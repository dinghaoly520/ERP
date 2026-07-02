import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  NotFoundException,
  BadRequestException,
  Logger,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentParserService } from '../knowledge/services/document-parser.service';
import { RuleExtractorService } from './services/rule-extractor.service';
import { FieldExtractorService } from './services/field-extractor.service';
import { RuleExecutorService } from './services/rule-executor.service';
import { SemanticReviewerService } from './services/semantic-reviewer.service';
import { GeneralReviewerService } from './services/general-reviewer.service';
import { LlmFreeReviewerService } from './services/llm-free-reviewer.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { ExecuteReviewDto, ExtractRulesDto } from './dto/review.dto';
import { toStructuredSuggestion } from './services/text-operations';
import {
  addDocxCommentBuffer,
  modifyDocxBuffer,
} from './services/docx-generator';
import { pickManualCommentAnchor } from './services/review-utils';
import { ResolveIssueDto } from './dto/resolve-issue.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/rule.dto';
import { ReviewReport } from './services/report-generator.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewAllUserActivity } from '../auth/auth-scope';

@ApiTags('Tender Review')
@Controller('tender-review')
@UseGuards(AuthGuard)
export class TenderReviewController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenderReviewController.name);
  private readonly activeReviews = new Map<string, AbortController>();
  private zombieCleanupTimer: NodeJS.Timeout | null = null;

  async onModuleInit() {
    // On startup: resume interrupted extraction tasks + mark killed review tasks as failed
    try {
      await this.resumeInterruptedExtractions();
      await this.recoverInterruptedReviews();
    } catch (err) {
      this.logger.warn(
        `Failed to recover interrupted tasks on startup: ${err}`,
      );
    }
    // Periodic cleanup for stale tasks (30 min threshold)
    this.zombieCleanupTimer = setInterval(
      () => this.cleanZombies(),
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.zombieCleanupTimer) {
      clearInterval(this.zombieCleanupTimer);
      this.zombieCleanupTimer = null;
    }
  }

  private async resumeInterruptedExtractions() {
    // On startup, find any extraction tasks left in 'running' state
    // (caused by process restart/reload) and resume them
    const interrupted = await this.prisma.extractionTask.findMany({
      where: { status: 'running' },
    });
    for (const task of interrupted) {
      const kbId = task.knowledgeBaseId;
      if (!kbId) continue;
      const kb = await this.prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });
      if (kb) {
        this.logger.log(
          `Resuming interrupted extraction task ${task.id} for KB "${kb.name}" (${task.extractedCount ?? 0} rules already extracted)`,
        );
        this.runExtraction(task.id, kbId).catch(async (err) => {
          await this.prisma.extractionTask.update({
            where: { id: task.id },
            data: { status: 'failed', error: String(err).slice(0, 500) },
          });
        });
      } else {
        await this.prisma.extractionTask.update({
          where: { id: task.id },
          data: { status: 'failed', error: '关联知识库已删除' },
        });
      }
    }
    if (interrupted.length > 0) {
      this.logger.warn(
        `Resumed ${interrupted.length} interrupted extraction task(s)`,
      );
    }
  }

  private async recoverInterruptedReviews() {
    // On startup, mark any in-progress review tasks as failed.
    // They were killed by the process restart and cannot be resumed
    // (ReviewTask has no checkpoint mechanism).
    const interrupted = await this.prisma.reviewTask.findMany({
      where: { status: 'running' },
    });

    if (interrupted.length === 0) return;

    for (const task of interrupted) {
      await this.prisma.reviewTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          results: { error: '服务重启，审查任务中断，请重新提交' } as any,
        },
      });
    }

    this.logger.warn(
      `Marked ${interrupted.length} interrupted review task(s) as failed due to service restart`,
    );
  }

  private async cleanZombies() {
    // Review task zombies — mark as failed if older than 30 min
    const deadline = new Date(Date.now() - 30 * 60 * 1000);
    const zombies = await this.prisma.reviewTask.findMany({
      where: { status: 'running', createdAt: { lt: deadline } },
    });
    for (const task of zombies) {
      if (this.activeReviews.has(task.id)) continue;
      await this.prisma.reviewTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          results: { error: '审查任务超时（服务重启）' } as any,
        },
      });
    }
    if (zombies.length > 0) {
      this.logger.warn(`Recovered ${zombies.length} zombie review task(s)`);
    }

    // Extraction task zombies — mark as failed if older than 30 min
    const extractZombies = await this.prisma.extractionTask.findMany({
      where: { status: 'running', createdAt: { lt: deadline } },
    });
    for (const task of extractZombies) {
      await this.prisma.extractionTask.update({
        where: { id: task.id },
        data: { status: 'failed', error: '提取任务超时（服务重启）' },
      });
    }
    if (extractZombies.length > 0) {
      this.logger.warn(
        `Recovered ${extractZombies.length} zombie extraction task(s)`,
      );
    }
  }

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private parser: DocumentParserService,
    private ruleExtractor: RuleExtractorService,
    private fieldExtractor: FieldExtractorService,
    private ruleExecutor: RuleExecutorService,
    private semanticReviewer: SemanticReviewerService,
    private generalReviewer: GeneralReviewerService,
    private llmFreeReviewer: LlmFreeReviewerService,
    private reportGenerator: ReportGeneratorService,
  ) {}

  // ── Rule Management ──

  @Post('rules/extract')
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({
    summary:
      'AI-assisted rule extraction from knowledge base (async, admin only)',
  })
  async extractRules(@Body() dto: ExtractRulesDto) {
    const task = await this.prisma.extractionTask.create({
      data: {
        knowledgeBaseId: dto.knowledgeBaseId,
        status: 'running',
      },
    });

    this.runExtraction(task.id, dto.knowledgeBaseId).catch(async (err) => {
      await this.prisma.extractionTask.update({
        where: { id: task.id },
        data: { status: 'failed', error: String(err).slice(0, 500) },
      });
    });

    return { taskId: task.id, status: 'running' };
  }

  @Get('rules/extract/tasks/:taskId')
  @ApiOperation({ summary: 'Poll extraction task status' })
  async getExtractionTask(@Param('taskId') taskId: string) {
    const task = await this.prisma.extractionTask.findUnique({
      where: { id: taskId },
    });
    if (!task) throw new NotFoundException('Extraction task not found');
    return task;
  }

  @Get('rules/extract/active')
  @ApiOperation({ summary: 'Find active extraction task for a knowledge base' })
  async getActiveExtraction(@Query('knowledgeBaseId') knowledgeBaseId: string) {
    const task = await this.prisma.extractionTask.findFirst({
      where: { knowledgeBaseId, status: 'running' },
      orderBy: { createdAt: 'desc' },
    });
    return task ?? null;
  }

  @Post('rules')
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Create compliance rule (admin only)' })
  async createRule(@Body() dto: CreateRuleDto) {
    return this.prisma.complianceRule.create({ data: dto as any });
  }

  @Get('rules')
  @ApiOperation({ summary: 'List compliance rules' })
  async listRules(@Query('knowledgeBaseId') knowledgeBaseId?: string) {
    const where = knowledgeBaseId
      ? { knowledgeBaseId, isActive: true }
      : { isActive: true };
    return this.prisma.complianceRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Put('rules/:id')
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Update compliance rule (admin only)' })
  async updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
    return this.prisma.complianceRule.update({
      where: { id },
      data: dto as any,
    });
  }

  @Delete('rules/:id')
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Delete compliance rule (admin only)' })
  async deleteRule(@Param('id') id: string) {
    return this.prisma.complianceRule.delete({ where: { id } });
  }

  // ── Review Execution ──

  @Post('review/upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload tender document for review' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
          'text/plain',
        ];
        const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt'];
        const ext = file.originalname?.toLowerCase().slice(-5);
        if (
          allowedMimes.includes(file.mimetype) ||
          allowedExtensions.some((e) => ext?.endsWith(e))
        ) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException('仅支持 PDF、DOCX、DOC、TXT 格式文件'),
            false,
          );
        }
      },
    }),
  )
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传文件');
    }
    const fileName = file.originalname
      ? Buffer.from(file.originalname, 'latin1').toString('utf-8')
      : 'unknown';
    const content = await this.parser.parse(
      file.buffer,
      file.mimetype,
      fileName,
    );
    const objectKey = `review/${Date.now()}_${fileName}`;
    await this.storage.upload(objectKey, file.buffer, file.mimetype);

    return {
      documentName: fileName,
      objectKey,
      content,
      contentLength: content.length,
    };
  }

  @Post('review/execute')
  @ApiOperation({ summary: 'Execute compliance review' })
  async executeReview(
    @Body() dto: ExecuteReviewDto,
    @Body('documentContent') documentContent: string,
    @Body('documentName') documentName: string,
    @Body('objectKey') objectKey: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    // Validate knowledge base exists before creating the task
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: dto.knowledgeBaseId },
    });
    if (!kb) {
      throw new BadRequestException('所选知识库不存在，请刷新页面后重试');
    }

    const task = await this.prisma.reviewTask.create({
      data: {
        documentName: documentName ?? 'unknown',
        objectKey: objectKey ?? '',
        documentContent,
        knowledgeBaseId: dto.knowledgeBaseId,
        userId: user?.sub,
        reviewMode: dto.reviewMode,
        status: 'running',
      },
    });

    // Execute review asynchronously (fire and forget for now)
    const ac = new AbortController();
    this.activeReviews.set(task.id, ac);
    this.runReview(
      task.id,
      dto.knowledgeBaseId,
      documentContent,
      dto.reviewMode,
      ac.signal,
    )
      .catch(async (err) => {
        if (ac.signal.aborted) return;
        await this.prisma.reviewTask.update({
          where: { id: task.id },
          data: {
            status: 'failed',
            results: { error: this.sanitizeError(err) } as any,
          },
        });
      })
      .finally(() => this.activeReviews.delete(task.id));

    return { taskId: task.id, status: 'running' };
  }

  @Post('review/tasks/:id/stop')
  @ApiOperation({ summary: 'Stop a running review task' })
  async stopTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权操作此任务');
    }
    if (task.status !== 'running' && task.status !== 'pending') {
      throw new BadRequestException('Task is not running');
    }
    this.activeReviews.get(id)?.abort();
    return this.prisma.reviewTask.update({
      where: { id },
      data: { status: 'failed', results: { error: '用户手动停止' } as any },
    });
  }

  @Delete('review/tasks/:id')
  @ApiOperation({ summary: 'Delete review task' })
  async deleteTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权删除此任务');
    }
    await this.prisma.reviewTask.delete({ where: { id } });
    return { deleted: true };
  }

  @Get('review/stats/today')
  @ApiOperation({ summary: 'Get today\'s review stats for current user' })
  async getTodayStats(@CurrentUser() user: AuthenticatedUser | undefined) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const baseWhere: any = {
      createdAt: { gte: todayStart, lt: todayEnd },
    };

    // admin sees all; leader/staff only see their own
    if (!canViewAllUserActivity(user?.role as any)) {
      baseWhere.userId = user?.sub;
    }

    const [totalCount, completedAgg] = await Promise.all([
      this.prisma.reviewTask.count({ where: baseWhere }),
      this.prisma.reviewTask.aggregate({
        where: { ...baseWhere, status: 'completed' },
        _sum: { passedCount: true, failedCount: true, warningCount: true },
      }),
    ]);

    return {
      totalReviews: totalCount,
      passedCount: completedAgg._sum.passedCount ?? 0,
      failedCount: completedAgg._sum.failedCount ?? 0,
      warningCount: completedAgg._sum.warningCount ?? 0,
    };
  }

  @Get('review/tasks')
  @ApiOperation({ summary: 'List review tasks' })
  async listTasks(@CurrentUser() user: AuthenticatedUser | undefined) {
    // 管理员可以看到所有任务，普通用户只能看到自己的任务
    const where = canViewAllUserActivity(user?.role as any) ? {} : { userId: user?.sub };
    return this.prisma.reviewTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Get('review/tasks/:id')
  @ApiOperation({ summary: 'Get review task result' })
  async getTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权查看此任务');
    }
    return task;
  }

  @Patch('review/tasks/:id/issues/resolve')
  @ApiOperation({ summary: 'Accept or reject an issue suggestion' })
  async resolveIssue(
    @Param('id') id: string,
    @Body() dto: ResolveIssueDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (!task.results) throw new BadRequestException('Task has no results');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权操作此任务');
    }

    const report = task.results as any;
    let updated = false;
    let foundIssue: any = null;

    const findIssue = (
      list: any[],
      offset: number,
    ): { issue: any; localIdx: number } | null => {
      if (dto.issueIndex >= offset && dto.issueIndex < offset + list.length) {
        return {
          issue: list[dto.issueIndex - offset],
          localIdx: dto.issueIndex - offset,
        };
      }
      return null;
    };

    if (report.generalResults) {
      let idx = 0;
      for (const section of report.generalResults) {
        for (const issue of section.issues) {
          if (idx === dto.issueIndex) {
            foundIssue = issue;
            updated = true;
            break;
          }
          idx++;
        }
        if (updated) break;
      }
      // Also search llmFreeIssues (appended after generalResults in flattenReport)
      if (!updated && report.llmFreeIssues) {
        const llmFreeOffset = idx;
        const llmFreeList = report.llmFreeIssues;
        const localIdx = dto.issueIndex - llmFreeOffset;
        if (localIdx >= 0 && localIdx < llmFreeList.length) {
          foundIssue = llmFreeList[localIdx];
          updated = true;
        }
      }
    } else {
      const allIssues = [
        ...(report.criticalIssues || []),
        ...(report.warnings || []),
        ...(report.passedChecks || []),
        ...(report.llmFreeIssues || []),
      ];
      if (dto.issueIndex < allIssues.length) {
        foundIssue = allIssues[dto.issueIndex];
        updated = true;
      }
    }

    if (!updated || !foundIssue)
      throw new BadRequestException('Issue not found');

    const previousStatus = foundIssue.status;
    foundIssue.status = dto.action === 'accept' ? 'accepted' : 'rejected';
    if (dto.action === 'accept' && dto.editedSuggestion) {
      foundIssue.editedSuggestion = dto.editedSuggestion;
    }
    foundIssue.resolvedAt = new Date().toISOString();

    const updateData: any = { results: report };

    if (dto.action === 'accept') {
      const structured = toStructuredSuggestion(
        dto.editedSuggestion
          ? { description: dto.editedSuggestion, operation: 'manual' as const }
          : foundIssue.suggestion,
      );

      if (structured.operation === 'manual') {
        const commentText = structured.description.trim();
        if (commentText) {
          const anchorText = pickManualCommentAnchor(foundIssue);
          try {
            await this.applyManualCommentToFile(task, anchorText, commentText);
            foundIssue.modificationApplied = true;
          } catch (e) {
            this.logger.warn(
              `addComment failed for task ${id}: ${String(e).slice(0, 200)}`,
            );
          }
        }
      } else {
        try {
          await this.applyModificationToFile(task, structured);
          foundIssue.modificationApplied = true;
        } catch (e) {
          this.logger.warn(
            `modifyDocx failed for task ${id}: ${String(e).slice(0, 200)}`,
          );
        }
      }
    } else if (
      dto.action === 'reject' &&
      previousStatus === 'accepted' &&
      foundIssue.modificationApplied
    ) {
      // Revert: re-download original, re-apply all remaining accepted modifications
      try {
        await this.rebuildDocxFromAccepted(task, dto.issueIndex);
        foundIssue.modificationApplied = false;
      } catch (e) {
        this.logger.warn(
          `rebuildDocx failed for task ${id}: ${String(e).slice(0, 200)}`,
        );
      }
    }

    await this.prisma.reviewTask.update({
      where: { id },
      data: updateData,
    });

    return this.prisma.reviewTask.findUnique({ where: { id } });
  }

  private backupKey(task: any): string {
    return `${task.objectKey}.original`;
  }

  private async ensureOriginalBackup(task: any): Promise<void> {
    if (!task.objectKey) return;
    const bk = this.backupKey(task);
    try {
      await this.storage.download(bk);
      // backup already exists
    } catch {
      // backup doesn't exist yet — create it from current file
      const current = await this.storage.download(task.objectKey);
      await this.storage.upload(
        bk,
        current,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    }
  }

  private async applyModificationToFile(
    task: any,
    structured: any,
  ): Promise<void> {
    if (!task.objectKey) return;
    await this.ensureOriginalBackup(task);
    const originalBuffer = await this.storage.download(task.objectKey);
    const modified = await modifyDocxBuffer(
      originalBuffer,
      structured.originalText || '',
      structured.replacementText || '',
      structured.operation,
    );
    await this.storage.upload(
      task.objectKey,
      modified,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  }

  private async applyManualCommentToFile(
    task: any,
    anchorText: string | undefined,
    commentText: string,
  ): Promise<void> {
    if (!task.objectKey) return;
    await this.ensureOriginalBackup(task);
    const originalBuffer = await this.storage.download(task.objectKey);
    const modified = await addDocxCommentBuffer(
      originalBuffer,
      commentText,
      anchorText,
    );
    await this.storage.upload(
      task.objectKey,
      modified,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  }

  private async rebuildDocxFromAccepted(
    task: any,
    revertedIssueIndex: number,
  ): Promise<void> {
    if (!task.objectKey) return;

    const report = task.results;
    // Collect all accepted issues with modificationApplied, excluding the reverted one
    const acceptedIssues: { issue: any; index: number }[] = [];
    let idx = 0;
    const collectIssues = (issues: any[]) => {
      for (const issue of issues) {
        if (
          idx !== revertedIssueIndex &&
          issue.status === 'accepted' &&
          issue.modificationApplied
        ) {
          acceptedIssues.push({ issue, index: idx });
        }
        idx++;
      }
    };

    if (report.generalResults) {
      for (const section of report.generalResults) {
        collectIssues(section.issues);
      }
      collectIssues(report.llmFreeIssues || []);
    } else {
      collectIssues(report.criticalIssues || []);
      collectIssues(report.warnings || []);
      collectIssues(report.passedChecks || []);
      collectIssues(report.llmFreeIssues || []);
    }

    // Start from the original backup
    const bk = this.backupKey(task);
    let buffer: Buffer;
    try {
      buffer = await this.storage.download(bk);
    } catch {
      this.logger.warn(
        `Original backup not found for task ${task.id}, cannot revert`,
      );
      return;
    }

    // Re-apply all remaining accepted modifications
    for (const { issue } of acceptedIssues) {
      const structured = toStructuredSuggestion(
        issue.editedSuggestion
          ? {
              description: issue.editedSuggestion,
              operation: 'manual' as const,
            }
          : issue.suggestion,
      );

      if (structured.operation === 'manual') {
        const commentText = structured.description.trim();
        if (commentText) {
          const anchorText = pickManualCommentAnchor(issue);
          buffer = await addDocxCommentBuffer(buffer, commentText, anchorText);
        }
      } else {
        buffer = await modifyDocxBuffer(
          buffer,
          structured.originalText || '',
          structured.replacementText || '',
          structured.operation,
        );
      }
    }

    // Upload the rebuilt file
    await this.storage.upload(
      task.objectKey,
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    // If no accepted modifications remain, clean up the backup
    if (acceptedIssues.length === 0) {
      try {
        await this.storage.delete(bk);
      } catch {
        // ignore cleanup failure
      }
    }
  }

  // ── Download modified document ──

  @Get('review/tasks/:id/download')
  @ApiOperation({ summary: 'Download the modified document' })
  async downloadModifiedDocument(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res() res: Response,
  ) {
    try {
      const task = await this.prisma.reviewTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('Task not found');
      if (!task.objectKey) throw new BadRequestException('No document file');
      if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
        throw new ForbiddenException('无权下载此任务文档');
      }

      const buffer = await this.storage.download(task.objectKey);
      const fileName = task.documentName || 'document.docx';

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.send(buffer);
    } catch (err) {
      this.logger.error(`Download failed for task ${id}:`, err);
      throw err;
    }
  }

  // ── Internal Extraction Logic ──

  private async runExtraction(
    taskId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    // Load task to get processedFiles from previous run (for resume)
    const task = await this.prisma.extractionTask.findUnique({
      where: { id: taskId },
    });
    const skipFiles: string[] = Array.isArray((task as any)?.processedFiles)
      ? ((task as any).processedFiles as string[])
      : [];
    const processedFiles: string[] = [...skipFiles];

    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 5000;

    const count =
      await this.ruleExtractor.extractFromKnowledgeBase(
        knowledgeBaseId,
        {
          onProgress: async (extractedCount, fileName) => {
            const now = Date.now();
            if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
              lastProgressUpdate = now;
              if (!processedFiles.includes(fileName)) {
                processedFiles.push(fileName);
              }
              try {
                await this.prisma.extractionTask.update({
                  where: { id: taskId },
                  data: { extractedCount, processedFiles } as any,
                });
              } catch {
                // Progress update is best-effort
              }
            }
          },
        },
        skipFiles,
      );
    await this.prisma.extractionTask.update({
      where: { id: taskId },
      data: { status: 'completed', extractedCount: count },
    });
  }

  // ── Internal Review Logic ──

  private async runReview(
    taskId: string,
    knowledgeBaseId: string,
    documentContent: string,
    reviewMode: 'strict' | 'general',
    signal: AbortSignal,
  ): Promise<void> {
    // Path A: Knowledge-base review (existing logic)
    const kbReviewPromise =
      reviewMode === 'strict'
        ? this.runStrictReview(knowledgeBaseId, documentContent, signal)
        : this.runGeneralReview(knowledgeBaseId, documentContent, signal);

    // Path B: LLM-free review (no knowledge base dependency)
    const llmFreePromise = this.llmFreeReviewer
      .review(documentContent, signal)
      .catch((err) => {
        if (signal.aborted) throw err;
        this.logger.warn(
          `LLM-free review failed for task ${taskId}: ${String(err).slice(0, 200)}`,
        );
        return { results: [], totalSections: 0 }; // Non-critical: return empty on failure
      });

    // Execute both paths in parallel
    const [kbReport, llmFreeResult] = await Promise.all([
      kbReviewPromise,
      llmFreePromise,
    ]);

    if (signal.aborted) return;

    // Merge and deduplicate
    const mergedReport = this.reportGenerator.mergeWithLlmFreeResults(
      kbReport,
      llmFreeResult,
    );

    await this.reportGenerator.saveReport(taskId, mergedReport);
  }

  private async runStrictReview(
    knowledgeBaseId: string,
    documentContent: string,
    signal: AbortSignal,
  ): Promise<ReviewReport> {
    const allRules = await this.prisma.complianceRule.findMany({
      where: { knowledgeBaseId, isActive: true },
    });

    const numericRules = allRules.filter(
      (r: { ruleType: string }) => r.ruleType === 'numeric_compare',
    );
    const existenceRules = allRules.filter(
      (r: { ruleType: string }) => r.ruleType === 'existence_check',
    );
    const semanticRules = allRules.filter(
      (r: { ruleType: string }) => r.ruleType === 'semantic',
    );

    if (signal.aborted) throw new Error('aborted');
    const fields = await this.fieldExtractor.extract(documentContent, signal);

    if (signal.aborted) throw new Error('aborted');
    const numericResults = await this.ruleExecutor.executeNumericRules(
      numericRules as any,
      fields,
      documentContent,
    );
    const existenceResults = await this.ruleExecutor.executeExistenceRules(
      existenceRules as any,
      documentContent,
      fields,
    );

    if (signal.aborted) throw new Error('aborted');
    const semanticResults = await this.semanticReviewer.review(
      semanticRules as any,
      documentContent,
      knowledgeBaseId,
      signal,
    );

    const allResults = [
      ...numericResults,
      ...existenceResults,
      ...semanticResults,
    ];
    return this.reportGenerator.generateFromRuleResults(allResults);
  }

  private async runGeneralReview(
    knowledgeBaseId: string,
    documentContent: string,
    signal: AbortSignal,
  ): Promise<ReviewReport> {
    const { results, totalSections } = await this.generalReviewer.review(
      documentContent,
      knowledgeBaseId,
      signal,
    );
    return this.reportGenerator.generateFromGeneralResults(
      results,
      totalSections,
    );
  }

  private sanitizeError(err: unknown): string {
    const msg = String(err);
    return msg.split('\n')[0]?.slice(0, 100) || '未知错误';
  }
}
