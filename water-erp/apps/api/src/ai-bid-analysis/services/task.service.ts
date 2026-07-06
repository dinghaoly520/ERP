// apps/api/src/ai-bid-analysis/services/task.service.ts
// ★ per-item 适配（Phase 3.1）：AiBidder→AiBidderResult, AiBidTaskStatus→AiAnalysisTaskStatus
//   删 tender 文件管理（aiTenderFile 表已移除）+ bidder 上传管理（ERP bidderResult 来自解密投标文件）
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { AiAnalysisTaskStatus, AiBidderStatus } from '@prisma/client';
import { ALLOWED_START_ANALYSIS_STATUSES } from '../constants/status.constants';
import { LlmService } from '../../local-ai/llm.service';
import { PROMPT_VERSIONS } from '../prompts';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private prisma: PrismaService,
    // storage 保留：未来 worker 可能用于中间产物；当前 task CRUD 不直接用
    private storage: StorageService,
    private llm: LlmService,
  ) {}

  // ── Task CRUD（1:1 关联 BidProject）──

  async create(dto: CreateTaskDto, _userId: string) {
    return this.prisma.aiBidAnalysisTask.create({
      data: {
        projectId: dto.projectId,
        status: AiAnalysisTaskStatus.PENDING,
        aiProvenance: {
          model: this.llm.getModel(),
          ranAt: new Date().toISOString(),
          promptVersions: PROMPT_VERSIONS,
        },
      },
    });
  }

  async findAll(_userId: string, _isAdmin: boolean) {
    return this.prisma.aiBidAnalysisTask.findMany({
      include: {
        bidderResults: {
          select: {
            id: true,
            status: true,
            totalScore: true,
            bidSupplier: { select: { supplierName: true } },
          },
        },
        report: { select: { id: true, generatedAt: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { id },
      include: {
        bidderResults: true,
        report: true,
        project: { select: { id: true, name: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(id: string, dto: UpdateTaskDto) {
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: dto as any,
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.prisma.aiBidAnalysisTask.delete({ where: { id } });
  }

  async updateStatus(id: string, status: AiAnalysisTaskStatus) {
    const data: any = { status };
    if (
      status === AiAnalysisTaskStatus.COMPLETED ||
      status === AiAnalysisTaskStatus.COMPLETED_WITH_ERRORS
    ) {
      data.completedAt = new Date();
    }
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data,
    });
  }

  async updateTenderData(id: string, data: { text: string; pages: any[] }) {
    // ERP：tenderText 直接存 task（无独立 tender 文件表）
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: {
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

  async updateScoringCriteriaSnapshot(id: string, snapshot: any) {
    return this.prisma.aiBidAnalysisTask.update({
      where: { id },
      data: { scoringCriteriaSnapshot: snapshot },
    });
  }

  async getRequirements(id: string) {
    const task = await this.findOne(id);
    return task.requirements;
  }

  // ── 投标结果管理（AiBidderResult，来自解密 + worker 分析）──

  async updateBidderStatus(bidderId: string, status: AiBidderStatus) {
    const data: any = { status };
    if (status === AiBidderStatus.COMPLETED) {
      data.processedAt = new Date();
    }
    return this.prisma.aiBidderResult.update({
      where: { id: bidderId },
      data,
    });
  }

  async updateBidderScores(
    bidderId: string,
    data: {
      extractedInfo?: any;
      systemInfo?: any;
      keyInfo?: any;
      scoreItems?: any;
      categoryTotals?: any;
      totalScore: number;
      qualificationStatus?: string;
      riskLevel?: string;
      riskAnalysis?: any;
      strengths?: any;
      weaknesses?: any;
      overallComment?: string;
      deviationAnalysis?: any;
    },
  ) {
    return this.prisma.aiBidderResult.update({
      where: { id: bidderId },
      data,
    });
  }

  async deleteBidder(bidderId: string) {
    const bidder = await this.prisma.aiBidderResult.findUnique({
      where: { id: bidderId },
    });
    if (!bidder) throw new NotFoundException('Bidder not found');
    await this.prisma.aiBidderResult.delete({ where: { id: bidderId } });
  }

  async getBidders(taskId: string) {
    return this.prisma.aiBidderResult.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: { bidSupplier: { select: { supplierName: true } } },
    });
  }

  async getBidder(bidderId: string) {
    const bidder = await this.prisma.aiBidderResult.findUnique({
      where: { id: bidderId },
      include: {
        task: true,
        bidSupplier: { select: { supplierName: true } },
      },
    });
    if (!bidder) throw new NotFoundException('Bidder not found');
    return bidder;
  }

  async getAllPrices(taskId: string) {
    const bidders = await this.prisma.aiBidderResult.findMany({
      where: { taskId, keyInfo: { not: null as any } },
      select: {
        id: true,
        keyInfo: true,
        bidSupplier: { select: { supplierName: true } },
      },
    });
    return bidders
      .map((b) => ({
        bidderId: b.id,
        name: b.bidSupplier.supplierName,
        price: (b.keyInfo as any)?.quotePrice ?? null,
      }))
      .filter((b) => b.price !== null);
  }

  // ── 报告 ──

  async createReport(taskId: string) {
    return this.prisma.aiBidReport.create({ data: { taskId } });
  }

  async updateReport(taskId: string, data: any) {
    return this.prisma.aiBidReport.update({ where: { taskId }, data });
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
      return this.prisma.aiBidReport.update({ where: { taskId }, data });
    }
    return this.prisma.aiBidReport.create({ data: { taskId, ...data } });
  }

  /**
   * 乐观锁启动分析（ERP：检查 bidderResults 存在 + 投标单位已解密）
   * 替代 procurement 的 bidder.fileId 上传检查
   */
  async startAnalysisWithLock(taskId: string): Promise<{
    success: boolean;
    message: string;
    bidders: any[];
  }> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.aiBidAnalysisTask.findUnique({
        where: { id: taskId },
        include: {
          bidderResults: {
            include: {
              bidSupplier: { select: { supplierName: true, decryptStatus: true } },
            },
          },
        },
      });

      if (!task) {
        return { success: false, message: '任务不存在', bidders: [] };
      }

      if (!ALLOWED_START_ANALYSIS_STATUSES.includes(task.status as any)) {
        return {
          success: false,
          message: `当前任务状态 (${task.status}) 不允许启动分析`,
          bidders: [],
        };
      }

      const bidderResults = task.bidderResults;
      if (bidderResults.length === 0) {
        return {
          success: false,
          message: '暂无投标单位分析结果（需先解密投标文件并创建 bidderResult）',
          bidders: [],
        };
      }

      // ERP：检查投标单位已解密成功（替代 procurement 的 fileId 上传检查）
      const notReady = bidderResults.filter(
        (b) => b.bidSupplier.decryptStatus !== 'SUCCESS',
      );
      if (notReady.length > 0) {
        return {
          success: false,
          message: `以下投标单位未解密成功: ${notReady.map((b) => b.bidSupplier.supplierName).join(', ')}`,
          bidders: [],
        };
      }

      const updateResult = await tx.aiBidAnalysisTask.updateMany({
        where: { id: taskId, status: task.status },
        data: { status: AiAnalysisTaskStatus.ANALYZING },
      });

      if (updateResult.count === 0) {
        return {
          success: false,
          message: '任务状态已变更，请刷新后重试',
          bidders: [],
        };
      }

      this.logger.log(`Task ${taskId} analysis started successfully`);
      return { success: true, message: '分析启动成功', bidders: bidderResults };
    });
  }
}
