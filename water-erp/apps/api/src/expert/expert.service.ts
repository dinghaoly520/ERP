import { Injectable, Optional, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { BidGateway } from '../bid/bid.gateway';
import { ClarificationAiService } from '../bid/clarification-ai.service';
import { PlaintextFetcherService, BidderFileType } from '../ai-bid-analysis/services/plaintext-fetcher.service';
import { BatchScoreDto } from './dto/batch-score.dto';
import { UpdateExpertProfileDto } from './dto/update-profile.dto';
import { CreateExpertClarificationDto } from './dto/create-expert-clarification.dto';
import { UpsertRequirementReviewDto } from './dto/upsert-requirement-review.dto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { decryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';
import { unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';

@Injectable()
export class ExpertService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private conflictService: ExpertConflictService,
    private plaintextFetcher: PlaintextFetcherService,
    @Optional() private readonly clarificationAi?: ClarificationAiService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  /* ── 个人资料 ── */

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
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
    return { ...safeUser, assignments: expertRecords };
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

    return this.prisma.user.findUnique({ where: { id: userId } });
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
    // 平均得分 = 所有打分项总分 / 被评供应商数（每位供应商满分100）
    // 每个 BidExpert 下的 scoreRecords 中 supplierId 去重即为该专家在该项目中评过的供应商数
    const totalScoreSum = records.reduce((s, e) => s + Number(e.totalScore), 0);
    const distinctSupplierCount = new Set(
      records.flatMap(e => e.scoreRecords.map(r => r.supplierId)),
    ).size;
    const averageScore = distinctSupplierCount > 0
      ? Math.round((totalScoreSum / distinctSupplierCount) * 10) / 10
      : 0;

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

  async getProject(userId: string, projectId: string) {
    const expertRecord = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
      include: {
        user: { include: { expertProfile: true } },
      },
    });
    if (!expertRecord) throw new ForbiddenException('您不是该项目的评审专家');

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { select: { id: true, expertName: true, major: true, signedIn: true, avoidanceConfirmed: true, progress: true, reportConfirmed: true } },
        scoreItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
        clarifications: { orderBy: { createdAt: 'desc' } },
        supervisionLogs: { orderBy: { time: 'desc' }, take: 20 },
      },
    });
    if (!project) throw new NotFoundException('项目不存在');

    const isActive = project.stage === 'OPENING' || project.stage === 'EVALUATING';

    // Compute masked phone from ExpertProfile
    const phone = expertRecord.user?.expertProfile?.phone ?? null;
    const phoneMasked = phone
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : null;

    const myExpertRecord = {
      ...expertRecord,
      phoneVerified: expertRecord.phoneVerified,
      phoneMasked,
      // Exclude nested user object from response
      user: undefined,
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

    // 招标文件元信息：仅 active 项目附带（门控要求 OPENING/EVALUATING），restricted 分支不带
    const tenderDoc = await this.prisma.bidDocument.findFirst({
      where: { bidProjectId: projectId },
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
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

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
    const allConflictIds = [...new Set([...(conflictedSupplierIds || []), ...autoConflicts.map(c => c.supplierId)])];
    if (!conflictedSupplierIds?.length && autoConflicts.length > 0) {
      // 仅自动检测出冲突时，仍允许确认（前端会提示），但阻止对冲突供应商评分。
    }

    const updated = await this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { avoidanceConfirmed: true, conflictedSupplierIds: allConflictIds.length > 0 ? (allConflictIds as any) : undefined },
    });
    this.gateway?.notifyExpertPresence(expert.projectId, {
      expertId: expert.id, expertName: expert.expertName, milestone: 'avoidance_confirmed', progressPercent: updated.progress ?? 0,
    });
    return updated;
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
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
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
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
    }
    return expert;
  }

  /** 招标文件元信息（供前端「招标文件」卡片展示），无则 null。 */
  async getTenderDocument(userId: string, projectId: string) {
    await this.assertExpertActiveForProject(userId, projectId);
    const doc = await this.prisma.bidDocument.findFirst({
      where: { bidProjectId: projectId },
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
    const doc = await this.prisma.bidDocument.findFirst({
      where: { bidProjectId: projectId },
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

    return { buffer: plaintext, fileName: doc.fileAsset.originalName, mimeType: 'application/pdf' };
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
    const conflictedIds: string[] = ((expert.conflictedSupplierIds as unknown) as string[]) || [];
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
    const conflictedIds: string[] = ((expert.conflictedSupplierIds as unknown) as string[]) || [];
    if (conflictedIds.includes(supplierId)) {
      throw new ForbiddenException({ error: '该供应商在您的回避名单中', code: 'CONFLICTED_SUPPLIER' });
    }
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
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

    // 15.4: 专家回避屏蔽 — 回避名单中的供应商不可查看 AI 分析
    const conflictedIds: string[] = ((expert.conflictedSupplierIds as unknown) as string[]) || [];
    if (conflictedIds.includes(supplierId)) {
      throw new ForbiddenException({ error: '该供应商在您的回避名单中', code: 'CONFLICTED_SUPPLIER' });
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
        totalScore: bidderResult.totalScore,
        scoreItems: bidderResult.scoreItems,
        categoryTotals: bidderResult.categoryTotals,
        keyInfo: bidderResult.keyInfo,
        concordance: bidderResult.concordance?.checkedFields ?? null,
        concordanceStatus: bidderResult.concordance?.overallStatus ?? null,
        strengths: bidderResult.strengths,
        weaknesses: bidderResult.weaknesses,
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
      ...(await this.aiService.analyzeBid(projectId, supplierId, expert.id)),
    };
  }

  /** 跨供应商对比概览 — 返回项目下所有已完成 AI 分析的供应商摘要 */
  async getAssistCompare(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      select: { id: true },
    });
    if (!task) return { bidders: [] };

    const results = await this.prisma.aiBidderResult.findMany({
      where: { taskId: task.id, status: 'COMPLETED' },
      include: { bidSupplier: { select: { supplierName: true } } },
    });

    return {
      bidders: results.map((r) => ({
        supplierId: r.bidSupplierId,
        supplierName: r.bidSupplier.supplierName,
        totalScore: r.totalScore != null ? Number(r.totalScore) : 0,
        categoryTotals: (r.categoryTotals as Record<string, { score: number; max: number }>) ?? {},
        qualificationStatus: r.qualificationStatus ?? '待审查',
        riskLevel: r.riskLevel ?? 'low',
      })),
    };
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
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
    }
    // P2: block scoring for suppliers the expert declared as conflicted
    // 防御性处理：Prisma Json 字段可能返回数组或字符串（seed 数据历史遗留）
    const rawConflicts = expert.conflictedSupplierIds;
    let expertConflicts: string[] = [];
    if (Array.isArray(rawConflicts)) {
      expertConflicts = rawConflicts as string[];
    } else if (typeof rawConflicts === 'string' && rawConflicts.length > 0) {
      try { expertConflicts = JSON.parse(rawConflicts); } catch { /* 解析失败则保持空数组 */ }
    }
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

    for (const item of dto.scores) {
      const meta = itemMeta.get(item.scoreItemId);
      if (!meta) continue;
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

      // Batch upsert — unique composite index guarantees idempotency
      for (const item of dto.scores) {
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
      const allScoreItems = await tx.bidScoreItem.findMany({ where: { projectId } });
      const activeSupplierCount = await tx.bidSupplier.count({
        where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
      });
      const totalItems = allScoreItems.length * activeSupplierCount;
      const scoredItems = await tx.bidScoreRecord.count({
        where: { expertId: expert.id, scoreItem: { projectId } },
      });
      const progress = totalItems > 0 ? Math.round((scoredItems / totalItems) * 100) : 0;

      const allRecords = await tx.bidScoreRecord.findMany({
        where: { expertId: expert.id, scoreItem: { projectId } },
      });
      const totalScore = allRecords.reduce((sum, r) => sum + Number(r.score), 0);

      await tx.bidExpert.update({
        where: { id: expert.id },
        data: { progress, totalScore },
      });

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

      return { records: allRecords, progress, totalScore };
    });

    // Emit WebSocket events after successful commit
    this.gateway?.notifyExpertPresence?.(projectId, {
      expertId: expert.id,
      expertName: expert.expertName,
      milestone: 'scoring_activity',
      progressPercent: result.progress,
    });
    this.gateway?.broadcastAggregatePresence?.(projectId);

    return result;
  }

  async getMyScores(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
    }

    const [records, reviews] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({
        where: { expertId: expert.id },
        include: { scoreItem: true },
      }),
      this.buildExpertReviews(projectId, expert.id, ['dispute', 'doubt']),
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
    return { records, disputeCategoriesBySupplier, disputesBySupplier };
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
  async draftClarification(_userId: string, projectId: string, supplierId: string) {
    return this.clarificationAi?.draftQuestion(projectId, supplierId) ?? { drafts: [], basis: [] };
  }

  async createClarification(userId: string, projectId: string, dto: CreateExpertClarificationDto) {
    // P2: 阶段门控 — 归档后不可发起澄清
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (project?.stage === 'ARCHIVED') {
      throw new ForbiddenException({ error: '项目已归档，无法发起澄清', code: 'PROJECT_ARCHIVED' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

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
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
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

    // 按供应商分组汇总评分
    const supplierScores = project.suppliers.map(supplier => {
      const records = bySupplier.get(supplier.id) || [];
      const totalScore = records.reduce((sum, r) => sum + Number(r.score), 0);
      const categoryScores: Record<string, { total: number; max: number; items: { name: string; score: number; maxScore: number; passed?: boolean; reason?: string }[] }> = {};

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
        });
      }

      return {
        supplierName: supplier.supplierName,
        totalScore,
        categoryScores,
        perSupplierComplete: project.scoreItems.length > 0 && records.length === project.scoreItems.length,
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
      canConfirm: expert.progress >= 100,
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
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
    }
    if (expert.progress < 100) throw new ForbiddenException({ error: '评分未完成，无法确认报告', code: 'SCORING_INCOMPLETE' });

    // 记录监督日志
    await this.prisma.bidSupervisionLog.create({
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

    const updated = await this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { progress: 100, reportConfirmed: true, reportConfirmedAt: new Date() },
    });
    // P1-E：报告确认后，该专家本项目的 delta 标记为已确认（仅统计已确认报告的）
    await this.prisma.bidScoreDelta.updateMany({
      where: { expertId: expert.id, projectId },
      data: { expertReportConfirmed: true },
    }).catch(() => {});
    this.gateway?.notifyExpertPresence(expert.projectId, {
      expertId: expert.id, expertName: expert.expertName, milestone: 'report_confirmed', progressPercent: 100,
    });
    return updated;
  }
}
