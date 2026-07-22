import { Injectable, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';
import { ReplyClarificationDto } from './dto/reply-clarification.dto';
import { StartOpeningDto } from './dto/start-opening.dto';
import { DecryptSupplierDto } from './dto/decrypt-supplier.dto';
import { CreateScoreItemDto } from './dto/create-score-item.dto';
import { UpdateScoreItemDto } from './dto/update-score-item.dto';
import { CreateScorePointDto } from './dto/create-score-point.dto';
import { UpdateScorePointDto } from './dto/update-score-point.dto';
import { BatchCreateScorePointsDto } from './dto/batch-create-score-points.dto';
import { CreateOpeningRecordDto } from './dto/create-opening-record.dto';
import { UpsertSupervisionAnnotationDto } from './dto/upsert-supervision-annotation.dto';
import { assertBidStageTransition, type BidStage } from './bid-state';
import { computeArchiveChain, genesisHash as archiveGenesisHash } from './bid-archive.digest';
import { decryptBuffer, streamToBuffer, verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';
import { unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { checkScoreAnomaly, type ScoreRecordInput } from '../expert/expert-deviation';
import { Prisma, ScoreCategory } from '@prisma/client';
import { isBondQualified } from './bid-bond-status';
import { recomputeExpertProgress, recomputeItemFromDecisions } from './score-recalculate.helper';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { buildArchiveAiUsage } from '../ai-bid-analysis/utils/archive-ai-usage';
import { ClarificationAiService } from './clarification-ai.service';
import { ScoreStandardValidator } from './score-standard-validator.service';

@Injectable()
export class BidService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private readonly scoreStandardValidator: ScoreStandardValidator,
    @Optional() private readonly clarificationAi?: ClarificationAiService,
    @Optional() private readonly gateway?: BidGateway,
    @Optional()
    @InjectQueue(QUEUE_NAMES.TENDER_PROCESSING)
    private readonly tenderQueue?: Queue,
  ) {}

  private readonly logger = new Logger(BidService.name);

  /** 生成评标结果时默认标记为候选人（recommended）的名次数 */
  private readonly DEFAULT_WINNER_COUNT = 3;

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
      recentLogs,
    };
  }

  listProjects(stages?: string[]) {
    const where = stages && stages.length > 0
      ? { stage: { in: stages as BidStage[] } }
      : {};

    // 当按阶段筛选时返回精简字段（用于搜索选择器）
    // 无筛选时返回完整字段（用于归档/仪表盘等向后兼容）
    if (stages && stages.length > 0) {
      return this.prisma.bidProject.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          projectCode: true,
          name: true,
          stage: true,
        },
      });
    }

    return this.prisma.bidProject.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { suppliers: true } } },
    });
  }

  /**
   * Dashboard 聚合端点：一次返回项目列表 + 就绪状态 + 阶段分布。
   * 避免前端 N+1 次工作区查询，在表格中直接呈现供应商/专家就绪信号。
   */
  async getProjectsDashboard() {
    const projects = await this.prisma.bidProject.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { suppliers: true, experts: true } },
      },
    });

    const projectIds = projects.map(p => p.id);

    // 批量获取各项目的供应商提交数与专家签到数（单次 groupBy，避免 N+1）
    const [submissionCounts, expertSignInCounts] = await Promise.all([
      projectIds.length > 0
        ? this.prisma.supplierBidSubmission.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds }, status: 'submitted' },
            _count: { projectId: true },
          })
        : ([] as { projectId: string; _count: { projectId: number } }[]),
      projectIds.length > 0
        ? this.prisma.bidExpert.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds }, signedIn: true },
            _count: { projectId: true },
          })
        : ([] as { projectId: string; _count: { projectId: number } }[]),
    ]);

    const submittedMap = new Map(submissionCounts.map(s => [s.projectId, s._count.projectId] as [string, number]));
    const signedInMap = new Map(expertSignInCounts.map(e => [e.projectId, e._count.projectId] as [string, number]));

    const projectRows = projects.map(p => {
      const supplierCount = p._count.suppliers;
      const supplierSubmitted = submittedMap.get(p.id) ?? 0;
      const expertCount = p._count.experts;
      const expertSignedIn = signedInMap.get(p.id) ?? 0;

      let readiness: 'ready' | 'partial' | 'not-ready' | 'archived';
      if (p.stage === 'ARCHIVED') {
        readiness = 'archived';
      } else if (
        supplierCount > 0 &&
        supplierSubmitted === supplierCount &&
        expertCount > 0 &&
        expertSignedIn === expertCount
      ) {
        readiness = 'ready';
      } else if (supplierSubmitted > 0 || expertSignedIn > 0) {
        readiness = 'partial';
      } else {
        readiness = 'not-ready';
      }

      return {
        id: p.id,
        projectCode: p.projectCode,
        name: p.name,
        procurementMethod: p.procurementMethod,
        openTime: p.openTime,
        deadline: p.deadline,
        stage: p.stage,
        riskNote: p.riskNote,
        budget: p.budget,
        scope: p.scope,
        qualification: p.qualification,
        contact: p.contact,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        supplierCount,
        supplierSubmitted,
        expertCount,
        expertSignedIn,
        readiness,
      };
    });

    const stageCounts = await this.prisma.bidProject.groupBy({
      by: ['stage'],
      _count: { stage: true },
    });
    const stageDistribution: Record<string, number> = {};
    stageCounts.forEach(s => {
      stageDistribution[s.stage] = s._count.stage;
    });

    const totalProjects = projects.length;
    const activeProjects = projectRows.filter(
      p => p.stage === 'OPENING' || p.stage === 'EVALUATING' || p.stage === 'SUBMIT',
    ).length;

    return {
      projects: projectRows,
      stageDistribution,
      totalProjects,
      activeProjects,
    };
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

  /** 项目工作台：聚合项目 + 供应商(含投标提交) + 专家组 + 统计，供采购管理端判断开标准备 */
  async getWorkspace(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, name: true, projectCode: true, procurementMethod: true, stage: true, openTime: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const [suppliers, experts, submissions] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: id },
        include: { supplier: { select: { id: true, name: true, classification: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidExpert.findMany({
        where: { projectId: id },
        select: { id: true, expertName: true, major: true, signedIn: true, avoidanceConfirmed: true, progress: true },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: id },
        select: { supplierId: true, status: true, submittedAt: true, bidPrice: true, deliveryPeriod: true },
      }),
    ]);
    const subMap = new Map(submissions.map(s => [s.supplierId, s]));

    const supplierRows = suppliers.map(s => {
      const submission = s.supplierId ? (subMap.get(s.supplierId) ?? null) : null;
      // 单一事实来源：有 SupplierBidSubmission 以其 status 为准；否则回退到 BidSupplier.submitStatus
      const submitted = submission?.status === 'submitted' || (!submission && s.submitStatus === '已提交');
      const withdrawn = submission?.status === 'withdrawn';
      return {
        id: s.id,
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        classification: s.supplier?.classification?.name,
        downloadStatus: s.downloadStatus,
        submitStatus: s.submitStatus,
        decryptStatus: s.decryptStatus,
        submission,
        submitted,
        withdrawn,
      };
    });

    return {
      project,
      suppliers: supplierRows,
      experts,
      stats: {
        supplierTotal: suppliers.length,
        submitted: supplierRows.filter(s => s.submitted).length,
        withdrawn: supplierRows.filter(s => s.withdrawn).length,
        expertCount: experts.length,
        expertSignedIn: experts.filter(e => e.signedIn).length,
      },
    };
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
        qualityRequirement: dto.qualityRequirement,
        bondRequired: dto.bondRequired ?? false,
        bondAmount: dto.bondAmount,
      },
    });

    // 若提供了 announcementId，自动关联公告的 relatedProjectCode
    if (dto.announcementId) {
      await this.prisma.announcement.update({
        where: { id: dto.announcementId },
        data: { relatedProjectCode: project.projectCode },
      });
    }

    await this.notificationService.sendToRole('bid_host', {
      type: 'BID_PUBLISHED',
      title: `新招标项目：${project.name}`,
      content: `项目编号 ${project.projectCode} 已创建，采购方式：${project.procurementMethod}。`,
      link: `/bid?id=${project.id}`,
    });

    return project;
  }

  /**
   * 从公告发布联动创建 BidProject。
   * 调用方负责幂等检查（公告 relatedProjectCode 已关联则跳过）。
   */
  async createFromAnnouncement(
    announcement: { id: string; title: string; publishDate: Date | null },
    metadata: Record<string, any>,
  ) {
    const projectCode = `BID-${Date.now()}`;
    const openTime = metadata.openTime
      ? new Date(metadata.openTime)
      : (announcement.publishDate || new Date());
    const deadline = metadata.deadline
      ? new Date(metadata.deadline)
      : new Date(openTime.getTime() + 7 * 86400000);

    const project = await this.prisma.bidProject.create({
      data: {
        name: announcement.title,
        projectCode,
        procurementMethod: metadata.method || '公开招标',
        openTime,
        deadline,
        riskNote: '（来自公告自动创建）',
        budget: metadata.budget != null ? Number(metadata.budget) : null,
        scope: metadata.scope || null,
        qualification: metadata.qualification || null,
        contact: metadata.contact || null,
        stage: 'DOWNLOAD',
      },
    });

    this.logger.log(
      `公告联动创建项目: ${project.projectCode} (announcementId=${announcement.id})`,
    );

    return project;
  }

  /**
   * 已发布公告再次编辑时，同步更新 BidProject 的可编辑字段。
   * 不改变 projectCode 和 stage。
   */
  async syncFromAnnouncement(
    projectId: string,
    announcement: { title: string },
    metadata: Record<string, any>,
  ) {
    const existing = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true },
    });
    if (!existing) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const openTime = metadata.openTime ? new Date(metadata.openTime) : undefined;
    const deadline = metadata.deadline ? new Date(metadata.deadline) : undefined;

    const updated = await this.prisma.bidProject.update({
      where: { id: projectId },
      data: {
        name: announcement.title,
        ...(metadata.method !== undefined && { procurementMethod: metadata.method }),
        ...(openTime && { openTime }),
        ...(deadline && { deadline }),
        ...(metadata.budget !== undefined && { budget: Number(metadata.budget) }),
        ...(metadata.scope !== undefined && { scope: metadata.scope }),
        ...(metadata.qualification !== undefined && { qualification: metadata.qualification }),
        ...(metadata.contact !== undefined && { contact: metadata.contact }),
      },
    });

    this.logger.log(`公告同步更新项目: ${updated.projectCode} (projectId=${projectId})`);
    return updated;
  }

  async updateProject(id: string, dto: UpdateBidProjectDto) {
    // stage 流转不走此接口：曾允许 PATCH stage 绕过专用端点的前置校验/副作用/审计
    // （OPENING→EVALUATING 不建 AI task 致分析死锁，且无监督/审计日志）。
    // 阶段变更须走 openSubmission/startOpening/startEvaluation/archiveAll 等专用端点。
    return this.prisma.bidProject.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.procurementMethod !== undefined && { procurementMethod: dto.procurementMethod }),
        ...(dto.openTime !== undefined && { openTime: new Date(dto.openTime) }),
        ...(dto.deadline !== undefined && { deadline: new Date(dto.deadline) }),
        ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }),
        ...(dto.budget !== undefined && { budget: dto.budget }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
        ...(dto.qualification !== undefined && { qualification: dto.qualification }),
        ...(dto.contact !== undefined && { contact: dto.contact }),
        ...(dto.qualityRequirement !== undefined && { qualityRequirement: dto.qualityRequirement }),
        ...(dto.bondRequired !== undefined && { bondRequired: dto.bondRequired }),
        ...(dto.bondAmount !== undefined && { bondAmount: dto.bondAmount }),
      },
    });
  }

  listSuppliers(projectId: string) {
    return this.prisma.bidSupplier.findMany({ where: { projectId } });
  }

  startOpening(projectId: string, dto?: StartOpeningDto, userId?: string) {
    return this.startOpeningInternal(projectId, dto, userId);
  }

  async openSubmission(id: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true, projectCode: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'SUBMIT');

    // G3: 开放投递前必须已发布招标公示（供应商经 relatedProjectCode 获取招标文件）
    const notice = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'BID_NOTICE', status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!notice) {
      throw new ConflictException({
        error: '尚未发布招标公示，供应商无法获取招标文件，请先在信息发布中心发布招标公告',
        code: 'BID_NOTICE_REQUIRED',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'SUBMIT' },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '开放投递 (DOWNLOAD→SUBMIT)', result: '阶段变更成功', riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: 'DOWNLOAD', to: 'SUBMIT', stage: 'SUBMIT' } } });

      return result;
    });

    // Defer WebSocket notifications until after transaction commits
    this.gateway?.notifyStageChange(id, 'DOWNLOAD', 'SUBMIT', 'host');
    this.gateway?.notifySubmissionOpened(id);
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: '开放投递 (DOWNLOAD→SUBMIT)', target: project.name, result: '阶段变更成功', riskFlag: '无' });

    return updated;
  }

  private async startOpeningInternal(id: string, dto?: StartOpeningDto, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'OPENING');

    // P1: 截标时间校验——投标截止时间未到，不允许启动开标
    if (new Date() < new Date(project.deadline)) {
      throw new BadRequestException({
        error: '投标截止时间未到，无法启动开标',
        code: 'DEADLINE_NOT_PASSED',
      });
    }

    // P1: 整个阶段变更 + Session 创建用事务包裹，防止并发竞争
    const isTransitioning = project.stage !== 'OPENING';

    // 首次进入 OPENING 必须提供完整的开标会话信息
    if (isTransitioning && (!dto?.host || !dto?.supervisor || !dto?.decryptWindowStart || !dto?.decryptWindowEnd)) {
      throw new BadRequestException({
        error: '启动开标需填写主持人、监督人及解密窗口起止时间',
        code: 'OPENING_SESSION_REQUIRED',
      });
    }

    if (dto?.decryptWindowStart && dto?.decryptWindowEnd) {
      if (new Date(dto.decryptWindowEnd) <= new Date(dto.decryptWindowStart)) {
        throw new BadRequestException({
          error: '解密窗口结束时间必须晚于开始时间',
          code: 'INVALID_DECRYPT_WINDOW',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto?.host && dto?.supervisor && dto?.decryptWindowStart && dto?.decryptWindowEnd) {
        const existingSession = await tx.bidOpeningSession.findUnique({ where: { projectId: id } });
        const decryptWindowEnd = new Date(dto.decryptWindowEnd);
        const remainingSeconds = Math.max(0, Math.floor((decryptWindowEnd.getTime() - Date.now()) / 1000));
        const sessionData = {
          host: dto.host,
          supervisor: dto.supervisor,
          decryptWindowStart: new Date(dto.decryptWindowStart),
          decryptWindowEnd,
          remainingSeconds,
          status: '待开标' as const,
        };
        if (existingSession) {
          await tx.bidOpeningSession.update({ where: { projectId: id }, data: sessionData });
        } else {
          await tx.bidOpeningSession.create({ data: { projectId: id, ...sessionData } });
        }
      }

      const updated = await tx.bidProject.update({
        where: { id },
        data: { stage: 'OPENING' },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: dto?.host || '系统', target: project.name, action: '启动开标 (SUBMIT→OPENING)', result: '阶段变更成功', riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: 'SUBMIT', to: 'OPENING', stage: 'OPENING', host: dto?.host, supervisor: dto?.supervisor, deadline: project.deadline } } });

      this.gateway?.notifyStageChange(id, 'SUBMIT', 'OPENING', 'host');
      this.gateway?.notifyOpeningStarted(id, { host: dto?.host || '系统', supervisor: dto?.supervisor || '系统' });
      this.gateway?.notifySupervisionLog(id, { role: dto?.host || '系统', action: '启动开标 (SUBMIT→OPENING)', target: project.name, result: '阶段变更成功', riskFlag: '无' });

      return updated;
    });
  }

  async startEvaluation(id: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'EVALUATING');

    // P2: Prevent deadlock — ensure at least one expert is assigned
    const expertCount = await this.prisma.bidExpert.count({ where: { projectId: id } });
    if (expertCount === 0) {
      throw new BadRequestException({ error: '项目未分配评审专家，无法启动评标', code: 'NO_EXPERTS_ASSIGNED' });
    }

    // G4: 至少一个解密成功且未撤回的供应商，否则评标阶段无供应商可评（死局）
    const evaluableSupplierCount = await this.prisma.bidSupplier.count({
      where: { projectId: id, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
    });
    if (evaluableSupplierCount === 0) {
      throw new BadRequestException({
        error: '没有解密成功的有效供应商，无法启动评标',
        code: 'NO_EVALUABLE_SUPPLIERS',
      });
    }

    // G9: 评分标准完整(打分类 Σ=100 + 每个打分类项 ≥1 得分点),否则专家无法打分
    await this.scoreStandardValidator.assertScoreStandardComplete(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'EVALUATING' },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '启动评标 (OPENING→EVALUATING)', result: '阶段变更成功', riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: 'OPENING', to: 'EVALUATING', stage: 'EVALUATING' } } });

      // 4.3: 创建 AI 分析 task（1:1，upsert 幂等）+ 为解密成功供应商创建 bidderResult（数据准备）
      const aiTask = await tx.aiBidAnalysisTask.upsert({
        where: { projectId: id },
        create: { projectId: id, status: 'PENDING' },
        update: {},
      });
      const evaluableSuppliers = await tx.bidSupplier.findMany({
        where: { projectId: id, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
        select: { id: true },
      });
      if (evaluableSuppliers.length > 0) {
        await tx.aiBidderResult.createMany({
          data: evaluableSuppliers.map((s) => ({
            taskId: aiTask.id,
            bidSupplierId: s.id,
            status: 'PENDING',
          })),
          skipDuplicates: true, // @@unique([taskId, bidSupplierId]) 幂等
        });
      }
      // TODO Phase 5: 入队 BullMQ 触发 worker（OCR → extract → concordance → score）

      return result;
    });

    // Defer WebSocket notifications until after transaction commits
    this.gateway?.notifyStageChange(id, 'OPENING', 'EVALUATING', 'host');
    this.gateway?.notifyEvaluationStarted(id);
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: '启动评标 (OPENING→EVALUATING)', target: project.name, result: '阶段变更成功', riskFlag: '无' });

    // 15.10: AI 分析启动监督日志
    await this.prisma.bidSupervisionLog.create({
      data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '启动AI辅助分析', result: `${evaluableSupplierCount}家供应商入队分析`, riskFlag: '无' },
    }).catch(() => {});
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: '启动AI辅助分析', target: project.name, result: `${evaluableSupplierCount}家供应商入队`, riskFlag: '无' });

    // 4.3: 入队 AI 分析（tender 处理 → 触发 worker 端到端）
    if (this.tenderQueue) {
      const aiTask = await this.prisma.aiBidAnalysisTask.findUnique({
        where: { projectId: id },
      });
      if (aiTask) {
        try {
          await this.tenderQueue.add(
            'process',
            { taskId: aiTask.id },
            {
              jobId: `tender-${aiTask.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: { age: 7 * 24 * 3600 },
              removeOnFail: { age: 30 * 24 * 3600 },
            },
          );
          this.logger.log(`AI analysis task ${aiTask.id} enqueued for project ${id}`);
        } catch (err) {
          this.logger.error(`Failed to enqueue AI analysis task ${aiTask.id}: ${(err as Error).message}`);
          // 入队失败则将任务标记为 FAILED，避免永久 PENDING
          await this.prisma.aiBidAnalysisTask.update({
            where: { id: aiTask.id },
            data: { status: 'FAILED' },
          }).catch(() => {});
        }
      }
    }

    return updated;
  }

  /**
   * B8 (15.5): 重新触发 AI 分析 — 清除旧结果 → 重置 PENDING → 入队
   */
  async rerunAiAnalysis(projectId: string, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段，无法重新分析', code: 'PROJECT_NOT_EVALUATING' });
    }

    const task = await this.prisma.aiBidAnalysisTask.findUnique({ where: { projectId } });
    if (!task) throw new BadRequestException({ error: '未找到 AI 分析任务', code: 'TASK_NOT_FOUND' });

    // 清除旧结果：bidderResult + report + concordance（cascade 会处理部分）
    await this.prisma.$transaction(async (tx) => {
      await tx.aiBidReport.deleteMany({ where: { taskId: task.id } });
      await tx.aiConcordanceResult.deleteMany({ where: { taskId: task.id } });
      await tx.aiBidderResult.deleteMany({ where: { taskId: task.id } });
      // 重置 task 为 PENDING
      await tx.aiBidAnalysisTask.update({
        where: { id: task.id },
        data: { status: 'PENDING', completedAt: null },
      });
      // 重新创建 evaluable bidderResult
      const evaluableSuppliers = await tx.bidSupplier.findMany({
        where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
        select: { id: true },
      });
      if (evaluableSuppliers.length > 0) {
        await tx.aiBidderResult.createMany({
          data: evaluableSuppliers.map((s) => ({
            taskId: task.id,
            bidSupplierId: s.id,
            status: 'PENDING',
          })),
          skipDuplicates: true,
        });
      }
    });

    // 入队 tender 处理
    if (this.tenderQueue) {
      try {
        await this.tenderQueue.add(
          'process',
          { taskId: task.id },
          {
            jobId: `tender-rerun-${task.id}-${Date.now()}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 7 * 24 * 3600 },
            removeOnFail: { age: 30 * 24 * 3600 },
          },
        );
        this.logger.log(`AI analysis rerun enqueued: task=${task.id}, project=${projectId}`);
      } catch (err) {
        this.logger.error(`Failed to enqueue rerun for task ${task.id}: ${(err as Error).message}`);
        await this.prisma.aiBidAnalysisTask.update({
          where: { id: task.id },
          data: { status: 'FAILED' },
        }).catch(() => {});
        throw new BadRequestException({ error: '入队失败，任务已标记为 FAILED', code: 'ENQUEUE_FAILED' });
      }
    }

    // 监督日志
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: project.name, action: '重新启动AI辅助分析', result: '旧结果已清除，重新入队', riskFlag: '无' },
    }).catch(() => {});
  }

  /**
   * 4.4: 一键解密窗口内所有待解密供应商
   */
  async decryptAllSuppliers(projectId: string, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, name: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段', code: 'PROJECT_NOT_OPENING' });
    }

    const pendingSuppliers = await this.prisma.bidSupplier.findMany({
      where: { projectId, decryptStatus: { in: ['PENDING', 'DANGER'] }, submitStatus: { not: '已撤回' } },
      select: { id: true, supplierName: true },
    });

    const results: Array<{ supplierId: string; supplierName: string; success: boolean; error?: string }> = [];
    for (const s of pendingSuppliers) {
      try {
        await this.decryptSupplier(projectId, s.id, undefined, actorId);
        results.push({ supplierId: s.id, supplierName: s.supplierName, success: true });
      } catch (e) {
        results.push({ supplierId: s.id, supplierName: s.supplierName, success: false, error: (e as Error).message });
      }
    }

    this.gateway?.notifySupervisionLog(projectId, {
      role: '系统', action: '一键解密', target: project.name,
      result: `${results.filter(r => r.success).length}/${results.length} 成功`, riskFlag: '无',
    });

    return { total: results.length, success: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, details: results };
  }

  async decryptSupplier(projectId: string, supplierId: string, dto?: DecryptSupplierDto, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const bidSupplier = await tx.bidSupplier.findFirst({
        where: { projectId, id: supplierId },
      });
      if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });

      // P0: 重复解密保护 — 已成功解密的不允许再次解密（避免覆写 confirmStatus）
      if (bidSupplier.decryptStatus === 'SUCCESS') {
        throw new BadRequestException({ error: '标书已解密成功，无需重复解密', code: 'ALREADY_DECRYPTED' });
      }

      // P0: 显式阶段门控 — 仅 OPENING 阶段可解密（兜底 session 校验）
      const project = await tx.bidProject.findUnique({ where: { id: projectId } });
      if (!project || project.stage !== 'OPENING') {
        throw new BadRequestException({ error: '项目不在开标阶段，无法解密', code: 'PROJECT_NOT_OPENING' });
      }

      // P0: 解密窗口校验 — 开标未启动或窗口未开启/已关闭时拒绝解密
      const session = await tx.bidOpeningSession.findUnique({ where: { projectId } });
      if (!session) {
        throw new BadRequestException({ error: '开标尚未启动，无法解密', code: 'OPENING_NOT_STARTED' });
      }
      const now = new Date();
      if (now < session.decryptWindowStart) {
        throw new BadRequestException({ error: '解密窗口尚未开启', code: 'DECRYPT_WINDOW_NOT_OPEN' });
      }
      if (now > session.decryptWindowEnd) {
        throw new BadRequestException({ error: '解密窗口已关闭', code: 'DECRYPT_WINDOW_CLOSED' });
      }

      // Phase 1: 开始解密
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { decryptStatus: 'RUNNING' },
      });

      // 查找该供应商的提交记录（含加密封存密钥与文件引用）
      // P0: Use tx (transaction client) for consistency inside $transaction
      const submission = bidSupplier.supplierId
        ? await tx.supplierBidSubmission.findUnique({
            where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
          })
        : null;

      // 真实解密 + 完整性校验（如有文件引用）：读取 MinIO 文件，重算 SHA-256 与 FileAsset.sha256 比对；
      // 若存在 sealedKey 则先做真实 AES-256-GCM 解密。DANGER 由真实校验失败触发，不再依赖 simulateDanger。
      let decryptOk: boolean | null = null;
      let integrityOk: boolean | null = null;
      let errorMsg = '';

      const fileRefs: Array<{ assetId?: string | null; sealedKey?: string | null }> = submission
        ? [
            { assetId: submission.technicalFileAssetId, sealedKey: submission.technicalSealedKey },
            { assetId: submission.businessFileAssetId, sealedKey: submission.businessSealedKey },
            { assetId: submission.coverLetterAssetId, sealedKey: submission.coverLetterSealedKey },
          ].filter(ref => !!ref.assetId)
        : [];

      // P0: 无投标文件 → 直接标记 DANGER，避免 classifyDecryptOutcome 默认判 SUCCESS
      if (fileRefs.length === 0) {
        const reason = submission
          ? '投标文件引用缺失（未上传技术/商务/报价文件）'
          : (bidSupplier.supplierId ? '供应商未提交投标文件' : '供应商未关联系统账户，无法查询投标记录');
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'DANGER', decryptError: reason } });
        this.gateway?.notifyDecryptStatus(projectId, supplierId, bidSupplier.supplierName, 'DANGER');
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密异常：${reason}`, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '标书解密', target: bidSupplier.supplierName, result: `解密异常：${reason}`, riskFlag: '高风险' });
        this.gateway?.notifyAnomaly(projectId, { type: 'decrypt_failure', supplierId, supplierName: bidSupplier.supplierName, detail: reason, severity: 'danger' });
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, outcome: 'DANGER', reason, phase: 'no_files' } } });
        return tx.bidSupplier.findUnique({ where: { id: supplierId } });
      }

      for (const ref of fileRefs) {
        if (!ref.assetId) continue;
        // P0: Use tx (transaction client) for consistency inside $transaction
        const asset = await tx.fileAsset.findUnique({ where: { id: ref.assetId } });
        if (!asset) { errorMsg = `投标文件记录缺失: ${ref.assetId}`; break; }
        try {
          const readKey = asset.sealedPath || asset.key; // 兼容存量：无 sealedPath 时回退到原路径
          const objStream = await minioClient.getObject(MINIO_BUCKET, readKey);
          let buffer = await streamToBuffer(objStream);
          // Layer B：有 sealedKey 时执行真实 AES 解密
          if (ref.sealedKey) {
            const rawKey = isWrappedKey(ref.sealedKey)
              ? unwrapKey(ref.sealedKey, process.env.KMS_SECRET!)
              : ref.sealedKey;
            buffer = decryptBuffer(buffer, rawKey);
            decryptOk = true;
          }
          // Layer A：完整性校验（解密后的明文 vs 存储 sha256）
          const integrity = verifyIntegrity(buffer, asset.sha256);
          if (integrity === false) { integrityOk = false; errorMsg = '标书文件完整性校验失败：SHA-256 不匹配（疑似篡改或损坏）'; break; }
          if (integrity === true) integrityOk = true;
        } catch (e) {
          decryptOk = ref.sealedKey ? false : null;
          errorMsg = `标书文件解密失败：${(e as Error).message}`;
          break;
        }
      }

      const hasSealedKey = !!submission && !!(submission.technicalSealedKey || submission.businessSealedKey || submission.coverLetterSealedKey);
      // P0 Security: simulateDanger is gated to non-production environments only.
      // In production, any attempt to force DANGER is rejected with an explicit error.
      const simulateOk = dto?.simulateDanger === true;
      if (simulateOk && process.env.NODE_ENV === 'production') {
        throw new BadRequestException({ error: 'simulateDanger 不可在生产环境使用', code: 'FORBIDDEN_IN_PRODUCTION' });
      }
      const outcome = simulateOk
        ? 'DANGER' as const  // 仅非生产环境可用：显式模拟开关用于演练（覆盖真实结果）
        : (errorMsg && integrityOk !== true && decryptOk !== true
            ? 'DANGER' as const
            : classifyDecryptOutcome({ hasSealedKey, decryptOk, integrityOk }));

      if (outcome === 'DANGER') {
        const reason = errorMsg || '标书文件校验失败：签名不匹配或文件损坏';
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'DANGER', decryptError: reason } });
        this.gateway?.notifyDecryptStatus(projectId, supplierId, bidSupplier.supplierName, 'DANGER');
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密异常：${reason}`, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '标书解密', target: bidSupplier.supplierName, result: `解密异常：${reason}`, riskFlag: '高风险' });
        this.gateway?.notifyAnomaly(projectId, { type: 'decrypt_failure', supplierId, supplierName: bidSupplier.supplierName, detail: reason, severity: 'danger' });
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, outcome: 'DANGER', reason, phase: 'decrypt_verify' } } });
        return tx.bidSupplier.findUnique({ where: { id: supplierId } });
      }

      // 解密成功
      await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'SUCCESS' } });
      this.gateway?.notifyDecryptStatus(projectId, supplierId, bidSupplier.supplierName, 'SUCCESS');

      // 创建开标记录（仅当开标记录字段全部提供时）——等待供应商确认，不自动 CONFIRMED
      if (dto?.amount && dto?.period && dto?.qualityTarget && dto?.bondStatus) {
        await tx.bidOpeningRecord.create({
          data: {
            projectId,
            supplierName: bidSupplier.supplierName,
            amount: dto.amount,
            period: dto.period,
            qualityTarget: dto.qualityTarget,
            bondStatus: dto.bondStatus,
            decryptResult: '解密成功',
            confirmStatus: '待供应商确认',
            bidSupplierId: supplierId,
          },
        });
      }

      const confirmed = await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { confirmStatus: 'PENDING' },
      });
      const legacyNote = hasSealedKey ? '' : '（legacy 记录：未加密封存，仅完成完整性校验）';
      await tx.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密成功，等待供应商确认唱标信息${legacyNote}`, riskFlag: '无' },
      });

      this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '标书解密', target: bidSupplier.supplierName, result: `解密成功，等待供应商确认唱标信息${legacyNote}`, riskFlag: '无' });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, outcome: 'SUCCESS' } } });

      return confirmed;
    });
  }

  async getOpeningSession(projectId: string) {
    return this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
  }

  listOpeningRecords(projectId: string) {
    return this.prisma.bidOpeningRecord.findMany({ where: { projectId } });
  }

  /**
   * 唱标预填草稿：聚合项目级质量目标 + 投标提交的报价/工期 + 已有开标记录的保证金状态。
   * 仅 OPENING 阶段且该供应商解密成功才返回真实数据（canView=true），
   * 保证金凭证（bidBondAssetId）同样仅此时可见，供主持人核对。
   */
  async getOpeningRecordDraft(projectId: string, bidSupplierId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, qualityRequirement: true },
    });
    const empty = { canView: false, amount: null, period: null, qualityTarget: null, bondStatus: null, bidBondAssetId: null };
    if (!project || project.stage !== 'OPENING') return { ...empty, qualityTarget: project?.qualityRequirement ?? null };

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: bidSupplierId, projectId },
      select: { id: true, decryptStatus: true, supplierId: true },
    });
    if (!bidSupplier || bidSupplier.decryptStatus !== 'SUCCESS') return empty;

    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
          select: { bidPrice: true, deliveryPeriod: true, bidBondAssetId: true },
        })
      : null;

    const existingRecord = await this.prisma.bidOpeningRecord.findFirst({
      where: { projectId, bidSupplierId },
      select: { bondStatus: true },
    });

    return {
      canView: true,
      amount: submission?.bidPrice ?? null,
      period: submission?.deliveryPeriod ?? null,
      qualityTarget: project.qualityRequirement,
      bondStatus: existingRecord?.bondStatus ?? null,
      bidBondAssetId: submission?.bidBondAssetId ?? null,
    };
  }

  /**
   * 主持人录入唱标信息（报价/工期/质量目标/保证金）。
   * 解决"解密不落开标记录"的断链：解密仅做密文校验，唱标信息由主持人据解密内容补录，
   * 据此生成/更新 BidOpeningRecord（confirmStatus=待供应商确认），供供应商确认或异议。
   * 仅在 OPENING 阶段可录入；投标须已解密成功。按 bidSupplierId 幂等 upsert。
   */
  async enterOpeningRecord(projectId: string, dto: CreateOpeningRecordDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '唱标信息录入需在开标阶段进行', code: 'NOT_OPENING_STAGE' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: dto.bidSupplierId, projectId },
      select: { id: true, supplierName: true, decryptStatus: true },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '投标记录不存在', code: 'BID_SUPPLIER_NOT_FOUND' });
    if (bidSupplier.decryptStatus !== 'SUCCESS') {
      throw new BadRequestException({ error: '标书尚未解密成功，无法录入唱标信息', code: 'NOT_DECRYPTED' });
    }

    const payload = {
      amount: dto.amount,
      period: dto.period,
      qualityTarget: dto.qualityTarget,
      bondStatus: dto.bondStatus,
      decryptResult: '解密成功',
      confirmStatus: '待供应商确认',
    };

    // P0: Wrap check-then-act + log in transaction to prevent duplicate record race
    const record = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.bidOpeningRecord.findFirst({
        where: { projectId, bidSupplierId: bidSupplier.id },
      });
      const rec = existing
        ? await tx.bidOpeningRecord.update({ where: { id: existing.id }, data: payload })
        : await tx.bidOpeningRecord.create({
            data: { projectId, supplierName: bidSupplier.supplierName, bidSupplierId: bidSupplier.id, ...payload },
          });

      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: bidSupplier.supplierName,
          action: '录入唱标信息', result: `报价 ${dto.amount} / 工期 ${dto.period}`, riskFlag: '无',
        },
      });
      return rec;
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '录入唱标信息', target: bidSupplier.supplierName, result: `报价 ${dto.amount} / 工期 ${dto.period}`, riskFlag: '无' });
    return record;
  }

  async resolveOpeningDispute(projectId: string, recordId: string, dto: { result: string; confirm: boolean }) {
    const record = await this.prisma.bidOpeningRecord.findFirst({ where: { id: recordId, projectId } });
    if (!record) throw new BadRequestException({ error: '开标记录不存在', code: 'NOT_FOUND' });

    // P0: 阶段门控 — 仅在开标阶段可处理异议
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法处理异议', code: 'PROJECT_NOT_OPENING' });
    }

    const now = new Date();
    const confirmStatus = dto.confirm ? '异议已处理-确认' : '异议已处理-退回';

    // P0: Wrap record update + supplier update + supervision log in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.bidOpeningRecord.update({
        where: { id: recordId },
        data: { confirmStatus, handleResult: dto.result, handledAt: now },
      });
      if (record.bidSupplierId) {
        await tx.bidSupplier.update({
          where: { id: record.bidSupplierId },
          data: { confirmStatus: dto.confirm ? 'CONFIRMED' : 'EXCEPTION' },
        });
      }
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: now, role: '开标主持人', target: record.supplierName,
          action: '处理开标异议', result: dto.result, riskFlag: '中风险',
        },
      });
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '处理开标异议', target: record.supplierName, result: dto.result, riskFlag: '中风险' });
    return this.prisma.bidOpeningRecord.findUnique({ where: { id: recordId } });
  }

  listExperts(projectId: string) {
    return this.prisma.bidExpert.findMany({ where: { projectId }, include: { scoreRecords: true } });
  }

  listEvaluationResults(projectId: string) {
    return this.prisma.bidEvaluationResult.findMany({ where: { projectId }, orderBy: { rank: 'asc' } });
  }

  async generateEvaluationResults(projectId: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { experts: true, suppliers: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段', code: 'PROJECT_NOT_EVALUATING' });
    }
    if (project.experts.some(e => !e.reportConfirmed)) {
      throw new BadRequestException({ error: '仍有专家未确认评审报告', code: 'EXPERT_REPORTS_NOT_CONFIRMED' });
    }

    const activeSuppliers = project.suppliers.filter(
      s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.confirmStatus === 'CONFIRMED' && s.bidValidity !== 'invalid',
    );

    // 保证金软标记：bondRequired 时查各供应商 bondStatus，异常者写监督日志（不排除，由评标委员会定）
    const bondFlagged: { supplierName: string; bondStatus: string }[] = [];
    if (project.bondRequired) {
      const openingRecords = await this.prisma.bidOpeningRecord.findMany({
        where: { projectId },
        select: { bidSupplierId: true, bondStatus: true, supplierName: true },
      });
      const bondBySupplier = new Map(openingRecords.map(r => [r.bidSupplierId, r.bondStatus]));
      for (const s of activeSuppliers) {
        const status = bondBySupplier.get(s.id);
        if (!isBondQualified(status)) {
          bondFlagged.push({ supplierName: s.supplierName, bondStatus: status || '未核对' });
        }
      }
    }

    // P0: Single batch query instead of per-supplier N+1 — fetch all scores at once
    const activeSupplierIds = activeSuppliers.map(s => s.id);
    const allScoreRecords = activeSupplierIds.length > 0
      ? await this.prisma.bidScoreRecord.findMany({
          where: { supplierId: { in: activeSupplierIds }, expert: { projectId } },
        })
      : [];
    // Group records by supplierId for O(1) lookup
    const recordsBySupplier = new Map<string, typeof allScoreRecords>();
    for (const record of allScoreRecords) {
      const arr = recordsBySupplier.get(record.supplierId);
      if (arr) {
        arr.push(record);
      } else {
        recordsBySupplier.set(record.supplierId, [record]);
      }
    }

    // G2: 按供应商聚合 → 每专家对该供应商的总评分 → 专家组≥5 去 1 高 1 低 → 求平均
    const panelSize = project.experts.length;

    // ── 通过性审查废标判定：某项不通过票严格过半 → 该供应商废标 ──
    const passFailVerdicts = new Map<string, boolean>(); // supplierId -> disqualified
    const passFailFailures: { supplierId: string; supplierName: string; category: string; fail: number; total: number }[] = [];
    {
      // 收集所有通过性 scoreItemId（按项目）
      const passFailItemIds = new Set<string>();
      // 需要每个 record 的 scoreItem.category；上面 allScoreRecords 未 include scoreItem，单独查一次通过性项
      const passFailItems = await this.prisma.bidScoreItem.findMany({
        where: { projectId, category: { in: ['QUALIFICATION', 'RESPONSIVE'] } },
        select: { id: true, category: true },
      });
      for (const it of passFailItems) passFailItemIds.add(it.id);
      const categoryById = new Map(passFailItems.map(it => [it.id, it.category as string]));

      for (const supplier of activeSuppliers) {
        const records = recordsBySupplier.get(supplier.id) ?? [];
        let disqualified = false;
        // 逐项统计
        const byItem = new Map<string, { fail: number; total: number }>();
        for (const r of records) {
          if (!passFailItemIds.has(r.scoreItemId) || r.passed === null || r.passed === undefined) continue;
          const agg = byItem.get(r.scoreItemId) ?? { fail: 0, total: 0 };
          agg.total += 1;
          if (r.passed === false) agg.fail += 1;
          byItem.set(r.scoreItemId, agg);
        }
        for (const [itemId, agg] of byItem) {
          if (agg.fail > agg.total - agg.fail) { // 不通过票严格过半
            disqualified = true;
            passFailFailures.push({
              supplierId: supplier.id, supplierName: supplier.supplierName,
              category: categoryById.get(itemId) || '通过性', fail: agg.fail, total: agg.total,
            });
          }
        }
        passFailVerdicts.set(supplier.id, disqualified);
      }
    }

    const ranked: { supplierId: string; supplierName: string; totalScore: number; averageScore: number; disqualified: boolean }[] = [];
    for (const supplier of activeSuppliers) {
      const records = recordsBySupplier.get(supplier.id) ?? [];
      // 每位专家对该供应商的总评分
      const perExpert = new Map<string, number>();
      for (const r of records) {
        perExpert.set(r.expertId, (perExpert.get(r.expertId) ?? 0) + Number(r.score));
      }
      const expertTotals = [...perExpert.values()].sort((a, b) => a - b);
      const totalScore = expertTotals.reduce((s, v) => s + v, 0);

      // 专家组≥5 时去 1 高 1 低（标准评标实务）
      let trimmed = expertTotals;
      if (expertTotals.length >= 5) {
        trimmed = expertTotals.slice(1, -1);
      }
      const averageScore = trimmed.length > 0
        ? Math.round((trimmed.reduce((s, v) => s + v, 0) / trimmed.length) * 100) / 100
        : 0;

      ranked.push({ supplierId: supplier.id, supplierName: supplier.supplierName, totalScore, averageScore, disqualified: !!passFailVerdicts.get(supplier.id) });
    }
    // 合格者在前、废标者在后；同组内按 averageScore 降序
    ranked.sort((a, b) => {
      if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
      return b.averageScore - a.averageScore;
    });

    const qualifiedRanked = ranked.filter(r => !r.disqualified);
    const winnerCount = Math.min(this.DEFAULT_WINNER_COUNT, qualifiedRanked.length);

    await this.prisma.$transaction(async (tx) => {
      await tx.bidEvaluationResult.deleteMany({ where: { projectId } });
      if (ranked.length > 0) {
        await tx.bidEvaluationResult.createMany({
          data: ranked.map((r, index) => ({
            projectId,
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            totalScore: r.totalScore,
            averageScore: r.averageScore,
            rank: index + 1,
            recommended: !r.disqualified && index < winnerCount,
            disqualified: r.disqualified,
          })),
        });
      }
      // ── 权威重算 bidValidity：覆盖实时触发器可能的多-item race 终态 ──
      // 仅重算 active 供应商（passFailVerdicts 只含 activeSuppliers）。
      // 已被实时触发器判定为 invalid 的非 active 供应商不在 passFailVerdicts 中，
      // 跳过更新以保留其既有 invalid 状态（避免误恢复为 valid）。
      for (const s of project.suppliers) {
        if (passFailVerdicts.has(s.id)) {
          await tx.bidSupplier.update({
            where: { id: s.id },
            data: { bidValidity: passFailVerdicts.get(s.id) ? 'invalid' : 'valid' },
          });
        }
      }

      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: project.name,
          action: '生成评标结果', result: `生成${ranked.length}家供应商排名（候选人 ${winnerCount} 名，专家组 ${panelSize} 人${panelSize >= 5 ? '，去极值' : ''}）`, riskFlag: '无',
        },
      });
      for (const f of bondFlagged) {
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: f.supplierName,
            action: '保证金异常标记', result: `保证金状态：${f.bondStatus}（未达标，供评标委员会审查）`, riskFlag: '高风险',
          },
        });
      }
      for (const f of passFailFailures) {
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: f.supplierName,
            action: '资格审查', result: `因${f.category === 'QUALIFICATION' ? '资格' : '响应性'}性审查不通过废标（不通过 ${f.fail}/${f.total} 票）`, riskFlag: '高风险',
          },
        });
      }
    });
    this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '生成评标结果', target: project.name, result: `生成${ranked.length}家供应商排名（候选人 ${winnerCount} 名，专家组 ${panelSize} 人${panelSize >= 5 ? '，去极值' : ''}）`, riskFlag: '无' });
    if (actorId) await this.prisma.auditLog.create({ data: { userId: actorId, action: 'BID_RESULTS_GENERATED', resourceType: `BidProject:${projectId}`, details: { rankedCount: ranked.length } } });

    return this.listEvaluationResults(projectId);
  }

  async submitScore(projectId: string, dto: CreateScoreDto, actorId?: string) {
    // P0: 阶段门控 — 仅在评标阶段可提交评分
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段，无法提交评分', code: 'PROJECT_NOT_EVALUATING' });
    }

    // 校验 expert 属于该项目
    const expert = await this.prisma.bidExpert.findFirst({
      where: { id: dto.expertId, projectId },
    });
    if (!expert) {
      throw new BadRequestException({ error: '该专家不属于此项目', code: 'EXPERT_NOT_IN_PROJECT' });
    }
    // P1-5：代评锁定——专家已确认报告后不可再代评改分
    if (expert.reportConfirmed) {
      throw new BadRequestException({ error: '评审报告已确认，评分已锁定', code: 'SCORE_LOCKED' });
    }

    // 校验 scoreItem 属于该项目
    const scoreItem = await this.prisma.bidScoreItem.findFirst({
      where: { id: dto.scoreItemId, projectId },
    });
    if (!scoreItem) {
      throw new BadRequestException({ error: '评分项不属于此项目', code: 'SCORE_ITEM_NOT_IN_PROJECT' });
    }

    // 校验 supplierId 属于该项目（防跨项目写脏分：bid_host 可传别项目的 supplierId，FK 满足即落库）
    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: dto.supplierId, projectId },
    });
    if (!bidSupplier) {
      throw new BadRequestException({ error: '供应商不属于此项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
    }
    // P1-9：代评不可对未解密成功/已撤回的供应商打分（与专家自评口径一致）
    if (bidSupplier.decryptStatus !== 'SUCCESS' || bidSupplier.submitStatus === '已撤回') {
      throw new BadRequestException({ error: '该供应商未解密成功或已撤回，无法代评', code: 'SUPPLIER_NOT_DECRYPTED' });
    }

    // 校验分数不超过评分项满分
    if (Number(dto.score) > Number(scoreItem.maxScore)) {
      throw new BadRequestException({
        error: `评分项 ${scoreItem.name} 分数 ${dto.score} 超过满分 ${scoreItem.maxScore}`,
        code: 'SCORE_EXCEEDS_MAX',
      });
    }

    // checklist 模式：若该 item 有 points，走 decision 汇总（与 ExpertService.submitScores 同口径）
    const points = await this.prisma.bidScorePoint.findMany({
      where: { scoreItemId: dto.scoreItemId },
      select: { id: true, objective: true, fullScore: true, scoreItemId: true },
    });
    let finalScore = Number(dto.score);
    let finalPassed = dto.passed;
    if (points.length > 0) {
      // 含得分点的评分项必须提交 pointDecisions（与 ExpertService.submitScores 同口径）
      if (!dto.pointDecisions || dto.pointDecisions.length === 0) {
        throw new BadRequestException({
          error: `评分项 ${scoreItem.name} 含得分点，必须提交得分点裁定`,
          code: 'DECISIONS_REQUIRED',
        });
      }
      for (const d of dto.pointDecisions) {
        const pm = points.find(p => p.id === d.pointId);
        if (!pm) throw new BadRequestException({ error: `得分点 ${d.pointId} 不属于该评分项`, code: 'POINT_NOT_IN_ITEM' });
        if (Number(d.awardedScore) > Number(pm.fullScore)) {
          throw new BadRequestException({ error: `得分点 ${d.pointId} 分数超过满分`, code: 'POINT_SCORE_EXCEEDS_MAX' });
        }
      }
      const decisionMap = new Map(dto.pointDecisions.map(d => [d.pointId, { checked: d.checked, awardedScore: Number(d.awardedScore) }]));
      const recomputed = recomputeItemFromDecisions({
        category: scoreItem.category,
        points: points.map(p => ({ id: p.id, objective: p.objective, fullScore: Number(p.fullScore) })),
        decisions: decisionMap,
        maxScore: Number(scoreItem.maxScore), // P0-A：封顶，防止数据异常使单项分 > maxScore
      });
      finalScore = recomputed.score;
      finalPassed = recomputed.passed ?? dto.passed;
      // （decision 的写 upsert 移入下方事务，与 record/review/progress 原子提交）
    }

    // P1-4/P1-5：写操作整体事务化（decisions + record + review + progress），中途失败整体回滚
    const { record, progress } = await this.prisma.$transaction(async (tx) => {
      // checklist 得分点裁定写入
      if (points.length > 0 && dto.pointDecisions) {
        for (const d of dto.pointDecisions) {
          await tx.bidScorePointDecision.upsert({
            where: { expertId_pointId_supplierId: { expertId: dto.expertId, pointId: d.pointId, supplierId: dto.supplierId } },
            update: { checked: d.checked, awardedScore: d.awardedScore, note: d.note },
            create: { expertId: dto.expertId, pointId: d.pointId, supplierId: dto.supplierId, checked: d.checked, awardedScore: d.awardedScore, note: d.note },
          });
        }
      }
      // 利用唯一约束 upsert：存在则更新，不存在则创建
      const rec = await tx.bidScoreRecord.upsert({
        where: {
          expertId_scoreItemId_supplierId: {
            expertId: dto.expertId,
            scoreItemId: dto.scoreItemId,
            supplierId: dto.supplierId,
          },
        },
        update: { score: finalScore, reason: dto.reason, ...(finalPassed !== undefined ? { passed: finalPassed } : {}) },
        create: {
          expertId: dto.expertId,
          scoreItemId: dto.scoreItemId,
          supplierId: dto.supplierId,
          score: finalScore,
          reason: dto.reason,
          ...(finalPassed !== undefined ? { passed: finalPassed } : {}),
        },
      });
      // P1-4：代评也写核对记录（否则专家核对时 P2025 → 无法确认报告）；改分后重置为 draft 需重新核对
      await tx.bidScoreReview.upsert({
        where: { expertId_projectId_supplierId: { expertId: dto.expertId, projectId, supplierId: dto.supplierId } },
        update: { status: 'draft', verifiedAt: null },
        create: { expertId: dto.expertId, projectId, supplierId: dto.supplierId, status: 'draft' },
      });
      // 同步专家进度/总分（事务内，复用纯函数，与 ExpertService.submitScores 同口径）
      const { progress, totalScore } = await recomputeExpertProgress(tx, dto.expertId, projectId);
      await tx.bidExpert.update({ where: { id: expert.id }, data: { progress, totalScore } });
      return { record: rec, progress };
    });

    // 非否认审计：此为管理端代评/改分通道（bid_expert 走 expert 模块自评），记录实际操作者与落库分 finalScore
    if (actorId) {
      this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'BID_SCORE_SUBMIT',
          resourceType: `BidProject:${projectId}`,
          details: { expertId: dto.expertId, scoreItemId: dto.scoreItemId, supplierId: dto.supplierId, score: finalScore },
        },
      }).catch((err) => this.logger.error('评分提交审计日志写入失败', err));
    }

    // P1: 评分偏差实时检测（事务外只读 + 广播）
    const existingRows = await this.prisma.bidScoreRecord.findMany({
      where: { scoreItemId: dto.scoreItemId, supplierId: dto.supplierId, expertId: { not: dto.expertId } },
      select: { expertId: true, scoreItemId: true, supplierId: true, score: true },
    });
    const existingScores: ScoreRecordInput[] = (existingRows ?? []).map(r => ({
      expertId: r.expertId, scoreItemId: r.scoreItemId,
      supplierId: r.supplierId, score: Number(r.score),
    }));

    const alert = checkScoreAnomaly(
      { expertId: dto.expertId, scoreItemId: dto.scoreItemId, supplierId: dto.supplierId, score: finalScore },
      existingScores,
    );
    if (alert) {
      this.logger.warn(`[ScoreAnomaly] project=${projectId} ${alert.detail}`);
      this.gateway?.notifyAnomaly(projectId, {
        type: 'score_deviation',
        supplierId: dto.supplierId,
        supplierName: '',
        detail: alert.detail,
        severity: alert.severity,
      });
    }

    // P2: 不再广播分数值（专家独立评审）。仅通知"评分活动"里程碑 + 刷新聚合在场（无分数）。
    this.gateway?.notifyExpertPresence(projectId, {
      expertId: dto.expertId, expertName: expert.expertName, milestone: 'scoring_activity',
      progressPercent: progress,
    });
    return record;
  }

  listScores(projectId: string) {
    return this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      include: { expert: true, scoreItem: true },
    });
  }

  listClarifications(projectId: string) {
    return this.prisma.bidClarification.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async replyClarification(projectId: string, cid: string, dto: ReplyClarificationDto) {
    // P1: 阶段门控 — 归档后不可回复澄清
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (project?.stage === 'ARCHIVED') {
      throw new BadRequestException({ error: '项目已归档，无法回复澄清', code: 'PROJECT_ARCHIVED' });
    }

    const reply = dto.reply;
    const status = dto.status || '已回复';
    // 归属校验：原实现 where:{id:cid} 忽略 projectId，可用项目 A 路径回复项目 B 澄清（IDOR）
    const existingClarification = await this.prisma.bidClarification.findFirst({
      where: { id: cid, projectId },
    });
    if (!existingClarification) {
      throw new BadRequestException({ error: '澄清不存在或不属于此项目', code: 'CLARIFICATION_NOT_IN_PROJECT' });
    }
    const result = await this.prisma.bidClarification.update({
      where: { id: cid }, data: { reply, status },
    });
    // P2: emit real-time reply to project room
    this.gateway?.notifyClarificationReplied(projectId, {
      id: cid, replier: 'host', replyPreview: reply.slice(0, 60),
    });
    return result;
  }

  /** P1-F：AI 起草澄清问题候选（不落库——专家改完再走 createClarification） */
  async draftClarification(projectId: string, supplierId: string) {
    return this.clarificationAi?.draftQuestion(projectId, supplierId) ?? { drafts: [], basis: [] };
  }

  /** P1-F：AI 提炼回复要点 → 写入 BidClarification.aiSummary（供全体评委速读） */
  async summarizeClarification(projectId: string, cid: string) {
    const c = await this.prisma.bidClarification.findFirst({ where: { id: cid, projectId } });
    if (!c || !c.reply) {
      throw new BadRequestException({ error: '澄清不存在或尚未回复', code: 'NO_REPLY' });
    }
    const result = this.clarificationAi ? await this.clarificationAi.summarizeReply(c.question, c.reply) : null;
    if (!result) return { summary: null, keyPoints: [] };
    const aiSummary = `${result.summary}\n${result.keyPoints.map((k) => `· ${k}`).join('\n')}`;
    await this.prisma.bidClarification.update({ where: { id: cid }, data: { aiSummary } });
    return { ...result, aiSummary };
  }

  async createClarification(projectId: string, dto: CreateClarificationDto) {
    // P1: 阶段门控 — 归档后不可发起澄清
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (project?.stage === 'ARCHIVED') {
      throw new BadRequestException({ error: '项目已归档，无法发起澄清', code: 'PROJECT_ARCHIVED' });
    }

    return this.prisma.bidClarification.create({
      data: { projectId, type: dto.type || 'clarification', question: dto.question, issuer: dto.issuer, supplierName: dto.supplierName, supplierId: dto.supplierId || null },
    }).then((created) => {
      this.gateway?.notifyClarificationCreated(projectId, {
        id: created.id, issuer: dto.issuer, issuerRole: 'host',
        supplierName: dto.supplierName, questionPreview: dto.question.slice(0, 60),
      });
      return created;
    });
  }

  listSupervisionLogs(projectId: string) {
    return this.prisma.bidSupervisionLog.findMany({ where: { projectId }, orderBy: { time: 'desc' } });
  }

  listArchives(projectId: string) {
    return this.prisma.bidArchiveItem.findMany({ where: { projectId } });
  }

  /** 一键归档前自动补齐标准归档材料清单（幂等：已存在则跳过） */
  /**
   * Ensure standard archive items exist for a project.
   * When called with a transaction client, uses it; otherwise uses this.prisma.
   */
  private async ensureArchiveItems(projectId: string, tx?: any) {
    const db = tx ?? this.prisma;
    const standards = [
      { name: '招标项目基础信息', ownerRole: '系统' },
      { name: '投标供应商名单', ownerRole: '开标主持人' },
      { name: '开标记录表', ownerRole: '开标主持人' },
      { name: '供应商确认/异议记录', ownerRole: '供应商' },
      { name: '专家评分明细', ownerRole: '评审专家' },
      { name: '评标结果汇总', ownerRole: '评审委员会' },
      { name: '监督日志', ownerRole: '监督人' },
    ];
    // Use a single findMany + createMany to avoid N+1
    const names = standards.map(s => s.name);
    const existing: Array<{ name: string }> = await db.bidArchiveItem.findMany({
      where: { projectId, name: { in: names } },
      select: { name: true },
    });
    const existingNames = new Set(existing.map(e => e.name));
    const missing = standards.filter(s => !existingNames.has(s.name));
    if (missing.length > 0) {
      for (const item of missing) {
        await db.bidArchiveItem.create({
          data: { projectId, name: item.name, ownerRole: item.ownerRole, status: 'PENDING_CONFIRM' },
        });
      }
    }
  }

  /** P1-E：项目级 AI 建议采纳率（仅统计已确认报告的专家 delta；返回总体 + 按评分项） */
  async getAiAdoption(projectId: string) {
    const deltas = await this.prisma.bidScoreDelta.findMany({
      where: { projectId, expertReportConfirmed: true },
    });
    if (deltas.length === 0) return { total: 0, accepted: 0, adoptionRate: null, byItem: [] };
    const itemIds = [...new Set(deltas.map((d) => d.scoreItemId))];
    const items = await this.prisma.bidScoreItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, category: true },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const accepted = deltas.filter((d) => d.accepted).length;
    const byItem = itemIds.map((id) => {
      const ds = deltas.filter((d) => d.scoreItemId === id);
      const avgDelta = ds.reduce((s, d) => s + Number(d.delta), 0) / ds.length;
      return {
        scoreItemId: id,
        name: itemMap.get(id)?.name,
        category: itemMap.get(id)?.category,
        count: ds.length,
        avgDelta: Math.round(avgDelta * 10) / 10,
        accepted: ds.filter((d) => d.accepted).length,
      };
    });
    return {
      total: deltas.length,
      accepted,
      adoptionRate: Math.round((accepted / deltas.length) * 100) / 100,
      byItem,
    };
  }

  /** 归档项目汇总（单次聚合，避免前端逐项目拉详情的 N+1） */
  async getArchiveSummary() {
    const projects = await this.prisma.bidProject.findMany({
      where: { stage: 'ARCHIVED' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectCode: true,
        name: true,
        createdAt: true,
        _count: { select: { archiveItems: true } },
      },
    });

    const ids = projects.map(p => p.id);
    // 批量聚合各项目的已归档项数 + 最后归档时间（单次 groupBy，避免 N+1）
    const archivedAgg = ids.length > 0
      ? await this.prisma.bidArchiveItem.groupBy({
          by: ['projectId'],
          where: { projectId: { in: ids }, status: 'ARCHIVED' },
          _count: { projectId: true },
          _max: { archivedAt: true },
        })
      : [];
    const aggMap = new Map(
      archivedAgg.map(a => [a.projectId, { archived: a._count.projectId, lastAt: a._max.archivedAt }]),
    );

    return projects.map(p => {
      const agg = aggMap.get(p.id);
      const totalItems = p._count.archiveItems;
      const archivedItems = agg?.archived ?? 0;
      return {
        id: p.id,
        projectCode: p.projectCode,
        name: p.name,
        totalItems,
        archivedItems,
        completionRate: totalItems > 0 ? Math.round((archivedItems / totalItems) * 100) : 0,
        lastArchivedAt: agg?.lastAt ?? null,
        createdAt: p.createdAt,
      };
    });
  }

  async archiveAll(id: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'ARCHIVED');

    // P2: 已归档项目幂等返回，不抛异常
    if (project.stage === 'ARCHIVED') {
      return this.prisma.bidProject.findUnique({
        where: { id },
        include: { archiveItems: true },
      });
    }

    // P0: Wrap ALL reads + writes in a single transaction to prevent race conditions.
    // The ensureArchiveItems, counts check, item fetch, and all updates happen atomically.
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 防止”跳过评标”归档：存在已确认的可评供应商但未生成评标结果时阻断
      // G5: 已确认可评供应商必须有对应开标记录（主持人已补录唱标信息），保证归档材料完整
      // 合并 confirmableCount 与 confirmableSuppliers 为一次 findMany 查询（R1 去冗余）
      const [confirmableSuppliers, resultCount] = await Promise.all([
        tx.bidSupplier.findMany({
          where: { projectId: id, decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', submitStatus: { not: '已撤回' } },
          select: { id: true, supplierName: true },
        }),
        tx.bidEvaluationResult.count({ where: { projectId: id } }),
      ]);
      const confirmableCount = confirmableSuppliers.length;
      if (confirmableCount > 0 && resultCount === 0) {
        throw new ConflictException({
          error: '存在已确认的可评供应商，请先生成评标结果再归档',
          code: 'EVALUATION_RESULTS_REQUIRED',
        });
      }

      if (confirmableSuppliers.length > 0) {
        const confirmedSupplierIds = confirmableSuppliers.map(s => s.id);
        const records = await tx.bidOpeningRecord.findMany({
          where: { projectId: id, bidSupplierId: { in: confirmedSupplierIds } },
          select: { bidSupplierId: true },
        });
        const recordedIds = new Set(records.map(r => r.bidSupplierId));
        const missingNames = confirmableSuppliers.filter(s => !recordedIds.has(s.id)).map(s => s.supplierName);
        if (missingNames.length > 0) {
          throw new ConflictException({
            error: `以下供应商缺少开标记录（请补录唱标信息）：${missingNames.join('、')}`,
            code: 'OPENING_RECORDS_MISSING',
          });
        }
      }

      // 自动补齐标准归档材料，避免”无可归档项”阻塞
      await this.ensureArchiveItems(id, tx);

      const archiveItems = await tx.bidArchiveItem.findMany({
        where: { projectId: id, status: { not: 'ARCHIVED' } },
      });

      if (archiveItems.length === 0) {
        throw new BadRequestException({ error: '没有可归档的项目', code: 'NO_ITEMS_TO_ARCHIVE' });
      }

      // P0-4: 逐项 SHA-256 哈希链 — 每个归档项拥有独立哈希，链式防篡改。
      const chain = computeArchiveChain(
        { id: project.id, projectCode: project.projectCode, name: project.name, stage: 'ARCHIVED' },
        archiveItems,
      );

      // 逐项归档更新（各自哈希）+ 项目状态变更 + 监督日志
      for (const item of archiveItems) {
        await tx.bidArchiveItem.update({
          where: { id: item.id },
          data: { status: 'ARCHIVED', hashDigest: chain.get(item.id)!, archivedAt: now },
        });
      }
      await tx.bidProject.update({
        where: { id },
        data: { stage: 'ARCHIVED' },
      });
      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '一键归档', result: `归档 ${archiveItems.length} 项`, riskFlag: '无' },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: 'EVALUATING', to: 'ARCHIVED', stage: 'ARCHIVED', archiveItems: archiveItems.length } },
        });
      }

      return tx.bidProject.findUnique({
        where: { id },
        include: { archiveItems: true },
      });
    });

    this.gateway?.notifyStageChange(id, 'EVALUATING', 'ARCHIVED', 'host');
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: '一键归档', target: project.name, result: `归档 ${result?.archiveItems?.length ?? 0} 项`, riskFlag: '无' });

    // G1: 归档成功后自动生成中标公示草稿（事务外；幂等；不阻塞归档主流程）
    try {
      await this.ensureWinnerNotice(id);
    } catch (e) {
      this.logger.error(`中标公示自动生成失败（不阻塞归档）: ${(e as Error).message}`);
    }

    return result;
  }

  /**
   * 归档后自动生成中标公示草稿（G1）。幂等。
   * 直接写 announcement 表（避免与 AnnouncementService 循环依赖）。
   */
  private async ensureWinnerNotice(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        evaluationResults: { orderBy: { rank: 'asc' }, select: { rank: true, supplierName: true, totalScore: true, averageScore: true, recommended: true } },
      },
    });
    if (!project) return;
    if (!project.evaluationResults || project.evaluationResults.length === 0) {
      this.logger.warn(`项目 ${project.projectCode} 无评标结果，跳过中标公示生成`);
      return;
    }

    const existing = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'WIN_NOTICE' },
      select: { id: true },
    });
    if (existing) return;

    const winner = project.evaluationResults.find(r => r.rank === 1);
    const candidates = project.evaluationResults.filter(r => r.recommended);

    await this.prisma.announcement.create({
      data: {
        title: `中标公示：${project.name}`,
        content: `项目编号 ${project.projectCode}（${project.name}）已完成评标并归档。中标人：${winner?.supplierName ?? '—'}。`,
        type: 'WIN_NOTICE',
        status: 'DRAFT',
        relatedProjectCode: project.projectCode,
        metadata: {
          projectCode: project.projectCode,
          winner: winner ? { supplierName: winner.supplierName, totalScore: Number(winner.totalScore), averageScore: Number(winner.averageScore) } : null,
          candidates: candidates.map(c => ({ rank: c.rank, supplierName: c.supplierName, totalScore: Number(c.totalScore), averageScore: Number(c.averageScore) })),
        },
      },
    });
    this.logger.log(`已自动生成中标公示草稿：${project.projectCode}`);
  }

  /** 查询项目关联的中标公示（G1，草稿或已发布）；无则返回 null */
  async getWinnerNotice(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true },
    });
    if (!project) return null;
    return this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'WIN_NOTICE' },
    });
  }

  async exportArchivePackage(projectId: string, format: 'json' | 'csv' = 'json') {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: { include: { scoreItem: true } } } },
        scoreItems: true,
        clarifications: true,
        supervisionLogs: { orderBy: { time: 'asc' } },
        archiveItems: true,
        evaluationResults: { orderBy: { rank: 'asc' } },
      },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const chain = computeArchiveChain(
      { id: project.id, projectCode: project.projectCode, name: project.name, stage: project.stage },
      project.archiveItems,
    );
    const genesis = project.archiveItems.length > 0
      ? archiveGenesisHash({ id: project.id, projectCode: project.projectCode, name: project.name, stage: project.stage })
      : '';

    // P0-D：AI 辅助说明（模型/prompt 版本 + 每家供应商 AI 评分摘要）
    const aiTask = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      select: {
        aiProvenance: true,
        bidderResults: {
          where: { status: 'COMPLETED' },
          select: { totalScore: true, scoreItems: true, bidSupplier: { select: { supplierName: true } } },
        },
      },
    });
    const aiUsage = aiTask ? buildArchiveAiUsage(aiTask.aiProvenance as any, aiTask.bidderResults as any) : null;

    if (format === 'csv') {
      const BOM = '﻿';
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines: string[] = [];
      lines.push('=== 招标项目基础信息 ===');
      lines.push(['项目编号', '项目名称', '采购方式', '预算', '招标范围', '资质要求', '联系人', '阶段'].map(esc).join(','));
      lines.push([project.projectCode, project.name, project.procurementMethod, project.budget, project.scope, project.qualification, project.contact, project.stage].map(esc).join(','));
      lines.push('');
      lines.push('=== 投标供应商名单 ===');
      lines.push(['供应商名称', '下载状态', '提交状态', '加密状态', '解密状态', '确认状态'].map(esc).join(','));
      project.suppliers.forEach(s => lines.push([s.supplierName, s.downloadStatus, s.submitStatus, s.encryptStatus, s.decryptStatus, s.confirmStatus].map(esc).join(',')));
      lines.push('');
      lines.push('=== 开标记录表 ===');
      lines.push(['供应商', '报价', '工期', '质量目标', '保证金', '解密结果', '确认状态'].map(esc).join(','));
      project.openingRecords.forEach(r => lines.push([r.supplierName, r.amount, r.period, r.qualityTarget, r.bondStatus, r.decryptResult, r.confirmStatus].map(esc).join(',')));
      lines.push('');
      lines.push('=== 供应商确认/异议记录 ===');
      lines.push(['供应商', '确认状态', '异议原因'].map(esc).join(','));
      project.suppliers.filter(s => s.confirmStatus !== 'PENDING').forEach(s => lines.push([s.supplierName, s.confirmStatus, s.decryptError || ''].map(esc).join(',')));
      project.openingRecords.filter(r => r.objectionReason).forEach(r => lines.push([r.supplierName, r.confirmStatus, r.objectionReason || ''].map(esc).join(',')));
      lines.push('');
      lines.push('=== 专家评分明细 ===');
      lines.push(['专家', '供应商', '评分项', '分数', '评语'].map(esc).join(','));
      project.experts.forEach(e => e.scoreRecords.forEach(sr => lines.push([e.expertName, project.suppliers.find(s => s.id === sr.supplierId)?.supplierName || '', sr.scoreItem?.name || '', sr.score, sr.reason].map(esc).join(','))));
      lines.push('');
      lines.push('=== 评标结果汇总 ===');
      lines.push(['排名', '供应商', '总分', '平均分', '推荐'].map(esc).join(','));
      project.evaluationResults.forEach(r => lines.push([String(r.rank), r.supplierName, r.totalScore, r.averageScore, r.recommended ? '是' : '否'].map(esc).join(',')));
      lines.push('');
      lines.push('=== 监督日志 ===');
      lines.push(['时间', '角色', '对象', '操作', '结果', '风险标识'].map(esc).join(','));
      project.supervisionLogs.forEach(l => lines.push([String(l.time), l.role, l.target, l.action, l.result, l.riskFlag].map(esc).join(',')));
      lines.push('');
      lines.push('=== 澄清答疑记录 ===');
      lines.push(['类型', '发起人', '供应商', '问题', '状态', '回复'].map(esc).join(','));
      project.clarifications.forEach(c => lines.push([c.type, c.issuer, c.supplierName, c.question, c.status, c.reply || ''].map(esc).join(',')));
      lines.push('');
      lines.push('=== 档案哈希链验证摘要 ===');
      lines.push(['算法', 'SHA-256'].join(','));
      lines.push(['创世哈希', genesis].join(','));
      const chainArr = Array.from(chain.entries());
      chainArr.forEach(([itemId, hash], i) => {
        const item = project.archiveItems.find(a => a.id === itemId);
        lines.push([`#${i + 1} ${item?.name || itemId}`, hash].map(esc).join(','));
      });
      if (aiUsage) {
        lines.push('');
        lines.push('=== AI 辅助说明 ===');
        lines.push(['模型', aiUsage.model ?? ''].join(','));
        lines.push(['运行时间', aiUsage.ranAt ?? ''].join(','));
        lines.push(['供应商', 'AI建议评分项数', 'AI综合分'].join(','));
        aiUsage.suppliers.forEach(s => lines.push([s.name, s.aiScoredItemsCount, s.aiSuggestedTotal ?? ''].map(esc).join(',')));
      }
      return BOM + lines.join('\n');
    }

    // JSON format
    return {
      manifest: {
        exportedAt: new Date().toISOString(),
        projectId: project.id,
        projectCode: project.projectCode,
        format: 'application/json',
        version: '1.0',
      },
      projectInfo: {
        projectCode: project.projectCode,
        name: project.name,
        procurementMethod: project.procurementMethod,
        budget: project.budget,
        scope: project.scope,
        qualification: project.qualification,
        contact: project.contact,
        stage: project.stage,
      },
      sections: {
        suppliers: project.suppliers.map(s => ({ supplierName: s.supplierName, downloadStatus: s.downloadStatus, submitStatus: s.submitStatus, encryptStatus: s.encryptStatus, decryptStatus: s.decryptStatus, confirmStatus: s.confirmStatus })),
        openingRecords: project.openingRecords,
        expertScores: project.experts.map(e => ({ expertName: e.expertName, major: e.major, scores: e.scoreRecords.map(sr => ({ supplierId: sr.supplierId, scoreItemName: sr.scoreItem?.name, score: sr.score, reason: sr.reason })) })),
        evaluationResults: project.evaluationResults,
        supervisionLogs: project.supervisionLogs,
        clarifications: project.clarifications,
        confirmationRecords: project.suppliers.filter(s => s.confirmStatus !== 'PENDING').map(s => ({ supplierName: s.supplierName, status: s.confirmStatus, error: s.decryptError })),
      },
      hashChain: {
        algorithm: 'SHA-256',
        genesisHash: genesis,
        chain: Array.from(chain.entries()).map(([itemId, hash]) => {
          const item = project.archiveItems.find(a => a.id === itemId);
          return { itemId, name: item?.name, hash };
        }),
      },
      ...(aiUsage ? { aiUsage } : {}),
    };
  }

  /* ── 评分标准编制（评标办法）──
   * 评分项是评标段的前置条件：无评分项则专家无法打分、无法确认报告、无法生成结果。
   * 一旦项目进入评标（专家已开始打分）或归档，评分标准锁定，禁止增删改。 */

  /** 写评分标准审计日志，统一带 operatorId/operatorRole 以便追溯。 */
  private async logScoreStdOp(
    tx: Prisma.TransactionClient,
    projectId: string,
    projectName: string,
    actor: { userId: string; role: string },
    action: string,
    result: string,
  ) {
    await tx.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '开标主持人',
        operatorId: actor.userId, operatorRole: actor.role,
        target: projectName, action, result, riskFlag: '无',
      },
    });
  }

  /** 评分标准仅在 DOWNLOAD/SUBMIT/OPENING 阶段且未发布时可编辑；已发布或进入评标/归档阶段锁定（409）。 */
  private assertScoreItemsEditable(stage: BidStage, publishedAt: Date | null) {
    if (publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED') {
      throw new ConflictException({
        error: '评分标准已发布或项目已进入评标/归档阶段,已锁定',
        code: 'SCORE_ITEMS_LOCKED',
      });
    }
  }

  listScoreItems(projectId: string) {
    return this.prisma.bidScoreItem.findMany({
      where: { projectId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
    });
  }

  async createScoreItem(projectId: string, dto: CreateScoreItemDto, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);
    this.scoreStandardValidator.assertPassFailMaxScore(dto.category, dto.maxScore);

    const result = `新增评分项「${dto.name}」（满分 ${dto.maxScore}）`;
    const created = await this.prisma.$transaction(async (tx) => {
      const item = await tx.bidScoreItem.create({
        data: { projectId, category: dto.category, name: dto.name, maxScore: dto.maxScore },
      });
      await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', result);
      return item;
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result, riskFlag: '无' });
    return created;
  }

  async updateScoreItem(projectId: string, itemId: string, dto: UpdateScoreItemDto, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    const existing = await this.prisma.bidScoreItem.findFirst({ where: { id: itemId, projectId } });
    if (!existing) throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });

    // Task 3: 通过性审查类别(QUALIFICATION/RESPONSIVE) 满分必须为 0
    if (dto.category !== undefined || dto.maxScore !== undefined) {
      const nextCategory = dto.category ?? existing.category;
      const nextMaxScore = dto.maxScore ?? Number(existing.maxScore);
      this.scoreStandardValidator.assertPassFailMaxScore(nextCategory, nextMaxScore);
    }

    const diffs: string[] = [];
    if (dto.category !== undefined && dto.category !== existing.category) diffs.push(`category ${existing.category}→${dto.category}`);
    if (dto.name !== undefined && dto.name !== existing.name) diffs.push(`name ${existing.name}→${dto.name}`);
    if (dto.maxScore !== undefined && Number(dto.maxScore) !== Number(existing.maxScore)) diffs.push(`maxScore ${existing.maxScore}→${dto.maxScore}`);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bidScoreItem.update({
        where: { id: itemId },
        data: {
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.maxScore !== undefined && { maxScore: dto.maxScore }),
        },
      });
      // P0-A：（降）满分后复查 Σ得分点满分 ≤ 新满分，违反不变量则整体回滚
      const newMax = dto.maxScore !== undefined ? Number(dto.maxScore) : Number(existing.maxScore);
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, newMax, 0);
      if (diffs.length > 0) {
        await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', `修改评分项「${existing.name}」:${diffs.join(', ')}`);
      }
      return updated;
    });
  }

  async deleteScoreItem(projectId: string, itemId: string, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    const existing = await this.prisma.bidScoreItem.findFirst({ where: { id: itemId, projectId } });
    if (!existing) throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });

    const result = `删除评分项「${existing.name}」`;
    await this.prisma.$transaction(async (tx) => {
      await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', result);
      await tx.bidScoreItem.delete({ where: { id: itemId } });
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result, riskFlag: '无' });
    return { deleted: true };
  }

  // ── 得分点（checklist 子项）CRUD ──

  private async assertScoreItemInProject(projectId: string, itemId: string) {
    const item = await this.prisma.bidScoreItem.findFirst({
      where: { id: itemId, projectId },
      include: { project: { select: { stage: true, scoreStandardPublishedAt: true } } },
    });
    if (!item) {
      throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });
    }
    this.assertScoreItemsEditable(item.project.stage as BidStage, item.project.scoreStandardPublishedAt);
    return item;
  }

  listScorePoints(projectId: string, itemId: string) {
    return this.prisma.bidScorePoint.findMany({
      where: { scoreItemId: itemId, scoreItem: { projectId } },
      orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createScorePoint(projectId: string, itemId: string, dto: CreateScorePointDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    return this.prisma.$transaction(async (tx) => {
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), Number(dto.fullScore));
      return tx.bidScorePoint.create({
        data: {
          scoreItemId: itemId,
          name: dto.name,
          fullScore: dto.fullScore,
          seq: dto.seq ?? 0,
          evidenceHint: dto.evidenceHint ?? null,
          objective: dto.objective ?? true,
        },
      });
    });
  }

  async updateScorePoint(projectId: string, itemId: string, pointId: string, dto: UpdateScorePointDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    const existing = await this.prisma.bidScorePoint.findFirst({ where: { id: pointId, scoreItemId: itemId } });
    if (!existing) {
      throw new BadRequestException({ error: '得分点不存在', code: 'NOT_FOUND' });
    }
    const delta = dto.fullScore !== undefined ? Number(dto.fullScore) - Number(existing.fullScore) : 0;
    return this.prisma.$transaction(async (tx) => {
      if (delta !== 0) {
        await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), delta);
      }
      return tx.bidScorePoint.update({
        where: { id: pointId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.fullScore !== undefined && { fullScore: dto.fullScore }),
          ...(dto.seq !== undefined && { seq: dto.seq }),
          ...(dto.evidenceHint !== undefined && { evidenceHint: dto.evidenceHint }),
          ...(dto.objective !== undefined && { objective: dto.objective }),
        },
      });
    });
  }

  async deleteScorePoint(projectId: string, itemId: string, pointId: string) {
    await this.assertScoreItemInProject(projectId, itemId);
    const existing = await this.prisma.bidScorePoint.findFirst({ where: { id: pointId, scoreItemId: itemId } });
    if (!existing) {
      throw new BadRequestException({ error: '得分点不存在', code: 'NOT_FOUND' });
    }
    return this.prisma.bidScorePoint.delete({ where: { id: pointId } });
  }

  /** 批量导入得分点（管理员审核 AI 建议后）。复用 assertScoreItemInProject 做归属 + 阶段锁校验。 */
  async batchCreateScorePoints(projectId: string, itemId: string, dto: BatchCreateScorePointsDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    const delta = dto.points.reduce((s, p) => s + Number(p.fullScore), 0);
    return this.prisma.$transaction(async (tx) => {
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), delta);
      return tx.bidScorePoint.createMany({
        data: dto.points.map((p) => ({
          scoreItemId: itemId,
          name: p.name,
          fullScore: p.fullScore,
          evidenceHint: p.evidenceHint ?? null,
          evidenceSection: p.evidenceSection ?? null,
          confidence: p.confidence ?? null,
          objective: p.objective ?? true,
        })),
      });
    });
  }

  /** 应用标准评分模板（幂等：按 name 去重，已存在的项不重复创建）。立即解除新建项目的评标死锁。 */
  async applyScoreItemTemplate(projectId: string, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    const TEMPLATE: Array<{ category: ScoreCategory; name: string; maxScore: number }> = [
      { category: ScoreCategory.QUALIFICATION, name: '资格性审查', maxScore: 0 },
      { category: ScoreCategory.RESPONSIVE, name: '符合性审查', maxScore: 0 },
      { category: ScoreCategory.BUSINESS, name: '商务评分', maxScore: 20 },
      { category: ScoreCategory.TECHNICAL, name: '技术评分', maxScore: 50 },
      { category: ScoreCategory.PRICE, name: '价格评分', maxScore: 30 },
    ];

    const existing = await this.prisma.bidScoreItem.findMany({ where: { projectId }, select: { name: true } });
    const existingNames = new Set(existing.map(e => e.name));
    const toCreate = TEMPLATE.filter(t => !existingNames.has(t.name));

    if (toCreate.length > 0) {
      const result = `应用标准模板，新增 ${toCreate.length} 项`;
      await this.prisma.$transaction(async (tx) => {
        await tx.bidScoreItem.createMany({
          data: toCreate.map(t => ({ projectId, category: t.category, name: t.name, maxScore: t.maxScore })),
        });
        await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', result);
      });
      this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result, riskFlag: '无' });
    }
    return this.listScoreItems(projectId);
  }

  /** 发布评分标准:校验完整性 → 置 publishedAt → 此后写操作锁定。 */
  async publishScoreStandard(projectId: string, actor: { userId: string; role: string; username: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, scoreStandardPublishedAt: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.scoreStandardPublishedAt) {
      throw new ConflictException({ error: '评分标准已发布,不可重复发布', code: 'SCORE_STANDARD_ALREADY_PUBLISHED' });
    }
    await this.scoreStandardValidator.assertScoreStandardComplete(projectId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bidProject.update({
        where: { id: projectId },
        data: { scoreStandardPublishedAt: new Date() },
      });
      await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', '发布评分标准');
      return result;
    });
    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: '发布评分标准', riskFlag: '无' });
    return updated;
  }

  /* ── 评分模板（用户保存的整套评分标准，跨项目复用）── */

  async saveScoreTemplate(projectId: string, name: string, userId?: string, username?: string) {
    const items = await this.prisma.bidScoreItem.findMany({
      where: { projectId },
      include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    });
    if (items.length === 0) {
      throw new BadRequestException({ error: '当前项目尚无评分项，无法保存为模板', code: 'EMPTY' });
    }
    const payload = {
      items: items.map((it) => ({
        category: it.category,
        name: it.name,
        maxScore: Number(it.maxScore),
        points: it.points.map((p) => ({
          name: p.name,
          fullScore: Number(p.fullScore),
          evidenceHint: p.evidenceHint,
          objective: p.objective,
        })),
      })),
    };
    return this.prisma.scoreTemplate.create({
       
      data: { name, payload: payload as any, createdById: userId ?? null, createdByName: username ?? null },
    });
  }

  async listScoreTemplates(userId?: string) {
    return this.prisma.scoreTemplate.findMany({
      where: userId ? { OR: [{ createdById: userId }, { createdById: null }] } : {},
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, createdById: true, createdByName: true, createdAt: true },
    });
  }

  async applyScoreTemplateById(projectId: string, templateId: string, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, scoreStandardPublishedAt: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    const tpl = await this.prisma.scoreTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) throw new BadRequestException({ error: '模板不存在', code: 'NOT_FOUND' });

    const payload = tpl.payload as {
      items: Array<{
        category: ScoreCategory;
        name: string;
        maxScore: number;
        points?: Array<{ name: string; fullScore: number; evidenceHint?: string | null; objective?: boolean }>;
      }>;
    };
    // B1: 通过性类别 maxScore 必须为 0
    for (const it of payload.items) {
      this.scoreStandardValidator.assertPassFailMaxScore(it.category, it.maxScore);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.bidScoreItem.findMany({ where: { projectId }, select: { name: true } });
      const existingNames = new Set(existing.map((e) => e.name));
      const toCreate = payload.items.filter((it) => !existingNames.has(it.name));

      for (const it of toCreate) {
        const item = await tx.bidScoreItem.create({
          data: { projectId, category: it.category, name: it.name, maxScore: it.maxScore },
        });
        if (it.points && it.points.length > 0) {
          await tx.bidScorePoint.createMany({
            data: it.points.map((p) => ({
              scoreItemId: item.id,
              name: p.name,
              fullScore: p.fullScore,
              evidenceHint: p.evidenceHint ?? null,
              objective: p.objective ?? true,
            })),
          });
        }
        // P0-A：模板得分点 ΣfullScore 不得超过该项满分（不变量），违反则整体回滚
        await this.scoreStandardValidator.assertPointsSumWithinMax(tx, item.id, Number(it.maxScore), 0);
      }

      if (toCreate.length > 0) {
        await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', `应用模板「${tpl.name}」新增 ${toCreate.length} 项`);
      }
      return toCreate.length;
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: `应用模板「${tpl.name}」`, riskFlag: '无' });
    return this.listScoreItems(projectId);
  }

  async deleteScoreTemplate(templateId: string, userId?: string) {
    const tpl = await this.prisma.scoreTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, createdById: true },
    });
    if (!tpl) throw new BadRequestException({ error: '模板不存在', code: 'NOT_FOUND' });
    if (tpl.createdById && tpl.createdById !== userId) {
      throw new BadRequestException({ error: '只能删除自己保存的模板', code: 'FORBIDDEN' });
    }
    await this.prisma.scoreTemplate.delete({ where: { id: templateId } });
    return { deleted: true };
  }

  // ── Supervision Annotations ──

  async upsertSupervisionAnnotation(projectId: string, dto: UpsertSupervisionAnnotationDto) {
    // 归属校验：防止 supplierId 指向其它项目的 BidSupplier，写出 projectId=A、supplierId→B 的脏标注
    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: dto.supplierId, projectId },
    });
    if (!bidSupplier) {
      throw new BadRequestException({ error: '供应商不属于此项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
    }
    return this.prisma.bidSupervisionAnnotation.upsert({
      where: { supplierId: dto.supplierId },
      create: {
        projectId,
        supplierId: dto.supplierId,
        status: dto.status,
        notes: dto.notes,
        createdBy: dto.createdBy,
      },
      update: {
        status: dto.status,
        notes: dto.notes,
        createdBy: dto.createdBy,
      },
    });
  }

  async deleteSupervisionAnnotation(projectId: string, supplierId: string) {
    // 归属校验：原实现 where:{supplierId} 忽略 projectId（supplierId 为 @unique），
    // 可跨项目删除任意项目下该供应商的标注
    const existing = await this.prisma.bidSupervisionAnnotation.findFirst({
      where: { supplierId, projectId },
    });
    if (!existing) return null;
    return this.prisma.bidSupervisionAnnotation.delete({
      where: { id: existing.id },
    }).catch(() => null);
  }

  async listSupervisionAnnotations(projectId: string) {
    return this.prisma.bidSupervisionAnnotation.findMany({
      where: { projectId },
    });
  }

  // ── 催办（nudge）：向项目参与者发站内信 + Email 多通道 ──
  // NotificationService.create 已内置多通道：写站内信 → 记 in_app 投递日志 → 异步分发 Email（SMS 待 User.phone 字段后生效）。

  /** 批量创建站内信（逐条调用以触发多通道异步分发）；空列表直接返回。 */
  private async notifyParticipants(
    userIds: string[],
    payload: { type: string; title: string; content: string; link: string },
  ): Promise<void> {
    if (userIds.length === 0) return;
    await Promise.all(
      userIds.map(userId => this.notificationService.create({ userId, ...payload })),
    );
  }

  /**
   * 催促供应商投标/提交。
   * - onlyUnsubmitted=true：仅催未提交者（单一事实来源：SupplierBidSubmission.status，回退 BidSupplier.submitStatus）
   * - 对去重后的 userId 各发一条；写一条 AuditLog 记录催办行为。
   */
  async nudgeSuppliers(id: string, onlyUnsubmitted: boolean, actorId: string): Promise<{ reached: number }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, name: true },
    });
    if (!project) {
      throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    }

    const [roster, submissions] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: id },
        select: { supplierId: true, submitStatus: true, supplier: { select: { userId: true } } },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: id },
        select: { supplierId: true, status: true },
      }),
    ]);

    const subMap = new Map(submissions.map(s => [s.supplierId, s]));
    const userIdSet = new Set<string>();
    for (const entry of roster) {
      const userId = entry.supplier?.userId;
      if (!userId) continue; // 跳过无关联供应商的 roster 项
      const submission = entry.supplierId ? subMap.get(entry.supplierId) : undefined;
      const submitted = submission?.status === 'submitted' || (!submission && entry.submitStatus === '已提交');
      if (onlyUnsubmitted && submitted) continue;
      userIdSet.add(userId);
    }
    const userIds = [...userIdSet];

    await this.notifyParticipants(userIds, {
      type: 'BID_NUDGE_SUPPLIER',
      title: `投标提醒：${project.name}`,
      content: `项目 ${project.projectCode}（${project.name}）正在进行中，请尽快登录供应商门户完成投标提交。`,
      link: `/dashboard`,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'BID_NUDGE_SUPPLIERS',
        resourceType: project.projectCode,
        details: { projectId: id, reached: userIds.length, onlyUnsubmitted },
      },
    });

    return { reached: userIds.length };
  }

  /**
   * 催促专家签到 / 评分。
   * - reason='signin'：仅催未签到者（signedIn=false）
   * - reason='score'：仅催评分未完成者（progress < 100）
   */
  async nudgeExperts(id: string, reason: 'signin' | 'score', actorId: string): Promise<{ reached: number }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, name: true },
    });
    if (!project) {
      throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    }

    const experts = await this.prisma.bidExpert.findMany({
      where: { projectId: id },
      select: { userId: true, signedIn: true, progress: true },
    });

    const userIds = experts
      .filter(e => (reason === 'signin' ? !e.signedIn : (e.progress ?? 0) < 100))
      .map(e => e.userId)
      .filter((u): u is string => !!u);

    const isSignin = reason === 'signin';
    await this.notifyParticipants(userIds, {
      type: 'BID_NUDGE_EXPERT',
      title: `${isSignin ? '评审签到' : '评审进度'}提醒：${project.name}`,
      content: isSignin
        ? `项目 ${project.projectCode}（${project.name}）开评标在即，请尽快登录专家门户完成身份核验与签到。`
        : `项目 ${project.projectCode}（${project.name}）评标进行中，您的评分尚未完成，请尽快登录专家门户完成评分。`,
      link: `/?projectId=${id}`,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'BID_NUDGE_EXPERTS',
        resourceType: project.projectCode,
        details: { projectId: id, reached: userIds.length, reason },
      },
    });

    return { reached: userIds.length };
  }

  /** 通知开标时间变更：向全部投标供应商 + 评标专家发送变更通知 */
  async notifyScheduleChange(id: string, openTime: string, actorId?: string): Promise<{ reached: number }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const [suppliers, experts] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: id },
        select: { supplier: { select: { userId: true } } },
      }),
      this.prisma.bidExpert.findMany({
        where: { projectId: id },
        select: { userId: true },
      }),
    ]);

    const userIdSet = new Set<string>();
    for (const s of suppliers) {
      if (s.supplier?.userId) userIdSet.add(s.supplier.userId);
    }
    for (const e of experts) {
      if (e.userId) userIdSet.add(e.userId);
    }
    const userIds = [...userIdSet];

    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date(openTime);
    const fmt = Number.isNaN(d.getTime())
      ? openTime
      : `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    await this.notifyParticipants(userIds, {
      type: 'BID_SCHEDULE_CHANGE',
      title: `开标时间变更：${project.name}`,
      content: `项目 ${project.projectCode}（${project.name}）开标时间已调整为 ${fmt}，请留意最新安排。`,
      link: `/dashboard`,
    });

    if (actorId) {
      await this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'BID_SCHEDULE_CHANGE_NOTIFY',
          resourceType: project.projectCode,
          details: { projectId: id, reached: userIds.length, openTime: fmt },
        },
      });
    }

    return { reached: userIds.length };
  }

  /**
   * 邀请供应商加入项目名册（BidSupplier）——补齐邀请招标缺失的管理端写入路径。
   * - 仅 DOWNLOAD/SUBMIT 阶段可邀请（开标后名册锁定）
   * - 仅 APPROVED 供应商；已在名册的跳过（幂等）
   * - 给每位新邀供应商发邀请通知（站内信+Email 多通道）；写 AuditLog
   * 名册也是 INVITED 文档访问范围的判定依据，故被邀供应商在 scope=INVITED 时自动获得下载资格。
   */
  async inviteSuppliers(id: string, supplierIds: string[], actorId: string): Promise<{ added: number; skipped: number }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, name: true, stage: true },
    });
    if (!project) {
      throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    }
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new ConflictException({
        error: `当前阶段（${project.stage}）不可邀请供应商，仅发标/投标期可邀请`,
        code: 'STAGE_LOCKED',
      });
    }

    const uniqIds = [...new Set(supplierIds)];
    if (uniqIds.length === 0) return { added: 0, skipped: 0 };

    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: uniqIds }, status: 'APPROVED' },
      select: { id: true, name: true, userId: true },
    });
    const validIds = new Set(suppliers.map(s => s.id));

    const existing = await this.prisma.bidSupplier.findMany({
      where: { projectId: id, supplierId: { in: [...validIds] } },
      select: { supplierId: true },
    });
    const existingSet = new Set(existing.map(e => e.supplierId));

    const toInvite = suppliers.filter(s => !existingSet.has(s.id));
    const skipped = uniqIds.length - toInvite.length;

    if (toInvite.length > 0) {
      await this.prisma.bidSupplier.createMany({
        data: toInvite.map(s => ({ projectId: id, supplierId: s.id, supplierName: s.name })),
        skipDuplicates: true,
      });
    }

    await this.notifyParticipants(
      toInvite.map(s => s.userId).filter((u): u is string => !!u),
      {
        type: 'BID_INVITED',
        title: `招标邀请：${project.name}`,
        content: `您已被邀请参与招标项目 ${project.projectCode}（${project.name}），请尽快登录供应商门户查看招标文件并投标。`,
        link: '/dashboard',
      },
    );

    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'BID_INVITE_SUPPLIERS',
        resourceType: project.projectCode,
        details: { projectId: id, added: toInvite.length, skipped },
      },
    });

    return { added: toInvite.length, skipped };
  }

  // ── 废标复核撤销（决策 D：reportConfirmed 前可逆，之后锁定）──

  async revokeInvalidBid(projectId: string, supplierId: string, scoreItemId: string, actorId: string) {
    // 锁定检查：任一专家 reportConfirmed=true 即不可撤销
    const anyConfirmed = await this.prisma.bidExpert.findFirst({
      where: { projectId, reportConfirmed: true },
    });
    if (anyConfirmed) {
      throw new BadRequestException({ error: '已有专家确认评审报告，废标不可撤销', code: 'LOCKED' });
    }

    const rec = await this.prisma.bidInvalidBid.findUnique({
      where: { projectId_supplierId_scoreItemId: { projectId, supplierId, scoreItemId } },
    });
    if (!rec || rec.status === 'revoked') {
      throw new BadRequestException({ error: '无有效废标记录', code: 'NOT_FOUND' });
    }

    await this.prisma.bidInvalidBid.update({
      where: { id: rec.id },
      data: { status: 'revoked', revokedAt: new Date(), revokedBy: actorId },
    });
    // 仅当该供应商已无任何有效废标记录时才恢复为 valid（多 item 场景：另一 item 仍 invalid）
    const stillInvalid = await this.prisma.bidInvalidBid.findFirst({
      where: { projectId, supplierId, status: 'invalid' },
    });
    if (!stillInvalid) {
      await this.prisma.bidSupplier.update({
        where: { id: supplierId },
        data: { bidValidity: 'valid' },
      });
    }

    // WS 广播：供应商废标状态恢复（专家端取消置灰）
    this.gateway?.notifyBidValidity?.(projectId, {
      supplierId,
      failCount: rec.failCount,
      totalCount: rec.totalCount,
      status: 'revoked',
    });

    // 监督日志：复核撤销废标
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId,
        time: new Date(),
        role: '管理员',
        target: supplierId,
        action: '复核撤销废标',
        result: '恢复有效',
        riskFlag: '中',
      },
    });

    return { revoked: true };
  }
}
