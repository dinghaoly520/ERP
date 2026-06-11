import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BatchScoreDto } from './dto/batch-score.dto';
import { UpdateExpertProfileDto } from './dto/update-profile.dto';
import { CreateExpertClarificationDto } from './dto/create-expert-clarification.dto';

@Injectable()
export class ExpertService {
  constructor(private prisma: PrismaService) {}

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

  /* ── 辅助评标 ── */

  async getAssistData(userId: string, projectId: string, supplierId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, expertName: user.displayName },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    const supplier = await this.prisma.bidSupplier.findFirst({
      where: { id: supplierId, projectId },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');

    // 模拟AI辅助评标数据
    return {
      supplierName: supplier.supplierName,
      complianceCheck: {
        overall: '符合',
        items: [
          { name: '投标函签字盖章', status: 'pass', detail: '投标函已按要求签字盖章' },
          { name: '法定代表人授权书', status: 'pass', detail: '授权书有效，授权范围明确' },
          { name: '营业执照', status: 'pass', detail: '营业执照在有效期内' },
          { name: '资质证书', status: 'pass', detail: '资质等级符合要求' },
          { name: '安全生产许可证', status: 'pass', detail: '许可证有效' },
          { name: '项目经理资格', status: 'pass', detail: '一级建造师，符合要求' },
          { name: '投标保证金', status: 'pass', detail: '保证金已按时足额缴纳' },
          { name: '投标文件完整性', status: 'pass', detail: '文件份数符合要求' },
        ],
      },
      riskAnalysis: [
        { level: 'info', category: '技术', content: '技术方案中关于施工进度的描述较为详细，建议关注关键路径分析' },
        { level: 'info', category: '商务', content: '商务报价处于有效区间，建议结合市场行情综合评审' },
        { level: 'success', category: '资质', content: '供应商资质齐全，无异常记录' },
        { level: 'info', category: '经验', content: '同类项目经验3个以上，建议重点评审项目成果质量' },
      ],
      scoreSuggestion: [
        { category: 'QUALIFICATION', name: '企业资质', suggestedScore: 85, reason: '资质齐全，等级符合要求' },
        { category: 'TECHNICAL', name: '技术方案', suggestedScore: 80, reason: '方案较为完善，但部分细节可进一步优化' },
        { category: 'BUSINESS', name: '商务报价', suggestedScore: 88, reason: '报价合理，处于有效区间偏上' },
        { category: 'RESPONSIVE', name: '响应性', suggestedScore: 90, reason: '完全响应招标文件要求' },
        { category: 'PRICE', name: '价格评分', suggestedScore: 82, reason: '价格具有竞争力' },
      ],
      keyPoints: [
        '该供应商技术方案中质量控制体系较为完善',
        '项目经理具有丰富的同类项目经验',
        '商务报价略高于基准价，但仍在有效范围内',
        '售后服务承诺明确，响应时间满足要求',
      ],
    };
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

    // 删除该专家该供应商的旧评分（允许修改）
    await this.prisma.bidScoreRecord.deleteMany({
      where: {
        expertId: expert.id,
        scoreItemId: { in: dto.items.map(i => i.scoreItemId) },
      },
    });

    // 创建新评分
    const records = await Promise.all(
      dto.items.map(item =>
        this.prisma.bidScoreRecord.create({
          data: {
            expertId: expert.id,
            scoreItemId: item.scoreItemId,
            score: item.score,
            reason: item.reason,
          },
        }),
      ),
    );

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
        result: `共${dto.items.length}项评分`,
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
      include: { scoreRecords: { include: { scoreItem: true } } },
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

    // 按供应商分组汇总评分
    const supplierScores = project.suppliers.map(supplier => {
      const records = expert.scoreRecords;
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
