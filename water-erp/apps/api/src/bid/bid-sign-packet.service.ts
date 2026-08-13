import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BidSignPacketDocxService } from './bid-sign-packet-docx.service';
import { lockAndReassertStage } from './bid-state';
import type { RegisterSignDto } from './dto/bid-sign-packet.dto';
import { createIntegrityStamp } from '../common/crypto/integrity-stamp';

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

  // generate / uploadExpertScan / uploadSignaturePageScan / generateHandover 在 Task 3/4/6 追加
}
