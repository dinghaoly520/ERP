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
import { CreateOpeningRecordDto } from './dto/create-opening-record.dto';
import { UpsertSupervisionAnnotationDto } from './dto/upsert-supervision-annotation.dto';
import { assertBidStageTransition, type BidStage } from './bid-state';
import { computeArchiveChain, genesisHash as archiveGenesisHash } from './bid-archive.digest';
import { decryptBuffer, streamToBuffer, verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';
import { unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { checkScoreAnomaly, type ScoreRecordInput } from '../expert/expert-deviation';
import { ScoreCategory } from '@prisma/client';

@Injectable()
export class BidService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  private readonly logger = new Logger(BidService.name);

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

    const submittedMap = new Map(submissionCounts.map(s => [s.projectId, s._count.projectId]));
    const signedInMap = new Map(expertSignInCounts.map(e => [e.projectId, e._count.projectId]));

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
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.procurementMethod !== undefined && { procurementMethod: dto.procurementMethod }),
        ...(dto.openTime !== undefined && { openTime: new Date(dto.openTime) }),
        ...(dto.deadline !== undefined && { deadline: new Date(dto.deadline) }),
        ...(dto.stage && { stage: dto.stage as any }),
        ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }),
        ...(dto.budget !== undefined && { budget: dto.budget }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
        ...(dto.qualification !== undefined && { qualification: dto.qualification }),
        ...(dto.contact !== undefined && { contact: dto.contact }),
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
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'SUBMIT');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'SUBMIT' },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '开放投递 (DOWNLOAD→SUBMIT)', result: '阶段变更成功', riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', target: `BidProject:${id}`, detail: { from: 'DOWNLOAD', to: 'SUBMIT', stage: 'SUBMIT' } } });

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
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', target: `BidProject:${id}`, detail: { from: 'SUBMIT', to: 'OPENING', stage: 'OPENING', host: dto?.host, supervisor: dto?.supervisor, deadline: project.deadline } } });

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

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'EVALUATING' },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '启动评标 (OPENING→EVALUATING)', result: '阶段变更成功', riskFlag: '无' },
      });
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_STAGE_CHANGE', target: `BidProject:${id}`, detail: { from: 'OPENING', to: 'EVALUATING', stage: 'EVALUATING' } } });

      return result;
    });

    // Defer WebSocket notifications until after transaction commits
    this.gateway?.notifyStageChange(id, 'OPENING', 'EVALUATING', 'host');
    this.gateway?.notifyEvaluationStarted(id);
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: '启动评标 (OPENING→EVALUATING)', target: project.name, result: '阶段变更成功', riskFlag: '无' });

    return updated;
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
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', target: `${bidSupplier.supplierName}:${supplierId}`, detail: { projectId, outcome: 'DANGER', reason, phase: 'no_files' } } });
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
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', target: `${bidSupplier.supplierName}:${supplierId}`, detail: { projectId, outcome: 'DANGER', reason, phase: 'decrypt_verify' } } });
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
      if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', target: `${bidSupplier.supplierName}:${supplierId}`, detail: { projectId, outcome: 'SUCCESS' } } });

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
      s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.confirmStatus === 'CONFIRMED',
    );

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

    const ranked: { supplierId: string; supplierName: string; totalScore: number; averageScore: number }[] = [];
    for (const supplier of activeSuppliers) {
      const records = recordsBySupplier.get(supplier.id) ?? [];
      const totalScore = records.reduce((sum, r) => sum + Number(r.score), 0);
      const scoringExpertCount = new Set(records.map(r => r.expertId)).size;
      const averageScore = scoringExpertCount > 0 ? totalScore / scoringExpertCount : 0;
      ranked.push({
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        totalScore,
        averageScore,
      });
    }
    ranked.sort((a, b) => b.averageScore - a.averageScore);

    // Wrap deleteMany + createMany + supervision log in a transaction
    // to prevent data loss if createMany fails after deleteMany succeeds.
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
            recommended: index === 0,
          })),
        });
      }
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: project.name,
          action: '生成评标结果', result: `生成${ranked.length}家供应商排名`, riskFlag: '无',
        },
      });
    });
    this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '生成评标结果', target: project.name, result: `生成${ranked.length}家供应商排名`, riskFlag: '无' });
    if (actorId) await this.prisma.auditLog.create({ data: { userId: actorId, action: 'BID_RESULTS_GENERATED', target: `BidProject:${projectId}`, detail: { rankedCount: ranked.length } } });

    return this.listEvaluationResults(projectId);
  }

  async submitScore(projectId: string, dto: CreateScoreDto) {
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

    // 校验 scoreItem 属于该项目
    const scoreItem = await this.prisma.bidScoreItem.findFirst({
      where: { id: dto.scoreItemId, projectId },
    });
    if (!scoreItem) {
      throw new BadRequestException({ error: '评分项不属于此项目', code: 'SCORE_ITEM_NOT_IN_PROJECT' });
    }

    // 利用唯一约束 upsert：存在则更新，不存在则创建
    const record = await this.prisma.bidScoreRecord.upsert({
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
    // P1: 评分偏差实时检测
    const existingRows = await this.prisma.bidScoreRecord.findMany({
      where: { scoreItemId: dto.scoreItemId, supplierId: dto.supplierId, expertId: { not: dto.expertId } },
      select: { expertId: true, scoreItemId: true, supplierId: true, score: true },
    });
    const existingScores: ScoreRecordInput[] = (existingRows ?? []).map(r => ({
      expertId: r.expertId, scoreItemId: r.scoreItemId,
      supplierId: r.supplierId, score: Number(r.score),
    }));

    const alert = checkScoreAnomaly(
      { expertId: dto.expertId, scoreItemId: dto.scoreItemId, supplierId: dto.supplierId, score: Number(dto.score) },
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
      progressPercent: 0,
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
    const result = await this.prisma.bidClarification.update({
      where: { id: cid }, data: { reply, status },
    });
    // P2: emit real-time reply to project room
    this.gateway?.notifyClarificationReplied(projectId, {
      id: cid, replier: 'host', replyPreview: reply.slice(0, 60),
    });
    return result;
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
      const [confirmableCount, resultCount] = await Promise.all([
        tx.bidSupplier.count({
          where: { projectId: id, decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', submitStatus: { not: '已撤回' } },
        }),
        tx.bidEvaluationResult.count({ where: { projectId: id } }),
      ]);
      if (confirmableCount > 0 && resultCount === 0) {
        throw new ConflictException({
          error: '存在已确认的可评供应商，请先生成评标结果再归档',
          code: 'EVALUATION_RESULTS_REQUIRED',
        });
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
          data: { userId: actorId, action: 'BID_STAGE_CHANGE', target: `BidProject:${id}`, detail: { from: 'EVALUATING', to: 'ARCHIVED', stage: 'ARCHIVED', archiveItems: archiveItems.length } },
        });
      }

      return tx.bidProject.findUnique({
        where: { id },
        include: { archiveItems: true },
      });
    });

    this.gateway?.notifyStageChange(id, 'EVALUATING', 'ARCHIVED', 'host');
    this.gateway?.notifySupervisionLog(id, { role: '系统', action: '一键归档', target: project.name, result: `归档 ${result?.archiveItems?.length ?? 0} 项`, riskFlag: '无' });

    return result;
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
    };
  }

  /* ── 评分标准编制（评标办法）──
   * 评分项是评标段的前置条件：无评分项则专家无法打分、无法确认报告、无法生成结果。
   * 一旦项目进入评标（专家已开始打分）或归档，评分标准锁定，禁止增删改。 */

  /** 评分标准仅在 DOWNLOAD/SUBMIT/OPENING 阶段可编辑；EVALUATING/ARCHIVED 锁定（409）。 */
  private assertScoreItemsEditable(stage: BidStage) {
    if (stage === 'EVALUATING' || stage === 'ARCHIVED') {
      throw new ConflictException({
        error: '项目已进入评标或归档阶段，评分标准已锁定',
        code: 'SCORE_ITEMS_LOCKED',
      });
    }
  }

  listScoreItems(projectId: string) {
    return this.prisma.bidScoreItem.findMany({
      where: { projectId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createScoreItem(projectId: string, dto: CreateScoreItemDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage);

    const created = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bidScoreItem.create({
        data: { projectId, category: dto.category, name: dto.name, maxScore: dto.maxScore },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: project.name,
          action: '编制评分标准', result: `新增评分项「${dto.name}」（满分 ${dto.maxScore}）`, riskFlag: '无',
        },
      });
      return result;
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: `新增评分项「${dto.name}」（满分 ${dto.maxScore}）`, riskFlag: '无' });
    return created;
  }

  async updateScoreItem(projectId: string, itemId: string, dto: UpdateScoreItemDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage);

    const existing = await this.prisma.bidScoreItem.findFirst({ where: { id: itemId, projectId } });
    if (!existing) throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });

    return this.prisma.bidScoreItem.update({
      where: { id: itemId },
      data: {
        ...(dto.category && { category: dto.category }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.maxScore !== undefined && { maxScore: dto.maxScore }),
      },
    });
  }

  async deleteScoreItem(projectId: string, itemId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage);

    const existing = await this.prisma.bidScoreItem.findFirst({ where: { id: itemId, projectId } });
    if (!existing) throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });

    await this.prisma.$transaction(async (tx) => {
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: project.name,
          action: '编制评分标准', result: `删除评分项「${existing.name}」`, riskFlag: '无',
        },
      });
      await tx.bidScoreItem.delete({ where: { id: itemId } });
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: `删除评分项「${existing.name}」`, riskFlag: '无' });
    return { deleted: true };
  }

  /** 应用标准评分模板（幂等：按 name 去重，已存在的项不重复创建）。立即解除新建项目的评标死锁。 */
  async applyScoreItemTemplate(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage);

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
      await this.prisma.bidScoreItem.createMany({
        data: toCreate.map(t => ({ projectId, category: t.category, name: t.name, maxScore: t.maxScore })),
      });
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: project.name,
          action: '编制评分标准', result: `应用标准模板，新增 ${toCreate.length} 项`, riskFlag: '无',
        },
      });
      this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: `应用标准模板，新增 ${toCreate.length} 项`, riskFlag: '无' });
    }
    return this.listScoreItems(projectId);
  }

  // ── Supervision Annotations ──

  async upsertSupervisionAnnotation(projectId: string, dto: UpsertSupervisionAnnotationDto) {
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
    return this.prisma.bidSupervisionAnnotation.delete({
      where: { supplierId },
    }).catch(() => null);
  }

  async listSupervisionAnnotations(projectId: string) {
    return this.prisma.bidSupervisionAnnotation.findMany({
      where: { projectId },
    });
  }
}
