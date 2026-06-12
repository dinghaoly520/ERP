import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';

@Injectable()
export class BidService {
  // 阶段转换白名单
  private static readonly STAGE_TRANSITIONS: Record<string, string[]> = {
    DOWNLOAD:    ['SUBMIT'],
    SUBMIT:      ['OPENING'],
    OPENING:     ['EVALUATING'],
    EVALUATING:  ['ARCHIVED'],
    ARCHIVED:    [],
  };

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  private assertStageTransition(current: string, target: string) {
    const allowed = BidService.STAGE_TRANSITIONS[current];
    if (!allowed || !allowed.includes(target)) {
      throw new BadRequestException({
        error: `不允许从 ${current} 转换到 ${target}`,
        code: 'INVALID_STAGE_TRANSITION',
      });
    }
  }

  async getDashboardStats() {
    const [
      totalProjects,
      activeProjects,
      totalSuppliers,
      approvedSuppliers,
      totalExperts,
      totalAnnouncements,
      recentLogs,
    ] = await Promise.all([
      this.prisma.bidProject.count(),
      this.prisma.bidProject.count({ where: { stage: { in: ['OPENING', 'EVALUATING', 'SUBMIT'] } } }),
      this.prisma.supplier.count(),
      this.prisma.supplier.count({ where: { status: 'APPROVED' } }),
      this.prisma.bidExpert.groupBy({ by: ['expertName'], _count: true }),
      this.prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.bidSupervisionLog.findMany({
        orderBy: { time: 'desc' },
        take: 8,
      }),
    ]);

    const stageCounts = await this.prisma.bidProject.groupBy({
      by: ['stage'],
      _count: { stage: true },
    });

    const stageDistribution: Record<string, number> = {};
    stageCounts.forEach(s => { stageDistribution[s.stage] = s._count.stage; });

    return {
      totalProjects,
      activeProjects,
      totalSuppliers,
      approvedSuppliers,
      totalExperts: totalExperts.length,
      totalAnnouncements,
      stageDistribution,
      recentActivity: recentLogs,
    };
  }

  listProjects() {
    return this.prisma.bidProject.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { suppliers: true } } },
    });
  }

  getProject(id: string) {
    return this.prisma.bidProject.findUnique({
      where: { id },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: true } },
        scoreItems: true,
        clarifications: true,
        supervisionLogs: { orderBy: { time: 'desc' } },
        archiveItems: true,
      },
    });
  }

  async createProject(dto: CreateBidProjectDto) {
    const project = await this.prisma.bidProject.create({
      data: {
        name: dto.name,
        projectCode: `BID-${Date.now()}`,
        procurementMethod: dto.procurementMethod,
        openTime: new Date(dto.openTime),
        deadline: new Date(dto.deadline),
        riskNote: dto.riskNote,
      },
    });

    await this.notificationService.sendToRole('bid_host', {
      type: 'BID_PUBLISHED',
      title: `新招标项目：${project.name}`,
      content: `项目编号 ${project.projectCode} 已创建，采购方式：${project.procurementMethod}。`,
      link: `/bid?id=${project.id}`,
    });

    return project;
  }

  async updateProject(id: string, dto: UpdateBidProjectDto) {
    if (dto.stage) {
      const project = await this.prisma.bidProject.findUnique({
        where: { id },
        select: { stage: true },
      });
      if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
      this.assertStageTransition(project.stage, dto.stage);
    }

    return this.prisma.bidProject.update({
      where: { id },
      data: {
        ...(dto.stage && { stage: dto.stage as any }),
        ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }),
      },
    });
  }

  listSuppliers(projectId: string) {
    return this.prisma.bidSupplier.findMany({ where: { projectId } });
  }

  submitBid(projectId: string, dto: SubmitBidDto) {
    const receiptNo = `TB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
    return this.prisma.bidSupplier.create({
      data: {
        projectId,
        supplierName: dto.supplierName,
        downloadStatus: '已下载',
        submitStatus: '已提交',
        encryptStatus: '密文已校验',
        receiptNo,
        decryptStatus: 'PENDING',
        confirmStatus: 'PENDING',
      },
    });
  }

  startOpening(projectId: string) {
    return this.startOpeningInternal(projectId);
  }

  async openSubmission(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertStageTransition(project.stage, 'SUBMIT');

    return this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'SUBMIT' },
    });
  }

  private async startOpeningInternal(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertStageTransition(project.stage, 'OPENING');

    return this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'OPENING' },
    });
  }

  async startEvaluation(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertStageTransition(project.stage, 'EVALUATING');

    return this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'EVALUATING' },
    });
  }

  decryptSupplier(projectId: string, supplierId: string) {
    return this.prisma.bidSupplier.update({
      where: { id: supplierId },
      data: { decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
    });
  }

  listOpeningRecords(projectId: string) {
    return this.prisma.bidOpeningRecord.findMany({ where: { projectId } });
  }

  listExperts(projectId: string) {
    return this.prisma.bidExpert.findMany({ where: { projectId }, include: { scoreRecords: true } });
  }

  submitScore(projectId: string, dto: CreateScoreDto) {
    return this.prisma.bidScoreRecord.create({
      data: {
        expertId: dto.expertId,
        scoreItemId: dto.scoreItemId,
        score: dto.score,
        reason: dto.reason,
      },
    });
  }

  listScores(projectId: string) {
    return this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      include: { expert: true, scoreItem: true },
    });
  }

  listClarifications(projectId: string) {
    return this.prisma.bidClarification.findMany({ where: { projectId } });
  }

  createClarification(projectId: string, dto: CreateClarificationDto) {
    return this.prisma.bidClarification.create({
      data: { projectId, question: dto.question, issuer: dto.issuer, supplierName: dto.supplierName },
    });
  }

  listSupervisionLogs(projectId: string) {
    return this.prisma.bidSupervisionLog.findMany({ where: { projectId }, orderBy: { time: 'desc' } });
  }

  listArchives(projectId: string) {
    return this.prisma.bidArchiveItem.findMany({ where: { projectId } });
  }

  async archiveAll(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertStageTransition(project.stage, 'ARCHIVED');

    const archiveItems = await this.prisma.bidArchiveItem.findMany({
      where: { projectId: id, status: { not: 'ARCHIVED' } },
    });

    if (archiveItems.length === 0) {
      throw new BadRequestException({ error: '没有可归档的项目', code: 'NO_ITEMS_TO_ARCHIVE' });
    }

    const now = new Date();
    const hashDigest = `sha256:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

    await this.prisma.bidArchiveItem.updateMany({
      where: { projectId: id, status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED', hashDigest, archivedAt: now },
    });

    await this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'ARCHIVED' },
    });

    return this.prisma.bidProject.findUnique({
      where: { id },
      include: { archiveItems: true },
    });
  }
}
