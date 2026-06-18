import { Injectable, Optional, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { BidGateway } from '../bid/bid.gateway';
import { BatchScoreDto } from './dto/batch-score.dto';
import { UpdateExpertProfileDto } from './dto/update-profile.dto';
import { CreateExpertClarificationDto } from './dto/create-expert-clarification.dto';

@Injectable()
export class ExpertService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private conflictService: ExpertConflictService,
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
    const totalScoreSum = records.reduce((s, e) => s + Number(e.totalScore), 0);
    const averageScore = records.length > 0 ? Math.round((totalScoreSum / records.length) * 10) / 10 : 0;

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
        restricted: true,
      };
    }

    // 获取当前专家自己的评分记录
    const myScores = await this.prisma.bidScoreRecord.findMany({
      where: { expertId: expertRecord.id },
      include: { scoreItem: true },
    });

    return { ...project, myExpertRecord, myScores, restricted: false };
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
          downloadUrl: canView && asset ? `/api/upload/files/${asset.id}` : undefined,
          sha256: canView ? asset?.sha256 : undefined,
        };
      });

    return {
      supplier: { id: supplier.id, name: supplier.supplierName, decryptStatus: supplier.decryptStatus },
      documents,
      canView,
    };
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

    // 使用 AI 引擎进行全方位分析
    return this.aiService.analyzeBid(projectId, supplierId, expert.id);
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
    const expertConflicts: string[] = ((expert.conflictedSupplierIds as unknown) as string[]) || [];
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
      select: { id: true, maxScore: true },
    });
    if (scoreItems.length !== new Set(scoreItemIds).size) {
      throw new BadRequestException({ error: '评分项不属于当前项目', code: 'SCORE_ITEM_NOT_IN_PROJECT' });
    }
    const maxScoreMap = new Map(scoreItems.map(si => [si.id, Number(si.maxScore)]));

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
      const maxScore = maxScoreMap.get(item.scoreItemId);
      if (maxScore !== undefined && item.score > maxScore) {
        throw new BadRequestException({
          error: `评分项 ${item.scoreItemId} 分数 ${item.score} 超过满分 ${maxScore}`,
          code: 'SCORE_EXCEEDS_MAX',
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
          update: { score: item.score, reason: item.reason },
          create: {
            expertId: expert.id,
            scoreItemId: item.scoreItemId,
            supplierId: item.supplierId,
            score: item.score,
            reason: item.reason,
          },
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

    return this.prisma.bidScoreRecord.findMany({
      where: { expertId: expert.id },
      include: { scoreItem: true },
    });
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
      const categoryScores: Record<string, { total: number; max: number; items: { name: string; score: number; maxScore: number; reason?: string }[] }> = {};

      for (const record of records) {
        const cat = record.scoreItem.category;
        if (!categoryScores[cat]) categoryScores[cat] = { total: 0, max: 0, items: [] };
        categoryScores[cat].total += Number(record.score);
        categoryScores[cat].max += Number(record.scoreItem.maxScore);
        categoryScores[cat].items.push({
          name: record.scoreItem.name,
          score: Number(record.score),
          maxScore: Number(record.scoreItem.maxScore),
          reason: record.reason || undefined,
        });
      }

      return {
        supplierName: supplier.supplierName,
        totalScore,
        categoryScores,
        completed: project.scoreItems.length > 0 && records.length === project.scoreItems.length,
      };
    });

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
    this.gateway?.notifyExpertPresence(expert.projectId, {
      expertId: expert.id, expertName: expert.expertName, milestone: 'report_confirmed', progressPercent: 100,
    });
    return updated;
  }
}
