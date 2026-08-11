import { Injectable, Optional, NotFoundException, ForbiddenException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { BidGateway } from '../bid/bid.gateway';
import { ClarificationAiService } from '../bid/clarification-ai.service';
import { PlaintextFetcherService, BidderFileType } from '../ai-bid-analysis/services/plaintext-fetcher.service';
import { BatchScoreDto } from './dto/batch-score.dto';
import { UpdateExpertProfileDto } from './dto/update-profile.dto';
import { ConfirmContactDto } from './dto/confirm-contact.dto';
import { CreateExpertClarificationDto } from './dto/create-expert-clarification.dto';
import { UpsertRequirementReviewDto } from './dto/upsert-requirement-review.dto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { decryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';
import { unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { recomputeExpertProgress, recomputeItemFromDecisions } from '../bid/score-recalculate.helper';
import { evaluateInvalidBid } from '../bid/evaluate-invalid-bid.helper';
import { parseConflictedIds } from './expert.util';
import { checkScoreAnomaly, type ScoreRecordInput } from './expert-deviation';

@Injectable()
export class ExpertService {
  private readonly logger = new Logger(ExpertService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private conflictService: ExpertConflictService,
    private plaintextFetcher: PlaintextFetcherService,
    @Optional() private readonly clarificationAi?: ClarificationAiService,
    @Optional() private readonly gateway?: BidGateway,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {}

  /* ── 个人资料 ── */

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        expertProfile: {
          select: {
            specialty: true,
            title: true,
            employer: true,
            phone: true,
            idNumber: true,
            ethnicity: true,
            education: true,
            licenseNo: true,
            contactConfirmedAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException({ error: '用户不存在', code: 'USER_NOT_FOUND' });
    const expertRecords = await this.prisma.bidExpert.findMany({
      where: {
        userId,
        project: { stage: { in: ['OPENING', 'EVALUATING', 'ARCHIVED'] } },
      },
      include: {
        project: { select: { id: true, projectCode: true, name: true, stage: true, openTime: true } },
        scoreRecords: { include: { scoreItem: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const { passwordHash, ...safeUser } = user;
    return { ...safeUser, assignments: expertRecords, averageScore: this.computeAverageScore(expertRecords) };
  }

  async updateProfile(userId: string, dto: UpdateExpertProfileDto) {
    const data: Record<string, string> = {};
    if (dto.displayName) data.displayName = dto.displayName;
    if (dto.email) data.email = dto.email;

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    // Persist major to the expert's BidExpert records (current active assignments)
    if (dto.major) {
      await this.prisma.bidExpert.updateMany({
        where: { userId, signedIn: false },
        data: { major: dto.major },
      });
    }

    const updated = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!updated) return null;
    // 剥离密码哈希，避免敏感字段外泄（对齐 getProfile）
    const { passwordHash, ...safeUser } = updated;
    return safeUser;
  }

  /* ── 联系方式确认（首次登录弹窗）── */

  async getContactCheck(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, phone: true, email: true },
    });
    if (!user) throw new NotFoundException({ error: '用户不存在', code: 'USER_NOT_FOUND' });
    const ep = await this.prisma.expertProfile.findUnique({
      where: { userId },
      select: { phone: true, contactConfirmedAt: true },
    });
    return {
      displayName: user.displayName,
      phone: ep?.phone || user.phone || '',
      email: user.email || '',
      contactConfirmedAt: ep?.contactConfirmedAt || null,
    };
  }

  async confirmContact(userId: string, dto: ConfirmContactDto) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { phone: dto.phone, ...(dto.email && { email: dto.email }) },
      }),
      this.prisma.expertProfile.upsert({
        where: { userId },
        update: { phone: dto.phone, contactConfirmedAt: now },
        create: { userId, specialty: '综合', phone: dto.phone, contactConfirmedAt: now },
      }),
    ]);
    return this.getContactCheck(userId);
  }

  /* ── 统计概览 ── */

  async getStatistics(userId: string) {
    const records = await this.prisma.bidExpert.findMany({
      where: {
        userId,
        project: { stage: { in: ['OPENING', 'EVALUATING', 'ARCHIVED'] } },
      },
      include: { scoreRecords: true, project: true },
    });

    const totalProjects = records.length;
    const completedProjects = records.filter(e => e.progress >= 100).length;
    const signedInProjects = records.filter(e => e.signedIn).length;
    const pendingProjects = records.filter(e => !e.signedIn).length;
    const averageScore = this.computeAverageScore(records);

    // 获取专家名称用于查询监督日志；无项目分配时跳过查询避免全量泄露
    const expertName = records.length > 0 ? records[0].expertName : '';
    const recentActivity = expertName
      ? await this.prisma.bidSupervisionLog.findMany({
          where: { target: { contains: expertName } },
          orderBy: { time: 'desc' },
          take: 5,
        })
      : [];

    return { totalProjects, completedProjects, signedInProjects, pendingProjects, averageScore, recentActivity };
  }

  /** 平均得分 = 该专家对每位供应商的总评分（按 supplierId 聚合）取平均；无评分返回 0 */
  private computeAverageScore(
    records: ReadonlyArray<{ scoreRecords: ReadonlyArray<{ supplierId: string; score: Prisma.Decimal | number }> }>,
  ): number {
    const supplierScoreMap = new Map<string, number>();
    for (const e of records) {
      for (const r of e.scoreRecords) {
        supplierScoreMap.set(r.supplierId, (supplierScoreMap.get(r.supplierId) ?? 0) + Number(r.score));
      }
    }
    const totals = [...supplierScoreMap.values()];
    return totals.length > 0
      ? Math.round((totals.reduce((s, v) => s + v, 0) / totals.length) * 10) / 10
      : 0;
  }

  /* ── 项目列表 ── */

  async listProjects(userId: string) {
    const records = await this.prisma.bidExpert.findMany({
      where: {
        userId,
        project: { stage: { in: ['OPENING', 'EVALUATING', 'ARCHIVED'] } },
      },
      include: {
        project: {
          include: {
            suppliers: true,
            scoreItems: true,
            _count: { select: { clarifications: true } },
          },
        },
        scoreRecords: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Sort: active projects (OPENING > EVALUATING) first, then others by createdAt desc.
    const stagePriority: Record<string, number> = { OPENING: 0, EVALUATING: 1 };
    return records.sort((a, b) => {
      const pa = stagePriority[a.project.stage] ?? 2;
      const pb = stagePriority[b.project.stage] ?? 2;
      if (pa !== pb) return pa - pb;
      return 0; // preserve existing createdAt desc order
    });
  }

  /** 我的评审邀请（邀请确认链接落地页用）：返回项目基础信息 + 本人邀请状态 */
  async getMyInvitation(userId: string, projectId: string) {
    const record = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
      include: {
        project: {
          select: { id: true, name: true, projectCode: true, procurementMethod: true, openTime: true, deadline: true, stage: true, isExtractionOnly: true },
        },
      },
    });
    if (!record) throw new NotFoundException({ error: '未找到该项目的评审邀请', code: 'INVITATION_NOT_FOUND' });
    return {
      projectId: record.projectId,
      projectName: record.project.name,
      projectCode: record.project.projectCode,
      procurementMethod: record.project.procurementMethod,
      openTime: record.project.openTime,
      deadline: record.project.deadline,
      stage: record.project.stage,
      isExtractionOnly: record.project.isExtractionOnly,
      expertRole: record.expertRole,
      invitationStatus: record.invitationStatus,
      signedIn: record.signedIn,
    };
  }

  async getProject(userId: string, projectId: string) {
    const expertRecord = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
      include: {
        user: { include: { expertProfile: true } },
      },
    });
    if (!expertRecord) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { select: { id: true, expertName: true, major: true, signedIn: true, avoidanceConfirmed: true, progress: true, reportConfirmed: true } },
        scoreItems: {
          orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
          include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
        },
        clarifications: { orderBy: { createdAt: 'desc' } },
        supervisionLogs: { orderBy: { time: 'desc' }, take: 20 },
      },
    });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });

    const isActive = project.stage === 'OPENING' || project.stage === 'EVALUATING';

    // Compute masked phone from ExpertProfile
    const phone = expertRecord.user?.expertProfile?.phone ?? null;
    const phoneMasked = phone
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : null;

    // 查询该专家在本项目所有供应商的评分核对状态
    const scoreReviews = await this.prisma.bidScoreReview.findMany({
      where: { expertId: expertRecord.id, projectId },
      select: { supplierId: true, status: true, verifiedAt: true },
    });

    const myExpertRecord = {
      ...expertRecord,
      phoneVerified: expertRecord.phoneVerified,
      phoneMasked,
      // Exclude nested user object from response
      user: undefined,
      scoreReviews: scoreReviews.map(r => ({
        supplierId: r.supplierId,
        status: r.status,
        verifiedAt: r.verifiedAt,
      })),
    };

    if (!isActive) {
      // Return restricted data for non-active projects — no suppliers, experts, scores, etc.
      return {
        id: project.id,
        projectCode: project.projectCode,
        name: project.name,
        stage: project.stage,
        openTime: project.openTime,
        deadline: project.deadline,
        procurementMethod: project.procurementMethod,
        budget: project.budget,
        scope: project.scope,
        qualification: project.qualification,
        contact: project.contact,
        riskNote: project.riskNote,
        _count: { suppliers: project.suppliers?.length ?? 0 },
        suppliers: [] as any[],
        openingSession: null,
        openingRecords: [] as any[],
        experts: [] as any[],
        scoreItems: [] as any[],
        clarifications: [] as any[],
        supervisionLogs: [] as any[],
        myExpertRecord,
        myScores: [] as any[],
        tenderDocument: null,
        restricted: true,
      };
    }

    // 获取当前专家自己的评分记录
    const myScores = await this.prisma.bidScoreRecord.findMany({
      where: { expertId: expertRecord.id },
      include: { scoreItem: true },
    });

    // 招标文件元信息：通过 projectId 或公告链（OPEN 公告的 bidProjectId 为 null，但
    // announcement.relatedProjectCode 匹配当前 projectCode）查找
    const tenderDoc = await this.prisma.bidDocument.findFirst({
      where: {
        OR: [
          { bidProjectId: projectId },
          { announcement: { relatedProjectCode: project.projectCode } },
        ],
      },
      include: { fileAsset: true },
    });
    return {
      ...project,
      myExpertRecord,
      myScores,
      restricted: false,
      tenderDocument: this.buildTenderDocumentMeta(tenderDoc, projectId),
    };
  }

  /* ── 身份核验 ── */

  async signIn(userId: string, projectId: string) {
    // P1: 阶段门控 — 仅开标/评标阶段可签到
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可签到阶段', code: 'PROJECT_NOT_ACTIVE' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    if (!expert.phoneVerified) {
      throw new ForbiddenException({
        code: 'PHONE_NOT_VERIFIED',
        error: '请先完成手机验证',
      });
    }

    const updated = await this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { signedIn: true },
    });
    // P1-5: 签到监督日志
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName,
        action: '身份签到', result: '签到成功', riskFlag: '无' },
    }).catch(() => {});
    this.gateway?.notifyExpertPresence(expert.projectId, {
      expertId: expert.id, expertName: expert.expertName, milestone: 'signed_in', progressPercent: updated.progress ?? 0,
    });
    return updated;
  }

  async confirmAvoidance(userId: string, projectId: string, conflictedSupplierIds?: string[]) {
    // P1: 阶段门控 — 仅开标/评标阶段可确认回避
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可确认回避阶段', code: 'PROJECT_NOT_ACTIVE' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // 自动利益冲突检测：工作单位 vs 投标供应商名称（归一化匹配）
    const autoConflicts = await this.conflictService.detectForProject(projectId, userId);

    // P2: 合并手动声明的冲突 + 自动检测的冲突（去重），持久化到 expert 记录。
    // D4: 若调用方显式传入 conflictedSupplierIds（含空数组），以传入值为准（替换手动部分）；
    // 未传入则保留既有手动声明（向后兼容，旧前端可能不传）。
    const existingConflicts = parseConflictedIds(expert.conflictedSupplierIds);
    const manualConflicts = conflictedSupplierIds !== undefined ? conflictedSupplierIds : existingConflicts;
    const allConflictIds = [...new Set([
      ...manualConflicts,
      ...autoConflicts.map(c => c.supplierId),
    ])];
    if (!conflictedSupplierIds?.length && autoConflicts.length > 0) {
      // 仅自动检测出冲突时，仍允许确认（前端会提示），但阻止对冲突供应商评分。
    }

    const updated = await this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { avoidanceConfirmed: true, conflictedSupplierIds: allConflictIds.length > 0 ? (allConflictIds as any) : undefined },
    });
    // P1-5: 回避确认监督日志
    const conflictNames = allConflictIds.length > 0
      ? (await this.prisma.bidSupplier.findMany({ where: { id: { in: allConflictIds.filter((id): id is string => !!id) } }, select: { supplierName: true } }))
          .map(s => s.supplierName).join('、')
      : '无';
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName,
        action: '确认利益回避', result: `回避供应商：${conflictNames}`, riskFlag: allConflictIds.length > 0 ? '中' : '无' },
    }).catch(() => {});
    this.gateway?.notifyExpertPresence(expert.projectId, {
      expertId: expert.id, expertName: expert.expertName, milestone: 'avoidance_confirmed', progressPercent: updated.progress ?? 0,
    });
    return updated;
  }

  async confirmAiConsent(userId: string, projectId: string) {
    // P1: 阶段门控 — 仅开标/评标阶段可确认 AI 辅助评标声明
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可确认 AI 声明阶段', code: 'PROJECT_NOT_ACTIVE' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // 幂等：重复确认只刷新时间戳，不报错（与签到/回避一致）
    const updated = await this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { aiConsentConfirmed: true, aiConsentAt: new Date() },
    });
    // P1-5: AI 辅助评标声明监督日志
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName,
        action: '确认AI辅助评标声明', result: '已确认', riskFlag: '无' },
    }).catch(() => {});
    return updated;
  }

  /** P4: 保密承诺/评标纪律签署 — 持久化到 BidExpert,刷新不丢,涉诉可取证 */
  async updateAgreements(userId: string, projectId: string, dto: import('./dto/update-agreements.dto').UpdateAgreementsDto) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const data: Record<string, unknown> = {};
    if (dto.confidentialityAgreed !== undefined) {
      data.confidentialityAgreed = dto.confidentialityAgreed;
      data.confidentialityAgreedAt = dto.confidentialityAgreed ? new Date() : null;
    }
    if (dto.disciplineAgreed !== undefined) {
      data.disciplineAgreed = dto.disciplineAgreed;
      data.disciplineAgreedAt = dto.disciplineAgreed ? new Date() : null;
    }
    const result = await this.prisma.bidExpert.update({ where: { id: expert.id }, data });
    // P1-5: 协议签署监督日志
    const agreedItems: string[] = [];
    if (dto.confidentialityAgreed) agreedItems.push('保密承诺');
    if (dto.disciplineAgreed) agreedItems.push('评标纪律');
    if (agreedItems.length > 0) {
      await this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName,
          action: '签署协议', result: `已签署：${agreedItems.join('、')}`, riskFlag: '无' },
      }).catch(() => {});
    }
    return result;
  }

  /* ── 标书解密获取 ── */

  async getDecryptedDocuments(userId: string, projectId: string, supplierId: string) {
    // P2: 阶段门控 — 仅开标/评标阶段可获取解密文件
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可获取文件阶段', code: 'PROJECT_NOT_ACTIVE' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      // 审计：专家核验未完成即尝试访问
      this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName,
          action: '尝试查看投标文件（被拒：核验未完成）', result: `signedIn=${expert.signedIn} avoidanceConfirmed=${expert.avoidanceConfirmed} aiConsentConfirmed=${expert.aiConsentConfirmed} confidentialityAgreed=${expert.confidentialityAgreed} disciplineAgreed=${expert.disciplineAgreed}`, riskFlag: '无' },
      }).catch(() => {});
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }

    // 回避名单检查：与 downloadBidDocument / getAssistData 保持一致，避免向冲突专家泄露投标文件元数据
    const conflictedIds = parseConflictedIds(expert.conflictedSupplierIds);
    if (conflictedIds.includes(supplierId)) {
      // 审计：回避冲突访问
      this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName,
          action: '尝试查看投标文件（被拒：回避冲突）', result: `supplierId=${supplierId}`, riskFlag: '中风险' },
      }).catch(() => {});
      throw new ForbiddenException({ error: '该供应商在您的回避名单中', code: 'CONFLICTED_SUPPLIER' });
    }

    const supplier = await this.prisma.bidSupplier.findFirst({
      where: { id: supplierId, projectId },
    });
    if (!supplier) throw new NotFoundException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });

    // 读取供应商真实提交的投标文件；未解密成功时不暴露下载地址与指纹
    const canView = supplier.decryptStatus === 'SUCCESS';
    const submission = supplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: supplier.supplierId, projectId } },
        })
      : null;

    const assetRefs: Array<[string, string | undefined | null]> = [
      ['技术方案', submission?.technicalFileAssetId],
      ['商务文件', submission?.businessFileAssetId],
      ['投标函', submission?.coverLetterAssetId],
    ];
    const assetIds = assetRefs.map(([, id]) => id).filter((id): id is string => !!id);
    const assets = assetIds.length
      ? await this.prisma.fileAsset.findMany({ where: { id: { in: assetIds } } })
      : [];
    const assetMap = new Map(assets.map(a => [a.id, a]));

    const documents = assetRefs
      .filter(([, id]) => id)
      .map(([label, id]) => {
        const asset = assetMap.get(id!);
        return {
          name: label,
          originalName: asset?.originalName ?? label,
          type: asset?.mimeType ?? 'unknown',
          size: asset?.size ?? 0,
          status: canView ? '已解密' : '加密中',
          downloadUrl: canView && asset ? `/api/expert/projects/${projectId}/suppliers/${supplierId}/documents/${asset.id}/download` : undefined,
          sha256: canView ? asset?.sha256 : undefined,
        };
      });

    return {
      supplier: { id: supplier.id, name: supplier.supplierName, decryptStatus: supplier.decryptStatus },
      documents,
      canView,
    };
  }

  /* ── 招标文件预览（专家独立核对原文）── */

  /** 门控：项目阶段 ∈ {OPENING, EVALUATING} + 调用者是该项目已签到 + 回避确认的专家。 */
  private async assertExpertActiveForProject(userId: string, projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可获取文件阶段', code: 'PROJECT_NOT_ACTIVE' });
    }
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }
    return expert;
  }

  /** 招标文件元信息（供前端「招标文件」卡片展示），无则 null。 */
  async getTenderDocument(userId: string, projectId: string) {
    await this.assertExpertActiveForProject(userId, projectId);
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { projectCode: true },
    });
    const doc = await this.prisma.bidDocument.findFirst({
      where: {
        OR: [
          { bidProjectId: projectId },
          { announcement: { relatedProjectCode: project?.projectCode ?? '' } },
        ],
      },
      include: { fileAsset: true },
    });
    return this.buildTenderDocumentMeta(doc, projectId);
  }

  /** 把 BidDocument 行塑形为前端「招标文件」卡片所需的元信息；doc 为空返回 null。 */
  private buildTenderDocumentMeta(
    doc: { title: string; fileAsset: { originalName: string; size: number } } | null,
    projectId: string,
  ) {
    if (!doc) return null;
    return {
      title: doc.title,
      fileName: doc.fileAsset.originalName,
      fileSize: doc.fileAsset.size,
      downloadUrl: `/api/expert/projects/${projectId}/tender-document/download`,
    };
  }

  /** 解密下载招标文件明文 PDF，并写一条访问审计日志（不递增 downloadCount）。 */
  async downloadTenderDocument(userId: string, projectId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const expert = await this.assertExpertActiveForProject(userId, projectId);
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { projectCode: true } });
    const doc = await this.prisma.bidDocument.findFirst({
      where: {
        OR: [
          { bidProjectId: projectId },
          { announcement: { relatedProjectCode: project?.projectCode ?? '' } },
        ],
      },
      include: { fileAsset: true },
    });
    if (!doc?.fileAsset) throw new NotFoundException({ error: '招标文件不存在', code: 'NOT_FOUND' });

    // 与 BidDocumentService.downloadForSupplier 同款：全量 buffer 解密，兼容未被包裹的旧 key
    const objStream = await minioClient.getObject(MINIO_BUCKET, doc.fileAsset.key);
    const ciphertext = await streamToBuffer(objStream);
    const rawKey = isWrappedKey(doc.decryptKey)
      ? unwrapKey(doc.decryptKey, process.env.KMS_SECRET!)
      : doc.decryptKey;
    const plaintext = decryptBuffer(ciphertext, rawKey);

    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId,
        time: new Date(),
        role: '评审专家',
        target: expert.expertName,
        action: '访问招标文件',
        result: doc.fileAsset.originalName,
        riskFlag: '无',
      },
    });

    return { buffer: this.maybeConvertDocxToPdf(plaintext, doc.fileAsset.originalName), fileName: this.pdfFileName(doc.fileAsset.originalName), mimeType: 'application/pdf' };
  }

  /** 如果 plaintext 是 .docx/.doc，则用 LibreOffice 转换为 PDF；否则原样返回。
   *  安全要点：临时文件使用固定安全名（mkdtemp 目录本身唯一），用户可控的 originalName
   *  绝不进入文件路径或命令行；用 execFileSync 数组参数，杜绝 shell 注入与路径穿越。 */
  private maybeConvertDocxToPdf(plaintext: Buffer, originalName: string): Buffer {
    const ext = /\.docx$/i.test(originalName) ? '.docx' : /\.doc$/i.test(originalName) ? '.doc' : null;
    if (!ext) return plaintext;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tender-docx-'));
    const safeBase = 'input';
    const docxPath = path.join(tmpDir, `${safeBase}${ext}`);
    try {
      fs.writeFileSync(docxPath, plaintext);
      execFileSync(
        'libreoffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, docxPath],
        { timeout: 60_000, stdio: 'pipe' },
      );
      const pdfPath = path.join(tmpDir, `${safeBase}.pdf`);
      if (fs.existsSync(pdfPath)) {
        return fs.readFileSync(pdfPath);
      }
      return plaintext;
    } catch (err: any) {
      this.logger.warn(`LibreOffice docx→pdf failed for ${originalName}: ${err?.message ?? err}`);
      return plaintext;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** 把 .docx/.doc 文件名的扩展名替换为 .pdf；非 Word 文件保留原名。 */
  private pdfFileName(originalName: string): string {
    if (/\.docx?$/i.test(originalName)) {
      return originalName.replace(/\.docx?$/i, '.pdf');
    }
    return originalName;
  }

  /* ── 投标文件解密下载（专家预览投标人 PDF）── */

  /** 门控同 getDecryptedDocuments/resolveReviewContext：项目阶段 OPENING/EVALUATING + 本人专家 + 签到/回避确认 + 回避名单。
   *  fileId 必须归属该 supplier 的某类投标文件（防越权），再委托 plaintextFetcher 解密。 */
  async downloadBidDocument(
    userId: string,
    projectId: string,
    supplierId: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const expert = await this.assertExpertActiveForProject(userId, projectId);

    // 回避名单检查：与 getAssistData/resolveReviewContext 一致
    const conflictedIds = parseConflictedIds(expert.conflictedSupplierIds);
    if (conflictedIds.includes(supplierId)) {
      throw new ForbiddenException({ error: '该供应商在您的回避名单中', code: 'CONFLICTED_SUPPLIER' });
    }

    // 确认 supplier 属于该项目，并拿到 supplierId（系统账户）查 submission
    const supplier = await this.prisma.bidSupplier.findFirst({
      where: { id: supplierId, projectId },
    });
    if (!supplier) throw new NotFoundException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });
    if (!supplier.supplierId) {
      throw new NotFoundException({ error: '供应商未关联账户', code: 'NOT_FOUND' });
    }

    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId: supplier.supplierId, projectId } },
    });
    if (!submission) throw new NotFoundException({ error: '投标文件不存在', code: 'NOT_FOUND' });

    // fileId → which 映射（防越权：fileId 必须是三选一且归属本 supplier）
    let which: BidderFileType | null = null;
    if (submission.technicalFileAssetId === fileId) which = 'technical';
    else if (submission.businessFileAssetId === fileId) which = 'business';
    else if (submission.coverLetterAssetId === fileId) which = 'coverLetter';
    if (!which) {
      throw new NotFoundException({ error: '文件不属于该供应商', code: 'NOT_FOUND' });
    }

    const result = await this.plaintextFetcher.fetchBidderPlaintext(supplierId, which);
    if (!result) throw new NotFoundException({ error: '投标文件不存在', code: 'NOT_FOUND' });

    const asset = await this.prisma.fileAsset.findUnique({ where: { id: fileId } });
    const fileName = asset?.originalName ?? `${which}.pdf`;

    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId,
        time: new Date(),
        role: '评审专家',
        target: expert.expertName,
        action: `访问投标文件（${supplier.supplierName}）`,
        result: fileName,
        riskFlag: '无',
      },
    });

    return { buffer: result.buffer, fileName, mimeType: 'application/pdf' };
  }

  /* ── 招标条款标注（Task 9：本人 CRUD）── */

  /** 门控：项目阶段 ∈ {OPENING, EVALUATING} + 本项目已签到/回避确认的专家 + 非回避名单供应商 + 投标人 AI 分析已 COMPLETED。
   *  任一不满足即抛 403/404。返回解析后的 expert 与 bidderResult 供 upsert/list 复用。 */
  private async resolveReviewContext(userId: string, projectId: string, supplierId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可操作阶段', code: 'PROJECT_NOT_ACTIVE' });
    }
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    // 回避名单检查先于签到/回避确认检查：回避名单本身即最终阻断信号，避免泄露后续状态细节
    const conflictedIds = parseConflictedIds(expert.conflictedSupplierIds);
    if (conflictedIds.includes(supplierId)) {
      throw new ForbiddenException({ error: '该供应商在您的回避名单中', code: 'CONFLICTED_SUPPLIER' });
    }
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }
    const bidderResult = await this.prisma.aiBidderResult.findFirst({
      where: { bidSupplierId: supplierId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!bidderResult) throw new NotFoundException({ error: '该供应商 AI 分析尚未完成', code: 'NOT_FOUND' });
    return { expert, bidderResult };
  }

  /** Upsert 本人针对某招标条款的标注。复合唯一键 projectId+bidderResultId+expertId+requirementId 保证幂等。 */
  async upsertRequirementReview(userId: string, projectId: string, supplierId: string, dto: UpsertRequirementReviewDto) {
    const { expert, bidderResult } = await this.resolveReviewContext(userId, projectId, supplierId);
    return this.prisma.bidRequirementReview.upsert({
      where: {
        projectId_bidderResultId_expertId_requirementId: {
          projectId, bidderResultId: bidderResult.id, expertId: expert.id, requirementId: dto.requirementId,
        },
      },
      create: {
        projectId, bidderResultId: bidderResult.id, expertId: expert.id,
        requirementId: dto.requirementId, category: dto.category, verdict: dto.verdict, note: dto.note,
      },
      update: { verdict: dto.verdict, note: dto.note },
    });
  }

  /** 列出本人针对该投标人的全部条款标注（reviews 本人-only）。 */
  async listRequirementReviews(userId: string, projectId: string, supplierId: string) {
    const { expert, bidderResult } = await this.resolveReviewContext(userId, projectId, supplierId);
    return this.prisma.bidRequirementReview.findMany({
      where: { bidderResultId: bidderResult.id, expertId: expert.id },
    });
  }

  /* ── 辅助评标（AI引擎驱动） ── */

  async getAssistData(userId: string, projectId: string, supplierId: string) {
    // P2: 阶段门控 — 仅开标/评标阶段可获取辅助评标数据
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可获取辅助数据阶段', code: 'PROJECT_NOT_ACTIVE' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // P1-2：身份核验/回避/AI声明门控——未完成前置步骤不可读 AI 分析（服务端强制，前端门控不可绕过）
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }

    // 15.4: 专家回避屏蔽 — 回避名单中的供应商不可查看 AI 分析
    const conflictedIds = parseConflictedIds(expert.conflictedSupplierIds);
    if (conflictedIds.includes(supplierId)) {
      throw new ForbiddenException({ error: '该供应商在您的回避名单中', code: 'CONFLICTED_SUPPLIER' });
    }

    // C3+M11: 多轮报价项目——从 BidOpeningRecord 注入最终轮报价供专家参考
    let finalQuotePrice: string | null = null;
    if (project.roundMode) {
      const openingRec = await this.prisma.bidOpeningRecord.findFirst({
        where: { projectId, bidSupplierId: supplierId },
        select: { amount: true },
      });
      finalQuotePrice = openingRec?.amount ?? null;
    }

    // 4.5: 优先读 AiBidderResult（per-item LLM 结果），降级用规则引擎
    const bidderResult = await this.prisma.aiBidderResult.findFirst({
      where: { bidSupplierId: supplierId, status: 'COMPLETED' },
      include: {
        concordance: true,
        bidSupplier: { select: { supplierName: true } },
      },
    });
    if (bidderResult) {
      const task = await this.prisma.aiBidAnalysisTask.findUnique({
        where: { projectId },
        select: { id: true, requirements: true },
      });
      // 本人针对该投标人的条款标注（Task 3 BidRequirementReview）
      let myReviews: any[] = [];
      if (task) {
        myReviews = await this.prisma.bidRequirementReview.findMany({
          where: { bidderResultId: bidderResult.id, expertId: expert.id },
        });
      }
      return {
        source: 'ai_bidder_result',
        supplierName: bidderResult.bidSupplier.supplierName,
        finalQuotePrice, // C3: 多轮项目最终轮报价
        totalScore: bidderResult.totalScore,
        scoreItems: bidderResult.scoreItems,
        categoryTotals: bidderResult.categoryTotals,
        keyInfo: bidderResult.keyInfo,
        concordance: bidderResult.concordance?.checkedFields ?? null,
        concordanceStatus: bidderResult.concordance?.overallStatus ?? null,
        strengths: bidderResult.strengths,
        weaknesses: bidderResult.weaknesses,
        // ★ keyObservations 存在 competitiveAnalysis 里（bidder.processor 第一轮写入），
        //   历史被旧版 comparative-scoring 覆盖过的记录此处为 undefined → 兜底空数组。
        //   修复 A 后新跑的分析不再覆盖，docx 报告与专家端均可消费。
        keyObservations:
          (bidderResult.competitiveAnalysis as { keyObservations?: string[] } | null)?.keyObservations ?? [],
        overallComment: bidderResult.overallComment,
        qualificationStatus: bidderResult.qualificationStatus,
        riskLevel: bidderResult.riskLevel,
        starredResponse: (bidderResult.starredResponse as { allMet: boolean; unmet?: string[] } | null) ?? null,
        requirements: task?.requirements ?? null, // 招标条款（来自 AiBidAnalysisTask.requirements）
        requirementResponses: bidderResult.requirementResponses ?? [], // AI 条款响应定位（Task 3/6/7）
        reviews: myReviews, // 本人 BidRequirementReview 列表
      };
    }
    // 降级：规则引擎（LLM/OCR 不可用或 bidderResult 未就绪时）
    return {
      source: 'rules_fallback',
      finalQuotePrice,
      ...(await this.aiService.analyzeBid(projectId, supplierId, expert.id)),
    };
  }

  /** 跨供应商对比概览 — 返回项目下所有已完成 AI 分析的供应商摘要 */
  async getAssistCompare(userId: string, projectId: string) {
    // P1-2：阶段门控 — 仅开标/评标阶段可获取跨供应商对比
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可获取辅助数据阶段', code: 'PROJECT_NOT_ACTIVE' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // P1-2：身份核验/回避/AI声明门控——未完成前置步骤不可读竞争态势（含 projectFraudSummary）
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }

    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      select: { id: true },
    });
    if (!task) return { bidders: [], projectFraudSummary: null, reportDocxUrl: null };

    const [results, report] = await Promise.all([
      this.prisma.aiBidderResult.findMany({
        where: { taskId: task.id, status: 'COMPLETED' },
        include: { bidSupplier: { select: { supplierName: true } } },
      }),
      this.prisma.aiBidReport.findUnique({
        where: { taskId: task.id },
        select: { fraudIndicators: true, docxFileId: true },
      }),
    ]);

    let projectFraudSummary: { riskLevel: string; indicatorCount: number } | null = null;
    if (report?.fraudIndicators) {
      const fi = report.fraudIndicators as { riskLevel?: string; summary?: { totalCount?: number }; indicators?: unknown[] };
      projectFraudSummary = {
        riskLevel: fi.riskLevel ?? 'low',
        indicatorCount: fi.summary?.totalCount ?? fi.indicators?.length ?? 0,
      };
    }
    // P1-2：bid_expert 无该 AI 报告 FileAsset 的访问权（canAccessFile 仅放行投标文件），
    // 返回 URL 恒为 403 死链且泄露内部 fileId → 置 null（前端按可空处理）。
    const reportDocxUrl = null;

    return {
      bidders: results.map((r) => ({
        supplierId: r.bidSupplierId,
        supplierName: r.bidSupplier.supplierName,
        totalScore: r.totalScore != null ? Number(r.totalScore) : 0,
        categoryTotals: (r.categoryTotals as Record<string, { score: number; max: number }>) ?? {},
        qualificationStatus: r.qualificationStatus ?? '待审查',
        riskLevel: r.riskLevel ?? 'low',
      })),
      projectFraudSummary,
      reportDocxUrl,
    };
  }

  /** 多轮报价历史（专家只读）—— 仅返回 published/closed 轮次 + 供应商名 + 报价 */
  async getQuoteHistory(userId: string, projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new ForbiddenException({ error: '项目不存在', code: 'NOT_FOUND' });
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const rounds = await this.prisma.bidRound.findMany({
      where: { projectId, status: { in: ['published', 'closed'] } },
      orderBy: { roundNo: 'asc' },
      include: { quotes: { orderBy: { quotePrice: 'asc' } } },
    });

    // 批量查供应商名
    const supplierIds = [...new Set(rounds.flatMap(r => r.quotes.map(q => q.bidSupplierId)))];
    const suppliers = await this.prisma.bidSupplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, supplierName: true },
    });
    const nameMap = new Map(suppliers.map(s => [s.id, s.supplierName]));

    return rounds.map(r => ({
      roundNo: r.roundNo,
      roundType: r.roundType,
      status: r.status,
      deadline: r.deadline,
      quotes: r.quotes.map(q => ({
        supplierName: nameMap.get(q.bidSupplierId) ?? '—',
        quotePrice: String(q.quotePrice),
      })),
    }));
  }

  /* ── 专家打分 ── */

  async submitScores(userId: string, projectId: string, dto: BatchScoreDto) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (expert.reportConfirmed) {
      throw new BadRequestException({ error: '评审报告已确认，评分已锁定', code: 'SCORE_LOCKED' });
    }
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }
    // P2: block scoring for suppliers the expert declared as conflicted
    // 防御性处理：Prisma Json 字段可能返回数组或字符串（seed 数据历史遗留）
    const expertConflicts = parseConflictedIds(expert.conflictedSupplierIds);
    const conflictSuppliers = dto.scores
      .map(s => s.supplierId)
      .filter(sid => expertConflicts.includes(sid));
    if (conflictSuppliers.length > 0) {
      throw new BadRequestException({
        error: '您已声明与部分供应商存在利益冲突，无法评分',
        code: 'AVOIDANCE_CONFLICT',
        conflictSupplierIds: [...new Set(conflictSuppliers)],
      });
    }
    if (!dto.scores || dto.scores.length === 0) {
      throw new BadRequestException({ error: '评分列表不能为空', code: 'SCORES_EMPTY' });
    }

    // Validate scores don't exceed maxScore — 限定当前项目防止跨项目注入
    const scoreItemIds = dto.scores.map(s => s.scoreItemId);
    const scoreItems = await this.prisma.bidScoreItem.findMany({
      where: { id: { in: scoreItemIds }, projectId },
      select: { id: true, maxScore: true, category: true },
    });
    if (scoreItems.length !== new Set(scoreItemIds).size) {
      throw new BadRequestException({ error: '评分项不属于当前项目', code: 'SCORE_ITEM_NOT_IN_PROJECT' });
    }
    const itemMeta = new Map(scoreItems.map(si => [si.id, { maxScore: Number(si.maxScore), category: si.category as string }]));

    const supplierIds = Array.from(new Set(dto.scores.map(s => s.supplierId)));
    const bidSuppliers = await this.prisma.bidSupplier.findMany({
      where: { id: { in: supplierIds }, projectId },
      select: { id: true, supplierName: true, decryptStatus: true, submitStatus: true },
    });
    if (bidSuppliers.length !== supplierIds.length) {
      throw new BadRequestException({ error: '评分供应商不属于当前项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
    }
    const invalidSupplier = bidSuppliers.find(s => s.decryptStatus !== 'SUCCESS' || s.submitStatus === '已撤回');
    if (invalidSupplier) {
      throw new BadRequestException({ error: '存在未解密成功或已撤回的供应商，无法评分', code: 'SUPPLIER_NOT_DECRYPTED' });
    }

    // 批量查所有相关 item 的 points（判断 item 有无 points + decision 校验）
    const allPoints = await this.prisma.bidScorePoint.findMany({
      where: { scoreItemId: { in: scoreItemIds } },
      select: { id: true, scoreItemId: true, objective: true, fullScore: true },
    });
    const pointsByItem = new Map<string, typeof allPoints>();
    for (const p of allPoints) {
      const arr = pointsByItem.get(p.scoreItemId) ?? [];
      arr.push(p); pointsByItem.set(p.scoreItemId, arr);
    }
    const pointMeta = new Map(allPoints.map(p => [p.id, p]));

    for (const item of dto.scores) {
      const meta = itemMeta.get(item.scoreItemId);
      if (!meta) continue;
      const hasPoints = (pointsByItem.get(item.scoreItemId)?.length ?? 0) > 0;
      if (hasPoints) {
        // checklist 模式：必须有 pointDecisions（含得分点的评分项不允许空 decisions，否则 recompute 会静默得 score=0/passed=false）
        const decisions = item.pointDecisions ?? [];
        if (decisions.length === 0) {
          throw new BadRequestException({
            error: `评分项 ${item.scoreItemId} 含得分点，必须提交得分点裁定`,
            code: 'DECISIONS_REQUIRED',
          });
        }
        for (const d of decisions) {
          const pm = pointMeta.get(d.pointId);
          if (!pm) {
            throw new BadRequestException({ error: `得分点 ${d.pointId} 不属于该评分项`, code: 'POINT_NOT_IN_ITEM' });
          }
          if (Number(d.awardedScore) > Number(pm.fullScore)) {
            throw new BadRequestException({ error: `得分点 ${d.pointId} 分数 ${d.awardedScore} 超过满分 ${pm.fullScore}`, code: 'POINT_SCORE_EXCEEDS_MAX' });
          }
        }
        // 由 decisions 算 score/passed
        const decisionMap = new Map(decisions.map(d => [d.pointId, { checked: d.checked, awardedScore: Number(d.awardedScore) }]));
        const { score, passed } = recomputeItemFromDecisions({
          category: meta.category,
          points: (pointsByItem.get(item.scoreItemId) ?? []).map(p => ({ id: p.id, objective: p.objective, fullScore: Number(p.fullScore) })),
          decisions: decisionMap,
          maxScore: meta.maxScore, // P0-A：封顶，防止数据异常使单项分 > maxScore
        });
        item.score = score;
        item.passed = passed as boolean | undefined;
      } else {
        // 旧路径（无 points）：保留原直输校验
        if (meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE') {
          // 通过性项：必须有 passed，忽略 score
          if (typeof item.passed !== 'boolean') {
            throw new BadRequestException({
              error: `通过性审查项 ${item.scoreItemId} 必须提供 passed（通过/不通过）`,
              code: 'PASS_FAIL_VERDICT_REQUIRED',
            });
          }
          item.score = 0; // 落库固定 0，不进总分
        } else {
          // 数值项：必须有 score 且 ≤ maxScore
          if (typeof item.score !== 'number') {
            throw new BadRequestException({
              error: `评分项 ${item.scoreItemId} 必须提供 score`,
              code: 'SCORE_REQUIRED',
            });
          }
          if (item.score > meta.maxScore) {
            throw new BadRequestException({
              error: `评分项 ${item.scoreItemId} 分数 ${item.score} 超过满分 ${meta.maxScore}`,
              code: 'SCORE_EXCEEDS_MAX',
            });
          }
          item.passed = null as unknown as undefined;
        }
      }
    }

    // P1-E：查 AI 建议分（用于评分 delta 飞轮：专家 vs AI 差异）
    const aiResults = await this.prisma.aiBidderResult.findMany({
      where: { task: { projectId }, status: 'COMPLETED' },
      select: { bidSupplierId: true, scoreItems: true },
    });
    const aiScoreMap = new Map<string, { score: number; confidence: number | null }>();
    for (const r of aiResults) {
      for (const it of (r.scoreItems as any[]) ?? []) {
        aiScoreMap.set(`${r.bidSupplierId}:${it.scoreItemId}`, {
          score: Number(it.score ?? 0),
          confidence: it.confidence != null ? Number(it.confidence) : null,
        });
      }
    }

    // Wrap stage check + upsert + progress-recalc + supervision log in a single transaction
    // to prevent TOCTOU race conditions and ensure aggregate consistency.
    const result = await this.prisma.$transaction(async (tx) => {
      // Re-check stage inside transaction to close the TOCTOU window
      const currentProject = await tx.bidProject.findUnique({
        where: { id: projectId },
        select: { stage: true },
      });
      if (!currentProject) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
      if (currentProject.stage !== 'EVALUATING') {
        throw new BadRequestException({ error: '项目不在评标阶段', code: 'PROJECT_NOT_EVALUATING' });
      }

      // Re-check reportConfirmed inside transaction to close the TOCTOU window
      // （事务外已检查，但 confirmReport 可在进入事务前把 reportConfirmed 置 true → 报告确认后仍可改分）
      // P0-3: 行锁 BidExpert，消除与 confirmReport 的 TOCTOU 竞态
      await tx.$queryRaw`SELECT id FROM "BidExpert" WHERE id = ${expert.id} FOR UPDATE`;
      const lockedExpert = await tx.bidExpert.findUnique({
        where: { id: expert.id },
        select: { reportConfirmed: true },
      });
      if (lockedExpert?.reportConfirmed) {
        throw new BadRequestException({ error: '评审报告已确认，评分已锁定', code: 'SCORE_LOCKED' });
      }

      // Batch upsert — unique composite index guarantees idempotency
      // checklist decisions upsert（有 points 的 item）
      for (const item of dto.scores) {
        if (!item.pointDecisions || item.pointDecisions.length === 0) continue;
        for (const d of item.pointDecisions) {
          await tx.bidScorePointDecision.upsert({
            where: { expertId_pointId_supplierId: { expertId: expert.id, pointId: d.pointId, supplierId: item.supplierId } },
            update: { checked: d.checked, awardedScore: d.awardedScore, note: d.note },
            create: { expertId: expert.id, pointId: d.pointId, supplierId: item.supplierId, checked: d.checked, awardedScore: d.awardedScore, note: d.note },
          });
        }
      }

      // P5: 预读现有评分记录用于修订历史快照
      const existingScoreRecords = await tx.bidScoreRecord.findMany({
        where: {
          expertId: expert.id,
          scoreItemId: { in: dto.scores.map(i => i.scoreItemId) },
          supplierId: { in: [...new Set(dto.scores.map(i => i.supplierId))] },
        },
      });
      const existingScoreMap = new Map(existingScoreRecords.map(r => [`${r.scoreItemId}:${r.supplierId}`, r]));

      for (const item of dto.scores) {
        // P5: 评分修订历史 — 覆盖前写入旧值快照
        const existing = existingScoreMap.get(`${item.scoreItemId}:${item.supplierId}`);
        if (existing) {
          const newScore = item.score ?? 0;
          const newPassed = item.passed ?? null;
          const scoreChanged = Number(existing.score) !== newScore;
          const passedChanged = (existing.passed ?? null) !== newPassed;
          const reasonChanged = (existing.reason ?? null) !== (item.reason ?? null);
          if (scoreChanged || passedChanged || reasonChanged) {
            await tx.bidScoreRecordHistory.create({
              data: {
                recordId: existing.id,
                expertId: expert.id,
                scoreItemId: item.scoreItemId,
                supplierId: item.supplierId,
                score: existing.score,
                passed: existing.passed,
                reason: existing.reason,
                action: 'update',
              },
            });
          }
        }
        await tx.bidScoreRecord.upsert({
          where: {
            expertId_scoreItemId_supplierId: {
              expertId: expert.id,
              scoreItemId: item.scoreItemId,
              supplierId: item.supplierId,
            },
          },
          update: { score: item.score ?? 0, passed: item.passed ?? null, reason: item.reason },
          create: {
            expertId: expert.id,
            scoreItemId: item.scoreItemId,
            supplierId: item.supplierId,
            score: item.score ?? 0,
            passed: item.passed ?? null,
            reason: item.reason,
          },
        });
      }

      // P1-E：评分 delta 飞轮（数值项 only，排除通过性项 QUALIFICATION/RESPONSIVE；无 AI 分析则跳过）
      for (const item of dto.scores) {
        const meta = itemMeta.get(item.scoreItemId);
        if (!meta || meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE') continue;
        const ai = aiScoreMap.get(`${item.supplierId}:${item.scoreItemId}`);
        if (!ai) continue;
        const expertScore = item.score ?? 0;
        const delta = Math.round((expertScore - ai.score) * 10) / 10;
        const accepted = Math.abs(delta) <= meta.maxScore * 0.1;
        await tx.bidScoreDelta.upsert({
          where: { expertId_scoreItemId_supplierId: { expertId: expert.id, scoreItemId: item.scoreItemId, supplierId: item.supplierId } },
          update: { aiScore: ai.score, expertScore, delta, accepted, aiConfidence: ai.confidence },
          create: { projectId, expertId: expert.id, scoreItemId: item.scoreItemId, supplierId: item.supplierId, aiScore: ai.score, expertScore, delta, accepted, aiConfidence: ai.confidence },
        });
      }

      // Recalculate progress and totalScore within the same transaction
      const { progress, totalScore } = await recomputeExpertProgress(tx, expert.id, projectId);
      await tx.bidExpert.update({
        where: { id: expert.id },
        data: { progress, totalScore },
      });

      // phase ③：为每个涉及的供应商 upsert draft review（已 verified 的，专家改分后重置为 draft 需重新核对）
      const reviewSupplierIds = Array.from(new Set(dto.scores.map(s => s.supplierId)));
      for (const sid of reviewSupplierIds) {
        await tx.bidScoreReview.upsert({
          where: { expertId_projectId_supplierId: { expertId: expert.id, projectId, supplierId: sid } },
          update: { status: 'draft', verifiedAt: null },
          create: { expertId: expert.id, projectId, supplierId: sid, status: 'draft' },
        });
      }

      // Supervision log
      await tx.bidSupervisionLog.create({
        data: {
          projectId,
          time: new Date(),
          role: '评审专家',
          target: expert.expertName,
          action: `提交评分（供应商：${bidSuppliers.map(s => s.supplierName).join('、')}）`,
          result: `共${dto.scores.length}项评分`,
          riskFlag: '无',
        },
      });

      return { progress, totalScore };
    });

    // phase ④：实时废标判定（事务已提交，数据可读；放事务外避免长事务）
    try {
      const passFailTouched = dto.scores.filter(s => {
        const m = itemMeta.get(s.scoreItemId);
        return m && (m.category === 'QUALIFICATION' || m.category === 'RESPONSIVE');
      });
      for (const s of Array.from(new Set(passFailTouched.map(x => x.supplierId)))) {
        const items = passFailTouched.filter(x => x.supplierId === s).map(x => x.scoreItemId);
        for (const itemId of Array.from(new Set(items))) {
          const verdict = await evaluateInvalidBid(this.prisma, projectId, s, itemId);
          if (verdict.disqualified) {
            // #1: 旧 unique 约束已移除 → findFirst + create/update
            const existingRec = await this.prisma.bidInvalidBid.findFirst({
              where: { projectId, supplierId: s, scoreItemId: itemId },
            });
            if (existingRec) {
              await this.prisma.bidInvalidBid.update({
                where: { id: existingRec.id },
                data: { failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'invalid', revokedAt: null, revokedBy: null, reason: `通过性审查不通过票过半（${verdict.failCount}/${verdict.totalCount}）` },
              });
            } else {
              await this.prisma.bidInvalidBid.create({
                data: { projectId, supplierId: s, scoreItemId: itemId, source: 'passfail', failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'invalid', reason: `通过性审查不通过票过半（${verdict.failCount}/${verdict.totalCount}）` },
              });
            }
            this.gateway?.notifyBidValidity?.(projectId, { supplierId: s, failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'invalid' });
          } else {
            // 不过半：若之前 invalid 现恢复（票数变化，决策 B 接受跳变）
            const existing = await this.prisma.bidInvalidBid.findFirst({ where: { projectId, supplierId: s, scoreItemId: itemId } });
            if (existing?.status === 'invalid') {
              await this.prisma.bidInvalidBid.update({ where: { id: existing.id }, data: { status: 'revoked', revokedAt: new Date() } });
              this.gateway?.notifyBidValidity?.(projectId, { supplierId: s, failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'revoked' });
            }
          }
        }
        // P1-8：按供应商聚合判定 bidValidity——任一通过性项仍 invalid 即整单 invalid（每供应商仅 update 一次，不被其他项覆盖）
        const invalidCount = await this.prisma.bidInvalidBid.count({ where: { projectId, supplierId: s, status: 'invalid' } });
        await this.prisma.bidSupplier.update({ where: { id: s }, data: { bidValidity: invalidCount > 0 ? 'invalid' : 'valid' } });
      }
    } catch (e) {
      this.logger.error('实时废标判定失败（不阻塞评分主流程）', e instanceof Error ? e.message : String(e));
    }

    // Emit WebSocket events after successful commit
    this.gateway?.notifyExpertPresence?.(projectId, {
      expertId: expert.id,
      expertName: expert.expertName,
      milestone: 'scoring_activity',
      progressPercent: result.progress,
    });
    this.gateway?.broadcastAggregatePresence?.(projectId);

    // 偏差检测（事务已提交，只读查询 + WS 广播，失败不阻塞）
    try {
      for (const item of dto.scores) {
        const meta = itemMeta.get(item.scoreItemId);
        if (!meta || meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE') continue;
        const existingRows = await this.prisma.bidScoreRecord.findMany({
          where: { scoreItemId: item.scoreItemId, supplierId: item.supplierId, expertId: { not: expert.id } },
          select: { expertId: true, scoreItemId: true, supplierId: true, score: true },
        });
        const existingScores: ScoreRecordInput[] = existingRows.map(r => ({
          expertId: r.expertId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score),
        }));
        const alert = checkScoreAnomaly(
          { expertId: expert.id, scoreItemId: item.scoreItemId, supplierId: item.supplierId, score: item.score ?? 0 },
          existingScores,
        );
        if (alert) {
          this.logger.warn(`[ScoreAnomaly] project=${projectId} expert=${expert.expertName} ${alert.detail}`);
          this.gateway?.notifyAnomaly(projectId, {
            type: 'score_deviation',
            supplierId: item.supplierId,
            supplierName: bidSuppliers.find(s => s.id === item.supplierId)?.supplierName ?? '',
            detail: alert.detail,
            severity: alert.severity,
          });
        }
      }
    } catch (e) {
      this.logger.error('偏差检测失败（不阻塞评分主流程）', e instanceof Error ? e.message : String(e));
    }

    return result;
  }

  async getMyScores(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }

    const [records, reviews, pointDecisions] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({
        where: { expertId: expert.id },
        include: { scoreItem: true },
      }),
      this.buildExpertReviews(projectId, expert.id, ['dispute', 'doubt']),
      this.prisma.bidScorePointDecision.findMany({
        where: { expertId: expert.id },
        select: { pointId: true, supplierId: true, checked: true, awardedScore: true, note: true },
      }),
    ]);

    const UPPER: Record<string, string> = {
      qualification: 'QUALIFICATION',
      technical: 'TECHNICAL',
      commercial: 'BUSINESS',
    };
    // disputeCategoriesBySupplier 仍 dispute-only（软门用）；disputesBySupplier 含 dispute+doubt
    const disputeCategoriesBySupplier: Record<string, string[]> = {};
    const disputesBySupplier: Record<string, Record<string, { requirementId: string; content: string; note: string; verdict: string }[]>> = {};
    for (const r of reviews) {
      const cat = UPPER[r.category];
      if (!cat) continue;
      if (r.verdict === 'dispute') {
        const catList = disputeCategoriesBySupplier[r.supplierId] ?? (disputeCategoriesBySupplier[r.supplierId] = []);
        if (!catList.includes(cat)) catList.push(cat);
      }
      const detailMap = disputesBySupplier[r.supplierId] ?? (disputesBySupplier[r.supplierId] = {});
      const detailList = detailMap[cat] ?? (detailMap[cat] = []);
      detailList.push({ requirementId: r.requirementId, content: r.content, note: r.note, verdict: r.verdict });
    }
    return { records, disputeCategoriesBySupplier, disputesBySupplier, pointDecisions };
  }

  /** 汇总本人条款核对（dispute/doubt）为扁平 review 列表，供 getMyScores 与 getReport 复用。
   *  反查 AiBidderResult.requirementResponses 取 tenderContent；丢弃无 supplier 关联的孤儿记录。 */
  private async buildExpertReviews(
    projectId: string,
    expertId: string,
    verdicts: ('dispute' | 'doubt')[],
  ) {
    const rows = await this.prisma.bidRequirementReview.findMany({
      where: { projectId, expertId, verdict: { in: verdicts } },
      select: {
        category: true, verdict: true, bidderResultId: true, requirementId: true, note: true,
        bidderResult: { select: { bidSupplier: { select: { id: true, supplierName: true } } } },
      },
    });
    const brIds = [...new Set(rows.map((r) => r.bidderResultId))];
    const brs = brIds.length
      ? await this.prisma.aiBidderResult.findMany({ where: { id: { in: brIds } } })
      : [];
    const contentMap = new Map<string, string>();
    for (const br of brs) {
      for (const r of ((br.requirementResponses as any[]) ?? [])) {
        contentMap.set(`${br.id}:${r.requirementId}`, r.tenderContent ?? '');
      }
    }
    return rows
      .map((d) => ({
        category: d.category,
        verdict: d.verdict,
        requirementId: d.requirementId,
        note: d.note ?? '',
        supplierId: d.bidderResult?.bidSupplier?.id ?? '',
        supplierName: d.bidderResult?.bidSupplier?.supplierName ?? '',
        content: contentMap.get(`${d.bidderResultId}:${d.requirementId}`) ?? '',
      }))
      // 防御：信任 query verdict 过滤，但兼容 mock/历史 Json 漂移
      .filter((r) => r.supplierId && (r.verdict === 'dispute' || r.verdict === 'doubt'));
  }

  /* ── 核对评分（draft → verified）── */

  async verifyScoreReview(userId: string, projectId: string, supplierId: string) {
    // P2-3：阶段门控 — 仅评标阶段可核对
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'EVALUATING') {
      throw new ForbiddenException({ error: '项目不在评标阶段，无法核对评分', code: 'PROJECT_NOT_EVALUATING' });
    }

    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (expert.reportConfirmed) throw new BadRequestException({ error: '评审报告已确认，评分已锁定', code: 'SCORE_LOCKED' });
    // P2-3：身份核验/回避/AI声明门控
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }

    // P2-2：仅活跃供应商（解密成功且未撤回）可核对评分
    const activeSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: supplierId, projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
    });
    if (!activeSupplier) throw new BadRequestException({ error: '该供应商未解密成功或已撤回，无法核对', code: 'SUPPLIER_NOT_ACTIVE' });

    // 必须先有评分记录
    const scores = await this.prisma.bidScoreRecord.findMany({ where: { expertId: expert.id, supplierId } });
    if (scores.length === 0) throw new BadRequestException({ error: '该供应商尚未评分，无法核对', code: 'SCORING_INCOMPLETE' });
    // P1-6：须评完该供应商全部评分项才能核对（防止漏评项被核对/确认）
    const itemCount = await this.prisma.bidScoreItem.count({ where: { projectId } });
    if (scores.length < itemCount) {
      throw new BadRequestException({ error: `该供应商尚有 ${itemCount - scores.length} 个评分项未评，无法核对`, code: 'SCORING_INCOMPLETE' });
    }

    // P1-4：改 upsert——无 review 行（如管理端代评路径）也能核对，消除 P2025→500
    const updated = await this.prisma.bidScoreReview.upsert({
      where: { expertId_projectId_supplierId: { expertId: expert.id, projectId, supplierId } },
      update: { status: 'verified', verifiedAt: new Date() },
      create: { expertId: expert.id, projectId, supplierId, status: 'verified', verifiedAt: new Date() },
    });

    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId,
        time: new Date(),
        role: '评审专家',
        target: expert.expertName,
        action: '核对评分完成（供应商）',
        result: '已核对',
        riskFlag: '无',
      },
    });

    return updated;
  }

  /* ── 澄清答疑 ── */

  async listClarifications(userId: string, projectId: string) {
    // Verify expert is assigned to this project
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
      select: { id: true },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // Lightweight query — only fetch clarifications, not the entire project
    return this.prisma.bidClarification.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** P1-F：AI 起草澄清问题候选（不落库——专家改完再走 createClarification） */
  async draftClarification(userId: string, projectId: string, supplierId: string) {
    // P1-1：归属校验——必须是本项目专家，且供应商属于本项目（防越权套取他项目投标弱点）
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    const supplier = await this.prisma.bidSupplier.findFirst({ where: { id: supplierId, projectId } });
    if (!supplier) throw new BadRequestException({ error: '供应商不属于此项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
    return this.clarificationAi?.draftQuestion(projectId, supplierId) ?? { drafts: [], basis: [] };
  }

  async createClarification(userId: string, projectId: string, dto: CreateExpertClarificationDto) {
    // P2：阶段门控 — 仅评标阶段可发起澄清（澄清答疑发生在评标期间）
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'EVALUATING') {
      throw new ForbiddenException({ error: '项目不在评标阶段，无法发起澄清', code: 'PROJECT_NOT_EVALUATING' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // P2：校验供应商属于本项目（防注入任意 supplierId 污染 QA 线程）
    if (dto.supplierId) {
      const supplier = await this.prisma.bidSupplier.findFirst({ where: { id: dto.supplierId, projectId } });
      if (!supplier) throw new BadRequestException({ error: '供应商不属于此项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
    }

    return this.prisma.bidClarification.create({
      data: {
        projectId,
        question: dto.question,
        issuer: expert.expertName,
        supplierName: dto.supplierName,
        supplierId: dto.supplierId || null,
        status: '待回复',
      },
    });
  }

  /* ── 评审报告 ── */

  async getReport(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ error: '用户不存在', code: 'USER_NOT_FOUND' });

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        scoreItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });

    // Query score records and group by supplierId
    const scoreRecords = await this.prisma.bidScoreRecord.findMany({
      where: { expertId: expert.id },
      include: { scoreItem: true },
    });

    const bySupplier = new Map<string, typeof scoreRecords>();
    for (const r of scoreRecords) {
      const key = r.supplierId || '__unassigned';
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key)!.push(r);
    }

    // C3+M9: 多轮项目查 BidOpeningRecord 金额供报告展示
    const openingRecMap = new Map<string, string>();
    const openingRecs = await this.prisma.bidOpeningRecord.findMany({
      where: { projectId, bidSupplierId: { in: project.suppliers.map(s => s.id) } },
      select: { bidSupplierId: true, amount: true },
    });
    for (const r of openingRecs) {
      if (r.bidSupplierId && r.amount) openingRecMap.set(r.bidSupplierId, r.amount);
    }

    // 查询该专家在本项目所有供应商的评分核对状态（供 report-step 核对徽章 + canConfirm 判定）
    const reviewRecords = await this.prisma.bidScoreReview.findMany({
      where: { expertId: expert.id, projectId },
      select: { supplierId: true, status: true, verifiedAt: true },
    });
    const reviewBySupplier = new Map(reviewRecords.map(r => [r.supplierId, r]));

    // 与 confirmReport gate 一致：active = decryptStatus SUCCESS + submitStatus != 已撤回
    const activeSuppliers = project.suppliers.filter(
      s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回',
    );
    const allVerified = activeSuppliers.length > 0 && activeSuppliers.every(s => reviewBySupplier.get(s.id)?.status === 'verified');

    // 证据链：查 pointDecisions + 得分点元数据，供报告展示逐点明细（复用 getMyScores 的查询模式）
    const [pointDecisions, scorePoints] = await Promise.all([
      this.prisma.bidScorePointDecision.findMany({
        where: { expertId: expert.id },
        select: { pointId: true, supplierId: true, checked: true, awardedScore: true, note: true },
      }),
      this.prisma.bidScorePoint.findMany({
        where: { scoreItemId: { in: project.scoreItems.map(i => i.id) } },
        select: { id: true, scoreItemId: true, name: true, fullScore: true, seq: true },
        orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    // pointId → 元数据（name/fullScore/scoreItemId）
    const pointMeta = new Map(scorePoints.map(p => [p.id, p]));
    // `${supplierId}:${scoreItemId}` → 得分点明细（按 seq 排序）
    const decisionsByItem = new Map<string, { name: string; checked: boolean; awardedScore: number; fullScore: number; note?: string }[]>();
    for (const d of pointDecisions) {
      const meta = pointMeta.get(d.pointId);
      if (!meta) continue; // 防御：孤儿 decision（point 已删）
      const key = `${d.supplierId}:${meta.scoreItemId}`;
      const arr = decisionsByItem.get(key) ?? [];
      arr.push({ name: meta.name, checked: d.checked, awardedScore: Number(d.awardedScore), fullScore: Number(meta.fullScore), note: d.note || undefined });
      decisionsByItem.set(key, arr);
    }

    // 按供应商分组汇总评分
    const supplierScores = project.suppliers.map(supplier => {
      const records = bySupplier.get(supplier.id) || [];
      const totalScore = records.reduce((sum, r) => sum + Number(r.score), 0);
      const categoryScores: Record<string, { total: number; max: number; items: { name: string; score: number; maxScore: number; passed?: boolean; reason?: string; points?: { name: string; checked: boolean; awardedScore: number; fullScore: number; note?: string }[] }[] }> = {};

      for (const record of records) {
        const cat = record.scoreItem.category;
        if (!categoryScores[cat]) categoryScores[cat] = { total: 0, max: 0, items: [] };
        categoryScores[cat].total += Number(record.score);
        categoryScores[cat].max += Number(record.scoreItem.maxScore);
        categoryScores[cat].items.push({
          name: record.scoreItem.name,
          score: Number(record.score),
          maxScore: Number(record.scoreItem.maxScore),
          passed: (record as any).passed ?? undefined,
          reason: record.reason || undefined,
          points: decisionsByItem.get(`${supplier.id}:${record.scoreItem.id}`),
        });
      }

      return {
        supplierName: supplier.supplierName,
        totalScore,
        bidPrice: openingRecMap.get(supplier.id) ?? undefined, // C3+M9: 最终报价
        categoryScores,
        perSupplierComplete: project.scoreItems.length > 0 && records.length === project.scoreItems.length,
        scoreReview: reviewBySupplier.has(supplier.id)
          ? { status: reviewBySupplier.get(supplier.id)!.status, verifiedAt: reviewBySupplier.get(supplier.id)!.verifiedAt }
          : null,
      };
    });

    // Task 11：披露本人异议条款（评审报告维度，非 AI docx — 异议产生于专家评标阶段，晚于 AI 报告）
    // 过滤 verdict='dispute'，跨 supplier；supplierName 来自 bidderResult.bidSupplier，
    // tenderContent 来自 bidderResult.requirementResponses 反查（缺失 fallback 空串）
    const disputedReviews = await this.buildExpertReviews(projectId, expert.id, ['dispute']);
    const myDisputedReviews = disputedReviews.map((r) => ({
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      requirementId: r.requirementId,
      category: r.category,
      tenderContent: r.content,
      note: r.note,
    }));

    return {
      projectName: project.name,
      projectCode: project.projectCode,
      expertName: expert.expertName,
      expertProgress: expert.progress,
      signedIn: expert.signedIn,
      avoidanceConfirmed: expert.avoidanceConfirmed,
      supplierScores,
      scoreItems: project.scoreItems,
      canConfirm: expert.progress >= 100 && allVerified,
      overallComplete: expert.progress >= 100,
      myDisputedReviews,
    };
  }

  async confirmReport(userId: string, projectId: string, comment?: string) {
    // P1: 阶段门控 — 仅在评标阶段可确认报告
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'EVALUATING') {
      throw new ForbiddenException({ error: '项目不在评标阶段，无法确认报告', code: 'PROJECT_NOT_EVALUATING' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }
    if (expert.progress < 100) throw new ForbiddenException({ error: '评分未完成，无法确认报告', code: 'SCORING_INCOMPLETE' });

    // P1-7：事务化——事务内重读核对状态并原子确认，消除与 submitScores（重置 review 为 draft）的 TOCTOU
    const updated = await this.prisma.$transaction(async (tx) => {
      // P0-3: 行锁 BidExpert，消除与 submitScores 的 TOCTOU 竞态
      await tx.$queryRaw`SELECT id FROM "BidExpert" WHERE id = ${expert.id} FOR UPDATE`;

      // phase ③：所有活跃供应商必须已核对（事务内重读）
      const activeSuppliers = await tx.bidSupplier.findMany({
        where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
        select: { id: true },
      });
      const verifiedReviews = await tx.bidScoreReview.findMany({
        where: { expertId: expert.id, projectId, status: 'verified' },
        select: { supplierId: true },
      });
      const verifiedSet = new Set(verifiedReviews.map(r => r.supplierId));
      const unverified = activeSuppliers.filter(s => !verifiedSet.has(s.id));
      if (unverified.length > 0) {
        throw new BadRequestException({ error: `有 ${unverified.length} 个供应商评分未核对`, code: 'REVIEW_PENDING' });
      }

      // 先更新确认状态，再记监督日志（同事务，避免孤儿「已确认」日志）
      const upd = await tx.bidExpert.update({
        where: { id: expert.id },
        data: { progress: 100, reportConfirmed: true, reportConfirmedAt: new Date() },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId,
          time: new Date(),
          role: '评审专家',
          target: expert.expertName,
          action: '确认评审报告',
          result: comment || '确认完成',
          riskFlag: '无',
        },
      });
      // P1-E：报告确认后，该专家本项目的 delta 标记为已确认（仅统计已确认报告的）
      await tx.bidScoreDelta.updateMany({
        where: { expertId: expert.id, projectId },
        data: { expertReportConfirmed: true },
      }).catch(() => {});
      return upd;
    });

    this.gateway?.notifyExpertPresence(expert.projectId, {
      expertId: expert.id, expertName: expert.expertName, milestone: 'report_confirmed', progressPercent: 100,
    });
    return updated;
  }

  /** G3: 保存/加载评分草稿(服务端持久化,防 localStorage 丢失)。
   *  按 device 分槽存储，避免平板与桌面互相覆盖。 */
  async saveScoreDraft(userId: string, projectId: string, draft: Record<string, unknown>, device?: 'tablet' | 'desktop') {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '不是项目评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (expert.reportConfirmed) {
      throw new BadRequestException({ error: '评审报告已确认，评分已锁定', code: 'SCORE_LOCKED' });
    }
    const deviceSlot = device === 'tablet' ? 'tablet' : 'desktop';
    // 兼容旧扁平格式：若 scoreDraft 不含 device 分槽，初始化为空对象
    const existing = (expert.scoreDraft as any) ?? {};
    const merged = typeof existing.tablet === 'object' || typeof existing.desktop === 'object'
      ? { ...existing, [deviceSlot]: draft }
      : { desktop: existing, [deviceSlot]: draft };
    return this.prisma.bidExpert.update({ where: { id: expert.id }, data: { scoreDraft: merged as any } });
  }

  async getScoreDraft(userId: string, projectId: string, device?: 'tablet' | 'desktop') {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId }, select: { scoreDraft: true } });
    const raw = (expert?.scoreDraft ?? {}) as any;
    // 兼容旧扁平格式 → 视为 desktop 草稿
    if (!raw || (typeof raw.tablet !== 'object' && typeof raw.desktop !== 'object')) {
      if (raw && typeof raw.scores === 'object') return raw; // 旧格式直接返回
      return null;
    }
    // 新格式：合并 tablet + desktop 草稿，对本设备优先（同一 scoreKey 本设备的覆盖对方的）
    const own = (device === 'tablet' ? raw.tablet : raw.desktop) ?? {};
    const other = (device === 'tablet' ? raw.desktop : raw.tablet) ?? {};
    const ownScores = own?.scores ?? {};
    const otherScores = other?.scores ?? {};
    const mergedScores = { ...otherScores, ...ownScores }; // 本设备覆盖
    const mergedSavedAt = Math.max(
      own?.savedAt ?? 0,
      other?.savedAt ?? 0,
    );
    return {
      scores: mergedScores,
      savedAt: mergedSavedAt,
    };
  }

  /** 评分历史：已提交值 + 修改快照 + 草稿值 + 未评分项，按 scoreItemId 分组 */
  async getScoreHistory(userId: string, projectId: string, supplierId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const [scoreItems, records, history] = await Promise.all([
      // 全部评分项（含 name + category，用于展示未评分项）
      this.prisma.bidScoreItem.findMany({
        where: { projectId },
        select: { id: true, name: true, category: true },
      }),
      // 已提交的当前值
      this.prisma.bidScoreRecord.findMany({
        where: { expertId: expert.id, supplierId },
      }),
      // 修改历史快照
      this.prisma.bidScoreRecordHistory.findMany({
        where: { expertId: expert.id, supplierId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // 草稿：从 scoreDraft 合并提取该供应商的草稿评分
    const rawDraft = (expert.scoreDraft ?? {}) as any;
    let draftScores: Record<string, any> = {};
    if (typeof rawDraft.tablet === 'object' || typeof rawDraft.desktop === 'object') {
      const t = rawDraft.tablet?.scores ?? {};
      const d = rawDraft.desktop?.scores ?? {};
      draftScores = { ...t, ...d };
    } else if (rawDraft.scores) {
      draftScores = rawDraft.scores;
    }
    const draftForSupplier: Record<string, any> = {};
    for (const [key, val] of Object.entries(draftScores)) {
      if (key.startsWith(`${supplierId}:`)) {
        const scoreItemId = key.split(':')[1];
        draftForSupplier[scoreItemId] = val;
      }
    }

    type Item = {
      scoreItemId: string;
      scoreItemName: string;
      category: string;
      current: { score: number; passed: boolean | null; reason: string | null; updatedAt: string };
      draft: { score: number; passed: boolean | null; reason: string | null } | null;
      history: Array<{ score: number; passed: boolean | null; reason: string | null; action: string; createdAt: string }>;
    };

    const byItemId = new Map<string, Item>();

    // 1. 初始化全部评分项（包括未评分的）
    for (const si of scoreItems) {
      byItemId.set(si.id, {
        scoreItemId: si.id,
        scoreItemName: si.name,
        category: si.category,
        current: { score: 0, passed: null, reason: null, updatedAt: '' },
        draft: null,
        history: [],
      });
    }

    // 2. 放历史快照
    for (const h of history) {
      const item = byItemId.get(h.scoreItemId);
      if (item) {
        item.history.push({
          score: Number(h.score),
          passed: h.passed,
          reason: h.reason,
          action: h.action,
          createdAt: h.createdAt.toISOString(),
        });
      }
    }

    // 3. 放已提交的当前值
    for (const r of records) {
      const item = byItemId.get(r.scoreItemId);
      if (item) {
        item.current = {
          score: Number(r.score),
          passed: r.passed,
          reason: r.reason,
          updatedAt: r.updatedAt.toISOString(),
        };
      }
    }

    // 4. 放草稿值（标记未提交的打分）
    for (const [scoreItemId, draftVal] of Object.entries(draftForSupplier)) {
      const item = byItemId.get(scoreItemId);
      if (item && !item.current.updatedAt) {
        item.draft = {
          score: draftVal.score ?? 0,
          passed: draftVal.passed ?? null,
          reason: draftVal.reason ?? null,
        };
      }
    }

    return Array.from(byItemId.values());
  }

  /** E：桌面端「去打分平板」跨设备联动——写入 focus hint（Redis，TTL 120s）。 */
  async setFocusHint(userId: string, projectId: string, body: { supplierId: string; scoreItemId?: string; pointId?: string }) {
    if (!this.redis) throw new BadRequestException({ error: 'Redis 未配置，跨设备联动不可用', code: 'REDIS_UNAVAILABLE' });
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId }, select: { id: true } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    const key = `expert:focus:${expert.id}:${projectId}`;
    const seqKey = `expert:focus:seq:${expert.id}:${projectId}`;
    const seq = await this.redis!.incr(seqKey);
    await this.redis!.set(key, JSON.stringify({ ...body, seq, at: Date.now() }), 'EX', 120);
    await this.redis!.expire(seqKey, 120);
    return { ok: true, seq };
  }

  /** E：平板端轮询读取 focus hint（无则 null）。 */
  async getFocusHint(userId: string, projectId: string) {
    if (!this.redis) return null;
    const redis = this.redis;
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId }, select: { id: true } });
    if (!expert) return null;
    const raw = await redis.get(`expert:focus:${expert.id}:${projectId}`);
    if (!raw) return null;
    try {
      const hint = JSON.parse(raw);
      // ACK：平板已成功读取本 seq 的 hint（幂等，多次轮询重复写同一 key 无副作用）
      await redis.set(`expert:focus:ack:${expert.id}:${projectId}:${hint.seq}`, '1', 'EX', 30);
      return hint;
    } catch { return null; }
  }

  /** 桌面端查询平板是否已接收 focus hint（ACK 回执）。 */
  async getFocusHintAck(userId: string, projectId: string, seq: number) {
    if (!this.redis) return { acked: false };
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId }, select: { id: true } });
    if (!expert) return { acked: false };
    const ack = await this.redis.get(`expert:focus:ack:${expert.id}:${projectId}:${seq}`);
    return { acked: !!ack };
  }

  /** D2: 创建异议工单（仅组长） */
  async createDispute(userId: string, projectId: string, dto: { type: string; title: string; content: string }) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '不是项目评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.isLead) throw new ForbiddenException({ error: '仅评审组长可提交异议', code: 'NOT_LEAD' });
    return this.prisma.expertDispute.create({
      data: { projectId, expertId: expert.id, expertName: expert.expertName, type: dto.type, title: dto.title, content: dto.content },
    });
  }

  /** D2: 查询项目异议工单 */
  async listDisputes(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '不是项目评审专家', code: 'NOT_PROJECT_EXPERT' });
    return this.prisma.expertDispute.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  /** C2: 组长末签 — 所有专家确认报告后,组长执行最终末签 */
  async leaderCoSign(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // P1-1: 阶段门控 — 仅在评标阶段可末签
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true },
    });
    if (!project || project.stage !== 'EVALUATING') {
      throw new ForbiddenException({ error: '项目不在评标阶段，无法末签', code: 'PROJECT_NOT_EVALUATING' });
    }

    // P1-1: 组长身份核验门控（与 confirmReport 对齐）
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed
        || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }

    if (!expert.isLead) throw new ForbiddenException({ error: '仅评审组长可末签', code: 'NOT_LEADER' });
    if (!expert.reportConfirmed) throw new BadRequestException({ error: '组长须先确认自己的评审报告', code: 'REPORT_NOT_CONFIRMED' });

    // 所有专家必须已确认报告
    const unconfirmed = await this.prisma.bidExpert.count({
      where: { projectId, reportConfirmed: false },
    });
    if (unconfirmed > 0) throw new BadRequestException({
      error: `还有 ${unconfirmed} 位专家未确认报告,无法末签`, code: 'MEMBERS_NOT_CONFIRMED',
    });

    const updated = await this.prisma.bidProject.update({
      where: { id: projectId },
      data: { leaderCoSigned: true, leaderCoSignedAt: new Date() },
      select: { id: true, leaderCoSigned: true, leaderCoSignedAt: true },
    });

    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '评审组长', target: expert.expertName,
        action: '组长末签', result: '评审报告经组长末签,可生成评标结果', riskFlag: '无' },
    }).catch(() => {});

    return updated;
  }

  // ── C1: 投票/合议/决议 ──

  /** 发起表决(仅组长) */
  async createMotion(userId: string, projectId: string, dto: { type: string; title: string; description?: string }) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '不是项目评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.isLead) throw new ForbiddenException({ error: '仅评审组长可发起表决', code: 'NOT_LEAD' });

    const motion = await this.prisma.bidMotion.create({
      data: { projectId, type: dto.type, title: dto.title, description: dto.description, createdBy: expert.id, status: 'voting' },
    });
    return motion;
  }

  /** 投票(一票制,不可改投) */
  async castVote(userId: string, motionId: string, vote: string, reason?: string) {
    const VALID_VOTES = ['approve', 'reject', 'abstain'];
    if (!VALID_VOTES.includes(vote)) {
      throw new BadRequestException({ error: '无效的投票值', code: 'INVALID_VOTE' });
    }

    // P0-1: 先查 motion 获取 projectId，再以此限定 BidExpert 查询，防止跨项目投票
    const motion = await this.prisma.bidMotion.findUnique({ where: { id: motionId } });
    if (!motion) throw new BadRequestException({ error: '动议不存在', code: 'NOT_FOUND' });
    if (motion.status !== 'voting') throw new BadRequestException({ error: '动议不在投票阶段', code: 'MOTION_NOT_VOTING' });

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId: motion.projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '不是该项目评审专家', code: 'NOT_PROJECT_EXPERT' });

    const existing = await this.prisma.bidVote.findUnique({ where: { motionId_expertId: { motionId, expertId: expert.id } } });
    if (existing) throw new BadRequestException({ error: '您已投过票,不可重复投票', code: 'ALREADY_VOTED' });

    return this.prisma.bidVote.create({
      data: { motionId, expertId: expert.id, vote, reason },
    });
  }

  /** 结束投票并统计结果(仅组长或动议发起人) */
  async closeMotion(userId: string, motionId: string) {
    // P0-1: 先查 motion 获取 projectId，再以此限定 BidExpert 查询，防止跨项目操作
    const motion = await this.prisma.bidMotion.findUnique({
      where: { id: motionId },
      include: { votes: true, project: { select: { experts: {
        where: { expertRole: '正选' },
        select: { id: true, isLead: true },
      } } } },
    });
    if (!motion) throw new BadRequestException({ error: '动议不存在', code: 'NOT_FOUND' });

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId: motion.projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '不是该项目评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.isLead && motion.createdBy !== expert.id)
      throw new ForbiddenException({ error: '仅评审组长或动议发起人可结束投票', code: 'NOT_AUTHORIZED' });

    const approves = motion.votes.filter(v => v.vote === 'approve').length;
    const rejects = motion.votes.filter(v => v.vote === 'reject').length;
    const totalVoters = motion.project.experts.length;

    // P1: 常量门槛——须过半数正选专家投票方可结束（防 1 票草率结案）
    const quorum = Math.floor(totalVoters / 2) + 1;
    if (motion.votes.length < quorum) {
      throw new BadRequestException({
        error: `投票人数不足（${motion.votes.length}/${totalVoters}），须至少 ${quorum} 人投票方可结束`,
        code: 'QUORUM_NOT_MET',
      });
    }

    let result: string;
    if (approves > rejects) result = 'approved';
    else if (rejects > approves) result = 'rejected';
    else {
      // P1: 平票时组长投票作为决定票（评标实务：组长裁决权）
      const lead = motion.project.experts.find(e => e.isLead);
      const leadVote = motion.votes.find(v => v.expertId === lead?.id);
      if (leadVote?.vote === 'approve') result = 'approved';
      else if (leadVote?.vote === 'reject') result = 'rejected';
      else result = 'tie_deadlock'; // 组长未投票或弃权——保留平票，须人工介入
    }

    return this.prisma.bidMotion.update({
      where: { id: motionId },
      data: { status: 'closed', result, closedAt: new Date() },
    });
  }

  /** 查询项目动议列表 */
  async listMotions(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '不是项目评审专家', code: 'NOT_PROJECT_EXPERT' });
    return this.prisma.bidMotion.findMany({
      where: { projectId },
      include: { votes: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── 评审待办：跨项目聚合 ──

  /** 汇总当前专家所有活跃项目的动议(投票中)与异议工单 */
  async getMyTasks(userId: string) {
    const records = await this.prisma.bidExpert.findMany({
      where: { userId, project: { stage: { in: ['OPENING', 'EVALUATING'] } } },
      select: { id: true, expertName: true, isLead: true, projectId: true, project: { select: { name: true, stage: true } } },
    });
    if (records.length === 0) return { motions: [], disputes: [], projects: [] };

    const projectIds = [...new Set(records.map(r => r.projectId))];
    const expertIds = records.map(r => r.id);

    // 每个项目的正选委员总数（用于表决进度「已投/应投」）
    const voterCounts = await this.prisma.bidExpert.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, expertRole: '正选' },
      _count: { _all: true },
    });
    const projectMap = new Map(records.map(r => [r.projectId, {
      name: r.project.name,
      stage: r.project.stage,
      totalVoters: voterCounts.find(v => v.projectId === r.projectId)?._count._all ?? 0,
    }]));

    const [motions, disputes] = await Promise.all([
      this.prisma.bidMotion.findMany({
        where: { projectId: { in: projectIds }, status: { in: ['voting', 'closed'] } },
        include: { votes: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.expertDispute.findMany({
        where: { projectId: { in: projectIds } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      projects: records.map(r => ({
        projectId: r.projectId,
        projectName: r.project.name,
        stage: r.project.stage,
        myExpertId: r.id,
        isLead: r.isLead,
      })),
      motions: motions.map(m => ({
        ...m,
        projectName: projectMap.get(m.projectId)?.name ?? '',
        projectStage: projectMap.get(m.projectId)?.stage ?? '',
        totalVoters: projectMap.get(m.projectId)?.totalVoters ?? 0,
        myVote: m.votes.find(v => expertIds.includes(v.expertId))?.vote ?? null,
      })),
      disputes: disputes.map(d => ({
        ...d,
        projectName: projectMap.get(d.projectId)?.name ?? '',
        projectStage: projectMap.get(d.projectId)?.stage ?? '',
      })),
    };
  }
}
