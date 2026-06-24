// apps/api/src/ai-bid-analysis/services/task.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { AiBidTaskStatus, AiBidderStatus } from '@prisma/client';
import { ALLOWED_START_ANALYSIS_STATUSES } from '../constants/status.constants';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async create(dto: CreateTaskDto, userId: string) {
    return this.prisma.aiBidAnalysisTask.create({
      data: {
        projectId: dto.projectId,
        name: dto.name,
        projectName: dto.projectName,
        createdBy: userId,
        status: AiBidTaskStatus.CREATED,
      },
    });
  }

  async findAll(userId: string, isAdmin: boolean) {
    const where = isAdmin ? {} : { createdBy: userId };
    return this.prisma.aiBidAnalysisTask.findMany({
      where,
      include: {
        bidders: { select: { id: true, name: true, status: true, totalScore: true } },
        report: { select: { id: true, generatedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { id },
      include: {
        bidders: true,
        report: true,
        tenderFiles: { orderBy: [{ isMain: 'desc' }, { order: 'asc' }] },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(id: string, dto: UpdateTaskDto) {
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    const task = await this.findOne(id);

    // 删除所有招标文件（主文件和补充文件）
    for (const tenderFile of task.tenderFiles || []) {
      try {
        await this.storage.delete(tenderFile.fileId);
      } catch (e) {
        this.logger.warn(`Failed to delete tender file: ${e}`);
      }
    }

    // 删除旧的单文件字段对应的存储
    if (task.tenderFileId) {
      try {
        await this.storage.delete(task.tenderFileId);
      } catch (e) {
        this.logger.warn(`Failed to delete old tender file: ${e}`);
      }
    }

    for (const bidder of task.bidders) {
      if (bidder.fileId) {
        try {
          await this.storage.delete(bidder.fileId);
        } catch (e) {
          this.logger.warn(`Failed to delete bidder file: ${e}`);
        }
      }
    }

    await this.prisma.aiBidAnalysisTask.delete({ where: { id } });
  }

  async updateStatus(id: string, status: AiBidTaskStatus) {
    const data: any = { status };
    if (status === AiBidTaskStatus.COMPLETED) {
      data.completedAt = new Date();
    }
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data,
    });
  }

  async updateTenderFile(
    id: string,
    data: { fileId: string; fileName: string },
  ) {
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: {
        tenderFileId: data.fileId,
        tenderFileName: data.fileName,
        status: AiBidTaskStatus.TENDER_UPLOADING,
      },
    });
  }

  async updateTenderData(
    id: string,
    data: {
      fileId: string;
      fileName: string;
      text: string;
      pages: any[];
    },
  ) {
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: {
        tenderFileId: data.fileId,
        tenderFileName: data.fileName,
        tenderText: data.text,
        tenderPages: data.pages,
      },
    });
  }

  async updateRequirements(id: string, requirements: any) {
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: { requirements },
    });
  }

  async clearTenderFile(id: string) {
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: {
        tenderFileId: null,
        tenderFileName: null,
        tenderText: null,
        tenderPages: undefined,
        requirements: undefined,
        status: AiBidTaskStatus.CREATED,
      },
    });
  }

  // ── Tender Files (多文件支持) ──

  async addTenderFile(
    taskId: string,
    data: { fileId: string; fileName: string; isMain?: boolean },
  ) {
    // 检查是否已有主文件
    const existingMain = await this.prisma.aiTenderFile.findFirst({
      where: { taskId, isMain: true },
    });

    // 如果没有主文件，则设为主文件
    const isMain = data.isMain ?? !existingMain;

    // 获取当前最大 order
    const maxOrder = await this.prisma.aiTenderFile.findFirst({
      where: { taskId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const tenderFile = await this.prisma.aiTenderFile.create({
      data: {
        taskId,
        fileId: data.fileId,
        fileName: data.fileName,
        isMain,
        order: (maxOrder?.order ?? -1) + 1,
      },
    });

    // 更新任务状态
    await this.prisma.aiBidAnalysisTask.update({
      where: { id: taskId },
      data: { status: AiBidTaskStatus.TENDER_UPLOADING },
    });

    return tenderFile;
  }

  async updateTenderFileText(
    tenderFileId: string,
    data: { text: string; pages: any[] },
  ) {
    return this.prisma.aiTenderFile.update({
      where: { id: tenderFileId },
      data: {
        text: data.text,
        pages: data.pages,
      },
    });
  }

  async getTenderFiles(taskId: string) {
    return this.prisma.aiTenderFile.findMany({
      where: { taskId },
      orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
    });
  }

  async getTenderFile(tenderFileId: string) {
    const tenderFile = await this.prisma.aiTenderFile.findUnique({
      where: { id: tenderFileId },
    });
    if (!tenderFile) throw new NotFoundException('Tender file not found');
    return tenderFile;
  }

  async deleteTenderFile(tenderFileId: string) {
    const tenderFile = await this.getTenderFile(tenderFileId);

    // 删除存储中的文件
    try {
      await this.storage.delete(tenderFile.fileId);
    } catch (e) {
      this.logger.warn(`Failed to delete tender file from storage: ${e}`);
    }

    // 如果删除的是主文件，需要指定新的主文件
    if (tenderFile.isMain) {
      const nextFile = await this.prisma.aiTenderFile.findFirst({
        where: { taskId: tenderFile.taskId, id: { not: tenderFileId } },
        orderBy: { order: 'asc' },
      });

      if (nextFile) {
        await this.prisma.aiTenderFile.update({
          where: { id: nextFile.id },
          data: { isMain: true },
        });
      }
    }

    await this.prisma.aiTenderFile.delete({ where: { id: tenderFileId } });

    return { success: true };
  }

  async setMainTenderFile(tenderFileId: string) {
    const tenderFile = await this.getTenderFile(tenderFileId);

    // 取消当前主文件
    await this.prisma.aiTenderFile.updateMany({
      where: { taskId: tenderFile.taskId, isMain: true },
      data: { isMain: false },
    });

    // 设置新的主文件
    return this.prisma.aiTenderFile.update({
      where: { id: tenderFileId },
      data: { isMain: true },
    });
  }

  async getRequirements(id: string) {
    const task = await this.findOne(id);
    return task.requirements;
  }

  async addBidder(taskId: string, name: string) {
    return this.prisma.aiBidder.create({
      data: {
        taskId,
        name,
        status: AiBidderStatus.PENDING,
      },
    });
  }

  async updateBidderFile(
    bidderId: string,
    data: { fileId: string; fileName: string },
  ) {
    return this.prisma.aiBidder.update({
      where: { id: bidderId },
      data: {
        fileId: data.fileId,
        fileName: data.fileName,
      },
    });
  }

  async updateBidderName(bidderId: string, name: string) {
    const bidder = await this.prisma.aiBidder.findUnique({
      where: { id: bidderId },
    });
    if (!bidder) throw new NotFoundException('Bidder not found');
    return this.prisma.aiBidder.update({
      where: { id: bidderId },
      data: { name },
    });
  }

  async updateBidderText(
    bidderId: string,
    data: { text: string; pages: any[] },
  ) {
    return this.prisma.aiBidder.update({
      where: { id: bidderId },
      data: {
        text: data.text,
        pages: data.pages,
      },
    });
  }

  async updateBidderStatus(bidderId: string, status: AiBidderStatus) {
    const data: any = { status };
    if (status === AiBidderStatus.COMPLETED) {
      data.processedAt = new Date();
    }
    return this.prisma.aiBidder.update({
      where: { id: bidderId },
      data,
    });
  }

  async updateBidderScores(
    bidderId: string,
    data: {
      extractedInfo: any;
      keyInfo: any;
      scores: any;
      totalScore: number;
      qualificationStatus: string;
      riskLevel: string;
      riskAnalysis: any;
      strengths: string[];
      weaknesses: string[];
      overallComment: string;
      deviationAnalysis: any;
    },
  ) {
    return this.prisma.aiBidder.update({
      where: { id: bidderId },
      data: {
        extractedInfo: data.extractedInfo,
        keyInfo: data.keyInfo,
        scores: data.scores,
        totalScore: data.totalScore,
        qualificationStatus: data.qualificationStatus,
        riskLevel: data.riskLevel,
        riskAnalysis: data.riskAnalysis,
        strengths: data.strengths,
        weaknesses: data.weaknesses,
        overallComment: data.overallComment,
        deviationAnalysis: data.deviationAnalysis,
      },
    });
  }

  async deleteBidder(bidderId: string) {
    const bidder = await this.prisma.aiBidder.findUnique({
      where: { id: bidderId },
    });
    if (!bidder) throw new NotFoundException('Bidder not found');

    if (bidder.fileId) {
      try {
        await this.storage.delete(bidder.fileId);
      } catch (e) {
        this.logger.warn(`Failed to delete bidder file: ${e}`);
      }
    }

    await this.prisma.aiBidder.delete({ where: { id: bidderId } });
  }

  async getBidders(taskId: string) {
    return this.prisma.aiBidder.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getBidder(bidderId: string) {
    const bidder = await this.prisma.aiBidder.findUnique({
      where: { id: bidderId },
      include: { task: true },
    });
    if (!bidder) throw new NotFoundException('Bidder not found');
    return bidder;
  }

  async getAllPrices(taskId: string) {
    const bidders = await this.prisma.aiBidder.findMany({
      where: { taskId, keyInfo: { not: null as any } },
      select: { id: true, name: true, keyInfo: true },
    });
    return bidders
      .map((b) => ({
        bidderId: b.id,
        name: b.name,
        price: (b.keyInfo as any)?.quotePrice ?? null,
      }))
      .filter((b) => b.price !== null);
  }

  async createReport(taskId: string) {
    return this.prisma.aiBidReport.create({
      data: { taskId },
    });
  }

  async updateReport(taskId: string, data: any) {
    return this.prisma.aiBidReport.update({
      where: { taskId },
      data,
    });
  }

  async getReport(taskId: string) {
    const report = await this.prisma.aiBidReport.findUnique({
      where: { taskId },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async createOrUpdateReport(taskId: string, data: any) {
    const existing = await this.prisma.aiBidReport.findUnique({
      where: { taskId },
    });

    if (existing) {
      return this.prisma.aiBidReport.update({
        where: { taskId },
        data,
      });
    }

    return this.prisma.aiBidReport.create({
      data: { taskId, ...data },
    });
  }

  /**
   * 使用乐观锁启动分析，防止竞态条件
   * 在事务中检查状态并更新，确保原子性
   */
  async startAnalysisWithLock(taskId: string): Promise<{
    success: boolean;
    message: string;
    bidders: any[];
  }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. 获取任务当前状态
      const task = await tx.aiBidAnalysisTask.findUnique({
        where: { id: taskId },
        include: { bidders: true },
      });

      if (!task) {
        return { success: false, message: '任务不存在', bidders: [] };
      }

      // 2. 检查状态是否允许启动（使用乐观锁）
      if (!ALLOWED_START_ANALYSIS_STATUSES.includes(task.status as any)) {
        return {
          success: false,
          message: `当前任务状态 (${task.status}) 不允许启动分析`,
          bidders: [],
        };
      }

      // 3. 验证投标单位
      const bidders = task.bidders;
      if (bidders.length === 0) {
        return { success: false, message: '请先添加投标单位', bidders: [] };
      }

      const biddersWithoutFile = bidders.filter(b => !b.fileId);
      if (biddersWithoutFile.length > 0) {
        return {
          success: false,
          message: `以下投标单位未上传文件: ${biddersWithoutFile.map(b => b.name).join(', ')}`,
          bidders: [],
        };
      }

      // 4. 在事务中更新状态（乐观锁：只有状态匹配时才更新）
      const updateResult = await tx.aiBidAnalysisTask.updateMany({
        where: {
          id: taskId,
          status: task.status, // 乐观锁：状态必须匹配
        },
        data: {
          status: AiBidTaskStatus.ANALYZING,
        },
      });

      // 5. 如果更新失败（被其他请求抢先），返回错误
      if (updateResult.count === 0) {
        return {
          success: false,
          message: '任务状态已变更，请刷新后重试',
          bidders: [],
        };
      }

      this.logger.log(`Task ${taskId} analysis started successfully`);

      return {
        success: true,
        message: '分析启动成功',
        bidders,
      };
    });
  }
}
