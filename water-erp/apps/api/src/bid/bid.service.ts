import { Injectable, BadRequestException, ConflictException, ForbiddenException, Optional, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import { GB_ARCHIVE_CATEGORIES } from '@water-erp/shared';
import { buildArchiveTemplate } from './archive-template';
import { aggregateSupplierScores } from './aggregate-supplier-scores';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { BidOpeningRecordService } from './bid-opening-record.service'; // 值导入：emitDecoratorMetadata 需运行时引用，import type 会退化为 Object 致 DI 失败
import { notifySupplierDecryptAttribution } from './decrypt-notify.util';
import { BidScoreStandardService } from './bid-score-standard.service';
import { sanitizeForBidHost } from './bid-sanitizer';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';
import { ReplyClarificationDto } from './dto/reply-clarification.dto';
import { StartOpeningDto } from './dto/start-opening.dto';
import { CreateScoreItemDto } from './dto/create-score-item.dto';
import { UpdateScoreItemDto } from './dto/update-score-item.dto';
import { CreateScorePointDto } from './dto/create-score-point.dto';
import { UpdateScorePointDto } from './dto/update-score-point.dto';
import { BatchCreateScorePointsDto } from './dto/batch-create-score-points.dto';
import { UpsertSupervisionAnnotationDto } from './dto/upsert-supervision-annotation.dto';
import { ReportNotesDto, ReportNoteItemDto, REPORT_NOTE_SECTIONS } from './dto/report-notes.dto';
import { assertMinAcceptedInvitees } from './bid-timing-rules';
import { getMinBiddersForMethod } from './decrypt-quorum.util';
import { assertCommitteeComposition, isWaterProject, MIN_COMMITTEE_WATER } from './committee-composition.util';
import { sortSupplierRowsBySubmission } from './supplier-row-order.util';
import { stripOpeningConfirmSignature } from '../supplier-portal/opening-confirm-signature.util';
import { assertBidStageTransition, assertSignGateClosed, lockAndReassertStage, stageAtLeast, type BidStage } from './bid-state';
import { computeArchiveChain, genesisHash as archiveGenesisHash } from './bid-archive.digest';
import { openField } from '../common/crypto/field-crypto';
import { parseFlexibleDate } from '../common/parse-date.util';
import { generateProjectCode } from '../common/project-code.util';
import { GbCodeService } from '../common/gb-code.service';
import { assertNudgeWindowOpen, assertOpeningDeadlineRelation, deriveDeadlineFromOpenTime, deriveOpenTimeFromDeadline, modeFor } from './opening-deadline.util';
import { parseConflictedIds } from '../common/scoring/expert.util';
import { checkScoreAnomaly, type ScoreRecordInput } from '../common/scoring/expert-deviation';
import { Prisma, AiBidderStatus } from '@prisma/client';
import { pendingBondReturnWhere } from './bond-pending.util';
import { createIntegrityStamp } from '../common/crypto/integrity-stamp';
import { recomputeExpertProgress, recomputeItemFromDecisions } from './score-recalculate.helper';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { buildArchiveAiUsage } from '../ai-bid-analysis/utils/archive-ai-usage';
import { ClarificationAiService } from './clarification-ai.service';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { PriceFormulaService } from './price-formula.service';
import { getEvaluationDefault } from './evaluation-method.config';
import { StorageService } from '../storage/storage.service';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { SignatureService } from '../common/crypto/signature.service';
import { buildClarificationReplyCanonical } from '../supplier-portal/clarification-reply.util';

/** AI 分析「卡住」判定阈值：bidder 处于中间态且 updatedAt 停摆超过该时长（单家 OCR+LLM 约 5-15 分钟，30 分钟留足余量） */
const AI_STUCK_THRESHOLD_MS = 30 * 60 * 1000;

/** F14：workerIdle 队列探测宽限窗——task 行先建、job 后 add 的入队竞态余量，超窗才探测 */
const AI_WORKER_IDLE_GRACE_MS = 30 * 1000;

/** 成交通知书交付附件边界：上传后的实际存储元数据必须仍是 PDF/Word，且不超过 20 MiB。 */
const AWARD_LETTER_MAX_ASSET_BYTES = 20 * 1024 * 1024;
const AWARD_LETTER_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

@Injectable()
export class BidService {
  constructor(
    private prisma: PrismaService,
    private gbCode: GbCodeService,
    private notificationService: NotificationService,
    private readonly scoreStandardValidator: ScoreStandardValidator,
    private readonly scoreStandard: BidScoreStandardService,
    private readonly priceFormula: PriceFormulaService,
    private readonly storage: StorageService,
    private readonly adminKey: AdminKeyService,
    private readonly dualEnvelope: DualEnvelopeService,
    private readonly signature: SignatureService,
    private readonly openingRecord: BidOpeningRecordService,
    @Optional() private readonly clarificationAi?: ClarificationAiService,
    @Optional() private readonly gateway?: BidGateway,
    @Optional()
    @InjectQueue(QUEUE_NAMES.TENDER_PROCESSING)
    private readonly tenderQueue?: Queue,
    @Optional()
    @InjectQueue(QUEUE_NAMES.BIDDER_PROCESSING)
    private readonly bidderQueue?: Queue,
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

  /** 列出可指派的开标主持人账号（:3005 选择器用） */
  async listHosts() {
    return this.prisma.user.findMany({
      where: { role: 'bid_host', isActive: true },
      select: { id: true, username: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
  }

  /**
   * 指派/改派开标主持人（R1 硬分流 / R3 改派窗口）。
   * - leader/staff/admin 调用（角色守卫在 Controller 层）
   * - OpeningSession 已存在 → 409 锁定
   * - userId=null 清除指派（项目回到 :3005 公开池，但 :3007 不可见）
   */
  async assignHost(projectId: string, userId: string | null, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // R3: OpeningSession 存在则锁定改派
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (session) {
      throw new ConflictException({ error: '开标会话已组建，无法改派', code: 'OPENING_SESSION_LOCKED' });
    }

    // 校验目标用户必须是 active bid_host
    if (userId !== null) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
      });
      if (!user || user.role !== 'bid_host' || !user.isActive) {
        throw new BadRequestException({ error: '目标用户不是有效的开标主持人', code: 'INVALID_HOST' });
      }
    }

    return this.prisma.bidProject.update({
      where: { id: projectId },
      data: {
        assignedHostUserId: userId,
        assignedAt: userId ? new Date() : null,
        assignedByUserId: userId ? actorId : null,
      },
      include: {
        assignedHostUser: { select: { id: true, username: true, displayName: true } },
      },
    });
  }

  async listProjects(stages?: string[], actor?: { id: string; role: string }, portal?: string) {
    const stageFilter = stages && stages.length > 0 ? { stage: { in: stages as BidStage[] } } : {};
    // 按端口过滤：bid portal（:3007）只看派给自己的项目；web portal（:3005）按公司隔离（2026-08-20）
    const actorFilter = portal === 'bid' && actor ? { assignedHostUserId: actor.id } : {};
    const companyFilter = await this.companyFilterFor(actor, portal);
    const where = { ...stageFilter, ...actorFilter, ...companyFilter, isExtractionOnly: false };

    // 当按阶段筛选时返回精简字段（用于搜索选择器）
    // 无筛选时返回完整字段（用于归档/仪表盘等向后兼容）
    if (stages && stages.length > 0) {
      const projects = await this.prisma.bidProject.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          projectCode: true,
          name: true,
          stage: true,
          projectManagementItemId: true,
        },
      });
      // 用源项目管理的 projectCode 覆盖 bid 自动生成的编号（如 BID-xxx → TP-xxx）
      return this.resolveDisplayCodes(projects);
    }

    const projects = await this.prisma.bidProject.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { suppliers: true } } },
    });
    // 同上：用源项目管理的 projectCode 覆盖
    return this.resolveDisplayCodes(projects);
  }

  /** 联查 ProjectManagementItem.projectCode，覆盖 BidProject 自身编号 */
  private async resolveDisplayCodes<T extends { projectManagementItemId?: string | null; projectCode?: string }>(
    projects: T[],
  ): Promise<T[]> {
    const pmIds = [...new Set(projects.map(p => p.projectManagementItemId).filter(Boolean))] as string[];
    if (pmIds.length === 0) return projects;
    const pmItems = await this.prisma.projectManagementItem.findMany({
      where: { id: { in: pmIds } },
      select: { id: true, projectCode: true },
    });
    const codeMap = new Map(pmItems.map(pm => [pm.id, pm.projectCode]));
    return projects.map(p => {
      const sourceCode = p.projectManagementItemId ? codeMap.get(p.projectManagementItemId) : undefined;
      return sourceCode ? { ...p, projectCode: sourceCode } : p;
    });
  }

  /** 公告 relatedProjectCode 的候选编号集合：业务编号（PMI.projectCode，公告实际存储值）∪ 内部编号（历史数据兜底）。
   *  公告查找必须同时尝试两者——公告存业务编号（ZJ-xxx），BidProject.projectCode 是内部 BID-时间戳，
   *  仅用内部编号查找会恒空（openSubmission 闸门误拒 / 中标公示重复生成 / 供应商端"暂无公告正文"）。 */
  private async resolveAnnouncementCodes(project: { projectManagementItemId?: string | null; projectCode: string }): Promise<string[]> {
    const codes = new Set<string>([project.projectCode]);
    if (project.projectManagementItemId) {
      const pm = await this.prisma.projectManagementItem.findUnique({
        where: { id: project.projectManagementItemId },
        select: { projectCode: true },
      });
      if (pm?.projectCode) codes.add(pm.projectCode);
    }
    return [...codes];
  }

  /**
   * Dashboard 聚合端点：一次返回项目列表 + 就绪状态 + 阶段分布。
   * 避免前端 N+1 次工作区查询，在表格中直接呈现供应商/专家就绪信号。
   */

  /** 公司隔离（2026-08-20）：web 等门户的内部角色（非 admin）仅看本公司项目；
   *  bid 门户（:3007）沿用"仅看指派"语义，不叠加公司过滤；admin 全量。 */
  private async companyFilterFor(actor?: { id: string; role: string }, portal?: string): Promise<Record<string, unknown>> {
    if (portal === 'bid' || !actor || actor.role === 'admin') return {};
    if (!['leader', 'staff', 'bid_host'].includes(actor.role)) return {};
    const me = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { companyId: true } });
    return { companyId: me?.companyId ?? '__no_company__' };
  }

  /** 创建项目时的公司归属快照（写时口径与 CompanyScopeService.stampFor 一致：操作人所在公司） */
  private async operatorCompanyStamp(operator?: { sub: string; role: string }): Promise<{ companyId: string | null; companyName: string | null }> {
    if (!operator) return { companyId: null, companyName: null };
    // User 表公司名字段为 company（非 companyName）
    const me = await this.prisma.user.findUnique({
      where: { id: operator.sub },
      select: { companyId: true, company: true },
    });
    return { companyId: me?.companyId ?? null, companyName: me?.company ?? null };
  }

  async getProjectsDashboard(actor?: { id: string; role: string }, portal?: string) {
    // 按 portal 过滤：bid portal 只看派给自己的；web portal 按公司隔离（2026-08-20）
    // N1（2026-08-28，浏览器验证发现）：admin 豁免主持人过滤——:3007 是 admin 的默认落地
    // 门户（urls.ts role→portal），未被指派为主持人时任务板全空不可用；leader/staff 维持
    // 只看派给自己的（:3005 才是其工作面，:3007 仅现场协同，可经直链进入工作区）。
    const actorFilter = portal === 'bid' && actor && actor.role !== 'admin' ? { assignedHostUserId: actor.id } : {};
    const companyFilter = await this.companyFilterFor(actor, portal);
    const projects = await this.prisma.bidProject.findMany({
      where: { ...actorFilter, ...companyFilter, isExtractionOnly: false },
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

    // N1：stageDistribution 原为另一笔无过滤 groupBy——与 projects 过滤集脱钩（admin 在
    // bid portal 曾得到 totalProjects=0 但 OPENING:4 的自相矛盾载荷），对 web portal
    // 公司隔离也违反「统计在隔离集上算」的既档口径。改为对过滤集直接计数（省一笔查询）。
    const stageDistribution: Record<string, number> = {};
    for (const row of projectRows) stageDistribution[row.stage] = (stageDistribution[row.stage] ?? 0) + 1;

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

  async getProject(id: string, actor?: { id: string; role: string }, portal?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: true }, orderBy: { id: 'asc' } },
        scoreItems: true,
        clarifications: true,
        supervisionLogs: { orderBy: { time: 'desc' } },
        expertDisputes: { orderBy: { createdAt: 'desc' } },
        archiveItems: true,
        bidRounds: { orderBy: { roundNo: 'asc' } },
        // A4 补齐（2026-09-04）：评标结果汇总随详情下发——:3005 开标确认面板候选人与金额展示、
        // A1/A3 公示倒计时与中标通知书推送均消费 detail.evaluationResults。
        // 结果生成前为空数组，评标进行中不泄露；生成后招标人（:3005 staff/leader）可见，
        // 服务第 54 条「3 日内公示中标候选人」的时限管理（回流包 generateHandover 同源携带）。
        evaluationResults: { orderBy: { rank: 'asc' } },
        assignedHostUser: { select: { id: true, username: true, displayName: true } },
      },
    });
    if (!project) return null;

    // T17（双信封 v2）：项目详情为供应商行派生下发新轨判别字段。envelopeVersion/outerDecryptedAt/
    // packageFetchedAt 存于 SupplierBidSubmission（BidSupplier 无这些列），dangerAttribution 已随
    // suppliers 全量下发（BidSupplier 标量列）。仅 status='submitted' 生效（草稿信封不参与开标判定）。
    const dualSubs = await this.prisma.supplierBidSubmission.findMany({
      where: { projectId: id },
      select: { supplierId: true, status: true, envelopeVersion: true, outerDecryptedAt: true, packageFetchedAt: true, submittedAt: true },
    });
    const dualSubMap = new Map(dualSubs.map(s => [s.supplierId, s]));
    // A-100（验收补，2026-08-31）：详情端点是 :3007 开标大厅供应商表的数据源——与 getWorkspace/
    // 开标文件包同口径按递交时间排序。submitted/withdrawn/submission 为排序临时键（util 要求
    // 顶层形状、与 BidSupplier 真实列无冲突），排序后剥离，响应形状不变仅行序变。
    project.suppliers = sortSupplierRowsBySubmission(
      (project.suppliers as any[]).map(s => {
        const sub = s.supplierId ? dualSubMap.get(s.supplierId) : undefined;
        const submitted = sub?.status === 'submitted';
        return {
          ...s,
          envelopeVersion: submitted ? (sub.envelopeVersion ?? null) : null,
          outerDecryptedAt: submitted ? (sub.outerDecryptedAt ?? null) : null,
          packageFetchedAt: submitted ? (sub.packageFetchedAt ?? null) : null,
          submitted,
          withdrawn: sub?.status === 'withdrawn',
          submission: sub ? { submittedAt: sub.submittedAt } : null,
        };
      }),
    ).map(({ submitted: _s, withdrawn: _w, submission: _sub, ...rest }) => rest) as typeof project.suppliers;

    // A-114：主持端/唱标总表视图剥壳——开标记录确认签名只下发摘要（algorithm/verifiedAt），
    // 完整签名证据仅本人视图（supplier-portal getMyOpeningRecord）与开标文件包/归档导出保留。
    project.openingRecords = project.openingRecords.map(
      (r) => ({ ...r, confirmSignature: stripOpeningConfirmSignature(r) }),
    ) as typeof project.openingRecords;

    // L6 数据级隔离：bid portal 只能看指派给自己的项目。
    // admin 豁免（N1，2026-08-28，浏览器验证发现）：:3007 是 admin 的默认落地门户且
    // 全模块 @Roles 均含 admin（解密/启动评标/归档皆可办），任务板已对 admin 放开
    // （getProjectsDashboard 同步豁免），此处不豁免会「看得到进不去」。
    if (portal === 'bid' && actor && actor.role !== 'admin' && project.assignedHostUserId !== actor.id) {
      throw new ForbiddenException('无权访问该项目（未指派给您）');
    }

    // 配置开关：评标期间对主持端匿名化专家身份（同 listScores）。
    // 2026-08-15 审计整改：默认开启（未配置视为开启，显式 =false 才关闭）；
    // 匿名标签按 expertId 排序稳定编号（专家 1/2/…），刷新不换号，矩阵行间可区分。
    // 2026-08-17 方案 A（角色分层实名）：admin/bid_host 是现场组织者，评标期间需实名管理
    // 专家（点名/签到核对/打印签字/面对面沟通）——expertName 保留实名并额外下发 anonLabel，
    // 评分矩阵/排名/偏差清单仍按 anonLabel 呈现（组织视图实名、评分视图匿名）；
    // 其余角色（leader/staff/其他）维持原匿名口径。实名查看写监督日志留痕（logExpertRosterView）。
    const anonymize = process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL !== 'false';
    if (anonymize) {
      const allConfirmed = project.experts.length > 0 && project.experts.every(e => e.reportConfirmed);
      if (project.stage === 'EVALUATING' && !allConfirmed) {
        const anonLabel = new Map(
          [...project.experts].map(e => e.id).sort().map((id, i) => [id, `专家 ${i + 1}`]),
        );
        const privileged = !!actor && (actor.role === 'admin' || actor.role === 'bid_host');
        project.experts = project.experts.map(e => ({
          ...e,
          // 评分视图匿名标签（矩阵等）——所有角色统一使用
          anonLabel: anonLabel.get(e.id) ?? '专家',
          // 组织视图：特权角色保留实名，其余角色匿名
          expertName: privileged ? e.expertName : (anonLabel.get(e.id) ?? '专家'),
          scoreRecords: e.scoreRecords.map(r => ({ ...r, expertId: null } as unknown as typeof r)),
        })) as typeof project.experts;
        if (privileged && actor) {
          void this.logExpertRosterView(project.id, actor);
        }
      }
    }

    // 用源项目管理的 projectCode 覆盖 bid 自动生成的编号
    if (project.projectManagementItemId) {
      const pm = await this.prisma.projectManagementItem.findUnique({
        where: { id: project.projectManagementItemId },
        select: { projectCode: true },
      });
      if (pm?.projectCode) {
        project.projectCode = pm.projectCode;
      }
    }

    // N4a：法定最少投标家数随详情下发（直接采购=1，其余=3）——前端流标建议按采购方式取数，不再硬编码 3
    const enriched = { ...project, minBidders: this.getMinBidders(project.procurementMethod) };
    // L6 字段去敏：bid portal 视角移除管理内部字段（minBidders 不在去敏清单）
    if (portal === 'bid') {
      return sanitizeForBidHost(enriched);
    }
    return enriched;
  }

  /** 方案 A 留痕：特权角色（admin/bid_host）评标期间查看专家实名名单写监督日志。
   *  按 operatorId+action 30 分钟去重，避免详情轮询刷屏。 */
  private async logExpertRosterView(
    projectId: string,
    actor: { id: string; role: string },
  ): Promise<void> {
    try {
      const windowStart = new Date(Date.now() - 30 * 60_000);
      const recent = await this.prisma.bidSupervisionLog.findFirst({
        where: {
          projectId,
          operatorId: actor.id,
          action: '查看专家实名名单',
          time: { gte: windowStart },
        },
        select: { id: true },
      });
      if (recent) return;
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId,
          time: new Date(),
          role: actor.role === 'admin' ? '管理员' : '开标主持人',
          target: '评标管理',
          action: '查看专家实名名单',
          result: '角色分层实名：现场组织者可见专家实名（评分矩阵与分数仍按编号匿名）',
          riskFlag: '低',
          operatorId: actor.id,
          operatorRole: actor.role,
        },
      });
    } catch (e) {
      this.logger.warn(`专家实名查看留痕失败: ${(e as Error).message}`);
    }
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
        include: { supplier: { select: { id: true, name: true, tags: true, classification: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidExpert.findMany({
        where: { projectId: id },
        include: { user: { select: { expertProfile: { select: { title: true, employer: true } } } } },
        orderBy: [{ expertRole: 'desc' }, { createdAt: 'asc' }],
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
        tags: s.supplier?.tags ?? [],
        downloadStatus: s.downloadStatus,
        submitStatus: s.submitStatus,
        decryptStatus: s.decryptStatus,
        confirmStatus: s.confirmStatus,
        submission: safeSubmission,
        submitted,
        withdrawn,
      };
    });
    // A-100：接收列表按接收时间排序——已递交(submittedAt 升序)在前、未递交(名册序)居中、已撤回殿后
    sortSupplierRowsBySubmission(supplierRows);

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

  async createProject(dto: CreateBidProjectDto, operator?: { sub: string; role: string }) {
    const projectCode = await generateProjectCode(this.prisma, dto.procurementMethod);
    // A1（B.4.3.3/4）：分配国标编码——有 PMI 宿主复用其 18 位基码，否则自立
    const host = dto.projectManagementItemId
      ? await this.prisma.projectManagementItem.findUnique({ where: { id: dto.projectManagementItemId }, select: { gbProjectCode: true } })
      : null;
    // 赋码失败降级不阻塞建项，但必须可见（静默教训：0/18 全空曾被 .catch(()=>null) 掩盖——真因种子直载）
    const gbCodes = await this.gbCode.allocateProcureCode(host?.gbProjectCode ?? null).catch((e) => {
      this.logger.warn(`国标采购编码分配失败（建项降级为无码，须回填）: ${(e as Error).message}`);
      return null;
    });
    // 截标↔开标 24h（P0-2）：双字段提供 → align 校验；缺 deadline → 按规则派生
    // （DTO 层 openTime/deadline 均为必填，此分支为服务层防御；缺 openTime 保持原行为不动）
    const openTime = new Date(dto.openTime);
    let deadline: Date;
    if (dto.deadline != null) {
      deadline = new Date(dto.deadline);
      assertOpeningDeadlineRelation({ openTime, deadline, mode: 'align' });
    } else {
      deadline = deriveDeadlineFromOpenTime(openTime);
    }
    const project = await this.prisma.bidProject.create({
      data: {
        name: dto.name,
        projectCode,
        ...(gbCodes ?? {}),
        procurementMethod: dto.procurementMethod,
        evaluationMethod: getEvaluationDefault(dto.procurementMethod).evaluationMethod,
        roundMode: dto.procurementMethod === '谈判采购' ? 'negotiation'
                  : dto.procurementMethod === '竞价采购' ? 'sealed_auction'
                  : null,
        openTime,
        deadline,
        riskNote: dto.riskNote,
        qualityRequirement: dto.qualityRequirement,
        // P1-4（2026-09-09 补录入口）：依法必招标式落库——B-004/B-009 发布闸门据此强制（缺省 false）
        legalMandatory: dto.legalMandatory === true,
        bondRequired: dto.bondRequired ?? false,
        bondAmount: dto.bondAmount,
        // 公司归属快照自创建人（BidCompanyScopeGuard：非_admin 内部角色仅本公司项目可见）
        ...(await this.operatorCompanyStamp(operator)),
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
    companyStamp: { companyId?: string | null; companyName?: string | null } = {},
  ) {
    const procurementMethod = metadata.method || '公开招标';
    const projectCode = await generateProjectCode(this.prisma, procurementMethod);
    // A1（B.4.3.3/4）：国标采购项目编码 + 标段编码（宿主 PMI 的 18 位码优先复用）
    const host = metadata.projectManagementItemId
      ? await this.prisma.projectManagementItem.findUnique({ where: { id: metadata.projectManagementItemId }, select: { gbProjectCode: true } })
      : null;
    const gbCodes = await this.gbCode.allocateProcureCode(host?.gbProjectCode).catch((e) => {
      this.logger.warn(`国标采购编码分配失败（公告直建降级为无码，须回填）: ${(e as Error).message}`);
      return null;
    });
    const openTime = parseFlexibleDate(metadata.openTime) ?? (announcement.publishDate || new Date());
    // 截标↔开标 24h（P0-2）：metadata.deadline 缺省 → 派生（替换原 +7 天兜底）；提供 → align 校验
    const parsedDeadline = parseFlexibleDate(metadata.deadline);
    let deadline: Date;
    if (parsedDeadline) {
      assertOpeningDeadlineRelation({ openTime, deadline: parsedDeadline, mode: 'align' });
      deadline = parsedDeadline;
    } else {
      deadline = deriveDeadlineFromOpenTime(openTime);
    }
    // 采购文件下载截止时间（= 公告截止时间），超时不可下载
    const downloadDeadline = parseFlexibleDate(metadata.downloadDeadline);

    const project = await this.prisma.bidProject.create({
      data: {
        name: announcement.title,
        projectCode,
        procurementMethod,
        evaluationMethod: getEvaluationDefault(procurementMethod).evaluationMethod,
        roundMode: procurementMethod === '谈判采购' ? 'negotiation'
                  : procurementMethod === '竞价采购' ? 'sealed_auction'
                  : null,
        openTime,
        deadline,
        downloadDeadline,
        riskNote: '（来自公告自动创建）',
        ...(gbCodes ?? {}),
        budget: metadata.budget != null ? Number(metadata.budget) : null,
        scope: metadata.scope || null,
        qualification: metadata.qualification || null,
        // A3（7.2.2.3）：直接采购理由随公告建项落库，供公告/详情公示
        directSourcingReason: metadata.directSourcingReason || null,
        contact: metadata.contact || null,
        // P1-4（2026-09-09 补录入口）：公告直建持久化依法必招标式（guard 直建路径读 metadata，
        // 建项后随列存储——后续再发布以项目列为准）
        legalMandatory: metadata.legalMandatory === true,
        stage: 'DOWNLOAD',
        // 公司归属：跟随公告（admin 代发时项目归公告所属公司，而非操作人）
        companyId: companyStamp.companyId ?? null,
        companyName: companyStamp.companyName ?? null,
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

    // P1-15（走查⑤）：时间合理性校验——AI 智能填入/字段提取可能产出「发布时刻」这类无效
    // 开标时间并随公告 sync 覆盖 ensureBidProject 的合理兜底值（走查实测 openTime 回退当日
    // 16:24 且早于投递截止，供应商门户显示时间矛盾）。无效值一律忽略、保留项目原值。
    const parsedOpen = parseFlexibleDate(metadata.openTime);
    const parsedDeadline = parseFlexibleDate(metadata.deadline);
    const openTime = parsedOpen && parsedOpen.getTime() > Date.now()
      ? parsedOpen
      : undefined;
    // 截标↔开标 24h（P0-2）：覆盖方向不变（parsedDeadline < openTime 才覆盖 / 无有效 openTime 时
    // 沿用 metadata deadline），但覆盖值改为按 openTime 派生 24h，杜绝公告元数据把非 24h 关系写回。
    const deadline = parsedDeadline
      && (!openTime || parsedDeadline.getTime() < openTime.getTime())
      ? (openTime ? deriveDeadlineFromOpenTime(openTime) : parsedDeadline)
      : undefined;
    const downloadDeadline = parseFlexibleDate(metadata.downloadDeadline) ?? undefined;

    const updated = await this.prisma.bidProject.update({
      where: { id: projectId },
      data: {
        name: announcement.title,
        ...(metadata.method !== undefined && {
          procurementMethod: metadata.method,
          roundMode: metadata.method === '谈判采购' ? 'negotiation'
                    : metadata.method === '竞价采购' ? 'sealed_auction'
                    : null,
        }),
        ...(openTime && { openTime }),
        ...(deadline && { deadline }),
        ...(downloadDeadline !== undefined && { downloadDeadline }),
        ...(metadata.budget !== undefined && { budget: Number(metadata.budget) }),
        ...(metadata.scope !== undefined && { scope: metadata.scope }),
        ...(metadata.qualification !== undefined && { qualification: metadata.qualification }),
        ...(metadata.directSourcingReason !== undefined && { directSourcingReason: metadata.directSourcingReason }),
        ...(metadata.contact !== undefined && { contact: metadata.contact }),
        // P1-4：metadata 显式携带时同步（未提供不覆盖既有值）
        ...(metadata.legalMandatory !== undefined && { legalMandatory: metadata.legalMandatory === true }),
      },
    });

    this.logger.log(`公告同步更新项目: ${updated.projectCode} (projectId=${projectId})`);
    return updated;
  }

  async updateProject(id: string, dto: UpdateBidProjectDto, actorId?: string) {
    // stage 流转不走此接口：曾允许 PATCH stage 绕过专用端点的前置校验/副作用/审计
    // （OPENING→EVALUATING 不建 AI task 致分析死锁，且无监督/审计日志）。
    // 阶段变更须走 openSubmission/startOpening/startEvaluation/archiveAll 等专用端点。

    // P1-4（2026-09-09 补录入口）：依法必招标式——开标启动前可录可改，OPENING 起锁定。
    // 标志决定 B-004/B-009 发布闸门是否强制，开标后翻标志无法追溯已发布流程，只允许前进期录入。
    if (dto.legalMandatory !== undefined) {
      const stageRow = await this.prisma.bidProject.findUnique({ where: { id }, select: { stage: true } });
      if (stageRow && !['DOWNLOAD', 'SUBMIT'].includes(stageRow.stage)) {
        throw new ConflictException({
          error: `开标已启动（${stageRow.stage}），依法必招标式不可变更；如需更正请走数据修正流程`,
          code: 'LEGAL_FLAG_LOCKED',
        });
      }
    }

    // P1-3（2026-09-09 审查）：阶段锁——①定标语义字段（采购方式/资质要求/保证金）自开标启动
    // （OPENING）起锁定：改 procurementMethod 会漂移法定家数门槛 getMinBidders 口径（如评标中
    // 改「直接采购」使门槛 3→1，事后合法化家数不足），更正须走法定程序（更正公告）；
    // ②ARCHIVED 为不可逆终局，任何字段不可再改——开标文件包/归档包/签字包记录的是归档时值，
    // 事后 PATCH（含旧 frozen 分支仅校验相对关系的 openTime/deadline）都会污染历史证据。
    // DOWNLOAD/SUBMIT/ABORTED 维持可编辑（发标期调整；流标项目重启前修正是正当窗口——
    // reopenFromAborted 复制这些字段进新一轮）。
    // null 守卫（同 P0-2 终审口径）：@IsOptional 放行显式 null，null 一律视同未提供
    const providedAnyField = [
      'name', 'procurementMethod', 'openTime', 'deadline', 'riskNote', 'budget', 'scope',
      'qualification', 'contact', 'qualityRequirement', 'bondRequired', 'bondAmount',
      'sectionNo', 'sectionName', 'legalMandatory',
    ].some(k => (dto as Record<string, unknown>)[k] != null);
    if (providedAnyField) {
      const stageRow = await this.prisma.bidProject.findUnique({ where: { id }, select: { stage: true } });
      if (stageRow) {
        if (stageRow.stage === 'ARCHIVED') {
          throw new ConflictException({
            error: '项目已归档（不可逆终局），项目信息不可再修改；如需更正请走数据修正流程',
            code: 'PROJECT_ARCHIVED_IMMUTABLE',
          });
        }
        const stageLocked = ['procurementMethod', 'qualification', 'bondRequired', 'bondAmount']
          .some(k => (dto as Record<string, unknown>)[k] != null);
        if (stageLocked && (stageRow.stage === 'OPENING' || stageRow.stage === 'EVALUATING')) {
          throw new ConflictException({
            error: `开标已启动（${stageRow.stage}），采购方式/资质要求/保证金等定标语义字段已锁定；如需更正请按法定程序办理（更正公告）`,
            code: 'STAGE_FIELD_LOCKED',
          });
        }
      }
    }

    // 截标↔开标 24h（P0-2）分阶段语义：
    // - align（prev.deadline 未过）：仅传 openTime → deadline 派生；仅传 deadline → openTime 派生；双传 → align 校验
    // - frozen（prev.deadline 已过，延时开标 PATCH openTime 走此分支）：deadline 不得变更；openTime ≥ deadline + 24h
    // 非时间字段更新不读 prev、不走校验（零回归）。
    let openTime: Date | undefined;
    let deadline: Date | undefined;
    let prevTime: { openTime: Date; deadline: Date } | undefined;
    // 终审 null 守卫：@IsOptional 放行显式 null，若按 !== undefined 判定会把 new Date(null)=epoch
    // 当「提供」反推 1969；null 一律视同未提供（不写时间字段、不进 align/frozen 校验）
    if (dto.openTime != null || dto.deadline != null) {
      const prev = await this.prisma.bidProject.findUnique({
        where: { id },
        select: { openTime: true, deadline: true, stage: true },
      });
      if (prev?.openTime && prev?.deadline) {
        prevTime = { openTime: prev.openTime, deadline: prev.deadline };
        const mode = modeFor(prev.deadline);
        const newOpen = dto.openTime != null ? new Date(dto.openTime) : undefined;
        const newDeadline = dto.deadline != null ? new Date(dto.deadline) : undefined;
        if (mode === 'frozen') {
          // frozen 必传 prev：DEADLINE_FROZEN 检查依赖现值比对，缺失会静默跳过
          assertOpeningDeadlineRelation({
            openTime: newOpen ?? prev.openTime,
            deadline: newDeadline ?? prev.deadline,
            prev: { openTime: prev.openTime, deadline: prev.deadline },
            mode: 'frozen',
          });
          openTime = newOpen;
          deadline = newDeadline;
        } else if (newOpen && newDeadline) {
          assertOpeningDeadlineRelation({ openTime: newOpen, deadline: newDeadline, mode: 'align' });
          openTime = newOpen;
          deadline = newDeadline;
        } else if (newOpen) {
          openTime = newOpen;
          deadline = deriveDeadlineFromOpenTime(newOpen);
        } else if (newDeadline) {
          openTime = deriveOpenTimeFromDeadline(newDeadline);
          deadline = newDeadline;
        }
      } else {
        // 项目不存在或时间字段缺失的历史行：保持原行为（仅写入所传字段，由 update 抛 P2025/落库）
        openTime = dto.openTime != null ? new Date(dto.openTime) : undefined;
        deadline = dto.deadline != null ? new Date(dto.deadline) : undefined;
      }
    }
    const updated = await this.prisma.bidProject.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.procurementMethod !== undefined && { procurementMethod: dto.procurementMethod }),
        ...(openTime !== undefined && { openTime }),
        ...(deadline !== undefined && { deadline }),
        ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }),
        ...(dto.budget !== undefined && { budget: dto.budget }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
        ...(dto.qualification !== undefined && { qualification: dto.qualification }),
        ...(dto.contact !== undefined && { contact: dto.contact }),
        ...(dto.qualityRequirement !== undefined && { qualityRequirement: dto.qualityRequirement }),
        ...(dto.bondRequired !== undefined && { bondRequired: dto.bondRequired }),
        ...(dto.bondAmount !== undefined && { bondAmount: dto.bondAmount }),
        ...(dto.legalMandatory !== undefined && { legalMandatory: dto.legalMandatory === true }),
        ...(dto.sectionNo !== undefined && { sectionNo: dto.sectionNo }),
        ...(dto.sectionName !== undefined && { sectionName: dto.sectionName }),
      },
    });

    // P1-4：截标/开标时间修改留痕（监督日志 + 审计日志，含前后值；fire-and-forget 不阻塞主流程）
    if (openTime !== undefined || deadline !== undefined) {
      const detail = {
        prev: prevTime ? { openTime: prevTime.openTime.toISOString(), deadline: prevTime.deadline.toISOString() } : null,
        next: { openTime: openTime?.toISOString() ?? null, deadline: deadline?.toISOString() ?? null },
      };
      this.prisma.bidSupervisionLog.create({
        data: {
          projectId: id,
          time: new Date(),
          role: actorId ? '采购人员' : '系统',
          target: '开标/截标时间调整',
          action: '项目时间调整',
          result: JSON.stringify(detail),
          riskFlag: '中',
        },
      }).catch(() => {});
      if (actorId) {
        this.prisma.auditLog.create({
          data: {
            userId: actorId,
            action: 'BID_PROJECT_TIME_UPDATED',
            resourceType: `BidProject:${id}`,
            details: detail,
          },
        }).catch(() => {});
      }
    }
    return updated;
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
  async completeOpening(id: string, actorId?: string, opts?: { auto?: boolean; trigger?: string }) {
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

    // 异议超时检查（告警 + 可选自动裁决；不阻塞移交）
    await this.checkDisputeTimeout(id);

    // 文件包与上传放在事务之前：MinIO 失败 → 零数据库副作用，可安全重试
    const pkg = await this.buildHandoverPackage(project, existing);
    const buffer = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
    const objectKey = `bid-opening-handover/${id}.json`;
    await this.storage.upload(objectKey, buffer, 'application/json');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const session = await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, id, 'OPENING'); // 行锁复查：防并发归档/流标偷跑
      // TOCTOU 收窄：事务内复查 opening-done（防 check → tx 间隙异议插入）
      // assertOpeningDone 内部用 this.prisma（非 tx），在高隔离级别下读到的可能是事务前快照，
      // 故在此用 tx 内联同样的 notReady 判定。FOR UPDATE 锁住 BidProject 行不锁 BidSupplier 行，
      // 异议可并发修改 confirmStatus，须 tx 内重读。
      const txSuppliers = await tx.bidSupplier.findMany({
        where: { projectId: id, submitStatus: { not: '已撤回' } },
        select: { supplierName: true, supplierId: true, submitStatus: true, decryptStatus: true, confirmStatus: true },
      });
      // P1-5b：事务内复查同口径排除未投递家（与 getOpeningNotReady 一致，防 check→tx 间隙口径分叉）
      const txSubMap = await this.loadSubmissionStatusMap(tx, id);
      const txNotReady = txSuppliers.filter(s => BidService.isSubmittedRow(s, txSubMap) && BidService.openingRowNotReady(s));
      if (txNotReady.length > 0) {
        throw new ConflictException({
          error: `事务内复查：开标尚未完成，${txNotReady.map(s => s.supplierName).join('、')} 未到终局态`,
          code: 'OPENING_NOT_DONE_TX',
        });
      }
      const fresh = await tx.bidOpeningSession.findUnique({ where: { projectId: id } });
      if (fresh?.status === '开标完成') return fresh; // 并发幂等：后提交方走既有产物
      const now = new Date();
      // 终审 Important #2：upsert 而非裸 create——MinIO 上传在事务前且 payload 含 generatedAt，
      // 亚秒级并发下第二笔先覆盖 MinIO 再早退，若 DB 仍 create 会撞 key @unique（P2002）；
      // upsert 的 update 段同步刷新 size/sha256，DB 指纹不与 MinIO 内容分叉（N3/P1-17 同款）
      const asset = await tx.fileAsset.upsert({
        where: { key: objectKey },
        create: {
          key: objectKey,
          originalName: `开标文件包-${project.projectCode}.json`,
          mimeType: 'application/json',
          size: buffer.length,
          sha256,
          category: 'bid_opening_handover',
          uploaderId: actorId ?? null,
        },
        update: { size: buffer.length, sha256, uploaderId: actorId ?? null },
      });
      const updated = await tx.bidOpeningSession.update({
        where: { projectId: id },
        data: { status: '开标完成', handoverAt: now, handoverAssetId: asset.id },
      });
      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: now, role: existing.host, target: project.name, action: '完成开标·资料移交', result: `${opts?.auto ? `[自动固化·${opts.trigger ?? '终局'}] ` : ''}开标文件包已生成并移交采购管理工作台`, riskFlag: '无' },
      });
      if (actorId) {
        let integrityStamp: { ts: string; sig: string } | null = null;
        try {
          integrityStamp = createIntegrityStamp(actorId, 'COMPLETE_OPENING', id);
        } catch { /* 签名失败不阻塞开标移交 */ }
        await tx.auditLog.create({ data: { userId: actorId, action: 'BID_OPENING_HANDOVER', resourceType: `BidProject:${id}`, details: { assetId: asset.id, sha256, integrityStamp } } });
      }
      return updated;
    });

    // 事务后通知（失败不阻塞，同 abort 通知模式）
    this.gateway?.notifyOpeningCompleted(id, {
      handoverAt: (session.handoverAt ?? new Date()).toISOString(),
      handoverAssetId: session.handoverAssetId ?? '',
    });
    this.gateway?.notifySupervisionLog(id, { role: existing.host, action: '完成开标·资料移交', target: project.name, result: `${opts?.auto ? `[自动固化·${opts.trigger ?? '终局'}] ` : ''}开标文件包已生成并移交采购管理工作台`, riskFlag: '无' });
    const pmLink = project.projectManagementItemId
      ? `/projects?projectId=${project.projectManagementItemId}&panel=bid-confirm`
      : '/projects';
    for (const role of ['leader', 'staff']) {
      try {
        await this.notificationService.sendToRole(role, {
          type: 'BID_OPENING_HANDED_OVER',
          title: opts?.auto ? `项目${project.name}开标完成，开标资料已自动固化移交` : `项目${project.name}开标完成，资料已移交`,
          content: opts?.auto
            ? `全部投标人已到终局态（触发：${opts.trigger ?? '终局'}），开标文件包已自动生成固化`
            : '开标文件包已生成，可在开标确认面板启动评标或执行后续流程',
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

  /** 终局即固化（A）：全部供应商到终局态后自动生成开标文件包并移交 :3005。
   *  幂等、内部吞错仅告警——绝不阻塞触发它的业务路径；startEvaluation 另有兜底（B），
   *  :3007 手动按钮保留为幂等补触。触发点：供应商确认唱标 / 供应商解密终局 / 主持端解密归因·裁决·接受 / 启动评标兜底。 */
  async autoHandoverIfDone(projectId: string, trigger: string, knownProject?: { stage: string }): Promise<void> {
    try {
      // knownProject：调用方已查得的项目行（如 startEvaluation 自身的前置读）——复用可少一次查询，
      // 也避免吞掉测试/上游精心排队的 findUnique mock 序列
      const [session, project] = await Promise.all([
        this.prisma.bidOpeningSession.findUnique({ where: { projectId }, select: { status: true } }),
        knownProject
          ? Promise.resolve(knownProject)
          : this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } }),
      ]);
      if (!session || session.status === '开标完成' || project?.stage !== 'OPENING') return;
      if ((await this.getOpeningNotReady(projectId)).length > 0) return;
      await this.completeOpening(projectId, undefined, { auto: true, trigger });
      this.logger.log(`开标文件包已自动固化移交（trigger=${trigger}）`);
    } catch (e: any) {
      this.logger.warn(`开标文件包自动固化失败（trigger=${trigger}，不阻塞业务）：${e?.message}`);
    }
  }

  /** 开标文件包：开标环节全部资料（会话/供应商/开标记录/监督日志）+ 内容指纹。 */
  private async buildHandoverPackage(
    project: { id: string; projectCode: string; name: string; procurementMethod: string; openTime: Date; deadline: Date; stage: string },
    session: { host: string; supervisor: string | null; decryptWindowStart: Date; decryptWindowEnd: Date; status: string },
  ) {
    // H9: 查询项目 roundMode，多轮项目包含报价历史
    const projectDetail = await this.prisma.bidProject.findUnique({
      where: { id: project.id },
      select: { roundMode: true },
    });

    const [suppliers, submissions, records, logs, bidRounds] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: project.id },
        // §5.5：dangerAttribution 归因写入开标文件包（法定留痕）；A-111：decryptedAt 解密成功时间入包
        select: { supplierId: true, supplierName: true, receiptNo: true, encryptStatus: true, decryptStatus: true, confirmStatus: true, submitStatus: true, dangerAttribution: true, decryptedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // §5.5b（Task 18）：dual-v2 解密明文资产指纹入包（decryptedAssets → FileAsset.sha256）
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: project.id },
        select: { supplierId: true, envelopeVersion: true, decryptedAssets: true, status: true, submittedAt: true },
      }),
      this.prisma.bidOpeningRecord.findMany({
        where: { projectId: project.id },
        // A-114（SHOULD-FIX-1）：开标文件包为带 SHA-256 指纹的证据件——确认电子签名两列完整入包（spec §一.4），
        // 不做 getProject/listOpeningRecords 式剥壳（主持端视图才剥摘要）。
        select: { supplierName: true, amount: true, period: true, qualityTarget: true, bondStatus: true, confirmStatus: true, confirmSignature: true, confirmSignedAt: true, objectionReason: true, handleResult: true },
      }),
      this.prisma.bidSupervisionLog.findMany({
        where: { projectId: project.id },
        select: { time: true, role: true, action: true, target: true, result: true, riskFlag: true },
        orderBy: { time: 'asc' },
      }),
      // H9: 多轮报价历史
      projectDetail?.roundMode ? this.prisma.bidRound.findMany({
        where: { projectId: project.id },
        include: { quotes: { select: { bidSupplierId: true, quotePrice: true, submittedAt: true, status: true } } },
        orderBy: { roundNo: 'asc' },
      }) : Promise.resolve([]),
    ]);
    const active = suppliers.filter(s => s.submitStatus !== '已撤回');

    // §5.5b（Task 18）：dual-v2 解密明文资产指纹——submission.decryptedAssets 为 {role: assetId}，
    // 取各 FileAsset.sha256 输出角色→sha256 映射；未解密/旧轨家为 null。
    const submissionBySupplierId = new Map(submissions.map((s: any) => [s.supplierId, s]));
    const decryptedAssetIds = Array.from(new Set(
      submissions
        .filter((s: any) => s.envelopeVersion === 'dual-v2' && s.decryptedAssets && typeof s.decryptedAssets === 'object')
        .flatMap((s: any) =>
          Object.values(s.decryptedAssets as Record<string, unknown>).filter((v): v is string => typeof v === 'string'),
        ),
    ));
    const shaByAssetId = decryptedAssetIds.length > 0
      ? new Map((await this.prisma.fileAsset.findMany({
          where: { id: { in: decryptedAssetIds } },
          select: { id: true, sha256: true },
        })).map((a: { id: string; sha256: string }) => [a.id, a.sha256]))
      : new Map<string, string>();
    const suppliersWithFingerprints = suppliers.map((s: any) => {
      const submission = submissionBySupplierId.get(s.supplierId);
      const decryptedAssets = (submission && submission.envelopeVersion === 'dual-v2'
        && submission.decryptedAssets && typeof submission.decryptedAssets === 'object')
        ? submission.decryptedAssets as Record<string, unknown>
        : null;
      const byRole: Record<string, string | null> = {};
      if (decryptedAssets) {
        for (const [role, assetId] of Object.entries(decryptedAssets)) {
          byRole[role] = typeof assetId === 'string' ? (shaByAssetId.get(assetId) ?? null) : null;
        }
      }
      return {
        ...s,
        decryptedFileSha256: decryptedAssets ? byRole : null,
        // A-100：排序用临时字段（submitted/withdrawn/submission）——排序后剥离，不入文件包输出
        submitted: submission?.status === 'submitted',
        withdrawn: submission?.status === 'withdrawn',
        submission: submission ? { submittedAt: submission.submittedAt } : null,
      };
    });
    // A-100：开标文件包供应商行同 getWorkspace 口径按接收时间排序（已递交升序→未投名册序→已撤回殿后）
    const orderedSuppliers = sortSupplierRowsBySubmission(suppliersWithFingerprints)
      .map(({ submitted: _submitted, withdrawn: _withdrawn, submission: _submission, ...rest }) => rest);

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
      suppliers: orderedSuppliers,
      openingRecords: records,
      supervisionLogs: logs,
      bidRounds: bidRounds.length > 0 ? bidRounds.map(r => ({
        roundNo: r.roundNo, roundType: r.roundType, status: r.status,
        deadline: r.deadline?.toISOString() ?? null,
        quotes: r.quotes,
      })) : undefined,
      summary,
    };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return { ...body, fingerprint };
  }

  async openSubmission(id: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true, projectCode: true, projectManagementItemId: true, procurementMethod: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'SUBMIT');

    // G3: 开放投递前必须已发布招标公示（供应商经 relatedProjectCode 获取招标文件）。
    // 公告存业务编号（ZJ-xxx）、项目内部是 BID-时间戳——两个编号都试，否则闸门恒误拒。
    const notice = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: { in: await this.resolveAnnouncementCodes(project) }, type: 'BID_NOTICE', status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!notice) {
      throw new ConflictException({
        error: '尚未发布招标公示，供应商无法获取招标文件，请先在信息发布中心发布招标公告',
        code: 'BID_NOTICE_REQUIRED',
      });
    }

    // W3/B-006：邀请类采购（邀请招标/谈判）须 ≥3 家已接受邀请方可开放投递
    if (['邀请招标', '谈判采购'].includes(project.procurementMethod)) {
      const accepted = await this.prisma.invitationRsvp.count({
        where: { projectId: id, status: 'ACCEPTED' },
      });
      assertMinAcceptedInvitees({ procurementMethod: project.procurementMethod, acceptedCount: accepted });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, id, 'SUBMIT'); // C1: 事务内行锁后复查阶段
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
  async abortBidProject(id: string, actorId?: string, reason?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, name: true, stage: true, procurementMethod: true, _count: { select: { suppliers: true } } },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    assertBidStageTransition(project.stage, 'ABORTED');

    // N4c：已生成官方评标结果仍可流标（定标前发现重大问题的合法出口），但必须书面理由并高风险留痕
    const resultCount = await this.prisma.bidEvaluationResult.count({ where: { projectId: id } });
    if (resultCount > 0 && !reason?.trim()) {
      throw new BadRequestException({ error: '本项目已生成官方评标结果，流标须填写书面理由（结果将作废并留痕）', code: 'ABORT_REASON_REQUIRED' });
    }

    // #16 流标业务留痕：riskNote 记录采购方式 + 投标供应商数 + 时间 + 操作人
    // （请求级留痕含操作人 userId 由全局 OperationLogInterceptor 自动记录）
    const supplierCount = project._count.suppliers;
    const abortAt = new Date().toISOString();
    const reasonPart = reason ? `，原因：${reason}` : '';
    const riskNote = `流标（${project.procurementMethod}，投标供应商 ${supplierCount} 家，${abortAt}${actorId ? `，操作人 ${actorId}` : ''}${reasonPart}）`;

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, id, 'ABORTED');
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'ABORTED', riskNote },
        select: { id: true, stage: true },
      });
      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name,
          action: '流标', result: `${riskNote}${resultCount > 0 ? '；注意：已存在官方评标结果，随流标作废' : ''}`, riskFlag: '高风险' },
      });
      return result;
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

    // P3-5: 通知已分配的评审专家（N9：仅已确认正选——候补/已婉拒/未确认不再收流标通知）
    try {
      const experts = await this.prisma.bidExpert.findMany({
        where: { projectId: id, expertRole: '正选', invitationStatus: 'confirmed' },
        select: { userId: true, expertName: true },
      });
      for (const e of experts) {
        if (!e.userId) continue;
        await this.notificationService.sendToUser(e.userId, ['in_app'], {
          type: 'BID_ABORTED',
          title: `项目${project.name}已流标`,
          content: '您被指派的评标项目已流标，无需继续评审。',
          link: '/',
        }).catch(() => {});
      }
    } catch { /* 通知失败不阻塞流标 */ }

    // F18（2026-08-28）：补审计——流标是高风险动作，旧实现仅监督日志、零 AuditLog
    //（对照阶段变更/裁决/延期均有审计；try/catch 兜底，审计失败不阻断流标结果）
    if (actorId) {
      try {
        await this.prisma.auditLog.create({
          data: { userId: actorId, action: 'BID_PROJECT_ABORT', resourceType: `BidProject:${id}`, details: { reason: riskNote ?? null, hadResults: resultCount > 0, fromStage: project.stage } },
        });
      } catch { /* 审计失败不阻断 */ }
    }

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
        companyId: true, companyName: true,
      },
    });
    if (!original) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (original.stage !== 'ABORTED') {
      throw new BadRequestException({ error: '仅流标项目可重启', code: 'PROJECT_NOT_ABORTED' });
    }

    // N5：原时间已随流标过期——重启项目给「截标 +3 天、开标 = 截标 +24h」兜底窗口，并在留痕中提示重新设定
    const fallbackDeadline = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const fallbackOpenTime = deriveOpenTimeFromDeadline(fallbackDeadline);
    const newCode = await generateProjectCode(this.prisma, original.procurementMethod);
    const now = new Date();
    const newProject = await this.prisma.bidProject.create({
      data: {
        name: original.name,
        projectCode: newCode,
        procurementMethod: original.procurementMethod,
        openTime: fallbackOpenTime,
        deadline: fallbackDeadline,
        downloadDeadline: null,
        budget: original.budget,
        scope: original.scope,
        qualification: original.qualification,
        contact: original.contact,
        qualityRequirement: original.qualityRequirement,
        bondRequired: original.bondRequired,
        bondAmount: original.bondAmount,
        round: (original.round ?? 1) + 1,
        projectManagementItemId: original.projectManagementItemId,
        // 公司归属随原项目承继（重启不改变归属主体）
        companyId: original.companyId ?? null,
        companyName: original.companyName ?? null,
        stage: 'DOWNLOAD',
        riskNote: `（从流标项目 ${original.name} 重启，原项目编号 ${original.projectCode ?? id}，操作时间 ${now.toISOString()}${actorId ? `，操作人 ${actorId}` : ''}；重启默认时间 截标 ${fallbackDeadline.toISOString()} / 开标 ${fallbackOpenTime.toISOString()}（请在项目编辑中重新设定））`,
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

  /** 按采购方式返回法定最少投标家数。消费方：开标 checklist + 启动评标 */
  private getMinBidders(procurementMethod: string | null): number {
    // 谈判采购与其余方式（邀请招标/询比采购等）同为 3 家
    // （《采购管理办法》：谈判/询比应邀请不少于3家，与 stage-compliance-rules 供应商邀请检查同口径）
    return getMinBiddersForMethod(procurementMethod);
  }

  /**
   * E6: 评标完成闸门——谈判采购"先评标→再报价"。
   * 正选专家全部确认 + 组长末签 + 无未裁决异议，与 generateEvaluationResults 同口径。
   */
  private async assertEvaluationComplete(projectId: string): Promise<void> {
    const experts = await this.prisma.bidExpert.findMany({
      where: { projectId, expertRole: '正选' },
      select: { reportConfirmed: true },
    });
    if (experts.some(e => !e.reportConfirmed)) {
      throw new BadRequestException({ error: '仍有正选专家未确认评审报告', code: 'EXPERT_REPORTS_NOT_CONFIRMED' });
    }
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { leaderCoSigned: true },
    });
    if (!project?.leaderCoSigned) {
      throw new BadRequestException({ error: '评审报告尚未经组长末签', code: 'LEADER_NOT_COSIGNED' });
    }
    const openDisputes = await this.prisma.expertDispute.count({ where: { projectId, status: 'open' } });
    if (openDisputes > 0) {
      throw new BadRequestException({ error: `有 ${openDisputes} 个专家异议待裁决，评标尚未完成`, code: 'OPEN_DISPUTES' });
    }
  }

  private async startOpeningInternal(id: string, dto?: StartOpeningDto, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true, deadline: true, openTime: true, projectManagementItemId: true, round: true, assignedHostUserId: true, procurementMethod: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'OPENING');

    // P1: 整个阶段变更 + Session 创建用事务包裹，防止并发竞争
    const isTransitioning = project.stage !== 'OPENING';

    // R2: 指派前置闸门——阶段推进（确定开标）时必须已指派主持人
    // 同阶段调用（:3007 组建会话）不检查；与 DEADLINE_NOT_PASSED 语义一致
    if (isTransitioning && !project.assignedHostUserId) {
      throw new BadRequestException({
        error: '请先指派开标主持人',
        code: 'HOST_NOT_ASSIGNED',
      });
    }

    // P1: 截标时间校验——仅阶段推进（确定开标）时要求投标截止已过；
    // 同阶段调用（:3007 组建/更新开标会话）不受 deadline 约束——
    // 否则 :3005 延期开标（updateProject 无阶段门控）后会话将永远建不出来
    if (isTransitioning && new Date() < new Date(project.deadline)) {
      throw new BadRequestException({
        error: '投标截止时间未到，无法启动开标',
        code: 'DEADLINE_NOT_PASSED',
      });
    }

    // E4: 开标准备 checklist(仅阶段推进时检查,同阶段调用不检查)
    if (isTransitioning) {
      const expertCount = await this.prisma.bidExpert.count({ where: { projectId: id } });
      // N4d：家数口径 = 已提交——候选池行数（受邀未投递）不再计入，与 startEvaluation 有效投标口径对齐
      const supplierCount = await this.prisma.bidSupplier.count({ where: { projectId: id, submitStatus: '已提交' } });
      // A-109b：法定硬闸（家数不足 force 不可绕过）与管理性软闸（force 可绕过+高风险留痕）分区
      const hardBlocking: string[] = [];
      const softBlocking: string[] = [];
      if (supplierCount < this.getMinBidders(project.procurementMethod)) {
        hardBlocking.push(`有效投标（已提交）仅 ${supplierCount} 家(法定最少 ${this.getMinBidders(project.procurementMethod)} 家，${project.procurementMethod ?? '未知方式'})`);
      }
      if (expertCount === 0) softBlocking.push('尚有专家未分配');
      if (dto?.force && hardBlocking.length > 0) {
        await this.prisma.bidSupervisionLog.create({
          data: { projectId: id, time: new Date(), role: '系统', target: project.name,
            action: '强制开标被拒（法定家数不足）', result: hardBlocking.join('; '), riskFlag: '高风险' },
        }).catch(() => {});
      }
      if (hardBlocking.length > 0 || (softBlocking.length > 0 && !dto?.force)) {
        throw new BadRequestException({
          error: `开标准备未完成：${[...hardBlocking, ...softBlocking].join('；')}${hardBlocking.length > 0 ? '（有效投标家数不足为法定硬性条件，不可强制开标——请流标或调整采购方式后重新组织）' : ''}`,
          code: 'OPENING_CHECKLIST_FAILED',
          items: [...hardBlocking, ...softBlocking],
        });
      }
      if (softBlocking.length > 0 && dto?.force) {
        await this.prisma.bidSupervisionLog.create({
          data: { projectId: id, time: new Date(), role: '系统', target: project.name,
            action: '强制开标(忽略checklist)', result: softBlocking.join('; '), riskFlag: '高风险' },
        }).catch(() => {});
      }
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
      // A-107/A-110（K-6 锚定缺口）：解密窗口不得早于开标时间——此前门控只锚定「阶段/截标」，
      // 截标后、openTime 前仍可组建会话=理论上提前开标。硬闸（延时开标的合法场景经修改 openTime 实现，无须 force 通道）。
      if (project.openTime && new Date(dto.decryptWindowStart) < new Date(project.openTime)) {
        throw new BadRequestException({
          error: '解密窗口开始时间不得早于开标时间（《招标投标法》第34条：开标应当在开标时间公开进行）',
          code: 'DECRYPT_BEFORE_OPEN_TIME',
        });
      }
      // P2-7（2026-09-09 审查）：窗口结束须在未来——组建即已关闭的窗口等同提前终止供应商
      // 解密权；既有开放窗口不得缩短（缩短=中途剥夺解密权），只能延长或暂停/恢复；
      // 已过期窗口的重组=延长恢复通道，放行。
      if (new Date(dto.decryptWindowEnd).getTime() <= Date.now()) {
        throw new BadRequestException({ error: '解密窗口结束时间必须晚于当前时刻（不得组建即已关闭的窗口）', code: 'DECRYPT_WINDOW_IN_PAST' });
      }
      const priorSession = await this.prisma.bidOpeningSession.findUnique({
        where: { projectId: id },
        select: { decryptWindowEnd: true },
      });
      if (priorSession?.decryptWindowEnd
        && priorSession.decryptWindowEnd.getTime() > Date.now()
        && new Date(dto.decryptWindowEnd).getTime() < priorSession.decryptWindowEnd.getTime()) {
        throw new ConflictException({ error: '既有解密窗口仍在开放，不得缩短（将剥夺供应商解密权）；如需调整只能延长或暂停/恢复', code: 'DECRYPT_WINDOW_SHRINK' });
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, id, 'OPENING'); // C1: 事务内行锁后复查阶段（同阶段 OPENING→OPENING 幂等放行）
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

      // 通知所有已投递的供应商——开标已启动，请前往开标大厅
      try {
        const submittedSuppliers = await this.prisma.bidSupplier.findMany({
          where: { projectId: id, submitStatus: '已提交' },
          select: { supplierId: true },
        });
        const supplierIds = submittedSuppliers.map(s => s.supplierId).filter((id): id is string => !!id);
        if (supplierIds.length > 0) {
          const suppliers = await this.prisma.supplier.findMany({
            where: { id: { in: supplierIds } },
            select: { id: true, userId: true },
          });
          const userIdBySupplierId = new Map(suppliers.map(s => [s.id, s.userId]));
          for (const s of submittedSuppliers) {
            const userId = s.supplierId ? userIdBySupplierId.get(s.supplierId) : null;
            if (userId) {
              await this.notificationService.sendToUser(userId, ['in_app'], {
                type: 'BID_OPENING_STARTED',
                title: `开标已启动：${project.name}`,
                content: '请前往开标大厅查看解密窗口时间并参与开标。',
                link: `/my-bids/${id}/opening-hall`,
              });
            }
          }
        }
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
      if (next) {
        await tx.projectManagementItem.update({ where: { id: link.projectManagementItemId }, data: { currentStage: next.stageKey } });
        // 推进指针的同时把下一阶段置 IN_PROGRESS——前端只认 IN_PROGRESS 为可操作状态，
        // 否则（定标）阶段卡在 NOT_STARTED 被锁死，中标通知书/中标公告入口永不可达
        await tx.projectManagementStage.updateMany({
          where: {
            projectManagementItemId: link.projectManagementItemId,
            stageKey: next.stageKey,
            round: link.round,
            status: 'NOT_STARTED',
          },
          data: { status: 'IN_PROGRESS' },
        });
      }
    }
  }

  /**
   * H4 共享守卫：开标完成度——未撤回供应商须全部到终局态
   * （SUCCESS+CONFIRMED/EXCEPTION 或 DANGER）。startEvaluation 与
   * completeOpening（开标移交）共用，保证两处永远同口径。
   * 不满足 → 409 OPENING_NOT_DONE（附未到终局态供应商名单）。
   * 入口首行惰性执行 §5.5 新轨解密失败归因矩阵（幂等）：
   * 归因 BIDDER 的家转终局态后自然放行；UNKNOWN 家仍 PENDING 继续阻塞。
   */
  /** H4 共享守卫（非抛错版）：返回未到终局态的供应商名单（空数组=开标已完成）——assertOpeningDone 与自动固化钩子共用 */
  private async getOpeningNotReady(id: string): Promise<string[]> {
    await this.attributePendingDualSuppliers(id);
    const activeSuppliers = await this.prisma.bidSupplier.findMany({
      where: { projectId: id, submitStatus: { not: '已撤回' } },
      select: { supplierName: true, supplierId: true, submitStatus: true, decryptStatus: true, confirmStatus: true },
    });
    const subBySupplier = await this.loadSubmissionStatusMap(this.prisma, id);
    return activeSuppliers
      .filter(s => BidService.isSubmittedRow(s, subBySupplier)) // P1-5b：未投递家不参与开标完成度
      .filter(s => BidService.openingRowNotReady(s))
      .map(s => s.supplierName);
  }

  /** P1-5b（2026-09-09 审查）：参标（已投递）判定——有 SupplierBidSubmission 以 status='submitted'
   *  为准（单一事实源，同 getWorkspace 口径），无提交记录回退 BidSupplier.submitStatus；
   *  supplierId 为空的名册行不可能有提交记录，按 submitStatus 兜底。未投递≠解密异常，
   *  不得进入开标完成度（旧口径令 H4 永久阻塞且只能靠「接受未解密」错位定性）。 */
  static isSubmittedRow(
    s: { supplierId: string | null; submitStatus: string | null },
    subBySupplier: Map<string, string>,
  ): boolean {
    if (!s.supplierId) return s.submitStatus === '已提交';
    const sub = subBySupplier.get(s.supplierId);
    return sub !== undefined ? sub === 'submitted' : s.submitStatus === '已提交';
  }

  /** H4 未到终局态判定（解密/确认/异议未结）——对参标家的既有口径，抽出共享。 */
  static openingRowNotReady(s: { decryptStatus: string; confirmStatus: string }): boolean {
    if (s.decryptStatus === 'DANGER') return false;                             // 解密异常已定性
    if (s.decryptStatus !== 'SUCCESS') return true;                             // PENDING/RUNNING 未解密
    return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';  // 解密成功但确认未闭环
  }

  /** 项目提交记录状态表（supplierId → submission.status），H4 参标判定用。 */
  private async loadSubmissionStatusMap(db: any, id: string): Promise<Map<string, string>> {
    const rows = await db.supplierBidSubmission.findMany({
      where: { projectId: id },
      select: { supplierId: true, status: true },
    });
    return new Map(rows.filter((r: any) => r.supplierId).map((r: any) => [r.supplierId as string, r.status as string]));
  }

  private async assertOpeningDone(id: string): Promise<void> {
    const notReady = await this.getOpeningNotReady(id);
    if (notReady.length > 0) {
      throw new ConflictException({
        error: `开标尚未完成，以下供应商未到终局态（解密/确认/异议未结）：${notReady.join('、')}`,
        code: 'OPENING_NOT_DONE',
      });
    }
  }

  /**
   * §5.5 解密失败归因（惰性执行，幂等）：解密窗口已过后，对「新轨 dual-v2 + 解密 PENDING + 未撤回」
   * 供应商逐家跑判定矩阵。窗口未过不动（供应商仍可自行解密）。
   *   行 1（outer 未解）/ 行 2（包未取）→ 只置 dangerAttribution='UNKNOWN'，不置终局态（守卫继续阻塞）；
   *   行 3（两者齐但未完成解密上传）→ DANGER+EXCEPTION+归因 BIDDER+解密失败通知（视为撤销）；
   *   行 4（双闸失败）由 decrypt-upload 落库时即时归因（T13），不在此重判。
   * 幂等：已有 dangerAttribution（含 UNKNOWN）的家不重算；BIDDER 终局经 updateMany 原子抢占防并发双写。
   */
  async attributePendingDualSuppliers(projectId: string): Promise<void> { /* F1d：BidDecryptService（adjudicateDecryptFault 惰性归因）跨域调用 */
    const session = await this.prisma.bidOpeningSession.findUnique({
      where: { projectId },
      select: { decryptWindowEnd: true },
    });
    if (!session?.decryptWindowEnd) return;                            // 无窗口概念 → 旧流程，不动
    if (session.decryptWindowEnd.getTime() >= Date.now()) return;      // 窗口未过 → 供应商仍可自行解密

    const pending = await this.prisma.bidSupplier.findMany({
      where: { projectId, decryptStatus: 'PENDING', submitStatus: { not: '已撤回' }, dangerAttribution: null },
      select: { id: true, supplierId: true, supplierName: true },
    });
    if (pending.length === 0) return;

    const supplierIds = pending.map(s => s.supplierId).filter((v): v is string => !!v);
    const submissions = supplierIds.length > 0
      ? await this.prisma.supplierBidSubmission.findMany({
          where: { projectId, supplierId: { in: supplierIds } },
          select: { supplierId: true, envelopeVersion: true, outerDecryptedAt: true, packageFetchedAt: true },
        })
      : [];
    const subBySupplier = new Map(submissions.map(s => [s.supplierId, s]));

    for (const s of pending) {
      if (!s.supplierId) continue; // 未关联账户 → 无信封提交记录（守卫继续阻塞，主持人人工处置）
      const sub = subBySupplier.get(s.supplierId);
      if (!sub || sub.envelopeVersion !== 'dual-v2') continue; // 旧轨沿用现行语义，不自动归因

      if (!sub.outerDecryptedAt || !sub.packageFetchedAt) {
        // 矩阵行 1/2：管理方未解外层 / 供应商未取包——无法区分原因，只置 UNKNOWN（非终局态）
        const marked = await this.prisma.bidSupplier.updateMany({
          where: { id: s.id, decryptStatus: 'PENDING', dangerAttribution: null },
          data: { dangerAttribution: 'UNKNOWN' },
        });
        if (marked.count > 0) {
          // count 门保持幂等：重复触发不重复写监督日志
          await this.prisma.bidSupervisionLog.create({
            data: {
              projectId, time: new Date(), role: '系统', target: s.supplierName,
              action: '解密失败归因', result: '解密窗口关闭未完成解密，归因 UNKNOWN 待主持人裁决', riskFlag: '高风险',
            },
          }).catch(() => {});
        }
        continue;
      }

      // 矩阵行 3：供应商已持有 C_inner+K_self（外层已解 + 已取包），窗口内未完成解密上传 → BIDDER
      const reason = '投标人未在解密窗口内完成解密';
      const claimed = await this.prisma.bidSupplier.updateMany({
        where: { id: s.id, decryptStatus: 'PENDING' },
        data: { decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', decryptError: reason, dangerAttribution: 'BIDDER' },
      });
      if (claimed.count === 0) continue; // 并发/重复触发已被对手处置 → 幂等跳过
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: s.supplierName,
          action: '解密失败归因', result: `归因判定：BIDDER——${reason}，视为撤销投标文件，保证金依招标文件规定处理`, riskFlag: '高风险',
        },
      }).catch(() => {});
      this.gateway?.notifyDecryptStatus(projectId, s.id, s.supplierName, 'DANGER');
      notifySupplierDecryptAttribution(this.prisma, this.notificationService, s.supplierId, s.supplierName, projectId, 'BIDDER');
    }
  }

  /**
   * 检查开标异议是否已超时。超时写监督日志 + 可选自动裁决。
   * 不抛异常——超时不阻塞 completeOpening/startEvaluation，由主持人决定是否强制裁决。
   */
  private async checkDisputeTimeout(projectId: string): Promise<void> {
    const session = await this.prisma.bidOpeningSession.findUnique({
      where: { projectId },
      select: { disputeTimeoutMinutes: true, disputedSince: true },
    });
    if (!session?.disputeTimeoutMinutes || !session?.disputedSince) return;

    const timeoutAt = new Date(session.disputedSince.getTime() + session.disputeTimeoutMinutes * 60 * 1000);
    if (new Date() <= timeoutAt) return; // 未超时

    const disputedSuppliers = await this.prisma.bidSupplier.findMany({
      where: { projectId, confirmStatus: 'DISPUTED', submitStatus: { not: '已撤回' } },
      select: { id: true, supplierName: true },
    });
    if (disputedSuppliers.length === 0) return;

    const names = disputedSuppliers.map(s => s.supplierName).join('、');
    const timeoutStr = `异议已超时 ${session.disputeTimeoutMinutes} 分钟（自 ${session.disputedSince.toISOString()}）`;

    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '系统', target: names,
        action: '异议超时告警', result: timeoutStr, riskFlag: '高风险',
      },
    }).catch(() => {});

    // 自动裁决开关（默认关闭，需显式开启）
    if (process.env.OPENING_DISPUTE_AUTO_RESOLVE === 'true') {
      for (const s of disputedSuppliers) {
        // 自动按 EXCEPTION 处理（每个供应商独立裁决，互不阻塞）
        await this.openingRecord.overrideDispute(projectId, s.id, `[自动裁决·超时] ${timeoutStr}`, undefined, 'exception')
          .catch(err => this.logger.error(`自动裁决 ${s.supplierName} 失败`, err));
      }
    }

    // 通知主持人
    try {
      await this.notificationService.sendToRole('bid_host', {
        type: 'BID_DISPUTE_TIMEOUT',
        title: '开标异议处理已超时',
        content: `${names} 的异议已超过 ${session.disputeTimeoutMinutes} 分钟。请前往开标大厅强制裁决。`,
        link: `/bid/project/${projectId}`,
      });
    } catch { /* 通知失败不阻塞 */ }
  }

  async startEvaluation(id: string, actorId?: string, evaluationHours?: number) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true, procurementMethod: true, roundMode: true, projectManagementItemId: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    // F17（2026-08-28）：同阶段早退——阶段棘轮 EVALUATING→EVALUATING 幂等放行后旧实现会全流程重跑
    // （重验闸门、事务内重建 AI task/bidderResult、F7 remove-first 后重入队 tender job=真重跑分析、
    // 重通知全部专家、再写监督/审计日志）；双击/网络重试即触发。幂等早退零副作用。
    if (project.stage === 'EVALUATING') {
      return { id, stage: 'EVALUATING', alreadyStarted: true } as any;
    }
    // 移交兜底（B）：阶段离开 OPENING 前自动补齐开标文件包（幂等；失败仅告警——移交本非启动评标闸门）
    if (project.stage === 'OPENING') await this.autoHandoverIfDone(id, '启动评标兜底', project);
    assertBidStageTransition(project.stage, 'EVALUATING');

    // 多轮报价项目——价格同步在 generateEvaluationResults 中执行（评标完成后才报价）
    // 此处不做轮次守卫：谈判采购流程为 先评标 → 再多轮报价 → 最后生成结果

    // P2: Prevent deadlock — ensure at least one expert is assigned
    // #15: 评标委员会组成法律合规校验（暂行规定第九条：5人以上单数）
    const confirmedExperts = await this.prisma.bidExpert.count({
      where: { projectId: id, invitationStatus: 'confirmed', expertRole: '正选' },
    });
    if (confirmedExperts === 0) {
      throw new BadRequestException({ error: '项目未分配已确认的评审专家，无法启动评标', code: 'NO_EXPERTS_ASSIGNED' });
    }
    const repCount = await this.prisma.bidExpert.count({
      where: { projectId: id, invitationStatus: 'confirmed', expertRole: '正选', isPurchaserRepresentative: true },
    });
    // W5（B-022）：水利工程建设项目委员会须 7 人以上单数（无小项目例外）；
    // 水利判定=PMI 采购类别含「水利」或项目名命中水利关键词（PMI 缺失/查询失败退默认口径）
    const hostPmi = project.projectManagementItemId
      ? await this.prisma.projectManagementItem
          .findUnique({ where: { id: project.projectManagementItemId }, select: { procurementCategory: true } })
          .catch(() => null)
      : null;
    assertCommitteeComposition(
      { confirmed: confirmedExperts, representatives: repCount },
      isWaterProject(hostPmi, project.name)
        ? { minSize: MIN_COMMITTEE_WATER, smallProjectExempt: false }
        : {},
    );

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
    // P3: 法定门槛——有效投标不足法定家数应当流标（招标投标法第二十八条）
    // 按采购方式区分：直接采购(1家)、其余(3家，含谈判采购)
    const minBidders = this.getMinBidders(project.procurementMethod);
    if (evaluableSupplierCount < minBidders) {
      throw new BadRequestException({
        error: `有效投标仅 ${evaluableSupplierCount} 家，不足 ${minBidders} 家`,
        code: 'INSUFFICIENT_BIDDERS',
        count: evaluableSupplierCount,
      });
    }

    // H4: 开标完成度守卫（抽共享方法，与 completeOpening 同口径）
    await this.assertOpeningDone(id);

    // 异议超时检查（告警 + 可选自动裁决；不阻塞评标启动）
    await this.checkDisputeTimeout(id);

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

    // 异常低价前置检测（评标启动时，让委员会在评分前知晓）
    const evaluableSupplierIds = await this.prisma.bidSupplier.findMany({
      where: { projectId: id, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
      select: { id: true },
    });
    await this.checkAbnormalLowPrices(id, evaluableSupplierIds.map(s => s.id));

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAndReassertStage(tx, id, 'EVALUATING'); // C1: 行锁后复查阶段（含 P1-17 与评分标准编辑互斥的 FOR UPDATE）
      // E2: 评标时限可自定义（缺省 72h，上限 720h）——「自定义评标时长」；超时可经「评标延期审批」延长
      const hours = evaluationHours && evaluationHours > 0 ? Math.min(Math.floor(evaluationHours), 720) : 72;
      const result = await tx.bidProject.update({
        where: { id },
        data: { stage: 'EVALUATING', evaluationDeadline: new Date(Date.now() + hours * 60 * 60 * 1000) },
      });

      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: `启动评标 (${project.stage}→EVALUATING)`, result: `阶段变更成功（评标时限 ${hours}h）`, riskFlag: '无' },
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
    // A-87（P1 波4）：抽为 ensureTenderAnalysis，与公告发布钩子共用。此处 bidderResults 刚在事务内
    // 建为 PENDING，幂等闸（requirements 已提取且无待派发 bidder）天然放行，行为与旧内联实现一致
    await this.ensureTenderAnalysis(id);

    // 通知所有分配专家评标已启动（fire-and-forget，不阻塞）
    // N9：仅通知已确认正选——候补/已婉拒/未确认专家不在评审之列，不应收到启动通知
    try {
      const experts = await this.prisma.bidExpert.findMany({
        where: { projectId: id, expertRole: '正选', invitationStatus: 'confirmed' },
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
   * A-87（P1 波4）：确保项目存在 AI 招标要点提取任务并入队 tender 处理，三个调用点共用：
   * - 公告发布钩子（announcement.syncBidProject）——发布即提取，潜在投标人在 BID 阶段可见要点清单；
   * - startEvaluation——评标启动；
   * - rerunAiAnalysis——force=true。
   * 幂等闸：requirements 已提取且无 PENDING bidderResult → 跳过入队（同一项目重复发布不重复入队）。
   * 闸门不能只看 requirements：tender processor 收尾会把全部 PENDING bidderResult 批量入队 bidder
   * 分析，若发布时已提取、启动评标时被闸拦，则 bidder 分析永不入队——启动评标现场刚建 PENDING
   * bidderResult，闸门天然放行，行为与旧内联实现一致。
   * force=true（rerun 语义）：跳过幂等闸；入队失败抛 400 ENQUEUE_FAILED（非 force 仅标 FAILED 不抛，
   * 不阻塞发布/启动评标主流程）。返回 true=已入队，false=幂等跳过或队列不可用（非 force）。
   */
  async ensureTenderAnalysis(projectId: string, opts?: { force?: boolean }): Promise<boolean> {
    const tenderQueue = this.tenderQueue;
    if (!tenderQueue) {
      if (opts?.force) {
        // 与 rerunAiAnalysis 的 F7 前置闸同口径：force 路径已清空旧结果，必须有人消费，不可假成功
        throw new ServiceUnavailableException({ error: 'AI 分析队列不可用（Redis/worker 异常），无法入队', code: 'QUEUE_UNAVAILABLE' });
      }
      this.logger.warn(`tenderQueue 不可用，跳过 AI 分析入队 (project=${projectId})`);
      return false;
    }
    let aiTask = await this.prisma.aiBidAnalysisTask.findUnique({ where: { projectId } });
    if (!aiTask) {
      // N8 同款补建：upsert（update 空分支）——并发双钩子双双 findUnique 落空时，后到方撞
      // projectId @unique 走 update 分支复用对手已建 task，不 P2002 裸 500
      aiTask = await this.prisma.aiBidAnalysisTask.upsert({
        where: { projectId },
        create: { projectId, status: 'PENDING' },
        update: {},
      });
    }
    if (!opts?.force && aiTask.requirements) {
      const pendingBidders = await this.prisma.aiBidderResult.count({
        where: { taskId: aiTask.id, status: 'PENDING' },
      });
      if (pendingBidders === 0) {
        this.logger.log(`AI 招标要点已提取且无待派发投标分析，幂等跳过入队 (project=${projectId}, task=${aiTask.id})`);
        return false;
      }
    }
    // F7：add 前强制 remove——BullMQ 对任意保留状态（含 7 天内 completed）的同 id job 静默去重，
    // 不 remove 的话同 taskId 二次入队会静默 no-op（假成功）。jobId 确定性（tender-<taskId>）
    // 使同一任务至多一个在途 job
    const tenderJobId = `tender-${aiTask.id}`;
    try {
      await tenderQueue.remove(tenderJobId).catch(() => {});
      await tenderQueue.add(
        'process',
        { taskId: aiTask.id },
        {
          jobId: tenderJobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 7 * 24 * 3600 },
          removeOnFail: { age: 30 * 24 * 3600 },
        },
      );
      this.logger.log(`AI analysis task ${aiTask.id} enqueued for project ${projectId}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to enqueue AI analysis task ${aiTask.id}: ${(err as Error).message}`);
      // 入队失败则将任务标记为 FAILED，避免永久 PENDING
      await this.prisma.aiBidAnalysisTask.update({
        where: { id: aiTask.id },
        data: { status: 'FAILED' },
      }).catch(() => {});
      if (opts?.force) {
        throw new BadRequestException({ error: '入队失败，任务已标记为 FAILED', code: 'ENQUEUE_FAILED' });
      }
      return false;
    }
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

    // 评标产出保护（2026-08-28 审查修复）：全量重跑会删表重建 bidderResult（新 cuid），
    // BidRequirementReview 经 onDelete:Cascade 随之级联清空——专家条款标注属评审报告法定披露内容，
    // 不得静默损毁。故已有任何评标产出（条款标注/评分记录/得分点勾选）即禁止全量重跑；
    // 个别供应商分析异常请改用单家重试（retryAiBidders，原行原位重置不删行、不丢标注）。
    const [reviewCount, scoreCount, decisionCount] = await Promise.all([
      this.prisma.bidRequirementReview.count({ where: { projectId } }),
      this.prisma.bidScoreRecord.count({ where: { scoreItem: { projectId } } }),
      this.prisma.bidScorePointDecision.count({ where: { point: { scoreItem: { projectId } } } }),
    ]);
    if (reviewCount > 0 || scoreCount > 0 || decisionCount > 0) {
      throw new ConflictException({
        error: '专家已开始评标（存在条款标注/评分记录），禁止全量重跑 AI 分析；如仅个别供应商分析异常，请改用单家重试（未产生评标记录的供应商不受影响）',
        code: 'EVALUATION_IN_PROGRESS',
      });
    }

    // F7：队列不可用必须拦在清空旧结果之前——否则结果清完无人消费，任务永久 PENDING（假成功停摆）。
    // 旧实现 if (this.tenderQueue) 静默跳过入队并照常返回 { taskId }，属最坏路径
    const tenderQueue = this.tenderQueue;
    if (!tenderQueue) {
      throw new ServiceUnavailableException({ error: 'AI 分析队列不可用（Redis/worker 异常），无法重跑', code: 'QUEUE_UNAVAILABLE' });
    }

    let task = await this.prisma.aiBidAnalysisTask.findUnique({ where: { projectId } });
    // F15（2026-08-28）：进行中禁重跑——旧实现 task 处于 PENDING/TENDER_PROCESSING/ANALYZING 时照样
    // 清空重跑，在途分析直接被铲（tender/bidder job 撞到已删/非 PENDING 行被认领守卫跳过），
    // 连点两次即两次全量重跑。非终态闸门天然兼作频控（rerun 后 task 复位 PENDING，二次即被挡）。
    // 只判 findUnique 命中分支——N8 补建路径自建的 task 即为 PENDING，不能挡自己；
    // 极窄的补建竞态窗（对手在途而我方早读 null）由认领守卫兜底。
    if (task && ['PENDING', 'TENDER_PROCESSING', 'ANALYZING'].includes(task.status)) {
      throw new ConflictException({ error: 'AI 分析进行中，禁止重跑（会清空在途分析）；如个别供应商异常请用单家重试', code: 'TASK_IN_PROGRESS' });
    }
    if (!task) {
      // N8：存量项目（先于该特性创建）无任务——与 startEvaluation 同构补建，rerun 即恢复入口。
      // 终审 must-fix：upsert（与 startEvaluation 完全同款）而非裸 create——并发双 rerun 双双
      // findUnique 落空时，后到方撞 projectId @unique 走 update 空分支复用对手已建 task，不 P2002 裸 500
      task = await this.prisma.aiBidAnalysisTask.upsert({
        where: { projectId },
        create: { projectId, status: 'PENDING' },
        update: {},
      });
      const evaluable = await this.prisma.bidSupplier.findMany({
        where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
        select: { id: true },
      });
      if (evaluable.length > 0) {
        await this.prisma.aiBidderResult.createMany({
          data: evaluable.map((s) => ({ taskId: task!.id, bidSupplierId: s.id, status: 'PENDING' })),
          skipDuplicates: true,
        });
      }
    }
    const taskId = task.id; // 补建后为非空；const 以便下方事务闭包内保持非空收窄

    // 清除旧结果：bidderResult + report + concordance（cascade 会处理部分）
    await this.prisma.$transaction(async (tx) => {
      await tx.aiBidReport.deleteMany({ where: { taskId } });
      await tx.aiConcordanceResult.deleteMany({ where: { taskId } });
      await tx.aiBidderResult.deleteMany({ where: { taskId } });
      // 重置 task 为 PENDING
      await tx.aiBidAnalysisTask.update({
        where: { id: taskId },
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
            taskId,
            bidSupplierId: s.id,
            status: 'PENDING',
          })),
          skipDuplicates: true,
        });
      }
    });

    // 入队 tender 处理（F7：jobId 与 startEvaluation 同源 `tender-${taskId}`——确定性 id 使同一
    // 任务至多一个在途 job；add 前强制 remove，否则 7 天内保留的 completed 同 id job 会让本次
    // add 静默去重——重跑假成功：旧结果已清空、新分析永不出队）
    // A-87（P1 波4）：复用 ensureTenderAnalysis——force=true 跳过幂等闸并保留入队失败 400 语义
    await this.ensureTenderAnalysis(projectId, { force: true });

    // 监督日志
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: project.name, action: '重新启动AI辅助分析', result: '旧结果已清除，重新入队', riskFlag: '无' },
    }).catch(() => {});
    // F15：补审计（对齐 retry 的 BID_AI_RETRY_BIDDERS 模式——rerun 是破坏性操作，旧实现零审计）
    if (actorId) {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_AI_RERUN_ANALYSIS', resourceType: `BidProject:${projectId}`, details: { taskId } },
      }).catch(() => {});
    }

    return { taskId };
  }

  /**
   * AI 单家重试：重置 FAILED / 中间态卡住的 bidderResult 并重入队（不清空其它已完成结果）。
   * 不传 bidderResultIds 时重试全部可重试家。worker 无需改动——bidder.processor 按
   * bidderResultId 全流程重跑，收尾 checkTaskCompletion 全部终态后重新生成报告并复位 task 终态。
   */
  async retryAiBidders(projectId: string, bidderResultIds: string[] | undefined, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, name: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', message: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段，无法重试 AI 分析', message: '项目不在评标阶段，无法重试 AI 分析', code: 'PROJECT_NOT_EVALUATING' });
    }
    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      include: { bidderResults: { include: { bidSupplier: { select: { supplierName: true } } } } },
    });
    if (!task) throw new BadRequestException({ error: '未找到 AI 分析任务', message: '未找到 AI 分析任务', code: 'TASK_NOT_FOUND' });
    if (task.status !== 'ANALYZING' && task.status !== 'COMPLETED_WITH_ERRORS') {
      throw new ConflictException({ error: `当前任务状态（${task.status}）不支持单家重试`, message: `当前任务状态（${task.status}）不支持单家重试`, code: 'TASK_STATE_NOT_RETRYABLE' });
    }
    const nowMs = Date.now();
    const retryable = task.bidderResults.filter((b) =>
      b.status === 'FAILED'
      || (b.status !== 'PENDING' && b.status !== 'COMPLETED' && nowMs - new Date(b.updatedAt).getTime() > AI_STUCK_THRESHOLD_MS),
    );
    const targets = bidderResultIds && bidderResultIds.length > 0
      ? retryable.filter((b) => bidderResultIds.includes(b.id))
      : retryable;
    if (targets.length === 0) {
      throw new BadRequestException({ error: '无可重试的分析项（仅失败或卡住的可重试）', message: '无可重试的分析项（仅失败或卡住的可重试）', code: 'NO_RETRYABLE_BIDDERS' });
    }

    // F7（2026-08-28）：队列缺失显式 503——旧实现仅 warn 后照常返回成功，DB 已重置 PENDING/ANALYZING
    // 却无 job 消费，进度卡死在 allPending 停摆（假成功）
    const bidderQueue = this.bidderQueue;
    if (!bidderQueue) {
      throw new ServiceUnavailableException({ error: 'AI 分析队列不可用（Redis/worker 异常），无法重试', code: 'QUEUE_UNAVAILABLE' });
    }

    // 顺序：先落库后入队——bidder.processor 认领守卫只认 PENDING 行，先入队会被 worker 抢跑看到
    // FAILED 直接跳过、随后落库的 PENDING 永久无人消费；落库后入队则 worker 拿到 job 时行必为 PENDING。
    await this.prisma.$transaction(async (tx) => {
      await tx.aiBidderResult.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: { status: 'PENDING', processedAt: null },
      });
      await tx.aiBidAnalysisTask.update({ where: { id: task.id }, data: { status: 'ANALYZING', completedAt: null } });
    });

    // F7：jobId 确定性化（`bidderResult-${id}`，与 tender.processor 同源）——同一行至多一个 job，
    // 旧时间戳 jobId 在并发重试下会双 job 双跑同一行；add 前强制 remove：BullMQ 对任意保留状态
    // （含 7 天内 completed）的同 id job 静默去重，不 remove 即假成功。入队失败回滚本次重置。
    try {
      for (const t of targets) {
        const jobId = `bidderResult-${t.id}`;
        await bidderQueue.remove(jobId).catch(() => {});
        await bidderQueue.add('process', { bidderResultId: t.id, taskId: task.id }, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 7 * 24 * 3600 },
          removeOnFail: { age: 30 * 24 * 3600 },
        });
      }
    } catch (err) {
      this.logger.error(`Failed to enqueue retry for task ${task.id}: ${(err as Error).message}`);
      // 回滚：按原状态分组还原 targets + task（worker 未消费时 DB 完全复原；若有 job 在 remove/add
      // 间隙被抢跑，其后续状态写入会覆盖回滚值，收敛到终态而非停摆）
      const rollback = new Map<AiBidderStatus, string[]>();
      for (const t of targets) rollback.set(t.status, [...(rollback.get(t.status) ?? []), t.id]);
      for (const [status, ids] of rollback) {
        await this.prisma.aiBidderResult.updateMany({ where: { id: { in: ids } }, data: { status } }).catch(() => {});
      }
      await this.prisma.aiBidAnalysisTask.update({
        where: { id: task.id },
        data: { status: task.status, completedAt: task.completedAt ?? null },
      }).catch(() => {});
      throw new BadRequestException({ error: '入队失败，请稍后重试', code: 'ENQUEUE_FAILED', message: '入队失败，请稍后重试' });
    }

    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: project.name, action: '重试AI辅助分析', result: `${targets.length}家：${targets.map((t) => t.bidSupplier.supplierName).join('、')}`, riskFlag: '无' },
    }).catch(() => {});
    if (actorId) {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_AI_RETRY_BIDDERS', resourceType: `BidProject:${projectId}`, details: { bidderResultIds: targets.map((t) => t.id) } },
      }).catch(() => {});
    }
    return { retried: targets.map((t) => ({ id: t.id, name: t.bidSupplier.supplierName })) };
  }

  /**
   * AI 辅助评标进度聚合（:3007 评标管理进度卡片轮询，3s）。
   * 异常判定在后端完成：FAILED / 中间态停摆 / task FAILED / workerIdle（队列探测：无人消费，
   * F14 即时判定）/ allPending（30 分钟停摆兜底，疑似 worker 未运行）。
   * `now` 可注入以便测试。
   */
  async getAiAnalysisProgress(projectId: string, now: Date = new Date()) {
    const emptyAnomaly = { hasAnomaly: false, failedNames: [] as string[], stuckNames: [] as string[], taskFailed: false, allPending: false, workerIdle: false };
    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      include: { bidderResults: { include: { bidSupplier: { select: { supplierName: true } } } } },
    });
    if (!task) {
      return { exists: false, taskStatus: null, updatedAt: null, total: 0, completed: 0, failed: 0, bidders: [], anomaly: emptyAnomaly };
    }
    const isStuck = (d: Date | null) => !!d && now.getTime() - new Date(d).getTime() > AI_STUCK_THRESHOLD_MS;
    const TERMINAL = new Set(['COMPLETED', 'FAILED']);
    const failed = task.bidderResults.filter((b) => b.status === 'FAILED');
    const stuck = task.bidderResults.filter((b) => b.status !== 'PENDING' && !TERMINAL.has(b.status) && isStuck(b.updatedAt));
    const taskFailed = task.status === 'FAILED';
    const allPending = !taskFailed
      && ['PENDING', 'TENDER_PROCESSING', 'ANALYZING'].includes(task.status)
      && task.bidderResults.length > 0
      && task.bidderResults.every((b) => b.status === 'PENDING')
      && isStuck(task.updatedAt);
    // F14（2026-08-28）：workerIdle 即时判定——「task 非终态 && 全 bidder PENDING」且停摆超宽限窗
    // （30s，覆盖 task 行先建、job 后 add 的入队竞态）即探测队列，不再干等 30 分钟 allPending。
    // 30 分钟 allPending 口径原样保留作兜底（队列未注入/Redis 异常时的回退）。
    let workerIdle = false;
    const allBidderPending = task.bidderResults.length > 0 && task.bidderResults.every((b) => b.status === 'PENDING');
    if (!taskFailed
      && ['PENDING', 'TENDER_PROCESSING', 'ANALYZING'].includes(task.status)
      && allBidderPending
      && task.updatedAt
      && now.getTime() - new Date(task.updatedAt).getTime() > AI_WORKER_IDLE_GRACE_MS) {
      workerIdle = await this.probeWorkerIdle(task.status, task.id, task.bidderResults[0].id);
    }
    const anomaly = {
      hasAnomaly: failed.length > 0 || stuck.length > 0 || taskFailed || allPending || workerIdle,
      failedNames: failed.map((b) => b.bidSupplier.supplierName),
      stuckNames: stuck.map((b) => b.bidSupplier.supplierName),
      taskFailed,
      allPending,
      workerIdle,
    };
    return {
      exists: true,
      taskStatus: task.status,
      updatedAt: task.updatedAt?.toISOString() ?? null,
      total: task.bidderResults.length,
      completed: task.bidderResults.filter((b) => b.status === 'COMPLETED').length,
      failed: failed.length,
      bidders: task.bidderResults.map((b) => ({
        id: b.id,
        bidSupplierId: b.bidSupplierId,
        name: b.bidSupplier.supplierName,
        status: b.status,
        updatedAt: b.updatedAt.toISOString(),
      })),
      anomaly,
    };
  }

  /**
   * F14：探测本项目 AI job 是否无人消费（疑似 worker 未运行）——精确、即时、无跨项目误报。
   * 判定顺序（counts 先行：worker 忙别家时 active>0 属正常排队，不报；直接按本项目 job=waiting
   * 判会把「排队中」误报成「无 worker」）：
   * 1. `getJobCounts()`：active>0 → worker 活着（消费本项目或别家）→ 不报；
   *    active===0 且 waiting+delayed>0 → 全队列确无消费 → 报。
   * 2. 全队列空 → 查本项目确定性 jobId（F7 约定）：查不到 = 从未入队（无人会消费）→ 报；
   *    查到（completed/failed 保留期内）= 状态推进滞后 → 不报。
   * 队列未注入（@Optional，单测环境）或 Redis 异常 → false，由 30 分钟 allPending 口径兜底。
   */
  private async probeWorkerIdle(taskStatus: string, taskId: string, firstBidderResultId: string): Promise<boolean> {
    try {
      // PENDING/TENDER_PROCESSING：tender job 待消费；ANALYZING：tender 已完、bidder jobs 待消费
      const queue = taskStatus === 'ANALYZING' ? this.bidderQueue : this.tenderQueue;
      if (!queue) return false;
      const counts = await queue.getJobCounts();
      if ((counts?.active ?? 0) > 0) return false;
      if ((counts?.waiting ?? 0) + (counts?.delayed ?? 0) > 0) return true;
      const jobId = taskStatus === 'ANALYZING' ? `bidderResult-${firstBidderResultId}` : `tender-${taskId}`;
      const job = await queue.getJob(jobId);
      return !job;
    } catch {
      return false;
    }
  }

  /**
   * F12（2026-08-28）：官方口径实时排名预览——与 generateEvaluationResults 同一聚合纯函数
   * （aggregateSupplierScores），供前端排名区在结果未生成时按官方口径预览（去极值/公式价格分/
   * 废标置后），替代旧的「正选百分制原始均分」预览。只读、无副作用：
   * 不跑 syncMultiRoundPrices（写库）、不写异常低价监督日志；生成路径的 F11
   * CEILING_PRICE_REQUIRED 400 在此降级为响应字段 priceFormulaError（预览恰在最需指引时不能死）。
   * 与生成时刻的已知差异：passFail 动态判废（评分项通过性）不预判——只做超限价判废（同源
   * getOverCeilingSuppliers）与 invalid 过滤，评分仍在进行中本就无法终判。
   */
  async getLiveOfficialScores(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { suppliers: { select: { id: true, supplierName: true, decryptStatus: true, submitStatus: true, confirmStatus: true, bidValidity: true } } },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const activeSuppliers = project.suppliers.filter(
      s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.confirmStatus === 'CONFIRMED' && s.bidValidity !== 'invalid',
    );

    // 价格块（与 generate 同源：PRICE 项 → 唱标/最终轮报价 → 公式分）
    const priceItems = await this.prisma.bidScoreItem.findMany({
      where: { projectId, category: 'PRICE' },
      select: { id: true, maxScore: true },
    });
    const priceItemIds = new Set(priceItems.map(pi => pi.id));
    const openingRecs = await this.prisma.bidOpeningRecord.findMany({
      where: { projectId, bidSupplierId: { in: activeSuppliers.map(s => s.id) } },
      select: { bidSupplierId: true, amount: true },
    });
    const bidPrices = new Map<string, number>();
    for (const r of openingRecs) {
      if (r.amount) {
        const price = parseFloat(String(r.amount).replace(/,/g, ''));
        if (!isNaN(price) && price >= 0) bidPrices.set(r.bidSupplierId!, price);
      }
    }
    const ceilingPrice = project.ceilingPrice ? Number(project.ceilingPrice) : null;
    let formulaPriceScores = new Map<string, number>();
    let priceFormulaError: string | null = null;
    if (priceItems.length > 0 && project.priceFormulaConfig) {
      const config = project.priceFormulaConfig as any;
      if ((config.formulaType === 'benchmark_deviation' || config.formulaType === 'ratio') && !(ceilingPrice && ceilingPrice > 0)) {
        priceFormulaError = '价格分公式为基准价偏离法/比例法，但项目未设置最高限价——价格分无法计算。请先在采购管理工作台（:3005）设置最高限价，或将价格分公式改为最低评标价法';
      } else {
        const priceMaxTotal = priceItems.reduce((s, i) => s + Number(i.maxScore), 0);
        formulaPriceScores = this.priceFormula.calculate(config, bidPrices, ceilingPrice, priceMaxTotal);
      }
    }

    // 评分记录（正选专家，与 generate 同批查口径）
    const activeSupplierIds = activeSuppliers.map(s => s.id);
    const allScoreRecords = activeSupplierIds.length > 0
      ? await this.prisma.bidScoreRecord.findMany({
          where: { supplierId: { in: activeSupplierIds }, expert: { projectId, expertRole: '正选' } },
          select: { supplierId: true, expertId: true, scoreItemId: true, score: true },
        })
      : [];
    const recordsBySupplier = new Map<string, { expertId: string; scoreItemId: string; score: any }[]>();
    for (const r of allScoreRecords) {
      const list = recordsBySupplier.get(r.supplierId) ?? [];
      list.push({ expertId: r.expertId, scoreItemId: r.scoreItemId, score: r.score });
      recordsBySupplier.set(r.supplierId, list);
    }

    // 超限价判废（与 generate 同源；passFail 动态判废不预判，见 doc 注）
    const passFailVerdicts = new Map<string, boolean>();
    if (ceilingPrice != null
        && ((priceItems.length > 0 && project.priceFormulaConfig) || project.procurementMethod === '谈判采购')) {
      for (const sid of this.priceFormula.getOverCeilingSuppliers(bidPrices, ceilingPrice)) {
        passFailVerdicts.set(sid, true);
      }
    }

    const ranked = aggregateSupplierScores({
      activeSuppliers,
      recordsBySupplier,
      formulaPriceScores,
      priceItemIds,
      passFailVerdicts,
      bidPrices,
      isNegotiation: project.procurementMethod === '谈判采购',
    });
    return {
      results: ranked.map((r, index) => ({ ...r, rank: index + 1 })),
      priceFormulaError,
    };
  }

  async getOpeningSession(projectId: string) {
    return this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
  }

  /** 注册主持人为当前操作者（并发检测）。原子抢占——与 releaseActiveHost 同模式。 */
  async claimActiveHost(projectId: string, userId: string, userName: string): Promise<{ claimed: boolean; existingHost?: string }> {
    // #10: 原子 updateMany 防止 TOCTOU 竞态（旧实现 findUnique+update 可并发双抢）
    const res = await this.prisma.bidOpeningSession.updateMany({
      where: { projectId, OR: [{ activeHostId: null }, { activeHostId: userId }] },
      data: { activeHostId: userId, activeHostName: userName },
    });
    if (res.count > 0) return { claimed: true };
    // 被他人占用 → 回读占用者
    const session = await this.prisma.bidOpeningSession.findUnique({
      where: { projectId }, select: { activeHostId: true, activeHostName: true },
    });
    return { claimed: false, existingHost: session?.activeHostName ?? session?.activeHostId ?? undefined };
  }

  /** 释放主持人操作者身份。仅当调用者是当前 activeHost 时才清除。 */
  async releaseActiveHost(projectId: string, userId: string): Promise<void> {
    await this.prisma.bidOpeningSession.updateMany({
      where: { projectId, activeHostId: userId },
      data: { activeHostId: null, activeHostName: null },
    });
  }

  /** 暂停开标：冻结解密窗口倒计时，暂停期间拒绝解密。 */
  async pauseOpening(projectId: string, actorId?: string, reason?: string) {
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
      data: { pausedAt: now, ...(reason ? { pauseReason: reason } : {}) },
    });

    const resultText = reason ? `暂停原因: ${reason}。解密窗口倒计时已冻结` : '解密窗口倒计时已冻结，解密操作被禁止';
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: now, role: '开标主持人', target: project.name,
        action: '暂停开标', result: reason ? `暂停原因: ${reason}。解密窗口倒计时已冻结` : '解密窗口倒计时已冻结，解密操作被禁止', riskFlag: '中风险' },
    }).catch(() => {});
    if (actorId) {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_OPENING_PAUSED', resourceType: `BidProject:${projectId}`, details: { pausedAt: now.toISOString(), reason } },
      }).catch(() => {});
    }

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '暂停开标', target: project.name, result: resultText, riskFlag: '中风险' });
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

  async listExperts(projectId: string, callerRole?: string) {
    // P1-5：评委名单保密（招标投标法第37条——名单在中标结果确定前保密）。
    // 评标启动前（DOWNLOAD/SUBMIT/OPENING）leader/staff 不得查看；admin/bid_host 与
    // EVALUATING 及以后放行。callerRole 缺省（内部直调）向后兼容放行。
    if (callerRole && ['leader', 'staff'].includes(callerRole)) {
      const project = await this.prisma.bidProject.findUnique({
        where: { id: projectId },
        select: { stage: true },
      });
      if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
      if (['DOWNLOAD', 'SUBMIT', 'OPENING'].includes(project.stage)) {
        throw new ForbiddenException({
          error: '评标启动前评委名单保密，启动评标后可查看',
          code: 'EXPERTS_CONFIDENTIAL',
        });
      }
    }
    return this.prisma.bidExpert.findMany({ where: { projectId }, include: { scoreRecords: true } });
  }

  /**
   * 异常低价检测——在评标启动时执行（而非结果生成时），
   * 让评标委员会在评分前知晓异常报价，可要求供应商书面说明。
   * 触发条件：有效报价 >= 3 家；阈值：报价低于均值 70%（与 generateEvaluationResults 一致）。
   */
  private async checkAbnormalLowPrices(projectId: string, activeSupplierIds: string[]): Promise<void> {
    const openingRecs = await this.prisma.bidOpeningRecord.findMany({
      where: { projectId, bidSupplierId: { in: activeSupplierIds } },
      select: { bidSupplierId: true, amount: true },
    });
    const prices: { supplierId: string; price: number }[] = [];
    for (const r of openingRecs) {
      if (r.amount) {
        const price = parseFloat(String(r.amount).replace(/,/g, ''));
        if (!isNaN(price) && price >= 0 && r.bidSupplierId) {
          prices.push({ supplierId: r.bidSupplierId, price });
        }
      }
    }
    if (prices.length < 3) return; // 与 generateEvaluationResults 既有门槛一致（validPrices.length >= 3）
    const avgPrice = prices.reduce((s, p) => s + p.price, 0) / prices.length;
    if (avgPrice <= 0) return;

    for (const { supplierId, price } of prices) {
      if (price < avgPrice * 0.7) {
        // 低于均值 30%
        const supplier = await this.prisma.bidSupplier.findUnique({
          where: { id: supplierId },
          select: { supplierName: true },
        });
        const supplierName = supplier?.supplierName ?? supplierId;
        await this.prisma.bidSupervisionLog
          .create({
            data: {
              projectId,
              time: new Date(),
              role: '系统',
              target: supplierName,
              action: '异常低价告警（评标启动）',
              result: `报价 ¥${price} 显著低于有效报价均值 ¥${avgPrice.toFixed(2)}（偏离 ${((1 - price / avgPrice) * 100).toFixed(1)}%），请评标委员会要求该供应商作出书面说明`,
              riskFlag: '高风险',
            },
          })
          .catch(() => {});
        this.gateway?.notifyAnomaly(projectId, {
          type: 'abnormal_low_price',
          supplierId,
          supplierName,
          detail: `报价 ¥${price} 低于均值 ¥${avgPrice.toFixed(2)} 共 ${((1 - price / avgPrice) * 100).toFixed(1)}%`,
          severity: 'warning',
        });
      }
    }
  }

  async listScores(projectId: string) {
    const records = await this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      include: { expert: true, scoreItem: true },
    });

    // 配置开关：评标期间对主持端匿名化专家身份。
    // 默认开启（显式 =false 才关闭）；标签按 expertId 排序稳定编号，与 getProject 口径一致。
    const anonymize = process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL !== 'false';
    if (!anonymize) return records;

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, experts: { select: { id: true, reportConfirmed: true } } },
    });
    const allConfirmed = project?.experts.every(e => e.reportConfirmed) ?? false;
    if (project?.stage === 'EVALUATING' && !allConfirmed) {
      const anonLabel = new Map(
        [...project.experts].map(e => e.id).sort().map((id, i) => [id, `专家 ${i + 1}`]),
      );
      return records.map(r => ({
        ...r,
        expertId: null,
        expert: { ...r.expert, expertName: anonLabel.get(r.expert.id) ?? '专家', id: null },
      }));
    }
    return records;
  }

  /** P5: 评分修订历史（防篡改取证） */
  async getScoreHistory(projectId: string) {
    const experts = await this.prisma.bidExpert.findMany({
      where: { projectId },
      select: { id: true, expertName: true },
    });
    const expertMap = new Map(experts.map(e => [e.id, e.expertName]));
    const records = await this.prisma.bidScoreRecordHistory.findMany({
      where: { expertId: { in: experts.map(e => e.id) } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return records.map(r => ({
      ...r,
      expertName: expertMap.get(r.expertId) ?? r.expertId,
      score: Number(r.score),
    }));
  }

  listClarifications(projectId: string) {
    return this.prisma.bidClarification
      .findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map((r) => this.stripClarificationSignature(r)));
  }

  /** A-143：列表响应只留签名摘要（algorithm/certSn/verifiedAt），不回传 payload 全串 */
  private stripClarificationSignature<T extends { replySignature: unknown }>(row: T) {
    const sig = row.replySignature as { algorithm?: string; certSn?: string; verifiedAt?: string } | null;
    return { ...row, replySignature: sig ? { algorithm: sig.algorithm, certSn: sig.certSn, verifiedAt: sig.verifiedAt } : null };
  }

  async replyClarification(projectId: string, cid: string, actorName: string, dto: ReplyClarificationDto) {
    // P1: 阶段门控 — 归档后不可回复澄清
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (project?.stage === 'ARCHIVED') {
      throw new BadRequestException({ error: '项目已归档，无法回复澄清', code: 'PROJECT_ARCHIVED' });
    }
    // 归属校验：IDOR 防护（项目 A 路径不可回复项目 B 澄清）
    const existing = await this.prisma.bidClarification.findFirst({ where: { id: cid, projectId } });
    if (!existing) {
      throw new BadRequestException({ error: '澄清不存在或不属于此项目', code: 'CLARIFICATION_NOT_IN_PROJECT' });
    }

    if (existing.type === 'clarification') {
      // A-143：在线答复归供应商门户（SM2 签名）；主持端仅「离线答复登记」降级通道
      if (dto.channel !== 'offline' || !dto.offlineReason?.trim()) {
        throw new BadRequestException({
          error: '评标澄清答复已迁移供应商门户在线签名提交；线下书面/电话答复请走「离线答复登记」（channel=offline + offlineReason）',
          code: 'ONLINE_REPLY_SUPPLIER_ONLY',
        });
      }
      if (existing.replyChannel === 'online') {
        throw new ConflictException({ error: '供应商已在线签名答复，不可覆盖', code: 'ONLINE_REPLY_LOCKED' });
      }
    }
    // offlineData 展开的联合类型不过 tsc——按分支分别构造 data（brief Step 2 注明回退方案）
    const data = existing.type === 'clarification'
      ? {
          reply: dto.reply,
          status: dto.status || '已回复',
          replyChannel: 'offline' as const,
          replySignature: Prisma.DbNull,
          replyByName: actorName,
          replyOfflineReason: dto.offlineReason!.trim(),
        }
      : { reply: dto.reply, status: dto.status || '已回复' };

    let result;
    if (existing.type === 'clarification') {
      // TOCTOU 收口（终审修复 2026-08-28）：上方 existing 快照与写入之间供应商可能已
      // 在线签名答复——无条件 update 会用 DbNull 抹掉其 SM2 签名证据。条件 updateMany
      // 仅在尚无 online 答复（replyChannel null/offline）时可写，count=0 → 409。
      const written = await this.prisma.bidClarification.updateMany({
        where: { id: cid, OR: [{ replyChannel: null }, { replyChannel: 'offline' }] },
        data,
      });
      if (written.count === 0) {
        throw new ConflictException({ error: '供应商已在线签名答复，不可覆盖', code: 'ONLINE_REPLY_LOCKED' });
      }
      // updateMany 不回行——重取供返回
      result = await this.prisma.bidClarification.findUnique({ where: { id: cid } });
    } else {
      result = await this.prisma.bidClarification.update({ where: { id: cid }, data });
    }
    // P2: emit real-time reply（host/experts 房定向，投标人不可见——见 gateway 注记）
    this.gateway?.notifyClarificationReplied(projectId, {
      id: cid,
      replier: existing.type === 'clarification' ? 'host-offline' : 'host',
      replyPreview: dto.reply.slice(0, 60),
    });
    return this.stripClarificationSignature(result!);
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

  async createClarification(projectId: string, dto: CreateClarificationDto, actorId?: string) {
    // P1: 阶段门控 — 归档后不可发起澄清
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (project?.stage === 'ARCHIVED') {
      throw new BadRequestException({ error: '项目已归档，无法发起澄清', code: 'PROJECT_ARCHIVED' });
    }

    // F3（2026-08-28）：前端契约统一传 BidSupplier.id（行 id）。校验归属本项目，
    // 并转换为行上的 Supplier.id 落库（BidClarification.supplierId 是 FK→Supplier，
    // 直接存行 id 会 FK 违约；AI 起草/专家端校验则按行 id）。
    let clarSupplierId: string | null = null;
    if (dto.supplierId) {
      const row = await this.prisma.bidSupplier.findFirst({ where: { id: dto.supplierId, projectId } });
      if (!row) {
        throw new BadRequestException({ error: '供应商不属于此项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
      }
      clarSupplierId = row.supplierId;
    }
    // A-143：supplierId 缺省时按 supplierName 在本项目投标人集合内回填（寻址不到保持 null，供应商端不可见）
    if (!dto.supplierId && (dto.type || 'clarification') === 'clarification' && dto.supplierName) {
      const rowByName = await this.prisma.bidSupplier.findFirst({
        where: { projectId, supplierName: dto.supplierName },
      });
      if (rowByName) clarSupplierId = rowByName.supplierId;
    }

    const created = await this.prisma.bidClarification.create({
      data: { projectId, type: dto.type || 'clarification', question: dto.question, issuer: dto.issuer, supplierName: dto.supplierName, supplierId: clarSupplierId },
    });
    this.gateway?.notifyClarificationCreated(projectId, {
      id: created.id, issuer: dto.issuer, issuerRole: 'host',
      supplierName: dto.supplierName, questionPreview: dto.question.slice(0, 60),
      // P1-1：评标澄清定向投递（host/experts/当事供应商），答疑维持公开广播
      type: dto.type === 'question' ? 'question' : 'clarification',
      supplierId: clarSupplierId,
    });
    // F18（2026-08-28）：补审计——澄清发起是现场关键动作，旧实现零 AuditLog（try/catch 兜底）
    if (actorId) {
      this.prisma.auditLog?.create({
        data: { userId: actorId, action: 'BID_CLARIFICATION_CREATE', resourceType: `BidProject:${projectId}`, details: { clarificationId: created.id, type: dto.type || 'clarification', supplierName: dto.supplierName } },
      }).catch(() => {});
    }
    // 定向提醒被询问供应商；不广播给无关供应商，且链接直达答疑页。
    if (clarSupplierId && (dto.type || 'clarification') === 'clarification') {
      try {
        const supplier = await this.prisma.supplier.findUnique({
          where: { id: clarSupplierId },
          select: { userId: true },
        });
        if (supplier?.userId) {
          await this.notificationService.sendToUser(supplier.userId, ['in_app'], {
            type: 'BID_CLARIFICATION_CREATED',
            title: `收到澄清要求：${project?.name ?? dto.supplierName}`,
            content: '采购人已发起澄清，请在规定时间内查看并提交答复。',
            link: `/bids/${projectId}/clarifications`,
          });
        }
      } catch { /* 通知失败不阻塞澄清发起 */ }
    }
    return created;
  }

  /** 获取评标完整性快照信息（指纹 + 下载链接），供验证端点使用 */
  async getEvaluationHandover(projectId: string) {
    const asset = await this.prisma.fileAsset.findFirst({
      where: { category: 'bid_evaluation_handover',
        key: { startsWith: `bid-evaluation-handover/${projectId}` } },
      orderBy: { createdAt: 'desc' },
    });
    if (!asset) return null;
    return {
      id: asset.id,
      fileName: asset.originalName,
      fingerprint: asset.sha256,
      size: asset.size,
      createdAt: asset.createdAt,
      downloadUrl: `/api/upload/files/${asset.id}`,
    };
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

    // 重算哈希链（与 archiveAll 同口径：status 视为 ARCHIVED；fileHashes 持久化列归一为 string[]）
    const chain = computeArchiveChain(
      { id: project.id, projectCode: project.projectCode, name: project.name, stage: 'ARCHIVED' },
      archiveItems.map(i => {
        const { fileHashes, ...rest } = i;
        return {
          ...rest,
          status: 'ARCHIVED' as const,
          ...(Array.isArray(fileHashes) ? { fileHashes: fileHashes as string[] } : {}),
        };
      }),
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
    // §5.5b（Task 18）：项目含 dual-v2 提交时，标准清单追加「解密后投标文件」（解密明文须随案归档）
    const dualV2Submissions = await db.supplierBidSubmission.findMany({
      where: { projectId, envelopeVersion: 'dual-v2' },
      select: { id: true },
      take: 1,
    });
    const standards = [
      { name: '招标项目基础信息', ownerRole: '系统' },
      { name: '投标供应商名单', ownerRole: '开标主持人' },
      { name: '开标记录表', ownerRole: '开标主持人' },
      { name: '供应商确认/异议记录', ownerRole: '供应商' },
      ...(dualV2Submissions.length > 0 ? [{ name: '解密后投标文件', ownerRole: '供应商' }] : []),
      // 开标归档（scope=opening）不生成评分/评标两项材料
      ...(opts?.skipEvaluation ? [] : [
        { name: '专家评分明细', ownerRole: '评审专家' },
        { name: '评标结果汇总', ownerRole: '评审委员会' },
        { name: '评标签字包', ownerRole: '评审委员会' }, // 新增：签字包 PDF+签字页+各专家扫描+状态表
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

  /**
   * D2（GB/T 43711 4.1.5.2）：档案移交登记——清单快照（含指纹与保存期）+ 双方签收留痕。
   */
  async registerArchiveTransfer(
    projectId: string,
    dto: { receivedByName: string; note?: string; confirm?: boolean },
    operator: { userId: string; username: string },
  ) {
    if (!dto.receivedByName?.trim()) throw new BadRequestException({ error: '请填写接收方', code: 'BAD_PARAMS' });
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, projectCode: true, stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'ARCHIVED') {
      throw new BadRequestException({ error: '项目归档后方可移交', code: 'NOT_ARCHIVED' });
    }
    const items = await this.prisma.bidArchiveItem.findMany({
      where: { projectId, status: 'ARCHIVED' },
      select: { id: true, name: true, hashDigest: true, retentionUntil: true },
    });
    if (items.length === 0) throw new BadRequestException({ error: '无已归档材料可移交', code: 'NO_ITEMS' });

    const transfer = await this.prisma.archiveTransfer.create({
      data: {
        projectId,
        transferredByName: operator.username,
        receivedByName: dto.receivedByName.trim(),
        itemCount: items.length,
        scope: items.map(i => ({
          itemId: i.id, name: i.name,
          hashDigest: i.hashDigest,
          retentionUntil: i.retentionUntil?.toISOString() ?? null,
        })) as any,
        confirmedAt: dto.confirm ? new Date() : null,
        note: dto.note?.trim() || null,
      },
    });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: operator.username, target: project.name,
        action: '档案移交登记', result: `${items.length} 项 → ${dto.receivedByName.trim()}${dto.confirm ? '（已确认接收）' : '（待确认）'}`,
        riskFlag: '无',
      },
    }).catch(() => {});
    return transfer;
  }

  /** D2：移交确认（接收方二次确认制） */
  async confirmArchiveTransfer(transferId: string, operator: { userId: string; username: string }) {
    const transfer = await this.prisma.archiveTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new BadRequestException({ error: '移交记录不存在', code: 'NOT_FOUND' });
    if (transfer.confirmedAt) return transfer;
    return this.prisma.archiveTransfer.update({
      where: { id: transferId },
      data: { confirmedAt: new Date() },
    });
  }

  /**
   * D3（GB/T 43711 8.2/8.3）：监管数据时间线——按项目聚合 监督日志 + 审计日志 + 操作日志（事前/事中/事后追溯）。
   */
  async supervisionTimeline(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const [logs, audits, operations] = await Promise.all([
      this.prisma.bidSupervisionLog.findMany({ where: { projectId }, orderBy: { time: 'desc' }, take: 200 }),
      this.prisma.auditLog.findMany({
        where: { OR: [{ resourceId: projectId }, { details: { path: ['$'], string_contains: projectId } } as any] },
        orderBy: { createdAt: 'desc' }, take: 100,
      }).catch(() => []),
      this.prisma.operationLog.findMany({
        where: { OR: [{ path: { contains: projectId } }, { query: { contains: projectId } }] },
        orderBy: { createdAt: 'desc' }, take: 150,
      }).catch(() => [] as any[]),
    ]);

    type Entry = { at: string; source: string; actor: string; action: string; detail: string; risk?: string };
    const entries: Entry[] = [
      ...logs.map(l => ({
        at: l.time.toISOString(), source: '监督日志', actor: l.role,
        action: l.action, detail: `${l.target ?? ''}：${l.result ?? ''}`.trim(), risk: l.riskFlag,
      })),
      ...audits.map(a => ({
        at: a.createdAt.toISOString(), source: '审计日志',
        actor: (a as any).user?.displayName ?? '—',
        action: a.action, detail: a.resourceType ?? '',
      })),
      ...operations.map(o => ({
        at: o.createdAt.toISOString(), source: '操作日志',
        actor: o.username ?? '—',
        action: `${o.method} ${o.path}`.slice(0, 80), detail: o.statusCode >= 400 ? `HTTP ${o.statusCode}${o.error ? ' ' + o.error.slice(0, 60) : ''}` : `HTTP ${o.statusCode} ${o.durationMs}ms`,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return { project, entries, counts: { supervision: logs.length, audit: audits.length, operation: operations.length } };
  }

  /** D3：监管数据包导出（JSON——公告+档案对标+移交+时间线，事前预警/事后追溯一体） */
  async supervisionExport(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, gbProcureCode: true, name: true, procurementMethod: true, stage: true, createdAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const [announcements, transfers, timeline, archiveItems] = await Promise.all([
      this.prisma.announcement.findMany({
        where: { relatedProjectCode: project.projectCode },
        select: { title: true, type: true, status: true, publishDate: true, dataClass: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.archiveTransfer.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
      this.supervisionTimeline(projectId),
      this.prisma.bidArchiveItem.findMany({
        where: { projectId },
        select: { name: true, status: true, hashDigest: true, archivedAt: true, retentionUntil: true, gbCategory: true },
        orderBy: { archivedAt: 'asc' },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      standard: 'GB/T 43711—2024 第 8 章（8.2/8.3 事前预警、事中控制、事后追溯）',
      project,
      announcements,
      archive: { items: archiveItems, gbTemplate: await this.getArchiveTemplate(projectId) },
      transfers,
      supervisionTimeline: timeline,
    };
  }

  /**
   * D1（GB/T 43711 4.1.5.1）：档案清单对标——标准 13 类满足度（线上数据自动判定 + 人工登记缺口）。
   */
  async getArchiveTemplate(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, projectManagementItemId: true, procurementMethod: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    return buildArchiveTemplate(this.prisma as any, project);
  }

  /**
   * D1：人工登记档案材料（线下预审资料/争议文件等）——
   * 按 GB 类别建归档项（幂等：同类别已有未归档项则更新），附件走既有 /upload 后传 fileAssetId 引用。
   */
  async registerManualArchiveItem(
    projectId: string,
    dto: { categoryKey: string; fileAssetId?: string; note?: string },
    actor?: { userId: string; username: string },
  ) {
    const cat = GB_ARCHIVE_CATEGORIES.find(c => c.key === dto.categoryKey);
    if (!cat) throw new BadRequestException({ error: '档案类别不合法', code: 'BAD_CATEGORY' });
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const existing = await this.prisma.bidArchiveItem.findFirst({
      where: { projectId, gbCategory: cat.key, status: { not: 'ARCHIVED' } },
      select: { id: true },
    });

    const name = `${cat.name}${dto.note ? `（${dto.note.trim().slice(0, 30)}）` : ''}`;
    const item = existing
      ? await this.prisma.bidArchiveItem.update({ where: { id: existing.id }, data: { name, ownerRole: '采购人' } })
      : await this.prisma.bidArchiveItem.create({
          data: { projectId, name, ownerRole: '采购人', gbCategory: cat.key, status: 'PENDING_CONFIRM' },
        });

    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: actor?.username ?? '采购人', target: project.name,
        action: '档案人工登记', result: `${cat.name}${dto.fileAssetId ? '（附材料）' : ''}`, riskFlag: '无',
      },
    }).catch(() => {});

    this.logger.log(`[D1] 档案人工登记：${project.name} / ${cat.name}`);
    return item;
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
      await lockAndReassertStage(tx, id, 'ARCHIVED'); // C1: 事务内行锁后复查阶段（同阶段 ARCHIVED 幂等放行）
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
      // P2-1：无有效供应商时记录原因（避免静默跳过评标结果检查）
      if (scope === 'full' && confirmableCount === 0) {
        await tx.bidSupervisionLog.create({
          data: { projectId: id, time: new Date(), role: '系统', target: project.name,
            action: '归档无有效供应商', result: '无解密成功且已确认的可评供应商，跳过评标结果检查', riskFlag: '无' },
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

      // 签字闸门（完整归档）：签字包已生成 + 全员正选闭环 + 回流包已生成（spec §7）
      if (scope === 'full') {
        const signPacket = await tx.bidSignPacket.findUnique({
          where: { projectId: id },
          select: { closedAt: true, handoverFileAssetId: true },
        });
        const pendingExperts = signPacket && !signPacket.closedAt
          ? await tx.bidExpert.findMany({
              where: { projectId: id, expertRole: '正选', signStatus: 'PENDING' },
              select: { expertName: true },
            })
          : [];
        assertSignGateClosed(scope, signPacket, pendingExperts.map(p => p.expertName));
      }

      // 自动补齐标准归档材料，避免”无可归档项”阻塞
      await this.ensureArchiveItems(id, tx, { skipEvaluation: scope === 'opening' });

      const archiveItems = await tx.bidArchiveItem.findMany({
        where: { projectId: id, status: { not: 'ARCHIVED' } },
      });

      if (archiveItems.length === 0) {
        throw new BadRequestException({ error: '没有可归档的项目', code: 'NO_ITEMS_TO_ARCHIVE' });
      }

      // 签字包归档项：把签字包/扫描件指纹 + 签字状态 JSON 指纹并入哈希链（spec §4.4）
      let signFileHashes: string[] | undefined;
      if (scope === 'full') {
        const signPacket = await tx.bidSignPacket.findUnique({ where: { projectId: id } });
        if (signPacket) {
          // A-152：电子签名专家无扫描件——有扫描件或电子签名者均入状态 JSON；
          // 旧数据无 esignature 时集合与原「仅扫描件」口径一致（verify/export 用持久化 fileHashes，不受此处影响）
          const expertScans = await tx.bidExpert.findMany({
            where: { projectId: id, OR: [{ signScanFileId: { not: null } }, { esignature: { not: Prisma.DbNull } }] },
            select: { expertName: true, signStatus: true, signScanFileId: true, esignature: true, esignatureAt: true },
          });
          const scanAssetIds = [signPacket.fileAssetId, signPacket.signPageScanFileId, ...expertScans.map(e => e.signScanFileId)]
            .filter((v): v is string => v != null);
          const scanAssets = await tx.fileAsset.findMany({ where: { id: { in: scanAssetIds } }, select: { sha256: true } });
          const statusJson = JSON.stringify(expertScans.map(e => ({
            expertName: e.expertName, signStatus: e.signStatus,
            esignature: e.esignature ?? null, esignatureAt: e.esignatureAt?.toISOString() ?? null,
          })));
          signFileHashes = [
            signPacket.sha256,
            ...scanAssets.map(a => a.sha256),
            crypto.createHash('sha256').update(statusJson, 'utf8').digest('hex'),
          ];
        }
      }
      // P0-4: 逐项 SHA-256 哈希链 — 每个归档项拥有独立哈希，链式防篡改。
      // 归一化：算链时把各项 status 视作 ARCHIVED，与 exportArchivePackage 重算口径一致
      // （修预存 bug：此前按 PENDING_CONFIRM 算链，导出按 ARCHIVED 重算，两者永不匹配）
      const chain = computeArchiveChain(
        { id: project.id, projectCode: project.projectCode, name: project.name, stage: 'ARCHIVED' },
        archiveItems.map(i => {
          const { fileHashes: _persisted, ...rest } = i;
          return {
            ...rest,
            status: 'ARCHIVED' as const,
            ...(i.name === '评标签字包' && signFileHashes ? { fileHashes: signFileHashes } : {}),
          };
        }),
      );

      // 逐项归档更新（各自哈希）+ 项目状态变更 + 监督日志
      // D2（4.1.5.2）：保存期 = 归档日 + 15 年（期内不可销毁；到期由档案部门依规处置）
      const retentionUntil = new Date(now.getTime() + 15 * 365.25 * 24 * 3600 * 1000);
      for (const item of archiveItems) {
        await tx.bidArchiveItem.update({
          where: { id: item.id },
          data: {
            status: 'ARCHIVED',
            hashDigest: chain.get(item.id)!,
            // P1-14：签字包指纹链持久化——verify/export 重算经 spread 回读，修复恒 mismatch
            ...(item.name === '评标签字包' && signFileHashes ? { fileHashes: signFileHashes } : {}),
            archivedAt: now,
            retentionUntil,
          },
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
      // P2-3: 写入监督日志告警
      await this.prisma.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name,
          action: '中标公示生成失败', result: (e as Error).message, riskFlag: '高' },
      }).catch((dbErr) =>
        this.logger.warn(`中标公示失败告警的监督日志写入失败: projectId=${id} err=${(dbErr as Error).message}`),
      );
    }

    return result;
  }

  /**
   * 归档后自动生成预成交公示草稿（G1→C1，GB/T 43711 7.5.2.2 两段式第一段）。幂等。
   * 直接写 announcement 表（避免与 AnnouncementService 循环依赖）。
   * 公示期满无异议后由 AnnouncementService.confirmWinnerNotice 派生成成交公告。
   */
  private async ensureWinnerNotice(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        evaluationResults: { orderBy: { rank: 'asc' }, select: { rank: true, supplierName: true, totalScore: true, averageScore: true, recommended: true, bidPrice: true } },
      },
    });
    if (!project) return;
    if (!project.evaluationResults || project.evaluationResults.length === 0) {
      this.logger.warn(`项目 ${project.projectCode} 无评标结果，跳过预成交公示生成`);
      return;
    }

    // 公告存业务编号、项目内部是 BID-时间戳——两个编号都试。
    // 幂等口径（按轮）：仅当已有公示/成交公告创建于【本轮评标结果生成之后】才跳过——
    // 多轮采购（round≥2）上一轮的 WIN 不得挡住本轮生成新 PRE（否则第二轮永不公示）
    const codes = await this.resolveAnnouncementCodes(project);
    const [existing, latestResult] = await Promise.all([
      this.prisma.announcement.findFirst({
        where: { relatedProjectCode: { in: codes }, type: { in: ['PRE_WIN_NOTICE', 'WIN_NOTICE'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      }),
      this.prisma.bidEvaluationResult.findFirst({
        where: { projectId },
        orderBy: { generatedAt: 'desc' },
        select: { generatedAt: true },
      }),
    ]);
    if (existing && latestResult && existing.createdAt > latestResult.generatedAt) return;
    if (existing && !latestResult) return; // 无评标结果的登记制场景，保持原幂等

    const winner = project.evaluationResults.find(r => r.rank === 1);
    const candidates = project.evaluationResults.filter(r => r.recommended);

    // A4: 中标价格从评标结果直接获取（不再通过 supplierName 模糊匹配开标记录）
    const winnerPrice = winner?.bidPrice ? String(winner.bidPrice) : null;

    await this.prisma.announcement.create({
      data: {
        title: `预成交公示：${project.name}`,
        content: `项目编号 ${project.projectCode}（${project.name}）已完成评审并归档，现将预成交供应商予以公示。`
          + `预成交供应商：${winner?.supplierName ?? '—'}。`
          + `${winnerPrice ? `预成交价格：¥${winnerPrice}元。` : ''}`
          + `公示期为3个日历日，公示期内如无异议，预成交供应商即为成交供应商。`
          + `供应商对公示内容有异议的，请在公示期内通过供应商门户公告页向采购人在线提出。`,
        type: 'PRE_WIN_NOTICE',
        status: 'DRAFT',
        relatedProjectCode: project.projectCode,
        metadata: {
          projectCode: project.projectCode,
          winner: winner ? { supplierName: winner.supplierName, totalScore: Number(winner.totalScore), averageScore: Number(winner.averageScore), price: winnerPrice } : null,
          candidates: candidates.map(c => ({ rank: c.rank, supplierName: c.supplierName, totalScore: Number(c.totalScore), averageScore: Number(c.averageScore) })),
          publicityPeriod: '3个日历日',
          objection: '公示期内通过供应商门户向采购人在线提出异议',
        },
      },
    });
    this.logger.log(`已自动生成预成交公示草稿：${project.projectCode}`);
  }

  /** 查询项目关联的预成交公示/成交公告（G1→C1，草稿或已发布）；无则返回 null */
  async getWinnerNotice(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true, projectManagementItemId: true },
    });
    if (!project) return null;
    // 公告存业务编号、项目内部是 BID-时间戳——两个编号都试；本轮（最近评标结果之后）优先
    const codes = await this.resolveAnnouncementCodes(project);
    const latestResult = await this.prisma.bidEvaluationResult.findFirst({
      where: { projectId },
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true },
    });
    if (latestResult) {
      const current = await this.prisma.announcement.findFirst({
        where: { relatedProjectCode: { in: codes }, type: { in: ['PRE_WIN_NOTICE', 'WIN_NOTICE'] }, createdAt: { gt: latestResult.generatedAt } },
        orderBy: { createdAt: 'desc' },
      });
      if (current) return current;
    }
    return this.prisma.announcement.findFirst({
      where: { relatedProjectCode: { in: codes }, type: { in: ['PRE_WIN_NOTICE', 'WIN_NOTICE'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A1: 公示状态——是否已公示、公示截止时间、是否可发中标通知书 */
  async getPublicityStatus(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true, projectManagementItemId: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // C1（7.5.2）：优先取预成交公示（两段式第一段）；无则回落存量 WIN_NOTICE（老"中标公示"，
    // 其 publicityEnd 语义同为公示期）。多轮采购取"本轮"（最近评标结果之后）的公告——
    // 上一轮已确认的公示不应继续给第二轮项目当公示状态（否则二轮永远"已公示"）。
    const codes = await this.resolveAnnouncementCodes(project);
    const latestResult = await this.prisma.bidEvaluationResult.findFirst({
      where: { projectId },
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true },
    });
    const roundFilter = latestResult ? { createdAt: { gt: latestResult.generatedAt } } : {};
    const pick = (type: any) => this.prisma.announcement.findFirst({
      where: { relatedProjectCode: { in: codes }, type, ...roundFilter },
      orderBy: { createdAt: 'desc' },
      select: { status: true, publishDate: true, publicityEnd: true },
    });
    const notice =
      (await pick('PRE_WIN_NOTICE')
        .then(r => r ?? pick('WIN_NOTICE'))) ??
      // 本轮无任何公示 → 回落全量（在途/登记制场景）
      (await this.prisma.announcement.findFirst({
        where: { relatedProjectCode: { in: codes }, type: 'PRE_WIN_NOTICE' },
        orderBy: { createdAt: 'desc' },
        select: { status: true, publishDate: true, publicityEnd: true },
      })) ??
      (await this.prisma.announcement.findFirst({
        where: { relatedProjectCode: { in: codes }, type: 'WIN_NOTICE' },
        orderBy: { createdAt: 'desc' },
        select: { status: true, publishDate: true, publicityEnd: true },
      }));

    if (!notice || notice.status !== 'PUBLISHED') {
      return { hasPublicity: false, publicityEnd: null, canIssueAward: false };
    }
    const now = new Date();
    const publicityEnd = notice.publicityEnd;
    // P1-8：公示期未设置（null）不再放行——create/update 路径已兜底必设；null 视为未满足（条例第54条）
    const canIssueAward = !!publicityEnd && now >= new Date(publicityEnd);
    return { hasPublicity: true, publicityEnd, canIssueAward };
  }

  /** P1: 设置最高限价 + 价格分公式配置 + 评标办法 */
  async updatePriceConfig(
    projectId: string,
    dto: { ceilingPrice?: number; evaluationMethod?: string; priceFormulaConfig?: Record<string, unknown> },
    actorId?: string,
  ) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { id: true, stage: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // P2-17（二轮审查收尾）：评标/归档阶段锁定价格与评标办法配置——评标办法在招标文件确定，
    // 评标中变更评标办法/最高限价/价格分公式会改变评分与排名口径（合规风险）；更正须走法定程序
    if ((project.stage === 'EVALUATING' || project.stage === 'ARCHIVED')
      && (dto.evaluationMethod !== undefined || dto.ceilingPrice !== undefined || dto.priceFormulaConfig !== undefined)) {
      throw new ConflictException({ error: '评标已开始，价格与评标办法配置已锁定；如需更正请按法定程序办理', code: 'PRICE_CONFIG_LOCKED' });
    }

    const data: Record<string, unknown> = {};
    if (dto.ceilingPrice !== undefined) data.ceilingPrice = dto.ceilingPrice;
    if (dto.evaluationMethod !== undefined) data.evaluationMethod = dto.evaluationMethod;
    if (dto.priceFormulaConfig !== undefined) data.priceFormulaConfig = dto.priceFormulaConfig as any;

    return this.prisma.bidProject.update({ where: { id: projectId }, data, select: { id: true, ceilingPrice: true, evaluationMethod: true, priceFormulaConfig: true } });
  }

  /** B3（GB/T 43711 7.2.3.6）：资格后审复核结果登记（登记制——评审线下完成，结果留痕） */
  async registerQualificationReview(projectId: string, result: string) {
    if (!result?.trim()) throw new BadRequestException({ error: '请填写复核结果', code: 'RESULT_REQUIRED' });
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const updated = await this.prisma.bidProject.update({
      where: { id: projectId },
      data: { qualificationReviewResult: result.trim() },
      select: { id: true, qualificationReviewResult: true },
    });
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '采购人', action: '资格后审复核登记', target: project.name, result: result.trim().slice(0, 200), riskFlag: '无' },
    }).catch(() => {});
    return updated;
  }

  /** A-151：评标报告章节附注（签字包生成前编辑，docx 渲染；重新生成取最新值） */
  async getReportNotes(projectId: string) {
    const p = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { reportNotes: true } });
    return { notes: (p?.reportNotes as ReportNoteItemDto[] | null) ?? [] };
  }
  async setReportNotes(projectId: string, dto: ReportNotesDto, actorId?: string) {
    const p = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { name: true } });
    if (!p) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    // notes 缺省/null 归一空数组（@IsOptional 放行 body {}/{"notes":null}）——否则日志行 .map 在 create 参数求值阶段同步抛 TypeError（.catch 挂在返回的 Promise 上救不了）→ 500 且清空绕过留痕
    const notes = dto.notes ?? [];
    // service 硬校验与 DTO @IsIn 双保险（直调或白名单管道剥落时兜底）
    for (const n of notes) {
      if (!(REPORT_NOTE_SECTIONS as readonly string[]).includes(n.section)) {
        throw new BadRequestException({ error: `非法章节 ${n.section}（仅允许 一~十）`, code: 'INVALID_SECTION' });
      }
    }
    await this.prisma.bidProject.update({ where: { id: projectId }, data: { reportNotes: notes as any } });
    await this.prisma.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '系统', target: p.name,
      action: '评标报告附注编辑', result: notes.map(n => `第${n.section}节 ${n.content.length} 字`).join('；') || '清空附注', riskFlag: '无', operatorId: actorId ?? null } }).catch(e => this.logger.warn('监督日志写入失败(action=评标报告附注编辑): ' + String(e)));
    return { success: true };
  }

  /** A3: 推送中标通知书给中标供应商 */
  async deliverAwardLetter(
    projectId: string,
    dto: { winnerName: string; winnerSupplierId?: string; content?: Record<string, unknown>; letterAssetId?: string },
    actorId?: string,
  ) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { name: true, projectCode: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // P1-8：公示期硬闸——公示未发布或未期满不得发出中标通知书（实施条例第54条）
    const publicity = await this.getPublicityStatus(projectId);
    if (!publicity.canIssueAward) {
      throw new ConflictException({
        error: publicity.hasPublicity
          ? `中标候选人公示期未满（公示截止 ${publicity.publicityEnd}），不得发出中标通知书`
          : '中标候选人公示未发布，不得发出中标通知书',
        code: 'PUBLICITY_NOT_ENDED',
      });
    }

    // 中标人一致性：以 rank1 推荐为准，防向任意供应商发通知书
    const winnerResult = await this.prisma.bidEvaluationResult.findFirst({
      where: { projectId, recommended: true, rank: 1 },
      select: { supplierId: true, supplierName: true },
    });
    if (!winnerResult) {
      throw new BadRequestException({ error: '缺少中标候选人推荐记录，无法发出通知书', code: 'WINNER_MISMATCH' });
    }
    if (dto.winnerSupplierId && dto.winnerSupplierId !== winnerResult.supplierId) {
      throw new BadRequestException({ error: '中标通知书接收人与推荐中标候选人不一致', code: 'WINNER_MISMATCH' });
    }
    if (dto.winnerName && dto.winnerName !== winnerResult.supplierName) {
      throw new BadRequestException({ error: '中标通知书中标人与推荐中标候选人不一致', code: 'WINNER_MISMATCH' });
    }
    const supplierId = winnerResult.supplierId;
    const supplierName = winnerResult.supplierName;

    if (!dto.letterAssetId?.trim()) {
      throw new BadRequestException({ error: '请先上传中标通知书文件', code: 'AWARD_LETTER_ASSET_REQUIRED' });
    }
    if (!actorId) {
      throw new BadRequestException({ error: '无法核验通知书文件上传人', code: 'AWARD_LETTER_ASSET_INVALID' });
    }
    const letterAssetId = dto.letterAssetId.trim();
    const letterAsset = await this.prisma.fileAsset.findFirst({
      where: { id: letterAssetId, category: 'contract_document', uploaderId: actorId },
      select: { id: true, mimeType: true, size: true },
    });
    if (!letterAsset) {
      throw new BadRequestException({ error: '通知书文件不存在、分类不符或不属于当前账号', code: 'AWARD_LETTER_ASSET_INVALID' });
    }
    if (!AWARD_LETTER_MIME_TYPES.has(letterAsset.mimeType)) {
      throw new BadRequestException({
        error: '中标通知书仅支持可信的 PDF 或 Word 文件',
        code: 'AWARD_LETTER_ASSET_TYPE_INVALID',
      });
    }
    if (letterAsset.size > AWARD_LETTER_MAX_ASSET_BYTES) {
      throw new BadRequestException({
        error: '中标通知书文件不得超过 20 MiB',
        code: 'AWARD_LETTER_ASSET_TOO_LARGE',
      });
    }

    const delivery = await this.prisma.$transaction(async (tx) => {
      const deliveryKey = { projectId_supplierId: { projectId, supplierId } };
      const existing = await tx.awardLetterDelivery.findUnique({
        where: deliveryKey,
        select: { id: true, signedAt: true, deliveredAt: true },
      });

      if (existing?.signedAt) {
        throw new ConflictException({
          error: '中标通知书已签收，不可覆盖或重新交付',
          code: 'AWARD_LETTER_ALREADY_SIGNED',
        });
      }

      const [otherDeliveryBinding, contractBinding, fulfillmentBinding] = await Promise.all([
        tx.awardLetterDelivery.findFirst({
          where: {
            letterAssetId,
            NOT: { projectId, supplierId },
          },
          select: { id: true },
        }),
        tx.contract.findFirst({
          where: {
            OR: [
              { draftAssetId: letterAssetId },
              { signedAssetId: letterAssetId },
            ],
          },
          select: { id: true },
        }),
        tx.contractFulfillment.findFirst({
          where: { proofAssetId: letterAssetId },
          select: { id: true },
        }),
      ]);
      if (otherDeliveryBinding || contractBinding || fulfillmentBinding) {
        throw new ConflictException({
          error: '该中标通知书文件已绑定其他业务记录，不可重复使用',
          code: 'AWARD_LETTER_ASSET_ALREADY_BOUND',
        });
      }

      const nowMs = Date.now();
      const deliveredAt = new Date(existing?.deliveredAt
        ? Math.max(nowMs, existing.deliveredAt.getTime() + 1)
        : nowMs);

      if (!existing) {
        return tx.awardLetterDelivery.create({
          data: {
            projectId,
            supplierId,
            supplierName,
            content: (dto.content as any) ?? undefined,
            letterAssetId,
            deliveredAt,
          },
        });
      }

      // 未签收通知书可重发，但新文件不能继承旧文件的查看回执。
      // signedAt 条件是并发闸门：若供应商在读取后先完成签收，本更新必须零命中并拒绝。
      const updated = await tx.awardLetterDelivery.updateMany({
        where: { id: existing.id, signedAt: null, deliveredAt: existing.deliveredAt },
        data: {
          supplierName,
          content: (dto.content as any) ?? undefined,
          letterAssetId,
          deliveredAt,
          receivedAt: null,
          signedBy: null,
        },
      });
      if (updated.count !== 1) {
        const current = await tx.awardLetterDelivery.findUnique({
          where: { id: existing.id },
          select: { signedAt: true, deliveredAt: true },
        });
        if (current?.signedAt) {
          throw new ConflictException({
            error: '中标通知书已签收，不可覆盖或重新交付',
            code: 'AWARD_LETTER_ALREADY_SIGNED',
          });
        }
        throw new ConflictException({
          error: '中标通知书版本已变更，请刷新后重试',
          code: 'AWARD_LETTER_VERSION_CHANGED',
        });
      }

      const persisted = await tx.awardLetterDelivery.findUnique({ where: { id: existing.id } });
      if (!persisted) {
        throw new ConflictException({
          error: '中标通知书版本已变更，请刷新后重试',
          code: 'AWARD_LETTER_VERSION_CHANGED',
        });
      }
      return persisted;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // CTS A-203 / 拍板 #7（2026-08-27）：定标（发出中标通知书）即从交易链自动回写台账中标信息，
    // 替代手工维护 awardedSupplier 的双头不一致；管理端手工值仍可兜底覆盖（回写幂等，值一致则跳过）。
    try {
      // PMI.bidProjects（1:N）：通过 BidProject.projectManagementItemId 反查宿主台账项
      const pmi = await this.prisma.projectManagementItem.findFirst({
        where: { bidProjects: { some: { id: projectId } } },
        select: { id: true, awardedSupplier: true },
      });
      if (pmi && pmi.awardedSupplier !== supplierName) {
        await this.prisma.projectManagementItem.update({
          where: { id: pmi.id },
          data: { awardedSupplier: supplierName },
        });
      }
    } catch {
      // 回写失败不阻断通知书发出（台账可手工兜底）
    }

    // P1-8：定向通知中标供应商（不再广播全体供应商）
    try {
      // BidEvaluationResult.supplierId / AwardLetterDelivery.supplierId 均保存 BidSupplier.id，
      // 必须先沿 BidSupplier → Supplier → User 解析真实站内信接收人。
      const winner = await this.prisma.bidSupplier.findUnique({
        where: { id: supplierId },
        select: { supplier: { select: { userId: true } } },
      });
      if (winner?.supplier?.userId) {
        await this.notificationService.sendToUser(winner.supplier.userId, ['in_app'], {
          type: 'AWARD_LETTER',
          title: `中标通知书：${project.name}`,
          content: `恭喜贵公司中标${project.name}，请及时签收中标通知书。`,
          link: `/award-letters?deliveryId=${encodeURIComponent(delivery.id)}`,
        });
      } else {
        this.logger.warn(`中标通知书已生成，但供应商 ${supplierName} 无关联用户，跳过站内信`);
      }
    } catch { /* 通知失败不阻塞 */ }

    // A-105：定标联动——发出中标通知书即提醒经办逐家退还未中标供应商的响应担保
    //（实施条例第57条：合同签订后5日内向中标人和未中标人退还；GB/T 43711 7.5.4.4）。
    // 幂等：systemConfig marker bond_return_reminder_award:<projectId>（每项目只提醒一次，仅在发送成功后写入——
    // 失败不占坑，日调度 bond_return_reminded:* 第二通道兜底）；失败不阻塞通知书。
    try {
      const markerKey = `bond_return_reminder_award:${projectId}`;
      const reminded = await this.prisma.systemConfig.findUnique({ where: { key: markerKey } });
      if (!reminded) {
        const pending = await this.prisma.bidSupplier.findMany({
          // 终审 Critical#2：pending 谓词收口共享 util——补 submitStatus=已提交（hook 原漏）与
          // bondReturnReason=null（不予退还=终局，三处原都漏）；winner 排除保留（保守方向）
          where: pendingBondReturnWhere({ projectId, supplierName: { not: supplierName } }),
          select: { supplierName: true },
        });
        if (pending.length > 0) {
          const names = pending.slice(0, 5).map(s => s.supplierName).join('、');
          try {
            await this.notificationService.sendToRole('staff', {
              type: 'SYSTEM',
              title: '响应担保待逐家退还提醒',
              content: `${project.name}已发出中标通知书，尚有 ${pending.length} 家未中标供应商的响应担保未登记退还（实施条例第57条：合同签订后5日内退还）：${names}${pending.length > 5 ? '…' : ''}。请在项目管理-合同面板逐家登记退还。`,
            });
            await this.prisma.systemConfig.upsert({
              where: { key: markerKey },
              update: { value: new Date().toISOString() },
              create: { key: markerKey, value: new Date().toISOString() },
            });
          } catch (e) {
            this.logger.warn(`A-105 定标提醒发送失败 project=${projectId}: ${String(e)}`);
          }
        }
      }
    } catch { /* 逐家退还提醒失败不阻塞中标通知书 */ }

    // P1-6（2026-09-09 审查）：定标即定向通知所有未中标投标人（《招标投标法》第45条——
    // 中标人确定后应同时将中标结果通知所有未中标的投标人）。公开的预成交公示不构成定向通知。
    // 口径：已投递家（submission status='submitted'）中排除中标人（BidSupplier.id → Supplier.id）；
    // 幂等：systemConfig marker award_result_notified:<projectId>（发送成功后写，失败不占坑；
    // 未签收前重发通知书不重复通知落标家）。响应担保退还另行通知（A-105 同点已提醒经办）。
    try {
      const markerKey = `award_result_notified:${projectId}`;
      const alreadyNotified = await this.prisma.systemConfig.findUnique({ where: { key: markerKey } });
      if (!alreadyNotified) {
        const winnerRow = await this.prisma.bidSupplier.findUnique({
          where: { id: supplierId },
          select: { supplierId: true },
        });
        const winnerSupplierId = winnerRow?.supplierId ?? null;
        const submissions = await this.prisma.supplierBidSubmission.findMany({
          where: { projectId, status: 'submitted' },
          select: { supplierId: true },
        });
        const loserSupplierIds = [...new Set(
          submissions.map(x => x.supplierId).filter((v): v is string => !!v && v !== winnerSupplierId),
        )];
        if (loserSupplierIds.length > 0) {
          const loserUsers = await this.prisma.supplier.findMany({
            where: { id: { in: loserSupplierIds } },
            select: { userId: true },
          });
          const userIds = [...new Set(loserUsers.map(u => u.userId).filter((u): u is string => !!u))];
          for (const uid of userIds) {
            await this.notificationService.sendToUser(uid, ['in_app'], {
              type: 'BID_AWARD_RESULT',
              title: `定标结果通知：${project.name}`,
              content: `项目 ${project.projectCode}（${project.name}）已完成定标，中标供应商：${supplierName}。感谢贵公司参与本项目投标。响应担保退还事宜将按《招标投标法实施条例》第57条另行通知安排。`,
              link: `/my-bids/${projectId}/opening-hall`,
            }).catch(() => {});
          }
          if (userIds.length > 0) {
            await this.prisma.systemConfig.upsert({
              where: { key: markerKey },
              update: { value: new Date().toISOString() },
              create: { key: markerKey, value: new Date().toISOString() },
            });
          }
        }
      }
    } catch { /* 落标通知失败不阻塞中标通知书（法45条义务由重发路径兜底） */ }

    return delivery;
  }

  /** A3: 查询中标通知书签收状态 */
  async getAwardLetterStatus(projectId: string) {
    const deliveries = await this.prisma.awardLetterDelivery.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    const assetIds = [...new Set(deliveries.map(item => item.letterAssetId).filter((id): id is string => Boolean(id)))];
    const signerIds = [...new Set(deliveries.map(item => item.signedBy).filter((id): id is string => Boolean(id)))];
    const [assets, signers] = await Promise.all([
      assetIds.length
        ? this.prisma.fileAsset.findMany({
            where: { id: { in: assetIds } },
            select: { id: true, originalName: true, mimeType: true, size: true, sha256: true, createdAt: true },
          })
        : [],
      signerIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: signerIds } },
            select: { id: true, username: true, displayName: true },
          })
        : [],
    ]);
    const assetById = new Map<string, (typeof assets)[number]>();
    for (const asset of assets) assetById.set(asset.id, asset);
    const signerById = new Map<string, string>();
    for (const user of signers) signerById.set(user.id, user.displayName || user.username);

    return deliveries.map(delivery => ({
      ...delivery,
      receiptNo: `AL-${delivery.id.replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase() || 'RECEIPT'}`,
      signedByName: delivery.signedBy ? signerById.get(delivery.signedBy) ?? null : null,
      letterAsset: delivery.letterAssetId ? assetById.get(delivery.letterAssetId) ?? null : null,
    }));
  }

  /** D2: 采购端裁决专家异议工单 */
  async resolveExpertDispute(projectId: string, disputeId: string, dto: { response: string; status: string; invalidateBidSupplierId?: string }, actorId?: string) {
    const dispute = await this.prisma.expertDispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.projectId !== projectId) throw new BadRequestException({ error: '异议不存在', code: 'NOT_FOUND' });
    if (dispute.status !== 'open') throw new BadRequestException({ error: '该异议已处理，不可重复裁决', code: 'DISPUTE_NOT_OPEN' });

    // P0: 阶段门控 — 仅评标阶段可裁决（ARCHIVED 只读回看）
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段，无法裁决异议', code: 'PROJECT_NOT_EVALUATING' });
    }

    // 废标联动：采纳时可同时把指定供应商置为 invalid（须属于本项目）
    let invalidateTarget: { id: string; supplierName: string } | null = null;
    if (dto.status === 'resolved' && dto.invalidateBidSupplierId) {
      const bs = await this.prisma.bidSupplier.findFirst({
        where: { id: dto.invalidateBidSupplierId, projectId },
        select: { id: true, supplierName: true },
      });
      if (!bs) throw new BadRequestException({ error: '废标供应商不属于本项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
      invalidateTarget = bs;
    }

    const statusLabel = dto.status === 'resolved' ? '已采纳' : '已驳回';
    const now = new Date();

    // 事务：乐观锁 updateMany（防并发双裁）+ 监督日志 + 审计日志 + 废标联动
    const result = await this.prisma.$transaction(async (tx) => {
      const res = await tx.expertDispute.updateMany({
        where: { id: disputeId, status: 'open' },
        data: { status: dto.status, response: dto.response, resolvedBy: actorId, resolvedAt: now },
      });
      if (res.count === 0) throw new BadRequestException({ error: '该异议已被处理', code: 'DISPUTE_NOT_OPEN' });

      // 废标联动：同事务内置 invalid + 高风险监督日志 + B3 决议记录
      if (invalidateTarget) {
        await tx.bidSupplier.update({ where: { id: invalidateTarget.id }, data: { bidValidity: 'invalid' } });
        // #1: scoreItemId 可空 + 无 Prisma 管理 unique → findFirst + create/update
        const existingInv = await tx.bidInvalidBid.findFirst({
          where: { projectId, supplierId: invalidateTarget.id, source: 'dispute' },
        });
        if (existingInv) {
          await tx.bidInvalidBid.update({
            where: { id: existingInv.id },
            data: { reason: `异议裁决废标：${dto.response}`, actorId: actorId ?? null, status: 'invalid' },
          });
        } else {
          await tx.bidInvalidBid.create({
            data: { projectId, supplierId: invalidateTarget.id, source: 'dispute', failCount: 0, totalCount: 0, status: 'invalid', reason: `异议裁决废标：${dto.response}`, actorId: actorId ?? null },
          });
        }
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: now, role: '采购管理员', target: invalidateTarget.supplierName,
            action: '依专家异议裁决废标',
            result: `异议「${dispute.title}」采纳→废标：${dto.response}`, riskFlag: '高风险',
          },
        });
        // H6: 废标联动——清除已有评标结果，强制下次 generateEvaluationResults 重算
        // P1-2（2026-09-09）：与 manualMarkInvalidBid 共用同一口径（invalidateEvaluationResultsAndPacket）
        await this.invalidateEvaluationResultsAndPacket(tx, projectId, invalidateTarget.supplierName);
      }

      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: now, role: '采购管理员', target: dispute.expertName,
          action: `裁决专家异议·${statusLabel}`,
          result: `${dispute.title}：${dto.response}`,
          riskFlag: dto.status === 'resolved' ? '中风险' : '低风险',
        },
      });

      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'EXPERT_DISPUTE_RESOLVE', resourceType: `ExpertDispute:${disputeId}`, details: { projectId, status: dto.status, title: dispute.title, invalidateBidSupplierId: dto.invalidateBidSupplierId ?? null } },
        });
      }

      return tx.expertDispute.findUnique({ where: { id: disputeId } });
    });

    // 通知专家异议裁决结果（fire-and-forget）
    try {
      const expert = await this.prisma.bidExpert.findUnique({ where: { id: dispute.expertId }, select: { userId: true } });
      if (expert?.userId) {
        await this.notificationService.sendToUser(expert.userId, ['in_app'], {
          type: 'EXPERT_DISPUTE_RESOLVED',
          title: `异议${statusLabel}：${dispute.title}`,
          content: dto.response,
          link: `/evaluate/${projectId}`,
        });
      }
    } catch { /* 通知失败不阻塞裁决 */ }

    return result;
  }

  /**
   * H6/P1-2：废标联动——清除已有评标结果并失效未闭环签字包（事务内调用）。
   * resolveExpertDispute 与 manualMarkInvalidBid 共用同一口径：已有官方结果即清除、
   * 未闭环签字包删除并重置全员签字状态（快照与结果分叉）；闭环包抛 409 SIGN_PACKET_CLOSED
   * （spec §10 闭环后不可更正，由外层事务回滚保证废标本身不生效）。无结果时不触碰结果/签字包。
   */
  private async invalidateEvaluationResultsAndPacket(tx: any, projectId: string, targetName: string): Promise<void> {
    const existingResults = await tx.bidEvaluationResult.count({ where: { projectId } });
    if (existingResults === 0) return;
    const closedPacket = await tx.bidSignPacket.findUnique({ where: { projectId }, select: { closedAt: true } });
    if (closedPacket?.closedAt) {
      throw new ConflictException({ error: '评标签字已闭环，废标将清除已签字的评标结果；如需更正请走数据修正流程重开签字包', code: 'SIGN_PACKET_CLOSED' });
    }
    await tx.bidEvaluationResult.deleteMany({ where: { projectId } });
    await tx.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: targetName, action: '废标联动·评标结果已清除', result: '请重新生成评标结果', riskFlag: '中' },
    });
    const stalePacket = await tx.bidSignPacket.findUnique({ where: { projectId } });
    if (stalePacket) {
      await tx.bidSignPacket.delete({ where: { projectId } });
      await tx.bidExpert.updateMany({
        where: { projectId, expertRole: '正选' },
        data: {
          signStatus: 'PENDING', signStatusAt: null, signRegisteredBy: null, signScanFileId: null,
          dissentingOpinion: null, dissentingReason: null,
        },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: targetName,
          action: '废标联动·签字包已失效',
          result: `旧包指纹 ${stalePacket.sha256.slice(0, 16)}… 已作废，重算结果后须重新生成签字包`,
          riskFlag: '高',
        },
      });
    }
  }

  /** B1: 手动标记废标(围标/串标/资质造假等非通过性违规) */
  async manualMarkInvalidBid(projectId: string, supplierId: string, reason: string, actorId?: string) {
    const supplier = await this.prisma.bidSupplier.findFirst({ where: { id: supplierId, projectId } });
    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });

    // #23a: 阶段门控 — 仅评标阶段可手动废标
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段，无法手动废标', code: 'PROJECT_NOT_EVALUATING' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bidSupplier.update({ where: { id: supplierId }, data: { bidValidity: 'invalid' } });
      // B3: 废标决议记录 — source='manual', findFirst+create/update 避免复合 unique 查 null
      const existingManual = await tx.bidInvalidBid.findFirst({
        where: { projectId, supplierId, source: 'manual' },
      });
      if (existingManual) {
        await tx.bidInvalidBid.update({
          where: { id: existingManual.id },
          data: { reason, actorId, status: 'invalid' },
        });
      } else {
        await tx.bidInvalidBid.create({
          data: { projectId, supplierId, source: 'manual', failCount: 0, totalCount: 0, status: 'invalid', reason, actorId },
        });
      }
      await tx.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '采购管理员', target: supplier.supplierName,
          action: '手动废标', result: `原因: ${reason}`, riskFlag: '高风险' },
      });
      // P1-2（2026-09-09 审查）：与异议裁决废标同口径——已有官方评标结果时联动清除并
      // 失效未闭环签字包；闭环包 409 拦截（事务回滚，废标不生效）。旧实现仅置
      // bidValidity=invalid，已生成的官方结果/签字包仍把该供应商当有效候选人，
      // 形成「已签字的法定文件与废标事实并存」的矛盾并绕过 spec §10 闭环不可更正语义。
      await this.invalidateEvaluationResultsAndPacket(tx, projectId, supplier.supplierName);
    });
    return { invalidated: true };
  }

  /** B1: 撤销手动废标（恢复 bidValidity='valid'） */
  async revokeManualInvalidBid(projectId: string, supplierId: string, actorId: string) {
    const anyConfirmed = await this.prisma.bidExpert.findFirst({
      where: { projectId, reportConfirmed: true },
    });
    if (anyConfirmed) {
      throw new BadRequestException({ error: '已有专家确认评审报告，废标不可撤销', code: 'LOCKED' });
    }

    const supplier = await this.prisma.bidSupplier.findFirst({ where: { id: supplierId, projectId } });
    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (supplier.bidValidity !== 'invalid') {
      throw new BadRequestException({ error: '该供应商未被判废标', code: 'NOT_INVALID' });
    }

    // 检查是否有其他通过性投票导致的废标（BidInvalidBid），如有则不能恢复
    const stillInvalid = await this.prisma.bidInvalidBid.findFirst({
      where: { projectId, supplierId, status: 'invalid' },
    });

    await this.prisma.$transaction(async (tx) => {
      if (!stillInvalid) {
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { bidValidity: 'valid' } });
      }
      await tx.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '管理员', target: supplier.supplierName,
          action: '撤销手动废标', result: stillInvalid ? '仍有通过性废标记录，仅撤销手动标记' : '恢复有效', riskFlag: '中' },
      });
    });

    this.gateway?.notifyBidValidity?.(projectId, {
      supplierId, failCount: 0, totalCount: 0, status: 'revoked',
    });

    return { revoked: true };
  }

  // ── P2c: 多轮报价(谈判/竞价) ──

  /** 查询项目的报价轮次 */
  listRounds(projectId: string) {
    return this.prisma.bidRound.findMany({
      where: { projectId },
      include: { quotes: true },
      orderBy: { roundNo: 'asc' },
    }).then(rounds => rounds.map(r => ({
      ...r,
      // 2c 脱敏：非 published/closed 状态的轮次，密封报价不暴露给前端
      quotes: ['published', 'closed'].includes(r.status)
        ? r.quotes
        : r.quotes.map(q => ({ ...q, quotePrice: null as string | null })),
    })));
  }

  /** 创建新报价轮次 */
  async createRound(projectId: string, roundType: string, deadline?: string, actorId?: string, supplierIds?: string[]) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, roundMode: true, procurementMethod: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (!project.roundMode) throw new BadRequestException({ error: '该项目不是多轮报价模式', code: 'NOT_MULTI_ROUND' });
    // E6: 谈判采购——先评标→再报价。评标未完成（正选未确认/组长未末签/有异议未裁决）禁止创建报价轮。
    // 竞价采购(sealed_auction)为形态B（先报价后评标），不受此闸门约束。
    if (project.procurementMethod === '谈判采购') {
      await this.assertEvaluationComplete(projectId);
    }
    // 阶段守卫——谈判采购的多轮报价在评标阶段进行（先评标→再报价→最后生成结果）
    if (project.stage !== 'OPENING' && project.stage !== 'EVALUATING') {
      throw new ConflictException({ error: '当前阶段不可创建报价轮次', code: 'STAGE_NOT_OPENING' });
    }
    // H5: 并发守卫——不允许同时存在多个 open 轮次
    const openRound = await this.prisma.bidRound.findFirst({ where: { projectId, status: 'open' } });
    if (openRound) throw new ConflictException({ error: `第${openRound.roundNo}轮仍在进行中，请先截止并公布`, code: 'ROUND_STILL_OPEN' });

    const lastRound = await this.prisma.bidRound.findFirst({ where: { projectId }, orderBy: { roundNo: 'desc' } });
    const roundNo = (lastRound?.roundNo ?? 0) + 1;

    // 确定本轮可参与的供应商
    let finalEligibleIds: string[];
    if (supplierIds && supplierIds.length > 0) {
      // 显式指定：校验都属于项目且未废标
      const specified = await this.prisma.bidSupplier.findMany({
        where: { id: { in: supplierIds }, projectId },
        select: { id: true, bidValidity: true, supplierName: true, decryptStatus: true, submitStatus: true },
      });
      const invalidOnes = specified.filter(s => s.bidValidity === 'invalid');
      if (invalidOnes.length > 0) {
        throw new BadRequestException({
          error: `以下供应商已废标，不可参与报价：${invalidOnes.map(s => s.supplierName).join('、')}`,
          code: 'SUPPLIER_DISQUALIFIED',
        });
      }
      // P2-3（2026-09-09 审查）：未达参评状态（未解密/解密失败/已撤回）的家不可被点名进报价轮
      const notEvaluable = specified.filter(s => s.decryptStatus !== 'SUCCESS' || s.submitStatus === '已撤回');
      if (notEvaluable.length > 0) {
        throw new BadRequestException({
          error: `以下供应商未达参评状态（须解密成功且未撤回），不可参与报价：${notEvaluable.map(s => s.supplierName).join('、')}`,
          code: 'SUPPLIER_NOT_EVALUABLE',
        });
      }
      finalEligibleIds = specified.map(s => s.id);
    } else {
      // 默认：所有达参评状态的供应商——P2-3（2026-09-09 审查）：旧口径仅排除废标，
      // 已撤回/解密失败/未解密家照入轮（撤回家可继续报价、其报价经 syncMultiRoundPrices
      // 污染开标记录价格源）。收紧为解密成功 + 未撤回 + 未废标（谈判/竞价轮次在有效参卖家中组织）。
      const candidates = await this.prisma.bidSupplier.findMany({
        where: { projectId, bidValidity: { not: 'invalid' } },
        select: { id: true, decryptStatus: true, submitStatus: true },
      });
      finalEligibleIds = candidates
        .filter(s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回')
        .map(s => s.id);
    }

    const round = await this.prisma.bidRound.create({
      data: {
        projectId, roundNo, roundType,
        status: 'open',
        deadline: deadline ? new Date(deadline) : null,
        eligibleSupplierIds: finalEligibleIds,
      },
    });
    await this.prisma.bidProject.update({ where: { id: projectId }, data: { currentRoundNo: roundNo } });

    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '开标主持人', target: `第${roundNo}轮报价`, action: '创建报价轮次', result: `类型: ${roundType}`, riskFlag: '无' },
    }).catch(() => {});

    // 仅通知本轮被邀请供应商，避免向全体供应商泄露定向谈判/报价轮次。
    try {
      const eligibleAccounts = await this.prisma.bidSupplier.findMany({
        where: { id: { in: finalEligibleIds }, projectId },
        select: { supplier: { select: { userId: true } } },
      });
      const userIds = [...new Set(eligibleAccounts.map(row => row.supplier?.userId).filter((id): id is string => Boolean(id)))];
      for (const userId of userIds) {
        await this.notificationService.sendToUser(userId, ['in_app'], {
          type: 'BID_ROUND_OPEN',
          title: `新报价轮次已开放（第${roundNo}轮）`,
          content: '请在截止时间前提交本轮报价。',
          link: `/bids/${projectId}/round-quote`,
        });
      }
    } catch {}

    // H2: WS 广播轮次状态变更
    this.gateway?.notifyRoundStatusChange(projectId, { projectId, roundId: round.id, roundNo, status: 'open', timestamp: Date.now() });

    return round;
  }

  /** 截止报价(密封) */
  async sealRound(projectId: string, roundId: string, actorId?: string) {
    const round = await this.prisma.bidRound.findUnique({ where: { id: roundId } });
    if (!round || round.projectId !== projectId) throw new BadRequestException({ error: '轮次不存在', code: 'NOT_FOUND' });
    if (round.status !== 'open') throw new ConflictException({ error: '轮次不在开放状态', code: 'ROUND_NOT_OPEN' });

    const updated = await this.prisma.bidRound.update({ where: { id: roundId }, data: { status: 'sealed' } });
    await this.notificationService.resolveActionable(
      'BID_ROUND_OPEN',
      `/bids/${projectId}/round-quote`,
    ).catch(() => {
      // 轮次已截止；通知清理失败不得把已生效的业务状态回滚。
    });
    this.gateway?.notifyRoundStatusChange(projectId, { projectId, roundId, roundNo: round.roundNo, status: 'sealed', timestamp: Date.now() });
    return updated;
  }

  /** 公布报价(开标) */
  async publishRound(projectId: string, roundId: string, actorId?: string) {
    const round = await this.prisma.bidRound.findUnique({ where: { id: roundId }, include: { quotes: true } });
    if (!round || round.projectId !== projectId) throw new BadRequestException({ error: '轮次不存在', code: 'NOT_FOUND' });
    if (round.status !== 'sealed') throw new ConflictException({ error: '轮次未截止', code: 'ROUND_NOT_SEALED' });

    // 开标: 所有 sealed 报价 → opened
    await this.prisma.bidQuote.updateMany({ where: { roundId, status: 'sealed' }, data: { status: 'opened' } });
    const updated = await this.prisma.bidRound.update({ where: { id: roundId }, data: { status: 'published' } });
    this.gateway?.notifyRoundStatusChange(projectId, { projectId, roundId, roundNo: round.roundNo, status: 'published', timestamp: Date.now() });
    return updated;
  }

  /**
   * H3+C1: 多轮报价项目——将最终轮（最后一轮 published/closed）报价
   * 同步写入 BidOpeningRecord.amount，供 generateEvaluationResults 使用。
   * 缺 record 时创建（C1 fix），全量操作在事务中（C2 fix）。
   */
  public async syncMultiRoundPrices(projectId: string): Promise<void> {
    const lastRound = await this.prisma.bidRound.findFirst({
      where: { projectId, status: { in: ['published', 'closed'] } },
      orderBy: { roundNo: 'desc' },
    });
    if (!lastRound) return; // 无已公布轮次，跳过

    const quotes = await this.prisma.bidQuote.findMany({ where: { roundId: lastRound.id } });
    if (quotes.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const q of quotes) {
        // N1b 收尾：check-then-act 在唯一索引 (projectId, bidSupplierId) 下并发补建会裸抛 P2002，
        // 与 decryptSupplier 同款 upsert（:1985）——update 只改价格，create 为缺 record 时补建（C1 fix）
        const sup = await tx.bidSupplier.findUnique({ where: { id: q.bidSupplierId }, select: { supplierName: true } });
        await tx.bidOpeningRecord.upsert({
          where: { projectId_bidSupplierId: { projectId, bidSupplierId: q.bidSupplierId } },
          create: {
            projectId, bidSupplierId: q.bidSupplierId,
            supplierName: sup?.supplierName ?? '—',
            amount: String(q.quotePrice),
            period: '', qualityTarget: '', bondStatus: '',
            confirmStatus: 'PENDING', decryptResult: 'SUCCESS',
          },
          update: { amount: String(q.quotePrice) },
        });
      }

      await tx.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '系统', target: projectId, action: `多轮报价最终价格同步（R${lastRound.roundNo} → 开标记录）`, result: `${quotes.length}家报价已写入`, riskFlag: '低' },
      });
    });
  }

  /** 结束轮次(进入下一轮或结束报价) */
  async closeRound(projectId: string, roundId: string, proceedToEvaluation: boolean, actorId?: string) {
    // C1+C2: 事务化，防止部分失败导致数据不一致
    const result = await this.prisma.$transaction(async (tx) => {
      const round = await tx.bidRound.findUnique({ where: { id: roundId } });
      if (!round || round.projectId !== projectId) throw new BadRequestException({ error: '轮次不存在', code: 'NOT_FOUND' });
      if (round.status !== 'published') throw new ConflictException({ error: '轮次未公布', code: 'ROUND_NOT_PUBLISHED' });

      // H10: proceedToEvaluation 时校验为最后一轮
      if (proceedToEvaluation) {
        const lastRound = await tx.bidRound.findFirst({ where: { projectId }, orderBy: { roundNo: 'desc' } });
        if (lastRound && round.roundNo !== lastRound.roundNo) {
          throw new BadRequestException({ error: '只能从最后一轮结束报价', code: 'NOT_LAST_ROUND' });
        }
      }

      await tx.bidRound.update({ where: { id: roundId }, data: { status: 'closed' } });

      // H3: 不在此处写 BidOpeningRecord——价格写入移至 startEvaluation
      // （:3007 不持有阶段流转，closeRound 只关闭轮次）

      await tx.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '开标主持人', target: `R${round.roundNo}`, action: `关闭报价轮次 R${round.roundNo}`, result: proceedToEvaluation ? '最终轮·报价结束' : '进入下一轮准备', riskFlag: '低' },
      });

      return { roundNo: round.roundNo };
    });

    // H2+L7: WS 广播 + 返回详情
    this.gateway?.notifyRoundStatusChange(projectId, { projectId, roundId, roundNo: result.roundNo, status: 'closed', timestamp: Date.now() });
    return { closed: true, proceedToEvaluation, roundNo: result.roundNo };
  }

  /** 供应商提交报价 */
  async submitQuote(projectId: string, roundId: string, bidSupplierId: string, quotePrice: number) {
    const round = await this.prisma.bidRound.findUnique({ where: { id: roundId } });
    if (!round || round.projectId !== projectId) throw new BadRequestException({ error: '轮次不存在', code: 'NOT_FOUND' });
    if (round.status !== 'open') throw new ConflictException({ error: '轮次不在开放状态', code: 'ROUND_NOT_OPEN' });
    if (round.deadline && new Date() > new Date(round.deadline)) {
      throw new BadRequestException({ error: '报价已截止', code: 'ROUND_DEADLINE_PASSED' });
    }

    // 验证供应商属于该项目
    const supplier = await this.prisma.bidSupplier.findFirst({ where: { id: bidSupplierId, projectId } });
    if (!supplier) throw new ForbiddenException({ error: '供应商不属于该项目', code: 'NOT_PROJECT_SUPPLIER' });

    // 校验供应商在轮次合格名单中（legacy 兼容：空数组=不限制）
    if (round.eligibleSupplierIds && round.eligibleSupplierIds.length > 0
        && !round.eligibleSupplierIds.includes(bidSupplierId)) {
      throw new ForbiddenException({ error: '该供应商不在本轮可参与名单中', code: 'NOT_ELIGIBLE_FOR_ROUND' });
    }
    // 废标供应商不可报价
    if (supplier.bidValidity === 'invalid') {
      throw new ForbiddenException({ error: '供应商已废标，不可报价', code: 'SUPPLIER_DISQUALIFIED' });
    }
    // P2-3：未达参评状态（未解密/已撤回）的家不可报价——与 createRound 名单口径一致
    if (supplier.decryptStatus !== 'SUCCESS' || supplier.submitStatus === '已撤回') {
      throw new ForbiddenException({ error: '供应商未达参评状态（须解密成功且未撤回），不可报价', code: 'SUPPLIER_NOT_EVALUABLE' });
    }

    // H4: 严格一报制——与供应商端一致，upsert 改为 create + P2002 catch
    try {
      return await this.prisma.bidQuote.create({ data: { roundId, bidSupplierId, quotePrice } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException({ error: '该供应商本轮已提交报价', code: 'ALREADY_QUOTED' });
      throw e;
    }
  }

  /** 获取轮次报价(仅 published 轮次对供应商可见) */
  async getRoundQuotes(projectId: string, roundId: string, requesterRole: string) {
    const round = await this.prisma.bidRound.findUnique({ where: { id: roundId } });
    if (!round || round.projectId !== projectId) throw new BadRequestException({ error: '轮次不存在', code: 'NOT_FOUND' });

    // 供应商只能看 published 轮次;管理端可看所有
    if (requesterRole === 'supplier' && round.status !== 'published') {
      return []; // 未公布的轮次不返回报价
    }
    return this.prisma.bidQuote.findMany({ where: { roundId }, orderBy: { quotePrice: 'asc' } });
  }

  async exportArchivePackage(projectId: string, format: 'json' | 'csv' = 'json', scope: 'full' | 'summary' = 'full') {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: { include: { scoreItem: true } } }, orderBy: { id: 'asc' } },
        scoreItems: true,
        clarifications: true,
        supervisionLogs: { orderBy: { time: 'asc' } },
        archiveItems: true,
        evaluationResults: { orderBy: { rank: 'asc' } },
      },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // P2-2（2026-09-09 审查）：导出与 listScores/getProject 的评标期匿名化同口径——EVALUATING
    // 且未全员确认报告时 expertScores 以稳定编号（专家 N）脱敏，防止导出通道成为
    // EXPERT_SCORE_ANONYMIZED_DURING_EVAL 的旁路；全员确认/归档后证据文件自然实名。
    const anonymizeExport = process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL !== 'false';
    const allConfirmedExport = project.experts.length > 0 && project.experts.every(e => e.reportConfirmed);
    const maskExport = anonymizeExport && project.stage === 'EVALUATING' && !allConfirmedExport;
    const anonLabelExport = new Map(
      [...project.experts].map(e => e.id).sort().map((id, i) => [id, `专家 ${i + 1}`]),
    );
    const displayExpertName = (e: { id: string; expertName: string }) =>
      maskExport ? (anonLabelExport.get(e.id) ?? '专家') : e.expertName;

    const hallMessages = await this.prisma.openingHallMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    // W11-①（A-101）：投标回执 SM2 签名存档段（有签署才导出）
    const submissionReceipts = await this.prisma.supplierBidSubmission.findMany({
      where: { projectId, receiptSignature: { not: Prisma.DbNull } },
      select: { id: true, supplierId: true, status: true, receiptSignature: true, receiptSignedAt: true },
    });
    // OpeningHallMessage 不存 supplierName（schema 仅 supplierId）；私聊归属经 BidSupplier 反查
    const hallSupplierNames = new Map(
      (await this.prisma.bidSupplier.findMany({ where: { projectId }, select: { supplierId: true, supplierName: true } }))
        .filter(s => s.supplierId)
        .map(s => [s.supplierId as string, s.supplierName] as const),
    );

    const chain = computeArchiveChain(
      { id: project.id, projectCode: project.projectCode, name: project.name, stage: project.stage },
      project.archiveItems.map((i: any) => {
        const { fileHashes, ...rest } = i;
        return { ...rest, ...(Array.isArray(fileHashes) ? { fileHashes: fileHashes as string[] } : {}) };
      }),
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
      // W8（A-115）：有 active 开标记录模板则按模板列导出，否则回退内置列
      const openingTpl = await this.prisma.workTemplate.findFirst({ where: { kind: 'opening_record', isActive: true }, orderBy: { updatedAt: 'desc' } }).catch(() => null);
      const openingCols = (openingTpl?.content as { columns?: Array<{ key: string; label: string }> } | null)?.columns;
      if (openingCols && openingCols.length > 0) {
        lines.push(openingCols.map(c => c.label).map(esc).join(','));
        // A-113：模板列不在法定专属列时回退 customFields 动态字段仓（仍无则空串）
        project.openingRecords.forEach(r => lines.push(openingCols.map(c => String((r as unknown as Record<string, unknown>)[c.key] ?? (r.customFields as Record<string, string> | undefined)?.[c.key] ?? '')).map(esc).join(',')));
      } else {
        lines.push(['供应商', '报价', '工期', '质量目标', '保证金', '解密结果', '确认状态'].map(esc).join(','));
        project.openingRecords.forEach(r => lines.push([r.supplierName, r.amount, r.period, r.qualityTarget, r.bondStatus, r.decryptResult, r.confirmStatus].map(esc).join(',')));
      }
      lines.push('');
      lines.push('=== 供应商确认/异议记录 ===');
      lines.push(['供应商', '确认状态', '异议原因'].map(esc).join(','));
      project.suppliers.filter(s => s.confirmStatus !== 'PENDING').forEach(s => lines.push([s.supplierName, s.confirmStatus, s.decryptError || ''].map(esc).join(',')));
      project.openingRecords.filter(r => r.objectionReason).forEach(r => lines.push([r.supplierName, r.confirmStatus, r.objectionReason || ''].map(esc).join(',')));
      lines.push('');
      lines.push('=== 专家评分明细 ===');
      lines.push(['专家', '供应商', '评分项', '分数', '评语'].map(esc).join(','));
      project.experts.forEach(e => e.scoreRecords.forEach(sr => lines.push([displayExpertName(e), project.suppliers.find(s => s.id === sr.supplierId)?.supplierName || '', sr.scoreItem?.name || '', sr.score, sr.reason].map(esc).join(','))));
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
      if (submissionReceipts.length > 0) {
        lines.push('', '=== 投标回执 SM2 签名（A-101）===');
        lines.push(['提交ID', '供应商', '签署时间', '算法'].map(esc).join(','));
        for (const r of submissionReceipts) {
          const rec = r.receiptSignature as { algorithm?: string } | null;
          lines.push([r.id, r.supplierId, r.receiptSignedAt?.toISOString() ?? '', rec?.algorithm ?? ''].map(esc).join(','));
        }
      }
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
      submissionReceipts: submissionReceipts.map(r => ({
        submissionId: r.id,
        supplierId: r.supplierId,
        signedAt: r.receiptSignedAt?.toISOString() ?? null,
        receipt: r.receiptSignature as object,
      })),
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
        expertScores: project.experts.map(e => ({ expertName: displayExpertName(e), major: e.major, scores: e.scoreRecords.map(sr => ({ supplierId: sr.supplierId, scoreItemName: sr.scoreItem?.name, score: sr.score, reason: sr.reason })) })),
        evaluationResults: project.evaluationResults,
        supervisionLogs: project.supervisionLogs,
        clarifications: project.clarifications,
        hallMessages: hallSection,
        confirmationRecords: project.suppliers.filter(s => s.confirmStatus !== 'PENDING').map(s => ({ supplierName: s.supplierName, status: s.confirmStatus, error: s.decryptError })),
      },
      ...(aiUsage ? { aiUsage } : {}),
    };
  }

  /* ── 评分标准编制（评标办法）—— 委托到 BidScoreStandardService（2026-08 拆分）── */

  listScoreItems(projectId: string) { return this.scoreStandard.listScoreItems(projectId); }
  async createScoreItem(projectId: string, dto: CreateScoreItemDto, actor: { userId: string; role: string }) { return this.scoreStandard.createScoreItem(projectId, dto, actor); }
  async updateScoreItem(projectId: string, itemId: string, dto: UpdateScoreItemDto, actor: { userId: string; role: string }) { return this.scoreStandard.updateScoreItem(projectId, itemId, dto, actor); }
  async deleteScoreItem(projectId: string, itemId: string, actor: { userId: string; role: string }) { return this.scoreStandard.deleteScoreItem(projectId, itemId, actor); }
  listScorePoints(projectId: string, itemId: string) { return this.scoreStandard.listScorePoints(projectId, itemId); }
  async createScorePoint(projectId: string, itemId: string, dto: CreateScorePointDto) { return this.scoreStandard.createScorePoint(projectId, itemId, dto); }
  async updateScorePoint(projectId: string, itemId: string, pointId: string, dto: UpdateScorePointDto) { return this.scoreStandard.updateScorePoint(projectId, itemId, pointId, dto); }
  async deleteScorePoint(projectId: string, itemId: string, pointId: string) { return this.scoreStandard.deleteScorePoint(projectId, itemId, pointId); }
  async batchCreateScorePoints(projectId: string, itemId: string, dto: BatchCreateScorePointsDto) { return this.scoreStandard.batchCreateScorePoints(projectId, itemId, dto); }
  async updateLinkedRequirements(projectId: string, itemId: string, pointId: string, linkedRequirementIds: string[]) { return this.scoreStandard.updateLinkedRequirements(projectId, itemId, pointId, linkedRequirementIds); }
  async getTenderRequirements(projectId: string) { return this.scoreStandard.getTenderRequirements(projectId); }
  async applyScoreItemTemplate(projectId: string, actor: { userId: string; role: string }) { return this.scoreStandard.applyScoreItemTemplate(projectId, actor); }
  async publishScoreStandard(projectId: string, actor: { userId: string; role: string; username: string }) { return this.scoreStandard.publishScoreStandard(projectId, actor); }
  async saveScoreTemplate(projectId: string, name: string, userId?: string, username?: string) { return this.scoreStandard.saveScoreTemplate(projectId, name, userId, username); }
  async listScoreTemplates(userId?: string, procurementMethod?: string, projectCategory?: string) { return this.scoreStandard.listScoreTemplates(userId, procurementMethod, projectCategory); }
  async applyScoreTemplateById(projectId: string, templateId: string, actor: { userId: string; role: string }) { return this.scoreStandard.applyScoreTemplateById(projectId, templateId, actor); }
  async deleteScoreTemplate(templateId: string, userId?: string, role?: string) { return this.scoreStandard.deleteScoreTemplate(templateId, userId, role); }

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
      select: { id: true, projectCode: true, name: true, openTime: true },
    });
    if (!project) {
      throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    }
    assertNudgeWindowOpen(project.openTime);

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

  // ── 催促未投递供应商（v2：逐家 AI 文案 + 自选渠道 + 一次性额度，人工/自动共用）──
  // 目标集合 = 回执 ACCEPTED 且尚未投递的供应商；回执可能写在 PM-item id 或 BidProject id 两个空间，故都查。

  /** 计算"已回执参加 + 未投递"的供应商目标集合（含 supplierId/name/userId）。
   *  与是否已生成逐家文案无关——文案仅在发送时按 supplierId 取用。 */
  private async computeNudgeTargets(
    bidProjectId: string,
  ): Promise<{ supplierId: string; name: string; userId: string | null }[]> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: bidProjectId },
      select: { id: true, projectManagementItemId: true },
    });
    if (!project) return [];
    const pmId = project.projectManagementItemId;

    const [roster, submissions, rsvps] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: bidProjectId },
        select: { supplierId: true, supplierName: true, submitStatus: true, supplier: { select: { userId: true } } },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: bidProjectId },
        select: { supplierId: true, status: true },
      }),
      this.prisma.invitationRsvp.findMany({
        where: { projectId: { in: pmId ? [bidProjectId, pmId] : [bidProjectId] }, status: 'ACCEPTED' },
        select: { supplierId: true, supplierName: true },
      }),
    ]);

    const subMap = new Map(submissions.map(s => [s.supplierId, s]));
    const nameMap = new Map<string, string>();
    for (const r of roster) if (r.supplierId) nameMap.set(r.supplierId, r.supplierName);
    for (const r of rsvps) if (r.supplierId) nameMap.set(r.supplierId, r.supplierName);
    const userMap = new Map<string, string | null>();
    for (const r of roster) if (r.supplierId) userMap.set(r.supplierId, r.supplier?.userId ?? null);

    const accepted = new Set(rsvps.map(r => r.supplierId));
    const seen = new Set<string>();
    const targets: { supplierId: string; name: string; userId: string | null }[] = [];
    for (const sid of accepted) {
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      const submission = subMap.get(sid);
      const entry = roster.find(r => r.supplierId === sid);
      const submitted = submission?.status === 'submitted' || (!submission && entry?.submitStatus === '已提交');
      if (submitted) continue;
      targets.push({ supplierId: sid, name: nameMap.get(sid) ?? sid, userId: userMap.get(sid) ?? null });
    }
    return targets;
  }

  /** 当前催促状态（供面板渲染：是否已发/已定时、定时点、目标名单、文案数）。 */
  async getNudgeStatus(bidProjectId: string): Promise<{
    status: string | null; sendAt: string | null; sentAt: string | null;
    channels: string[]; messageCount: number; canNudge: boolean; openTime: string | null;
    targets: { supplierId: string; name: string }[];
  }> {
    const project = await this.prisma.bidProject.findUnique({ where: { id: bidProjectId }, select: { openTime: true } });
    const nudge = await this.prisma.bidSupplierNudge.findUnique({ where: { bidProjectId } });
    const messages = (nudge?.messages as Record<string, { title: string; body: string }> | null) ?? {};
    const targets = await this.computeNudgeTargets(bidProjectId);
    return {
      status: nudge?.status ?? null,
      sendAt: nudge?.sendAt ? nudge.sendAt.toISOString() : null,
      sentAt: nudge?.sentAt ? nudge.sentAt.toISOString() : null,
      channels: (nudge?.channels as string[] | null) ?? [],
      messageCount: Object.keys(messages).length,
      canNudge: nudge?.status !== 'SENT',
      openTime: project?.openTime ? project.openTime.toISOString() : null,
      targets: targets.map(t => ({ supplierId: t.supplierId, name: t.name })),
    };
  }

  /** 人工立即发送：原子抢占一次额度（已发则 409），按当前目标集合逐家多渠道投递。 */
  async sendNudgeNow(
    bidProjectId: string,
    input: { channels: string[]; messages: Record<string, { title: string; body: string }> },
    actorId: string,
  ): Promise<{ sent: number; notFound: number }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: bidProjectId },
      select: { id: true, projectCode: true, openTime: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertNudgeWindowOpen(project.openTime);

    const claimed = await this.prisma.bidSupplierNudge.updateMany({
      where: { bidProjectId, status: { not: 'SENT' } },
      data: { status: 'SENT', sentAt: new Date(), channels: input.channels as unknown as Prisma.InputJsonValue, messages: input.messages as unknown as Prisma.InputJsonValue },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.bidSupplierNudge.findUnique({ where: { bidProjectId }, select: { status: true } });
      if (existing?.status === 'SENT') throw new ConflictException({ error: '该项目已催促过，仅可催促一次', code: 'NUDGE_ALREADY_SENT' });
    }
    if (claimed.count === 0) {
      await this.prisma.bidSupplierNudge.upsert({
        where: { bidProjectId },
        create: { bidProjectId, status: 'SENT', sentAt: new Date(), channels: input.channels as unknown as Prisma.InputJsonValue, messages: input.messages as unknown as Prisma.InputJsonValue },
        update: { status: 'SENT', sentAt: new Date(), channels: input.channels as unknown as Prisma.InputJsonValue, messages: input.messages as unknown as Prisma.InputJsonValue },
      });
    }

    const targets = await this.computeNudgeTargets(bidProjectId);
    let sent = 0;
    let notFound = 0;
    for (const t of targets) {
      const msg = input.messages[t.supplierId];
      if (!msg || !msg.body?.trim()) continue; // 无对应文案者跳过（不催）
      if (!t.userId) { notFound++; continue; }
      try {
        await this.notificationService.sendToUser(t.userId, input.channels, {
          type: 'BID_NUDGE_SUPPLIER', title: msg.title, content: msg.body, link: null,
        });
        sent++;
      } catch (e) {
        this.logger.warn(`催促发送失败 supplier=${t.supplierId}: ${(e as Error).message}`);
      }
    }
    await this.prisma.auditLog.create({
      data: { userId: actorId, action: 'BID_NUDGE_SUPPLIERS', resourceType: project.projectCode, details: { projectId: bidProjectId, mode: 'manual', sent, notFound } },
    }).catch(() => {});
    return { sent, notFound };
  }

  /** 定时发送（开标前 24h）：写入 SCHEDULED；若已发则 409。重复定时以最新为准。 */
  async scheduleNudge(
    bidProjectId: string,
    input: { sendAt: string; channels: string[]; messages: Record<string, { title: string; body: string }> },
    actorId: string,
  ): Promise<{ sendAt: string }> {
    const project = await this.prisma.bidProject.findUnique({ where: { id: bidProjectId }, select: { id: true, projectCode: true, openTime: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertNudgeWindowOpen(project.openTime);
    const sendAt = new Date(input.sendAt);
    if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() <= Date.now()) {
      throw new BadRequestException({ error: '定时时间无效或已过期', code: 'INVALID_SCHEDULE' });
    }
    const existing = await this.prisma.bidSupplierNudge.findUnique({ where: { bidProjectId }, select: { status: true } });
    if (existing?.status === 'SENT') throw new ConflictException({ error: '该项目已催促过，无法再设定时', code: 'NUDGE_ALREADY_SENT' });

    await this.prisma.bidSupplierNudge.upsert({
      where: { bidProjectId },
      create: { bidProjectId, status: 'SCHEDULED', sendAt, channels: input.channels as unknown as Prisma.InputJsonValue, messages: input.messages as unknown as Prisma.InputJsonValue },
      update: { status: 'SCHEDULED', sendAt, channels: input.channels as unknown as Prisma.InputJsonValue, messages: input.messages as unknown as Prisma.InputJsonValue },
    });
    await this.prisma.auditLog.create({
      data: { userId: actorId, action: 'BID_NUDGE_SUPPLIERS', resourceType: project.projectCode, details: { projectId: bidProjectId, mode: 'scheduled', sendAt: sendAt.toISOString() } },
    }).catch(() => {});
    return { sendAt: sendAt.toISOString() };
  }

  /** 取消定时（仅 SCHEDULED 可取消；已发不可取消）。 */
  async cancelNudge(bidProjectId: string, actorId: string): Promise<{ ok: boolean }> {
    const res = await this.prisma.bidSupplierNudge.updateMany({
      where: { bidProjectId, status: 'SCHEDULED' },
      data: { status: null, sendAt: null },
    });
    if (res.count > 0) {
      const p = await this.prisma.bidProject.findUnique({ where: { id: bidProjectId }, select: { projectCode: true } });
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_NUDGE_SUPPLIERS', resourceType: p?.projectCode ?? bidProjectId, details: { projectId: bidProjectId, mode: 'cancelled' } },
      }).catch(() => {});
    }
    return { ok: true };
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
    // P2-8（2026-09-09 审查）：通知内容校验——openTime 须可解析且与项目当前值一致。
    // 实际变更须先经 updateProject（24h 规则闸 + 监督/审计留痕），通知不得脱离变更任意广播。
    const openTimeDate = new Date(openTime);
    if (Number.isNaN(openTimeDate.getTime())) {
      throw new BadRequestException({ error: '开标时间无法解析', code: 'INVALID_TIME' });
    }
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, name: true, openTime: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.openTime && Math.abs(openTimeDate.getTime() - new Date(project.openTime).getTime()) > 1000) {
      throw new BadRequestException({
        error: '通知中的开标时间与项目当前值不一致；请先通过项目编辑完成时间变更（含 24h 规则校验与留痕），再发送变更通知',
        code: 'SCHEDULE_MISMATCH',
      });
    }

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

    // #1: 旧 unique 约束已移除 → findFirst 替代 findUnique
    const rec = await this.prisma.bidInvalidBid.findFirst({
      where: { projectId, supplierId, scoreItemId },
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

  /** 正选↔候补角色互换（开标确认页 操作→替换） */
  async swapExpertRole(projectId: string, fromExpertId: string, toExpertId: string) {
    // backlog §6.2（原 P2-5）：评标启动后互换评委 = 改变委员会组成，被换正选的已交评分
    // 会被聚合口径静默排除——须走重评/补选流程，不允许静默互换。评标前互换是正常递补，放行。
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage === 'EVALUATING' || project.stage === 'ARCHIVED') {
      throw new ConflictException({
        error: '评标已启动，不可互换正选/候补专家（改变委员会组成）——如需更换请走异议裁决或重新评标流程',
        code: 'EXPERT_SWAP_LOCKED',
      });
    }
    const [e1, e2] = await Promise.all([
      this.prisma.bidExpert.findFirst({ where: { projectId, id: fromExpertId } }),
      this.prisma.bidExpert.findFirst({ where: { projectId, id: toExpertId } }),
    ]);
    if (!e1 || !e2) throw new BadRequestException({ error: '专家记录不存在', code: 'NOT_FOUND' });
    await this.prisma.$transaction([
      this.prisma.bidExpert.update({ where: { id: e1.id }, data: { expertRole: '候补' } }),
      this.prisma.bidExpert.update({ where: { id: e2.id }, data: { expertRole: '正选' } }),
    ]);
    return { success: true };
  }

  /** 审批延期评标——延长 evaluationDeadline，记录监督日志和审计日志 */
  async extendEvaluationDeadline(projectId: string, extendHours: number, reason: string, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { evaluationDeadline: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    // F16（2026-08-28）：单次延期上限对齐启动评标 evaluationHours 的 720h 封顶——
    // 旧实现 DTO 仅 @Min(1) 可任意延长；service 硬校验防绕过 DTO 直调
    if (!Number.isFinite(extendHours) || extendHours < 1 || extendHours > 720) {
      throw new BadRequestException({ error: `延期时长须为 1~720 小时（收到 ${extendHours}）`, code: 'EXTEND_HOURS_OUT_OF_RANGE' });
    }
    const base = project.evaluationDeadline && new Date(project.evaluationDeadline) > new Date()
      ? new Date(project.evaluationDeadline)
      : new Date();
    const newDeadline = new Date(base.getTime() + extendHours * 60 * 60 * 1000);
    await this.prisma.bidProject.update({
      where: { id: projectId },
      data: { evaluationDeadline: newDeadline },
    });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId,
        time: new Date(),
        role: '采购管理',
        target: project.name,
        action: `评标延期 ${extendHours}h`,
        result: reason,
        riskFlag: '中风险',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'EVALUATION_EXTEND',
        resourceType: `BidProject:${projectId}`,
        details: { extendHours, reason, newDeadline },
      },
    }).catch(() => {});
    return { evaluationDeadline: newDeadline };
  }

  /** A-143：主持端核验供应商在线答复签名（重算 canonical + SM2 验签；验真刷新 verifiedAt） */
  async verifyClarificationReply(projectId: string, cid: string) {
    const clar = await this.prisma.bidClarification.findFirst({ where: { id: cid, projectId } });
    if (!clar) throw new BadRequestException({ error: '澄清不存在或不属于此项目', code: 'CLARIFICATION_NOT_IN_PROJECT' });
    const sig = clar.replySignature as
      | { payload?: string; signature?: string; certSn?: string; verifiedAt?: string }
      | null;
    if (clar.replyChannel !== 'online' || !sig?.signature || !sig.certSn || !clar.reply) {
      throw new BadRequestException({ error: '该澄清无在线签名答复', code: 'NO_ONLINE_REPLY' });
    }
    const attachments = ((clar.replyAttachmentIds ?? []) as { fileAssetId: string; sha256: string }[])
      .map((a) => ({ fileAssetId: a.fileAssetId, sha256: a.sha256 }));
    const canonical = buildClarificationReplyCanonical({
      clarificationId: clar.id, projectId, supplierId: clar.supplierId ?? '',
      reply: clar.reply, attachments, certSn: sig.certSn,
    });
    const cert = await this.prisma.supplierCert.findFirst({ where: { certSn: sig.certSn } });
    const valid = !!cert && this.signature.verify(canonical, sig.signature, cert.publicKey);
    // 完整性双保险：库内 payload 串须与重算 canonical 一致（防行内 payload 被篡改）
    const consistent = canonical === sig.payload;
    if (valid && consistent) {
      const refreshed = { ...sig, verifiedAt: new Date().toISOString() };
      await this.prisma.bidClarification.update({ where: { id: cid }, data: { replySignature: refreshed } });
      return { valid: true, certSn: sig.certSn, bindingStatus: cert!.bindingStatus, verifiedAt: refreshed.verifiedAt };
    }
    return {
      valid: valid && consistent,
      certSn: sig.certSn,
      bindingStatus: cert?.bindingStatus ?? 'NOT_FOUND',
      verifiedAt: sig.verifiedAt ?? null,
    };
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
