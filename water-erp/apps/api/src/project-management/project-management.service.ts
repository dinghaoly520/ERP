import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile, copyFile, access, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import JSZip = require('jszip');
import { Response } from 'express';
import { ResultStatus, SourceType, type Prisma } from '@prisma/client';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';
import { AiService } from '../ai/ai.service';
import { parseFlexibleDate } from '../common/parse-date.util';
import { generateProjectCode } from '../common/project-code.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import * as mammoth from 'mammoth';
import { convertDocxToHtml as convertDocxToHtmlPatched } from './docx/docx-to-html.converter';
import { htmlToDocxChildren } from './docx/html-to-docx.converter';
import { getTenderTextCachePath, isLabelLine, normalizeStageMatchText, getUploadDir, getProjectSummaryCachePath, getStageAnalysisCachePath, getComplianceCachePath, getStepAnalysisCachePath, buildStageAnalysisFingerprint, sanitizeFileName, normalizeUploadedFileName, summarizeHtmlDiff } from './docx/file-utils';
import { parseArchiveTxt } from './docx/archive-txt-parser';
import { decodeXmlText, extractPlainText, applyTextToParagraphXml } from './docx/paragraph-xml';
import { extractBiddingUnitsFromText, extractAwardedSupplierFromText, extractContractAmountFromText, extractAwardedSupplierFromAwardTable, extractAwardedSupplierFromContract, extractContractNumberFromText, extractExpertInfoFromText, extractProjectOverviewFromText } from './docx/field-extractor';
import { patchDocx, ConcurrentEditError } from './docx/html-to-docx.patcher';
import { Document, Packer } from 'docx';
import { DocumentParserService } from '../knowledge/services/document-parser.service';
import { StorageService } from '../storage/storage.service';
import { GbCodeService } from '../common/gb-code.service';
import { ArchiveScopeService } from '../archive/archive-scope.service';
import { StageComplianceConfigService } from './stage-compliance-config.service';
import { ArchiveFlowService } from '../archive/archive-flow.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteProjectDto } from './dto/complete-project.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { CreateProjectFromInitiationDto } from './dto/create-project-from-initiation.dto';
import { QueryProjectManagementDto } from './dto/query-project-management.dto';
import { getEvaluationDefault } from '../bid/evaluation-method.config';
import { UpdateProjectStageDto } from './dto/update-project-stage.dto';
import { AnalyzeBudgetReferenceDto } from './dto/analyze-budget-reference.dto';
import { estimateBudgetReference } from './budget-reference-estimator';
import { LOCKED_STAGES, PROJECT_WORKFLOW_STAGES } from './project-management.types';
import { getStageComplianceRules } from './stage-compliance-rules';

type ProjectManagementStatusValue = 'ACTIVE' | 'ARCHIVED' | 'RECYCLED';
type ProjectStageStatusValue = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

type StoredAttachment = {
  fileName: string;
  objectKey: string;
  mimeType: string;
  fileSize: number;
  uploadedById?: string;
};

const PROJECT_MANAGEMENT_STATUS: Record<
  ProjectManagementStatusValue,
  ProjectManagementStatusValue
> = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  RECYCLED: 'RECYCLED',
};

const PROJECT_STAGE_STATUS: Record<
  ProjectStageStatusValue,
  ProjectStageStatusValue
> = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
};

/** 采购方式前两字拼音首字母 → 项目编号前缀（竞价→JJ、邀请→YQ…）；未知字回退 ASCII 大写或 X */
const PROCUREMENT_METHOD_PINYIN: Record<string, string> = {
  谈: 'T', 判: 'P', 竞: 'J', 价: 'J', 直: 'Z', 接: 'J',
  邀: 'Y', 请: 'Q', 询: 'X', 比: 'B', 小: 'X', 额: 'E', 公: 'G', 开: 'K',
};
function procurementMethodPrefix(method?: string | null): string {
  const chars = Array.from(method ?? '').slice(0, 2);
  return (
    chars
      .map((c) => PROCUREMENT_METHOD_PINYIN[c] ?? (/[a-zA-Z]/.test(c) ? c.toUpperCase() : 'X'))
      .join('') || 'XM'
  );
}

const KNOWN_CATEGORIES = [
  '生产技术类采购',
  'EPC项目采购',
  'EPC管理采购',
  '公用集中采购',
  '科技研发类采购',
  '信息化采购',
  '其他',
];

const KNOWN_METHODS = [
  '公开招标',
  '邀请招标',
  '竞价采购',
  '谈判采购',
  '询比采购',
  '单一来源采购',
  '直接委托续约采购',
  '框架协议采购',
  '直接签订合同',
];

const KNOWN_ORGANIZATION_FORMS = ['自行招标', '委托招标'];

// 本单位名称，不应被拾取为中标单位

/** 解析项目基本信息中的开标时间字符串：兼容 ISO、"2026年8月15日"、"2026-08-15"、"2026/8/15 10:00" 等 */
function parseBidOpeningTime(raw: string | null | undefined): Date | null {
  return parseFlexibleDate(raw);
}

/** 再次采购时按采购方式插入的阶段段（与前端 PROCUREMENT_METHOD_STAGES 的 TENDER_DOCUMENT→AWARD_DECISION 一致）*/
const REPROC_STAGE_SEGMENTS: Record<string, Array<{ key: string; label: string }>> = {
  谈判采购: [
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'SUPPLIER_INVITATION', label: '供应商邀请' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
  ],
  竞价采购: [
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
  ],
  直接采购: [
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示(供应商邀请)' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
  ],
  邀请招标: [
    { key: 'TENDER_DOCUMENT', label: '招标文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
  ],
  询比采购: [
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
  ],
};

@Injectable()
export class ProjectManagementService {
  private readonly logger = new Logger(ProjectManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gbCode: GbCodeService,
    private readonly aiService: AiService,
    private readonly documentParser: DocumentParserService,
    private readonly storage: StorageService,
    private readonly archiveScope: ArchiveScopeService,
    private readonly archiveFlow: ArchiveFlowService,
    private readonly stageCompliance: StageComplianceConfigService,
  ) {}

  async list(query: QueryProjectManagementDto, user?: AuthenticatedUser) {
    const where: Record<string, unknown> = {};

    // 项目可见性（拍板 1C，2026-08-24 确认保留）：非 admin 仅见本人创建的项目；admin 全量。
    // 隔离是硬性要求，不做全员可见。user=undefined 属鉴权异常，返回空集不泄露数据。
    if (user?.role !== 'admin') {
      where.createdById = user?.sub ?? '__no_user__';
    }

    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { requesterName: { contains: query.keyword, mode: 'insensitive' } },
        {
          requesterDepartment: {
            contains: query.keyword,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (query.requesterDepartment) {
      where.requesterDepartment = query.requesterDepartment;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.currentStage) {
      where.currentStage = query.currentStage;
    }

    const items = await this.prisma.projectManagementItem.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        stages: {
          orderBy: { stageOrder: 'asc' },
          include: { attachments: true },
        },
        createdBy: true,
        submittedBy: true,
        reviewedBy: true,
      },
    });

    return items.map((item) => ({
      ...item,
      budgetAmount: Number(item.budgetAmount),
      createdByName: item.createdBy?.displayName || item.createdBy?.username || null,
      submittedByName: item.submittedBy?.displayName || item.submittedBy?.username || null,
      reviewedByName: item.reviewedBy?.displayName || item.reviewedBy?.username || null,
    }));
  }

  /** P2: 按采购方式构建评标办法+公式默认值 */
  private buildEvaluationDefaults(procurementMethod: string): Record<string, unknown> {
    const def = getEvaluationDefault(procurementMethod);
    const data: Record<string, unknown> = { evaluationMethod: def.evaluationMethod };
    if (def.formulaType) {
      data.priceFormulaConfig = { formulaType: def.formulaType };
    }
    // P2c: 谈判/竞价设多轮模式
    if (procurementMethod === '谈判采购') data.roundMode = 'negotiation';
    else if (procurementMethod === '竞价采购') data.roundMode = 'sealed_auction';
    return data;
  }

  /**
   * 开标确认：确保项目管理项已关联 BidProject。
   * 已关联 → 返回该 BidProject 概要；未关联 → 按项目信息创建并回写 bidProjectId。
   * 兼容未来"立项时自动创建"：无论关联何时建立，本方法都幂等返回。
   */
  /**
   * N16 方案 A（2026-08-17）：公告直建项目自动补建最小 PMI。
   * 信息发布中心独立发布 BID_NOTICE 且无既有项目时，BidProject 由 createFromAnnouncement 创建（无 PMI 挂钩），
   * 而 :3005 开标确认面板（评分标准/主持人/按时开标/归档/公示）以 PMI 为宿主——本方法补齐宿主。
   * 编号复用 create 流程同款规则（procurementMethodPrefix + 当日序号）；阶段集复用 PROJECT_WORKFLOW_STAGES
   * + 方法过滤（PUBLIC_ANNOUNCEMENT 仅竞价/直接/邀请）；前置阶段以公告为准补记 COMPLETED，
   * currentStage 落 BID_EVALUATION（此后 syncPmStage 恢复正常联动）。
   */
  async createItemFromAnnouncement(
    companyStamp: { companyId?: string | null; companyName?: string | null } = {},
    tx: Prisma.TransactionClient,
    dto: { title: string; procurementMethod: string; budget: number | null; authorId: string | null },
  ): Promise<{ id: string; projectCode: string }> {
    // requester：公告作者解析，兜底「采购中心」
    let requesterName = '采购中心';
    let requesterDepartment = '采购中心';
    if (dto.authorId) {
      const author = await tx.user.findUnique({
        where: { id: dto.authorId },
        select: { displayName: true, department: { select: { name: true } } },
      });
      if (author?.displayName) requesterName = author.displayName;
      if (author?.department?.name) requesterDepartment = author.department.name;
    }

    // 编号：与 create 流程同规则（勿另造格式）
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const todayCount = await tx.projectManagementItem.count({
      where: { createdAt: { gte: startOfDay, lte: endOfDay } },
    });
    const projectCode = `${procurementMethodPrefix(dto.procurementMethod)}-${ymd}${String(todayCount + 1).padStart(2, '0')}`;
      const gbProjectCode = await this.gbCode.allocateProjectCode().catch(() => null); // A1（B.4.3.2）

    // 阶段集：全套 + 方法过滤（与 create 流程同口径）
    const needsPublicAnnouncement = ['竞价采购', '直接采购', '邀请招标'].includes(dto.procurementMethod);
    const stagesToCreate = PROJECT_WORKFLOW_STAGES.filter(
      (s) => needsPublicAnnouncement || s.key !== 'PUBLIC_ANNOUNCEMENT',
    );
    // 公告直建=前置链路（需求/立项/采购文件/公告公示/供应商邀请）以公告为准补记 COMPLETED
    const completedKeys = new Set(['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'SUPPLIER_INVITATION']);

    const item = await tx.projectManagementItem.create({
      data: {
        projectCode,
        ...(gbProjectCode ? { gbProjectCode } : {}),
        title: dto.title,
        requesterName,
        requesterDepartment,
        procurementMethod: dto.procurementMethod,
        procurementCategory: '其他',
        procurementOrganizationForm: '—',
        budgetAmount: dto.budget ?? 0,
        isAnnualBudget: false,
        projectReason: '（公告直建自动补齐 PMI——N16 A 方案）',
        supplierRequirements: '（以公告公示要求为准）',
        initiationDate: now,
        currentStage: 'BID_EVALUATION',
        status: PROJECT_MANAGEMENT_STATUS.ACTIVE,
        createdById: dto.authorId,
        companyId: companyStamp.companyId ?? null,
        companyName: companyStamp.companyName ?? null,
        hasProcurementDemand: false,
      },
    });
    await tx.projectManagementStage.createMany({
      data: stagesToCreate.map((stage, index) => ({
        projectManagementItemId: item.id,
        stageKey: stage.key,
        stageName: stage.label,
        stageOrder: index + 1,
        round: 1,
        status: completedKeys.has(stage.key) ? PROJECT_STAGE_STATUS.COMPLETED : PROJECT_STAGE_STATUS.NOT_STARTED,
        completedAt: completedKeys.has(stage.key) ? now : null,
      })),
    });
    this.logger.log(`公告直建补 PMI: ${projectCode}（${stagesToCreate.length} 阶段，currentStage→BID_EVALUATION）`);
    return { id: item.id, projectCode };
  }

  async ensureBidProject(itemId: string, round?: number) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        title: true,
        procurementMethod: true,
        budgetAmount: true,
        bidOpeningTime: true,
        documentAcquireTime: true,
        initiationDate: true,
        projectOverview: true,
        currentRound: true,
        // 公司归属写时快照（BidCompanyScopeGuard 据此放行 :3005 开标确认面板）
        companyId: true,
        companyName: true,
      },
    });
    if (!item) {
      throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    }

    const targetRound = round ?? item.currentRound ?? 1;

    // 关联的招标公告发布时间（投递时间范围起点）：按项目标题匹配 BID_NOTICE
    const announcement = await this.prisma.announcement.findFirst({
      where: { title: item.title, type: 'BID_NOTICE' },
      orderBy: { publishDate: 'desc' },
      select: { publishDate: true },
    });
    const publishTimeIso = announcement?.publishDate
      ? announcement.publishDate.toISOString()
      : null;

    // 多轮：按 (projectManagementItemId, round) 查当前轮的 BidProject
    const existing = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: itemId, round: targetRound },
      select: {
        id: true,
        projectCode: true,
        name: true,
        stage: true,
        procurementMethod: true,
        openTime: true,
        deadline: true,
      },
    });
    if (existing) {
      // 2026-07 重构：棘轮状态机 + 投递放宽后，DOWNLOAD 阶段即可投递（以公告发布为权威闸门），
      // 不再自动裸推 DOWNLOAD→SUBMIT；阶段推进统一由 :3005 人工确认驱动，返回真实 stage
      return {
        ...existing,
        round: targetRound,
        openTime: existing.openTime.toISOString(),
        deadline: existing.deadline.toISOString(),
        publishTime: publishTimeIso,
      };
    }

    // 开标时间：取项目基本信息 bidOpeningTime（兼容中文日期），fallback initiationDate → 72h 后
    // P0-5：fallback 不再取 now（旧行为 deadline=now-12h，项目一创建即 DEADLINE_PASSED，供应商无法投递）
    const parsedOpen = parseBidOpeningTime(item.bidOpeningTime);
    const openTime = parsedOpen ?? (item.initiationDate ?? new Date(Date.now() + 72 * 60 * 60 * 1000));
    // 投递截止 = 开标前 BID_DEADLINE_BEFORE_OPENING_MS（24h 业务规则，第五写点，口径同 P0-2）；
    // P0-5 兜底【仅当 openTime 来自纯兜底（now+72h）时顺延至 24h 后】：真实解析出的历史开标
    // 时间（如老项目时间轴 3/26）若也顺延，会出现"开标 3/26 / 截止 9/1"倒挂——历史项目
    // 忠实过期（deadline=开标-24h，供应商端显示已截止、不可投），不再人为续命。
    let deadline = new Date(openTime.getTime() - BID_DEADLINE_BEFORE_OPENING_MS);
    const openTimeIsPureFallback = parsedOpen == null && item.initiationDate == null;
    if (openTimeIsPureFallback && deadline.getTime() <= Date.now()) {
      deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    // 采购文件下载截止：documentAcquireTime（"起至止"区间）取截止侧（如 2026/3/26 15:00）
    let downloadDeadline: Date | null = null;
    if (item.documentAcquireTime) {
      const seg = String(item.documentAcquireTime).split('至');
      const endRaw = seg[seg.length - 1]?.trim() || '';
      downloadDeadline = parseFlexibleDate(endRaw);
    }

    const created = await this.prisma.bidProject.create({
      data: {
        name: item.title,
        projectCode: await generateProjectCode(this.prisma, item.procurementMethod || '公开招标'),
        procurementMethod: item.procurementMethod || '公开招标',
        openTime,
        deadline,
        // 采购文件下载截止（documentAcquireTime 止点；谈判配置确认后由 sendNegotiationConfig 覆盖）
        downloadDeadline: downloadDeadline ?? undefined,
        budget: item.budgetAmount != null ? Number(item.budgetAmount) : null,
        scope: item.projectOverview || null,
        // 公告已发布，直接进入投标投递期
        stage: 'SUBMIT',
        projectManagementItemId: itemId,
        round: targetRound,
        // 公司归属快照自 PMI（漏盖曾致存量项目 companyId 空 → 非_admin 开标确认 403 COMPANY_SCOPE_FORBIDDEN）
        companyId: item.companyId ?? null,
        companyName: item.companyName ?? null,
        // P2: 按采购方式自动设置评标办法 + 价格公式默认值
        ...this.buildEvaluationDefaults(item.procurementMethod || '公开招标'),
      },
    });
    this.logger.log(
      `为项目管理项 ${itemId} 第 ${targetRound} 轮创建开评标项目 ${created.projectCode}`,
    );
    // P0-2 收尾：回填已接受邀请回执的供应商进候选池（rsvp 常早于 BidProject 懒创建——
    // respond() 在无 BidProject 时只记录回执；此处补挂，保证门户「可投标项目」受邀分支可见）
    try {
      const accepted = await this.prisma.invitationRsvp.findMany({
        where: { projectId: itemId, status: 'ACCEPTED' },
        select: { supplierId: true, supplierName: true },
      });
      for (const r of accepted) {
        if (!r.supplierId) continue;
        await this.prisma.bidSupplier.upsert({
          where: { projectId_supplierName: { projectId: created.id, supplierName: r.supplierName } },
          create: { projectId: created.id, supplierId: r.supplierId, supplierName: r.supplierName },
          update: { supplierId: r.supplierId },
        });
      }
      if (accepted.length > 0) this.logger.log(`  回填 ${accepted.length} 家已接受回执供应商进候选池`);
    } catch (e) {
      this.logger.warn(`候选回填失败（不阻塞）: ${(e as Error).message}`);
    }
    return {
      id: created.id,
      projectCode: created.projectCode,
      name: created.name,
      stage: created.stage,
      procurementMethod: created.procurementMethod,
      round: targetRound,
      openTime: created.openTime.toISOString(),
      deadline: created.deadline.toISOString(),
      publishTime: publishTimeIso,
    };
  }

  /**
   * 流标后再次采购：在当前 AWARD_DECISION 后、CONTRACT 前插入新一轮
   * "采购文件→定标"阶段（按 procurementMethod），round 递增。允许多次循环。
   */
  async reproc(itemId: string) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: { id: true, procurementMethod: true, stages: { orderBy: { stageOrder: 'asc' } } },
    });
    if (!item) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });

    const segment = REPROC_STAGE_SEGMENTS[item.procurementMethod];
    if (!segment || segment.length === 0) {
      throw new BadRequestException({ error: '当前采购方式不支持再次采购', code: 'UNSUPPORTED' });
    }

    const maxRound = item.stages.reduce((m, s) => Math.max(m, s.round ?? 1), 1);

    // 幂等：最新一轮（maxRound > 1）首个重采阶段仍 NOT_STARTED → 上次 reproc 尚未推进，拒绝重复开轮
    // （防双击 / 多入口重复触发，避免插入 round+2、round+3… 脏数据）
    if (maxRound > 1) {
      const latestRoundFirst = item.stages.find(
        (s) => s.round === maxRound && s.stageKey === segment[0].key,
      );
      if (latestRoundFirst?.status === 'NOT_STARTED') {
        throw new BadRequestException({
          error: '已有新一轮采购等待开始，无需重复发起',
          code: 'REPROC_ALREADY_PENDING',
        });
      }
    }

    const newRound = maxRound + 1;

    // 新一轮插在 CONTRACT 前；CONTRACT 及之后阶段 stageOrder 后移
    const contract = item.stages.find((s) => s.stageKey === 'CONTRACT');
    const insertAt = contract
      ? contract.stageOrder
      : item.stages.reduce((m, s) => Math.max(m, s.stageOrder), 0) + 1;
    const shift = segment.length;

    await this.prisma.$transaction(async (tx) => {
      // #2 旧轮定标清理：流标后标记当前轮开标评标/定标为已流标终态，避免时间线残留"未开始"阶段
      await tx.projectManagementStage.updateMany({
        where: {
          projectManagementItemId: itemId,
          round: maxRound,
          stageKey: { in: ['BID_EVALUATION', 'AWARD_DECISION'] },
        },
        data: { status: 'COMPLETED', note: '已流标（重新采购）' },
      });
      await tx.projectManagementStage.updateMany({
        where: { projectManagementItemId: itemId, stageOrder: { gte: insertAt } },
        data: { stageOrder: { increment: shift } },
      });
      await tx.projectManagementStage.createMany({
        data: segment.map((s, i) => ({
          projectManagementItemId: itemId,
          stageKey: s.key,
          stageName: s.label,
          stageOrder: insertAt + i,
          round: newRound,
          status: 'NOT_STARTED',
        })),
      });
    });

    // 当前阶段指向新一轮首个阶段（如 TENDER_DOCUMENT / PUBLIC_ANNOUNCEMENT），currentRound 递增
    await this.prisma.projectManagementItem.update({
      where: { id: itemId },
      data: { currentStage: segment[0].key, currentRound: newRound },
    });

    this.logger.log(`项目 ${itemId} 再次采购：插入第 ${newRound} 轮（${segment.length} 个阶段），currentStage → ${segment[0].key}`);
    return { round: newRound, inserted: segment.length };
  }

  /**
   * 从已上传的采购文件重新提取 projectOverview / bidOpeningTime / documentAcquireTime。
   * 用于上传时解析失败、用户手动触发重新提取的场景。
   */
  async extractTenderFields(itemId: string, field?: string) {
    // 提前获取采购方式，用于适配不同采购方式的提取逻辑
    const itemMeta = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: { procurementMethod: true },
    });
    const procurementMethod = itemMeta?.procurementMethod ?? undefined;

    const cachePath = getTenderTextCachePath(itemId);
    let text: string;
    try {
      text = await readFile(cachePath, 'utf8');
      if (!text || text.length < 50) throw new Error('empty cache');
    } catch {
      const stage = await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: itemId, stageKey: 'TENDER_DOCUMENT' },
        include: { attachments: true },
      });
      if (!stage) throw new NotFoundException({ error: '未找到采购文件阶段', code: 'NOT_FOUND' });

      const tenderFile = stage.attachments.find(
        (a) => /采购文件|招标文件/.test(a.fileName) && !/审批表|公告|合同|通知书|需求|立项/.test(a.fileName),
      );
      if (!tenderFile) throw new BadRequestException({ error: '未找到采购文件，请先上传', code: 'NO_TENDER_FILE' });

      try {
        const buffer = await this.storage.download(tenderFile.objectKey);
        text = await this.documentParser.parse(buffer, tenderFile.mimeType, tenderFile.fileName);
        try { await writeFile(cachePath, text, 'utf8'); } catch {}
      } catch (e) {
        this.logger.warn(`[extractTenderFields] 文件读取失败，回退 DB: ${(e as Error)?.message}`);
        const item = await this.prisma.projectManagementItem.findUnique({
          where: { id: itemId },
          select: { projectOverview: true, bidOpeningTime: true, documentAcquireTime: true },
        });
        const fallback: Record<string, string | null> = {
          projectOverview: item?.projectOverview ?? null,
          bidOpeningTime: item?.bidOpeningTime ?? null,
          documentAcquireTime: item?.documentAcquireTime ?? null,
        };
        return field ? { [field]: fallback[field] ?? null } : fallback;
      }
    }
    this.logger.log(`[extractTenderFields] ${text.length} chars, field=${field ?? 'all'}`);

    // 只提取指定字段（或全部）
    const wants = (f: string) => !field || field === f;
    const updateData: Record<string, string> = {};
    const result: Record<string, string | null> = {};

    if (wants('projectOverview')) {
      let raw = extractProjectOverviewFromText(text, procurementMethod);
      if (!raw) raw = await this.aiExtractProjectOverview(text, procurementMethod);
      const val = raw ? await this.aiMinimalPolish(raw) : null;
      if (val) updateData.projectOverview = val;
      result.projectOverview = val;
    }
    if (wants('bidOpeningTime')) {
      const raw = this.extractBidOpeningTimeFromText(text, procurementMethod);
      const val = raw ? await this.aiNormalizeBidOpeningTime(raw) : null;
      if (val) updateData.bidOpeningTime = val;
      result.bidOpeningTime = val;
    }
    if (wants('documentAcquireTime')) {
      let raw = this.extractDocumentAcquireTimeFromText(text);
      if (!raw) raw = await this.aiExtractDocumentAcquireTime(text);
      const val = raw ? await this.aiNormalizeDocumentAcquireTime(raw) : null;
      if (val) updateData.documentAcquireTime = val;
      result.documentAcquireTime = val;
    }

    // 直接采购：额外提取拟定供应商名称（从采购文件中）
    if (procurementMethod === '直接采购') {
      const existing = await this.prisma.projectManagementItem.findUnique({
        where: { id: itemId }, select: { awardedSupplier: true },
      });
      if (!existing?.awardedSupplier?.trim()) {
        const supplierName = extractAwardedSupplierFromText(text);
        if (supplierName) {
          updateData.awardedSupplier = supplierName;
          result.awardedSupplier = supplierName;
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.projectManagementItem.update({ where: { id: itemId }, data: updateData });
    }
    return field ? { [field]: result[field] ?? null } : result;
  }

  /** 直接采购供应商抽选：读取立项/需求/采购文件内容，AI 推荐 3-5 家供应商 */
  async recommendSuppliersForProject(itemId: string) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: {
        title: true, procurementMethod: true, procurementCategory: true,
        requesterDepartment: true, budgetAmount: true,
        projectReason: true, supplierRequirements: true, projectOverview: true,
      },
    });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });

    // 收集各阶段文档文本（立项、需求、采购文件）
    const contextParts: string[] = [];
    contextParts.push(`项目名称：${project.title || ''}`);
    contextParts.push(`采购方式：${project.procurementMethod || ''}`);
    contextParts.push(`采购类别：${project.procurementCategory || ''}`);
    contextParts.push(`需求部门：${project.requesterDepartment || ''}`);
    if (project.budgetAmount != null) contextParts.push(`预算金额：${Number(project.budgetAmount).toLocaleString('zh-CN')}`);
    if (project.projectReason) contextParts.push(`立项事由：${project.projectReason}`);
    if (project.supplierRequirements) contextParts.push(`供方要求：${project.supplierRequirements}`);
    if (project.projectOverview) contextParts.push(`项目概况/采购内容：${project.projectOverview}`);

    // 读取各阶段附件文本
    const stages = await this.prisma.projectManagementStage.findMany({
      where: { projectManagementItemId: itemId, stageKey: { in: ['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT'] } },
      include: { attachments: true },
    });
    for (const stage of stages) {
      for (const att of stage.attachments.slice(0, 3)) {
        try {
          const buffer = await this.storage.download(att.objectKey);
          const text = await this.documentParser.parse(buffer, att.mimeType, att.fileName);
          if (text && text.length > 20) {
            contextParts.push(`【${stage.stageKey} - ${att.fileName}】${text.slice(0, 4000)}`);
          }
        } catch { /* 单个文件读取失败不阻塞 */ }
      }
    }

    const context = contextParts.join('\n\n');

    // 调用 AI 推荐
    const systemPrompt = `你是采购供应商智能推荐助手。根据项目的采购需求、立项事由、供方要求、采购内容、采购文件等信息，从供应商库中推荐3-5家最合适的供应商。
请输出一个 JSON 对象，结构固定为：
{
  "suppliers": [
    {"name": "供应商名称", "reason": "推荐理由（50字以内）", "matchScore": 85}
  ]
}
要求：
1. 供应商名称必须真实可查，不要编造虚构的公司名
2. 推荐理由基于项目的实际采购内容和要求
3. matchScore 为 0-100 的匹配度评分
4. 只输出 JSON，不要任何解释`;

    try {
      const result = await this.aiService.chatJson<{
        suppliers: Array<{ name: string; reason: string; matchScore: number }>;
      }>(systemPrompt, context.slice(0, 8000), 0.3);
      return {
        suppliers: (result.suppliers || []).slice(0, 5),
        contextSummary: context.slice(0, 500),
      };
    } catch {
      // AI 不可用时返回空列表
      return { suppliers: [], contextSummary: context.slice(0, 500) };
    }
  }

  async createFromInitiation(
    dto: CreateProjectFromInitiationDto,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ) {
    await this.prisma.department.upsert({
      where: { name: dto.requesterDepartment },
      update: {},
      create: { name: dto.requesterDepartment },
    });

    // Determine stages based on procurement method, then adjust for uploaded documents
    const isSmallPurchase = dto.procurementMethod === '小额采购';
    const hasDemand = !!(dto.hasProcurementDemand && dto.demandAttachment);
    const hasInitiation = !!dto.initiationAttachment;

    type StageKey = typeof PROJECT_WORKFLOW_STAGES[number]['key'];

    // For small purchases, the first stage depends on which document was uploaded:
    // - Only demand → 采购需求
    // - Only initiation → 项目立项
    // - Both → 采购需求 + 项目立项
    const SMALL_PURCHASE_DEMAND_STAGE = { key: 'PROCUREMENT_DEMAND' as StageKey, label: '采购需求' };
    const SMALL_PURCHASE_INITIATION_STAGE = { key: 'INITIATION' as StageKey, label: '项目立项' };
    const CONTRACT_STAGE = { key: 'CONTRACT' as StageKey, label: '合同' };

    // Build stages list
    let stagesToCreate: Array<{ readonly key: StageKey; readonly label: string }>;
    if (isSmallPurchase) {
      const firstStages: Array<{ readonly key: StageKey; readonly label: string }> = [];
      if (hasDemand) firstStages.push(SMALL_PURCHASE_DEMAND_STAGE);
      if (hasInitiation) firstStages.push(SMALL_PURCHASE_INITIATION_STAGE);
      if (firstStages.length === 0) firstStages.push(SMALL_PURCHASE_DEMAND_STAGE);
      stagesToCreate = [...firstStages, CONTRACT_STAGE];
    } else {
      stagesToCreate = [...PROJECT_WORKFLOW_STAGES];
      // Only initiation form → remove PROCUREMENT_DEMAND from stages
      if (!hasDemand && hasInitiation) {
        stagesToCreate = stagesToCreate.filter((s) => s.key !== 'PROCUREMENT_DEMAND');
      }
      // Only keep PUBLIC_ANNOUNCEMENT for methods that require it
      const needsPublicAnnouncement = ['竞价采购', '直接采购', '邀请招标'].includes(
        dto.procurementMethod,
      );
      if (!needsPublicAnnouncement) {
        stagesToCreate = stagesToCreate.filter((s) => s.key !== 'PUBLIC_ANNOUNCEMENT');
      }
    }

    // Determine the first active stage based on which documents were uploaded
    let firstActiveStage: StageKey;
    if (hasDemand && !hasInitiation) {
      // Only demand form → land on INITIATION (or CONTRACT for small purchases)
      firstActiveStage = isSmallPurchase ? 'CONTRACT' : 'INITIATION';
    } else {
      // Only initiation form or both forms → land on TENDER_DOCUMENT (or CONTRACT for small purchases)
      firstActiveStage = isSmallPurchase ? 'CONTRACT' : 'TENDER_DOCUMENT';
    }

    const createdProject = await this.prisma.$transaction(async (tx) => {
      // 自动生成项目编号：采购方式前两字拼音首字母 + 当日 YYYYMMDD + 当日全局顺序号
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const todayCount = await tx.projectManagementItem.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      });
      const projectCode = `${procurementMethodPrefix(dto.procurementMethod)}-${ymd}${String(todayCount + 1).padStart(2, '0')}`;
      const gbProjectCode = await this.gbCode.allocateProjectCode().catch(() => null); // A1（B.4.3.2）

      const project = await tx.projectManagementItem.create({
        data: {
          projectCode,
          ...(gbProjectCode ? { gbProjectCode } : {}),
          title: dto.procurementTitle,
          requesterName: dto.requesterName,
          requesterDepartment: dto.requesterDepartment,
          procurementMethod: dto.procurementMethod,
          procurementCategory: dto.procurementCategory,
          procurementOrganizationForm: dto.procurementOrganizationForm,
          budgetAmount: dto.budgetAmount,
          isAnnualBudget: dto.isAnnualBudget,
          projectReason: dto.projectReason,
          supplierRequirements: dto.supplierRequirements,
          // B1：采购方案要素（7.2.1.2）
          implementerName: dto.implementerName ?? null,
          contractPricingType: dto.contractPricingType ?? null,
          sectionPlan: dto.sectionPlan ?? null,
          activitySchedule: dto.activitySchedule ?? null,
          riskMeasures: dto.riskMeasures ?? null,
          initiationDate: dto.initiationDate ? new Date(dto.initiationDate) : null,
          currentStage: firstActiveStage,
          status: PROJECT_MANAGEMENT_STATUS.ACTIVE,
          createdById: dto.createdById,
          companyId: companyStamp.companyId ?? null,
          companyName: companyStamp.companyName ?? null,
          hasProcurementDemand: dto.hasProcurementDemand,
          demandRequesterName: dto.demandFields?.requesterName ?? null,
          demandDepartment: dto.demandFields?.requesterDepartment ?? null,
          demandProcurementTitle: dto.demandFields?.procurementTitle ?? null,
          demandProjectReason: dto.demandFields?.projectReason ?? null,
          demandSupplierReqs: dto.demandFields?.supplierRequirements ?? null,
          demandBudgetAmount: dto.demandFields?.budgetAmount ?? null,
          demandProcurementCategory: dto.demandFields?.procurementCategory ?? null,
          demandProcurementMethod: dto.demandFields?.procurementMethod ?? null,
          demandProject: dto.demandFields?.demandProject ?? null,
          demandContractNumber: dto.demandFields?.demandContractNumber ?? null,
        },
      });

      // Create stages with status determined by uploaded documents
      await tx.projectManagementStage.createMany({
        data: stagesToCreate.map((stage, index) => {
          let status: ProjectStageStatusValue = PROJECT_STAGE_STATUS.NOT_STARTED;

          if (hasDemand && !hasInitiation) {
            // Only demand form
            if (stage.key === 'PROCUREMENT_DEMAND') {
              status = PROJECT_STAGE_STATUS.COMPLETED;
            } else if (stage.key === 'INITIATION' && !isSmallPurchase) {
              status = PROJECT_STAGE_STATUS.IN_PROGRESS;
            }
          } else if (!hasDemand && hasInitiation) {
            // Only initiation form
            if (stage.key === 'INITIATION') {
              status = PROJECT_STAGE_STATUS.COMPLETED;
            }
          } else if (hasDemand && hasInitiation) {
            // Both forms
            if (stage.key === 'PROCUREMENT_DEMAND' || stage.key === 'INITIATION') {
              status = PROJECT_STAGE_STATUS.COMPLETED;
            }
          }

          // Mark the first active stage as IN_PROGRESS
          if (stage.key === firstActiveStage && status === PROJECT_STAGE_STATUS.NOT_STARTED) {
            status = PROJECT_STAGE_STATUS.IN_PROGRESS;
          }

          if (LOCKED_STAGES.has(stage.key)) {
            status = PROJECT_STAGE_STATUS.COMPLETED;
          }

          return {
            projectManagementItemId: project.id,
            stageKey: stage.key,
            stageName: stage.label,
            stageOrder: index + 1,
            status,
          };
        }),
      });

      // Set completion time for PROCUREMENT_DEMAND if completed (demand form uploaded)
      if (hasDemand) {
        const demandStage = await tx.projectManagementStage.findFirst({
          where: { projectManagementItemId: project.id, stageKey: 'PROCUREMENT_DEMAND' },
        });
        if (demandStage) {
          await tx.projectManagementStage.update({
            where: { id: demandStage.id },
            data: { completedAt: new Date() },
          });

          // Save demand attachment
          await tx.attachment.create({
            data: {
              projectManagementItemId: project.id,
              projectManagementStageId: demandStage.id,
              attachmentType: 'SUPPORTING_MATERIAL',
              fileName: dto.demandAttachment!.fileName,
              objectKey: dto.demandAttachment!.objectKey,
              mimeType: dto.demandAttachment!.mimeType,
              fileSize: dto.demandAttachment!.fileSize,
              uploadedById: dto.demandAttachment!.uploadedById,
            },
          });
        }
      }

      // Set completion time for INITIATION if completed (initiation form uploaded)
      if (hasInitiation) {
        const initiationStage = await tx.projectManagementStage.findFirst({
          where: { projectManagementItemId: project.id, stageKey: 'INITIATION' },
        });
        if (initiationStage) {
          await tx.projectManagementStage.update({
            where: { id: initiationStage.id },
            data: { completedAt: new Date() },
          });

          // Save initiation attachment
          await tx.attachment.create({
            data: {
              projectManagementItemId: project.id,
              projectManagementStageId: initiationStage.id,
              attachmentType: 'SUPPORTING_MATERIAL',
              fileName: dto.initiationAttachment!.fileName,
              objectKey: dto.initiationAttachment!.objectKey,
              mimeType: dto.initiationAttachment!.mimeType,
              fileSize: dto.initiationAttachment!.fileSize,
              uploadedById: dto.initiationAttachment!.uploadedById,
            },
          });
        }
      }

      return project;
    });

    // Trigger analysis for the initiation stage (fire-and-forget) — must NOT be
    // awaited: refreshProjectAnalysis can take minutes (PDF parse + LLM), and
    // blocking here makes the create endpoint appear to hang, which tempts the
    // user to resubmit. The resubmit reuses the same demand/initiation
    // objectKey and trips the Attachment unique constraint → 500 → confusing
    // "登录失败" dialog even though the first transaction committed.
    void this.refreshProjectAnalysis(createdProject.id).catch(() => {
      this.logger.warn(
        `Project ${createdProject.id} created but analysis failed; it will be retried later.`,
      );
    });

    return createdProject;
  }

  async extractInitiationFromUploadedFile(
    file: Express.Multer.File,
    uploadedById?: string,
  ) {
    if (!file.mimetype.includes('pdf')) {
      throw new BadRequestException('请上传 PDF 文件。');
    }

    const { absolutePath, attachment } = await this.persistUploadedFile(
      file,
      'initiation',
      uploadedById,
    );

    const extractedText = await this.extractFileText(
      absolutePath,
      file.mimetype,
      file.originalname,
    );

    return {
      fields: await this.extractInitiationFieldsFromText(extractedText),
      attachment,
      extractedText,
    };
  }

  async extractInitiationFieldsFromPdf(filePath: string) {
    const text = await this.extractFileText(filePath, 'application/pdf', 'initiation.pdf');
    return this.extractInitiationFieldsFromText(text);
  }

  async addStageAttachment(
    projectId: string,
    stageKey: string,
    file: Express.Multer.File,
    uploadedById?: string,
  ) {
    const stage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: projectId, stageKey },
      include: { attachments: true },
    });

    if (!stage) {
      throw new NotFoundException('未找到对应的项目阶段。');
    }

    // 同名文件覆盖：先删除旧版本再上传新版本（采购文件只需保留最新一份）
    const decodedNewFileName = normalizeUploadedFileName(file.originalname);
    const duplicate = stage.attachments.find(
      (a) => a.fileName === decodedNewFileName,
    );
    if (duplicate) {
      await this.deleteAttachment(projectId, duplicate.id);
    }

    const { attachment, absolutePath } = await this.persistUploadedFile(
      file,
      `${projectId}-${stageKey.toLowerCase()}`,
      uploadedById,
    );

    // Decode filename (Multer sends latin1-encoded UTF-8)
    const decodedFileName = normalizeUploadedFileName(file.originalname).toLowerCase();

    // For AWARD_DECISION and BID_EVALUATION stages, extract info from the document
    if (stageKey === 'AWARD_DECISION' || stageKey === 'BID_EVALUATION') {
      try {
        const text = await this.extractFileText(absolutePath, file.mimetype, file.originalname);
        const fileName = decodedFileName;

        // Extract bidding units from 定标审批表 or 评标/开标相关文件
        if (stageKey === 'AWARD_DECISION' || fileName.includes('评标') || fileName.includes('开标')) {
          const biddingUnits = extractBiddingUnitsFromText(text);
          this.logger.log(`[Extraction] biddingUnits: ${biddingUnits || '(empty)'}`);
          if (biddingUnits) {
            await this.prisma.projectManagementItem.update({
              where: { id: projectId },
              data: { biddingUnits },
            });
          }
        }

        // Extract awarded supplier from 定标审批表 (AWARD_DECISION only)
        if (stageKey === 'AWARD_DECISION' && (fileName.includes('定标') || fileName.includes('审批表'))) {
          const awardedSupplier = extractAwardedSupplierFromAwardTable(text);
          if (awardedSupplier) {
            await this.prisma.projectManagementItem.update({
              where: { id: projectId },
              data: { awardedSupplier },
            });
          }
        }

        // Extract awarded supplier from 中标通知书 (takes precedence)
        if (fileName.includes('中标') || fileName.includes('通知书')) {
          const awardedSupplier = extractAwardedSupplierFromText(text);
          if (awardedSupplier) {
            await this.prisma.projectManagementItem.update({
              where: { id: projectId },
              data: { awardedSupplier },
            });
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to extract info from award decision document: ${err}`);
        // Don't throw - attachment upload should succeed even if extraction fails
      }
    }

    // For EXPERT_SELECTION stage, extract expert info from 抽取结果单
    if (stageKey === 'EXPERT_SELECTION') {
      try {
        const text = await this.extractFileText(absolutePath, file.mimetype, file.originalname);
        const fileName = decodedFileName;

        // Extract expert info from 抽取结果单
        if (fileName.includes('抽取结果单') || fileName.includes('抽取结果')) {
          const expertInfo = extractExpertInfoFromText(text);
          this.logger.log(`[Extraction] expertInfo: ${expertInfo || '(empty)'}`);
          if (expertInfo) {
            await this.prisma.projectManagementItem.update({
              where: { id: projectId },
              data: { expertInfo },
            });
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to extract expert info from document: ${err}`);
      }
    }

    // For TENDER_DOCUMENT stage, extract project overview and bid opening time
    if (stageKey === 'TENDER_DOCUMENT') {
      // 上传即同步「采购文件获取时间」（2026-08-27 拍板）：文件可获取的时刻先落账，
      // 时间轴（A-204）立即可见不再"未登记"；随后 AI 从文件提取到更精确的获取时段会覆盖此值
      try {
        const cur = await this.prisma.projectManagementItem.findUnique({
          where: { id: projectId },
          select: { documentAcquireTime: true },
        });
        if (!cur?.documentAcquireTime?.trim()) {
          const now = new Date();
          const zh = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          await this.prisma.projectManagementItem.update({
            where: { id: projectId },
            data: { documentAcquireTime: zh },
          });
        }
      } catch {
        /* 同步失败不阻断上传 */
      }
      // 仅从"采购文件/招标文件"提取，审批表/公告/合同等附件不提取（避免覆盖已有信息）
      const tdFileName = decodedFileName;
      const isTenderDocFile = /采购文件|招标文件/.test(tdFileName) && !/审批表|公告|合同|通知书|需求|立项/.test(tdFileName);
      if (isTenderDocFile) {
      try {
        const text = await this.extractFileText(absolutePath, file.mimetype, file.originalname);
        this.logger.log(`[TENDER_DOCUMENT] Extracted ${text.length} chars from ${file.originalname}`);

        // 获取采购方式以适配不同文档结构（如直接采购用"采购内容"和"递交和谈判时间"）
        const pm = await this.prisma.projectManagementItem.findUnique({
          where: { id: projectId },
          select: { procurementMethod: true },
        });
        const procurementMethod = pm?.procurementMethod ?? undefined;

        let rawOverview = extractProjectOverviewFromText(text, procurementMethod);
        if (!rawOverview) rawOverview = await this.aiExtractProjectOverview(text, procurementMethod);
        if (rawOverview) {
          const projectOverview = await this.aiMinimalPolish(rawOverview);
          await this.prisma.projectManagementItem.update({
            where: { id: projectId },
            data: { projectOverview },
          });
        }

        const rawBidTime = this.extractBidOpeningTimeFromText(text, procurementMethod);
        if (rawBidTime) {
          const bidOpeningTime = await this.aiNormalizeBidOpeningTime(rawBidTime);
          await this.prisma.projectManagementItem.update({
            where: { id: projectId },
            data: { bidOpeningTime },
          });
          // 开标时间提取成功 → 对齐同轮 BidProject（24h 业务规则，口径同 P0-2）。
          // 懒创建常早于本次提取（创建时 bidOpeningTime 尚未提取 → openTime 落在
          // fallback=立项日、deadline 落在兜底 now+24h），时间轴因此出现
          // "开标=立项日、投标截止=无关兜底值"的错乱；未开标前按下式回填修正：
          // openTime=提取值，deadline=openTime−24h
          try {
            const parsed = parseBidOpeningTime(bidOpeningTime);
            if (parsed) {
              const bp = await this.prisma.bidProject.findFirst({
                where: { projectManagementItemId: projectId },
                orderBy: { round: 'desc' },
                select: { id: true, stage: true, openTime: true },
              });
              const preOpening = bp && (bp.stage === 'DOWNLOAD' || bp.stage === 'SUBMIT');
              if (bp && preOpening && bp.openTime.getTime() !== parsed.getTime()) {
                await this.prisma.bidProject.update({
                  where: { id: bp.id },
                  data: {
                    openTime: parsed,
                    deadline: new Date(parsed.getTime() - BID_DEADLINE_BEFORE_OPENING_MS),
                  },
                });
                this.logger.log(
                  `采购文件提取开标时间 ${bidOpeningTime} → 已回填 BidProject ${bp.id}（deadline=openTime−24h）`,
                );
              }
            }
          } catch (e) {
            this.logger.warn(`开标时间回填 BidProject 失败（不阻断上传）: ${(e as Error).message}`);
          }
        }

        // 直接采购：从采购文件提取拟定供应商名称（后续供应商邀请步骤自动跳过选取）
        if (procurementMethod === '直接采购') {
          const existingProject = await this.prisma.projectManagementItem.findUnique({
            where: { id: projectId },
            select: { awardedSupplier: true },
          });
          if (!existingProject?.awardedSupplier?.trim()) {
            const supplierName = extractAwardedSupplierFromText(text);
            if (supplierName) {
              await this.prisma.projectManagementItem.update({
                where: { id: projectId },
                data: { awardedSupplier: supplierName },
              });
            }
          }
        }

        // 采购文件获取时间：正则优先，失败时用 AI 从文本提取
        let rawAcquireTime = this.extractDocumentAcquireTimeFromText(text);
        if (!rawAcquireTime) {
          rawAcquireTime = await this.aiExtractDocumentAcquireTime(text);
        }
        if (rawAcquireTime) {
          const documentAcquireTime = await this.aiNormalizeDocumentAcquireTime(rawAcquireTime);
          await this.prisma.projectManagementItem.update({
            where: { id: projectId },
            data: { documentAcquireTime },
          });
        }

        // 缓存 mammoth 文本供 AI 提取按钮复用（绕过 MinIO）
        try {
          await mkdir('/tmp/project-management-cache', { recursive: true });
          await writeFile(join('/tmp/project-management-cache', `tender-text-${projectId}.txt`), text, 'utf8');
        } catch (e) {
          this.logger.warn(`[TENDER_DOCUMENT] 缓存文本失败: ${(e as Error)?.message}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to extract info from tender document: ${err}`);
      }
      } else {
        this.logger.log(`[TENDER_DOCUMENT] 跳过提取（非采购文件）: ${tdFileName}`);
      }
    }

    // For CONTRACT stage, extract contract amount and awarded supplier from the document
    if (stageKey === 'CONTRACT') {
      try {
        const text = await this.extractFileText(absolutePath, file.mimetype, file.originalname);
        const fileName = decodedFileName;
        this.logger.log(`[CONTRACT] Extracted ${text.length} chars from ${file.originalname}`);

        // Guard: read current project to avoid overwriting existing values
        const currentProject = await this.prisma.projectManagementItem.findUnique({
          where: { id: projectId },
          select: { contractAmount: true, awardedSupplier: true, contractNumber: true },
        });

        const contractAmount = currentProject?.contractAmount ? null : extractContractAmountFromText(text);
        const contractNumber = currentProject?.contractNumber ? null : extractContractNumberFromText(text);
        const awardedSupplier = fileName.includes('合同') || fileName.includes('购销')
          ? extractAwardedSupplierFromContract(text)
          : extractAwardedSupplierFromText(text);

        this.logger.log(
          `[CONTRACT] Extracted — contractNumber=${contractNumber ?? '(none)'}, ` +
          `contractAmount=${contractAmount ?? '(none)'}, ` +
          `awardedSupplier=${awardedSupplier || '(none)'}` +
          ` | currentProject had: contractNumber=${currentProject?.contractNumber || '(none)'}, ` +
          `contractAmount=${currentProject?.contractAmount || '(none)'}`,
        );

        const updateData: { contractAmount?: number; contractNumber?: string | null; awardedSupplier?: string } = {};
        if (contractAmount !== null) {
          updateData.contractAmount = contractAmount;
        }
        if (contractNumber !== null) {
          updateData.contractNumber = contractNumber;
        }
        if (awardedSupplier) {
          updateData.awardedSupplier = awardedSupplier;
        }

        if (Object.keys(updateData).length > 0) {
          await this.prisma.projectManagementItem.update({
            where: { id: projectId },
            data: updateData,
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to extract info from contract document: ${err}`);
        // Don't throw - attachment upload should succeed even if extraction fails
      }
    }

    const attachmentRecord = await this.prisma.attachment.create({
      data: {
        projectManagementItemId: projectId,
        projectManagementStageId: stage.id,
        attachmentType: 'SUPPORTING_MATERIAL',
        fileName: attachment.fileName,
        objectKey: attachment.objectKey,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        uploadedById: attachment.uploadedById,
      },
    });

    // DA/T 103-2024 §8.1 归档时点：定标/合同阶段上传件即流程终结信号 → 归档待办（fire-and-forget）
    if (stageKey === 'AWARD_DECISION' || stageKey === 'CONTRACT') {
      void this.archiveFlow.onTerminalAttachmentUploaded(projectId);
    }

    // Return updated extracted info so frontend can display immediately
    const updatedItem = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: {
        initiationDate: true,
        evaluationMethod: true,
        expertInfo: true,
        biddingUnits: true,
        awardedSupplier: true,
        contractAmount: true,
        contractNumber: true,
        projectOverview: true,
        bidOpeningTime: true,
        documentAcquireTime: true,
      },
    });

    return {
      ...attachmentRecord,
      extractedInfo: updatedItem
        ? {
            initiationDate: updatedItem.initiationDate?.toISOString().split('T')[0] ?? null,
            evaluationMethod: updatedItem.evaluationMethod,
            expertInfo: updatedItem.expertInfo,
            biddingUnits: updatedItem.biddingUnits,
            awardedSupplier: updatedItem.awardedSupplier,
            contractAmount: updatedItem.contractAmount ? Number(updatedItem.contractAmount) : null,
            contractNumber: updatedItem.contractNumber ?? null,
            projectOverview: updatedItem.projectOverview ?? null,
            bidOpeningTime: updatedItem.bidOpeningTime ?? null,
            documentAcquireTime: updatedItem.documentAcquireTime ?? null,
          }
        : null,
    };
  }

  async aiIdentifyField(dto: { fieldName: string; documentText: string; topK?: number }): Promise<Array<{ value: string; confidence: number; location?: string }>> {
    const { fieldName, documentText, topK = 3 } = dto;

    const systemPrompt = `你是一个专业的文档信息提取助手。请从用户提供的文档文本中识别指定字段的候选值。

【重要：文档结构认知】
文档可能是采购申请表/审批表/评审表等含审批流程的表格文件。这类文件通常分为两个区域：
- 表单正文区（前部）：包含申请事项名称、申请人、部门、预算、事由、要求等核心采购信息
- 审批流转区（后部）：包含审批人签字栏、审批意见、日期、签章等流程信息

提取字段值时，请遵循以下原则：
1. 优先在表单正文区查找目标字段值，不要将审批流转区的审批人姓名、审批意见误认为目标字段
2. 字段值可能以表格行形式出现（如"需求申请人 | 张三"），需正确解析行列对应关系
3. 如果文档是审批表，标题行或表头区域通常是字段值最集中的位置

请提取所有可能值，并按置信度从高到低排序。每个候选值需要提供：
1. value: 提取的值
2. confidence: 置信度 (0.0-1.0)
3. location: 在文档中的位置描述

返回 JSON 数组格式，最多${topK}个候选：
[{"value": "xxx", "confidence": 0.9, "location": "第X行"}]

如果没有找到相关值，返回空数组 []`;

    const userPrompt = `请从以下文档文本中识别"${fieldName}"字段的候选值：\n\n${documentText.slice(0, 4000)}`;

    try {
      // chatJson 内部设 response_format: json_object 强制 LLM 返回 JSON 对象，
      // 会导致返回值已被 parseJson 解析成 JS 对象，而非原始字符串。此处改用 chat()
      // 返回 raw string，再自行匹配 JSON 数组。
      const content = await this.aiService.chat(systemPrompt, userPrompt, 0.1);
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]).slice(0, topK);
      }
      return [];
    } catch (error) {
      this.logger.error('AI identify field failed:', error);
      return [];
    }
  }

  /**
   * Scan all uploaded files in a project and extract missing info.
   * Called when project detail opens to handle files uploaded before extraction code existed.
   */
  /**
   * 预算参考：置信分层估算（方法 C）。在单价层归一，按数据质量分 Tier 1–4，
   * 修复旧算法“按历史项目总价×业务相关度加权”在数量/质量/规模不一致时的失真。
   * 详见 docs/superpowers/specs/2026-07-21-budget-reference-tiered-pricing-design.md
   */
  async analyzeBudgetReference(dto: AnalyzeBudgetReferenceDto) {
    return estimateBudgetReference(this.prisma, {
      procurementTitle: dto.procurementTitle,
      procurementCategory: dto.procurementCategory ?? null,
      procurementType: dto.procurementType ?? null,
      projectReason: dto.projectReason ?? null,
      supplierRequirements: dto.supplierRequirements ?? null,
      lines: dto.lines,
      budgetListId: dto.budgetListId ?? null,
    });
  }

  async refreshExtractedInfo(projectId: string) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: {
        initiationDate: true,
        evaluationMethod: true,
        expertInfo: true,
        biddingUnits: true,
        awardedSupplier: true,
        contractAmount: true,
        contractNumber: true,
        demandContractNumber: true,
        stages: {
          orderBy: { stageOrder: 'asc' },
          include: { attachments: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    const updates: Record<string, unknown> = {};

    for (const stage of project.stages) {
      for (const attachment of stage.attachments) {
        const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
        const fileName = attachment.fileName.toLowerCase();

        try {
          // AWARD_DECISION stage
          if (stage.stageKey === 'AWARD_DECISION' && (fileName.includes('定标') || fileName.includes('审批表'))) {
            const text = await this.extractFileText(filePath, attachment.mimeType, attachment.fileName);
            if (!project.biddingUnits && !updates.biddingUnits) {
              const biddingUnits = extractBiddingUnitsFromText(text);
              if (biddingUnits) updates.biddingUnits = biddingUnits;
            }
            if (!project.awardedSupplier && !updates.awardedSupplier) {
              const awardedSupplier = extractAwardedSupplierFromAwardTable(text);
              if (awardedSupplier) updates.awardedSupplier = awardedSupplier;
            }
          }

          // BID_EVALUATION stage — also extract bidding units
          if (stage.stageKey === 'BID_EVALUATION' && !project.biddingUnits && !updates.biddingUnits) {
            const text = await this.extractFileText(filePath, attachment.mimeType, attachment.fileName);
            const biddingUnits = extractBiddingUnitsFromText(text);
            if (biddingUnits) updates.biddingUnits = biddingUnits;
          }

          if (stage.stageKey === 'AWARD_DECISION' && (fileName.includes('中标') || fileName.includes('通知书'))) {
            const text = await this.extractFileText(filePath, attachment.mimeType, attachment.fileName);
            if (!project.awardedSupplier && !updates.awardedSupplier) {
              const awardedSupplier = extractAwardedSupplierFromText(text);
              if (awardedSupplier) updates.awardedSupplier = awardedSupplier;
            }
          }

          // CONTRACT stage
          if (stage.stageKey === 'CONTRACT') {
            const text = await this.extractFileText(filePath, attachment.mimeType, attachment.fileName);
            if (!project.contractAmount && !updates.contractAmount) {
              const contractAmount = extractContractAmountFromText(text);
              if (contractAmount !== null) updates.contractAmount = contractAmount;
            }
            if (!project.contractNumber && !updates.contractNumber) {
              const contractNumber = extractContractNumberFromText(text);
              if (contractNumber !== null) updates.contractNumber = contractNumber;
            }
            if (!project.awardedSupplier && !updates.awardedSupplier) {
              const fileName = attachment.fileName;
              const awardedSupplier = fileName.includes('中标通知书') || fileName.includes('中标')
                ? extractAwardedSupplierFromText(text)
                : extractAwardedSupplierFromContract(text);
              if (awardedSupplier) updates.awardedSupplier = awardedSupplier;
            }
          }

          // EXPERT_SELECTION stage
          if (stage.stageKey === 'EXPERT_SELECTION' && (fileName.includes('抽取结果单') || fileName.includes('抽取结果'))) {
            const text = await this.extractFileText(filePath, attachment.mimeType, attachment.fileName);
            if (!project.expertInfo && !updates.expertInfo) {
              const expertInfo = extractExpertInfoFromText(text);
              if (expertInfo) updates.expertInfo = expertInfo;
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.projectManagementItem.update({
        where: { id: projectId },
        data: updates,
      });
    }

    // Return the latest extracted info
    const updated = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: {
        initiationDate: true,
        evaluationMethod: true,
        expertInfo: true,
        biddingUnits: true,
        awardedSupplier: true,
        contractAmount: true,
      },
    });

    return {
      initiationDate: updated?.initiationDate?.toISOString().split('T')[0] ?? null,
      evaluationMethod: updated?.evaluationMethod,
      expertInfo: updated?.expertInfo,
      biddingUnits: updated?.biddingUnits,
      awardedSupplier: updated?.awardedSupplier,
      contractAmount: updated?.contractAmount ? Number(updated.contractAmount) : null,
    };
  }

  extractInitiationFieldsFromText(text: string) {
    const normalizedText = this.normalizeInitiationText(text);
    const lines = normalizedText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    // Find key positions in the document
    const titleIndex = lines.findIndex(
      (line) => line.includes('申请采购事项名称') || line.includes('申请采购'),
    );
    const projectReasonIndex = lines.findIndex(
      (line) => line.includes('申请立项事由') || line.includes('申请立项'),
    );
    const supplierReqIndex = lines.findIndex(
      (line) => line.includes('对供方的主要要求') || line.includes('对供方的'),
    );
    const budgetIndex = lines.findIndex(
      (line) => line.includes('采购预算价格') || line.includes('采购预算'),
    );
    const categoryIndex = lines.findIndex((line) => line.includes('采购类别'));
    const methodIndex = lines.findIndex(
      (line) => line.includes('拟采购方式') || line.includes('拟采购方'),
    );

    // Extract requester name and department using "name + department" pair detection
    // This is the most robust method for pdf-parse output where labels and values are interleaved
    let requesterName = '';
    let requesterDepartment = '';

    // Strategy 0: Find name+department on same line (new format: "陈迎迎人力资源部")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Match pattern: 2-4 Chinese chars followed by department keywords (without space)
      // e.g., "陈迎迎人力资源部" -> name="陈迎迎", dept="人力资源部"
      const nameDeptMatch = line.match(/^([一-龥]{2,4})(人力资源部|办公室|测绘分院|勘察分院|工程勘察院|造价咨询院|科技创新部|财务资产部|采购中心)$/);
      if (nameDeptMatch) {
        requesterName = nameDeptMatch[1];
        requesterDepartment = nameDeptMatch[2];
        break;
      }
      // Also match pattern like "张维刚工程勘察院/钻探室" - need more specific match to avoid partial matches
      const nameDeptSlashMatch = line.match(/^([一-龥]{2,4})(工程勘察院\/[^/\s]+)$/);
      if (nameDeptSlashMatch) {
        requesterName = nameDeptSlashMatch[1];
        requesterDepartment = nameDeptSlashMatch[2];
        break;
      }
    }

    // Strategy 1: Find the first "name + department" pair in the document (separate lines)
    // Name: 2-4 pure Chinese characters
    // Department: contains "/" (e.g., "测绘分院/测绘分院")
    if (!requesterName) {
      for (let i = 0; i < lines.length - 1; i++) {
        const current = lines[i].trim();
        const next = lines[i + 1]?.trim() || '';

        // Check if current is a name (2-4 Chinese chars)
        if (current.length >= 2 && current.length <= 4 && /^[一-龥]+$/.test(current)) {
          // Check if next line is a department (contains "/")
          if (next.match(/[^\/\s]+\/[^\/\s]+/)) {
            requesterName = current;
            // Check for sub-department on the following line
            const subDept = lines[i + 2]?.trim() || '';
            if (subDept.length >= 2 && subDept.length <= 10 &&
                (subDept.includes('室') || subDept.includes('部')) &&
                !subDept.includes('分院') && !subDept.match(/^\d/)) {
              requesterDepartment = next + subDept;
            } else {
              requesterDepartment = next;
            }
            break;
          }
        }
      }
    }

    // Fallback: try label-based extraction
    if (!requesterName) {
      for (const line of lines) {
        const match = line.match(/需求申请人\s*[：:]?\s*([^\s]+)/);
        if (match && match[1].length >= 2) {
          requesterName = match[1].trim();
          break;
        }
      }
    }

    if (!requesterDepartment) {
      for (const line of lines) {
        const matchFull = line.match(/([^\/\s]+\/[^\/\s]+)\s*需求部门\s*([^\s]+)/);
        if (matchFull) {
          requesterDepartment = `${matchFull[1]}${matchFull[2]}`;
          break;
        }
        const matchSlash = line.match(/需求部门\s*[：:]?\s*([^\/\s]+\/[^\s]+)/);
        if (matchSlash) {
          requesterDepartment = matchSlash[1].trim();
          break;
        }
        const match = line.match(/需求部门\s*[：:]?\s*([^\s]+)/);
        if (match) {
          requesterDepartment = match[1].trim();
          break;
        }
      }
    }

    // Final fallback to layout-based extraction
    if (!requesterName) {
      requesterName = this.findRequesterNameFromLayout(lines);
    }
    if (!requesterDepartment) {
      requesterDepartment = this.findRequesterDepartmentFromLayout(lines);
    }

    // Extract procurement title - try multiple patterns
    let procurementTitle = '';
    // Pattern 1: "申请采购 人工智能数据分析处理工作站 事项名称"
    for (const line of lines) {
      const match = line.match(/申请采购\s*([^\s]+(?:\s+[^\s]+)*?)\s*事项名称/);
      if (match) {
        let title = match[1].trim();
        // Stop at "所属项目" or "合同及编号" if captured
        const stopIdx = title.search(/所属项目|合同及编号|合同及编/);
        if (stopIdx > 0) {
          title = title.substring(0, stopIdx).trim();
        }
        procurementTitle = title;
        break;
      }
      // Pattern 2: "申请采购事项名称 人工智能数据分析处理工作站"
      const match2 = line.match(/申请采购事项名称\s*[：:]?\s*(.+)$/);
      if (match2) {
        let title = match2[1].trim();
        // Stop at "所属项目" or "合同及编号" if captured
        const stopIdx = title.search(/所属项目|合同及编号|合同及编/);
        if (stopIdx > 0) {
          title = title.substring(0, stopIdx).trim();
        }
        procurementTitle = title;
        break;
      }
    }
    // Pattern 3: For new format "采购立项申请表(新)" - title appears after "申请采购事项名称" label on separate line
    if (!procurementTitle) {
      const titleLabelIdx = lines.findIndex((line) => line.includes('申请采购事项名称'));
      if (titleLabelIdx >= 0) {
        // Check if the label line ends with "名称" and next line has content
        for (let i = titleLabelIdx + 1; i < Math.min(lines.length, titleLabelIdx + 3); i++) {
          const nextLine = lines[i].trim();
          // Skip empty lines, labels, and short content
          if (!nextLine || nextLine.includes('所属项目') || nextLine.includes('合同及编号') ||
              nextLine.includes('申请立项') || nextLine.length < 3) {
            continue;
          }
          // This should be the title
          procurementTitle = nextLine;
          break;
        }
      }
    }
    // Fallback to original logic
    if (!procurementTitle && titleIndex >= 0) {
      for (let i = titleIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (
          line.includes('所属项目') ||
          line.includes('合同及编号') ||
          line.includes('申请立项')
        ) {
          break;
        }
        if (
          line.length > 2 &&
          !line.includes('申请采购') &&
          !line.includes('事项名称') &&
          !line.match(/^(需求|基本信息|日期)/)  // Skip label-like lines
        ) {
          procurementTitle = line;
          break;
        }
      }
    }

    // Extract project reason - try multiple patterns
    let projectReason = '';

    // Pattern 0: For "采购立项申请表(新)" format - find "申请立项" label and get content from next line
    const newFormReasonIdx = lines.findIndex((line) =>
      line === '申请立项' || line === '申请立项事由' || line === '申请立项事由/情况说明');
    if (newFormReasonIdx >= 0) {
      const reasonLines: string[] = [];
      for (let i = newFormReasonIdx + 1; i < Math.min(lines.length, newFormReasonIdx + 10); i++) {
        const nextLine = lines[i].trim();
        // Stop at markers
        if (nextLine.includes('对供方') || nextLine.includes('主要要求') ||
            nextLine.includes('采购预算') || nextLine.includes('采购类别') ||
            nextLine.includes('所属项目') || nextLine.includes('合同及编号')) {
          break;
        }
        // Skip short lines, labels, and dates
        if (nextLine.length > 3 &&
            !nextLine.match(/^(申请|需求|采购|拟采购|基本信息|日期)/) &&
            !nextLine.match(/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/)) {
          reasonLines.push(nextLine);
        }
      }
      if (reasonLines.length > 0) {
        projectReason = reasonLines.join('').trim();
      }
    }

    // Pattern 1: Find the line that contains "申请立项" and "事由"
    // The content is typically BEFORE these keywords in OCR output
    if (!projectReason) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('申请立项') && line.includes('事由')) {
          // The reason content is before "申请立项" keyword
          // Find the start of the reason (look for previous lines that contain content)
          const reasonLines: string[] = [];

          // First, check if there's content before "申请立项" on the same line
          const beforeMatch = line.match(/(.+?)\s*申请立项/);
          if (beforeMatch) {
            let content = beforeMatch[1].trim();
            // Remove any leading date or department info
            content = content.replace(/^日期[^\s]+\s*/, '');
            content = content.replace(/^[^/\s]+\/[^/\s]+\s*需求部门[^\s]*\s*/, '');
            content = content.replace(/^需求部门[^\s]*\s*/, '');
            if (content.length > 5) {
              reasonLines.push(content);
            }
          }

          // Part 2: Content BETWEEN "申请立项" and "事由"
          const middleMatch = line.match(/申请立项\s*(.+?)\s*事由/);
          if (middleMatch) {
            const middleContent = middleMatch[1].trim();
            if (middleContent.length > 2) {
              reasonLines.push(middleContent);
            }
          }

          // Content after "事由" on the same line
          const afterMatch = line.match(/事由\s*(.+)$/);
          if (afterMatch) {
            let afterContent = afterMatch[1].trim();
            const stopIdx = afterContent.search(/对供方|采购预算|采购类别/);
            if (stopIdx > 0) {
              afterContent = afterContent.substring(0, stopIdx).trim();
            }
            if (afterContent.length > 2) {
              reasonLines.push(afterContent);
            }
          }

          // Look for content in previous lines (for OCR format where content is before keywords)
          // Only search backwards if inline content was found on this line (OCR format)
          // In pdf-parse format, label is standalone with no inline content - skip backwards search
          const hasInlineReasonContent = (beforeMatch && beforeMatch[1].trim().length > 5) ||
            (middleMatch && middleMatch[1].trim().length > 2) ||
            (afterMatch && afterMatch[1].trim().length > 2);

          if (hasInlineReasonContent) {
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              const prevLine = lines[j];
              // Skip lines that are just labels, dates, or short
              if (prevLine.length > 10 &&
                  !prevLine.includes('申请采购') &&
                  !prevLine.includes('事项名称') &&
                  !prevLine.includes('所属项目') &&
                  !prevLine.includes('合同及编号') &&
                  !prevLine.includes('合同及编') &&
                  !prevLine.match(/^日期/) &&
                  !prevLine.match(/^\d{4}[./-]/) && // Skip date lines
                  !prevLine.match(/需求部门/) &&
                  !prevLine.match(/[^/\s]+\/[^/\s]+/)) { // Skip department lines like "测绘分院/测绘分院"
                reasonLines.unshift(prevLine);
              }
            }
          }

          // Collect subsequent lines until we hit a real stop marker (for pdf-parse format)
          for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
            const nextLine = lines[j];
            // Stop at real markers, not "项目名称" which is part of content
            if (nextLine.includes('对供方') ||
                nextLine.includes('主要要求') ||
                nextLine.includes('采购预算') ||
                nextLine.includes('采购类别') ||
                nextLine.match(/^\d+\s*具有/)) {
              break;
            }
            if (nextLine.length > 5) {
              reasonLines.push(nextLine);
            }
          }

          projectReason = reasonLines.join('').replace(/\s+/g, '').trim();
          break;
        }

        // Pattern 2: "申请立项事由 为推进科研试验项目..."
        const match2 = line.match(/申请立项事由\s*[：:]?\s*(.+)$/);
        if (match2) {
          projectReason = match2[1].trim();
          break;
        }
      }
    }

    // Fallback to original logic
    if (!projectReason && projectReasonIndex >= 0) {
      const endIdx =
        supplierReqIndex > projectReasonIndex ? supplierReqIndex : lines.length;
      const reasonLines: string[] = [];
      for (let i = projectReasonIndex + 1; i < endIdx; i++) {
        const line = lines[i];
        if (line.includes('对供方') || line.includes('主要要求')) break;
        if (
          !line.includes('申请立项') &&
          !line.includes('事由') &&
          line.length > 2
        ) {
          reasonLines.push(line);
        }
      }
      projectReason = reasonLines.join('').replace(/\s+/g, '').trim();
    }

    // Extract supplier requirements
    let supplierRequirements = '';

    // Pattern 0: For new format - find "对供方的主要要求" label on separate line
    const newFormSupplierIdx = lines.findIndex((line) =>
      line === '对供方的主要要求' || line === '对供方' || line.includes('主要要求'));
    if (newFormSupplierIdx >= 0 && !lines[newFormSupplierIdx].match(/\d+[.、]/)) {
      // Label is on its own line, content follows
      const reqLines: string[] = [];
      for (let i = newFormSupplierIdx + 1; i < Math.min(lines.length, newFormSupplierIdx + 10); i++) {
        const nextLine = lines[i].trim();
        // Stop at markers
        if (nextLine.includes('采购预算') || nextLine.includes('采购类别') ||
            nextLine.includes('采购组织') || nextLine.includes('采购内容明细') ||
            nextLine.includes('拟采购方')) {
          break;
        }
        // Collect numbered requirements or substantial content
        if (nextLine.match(/^\d+[.、:]/) || nextLine.startsWith('具有') ||
            nextLine.startsWith('法律') || nextLine.startsWith('参加') ||
            nextLine.length > 10) {
          reqLines.push(nextLine);
        }
      }
      if (reqLines.length > 0) {
        supplierRequirements = reqLines.join(' ').trim();
      }
    }

    // Pattern 1: Find the line that contains "对供方" (or OCR errors like "对供n的") and "主要要求"
    // The requirements are typically BEFORE these keywords in OCR output
    if (!supplierRequirements) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Use loose matching for OCR errors: "对供方", "对供n的", "对供方的" etc.
        const hasSupplierKeyword = line.match(/对供[方n]/) || line.includes('主要要求');

        if (line.match(/对供[方n]/) && line.includes('主要要求')) {
          // Both keywords on same line
          const reqLines: string[] = [];

          // Check content before "对供方" on the same line
          const beforeMatch = line.match(/(.+?)\s*对供[方n]/);
          if (beforeMatch) {
            let content = beforeMatch[1].trim();
            if (content.startsWith('具有') && !content.match(/^1[.、]/)) {
              content = '1. ' + content;
            }
            reqLines.push(content);
          }

          // Extract content between "对供方" and "主要要求"
          const middleMatch = line.match(/对供[方n][^\d]*(\d+[.、\s][^对]+?)主要要求/);
          if (middleMatch) {
            reqLines.push(middleMatch[1].trim());
        }

        // Content after "主要要求" on the same line
        const afterMatch = line.match(/主要要求\s*(.+)$/);
        if (afterMatch) {
          const afterContent = afterMatch[1].trim();
          if (afterContent.match(/^\d+[.、\s]/) || afterContent.startsWith('参加')) {
            reqLines.push(afterContent);
          }
        }

        // Only search backwards/forwards if content was found on the same line (OCR format)
        // In pdf-parse format, label is standalone - skip to let fallback handle it
        const hasInlineContent = (beforeMatch && beforeMatch[1].trim().length > 5) ||
          middleMatch || (afterMatch && afterMatch[1].trim().length > 2);

        if (hasInlineContent) {
          // Look for numbered requirement items in previous lines (OCR format)
          for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
            const prevLine = lines[j];
            if (prevLine.match(/^\d+[.、\s]/) ||
                prevLine.startsWith('具有') ||
                prevLine.startsWith('参加') ||
                prevLine.startsWith('法律') ||
                prevLine.startsWith('对方')) {
              let content = prevLine;
              if (content.startsWith('具有') && !content.match(/^1[.、]/)) {
                content = '1. ' + content;
              }
              reqLines.unshift(content);
            }
          }

          // Collect subsequent numbered items
          for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
            const nextLine = lines[j];
            if (nextLine.includes('采购预算') || nextLine.includes('采购类别')) break;
            if (nextLine.match(/^\d+[.、\s]/) ||
                nextLine.startsWith('法律') ||
                nextLine.startsWith('行政法规')) {
              reqLines.push(nextLine);
            }
          }

          supplierRequirements = reqLines.join(' ').trim();
        }
        break;
      }

      // Pattern for split "对供方" and "主要要求" across lines
      // Format: "1.对方提供...快\n对供方的\n速，信号强，2.图形操作...3.\n主要要求\n能无网续测.4.售后完善。"
      if (line.match(/对供[方n]/) && !line.includes('主要要求')) {
        const reqLines: string[] = [];

        // Look for content before "对供方" in previous lines
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const prevLine = lines[j];
          if (prevLine.match(/^\d+[.、\s]/) ||
              prevLine.startsWith('对方') ||
              prevLine.startsWith('具有') ||
              prevLine.startsWith('参加')) {
            reqLines.unshift(prevLine);
          }
        }

        // Look for content between "对供方" line and "主要要求" line
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          const nextLine = lines[j];
          if (nextLine.includes('主要要求')) {
            // Check for content after "主要要求"
            const afterMatch = nextLine.match(/主要要求\s*(.+)$/);
            if (afterMatch) {
              reqLines.push(afterMatch[1].trim());
            }
            // Continue collecting after "主要要求" line
            for (let k = j + 1; k < Math.min(lines.length, j + 3); k++) {
              const afterLine = lines[k];
              if (afterLine.includes('采购预算') || afterLine.includes('采购类别')) break;
              if (afterLine.match(/^\d+[.、\s]/) || afterLine.length > 5) {
                reqLines.push(afterLine);
              }
            }
            break;
          }
          if (nextLine.match(/^\d+[.、\s]/) || nextLine.length > 3) {
            reqLines.push(nextLine);
          }
        }

        if (reqLines.length > 0) {
          supplierRequirements = reqLines.join('').replace(/\s+/g, '').trim();
          break;
        }
      }

      // Pattern 2: "对供方的主要要求 1.具有独立承担..."
      const match2 = line.match(/对供[方n].*主要要求\s*[：:]?\s*(.+)$/);
      if (match2) {
        supplierRequirements = match2[1].trim();
        // Collect subsequent numbered items
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          const nextLine = lines[j];
          if (nextLine.includes('采购预算') || nextLine.includes('采购类别')) break;
          if (nextLine.match(/^\d+[.、\s]/)) {
            supplierRequirements += ' ' + nextLine;
          }
        }
        break;
      }
    }
    }

    // Fallback to original method
    if (!supplierRequirements) {
      supplierRequirements = this.findSupplierRequirementsFromLayout(lines);
    }

    // Strategy for pdf-parse native text format:
    // In pdf-parse output, "对供方的主要要求" value may not follow the label.
    // Instead, the value appears after "拟采购方式" section with numbered items like "1.对方提供..."
    if (!supplierRequirements) {
      // Find the line "拟采购方" and look for numbered requirement items after it
      const procurementMethodIdx = lines.findIndex(
        (line) => line.includes('拟采购方'),
      );
      if (procurementMethodIdx >= 0) {
        // Search for numbered content starting with "1." after procurement method
        for (let i = procurementMethodIdx + 1; i < Math.min(lines.length, procurementMethodIdx + 15); i++) {
          if (lines[i].match(/^1[.、:]/)) {
            const reqLines: string[] = [];
            for (let j = i; j < Math.min(lines.length, i + 5); j++) {
              const currentLine = lines[j];
              if (
                currentLine.includes('公开招标') ||
                currentLine.includes('邀请招标') ||
                currentLine.includes('谈判采购') ||
                currentLine === '其他' ||
                currentLine.includes('采购组织形式') ||
                currentLine.startsWith('2025/')
              ) {
                break;
              }
              reqLines.push(currentLine);
            }
            if (reqLines.length > 0) {
              supplierRequirements = reqLines.join(' ').trim();
            }
            break;
          }
        }
      }
    }

    // Extract budget amount - try multiple patterns
    let budgetAmount = 0;
    // Pattern 1: "采购预算价格(元) 250000.00"
    for (const line of lines) {
      const match = line.match(/采购预算[^0-9]*([0-9]+(?:\.[0-9]+)?)/);
      if (match) {
        budgetAmount = Number.parseFloat(match[1]);
        break;
      }
    }
    // Fallback to original logic
    if (!budgetAmount && budgetIndex >= 0) {
      for (
        let i = budgetIndex;
        i < Math.min(budgetIndex + 3, lines.length);
        i++
      ) {
        const match = lines[i].match(/([0-9]+(?:\.[0-9]+)?)/);
        if (match) {
          budgetAmount = Number(match[1]);
          break;
        }
      }
    }

    // Extract procurement category
    let procurementCategory = '';
    // Pattern 1: "采购类别 科技研发类采购"
    for (const line of lines) {
      const match = line.match(/采购类别\s*[：:]?\s*([^\s\[\(]+)/);
      if (match) {
        const potentialCat = match[1].trim();
        if (KNOWN_CATEGORIES.includes(potentialCat)) {
          procurementCategory = potentialCat;
          break;
        }
      }
      // Pattern 2: Look for known category at start of line after "采购类别"
      if (line.includes('采购类别')) {
        for (const cat of KNOWN_CATEGORIES) {
          if (line.includes(cat) && line.indexOf(cat) < 30) {
            procurementCategory = cat;
            break;
          }
        }
        if (procurementCategory) break;
      }
    }
    // Fallback: find any known category in the document
    if (!procurementCategory) {
      procurementCategory =
        lines.find((line) => KNOWN_CATEGORIES.includes(line)) || '';
    }

    // Extract procurement method
    // Note: PDF text extraction merges all method options into one line,
    // making it impossible to determine which one is selected.
    // We leave it empty for user to select manually.
    const procurementMethod = '';

    // Extract procurement organization form
    let procurementOrganizationForm = '';
    // Pattern 1: "采购组织 自行招标 形式" (split across line)
    for (const line of lines) {
      if (line.includes('采购组织') && line.includes('形式')) {
        // Extract the word between "采购组织" and "形式"
        const match = line.match(/采购组织\s*[：:]?\s*(\S+)\s*形式/);
        if (match && KNOWN_ORGANIZATION_FORMS.includes(match[1])) {
          procurementOrganizationForm = match[1];
          break;
        }
      }
      // Pattern 2: "采购组织形式 自行招标"
      const match2 = line.match(/采购组织形式\s*[：:]?\s*([^\s]+)/);
      if (match2 && KNOWN_ORGANIZATION_FORMS.includes(match2[1])) {
        procurementOrganizationForm = match2[1];
        break;
      }
    }
    // Pattern 3: pdf-parse format - look for organization form right after the label
    if (!procurementOrganizationForm) {
      const formIdx = lines.findIndex((l) => l.includes('采购组织形式'));
      if (formIdx >= 0) {
        // Search next few lines for known organization forms
        for (let i = formIdx + 1; i < Math.min(lines.length, formIdx + 10); i++) {
          const candidate = lines[i].trim();
          if (KNOWN_ORGANIZATION_FORMS.includes(candidate)) {
            procurementOrganizationForm = candidate;
            break;
          }
          // Also check if it's part of a line (e.g., "自行招标附件")
          for (const form of KNOWN_ORGANIZATION_FORMS) {
            if (candidate.startsWith(form)) {
              procurementOrganizationForm = form;
              break;
            }
          }
          if (procurementOrganizationForm) break;
        }
      }
    }
    // Fallback
    if (!procurementOrganizationForm) {
      procurementOrganizationForm =
        this.findExactValueAfterAnchor(
          lines,
          '采购组织形式',
          KNOWN_ORGANIZATION_FORMS,
        ) ||
        lines.find((line) => KNOWN_ORGANIZATION_FORMS.includes(line)) ||
        '';
    }

    // Extract annual budget flag
    // Pattern 1: "是否属于 是 年度预算"
    let isAnnualBudget = false;
    for (const line of lines) {
      if (line.includes('是否属于') && line.includes('年度预算')) {
        // Check if "是" appears between "是否属于" and "年度预算"
        const match = line.match(/是否属于\s*(是)\s*年度预算/);
        if (match) {
          isAnnualBudget = true;
          break;
        }
      }
      if (line.includes('是否属于年度预算')) {
        isAnnualBudget = line.includes('是');
        break;
      }
    }
    // Fallback
    if (!isAnnualBudget) {
      const annualBudgetSection = this.collectSection(lines, '是否属于年度预算', [
        '三重一大佐证材料',
        '采购内容明细',
      ]);
      isAnnualBudget =
        annualBudgetSection.some((line) => line === '是') ||
        this.findAnnualBudgetFlag(lines);
    }

    // Extract initiation date (立项时间)
    // Pattern: Look for "日期" or "基本信息日期" label, then extract date from next line or inline
    let initiationDate = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Pattern 1: "日期 2025-09-29" or "基本信息日期 2025-07-07"
      const inlineMatch = line.match(/(?:基本信息)?日期\s*[：:]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})/);
      if (inlineMatch) {
        initiationDate = inlineMatch[1].replace(/[./]/g, '-');
        break;
      }
      // Pattern 2: Label on one line, date on next line (pdf-parse format)
      if (line === '日期' || line === '基本信息日期' || line.match(/^基本信息\s*日期$/)) {
        const nextLine = lines[i + 1]?.trim() || '';
        const dateMatch = nextLine.match(/^(\d{4}[./-]\d{1,2}[./-]\d{1,2})$/);
        if (dateMatch) {
          initiationDate = dateMatch[1].replace(/[./]/g, '-');
          break;
        }
      }
    }

    // Clean up whitespace in all extracted text fields
    const cleanText = (t: string) => t.replace(/\s+/g, ' ').trim();

    return {
      requesterName: cleanText(requesterName),
      requesterDepartment: cleanText(requesterDepartment),
      procurementTitle: cleanText(procurementTitle),
      procurementMethod,
      procurementCategory: cleanText(procurementCategory),
      procurementOrganizationForm: cleanText(procurementOrganizationForm),
      budgetAmount,
      isAnnualBudget,
      projectReason: cleanText(projectReason),
      supplierRequirements: cleanText(supplierRequirements),
      initiationDate,
    };
  }

  async extractDemandFieldsFromText(text: string) {
    const normalizedText = this.normalizeInitiationText(text);
    const lines = normalizedText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    // 采购需求表PDF解析策略：
    // PDF文本提取后，标签和值通常在同一行或相邻行
    // 格式特征：
    // - "申请采购事项名称" 后面紧跟事项名称
    // - "采购预算价格(元)" 后面是金额
    // - "需求申请人" 后面是申请人名字
    // - "需求部门" 后面是部门
    // - "申请立项事由/情况说明" 后面是事由（可能是多行）
    // - "对供方的主要要求" 后面是要求（可能是多行）
    // - "采购类别" 后面是类别

    // 辅助函数：查找标签后的值
    const findValueAfterLabel = (label: string, maxLines: number = 5): string => {
      const labelIdx = lines.findIndex((line) => line.includes(label));
      if (labelIdx < 0) return '';

      // 情况1：标签和值在同一行（如 "需求申请人 张三"）
      const sameLineMatch = lines[labelIdx].match(new RegExp(`${label}\\s*(.+)`));
      if (sameLineMatch && sameLineMatch[1].trim().length > 0) {
        return sameLineMatch[1].trim();
      }

      // 情况2：值在标签下一行
      for (let i = labelIdx + 1; i < Math.min(lines.length, labelIdx + maxLines + 1); i++) {
        const line = lines[i];
        // 跳过空行和其他标签
        if (line.length === 0 || line.includes('所属项目') || line.includes('合同及编号')) continue;
        // 如果遇到另一个标签，停止
        if (line.includes('采购预算') || line.includes('采购类别') || line.includes('附件') ||
            line.includes('备注') || line.includes('序号')) break;
        return line;
      }
      return '';
    };

    // 辅助函数：查找多行内容（用于事由和要求）
    const findMultiLineContent = (label: string, endLabels: string[]): string => {
      const labelIdx = lines.findIndex((line) => line.includes(label));
      if (labelIdx < 0) return '';

      const contentLines: string[] = [];

      // 检查标签同行是否有内容
      const sameLineMatch = lines[labelIdx].match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(.+)'));
      if (sameLineMatch && sameLineMatch[1].trim().length > 0) {
        let inlineContent = sameLineMatch[1].trim();
        // Strip residual label fragments like "/情况说明" after the main label
        inlineContent = inlineContent.replace(/^[/／]\S+\s*/, '').trim();
        // Known label remnants that should not be treated as real content
        const labelRemnants = ['事由', '情况说明', '说明', '事由/情况说明', '主要要求', '/情况说明'];
        if (!labelRemnants.includes(inlineContent) && inlineContent.length > 3) {
          contentLines.push(inlineContent);
        }
      }

      // 继续读取后续行直到遇到结束标签
      for (let i = labelIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        // 检查是否遇到结束标签
        if (endLabels.some((end) => line.includes(end))) break;
        // 跳过审批流程相关内容
        if (line.includes('接收人') || line.includes('流转意见') ||
            line.includes('[') || line.match(/^\d{4}-\d{2}-\d{2}/)) break;
        // 跳过表格相关
        if (line.match(/^序号$/) || line.includes('采购物品规格') ||
            line.includes('预估单价') || line.includes('小计')) break;
        // 跳过"是"和人员名字、部门等
        if (line === '是' || (line.length >= 2 && line.length <= 4 && /^[一-龥]+$/.test(line))) break;
        if (line.includes('/') && line.length < 20) break; // 跳过部门格式
        if (line.length > 0) {
          contentLines.push(line);
        }
      }

      return contentLines.join(' ').trim();
    };

    // 辅助函数：从"合计"行后提取内容（需求表特有格式）
    // 格式：合计金额后依次是：申请人、部门、事项名称、立项事由、对供方要求
    // 当事项名称=立项事由时，会出现两段相同的文本，跳过第二段
    const findContentAfterTotal = (): { requesterName: string; requesterDept: string; projectReason: string; supplierRequirements: string; firstSegment: string; contentStartIndex: number } => {
      const totalIdx = lines.findIndex((line) => line.startsWith('合计') || (line.includes('合计') && /\d/.test(line)));
      if (totalIdx < 0) return { requesterName: '', requesterDept: '', projectReason: '', supplierRequirements: '', firstSegment: '', contentStartIndex: -1 };

      // 跳过金额行，找到申请人（2-4个汉字）
      let nameIdx = -1;
      for (let i = totalIdx + 1; i < Math.min(lines.length, totalIdx + 5); i++) {
        const line = lines[i].trim();
        if (line.length >= 2 && line.length <= 4 && /^[一-龥]+$/.test(line)) {
          nameIdx = i;
          break;
        }
      }
      if (nameIdx < 0) return { requesterName: '', requesterDept: '', projectReason: '', supplierRequirements: '', firstSegment: '', contentStartIndex: -1 };

      const requesterName = lines[nameIdx];
      const requesterDept = lines[nameIdx + 1] || '';

      // 从部门后收集文本段落
      const segments: string[] = [];
      let currentSegment = '';

      let contentStartIndex = -1;
      for (let i = nameIdx + 2; i < Math.min(lines.length, nameIdx + 20); i++) {
        const line = lines[i].trim();

        // 停止条件
        if (KNOWN_CATEGORIES.includes(line)) break;
        if (line.includes('.pdf') || line.includes('.docx') || line.match(/^\d+[\.\d]*[KM]$/)) break;
        if (line.includes('接收人') || line.includes('来自') || line.match(/^\d{4}-\d{2}-\d{2}/)) break;
        if (line.includes('|') || line.length < 2) continue;

        if (contentStartIndex < 0) {
          contentStartIndex = i;
        }

        // 合并被分割的行：如果当前段落未以句号结束，继续追加
        const endsWithEndMark = /[。；！？]$/.test(line);

        if (currentSegment.length > 0 && !endsWithEndMark) {
          // 当前段落未结束，继续追加
          currentSegment += line;
        } else if (line.length > 3) {
          // 新段落开始
          if (currentSegment.length > 0) {
            segments.push(currentSegment.trim());
          }
          currentSegment = line;
        }
      }
      if (currentSegment.length > 0) {
        segments.push(currentSegment.trim());
      }

      // 分析段落：
      // 格式：事项名称、立项事由、对供方要求
      // 当事项名称=立项事由时，前两段相同，跳过第二段
      let projectReason = '';
      let supplierRequirements = '';
      let firstSegment = '';

      if (segments.length >= 1) {
        const first = segments[0]; // 事项名称
        firstSegment = first;

        if (segments.length >= 2) {
          const second = segments[1];

          if (first === second || second.includes(first) || first.includes(second)) {
            // 事项名称 = 立项事由，跳过第二段
            projectReason = first;
            // 第三段是对供方要求
            if (segments.length >= 3) {
              supplierRequirements = segments[2];
            }
          } else {
            // 事项名称 != 立项事由
            projectReason = second;
            if (segments.length >= 3) {
              supplierRequirements = segments[2];
            }
          }
        } else {
          // 只有一段，就是事项名称=立项事由，没有对供方要求
          projectReason = first;
        }
      }

      return { requesterName, requesterDept, projectReason, supplierRequirements, firstSegment, contentStartIndex };
    };

    // 辅助函数：查找"是"行后的名字+部门对
    const demandLabelPatterns = ['需求申请人', '需求部门', '申请采购事项名称', '所属项目', '合同及编号', '申请立项事由', '情况说明', '对供方的主要要求', '采购预算价格', '采购类别', '附件', '备注', '序号'];
    const isDemandLabel = (line: string) => demandLabelPatterns.some((l) => line === l || line.startsWith(l));
    const findNameDeptAfterYes = (): { name: string; dept: string } => {
      const yesIdx = lines.findIndex((line) => line === '是');
      if (yesIdx >= 0) {
        for (let i = yesIdx + 1; i < Math.min(lines.length, yesIdx + 15); i++) {
          const line = lines[i];
          if (isDemandLabel(line)) continue;
          // 名字特征：2-4个纯汉字
          if (line.length >= 2 && line.length <= 4 && /^[一-龥]+$/.test(line)) {
            // 检查后续行是否是部门格式（跳过标签行）
            for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
              const candidate = lines[j];
              if (isDemandLabel(candidate)) continue;
              if (candidate.includes('/') || candidate.includes('院') || candidate.includes('室') ||
                  candidate.includes('部') || candidate.includes('中心')) {
                return { name: line, dept: candidate };
              }
              break;
            }
          }
        }
      }
      return { name: '', dept: '' };
    };

    // 1. 申请采购事项名称
    let procurementTitle = findValueAfterLabel('申请采购事项名称', 3);
    // 清理：移除可能的"所属项目/合同及编号"部分
    if (procurementTitle.includes('所属项目')) {
      procurementTitle = procurementTitle.split('所属项目')[0].trim();
    }

    // 2. 采购预算价格
    let budgetAmount = 0;
    const budgetLabelIdx = lines.findIndex((line) => line.includes('采购预算价格'));
    if (budgetLabelIdx >= 0) {
      // 检查同行
      const sameLineMatch = lines[budgetLabelIdx].match(/采购预算价格[^0-9]*([0-9]+(?:\.[0-9]+)?)/);
      if (sameLineMatch) {
        budgetAmount = Number.parseFloat(sameLineMatch[1]);
      } else {
        // 检查下一行
        for (let i = budgetLabelIdx + 1; i < Math.min(lines.length, budgetLabelIdx + 3); i++) {
          const match = lines[i].match(/([0-9]+(?:\.[0-9]+)?)/);
          if (match) {
            budgetAmount = Number.parseFloat(match[1]);
            break;
          }
        }
      }
    }

    // 3. 需求申请人 - 使用多种策略
    let requesterName = '';
    let requesterDepartment = '';

    // 策略1：查找"是"行后的名字+部门对（年度预算为"是"的情况，这是最常见的格式）
    const nameDeptPair = findNameDeptAfterYes();
    if (nameDeptPair.name) {
      requesterName = nameDeptPair.name;
      requesterDepartment = nameDeptPair.dept;
    }

    // 策略2：查找"合计"行后的名字+部门对（无年度预算的情况）
    if (!requesterName) {
      const totalIdx = lines.findIndex((line) => line.startsWith('合计') || (line.includes('合计') && /\d/.test(line)));
      if (totalIdx >= 0) {
        for (let i = totalIdx + 1; i < Math.min(lines.length, totalIdx + 15); i++) {
          const line = lines[i];
          // 名字特征：2-4个纯汉字，或者"人力资源部"这种部门名后面跟着名字
          if (line.length >= 2 && line.length <= 10 && /^[一-龥]+$/.test(line)) {
            // 检查是否是部门名（包含"部"、"室"、"中心"等）
            if (line.includes('部') || line.includes('室') || line.includes('中心')) {
              // 这可能是部门名，检查下一行是否是更具体的部门或事项
              continue;
            }
            const nextLine = lines[i + 1] || '';
            // 部门特征：包含"/"、"院"、"室"、"部"、"中心"，或者是"人力资源部"这种
            if (nextLine.includes('/') || nextLine.includes('院') || nextLine.includes('室') ||
                nextLine.includes('部') || nextLine.includes('中心') || nextLine.includes('人力资源')) {
              requesterName = line;
              requesterDepartment = nextLine;
              break;
            }
          }
        }
      }
    }

    // 策略3：直接查找标签后的值（标签和值在同一行的情况）
    if (!requesterName) {
      requesterName = findValueAfterLabel('需求申请人', 3);
    }
    if (!requesterDepartment) {
      requesterDepartment = findValueAfterLabel('需求部门', 3);
    }

    // 策略4：如果只找到名字，在名字后找部门
    if (requesterName && !requesterDepartment) {
      const nameIdx = lines.lastIndexOf(requesterName);
      if (nameIdx >= 0 && nameIdx + 1 < lines.length) {
        const nextLine = lines[nameIdx + 1];
        if (nextLine.includes('/') || nextLine.includes('院') || nextLine.includes('室') ||
            nextLine.includes('部') || nextLine.includes('中心')) {
          requesterDepartment = nextLine;
        }
      }
    }
    // 备用：直接查找标签
    if (!requesterDepartment) {
      requesterDepartment = findValueAfterLabel('需求部门', 3);
    }

    const findDemandNarrativeAfterRequester = (): { projectReason: string; supplierRequirements: string } => {
      if (!requesterDepartment) {
        return { projectReason: '', supplierRequirements: '' };
      }

      // Prefer the department occurrence after "合计" (the table data area),
      // not the one in the approval flow at the bottom of the document.
      let deptIdx = -1;
      const totalIdx = lines.findIndex((line) => line.startsWith('合计') || (line.includes('合计') && /\d/.test(line)));
      if (totalIdx >= 0) {
        for (let i = totalIdx + 1; i < Math.min(lines.length, totalIdx + 10); i++) {
          if (lines[i] === requesterDepartment) {
            deptIdx = i;
            break;
          }
        }
      }
      if (deptIdx < 0) {
        deptIdx = lines.indexOf(requesterDepartment);
      }
      if (deptIdx < 0) {
        return { projectReason: '', supplierRequirements: '' };
      }

      const stopPatterns = [
        '接收人',
        '来自',
        '流转意见',
        '采购需求申请表-',
        '10.20.',
      ];
      const contentLines: string[] = [];
      const normalizedTitle = procurementTitle.replace(/\s+/g, '');
      const normalizedProjectLine = lines.find((line) => line.includes('所属项目/合同及编号')) ? lines[lines.findIndex((line) => line.includes('所属项目/合同及编号')) + 1]?.replace(/\s+/g, '') ?? '' : '';
      let titleBuffer = '';
      let skippingRepeatedTitle = normalizedTitle.length > 0;
      let skippedRepeatedTitle = false;

      for (let i = deptIdx + 1; i < Math.min(lines.length, deptIdx + 40); i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (KNOWN_CATEGORIES.includes(line)) break;
        if (stopPatterns.some((pattern) => line.includes(pattern))) break;
        if (line.includes('[') || line.match(/^\d{4}-\d{2}-\d{2}/) || line.match(/^\d{4}\/\d{1,2}\/\d{1,2}/)) break;
        if (line.includes('.pdf') || line.includes('.docx') || line.match(/^\d+[\.\d]*[KM]$/)) continue;
        if (line.includes('|') || line === requesterName || line === requesterDepartment) continue;

        const normalizedLine = line.replace(/\s+/g, '');
        if (normalizedProjectLine && normalizedLine === normalizedProjectLine) {
          continue;
        }
        if (skippingRepeatedTitle) {
          const candidate = titleBuffer + normalizedLine;
          if (candidate.length > 0 && (normalizedTitle.includes(candidate) || candidate.includes(normalizedTitle))) {
            titleBuffer = candidate;
            skippedRepeatedTitle = true;
            continue;
          }
          skippingRepeatedTitle = false;
        }

        contentLines.push(line);
      }

      if (contentLines.length === 0) {
        return {
          projectReason: skippedRepeatedTitle ? procurementTitle : '',
          supplierRequirements: '',
        };
      }

      const isStructuredRequirementLine = (line: string) =>
        /^[（(]?\d+[）)]/.test(line) || /^\d+[、]/.test(line);

      let splitByRequirementMarker = false;
      const requirementStartIndex = contentLines.findIndex((line) => {
        if (isStructuredRequirementLine(line)) {
          splitByRequirementMarker = true;
          return true;
        }
        if (/(资质要求|业绩要求|提交不少于|提交能够满足|具备.*资质|具备.*能力)/.test(line)) {
          splitByRequirementMarker = true;
          return true;
        }
        return false;
      });

      const joinWrappedLines = (segments: string[], preserveHardBreaks = false) => {
        const paragraphs: string[] = [];
        let current = '';

        for (const segment of segments) {
          const trimmed = segment.trim();
          if (!trimmed) continue;

          if (!current) {
            current = trimmed;
            continue;
          }

          const continuesSentence =
            !preserveHardBreaks &&
            !/[。；！？：:]$/.test(current) &&
            !isStructuredRequirementLine(trimmed);

          if (continuesSentence) {
            current += trimmed;
          } else {
            paragraphs.push(current);
            current = trimmed;
          }
        }

        if (current) {
          paragraphs.push(current);
        }

        return paragraphs.join(' ');
      };

      if (requirementStartIndex > 0) {
        return {
          projectReason: joinWrappedLines(contentLines.slice(0, requirementStartIndex)),
          supplierRequirements: joinWrappedLines(
            contentLines.slice(requirementStartIndex),
            !splitByRequirementMarker,
          ),
        };
      }

      if (contentLines.length >= 2 && /(附件|要求)/.test(contentLines[1])) {
        return {
          projectReason: joinWrappedLines([contentLines[0]]),
          supplierRequirements: joinWrappedLines(contentLines.slice(1)),
        };
      }

      if (skippedRepeatedTitle) {
        return {
          projectReason: procurementTitle,
          supplierRequirements: joinWrappedLines(contentLines),
        };
      }

      if (contentLines.length >= 2) {
        const requirementMarkerIndex = contentLines.findIndex((line, index) =>
          index > 0 && (isStructuredRequirementLine(line) || /(资质要求|业绩要求|提交不少于|提交能够满足|提交能够|提交不少于1篇)/.test(line)),
        );
        if (requirementMarkerIndex > 0) {
          return {
            projectReason: joinWrappedLines(contentLines.slice(0, requirementMarkerIndex)),
            supplierRequirements: joinWrappedLines(contentLines.slice(requirementMarkerIndex), true),
          };
        }
      }

      return {
        projectReason: joinWrappedLines(contentLines),
        supplierRequirements: '',
      };
    };

    let projectReason = '';
    let supplierRequirements = '';

    // 策略1：优先使用标签精确提取，避免误吃审批流文本
    // Use the full label "申请立项事由/情况说明" first (most specific), then shorter variants
    projectReason = findMultiLineContent('申请立项事由/情况说明', ['对供方的主要要求', '采购预算价格', '采购类别', '附件', '备注', '序号']);
    if (!projectReason) {
      projectReason = findMultiLineContent('申请立项事由', ['对供方的主要要求', '采购预算价格', '采购类别', '附件', '备注', '序号']);
    }
    if (!projectReason) {
      projectReason = findMultiLineContent('情况说明', ['对供方的主要要求', '采购预算价格', '采购类别', '附件']);
    }
    if (!projectReason) {
      projectReason = findMultiLineContent('申请立项', ['对供方的主要要求', '采购预算价格', '采购类别']);
    }

    if (!supplierRequirements) {
      supplierRequirements = findMultiLineContent('对供方的主要要求', ['采购预算价格', '采购类别', '附件', '备注', '序号']);
    }

    // 策略2：从申请人/部门后的正文区提取，适配多种版式
    const demandNarrative = findDemandNarrativeAfterRequester();
    if (!projectReason && demandNarrative.projectReason) {
      projectReason = demandNarrative.projectReason;
    }
    if (!supplierRequirements && demandNarrative.supplierRequirements) {
      supplierRequirements = demandNarrative.supplierRequirements;
    }

    // "资质"/"业绩"关键词 fallback（放在策略2之后，避免截断覆盖策略2的完整结果）
    if (!supplierRequirements) {
      for (const line of lines) {
        if (line.includes('资质要求') || line.includes('业绩要求') ||
            (line.includes('资质') && line.length > 10) ||
            (line.includes('业绩') && line.length > 10)) {
          supplierRequirements = line;
          break;
        }
      }
    }

    // 策略3：从"合计"行后提取（历史版式兼容）
    const contentAfterTotal = findContentAfterTotal();
    if (!projectReason && contentAfterTotal.projectReason) {
      projectReason = contentAfterTotal.projectReason;
    }
    if (!supplierRequirements && contentAfterTotal.supplierRequirements) {
      supplierRequirements = contentAfterTotal.supplierRequirements;
    }

    const normalizedTitle = procurementTitle.replace(/\s+/g, '');
    const findSupplierRequirementsAfterRepeatedTitle = (): string => {
      if (contentAfterTotal.contentStartIndex < 0) {
        return '';
      }

      const requirementLines: string[] = [];
      let titleConsumed = false;

      for (let i = contentAfterTotal.contentStartIndex; i < Math.min(lines.length, contentAfterTotal.contentStartIndex + 20); i++) {
        const line = lines[i];

        if (KNOWN_CATEGORIES.includes(line)) break;
        if (line.includes('.pdf') || line.includes('.docx') || line.match(/^\d+[\.\d]*[KM]$/)) break;
        if (line.includes('接收人') || line.includes('来自') || line.match(/^\d{4}-\d{2}-\d{2}/)) break;
        if (line.includes('|') || line.length < 2) continue;

        const normalizedLine = line.replace(/\s+/g, '');
        if (!titleConsumed) {
          if (normalizedTitle.includes(normalizedLine) || normalizedLine.includes(normalizedTitle)) {
            titleConsumed = true;
          }
          continue;
        }

        requirementLines.push(line);
      }

      return requirementLines.join('');
    };

    const normalizedFirstSegment = contentAfterTotal.firstSegment.replace(/\s+/g, '');
    const totalContentLooksLikeRepeatedTitle =
      normalizedTitle.length > 0 &&
      normalizedFirstSegment.length > 0 &&
      (normalizedTitle === normalizedFirstSegment ||
        normalizedTitle.includes(normalizedFirstSegment) ||
        normalizedFirstSegment.includes(normalizedTitle));

    if (totalContentLooksLikeRepeatedTitle) {
      projectReason = procurementTitle;
      if (!supplierRequirements && contentAfterTotal.projectReason) {
        supplierRequirements = contentAfterTotal.projectReason;
      }
      const recoveredSupplierRequirements = findSupplierRequirementsAfterRepeatedTitle();
      if (recoveredSupplierRequirements) {
        supplierRequirements = recoveredSupplierRequirements;
      }
    }

    // 策略4（最后备用）：从部门后查找，但需要区分事由和要求
    // 只有当以上策略都失败时才使用此策略
    if (!projectReason && !supplierRequirements && requesterDepartment) {
      const deptIdx = lines.lastIndexOf(requesterDepartment);
      if (deptIdx >= 0) {
        // 收集部门后的所有长文本
        const textSegments: string[] = [];
        for (let i = deptIdx + 1; i < Math.min(lines.length, deptIdx + 20); i++) {
          const line = lines[i];
          // 跳过各种无关内容
          if (line === procurementTitle || KNOWN_CATEGORIES.includes(line)) continue;
          if (line.includes('.pdf') || line.includes('.docx') || line.match(/^\d+[\.\d]*[KM]$/)) continue;
          if (line.includes('/') && !line.includes('院') && !line.includes('部') && !line.includes('室')) continue;
          if (line === requesterName || line === requesterDepartment) continue;
          if (line.includes('接收人') || line.includes('来自') || line.match(/^\d{4}-\d{2}-\d{2}/) ||
              line.includes('[') || line.includes('|') || line.length < 5) continue;
          if (/^[\d\s|]+$/.test(line)) continue;
          if (line.length > 10) {
            textSegments.push(line);
          }
        }
        // 第一个长文本作为事由，第二个作为要求
        if (textSegments.length >= 1) {
          projectReason = textSegments[0];
        }
        if (textSegments.length >= 2) {
          supplierRequirements = textSegments[1];
        }
      }
    }


    let procurementCategory = '';
    // 策略1：查找标签后的值
    const categoryLabelIdx = lines.findIndex((line) => line.includes('采购类别'));
    if (categoryLabelIdx >= 0) {
      // 检查同行
      for (const cat of KNOWN_CATEGORIES) {
        if (lines[categoryLabelIdx].includes(cat)) {
          procurementCategory = cat;
          break;
        }
      }
      // 检查后续几行
      if (!procurementCategory) {
        for (let i = categoryLabelIdx + 1; i < Math.min(lines.length, categoryLabelIdx + 5); i++) {
          if (KNOWN_CATEGORIES.includes(lines[i])) {
            procurementCategory = lines[i];
            break;
          }
        }
      }
    }
    // 策略2：在整个文本中查找已知类别
    if (!procurementCategory) {
      for (const line of lines) {
        if (KNOWN_CATEGORIES.includes(line)) {
          procurementCategory = line;
          break;
        }
      }
    }

    // 8. 采购方式（采购需求表通常没有此字段，但保留逻辑）
    let procurementMethod = '';
    for (const line of lines) {
      for (const method of KNOWN_METHODS) {
        if (line.includes(method)) {
          procurementMethod = method;
          break;
        }
      }
      if (procurementMethod) break;
    }

    // 9. 所属项目/合同及编号
    let 所属项目 = '';
    let 合同及编号 = '';
    const projectContractIdx = lines.findIndex((line) => line.includes('所属项目') && !line.includes('申请'));
    if (projectContractIdx >= 0 && projectContractIdx + 1 < lines.length) {
      const valueLine = lines[projectContractIdx + 1];
      // 检查是否是下一个标签（申请立项事由等）
      if (!valueLine.includes('申请') && !valueLine.includes('情况说明')) {
        // 格式通常是 "项目名/合同编号"，如 "引大济岷/川水市场（2025）103号"
        const parts = valueLine.split('/');
        if (parts.length >= 2) {
          所属项目 = parts[0].trim();
          合同及编号 = parts.slice(1).join('/').trim();
        } else {
          // 如果没有"/"，整个作为项目名
          所属项目 = valueLine.trim();
        }
      }
    }

    const cleanText = (t: string) => t.replace(/\s+/g, ' ').trim();

    // 返回算法提取结果（暂时禁用AI复核）
    return {
      requesterName: cleanText(requesterName),
      requesterDepartment: cleanText(requesterDepartment),
      procurementTitle: cleanText(procurementTitle),
      projectReason: cleanText(projectReason),
      supplierRequirements: cleanText(supplierRequirements),
      budgetAmount,
      procurementCategory: cleanText(procurementCategory),
      procurementMethod: cleanText(procurementMethod),
 所属项目: cleanText(所属项目),
      合同及编号: cleanText(合同及编号),
    };

  }

  private async verifyDemandFieldsWithAI(
    originalText: string,
    algorithmResult: {
      requesterName: string;
      requesterDepartment: string;
      procurementTitle: string;
      projectReason: string;
      supplierRequirements: string;
      budgetAmount: number;
      procurementCategory: string;
      procurementMethod: string;
 所属项目: string;
      合同及编号: string;
    },
  ) {
    const systemPrompt = `你是一个采购需求表信息提取助手。你的任务是复核算法提取的结果，并根据PDF原文内容进行修正和补充。

【重要：文档结构认知】
采购需求申请表通常包含两个区域：
- 表单正文区（前部）：含申请采购事项名称、需求申请人、需求部门、预算金额、采购类别、采购方式、申请立项事由/情况说明、对供方的主要要求等核心字段
- 审批流转区（后部）：含审批人签字栏、审批意见（同意/不同意/条件同意等）、审批日期、签章等流程信息

请输出一个JSON对象，包含以下字段：
{
  "requesterName": "需求申请人姓名",
  "requesterDepartment": "需求部门",
  "procurementTitle": "申请采购事项名称",
  "projectReason": "申请立项事由/情况说明",
  "supplierRequirements": "对供方的主要要求",
  "budgetAmount": 采购预算价格(数字),
  "procurementCategory": "采购类别",
  "procurementMethod": "采购方式",
 所属项目": "所属项目名称",
  "合同及编号": "合同及编号"
}

规则：
1. 如果算法提取的字段值正确，保持不变
2. 如果算法提取的字段值为空或不正确，根据原文内容修正
3. 特别注意"申请立项事由/情况说明"和"对供方的主要要求"这两个字段，它们通常是多行文本
4. 所有字段都必须填写，如果原文中没有对应信息，填写空字符串
5. 只输出JSON，不要输出其他内容
6. ★★★ "申请立项事由/情况说明"和"对供方的主要要求"应从表单正文区提取，不得包含审批流转区中审批人的审批意见（如"同意""拟同意""建议补充XX"等）
7. ★★★ "需求申请人"应从表单正文区提取，不得误取审批流转区中的审批人姓名
8. ★★★ 审批流转区中的审批意见、审批人签名、日期等内容不属于任何采购信息字段，请勿混入`;

    const userPrompt = `以下是采购需求表PDF的原文内容：

${originalText}

以下是算法提取的结果：
${JSON.stringify(algorithmResult, null, 2)}

请复核并修正上述结果，输出正确的JSON。`;

    const response = await this.aiService.chatJson(systemPrompt, userPrompt, 0.3);

    try {
      const parsed = JSON.parse(response);
      return {
        requesterName: parsed.requesterName || algorithmResult.requesterName,
        requesterDepartment: parsed.requesterDepartment || algorithmResult.requesterDepartment,
        procurementTitle: parsed.procurementTitle || algorithmResult.procurementTitle,
        projectReason: parsed.projectReason || algorithmResult.projectReason,
        supplierRequirements: parsed.supplierRequirements || algorithmResult.supplierRequirements,
        budgetAmount: typeof parsed.budgetAmount === 'number' ? parsed.budgetAmount : algorithmResult.budgetAmount,
        procurementCategory: parsed.procurementCategory || algorithmResult.procurementCategory,
        procurementMethod: parsed.procurementMethod || algorithmResult.procurementMethod,
 所属项目: parsed.所属项目 || algorithmResult.所属项目,
        合同及编号: parsed.合同及编号 || algorithmResult.合同及编号,
      };
    } catch {
      // JSON解析失败，返回算法结果
      return algorithmResult;
    }
  }

  async extractDemandFromUploadedFile(
    file: Express.Multer.File,
    uploadedById?: string,
  ) {
    if (!file.mimetype.includes('pdf')) {
      throw new BadRequestException('请上传 PDF 文件。');
    }

    const { absolutePath, attachment } = await this.persistUploadedFile(
      file,
      'demand',
      uploadedById,
    );

    const extractedText = await this.extractFileText(
      absolutePath,
      file.mimetype,
      file.originalname,
    );

    return {
      fields: await this.extractDemandFieldsFromText(extractedText),
      attachment,
      extractedText,
    };
  }

  // ── CTS-EBS01 A-36/37 项目递交与受理留痕（申报人/时间、验证人/时间，双人分离）──

  /** 创建人递交项目送审；REJECTED 修正后可重新递交 */
  async submitForReview(projectId: string, user?: AuthenticatedUser) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { reviewStatus: true, status: true },
    });
    if (!item) throw new NotFoundException('未找到对应项目。');
    // 生命周期闸：已归档/回收项目不可递交（UI 同口径；API 侧收口防直调）
    if (item.status !== 'ACTIVE') {
      throw new BadRequestException({ error: '仅进行中的项目可递交审核，已归档/回收项目不可递交', code: 'INVALID_LIFECYCLE' });
    }
    if (item.reviewStatus === 'PENDING') {
      throw new BadRequestException({ error: '该项目已递交待审核，请勿重复递交', code: 'ALREADY_SUBMITTED' });
    }
    if (item.reviewStatus === 'APPROVED') {
      throw new BadRequestException({ error: '该项目已审核通过，无需再次递交', code: 'ALREADY_APPROVED' });
    }
    return this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: { reviewStatus: 'PENDING', submittedAt: new Date(), submittedById: user?.sub ?? null, reviewComment: null },
    });
  }

  /** leader/admin 受理审核；申报人与审核人分离（admin 复核不受限） */
  async reviewSubmission(projectId: string, dto: ReviewSubmissionDto, user?: AuthenticatedUser) {
    if (!user || !['leader', 'admin'].includes(user.role)) {
      throw new ForbiddenException({ error: '仅领导或管理员可受理审核', code: 'REVIEW_ROLE_FORBIDDEN' });
    }
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { reviewStatus: true, submittedById: true },
    });
    if (!item) throw new NotFoundException('未找到对应项目。');
    if (item.reviewStatus !== 'PENDING') {
      throw new BadRequestException({ error: '该项目不在待审核状态', code: 'NOT_PENDING_REVIEW' });
    }
    if (user.role !== 'admin' && item.submittedById === user.sub) {
      throw new BadRequestException({ error: '申报人与审核人不得为同一人，请由领导或管理员受理', code: 'SELF_REVIEW_FORBIDDEN' });
    }
    if (!dto.approve && !dto.comment?.trim()) {
      throw new BadRequestException({ error: '驳回必须填写理由', code: 'REJECT_REASON_REQUIRED' });
    }
    return this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: {
        reviewStatus: dto.approve ? 'APPROVED' : 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: user.sub,
        reviewComment: dto.comment?.trim() || null,
      },
    });
  }

  async updateStage(
    projectId: string,
    stageKey: string,
    dto: UpdateProjectStageDto,
  ) {
    const stage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: projectId, stageKey },
    });

    if (!stage) {
      throw new NotFoundException('未找到对应的项目阶段。');
    }

    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { currentStage: true },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    if (
      dto.status === PROJECT_STAGE_STATUS.COMPLETED &&
      project.currentStage !== stageKey
    ) {
      throw new BadRequestException('请先完成当前阶段后再推进下一阶段。');
    }

    // P1-12：阶段完成最小实质校验（与 UI 步骤检查口径一致——此前 0 文件/0 邀请/0 专家可空完成，
    // 一路放行到开标确认才发现缺前置，返工成本高）
    if (dto.status === PROJECT_STAGE_STATUS.COMPLETED) {
      // 制度硬闸（2026-08-27 拍板 #6）：立项须先「递交审核」并受理通过（reviewStatus=APPROVED），
      // 方可完成立项阶段进入采购文件编制——「立项批准后才能采购」从 AI 提示升级为硬控制。
      // 仅约束存在立项阶段的常规流程；小额采购（无 INITIATION 阶段）与已越过该阶段的存量不受影响。
      if (stageKey === 'INITIATION') {
        const pmi = await this.prisma.projectManagementItem.findUnique({
          where: { id: projectId },
          select: { reviewStatus: true },
        });
        if (pmi?.reviewStatus !== 'APPROVED') {
          throw new BadRequestException({
            error: '立项尚未受理审核通过（需先「递交审核」并由领导/管理员受理），不能完成立项阶段进入采购文件编制',
            code: 'INITIATION_NOT_APPROVED',
          });
        }
      }
      // DA/T 103-2024 前端控制（§4.1 + A.1a）：按归档范围表检查该阶段必选材料
      // （范围表 attachment 源必选项 = TENDER_DOCUMENT/AWARD_DECISION/CONTRACT 三处，与下方专项检查口径互补）
      // M5：显式豁免路径——确无材料（流标终止等）时 waiveArchiveGate=true + note 必填留痕，阶段可推进
      const gateMissing = await this.archiveScope.checkStageGate(projectId, stageKey);
      if (gateMissing.length > 0) {
        if (dto.waiveArchiveGate === true) {
          if (!dto.note?.trim()) {
            throw new BadRequestException('豁免归档材料检查必须填写豁免理由（note 字段留痕）');
          }
          this.logger.warn(
            `[归档闸门豁免] 项目 ${projectId} 阶段 ${stageKey} 缺件放行：${gateMissing.join('、')}；理由：${dto.note.trim()}`,
          );
        } else {
          throw new BadRequestException(
            `该阶段归档必选材料缺失（DA/T 103-2024 附录B）：${gateMissing.join('、')}，请上传后再标记完成；如确无此类材料（如流标终止），可传 waiveArchiveGate=true 并填写 note 豁免`,
          );
        }
      }
      if (stageKey === 'SUPPLIER_INVITATION') {
        // 完成门槛：确认参加的回执数量达到用户设定的满足数量（默认 3）即可标记完成。
        // 数量以 InvitationRsvp 实数核验（不信任前端计数）；达标蕴含通知已发出，原"须先发送邀请通知"核查被覆盖。
        // id 空间：回执的 projectId 为 BidProject id（邀请发起方），阶段接口收到的是 PMI id——两个空间都要数。
        const threshold = Math.min(Math.max(dto.confirmedThreshold ?? 3, 1), 50);
        const bpIds = await this.prisma.bidProject.findMany({
          where: { projectManagementItemId: projectId },
          select: { id: true },
        });
        const rsvpWhere = { OR: [{ projectId }, { projectId: { in: bpIds.map((b) => b.id) } }] };
        const [rsvps, accepted] = await Promise.all([
          this.prisma.invitationRsvp.count({ where: rsvpWhere }),
          this.prisma.invitationRsvp.count({ where: { ...rsvpWhere, status: 'ACCEPTED' } }),
        ]);
        if (rsvps === 0) throw new BadRequestException('请先通过供应商邀请向导发送邀请通知，再标记完成');
        if (accepted < threshold) {
          throw new BadRequestException(
            `供应商确认数量未达标：${accepted}/${threshold} 家已回执确认参加，达到「满足数量」后方可标记完成（可在确认页调整满足数量）`,
          );
        }
      }
      if (stageKey === 'EXPERT_SELECTION') {
        const bp = await this.prisma.bidProject.findFirst({ where: { projectManagementItemId: projectId }, select: { id: true } });
        if (bp) {
          const experts = await this.prisma.bidExpert.count({ where: { projectId: bp.id } });
          if (experts === 0) throw new BadRequestException('请先完成专家抽取，再标记完成');
        }
      }
    }

    const updatedStage = await this.prisma.projectManagementStage.update({
      where: { id: stage.id },
      data: {
        status: dto.status,
        note: dto.note?.trim() || null,
        completedAt:
          dto.status === PROJECT_STAGE_STATUS.COMPLETED ? new Date() : null,
      },
    });

    if (dto.status === PROJECT_STAGE_STATUS.COMPLETED) {
      const savedStages = await this.prisma.projectManagementStage.findMany({
        where: { projectManagementItemId: projectId },
        orderBy: { stageOrder: 'asc' },
      });
      const projectStages = Array.isArray(savedStages) && savedStages.length > 0
        ? savedStages
        : PROJECT_WORKFLOW_STAGES.map((stage, index) => ({
            stageKey: stage.key,
            stageOrder: index + 1,
          }));
      const currentIndex = projectStages.findIndex((item) => item.stageKey === stageKey);
      let nextStage = currentIndex >= 0 ? projectStages[currentIndex + 1] ?? null : null;
      while (nextStage && LOCKED_STAGES.has(nextStage.stageKey as typeof PROJECT_WORKFLOW_STAGES[number]['key'])) {
        await this.prisma.projectManagementStage.updateMany({
          where: { projectManagementItemId: projectId, stageKey: nextStage.stageKey },
          data: { status: PROJECT_STAGE_STATUS.COMPLETED, completedAt: new Date() },
        });
        const nextIndex = projectStages.findIndex((item) => item.stageKey === nextStage!.stageKey);
        nextStage = nextIndex >= 0 ? projectStages[nextIndex + 1] ?? null : null;
      }

      if (nextStage) {
        await this.prisma.projectManagementStage.updateMany({
          where: {
            projectManagementItemId: projectId,
            stageKey: nextStage.stageKey,
            status: PROJECT_STAGE_STATUS.NOT_STARTED,
          },
          data: { status: PROJECT_STAGE_STATUS.IN_PROGRESS },
        });
        await this.prisma.projectManagementItem.update({
          where: { id: projectId },
          data: { currentStage: nextStage.stageKey },
        });
      }

      await this.refreshProjectAnalysis(projectId);
    }

    return updatedStage;
  }

  /**
   * 重新打开已完成的步骤：目标步骤 → 进行中；同轮后续步骤及后续轮次全部 → 待解锁；
   * 项目指针（currentStage/currentRound）回退到该步骤。
   * 附件（已上传文件）与分析缓存（按 stageKey 键控）一律不动——文件在，分析结论保留。
   */
  async reopenStage(projectId: string, stageKey: string, round?: number) {
    const stage = await this.prisma.projectManagementStage.findFirst({
      where: {
        projectManagementItemId: projectId,
        stageKey,
        ...(round != null ? { round } : {}),
      },
    });
    if (!stage) throw new NotFoundException('未找到对应的项目阶段。');
    if (stage.status !== PROJECT_STAGE_STATUS.COMPLETED) {
      throw new BadRequestException('只有已完成的步骤才能重新设置为进行中。');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. 目标步骤 → 进行中（清除完成时间）
      await tx.projectManagementStage.update({
        where: { id: stage.id },
        data: { status: PROJECT_STAGE_STATUS.IN_PROGRESS, completedAt: null },
      });
      // 2. 同轮后续步骤 → 待解锁
      await tx.projectManagementStage.updateMany({
        where: {
          projectManagementItemId: projectId,
          round: stage.round,
          stageOrder: { gt: stage.stageOrder },
        },
        data: { status: PROJECT_STAGE_STATUS.NOT_STARTED, completedAt: null },
      });
      // 3. 后续轮次的全部步骤 → 待解锁（重开早轮步骤使再次采购轮失效）
      await tx.projectManagementStage.updateMany({
        where: {
          projectManagementItemId: projectId,
          round: { gt: stage.round },
        },
        data: { status: PROJECT_STAGE_STATUS.NOT_STARTED, completedAt: null },
      });
      // 4. 项目指针回退
      await tx.projectManagementItem.update({
        where: { id: projectId },
        data: {
          currentStage: stage.stageKey,
          ...(stage.round > 1 ? { currentRound: stage.round } : {}),
        },
      });
    });

    this.logger.log(`步骤重开：项目 ${projectId} 的 ${stageKey}(round=${stage.round}) → 进行中，后续步骤已重置为待解锁`);
    return { success: true };
  }

  async completeProject(projectId: string, dto: CompleteProjectDto, userId?: string) {
    if (!dto.confirmedCompleted) {
      throw new BadRequestException('请先确认项目已完成。');
    }

    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // allowIncomplete：流标归档等场景，跳过"合同完成"校验
    if (!dto.allowIncomplete && project.currentStage !== 'CONTRACT') {
      throw new BadRequestException('只有合同阶段完成后才允许归档。');
    }

    if (!project.departmentNumber || !project.departmentNumber.trim()) {
      throw new BadRequestException('请先在项目基本信息中填写部门编号后再完成归档。');
    }

    const stages = await this.prisma.projectManagementStage.findMany({
      where: { projectManagementItemId: projectId },
      include: { attachments: true },
      orderBy: { stageOrder: 'asc' },
    });

    const contractStage = stages.find((stage) => stage.stageKey === 'CONTRACT');
    if (
      !dto.allowIncomplete &&
      (!contractStage || contractStage.status !== PROJECT_STAGE_STATUS.COMPLETED)
    ) {
      throw new BadRequestException('合同阶段尚未完成。');
    }

    const archivedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const department = await tx.department.upsert({
        where: { name: project.requesterDepartment },
        update: {},
        create: { name: project.requesterDepartment },
      });

      const createdProject = await tx.project.create({
        data: {
          projectCode: `PM-${project.id}`,
          name: project.title,
          businessCategory: project.procurementCategory,
          description: project.projectReason,
          requestingDepartmentId: department.id,
        },
      });

      const procurementRound = await tx.procurementRound.create({
        data: {
          projectId: createdProject.id,
          roundNo: 1,
          procurementMethod: project.procurementMethod,
          departmentId: department.id,
          budgetAmount: project.budgetAmount,
          controlAmount: project.budgetAmount,
          awardAmount: project.contractAmount,
          resultStatus: ResultStatus.AWARDED,
          resultText: '项目已完成并归档',
          sourceType: SourceType.PROJECT_MANAGEMENT,
          createdById: userId,
          awardedSupplierName: project.awardedSupplier || null,
          expertInfo: project.expertInfo || null,
          biddingUnits: project.biddingUnits || null,
        },
      });

      return tx.projectManagementItem.update({
        where: { id: projectId },
        data: {
          status: PROJECT_MANAGEMENT_STATUS.ARCHIVED,
          archivedProcurementRoundId: procurementRound.id,
          archivedAt,
        },
      });
    });

    // Generate archive files in background with unique hook
    const archiveHook = `ARCHIVE-${projectId}-${Date.now()}`;
    this.generateArchiveFiles(project, stages, archivedAt, archiveHook).catch((err) => {
      this.logger.error('Failed to generate archive files:', err);
    });

    await this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: { archiveHook },
    });

    return result;
  }

  async updateExtractedInfo(
    projectId: string,
    dto: {
      title?: string;
      initiationDate?: string;
      evaluationMethod?: string;
      expertInfo?: string;
      biddingUnits?: string;
      awardedSupplier?: string;
      contractAmount?: number;
      demandProject?: string;
      demandContractNumber?: string;
      contractNumber?: string;
      departmentNumber?: string;
      projectOverview?: string;
      bidOpeningTime?: string;
      documentAcquireTime?: string;
      invitedSuppliers?: string;
      paymentPerformance?: string;
      requesterName?: string;
      requesterDepartment?: string;
      procurementMethod?: string;
      procurementCategory?: string;
      budgetAmount?: number;
      projectReason?: string;
      supplierRequirements?: string;
      implementerName?: string;
      contractPricingType?: string;
      sectionPlan?: string;
      activitySchedule?: string;
      riskMeasures?: string;
    },
  ) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    const updateData: Record<string, unknown> = {};

    if (dto.title !== undefined) {
      updateData.title = dto.title || null;
    }

    if (dto.initiationDate) {
      const parsedDate = new Date(dto.initiationDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        updateData.initiationDate = parsedDate;
      }
    }

    if (dto.evaluationMethod !== undefined) {
      updateData.evaluationMethod = dto.evaluationMethod;
    }

    if (dto.expertInfo !== undefined) {
      updateData.expertInfo = dto.expertInfo;
    }

    if (dto.biddingUnits !== undefined) {
      updateData.biddingUnits = dto.biddingUnits;
    }

    if (dto.awardedSupplier !== undefined) {
      updateData.awardedSupplier = dto.awardedSupplier;
    }

    if (dto.contractAmount !== undefined) {
      updateData.contractAmount = dto.contractAmount;
    }

    // B1（7.2.1.2）：采购方案要素可编辑
    for (const key of ['implementerName', 'contractPricingType', 'sectionPlan', 'activitySchedule', 'riskMeasures'] as const) {
      if (dto[key] !== undefined) {
        updateData[key] = dto[key] || null;
      }
    }

    if (dto.demandProject !== undefined) {
      updateData.demandProject = dto.demandProject || null;
    }

    if (dto.demandContractNumber !== undefined) {
      updateData.demandContractNumber = dto.demandContractNumber || null;
    }

    if (dto.contractNumber !== undefined) {
      updateData.contractNumber = dto.contractNumber || null;
    }

    if (dto.departmentNumber !== undefined) {
      updateData.departmentNumber = dto.departmentNumber || null;
    }

    if (dto.projectOverview !== undefined) {
      updateData.projectOverview = dto.projectOverview || null;
    }

    if (dto.bidOpeningTime !== undefined) {
      updateData.bidOpeningTime = dto.bidOpeningTime || null;
    }

    if (dto.documentAcquireTime !== undefined) {
      updateData.documentAcquireTime = dto.documentAcquireTime || null;
    }

    if (dto.invitedSuppliers !== undefined) {
      updateData.invitedSuppliers = dto.invitedSuppliers || null;
    }

    if (dto.paymentPerformance !== undefined) {
      updateData.paymentPerformance = dto.paymentPerformance || null;
    }

    // 项目基本信息字段（schema 中均为必填，空值不回写 null）
    if (dto.requesterName !== undefined) {
      updateData.requesterName = dto.requesterName;
    }

    if (dto.requesterDepartment !== undefined) {
      updateData.requesterDepartment = dto.requesterDepartment;
    }

    if (dto.procurementMethod !== undefined) {
      updateData.procurementMethod = dto.procurementMethod;
    }

    if (dto.procurementCategory !== undefined) {
      updateData.procurementCategory = dto.procurementCategory;
    }

    if (dto.budgetAmount !== undefined) {
      updateData.budgetAmount = dto.budgetAmount;
    }

    // 申请立项事由 / 对供方的主要要求（schema 非空，空值写空串）
    if (dto.projectReason !== undefined) {
      updateData.projectReason = dto.projectReason;
    }

    if (dto.supplierRequirements !== undefined) {
      updateData.supplierRequirements = dto.supplierRequirements;
    }

    return this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: updateData,
    });
  }

   
  /**
   * 提取并优化"申请立项事由 / 对供方的主要要求"：读 PROCUREMENT_DEMAND + INITIATION 两阶段
   * 上传文件的内容（优先 AI 分析缓存，无则回退附件原文），结合项目信息调 AI，仅返回不写库。
   */
  async optimizeInitiationFields(itemId: string): Promise<{ projectReason: string; supplierRequirements: string }> {
    const project = await this.prisma.projectManagementItem.findUnique({ where: { id: itemId } });
    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }
    const demandFileContext = await this.getStageFileContext(itemId, 'PROCUREMENT_DEMAND');
    const initiationFileContext = await this.getStageFileContext(itemId, 'INITIATION');
    return this.aiService.optimizeInitiationReasonAndRequirements({
      projectName: project.title,
      requesterName: project.requesterName,
      requesterDepartment: project.requesterDepartment,
      procurementMethod: project.procurementMethod || '',
      procurementCategory: project.procurementCategory || '',
      budgetAmount: project.budgetAmount ? Number(project.budgetAmount) : undefined,
      currentProjectReason: project.projectReason || '',
      currentSupplierRequirements: project.supplierRequirements || '',
      demandFileContext,
      initiationFileContext,
    });
  }

  /** 读取某阶段上传文件的内容上下文：优先 AI 分析缓存，回退附件原文（带截断保护）。 */
  private async getStageFileContext(itemId: string, stageKey: string): Promise<string> {
    try {
      const cachePath = getStageAnalysisCachePath(itemId, stageKey);
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
        files?: Array<{ fileName?: string; contentSummary?: string }>;
      };
      if (Array.isArray(cached.files) && cached.files.length > 0) {
        const parts = cached.files
          .map((f) => `【${f.fileName || '文件'}】${(f.contentSummary || '').trim()}`)
          .filter((p) => p.replace(/【.*?】/, '').trim().length > 0);
        if (parts.length > 0) return parts.join('\n\n').slice(0, 8000);
      }
    } catch {
      // 无分析缓存，回退原文
    }
    try {
      const stage = await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: itemId, stageKey },
        include: { attachments: true },
      });
      if (!stage || stage.attachments.length === 0) return '';
      const chunks: string[] = [];
      for (const a of stage.attachments.slice(0, 5)) {
        try {
          const buffer = await this.storage.download(a.objectKey);
          const txt = await this.documentParser.parse(buffer, a.mimeType, a.fileName);
          if (txt && txt.trim()) chunks.push(`【${a.fileName}】${txt.trim().slice(0, 4000)}`);
        } catch (e) {
          this.logger.warn(`[optimizeInitiation] 读取附件失败 ${a.fileName}: ${(e as Error)?.message}`);
        }
        if (chunks.join('\n').length > 10000) break;
      }
      return chunks.join('\n\n').slice(0, 10000);
    } catch (e) {
      this.logger.warn(`[optimizeInitiation] 阶段 ${stageKey} 原文读取失败: ${(e as Error)?.message}`);
      return '';
    }
  }

  private async generateArchiveFiles(project: any, stages: any[], archivedAt: Date, archiveHook: string) {
    // Primary archive path: project local directory (uploads/archive)
    const localArchiveBasePath = resolve(process.cwd(), 'uploads', 'archive');
    // Backup path: NAS storage
    const nasArchiveBasePath = process.env.NAS_PATH || '/home/swhi/nas_procurement';
    const nasArchivePath = join(nasArchiveBasePath, 'ProcurementData');

    const monthStr = `${archivedAt.getFullYear()}年${String(archivedAt.getMonth() + 1).padStart(2, '0')}月`;

    // Archive to local first
    const localMonthDir = join(localArchiveBasePath, monthStr);
    const localProjectDir = await this.createUniqueProjectDir(localMonthDir, project.title);

    // Archive to NAS backup (if available)
    const nasMonthDir = join(nasArchivePath, monthStr);
    let nasProjectDir: string | null = null;
    try {
      await access(nasArchiveBasePath);
      nasProjectDir = await this.createUniqueProjectDir(nasMonthDir, project.title);
    } catch {
      this.logger.warn(`NAS path ${nasArchiveBasePath} not available, skipping backup`);
    }

    // Create directory structure in both locations
    await mkdir(localProjectDir, { recursive: true });
    if (nasProjectDir) {
      await mkdir(nasProjectDir, { recursive: true });
    }

    // Load file analysis cache and project summary
    const summaryCachePath = getProjectSummaryCachePath(project.id);
    let summary = '';
    try {
      const cachedSummary = JSON.parse(await readFile(summaryCachePath, 'utf8')) as { summary?: string };
      summary = cachedSummary.summary || '';
    } catch {
      // No summary available
    }

    const stageAnalysisMap = new Map<string, Array<{ fileName: string; contentSummary: string }>>();
    for (const stage of stages) {
      const cachePath = getStageAnalysisCachePath(project.id, stage.stageKey);
      try {
        const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
          files?: Array<{ fileName: string; contentSummary: string }>;
        };
        if (Array.isArray(cached.files)) {
          stageAnalysisMap.set(stage.stageKey, cached.files);
        }
      } catch {
        // No cache
      }
    }

    const statusLabel = (s: string) => {
      if (s === 'COMPLETED') return '已完成';
      if (s === 'IN_PROGRESS') return '进行中';
      return '未开始';
    };

    const budgetStr = project.budgetAmount != null
      ? Number(project.budgetAmount).toLocaleString('zh-CN') + ' 元'
      : '暂缺';

    const contractAmountStr = project.contractAmount
      ? Number(project.contractAmount).toLocaleString('zh-CN') + ' 元'
      : '暂缺';

    // Copy files and build TXT content
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════');
    lines.push('          项目归档说明');
    lines.push('═══════════════════════════════════════');
    lines.push('');
    lines.push('【项目基本信息】');
    lines.push('');
    lines.push(`  项目名称：${project.title}`);
    lines.push(`  申  请  人：${project.requesterName}`);
    lines.push(`  申请部门：${project.requesterDepartment}`);
    lines.push(`  采购方式：${project.procurementMethod}`);
    lines.push(`  采购类别：${project.procurementCategory}`);
    lines.push(`  预算金额：${budgetStr}`);
    lines.push(`  申请立项事由：${project.projectReason || '待补充'}`);
    lines.push(`  对供方主要要求：${project.supplierRequirements || '无'}`);
    lines.push('');
    lines.push(`  立项时间：${project.initiationDate ? this.formatDate(project.initiationDate) : '暂缺'}`);
    lines.push(`  所属项目：${project.demandProject || '其他'}`);
    lines.push(`  合同编号：${project.contractNumber || project.demandContractNumber || '无'}`);
    lines.push(`  部门编号：${project.departmentNumber || '暂缺'}`);

    // 专家信息格式化：每行格式为 "姓名|部门|专业|职称"
    if (project.expertInfo) {
      const experts = project.expertInfo.split('\n').filter(Boolean);
      lines.push(`  专家信息：共 ${experts.length} 位专家`);
      for (const expert of experts) {
        const parts = expert.split('|');
        if (parts.length >= 4) {
          lines.push(`    ${parts[0]} - ${parts[1]} / ${parts[2]} / ${parts[3]}`);
        } else if (parts.length >= 1) {
          lines.push(`    ${parts[0]}`);
        }
      }
    } else {
      lines.push(`  专家信息：暂缺`);
    }

    // 投标单位格式化：用顿号分隔的单位列表
    if (project.biddingUnits) {
      const units = project.biddingUnits.split(/[、,\n]/).filter((u: string) => u.trim());
      lines.push(`  投标单位：共 ${units.length} 家单位`);
      for (const unit of units) {
        lines.push(`    ${unit.trim()}`);
      }
    } else {
      lines.push(`  投标单位：暂缺`);
    }

    lines.push(`  中标单位：${project.awardedSupplier || '暂缺'}`);
    lines.push(`  合同金额：${contractAmountStr}`);

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const localStageDir = join(localProjectDir, `${i + 1}.${stage.stageName}`);
      const nasStageDir = nasProjectDir ? join(nasProjectDir, `${i + 1}.${stage.stageName}`) : null;
      const analysisFiles = stageAnalysisMap.get(stage.stageKey) || [];

      lines.push('');
      lines.push('───────────────────────────────────────');
      lines.push('');
      lines.push(`【${stage.stageName}】（步骤 ${i + 1}/${stages.length}）${statusLabel(stage.status)}`);
      lines.push('');

      if (stage.attachments.length > 0) {
        // Create stage directory and copy files to both locations
        await mkdir(localStageDir, { recursive: true });
        if (nasStageDir) {
          await mkdir(nasStageDir, { recursive: true });
        }

        for (let j = 0; j < stage.attachments.length; j++) {
          const att = stage.attachments[j];
          const analysisFile = analysisFiles[j];

          if (j > 0) lines.push('');
          lines.push(`  文件${stage.attachments.length > 1 ? (j + 1) : ''}：${att.fileName}`);

          if (analysisFile) {
            lines.push('');
            lines.push('  文件分析：');
            lines.push(`  ${analysisFile.contentSummary}`);
          }

          const srcPath = resolve(process.cwd(), 'uploads', att.objectKey);
          // Copy to local archive
          const localDstPath = join(localStageDir, att.fileName);
          try { await copyFile(srcPath, localDstPath); } catch { /* skip if file missing */ }
          // Copy to NAS backup
          if (nasStageDir) {
            const nasDstPath = join(nasStageDir, att.fileName);
            try { await copyFile(srcPath, nasDstPath); } catch { /* skip if file missing */ }
          }
        }
      } else {
        lines.push('  文件：（无）');
      }
    }

    lines.push('');
    lines.push('═══════════════════════════════════════');
    lines.push(`          归档时间：${this.formatDate(archivedAt)}`);
    lines.push(`          归档标识：${archiveHook}`);
    lines.push('═══════════════════════════════════════');
    lines.push('');
    lines.push('【项目简报】');
    lines.push('');
    lines.push(summary || '暂无项目简报。');
    lines.push('');
    lines.push('═══════════════════════════════════════');

    // Write archive description to both locations
    await writeFile(join(localProjectDir, '项目归档说明.txt'), lines.join('\n'), 'utf8');
    if (nasProjectDir) {
      await writeFile(join(nasProjectDir, '项目归档说明.txt'), lines.join('\n'), 'utf8');
    }
  }

  private async createUniqueProjectDir(monthDir: string, projectTitle: string): Promise<string> {
    let projectDir = join(monthDir, projectTitle);
    let suffix = 1;
    while (true) {
      try {
        await access(projectDir);
        // Directory exists, try next suffix
        suffix += 1;
        projectDir = join(monthDir, `${projectTitle}（${suffix}）`);
      } catch {
        // Directory does not exist, use this path
        break;
      }
    }
    return projectDir;
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  async refreshProjectAnalysis(projectId: string) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      include: {
        stages: {
          orderBy: { stageOrder: 'asc' },
          include: { attachments: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    const summaryCachePath = getProjectSummaryCachePath(projectId);

    // Collect all attachments
    const allAttachments = project.stages.flatMap((stage) =>
      stage.attachments.map((attachment) => ({
        fileName: attachment.fileName,
        stageKey: stage.stageKey,
      })),
    );

    if (allAttachments.length === 0) {
      const emptySummary = '当前项目尚未上传可供分析的材料，暂无法生成项目简报。';
      await mkdir(getUploadDir(), { recursive: true });
      await writeFile(
        summaryCachePath,
        JSON.stringify({ summary: emptySummary }, null, 2),
        'utf8',
      );
      return;
    }

    // Read existing file analysis results from cache, or generate if not cached
    const fileAnalysisResults: Array<{ fileName: string; stageKey: string; contentSummary: string }> = [];
    for (const stage of project.stages) {
      if (stage.attachments.length === 0) continue;

      const stageAnalysisCachePath = getStageAnalysisCachePath(projectId, stage.stageKey);
      const fingerprint = buildStageAnalysisFingerprint(stage.stageKey, stage.attachments);

      let cachedFiles: Array<{
        objectKey: string;
        fileName: string;
        stageMatch: string;
        contentSummary: string;
      }> | null = null;

      // Try to read from cache
      try {
        const cached = JSON.parse(await readFile(stageAnalysisCachePath, 'utf8')) as {
          fingerprint?: string;
          files?: Array<{
            objectKey: string;
            fileName: string;
            stageMatch: string;
            contentSummary: string;
          }>;
        };
        if (cached.fingerprint === fingerprint && Array.isArray(cached.files)) {
          cachedFiles = cached.files;
        }
      } catch {
        // Cache doesn't exist or is invalid
      }

      // Generate analysis if no valid cache
      if (!cachedFiles) {
        const filesWithText = await Promise.all(
          stage.attachments.map(async (attachment) => {
            const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
            const extractedText = await this.extractFileTextWithOcr(
              filePath, attachment.mimeType, attachment.fileName,
            );
            return {
              objectKey: attachment.objectKey,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              fileSize: attachment.fileSize,
              createdAt: attachment.createdAt?.toISOString() ?? null,
              extractedText,
            };
          }),
        );

        if (filesWithText.length > 0) {
          const analysis = await this.aiService.analyzeProjectDetail({
            project: {
              id: project.id,
              title: project.title,
              requesterName: project.requesterName,
              requesterDepartment: project.requesterDepartment,
              procurementMethod: project.procurementMethod,
              procurementCategory: project.procurementCategory,
              currentStage: project.currentStage,
              projectReason: project.projectReason,
              supplierRequirements: project.supplierRequirements,
            },
            currentStage: {
              stageKey: stage.stageKey,
              stageName: stage.stageName,
              status: stage.status,
            },
            files: filesWithText,
          });

          cachedFiles = analysis.fileAnalyses.map((file) => ({
            objectKey: file.objectKey,
            fileName: file.fileName,
            stageMatch: normalizeStageMatchText(file.stageMatch),
            contentSummary: file.contentSummary,
          }));

          // Cache the stage analysis
          await mkdir(getUploadDir(), { recursive: true });
          await writeFile(
            stageAnalysisCachePath,
            JSON.stringify({ fingerprint, files: cachedFiles }, null, 2),
            'utf8',
          );
        }
      }

      if (cachedFiles) {
        for (const file of cachedFiles) {
          fileAnalysisResults.push({
            fileName: file.fileName,
            stageKey: stage.stageKey,
            contentSummary: file.contentSummary,
          });
        }
      }
    }

    // Check if all stages are completed (project is archived)
    const contractStage = project.stages.find((s) => s.stageKey === 'CONTRACT');
    const isCompleted = contractStage?.status === 'COMPLETED';

    // Generate summary based on project info and file analysis results
    const summary = await this.aiService.generateProjectSummary({
      project: {
        title: project.title,
        requesterName: project.requesterName,
        requesterDepartment: project.requesterDepartment,
        procurementMethod: project.procurementMethod,
        procurementCategory: project.procurementCategory,
        currentStage: project.currentStage,
        projectReason: project.projectReason,
        supplierRequirements: project.supplierRequirements,
        awardedSupplier: project.awardedSupplier || undefined,
        contractAmount: project.contractAmount ?? undefined,
        budgetAmount: project.budgetAmount ?? undefined,
        expertInfo: project.expertInfo || undefined,
        biddingUnits: project.biddingUnits || undefined,
      },
      fileAnalysisResults,
      isCompleted,
    });

    await mkdir(getUploadDir(), { recursive: true });
    await writeFile(
      summaryCachePath,
      JSON.stringify({ summary }, null, 2),
      'utf8',
    );

    return { summary };
  }

  async auditStageCompliance(projectId: string, stageKey?: string, force = false) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      include: {
        stages: {
          orderBy: { stageOrder: 'asc' },
          include: { attachments: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    const targetStage = stageKey
      ? project.stages.find((s) => s.stageKey === stageKey) ?? project.stages[0]
      : project.stages[0];

    if (!targetStage) {
      throw new NotFoundException('未找到项目阶段。');
    }

    // 检查合规审查缓存：指纹匹配时直接返回
    const complianceCachePath = getComplianceCachePath(projectId, targetStage.stageKey);

    // 步骤分析 fingerprint（供应商邀请/专家抽取）：名单变更 → 合规缓存失效
    let stepFingerprint = '';
    if (targetStage.stageKey === 'SUPPLIER_INVITATION' || targetStage.stageKey === 'EXPERT_SELECTION') {
      const rosterRaw = targetStage.stageKey === 'EXPERT_SELECTION'
        ? (project.expertInfo ?? '').trim()
        : (project.invitedSuppliers ?? '').trim();
      if (rosterRaw) {
        stepFingerprint = createHash('sha256').update(rosterRaw).digest('hex').slice(0, 16);
      }
    }
    const fingerprint = buildStageAnalysisFingerprint(targetStage.stageKey, targetStage.attachments) + (stepFingerprint ? `|step:${stepFingerprint}` : '');
    if (!force) {
      try {
        const cached = JSON.parse(await readFile(complianceCachePath, 'utf8')) as {
          fingerprint?: string;
          results?: unknown;
          summary?: string;
        };
        if (cached.fingerprint === fingerprint && cached.results && cached.summary) {
          // 兜底：历史缓存可能含 U+FFFD 乱码（修复前写入），返回前剔除，绝不让 � 落到前端
          const strip = (s: string) => s.replace(/�/g, '').replace(/[\uDC00-\uDFFF]/g, '');
          const results = Array.isArray(cached.results)
            ? cached.results.map((r: any) => ({
                ...r,
                evidence: strip(String(r?.evidence ?? '')),
                suggestion: strip(String(r?.suggestion ?? '')),
              }))
            : cached.results;
          return { results, summary: strip(cached.summary) };
        }
      } catch {
        // 缓存不存在或无效，继续调用 AI
      }
    }

    // 加载该阶段的合规审查规则
    // C4：DB 覆盖层优先，空则回退内置表（消费口径不变，仍为 checkpoints 数组）
    const { checkpoints } = await this.stageCompliance.getRules(targetStage.stageKey);

    // 收集当前阶段的文件分析结果（如果有缓存）
    const stageFiles: Array<{ fileName: string; stageMatch: string; contentSummary: string }> = [];
    if (targetStage.attachments.length > 0) {
      const cachePath = getStageAnalysisCachePath(projectId, targetStage.stageKey);
      try {
        const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
          files?: Array<{ objectKey: string; fileName: string; stageMatch: string; contentSummary: string }>;
        };
        if (Array.isArray(cached.files)) {
          stageFiles.push(...cached.files.map(f => ({
            fileName: f.fileName,
            stageMatch: f.stageMatch,
            contentSummary: f.contentSummary,
          })));
        }
      } catch {
        // 无缓存时使用附件列表
        stageFiles.push(...targetStage.attachments.map(a => ({
          fileName: a.fileName,
          stageMatch: '未分析',
          contentSummary: '暂未进行AI文件分析',
        })));
      }
    }

    // 步骤分析内容（供应商邀请/专家抽取阶段，从缓存读取，作为合规审查补充上下文）
    let stepAnalysisContent: string | undefined;
    if (targetStage.stageKey === 'SUPPLIER_INVITATION' || targetStage.stageKey === 'EXPERT_SELECTION') {
      try {
        const stepCache = JSON.parse(await readFile(getStepAnalysisCachePath(projectId, targetStage.stageKey), 'utf8')) as { content?: string };
        if (stepCache.content?.trim()) {
          stepAnalysisContent = stepCache.content.trim();
        }
      } catch {
        // 步骤分析未生成/缓存不存在，跳过
      }
    }

    const result = await this.aiService.auditStageCompliance({
      stageKey: targetStage.stageKey,
      stageName: targetStage.stageName,
      checkpoints,
      project: {
        title: project.title,
        requesterName: project.requesterName,
        requesterDepartment: project.requesterDepartment,
        procurementMethod: project.procurementMethod || '',
        procurementCategory: project.procurementCategory || '',
        currentStage: project.currentStage || '',
        projectReason: project.projectReason || '',
        supplierRequirements: project.supplierRequirements || '',
        budgetAmount: project.budgetAmount ? Number(project.budgetAmount) : undefined,
        contractAmount: project.contractAmount ? Number(project.contractAmount) : undefined,
        awardedSupplier: project.awardedSupplier || undefined,
        expertInfo: project.expertInfo || undefined,
        biddingUnits: project.biddingUnits || undefined,
      },
      files: stageFiles,
      stepAnalysis: stepAnalysisContent,
    });

    // 写入合规审查缓存（含指纹）
    await mkdir(getUploadDir(), { recursive: true });
    await writeFile(
      complianceCachePath,
      JSON.stringify({ fingerprint, results: result.results, summary: result.summary }, null, 2),
      'utf8',
    );

    return result;
  }

  /**
   * 步骤分析：为 SUPPLIER_INVITATION / EXPERT_SELECTION 生成「抽取过程 + 最终名单」叙述段落。
   * 数据源：item.invitedSuppliers / item.expertInfo（不依赖文件）。
   */
  /** 步骤分析阶段元数据：每阶段的分析要点（按各阶段实际情况定制） */
  private static readonly STAGE_ANALYSIS_META: Record<string, { label: string; focus: string }> = {
    PROCUREMENT_DEMAND: { label: '采购需求', focus: '需求来源与内容（需求申请要点、提出部门与经办人、预算规模与资金性质）' },
    INITIATION: { label: '采购立项', focus: '立项事由与审批（立项依据、递交审核与受理结果、供方要求、预算审定）' },
    TENDER_DOCUMENT: { label: '采购文件', focus: '采购文件编制（文件构成、资格与评审要点、采购组织形式与计价方式）' },
    SUPPLIER_INVITATION: { label: '供应商邀请', focus: '邀请过程与名单（选取方式、逐家确认状态）' },
    EXPERT_SELECTION: { label: '专家抽取', focus: '抽取过程与名单（配额/随机/回避原则、专家信息）' },
    BID_EVALUATION: { label: '开标评标', focus: '开评标过程（开标时间、参评供应商与评审结果）' },
    AWARD_DECISION: { label: '定标', focus: '定标结果（成交供应商、成交金额、定标依据）' },
    CONTRACT: { label: '合同', focus: '合同签订（合同编号、合同金额、与定标结果一致性）' },
  };

  async analyzeStep(projectId: string, stageKey: string, forceRefresh = false): Promise<{ content: string; empty: boolean }> {
    const meta = ProjectManagementService.STAGE_ANALYSIS_META[stageKey];
    if (!meta) {
      throw new BadRequestException('未知的项目阶段。');
    }

    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      include: { stages: { where: { stageKey }, select: { status: true, attachments: { select: { fileName: true } } } } },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }
    // 步骤分析仅对已完成阶段开放（与前端闸门一致，防直调 API 绕过）：进行中/待解锁数据未定型
    if (project.stages[0]?.status !== 'COMPLETED') {
      return { content: '', empty: true };
    }
    const attachmentNames = (project.stages[0]?.attachments ?? []).map((a) => a.fileName);

    // ── 按阶段构建分析数据（各取真实链路）──
    const isExpert = stageKey === 'EXPERT_SELECTION';
    let rosterRaw = '';
    let stageContext = `当前阶段：${meta.label}（${stageKey}）。采购方式：${project.procurementMethod || '未知'}。`;

    if (isExpert) {
      rosterRaw = (project.expertInfo ?? '').trim();
    } else if (stageKey === 'SUPPLIER_INVITATION') {
      // 供应商邀请：invitedSuppliers 快照字段由邀请通知发送时累计写入（ai.service 2026-09-01 补链）；
      // 存量/直改数据可能仍空 → 兜底改用 InvitationRsvp 真实链路数据（通知名单 + 逐家确认状态，
      // 含正选/补选/采购端手动标记，兼容 PMI/BP 两个 id 空间）
      const bpIds = await this.prisma.bidProject.findMany({
        where: { projectManagementItemId: projectId },
        select: { id: true },
      });
      const rsvps = await this.prisma.invitationRsvp.findMany({
        where: { OR: [{ projectId }, { projectId: { in: bpIds.map((b) => b.id) } }] },
        orderBy: { createdAt: 'asc' },
        select: { supplierName: true, status: true, note: true },
      });
      const statusLabel: Record<string, string> = { ACCEPTED: '已确认参加', DECLINED: '已放弃', PENDING: '待确认' };
      rosterRaw = rsvps
        .map((r) => `${r.supplierName}（${statusLabel[r.status] ?? r.status}${r.note ? `；备注：${r.note}` : ''}）`)
        .join('、');
    } else if (stageKey === 'BID_EVALUATION' || stageKey === 'AWARD_DECISION') {
      // 开评标/定标：BidProject 及其评审/成交数据
      const bp = await this.prisma.bidProject.findFirst({
        where: { projectManagementItemId: projectId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, stage: true, openTime: true, deadline: true, evaluationMethod: true,
        },
      });
      const parts: string[] = [];
      if (bp) {
        const stageLabel: Record<string, string> = { DOWNLOAD: '标书下载', SUBMIT: '投标递交', OPENING: '开标中', EVALUATING: '评标中', ARCHIVED: '已归档' };
        parts.push(`招标项目当前状态：${stageLabel[bp.stage] ?? bp.stage}`);
        if (bp.openTime) parts.push(`开标时间：${bp.openTime.toISOString().slice(0, 16).replace('T', ' ')}`);
        if (bp.deadline) parts.push(`截标时间：${bp.deadline.toISOString().slice(0, 16).replace('T', ' ')}`);
        if (bp.evaluationMethod) parts.push(`评标办法：${bp.evaluationMethod}`);
        // 参评供应商 + 评审得分排名（按分数降序）
        const [bidSuppliers, evalResults] = await Promise.all([
          this.prisma.bidSupplier.findMany({ where: { projectId: bp.id }, select: { supplierName: true } }),
          this.prisma.bidEvaluationResult.findMany({
            where: { projectId: bp.id },
            orderBy: { totalScore: 'desc' },
            select: { supplierName: true, totalScore: true, averageScore: true, bidPrice: true },
          }),
        ]);
        if (bidSuppliers.length > 0) parts.push(`参评供应商：${bidSuppliers.map((s) => s.supplierName).join('、')}`);
        if (evalResults.length > 0) {
          parts.push(`评审结果（按总分降序）：${evalResults.map((r) => `${r.supplierName} ${Number(r.totalScore)}分${r.bidPrice != null ? `/报价${Number(r.bidPrice).toLocaleString('zh-CN')}元` : ''}`).join('、')}`);
        }
      }
      if (stageKey === 'AWARD_DECISION') {
        if (project.awardedSupplier) parts.push(`成交供应商：${project.awardedSupplier}`);
        if (project.contractAmount) parts.push(`成交金额：${Number(project.contractAmount).toLocaleString('zh-CN')} 元`);
        if (project.biddingUnits) parts.push(`中标单位：${project.biddingUnits}`);
      }
      rosterRaw = parts.join('；');
    } else {
      // 需求/立项/采购文件/合同：以 PMI 阶段相关字段 + 阶段附件文件名构成
      const parts: string[] = [];
      if (stageKey === 'PROCUREMENT_DEMAND') {
        if (project.demandProcurementTitle) parts.push(`需求事项：${project.demandProcurementTitle}`);
        if (project.demandRequesterName || project.demandDepartment) parts.push(`需求提出：${project.demandRequesterName ?? ''}${project.demandDepartment ? `（${project.demandDepartment}）` : ''}`);
        if (project.demandBudgetAmount) parts.push(`需求预算：${Number(project.demandBudgetAmount).toLocaleString('zh-CN')} 元`);
        if (project.demandProjectReason) parts.push(`需求说明：${project.demandProjectReason.slice(0, 400)}`);
      }
      if (stageKey === 'INITIATION') {
        const reviewLabel: Record<string, string> = { PENDING: '待受理', APPROVED: '已受理通过', REJECTED: '已驳回' };
        if (project.projectReason) parts.push(`立项事由：${project.projectReason.slice(0, 400)}`);
        if (project.supplierRequirements) parts.push(`供方要求：${project.supplierRequirements.slice(0, 300)}`);
        if (project.initiationDate) parts.push(`立项日期：${project.initiationDate.toISOString().slice(0, 10)}`);
        if (project.reviewStatus) parts.push(`递交审核：${reviewLabel[project.reviewStatus] ?? project.reviewStatus}`);
      }
      if (stageKey === 'TENDER_DOCUMENT') {
        if (project.procurementOrganizationForm) parts.push(`采购组织形式：${project.procurementOrganizationForm}`);
        if (project.projectOverview) parts.push(`采购概况：${project.projectOverview.slice(0, 400)}`);
        if (project.bidOpeningTime) parts.push(`开标时间：${project.bidOpeningTime}`);
      }
      if (stageKey === 'CONTRACT') {
        if (project.contractNumber) parts.push(`合同编号：${project.contractNumber}`);
        if (project.contractAmount) parts.push(`合同金额：${Number(project.contractAmount).toLocaleString('zh-CN')} 元`);
        if (project.awardedSupplier) parts.push(`签约供应商：${project.awardedSupplier}`);
      }
      if (project.budgetAmount && stageKey !== 'PROCUREMENT_DEMAND') parts.push(`预算金额：${Number(project.budgetAmount).toLocaleString('zh-CN')} 元`);
      rosterRaw = parts.join('；');
    }

    // 附件清单并入（各阶段通用事实材料）
    if (attachmentNames.length > 0) {
      rosterRaw += `${rosterRaw ? '；' : ''}本阶段归档材料：${attachmentNames.join('、')}`;
    }

    if (!rosterRaw) {
      return { content: '', empty: true };
    }

    // fingerprint = 阶段数据原文 hash（数据变更即失效）
    const fingerprint = createHash('sha256').update(rosterRaw).digest('hex').slice(0, 16);

    // 读缓存
    const cachePath = getStepAnalysisCachePath(projectId, stageKey);
    if (!forceRefresh) {
      try {
        const cached = JSON.parse(await readFile(cachePath, 'utf8')) as { fingerprint?: string; content?: string };
        if (cached.fingerprint === fingerprint && cached.content) {
          return { content: cached.content, empty: false };
        }
      } catch {
        // 缓存不存在，继续生成
      }
    }

    // 构建 LLM prompt（阶段要点由元数据字典驱动）
    const systemPrompt = [
      '你是四川省水利发展集团有限公司招采ERP的 AI 采购步骤分析助手。请根据提供的项目信息与本阶段实际数据，',
      `生成一段描述「${meta.label}」步骤开展情况的分析文字。本阶段分析要点：${meta.focus}。`,
      '',
      '输出要求：',
      '1. 分为两段自然语言段落（用空行分隔），不要使用标题、编号或 Markdown 格式。',
      `2. 第一段「过程综述」：围绕${meta.label}阶段的实际数据描述该步骤如何开展（${isExpert ? '专家抽取涵盖专业配额/随机抽取或智能抽取/回避原则/需求方代表等' : '结合提供的项目字段、时间、状态与材料事实'}）。`,
      '3. 第二段直接逐项陈述关键对象与结果，首词即事实本身——严禁任何引导句开头（如「关键事实如下：」「本阶段关键事实包括：」「主要情况：」等），也不得输出「、」等残留列表符（名单类逐家说明：供应商含确认状态，专家含姓名/部门/专业/职称；结果类含成交供应商与金额等）。',
      '4. 只描述提供数据中的事实，不得编造未提供的内容。',
      '5. 总字数控制在 200-400 字。',
    ].join('\n');

    // 解析专家名单（pipe 分隔 → 可读文本）
    let rosterText: string;
    if (isExpert) {
      const experts = rosterRaw.split('\n').filter(l => l.trim()).map(line => {
        const p = line.split('|');
        return { name: p[0]?.trim() ?? '', dept: p[1]?.trim() ?? '', spec: p[2]?.trim() ?? '', title: p[3]?.trim() ?? '', role: p[4]?.trim() ?? '' };
      });
      rosterText = experts.map(e => `${e.name}（${e.dept}/${e.spec}/${e.title}${e.role ? '/' + e.role : ''}）`).join('、');
    } else {
      rosterText = rosterRaw;
    }

    const userPrompt = [
      `项目名称：${project.title}`,
      stageContext,
      `项目概况：${project.projectOverview || '未提供'}`,
      `立项事由：${project.projectReason || '未提供'}`,
      `供应商要求：${project.supplierRequirements || '未提供'}`,
      '',
      `=== 最终名单数据 ===`,
      rosterText,
    ].join('\n');

    let content = await this.aiService.chat(systemPrompt, userPrompt, 0.4);
    // 格式收敛：剥离违规引导句（「关键事实如下：」「本阶段关键事实包括：」等）与残留顿号开头（单测锁定 5 类样例）
    content = content
      .replace(/^(?:[一二三四五六七八九十]{0,3}\s*段?[：:]\s*)?(?:本阶段|本次|其中|主要)?(?:关键事实|关键情况|主要事实)(?:包括|如下|概述|总结)?[：:]?\s*[、，,]?\s*/g, '')
      .replace(/\n\s*\n\s*(?:[一二三四五六七八九十]{0,3}\s*段?[：:]\s*)?(?:本阶段|本次|其中|主要)?(?:关键事实|关键情况|主要事实)(?:包括|如下|概述|总结)?[：:]?\s*[、，,]?\s*/g, '\n\n')
      .replace(/(?:^|\n)\s*[、，,;；]\s*/g, (m) => (m.startsWith('\n') ? '\n' : ''))
      .trim();

    // 写缓存
    await mkdir(getUploadDir(), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ fingerprint, content }, null, 2), 'utf8');

    return { content, empty: false };
  }

  async analyzeProject(projectId: string, stageKey?: string, forceRefresh = false) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      include: {
        stages: {
          orderBy: { stageOrder: 'asc' },
          include: { attachments: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // Load the project summary from cache, or generate if missing (but only when there are files to analyze)
    const summaryCachePath = getProjectSummaryCachePath(project.id);
    let summary = '';
    let summaryFromCache = false;

    if (!forceRefresh) {
      try {
        const cachedSummary = JSON.parse(
          await readFile(summaryCachePath, 'utf8'),
        ) as { summary?: string };
        if (cachedSummary.summary?.trim()) {
          summary = cachedSummary.summary;
          summaryFromCache = true;
        }
      } catch {
        // will generate below if file analyses are available
      }
    }

    // Collect file analyses from relevant stages
    const allFileAnalyses: Array<{
      objectKey: string;
      fileName: string;
      stageMatch: string;
      contentSummary: string;
    }> = [];

    const stagesToAnalyze = stageKey
      ? project.stages.filter((s) => s.stageKey === stageKey)
      : project.stages;

    for (const stage of stagesToAnalyze) {
      if (stage.attachments.length === 0) continue;

      const cachePath = getStageAnalysisCachePath(project.id, stage.stageKey);
      const fingerprint = buildStageAnalysisFingerprint(stage.stageKey, stage.attachments);

      let stageFiles: Array<{
        objectKey: string;
        fileName: string;
        stageMatch: string;
        contentSummary: string;
      }> | null = null;

      // Try cache first (exact fingerprint match)
      const cachedByKey = new Map<string, { objectKey: string; fileName: string; stageMatch: string; contentSummary: string }>();
      if (!forceRefresh) {
        try {
          const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
            fingerprint?: string;
            files?: Array<{
              objectKey: string;
              fileName: string;
              stageMatch: string;
              contentSummary: string;
            }>;
          };
          if (cached.fingerprint === fingerprint && Array.isArray(cached.files)) {
            stageFiles = cached.files;
          } else if (Array.isArray(cached.files)) {
            // Fingerprint mismatch but cache exists — record existing analyses by objectKey
            for (const f of cached.files) {
              cachedByKey.set(f.objectKey, f);
            }
          }
        } catch {
          // No cache or invalid cache
        }
      }

      // Generate if no valid cache
      if (!stageFiles) {
        // Only analyze files that aren't already in the cache (incremental)
        const newAttachments = stage.attachments.filter((a) => !cachedByKey.has(a.objectKey));

        let newFileAnalyses: Array<{ objectKey: string; fileName: string; stageMatch: string; contentSummary: string }> = [];
        if (newAttachments.length > 0) {
          const newFilesWithText = await Promise.all(
            newAttachments.map(async (attachment) => {
              const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
              const extractedText = await this.extractFileTextWithOcr(
                filePath, attachment.mimeType, attachment.fileName,
              );
              return {
                objectKey: attachment.objectKey,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                fileSize: attachment.fileSize,
                createdAt: attachment.createdAt?.toISOString() ?? null,
                extractedText,
              };
            }),
          );

          if (newFilesWithText.length > 0) {
            const analysis = await this.aiService.analyzeProjectDetail({
              project: {
                id: project.id,
                title: project.title,
                requesterName: project.requesterName,
                requesterDepartment: project.requesterDepartment,
                procurementMethod: project.procurementMethod,
                procurementCategory: project.procurementCategory,
                currentStage: project.currentStage,
                projectReason: project.projectReason,
                supplierRequirements: project.supplierRequirements,
              },
              currentStage: {
                stageKey: stage.stageKey,
                stageName: stage.stageName,
                status: stage.status,
              },
              files: newFilesWithText,
            });

            newFileAnalyses = analysis.fileAnalyses.map((file) => ({
              ...file,
              stageMatch: normalizeStageMatchText(file.stageMatch),
            }));
          }
        }

        // Merge cached (still-existing) + new analyses, preserving attachment order
        const newAnalysisByKey = new Map<string, typeof newFileAnalyses[number]>();
        for (const f of newFileAnalyses) {
          newAnalysisByKey.set(f.objectKey, f);
        }

        stageFiles = [];
        for (const attachment of stage.attachments) {
          const cached = cachedByKey.get(attachment.objectKey);
          if (cached) {
            stageFiles.push(cached);
          } else {
            const newAnalysis = newAnalysisByKey.get(attachment.objectKey);
            if (newAnalysis) {
              stageFiles.push(newAnalysis);
            }
          }
        }

        if (stageFiles.length > 0 || stage.attachments.length === 0) {
          // Cache the stage analysis
          await mkdir(getUploadDir(), { recursive: true });
          await writeFile(cachePath, JSON.stringify({ fingerprint, files: stageFiles }, null, 2), 'utf8');
        }
      }

      if (stageFiles) {
        allFileAnalyses.push(...stageFiles.map((f) => ({
          ...f,
          stageMatch: normalizeStageMatchText(f.stageMatch),
        })));
      }
    }

    // If summary was NOT loaded from cache AND we have file analyses, auto-generate summary
    if (!summaryFromCache && allFileAnalyses.length > 0) {
      try {
        const contractStage = project.stages.find((s) => s.stageKey === 'CONTRACT');
        const isCompleted = contractStage?.status === 'COMPLETED';
        const generated = await this.aiService.generateProjectSummary({
          project: {
            title: project.title,
            requesterName: project.requesterName,
            requesterDepartment: project.requesterDepartment,
            procurementMethod: project.procurementMethod,
            procurementCategory: project.procurementCategory,
            currentStage: project.currentStage,
            projectReason: project.projectReason,
            supplierRequirements: project.supplierRequirements,
            awardedSupplier: project.awardedSupplier || undefined,
            budgetAmount: project.budgetAmount ? Number(project.budgetAmount) : undefined,
            contractAmount: project.contractAmount ? Number(project.contractAmount) : undefined,
            expertInfo: project.expertInfo || undefined,
            biddingUnits: project.biddingUnits || undefined,
          },
          fileAnalysisResults: allFileAnalyses.map(f => ({
            fileName: f.fileName,
            stageKey: f.stageMatch,
            contentSummary: f.contentSummary,
          })),
          isCompleted,
        });
        summary = generated;
        // Cache the generated summary
        await mkdir(getUploadDir(), { recursive: true });
        await writeFile(summaryCachePath, JSON.stringify({ summary: generated }, null, 2), 'utf8');
      } catch {
        summary = '项目简报生成中，请稍后点击刷新。';
      }
    }

    if (!summary) {
      summary = '当前还没有可供分析的项目文件内容。';
    }

    return {
      summary: {
        stageMatch: '项目简报',
        contentSummary: summary,
      },
      fileAnalyses: allFileAnalyses,
    };
  }

  async getProjectSummary(projectId: string) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    const summaryCachePath = getProjectSummaryCachePath(projectId);

    try {
      const cachedSummary = JSON.parse(
        await readFile(summaryCachePath, 'utf8'),
      ) as { summary?: string };
      return { summary: cachedSummary.summary || '暂无项目简报信息。' };
    } catch {
      return { summary: '暂无项目简报信息。' };
    }
  }

  /**
   * Get archive detail for a procurement round (from archived project management item)
   * Reads and parses the archived TXT file
   */
  async getArchiveDetail(procurementRoundId: string) {
    // Find the project management item that was archived to this procurement round
    const pmItem = await this.prisma.projectManagementItem.findFirst({
      where: { archivedProcurementRoundId: procurementRoundId },
      include: {
        stages: {
          orderBy: { stageOrder: 'asc' },
          include: { attachments: true },
        },
      },
    });

    if (!pmItem) {
      throw new NotFoundException('未找到对应的归档项目。');
    }

    // Find the archive TXT file
    // Primary path: local archive (uploads/archive)
    const localArchiveBasePath = resolve(process.cwd(), 'uploads', 'archive');
    // Backup path: NAS storage
    const nasArchiveBasePath = process.env.NAS_PATH || '/home/swhi/nas_procurement';
    const nasArchivePath = join(nasArchiveBasePath, 'ProcurementData');

    const archivedAt = pmItem.archivedAt;
    if (!archivedAt) {
      throw new NotFoundException('项目尚未归档。');
    }

    const monthStr = `${archivedAt.getFullYear()}年${String(archivedAt.getMonth() + 1).padStart(2, '0')}月`;
    const localMonthDir = join(localArchiveBasePath, monthStr);
    const nasMonthDir = join(nasArchivePath, monthStr);

    // Use archiveHook to find the correct directory (unique identifier)
    let txtPath: string | null = null;
    let projectDir: string | null = null;

    // Search for directory containing the archive hook in its TXT file
    // This ensures we find the correct archive even with duplicate project names
    const searchDirs = [pmItem.title];
    for (let suffix = 1; suffix < 100; suffix++) {
      searchDirs.push(`${pmItem.title}（${suffix}）`);
    }

    const archiveHook = pmItem.archiveHook;

    // Try local first, then NAS
    const searchLocations = [
      { monthDir: localMonthDir, label: 'local' },
      { monthDir: nasMonthDir, label: 'nas' },
    ];

    for (const location of searchLocations) {
      for (const dirName of searchDirs) {
        const candidateDir = join(location.monthDir, dirName);
        const candidateTxt = join(candidateDir, '项目归档说明.txt');
        try {
          await access(candidateTxt);
          const txtContent = await readFile(candidateTxt, 'utf8');
          // If archiveHook exists, match by hook; otherwise fall back to name matching
          if (archiveHook) {
            if (txtContent.includes(`归档标识：${archiveHook}`)) {
              txtPath = candidateTxt;
              projectDir = candidateDir;
              break;
            }
          } else {
            // Legacy: no hook stored, use first matching directory by project name
            txtPath = candidateTxt;
            projectDir = candidateDir;
            break;
          }
        } catch {
          // Directory doesn't exist, continue searching
        }
      }
      if (txtPath) break; // Found in this location, stop searching
    }

    if (!txtPath) {
      throw new NotFoundException('未找到归档文件。');
    }

    // Read and parse the TXT file
    const txtContent = await readFile(txtPath, 'utf8');

    // Parse the TXT content into structured data
    const parsed = parseArchiveTxt(txtContent);

    // Build file list with paths for preview

    // Create a map of parsed stage files by stage name
    const parsedStageFilesMap = new Map<string, Array<{ fileName: string; analysis: string }>>();
    for (const parsedStage of parsed.stages) {
      parsedStageFilesMap.set(parsedStage.stageName, parsedStage.files);
    }

    const stagesWithFiles = pmItem.stages.map((stage, idx) => {
      // Find matching parsed stage by name
      const parsedFiles = parsedStageFilesMap.get(stage.stageName) || [];
      const stageDir = `${idx + 1}.${stage.stageName}`;

      return {
        stageKey: stage.stageKey,
        stageName: stage.stageName,
        stageDirName: stageDir,
        status: stage.status,
        attachments: stage.attachments.map((att, index) => ({
          id: att.id,
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          filePath: projectDir ? join(projectDir, stageDir, att.fileName) : null,
          // Get analysis from parsed data, matching by index or filename
          analysis: parsedFiles[index]?.analysis || parsedFiles.find(f => f.fileName === att.fileName)?.analysis || '',
        })),
      };
    });

    // Inject department number from DB (not always in archive TXT)
    if (pmItem.departmentNumber) {
      parsed.basicInfo['部门编号'] = pmItem.departmentNumber;
    }

    return {
      projectId: pmItem.id,
      projectTitle: pmItem.title,
      archivedAt: archivedAt.toISOString().split('T')[0],
      archiveHook: parsed.archiveHook || pmItem.archiveHook || null,
      archiveDir: projectDir,
      basicInfo: parsed.basicInfo,
      extractedInfo: parsed.extractedInfo,
      stages: stagesWithFiles,
      summary: parsed.summary,
    };
  }

  /**
   * Serve archive file for preview/download
   */
  async serveArchiveFile(
    procurementRoundId: string,
    stageKey: string,
    fileIndex: number,
    res: Response,
  ) {
    // Find the project management item
    const pmItem = await this.prisma.projectManagementItem.findFirst({
      where: { archivedProcurementRoundId: procurementRoundId },
      include: {
        stages: {
          where: { stageKey },
          include: { attachments: true },
        },
      },
    });

    if (!pmItem) {
      throw new NotFoundException('未找到对应的归档项目。');
    }

    const stage = pmItem.stages[0];
    if (!stage || !stage.attachments[fileIndex]) {
      throw new NotFoundException('未找到对应的文件。');
    }

    const attachment = stage.attachments[fileIndex];
    const archivedAt = pmItem.archivedAt;
    if (!archivedAt) {
      throw new NotFoundException('项目尚未归档。');
    }

    // Build file path
    // Primary path: local archive (uploads/archive)
    const localArchiveBasePath = resolve(process.cwd(), 'uploads', 'archive');
    // Backup path: NAS storage
    const nasArchiveBasePath = process.env.NAS_PATH || '/home/swhi/nas_procurement';
    const nasArchivePath = join(nasArchiveBasePath, 'ProcurementData');

    const monthStr = `${archivedAt.getFullYear()}年${String(archivedAt.getMonth() + 1).padStart(2, '0')}月`;
    const localMonthDir = join(localArchiveBasePath, monthStr);
    const nasMonthDir = join(nasArchivePath, monthStr);

    // Try to find the project directory - local first, then NAS
    let projectDir: string | null = null;

    for (const monthDir of [localMonthDir, nasMonthDir]) {
      const exactDir = join(monthDir, pmItem.title);
      try {
        await access(exactDir);
        projectDir = exactDir;
        break;
      } catch {
        let suffix = 1;
        while (suffix < 100) {
          const suffixedDir = join(monthDir, `${pmItem.title}（${suffix}）`);
          try {
            await access(suffixedDir);
            projectDir = suffixedDir;
            break;
          } catch {
            suffix++;
          }
        }
        if (projectDir) break; // Found in this location
      }
    }

    if (!projectDir) {
      throw new NotFoundException('未找到归档目录。');
    }

    const filePath = join(projectDir, `${stage.stageOrder}.${stage.stageName}`, attachment.fileName);

    try {
      await access(filePath);
    } catch {
      throw new NotFoundException('未找到归档文件。');
    }

    // Set response headers
    const ext = extname(attachment.fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.txt': 'text/plain',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);

    // Stream the file
    const fileStream = createReadStream(filePath);
    fileStream.pipe(res);
  }

  async moveToRecycleBin(projectId: string, user?: AuthenticatedUser) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, createdById: true },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // Only the creator or admin can move a project to recycle bin
    if (user && user.role !== 'admin' && project.createdById !== user.sub) {
      throw new ForbiddenException('只能将本人创建的项目移至回收站。');
    }

    if (project.status === PROJECT_MANAGEMENT_STATUS.RECYCLED) {
      return project;
    }

    return this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: { status: PROJECT_MANAGEMENT_STATUS.RECYCLED, recycledAt: new Date() },
    });
  }

  async restoreFromRecycleBin(projectId: string, user?: AuthenticatedUser) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, createdById: true },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // Only the creator or admin can restore a project
    if (user && user.role !== 'admin' && project.createdById !== user.sub) {
      throw new ForbiddenException('只能恢复本人创建的项目。');
    }

    if (project.status !== PROJECT_MANAGEMENT_STATUS.RECYCLED) {
      throw new BadRequestException('只有回收站中的项目可以恢复。');
    }

    return this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: { status: PROJECT_MANAGEMENT_STATUS.ACTIVE, recycledAt: null },
    });
  }

  async deletePermanently(projectId: string, user?: AuthenticatedUser) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, createdById: true, archiveExportedAt: true, recycledAt: true },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // Only the creator or admin can permanently delete a project
    if (user && user.role !== 'admin' && project.createdById !== user.sub) {
      throw new ForbiddenException('只能彻底删除本人创建的项目。');
    }

    if (project.status !== PROJECT_MANAGEMENT_STATUS.RECYCLED) {
      throw new BadRequestException('请先将项目移入回收站后再彻底删除。');
    }

    // ── DA/T 103-2024 §8.5 保留策略（S1）──
    // ① 已导出归档信息包（ASIP）的卷 = 已移交档案，平台侧禁止物理删除；
    //    如确需重做，先由 leader/admin 在归档管理页取消归档标记并清除导出记录。
    if (project.archiveExportedAt) {
      throw new ConflictException(
        `该项目已于 ${project.archiveExportedAt.toLocaleDateString('zh-CN')} 导出归档信息包（DA/T 103-2024 档案保留），禁止彻底删除。`,
      );
    }
    // ② 回收站起算不足 3 年：电子文件在原平台至少保留 3 年（即使未归档）
    // M1：以 recycledAt（移入回收站时写入）为准；updatedAt 会被任何字段更新刷新，不能作起算点。
    // 存量项目（字段上线前已回收）无 recycledAt → 从严拒绝并提示先恢复再回收以记录时间。
    const recycledAt = project.recycledAt ?? null;
    const THREE_YEARS_MS = 3 * 365 * 86400000;
    if (!recycledAt) {
      throw new ConflictException(
        '该项目缺少回收时间记录（历史数据），请先恢复项目后重新移入回收站，以启动 3 年保留期计算（DA/T 103-2024 §8.5）。',
      );
    }
    const recycledSince = Date.now() - recycledAt.getTime();
    if (recycledSince < THREE_YEARS_MS) {
      const daysLeft = Math.ceil((THREE_YEARS_MS - recycledSince) / 86400000);
      throw new ConflictException(
        `依据 DA/T 103-2024 §8.5，电子文件在平台至少保留 3 年；该项目自 ${recycledAt.toLocaleDateString('zh-CN')} 回收，尚余 ${Math.floor(daysLeft / 30)} 个月，暂不能彻底删除。`,
      );
    }

    await this.prisma.projectManagementItem.delete({
      where: { id: projectId },
    });

    return { success: true };
  }

  async deleteAttachment(projectId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        projectManagementItemId: true,
        objectKey: true,
        projectManagementStageId: true,
      },
    });

    if (!attachment) {
      throw new NotFoundException('未找到对应的附件。');
    }

    if (attachment.projectManagementItemId !== projectId) {
      throw new BadRequestException('该附件不属于当前项目。');
    }

    // Delete the file from filesystem
    const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
    try {
      await unlink(filePath);
    } catch {
      // File may not exist, continue with database deletion
    }

    // Delete the attachment record
    await this.prisma.attachment.delete({
      where: { id: attachmentId },
    });

    // Rebuild stage analysis cache — remove only the deleted file's entry
    if (attachment.projectManagementStageId) {
      const stage = await this.prisma.projectManagementStage.findUnique({
        where: { id: attachment.projectManagementStageId },
        select: { stageKey: true, id: true },
      });
      if (stage) {
        const cachePath = getStageAnalysisCachePath(projectId, stage.stageKey);
        try {
          const cachedRaw = await readFile(cachePath, 'utf8');
          const cached = JSON.parse(cachedRaw) as {
            fingerprint?: string;
            files?: Array<{
              objectKey: string;
              fileName: string;
              stageMatch: string;
              contentSummary: string;
            }>;
          };
          if (Array.isArray(cached.files)) {
            // Remove the deleted file's entry
            const remainingFiles = cached.files.filter(
              (f) => f.objectKey !== attachment.objectKey,
            );
            if (remainingFiles.length > 0) {
              // Rebuild fingerprint from remaining stage attachments
              const remainingAttachments = await this.prisma.attachment.findMany({
                where: {
                  projectManagementStageId: stage.id,
                  id: { not: attachmentId },
                },
                select: { objectKey: true, fileSize: true, createdAt: true },
              });
              const newFingerprint = buildStageAnalysisFingerprint(
                stage.stageKey,
                remainingAttachments,
              );
              await writeFile(
                cachePath,
                JSON.stringify({ fingerprint: newFingerprint, files: remainingFiles }, null, 2),
                'utf8',
              );
            } else {
              // No files left — delete the cache entirely
              await unlink(cachePath);
            }
          }
        } catch {
          // Cache doesn't exist or is invalid — nothing to rebuild
        }

        // Clear extracted info fields based on stage
        const clearData: Record<string, null> = {};
        if (stage.stageKey === 'INITIATION') {
          clearData.initiationDate = null;
        } else if (stage.stageKey === 'TENDER_DOCUMENT') {
          clearData.evaluationMethod = null;
          clearData.projectOverview = null;
          clearData.bidOpeningTime = null;
          clearData.documentAcquireTime = null;
        } else if (stage.stageKey === 'EXPERT_SELECTION') {
          clearData.expertInfo = null;
          clearData.biddingUnits = null;
          clearData.awardedSupplier = null;
        } else if (stage.stageKey === 'CONTRACT') {
          clearData.contractAmount = null;
          // Only clear awardedSupplier if no award_decision stage has it
          const awardStage = await this.prisma.projectManagementStage.findFirst({
            where: { projectManagementItemId: projectId, stageKey: 'AWARD_DECISION' },
            include: { attachments: true },
          });
          if (!awardStage || awardStage.attachments.length === 0) {
            clearData.awardedSupplier = null;
          }
        }

        if (Object.keys(clearData).length > 0) {
          await this.prisma.projectManagementItem.update({
            where: { id: projectId },
            data: clearData,
          });
        }
      }
    }

    return { success: true };
  }

  private async extractFileText(
    filePath: string,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    try {
      const buffer = await readFile(filePath);
      const text = await this.documentParser.parse(buffer, mimeType, fileName);
      // If text extraction yielded meaningful content, return it
      if (text.trim().length > 50) {
        return text.slice(0, 8000);
      }
      // Text too sparse — likely a scanned document, fall back to OCR
      this.logger.log(`Text too sparse from ${fileName} (${text.trim().length} chars), trying OCR fallback`);
      const ocrText = await this.documentParser.parseWithOcr(buffer, mimeType, fileName);
      if (ocrText.trim().length > text.trim().length) {
        return ocrText.slice(0, 8000);
      }
      return text.slice(0, 8000);
    } catch (error) {
      this.logger.error(`Failed to extract text from ${fileName}:`, error);
      // Last resort: try OCR even on parse failure
      try {
        const buffer = await readFile(filePath);
        const ocrText = await this.documentParser.parseWithOcr(buffer, mimeType, fileName);
        return ocrText.slice(0, 8000);
      } catch {
        return '';
      }
    }
  }

  private async extractFileTextWithOcr(
    filePath: string,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    try {
      const buffer = await readFile(filePath);
      const text = await this.documentParser.parseWithOcr(buffer, mimeType, fileName);
      return text.slice(0, 8000);
    } catch (error) {
      this.logger.error(`Failed to extract text with OCR from ${fileName}:`, error);
      return '';
    }
  }

  private normalizeInitiationText(text: string) {
    return text
      .replace(/\r/g, '\n')
      .replace(/需求申请\s*人/g, '需求申请人')
      .replace(/申请采购\s*事项名称/g, '申请采购事项名称')
      .replace(/申请立项\s*事由/g, '申请立项事由')
      .replace(/对供方的\s*主要要求/g, '对供方的主要要求')
      .replace(/采购预算\s*价格\(元\)/g, '采购预算价格(元)')
      .replace(/拟采购方\s*式/g, '拟采购方式')
      .replace(/采购组织\s*形式/g, '采购组织形式')
      .replace(/是否属于\s*年度预算/g, '是否属于年度预算');
  }

  private collectSection(lines: string[], label: string, stopLabels: string[]) {
    const startIndex = lines.findIndex((line) => line.includes(label));
    if (startIndex < 0) {
      return [];
    }

    const values: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (stopLabels.some((stopLabel) => line.includes(stopLabel))) {
        break;
      }
      values.push(line);
    }
    return values;
  }

  private extractDocumentAcquireTimeFromText(text: string): string | null {
    // 策略1：找"采购文件获取"/"文件获取"章节标题 → 后续 300 字内找 "时 间：日期区间"
    const sectionLabels = ['采购文件获取', '文件获取', '获取采购文件', '获取招标文件'];
    for (const label of sectionLabels) {
      const idx = text.indexOf(label);
      if (idx < 0) continue;
      const window = text.slice(idx, idx + 300);
      // 1a. "时 间：日期区间"（mammoth 可能拆分"时 间"）
      const timeTagMatch = window.match(
        /时\s*间\s*[：:]\s*((?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}[：:]\d{2})\s*[-~至到]\s*(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}[：:]\d{2}))/,
      );
      if (timeTagMatch) return timeTagMatch[1].replace(/\s+/g, ' ').trim();

      // 1b. 窗口内直接的日期+时分区间（无"时间"标签）
      const directMatch = window.match(
        /((?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*\d{1,2}[：:]\d{2}\s*[-~至到]\s*(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*\d{1,2}[：:]\d{2})/,
      );
      if (directMatch) return directMatch[1].replace(/\s+/g, ' ').trim();

      // 1c. 窗口内的日期区间（无时分）
      const dateRangeMatch = window.match(
        /((?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*[-~至到]\s*(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日))/,
      );
      if (dateRangeMatch) return dateRangeMatch[1].replace(/\s+/g, ' ').trim();
    }

    // 策略2：全文搜索 "时 间：日期区间" 或含时分的日期区间（兜底）
    const fullTextMatch = text.match(
      /时\s*间\s*[：:]\s*((?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}[：:]\d{2})\s*[-~至到]\s*(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}[：:]\d{2}))/,
    );
    if (fullTextMatch) return fullTextMatch[1].replace(/\s+/g, ' ').trim();

    return null;
  }actInlineValue(text: string, label: string) {
    const match = text.match(new RegExp(`${label}[：:]\\s*([^\n]+)`));
    return match?.[1]?.trim() ?? '';
  }

  private findFollowingValue(
    lines: string[],
    label: string,
    stopLabels: string[],
  ) {
    const section = this.collectSection(lines, label, stopLabels);
    return section.find((line) => !isLabelLine(line)) ?? '';
  }

  private findRequesterNameFromLayout(lines: string[]) {
    // Look for pattern: short name (2-4 chars) followed by department line
    for (let i = 0; i < lines.length - 1; i++) {
      const currentLine = lines[i];
      const nextLine = lines[i + 1];
      // Skip if current line is a label
      if (
        currentLine.includes('需求申请') ||
        currentLine.includes('申请人') ||
        currentLine.includes('采购') ||
        currentLine.includes('审核') ||
        currentLine.includes('其他') ||
        currentLine.includes('意见')
      ) {
        continue;
      }
      // Name is typically 2-4 Chinese characters, followed by a department line
      if (
        currentLine.length >= 2 &&
        currentLine.length <= 10 &&
        /^[一-龥]+$/.test(currentLine) &&
        (nextLine.includes('分院') ||
          nextLine.includes('部门') ||
          nextLine.includes('公司'))
      ) {
        return currentLine;
      }
    }
    return '';
  }

  private findRequesterDepartmentFromLayout(lines: string[]) {
    // Find requester name first, then get department from next line
    for (let i = 0; i < lines.length - 1; i++) {
      const currentLine = lines[i];
      const nextLine = lines[i + 1];
      // Skip if current line is a label
      if (
        currentLine.includes('需求申请') ||
        currentLine.includes('申请人') ||
        currentLine.includes('采购') ||
        currentLine.includes('审核') ||
        currentLine.includes('其他') ||
        currentLine.includes('意见')
      ) {
        continue;
      }
      // Name is typically 2-4 Chinese characters, followed by a department line
      if (
        currentLine.length >= 2 &&
        currentLine.length <= 10 &&
        /^[一-龥]+$/.test(currentLine) &&
        (nextLine.includes('分院') ||
          nextLine.includes('部门') ||
          nextLine.includes('公司'))
      ) {
        const deptLine = nextLine;
        const subDeptLine = lines[i + 2] || '';
        // Check if next line is a sub-department like "综合室" or "地质室"
        if (
          subDeptLine.length <= 10 &&
          subDeptLine.length >= 2 &&
          (subDeptLine.includes('室') || subDeptLine.includes('部')) &&
          !subDeptLine.includes('分院') &&
          !subDeptLine.includes('采购') &&
          !/^1[.、]/.test(subDeptLine)
        ) {
          return deptLine + ' ' + subDeptLine;
        }
        return deptLine;
      }
    }
    return '';
  }

  private findValueAfterAnchor(
    lines: string[],
    anchor: string,
    candidates: string[],
  ) {
    const startIndex = lines.findIndex((line) => line.includes(anchor));
    if (startIndex < 0) {
      return '';
    }

    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const candidate = candidates.find((item) => lines[index].includes(item));
      if (candidate) {
        return candidate;
      }
    }

    return '';
  }

  private findConfirmedValueAfterAnchor(
    lines: string[],
    anchor: string,
    candidates: string[],
  ) {
    const startIndex = lines.findIndex((line) => line.includes(anchor));
    if (startIndex < 0) {
      return '';
    }

    const matches: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const candidate = candidates.find((item) => lines[index].includes(item));
      if (candidate && !matches.includes(candidate)) {
        matches.push(candidate);
      }
      if (matches.length > 1) {
        return '';
      }
    }

    return matches[0] ?? '';
  }

  private findAnnualBudgetFlag(lines: string[]) {
    const startIndex = lines.findIndex((line) =>
      line.includes('是否属于年度预算'),
    );
    if (startIndex < 0) {
      return false;
    }

    const endIndex = lines.findIndex(
      (line, index) => index > startIndex && line.includes('流转意见'),
    );
    const section = lines.slice(
      startIndex + 1,
      endIndex > startIndex ? endIndex : startIndex + 35,
    );
    return section.includes('是');
  }

  private findExactValueAfterAnchor(
    lines: string[],
    anchor: string,
    candidates: string[],
  ) {
    const startIndex = lines.findIndex((line) => line.includes(anchor));
    if (startIndex < 0) {
      return '';
    }

    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (candidates.includes(lines[index])) {
        return lines[index];
      }
    }

    return '';
  }

  private findSupplierRequirementsFromLayout(lines: string[]) {
    // Strategy 1: Look for supplier requirements after requester info
    // Find requester info pattern: name followed by department (e.g., "戴金旅" then "测绘分院/测绘分院")
    let requesterInfoEndIndex = -1;
    for (let i = 0; i < lines.length - 2; i++) {
      const currentLine = lines[i];
      const nextLine = lines[i + 1];
      // Skip if current line is a label
      if (
        currentLine.includes('需求申请') ||
        currentLine.includes('申请人') ||
        currentLine.includes('采购') ||
        currentLine.includes('审核') ||
        currentLine.includes('其他') ||
        currentLine.includes('意见')
      ) {
        continue;
      }
      // Name is typically 2-4 Chinese characters, followed by a department line
      if (
        currentLine.length >= 2 &&
        currentLine.length <= 10 &&
        /^[一-龥]+$/.test(currentLine) &&
        (nextLine.includes('分院') ||
          nextLine.includes('部门') ||
          nextLine.includes('公司'))
      ) {
        requesterInfoEndIndex = i + 2; // After name and department
        // Check if there's a third line like "综合室" or "地质室"
        const thirdLine = lines[i + 2] || '';
        if (
          thirdLine.length <= 10 &&
          thirdLine.length >= 2 &&
          (thirdLine.includes('室') || thirdLine.includes('部')) &&
          !thirdLine.includes('分院') &&
          !thirdLine.includes('采购') &&
          !/^1[.、]/.test(thirdLine)
        ) {
          requesterInfoEndIndex = i + 3;
        }
        break;
      }
    }

    if (requesterInfoEndIndex >= 0) {
      // Look for requirement content starting with "1." or "1、" after requester info
      const searchEndIndex = lines.findIndex(
        (line, index) =>
          index > requesterInfoEndIndex && KNOWN_CATEGORIES.includes(line),
      );
      const endIdx =
        searchEndIndex > requesterInfoEndIndex ? searchEndIndex : lines.length;

      for (let i = requesterInfoEndIndex; i < endIdx; i++) {
        const line = lines[i].trim();
        if (/^1[.、]/.test(line)) {
          const requirementLines: string[] = [];
          for (let j = i; j < endIdx; j++) {
            const currentLine = lines[j].trim();
            if (
              KNOWN_CATEGORIES.includes(currentLine) ||
              currentLine.startsWith('2025/') ||
              currentLine.includes('采购立项申请表')
            ) {
              break;
            }
            requirementLines.push(currentLine);
          }
          if (requirementLines.length > 0) {
            return requirementLines.join('\n').trim();
          }
          break;
        }
      }
    }

    // Strategy 2: Look for requirements after "拟采购方式" section (fallback for first PDF pattern)
    const procurementMethodIndex = lines.findIndex(
      (line) => line.includes('拟采购方') || line.includes('采购方式'),
    );

    if (procurementMethodIndex >= 0) {
      const methodOptionsIndex = lines.findIndex(
        (line, index) =>
          index > procurementMethodIndex &&
          (line.includes('公开招标') ||
            line.includes('邀请招标') ||
            line.includes('谈判采购')),
      );

      const searchEnd =
        methodOptionsIndex > 0 ? methodOptionsIndex : lines.length;

      for (let i = procurementMethodIndex + 1; i < searchEnd; i++) {
        const line = lines[i];
        if (/^1[.、]/.test(line.trim())) {
          const requirementLines: string[] = [];
          for (let j = i; j < searchEnd; j++) {
            const currentLine = lines[j].trim();
            if (
              currentLine.includes('公开招标') ||
              currentLine === '其他' ||
              currentLine.startsWith('2025/') ||
              currentLine.includes('采购组织形式')
            ) {
              break;
            }
            requirementLines.push(currentLine);
          }
          if (requirementLines.length > 0) {
            return requirementLines.join('\n').trim();
          }
          break;
        }
      }
    }

    return '';
  }

  /** 从采购文件正文中提取开标/投标截止时间。procurementMethod 用于适配不同采购方式的时间表述。 */
  private extractBidOpeningTimeFromText(text: string, procurementMethod?: string): string | null {
    const isDirect = procurementMethod === '直接采购';
    const isNegotiationOrInquiry = procurementMethod === '谈判采购' || procurementMethod === '询比采购';

    // 直接采购：文档使用"递交和谈判时间"或"递交及谈判时间"
    // 谈判/询比：文档使用"递交及谈判时间"、"响应截止及谈判时间"等
    const patterns: RegExp[] = isDirect
      ? [
          /递交[及和]谈判时间[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          /谈判时间[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          /递交时间[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          /响应文件[^。\n]{0,8}递交[及和]谈判[^。\n]{0,8}[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          // 兜底：在文本中找"递交"+"谈判"附近的时间
          /递交[^。\n]{0,30}谈判[^。\n]{0,10}[：:]{0,1}\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
        ]
      : [
          /开标时间[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          /投标截止时间[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          /响应文件[^。]{0,6}截止时间[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          /提交[^。]{0,10}截止[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
          /投标截止[：:]\s*(\d{4}\s*[年月]\s*\d{1,2}\s*[月]\s*\d{1,2}\s*日[\s\d:时分]*)/,
        ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].replace(/\s+/g, '');
      }
    }

    // Fallbacks: 适配不同采购方式的关键词
    const timeKeywords = isDirect
      ? '递交和谈判时间|递交及谈判时间|谈判时间|递交时间'
      : (isNegotiationOrInquiry ? '递交[及和]谈判|谈判时间|递交时间|开标时间|投标截止|响应文件提交截止' : '开标时间|投标截止时间|响应文件提交截止时间');

    // Fallback 1: standalone date pattern near time keyword
    const contextMatch = text.match(new RegExp(`(${timeKeywords})[：:][^。\\n]{0,50}`));
    if (contextMatch) {
      const dateMatch = contextMatch[0].match(/(\d{4}\s*[年月]\s*\d{1,2}\s*[月]\s*\d{1,2}\s*日)/);
      if (dateMatch?.[1]) return dateMatch[1].replace(/\s+/g, '');
    }

    // Fallback 2: 时间关键词附近 80 字符窗口内找日期+时分
    const looserMatch = text.match(new RegExp(`(?:${timeKeywords})[^\\n]{0,40}?(\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日\\s*\\d{1,2}[：:]\\d{2})`));
    if (looserMatch?.[1]) return looserMatch[1].replace(/\s+/g, '');

    // Fallback 3: 含时间关键词的行 + 相邻行的日期
    const lines = text.split('\n');
    const keywordList = timeKeywords.split('|');
    for (let i = 0; i < lines.length; i++) {
      if (keywordList.some(kw => lines[i].includes(kw))) {
        for (let j = i; j < Math.min(lines.length, i + 3); j++) {
          const dm = lines[j].match(/(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}[：:]\d{2})?)/);
          if (dm?.[1]) return dm[1].replace(/\s+/g, '');
        }
      }
    }

    return null;
  }

  /**
   * 从采购文件正文中提取"采购文件获取时间"（供应商可获取采购文件的时间窗口）。
   * 常见表述：采购文件获取时间 / 文件获取时间 / 领取时间 / 报名及文件获取，
   * 取值通常是日期或日期区间（如"2026年8月1日至8月5日"）。精确匹配失败时回退到标签附近窗口。
   */

  /** 最小限度优化：仅修正标点符号和语言不一致，不改变内容、不改编句子结构。 */
  private async aiMinimalPolish(text: string): Promise<string> {
    if (!text || text.length < 10) return text;
    try {
      const systemPrompt =
        '你是一位资深公文校对员。对以下文本进行最小限度的修正：' +
        '仅更正标点符号错误（中英文标点混用、缺失顿号/句号等）、' +
        '纠正语序不通顺或语法小错误，以及将不合适的用词调整为更正式、更准确的表达。' +
        '不得添加、删除或改写任何实质性内容，不得改变段落结构，不得增加任何解释或说明。' +
        '直接输出修正后的文本。';
      const result = await this.aiService.chat(systemPrompt, text, 0.2);
      if (result && result.trim().length >= text.length * 0.6) {
        return result.trim();
      }
      return text;
    } catch {
      return text; // AI 不可用时直接返回原文
    }
  }

  /**
   * 规范化开标时间：统一为"YYYY年M月D日H:MM"格式（24小时制）。
   * 保留原文时分；若无时分，含"下午/午后"线索补 14:00，否则补 9:00。
   */
  private async aiNormalizeBidOpeningTime(text: string): Promise<string> {
    if (!text) return text;
    try {
      const systemPrompt =
        '你是开标时间规范化助手。把输入的开标时间文本规范化为"YYYY年M月D日H:MM"格式（24小时制，分钟两位）。' +
        '规则：① 保留原文的日期与时分；② 若原文只有日期没有具体时分，按线索补全：含"下午/午后"补 14:00、含"上午"补 9:00、无线索默认补 9:00；' +
        '③ 把"X时X分""X点X分"统一为"H:MM"；④ 直接输出规范化结果，不要解释、引号或前后缀。' +
        '示例：输入"2026年7月25日"→"2026年7月25日9:00"；输入"2026.7.25 下午两点"→"2026年7月25日14:00"；输入"2026-07-25 14:00"→"2026年7月25日14:00"。';
      const result = await this.aiService.chat(systemPrompt, text, 0.2);
      const cleaned = result?.trim().replace(/^["'"，。.\s]+|["'"，。.\s]+$/g, '');
      if (cleaned && /\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}/.test(cleaned)) {
        return cleaned.replace(/\s+/g, '');
      }
      return text; // AI 输出不合格式时回退原文
    } catch {
      return text;
    }
  }

  /**
   * 规范化采购文件获取时间：统一为"YYYY年M月D日"或"YYYY年M月D日-YYYY年M月D日"。
   * 采购文件获取时间通常是日期或日期区间（不含时分），与单点的开标时间不同；区间以半角"-"分隔。
   */
  private async aiNormalizeDocumentAcquireTime(text: string): Promise<string> {
    if (!text) return text;
    try {
      const systemPrompt =
        '你是采购文件获取时间规范化助手。把输入文本规范化，输出"YYYY年M月D日HH:MM"（单时刻）或"YYYY年M月D日HH:MM-YYYY年M月D日HH:MM"（区间，用半角连字符"-"分隔）。' +
        '规则：① 识别文本中的日期与时分；② 若为时间段输出"起始日期时分-结束日期时分"；③ 保留原始时分（如09:00、15:00），去掉星期、解释、引号与前后缀；若原始无时分则只输出日期；' +
        '④ 缺失的年份按上下文推断。' +
        '示例：输入"2026年03月23日09:00至2026年03月26日15:00"→"2026年3月23日9:00-2026年3月26日15:00"；' +
        '输入"2026年8月1日至2026年8月5日"→"2026年8月1日-2026年8月5日"；' +
        '输入"自发布之日起至2026.8.5"→"2026年8月5日"。';
      const result = await this.aiService.chat(systemPrompt, text, 0.0);
      const cleaned = result?.trim().replace(/^["'"，。.\s]+|["'"，。.\s]+$/g, '');
      if (cleaned && /\d{4}年\d{1,2}月\d{1,2}日/.test(cleaned)) {
        return cleaned;
      }
      return text;
    } catch {
      return text;
    }
  }

  /** AI 从采购文件文本中提取"采购文件获取时间"（正则失败时的兜底）。 */
  private async aiExtractDocumentAcquireTime(text: string): Promise<string | null> {
    try {
      const systemPrompt =
        '从以下采购文件文本中提取"采购文件获取时间"（供应商可获取/下载/领取采购文件的时间段或截止时间），' +
        '必须保留时分（如09:00、15:00）。只输出时间（如"2026年3月23日9:00-2026年3月26日15:00"或"2026年3月25日17:00前"），不要其他说明。' +
        '如果文本中没有获取时间信息，输出"无"。';
      const result = await this.aiService.chat(systemPrompt, text.slice(0, 4000), 0.1);
      const cleaned = result?.trim();
      if (cleaned && cleaned !== '无' && /\d{4}年/.test(cleaned)) {
        return cleaned;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** AI 从采购文件文本中提取"项目概况/采购内容"（正则/关键词提取失败时的兜底）。
   *  procurementMethod 用于适配不同采购方式的段落结构。 */
  private async aiExtractProjectOverview(text: string, procurementMethod?: string): Promise<string | null> {
    try {
      const isDirect = procurementMethod === '直接采购';
      const isNegotiationOrInquiry = procurementMethod === '谈判采购' || procurementMethod === '询比采购';
      const systemPrompt = isDirect
        ? '从以下直接采购文件文本中提取"采购内容"部分的实质描述，' +
          '限定范围：仅提取采购标的名称、规格型号、数量、技术参数等描述"买什么"的信息。' +
          '严格排除以下内容："供应商资格要求""商务要求""技术要求""供货要求""验收标准""付款条件""合同条款"以及任何对供方的资质/业绩/能力门槛要求。' +
          '只输出提取到的实质内容原文（控制在100-500字），不要保留章节编号、不要输出"采购内容"标题本身、不要添加解释或评价。' +
          '如果文本中没有实质性的采购内容描述，输出"无"。'
        : isNegotiationOrInquiry
          ? '从以下采购文件文本中提取"采购内容/采购需求"部分的实质描述，' +
            '限定范围：仅提取采购标的名称、规格、数量、质量要求等描述"买什么"的信息。' +
            '严格排除："供应商资格条件""商务条款""技术门槛""供货期限""验收方式""付款方式"以及对供方的资质要求。' +
            '只输出提取到的实质内容原文（控制在100-500字），不要保留章节编号、不要输出标题、不要添加解释或评价。' +
            '如果文本中没有实质性的采购内容描述，输出"无"。'
          : '从以下采购文件文本中提取"项目概况"部分的实质描述，' +
            '限定范围：仅提取项目背景、采购范围、建设规模、采购标的等描述"买什么/建什么"的信息。' +
            '严格排除："投标人资格要求""供应商资格条件""技术规格要求""商务条款""评审办法"以及任何对投标方的资质/业绩门槛。' +
            '只输出提取到的实质内容原文（控制在100-500字），不要保留章节编号、不要输出"项目概况"标题本身、不要添加解释或评价。' +
            '如果文本中没有项目概况内容，输出"无"。';
      const result = await this.aiService.chat(systemPrompt, text.slice(0, 8000), 0.2);
      const cleaned = result?.trim();
      if (cleaned && cleaned !== '无' && cleaned.length >= 20) {
        return cleaned;
      }
      return null;
    } catch {
      return null;
    }
  }



  private async persistUploadedFile(
    file: Express.Multer.File,
    prefix: string,
    uploadedById?: string,
  ) {
    const uploadDir = getUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const normalizedFileName = normalizeUploadedFileName(
      file.originalname,
    );
    const storedFileName = `${Date.now()}-${prefix}-${sanitizeFileName(normalizedFileName)}`;
    const absolutePath = resolve(uploadDir, storedFileName);

    await writeFile(absolutePath, file.buffer);

    return {
      absolutePath,
      attachment: {
        fileName: normalizedFileName,
        objectKey: `project-management/${storedFileName}`,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedById,
      } satisfies StoredAttachment,
    };
  }

  async getProjectAttributions() {
    // 1. 查询所有已归档项目
    const archivedProjects = await this.prisma.projectManagementItem.findMany({
      where: {
        status: 'ARCHIVED',
        demandProject: { not: null },
      },
      select: {
        demandProject: true,
        demandContractNumber: true,
        contractNumber: true,
      },
    });

    // 2. 聚合统计：按项目归属分组，计算使用次数，取最常用的合同编号
    const attributionMap = new Map<string, { count: number; contractNumber: string | null }>();

    for (const project of archivedProjects) {
      if (!project.demandProject) continue;
      const effectiveContractNumber = project.contractNumber || project.demandContractNumber;
      const existing = attributionMap.get(project.demandProject);
      if (existing) {
        existing.count++;
        // 保留非空的合同编号
        if (!existing.contractNumber && effectiveContractNumber) {
          existing.contractNumber = effectiveContractNumber;
        }
      } else {
        attributionMap.set(project.demandProject, {
          count: 1,
          contractNumber: effectiveContractNumber,
        });
      }
    }

    // 3. 转换为数组并按使用次数降序排序
    const result = Array.from(attributionMap.entries())
      .map(([name, data]) => ({
        name,
        contractNumber: data.contractNumber,
        usageCount: data.count,
      }))
      .sort((a, b) => b.usageCount - a.usageCount);

    return result;
  }

  /** 获取 DOCX 附件中所有段落的文本结构（供编辑器分段落展示，含 HTML 保留格式）。 */
  async getAttachmentParagraphs(attachmentId: string): Promise<{
    fileName: string;
    paragraphs: Array<{ index: number; text: string; html: string; style: string; rawRange: { from: number; to: number } }>;
  }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, fileName: true, objectKey: true },
    });
    if (!attachment) throw new NotFoundException('未找到对应附件');

    const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
    const buffer = await readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new NotFoundException('无法解析 DOCX 文档');

    // ── 提取 styles.xml 用于字号映射 ──
    const styleSizeMap: Record<string, string> = {};
    try {
      const stylesXml = await zip.file('word/styles.xml')?.async('string');
      if (stylesXml) {
        const styleRegex = /<w:style[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:sz[^>]*w:val="(\d+)"[\s\S]*?<\/w:style>/g;
        let sm;
        while ((sm = styleRegex.exec(stylesXml)) !== null) {
          styleSizeMap[sm[1]] = sm[2];
        }
      }
    } catch {}

    // ── 第一步：提取每段的纯文本 + HTML ──
    const rawParagraphs: Array<{ text: string; html: string; style: string; origIdx: number }> = [];
    const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let match;

    while ((match = pRegex.exec(docXml)) !== null) {
      const pXml = match[0];

      // ── 提取样式名和段级别字号 ──
      let styleName = '';
      let fontSizePt = '';
      const styleMatch = pXml.match(/<w:pStyle w:val="([^"]+)"/);
      if (styleMatch) {
        styleName = styleMatch[1];
        if (styleSizeMap[styleName]) fontSizePt = (parseInt(styleSizeMap[styleName], 10) / 2).toFixed(0);
      }

      // 若样式没给字号，从第一个 run 读取
      if (!fontSizePt) {
        const firstSz = pXml.match(/<w:sz[^>]*w:val="(\d+)"/);
        if (firstSz) fontSizePt = (parseInt(firstSz[1], 10) / 2).toFixed(0);
      }

      const isBold = /<w:b\b/.test(pXml);

      // heading 判定：自定义章样式或粗体≥14pt（Normal 样式≥14pt不算，那是章节内子标题）
      let isHeading = false;
      if (/[Hh]eading|^TOC|题目|标题|章标题|目录|摘要|前言|致谢|^Style\d+$/.test(styleName)) {
        isHeading = true;
      } else if (isBold && styleName === '') {
        // 无样式名的粗体大字号（国产文档常见，如页眉章名）
        const pt = parseInt(fontSizePt, 10) || 0;
        if (pt >= 14) isHeading = true;
      }
      const style = isHeading ? 'heading' : 'body';

      // Extract text WITH formatting via runs — handle <w:br/> as line break
      const runs: string[] = [];
      const rRegex = /<w:r[\s>][\s\S]*?<\/w:r>|<w:br[^>]*\/?>/g;
      let rMatch;
      while ((rMatch = rRegex.exec(pXml)) !== null) {
        const rXml = rMatch[0];

        // line break → <br/>
        if (rXml.startsWith('<w:br')) {
          runs.push('<br/>');
          continue;
        }
        // run properties
        let bold = false, cssExtra = '';
        const rPrMatch = rXml.match(/<w:rPr[\s>][\s\S]*?<\/w:rPr>/);
        if (rPrMatch) {
          const rPr = rPrMatch[0];
          if (/<w:b\b/.test(rPr)) bold = true;
          const szMatch = rPr.match(/<w:sz[^>]*w:val="(\d+)"/);
          if (szMatch) fontSizePt = (parseInt(szMatch[1], 10) / 2).toFixed(0);
          if (rPr.match(/<w:i\b/)) cssExtra += 'font-style:italic;';
          if (rPr.match(/<w:u\b/)) cssExtra += 'text-decoration:underline;';
          const colorMatch = rPr.match(/<w:color[^>]*w:val="([^"]+)"/);
          if (colorMatch) cssExtra += `color:#${colorMatch[1]};`;
        }
        // text content
        const tMatches = rXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
        if (tMatches) {
          for (const t of tMatches) {
            const txt = decodeXmlText(t.replace(/<[^>]+>/g, ''));
            if (!txt) continue;
            const tag = bold ? 'strong' : 'span';
            let inline = '';
            if (fontSizePt) inline += `font-size:${fontSizePt}px;`;
            inline += cssExtra;
            runs.push(`<${tag}${inline ? ` style="${inline}"` : ''}>${txt}</${tag}>`);
          }
        }
      }
      const html = runs.length > 0 ? runs.join('') : '';

      // plain text (for save/AI) — 换行保留：<w:br/> → \n
      const withLineBreaks = pXml.replace(/<w:br[^>]*\/?>/g, '\n');
      const textContent = decodeXmlText(withLineBreaks.replace(/<[^>]+>/g, '')).trim();
      if (textContent.length > 0) {
        rawParagraphs.push({ text: textContent, html, style, origIdx: rawParagraphs.length });
      }
    }

    // ── 1.5：后处理 ─ 去噪、去重、识别章标题 ──
    const CHAPTER_TITLE_PATTERN = /^第[一二三四五六七八九十百零\d]+章\b/;
    const deduped = rawParagraphs.filter((p, i) => {
      // 纯数字/页码 跳过
      if (/^\d{4,}$/.test(p.text)) return false;
      // TOC 目录残留 PAGEREF/TOC 指令
      if (/PAGEREF\b|^TOC\s/i.test(p.text)) return false;
      // 连续相同段落（目录镜像），只保留第一个
      if (i > 0 && p.text === rawParagraphs[i - 1].text) return false;
      return true;
    });

    // 章标题识别：①文本含"第X章" ②style=heading 且有章名特征（非封面，短文本）
    const COVER_PARAS = 6; // 前6段视为封面/目录
    for (let i = 0; i < deduped.length; i++) {
      const p = deduped[i];
      if (p.style !== 'heading') continue;
      const isChapterByText = CHAPTER_TITLE_PATTERN.test(p.text);
      // 封面或目录区域的 heading 只保留"第X章"格式
      if (i < COVER_PARAS && !isChapterByText) { p.style = 'body'; continue; }
      // 非封面区：style=heading + 短文本(<40字，不含目录字样) = 章标题
      const isChapterByStyle = p.text.length <= 40 && !/^(目录|目\s*录)/.test(p.text);
      if (!isChapterByText && !isChapterByStyle) {
        p.style = 'body';
      }
    }

    // ── 第二步：AI 语义分析章节结构，回退到纯规则 ──
    const resultParagraphs: Array<{ index: number; text: string; html: string; style: string; rawRange: { from: number; to: number } }> = [];

    try {
      const labeledLines = deduped.map((p, i) =>
        `[${i}]${p.style === 'heading' ? '[H]' : ''}${p.text.slice(0, 120)}`,
      );
      const aiInput = labeledLines.join('\n');

      const aiResult = await Promise.race([
        this.aiService.chat(
          `你是采购文件结构化分析助手。以下是 Word 文档去噪后的段落列表（带[H]的是已标记的章标题）。\n\n` +
          `请按章标题（[H]）将内容分组。每章由一个[H]标题开始，后续所有内容（直到下一个[H]之前）为该章的正文。第一个[H]之前的段落合并为封面/目录区块。\n\n` +
          `返回严格 JSON 数组，每项：{ "from": 起始段落编号, "to": 结束段落编号 }\n\n` +
          `要求：\n` +
          `1. from/to 必须是实际编号，区间连续全覆盖无遗漏无重叠\n` +
          `2. 每章从 [H] 开始，到下一个 [H]-1 结束\n` +
          `3. 只用 JSON 数组作答，不要任何解释`,
          aiInput,
          0.2,
        ),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('AI_GROUPING_TIMEOUT')), 8000),
        ),
      ]);

      const cleaned = aiResult.replace(/```(?:json)?\s*|\s*```/g, '').trim();
      const blocks: Array<{ from: number; to: number; title?: string }> = JSON.parse(cleaned);

      if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('AI returned empty blocks');

      for (const block of blocks) {
        if (typeof block.from !== 'number' || typeof block.to !== 'number') continue;
        const from = Math.max(0, block.from);
        const to = Math.min(deduped.length - 1, block.to);
        if (from > to) continue;

        const blockParas = deduped.slice(from, to + 1);
        if (blockParas.length === 0) continue;
        const text = blockParas.map(p => p.text).join('\n\n');
        const html = blockParas.map(p => `<div>${p.html}</div>`).join('');
        const hasHeading = blockParas.some(p => p.style === 'heading');

        resultParagraphs.push({
          index: resultParagraphs.length,
          text,
          html,
          style: hasHeading ? 'heading' : 'body',
          rawRange: { from: blockParas[0].origIdx, to: blockParas[blockParas.length - 1].origIdx },
        });
      }

      this.logger.log(`AI chapter grouping: ${blocks.length} chapters from ${deduped.length} paragraphs`);
    } catch (err: any) {
      this.logger.warn(`AI grouping failed (${err?.message || err}), using rule-based fallback`);
      // ── fallback：遇 [H] 即切章 ──
      let blockStart = 0;
      for (let i = 1; i <= deduped.length; i++) {
        const isChapterBoundary = i === deduped.length || deduped[i].style === 'heading';
        if (!isChapterBoundary) continue;

        const blockParas = deduped.slice(blockStart, i);
        if (blockParas.length === 0) { blockStart = i; continue; }

        const text = blockParas.map(p => p.text).join('\n\n');
        const html = blockParas.map(p => `<div>${p.html}</div>`).join('');
        const isChapter = blockParas[0].style === 'heading';
        const splitSize = isChapter ? 2500 : 1500;

        if (text.length <= splitSize) {
          resultParagraphs.push({
            index: resultParagraphs.length, text, html,
            style: isChapter ? 'heading' : 'body',
            rawRange: { from: blockParas[0].origIdx, to: blockParas[blockParas.length - 1].origIdx },
          });
        } else {
          let subFrom = 0, acc = 0;
          for (let j = 0; j < blockParas.length; j++) {
            acc += blockParas[j].text.length;
            if (acc >= splitSize || j === blockParas.length - 1) {
              const sub = blockParas.slice(subFrom, j + 1);
              resultParagraphs.push({
                index: resultParagraphs.length, text: sub.map(p => p.text).join('\n\n'),
                html: sub.map(p => `<div>${p.html}</div>`).join(''),
                style: (isChapter && subFrom === 0) ? 'heading' : 'body',
                rawRange: { from: sub[0].origIdx, to: sub[sub.length - 1].origIdx },
              });
              subFrom = j + 1; acc = 0;
            }
          }
        }
        blockStart = i;
      }
    }

    return { fileName: attachment.fileName, paragraphs: resultParagraphs };
  }

  /** 对选中的文本段进行 AI 辅助修改（仅润色，不改变实质性内容）。 */
  async aiPolishAttachmentSelection(
    _projectId: string,
    dto: { text: string; instruction: string },
  ): Promise<{ polished: string }> {
    const systemPrompt =
      '你是招标/采购文件编写助手。请根据用户的修改要求，对以下文本段进行修改。' +
      '仅修改用户要求的部分，不要改动其他内容，不要添加解释。直接输出修改后的文本。';
    const userPrompt = `原文：\n${dto.text}\n\n修改要求：${dto.instruction}`;
    const polished = await this.aiService.chat(systemPrompt, userPrompt, 0.3);
    return { polished: polished.trim() || dto.text };
  }

  /** 用修改后的段落文本覆盖 DOCX 文件中的文字，保留原始格式。 */
  async saveAttachmentParagraphs(
    projectId: string,
    dto: {
      attachmentId: string;
      paragraphs: Array<{ index: number; text: string; rawRange?: { from: number; to: number } }>;
    },
    uploadedById?: string,
  ) {
    const oldAttachment = await this.prisma.attachment.findUnique({
      where: { id: dto.attachmentId },
      select: { id: true, fileName: true, objectKey: true, projectManagementStageId: true },
    });
    if (!oldAttachment) throw new NotFoundException('未找到对应附件');

    const filePath = resolve(process.cwd(), 'uploads', oldAttachment.objectKey);
    const buffer = await readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new NotFoundException('无法解析 DOCX 文档');

    // ── 第一步：提取所有非空 <w:p>（含在 docXml 中的字节起止位置） ──
    const rawParas: Array<{ xml: string; text: string; start: number; end: number }> = [];
    const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let pm;
    while ((pm = pRegex.exec(docXml)) !== null) {
      const xml = pm[0];
      const text = extractPlainText(xml);
      if (text.length > 0) {
        rawParas.push({ xml, text, start: pm.index, end: pm.index + xml.length });
      }
    }

    // ── 第二步：为每个编辑段构建编辑指令（仅修改前端发送的段落） ──
    const edits: Array<{ start: number; end: number; newXml: string }> = [];
    let skippedCount = 0;

    for (const ep of dto.paragraphs) {
      const range = ep.rawRange;
      if (!range || range.from > range.to || range.from >= rawParas.length) {
        skippedCount++;
        this.logger.warn(
          `段落[${ep.index}] rawRange 无效或越界，已跳过 — ` +
          `rawRange=${JSON.stringify(range)}, rawParas.length=${rawParas.length}`,
        );
        continue;
      }
      const to = Math.min(range.to, rawParas.length - 1);
      const fromText = rawParas[range.from].text.slice(0, 60);

      this.logger.log(
        `即将替换段落[${ep.index}] rawRange=[${range.from}..${to}] rawParas[${range.from}].text 前60字="${fromText}" → newText 前60字="${ep.text.slice(0, 60)}"`,
      );

      if (range.from === to) {
        // 单段落：保留 <w:r>/<w:rPr>，按比例分配文字
        edits.push({
          start: rawParas[range.from].start,
          end: rawParas[range.from].end,
          newXml: applyTextToParagraphXml(rawParas[range.from].xml, ep.text),
        });
      } else {
        // 多段落合并：全文写入第一段，其余清空
        edits.push({
          start: rawParas[range.from].start,
          end: rawParas[range.from].end,
          newXml: applyTextToParagraphXml(rawParas[range.from].xml, ep.text),
        });
        for (let i = range.from + 1; i <= to; i++) {
          edits.push({
            start: rawParas[i].start,
            end: rawParas[i].end,
            newXml: applyTextToParagraphXml(rawParas[i].xml, ''),
          });
        }
      }
    }

    // 如果前端发了段落但全部被跳过，说明提取不一致，直接报错方便定位
    if (dto.paragraphs.length > 0 && edits.length === 0) {
      this.logger.error(
        `全部 ${dto.paragraphs.length} 个段落 rawRange 都越界或无效！` +
        ` rawParas.length=${rawParas.length}, rawRanges=${JSON.stringify(dto.paragraphs.map(p => ({ idx: p.index, range: p.rawRange })))}`,
      );
      throw new BadRequestException(
        `无法定位修改位置：文件解析产生了 ${rawParas.length} 个段落，` +
        `但修改引用了越界的段落索引。请关闭编辑器后重新打开。`,
      );
    }

    this.logger.log(`保存 saveAttachmentParagraphs：${edits.length} 个编辑指令，${skippedCount} 个跳过`);

    // ── 第三步：从后往前应用编辑（保证位置索引不被前序修改偏移） ──
    edits.sort((a, b) => b.start - a.start);
    let modifiedXml = docXml;
    for (const edit of edits) {
      modifiedXml = modifiedXml.slice(0, edit.start) + edit.newXml + modifiedXml.slice(edit.end);
    }

    zip.file('word/document.xml', modifiedXml);
    const newBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 先持久化新文件，成功后再删除旧文件
    const persistResult = await this.persistUploadedFile(
      {
        fieldname: 'file', originalname: oldAttachment.fileName, encoding: '7bit',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(newBuffer), size: newBuffer.length,
        stream: null as any, destination: '', filename: '', path: '',
      } as Express.Multer.File,
      `${projectId}-tender-document`, uploadedById,
    );

    // 创建新 Attachment 数据库记录（persistUploadedFile 只写文件到磁盘，不写 DB）
    const newAttachment = await this.prisma.attachment.create({
      data: {
        projectManagementStageId: oldAttachment.projectManagementStageId,
        attachmentType: 'SUPPORTING_MATERIAL',
        fileName: persistResult.attachment.fileName,
        objectKey: persistResult.attachment.objectKey,
        mimeType: persistResult.attachment.mimeType,
        fileSize: persistResult.attachment.fileSize,
        uploadedById: persistResult.attachment.uploadedById,
      },
    });

    // 删除旧附件记录和文件
    await this.prisma.attachment.delete({ where: { id: oldAttachment.id } });
    try { await unlink(filePath); } catch {}

    this.logger.log(
      `附件替换成功：${oldAttachment.id} → ${newAttachment.id}, stage=${oldAttachment.projectManagementStageId}`,
    );

    return { success: true, attachmentId: newAttachment.id };
  }

  /** 两个文本的相似度（0-1），用于段落匹配。 */
  private textSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const minLen = Math.min(a.length, b.length);
    let prefixMatch = 0;
    for (let i = 0; i < minLen && a[i] === b[i]; i++) prefixMatch++;
    const prefixRatio = prefixMatch / minLen;
    const as = new Set(a), bs = new Set(b);
    let overlap = 0;
    for (const ch of as) if (bs.has(ch)) overlap++;
    const charRatio = overlap / Math.max(as.size, bs.size, 1);
    return prefixRatio * 0.6 + charRatio * 0.4;
  }

  /** 直接返回附件原始文件（供 iframe 查看模式使用）。 */
  async getAttachmentFile(attachmentId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, fileName: true, objectKey: true, mimeType: true },
    });
    if (!attachment) throw new NotFoundException('未找到对应附件');
    const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
    const buffer = await readFile(filePath);
    return { buffer, mimeType: attachment.mimeType, fileName: attachment.fileName };
  }

  /** 获取项目附件文件的纯文本内容（保留供旧代码兼容）。 */
  async getAttachmentTextContent(attachmentId: string): Promise<{ text: string; fileName: string }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, fileName: true, objectKey: true, mimeType: true },
    });
    if (!attachment) throw new NotFoundException('未找到对应附件');

    const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
    let text = await this.extractFileText(filePath, attachment.mimeType, attachment.fileName);

    // Fallback: 若 documentParser 解析 DOCX 失败，直接用 JSZip 提取 word/document.xml 的原始文本
    if (!text.trim() && attachment.fileName.toLowerCase().endsWith('.docx')) {
      try {
        const buffer = await readFile(filePath);
        const zip = await JSZip.loadAsync(buffer);
        const docXml = await zip.file('word/document.xml')?.async('string');
        if (docXml) {
          text = docXml.replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
          this.logger.log(`[getAttachmentTextContent] DOCX fallback extracted ${text.length} chars`);
        }
      } catch (err) {
        this.logger.warn(`[getAttachmentTextContent] DOCX fallback also failed: ${err}`);
      }
    }

    return { text, fileName: attachment.fileName };
  }

  /** 用修改后的文本替换附件文件并重新上传到同一阶段。 */
  async replaceAttachmentWithText(
    projectId: string,
    attachmentId: string,
    text: string,
    fileName: string,
    uploadedById?: string,
  ) {
    const oldAttachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, fileName: true, objectKey: true, projectManagementStageId: true },
    });
    if (!oldAttachment) throw new NotFoundException('未找到对应附件');

    // 构造 Multer-like file 对象并持久化
    const { attachment: newAttachment } = await this.persistUploadedFile(
      {
        originalname: Buffer.from(fileName, 'latin1'),
        buffer: Buffer.from(text, 'utf-8'),
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      } as unknown as Express.Multer.File,
      `${projectId}-tender-document`,
      uploadedById,
    );

    // 删除旧附件并连接新附件到同一阶段
    await this.prisma.attachment.delete({ where: { id: oldAttachment.id } });
    try { await unlink(resolve(process.cwd(), 'uploads', oldAttachment.objectKey)); } catch {}

    // 找到刚创建的附件记录并关联到原阶段
    const createdAttachment = await this.prisma.attachment.findFirst({
      where: { objectKey: newAttachment.objectKey },
      orderBy: { createdAt: 'desc' },
    });
    if (createdAttachment) {
      await this.prisma.attachment.update({
        where: { id: createdAttachment.id },
        data: { projectManagementStageId: oldAttachment.projectManagementStageId },
      });
    }

    return { success: true };
  }

  /** patcher 默认启用；仅当显式设置 TENDER_DOCX_PATCHER_ENABLED=false 时回退 mammoth 旧路径。 */
  private get patcherEnabled(): boolean {
    return process.env.TENDER_DOCX_PATCHER_ENABLED !== 'false';
  }

  async getAttachmentHtml(
    attachmentId: string,
  ): Promise<{ fileName: string; html: string; originalHash: string }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, fileName: true, objectKey: true },
    });
    if (!attachment) throw new NotFoundException('未找到对应附件');

    const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
    const buffer = await readFile(filePath);

    if (!this.patcherEnabled) {
      const result = await this.convertDocxToHtmlLegacy(buffer);
      const unrecognized = result.messages.filter(
        (m) => m.type === 'warning' && /Unrecognised/i.test(m.message),
      );
      if (unrecognized.length > 0) {
        this.logger.warn(`mammoth 未识别样式: ${unrecognized.map((m) => m.message).join('; ')}`);
      }
      return { fileName: attachment.fileName, html: result.value, originalHash: '' };
    }

    const { html, originalHash } = await convertDocxToHtmlPatched(buffer);
    return { fileName: attachment.fileName, html, originalHash };
  }

  /** 导入审阅版 DOCX：提取修订/批注/高亮并内嵌到 HTML 中。 */
  async importReviewFile(file: Express.Multer.File): Promise<{ html: string; annotationCount: number }> {
    const buffer = file.buffer;

    // 每条标注：{ fingerprint: 标注文字, type, note?: 批注内容 }
    interface InlineAnnotation { fingerprint: string; type: 'insertion' | 'deletion' | 'comment' | 'highlight'; note?: string }
    const inlineAnnotations: InlineAnnotation[] = [];

    try {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml')?.async('string');

      // 提取 XML 文本的辅助函数
      const xmText = (xml: string) => xml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();

      // ── 1. 提取批注引用范围 <w:commentRangeStart>/<w:commentRangeEnd> ──
      // 同时读取 comments.xml 获取批注文本
      const commentNotes: Map<number, string> = new Map();
      try {
        const commentsXml = await zip.file('word/comments.xml')?.async('string');
        if (commentsXml) {
          const commentRegex = /<w:comment\s+[^>]*w:id="(\d+)"[^>]*>([\s\S]*?)<\/w:comment>/g;
          let cm: RegExpExecArray | null;
          while ((cm = commentRegex.exec(commentsXml)) !== null) {
            const cid = parseInt(cm[1], 10);
            const note = xmText(cm[0]);
            if (note) commentNotes.set(cid, note);
          }
        }
      } catch {}

      if (docXml) {
        // 批注范围标记
        const rangeStarts = new Map<number, { idx: number; endIdx?: number }>();
        const rsRegex = /<w:commentRangeStart[^>]*w:id="(\d+)"[^>]*\/>/g;
        let rsm: RegExpExecArray | null;
        while ((rsm = rsRegex.exec(docXml)) !== null) {
          rangeStarts.set(parseInt(rsm[1], 10), { idx: rsm.index });
        }
        const reRegex = /<w:commentRangeEnd[^>]*w:id="(\d+)"[^>]*\/>/g;
        let rem: RegExpExecArray | null;
        while ((rem = reRegex.exec(docXml)) !== null) {
          const existing = rangeStarts.get(parseInt(rem[1], 10));
          if (existing) existing.endIdx = rem.index;
        }

        // 对每个批注范围，取首个有意义的短文本片段作为指纹（跨段落时 mammoth 会拆分，长文本无法精确匹配）
        for (const [cid, range] of rangeStarts) {
          if (!range.endIdx) continue;
          const middle = docXml.slice(range.idx, range.endIdx);
          const fullText = xmText(middle);
          if (fullText.length === 0) continue;
          // 仅用前 35 个字符做指纹（mammoth 输出中更易精确匹配，且跨段时不会因断行而丢失匹配）
          const shortFp = fullText.length > 35 ? fullText.slice(0, 35) + '…' : fullText;
          inlineAnnotations.push({
            fingerprint: shortFp,
            type: 'comment',
            note: commentNotes.get(cid),
          });
        }

        // ── 2. 提取高亮 run ──
        // mammoth 会丢弃 <w:highlight>，所以要对含高亮的 <w:r> 取其 <w:t> 文本作为指纹
        const highlightRegex = /<w:r[^>]*>[\s\S]*?<w:highlight[^>]*w:val="([^"]+)"[^>]*\/>[\s\S]*?<w:t[^>]*>([\s\S]*?)<\/w:t>[\s\S]*?<\/w:r>/g;
        let hm: RegExpExecArray | null;
        while ((hm = highlightRegex.exec(docXml)) !== null) {
          const color = hm[1];
          if (color === 'none') continue;
          const fp = hm[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
          if (fp.length >= 2) {
            inlineAnnotations.push({ fingerprint: fp, type: 'highlight' });
          }
        }

        // ── 3. 提取修订插入 <w:ins> ──
        for (const m of docXml.matchAll(/<w:ins[\s>][\s\S]*?<\/w:ins>/g)) {
          const fp = xmText(m[0]);
          if (fp.length >= 2) inlineAnnotations.push({ fingerprint: fp, type: 'insertion' });
        }

        // ── 4. 提取修订删除 <w:del> ──
        for (const m of docXml.matchAll(/<w:del[\s>][\s\S]*?<\/w:del>/g)) {
          const fp = xmText(m[0]);
          if (fp.length >= 2) inlineAnnotations.push({ fingerprint: fp, type: 'deletion' });
        }
      }

      this.logger.log(`审阅文件解析完成：${inlineAnnotations.length} 条内嵌标注`);
    } catch (e: any) {
      this.logger.warn(`审阅文件标注提取失败: ${e?.message}`);
    }

    // ── mammoth 转换（审阅版渲染专用：annotation 后处理依赖 mammoth 的 HTML 结构） ──
    const result = await this.convertDocxToHtmlLegacy(buffer);

    let html = result.value;

    // ── 后处理：在 HTML 中为每条标注包裹 <mark class="tfe-review-xxx"> ──
    // 为每条标注的文字指纹在 HTML 中查找对应位置，包裹标注标签
    for (const anno of inlineAnnotations) {
      let fp = anno.fingerprint;
      // 标注指纹可能带"…"省略尾缀
      // 查找纯文本匹配（在 > 和 < 之间，跳过标签）
      // 用更精确的从左到右扫描
      // 查找模式：先尝试完整指纹，若以"…"结尾且未匹配则去尾再试
      let searchStart = 0;
      let found = false;
      while (!found) {
        let idx = html.indexOf(fp, searchStart);
        if (idx === -1 && fp.endsWith('…')) {
          fp = fp.slice(0, -1);
          idx = html.indexOf(fp, searchStart);
        }
        if (idx === -1) break;
        // 确保不在 HTML 标签内（前面没有未闭合的 <）
        const before = html.slice(Math.max(0, idx - 200), idx);
        if (before.includes('<') && before.lastIndexOf('<') > before.lastIndexOf('>')) {
          // 匹配点在标签属性内，跳过
          searchStart = idx + 1;
          continue;
        }

        // 找到后，按类型包裹
        let className: string;
        let extraAttrs = '';
        if (anno.type === 'insertion') {
          className = 'tfe-review-insertion';
          extraAttrs = 'title="修订：新增"';
        } else if (anno.type === 'deletion') {
          className = 'tfe-review-deletion';
          extraAttrs = 'title="修订：删除"';
        } else if (anno.type === 'comment') {
          className = 'tfe-review-comment';
          const note = (anno.note || '（未填写批注内容）').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          extraAttrs = `data-comment="${note}" title="批注 · 点击查看内容"`;
        } else {
          className = 'tfe-review-highlight';
          extraAttrs = 'title="高亮"';
        }

        html = html.slice(0, idx) +
          `<mark class="${className}" ${extraAttrs}>${fp}</mark>` +
          html.slice(idx + fp.length);
        found = true;
      }
    }

    return { html, annotationCount: inlineAnnotations.length };
  }

  /** 统一的 mammoth DOCX→HTML 转换，保证所有视图格式一致。 */
  /** 旧路径：mammoth DOCX→HTML（有损），patcher 关闭时回退使用。 */
  private async convertDocxToHtmlLegacy(buffer: Buffer) {
    const styleMap = [
      "p[style-name='标题 1'] => h1:fresh",
      "p[style-name='标题 2'] => h2:fresh",
      "p[style-name='标题 3'] => h3:fresh",
      "p[style-name='标题 4'] => h4:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
      "p[style-name='TOC 标题'] => h2:fresh",
      "p[style-name='TOC Heading'] => h2:fresh",
      "p[style-name='章标题'] => h1:fresh",
      "p[style-name='节标题'] => h2:fresh",
      "p[style-name='条标题'] => h3:fresh",
      "p[style-name='Style1'] => h1:fresh",
      "p[style-name='Style2'] => h2:fresh",
      "p[style-name='Style3'] => h3:fresh",
      "p[style-name='题目'] => h1:fresh",
      "p[style-name='正文'] => p",
      "r[style-name='页眉'] => span",
      "r[style-name='页脚'] => span",
      "r[style-name='页码'] => span",
    ];
    return mammoth.convertToHtml(
      { buffer },
      {
        styleMap,
        convertImage: mammoth.images.imgElement((image: any) =>
          Promise.resolve({ src: `data:${image.contentType};base64,${Buffer.from(image.buffer).toString('base64')}` }),
        ),
      },
    );
  }

  /** 将编辑后的 HTML 转回 DOCX 并保存替换原附件。patcher 路径定点补丁、哈希守卫、归档旧版本。 */
  async saveAttachmentHtml(
    projectId: string,
    dto: { attachmentId: string; html: string; originalHash?: string },
    uploadedById?: string,
  ) {
    const oldAttachment = await this.prisma.attachment.findUnique({
      where: { id: dto.attachmentId },
      select: { id: true, fileName: true, objectKey: true, projectManagementStageId: true },
    });
    if (!oldAttachment) throw new NotFoundException('未找到对应附件');

    const oldPath = resolve(process.cwd(), 'uploads', oldAttachment.objectKey);
    const usePatcher = this.patcherEnabled && !!dto.originalHash;
    let newBuffer: Buffer;

    if (usePatcher) {
      const oldBuffer = await readFile(oldPath);
      const oldHash = createHash('sha256').update(oldBuffer).digest('hex');
      if (dto.originalHash !== oldHash) {
        throw new ConflictException('文件已被他人修改，请刷新重载');
      }
      try {
        newBuffer = await patchDocx(oldBuffer, dto.html, dto.originalHash!);
      } catch (e) {
        if (e instanceof ConcurrentEditError) throw new ConflictException(e.message);
        throw e;
      }
      // 生成变更摘要（旧 HTML vs 新 HTML 的差异行概要，供前端"修改历史"弹窗展示）
      const changeSummary = await summarizeHtmlDiff(oldBuffer, dto.html);
      // 归档旧版本（回滚保险）+ 记录变更摘要
      await this.archiveAttachmentVersion(
        oldAttachment.id, oldAttachment.objectKey, oldBuffer.length, oldHash, uploadedById, changeSummary,
      );
    } else {
      // legacy 回退：整体重建
      const children = htmlToDocxChildren(dto.html);
      const doc = new Document({ sections: [{ properties: {}, children }] });
      newBuffer = (await Packer.toBuffer(doc)) as Buffer;
    }

    // 上传新文件，更新现有 attachment 记录（不删除 DB 记录，避免外键问题）
    const persistResult = await this.persistUploadedFile(
      {
        fieldname: 'file', originalname: oldAttachment.fileName, encoding: '7bit',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(newBuffer), size: newBuffer.length,
        stream: null as any, destination: '', filename: '', path: '',
      } as Express.Multer.File,
      `${projectId}-tender-document`, uploadedById,
    );

    await this.prisma.attachment.update({
      where: { id: oldAttachment.id },
      data: {
        objectKey: persistResult.attachment.objectKey,
        fileSize: persistResult.attachment.fileSize,
        uploadedById: persistResult.attachment.uploadedById,
      },
    });

    // 清理旧物理文件（patcher 路径已在归档步骤复制到 tender-doc-versions/）
    try { await unlink(oldPath); } catch {}

    this.logger.log(
      `HTML 附件保存成功（${usePatcher ? 'patcher' : 'legacy'}）：${oldAttachment.id}`,
    );
    return { success: true, attachmentId: oldAttachment.id };
  }

  /** 归档当前 DOCX 到 tender-doc-versions/ 并写一条 AttachmentVersion 记录（含变更摘要）。 */
  private async archiveAttachmentVersion(
    attachmentId: string,
    objectKey: string,
    fileSize: number,
    originalHash: string,
    userId?: string,
    changeSummary?: string,
  ) {
    const src = resolve(process.cwd(), 'uploads', objectKey);
    const data = await readFile(src);
    const versionKey = `tender-doc-versions/${objectKey}-${Date.now()}.docx`;
    const dest = resolve(process.cwd(), 'uploads', versionKey);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
    await this.prisma.attachmentVersion.create({
      data: {
        attachmentId, objectKey: versionKey, fileSize, originalHash,
        createdById: userId,
        ...(changeSummary ? { changeSummary } : {}),
      },
    });
  }

  async listAttachmentVersions(attachmentId: string) {
    return this.prisma.attachmentVersion.findMany({
      where: { attachmentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        objectKey: true,
        fileSize: true,
        originalHash: true,
        createdAt: true,
        createdById: true,
        changeSummary: true,
        createdBy: { select: { username: true, displayName: true } },
      },
    });
  }

  /** 解析项目的 TENDER_DOCUMENT .docx 附件，用 AI 提取公告字段值供预填 */
  async parseAnnouncementFields(projectId: string): Promise<{ fields: Record<string, string>; extractedText: string } | null> {
    const stage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: projectId, stageKey: 'TENDER_DOCUMENT' },
      include: { attachments: true },
    });
    if (!stage) return null;
    const docxAttachment = stage.attachments.find((a) =>
      a.fileName.toLowerCase().endsWith('.docx'),
    );
    if (!docxAttachment) return null;

    const localPath = resolve(process.cwd(), 'uploads', docxAttachment.objectKey);
    let buffer: Buffer;
    try {
      buffer = await readFile(localPath);
    } catch {
      this.logger.warn(`parseAnnouncementFields: 源文件不存在 ${localPath}`);
      return null;
    }

    let extractedText: string;
    try {
      const mammothResult = await mammoth.extractRawText({ buffer });
      extractedText = (mammothResult.value || '').slice(0, 12000);
    } catch {
      this.logger.warn('parseAnnouncementFields: mammoth 解析失败');
      return null;
    }

    const fields: Record<string, string> = {};
    try {
      const aiResponse = await this.aiService.chatJson<Record<string, string>>(
        '你是采购公告字段提取助手。从招标文件原文中提取以下字段，输出严格的 JSON 对象（key 为字段名，value 为提取值）。只包含能提取到的字段，不确定的字段不要输出。字段：projectName(项目名称)、projectOverview(项目概况/采购内容简介)、maxPriceNumeric(预算金额/最高限价)、contactName(联系人)、contactPhone(联系电话)、contactEmail(联系邮箱)、qualificationRequirements(供应商资格要求)、bidOpeningTime(开标时间)。',
        extractedText,
        0.1,
      );
      if (aiResponse && typeof aiResponse === 'object') {
        for (const [k, v] of Object.entries(aiResponse)) {
          if (typeof v === 'string' && v.trim()) fields[k] = v.trim();
        }
      }
    } catch (e) {
      this.logger.warn(`parseAnnouncementFields: AI 提取失败 ${(e as Error).message}`);
    }

    return { fields, extractedText };
  }
}
