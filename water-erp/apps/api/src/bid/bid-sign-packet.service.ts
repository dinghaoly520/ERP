import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BidSignPacketDocxService } from './bid-sign-packet-docx.service';
import type { SignPacketSnapshot, OperationTrace } from './bid-sign-packet-docx.service';
import { lockAndReassertStage } from './bid-state';
import type { RegisterSignDto } from './dto/bid-sign-packet.dto';
import { createIntegrityStamp } from '../common/crypto/integrity-stamp';
import { convertOfficeToPdf } from '../common/office-to-pdf.util';

export type SignStatusValue = 'PENDING' | 'SIGNED' | 'REFUSED_DISSENT' | 'DEEMED_AGREED';

export interface SignPacketExpertRow {
  expertId: string;
  name: string;
  major: string;
  role: string;
  isLead: boolean;
  isPurchaserRepresentative: boolean;
  signStatus: SignStatusValue;
  signStatusAt: string | null;
  signScanUrl: string | null;
  dissentingOpinion: string | null;
  dissentingReason: string | null;
}

export interface SignPacketResponse {
  stage: string;
  resultsGenerated: boolean;
  canGenerate: boolean;
  packet: {
    id: string;
    sha256: string;
    generatedAt: string;
    downloadUrl: string;
    signPageScanUrl: string | null;
    closedAt: string | null;
    closed: boolean;
    handoverFileAssetId: string | null;
    handoverSha256: string | null;
    handoverDownloadUrl: string | null;
  } | null;
  experts: SignPacketExpertRow[];
  allClosed: boolean;
}

export interface UploadedSignScan {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

const SCAN_MIMES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

@Injectable()
export class BidSignPacketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly docxService: BidSignPacketDocxService,
  ) {}

  /** 组装响应（GET 与各写端点共用，保证前端只依赖一个形状） */
  async getStatus(projectId: string): Promise<SignPacketResponse> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, stage: true },
    });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });

    const [packet, resultsCount, experts] = await Promise.all([
      this.prisma.bidSignPacket.findUnique({ where: { projectId } }),
      this.prisma.bidEvaluationResult.count({ where: { projectId } }),
      this.prisma.bidExpert.findMany({
        where: { projectId },
        orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true, expertName: true, major: true, expertRole: true, isLead: true,
          isPurchaserRepresentative: true, signStatus: true, signStatusAt: true,
          signScanFileId: true, dissentingOpinion: true, dissentingReason: true,
        },
      }),
    ]);

    const resultsGenerated = resultsCount > 0;
    return {
      stage: project.stage,
      resultsGenerated,
      canGenerate: project.stage === 'EVALUATING' && resultsGenerated,
      packet: packet
        ? {
            id: packet.id,
            sha256: packet.sha256,
            generatedAt: packet.generatedAt.toISOString(),
            downloadUrl: `/api/upload/files/${packet.fileAssetId}`,
            signPageScanUrl: packet.signPageScanFileId ? `/api/upload/files/${packet.signPageScanFileId}` : null,
            closedAt: packet.closedAt ? packet.closedAt.toISOString() : null,
            closed: packet.closedAt != null,
            handoverFileAssetId: packet.handoverFileAssetId,
            handoverSha256: packet.handoverSha256,
            handoverDownloadUrl: packet.handoverFileAssetId ? `/api/upload/files/${packet.handoverFileAssetId}` : null,
          }
        : null,
      experts: experts.map((e) => ({
        expertId: e.id,
        name: e.expertName,
        major: e.major,
        role: e.expertRole,
        isLead: e.isLead,
        isPurchaserRepresentative: e.isPurchaserRepresentative,
        signStatus: e.signStatus as SignStatusValue,
        signStatusAt: e.signStatusAt ? e.signStatusAt.toISOString() : null,
        signScanUrl: e.signScanFileId ? `/api/upload/files/${e.signScanFileId}` : null,
        dissentingOpinion: e.dissentingOpinion,
        dissentingReason: e.dissentingReason,
      })),
      allClosed: packet?.closedAt != null,
    };
  }

  /** 登记（§43 语义服务端强制；最后一名正选进入终态 → 自动闭环） */
  async register(projectId: string, expertId: string, dto: RegisterSignDto, actorId: string): Promise<SignPacketResponse> {
    const packet = await this.prisma.bidSignPacket.findUnique({ where: { projectId } });
    if (!packet) throw new ConflictException({ error: '签字包尚未生成，无法登记', code: 'SIGN_PACKET_NOT_GENERATED' });
    if (packet.closedAt) throw new ConflictException({ error: '签字已闭环，登记通道已锁定；如需变更请走管理员通道', code: 'SIGN_PACKET_CLOSED' });

    const expert = await this.prisma.bidExpert.findFirst({ where: { id: expertId, projectId } });
    if (!expert) throw new BadRequestException({ error: '该专家不属于此项目', code: 'EXPERT_NOT_IN_PROJECT' }); // 与 bid.service.ts:3341 现有约定一致（400 非 404）
    if (expert.expertRole !== '正选') throw new BadRequestException({ error: '候补专家不参与签字', code: 'SIGN_EXPERT_NOT_FORMAL' });

    // §43：拒绝签字须书面陈述不同意见；拒绝且不陈述理由 = 视为同意
    let opinion = dto.dissentingOpinion?.trim() || null;
    let reason = dto.dissentingReason?.trim() || null;
    if (dto.status === 'REFUSED_DISSENT' && !opinion) {
      throw new BadRequestException({
        error: '拒绝签字须书面陈述不同意见；拒绝签字且不陈述理由的，视为同意评标结论',
        code: 'SIGN_DISSENT_REQUIRED',
      });
    }
    if (dto.status === 'DEEMED_AGREED') {
      opinion = null;
      reason = null;
    }

    await this.prisma.$transaction(async (tx) => {
      const project = await lockAndReassertStage(tx, projectId, 'EVALUATING');

      // 原子抢占：仅 PENDING 可登记，防并发双登
      const updated = await tx.bidExpert.updateMany({
        where: { id: expertId, projectId, signStatus: 'PENDING' },
        data: {
          signStatus: dto.status,
          signStatusAt: new Date(),
          signRegisteredBy: actorId,
          dissentingOpinion: opinion,
          dissentingReason: reason,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException({ error: '该专家已登记，请先撤销再重登', code: 'SIGN_ALREADY_REGISTERED' });
      }

      const stamp = createIntegrityStamp(actorId, 'expert-sign-register', expertId);
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: expert.expertName,
          action: '评标签字登记', result: `状态：${dto.status}（审计戳 ${stamp.sig.slice(0, 16)}…）`,
          riskFlag: dto.status === 'REFUSED_DISSENT' ? '中' : '无',
          operatorId: actorId, operatorRole: 'bid_host',
        },
      });

      // 闭环判定：全体正选进入终态 → 置位 closedAt
      const pendingCount = await tx.bidExpert.count({ where: { projectId, expertRole: '正选', signStatus: 'PENDING' } });
      if (pendingCount === 0) {
        await tx.bidSignPacket.update({ where: { projectId }, data: { closedAt: new Date(), closedById: actorId } });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: project.name,
            action: '评标签字闭环', result: '全体正选专家签字登记完成，可生成评标回流包', riskFlag: '无',
            operatorId: actorId, operatorRole: 'bid_host',
          },
        });
      }
    });

    return this.getStatus(projectId);
  }

  /** 撤销重登（仅闭环前；原子回退 PENDING） */
  async unregister(projectId: string, expertId: string, actorId: string): Promise<SignPacketResponse> {
    const packet = await this.prisma.bidSignPacket.findUnique({ where: { projectId } });
    if (!packet) throw new ConflictException({ error: '签字包尚未生成', code: 'SIGN_PACKET_NOT_GENERATED' });
    if (packet.closedAt) throw new ConflictException({ error: '签字已闭环，登记通道已锁定', code: 'SIGN_PACKET_CLOSED' });

    await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, projectId, 'EVALUATING');
      const updated = await tx.bidExpert.updateMany({
        where: { id: expertId, projectId, signStatus: { not: 'PENDING' } },
        data: { signStatus: 'PENDING', signStatusAt: null, signRegisteredBy: null, dissentingOpinion: null, dissentingReason: null },
      });
      if (updated.count === 0) throw new BadRequestException({ error: '该专家尚未登记', code: 'SIGN_NOT_REGISTERED' });
    });

    return this.getStatus(projectId);
  }

  // uploadExpertScan / uploadSignaturePageScan / generateHandover 在 Task 4/6 追加

  /** 生成签字包：快照评标数据 → docx → PDF → MinIO → BidSignPacket（重生成覆盖旧包并重置全员 PENDING） */
  async generate(projectId: string, actorId: string): Promise<SignPacketResponse> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, stage: true, name: true, projectCode: true },
    });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new ConflictException({ error: '仅评标阶段可生成签字包', code: 'SIGN_PACKET_STAGE_REQUIRED' });
    }
    const resultsCount = await this.prisma.bidEvaluationResult.count({ where: { projectId } });
    if (resultsCount === 0) {
      throw new ConflictException({ error: '尚未生成评标结果，无法生成签字包', code: 'SIGN_PACKET_RESULTS_MISSING' });
    }
    // 闭环锁定：签字包闭环后禁止重生成（回流包指纹已并入归档哈希链，重生成会使其失效）
    const existing = await this.prisma.bidSignPacket.findUnique({ where: { projectId } });
    if (existing?.closedAt) {
      throw new ConflictException({ error: '签字已闭环，签字包已锁定；如需更正请走数据修正流程', code: 'SIGN_PACKET_CLOSED' });
    }

    const snapshot = await this.buildSnapshot(projectId);
    const docxBuffer = await this.docxService.generateDocument(snapshot);

    // 打印降级（spec §10）：libreoffice 失败时直接提供 DOCX 下载
    const docxName = `评标签字包-${project.projectCode}.docx`;
    const pdf = convertOfficeToPdf(docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxName);
    const buffer = pdf ? pdf.buffer : docxBuffer;
    const mimeType = pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fileName = pdf ? docxName.replace(/\.docx$/, '.pdf') : docxName;

    const objectKey = `bid-sign-packet/${projectId}.${pdf ? 'pdf' : 'docx'}`; // 同 key 覆盖，MinIO 无孤儿对象
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    await this.storage.upload(objectKey, buffer, mimeType);

    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey, originalName: fileName, mimeType, size: buffer.length, sha256,
        category: 'bid_sign_packet', uploaderId: actorId,
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, projectId, 'EVALUATING');
      // 重生成：覆盖旧包引用、重置全员签字状态（数据快照可能已变，spec §7）
      const old = await tx.bidSignPacket.findUnique({ where: { projectId } });
      await tx.bidSignPacket.upsert({
        where: { projectId },
        create: { projectId, fileAssetId: asset.id, sha256, generatedAt: new Date(), generatedById: actorId },
        update: { fileAssetId: asset.id, sha256, generatedAt: new Date(), generatedById: actorId, signPageScanFileId: null, closedAt: null, closedById: null },
      });
      await tx.bidExpert.updateMany({
        where: { projectId, expertRole: '正选' },
        data: { signStatus: 'PENDING', signStatusAt: null, signRegisteredBy: null, signScanFileId: null, dissentingOpinion: null, dissentingReason: null },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: project.name,
          action: old ? '签字包重新生成' : '生成评标签字包', result: `指纹 ${sha256.slice(0, 16)}…（旧状态已重置）`, riskFlag: '无',
          operatorId: actorId, operatorRole: 'bid_host',
        },
      });
    });

    return this.getStatus(projectId);
  }

  /** 快照评标全量数据（§42 十项 + 签字页 + 个人表 + 异议/澄清/动议） */
  private async buildSnapshot(projectId: string): Promise<SignPacketSnapshot> {
    const [project, committee, openingRecords, suppliers, invalidBids, scoreItems, results, disputes, clarifications, motions] =
      await Promise.all([
        this.prisma.bidProject.findUnique({
          where: { id: projectId },
          select: { name: true, projectCode: true, procurementMethod: true, openTime: true, deadline: true, scope: true, qualification: true, budget: true, leaderCoSignedAt: true },
        }),
        this.prisma.bidExpert.findMany({
          where: { projectId, expertRole: '正选' },
          orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, expertName: true, major: true, expertRole: true, isLead: true, isPurchaserRepresentative: true, signInIp: true, signInMeta: true, confidentialityAgreedAt: true, disciplineAgreedAt: true, reportConfirmedAt: true },
        }),
        this.prisma.bidOpeningRecord.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
        this.prisma.bidSupplier.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' }, select: { id: true, supplierName: true, createdAt: true } }),
        // BidInvalidBid 每行即一条废标记录，不过滤 status（避免误依赖未核实的枚举值）
        this.prisma.bidInvalidBid.findMany({ where: { projectId } }),
        this.prisma.bidScoreItem.findMany({ where: { projectId }, include: { points: true } }),
        this.prisma.bidEvaluationResult.findMany({ where: { projectId }, orderBy: { rank: 'asc' } }),
        this.prisma.expertDispute.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
        this.prisma.bidClarification.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
        this.prisma.bidMotion.findMany({ where: { projectId }, include: { votes: true }, orderBy: { createdAt: 'asc' } }),
      ]);

    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    // 得分点取自 scoreItems 的 include（BidScorePoint 无 projectId 列，经 scoreItem 关联）
    const points = scoreItems.flatMap((i) => i.points);
    const expertIds = committee.map(e => e.id);
    const [records, pointDecisions, history, reviews] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({ where: { expertId: { in: expertIds } }, select: { expertId: true, supplierId: true, scoreItemId: true, score: true, passed: true, reason: true } }),
      this.prisma.bidScorePointDecision.findMany({ where: { expertId: { in: expertIds } }, select: { expertId: true, pointId: true, supplierId: true, checked: true, awardedScore: true } }),
      this.prisma.bidScoreRecordHistory.findMany({ where: { expertId: { in: expertIds } }, orderBy: { createdAt: 'asc' }, select: { expertId: true, createdAt: true } }),
      this.prisma.bidScoreReview.findMany({ where: { expertId: { in: expertIds }, status: 'verified' }, select: { expertId: true, verifiedAt: true } }),
    ]);
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.supplierName]));
    const pointNameById = new Map(points.map(p => [p.id, p.name]));
    const itemNameById = new Map(scoreItems.map(i => [i.id, i.name]));
    const itemCategoryById = new Map(scoreItems.map(i => [i.id, i.category]));

    // 每位专家：最早评分提交时间 = history 最早 createdAt；核对时间 = 各 review 最早 verifiedAt
    const firstScoreAt = new Map<string, string>();
    for (const h of history) if (!firstScoreAt.has(h.expertId)) firstScoreAt.set(h.expertId, h.createdAt.toISOString());
    const verifiedAt = new Map<string, string>();
    for (const r of reviews) {
      const t = r.verifiedAt ? r.verifiedAt.toISOString() : null;
      if (t && (!verifiedAt.has(r.expertId) || t < verifiedAt.get(r.expertId)!)) verifiedAt.set(r.expertId, t);
    }

    const expertSheets = committee.map(e => {
      const trace: OperationTrace = {
        identityVerified: { ip: e.signInIp, meta: e.signInMeta, at: null },
        confidentialityAgreedAt: e.confidentialityAgreedAt ? e.confidentialityAgreedAt.toISOString() : null,
        disciplineAgreedAt: e.disciplineAgreedAt ? e.disciplineAgreedAt.toISOString() : null,
        scoreSubmittedAt: firstScoreAt.get(e.id) ?? null,
        scoreVerifiedAt: verifiedAt.get(e.id) ?? null,
        reportConfirmedAt: e.reportConfirmedAt ? e.reportConfirmedAt.toISOString() : null,
        leaderCoSignedAt: e.isLead && project.leaderCoSignedAt ? project.leaderCoSignedAt.toISOString() : null,
      };
      return {
        expertId: e.id,
        name: e.expertName,
        major: e.major,
        role: e.expertRole,
        rows: records.filter(r => r.expertId === e.id).map(r => ({
          supplierName: supplierNameById.get(r.supplierId) ?? '（未知供应商）',
          scoreItemName: itemNameById.get(r.scoreItemId) ?? '（未知评分项）',
          category: itemCategoryById.get(r.scoreItemId) ?? '',
          score: Number(r.score),
          passed: r.passed,
          reason: r.reason,
        })),
        pointDecisions: pointDecisions.filter(d => d.expertId === e.id).map(d => ({
          pointName: pointNameById.get(d.pointId) ?? '（未知得分点）',
          supplierName: supplierNameById.get(d.supplierId) ?? '（未知供应商）',
          checked: d.checked,
          awardedScore: Number(d.awardedScore),
        })),
        trace,
      };
    });

    return {
      packageType: 'BID_SIGN_PACKET',
      packageVersion: 1,
      generatedAt: new Date().toISOString(),
      project: {
        name: project.name, projectCode: project.projectCode, procurementMethod: project.procurementMethod,
        openTime: project.openTime ? project.openTime.toISOString() : null,
        deadline: project.deadline ? project.deadline.toISOString() : null,
        scope: project.scope, qualification: project.qualification, budget: project.budget ? Number(project.budget) : null,
      },
      committee: committee.map(e => ({
        expertId: e.id, name: e.expertName, major: e.major, role: e.expertRole, isLead: e.isLead,
        isPurchaserRepresentative: e.isPurchaserRepresentative, signInIp: e.signInIp, signInMeta: e.signInMeta,
        confidentialityAgreedAt: e.confidentialityAgreedAt ? e.confidentialityAgreedAt.toISOString() : null,
        disciplineAgreedAt: e.disciplineAgreedAt ? e.disciplineAgreedAt.toISOString() : null,
        reportConfirmedAt: e.reportConfirmedAt ? e.reportConfirmedAt.toISOString() : null,
      })),
      leaderCoSignedAt: project.leaderCoSignedAt ? project.leaderCoSignedAt.toISOString() : null,
      openingRecords: openingRecords.map(r => ({ supplierName: r.supplierName, amount: r.amount, period: r.period, qualityTarget: r.qualityTarget, bondStatus: r.bondStatus, confirmStatus: r.confirmStatus })),
      bids: suppliers.map(s => ({ supplierName: s.supplierName, amount: '（见开标记录）', period: '（见开标记录）', submittedAt: s.createdAt.toISOString() })),
      invalidBids: invalidBids.map(b => ({ supplierName: suppliers.find(s => s.id === b.supplierId)?.supplierName ?? '（未知供应商）', reason: b.reason })),
      scoreStandard: scoreItems.map(i => ({ category: i.category, name: i.name, maxScore: Number(i.maxScore), points: i.points.map(p => p.name) })),
      results: results.map(r => ({ supplierName: r.supplierName, totalScore: Number(r.totalScore), averageScore: Number(r.averageScore), rank: r.rank, recommended: r.recommended, disqualified: r.disqualified, bidPrice: r.bidPrice ? Number(r.bidPrice) : null })),
      expertSheets,
      disputes: disputes.map(d => ({ expertName: d.expertName, type: d.type, title: d.title, content: d.content, status: d.status, response: d.response, createdAt: d.createdAt.toISOString() })),
      clarifications: clarifications.map(c => ({ supplierName: c.supplierName, question: c.question, reply: c.reply, createdAt: c.createdAt.toISOString() })),
      motions: motions.map(m => ({ title: m.title, description: m.description, status: m.status, result: m.result, votes: m.votes.map(v => ({ expertName: committee.find(e => e.id === v.expertId)?.expertName ?? '（专家）', vote: v.vote })) })),
    };
  }
}
