import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BatchScoreDto } from './dto/batch-score.dto';
import { UpdateExpertProfileDto } from './dto/update-profile.dto';
import { CreateExpertClarificationDto } from './dto/create-expert-clarification.dto';

@Injectable()
export class ExpertService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  /* ── 个人资料 ── */

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    const expertRecords = await this.prisma.bidExpert.findMany({
      where: { userId },
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
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName && { displayName: dto.displayName }),
        ...(dto.email && { email: dto.email }),
      },
    });
  }

  /* ── 统计概览 ── */

  async getStatistics(userId: string) {
    const records = await this.prisma.bidExpert.findMany({
      where: { userId },
      include: { scoreRecords: true, project: true },
    });

    const totalProjects = records.length;
    const completedProjects = records.filter(e => e.progress >= 100).length;
    const signedInProjects = records.filter(e => e.signedIn).length;
    const pendingProjects = records.filter(e => !e.signedIn).length;
    const totalScoreSum = records.reduce((s, e) => s + Number(e.totalScore), 0);
    const averageScore = records.length > 0 ? Math.round((totalScoreSum / records.length) * 10) / 10 : 0;

    // 获取专家名称用于查询监督日志
    const expertName = records.length > 0 ? records[0].expertName : '';

    const recentActivity = await this.prisma.bidSupervisionLog.findMany({
      where: { target: { contains: expertName } },
      orderBy: { time: 'desc' },
      take: 5,
    });

    return { totalProjects, completedProjects, signedInProjects, pendingProjects, averageScore, recentActivity };
  }

  /* ── 项目列表 ── */

  async listProjects(userId: string) {
    return this.prisma.bidExpert.findMany({
      where: { userId },
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
  }

  async getProject(userId: string, projectId: string) {
    const expertRecord = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expertRecord) throw new ForbiddenException('您不是该项目的评审专家');

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: { include: { scoreItem: true } } } },
        scoreItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
        clarifications: { orderBy: { createdAt: 'desc' } },
        supervisionLogs: { orderBy: { time: 'desc' }, take: 20 },
      },
    });

    // 获取当前专家自己的评分记录
    const myScores = await this.prisma.bidScoreRecord.findMany({
      where: { expertId: expertRecord.id },
      include: { scoreItem: true },
    });

    return { ...project, myExpertRecord: expertRecord, myScores };
  }

  /* ── 身份核验 ── */

  async signIn(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    return this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { signedIn: true },
    });
  }

  async confirmAvoidance(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    return this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { avoidanceConfirmed: true },
    });
  }

  /* ── 标书解密获取 ── */

  async getDecryptedDocuments(userId: string, projectId: string, supplierId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException('请先完成身份核验和回避确认');
    }

    const supplier = await this.prisma.bidSupplier.findFirst({
      where: { id: supplierId, projectId },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');

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
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    // 使用 AI 引擎进行全方位分析
    return this.aiService.analyzeBid(projectId, supplierId, expert.id);
  }

  /* ── 专家打分 ── */

  async submitScores(userId: string, projectId: string, dto: BatchScoreDto) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException('请先完成身份核验和回避确认');
    }

    // Validate project is in EVALUATING stage
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段', code: 'PROJECT_NOT_EVALUATING' });
    }

    // Validate scores don't exceed maxScore
    const scoreItemIds = dto.scores.map(s => s.scoreItemId);
    const scoreItems = await this.prisma.bidScoreItem.findMany({
      where: { id: { in: scoreItemIds } },
      select: { id: true, maxScore: true },
    });
    const maxScoreMap = new Map(scoreItems.map(si => [si.id, Number(si.maxScore)]));

    const supplierIds = Array.from(new Set(dto.scores.map(s => s.supplierId)));
    const bidSuppliers = await this.prisma.bidSupplier.findMany({
      where: { id: { in: supplierIds }, projectId },
      select: { id: true, decryptStatus: true, submitStatus: true },
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

    // 删除该专家该供应商的旧评分（允许修改）
    await this.prisma.bidScoreRecord.deleteMany({
      where: {
        expertId: expert.id,
        supplierId: { in: dto.scores.map(i => i.supplierId) },
        scoreItemId: { in: dto.scores.map(i => i.scoreItemId) },
      },
    });

    // 创建新评分
    await this.prisma.bidScoreRecord.createMany({
      data: dto.scores.map(item => ({
        expertId: expert.id,
        scoreItemId: item.scoreItemId,
        supplierId: item.supplierId,
        score: item.score,
        reason: item.reason,
      })),
    });

    // 查询新创建的记录用于返回值
    const records = await this.prisma.bidScoreRecord.findMany({
      where: {
        expertId: expert.id,
        scoreItemId: { in: dto.scores.map(i => i.scoreItemId) },
        supplierId: { in: dto.scores.map(i => i.supplierId) },
      },
    });

    // 更新专家的进度和总分
    const allScoreItems = await this.prisma.bidScoreItem.findMany({ where: { projectId } });
    const activeSupplierCount = await this.prisma.bidSupplier.count({
      where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
    });
    const totalItems = allScoreItems.length * activeSupplierCount;
    const scoredItems = await this.prisma.bidScoreRecord.count({
      where: { expertId: expert.id, scoreItem: { projectId } },
    });
    const progress = totalItems > 0 ? Math.round((scoredItems / totalItems) * 100) : 0;

    // 计算总分
    const allRecords = await this.prisma.bidScoreRecord.findMany({
      where: { expertId: expert.id, scoreItem: { projectId } },
    });
    const totalScore = allRecords.reduce((sum, r) => sum + Number(r.score), 0);

    await this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { progress, totalScore },
    });

    // 记录监督日志
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId,
        time: new Date(),
        role: '评审专家',
        target: expert.expertName,
        action: `提交评分（供应商：${dto.supplierName}）`,
        result: `共${dto.scores.length}项评分`,
        riskFlag: '无',
      },
    });

    return { records, progress, totalScore };
  }

  async getMyScores(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    return this.prisma.bidScoreRecord.findMany({
      where: { expertId: expert.id },
      include: { scoreItem: true },
    });
  }

  /* ── 澄清答疑 ── */

  async createClarification(userId: string, projectId: string, dto: CreateExpertClarificationDto) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    return this.prisma.bidClarification.create({
      data: {
        projectId,
        question: dto.question,
        issuer: expert.expertName,
        supplierName: dto.supplierName,
        status: '待回复',
      },
    });
  }

  /* ── 评审报告 ── */

  async getReport(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        scoreItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!project) throw new NotFoundException('项目不存在');

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
        completed: records.length === project.scoreItems.length,
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
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');
    if (expert.progress < 100) throw new ForbiddenException('评分未完成，无法确认报告');

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

    return this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { progress: 100 },
    });
  }
}
