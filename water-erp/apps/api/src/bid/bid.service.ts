import { Injectable, BadRequestException, ConflictException, ForbiddenException, Optional, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
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
import { ResolveOpeningDisputeDto } from './dto/resolve-opening-dispute.dto';
import { UpsertSupervisionAnnotationDto } from './dto/upsert-supervision-annotation.dto';
import { assertBidStageTransition, stageAtLeast, type BidStage } from './bid-state';
import { computeArchiveChain, genesisHash as archiveGenesisHash } from './bid-archive.digest';
import { encryptBuffer, decryptBuffer, streamToBuffer, verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';
import { wrapKey, unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { openField } from '../common/crypto/field-crypto';
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
import { StorageService } from '../storage/storage.service';

@Injectable()
export class BidService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private readonly scoreStandardValidator: ScoreStandardValidator,
    private readonly storage: StorageService,
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
      this.prisma.bidProject.count({ where: { isExtractionOnly: false } }),
      this.prisma.bidProject.count({ where: { stage: { in: ['OPENING', 'EVALUATING', 'SUBMIT'] }, isExtractionOnly: false } }),
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
      where: { isExtractionOnly: false },
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
      ? { stage: { in: stages as BidStage[] }, isExtractionOnly: false }
      : { isExtractionOnly: false };

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
      where: { isExtractionOnly: false },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { suppliers: true, experts: true } },
      },
    });

    const projectIds = projects.map(p => p.id);

    // 批量获取各项目的供应商提交数/专家签到数/开标就绪度计数（单次 groupBy，避免 N+1）
    type CountRow = { projectId: string; _count: { projectId: number } };
    const [submissionCounts, expertSignInCounts, decryptedCounts, confirmedCounts, disputedCounts, openingRecordCounts] = await Promise.all([
      projectIds.length > 0
        ? this.prisma.supplierBidSubmission.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds }, status: 'submitted' },
            _count: { projectId: true },
          })
        : ([] as CountRow[]),
      projectIds.length > 0
        ? this.prisma.bidExpert.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds }, signedIn: true },
            _count: { projectId: true },
          })
        : ([] as CountRow[]),
      projectIds.length > 0
        ? this.prisma.bidSupplier.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds }, decryptStatus: 'SUCCESS' },
            _count: { projectId: true },
          })
        : ([] as CountRow[]),
      projectIds.length > 0
        ? this.prisma.bidSupplier.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds }, confirmStatus: 'CONFIRMED' },
            _count: { projectId: true },
          })
        : ([] as CountRow[]),
      projectIds.length > 0
        ? this.prisma.bidSupplier.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds }, confirmStatus: 'DISPUTED' },
            _count: { projectId: true },
          })
        : ([] as CountRow[]),
      projectIds.length > 0
        ? this.prisma.bidOpeningRecord.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds } },
            _count: { projectId: true },
          })
        : ([] as CountRow[]),
    ]);

    const submittedMap = new Map(submissionCounts.map(s => [s.projectId, s._count.projectId] as [string, number]));
    const signedInMap = new Map(expertSignInCounts.map(e => [e.projectId, e._count.projectId] as [string, number]));
    const decryptedMap = new Map(decryptedCounts.map(r => [r.projectId, r._count.projectId] as [string, number]));
    const confirmedMap = new Map(confirmedCounts.map(r => [r.projectId, r._count.projectId] as [string, number]));
    const disputedMap = new Map(disputedCounts.map(r => [r.projectId, r._count.projectId] as [string, number]));
    const openingRecordMap = new Map(openingRecordCounts.map(r => [r.projectId, r._count.projectId] as [string, number]));

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
        // 开标就绪度信号：驱动 :3007 开标任务板与「开标完成」判定
        decryptedCount: decryptedMap.get(p.id) ?? 0,
        confirmedCount: confirmedMap.get(p.id) ?? 0,
        pendingDisputeCount: disputedMap.get(p.id) ?? 0,
        openingRecordedCount: openingRecordMap.get(p.id) ?? 0,
        readiness,
      };
    });

    const stageCounts = await this.prisma.bidProject.groupBy({
      by: ['stage'],
      where: { isExtractionOnly: false },
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

    const [suppliers, experts, submissions, openingRecordCount] = await Promise.all([
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
      this.prisma.bidOpeningRecord.count({ where: { projectId: id } }),
    ]);
    const subMap = new Map(submissions.map(s => [s.supplierId, s]));

    const supplierRows = suppliers.map(s => {
      const submission = s.supplierId ? (subMap.get(s.supplierId) ?? null) : null;
      // 单一事实来源：有 SupplierBidSubmission 以其 status 为准；否则回退到 BidSupplier.submitStatus
      const submitted = submission?.status === 'submitted' || (!submission && s.submitStatus === '已提交');
      const withdrawn = submission?.status === 'withdrawn';
      // 报价/工期 = 密封入库；仅在解密成功后拆封返回（防采购管理人员开标解密前看到封存报价）。
      // 前端 bid-confirm-panel.tsx 仅消费 submission.submittedAt/bidPrice，其余字段一并透传保持兼容。
      const isUnsealed = s.decryptStatus === 'SUCCESS';
      const safeSubmission = submission
        ? {
          supplierId: submission.supplierId,
          status: submission.status,
          submittedAt: submission.submittedAt,
          bidPrice: isUnsealed && submission.bidPrice ? openField(submission.bidPrice, process.env.KMS_SECRET!) : null,
          deliveryPeriod: isUnsealed ? submission.deliveryPeriod : null,
        }
        : null;
      return {
        id: s.id,
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        classification: s.supplier?.classification?.name,
        downloadStatus: s.downloadStatus,
        submitStatus: s.submitStatus,
        decryptStatus: s.decryptStatus,
        confirmStatus: s.confirmStatus,
        submission: safeSubmission,
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
        // 开标就绪度信号：驱动 :3005 开标进度区块与 :3007「开标完成」判定
        decryptedCount: supplierRows.filter(s => s.decryptStatus === 'SUCCESS').length,
        confirmedCount: supplierRows.filter(s => s.confirmStatus === 'CONFIRMED').length,
        pendingDisputeCount: supplierRows.filter(s => s.confirmStatus === 'DISPUTED').length,
        openingRecordedCount: openingRecordCount,
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
      title: `新采购项目发布：${project.name}`,
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
    // 采购文件下载截止时间（= 公告截止时间），超时不可下载
    const downloadDeadline = metadata.downloadDeadline
      ? new Date(metadata.downloadDeadline)
      : null;

    const project = await this.prisma.bidProject.create({
      data: {
        name: announcement.title,
        projectCode,
        procurementMethod: metadata.method || '公开招标',
        openTime,
        deadline,
        downloadDeadline,
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
    const downloadDeadline = metadata.downloadDeadline ? new Date(metadata.downloadDeadline) : undefined;

    const updated = await this.prisma.bidProject.update({
      where: { id: projectId },
      data: {
        name: announcement.title,
        ...(metadata.method !== undefined && { procurementMethod: metadata.method }),
        ...(openTime && { openTime }),
        ...(deadline && { deadline }),
        ...(downloadDeadline !== undefined && { downloadDeadline }),
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

  /**
   * 完成开标·资料移交（幂等，不改 stage）。
   * 开标执行端 :3007 在开标完成后调用：生成开标文件包（JSON + sha256）存 MinIO，
   * FileAsset 引用挂到 BidOpeningSession，WS 广播 opening:completed，
   * 并向 leader/staff 发站内信（深链直达 :3005 开标确认面板）。
   * 非闸门：:3005 启动评标不依赖本动作（H4 口径独立满足即可）。
   */
  async completeOpening(id: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, name: true, stage: true, procurementMethod: true, openTime: true, deadline: true, projectManagementItemId: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new ConflictException({
        error: `当前阶段 ${project.stage}，仅开标阶段可完成开标移交`,
        code: 'OPENING_STAGE_REQUIRED',
      });
    }
    const existing = await this.prisma.bidOpeningSession.findUnique({ where: { projectId: id } });
    if (!existing) {
      throw new ConflictException({ error: '开标会话尚未组建', code: 'SESSION_NOT_FOUND' });
    }
    // 幂等：已移交直接返回既有产物
    if (existing.status === '开标完成') {
      return {
        status: existing.status,
        handoverAt: existing.handoverAt,
        handoverAssetId: existing.handoverAssetId,
        downloadUrl: existing.handoverAssetId ? `/api/upload/files/${existing.handoverAssetId}` : null,
      };
    }
    await this.assertOpeningDone(id);

    // 文件包与上传放在事务之前：MinIO 失败 → 零数据库副作用，可安全重试
    const pkg = await this.buildHandoverPackage(project, existing);
    const buffer = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
    const objectKey = `bid-opening-handover/${id}.json`;
    await this.storage.upload(objectKey, buffer, 'application/json');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const session = await this.prisma.$transaction(async (tx) => {
      await this.lockAndReassertStage(tx, id, 'OPENING'); // 行锁复查：防并发归档/流标偷跑
      const fresh = await tx.bidOpeningSession.findUnique({ where: { projectId: id } });
      if (fresh?.status === '开标完成') return fresh; // 并发幂等：后提交方走既有产物
      const now = new Date();
      const asset = await tx.fileAsset.create({
        data: {
          key: objectKey,
          originalName: `开标文件包-${project.projectCode}.json`,
          mimeType: 'application/json',
          size: buffer.length,
          sha256,
          category: 'bid_opening_handover',
          uploaderId: actorId ?? null,
        },
      });
      const updated = await tx.bidOpeningSession.update({
        where: { projectId: id },
        data: { status: '开标完成', handoverAt: now, handoverAssetId: asset.id },
      });
      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: now, role: existing.host, target: project.name, action: '完成开标·资料移交', result: '开标文件包已生成并移交采购管理工作台', riskFlag: '无' },
      });
      if (actorId) {
        await tx.auditLog.create({ data: { userId: actorId, action: 'BID_OPENING_HANDOVER', resourceType: `BidProject:${id}`, details: { assetId: asset.id, sha256 } } });
      }
      return updated;
    });

    // 事务后通知（失败不阻塞，同 abort 通知模式）
    this.gateway?.notifyOpeningCompleted(id, {
      handoverAt: (session.handoverAt ?? new Date()).toISOString(),
      handoverAssetId: session.handoverAssetId ?? '',
    });
    this.gateway?.notifySupervisionLog(id, { role: existing.host, action: '完成开标·资料移交', target: project.name, result: '开标文件包已生成并移交采购管理工作台', riskFlag: '无' });
    const pmLink = project.projectManagementItemId
      ? `/projects?projectId=${project.projectManagementItemId}&panel=bid-confirm`
      : '/projects';
    for (const role of ['leader', 'staff']) {
      try {
        await this.notificationService.sendToRole(role, {
          type: 'BID_OPENING_HANDED_OVER',
          title: `项目${project.name}开标完成，资料已移交`,
          content: '开标文件包已生成，可在开标确认面板启动评标或执行后续流程',
          link: pmLink,
        });
      } catch { /* 通知失败不阻塞移交 */ }
    }

    return {
      status: '开标完成',
      handoverAt: session.handoverAt,
      handoverAssetId: session.handoverAssetId,
      downloadUrl: `/api/upload/files/${session.handoverAssetId}`,
    };
  }

  /** 开标文件包：开标环节全部资料（会话/供应商/开标记录/监督日志）+ 内容指纹。 */
  private async buildHandoverPackage(
    project: { id: string; projectCode: string; name: string; procurementMethod: string; openTime: Date; deadline: Date; stage: string },
    session: { host: string; supervisor: string | null; decryptWindowStart: Date; decryptWindowEnd: Date; status: string },
  ) {
    const [suppliers, records, logs] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: project.id },
        select: { supplierName: true, receiptNo: true, encryptStatus: true, decryptStatus: true, confirmStatus: true, submitStatus: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidOpeningRecord.findMany({
        where: { projectId: project.id },
        select: { supplierName: true, amount: true, period: true, qualityTarget: true, bondStatus: true, confirmStatus: true, objectionReason: true, handleResult: true },
      }),
      this.prisma.bidSupervisionLog.findMany({
        where: { projectId: project.id },
        select: { time: true, role: true, action: true, target: true, result: true, riskFlag: true },
        orderBy: { time: 'asc' },
      }),
    ]);
    const active = suppliers.filter(s => s.submitStatus !== '已撤回');
    const summary = {
      supplierTotal: suppliers.length,
      active: active.length,
      decrypted: active.filter(s => s.decryptStatus === 'SUCCESS').length,
      decryptFailed: active.filter(s => s.decryptStatus === 'DANGER').length,
      recorded: records.length,
      confirmed: active.filter(s => s.confirmStatus === 'CONFIRMED').length,
      disputed: active.filter(s => s.confirmStatus === 'DISPUTED').length,
      withdrawn: suppliers.length - active.length,
    };
    const body = {
      packageType: 'BID_OPENING_HANDOVER',
      packageVersion: 1,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id, projectCode: project.projectCode, name: project.name,
        procurementMethod: project.procurementMethod,
        openTime: project.openTime.toISOString(), deadline: project.deadline.toISOString(),
        stage: project.stage,
      },
      session: {
        host: session.host, supervisor: session.supervisor,
        decryptWindowStart: session.decryptWindowStart.toISOString(),
        decryptWindowEnd: session.decryptWindowEnd.toISOString(),
      },
      suppliers,
      openingRecords: records,
      supervisionLogs: logs,
      summary,
    };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return { ...body, fingerprint };
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
      await this.lockAndReassertStage(tx, id, 'SUBMIT'); // C1: 事务内行锁后复查阶段
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'SUBMIT' },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: `开放投递 (${project.stage}→SUBMIT)`, result: '阶段变更成功', riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: project.stage, to: 'SUBMIT', stage: 'SUBMIT' } } });

      return result;
    });

    // Defer WebSocket notifications until after transaction commits
    this.gateway?.notifyStageChange(id, 'DOWNLOAD', 'SUBMIT', 'host');
    this.gateway?.notifySubmissionOpened(id);
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: `开放投递 (${project.stage}→SUBMIT)`, target: project.name, result: '阶段变更成功', riskFlag: '无' });

    return updated;
  }

  /**
   * 流标：将项目标记为 ABORTED。
   * 允许从 SUBMIT 或 OPENING 阶段流转（开标确认后发现供应商不足）。
   * 直接委托（SINGLE_SOURCE）阈值 1，其余阈值 3。
   */
  async abortBidProject(id: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, name: true, stage: true, procurementMethod: true, _count: { select: { suppliers: true } } },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    assertBidStageTransition(project.stage, 'ABORTED');

    // #16 流标业务留痕：riskNote 记录采购方式 + 投标供应商数 + 时间 + 操作人
    // （请求级留痕含操作人 userId 由全局 OperationLogInterceptor 自动记录）
    const supplierCount = project._count.suppliers;
    const abortAt = new Date().toISOString();
    const riskNote = `流标（${project.procurementMethod}，投标供应商 ${supplierCount} 家，${abortAt}${actorId ? `，操作人 ${actorId}` : ''}）`;

    const updated = await this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'ABORTED', riskNote },
      select: { id: true, stage: true },
    });

    // 通知 bid_host 流标
    try {
      await this.notificationService.sendToRole('bid_host', {
        type: 'BID_ABORTED',
        title: `项目${project.name}已流标`,
        content: `招标方式：${project.procurementMethod}，投标供应商 ${supplierCount} 家`,
        link: `/bid?id=${id}`,
      });
    } catch { /* 通知失败不阻塞流标 */ }

    return updated;
  }

  /**
   * 从流标项目创建新采购项目（重新招标）。
   * 复制基础信息（名称/采购方式/预算/范围/资质等），重置阶段为 DOWNLOAD，递增轮次。
   * 原项目 riskNote 追加重启记录。
   */
  async reopenFromAborted(id: string, actorId?: string) {
    const original = await this.prisma.bidProject.findUnique({
      where: { id },
      select: {
        stage: true, name: true, projectCode: true, procurementMethod: true, budget: true,
        scope: true, qualification: true, contact: true, qualityRequirement: true,
        bondRequired: true, bondAmount: true, riskNote: true, round: true,
        projectManagementItemId: true, openTime: true, deadline: true, downloadDeadline: true,
      },
    });
    if (!original) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (original.stage !== 'ABORTED') {
      throw new BadRequestException({ error: '仅流标项目可重启', code: 'PROJECT_NOT_ABORTED' });
    }

    const newCode = `BID-${Date.now()}`;
    const now = new Date();
    const newProject = await this.prisma.bidProject.create({
      data: {
        name: original.name,
        projectCode: newCode,
        procurementMethod: original.procurementMethod,
        openTime: original.openTime,
        deadline: original.deadline,
        downloadDeadline: original.downloadDeadline,
        budget: original.budget,
        scope: original.scope,
        qualification: original.qualification,
        contact: original.contact,
        qualityRequirement: original.qualityRequirement,
        bondRequired: original.bondRequired,
        bondAmount: original.bondAmount,
        round: (original.round ?? 1) + 1,
        projectManagementItemId: original.projectManagementItemId,
        stage: 'DOWNLOAD',
        riskNote: `（从流标项目 ${original.name} 重启，原项目编号 ${original.projectCode ?? id}，操作时间 ${now.toISOString()}${actorId ? `，操作人 ${actorId}` : ''}）`,
      },
    });

    // 原项目 riskNote 追加重启记录
    await this.prisma.bidProject.update({
      where: { id },
      data: { riskNote: `${original.riskNote || ''}｜已于 ${now.toISOString()} 由 ${actorId || '系统'} 重启为新项目 ${newCode}` },
    });

    await this.prisma.bidSupervisionLog.create({
      data: { projectId: id, time: now, role: '系统', target: original.name,
        action: '流标项目重启', result: `创建新项目 ${newCode}（第 ${(original.round ?? 1) + 1} 轮）`, riskFlag: '无' },
    });

    if (actorId) {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_PROJECT_REOPEN', resourceType: `BidProject:${id}`, details: { newProjectId: newProject.id, newCode, round: (original.round ?? 1) + 1 } },
      }).catch(() => {});
    }

    this.logger.log(`流标项目重启: ${original.name} → ${newCode} (round ${(original.round ?? 1) + 1})`);
    return newProject;
  }

  private async startOpeningInternal(id: string, dto?: StartOpeningDto, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true, deadline: true, projectManagementItemId: true, round: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'OPENING');

    // P1: 整个阶段变更 + Session 创建用事务包裹，防止并发竞争
    const isTransitioning = project.stage !== 'OPENING';

    // P1: 截标时间校验——仅阶段推进（确定开标）时要求投标截止已过；
    // 同阶段调用（:3007 组建/更新开标会话）不受 deadline 约束——
    // 否则 :3005 延期开标（updateProject 无阶段门控）后会话将永远建不出来
    if (isTransitioning && new Date() < new Date(project.deadline)) {
      throw new BadRequestException({
        error: '投标截止时间未到，无法启动开标',
        code: 'DEADLINE_NOT_PASSED',
      });
    }

    // 会话必填三项（主持人 + 解密窗口起止）要么全给（组建/更新开标会话），要么全不给（仅推进阶段）。
    // 监督人选填——法律未强制开标现场必须有具名监督人（《招标投标法》第35/36条开标程序不含监督人；
    // 《水利工程建设项目招标投标行政监督暂行规定》第8条行政监督部门「可以派人」为裁量性规定），
    // 字段保留作为监督人登记 / 线上监督责任人。
    // 部分必填字段视为客户端错误，避免静默跳过建会话导致开标流程卡死
    const hasRequiredSessionFields = [dto?.host, dto?.decryptWindowStart, dto?.decryptWindowEnd].every(Boolean);
    const providedAnySessionField = Boolean(dto?.host || dto?.supervisor || dto?.decryptWindowStart || dto?.decryptWindowEnd);
    if (providedAnySessionField && !hasRequiredSessionFields) {
      throw new BadRequestException({
        error: '组建开标会话需提供主持人与解密窗口起止时间（监督人选填）',
        code: 'INCOMPLETE_SESSION_FIELDS',
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

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockAndReassertStage(tx, id, 'OPENING'); // C1: 事务内行锁后复查阶段（同阶段 OPENING→OPENING 幂等放行）
      let sessionUpserted = false;
      if (hasRequiredSessionFields) {
        const existingSession = await tx.bidOpeningSession.findUnique({ where: { projectId: id } });
        const decryptWindowEnd = new Date(dto!.decryptWindowEnd!);
        const remainingSeconds = Math.max(0, Math.floor((decryptWindowEnd.getTime() - Date.now()) / 1000));
        const sessionData = {
          host: dto!.host!,
          supervisor: dto?.supervisor ?? null,
          decryptWindowStart: new Date(dto!.decryptWindowStart!),
          decryptWindowEnd,
          remainingSeconds,
          status: '待开标' as const,
        };
        if (existingSession) {
          await tx.bidOpeningSession.update({ where: { projectId: id }, data: sessionData });
        } else {
          await tx.bidOpeningSession.create({ data: { projectId: id, ...sessionData } });
        }
        sessionUpserted = true;
      }

      const updated = await tx.bidProject.update({
        where: { id },
        data: { stage: 'OPENING' },
      });

      const action = isTransitioning ? `确定开标 (${project.stage}→OPENING)` : '组建开标会话';
      const result = isTransitioning ? '阶段变更成功' : '开标会话已组建/更新';
      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: dto?.host || '系统', target: project.name, action, result, riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: project.stage, to: 'OPENING', stage: 'OPENING', host: dto?.host, supervisor: dto?.supervisor, deadline: project.deadline } } });

      // 阶段联动：关联的 :3005 项目管理项「开标评标」阶段 → IN_PROGRESS（仅首次流转）
      if (isTransitioning) {
        await this.syncPmStage(tx, { projectManagementItemId: project.projectManagementItemId, round: project.round }, 'IN_PROGRESS');
      }

      this.gateway?.notifyStageChange(id, project.stage, 'OPENING', 'host');
      // 仅在真正 upsert 了会话时通知开标启动；裸推阶段（:3005 确定开标）不触发，
      // 否则 :3007 会收到 {host:'系统'} 事件误判会话已建（监督人选填，不再作为触发条件）
      if (sessionUpserted && dto?.host) {
        this.gateway?.notifyOpeningStarted(id, { host: dto.host, supervisor: dto.supervisor ?? null });
      }
      this.gateway?.notifySupervisionLog(id, { role: dto?.host || '系统', action, target: project.name, result, riskFlag: '无' });

      return updated;
    });

    // 流入侧通知：仅阶段推进（:3005 按时开标）时发；:3007 组建会话的同阶段调用不重复发
    if (isTransitioning) {
      try {
        await this.notificationService.sendToRole('bid_host', {
          type: 'BID_OPENING_CONFIRMED',
          title: `项目${project.name}已确定开标`,
          content: '请前往开标大厅组建会话（填写主持人、监督人与解密窗口）',
          link: `/bid/project/${id}`,
        });
      } catch { /* 通知失败不阻塞阶段流转 */ }
    }
    return updated;
  }

  /**
   * 阶段联动：BidProject 流转时同步关联 ProjectManagementItem 的「开标评标」(BID_EVALUATION) 阶段。
   * - IN_PROGRESS 仅从 NOT_STARTED 升级（幂等，不覆盖人工确认过的 COMPLETED）
   * - COMPLETED 带 completedAt；仅当 PM 指针正停在 BID_EVALUATION 时推进到下一阶段
   * - 不复用 ProjectManagementService.updateStage（其 currentStage 守卫与级联 AI 分析副作用不适用于程序化联动）
   * - 无关联（公告/手工创建的项目）→ no-op；置于流转事务末尾，与阶段变更同生共死
   */
  private async syncPmStage(
    tx: any,
    link: { projectManagementItemId: string | null; round: number },
    status: 'IN_PROGRESS' | 'COMPLETED',
  ) {
    if (!link.projectManagementItemId) return;
    await tx.projectManagementStage.updateMany({
      where: {
        projectManagementItemId: link.projectManagementItemId,
        stageKey: 'BID_EVALUATION',
        round: link.round,
        ...(status === 'IN_PROGRESS' ? { status: 'NOT_STARTED' } : {}),
      },
      data: status === 'COMPLETED' ? { status, completedAt: new Date() } : { status },
    });
    const item = await tx.projectManagementItem.findUnique({
      where: { id: link.projectManagementItemId },
      select: {
        currentStage: true,
        stages: { where: { round: link.round }, orderBy: { stageOrder: 'asc' }, select: { stageKey: true } },
      },
    });
    if (!item) return;
    const bidEvalIdx = item.stages.findIndex((s: { stageKey: string }) => s.stageKey === 'BID_EVALUATION');
    const currentIdx = item.stages.findIndex((s: { stageKey: string }) => s.stageKey === item.currentStage);
    if (status === 'IN_PROGRESS' && bidEvalIdx >= 0 && (currentIdx < 0 || currentIdx < bidEvalIdx)) {
      await tx.projectManagementItem.update({ where: { id: link.projectManagementItemId }, data: { currentStage: 'BID_EVALUATION' } });
    } else if (status === 'COMPLETED' && bidEvalIdx >= 0 && currentIdx === bidEvalIdx) {
      const next = item.stages[bidEvalIdx + 1];
      if (next) await tx.projectManagementItem.update({ where: { id: link.projectManagementItemId }, data: { currentStage: next.stageKey } });
    }
  }

  /**
   * C1 修复：事务内行锁后复查阶段，杜绝「事务外 assert + 事务内无条件写」的 TOCTOU。
   * 拿行锁后重读 stage 并重跑状态机断言；并发下后提交的一方在此抛 409，
   * 而非裸覆写已被其他事务推进/归档的阶段（防止 ARCHIVED 复活、防止回退）。
   */
  private async lockAndReassertStage(
    tx: Prisma.TransactionClient,
    id: string,
    target: BidStage,
  ): Promise<{ stage: BidStage; name: string }> {
    await tx.$queryRaw`SELECT id FROM "BidProject" WHERE id = ${id} FOR UPDATE`;
    const fresh = await tx.bidProject.findUnique({ where: { id }, select: { stage: true, name: true } });
    if (!fresh) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(fresh.stage, target);
    return fresh;
  }

  /**
   * H4 共享守卫：开标完成度——未撤回供应商须全部到终局态
   * （SUCCESS+CONFIRMED/EXCEPTION 或 DANGER）。startEvaluation 与
   * completeOpening（开标移交）共用，保证两处永远同口径。
   * 不满足 → 409 OPENING_NOT_DONE（附未到终局态供应商名单）。
   */
  private async assertOpeningDone(id: string): Promise<void> {
    const activeSuppliers = await this.prisma.bidSupplier.findMany({
      where: { projectId: id, submitStatus: { not: '已撤回' } },
      select: { supplierName: true, decryptStatus: true, confirmStatus: true },
    });
    const notReady = activeSuppliers.filter(s => {
      if (s.decryptStatus === 'DANGER') return false;                              // 解密异常已定性
      if (s.decryptStatus !== 'SUCCESS') return true;                              // PENDING/RUNNING 未解密
      return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';   // 解密成功但确认未闭环
    });
    if (notReady.length > 0) {
      throw new ConflictException({
        error: `开标尚未完成，以下供应商未到终局态（解密/确认/异议未结）：${notReady.map(s => s.supplierName).join('、')}`,
        code: 'OPENING_NOT_DONE',
      });
    }
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

    // H4: 开标完成度守卫（抽共享方法，与 completeOpening 同口径）
    await this.assertOpeningDone(id);

    // G9: 评分标准完整(打分类 Σ=100 + 每个打分类项 ≥1 得分点),否则专家无法打分
    await this.scoreStandardValidator.assertScoreStandardComplete(id);

    // R-2：启动评标前扫描投标供应商中的临时过期标记（不阻塞，写入监管日志供主持人确认）
    const expiredTemps = await this.prisma.bidSupplier.findMany({
      where: { projectId: id, submitStatus: { not: '已撤回' }, supplier: { isTemporary: true, temporaryExpiresAt: { lt: new Date() } } },
      select: { supplierName: true },
    });
    if (expiredTemps.length > 0) {
      console.warn(`[R-2] 启动评标 ${project.name} 时 ${expiredTemps.length} 个临时供应商已过期：${expiredTemps.map(s => s.supplierName).join('、')}`);
      await this.prisma.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: `临时过期供应商投标（${expiredTemps.map(s => s.supplierName).join('、')}）`, action: '评标启动时发现投标供应商临时权限已过期，请主持人确认是否排除', result: '待确认', riskFlag: '有' },
      }).catch(() => {});
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockAndReassertStage(tx, id, 'EVALUATING'); // C1: 行锁后复查阶段（含 P1-17 与评分标准编辑互斥的 FOR UPDATE）
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'EVALUATING' },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: `启动评标 (${project.stage}→EVALUATING)`, result: '阶段变更成功', riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: project.stage, to: 'EVALUATING', stage: 'EVALUATING' } } });

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
    this.gateway?.notifyStageChange(id, project.stage, 'EVALUATING', 'host');
    this.gateway?.notifyEvaluationStarted(id);
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: `启动评标 (${project.stage}→EVALUATING)`, target: project.name, result: '阶段变更成功', riskFlag: '无' });

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

    // 通知所有分配专家评标已启动（fire-and-forget，不阻塞）
    try {
      const experts = await this.prisma.bidExpert.findMany({
        where: { projectId: id },
        select: { userId: true, expertName: true },
      });
      for (const expert of experts) {
        if (!expert.userId) continue;
        await this.notificationService.sendToUser(expert.userId, ['in_app'], {
          type: 'BID_EVALUATION_STARTED',
          title: `项目${project.name}已启动评标`,
          content: `您被指派的评标项目「${project.name}」已启动，请登录专家门户查看投标文件并完成独立评分。`,
          link: `/evaluate/${id}`,
        }).catch(() => {});
      }
    } catch { /* 通知失败不阻塞评标启动 */ }

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

      // P0: 解密窗口校验 — 开标未启动或窗口未开启/已关闭/暂停中时拒绝解密
      const session = await tx.bidOpeningSession.findUnique({ where: { projectId } });
      if (!session) {
        throw new BadRequestException({ error: '开标尚未启动，无法解密', code: 'OPENING_NOT_STARTED' });
      }
      if (session.pausedAt) {
        throw new BadRequestException({ error: '开标已暂停，解密操作暂时禁止', code: 'OPENING_PAUSED' });
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
      let allFilesOk = true; // H1: 任一文件缺失/解密失败/完整性失败 → 整体失败，杜绝部分缺失误判 SUCCESS

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
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', decryptError: reason } });
        this.gateway?.notifyDecryptStatus(projectId, supplierId, bidSupplier.supplierName, 'DANGER');
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密异常：${reason}`, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '标书解密', target: bidSupplier.supplierName, result: `解密异常：${reason}`, riskFlag: '高风险' });
        this.gateway?.notifyAnomaly(projectId, { type: 'decrypt_failure', supplierId, supplierName: bidSupplier.supplierName, detail: reason, severity: 'danger' });
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, outcome: 'DANGER', reason, phase: 'no_files' } } });
        // 通知供应商解密失败（fire-and-forget，不阻塞主流程）
        this.notifySupplierDecryptFailure(bidSupplier.supplierId, bidSupplier.supplierName, projectId, reason);
        return tx.bidSupplier.findUnique({ where: { id: supplierId } });
      }

      for (const ref of fileRefs) {
        if (!ref.assetId) continue;
        // P0: Use tx (transaction client) for consistency inside $transaction
        const asset = await tx.fileAsset.findUnique({ where: { id: ref.assetId } });
        if (!asset) { allFilesOk = false; errorMsg = `投标文件记录缺失: ${ref.assetId}`; break; }
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
          if (integrity === false) { allFilesOk = false; integrityOk = false; errorMsg = '标书文件完整性校验失败：SHA-256 不匹配（疑似篡改或损坏）'; break; }
          if (integrity === true) integrityOk = true;
        } catch (e) {
          allFilesOk = false;
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
        : (!allFilesOk
            ? 'DANGER' as const  // H1: 任一文件缺失/解密失败/完整性失败 → 整体 DANGER
            : classifyDecryptOutcome({ hasSealedKey, decryptOk, integrityOk }));

      if (outcome === 'DANGER') {
        const reason = errorMsg || '标书文件校验失败：签名不匹配或文件损坏';
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', decryptError: reason } });
        this.gateway?.notifyDecryptStatus(projectId, supplierId, bidSupplier.supplierName, 'DANGER');
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密异常：${reason}`, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '标书解密', target: bidSupplier.supplierName, result: `解密异常：${reason}`, riskFlag: '高风险' });
        this.gateway?.notifyAnomaly(projectId, { type: 'decrypt_failure', supplierId, supplierName: bidSupplier.supplierName, detail: reason, severity: 'danger' });
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, outcome: 'DANGER', reason, phase: 'decrypt_verify' } } });
        // 通知供应商解密失败（fire-and-forget，不阻塞主流程）
        this.notifySupplierDecryptFailure(bidSupplier.supplierId, bidSupplier.supplierName, projectId, reason);
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

  /**
   * 向供应商发送解密失败通知（fire-and-forget，不阻塞解密主流程）。
   */
  private async notifySupplierDecryptFailure(
    supplierId: string | null,
    supplierName: string,
    projectId: string,
    reason: string,
  ) {
    if (!supplierId) return;
    try {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { userId: true, name: true },
      });
      if (supplier?.userId) {
        await this.notificationService.sendToUser(supplier.userId, ['in_app'], {
          type: 'BID_DECRYPT_FAILED',
          title: `投标文件解密异常：${supplierName}`,
          content: `您在项目中的投标文件解密失败：${reason}。请联系开标主持人处理或等待重新解密。`,
          link: `/supplier/bid/${projectId}`,
        });
      }
    } catch {
      /* 通知失败不阻塞解密流程 */
    }
  }

  /**
   * 主持人显式确认接受供应商解密失败（不可恢复），将供应商标记为 EXCEPTION 终局态。
   * 仅 OPENING 阶段、decryptStatus=DANGER 时可调用。
   */
  async acceptSupplierDanger(projectId: string, supplierId: string, reason: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '仅开标阶段可操作', code: 'PROJECT_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, id: supplierId },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    if (bidSupplier.decryptStatus !== 'DANGER') {
      throw new BadRequestException({ error: '仅解密异常（DANGER）状态的供应商可确认接受', code: 'NOT_DANGER' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { confirmStatus: 'EXCEPTION', decryptError: bidSupplier.decryptError || reason },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: bidSupplier.supplierName,
          action: '确认接受解密失败', result: reason, riskFlag: '高风险',
        },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_ACCEPT_DANGER', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, reason } },
        });
      }
    });

    this.gateway?.notifySupervisionLog(projectId, {
      role: '开标主持人', action: '确认接受解密失败', target: bidSupplier.supplierName,
      result: reason, riskFlag: '高风险',
    });

    return { accepted: true, supplierId, supplierName: bidSupplier.supplierName };
  }

  /**
   * 管理员补传异常投标文件（兜底机制）。
   * SHA-256 闸门：上传文件必须与原始标书逐字节一致（FileAsset.sha256），拒绝替换。
   * 重新加密 → 覆盖 sealedPath/sealedKey → 重置 DANGER → 自动重解密。
   * 仅 OPENING 阶段允许（评标开始后锁死）。
   */
  async reuploadBidFile(
    projectId: string,
    supplierId: string,
    role: string,
    file: Express.Multer.File,
    actorId: string,
  ) {
    // ── 角色字段映射 ──
    const ROLE_MAP = {
      technical:   { assetIdKey: 'technicalFileAssetId',  sealedKeyKey: 'technicalSealedKey'  },
      business:    { assetIdKey: 'businessFileAssetId',   sealedKeyKey: 'businessSealedKey'   },
      coverLetter: { assetIdKey: 'coverLetterAssetId',    sealedKeyKey: 'coverLetterSealedKey'},
    } as const;
    const fields = ROLE_MAP[role as keyof typeof ROLE_MAP];
    if (!fields) throw new BadRequestException({ error: '无效文件角色', code: 'INVALID_ROLE' });

    // ── 阶段门：仅 OPENING ──
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new ForbiddenException({ error: '仅开标阶段可补传投标文件', code: 'STAGE_NOT_OPENING' });
    }

    // ── 查 BidSupplier → SupplierBidSubmission → FileAsset ──
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, id: supplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });

    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
        })
      : null;
    if (!submission) throw new BadRequestException({ error: '供应商未提交投标文件', code: 'NO_SUBMISSION' });

    const assetId = submission[fields.assetIdKey] as string | null;
    if (!assetId) throw new BadRequestException({ error: `缺少${role} 文件引用`, code: 'NO_FILE_REF' });

    const originalAsset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
    if (!originalAsset || !originalAsset.sha256) {
      throw new BadRequestException({ error: '原始文件记录缺失，无法校验', code: 'FILE_RECORD_MISSING' });
    }

    // ── SHA-256 安全闸门：上传文件必须与原始标书逐字节一致 ──
    const uploadSha = crypto.createHash('sha256').update(file.buffer).digest('hex');
    if (uploadSha !== originalAsset.sha256) {
      this.logger.warn(`reupload SHA-256 mismatch: supplier=${bidSupplier.supplierName} role=${role} original=${originalAsset.sha256} upload=${uploadSha} actor=${actorId}`);
      // 安全事件审计：疑似标书替换尝试，通知监督端
      this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
          action: '标书补传拦截', result: `${role} 文件 SHA-256 不匹配，拒绝恢复（疑似替换尝试）`, riskFlag: '高风险' },
      }).catch(() => {});
      this.gateway?.notifyAnomaly(projectId, {
        type: 'tamper_attempt', supplierId, supplierName: bidSupplier.supplierName,
        detail: `${role} 文件补传被拦截：上传文件与原始标书不一致（SHA-256 不匹配）`, severity: 'danger',
      });
      if (actorId) {
        this.prisma.auditLog.create({
          data: { userId: actorId, action: 'BID_FILE_REUPLOAD_REJECTED',
            resourceType: `${bidSupplier.supplierName}:${supplierId}`,
            details: { projectId, role, originalSha256: originalAsset.sha256, uploadSha } },
        }).catch(() => {});
      }
      throw new BadRequestException({
        error: '上传文件与原始标书内容不一致（SHA-256 不匹配），疑似非原始文件，拒绝恢复',
        code: 'FILE_HASH_MISMATCH',
      });
    }

    // ── 重新加密（复用 submitBid 加密管线） ──
    const { ciphertext, decryptKey } = encryptBuffer(file.buffer);
    const wrappedKey = wrapKey(decryptKey, process.env.KMS_SECRET!);
    const sealedPath = `reupload/${projectId}/${supplierId}/${role}-${Date.now()}.enc`;

    try {
      await minioClient.putObject(MINIO_BUCKET, sealedPath, ciphertext, ciphertext.length, {
        'Content-Type': 'application/octet-stream',
      });
    } catch (err) {
      this.logger.error(`reupload MinIO putObject failed: ${sealedPath}`, err);
      throw new BadRequestException({ error: '文件存储失败，请重试', code: 'STORAGE_FAILED' });
    }

    // ── 事务：覆盖文件引用 + 重置 DANGER + 审计三件套 ──
    const sealedKeyUpdate: Record<string, string> = {};
    sealedKeyUpdate[fields.sealedKeyKey] = wrappedKey;

    await this.prisma.$transaction(async (tx) => {
      await tx.fileAsset.update({
        where: { id: assetId },
        // reupload 后文件变为 server-encrypted，清除 E2EE 标记
        data: { sealedPath, encrypted: true, clientEncrypted: false },
      });
      await tx.supplierBidSubmission.update({
        where: { supplierId_projectId: { supplierId: bidSupplier.supplierId!, projectId } },
        data: sealedKeyUpdate as any,
      });
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { decryptStatus: 'PENDING', decryptError: null },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
          action: '标书补传', result: `${role} 文件已恢复（SHA-256 一致）`, riskFlag: '高风险',
        },
      });
      this.gateway?.notifySupervisionLog(projectId, {
        role: '主持人', action: '标书补传', target: bidSupplier.supplierName,
        result: `${role} 文件已恢复（SHA-256 一致）`, riskFlag: '高风险',
      });
      if (actorId) {
        await tx.auditLog.create({
          data: {
            userId: actorId, action: 'BID_FILE_REUPLOAD',
            resourceType: `${bidSupplier.supplierName}:${supplierId}`,
            details: { projectId, role, originalSha256: originalAsset.sha256, uploadSha, phase: 'recovery' },
          },
        });
      }
    });

    // ── 自动重解密（事务外，窗口关了就只修复不重解） ──
    try {
      await this.decryptSupplier(projectId, supplierId, undefined, actorId);
      return { recovered: true, decrypted: true, decryptStatus: 'SUCCESS' };
    } catch (e) {
      this.logger.warn(`reupload auto-decrypt failed (file recovered): ${(e as Error).message}`);
      return { recovered: true, decrypted: false, message: '文件已修复，请点「重试解密」或确认解密窗口是否开启' };
    }
  }

  /**
   * 管理员一键重新封标（兜底机制·主路径）。
   * 从系统内存储的原始明文（FileAsset.key，供应商上传时存入、未删除）恢复：
   * 读取明文 → SHA-256 校验 → 重新加密（当前 KMS_SECRET）→ 覆盖 sealedPath/sealedKey → 重置 DANGER → 自动重解密。
   * 遍历 technical/business/coverLetter 三个角色，有文件引用的都尝试恢复。
   * 仅 OPENING 阶段允许。
   */
  async resealBidFiles(projectId: string, supplierId: string, actorId: string) {
    // ── 阶段门 ──
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new ForbiddenException({ error: '仅开标阶段可重新封标', code: 'STAGE_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, id: supplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
        })
      : null;
    if (!submission) throw new BadRequestException({ error: '供应商未提交投标文件', code: 'NO_SUBMISSION' });

    const ROLE_MAP = {
      technical:   { assetIdKey: 'technicalFileAssetId',  sealedKeyKey: 'technicalSealedKey',  label: '技术标' },
      business:    { assetIdKey: 'businessFileAssetId',   sealedKeyKey: 'businessSealedKey',   label: '商务标' },
      coverLetter: { assetIdKey: 'coverLetterAssetId',    sealedKeyKey: 'coverLetterSealedKey', label: '投标函' },
    } as const;

    const recovered: string[] = [];
    const failed: Array<{ role: string; label: string; code: string; error: string }> = [];

    for (const [role, fields] of Object.entries(ROLE_MAP)) {
      const assetId = submission[fields.assetIdKey as keyof typeof submission] as string | null;
      if (!assetId) continue; // 该角色无文件引用，跳过

      const originalAsset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
      if (!originalAsset || !originalAsset.sha256 || !originalAsset.key) {
        failed.push({ role, label: fields.label, code: 'FILE_RECORD_MISSING', error: '原始文件记录缺失' });
        continue;
      }

      if (originalAsset.clientEncrypted) {
        // ── E2EE 分支：密文在 asset.key，无需重加密。仅重新包裹 DEK（支持 KMS 轮转）──
        const oldSealedKey = submission?.[fields.sealedKeyKey as keyof typeof submission] as string | undefined;
        if (!oldSealedKey || !isWrappedKey(oldSealedKey)) {
          failed.push({ role, label: fields.label, code: 'MISSING_E2EE_KEY', error: 'E2EE 文件缺少有效 sealedKey' });
          continue;
        }
        const oldDek = unwrapKey(oldSealedKey, process.env.KMS_SECRET!);
        const wrappedKey = wrapKey(oldDek, process.env.KMS_SECRET!);

        // sealedPath 不变（密文已在 asset.key），仅更新 wrappedKey
        const sealedKeyUpdate: Record<string, string> = {};
        sealedKeyUpdate[fields.sealedKeyKey] = wrappedKey;

        await this.prisma.$transaction(async (tx) => {
          await tx.supplierBidSubmission.update({
            where: { supplierId_projectId: { supplierId: bidSupplier.supplierId!, projectId } },
            data: sealedKeyUpdate as any,
          });
          await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'PENDING', decryptError: null } });
          await tx.bidSupervisionLog.create({
            data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
              action: '重新封标', result: `${fields.label}（E2EE）已重新包裹密钥`, riskFlag: '低风险' },
          });
          if (actorId) {
            await tx.auditLog.create({
              data: { userId: actorId, action: 'BID_FILE_RESEAL', resourceType: `${bidSupplier.supplierName}:${supplierId}`,
                details: { projectId, role, e2ee: true } },
            });
          }
        });
        recovered.push(fields.label);
        continue;
      }

      // 从 FileAsset.key 读取原始明文（供应商上传时存入，submitBid 不删除）
      let plaintext: Buffer;
      try {
        plaintext = await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, originalAsset.key));
      } catch (err) {
        this.logger.error(`reseal getObject failed: ${originalAsset.key}`, err);
        failed.push({ role, label: fields.label, code: 'ORIGINAL_FILE_MISSING', error: '原始文件已丢失（MinIO 对象不存在）' });
        continue;
      }

      // SHA-256 校验原始明文完整性
      const plaintextSha = crypto.createHash('sha256').update(plaintext).digest('hex');
      if (plaintextSha !== originalAsset.sha256) {
        this.logger.warn(`reseal plaintext SHA-256 mismatch: asset=${assetId} stored=${originalAsset.sha256} actual=${plaintextSha}`);
        failed.push({ role, label: fields.label, code: 'ORIGINAL_FILE_CORRUPT', error: '原始文件已损坏（SHA-256 不匹配）' });
        continue;
      }

      // 重新加密（用当前 KMS_SECRET）
      const { ciphertext, decryptKey } = encryptBuffer(plaintext);
      const wrappedKey = wrapKey(decryptKey, process.env.KMS_SECRET!);
      const sealedPath = `reseal/${projectId}/${supplierId}/${role}-${Date.now()}.enc`;
      await minioClient.putObject(MINIO_BUCKET, sealedPath, ciphertext, ciphertext.length, {
        'Content-Type': 'application/octet-stream',
      });

      // 事务：覆盖文件引用 + 重置 DANGER + 审计
      const sealedKeyUpdate: Record<string, string> = {};
      sealedKeyUpdate[fields.sealedKeyKey] = wrappedKey;

      await this.prisma.$transaction(async (tx) => {
        await tx.fileAsset.update({ where: { id: assetId }, data: { sealedPath, encrypted: true } });
        await tx.supplierBidSubmission.update({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId!, projectId } },
          data: sealedKeyUpdate as any,
        });
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'PENDING', decryptError: null } });
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
            action: '重新封标', result: `${fields.label} 已从原始明文恢复`, riskFlag: '高风险' },
        });
        if (actorId) {
          await tx.auditLog.create({
            data: { userId: actorId, action: 'BID_FILE_RESEAL', resourceType: `${bidSupplier.supplierName}:${supplierId}`,
              details: { projectId, role, sha256: originalAsset.sha256 } },
          });
        }
      });
      recovered.push(fields.label);
    }

    if (recovered.length > 0) {
      this.gateway?.notifySupervisionLog(projectId, {
        role: '主持人', action: '重新封标', target: bidSupplier.supplierName,
        result: `${recovered.join('、')} 已恢复`, riskFlag: '高风险',
      });
    }

    // 文件校验失败（损坏/篡改/丢失）：安全事件，通知监督端并审计
    if (failed.length > 0) {
      const failDetail = failed.map(f => `${f.label}: ${f.error}`).join('；');
      // 全部失败时标记投标无效 + 更新 decryptError：前端据此隐藏「重试」按钮，改为显示"文件损坏"
      if (recovered.length === 0) {
        const invalidReason = `投标文件损坏无法恢复：${failDetail}。该供应商投标视为无效，将自动排除出评标`;
        await this.prisma.bidSupplier.update({
          where: { id: supplierId },
          data: { decryptError: `重新封标失败：${failDetail}`, bidValidity: 'invalid' },
        });
        // 监督日志 + 异常事件中明确呈现无效原因
        await this.prisma.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
            action: '投标无效', result: invalidReason, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, {
          role: '主持人', action: '投标无效', target: bidSupplier.supplierName,
          result: invalidReason, riskFlag: '高风险',
        });
        this.gateway?.notifyAnomaly(projectId, {
          type: 'file_corruption', supplierId, supplierName: bidSupplier.supplierName,
          detail: invalidReason, severity: 'danger',
        });
      } else {
        // 部分失败：记录异常 + 标记 bidValidity=invalid（部分文件不可恢复则整体不可评）
        await this.prisma.bidSupplier.update({
          where: { id: supplierId },
          data: { decryptError: `重新封标部分失败：${failDetail}`, bidValidity: 'invalid', confirmStatus: 'EXCEPTION' },
        });
        await this.prisma.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
            action: '重新封标异常', result: failDetail, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, {
          role: '主持人', action: '重新封标异常', target: bidSupplier.supplierName,
          result: failDetail, riskFlag: '高风险',
        });
        this.gateway?.notifyAnomaly(projectId, {
          type: 'file_corruption', supplierId, supplierName: bidSupplier.supplierName,
          detail: failDetail, severity: 'danger',
        });
      }
      if (actorId) {
        await this.prisma.auditLog.create({
          data: { userId: actorId, action: 'BID_FILE_RESEAL_FAILED',
            resourceType: `${bidSupplier.supplierName}:${supplierId}`,
            details: { projectId, failed } },
        });
      }
    }

    // 自动重解密
    let decrypted = false;
    if (recovered.length > 0) {
      try {
        await this.decryptSupplier(projectId, supplierId, undefined, actorId);
        decrypted = true;
      } catch (e) {
        this.logger.warn(`reseal auto-decrypt failed: ${(e as Error).message}`);
      }
    }

    return {
      recovered, failed, decrypted,
      message: recovered.length > 0
        ? `${recovered.join('、')} 已恢复${decrypted ? '并重新解密成功' : ''}`
        : '无文件可恢复',
    };
  }

  /**
   * 管理员重新加载招标文件（兜底机制）。
   * 招标文件一定在系统内（开标前提），此方法：
   * 1. 用完整 OR 条件查找（bidProjectId 或 projectCode 反查）
   * 2. 自动修复 bidProjectId 关联（getTenderDocument 只按 bidProjectId 查）
   * 3. 验证可解密（MinIO 密文 → unwrapKey → decryptBuffer）
   */
  async reloadTenderDocument(projectId: string, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, projectCode: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // 用完整 OR 条件查找（与 downloadTenderDocument 一致）
    const doc = await this.prisma.bidDocument.findFirst({
      where: {
        OR: [
          { bidProjectId: projectId },
          { announcement: { relatedProjectCode: project.projectCode ?? '' } },
        ],
      },
      include: { fileAsset: true },
    });

    if (!doc?.fileAsset) {
      return { status: 'missing' as const, message: '未找到招标文件，请确认已在 :3005 上传招标文件' };
    }

    // 如果 bidProjectId 未关联到当前项目，自动修复（getTenderDocument 只按 bidProjectId 查）
    let bidProjectIdFixed = false;
    if (!doc.bidProjectId) {
      await this.prisma.bidDocument.update({
        where: { id: doc.id },
        data: { bidProjectId: projectId },
      });
      bidProjectIdFixed = true;
    }

    // 验证可解密
    try {
      const ciphertext = await streamToBuffer(
        await minioClient.getObject(MINIO_BUCKET, doc.fileAsset.key),
      );
      const rawKey = isWrappedKey(doc.decryptKey)
        ? unwrapKey(doc.decryptKey, process.env.KMS_SECRET!)
        : doc.decryptKey;
      decryptBuffer(ciphertext, rawKey);

      if (actorId) {
        await this.prisma.auditLog.create({
          data: {
            userId: actorId, action: 'BID_TENDER_DOC_RELOAD',
            resourceType: `project:${projectId}`,
            details: { fileName: doc.fileAsset.originalName, bidProjectIdFixed },
          },
        });
      }

      return {
        status: 'ok' as const,
        message: bidProjectIdFixed
          ? `招标文件已关联并验证通过（${doc.fileAsset.originalName}）`
          : `招标文件可正常访问（${doc.fileAsset.originalName}）`,
      };
    } catch (err) {
      this.logger.warn(`reload tender document decrypt failed: ${(err as Error).message}`);
      return {
        status: 'decrypt_failed' as const,
        message: `招标文件解密失败：${(err as Error).message}，请在 :3005 重新上传招标文件`,
      };
    }
  }

  async getOpeningSession(projectId: string) {
    return this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
  }

  /** 注册主持人为当前操作者（并发检测）。返回是否已有其他主持人在操作。 */
  async claimActiveHost(projectId: string, userId: string, userName: string): Promise<{ claimed: boolean; existingHost?: string }> {
    const session = await this.prisma.bidOpeningSession.findUnique({
      where: { projectId }, select: { activeHostId: true, activeHostName: true },
    });
    if (session?.activeHostId && session.activeHostId !== userId) {
      return { claimed: false, existingHost: session.activeHostName ?? session.activeHostId };
    }
    await this.prisma.bidOpeningSession.update({
      where: { projectId },
      data: { activeHostId: userId, activeHostName: userName },
    });
    return { claimed: true };
  }

  /** 释放主持人操作者身份。仅当调用者是当前 activeHost 时才清除。 */
  async releaseActiveHost(projectId: string, userId: string): Promise<void> {
    await this.prisma.bidOpeningSession.updateMany({
      where: { projectId, activeHostId: userId },
      data: { activeHostId: null, activeHostName: null },
    });
  }

  /** 暂停开标：冻结解密窗口倒计时，暂停期间拒绝解密。 */
  async pauseOpening(projectId: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '仅开标阶段可暂停', code: 'PROJECT_NOT_OPENING' });
    }

    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) throw new BadRequestException({ error: '开标会话不存在', code: 'SESSION_NOT_FOUND' });
    if (session.pausedAt) throw new BadRequestException({ error: '开标已处于暂停状态', code: 'ALREADY_PAUSED' });

    const now = new Date();
    await this.prisma.bidOpeningSession.update({
      where: { projectId },
      data: { pausedAt: now },
    });

    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: now, role: '开标主持人', target: project.name,
        action: '暂停开标', result: '解密窗口倒计时已冻结，解密操作被禁止', riskFlag: '中风险' },
    }).catch(() => {});
    if (actorId) {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_OPENING_PAUSED', resourceType: `BidProject:${projectId}`, details: { pausedAt: now.toISOString() } },
      }).catch(() => {});
    }

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '暂停开标', target: project.name, result: '解密窗口倒计时已冻结', riskFlag: '中风险' });
    return { paused: true, pausedAt: now.toISOString() };
  }

  /** 恢复开标：解冻解密窗口，补偿暂停时长到 decryptWindowEnd。 */
  async resumeOpening(projectId: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '仅开标阶段可恢复', code: 'PROJECT_NOT_OPENING' });
    }

    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) throw new BadRequestException({ error: '开标会话不存在', code: 'SESSION_NOT_FOUND' });
    if (!session.pausedAt) throw new BadRequestException({ error: '开标未处于暂停状态', code: 'NOT_PAUSED' });

    const now = new Date();
    const pausedMs = now.getTime() - new Date(session.pausedAt).getTime();
    const newTotalPausedMs = (session.totalPausedMs ?? 0) + pausedMs;
    const newEnd = new Date(session.decryptWindowEnd.getTime() + pausedMs);

    await this.prisma.bidOpeningSession.update({
      where: { projectId },
      data: {
        pausedAt: null,
        totalPausedMs: newTotalPausedMs,
        decryptWindowEnd: newEnd,
        remainingSeconds: Math.max(0, Math.floor((newEnd.getTime() - now.getTime()) / 1000)),
      },
    });

    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: now, role: '开标主持人', target: project.name,
        action: '恢复开标', result: `暂停时长 ${Math.round(pausedMs / 1000)} 秒，窗口已补偿延长`, riskFlag: '中风险' },
    }).catch(() => {});
    if (actorId) {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_OPENING_RESUMED', resourceType: `BidProject:${projectId}`, details: { pausedMs, totalPausedMs: newTotalPausedMs } },
      }).catch(() => {});
    }

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '恢复开标', target: project.name, result: `暂停 ${Math.round(pausedMs / 1000)}s，窗口已补偿延长`, riskFlag: '中风险' });
    return { resumed: true, pausedMs, totalPausedMs: newTotalPausedMs, newDecryptWindowEnd: newEnd.toISOString() };
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
      // bidPrice 入库已密封；此处 canView=true 已保证 decryptStatus==='SUCCESS'，安全拆封。
      // 旧明文数据经 openField legacy 兼容原样返回。
      amount: submission?.bidPrice ? openField(submission.bidPrice, process.env.KMS_SECRET!) : null,
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
      select: { id: true, supplierName: true, decryptStatus: true, confirmStatus: true },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '投标记录不存在', code: 'BID_SUPPLIER_NOT_FOUND' });
    if (bidSupplier.decryptStatus !== 'SUCCESS') {
      throw new BadRequestException({ error: '标书尚未解密成功，无法录入唱标信息', code: 'NOT_DECRYPTED' });
    }
    // H11: 供应商已确认的记录禁止覆盖——否则记录回「待供应商确认」而供应商侧仍 CONFIRMED，
    // generateEvaluationResults 只看 bidSupplier.confirmStatus，主持人单方改报价会默认生效。
    if (bidSupplier.confirmStatus === 'CONFIRMED') {
      throw new ConflictException({ error: '该供应商已确认开标记录，禁止覆盖唱标信息', code: 'RECORD_ALREADY_CONFIRMED' });
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
      // 状态门（Wave4a-I1）：已确认/异议/已处理的记录不得被唱标重录覆写——否则异议态记录被
      // 覆写回「待供应商确认」（objectionReason 残留）后 resolve 撞 R7 状态门 400，bidSupplier
      // 永久停留 DISPUTED 并被 generateEvaluationResults 静默排除（R7 引入的交互回归楔子）。
      const LOCKED = ['供应商已确认', '供应商提出异议', '异议已处理-确认', '异议已处理-退回'];
      if (existing && LOCKED.includes(existing.confirmStatus)) {
        throw new ConflictException({
          error: `开标记录处于「${existing.confirmStatus}」状态，不得重录唱标；请通过异议处理结果（维持/退回）完成闭环`,
          code: 'RECORD_LOCKED',
        });
      }
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

  async resolveOpeningDispute(projectId: string, recordId: string, dto: ResolveOpeningDisputeDto, actorId?: string) {
    const record = await this.prisma.bidOpeningRecord.findFirst({ where: { id: recordId, projectId } });
    if (!record) throw new BadRequestException({ error: '开标记录不存在', code: 'NOT_FOUND' });

    // P0: 阶段门控 — 仅在开标阶段可处理异议
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法处理异议', code: 'PROJECT_NOT_OPENING' });
    }

    // R7：状态机门 — 仅「供应商提出异议」态记录可处理。旧实现不校验记录态：主持人可"处理"
    // 从未被异议的记录（翻转确认态）、对已处理记录反复覆盖。阶段门控之后、事务之前拦截。
    if (record.confirmStatus !== '供应商提出异议') {
      throw new BadRequestException({ error: '该记录不处于异议待处理状态', code: 'DISPUTE_NOT_PENDING' });
    }

    const now = new Date();
    const confirmStatus = dto.confirm ? '异议已处理-确认' : '异议已处理-退回';
    // Wave4a-M5：监督日志记态迁移（前态 → 后态：处理结果），便于监督端回放异议闭环
    const supervisionResult = `供应商提出异议 → ${confirmStatus}：${dto.result}`;

    // P0: Wrap record update + supplier update + supervision log in transaction
    await this.prisma.$transaction(async (tx) => {
      // Wave4a-M4：事务内条件更新是并发防线——事务外的状态门基于 stale read，并发双处理都过门时
      // 仅首笔命中异议待处理行（count=1），第二笔 count=0 → 400，杜绝双落（与 R6 原子抢占同构）。
      // H6 并入：updateMany 同时写 handledBy 操作者留痕。
      const res = await tx.bidOpeningRecord.updateMany({
        where: { id: recordId, confirmStatus: '供应商提出异议' },
        data: { confirmStatus, handleResult: dto.result, handledAt: now, handledBy: actorId ?? null },
      });
      if (res.count === 0) {
        throw new BadRequestException({ error: '该异议已被处理', code: 'DISPUTE_NOT_PENDING' });
      }
      if (record.bidSupplierId) {
        await tx.bidSupplier.update({
          where: { id: record.bidSupplierId },
          data: { confirmStatus: dto.confirm ? 'CONFIRMED' : 'EXCEPTION' },
        });
      }
      // 全清 DISPUTED → 清除 disputedSince
      const remainingDisputed = await tx.bidSupplier.count({
        where: { projectId, confirmStatus: 'DISPUTED', submitStatus: { not: '已撤回' } },
      });
      if (remainingDisputed === 0) {
        await tx.bidOpeningSession.update({ where: { projectId }, data: { disputedSince: null } });
      }
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: now, role: '开标主持人', target: record.supplierName,
          action: '处理开标异议', result: supervisionResult, riskFlag: '中风险',
        },
      });
      // H6: 操作者留痕（开标异议处理是法定留痕环节）
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_DISPUTE_RESOLVE', resourceType: `BidOpeningRecord:${recordId}`, details: { projectId, confirm: dto.confirm, result: dto.result } },
        });
      }
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '处理开标异议', target: record.supplierName, result: supervisionResult, riskFlag: '中风险' });
    if (record.bidSupplierId) {
      const bs = await this.prisma.bidSupplier.findUnique({
        where: { id: record.bidSupplierId },
        select: { supplierId: true },
      });
      if (bs?.supplierId) {
        this.gateway?.notifyOpeningDisputeResolved(projectId, bs.supplierId, {
          projectId, supplierId: bs.supplierId, supplierName: record.supplierName,
          recordId, confirm: dto.confirm, result: dto.result, timestamp: Date.now(),
        });
        // 发送站内信通知供应商异议处理结果（fire-and-forget）
        try {
          const supplier = await this.prisma.supplier.findUnique({
            where: { id: bs.supplierId }, select: { userId: true },
          });
          if (supplier?.userId) {
            await this.notificationService.sendToUser(supplier.userId, ['in_app'], {
              type: 'BID_DISPUTE_RESOLVED',
              title: `开标异议已处理：${record.supplierName}`,
              content: dto.confirm
                ? `您的异议已确认受理：${dto.result}`
                : `您的异议已处理（退回）：${dto.result}`,
              link: `/supplier/bid/${projectId}`,
            });
          }
        } catch { /* 通知失败不阻塞异议处理 */ }
      }
    }
    return this.prisma.bidOpeningRecord.findUnique({ where: { id: recordId } });
  }

  /**
   * 强制裁决异议（监督人应急通道）。
   * 当供应商 DISPUTED 导致项目永久卡死时，leader/admin 可直接覆盖 DISPUTED→EXCEPTION。
   * 要求提供书面理由（入 audit log），写高风险监督日志。
   */
  async overrideDispute(projectId: string, supplierId: string, reason: string, actorId?: string) {
    if (!reason?.trim()) throw new BadRequestException({ error: '请填写强制裁决理由', code: 'MISSING_REASON' });

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段', code: 'PROJECT_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, id: supplierId },
      select: { id: true, supplierName: true, confirmStatus: true, decryptStatus: true },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    if (bidSupplier.confirmStatus !== 'DISPUTED') {
      throw new BadRequestException({ error: '仅异议中（DISPUTED）的供应商可被强制裁决', code: 'NOT_DISPUTED' });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // 将关联的开标记录同步更新（如有）
      const record = await tx.bidOpeningRecord.findFirst({
        where: { projectId, bidSupplierId: supplierId },
      });
      if (record && record.confirmStatus === '供应商提出异议') {
        await tx.bidOpeningRecord.update({
          where: { id: record.id },
          data: { confirmStatus: '异议已处理-退回', handleResult: `[强制裁决] ${reason}`, handledAt: now, handledBy: actorId ?? null },
        });
      }
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { confirmStatus: 'EXCEPTION' },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: now, role: '监督人', target: bidSupplier.supplierName,
          action: '强制裁决异议', result: `DISPUTED→EXCEPTION：${reason}`, riskFlag: '高风险',
        },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_DISPUTE_OVERRIDE', resourceType: `BidSupplier:${supplierId}`, details: { projectId, reason } },
        });
      }
      // 全清 DISPUTED → 清除 disputedSince
      const remaining = await tx.bidSupplier.count({ where: { projectId, confirmStatus: 'DISPUTED', submitStatus: { not: '已撤回' } } });
      if (remaining === 0) {
        await tx.bidOpeningSession.update({ where: { projectId }, data: { disputedSince: null } });
      }
    });

    this.gateway?.notifySupervisionLog(projectId, {
      role: '监督人', action: '强制裁决异议', target: bidSupplier.supplierName,
      result: `DISPUTED→EXCEPTION：${reason}`, riskFlag: '高风险',
    });

    return { overridden: true, supplierId, supplierName: bidSupplier.supplierName };
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

      // H2: 已撤销的废标（管理员复核 revokeInvalidBid）不计入失败票——否则撤销被本重算静默推翻
      const revokedInvalidBids = await this.prisma.bidInvalidBid.findMany({
        where: { projectId, status: 'revoked' },
        select: { supplierId: true, scoreItemId: true },
      });
      const revokedKeys = new Set(revokedInvalidBids.map(r => `${r.supplierId}:${r.scoreItemId}`));

      for (const supplier of activeSuppliers) {
        const records = recordsBySupplier.get(supplier.id) ?? [];
        let disqualified = false;
        // 逐项统计
        const byItem = new Map<string, { fail: number; total: number }>();
        for (const r of records) {
          if (!passFailItemIds.has(r.scoreItemId) || r.passed === null || r.passed === undefined) continue;
          if (revokedKeys.has(`${supplier.id}:${r.scoreItemId}`)) continue; // H2: 已撤销废标不计入失败票
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
    // 合格者在前、废标者在后；同组内按 averageScore 降序；同分按供应商名确定性排序（P2：tiebreaker，结果可复现）
    ranked.sort((a, b) => {
      if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
      return a.supplierName.localeCompare(b.supplierName, 'zh-CN');
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

  /** 独立验证归档哈希链完整性（只读）。对比存储 hashDigest 与重算值，返回逐项比对结果。 */
  async verifyArchiveIntegrity(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, name: true, stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'ARCHIVED') {
      throw new BadRequestException({ error: '项目未归档，无法验证', code: 'PROJECT_NOT_ARCHIVED' });
    }

    const archiveItems = await this.prisma.bidArchiveItem.findMany({
      where: { projectId, status: 'ARCHIVED' },
    });
    if (archiveItems.length === 0) {
      return { valid: true, checkedAt: new Date().toISOString(), totalItems: 0, mismatches: [] };
    }

    // 重算哈希链（与 archiveAll 同口径：status 视为 ARCHIVED）
    const chain = computeArchiveChain(
      { id: project.id, projectCode: project.projectCode, name: project.name, stage: 'ARCHIVED' },
      archiveItems.map(i => ({ ...i, status: 'ARCHIVED' as const })),
    );

    const mismatches: Array<{ itemId: string; itemName: string; stored: string; computed: string }> = [];
    for (const item of archiveItems) {
      const computed = chain.get(item.id);
      if (computed && computed !== item.hashDigest) {
        mismatches.push({
          itemId: item.id,
          itemName: item.name,
          stored: item.hashDigest ?? '',
          computed,
        });
      }
    }

    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '系统', target: project.name,
        action: '验证归档哈希链',
        result: mismatches.length === 0 ? `全部通过（${archiveItems.length} 项）` : `${mismatches.length}/${archiveItems.length} 项不匹配`,
        riskFlag: mismatches.length > 0 ? '高风险' : '无',
      },
    }).catch(() => {});

    return {
      valid: mismatches.length === 0,
      checkedAt: new Date().toISOString(),
      totalItems: archiveItems.length,
      mismatches,
    };
  }

  /** 一键归档前自动补齐标准归档材料清单（幂等：已存在则跳过） */
  /**
   * Ensure standard archive items exist for a project.
   * When called with a transaction client, uses it; otherwise uses this.prisma.
   */
  private async ensureArchiveItems(projectId: string, tx?: any, opts?: { skipEvaluation?: boolean }) {
    const db = tx ?? this.prisma;
    const standards = [
      { name: '招标项目基础信息', ownerRole: '系统' },
      { name: '投标供应商名单', ownerRole: '开标主持人' },
      { name: '开标记录表', ownerRole: '开标主持人' },
      { name: '供应商确认/异议记录', ownerRole: '供应商' },
      // 开标归档（scope=opening）不生成评分/评标两项材料
      ...(opts?.skipEvaluation ? [] : [
        { name: '专家评分明细', ownerRole: '评审专家' },
        { name: '评标结果汇总', ownerRole: '评审委员会' },
      ]),
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

  /**
   * 一键归档。
   * @param scope 'full'（默认）完整归档，要求评标结果；'opening' 开标归档——
   *   仅归档开标文件（5 项材料，跳过评分明细/评标汇总与评标结果守卫），
   *   用于流标/废标等开标后不进入评标的场景。**终局操作**：归档后 ARCHIVED 不可逆。
   */
  async archiveAll(id: string, actorId?: string, scope: 'opening' | 'full' = 'full') {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, stage: true, name: true, projectManagementItemId: true, round: true },
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

    // F3: 阶段下限守卫——棘轮只拒回退，下限由各端点业务前置负责。
    // 防止对截标未到、供应商仍可投递的前阶段项目误归档（不可逆终局）。
    if (scope === 'opening' && !stageAtLeast(project.stage, 'OPENING')) {
      throw new ConflictException({
        error: '开标归档要求项目已进入开标阶段',
        code: 'ARCHIVE_NOT_OPENED',
      });
    }
    if (scope === 'full' && !stageAtLeast(project.stage, 'EVALUATING')) {
      throw new ConflictException({
        error: '完整归档要求项目已进入评标阶段；开标后不评标请改用开标归档（scope=opening）',
        code: 'ARCHIVE_NOT_EVALUATING',
      });
    }

    // P0: Wrap ALL reads + writes in a single transaction to prevent race conditions.
    // The ensureArchiveItems, counts check, item fetch, and all updates happen atomically.
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockAndReassertStage(tx, id, 'ARCHIVED'); // C1: 事务内行锁后复查阶段（同阶段 ARCHIVED 幂等放行）
      // 开标归档必须已完成移交（生成开标文件包），否则归档材料不完整
      if (scope === 'opening') {
        const session = await tx.bidOpeningSession.findUnique({
          where: { projectId: id }, select: { handoverAssetId: true },
        });
        if (!session?.handoverAssetId) {
          throw new ConflictException({
            error: '请先执行「完成开标·资料移交」后再归档',
            code: 'OPENING_HANDOVER_REQUIRED',
          });
        }
      }
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
      // scope=opening（开标归档）不进入评标，跳过评标结果守卫
      if (scope === 'full' && confirmableCount > 0 && resultCount === 0) {
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
      await this.ensureArchiveItems(id, tx, { skipEvaluation: scope === 'opening' });

      const archiveItems = await tx.bidArchiveItem.findMany({
        where: { projectId: id, status: { not: 'ARCHIVED' } },
      });

      if (archiveItems.length === 0) {
        throw new BadRequestException({ error: '没有可归档的项目', code: 'NO_ITEMS_TO_ARCHIVE' });
      }

      // P0-4: 逐项 SHA-256 哈希链 — 每个归档项拥有独立哈希，链式防篡改。
      // 归一化：算链时把各项 status 视作 ARCHIVED，与 exportArchivePackage 重算口径一致
      // （修预存 bug：此前按 PENDING_CONFIRM 算链，导出按 ARCHIVED 重算，两者永不匹配）
      const chain = computeArchiveChain(
        { id: project.id, projectCode: project.projectCode, name: project.name, stage: 'ARCHIVED' },
        archiveItems.map(i => ({ ...i, status: 'ARCHIVED' as const })),
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
      const scopeLabel = scope === 'opening' ? '（开标归档）' : '';
      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '一键归档', result: `归档 ${archiveItems.length} 项${scopeLabel}`, riskFlag: '无' },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_STAGE_CHANGE', resourceType: `BidProject:${id}`, details: { from: project.stage, to: 'ARCHIVED', stage: 'ARCHIVED', archiveItems: archiveItems.length, scope } },
        });
      }

      // 阶段联动：关联的 :3005 项目管理项「开标评标」阶段 → COMPLETED。
      // F5：仅完整归档推进 PM 指针；开标归档（scope=opening，流标/废标场景并未完成评标）
      // 不自动标 COMPLETED，PM 阶段留给人工处理（如流标后再采购 reproc）
      if (scope === 'full') {
        await this.syncPmStage(tx, { projectManagementItemId: project.projectManagementItemId, round: project.round }, 'COMPLETED');
      }

      return tx.bidProject.findUnique({
        where: { id },
        include: { archiveItems: true },
      });
    });

    this.gateway?.notifyStageChange(id, project.stage, 'ARCHIVED', 'host');
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: '一键归档', target: project.name, result: `归档 ${result?.archiveItems?.length ?? 0} 项${scope === 'opening' ? '（开标归档）' : ''}`, riskFlag: '无' });

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

  async exportArchivePackage(projectId: string, format: 'json' | 'csv' = 'json', scope: 'full' | 'summary' = 'full') {
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

    const hallMessages = await this.prisma.openingHallMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    // OpeningHallMessage 不存 supplierName（schema 仅 supplierId）；私聊归属经 BidSupplier 反查
    const hallSupplierNames = new Map(
      (await this.prisma.bidSupplier.findMany({ where: { projectId }, select: { supplierId: true, supplierName: true } }))
        .filter(s => s.supplierId)
        .map(s => [s.supplierId as string, s.supplierName] as const),
    );

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

    // S2：存证 sections（大厅消息 / 监督日志 / 澄清答疑）纳入归档包防篡改覆盖。
    // 信任模型与 archiveItems 哈希链一致：均为"导出包内防局部篡改"——整体包的真伪由
    // 导出时的捕获/签章环节保证（既有设计边界，不在本次扩展）。算法与 bid-archive.digest.ts
    // 同款：crypto.createHash('sha256').update(JSON.stringify(...), 'utf8')，同输入恒等。
    // 摘要取自与 sections 完全相同的数组引用/映射，保证复算口径一致。
    const sha256Json = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v), 'utf8').digest('hex');
    const hallSection = hallMessages.map(m => ({
      id: m.id, roomType: m.roomType,
      supplierName: m.supplierId ? (hallSupplierNames.get(m.supplierId) ?? null) : null,
      senderRole: m.senderRole, senderName: m.senderName, content: m.content, createdAt: m.createdAt,
    }));
    const sectionDigests = {
      hallMessages: sha256Json(hallSection),
      supervisionLogs: sha256Json(project.supervisionLogs),
      clarifications: sha256Json(project.clarifications),
    };
    const sectionsRoot = sha256Json(sectionDigests);

    if (format === 'csv') {
      const BOM = '﻿';
      // RFC4180 转义 + CSV 公式注入中和：以 = + - @ \t \r 开头的值前置单引号，
      // 防 Excel/WPS 把用户输入（大厅消息/异议原因/澄清等）当公式求值（=HYPERLINK 钓鱼/外部引用）。
      const esc = (v: unknown) => {
        const s = String(v ?? '').replace(/"/g, '""');
        return `"${/^[=+\-@\t\r]/.test(s) ? `'${s}` : s}"`;
      };
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
      // S3：开标大厅消息段（与 JSON 导出 sections.hallMessages 对齐）。
      // esc 统一双引号包裹 + 内部双引号加倍，内容含逗号/换行/引号亦为合法 CSV 字段。
      lines.push('=== 开标大厅消息 ===');
      lines.push(['时间', '类型', '供应商', '发送者角色', '发送者', '内容'].map(esc).join(','));
      hallSection.forEach(m => lines.push([
        m.createdAt.toISOString(),
        m.roomType === 'PUBLIC' ? '公聊' : '私聊',
        m.supplierName ?? '',
        m.senderRole === 'HOST' ? '主持人' : m.senderRole === 'SUPPLIER' ? '供应商' : '系统',
        m.senderName,
        m.content,
      ].map(esc).join(',')));
      lines.push('');
      lines.push('=== 档案哈希链验证摘要 ===');
      lines.push(['算法', 'SHA-256'].join(','));
      lines.push(['创世哈希', genesis].join(','));
      const chainArr = Array.from(chain.entries());
      chainArr.forEach(([itemId, hash], i) => {
        const item = project.archiveItems.find(a => a.id === itemId);
        lines.push([`#${i + 1} ${item?.name || itemId}`, hash].map(esc).join(','));
      });
      // S2：存证 sections 摘要（与 JSON 导出 hashChain.sectionDigests/sectionsRoot 同源）
      lines.push(['存证摘要-开标大厅消息', sectionDigests.hallMessages].join(','));
      lines.push(['存证摘要-监督日志', sectionDigests.supervisionLogs].join(','));
      lines.push(['存证摘要-澄清答疑', sectionDigests.clarifications].join(','));
      lines.push(['存证摘要根（sectionsRoot）', sectionsRoot].join(','));
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
    const base = {
      manifest: {
        exportedAt: new Date().toISOString(),
        projectId: project.id,
        projectCode: project.projectCode,
        format: 'application/json' as const,
        version: '1.0',
        scope,
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
      hashChain: {
        algorithm: 'SHA-256' as const,
        genesisHash: genesis,
        chain: Array.from(chain.entries()).map(([itemId, hash]) => {
          const item = project.archiveItems.find(a => a.id === itemId);
          return { itemId, name: item?.name, hash };
        }),
        sectionDigests,
        sectionsRoot,
      },
    };

    if (scope === 'summary') {
      return {
        ...base,
        verifierHtml: buildArchiveVerifierHtml(project.name, project.projectCode, genesis, Array.from(chain.entries()).map(([itemId, hash]) => {
          const item = project.archiveItems.find(a => a.id === itemId);
          return { itemId, name: item?.name ?? itemId, hash };
        })),
        evaluationSummary: project.evaluationResults.length > 0
          ? {
              totalCandidates: project.evaluationResults.length,
              recommendedCount: project.evaluationResults.filter(r => r.recommended).length,
              topSupplier: project.evaluationResults[0]?.supplierName ?? null,
              results: project.evaluationResults.map(r => ({
                rank: r.rank, supplierName: r.supplierName,
                totalScore: r.totalScore, averageScore: r.averageScore,
                recommended: r.recommended, disqualified: r.disqualified,
              })),
            }
          : null,
        archiveSummary: {
          totalItems: project.archiveItems.length,
          archivedItems: project.archiveItems.filter(i => i.status === 'ARCHIVED').length,
        },
      };
    }

    return {
      ...base,
      verifierHtml: buildArchiveVerifierHtml(project.name, project.projectCode, genesis, Array.from(chain.entries()).map(([itemId, hash]) => {
        const item = project.archiveItems.find(a => a.id === itemId);
        return { itemId, name: item?.name ?? itemId, hash };
      })),
      sections: {
        suppliers: project.suppliers.map(s => ({ supplierName: s.supplierName, downloadStatus: s.downloadStatus, submitStatus: s.submitStatus, encryptStatus: s.encryptStatus, decryptStatus: s.decryptStatus, confirmStatus: s.confirmStatus })),
        openingRecords: project.openingRecords,
        expertScores: project.experts.map(e => ({ expertName: e.expertName, major: e.major, scores: e.scoreRecords.map(sr => ({ supplierId: sr.supplierId, scoreItemName: sr.scoreItem?.name, score: sr.score, reason: sr.reason })) })),
        evaluationResults: project.evaluationResults,
        supervisionLogs: project.supervisionLogs,
        clarifications: project.clarifications,
        hallMessages: hallSection,
        confirmationRecords: project.suppliers.filter(s => s.confirmStatus !== 'PENDING').map(s => ({ supplierName: s.supplierName, status: s.confirmStatus, error: s.decryptError })),
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

  /**
   * P1-17：事务内锁定项目行（SELECT ... FOR UPDATE）并复查评分标准可编辑性。
   * 与 startEvaluation（同样 FOR UPDATE 后置 EVALUATING）互斥，消除「事务外校验通过后阶段被并发流转」的 TOCTOU。
   */
  private async reassertScoreItemsEditableInTx(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "BidProject" WHERE id = ${projectId} FOR UPDATE`;
    const p = await tx.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, scoreStandardPublishedAt: true } });
    if (!p) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(p.stage as BidStage, p.scoreStandardPublishedAt);
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
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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
    return this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      return tx.bidScorePoint.delete({ where: { id: pointId } });
    });
  }

  /** 批量导入得分点（管理员审核 AI 建议后）。复用 assertScoreItemInProject 做归属 + 阶段锁校验。 */
  async batchCreateScorePoints(projectId: string, itemId: string, dto: BatchCreateScorePointsDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    const delta = dto.points.reduce((s, p) => s + Number(p.fullScore), 0);
    return this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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
        await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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
      // P2：行锁 + 事务内复查 publishedAt，消除并发双发布竞态
      await tx.$queryRaw`SELECT id FROM "BidProject" WHERE id = ${projectId} FOR UPDATE`;
      const locked = await tx.bidProject.findUnique({ where: { id: projectId }, select: { scoreStandardPublishedAt: true } });
      if (locked?.scoreStandardPublishedAt) {
        throw new ConflictException({ error: '评分标准已发布,不可重复发布', code: 'SCORE_STANDARD_ALREADY_PUBLISHED' });
      }
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
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
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

  async deleteScoreTemplate(templateId: string, userId?: string, role?: string) {
    const tpl = await this.prisma.scoreTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, createdById: true },
    });
    if (!tpl) throw new BadRequestException({ error: '模板不存在', code: 'NOT_FOUND' });
    // P2：公共模板（createdById=null）仅管理员可删；私有模板仅创建者或管理员可删
    const isAdmin = role === 'admin' || role === 'bid_host';
    if (tpl.createdById === null) {
      if (!isAdmin) throw new ForbiddenException({ error: '公共模板仅管理员可删除', code: 'FORBIDDEN' });
    } else if (tpl.createdById !== userId && !isAdmin) {
      throw new ForbiddenException({ error: '只能删除自己保存的模板', code: 'FORBIDDEN' });
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
        title: `新采购项目邀请：${project.name}`,
        content: `您已被邀请参与采购项目 ${project.projectCode}（${project.name}），请尽快登录供应商门户查看采购文件并投标。`,
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

/** 构建归档哈希链自验证 HTML 页面（base64 编码，自包含） */
function buildArchiveVerifierHtml(
  projectName: string,
  projectCode: string,
  genesisHash: string,
  chainEntries: Array<{ itemId: string; name: string; hash: string }>,
): string {
  const chainJson = JSON.stringify(chainEntries);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>归档验证 - ${projectCode}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fa;color:#1a1a2e;padding:24px;max-width:960px;margin:0 auto}
  h1{font-size:20px;margin-bottom:4px} .code{font-family:monospace;font-size:12px;color:#666}
  .card{background:#fff;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .pass{border-left:3px solid #22c55e} .fail{border-left:3px solid #ef4444}
  .hash{font-family:monospace;font-size:11px;word-break:break-all;background:#f0f0f5;padding:4px 8px;border-radius:6px;margin:4px 0}
  .badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600}
  .badge-ok{background:#dcfce7;color:#166534} .badge-fail{background:#fef2f2;color:#991b1b}
  button{padding:8px 20px;border:none;border-radius:8px;font-size:14px;cursor:pointer;background:#2563eb;color:#fff;margin-top:8px}
  button:hover{background:#1d4ed8}
</style></head>
<body>
<h1>归档哈希链验证报告</h1>
<p class="code">项目：${projectName}（${projectCode}）｜验证时间：<span id="time"></span></p>
<div class="card">
  <h3>创世哈希</h3>
  <div class="hash" id="genesis">${genesisHash}</div>
</div>
<div id="results"></div>
<div id="summary" style="margin-top:16px;font-weight:600"></div>
<button onclick="verify()">重新验证</button>
<script>
const chainData = ${chainJson};
const GENESIS = "${genesisHash}";
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}
async function verify() {
  document.getElementById("time").textContent = new Date().toISOString();
  let prev = GENESIS;
  let pass = 0, fail = 0;
  const container = document.getElementById("results");
  container.innerHTML = "";
  for (const item of chainData) {
    const payload = JSON.stringify({prevHash:prev,id:item.itemId,name:item.name,ownerRole:"",status:"ARCHIVED"});
    const computed = "sha256:" + await sha256(payload);
    const ok = computed === item.hash;
    const card = document.createElement("div");
    card.className = "card " + (ok ? "pass" : "fail");
    card.innerHTML = '<strong>' + item.name + '</strong>' +
      '<span class="badge ' + (ok ? "badge-ok" : "badge-fail") + '" style="margin-left:8px">' + (ok ? "✓ 通过" : "✗ 不匹配") + '</span>' +
      '<div class="hash">存储：' + item.hash + '</div>' +
      '<div class="hash">重算：' + computed + '</div>';
    container.appendChild(card);
    if (ok) pass++; else fail++;
    prev = computed.replace("sha256:","");
  }
  document.getElementById("summary").innerHTML = fail === 0
    ? '<span class="badge badge-ok">全部通过 ✓</span> 共 ' + pass + ' 项'
    : '<span class="badge badge-fail">' + fail + '/' + (pass+fail) + ' 项不匹配 ✗</span>';
}
verify();
</script></body></html>`;
  return Buffer.from(html, 'utf-8').toString('base64');
}
