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
      where: { expertName: user.displayName },
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const records = await this.prisma.bidExpert.findMany({
      where: { expertName: user.displayName },
      include: { scoreRecords: true, project: true },
    });

    const totalProjects = records.length;
    const completedProjects = records.filter(e => e.progress >= 100).length;
    const signedInProjects = records.filter(e => e.signedIn).length;
    const pendingProjects = records.filter(e => !e.signedIn).length;
    const totalScoreSum = records.reduce((s, e) => s + Number(e.totalScore), 0);
    const averageScore = records.length > 0 ? Math.round((totalScoreSum / records.length) * 10) / 10 : 0;

    const recentActivity = await this.prisma.bidSupervisionLog.findMany({
      where: { target: { contains: user.displayName } },
      orderBy: { time: 'desc' },
      take: 5,
    });

    return { totalProjects, completedProjects, signedInProjects, pendingProjects, averageScore, recentActivity };
  }

  /* ── 项目列表 ── */

  async listProjects(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    return this.prisma.bidExpert.findMany({
      where: { expertName: user.displayName },
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expertRecord = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    return this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { signedIn: true },
    });
  }

  async confirmAvoidance(userId: string, projectId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    return this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { avoidanceConfirmed: true },
    });
  }

  /* ── 标书解密获取 ── */

  async getDecryptedDocuments(userId: string, projectId: string, supplierId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException('请先完成身份核验和回避确认');
    }

    const supplier = await this.prisma.bidSupplier.findFirst({
      where: { id: supplierId, projectId },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');

    // 模拟解密后的文档列表
    const documents = [
      { name: '投标函', type: 'PDF', size: '256KB', status: supplier.decryptStatus === 'SUCCESS' ? '已解密' : '加密中' },
      { name: '技术方案', type: 'PDF', size: '1.2MB', status: supplier.decryptStatus === 'SUCCESS' ? '已解密' : '加密中' },
      { name: '商务报价', type: 'PDF', size: '512KB', status: supplier.decryptStatus === 'SUCCESS' ? '已解密' : '加密中' },
      { name: '资质文件', type: 'PDF', size: '3.8MB', status: supplier.decryptStatus === 'SUCCESS' ? '已解密' : '加密中' },
      { name: '项目团队', type: 'PDF', size: '890KB', status: supplier.decryptStatus === 'SUCCESS' ? '已解密' : '加密中' },
      { name: '合同草案', type: 'DOCX', size: '340KB', status: supplier.decryptStatus === 'SUCCESS' ? '已解密' : '加密中' },
    ];

    return {
      supplier: { id: supplier.id, name: supplier.supplierName, decryptStatus: supplier.decryptStatus },
      documents,
      canView: supplier.decryptStatus === 'SUCCESS',
    };
  }

  /* ── 辅助评标（AI引擎驱动） ── */

  async getAssistData(userId: string, projectId: string, supplierId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    // 使用 AI 引擎进行全方位分析
    return this.aiService.analyzeBid(projectId, supplierId, expert.id);
  }

  /* ── 专家打分 ── */

  async submitScores(userId: string, projectId: string, dto: BatchScoreDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
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
    const totalItems = allScoreItems.length * (await this.prisma.bidSupplier.count({ where: { projectId } }));
    const scoredItems = await this.prisma.bidScoreRecord.count({ where: { expertId: expert.id } });
    const progress = totalItems > 0 ? Math.round((scoredItems / totalItems) * 100) : 0;

    // 计算总分
    const allRecords = await this.prisma.bidScoreRecord.findMany({
      where: { expertId: expert.id },
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
        target: user.displayName,
        action: `提交评分（供应商：${dto.supplierName}）`,
        result: `共${dto.scores.length}项评分`,
        riskFlag: '无',
      },
    });

    return { records, progress, totalScore };
  }

  async getMyScores(userId: string, projectId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    return this.prisma.bidScoreRecord.findMany({
      where: { expertId: expert.id },
      include: { scoreItem: true },
    });
  }

  /* ── 澄清答疑 ── */

  async createClarification(userId: string, projectId: string, dto: CreateExpertClarificationDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    return this.prisma.bidClarification.create({
      data: {
        projectId,
        question: dto.question,
        issuer: user.displayName,
        supplierName: dto.supplierName,
        status: '待回复',
      },
    });
  }

  /* ── 评审报告 ── */

  async getReport(userId: string, projectId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

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
      expertName: user.displayName,
      expertProgress: expert.progress,
      signedIn: expert.signedIn,
      avoidanceConfirmed: expert.avoidanceConfirmed,
      supplierScores,
      scoreItems: project.scoreItems,
      canConfirm: expert.progress >= 100,
    };
  }

  async confirmReport(userId: string, projectId: string, comment?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');
    if (expert.progress < 100) throw new ForbiddenException('评分未完成，无法确认报告');

    // 记录监督日志
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId,
        time: new Date(),
        role: '评审专家',
        target: user.displayName,
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
