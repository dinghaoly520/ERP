import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';
import { StartOpeningDto } from './dto/start-opening.dto';
import { DecryptSupplierDto } from './dto/decrypt-supplier.dto';
import { assertBidStageTransition, type BidStage } from './bid-state';

@Injectable()
export class BidService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

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
      assertBidStageTransition(project.stage, dto.stage as BidStage);
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

  startOpening(projectId: string, dto?: StartOpeningDto) {
    return this.startOpeningInternal(projectId, dto);
  }

  async openSubmission(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'SUBMIT');

    return this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'SUBMIT' },
    });
  }

  private async startOpeningInternal(id: string, dto?: StartOpeningDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'OPENING');

    // Create opening session if DTO is provided
    if (dto) {
      await this.prisma.bidOpeningSession.create({
        data: {
          projectId: id,
          host: dto.host,
          supervisor: dto.supervisor,
          decryptWindowStart: new Date(dto.decryptWindowStart),
          decryptWindowEnd: new Date(dto.decryptWindowEnd),
          status: '待开标',
        },
      });
    }

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
    assertBidStageTransition(project.stage, 'EVALUATING');

    return this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'EVALUATING' },
    });
  }

  async decryptSupplier(projectId: string, supplierId: string, dto?: DecryptSupplierDto) {
    return this.prisma.$transaction(async (tx) => {
      const bidSupplier = await tx.bidSupplier.findFirst({
        where: { projectId, id: supplierId },
      });
      if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });

      // Phase 1: Decrypting
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { decryptStatus: 'RUNNING' },
      });

      // Phase 2: Success
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { decryptStatus: 'SUCCESS' },
      });

      // Phase 3: Create record (if DTO provided)
      if (dto) {
        await tx.bidOpeningRecord.create({
          data: {
            projectId,
            supplierName: bidSupplier.supplierName,
            amount: dto.amount,
            period: dto.period,
            qualityTarget: dto.qualityTarget,
            bondStatus: dto.bondStatus,
            decryptResult: '解密成功',
            confirmStatus: '待确认',
          },
        });
      }

      // Phase 4: Confirm
      return tx.bidSupplier.update({
        where: { id: supplierId },
        data: { confirmStatus: 'CONFIRMED' },
      });
    });
  }

  listOpeningRecords(projectId: string) {
    return this.prisma.bidOpeningRecord.findMany({ where: { projectId } });
  }

  listExperts(projectId: string) {
    return this.prisma.bidExpert.findMany({ where: { projectId }, include: { scoreRecords: true } });
  }

  async submitScore(projectId: string, dto: CreateScoreDto) {
    // 校验 expert 属于该项目
    const expert = await this.prisma.bidExpert.findFirst({
      where: { id: dto.expertId, projectId },
    });
    if (!expert) {
      throw new BadRequestException({ error: '该专家不属于此项目', code: 'EXPERT_NOT_IN_PROJECT' });
    }

    // 校验 scoreItem 属于该项目
    const scoreItem = await this.prisma.bidScoreItem.findFirst({
      where: { id: dto.scoreItemId, projectId },
    });
    if (!scoreItem) {
      throw new BadRequestException({ error: '评分项不属于此项目', code: 'SCORE_ITEM_NOT_IN_PROJECT' });
    }

    // 利用唯一约束 upsert：存在则更新，不存在则创建
    return this.prisma.bidScoreRecord.upsert({
      where: {
        expertId_scoreItemId_supplierId: {
          expertId: dto.expertId,
          scoreItemId: dto.scoreItemId,
          supplierId: dto.supplierId,
        },
      },
      update: { score: dto.score, reason: dto.reason },
      create: {
        expertId: dto.expertId,
        scoreItemId: dto.scoreItemId,
        supplierId: dto.supplierId,
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
    assertBidStageTransition(project.stage, 'ARCHIVED');

    const archiveItems = await this.prisma.bidArchiveItem.findMany({
      where: { projectId: id, status: { not: 'ARCHIVED' } },
    });

    if (archiveItems.length === 0) {
      throw new BadRequestException({ error: '没有可归档的项目', code: 'NO_ITEMS_TO_ARCHIVE' });
    }

    const now = new Date();
    const hashDigest = `sha256:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

    // 事务：归档项更新 + 项目状态变更 原子执行
    await this.prisma.$transaction([
      this.prisma.bidArchiveItem.updateMany({
        where: { projectId: id, status: { not: 'ARCHIVED' } },
        data: { status: 'ARCHIVED', hashDigest, archivedAt: now },
      }),
      this.prisma.bidProject.update({
        where: { id },
        data: { stage: 'ARCHIVED' },
      }),
    ]);

    return this.prisma.bidProject.findUnique({
      where: { id },
      include: { archiveItems: true },
    });
  }
}
