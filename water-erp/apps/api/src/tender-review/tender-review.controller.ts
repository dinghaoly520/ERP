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
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { normalizeMultipartFilename } from '../common/filename-encoding.util';
import { DocumentParserService } from '../knowledge/services/document-parser.service';
import { RuleExtractorService } from './services/rule-extractor.service';
import { FieldExtractorService } from './services/field-extractor.service';
import { RuleExecutorService } from './services/rule-executor.service';
import { SemanticReviewerService } from './services/semantic-reviewer.service';
import { GeneralReviewerService } from './services/general-reviewer.service';
import { LlmFreeReviewerService } from './services/llm-free-reviewer.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { ExecuteReviewDto, ExtractRulesDto, ProjectStatusDto } from './dto/review.dto';
import { computeDraftFingerprint } from './services/draft-fingerprint.util';
import { ReviewReportDocxService } from './services/review-report-docx.service';
import { toStructuredSuggestion } from './services/text-operations';
import {
  addDocxCommentBuffer,
  modifyDocxBuffer,
} from './services/docx-generator';
import { pickManualCommentAnchor } from './services/review-utils';
import { ResolveIssueDto } from './dto/resolve-issue.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/rule.dto';
import { ReviewReport } from './services/report-generator.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewAllUserActivity } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { createHash } from 'crypto';
import {
  assertReviewObjectKey,
  buildReviewSourceKey,
  isReviewObjectKey,
  resolveReviewSourceType,
  REVIEW_SOURCE_CATEGORY,
} from './review-source-file.util';

@ApiTags('Tender Review')
@Controller('tender-review')
export class TenderReviewController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenderReviewController.name);
  private readonly activeReviews = new Map<string, AbortController>();
  /** 提取任务在跑登记（2026-11-19）：cleanZombies 的 30min 误杀豁免——大库提取
   *  （数百页×多批 LLM 调用）可远超 30min，进程内确实在跑的不是僵尸 */
  private readonly activeExtractions = new Set<string>();
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
    // (caused by process restart/reload) and resume them.
    // 同库收敛 + 逐任务兜底（2026-11-19 审查 #7/#8）：
    //  - 同库多条 running（旧双跑竞态产物）只恢复最新一条，旧的落 failed——
    //    防恢复期再次双跑交错写重复规则；
    //  - 恢复链路任一环节失败即时把该行落 failed（不等 30min 僵尸清扫）——
    //    「running 无活跑者」会把该库提取闸 409 锁死到清扫窗口
    const interrupted = await this.prisma.extractionTask.findMany({
      where: { status: 'running' },
      orderBy: { createdAt: 'desc' }, // 新→旧：同库保留最新
    });
    const resumedKb = new Set<string>();
    for (const task of interrupted) {
      const kbId = task.knowledgeBaseId;
      if (!kbId) continue;
      if (resumedKb.has(kbId)) {
        await this.prisma.extractionTask
          .update({
            where: { id: task.id },
            data: { status: 'failed', error: '服务重启后检测到重复的提取任务，此条已自动结束' },
          })
          .catch(() => undefined);
        continue;
      }
      try {
        const kb = await this.prisma.knowledgeBase.findUnique({
          where: { id: kbId },
        });
        if (kb) {
          resumedKb.add(kbId);
          this.logger.log(
            `Resuming interrupted extraction task ${task.id} for KB "${kb.name}" (${task.extractedCount ?? 0} rules already extracted)`,
          );
          this.runExtraction(task.id, kbId).catch(async (err) => {
            await this.prisma.extractionTask
              .update({
                where: { id: task.id },
                data: { status: 'failed', error: String(err).slice(0, 500) },
              })
              .catch(() => undefined);
          });
        } else {
          await this.prisma.extractionTask.update({
            where: { id: task.id },
            data: { status: 'failed', error: '关联知识库已删除' },
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to resume extraction task ${task.id}: ${err}`);
        await this.prisma.extractionTask
          .update({
            where: { id: task.id },
            data: { status: 'failed', error: `服务重启后恢复提取任务失败：${String(err).slice(0, 400)}` },
          })
          .catch(() => undefined);
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

    // Extraction task zombies — mark as failed if older than 30 min,
    // 除非进程内仍在跑（2026-11-19：与审查任务同款 active 豁免，长任务不再被误杀）。
    // 6h 硬顶（审查 #8-B）：active 登记只证明「本进程启动过它」，不证明活着——
    // DB 无语句超时，挂死 await 永不落 finally 的任务会永久豁免 + 409 锁门；
    // 超硬顶强制落 failed 解锁（若其实仍在跑且最终完成，完成更新会写回 completed，
    // 可接受的终态竞态）
    const EXTRACTION_HARD_CAP_MS = 6 * 60 * 60 * 1000;
    const extractZombies = await this.prisma.extractionTask.findMany({
      where: { status: 'running', createdAt: { lt: deadline } },
    });
    for (const task of extractZombies) {
      if (
        this.activeExtractions.has(task.id) &&
        task.createdAt.getTime() > Date.now() - EXTRACTION_HARD_CAP_MS
      ) {
        continue; // 正常在跑的长任务
      }
      const hardCapped = this.activeExtractions.has(task.id);
      if (hardCapped) {
        this.logger.error(
          `Extraction task ${task.id} exceeded 6h hard cap while registered active — force-failing to release the KB gate`,
        );
      }
      await this.prisma.extractionTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          // 文案分流（复审）：超时结束与服务重启是两种不同情况，勿混写误导排障
          error: hardCapped
            ? '提取任务超过 6 小时未完成，已自动结束；若后台仍在执行，已提取的规则不受影响'
            : '提取任务超时（服务重启）',
        },
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
    private reviewReportDocx: ReviewReportDocxService,
  ) {}

  // 知识库属主校验（rules / execute 复用）
  private async assertKbVisible(kbId: string, user: AuthenticatedUser | undefined) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { ownerId: true, isShared: true },
    });
    if (!kb) throw new NotFoundException('知识库不存在');
    if (!user || (kb.ownerId !== user.sub && !kb.isShared && user.role !== 'admin'))
      throw new ForbiddenException('无权访问该知识库');
  }
  private async assertKbEditable(kbId: string, user: AuthenticatedUser | undefined) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { ownerId: true },
    });
    if (!kb) throw new NotFoundException('知识库不存在');
    if (!user || (kb.ownerId !== user.sub && user.role !== 'admin'))
      throw new ForbiddenException('无权维护该知识库（仅创建者或管理员）');
  }

  // Rule Management

  @Post('rules/extract')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({
    summary:
      'AI-assisted rule extraction from knowledge base (async)',
  })
  async extractRules(
    @Body() dto: ExtractRulesDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    await this.assertKbEditable(dto.knowledgeBaseId, user);
    // 并发闸（2026-11-19 审查 #7 事务化）：check+create 同事务，并对 KB 行 FOR
    //  UPDATE 互斥——两个并发 POST 在此排队，前者提交后后者必见 running 行 → 409，
    //  消除 check-then-create 竞态窗口（双跑的去重键在各自启动时快照，交错写库
    //  产生重复规则）。根治（部分唯一索引 (knowledge_base_id) WHERE
    //  status='running'）待迁移窗口，金仓走 db execute+resolve 流程。
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "KnowledgeBase" WHERE id = ${dto.knowledgeBaseId} FOR UPDATE`;
      const running = await tx.extractionTask.findFirst({
        where: { knowledgeBaseId: dto.knowledgeBaseId, status: 'running' },
      });
      if (running) {
        throw new ConflictException('该知识库已有正在进行的提取任务，请等待完成');
      }
      return tx.extractionTask.create({
        data: {
          knowledgeBaseId: dto.knowledgeBaseId,
          status: 'running',
        },
      });
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
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Poll extraction task status' })
  async getExtractionTask(@Param('taskId') taskId: string) {
    const task = await this.prisma.extractionTask.findUnique({
      where: { id: taskId },
    });
    if (!task) throw new NotFoundException('提取任务不存在或已被删除');
    return task;
  }

  @Get('rules/extract/active')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Find active extraction task for a knowledge base' })
  async getActiveExtraction(@Query('knowledgeBaseId') knowledgeBaseId: string) {
    const task = await this.prisma.extractionTask.findFirst({
      where: { knowledgeBaseId, status: 'running' },
      orderBy: { createdAt: 'desc' },
    });
    return task ?? null;
  }

  @Post('rules')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Create compliance rule' })
  async createRule(
    @Body() dto: CreateRuleDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    await this.assertKbEditable(dto.knowledgeBaseId, user);
    return this.prisma.complianceRule.create({
      // checkTarget 已砍（2026-11-19 用户裁定，登记性元数据零消费）；列 NOT NULL
      // 无默认（删列待安全 schema 窗口）——创建路径落库兜底，更新路径不动存量值
      data: { ...this.coerceRuleSeverity(dto), checkTarget: '全部' } as any,
    });
  }

  @Get('rules')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'List compliance rules' })
  async listRules(
    @Query('knowledgeBaseId') knowledgeBaseId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    let where;
    if (knowledgeBaseId) {
      await this.assertKbVisible(knowledgeBaseId, user);
      where = { knowledgeBaseId, isActive: true };
    } else {
      // 仅返回当前用户可见 KB（自己创建的 + 共享的；admin 全部）的规则
      // 域隔离（2026-11-03）：恒审查域——水叮当知识库的规则不出现在审查规则列表
      const visible = await this.prisma.knowledgeBase.findMany({
        where:
          user?.role === 'admin'
            ? { domain: 'tender_review' }
            : { domain: 'tender_review', OR: [{ ownerId: user?.sub }, { isShared: true }] },
        select: { id: true },
      });
      where = {
        knowledgeBaseId: { in: visible.map((k) => k.id) },
        isActive: true,
      };
    }
    return this.prisma.complianceRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Put('rules/:id')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Update compliance rule' })
  async updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateRuleDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const existing = await this.prisma.complianceRule.findUnique({
      where: { id },
      select: { knowledgeBaseId: true },
    });
    if (existing) await this.assertKbEditable(existing.knowledgeBaseId, user);
    return this.prisma.complianceRule.update({
      where: { id },
      data: this.coerceRuleSeverity(dto) as any,
    });
  }

  /** severity 宽进严出（2026-11-19 复审 #1）：DTO @IsIn 把存量漂移值（旧提取
   *  落库、无校验时期产物）的编辑保存整单 400——前端「漂移值追加为选项原样
   *  保留」的设计在保存路径走不通。与 normalizeRule 同口径：非法一律落
   *  'warning'（漂移值本就无法正确渲染/执行，归一即修复）。 */
  private coerceRuleSeverity<T extends { severity?: string }>(dto: T): T {
    if (
      dto.severity !== undefined &&
      !['critical', 'warning', 'info'].includes(dto.severity)
    ) {
      (dto as { severity?: string }).severity = 'warning';
    }
    return dto;
  }

  @Delete('rules/:id')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Delete compliance rule' })
  async deleteRule(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const existing = await this.prisma.complianceRule.findUnique({
      where: { id },
      select: { knowledgeBaseId: true },
    });
    if (existing) await this.assertKbEditable(existing.knowledgeBaseId, user);
    return this.prisma.complianceRule.delete({ where: { id } });
  }

  // Review Execution

  @Post('review/upload')
  @Roles('leader', 'admin', 'staff')
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
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('请上传文件');
    }
    // multipart 文件名 latin1 铁律（§五.4-2 评审追修：全库最后一处无条件版——同模块 review-utils 已换）
    const fileName = file.originalname
      ? normalizeMultipartFilename(file.originalname)
      : 'unknown';
    // 类型只认四种；声明 MIME 不在四种之内时按文件名后缀推断（审计第 3 处）
    const type = resolveReviewSourceType(file.mimetype, fileName);
    if (!type) {
      throw new BadRequestException({
        error: '仅支持 PDF、DOCX、DOC、TXT 格式文件',
        code: 'REVIEW_FILE_TYPE_INVALID',
      });
    }
    const content = await this.parser.parse(
      file.buffer,
      file.mimetype,
      fileName,
    );
    // 键由服务端生成、不含任何用户提供的字符；上传即登记为登录人名下的文件记录（审计第 3 处）
    const objectKey = assertReviewObjectKey(buildReviewSourceKey(type.ext));
    await this.storage.upload(objectKey, file.buffer, type.mime);
    let asset: { id: string };
    try {
      asset = await this.prisma.fileAsset.create({
        data: {
          key: objectKey,
          originalName: fileName,
          mimeType: type.mime,
          size: file.buffer.length,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          category: REVIEW_SOURCE_CATEGORY,
          uploaderId: user?.sub,
        },
      });
    } catch (err) {
      // 登记失败就不留孤儿对象
      await this.storage.delete(objectKey).catch(() => undefined);
      throw err;
    }

    // 只把记录 id 交给客户端：对象键不再出现在任何响应里
    return {
      fileId: asset.id,
      documentName: fileName,
      content,
      contentLength: content.length,
    };
  }

  /** 按上传记录 id 解析审查用的文件：只认本人上传（admin 例外）的审查源文件记录，键必须落在审查命名空间内 */
  private async resolveReviewSourceFile(
    fileId: string | undefined,
    user: AuthenticatedUser | undefined,
  ): Promise<string> {
    if (!fileId) return '';
    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: fileId },
      select: { key: true, category: true, uploaderId: true },
    });
    // 不存在、类目不对、键越界三种情况同一口径——不泄露别的资产是否存在
    if (!asset || asset.category !== REVIEW_SOURCE_CATEGORY || !isReviewObjectKey(asset.key)) {
      throw new BadRequestException({ error: '上传记录无效，请重新上传文件', code: 'REVIEW_FILE_INVALID' });
    }
    if (asset.uploaderId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException({ error: '无权使用该上传文件', code: 'REVIEW_FILE_FORBIDDEN' });
    }
    return asset.key;
  }

  @Post('review/execute')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Execute compliance review' })
  async executeReview(
    @Body() dto: ExecuteReviewDto,
    @Body('documentContent') documentContent: string,
    @Body('documentName') documentName: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    // Validate knowledge base exists before creating the task
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: dto.knowledgeBaseId },
    });
    if (!kb) {
      throw new BadRequestException('所选知识库不存在，请刷新页面后重试');
    }
    // 可见性：创建者 或 共享 或 admin（跑审查属于「使用」）
    if (!user || (kb.ownerId !== user.sub && !kb.isShared && user.role !== 'admin')) {
      throw new ForbiddenException('无权使用该知识库');
    }

    // 项目关联（spec §6.2）：软关联不建外键，仅校验存在
    if (dto.projectId) {
      const project = await this.prisma.projectManagementItem.findUnique({
        where: { id: dto.projectId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('项目不存在');
    }

    // 文件只经上传记录 id 引用（审计第 3 处）：不带即纯文本审查
    const sourceKey = await this.resolveReviewSourceFile(dto.fileId, user);

    const task = await this.prisma.reviewTask.create({
      data: {
        documentName: documentName ?? 'unknown',
        objectKey: sourceKey,
        documentContent,
        knowledgeBaseId: dto.knowledgeBaseId,
        userId: user?.sub,
        reviewMode: dto.reviewMode,
        status: 'running',
        projectId: dto.projectId ?? null,
        draftFingerprint: dto.fingerprint ?? null,
      },
    });

    // 自动记忆默认知识库（spec §2 裁定 3）——仅项目场景，失败不阻塞审查
    if (dto.projectId && user?.sub) {
      await this.prisma.userSettings
        .upsert({
          where: { userId: user.sub },
          create: { userId: user.sub, theme: 'light', defaultReviewKbId: dto.knowledgeBaseId },
          update: { defaultReviewKbId: dto.knowledgeBaseId },
        })
        .catch(() => undefined);
    }

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

  @Post('review/project-status')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: '项目管理场景：判定该项目草稿的审查状态' })
  async projectStatus(@Body() dto: ProjectStatusDto) {
    const fingerprint = computeDraftFingerprint(dto.documentType, dto.answers);
    const latest = await this.prisma.reviewTask.findFirst({
      where: { projectId: dto.projectId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) return { fingerprint, state: 'none' as const };
    if (latest.status === 'pending' || latest.status === 'running') {
      return { fingerprint, state: 'running' as const, task: latest };
    }
    if (latest.status === 'completed' && latest.draftFingerprint === fingerprint) {
      return { fingerprint, state: 'matching' as const, task: latest };
    }
    // completed 但指纹不符，或最新为 failed——task 照常携带，前端按 task.status 细分（spec §6.1）
    return { fingerprint, state: 'stale' as const, task: latest };
  }

  @Post('review/tasks/:id/stop')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Stop a running review task' })
  async stopTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在或已被删除');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权操作此任务');
    }
    if (task.status !== 'running' && task.status !== 'pending') {
      throw new BadRequestException('任务不在运行中，无法执行该操作');
    }
    this.activeReviews.get(id)?.abort();
    return this.prisma.reviewTask.update({
      where: { id },
      data: { status: 'failed', results: { error: '用户手动停止' } as any },
    });
  }

  @Delete('review/tasks/:id')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Delete review task' })
  async deleteTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在或已被删除');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权删除此任务');
    }
    await this.prisma.reviewTask.delete({ where: { id } });
    if (task.objectKey) await this.removeReviewSourceFileIfUnreferenced(task.id, task.objectKey);
    return { deleted: true };
  }

  /**
   * 删除任务后清理它的源文件（2026-11-26）：同一份上传已没有任何任务在用，才删对象、备份与文件记录。
   * - 只清理登记过的审查源文件。键不在审查命名空间内，或者这个键名下没有审查源文件记录：存储一律不碰——
   *   存量任务的键是修复前写进去的，那时任何内部角色都能写，不能据它去删对象；
   * - 对象没删掉：保留文件记录，事后还能按记录找到这个对象。
   * 清理的任何失败都不影响「任务已删除」。
   */
  private async removeReviewSourceFileIfUnreferenced(taskId: string, objectKey: string): Promise<void> {
    const warn = (what: string, err?: unknown) =>
      this.logger.warn(`删除任务 ${taskId}：${what}${err === undefined ? '' : `（${String(err).slice(0, 200)}）`}`);
    let key: string;
    try {
      key = this.reviewFileKey({ objectKey });
    } catch {
      warn('文件键不在审查命名空间内，不清理存储');
      return;
    }
    let assetId: string;
    try {
      const asset = await this.prisma.fileAsset.findUnique({ where: { key }, select: { id: true, category: true } });
      if (asset?.category !== REVIEW_SOURCE_CATEGORY) {
        warn(asset ? '同键的文件记录不是审查源文件，不清理存储' : '文件没有审查源文件记录（存量对象），不清理存储');
        return;
      }
      assetId = asset.id;
    } catch (err) {
      warn('查不到文件记录，不清理存储', err);
      return;
    }
    // 必须在任务行删掉之后数：否则会把这个任务自己数进去
    let stillUsed: number;
    try {
      stillUsed = await this.prisma.reviewTask.count({ where: { objectKey } });
    } catch (err) {
      warn('统计引用失败，不清理存储', err);
      return;
    }
    if (stillUsed > 0) return;

    // 两个对象各删各的：备份删不掉（比如本就没有）不连累主对象与文件记录
    const [main, backup] = await Promise.allSettled([this.storage.delete(key), this.storage.delete(`${key}.original`)]);
    if (main.status === 'rejected') {
      warn('审查源文件没删掉，保留文件记录', main.reason);
      return;
    }
    if (backup.status === 'rejected') warn('原始备份没删掉', backup.reason);
    await this.prisma.fileAsset
      .deleteMany({ where: { id: assetId, category: REVIEW_SOURCE_CATEGORY } })
      .catch((err) => warn('审查源文件已删，但文件记录没删掉', err));
  }

  @Get('review/stats/today')
  @Roles('leader', 'admin', 'staff')
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
  @Roles('leader', 'admin', 'staff')
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
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Get review task result' })
  async getTask(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在或已被删除');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权查看此任务');
    }
    return task;
  }

  @Patch('review/tasks/:id/issues/resolve')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Accept or reject an issue suggestion' })
  async resolveIssue(
    @Param('id') id: string,
    @Body() dto: ResolveIssueDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在或已被删除');
    if (!task.results) throw new BadRequestException('任务暂无结果');
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
      throw new BadRequestException('问题记录不存在或已被删除');

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

  /** 任务的文件键：取出来之前先过审查命名空间守卫——存量任务或旧入口写进来的越界键在这里被拒 */
  private reviewFileKey(task: { objectKey: string }): string {
    return assertReviewObjectKey(task.objectKey);
  }

  private backupKey(task: { objectKey: string }): string {
    return `${this.reviewFileKey(task)}.original`;
  }

  private async ensureOriginalBackup(task: any): Promise<void> {
    if (!task.objectKey) return;
    const key = this.reviewFileKey(task);
    const bk = this.backupKey(task);
    try {
      await this.storage.download(bk);
      // backup already exists
    } catch {
      // backup doesn't exist yet — create it from current file
      const current = await this.storage.download(key);
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
    const key = this.reviewFileKey(task);
    await this.ensureOriginalBackup(task);
    const originalBuffer = await this.storage.download(key);
    const modified = await modifyDocxBuffer(
      originalBuffer,
      structured.originalText || '',
      structured.replacementText || '',
      structured.operation,
    );
    await this.storage.upload(
      key,
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
    const key = this.reviewFileKey(task);
    await this.ensureOriginalBackup(task);
    const originalBuffer = await this.storage.download(key);
    const modified = await addDocxCommentBuffer(
      originalBuffer,
      commentText,
      anchorText,
    );
    await this.storage.upload(
      key,
      modified,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  }

  private async rebuildDocxFromAccepted(
    task: any,
    revertedIssueIndex: number,
  ): Promise<void> {
    if (!task.objectKey) return;
    const key = this.reviewFileKey(task);

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
      key,
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

  // Download modified document

  @Get('review/tasks/:id/download')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: 'Download the modified document' })
  async downloadModifiedDocument(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res() res: Response,
  ) {
    try {
      const task = await this.prisma.reviewTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('任务不存在或已被删除');
      if (!task.objectKey) throw new BadRequestException('任务未关联文档文件');
      const key = this.reviewFileKey(task);
      if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
        throw new ForbiddenException('无权下载此任务文档');
      }

      const buffer = await this.storage.download(key);
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

  @Get('review/tasks/:id/report.docx')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: '下载审查报告 Word（含处置留痕）' })
  async downloadReportDocx(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res() res: Response,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在或已被删除');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权下载该审查报告');
    }
    if (task.status !== 'completed') {
      throw new BadRequestException('任务未完成，暂无报告');
    }
    const [kb, project] = await Promise.all([
      task.knowledgeBaseId
        ? this.prisma.knowledgeBase.findUnique({ where: { id: task.knowledgeBaseId }, select: { name: true } })
        : Promise.resolve(null),
      task.projectId
        ? this.prisma.projectManagementItem.findUnique({ where: { id: task.projectId }, select: { title: true } })
        : Promise.resolve(null),
    ]);
    const { buffer, fileName } = await this.reviewReportDocx.generate(task, {
      kbName: kb?.name ?? null,
      projectTitle: project?.title ?? null,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  }

  // Internal Extraction Logic

  private async runExtraction(
    taskId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    // 在跑登记（同步先行，2026-11-19）：zombie 豁免从调用即刻生效，
    // 避免启动恢复窗口内的首轮清扫误杀；结束（含异常）注销
    this.activeExtractions.add(taskId);
    try {
      // Load task to get processedFiles from previous run (for resume)
      const task = await this.prisma.extractionTask.findUnique({
        where: { id: taskId },
      });
      const skipFiles: string[] = Array.isArray((task as any).processedFiles)
        ? ((task as any).processedFiles as string[])
        : [];
      const processedFiles: string[] = [...skipFiles];
      // 累计语义（2026-11-19 审查 #10）：断点续跑的本进程增量叠加恢复时已有计数——
      // 旧实现整字段覆写，前端进度条可见「10→1」倒退、完成 toast 少计
      const baseCount: number = (task as any)?.extractedCount ?? 0;

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
                  // status:'running' 守卫（终态写回防复活，见下方完成写说明）
                  await this.prisma.extractionTask.updateMany({
                    where: { id: taskId, status: 'running' },
                    data: {
                      extractedCount: baseCount + extractedCount,
                      processedFiles,
                    } as any,
                  });
                } catch {
                  // Progress update is best-effort
                }
              }
            },
          },
          skipFiles,
        );
      // 完成写回带 status:'running' 守卫（updateMany 条件写，2026-11-19 复审）：
      // 6h 硬顶/僵尸清扫已把本行落 failed、闸门重开后，迟到的完成写不得把
      // failed 复活成 completed（复活会误导留档，且掩盖「已放行新任务」事实）
      await this.prisma.extractionTask.updateMany({
        where: { id: taskId, status: 'running' },
        data: { status: 'completed', extractedCount: baseCount + count },
      });
    } finally {
      this.activeExtractions.delete(taskId);
    }
  }
  // Internal Review Logic

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
    // 提取字段随报告落库（2026-11-19 透明化）：供报告页/docx 展示，缺什么一目了然
    return this.reportGenerator.generateFromRuleResults(allResults, fields);
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
