import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BidSignPacketDocxService } from './bid-sign-packet-docx.service';
import type { SignPacketSnapshot, OperationTrace } from './bid-sign-packet-docx.service';
import { lockAndReassertStage } from './bid-state';
import { closeSignLoopIfDone } from './sign-loop.util';
import { stripExpertEsignature } from '../expert/expert-esign.util';
import type { RegisterSignDto } from './dto/bid-sign-packet.dto';
import { createIntegrityStamp } from '../common/crypto/integrity-stamp';
import { convertOfficeToPdf } from '../common/office-to-pdf.util';
import { BidEvaluationResultsService } from './bid-evaluation-results.service'; // 值导入：emitDecoratorMetadata 需运行时引用，import type 会退化为 Object 致 DI 失败
import { buildStandardFileName } from '@water-erp/shared';
import { formatAmountWithUnit, resolveOpeningAmountUnitMap } from './opening-amount-unit.util';

export type SignStatusValue = 'PENDING' | 'SIGNED' | 'REFUSED_DISSENT' | 'DEEMED_AGREED';

export interface SignPacketExpertRow {
  expertId: string;
  name: string;
  major: string;
  role: string;
  /** A-132：评审分组（技术组|商务组|综合组）与组内职责（主审|复核|成员）；未设置为 null */
  reviewGroup: string | null;
  dutyRole: string | null;
  isLead: boolean;
  isPurchaserRepresentative: boolean;
  signStatus: SignStatusValue;
  signStatusAt: string | null;
  signScanUrl: string | null;
  dissentingOpinion: string | null;
  dissentingReason: string | null;
  /** A-152：电子签名剥壳摘要（同回流包口径 {algorithm, certSn, verifiedAt}；完整证据在 BidExpert.esignature） */
  esignature: { algorithm: string; certSn: string | null; verifiedAt: string | null } | null;
  esignatureAt: string | null;
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
    private readonly evalResults: BidEvaluationResultsService,
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
          reviewGroup: true, dutyRole: true,
          isPurchaserRepresentative: true, signStatus: true, signStatusAt: true,
          signScanFileId: true, dissentingOpinion: true, dissentingReason: true,
          esignature: true, esignatureAt: true,
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
        reviewGroup: e.reviewGroup,
        dutyRole: e.dutyRole,
        isLead: e.isLead,
        isPurchaserRepresentative: e.isPurchaserRepresentative,
        signStatus: e.signStatus as SignStatusValue,
        signStatusAt: e.signStatusAt ? e.signStatusAt.toISOString() : null,
        signScanUrl: e.signScanFileId ? `/api/upload/files/${e.signScanFileId}` : null,
        dissentingOpinion: e.dissentingOpinion,
        dissentingReason: e.dissentingReason,
        esignature: stripExpertEsignature(e.esignature),
        esignatureAt: e.esignatureAt ? e.esignatureAt.toISOString() : null,
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

      // 闭环判定：全体正选进入终态 → 置位 closedAt（共享 util：评委电子签名路径同闸，A-152）
      await closeSignLoopIfDone(tx, projectId, actorId, { projectName: project.name });
    });

    return this.getStatus(projectId);
  }

  /** 撤销重登（仅闭环前；原子回退 PENDING） */
  async unregister(projectId: string, expertId: string, actorId: string): Promise<SignPacketResponse> {
    const packet = await this.prisma.bidSignPacket.findUnique({ where: { projectId } });
    if (!packet) throw new ConflictException({ error: '签字包尚未生成', code: 'SIGN_PACKET_NOT_GENERATED' });
    if (packet.closedAt) throw new ConflictException({ error: '签字已闭环，登记通道已锁定', code: 'SIGN_PACKET_CLOSED' });

    // 终审 Critical#1：电子签名证据不可静默销毁——已电子签名的行禁止撤销回 PENDING
    //（否则陈旧 esignature 随 PENDING 行残留，徽标/计数失真、矛盾证据入归档链）；更正须重新生成整包（generate 清空链路）
    const signed = await this.prisma.bidExpert.findFirst({ where: { id: expertId, projectId }, select: { esignature: true } });
    if (signed?.esignature != null) {
      throw new BadRequestException({
        error: '该专家已电子签名，撤销须重新生成整包（电子签名证据不可静默销毁）',
        code: 'ESIGN_NOT_REVOCABLE',
      });
    }

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

  /** 上传该专家签字页/不同意见书扫描（替换旧件，同 key 覆盖） */
  async uploadExpertScan(projectId: string, expertId: string, file: UploadedSignScan, actorId: string): Promise<SignPacketResponse> {
    await this.assertScanUploadable(projectId, file);
    const expert = await this.prisma.bidExpert.findFirst({ where: { id: expertId, projectId } });
    if (!expert) throw new BadRequestException({ error: '该专家不属于此项目', code: 'EXPERT_NOT_IN_PROJECT' }); // 与 bid.service.ts:3341 现有约定一致（400 非 404）
    if (expert.expertRole !== '正选') throw new BadRequestException({ error: '候补专家不参与签字', code: 'SIGN_EXPERT_NOT_FORMAL' });

    const assetId = await this.storeScan(projectId, `expert-${expertId}`, file, 'expert_sign_scan', actorId);
    await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, projectId, 'EVALUATING');
      await tx.bidExpert.updateMany({ where: { id: expertId, projectId }, data: { signScanFileId: assetId } });
    });
    return this.getStatus(projectId);
  }

  /** 上传主报告签字页扫描（全员共签页） */
  async uploadSignaturePageScan(projectId: string, file: UploadedSignScan, actorId: string): Promise<SignPacketResponse> {
    await this.assertScanUploadable(projectId, file);
    const assetId = await this.storeScan(projectId, 'signature-page', file, 'sign_packet_signature_page', actorId);
    await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, projectId, 'EVALUATING');
      await tx.bidSignPacket.update({ where: { projectId }, data: { signPageScanFileId: assetId } });
    });
    return this.getStatus(projectId);
  }

  /** 公共前置：签字包存在 + 未闭环 + 文件类型白名单 */
  private async assertScanUploadable(projectId: string, file: UploadedSignScan): Promise<void> {
    const packet = await this.prisma.bidSignPacket.findUnique({ where: { projectId } });
    if (!packet) throw new ConflictException({ error: '签字包尚未生成，无法上传扫描件', code: 'SIGN_PACKET_NOT_GENERATED' });
    if (packet.closedAt) throw new ConflictException({ error: '签字已闭环，扫描件上传已锁定', code: 'SIGN_PACKET_CLOSED' });
    if (!SCAN_MIMES.has(file.mimetype)) {
      throw new BadRequestException({ error: '仅支持 jpg/png/pdf 扫描件', code: 'SIGN_SCAN_TYPE_INVALID' });
    }
  }

  /** 存 MinIO + 建 FileAsset，返回 asset id（同 key 覆盖，无孤儿对象） */
  private async storeScan(projectId: string, suffix: string, file: UploadedSignScan, category: string, actorId: string): Promise<string> {
    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/jpeg' ? 'jpg' : 'pdf';
    const objectKey = `bid-sign-packet/${projectId}/${suffix}.${ext}`;
    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.upload(objectKey, file.buffer, file.mimetype);
    // N2：重传时 MinIO 对象同 key 覆盖，FileAsset 若仍 create 会撞 key @unique（P2002 → 500）。
    // upsert：同 key 更新行（size/sha256/mimeType/originalName/uploaderId），与 MinIO 覆盖语义一致（P1-17 同款）。
    const asset = await this.prisma.fileAsset.upsert({
      where: { key: objectKey },
      create: {
        key: objectKey,
        originalName: file.originalname || `scan.${ext}`,
        mimeType: file.mimetype,
        size: file.buffer.length,
        sha256,
        category,
        uploaderId: actorId,
      },
      update: {
        originalName: file.originalname || `scan.${ext}`,
        mimeType: file.mimetype,
        size: file.buffer.length,
        sha256,
        uploaderId: actorId,
      },
    });
    return asset.id;
  }

  /** 评标回流包：签字闭环后生成独立 JSON 包（category=bid_evaluation_sign_handover），幂等、不改 stage */
  async generateHandover(projectId: string, actorId: string): Promise<SignPacketResponse> {
    const packet = await this.prisma.bidSignPacket.findUnique({ where: { projectId } });
    if (!packet) throw new ConflictException({ error: '签字包尚未生成', code: 'SIGN_PACKET_NOT_GENERATED' });
    if (!packet.closedAt) throw new ConflictException({ error: '签字未闭环，无法生成评标回流包', code: 'SIGN_HANDOVER_NOT_CLOSED' });
    if (packet.handoverFileAssetId) return this.getStatus(projectId); // 幂等：已生成直接返回

    // 基础快照复用评标完整性包（结果生成时的同一数据来源），扩展签字/异议/动议信息
    const base = await this.evalResults.buildEvaluationPackage(projectId);
    // 2026-09-18 完整性扩展 v2（「专家的一切归档」原则）：
    //  - 身份核验域整组（签到/AI 声明/回避——此前仅保密承诺与纪律经签字包 PDF 留痕，JSON 包不携带）
    //  - 专家备忘（ExpertMemo 文本 + 笔迹图 FileAsset 引用）
    //  - 条款裁定（BidRequirementReview，requirement-compare 产物）
    //  - AI 分析产物（task + bidderResults 核心结论 + AiBidReport；报告 docx/pdf 走 FileAsset 引用）
    //  - 评标段监督日志（与开标文件包 supervisionLogs 同口径）
    //  - 补齐字段：得分点 note / 动议投票理由+专家姓名 / 异议裁决留痕 / 澄清 A-143 签名证据链
    const [disputes, motions, clarifications, experts, evalResults, memos, requirementReviews, aiTask, supervisionLogs, scoreItemsForNames] = await Promise.all([
      this.prisma.expertDispute.findMany({ where: { projectId } }),
      this.prisma.bidMotion.findMany({ where: { projectId }, include: { votes: true } }),
      this.prisma.bidClarification.findMany({ where: { projectId } }),
      this.prisma.bidExpert.findMany({
        where: { projectId },
        select: {
          id: true, expertName: true, expertRole: true, signStatus: true, signStatusAt: true, signScanFileId: true,
          dissentingOpinion: true, dissentingReason: true, esignature: true, esignatureAt: true,
          signedIn: true, signInIp: true, signInMeta: true,
          confidentialityAgreed: true, confidentialityAgreedAt: true,
          disciplineAgreed: true, disciplineAgreedAt: true,
          aiConsentConfirmed: true, aiConsentAt: true,
          avoidanceConfirmed: true, conflictedSupplierIds: true,
        },
      }),
      this.prisma.bidEvaluationResult.findMany({ where: { projectId }, orderBy: { rank: 'asc' } }),
      this.prisma.expertMemo.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: {
          contentText: true, sourceDevice: true, createdAt: true, scoreItemId: true, scorePointId: true,
          expert: { select: { expertName: true } },
          supplier: { select: { supplierName: true } },
          inkFile: { select: { id: true, key: true, originalName: true, size: true, sha256: true } },
        },
      }),
      this.prisma.bidRequirementReview.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: {
          requirementId: true, category: true, verdict: true, note: true, createdAt: true,
          expert: { select: { expertName: true } },
          bidderResult: { select: { bidSupplier: { select: { supplierName: true } } } },
        },
      }),
      this.prisma.aiBidAnalysisTask.findUnique({
        where: { projectId },
        select: {
          status: true, aiProvenance: true, requirements: true,
          bidderResults: {
            select: {
              qualificationStatus: true, riskLevel: true, totalScore: true, starredResponse: true,
              scoreItems: true, categoryTotals: true, strengths: true, weaknesses: true,
              overallComment: true, deviationAnalysis: true, processedAt: true,
              bidSupplier: { select: { supplierName: true } },
            },
          },
          report: {
            select: {
              summary: true, ranking: true, keyInfoComparison: true, priceAnalysis: true, concordanceSummary: true,
              strengthsWeaknesses: true, scoreItemsDetail: true, riskStats: true, highRiskDetails: true,
              fraudIndicators: true, reviewSuggestions: true, conclusion: true, recommendation: true,
              generatedAt: true, docxFileId: true, pdfFileId: true,
            },
          },
        },
      }),
      this.prisma.bidSupervisionLog.findMany({
        where: { projectId },
        select: { time: true, role: true, action: true, target: true, result: true, riskFlag: true },
        orderBy: { time: 'asc' },
      }),
      // 备忘挂靠评分项/得分点名称解析（包自描述：归档离线可读，不靠回库反查 id）
      this.prisma.bidScoreItem.findMany({ where: { projectId }, select: { id: true, name: true, points: { select: { id: true, name: true } } } }),
    ]);
    const expertNameById = new Map(experts.map(e => [e.id, e.expertName]));
    const itemNameById = new Map(scoreItemsForNames.flatMap(i => [[i.id, i.name] as const, ...i.points.map(p => [p.id, p.name] as const)]));
    // AI 报告 docx/pdf 引用（category=general，key 不含项目 ID）——按 id 反查 FileAsset 拿 key/sha256 供归档校验
    const aiFileIds = [aiTask?.report?.docxFileId, aiTask?.report?.pdfFileId].filter((x): x is string => !!x);
    const aiFileById = new Map(
      (aiFileIds.length > 0
        ? await this.prisma.fileAsset.findMany({ where: { id: { in: aiFileIds } }, select: { id: true, key: true, originalName: true, size: true, sha256: true } })
        : []
      ).map(f => [f.id, f]),
    );
    const aiFileRef = (id: string | null) => {
      const f = id ? aiFileById.get(id) : null;
      return f ? { fileAssetId: f.id, key: f.key, originalName: f.originalName, size: f.size, sha256: f.sha256 } : null;
    };
    const body = {
      packageType: 'BID_EVALUATION_SIGN_HANDOVER',
      packageVersion: 2, // 2026-09-18 完整性扩展（身份核验域/备忘/条款裁定/AI 分析/监督日志/证据链补全）
      generatedAt: new Date().toISOString(),
      projectId,
      evaluationSnapshot: base, // 评标完整性快照（含 fingerprint）
      // A4 补齐（2026-09-04）：评标结果汇总（中标候选人排序+总得分+报价）——回传 :3005 开标确认
      // 面板展示与定标/预成交公示使用；Number 归一（Decimal 字符串不入包，与包内其他数值字段同风格）
      evaluationResults: evalResults.map(r => ({
        supplierId: r.supplierId, supplierName: r.supplierName,
        totalScore: Number(r.totalScore), averageScore: Number(r.averageScore),
        rank: r.rank, recommended: r.recommended, disqualified: r.disqualified,
        bidPrice: r.bidPrice != null ? Number(r.bidPrice) : null,
        generatedAt: r.generatedAt.toISOString(),
      })),
      signPacket: {
        fileAssetId: packet.fileAssetId, sha256: packet.sha256, generatedAt: packet.generatedAt.toISOString(),
        signPageScanFileId: packet.signPageScanFileId, closedAt: packet.closedAt!.toISOString(), // 上方已 if (!packet.closedAt) throw；! 显式收窄
      },
      expertSignStatuses: experts.map(e => ({
        expertName: e.expertName, expertRole: e.expertRole, signStatus: e.signStatus,
        signStatusAt: e.signStatusAt?.toISOString() ?? null, signScanFileId: e.signScanFileId,
        dissentingOpinion: e.dissentingOpinion, dissentingReason: e.dissentingReason,
        // A-152：电子签名剥壳摘要（完整证据在 BidExpert.esignature，payload/签名值不入回流包）
        esignature: stripExpertEsignature(e.esignature),
        esignatureAt: e.esignatureAt?.toISOString() ?? null,
        // ── 身份核验域（2026-09-18）：勾选/承诺的机器可读证据，与签字包 PDF 留痕表互补 ──
        signedIn: e.signedIn, signInIp: e.signInIp, signInMeta: e.signInMeta, // signInMeta 含 photoAssetId（签到照片引用）
        confidentialityAgreed: e.confidentialityAgreed, confidentialityAgreedAt: e.confidentialityAgreedAt?.toISOString() ?? null,
        disciplineAgreed: e.disciplineAgreed, disciplineAgreedAt: e.disciplineAgreedAt?.toISOString() ?? null,
        aiConsentConfirmed: e.aiConsentConfirmed, aiConsentAt: e.aiConsentAt?.toISOString() ?? null,
        avoidanceConfirmed: e.avoidanceConfirmed, conflictedSupplierIds: (e.conflictedSupplierIds as string[] | null) ?? [],
      })),
      // ── 专家备忘（手写/键盘，含笔迹图 FileAsset 引用——不内嵌字节，归档校验靠 sha256）──
      expertMemos: memos.map(m => ({
        expertName: m.expert?.expertName ?? '（专家）',
        supplierName: m.supplier?.supplierName ?? null,
        scoreItemId: m.scoreItemId, scoreItemName: m.scoreItemId ? itemNameById.get(m.scoreItemId) ?? null : null,
        scorePointId: m.scorePointId, scorePointName: m.scorePointId ? itemNameById.get(m.scorePointId) ?? null : null,
        contentText: m.contentText, sourceDevice: m.sourceDevice,
        createdAt: m.createdAt.toISOString(),
        ink: m.inkFile ? { fileAssetId: m.inkFile.id, key: m.inkFile.key, originalName: m.inkFile.originalName, size: m.inkFile.size, sha256: m.inkFile.sha256 } : null,
      })),
      // ── 条款裁定（requirement-compare 产物；requirementId 的解析源在下方 aiAnalysis.requirements）──
      requirementReviews: requirementReviews.map(r => ({
        expertName: r.expert?.expertName ?? '（专家）',
        supplierName: r.bidderResult?.bidSupplier?.supplierName ?? null,
        requirementId: r.requirementId, category: r.category, verdict: r.verdict, note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      // ── AI 分析产物：provenance（用了什么模型/prompt 的证据）+ 每家核心结论 + 汇总报告 ──
      // 边界：原始 OCR 文本（tenderText/technicalText/businessText）与逐家审计快照（extractedInfo/systemInfo/
      // requirementResponses/competitiveAnalysis）不入包——体积大且 DB 常驻；投标明文本体走 bid_decrypted 归档。
      aiAnalysis: aiTask ? {
        status: aiTask.status,
        aiProvenance: aiTask.aiProvenance,
        requirements: aiTask.requirements, // 招标要求提取（requirementReviews.requirementId 的原文解析源）
        bidders: aiTask.bidderResults.map(b => ({
          supplierName: b.bidSupplier?.supplierName ?? null,
          qualificationStatus: b.qualificationStatus, riskLevel: b.riskLevel,
          totalScore: b.totalScore != null ? Number(b.totalScore) : null,
          starredResponse: b.starredResponse, scoreItems: b.scoreItems, categoryTotals: b.categoryTotals,
          strengths: b.strengths, weaknesses: b.weaknesses, overallComment: b.overallComment,
          deviationAnalysis: b.deviationAnalysis, processedAt: b.processedAt?.toISOString() ?? null,
        })),
        report: aiTask.report ? {
          summary: aiTask.report.summary, ranking: aiTask.report.ranking, keyInfoComparison: aiTask.report.keyInfoComparison,
          priceAnalysis: aiTask.report.priceAnalysis, concordanceSummary: aiTask.report.concordanceSummary,
          strengthsWeaknesses: aiTask.report.strengthsWeaknesses, scoreItemsDetail: aiTask.report.scoreItemsDetail,
          riskStats: aiTask.report.riskStats, highRiskDetails: aiTask.report.highRiskDetails,
          fraudIndicators: aiTask.report.fraudIndicators, reviewSuggestions: aiTask.report.reviewSuggestions,
          conclusion: aiTask.report.conclusion, recommendation: aiTask.report.recommendation,
          generatedAt: aiTask.report.generatedAt?.toISOString() ?? null,
          docx: aiFileRef(aiTask.report.docxFileId), pdf: aiFileRef(aiTask.report.pdfFileId),
        } : null,
      } : null,
      // ── 评标段监督日志（开评标全周期动作留痕；与开标文件包 supervisionLogs 同 select 口径）──
      supervisionLogs: supervisionLogs.map(l => ({
        time: l.time.toISOString(), role: l.role, action: l.action, target: l.target, result: l.result, riskFlag: l.riskFlag,
      })),
      disputes: disputes.map(d => ({
        id: d.id, expertName: d.expertName, type: d.type, title: d.title, content: d.content,
        status: d.status, response: d.response,
        resolvedBy: d.resolvedBy, resolvedAt: d.resolvedAt?.toISOString() ?? null, // 裁决留痕
        createdAt: d.createdAt.toISOString(),
      })),
      motions: motions.map(m => ({
        id: m.id, type: m.type, title: m.title, description: m.description, status: m.status, result: m.result,
        createdBy: m.createdBy, closedAt: m.closedAt?.toISOString() ?? null,
        // 投票带专家姓名与理由（包自描述，离线读包无需回库反查 expertId）
        votes: m.votes.map(v => ({
          expertId: v.expertId, expertName: expertNameById.get(v.expertId) ?? '（专家）',
          vote: v.vote, reason: v.reason, createdAt: v.createdAt.toISOString(),
        })),
      })),
      clarifications: clarifications.map(c => ({
        id: c.id, type: c.type, supplierName: c.supplierName, question: c.question, issuer: c.issuer,
        reply: c.reply, status: c.status, aiSummary: c.aiSummary,
        // A-143 供应商答复证据链：渠道 + SM2 签名摘要 + 附件引用 + 操作人/离线缘由
        replyChannel: c.replyChannel, replySignature: c.replySignature, replyAttachmentIds: c.replyAttachmentIds,
        replyByName: c.replyByName, replyOfflineReason: c.replyOfflineReason,
        fileAssetId: c.fileAssetId, createdAt: c.createdAt.toISOString(),
      })),
    };

    const buffer = Buffer.from(JSON.stringify(body, null, 2), 'utf8');
    const objectKey = `bid-sign-handover/${projectId}.json`; // 同 key 覆盖
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    await this.storage.upload(objectKey, buffer, 'application/json');

    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { name: true } });
    // N14：幂等守卫已挡重复生成，此处 upsert 为防御性同 key 覆盖——若行已存在则更新指纹，
    // 保证 DB 记录与 MinIO 内容恒一致（与 N2/N3 同款，P1-17 同构）。
    const asset = await this.prisma.fileAsset.upsert({
      where: { key: objectKey },
      create: {
        key: objectKey, originalName: `评标回流包-${projectId}.json`, mimeType: 'application/json',
        size: buffer.length, sha256, category: 'bid_evaluation_sign_handover', uploaderId: actorId,
      },
      update: { size: buffer.length, sha256, uploaderId: actorId ?? null },
    });
    await this.prisma.bidSignPacket.update({
      where: { projectId },
      data: { handoverFileAssetId: asset.id, handoverSha256: sha256 },
    });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '开标主持人', target: project?.name ?? projectId,
        action: '生成评标回流包', result: `指纹 ${sha256.slice(0, 16)}…，可回传 :3005 归档`, riskFlag: '无',
        operatorId: actorId, operatorRole: 'bid_host',
      },
    });

    return this.getStatus(projectId);
  }

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
    const docxName = buildStandardFileName({ code: project.projectCode, docType: '评标签字包' });
    const pdf = convertOfficeToPdf(docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxName);
    const buffer = pdf ? pdf.buffer : docxBuffer;
    const mimeType = pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fileName = pdf ? docxName.replace(/\.docx$/, '.pdf') : docxName;

    const objectKey = `bid-sign-packet/${projectId}.${pdf ? 'pdf' : 'docx'}`; // 同 key 覆盖，MinIO 无孤儿对象
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    await this.storage.upload(objectKey, buffer, mimeType);

    // P1-17：重生成时 MinIO 对象同 key 覆盖，但旧 FileAsset 行仍挂同 key——
    // create 撞 key @unique（P2002 → 500）。改 upsert：同 key 更新行，与 MinIO 覆盖语义一致。
    const asset = await this.prisma.fileAsset.upsert({
      where: { key: objectKey },
      create: {
        key: objectKey, originalName: fileName, mimeType, size: buffer.length, sha256,
        category: 'bid_sign_packet', uploaderId: actorId,
      },
      update: {
        originalName: fileName, mimeType, size: buffer.length, sha256, uploaderId: actorId,
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
        data: { signStatus: 'PENDING', signStatusAt: null, signRegisteredBy: null, signScanFileId: null, dissentingOpinion: null, dissentingReason: null, esignature: Prisma.DbNull, esignatureAt: null },
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
  async buildSnapshot(projectId: string): Promise<SignPacketSnapshot> {
    const [project, committee, openingRecords, suppliers, invalidBids, scoreItems, results, disputes, clarifications, motions, verifyLogs] =
      await Promise.all([
        this.prisma.bidProject.findUnique({
          where: { id: projectId },
          select: { name: true, projectCode: true, procurementMethod: true, openTime: true, deadline: true, scope: true, qualification: true, budget: true, leaderCoSignedAt: true, reportNotes: true },
        }),
        this.prisma.bidExpert.findMany({
          where: { projectId, expertRole: '正选' },
          orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, expertName: true, major: true, expertRole: true, isLead: true, reviewGroup: true, dutyRole: true, isPurchaserRepresentative: true, signInIp: true, signInMeta: true, confidentialityAgreedAt: true, disciplineAgreedAt: true, reportConfirmedAt: true, signedIn: true, aiConsentConfirmed: true, aiConsentAt: true, avoidanceConfirmed: true },
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
        // R5（2026-09-20 §4.4）：核验事件入签字包证据链（降级/异常/替换三类留痕）
        this.prisma.bidSupervisionLog.findMany({
          where: { projectId, action: { in: ['身份核验降级', '核验异常', '核验异常撤销'] } },
          select: { time: true, action: true, target: true, result: true },
          orderBy: { time: 'asc' },
        }),
      ]);

    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    // 唱标金额单位解析（2026-09-14）：开标记录 amount 的单位标记（dual-v2=万元）
    const amountUnitMapForRecords = await resolveOpeningAmountUnitMap(this.prisma, projectId);
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
      // 2026-09-18 身份核验 §4.5：签到时间取自 signInMeta.timestamp（旧数据无 → at 保持 null）
      const signInMeta = (e.signInMeta ?? {}) as { timestamp?: string };
      const trace: OperationTrace = {
        identityVerified: { ip: e.signInIp, meta: e.signInMeta, at: signInMeta.timestamp ?? null },
        confidentialityAgreedAt: e.confidentialityAgreedAt ? e.confidentialityAgreedAt.toISOString() : null,
        disciplineAgreedAt: e.disciplineAgreedAt ? e.disciplineAgreedAt.toISOString() : null,
        aiConsentAt: e.aiConsentAt ? e.aiConsentAt.toISOString() : null, // 2026-09-18：留痕表加「AI 辅助声明确认」行
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
        reviewGroup: e.reviewGroup, dutyRole: e.dutyRole,
        isPurchaserRepresentative: e.isPurchaserRepresentative, signInIp: e.signInIp, signInMeta: e.signInMeta,
        confidentialityAgreedAt: e.confidentialityAgreedAt ? e.confidentialityAgreedAt.toISOString() : null,
        disciplineAgreedAt: e.disciplineAgreedAt ? e.disciplineAgreedAt.toISOString() : null,
        reportConfirmedAt: e.reportConfirmedAt ? e.reportConfirmedAt.toISOString() : null,
        // 2026-09-18：身份核验域入签字包 JSON 快照（PDF 留痕表仅 aiConsentAt 一行，回避明细见回流包）
        signedIn: e.signedIn, aiConsentConfirmed: e.aiConsentConfirmed,
        aiConsentAt: e.aiConsentAt ? e.aiConsentAt.toISOString() : null,
        avoidanceConfirmed: e.avoidanceConfirmed,
      })),
      leaderCoSignedAt: project.leaderCoSignedAt ? project.leaderCoSignedAt.toISOString() : null,
      reportNotes: (project.reportNotes as Array<{ section: string; content: string }>) ?? undefined,
      // 唱标金额单位（2026-09-14）：单位戳优先（amountUnit 列），回退轨道推导——签字包纸面/JSON 证据金额自含单位
      openingRecords: openingRecords.map(r => {
        const unit = r.amountUnit ?? ((r.bidSupplierId ? amountUnitMapForRecords.get(r.bidSupplierId) : null) ?? null);
        return { supplierName: r.supplierName, amount: formatAmountWithUnit(r.amount, unit), amountUnit: unit, period: r.period, qualityTarget: r.qualityTarget, bondStatus: r.bondStatus, confirmStatus: r.confirmStatus };
      }),
      bids: suppliers.map(s => ({ supplierName: s.supplierName, amount: '（见开标记录）', period: '（见开标记录）', submittedAt: s.createdAt.toISOString() })),
      invalidBids: invalidBids.map(b => ({ supplierName: suppliers.find(s => s.id === b.supplierId)?.supplierName ?? '（未知供应商）', reason: b.reason })),
      scoreStandard: scoreItems.map(i => ({ category: i.category, name: i.name, maxScore: Number(i.maxScore), points: i.points.map(p => p.name) })),
      results: results.map(r => ({ supplierName: r.supplierName, totalScore: Number(r.totalScore), averageScore: Number(r.averageScore), rank: r.rank, recommended: r.recommended, disqualified: r.disqualified, bidPrice: r.bidPrice ? Number(r.bidPrice) : null })),
      expertSheets,
      disputes: disputes.map(d => ({ expertName: d.expertName, type: d.type, title: d.title, content: d.content, status: d.status, response: d.response, createdAt: d.createdAt.toISOString() })),
      clarifications: clarifications.map(c => ({ supplierName: c.supplierName, question: c.question, reply: c.reply, createdAt: c.createdAt.toISOString() })),
      motions: motions.map(m => ({ title: m.title, description: m.description, status: m.status, result: m.result, votes: m.votes.map(v => ({ expertName: committee.find(e => e.id === v.expertId)?.expertName ?? '（专家）', vote: v.vote })) })),
      // R5（2026-09-20 §4.4）：核验事件（降级/异常/替换）入签字包——核验记录表附注披露
      verifyEvents: verifyLogs.map(l => ({
        time: l.time.toISOString(), action: l.action, target: l.target, result: l.result,
      })),
    };
  }
}
