import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile, copyFile, access, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import JSZip = require('jszip');
import { Response } from 'express';
import { ResultStatus, SourceType, type Prisma } from '@prisma/client';
import { BID_DEADLINE_BEFORE_OPENING_MS, STAGE_LABEL } from '@water-erp/shared';
import { AiService } from '../ai/ai.service';
import { parseFlexibleDate } from '../common/parse-date.util';
import { assertAttachmentRules } from '../upload/attachment-rules';
import { generateProjectCode, generatePmiProjectCode, resolveHostedProjectCode, stageCodeFor } from '../common/project-code.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import * as mammoth from 'mammoth';
import { convertDocxToHtml as convertDocxToHtmlPatched } from './docx/docx-to-html.converter';
import { htmlToDocxChildren } from './docx/html-to-docx.converter';
import { getTenderTextCachePath, isLabelLine, isTenderMainFile, normalizeStageMatchText, getUploadDir, getProjectSummaryCachePath, getStageAnalysisCachePath, getStepAnalysisCachePath, buildStageAnalysisFingerprint, sanitizeFileName, normalizeUploadedFileName, summarizeHtmlDiff } from './docx/file-utils';
import { parseArchiveTxt } from './docx/archive-txt-parser';
import { decodeXmlText, extractPlainText, applyTextToParagraphXml } from './docx/paragraph-xml';
import { extractBiddingUnitsFromText, extractAwardedSupplierFromText, extractContractAmountFromText, extractAwardedSupplierFromAwardTable, extractAwardedSupplierFromContract, extractContractNumberFromText, extractExpertInfoFromText, extractProjectOverviewFromText, capOverviewLength } from './docx/field-extractor';
import { patchDocx, ConcurrentEditError } from './docx/html-to-docx.patcher';
import { Document, Packer } from 'docx';
import { DocumentParserService } from '../knowledge/services/document-parser.service';
import { LlmService } from '../local-ai/llm.service';
import { StorageService } from '../storage/storage.service';
import { GbCodeService } from '../common/gb-code.service';
import { ArchiveScopeService } from '../archive/archive-scope.service';
import { StageComplianceConfigService } from './stage-compliance-config.service';
import { ArchiveFlowService } from '../archive/archive-flow.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyScopeService } from '../company/company-scope';
import { CompleteProjectDto } from './dto/complete-project.dto';
import { CreateProjectFromInitiationDto } from './dto/create-project-from-initiation.dto';
import { QueryProjectManagementDto } from './dto/query-project-management.dto';
import { ReprocDto } from './dto/reproc.dto';
import { getEvaluationDefault } from '../bid/evaluation-method.config';
import { isNoneEvaluation } from '../bid/none-evaluation.util';
import { ScoreStandardValidator } from '../bid/score-standard-validator.service';
import { resolveActiveUserId } from '../bid/bid-project-notify.util';
import { SelectOfficialTenderDto } from './dto/select-official-tender.dto';
import { UpdateProjectStageDto } from './dto/update-project-stage.dto';
import { BID_TAIL_STAGE_KEYS, LOCKED_STAGES, PROJECT_WORKFLOW_STAGES } from './project-management.types';
import { getStageComplianceRules } from './stage-compliance-rules';
import { stripAnnouncementTitlePrefix } from '../common/announcement-title.util';
import { stripMojibake } from '../common/text-clean.util';

type ProjectManagementStatusValue = 'ACTIVE' | 'ARCHIVED' | 'RECYCLED' | 'TERMINATED';
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
  TERMINATED: 'TERMINATED',
};

/** 归档/终止/回收站项目不可再变更（2026-10-19 复查）：阶段推进/重开、附件增删与正文改写、
 *  提取信息回填等写路径统一前置校验 PMI.status=ACTIVE——UI 只读挡不住 API 直调
 *  （本日 TP-2026101901 实例即 API 层绕行；归档数据不可扰动，更正走 DA/T103 重新归档流程）。
 *  读取、分析缓存与 aiPolish（纯文本变换无落库）不受限。 */
const PMI_STATUS_MUTABLE_LABEL: Record<string, string> = {
  ARCHIVED: '已归档',
  TERMINATED: '已终止',
  RECYCLED: '已移入回收站',
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
/**
 * 立项日期字符串 → Date：日期语义按服务器本地时区构造（本地午夜 instant）。
 * 两处写入共用——裸 new Date('YYYY-MM-DD') 会按 UTC 午夜解析，与本地构造口径混存
 * 曾致时间轴显示偏移 8 小时（2026-10-09 实录，详见 timeline.service toIso 注释）。
 */
function parseInitiationDateInput(raw: string): Date {
  return new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
}

/**
 * 按采购方式选择完整阶段模板，与前端 PROCUREMENT_METHOD_STAGES 保持一致。
 * 从全部阶段中简单裁剪会引入不适用阶段，例如直接采购的采购文件阶段。
 */

const METHOD_STAGE_TEMPLATES: Record<string, Array<{ key: string; label: string }>> = {
  谈判采购: [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'SUPPLIER_INVITATION', label: '供应商邀请' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  竞价采购: [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  直接采购: [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示(供应商邀请)' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
    // 09 直接采购备案表（2026-09-28，《集团采购管理办法》附件6）：合同后、归档前备案
    { key: 'DIRECT_PURCHASE_FILING', label: '直接采购备案表' },
  ],
  邀请招标: [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '招标文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  询比采购: [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
};

/** 留痕时间戳：本地时区可读格式（YYYY-MM-DD HH:mm）——裸 ISO 对用户即串码观感（2026-10-27） */
function formatNoteTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@Injectable()
export class ProjectManagementService {
  private readonly logger = new Logger(ProjectManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gbCode: GbCodeService,
    private readonly aiService: AiService,
    private readonly llm: LlmService,
    private readonly documentParser: DocumentParserService,
    private readonly storage: StorageService,
    private readonly archiveScope: ArchiveScopeService,
    private readonly archiveFlow: ArchiveFlowService,
    private readonly stageCompliance: StageComplianceConfigService,
    private readonly notificationService: NotificationService,
    private readonly scoreStandardValidator: ScoreStandardValidator,
    private readonly companyScope: CompanyScopeService, // 末位追加（2026-10-10 leader 公司视野）：构造器 12 参，三个 spec 按位同步
  ) {}

  /** 按公司分组项目计数（2026-09-26 公司下拉语境化）：ARCHIVED=已完成、ACTIVE=进行中（RECYCLED/TERMINATED 不计） */
  /** 按公司分组项目计数（公司下拉语境化计数：数据库/台账=已完成 ARCHIVED、进度=进行中 ACTIVE）。
   *  可见性收口（2026-10-28）：与 list() 同口径——此前同族四个 company-counts 端点中唯一
   *  无视野的（admin 全量恰巧合、leader/staff 可拉到平台全量分组计数）。 */
  async companyCounts(status?: 'ACTIVE' | 'ARCHIVED', user?: AuthenticatedUser) {
    const where: Record<string, unknown> = { status: status ?? 'ACTIVE' };
    if (user?.role === 'leader' || user?.role === 'admin') {
      // leader/admin：公司视野（admin 不传参=全部，与下拉「全部公司」一致）
      Object.assign(where, this.companyScope.filter(await this.companyScope.resolveScope(user)));
    } else {
      // staff（同 list 可见性）：仅本人项目，分组计数=列表行
      where.createdById = user?.sub ?? '__no_user__';
    }
    const groups = await this.prisma.projectManagementItem.groupBy({
      by: ['companyName'],
      where,
      _count: { _all: true },
    });
    return groups
      .map(g => ({ name: g.companyName?.trim() || '未归属', count: g._count._all }))
      .sort((a, b) => (a.name === '未归属' ? 1 : b.name === '未归属' ? -1 : b.count - a.count || a.name.localeCompare(b.name, 'zh')));
  }

  async list(query: QueryProjectManagementDto, user?: AuthenticatedUser) {
    const where: Record<string, unknown> = {};

    // 项目可见性（拍板 1C，2026-08-24；2026-10-10 修订）：staff 仅见本人创建的项目；
    // leader 见本公司全部项目（用户裁定：leader 在 :3005 项目管理看公司全量）；
    // admin 全量 + ?companyId= 单选/逗号多选（2026-10-14 多选统一——收口 resolveScope，
    // 原单选直赋 where.companyId 的旁路删除；非法 id 由 resolveScope 过滤为有效集）。
    // user=undefined 属鉴权异常，返回空集不泄露数据。
    if (user?.role === 'leader') {
      // leader 公司视野：与数据库/台账等页同口径（resolveScope 强制本人公司，传参忽略）
      Object.assign(where, this.companyScope.filter(await this.companyScope.resolveScope(user)));
    } else if (user?.role === 'admin') {
      // admin 公司视图：不传/'all' = 全部；支持 a,b,c 逗号多选（跨子公司统计）
      Object.assign(where, this.companyScope.filter(await this.companyScope.resolveScope(user, query.companyId)));
    } else {
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
        terminatedBy: true,
      },
    });

    return items.map((item) => ({
      ...item,
      budgetAmount: Number(item.budgetAmount),
      createdByName: item.createdBy?.displayName || item.createdBy?.username || null,
      terminatedByName: item.terminatedBy?.displayName || item.terminatedBy?.username || null,
    }));
  }

  /** 项目管理权（2026-10-10 读写分级）：仅创建人可管理（修改/终止/回收/恢复/彻底删除）；
   *  leader 本公司与 admin 全量均为只读视野（PmiOwnershipGuard 同口径，服务端第二道闸）。 */
  private assertCanManageProject(
    user: AuthenticatedUser | undefined,
    project: { createdById: string | null },
    deniedMessage: string,
  ): void {
    if (!user || project.createdById === user.sub) return;
    throw new ForbiddenException(deniedMessage);
  }

  /** 按采购方式构建评标办法+公式默认值 */
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
   * N16 方案 A：公告直建项目自动补建最小 PMI。
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

    // 编号：与 create 流程同规则（勿另造格式）—— 公司编码-方式前缀-YYYYMMDD##
    const projectCode = await generatePmiProjectCode(tx, {
      companyId: companyStamp.companyId ?? null,
      procurementMethod: dto.procurementMethod,
    });
    const now = new Date();
      const gbProjectCode = await this.gbCode.allocateProjectCode().catch(() => null); // A1（B.4.3.2）

    // 阶段集：全套 + 方法过滤（与 create 流程同口径）
    const needsPublicAnnouncement = ['竞价采购', '直接采购', '邀请招标'].includes(dto.procurementMethod);
    const stagesToCreate = PROJECT_WORKFLOW_STAGES.filter(
      (s) =>
        (needsPublicAnnouncement || s.key !== 'PUBLIC_ANNOUNCEMENT')
        // 09 备案表为直接采购专属（2026-09-28）：其余方式不得带入（末阶段归档闸门按最后阶段判定，
        // 带入后该方式将永远无法完成归档）
        && (s.key !== 'DIRECT_PURCHASE_FILING' || dto.procurementMethod === '直接采购'),
    );
    // 公告直建=前置链路（需求/立项/采购文件/公告公示/供应商邀请）以公告为准补记 COMPLETED
    const completedKeys = new Set(['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'SUPPLIER_INVITATION']);

    const item = await tx.projectManagementItem.create({
      data: {
        projectCode,
        ...(gbProjectCode ? { gbProjectCode } : {}),
        // PMI 标题剥离公告类型前缀（与 BidProject.name 同口径，2026-09-11）
        title: stripAnnouncementTitlePrefix(dto.title),
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
        stageCode: stageCodeFor(projectCode, stage.key, 1),
        // currentStage 指向的开标评标阶段置 IN_PROGRESS——:3005 流程卡动作按钮按
        // isInProgress 渲染，NOT_STARTED 会让开标确认面板在 DOWNLOAD/SUBMIT 期（开标前准备窗口）不可达
        status: stage.key === 'BID_EVALUATION'
          ? PROJECT_STAGE_STATUS.IN_PROGRESS
          : completedKeys.has(stage.key) ? PROJECT_STAGE_STATUS.COMPLETED : PROJECT_STAGE_STATUS.NOT_STARTED,
        completedAt: completedKeys.has(stage.key) ? now : null,
      })),
    });
    this.logger.log(`公告直建补 PMI: ${projectCode}（${stagesToCreate.length} 阶段，currentStage→BID_EVALUATION）`);
    return { id: item.id, projectCode };
  }

  /** 2026-10-28 二轮隔离：按轮解析 PMI 宿主 BidProject（round 缺省=当前轮）——替代裸 projectManagementItemId 查找，
   *  防止多轮项目误读旧轮（BidProject 无该轮行时返回 null，调用方自行兜底）。 */
  private async resolveRoundBidProject<Select extends Prisma.BidProjectSelect>(
    pmiId: string,
    round: number | undefined,
    select: Select,
  ) {
    let targetRound = round;
    if (targetRound == null) {
      const pmi = await this.prisma.projectManagementItem.findUnique({
        where: { id: pmiId },
        select: { currentRound: true },
      });
      targetRound = pmi?.currentRound ?? 1;
    }
    return this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: pmiId, round: targetRound },
      select,
      orderBy: { createdAt: 'desc' },
    });
  }

  async ensureBidProject(itemId: string, round?: number) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        title: true,
        projectCode: true,
        procurementMethod: true,
        budgetAmount: true,
        bidOpeningTime: true,
        documentAcquireTime: true,
        initiationDate: true,
        projectOverview: true,
        currentRound: true,
        // 国标 18 位基码（2026-10-20 缺码事故：懒建 BidProject 复用宿主基码赋 21 位采购码）
        gbProjectCode: true,
        // 公司归属写时快照（BidCompanyScopeGuard 据此放行 :3005 开标确认面板）
        companyId: true,
        companyName: true,
      },
    });
    if (!item) {
      throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    }

    const targetRound = round ?? item.currentRound ?? 1;

    // 多轮：按 (projectManagementItemId, round) 查当前轮的 BidProject
    const existing = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: itemId, round: targetRound },
      select: {
        id: true,
        projectCode: true,
        name: true,
        stage: true,
        procurementMethod: true,
        // none-eval（2026-10-19 审查 F1 / spec §4.7）：:3005 评分标准卡信息态判定字段——
        // 此前 existing 路径缺列、返回体无 evaluationMethod，前端只能回退 detail 全量接口
        evaluationMethod: true,
        openTime: true,
        deadline: true,
        // 存量治愈判定（2026-10-20 缺码事故）：旁路创建的无码行现场补码，不等 seed 回填
        gbProcureCode: true,
      },
    });
    // 关联的招标公告发布时间（投递时间范围起点；2026-09-29 收紧匹配——此前仅按标题精确
    // 匹配，公告标题带「竞价采购公告 — 」等前缀时匹配不到，已发布公告被开标确认误读为
    // 「待发布」）：先按 relatedProjectCode 匹配（新链路=PMI 项目编号 SWHI-*；存量老公告
    // =BidProject 编码），标题仅作历史兜底。
    const noticeByCode = await this.prisma.announcement.findFirst({
      where: {
        type: 'BID_NOTICE',
        relatedProjectCode: { in: [item.projectCode, existing?.projectCode].filter((c): c is string => !!c) },
      },
      orderBy: { publishDate: 'desc' },
      select: { publishDate: true },
    });
    const announcement = noticeByCode ?? (await this.prisma.announcement.findFirst({
      where: { title: item.title, type: 'BID_NOTICE' },
      orderBy: { publishDate: 'desc' },
      select: { publishDate: true },
    }));
    const publishTimeIso = announcement?.publishDate
      ? announcement.publishDate.toISOString()
      : null;

    if (existing) {
      // 存量治愈（2026-10-20 缺码事故）：无码行现场补码放行——不重建不换码，补码失败降级告警
      // （发布闸仍有自愈兜底，此处治愈让开标确认/评分标准链路尽早拿码）
      if (!existing.gbProcureCode) {
        await this.gbCode.backfillProcureCodeFor({
          id: existing.id,
          gbProcureCode: existing.gbProcureCode,
          projectManagementItemId: itemId,
        }).catch((e) => {
          this.logger.warn(`国标采购编码治愈失败（ensureBidProject 存量分支，发布闸将自愈兜底）: ${(e as Error).message}`);
        });
      }
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
    // fallback 不再取 now（旧行为 deadline=now-12h，项目一创建即 DEADLINE_PASSED，供应商无法投递）
    const parsedOpen = parseBidOpeningTime(item.bidOpeningTime);
    const openTime = parsedOpen ?? (item.initiationDate ?? new Date(Date.now() + 72 * 60 * 60 * 1000));
    // 投递截止 = 开标前 BID_DEADLINE_BEFORE_OPENING_MS（间隔常量，2026-10-16 起 10 分钟；第五写点）；
    // 兜底【仅当 openTime 来自纯兜底（now+72h）时顺延至 24h 后】：真实解析出的历史开标
    // 时间（如老项目时间轴 3/26）若也顺延，会出现"开标 3/26 / 截止 9/1"倒挂——历史项目
    // 忠实过期（deadline=开标−间隔常量，供应商端显示已截止、不可投），不再人为续命。
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
        // 2026-10-19 编号统一：PMI 宿主懒建直接继承 PMI 业务编号（多轮 -Rn 后缀）；
        // PMI 编号缺失（历史空值）回退三段式生成
        projectCode: item.projectCode
          ? await resolveHostedProjectCode(this.prisma, { pmiCode: item.projectCode, preferredRound: targetRound })
          : await generateProjectCode(this.prisma, item.procurementMethod || '公开招标', 'bidProject', { companyId: item.companyId }),
        // A1（B.4.3.3/4）国标采购编码（2026-10-20 缺码事故补齐：懒建路径与 createProject 同口径——
        // 宿主 PMI 18 位基码复用；分配失败降级不阻塞建项，发布闸自愈兜底）
        ...(await this.gbCode.allocateProcureCode(item.gbProjectCode ?? null).catch((e) => {
          this.logger.warn(`国标采购编码分配失败（PMI 懒建降级为无码，须回填）: ${(e as Error).message}`);
          return null;
        }) ?? {}),
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
        // 按采购方式自动设置评标办法 + 价格公式默认值
        ...this.buildEvaluationDefaults(item.procurementMethod || '公开招标'),
      },
    });
    this.logger.log(
      `为项目管理项 ${itemId} 第 ${targetRound} 轮创建开评标项目 ${created.projectCode}`,
    );
    // 收尾：回填已接受邀请回执的供应商进候选池（rsvp 常早于 BidProject 懒创建——
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
      // 与 existing 路径返回体对齐（none-eval F1）：创建时已由 buildEvaluationDefaults 落默认值
      evaluationMethod: created.evaluationMethod,
      round: targetRound,
      openTime: created.openTime.toISOString(),
      deadline: created.deadline.toISOString(),
      publishTime: publishTimeIso,
    };
  }

  /**
   * 流标后再次采购（2026-10-23 统一流改造，spec 2026-10-23-abort-restart-unification）：
   * 入参起点（采购需求/采购立项/采购文件）+ 可选采购方式变更 + 可选基本信息差异更新。
   * 前置：当前轮 BidProject 已终局且系流标（ABORTED；或开标归档 ARCHIVED 且 riskNote 流标前缀）。
   * 单事务：旧轮开标评标置流标终态 → 删当前轮尾部（定标/合同/备案表）→ 按方式模板从起点
   * 截取到模板末尾插入新轮（起点激活）→ PMI 指针/方式/基本信息更新。
   */
  async reproc(itemId: string, dto: ReprocDto) {
    const START_STAGES = ['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT'];
    const TAIL_STAGE_KEYS = ['AWARD_DECISION', 'CONTRACT', 'DIRECT_PURCHASE_FILING'];

    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true, projectCode: true, procurementMethod: true, currentRound: true, status: true,
        requesterName: true, requesterDepartment: true, title: true, procurementCategory: true,
        budgetAmount: true, projectReason: true, supplierRequirements: true, initiationDate: true,
        procurementOrganizationForm: true, isAnnualBudget: true,
        bidOpeningTime: true, documentAcquireTime: true,
        stages: { orderBy: { stageOrder: 'asc' } },
      },
    });
    if (!item) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (item.status !== PROJECT_MANAGEMENT_STATUS.ACTIVE) {
      throw new BadRequestException('仅进行中的项目可以发起再次采购。');
    }

    const startStage = dto?.startStageKey;
    if (!START_STAGES.includes(startStage)) {
      throw new BadRequestException({ error: '重启起点须为 采购需求 / 采购立项 / 采购文件 三者之一', code: 'INVALID_START_STAGE' });
    }

    // 采购方式：不传沿用；传入须有阶段模板（PMI 五种）
    const method = dto?.procurementMethod?.trim() || item.procurementMethod;
    const template = METHOD_STAGE_TEMPLATES[method];
    if (!template) {
      throw new BadRequestException({ error: `不支持的采购方式：${method}`, code: 'UNSUPPORTED' });
    }
    const segment = template.filter((s, i) => i >= template.findIndex((t) => t.key === startStage));

    // 幂等：最新一轮（maxRound > 1）仍处「刚开轮未推进」→ 拒绝重复开轮
    //（口径不变：首阶段 IN_PROGRESS 且整轮无 COMPLETED；首阶段按 stageOrder 取最小）
    // 须先于下方流标前置闸（2026-10-23 修复轮 1）：历史 NOT_STARTED 卡死轮从未建
    // BidProject，自愈若排在流标闸后会被 BID_NOT_ABORTED 挡死、不可达
    const maxRound = item.stages.reduce((m, s) => Math.max(m, s.round ?? 1), 1);
    if (maxRound > 1) {
      const latestRound = item.stages.filter((s) => s.round === maxRound);
      const first = [...latestRound].sort((a, b) => a.stageOrder - b.stageOrder)[0];
      const untouched = !!first
        && first.status === PROJECT_STAGE_STATUS.IN_PROGRESS
        && first.completedAt === null
        && latestRound.every((s) => s.status !== PROJECT_STAGE_STATUS.COMPLETED);
      if (untouched) {
        throw new BadRequestException({ error: '已有新一轮采购等待开始，无需重复发起', code: 'REPROC_ALREADY_PENDING' });
      }
      // 存量自愈：历史 NOT_STARTED 死锁轮——激活既有轮次而非叠加新轮
      const legacyStuck = !!first
        && first.status === PROJECT_STAGE_STATUS.NOT_STARTED
        && latestRound.every((s) => s.status !== PROJECT_STAGE_STATUS.COMPLETED);
      if (legacyStuck) {
        await this.prisma.$transaction([
          this.prisma.projectManagementStage.update({
            where: { id: first.id },
            data: { status: PROJECT_STAGE_STATUS.IN_PROGRESS },
          }),
          this.prisma.projectManagementItem.update({
            where: { id: itemId },
            data: { currentStage: first.stageKey, currentRound: maxRound },
          }),
        ]);
        this.logger.log(`项目 ${itemId} 自愈激活第 ${maxRound} 轮首阶段 ${first.stageKey}（历史死锁数据）`);
        return { round: maxRound, inserted: 0, activated: true };
      }
    }

    // 前置：当前轮 BidProject 已终局且系流标（createdAt desc 与全库当前轮解析口径
    // 一致——同轮多行时取最新，防 findFirst 任意取行误判未流标）
    const currentRound = item.currentRound ?? 1;
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: itemId, round: currentRound },
      select: { stage: true, riskNote: true },
      orderBy: { createdAt: 'desc' },
    });
    const bpAborted = !!bp && (bp.stage === 'ABORTED' || (bp.stage === 'ARCHIVED' && (bp.riskNote ?? '').startsWith('流标')));
    if (!bp || !bpAborted) {
      throw new ConflictException({
        error: '当前轮开评标流程尚未流标，请先发布流标公告完成流标，再发起再次采购',
        code: 'BID_NOT_ABORTED',
      });
    }

    // 删尾防御：当前轮尾部阶段挂有附件 → 拒绝（流标语义下不应有）
    const tailStages = item.stages.filter(
      (s) => (s.round ?? 1) === currentRound && TAIL_STAGE_KEYS.includes(s.stageKey),
    );
    if (tailStages.length) {
      const withAttachments = await this.prisma.projectManagementStage.findMany({
        where: { id: { in: tailStages.map((s) => s.id) } },
        select: { stageName: true, attachments: { select: { id: true } } },
      });
      const dirty = withAttachments.filter((s) => s.attachments.length > 0);
      if (dirty.length) {
        throw new ConflictException({
          error: `当前轮尾部阶段已挂材料（${dirty.map((s) => s.stageName).join('、')}），无法删除重排，请先人工处理`,
          code: 'TAIL_HAS_ATTACHMENTS',
        });
      }
    }

    // 基本信息差异更新（仅传入且有变化的字段落库）
    const infoData: Record<string, unknown> = {};
    const b = dto?.basicInfo ?? {};
    const strFields = ['requesterName', 'requesterDepartment', 'title', 'procurementCategory', 'projectReason', 'supplierRequirements', 'procurementOrganizationForm'];
    for (const f of strFields) {
      const v = (b as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.trim() && v !== (item as unknown as Record<string, unknown>)[f]) infoData[f] = v.trim();
    }
    if (typeof b.budgetAmount === 'number' && b.budgetAmount !== Number(item.budgetAmount)) infoData.budgetAmount = b.budgetAmount;
    if (typeof b.isAnnualBudget === 'boolean' && b.isAnnualBudget !== item.isAnnualBudget) infoData.isAnnualBudget = b.isAnnualBudget;
    if (typeof b.initiationDate === 'string' && b.initiationDate) {
      const d = parseInitiationDateInput(b.initiationDate);
      if (!item.initiationDate || d.getTime() !== item.initiationDate.getTime()) infoData.initiationDate = d;
    }
    if (method !== item.procurementMethod) infoData.procurementMethod = method;

    const newRound = maxRound + 1;
    // 追加式 stageOrder：删当前轮尾部后，新轮接在剩余阶段末尾
    const remainingMaxOrder = item.stages
      .filter((s) => !((s.round ?? 1) === currentRound && TAIL_STAGE_KEYS.includes(s.stageKey)))
      .reduce((m, s) => Math.max(m, s.stageOrder), 0);

    await this.prisma.$transaction(async (tx) => {
      // 旧轮流标终态标注（原 reproc 口径）：开标评标置 COMPLETED + 流标备注
      await tx.projectManagementStage.updateMany({
        where: { projectManagementItemId: itemId, round: currentRound, stageKey: 'BID_EVALUATION' },
        data: { status: PROJECT_STAGE_STATUS.COMPLETED, note: '已流标（重新采购）' },
      });
      if (tailStages.length) {
        await tx.projectManagementStage.deleteMany({ where: { id: { in: tailStages.map((s) => s.id) } } });
      }
      await tx.projectManagementStage.createMany({
        data: segment.map((s, i) => ({
          projectManagementItemId: itemId,
          stageKey: s.key,
          stageName: s.label,
          stageOrder: remainingMaxOrder + 1 + i,
          round: newRound,
          stageCode: item.projectCode ? stageCodeFor(item.projectCode, s.key, newRound) : null,
          status: i === 0 ? PROJECT_STAGE_STATUS.IN_PROGRESS : PROJECT_STAGE_STATUS.NOT_STARTED,
        })),
      });
      // 2026-10-28 二轮隔离：旧轮 PMI 层开标/获取时间快照到旧轮 BidProject，PMI 字段清空——
      // 两字段语义收窄为「当前轮值」，新轮基本信息不带旧轮时间（历史轮展示改读快照列）
      if (item.bidOpeningTime || item.documentAcquireTime) {
        await tx.bidProject.updateMany({
          where: { projectManagementItemId: itemId, round: currentRound },
          data: { roundOpeningTime: item.bidOpeningTime, roundDocAcquireTime: item.documentAcquireTime },
        });
      }
      await tx.projectManagementItem.update({
        where: { id: itemId },
        data: { ...infoData, currentStage: segment[0].key, currentRound: newRound, bidOpeningTime: null, documentAcquireTime: null },
      });
    });

    this.logger.log(
      `项目 ${itemId} 再次采购：删当前轮尾部 ${tailStages.length} 个阶段，插入第 ${newRound} 轮（${segment.length} 个阶段，起点 ${segment[0].key}，方式 ${method}）`,
    );
    return { round: newRound, inserted: segment.length };
  }

  /**
   * 失效 /tmp 采购文件文本缓存（extractTenderFields 优先读它）。
   * 采购文件内容一旦变更（编辑器保存/段落保存/文本替换/删除附件）必须调用，
   * 否则左栏「AI 提取」继续读旧文本、提出旧的开标时间/获取时间/项目概况
   * （2026-10-12 实录：编辑器 saveAttachmentHtml 只清了 DB extractedText，
   *  /tmp 缓存未清 → 提取恒命中三天前的旧文本）。
   */
  private async invalidateTenderTextCache(projectId: string) {
    try {
      await unlink(getTenderTextCachePath(projectId));
    } catch {
      /* 缓存不存在即无事可做 */
    }
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
        // 最新上传优先：多次上传采购文件主文件时，find 取到的应是最新一份
        include: { attachments: { orderBy: { createdAt: 'desc' } } },
      });
      if (!stage) throw new NotFoundException({ error: '未找到采购文件阶段', code: 'NOT_FOUND' });

      const tenderFile = stage.attachments.find(
        (a) => isTenderMainFile(a.fileName),
      );
      if (!tenderFile) throw new BadRequestException({ error: '未找到采购文件，请先上传', code: 'NO_TENDER_FILE' });

      try {
        text = await this.readAttachmentText(tenderFile.objectKey, tenderFile.mimeType, tenderFile.fileName);
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
      // 显式点击「AI 提取」（field 传入）→ AI 优先：正则只会复述文件里「项目概况」章节的
      // 模板套话（如「本项目共计1个包，设置1名成交供应商，询比详见第五章」，2026-10-15 实录），
      // 用户点名要 AI 就给实质提取（prompt 限采买标的/范围、排除条款性套话）；AI 落空回退正则。
      // AI 产物免二次抛光：本就是成段干净散文，再过一次 LLM 只加 25-60s 无谓转圈。
      // 自动路径（上传后自动提取/全字段）仍正则优先 + 抛光——省时且模板文档正则已够用。
      const explicitOverview = field === 'projectOverview';
      let fromAi = false;
      let raw: string | null = null;
      if (explicitOverview) {
        raw = await this.aiExtractProjectOverview(text, procurementMethod);
        fromAi = !!raw;
      }
      if (!raw) raw = extractProjectOverviewFromText(text, procurementMethod);
      if (!raw && !explicitOverview) raw = await this.aiExtractProjectOverview(text, procurementMethod);
      // 落库口终极闸：抛光是 LLM 改写、长度无硬保证（2026-10-16 稳健性加固）
      const val = capOverviewLength(raw && !fromAi ? await this.aiMinimalPolish(raw) : raw);
      if (val) updateData.projectOverview = val;
      result.projectOverview = val;
    }
    if (wants('bidOpeningTime')) {
      // 规则提取落空时 AI 兜底（与 projectOverview/documentAcquireTime 同口径）——
      // 旧版无兜底，直接采购模板改「开标时间」标签后正则不认 → 恒报「未能提取到该字段信息」
      let raw = this.extractBidOpeningTimeFromText(text, procurementMethod);
      if (!raw) raw = await this.aiExtractBidOpeningTime(text);
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

    // 直接采购「拟定供应商」不再写入 awardedSupplier（2026-10-16 收口）：「中标单位」
    // 在开标评标完成前恒空——合法写入时点 = 评标结果回写/定标审批表/中标通知书/合同附件。
    // 公告向导的「核对供应商」继续走 checkSupplierChange（只读提取，不写库）。

    if (Object.keys(updateData).length > 0) {
      await this.prisma.projectManagementItem.update({ where: { id: itemId }, data: updateData });
    }
    return field ? { [field]: result[field] ?? null } : result;
  }

  /**
   * 拟定供应商核对：重新解析采购文件提取当前供应商名（纯公司名），只读不写库。
   * 供公告「拟定供应商名称」字段的核对按钮判断「供应商是否已更换」——
   * 前端以公告草稿 supplierName 为比对基线（2026-10-16 起 awardedSupplier 开标评标前恒空，
   * current 字段仅为接口兼容保留，无消费方）；确认更新只改公告草稿字段，不写 PMI。
   */
  async checkSupplierChange(itemId: string) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: { awardedSupplier: true },
    });
    if (!item) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });

    // 取采购文件文本（缓存优先，回退 MinIO 下载解析）
    const cachePath = getTenderTextCachePath(itemId);
    let text: string;
    try {
      text = await readFile(cachePath, 'utf8');
      if (!text || text.length < 50) throw new Error('empty cache');
    } catch {
      const stage = await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: itemId, stageKey: 'TENDER_DOCUMENT' },
        // 最新上传优先：多次上传采购文件主文件时，find 取到的应是最新一份
        include: { attachments: { orderBy: { createdAt: 'desc' } } },
      });
      const tenderFile = stage?.attachments.find(
        (a) => isTenderMainFile(a.fileName),
      );
      if (!tenderFile) {
        return { current: item.awardedSupplier ?? '', extracted: null, changed: false, reason: '未找到采购文件' };
      }
      try {
        text = await this.readAttachmentText(tenderFile.objectKey, tenderFile.mimeType, tenderFile.fileName);
        try { await writeFile(cachePath, text, 'utf8'); } catch {}
      } catch (e) {
        this.logger.warn(`[checkSupplierChange] 采购文件解析失败: ${(e as Error).message}`);
        return { current: item.awardedSupplier ?? '', extracted: null, changed: false, reason: '采购文件解析失败' };
      }
    }

    const extracted = extractAwardedSupplierFromText(text) || null;
    const normalize = (n: string) => n.replace(/\s+/g, '');
    const current = item.awardedSupplier?.trim() ?? '';
    const changed = !!extracted && !!current && normalize(extracted) !== normalize(current);
    return {
      current,
      extracted,
      changed,
      reason: extracted ? null : '未能从采购文件中提取到供应商名称——若刚在采购文件编写中修改了供应商，请重新导出并上传采购文件后再核对',
    };
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
          const text = await this.readAttachmentText(att.objectKey, att.mimeType, att.fileName);
          if (text && text.length > 20) {
            contextParts.push(`【${stage.stageKey} - ${att.fileName}】${text.slice(0, 4000)}`);
          }
        } catch { /* 单个文件读取失败不阻塞 */ }
      }
    }

    const context = contextParts.join('\n\n');

    // 候选池：真实供应商库
    // 旧实现只对 LLM 说「从供应商库中推荐」却不喂名单、不校验结果——LLM 凭行业常识
    // 编造「四川诺克机械」等库外公司名，用户可选到库里不存在的供应商。现改为：
    // 库内 APPROVED 供应商经关键词粗筛后作为候选名单喂给 AI，且返回结果强制校验命中名单。
    const pool = await this.prisma.supplier.findMany({
      where: { status: 'APPROVED' },
      select: {
        name: true,
        tags: true,
        businessScope: true,
        classification: { select: { name: true } },
      },
      take: 600,
    });
    if (pool.length === 0) {
      return { suppliers: [], contextSummary: '供应商库为空（无已入库供应商），无法推荐' };
    }

    // 关键词粗筛：项目标题/类别/事由与供应商 名称/标签/经营范围 匹配计分，取 top 60；
    // 无命中时退化为库内前 60（按名称稳定排序），保证 AI 始终有真实候选可选。
    const keywords = [project.title, project.procurementCategory, project.projectReason, project.supplierRequirements]
      .filter(Boolean).join(' ')
      .replace(/[（）()【】\[\]、，。：:;；/\\\-—_*]/g, ' ');
    const kwSet = [...new Set(keywords.split(/\s+/).filter((k) => k.length >= 2))];
    const scored = pool.map((s) => {
      const hay = `${s.name} ${(s.tags || []).join(' ')} ${s.businessScope || ''} ${s.classification?.name || ''}`;
      let score = 0;
      for (const kw of kwSet) if (hay.includes(kw)) score++;
      return { s, score };
    });
    const shortlist = scored
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name, 'zh'))
      .slice(0, 60)
      .map(({ s }) => {
        const tags = (s.tags || []).slice(0, 4).join('、');
        const scope = (s.businessScope || '').slice(0, 60);
        return `- ${s.name}${tags ? `（${tags}）` : ''}${scope ? `：${scope}` : ''}`;
      })
      .join('\n');

    // 调用 AI 推荐（从给定名单中选择，不得编造）
    const systemPrompt = `你是采购供应商智能推荐助手。根据项目采购信息，从下面给出的【候选供应商名单】中推荐 3-5 家最合适的供应商。
【候选供应商名单】（只能从这个名单中选择，名单之外的公司一律不得输出）：
${shortlist}

请输出一个 JSON 对象，结构固定为：
{
  "suppliers": [
    {"name": "供应商名称", "reason": "推荐理由（50字以内）", "matchScore": 85}
  ]
}
要求：
1. name 必须与候选名单中的名称逐字一致（可省略名单中括号内的补充说明），严禁编造名单之外的公司名
2. 推荐理由基于项目的实际采购内容和要求
3. matchScore 为 0-100 的匹配度评分
4. 只输出 JSON，不要任何解释`;

    const normalizeName = (n: string) => n.replace(/\s+/g, '').toLowerCase();
    const poolNames = new Set(pool.map((s) => normalizeName(s.name)));

    try {
      const result = await this.aiService.chatJson<{
        suppliers: Array<{ name: string; reason: string; matchScore: number }>;
      }>(systemPrompt, context.slice(0, 4000), 0.3);
      // 幻觉兜底：AI 输出的名称必须命中库内名单，未命中的直接丢弃
      const validated = (result.suppliers || [])
        .filter((s) => s?.name && poolNames.has(normalizeName(s.name)))
        .slice(0, 5);
      return {
        suppliers: validated,
        contextSummary: context.slice(0, 500),
      };
    } catch {
      // AI 不可用时返回空列表
      return { suppliers: [], contextSummary: context.slice(0, 500) };
    }
  }

  /**
   * 部门编号发号：{部门编码}-{年度}-{部门内顺序号 3 位}，如 GCKC-2026-003。
   * - 部门编码取 Department.code（按 requesterDepartment 匹配；无 code 时生成并回写）
   * - 顺序号 = 同部门编码 + 同年度已用最大号 +1；跨年自动从 001 重新起号
   * - 防重：FOR UPDATE 锁部门行作为发号临界区（同部门并发立项排队），须在事务内调用
   */
  private async allocateDepartmentNumber(
    tx: Prisma.TransactionClient,
    requesterDepartment: string,
    year: number,
  ): Promise<string | null> {
    if (!requesterDepartment?.trim()) return null;
    // 部门匹配（与既有 normalizeDepartment 语义一致：先精确后包含）
    let dept = await tx.department.findFirst({ where: { name: requesterDepartment.trim() } });
    if (!dept) {
      dept = await tx.department.findFirst({
        where: { OR: [{ name: { contains: requesterDepartment.trim() } }, { name: { contains: requesterDepartment.trim().split('/')[0] } }] },
      });
    }
    if (!dept) {
      // 无部门主数据 → 建行（code 自动生成：名称内 ASCII 字母提取，不足则 D + 行尾 4 位）
      const ascii = (requesterDepartment.match(/[A-Za-z]{2,}/g) || []).join('').toUpperCase();
      const code = ascii.length >= 2 ? ascii.slice(0, 6) : null;
      dept = await tx.department.create({ data: { name: requesterDepartment.trim(), ...(code ? { code } : {}) } });
    }
    if (!dept.code) {
      const code = 'D' + dept.id.slice(-5).toUpperCase();
      await tx.department.update({ where: { id: dept.id }, data: { code } });
      dept = { ...dept, code };
    }
    // 发号临界区：锁部门行（同部门并发立项在此排队）
    await tx.$queryRaw`SELECT id FROM "Department" WHERE id = ${dept.id} FOR UPDATE`;
    const prefix = `${dept.code}-${year}-`;
    const last = await tx.projectManagementItem.findFirst({
      where: { departmentNumber: { startsWith: prefix } },
      orderBy: { departmentNumber: 'desc' },
      select: { departmentNumber: true },
    });
    // where startsWith 保证命中行非空，但列为 nullable——空值/解析失败按 0 起号
    const lastSeq = last?.departmentNumber ? Number(last.departmentNumber.slice(prefix.length)) || 0 : 0;
    return `${prefix}${String(lastSeq + 1).padStart(3, '0')}`;
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
      // 按采购方式取完整阶段模板（与前端定义矩阵一致）
      const template = METHOD_STAGE_TEMPLATES[dto.procurementMethod] ?? METHOD_STAGE_TEMPLATES['询比采购'];
      stagesToCreate = template as Array<{ readonly key: StageKey; readonly label: string }>;
      // Only initiation form → remove PROCUREMENT_DEMAND from stages
      if (!hasDemand && hasInitiation) {
        stagesToCreate = stagesToCreate.filter((s) => s.key !== 'PROCUREMENT_DEMAND');
      }
    }

    // Determine the first active stage based on which documents were uploaded
    let firstActiveStage: StageKey;
    if (hasDemand && !hasInitiation) {
      // Only demand form → land on INITIATION (or CONTRACT for small purchases)
      firstActiveStage = isSmallPurchase ? 'CONTRACT' : 'INITIATION';
    } else if (isSmallPurchase) {
      firstActiveStage = 'CONTRACT';
    } else {
      // Only initiation form or both forms → 第一个待办阶段按实际模板取「补记 COMPLETED 的
      // 最后一个前置阶段之后的第一个非锁定阶段」，不能写死 TENDER_DOCUMENT——直接采购模板
      // 没有「采购文件」步骤（立项后直接进公告公示），写死会使该方式项目建项后无任何
      // 进行中阶段且 currentStage 指向不存在的阶段（实录 2026-09-11：01/02 已完成、03 待解锁）
      const lastPrefillKey: StageKey = 'INITIATION';
      const prefillIndex = stagesToCreate.findIndex((s) => s.key === lastPrefillKey);
      const afterPrefill = stagesToCreate
        .slice(prefillIndex + 1)
        .find((s) => !LOCKED_STAGES.has(s.key));
      firstActiveStage = afterPrefill?.key ?? stagesToCreate[0]!.key;
    }

    const createdProject = await this.prisma.$transaction(async (tx) => {
      // 自动生成项目编号：公司编码-采购方式拼音首字母-当日 YYYYMMDD-当日全局顺序号（2026-09-16 三段式）
      const now = new Date();
      const projectCode = await generatePmiProjectCode(tx, {
        companyId: companyStamp.companyId ?? null,
        procurementMethod: dto.procurementMethod,
      });
      const gbProjectCode = await this.gbCode.allocateProjectCode().catch(() => null); // A1（B.4.3.2）

      // 部门编号发号（人工传入尊重人工；否则按 部门编码-年度-顺序号 分配，锁部门行防并发重号）
      const allocatedDeptNo = dto.departmentNumber?.trim()
        ? undefined
        : await this.allocateDepartmentNumber(tx, dto.requesterDepartment, now.getFullYear()).catch(() => null);
      const project = await tx.projectManagementItem.create({
        data: {
          projectCode,
          ...(gbProjectCode ? { gbProjectCode } : {}),
          departmentNumber: dto.departmentNumber?.trim() || allocatedDeptNo || null,
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
          initiationDate: dto.initiationDate
            ? parseInitiationDateInput(dto.initiationDate)
            : null,
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
            stageCode: stageCodeFor(projectCode, stage.key, 1),
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
    round?: number,
  ) {
    // 附件统一限制（2026-10-19）：阶段附件（含供应商邀请函/回执、采购文件、
    // 正式盖章版、向导自动上传的公告 docx）100MB + 9 扩展白名单——
    // 复用 announcement 规则集，先于任何 prisma/落盘调用
    assertAttachmentRules(file, 'announcement');
    await this.assertPmiMutable(projectId);
    // R6-1（2026-09-30 审计⑤升级为硬死锁）：多轮项目每轮各有一行同 stageKey 阶段——
    // 此前 findFirst 无 round 过滤，round-2 上传必落 round-1 行，selectOfficialTender
    // 校验 projectManagementStageId 必拒"该文件不属于本步骤"→流标重采后 03 无法完成。
    // 显式 round 优先；缺省回退 item.currentRound（兼容不带 round 的存量调用方）。
    // （对照 updateStage :3347 同款修复早已有注释警示，唯独此处漏网。）
    const roundItem = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { currentRound: true },
    });
    const targetRound = round ?? roundItem?.currentRound ?? 1;

    const stage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: projectId, stageKey, round: targetRound },
      include: { attachments: true },
    });

    if (!stage) {
      throw new NotFoundException('未找到对应的项目阶段。');
    }

    // ★ 旧轮内容只读闸（2026-10-26 补漏）：与 updateStage/reopenStage 的 PAST_ROUND_READONLY
    // 同源——再次采购后历史轮次仅供查看。前端 stageLocked 已挡，此处防 API 显式传旧轮
    // round 直传（此前显式 round=1 可穿透写旧轮附件）。
    if (targetRound < (roundItem?.currentRound ?? 1)) {
      throw new ConflictException({
        error: '该步骤属已完成的历史轮次，仅供查看',
        code: 'PAST_ROUND_READONLY',
      });
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

    // For INITIATION stage, extract 立项时间 from 立项申请表：
    // 项目基本信息的立项时间来源于本步骤上传的文件——此前只有创建向导的提取链
    // （extract-initiation → 表单 → 创建传参）写入 initiationDate，立项步骤补传/
    // 替换文件不回填，时间轴因此显示「未登记」。仅空值回填，不覆盖已登记值。
    if (stageKey === 'INITIATION' && /立项/.test(decodedFileName)) {
      try {
        const text = await this.extractFileText(absolutePath, file.mimetype, file.originalname);
        const cur = await this.prisma.projectManagementItem.findUnique({
          where: { id: projectId },
          select: { initiationDate: true },
        });
        if (!cur?.initiationDate) {
          const { initiationDate } = this.extractInitiationFieldsFromText(text);
          if (initiationDate) {
            await this.prisma.projectManagementItem.update({
              where: { id: projectId },
              // date-only 字符串 new Date() 按 UTC 零点解析，时间轴 toIsoFromBare 再按本地
              // 折算会前移一天（3/18 → 3/17 16:00）——补 T00:00:00 落本地零点
              data: { initiationDate: new Date(initiationDate.length === 10 ? `${initiationDate}T00:00:00` : initiationDate) },
            });
            this.logger.log(`[INITIATION] 从 ${decodedFileName} 提取立项时间 ${initiationDate} 已回填项目基本信息`);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to extract initiation date from document: ${err}`);
        // 提取失败不阻断上传
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
      // 上传即同步「采购文件获取时间」：文件可获取的时刻先落账，
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
      const isTenderDocFile = isTenderMainFile(tdFileName);
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
          const projectOverview = capOverviewLength(await this.aiMinimalPolish(rawOverview));
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
          // 开标时间提取成功 → 对齐同轮 BidProject（间隔常量口径，同 opening-deadline.util）。
          // 懒创建常早于本次提取（创建时 bidOpeningTime 尚未提取 → openTime 落在
          // fallback=立项日、deadline 落在兜底 now+24h），时间轴因此出现
          // "开标=立项日、投标截止=无关兜底值"的错乱；未开标前按下式回填修正：
          // openTime=提取值，deadline=openTime−BID_DEADLINE_BEFORE_OPENING_MS
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
                  `采购文件提取开标时间 ${bidOpeningTime} → 已回填 BidProject ${bp.id}（deadline=openTime−间隔常量）`,
                );
              }
            }
          } catch (e) {
            this.logger.warn(`开标时间回填 BidProject 失败（不阻断上传）: ${(e as Error).message}`);
          }
        }

        // 直接采购：拟定供应商不再写入 awardedSupplier（2026-10-16 收口，同 extractTenderFields）——
        // 公告发布链路由 BidSupplier 参与名单承载拟定供应商（邀请/参与展示不受影响）。

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

    // For CONTRACT stage, extract contract fields via AI (contract PDFs vary in format —
    // regex extractors are unreliable; use LLM structured extraction)
    if (stageKey === 'CONTRACT') {
      try {
        const text = await this.extractFileText(absolutePath, file.mimetype, file.originalname);
        const fileName = decodedFileName;
        this.logger.log(`[CONTRACT] Extracted ${text.length} chars from ${file.originalname}`);

        // Guard: read current project to avoid overwriting existing values
        const currentProject = await this.prisma.projectManagementItem.findUnique({
          where: { id: projectId },
          select: { contractAmount: true, awardedSupplier: true, contractNumber: true, paymentPerformance: true },
        });

        // LLM structured extraction: 评审表/审批表 → 编号+金额；合同本体 → 编号+金额+支付及履约条款
        const isReviewOrApproval = /评审|审批/.test(fileName);
        const userPrompt = [
          `文件名：${fileName}`,
          isReviewOrApproval
            ? '这是合同评审表或合同审批表。请从中提取合同编号与合同金额。合同编号=合同正式编号（形如 E202604062 的字母+数字编号，与所附合同文本编号一致），不要取审批单号/登记号/订单号等其他编号。'
            : '这是采购合同文本（格式多样）。请提取合同编号、合同金额，以及支付及履约相关条款要点。合同编号=合同首部或「合同编号：」栏的正式编号（形如 E202604062），不要取审批单号/登记号/订单号/系统流水号等其他编号。',
          '',
          '=== 文件内容 ===',
          text.slice(0, 6000),
          '',
          isReviewOrApproval
            ? '输出 json：{"contractNumber": "合同编号（无则 null）", "contractAmount": 金额数字（元，无则 null）}'
            : `输出 json：{"contractNumber": "合同编号（无则 null）", "contractAmount": 金额数字（元，无则 null）, "paymentPerformance": "支付及履约内容摘要"}
paymentPerformance 要求：提炼 3-6 条要点，涵盖支付方式与比例节点（如预付款/到货款/质保金）、履约保证（履约保证金/保函）、交付与验收、质保期与售后；每条一句话（30-60字），用换行分隔；合同中无相关条款则输出 null。不得编造。`,
        ].join('\n');

        const updateData: { contractAmount?: number; contractNumber?: string | null; awardedSupplier?: string; paymentPerformance?: string } = {};
        try {
          const ai = await this.llm.chatJson<{ contractNumber?: string | null; contractAmount?: number | null; paymentPerformance?: string | null }>(
            '你是采购合同信息提取助手，只输出 json，不添加任何解释。',
            userPrompt,
            0.1,
            undefined,
            undefined,
            { timeoutMs: 60_000, retries: 1 },
          );
          // 合同编号优先取文件名括号内的正式编号（如「购销合同（E202604062）」→ E202604062）：
          // 归档命名规范中括号内即合同编号；正文常为扫描件 OCR（编号可能落在截断段之外），
          // AI 又易误取审批单号/登记号（如 SCN0CK…）。正则限定字母开头编号格式防误取日期/页码。
          // 注意 decodedFileName 已被 normalize 小写化（e202604062），写入时恢复大写。
          const fnNo = decodedFileName.match(/[（(]([A-Za-z][A-Za-z0-9-]{4,})[）)]/)?.[1];
          const provenNo = fnNo ? fnNo.toUpperCase() : null;
          if (!currentProject?.contractNumber && (provenNo || ai?.contractNumber)) {
            updateData.contractNumber = (provenNo ?? String(ai!.contractNumber).trim()).slice(0, 64);
          }
          if (currentProject?.contractAmount == null && ai?.contractAmount != null && Number.isFinite(Number(ai.contractAmount))) {
            updateData.contractAmount = Number(ai.contractAmount);
          }
          if (!isReviewOrApproval && !currentProject?.paymentPerformance && ai?.paymentPerformance) {
            updateData.paymentPerformance = String(ai.paymentPerformance).trim().slice(0, 800);
          }
          this.logger.log(
            `[CONTRACT][AI] ${fileName} → contractNumber=${updateData.contractNumber ?? '(skip)'}, ` +
            `contractAmount=${updateData.contractAmount ?? '(skip)'}, ` +
            `paymentPerformance=${updateData.paymentPerformance ? `${updateData.paymentPerformance.length}字` : '(skip)'}`,
          );
        } catch (aiErr) {
          // AI 失败回退旧正则提取（编号/金额），支付履约留待人工
          this.logger.warn(`[CONTRACT][AI] 提取失败，回退正则: ${aiErr instanceof Error ? aiErr.message : aiErr}`);
          if (!currentProject?.contractNumber) {
            const n = extractContractNumberFromText(text);
            if (n) updateData.contractNumber = n;
          }
          if (currentProject?.contractAmount == null) {
            const a = extractContractAmountFromText(text);
            if (a !== null) updateData.contractAmount = a;
          }
        }

        // 供应商名沿用正则（AI 职责聚焦编号/金额/支付履约）
        const awardedSupplier = fileName.includes('合同') || fileName.includes('购销')
          ? extractAwardedSupplierFromContract(text)
          : extractAwardedSupplierFromText(text);
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

    // 项目归属专属规则（2026-10-23 用户口径）：归属=工程/项目主体规范短名，
    // 从全名中提炼（如「引大济岷工程在天全县xxx供水工程」→「引大济岷工程」），不照抄长名
    const fieldRule = fieldName === 'demandProject' || fieldName === '项目归属'
      ? `\n【字段专属规则：项目归属】\n候选值必须是工程/项目主体的规范短名，通常以「工程」「项目」「枢纽」「水库」「灌区」等结尾（例：项目全名「引大济岷工程在天全县某某段供水工程」，归属应为「引大济岷工程」）。请从文档中的项目全名/所属工程表述中提炼主体名称，剔除地点、标段、分期、具体建设内容等修饰成分；禁止把完整项目名称或采购申请事项全名作为归属候选。`
      : '';
    const userPrompt = `请从以下文档文本中识别"${fieldName}"字段的候选值：${fieldRule}\n\n${documentText.slice(0, 4000)}`;

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

  /** PMI 可变更前置闸（见文件头 PMI_STATUS_MUTABLE_LABEL 注释）——写路径统一入口。 */
  private async assertPmiMutable(projectId: string): Promise<void> {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (!item) throw new NotFoundException('未找到对应项目。');
    if (item.status !== PROJECT_MANAGEMENT_STATUS.ACTIVE) {
      throw new ConflictException({
        error: `项目${PMI_STATUS_MUTABLE_LABEL[item.status] ?? item.status}，不可变更（归档数据不可扰动；更正请走重新归档流程）`,
        code: 'PMI_NOT_ACTIVE',
      });
    }
  }

  /**
   * ★ 附件属主 + 旧轮内容只读闸（2026-10-26 补漏）：阶段内容写端点（附件删/段落/HTML/
   * 文本替换）统一前置。属主校验对齐 deleteAttachment 既有口径（附件须属本项目——
   * saveAttachmentParagraphs / replaceAttachmentWithText / saveAttachmentHtml 三处此前
   * 裸按附件 id 取行、无属主校验）；旧轮闸与 updateStage / reopenStage 的
   * PAST_ROUND_READONLY 同源——再次采购后历史轮次仅供查看，防 API 直写（前端
   * stageLocked 已挡，2026-10-23 统一流漏了内容级端点的服务端兜底）。
   * 项目级附件（未挂阶段）只过属主闸。
   */
  private async assertStageAttachmentMutable(
    projectId: string,
    attachment: { projectManagementItemId: string | null; projectManagementStageId: string | null },
  ): Promise<void> {
    if (attachment.projectManagementItemId !== projectId) {
      throw new BadRequestException('该附件不属于当前项目。');
    }
    if (!attachment.projectManagementStageId) return;
    const stage = await this.prisma.projectManagementStage.findUnique({
      where: { id: attachment.projectManagementStageId },
      select: { round: true },
    });
    if (!stage) return;
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { currentRound: true },
    });
    if ((stage.round ?? 1) < (item?.currentRound ?? 1)) {
      throw new ConflictException({
        error: '该步骤属已完成的历史轮次，仅供查看',
        code: 'PAST_ROUND_READONLY',
      });
    }
  }

  async updateStage(
    projectId: string,
    stageKey: string,
    dto: UpdateProjectStageDto,
  ) {
    await this.assertPmiMutable(projectId);
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { currentStage: true, currentRound: true },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // round 感知（2026-09-24 I-1）：多轮（再次采购）项目每轮各有一行同 stageKey 阶段
    // （schema (pmiId, stageKey, round) 唯一）——不带 round 的 findFirst 会命中任意行，
    // 完成 round-2 时可能误读/改写 round-1 行。dto.round 优先（前端传被点行轮次），缺省 currentRound。
    const targetRound = dto.round ?? project.currentRound ?? 1;

    const stage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: projectId, stageKey, round: targetRound },
    });

    if (!stage) {
      throw new NotFoundException('未找到对应的项目阶段。');
    }

    // ★ 旧轮只读闸（2026-10-23 统一流）：再次采购后历史轮次仅供查看——手工完成/补录/
    // 回退旧轮行与「旧轮只读」口径相悖（补录通道只对当前轮内已越过阶段开放）。与
    // reopenStage 服务端闸同源；无 dto.round 时 targetRound 缺省即当前轮，存量调用不受影响。
    if (targetRound < (project.currentRound ?? 1)) {
      throw new ConflictException({
        error: '该步骤属已完成的历史轮次，仅供查看',
        code: 'PAST_ROUND_READONLY',
      });
    }

    // 补录（2026-09-07）：目标阶段早于当前活跃阶段（流程已越过的前置）允许补完成——
    // 附件后传/历史数据补齐场景（此前一律拒绝，导致已越过阶段永远停在 NOT_STARTED，
    // 归档台账与实际不符）。后续实质闸门（归档材料 DA/T 103、邀请回执等）照常校验。
    // 补录只改该阶段 status：不触发 nextStage 推进/激活（那是"完成当前步骤往前走"的
    // 语义，补录历史阶段时执行会把 currentStage 拉回过去——实测把已归档项目指针
    // 从 CONTRACT 拉回 INITIATION，卡片「当前阶段」错显示「采购立项」）。
    let isBackfill = false;
    if (
      dto.status === PROJECT_STAGE_STATUS.COMPLETED &&
      project.currentStage !== stageKey
    ) {
      const current = await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: projectId, stageKey: project.currentStage ?? undefined },
        select: { stageOrder: true },
      });
      isBackfill = !!current && stage.stageOrder < current.stageOrder;
      if (!isBackfill) {
        throw new BadRequestException('请先完成当前阶段后再推进下一阶段。');
      }
      this.logger.warn(
        `[阶段补录] 项目 ${projectId} 阶段 ${stageKey} 已越过 currentStage(${project.currentStage})，补记完成（不推进项目指针）`,
      );
    }

    // P1-12：阶段完成最小实质校验（与 UI 步骤检查口径一致——此前 0 文件/0 邀请/0 专家可空完成，
    // 一路放行到开标确认才发现缺前置，返工成本高）
    if (dto.status === PROJECT_STAGE_STATUS.COMPLETED) {
      // 投标侧收口闸（2026-10-19，TP-2026101901 实例续）：开标评标及之后阶段（定标/合同/
      // 备案表）完成前，同轮关联 BidProject 必须已终局。正门=「开标确认」面板完整归档
      // （archiveAll→syncPmStage 置本阶段 COMPLETED 并解锁定标）；手工标完成/补录均不得越过
      // 投标侧——否则 PMI 一路推到合同而投标侧永卡活动态（专家/供应商端僵尸滞留）。
      // 无关联招标项目（无投标链方式）不拦；旧轮已流标/归档自然放行。与 completeProject
      // 归档闸、公告删除 BID_IN_PROGRESS 同源。
      if (BID_TAIL_STAGE_KEYS.has(stageKey as (typeof PROJECT_WORKFLOW_STAGES)[number]['key'])) {
        const activeBidProjects = await this.prisma.bidProject.findMany({
          where: {
            projectManagementItemId: projectId,
            round: targetRound,
            stage: { in: ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING'] },
          },
          select: { name: true, stage: true },
        });
        if (activeBidProjects.length > 0) {
          const names = activeBidProjects
            .map((bp) => `「${bp.name}」(${STAGE_LABEL[bp.stage] ?? bp.stage})`)
            .join('、');
          throw new ConflictException({
            error: `关联招标项目仍在开评标流程中：${names}。请先在「开标确认」面板完成完整归档（自动完成本阶段并解锁定标），或流标后再推进`,
            code: 'BID_IN_PROGRESS',
          });
        }
      }
      // 评分标准配置闸（2026-09-24 方案 v2）：03 采购文件完成前须完成评分标准配置——
      // 评标标准属采购文件组成内容，配置前置到本阶段收口；办法=none（不评分）免校验。
      // 先于归档材料闸抛出（评分标准是本阶段产物本身，不可豁免）。
      if (stageKey === 'TENDER_DOCUMENT') {
        // 正式盖章版强制闸（2026-09-26 用户裁定：必须强制、不可豁免）——先于评分标准闸：
        // 连正式文件都没定，「对照正式文件确认评分标准」无从谈起
        this.assertOfficialTenderSelected(stage);
        await this.assertScoreStandardConfigured(projectId, targetRound);
      }
      // DA/T 103-2024 前端控制（§4.1 + A.1a）：按归档范围表检查该阶段必选材料
      // （范围表 attachment 源必选项 = TENDER_DOCUMENT/AWARD_DECISION/CONTRACT 三处，与下方专项检查口径互补）
      // M5：显式豁免路径——确无材料（流标终止等）时 waiveArchiveGate=true + note 必填留痕，阶段可推进
      const gateMissing = await this.archiveScope.checkStageGate(projectId, stageKey);
      if (gateMissing.length > 0) {
        if (dto.waiveArchiveGate === true) {
          if (!dto.note?.trim()) {
            throw new BadRequestException({ error: '已选择豁免，请填写豁免理由（将记入操作日志留痕）', code: 'WAIVE_NOTE_REQUIRED' });
          }
          this.logger.warn(
            `[归档闸门豁免] 项目 ${projectId} 阶段 ${stageKey} 缺件放行：${gateMissing.join('、')}；理由：${dto.note.trim()}`,
          );
        } else {
          throw new BadRequestException({
            error: `无法完成该阶段：归档必选材料（DA/T 103-2024）尚未上传——${gateMissing.join('、')}。请先上传上述材料后再标记完成；若确无此类材料（如流标终止），可豁免并填写理由后继续。`,
            code: 'ARCHIVE_GATE_MISSING',
          });
        }
      }
      if (stageKey === 'SUPPLIER_INVITATION') {
        // 完成门槛：确认参加的回执数量达到用户设定的满足数量（默认 3）即可标记完成。
        // 数量以 InvitationRsvp 实数核验（不信任前端计数）；达标蕴含通知已发出，原"须先发送邀请通知"核查被覆盖。
        // id 空间：回执的 projectId 为 BidProject id（邀请发起方），阶段接口收到的是 PMI id。
        // 2026-10-28 二轮隔离：完成闸只数本轮 BidProject 名下回执——旧轮回执不再计入新轮完成判定；
        // 本轮 BidProject 尚未懒建时回退数 PMI id 存量行（旧数据空间）
        const threshold = Math.min(Math.max(dto.confirmedThreshold ?? 3, 1), 50);
        const roundBpForGate = await this.resolveRoundBidProject(projectId, targetRound, { id: true });
        const rsvpWhere = roundBpForGate ? { projectId: roundBpForGate.id } : { projectId };
        // 按供应商去重计数（2026-10-23 用户口径：与邀请页「已确认」同源）——同一供应商
        // 跨批次多行只数一次：已回执行优先于 PENDING，均非 PENDING 取 respondedAt 最新
        // （最新回执代表当前意愿）；此前裸 count 行数会把多批次重复数大、与页面显示打架
        const allRows = await this.prisma.invitationRsvp.findMany({
          where: rsvpWhere,
          select: { supplierId: true, status: true, respondedAt: true },
          orderBy: { respondedAt: 'desc' },
        });
        const bySupplier = new Map<string, string>();
        for (const r of allRows) {
          const existing = bySupplier.get(r.supplierId);
          if (!existing || existing === 'PENDING') {
            bySupplier.set(r.supplierId, r.status); // 无记录/PENDING → 任何状态可覆盖（desc 序即最新优先）
          }
        }
        const rsvps = bySupplier.size;
        const accepted = [...bySupplier.values()].filter((st) => st === 'ACCEPTED').length;
        if (rsvps === 0) throw new BadRequestException('请先通过供应商邀请向导发送邀请通知，再标记完成');
        if (accepted < threshold) {
          throw new BadRequestException(
            `供应商确认数量未达标：${accepted}/${threshold} 家已回执确认参加，达到「满足数量」后方可标记完成（可在确认页调整满足数量）`,
          );
        }
      }
      if (stageKey === 'EXPERT_SELECTION') {
        // 2026-10-28 二轮隔离：按本轮项目数专家——第一轮抽过不能让第二轮免抽直接标完成
        const bp = await this.resolveRoundBidProject(projectId, targetRound, { id: true });
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
        // 03 完成 = 走完「选正式文件 → 对照确认评分标准」向导，落确认时间留痕；
        // 回退为未完成（重开路径）则同步清空，重走向导时重新落
        ...(stageKey === 'TENDER_DOCUMENT' && {
          officialTenderConfirmedAt:
            dto.status === PROJECT_STAGE_STATUS.COMPLETED ? new Date() : null,
        }),
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

      if (nextStage && !isBackfill) {
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
   * 评分标准配置闸（2026-09-24 方案 v2；2026-09-26 方案 E 修订）：完成 03 采购文件前的
   * 提前校验——仅约束【已关联该轮 BidProject】的项目：
   *  - 无 BP → 放行。原 v2 拦截经 UI 全链实测为死锁（采购公告只能走 04 向导生成、信息
   *    发布中心不提供手工创建，而 04 向导被本阶段挡住）；终极兜底=启动评标 G9 硬闸。
   *  - BP 存在 + 评标办法=none（不评分）→ 免校验。
   *  - BP 存在 + 办法 ≠ none → 复用 ScoreStandardValidator.assertScoreStandardComplete
   *    （与发布/启动评标 G9 同源，不另写谓词副本）。
   * 400 + SCORE_STANDARD_REQUIRED（与 updateStage 既有阶段闸惯例一致）；不可豁免。
   */
  private async assertScoreStandardConfigured(pmiId: string, round: number) {
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: pmiId, round },
      select: { id: true, evaluationMethod: true },
    });
    if (!bp) return; // 方案 E：未关联开评标项目 → 放行（启动评标 G9 硬闸兜底）
    // none-eval（spec 2026-10-19 §4.1）：改调共享谓词——与 :3007 G9 唯一口径来源，行为不变
    if (isNoneEvaluation(bp.evaluationMethod)) return;
    try {
      await this.scoreStandardValidator.assertScoreStandardComplete(bp.id);
    } catch (e) {
      // 仅包装 validator 的业务异常（HttpException：Σ≠100 / 空项等，文案透传）；
      // Prisma 连接/表缺失等基础设施故障原样上抛保持 500 语义，勿归因为「未配置」（I-2）。
      if (!(e instanceof HttpException)) throw e;
      const resp = e.getResponse();
      const detail =
        resp && typeof resp === 'object' && 'error' in (resp as Record<string, unknown>)
          ? String((resp as Record<string, unknown>).error)
          : (e as Error).message;
      throw new BadRequestException({
        error: `评分标准未配置完整：${detail}`,
        code: 'SCORE_STANDARD_REQUIRED',
      });
    }
  }

  /**
   * 正式盖章版冻结锁（2026-09-27 用户裁定：03 确认即冻结）：附件是「已完成 03 阶段」的
   * 正式盖章版指针目标时，禁止内容替换（saveAttachmentHtml 原地换 objectKey）与删除——
   * 保 04 公告引用与 03 确认时刻的内容一致（身份一致由指针天然保证，本闸补内容时点）。
   * 解锁路径 = 重开该步骤（updateStage 回退未完成即解除）。
   */
  private async assertAttachmentNotFrozen(attachment: {
    id: string;
    projectManagementStageId: string | null;
  }) {
    if (!attachment.projectManagementStageId) return;
    const stage = await this.prisma.projectManagementStage.findUnique({
      where: { id: attachment.projectManagementStageId },
      select: { stageKey: true, status: true, officialTenderAttachmentId: true },
    });
    if (
      stage?.stageKey === 'TENDER_DOCUMENT' &&
      stage.status === PROJECT_STAGE_STATUS.COMPLETED &&
      stage.officialTenderAttachmentId === attachment.id
    ) {
      throw new BadRequestException({
        error:
          '该文件是已确认的正式盖章版采购文件（03 步骤完成时冻结）——如需修改或删除，请先重开「采购文件」步骤。',
        code: 'OFFICIAL_TENDER_FROZEN',
      });
    }
  }

  /**
   * 正式盖章版采购文件强制闸（2026-09-26 用户裁定：必须强制、不可豁免——
   * waiveArchiveGate 仅覆盖归档材料缺口，本闸不受其影响）。
   * 指针经 FK(onDelete: SetNull) 保证非空即存在：附件被删/整体替换时自动回空、闸门重开。
   */
  private assertOfficialTenderSelected(stage: {
    officialTenderAttachmentId: string | null;
  }) {
    if (!stage.officialTenderAttachmentId) {
      throw new BadRequestException({
        error: '请先选择或上传正式盖章版采购文件，并对照正式文件确认评分标准后，再标记本阶段完成。',
        code: 'OFFICIAL_TENDER_REQUIRED',
      });
    }
  }

  /**
   * 标记正式盖章版采购文件（指针即真相，不限类型）：仅「采购文件」步骤、仅未完成态可改——
   * 已完成的阶段指针为归档留痕，更换须先重开步骤。完成向导 Step1 选定即调本方法落指针
   * （中途取消不丢，重进向导回显）。
   */
  async selectOfficialTender(
    pmiId: string,
    stageKey: string,
    dto: SelectOfficialTenderDto,
  ) {
    if (stageKey !== 'TENDER_DOCUMENT') {
      throw new BadRequestException('仅「采购文件」步骤支持标记正式盖章版采购文件。');
    }
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { currentRound: true },
    });
    if (!project) throw new NotFoundException('未找到对应项目。');
    const round = dto.round ?? project.currentRound ?? 1;
    const stage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: pmiId, stageKey, round },
    });
    if (!stage) throw new NotFoundException('未找到对应的项目阶段。');
    if (stage.status === PROJECT_STAGE_STATUS.COMPLETED) {
      throw new BadRequestException('该步骤已完成，正式盖章版文件已锁定；如需更换请先重开该步骤。');
    }
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: dto.attachmentId },
      select: { id: true, fileName: true, projectManagementStageId: true },
    });
    if (!attachment || attachment.projectManagementStageId !== stage.id) {
      throw new BadRequestException('该文件不属于本步骤，请从「采购文件」步骤已上传的文件中选择。');
    }
    await this.prisma.projectManagementStage.update({
      where: { id: stage.id },
      data: { officialTenderAttachmentId: attachment.id },
    });
    return {
      stageId: stage.id,
      round,
      officialTenderAttachmentId: attachment.id,
      fileName: attachment.fileName,
    };
  }

  /**
   * 只读解析 PMI ↔ BidProject 关联（按轮）——项目管理抽屉级展示用。
   * 只查不建（创建仅经 ensureBidProject：开标确认面板 / 供应商邀请回执流）；
   * 抽屉级轮询若误用 ensure 会在公告发布前批量误建 SUBMIT 幽灵项目（方案 v2 P0-1）。
   */
  async listBidProjectRefs(pmiId: string) {
    const pmi = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { projectCode: true },
    });
    const bps = await this.prisma.bidProject.findMany({
      where: { projectManagementItemId: pmiId },
      // 列集对齐前端 BidProjectRef 类型（ScoreStandardEditor/评标办法子块入参）
      select: {
        id: true,
        round: true,
        projectCode: true,
        name: true,
        stage: true,
        procurementMethod: true,
        // none-eval（spec 2026-09-24）：:3005 评分标准卡 ref 兜底路径（detail 拉取失败时）也须能判 none
        evaluationMethod: true,
        openTime: true,
        deadline: true,
        // 公告闸判定（2026-10-23 统一流）：该轮流标公告须晚于该轮 BidProject 创建
        createdAt: true,
        // 2026-10-28 二轮隔离：该轮 PMI 层开标/获取时间快照（历史轮基本信息展示源）
        roundOpeningTime: true,
        roundDocAcquireTime: true,
      },
      orderBy: { round: 'asc' },
    });
    // 流标公告闸：FAILED_BID_NOTICE 命中本项目编码空间（PMI 编码或该轮 BidProject 编码）且发布于该轮创建之后。
    // 只认「已发布过」状态（2026-10-23 终审）：PUBLISHED/ARCHIVED/OFFLINE（下架=曾发布的撤回）；
    // DRAFT 不算——信息发布中心存草稿即翻闸会让决策向导抢在公告真正发布前打开（流标公告先行口径）；
    // HIDDEN 不算——回收站隐藏任意状态可入（含 DRAFT 入桶），不能反推曾发布。
    const codes = [pmi?.projectCode, ...bps.map((b) => b.projectCode)].filter((c): c is string => !!c);
    const notices = codes.length
      ? await this.prisma.announcement.findMany({
          where: {
            type: 'FAILED_BID_NOTICE',
            status: { in: ['PUBLISHED', 'ARCHIVED', 'OFFLINE'] },
            relatedProjectCode: { in: codes },
          },
          select: { relatedProjectCode: true, publishDate: true },
        })
      : [];
    return bps.map((b) => ({
      ...b,
      failedBidNoticePublished: notices.some((n) => {
        if (![pmi?.projectCode, b.projectCode].includes(n.relatedProjectCode)) return false;
        return !!n.publishDate && new Date(n.publishDate) >= b.createdAt;
      }),
    }));
  }

  /**
   * 重新打开已完成的步骤：目标步骤 → 进行中；同轮后续步骤及后续轮次全部 → 待解锁；
   * 项目指针（currentStage/currentRound）回退到该步骤。
   * 附件（已上传文件）与分析缓存（按 stageKey 键控）一律不动——文件在，分析结论保留。
   */
  async reopenStage(projectId: string, stageKey: string, round?: number) {
    await this.assertPmiMutable(projectId);
    const stage = await this.prisma.projectManagementStage.findFirst({
      where: {
        projectManagementItemId: projectId,
        stageKey,
        ...(round != null ? { round } : {}),
      },
    });
    if (!stage) throw new NotFoundException('未找到对应的项目阶段。');
    // ★ 旧轮只读闸（2026-10-23 统一流）：再次采购后历史轮次仅供查看——重开旧轮步骤会
    // 把 currentStage/currentRound 指针回拨、并连带把后续轮次全部重置为待解锁（下方事务
    // 步骤 3/4），破坏轮次结构。前端 stageLocked 已挡（Task 6），此为服务端兜底
    //（开标锁只拦 OPENING+ 活动态，流标 ABORTED 轮穿闸，勿依赖其代管）。
    const currentRound = (await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { currentRound: true },
    }))?.currentRound ?? 1;
    if (stage.round < currentRound) {
      throw new ConflictException({
        error: '该步骤属已完成的历史轮次，仅供查看',
        code: 'PAST_ROUND_READONLY',
      });
    }
    if (stage.status !== PROJECT_STAGE_STATUS.COMPLETED) {
      throw new BadRequestException('只有已完成的步骤才能重新设置为进行中。');
    }

    // ★ 开标锁定闸门（2026-09-24 用户拍板）：一旦「按时开标」被点击（BidProject→OPENING），
    // 前置步骤（开标评标之前）即冻结、不可重开——开标时刻已法定公开，前置资料封存留痕。
    // 口径与前端 isLockedByBid 一致（2026-08-17）：只锁 <BID_EVALUATION 的前置阶段；
    // 定标（中标通知书）/合同等后置阶段不受锁，线下定标→扫描上传回填流程保持可达。
    // 轮次对齐：流标（ABORTED）不在锁定态，再次采购新轮不受旧轮影响。
    const bidEval = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: projectId, stageKey: 'BID_EVALUATION', round: stage.round },
      select: { stageOrder: true },
    });
    if (bidEval && stage.stageOrder < bidEval.stageOrder) {
      const bp = await this.prisma.bidProject.findFirst({
        where: { projectManagementItemId: projectId, round: stage.round },
        select: { stage: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (bp && ['OPENING', 'EVALUATING', 'ARCHIVED'].includes(bp.stage)) {
        throw new ConflictException({
          error: '开标已确认，前置步骤已锁定不可重开；如确需变更请走流标/再次采购流程',
          code: 'BID_OPENING_LOCKED',
        });
      }
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

    // 状态机闸门：仅进行中项目可归档；已终止/回收站项目不可归档——
    // 否则终止项目（若恰在合同阶段）可被再次归档，台账出现同名 CANCELLED + AWARDED 双记录。
    if (project.status !== PROJECT_MANAGEMENT_STATUS.ACTIVE) {
      throw new BadRequestException('仅进行中的项目可以归档。');
    }

    // 闸门（2026-10-19，TP-2026101901 实例）：关联招标项目仍处活动阶段（含已发布未截标）时禁归档 PMI。
    // 否则 PMI 已 ARCHIVED 而投标侧永卡活动态——专家门户「已完结待归档」、供应商端流程条僵尸滞留
    // （单向棘轮无回退，且无人再触发投标侧归档）；投标侧收口须走「开标确认」面板完整归档
    // （签字闭环+评标回流法定闸门），流标场景先走流标端点留痕（ABORTED 终态不阻塞）。
    // 同源闸参照公告删除 BID_IN_PROGRESS；终止路径则是显式联动流标（terminateProject 下游联动①）。
    const activeBidProjects = await this.prisma.bidProject.findMany({
      where: {
        projectManagementItemId: projectId,
        stage: { in: ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING'] },
      },
      select: { name: true, stage: true },
    });
    if (activeBidProjects.length > 0) {
      const names = activeBidProjects
        .map((bp) => `「${bp.name}」(${STAGE_LABEL[bp.stage] ?? bp.stage})`)
        .join('、');
      throw new ConflictException({
        error: `关联招标项目仍在开评标流程中：${names}。请先在「开标确认」面板完成完整归档，或流标后再归档本项目`,
        code: 'BID_IN_PROGRESS',
      });
    }

    // allowIncomplete：流标归档等场景，跳过"最后阶段完成"校验
    if (!dto.allowIncomplete && project.currentStage !== 'CONTRACT' && project.currentStage !== 'DIRECT_PURCHASE_FILING') {
      throw new BadRequestException('只有合同（直接采购含备案表）阶段完成后才允许归档。');
    }

    const stages = await this.prisma.projectManagementStage.findMany({
      where: { projectManagementItemId: projectId },
      include: { attachments: true },
      orderBy: { stageOrder: 'asc' },
    });

    // 归档闸门按「最后一个阶段完成」判定（2026-09-28）：直接采购在合同后新增 09 备案表，
    // 末阶段随之变为 DIRECT_PURCHASE_FILING；其余方式末阶段仍是 CONTRACT，口径不变。
    const lastStage = stages[stages.length - 1];
    if (
      !dto.allowIncomplete &&
      (!lastStage || lastStage.status !== PROJECT_STAGE_STATUS.COMPLETED)
    ) {
      throw new BadRequestException(`「${lastStage?.stageName ?? '最后'}」阶段尚未完成，不能归档。`);
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
          // 项目编号承继 PMI 三段式编号（SWHI-TP-YYYYMMDD##），而非 PM-<cuid> 内码
          // （此前误写 cuid → 台账/数据库展示的「项目编号」是内部 id，非业务编号）。
          projectCode: project.projectCode ?? `PM-${project.id}`,
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
          // 公司归属承继 PMI 快照：此前漏盖章 → 台账/数据库单公司视图空
          companyId: project.companyId ?? null,
          companyName: project.companyName ?? null,
          awardedSupplierName: project.awardedSupplier || null,
          expertInfo: project.expertInfo || null,
          biddingUnits: project.biddingUnits || null,
        },
      });

      // 归档即全流程终结：未完成阶段一律收口为 COMPLETED（避免归档详情的步骤卡显示「进行中」）
      await tx.projectManagementStage.updateMany({
        where: { projectManagementItemId: projectId, status: { not: PROJECT_STAGE_STATUS.COMPLETED } },
        data: { status: PROJECT_STAGE_STATUS.COMPLETED, completedAt: archivedAt },
      });

      // 基本信息快照兜底回写（此前邀请/专家流程不回写 → 详情页恒"待补充"）：
      // 专家评审 = BidExpert（正选+候补，User/ExpertProfile 补部门职称）；供应商参与 = 邀请回执名单
      try {
        const bpIds = await tx.bidProject.findMany({ where: { projectManagementItemId: projectId }, select: { id: true } });
        const bpIdSet = bpIds.map(b => b.id);
        const bidExperts = bpIdSet.length > 0
          ? await tx.bidExpert.findMany({ where: { projectId: { in: bpIdSet } }, orderBy: [{ expertRole: 'asc' }, { createdAt: 'asc' }], select: { userId: true, expertName: true, major: true, expertRole: true } })
          : [];
        if (bidExperts.length > 0) {
          const profs = await tx.user.findMany({
            where: { id: { in: bidExperts.map(e => e.userId) } },
            select: { id: true, department: { select: { name: true } }, expertProfile: { select: { title: true } } },
          });
          const byId = new Map(profs.map(u => [u.id, u]));
          const expertInfo = bidExperts.map(e => {
            const u = byId.get(e.userId);
            // 字段内换行清杀（2026-10-27 实录）：e.major 多专业串可能带 \n——join('|') 后记录内藏换行，
            // 前端按行拆分即碎成假行；字段内一律折为顿号
            const cell = (v: unknown) => String(v ?? '').replace(/\r?\n+/g, '、').trim();
            return [cell(e.expertName), cell(u?.department?.name), cell(e.major), cell(u?.expertProfile?.title), cell(e.expertRole)].join('|');
          }).join('\n');
          await tx.projectManagementItem.update({ where: { id: projectId }, data: { expertInfo } });
        }
        const [rsvps, bidSuppliers] = await Promise.all([
          tx.invitationRsvp.findMany({
            where: { OR: [{ projectId }, { projectId: { in: bpIdSet } }] },
            select: { supplierName: true },
          }),
          bpIdSet.length > 0
            ? tx.bidSupplier.findMany({ where: { projectId: { in: bpIdSet } }, select: { supplierName: true } })
            : Promise.resolve([] as { supplierName: string }[]),
        ]);
        const supplierNames = [...new Set([...rsvps, ...bidSuppliers].map(r => r.supplierName?.trim()).filter(Boolean))];
        if (supplierNames.length > 0) {
          await tx.projectManagementItem.update({ where: { id: projectId }, data: { invitedSuppliers: supplierNames.join('\n') } });
        }
      } catch { /* 快照回写失败不阻断归档 */ }

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

  /**
   * 项目终止：进行中的项目可终止。
   *  - 记录终止原因 + 终止时所在阶段（快照）+ 关联的台账轮次
   *  - 同时写入采购台账：一条 CANCELLED 轮次（格式与归档一致，缺省字段留空，附终止原因）
   *  - 终止项目在「项目管理 → 已终止」列表只读查看，不得再编辑/推进
   */
  async terminateProject(projectId: string, dto: { reason?: string; notify?: 'none' | 'accepted' | 'all' }, userId?: string, user?: AuthenticatedUser) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: {
        id: true, title: true, projectCode: true, procurementMethod: true, procurementCategory: true,
        projectReason: true, budgetAmount: true, requesterDepartment: true, companyId: true, companyName: true,
        biddingUnits: true, expertInfo: true, awardedSupplier: true, contractAmount: true,
        currentStage: true, status: true, createdById: true,
      },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // 仅创建人可终止（2026-10-10 读写分级：leader/admin 对他人项目只读）
    this.assertCanManageProject(user, project, '仅项目创建人可终止该项目。');

    if (project.status !== PROJECT_MANAGEMENT_STATUS.ACTIVE) {
      throw new BadRequestException('仅进行中的项目可以终止。');
    }

    const reason = (dto.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('请填写终止原因。');
    }

    // 终止时所在阶段名（快照）
    const stageLabel =
      PROJECT_WORKFLOW_STAGES.find((s) => s.key === project.currentStage)?.label ?? project.currentStage;

    // 终止时资料快照：各阶段状态 + 已上传附件清单（不可变留痕，审计/归档追溯用）
    const stages = await this.prisma.projectManagementStage.findMany({
      where: { projectManagementItemId: projectId },
      include: { attachments: { select: { fileName: true, objectKey: true, createdAt: true, uploadedBy: { select: { displayName: true } } } } },
      orderBy: { stageOrder: 'asc' },
    });
    const terminationSnapshot = {
      stages: stages.map((s) => ({
        stageKey: s.stageKey,
        stageName: s.stageName,
        status: s.status,
        round: s.round,
        attachments: s.attachments.map((a) => ({
          fileName: a.fileName,
          objectKey: a.objectKey,
          uploadedAt: a.createdAt,
          uploadedBy: a.uploadedBy?.displayName ?? null,
        })),
      })),
    };

    const terminatedAt = new Date();

    // 下游联动调查（事务前取数）：关联招标项目 + 公告编号
    const linkedBidProjects = await this.prisma.bidProject.findMany({
      where: { projectManagementItemId: projectId },
      select: { id: true, name: true, stage: true, projectCode: true, procurementMethod: true, assignedHostUserId: true },
    });
    // 非终态（ARCHIVED=不可逆终态、ABORTED=已流标）的才联动流标
    const activeBidProjects = linkedBidProjects.filter((bp) => bp.stage !== 'ARCHIVED' && bp.stage !== 'ABORTED');
    const linkedProjectCodes = linkedBidProjects.map((bp) => bp.projectCode).filter((pc): pc is string => !!pc);

    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.upsert({
        where: { name: project.requesterDepartment },
        update: {},
        create: { name: project.requesterDepartment },
      });

      // 台账：项目编号承继 PMI 三段式编号（与归档同口径，修复历史 cuid 内码）。
      // 用 upsert 幂等：公告直建等路径可能已为同一 projectCode 在 Project 表建过记录，避免撞 @unique。
      const createdProject = await tx.project.upsert({
        where: { projectCode: project.projectCode ?? `PM-${project.id}` },
        update: { name: project.title },
        create: {
          projectCode: project.projectCode ?? `PM-${project.id}`,
          name: project.title,
          businessCategory: project.procurementCategory,
          description: project.projectReason,
          requestingDepartmentId: department.id,
        },
      });

      // 动态轮次号：同一 projectId 下已有轮次则 +1，避免 @@unique([projectId, roundNo]) 冲突
      // （硬编码 roundNo=1 在项目曾关联过台账轮次的场景下会撞 P2002）。
      const lastRound = await tx.procurementRound.findFirst({
        where: { projectId: createdProject.id },
        orderBy: { roundNo: 'desc' },
        select: { roundNo: true },
      });
      const roundNo = (lastRound?.roundNo ?? 0) + 1;

      // 终止轮次：结果=已取消；终止原因单独落 terminationReason 列；缺省字段（成交金额等）留空。
      // procurementDate 落终止时点——终止本身是一次有日期的采购事件，台账日期列与排序由此有意义。
      const procurementRound = await tx.procurementRound.create({
        data: {
          projectId: createdProject.id,
          roundNo,
          procurementDate: terminatedAt,
          procurementMethod: project.procurementMethod,
          departmentId: department.id,
          budgetAmount: project.budgetAmount,
          controlAmount: project.budgetAmount,
          resultStatus: ResultStatus.CANCELLED,
          resultText: '项目已终止',
          sourceType: SourceType.PROJECT_MANAGEMENT,
          createdById: userId ?? null,
          companyId: project.companyId ?? null,
          companyName: project.companyName ?? null,
          biddingUnits: project.biddingUnits || null,
          expertInfo: project.expertInfo || null,
          terminationReason: reason,
        },
      });

      const updated = await tx.projectManagementItem.update({
        where: { id: projectId },
        data: {
          status: PROJECT_MANAGEMENT_STATUS.TERMINATED,
          terminationReason: reason,
          terminatedAt,
          terminatedStage: stageLabel,
          terminatedProcurementRoundId: procurementRound.id,
          terminatedById: userId ?? null,
          terminationSnapshot,
        },
      });

      // 下游联动①：关联招标项目流标（2026-09-21 拍板：终止必须闭环下游）
      const terminator = userId
        ? await tx.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } })
        : null;
      const terminatorLabel = terminator ? (terminator.displayName?.trim() || terminator.username) : null;
      // ABORTED 后供应商端「可投标项目」（stage∈DOWNLOAD/SUBMIT）自动排除；
      // ARCHIVED 终态跳过（归档数据不可扰动）；监督时间线留痕联动原因。
      for (const bp of activeBidProjects) {
        // 2026-10-27 串码修复：操作人此前嵌裸 userId、时间裸 ISO——改姓名快照+本地可读时间
        // （前缀「项目终止联动流标（」勿动：:3007 归档端「已终止」判定依赖此前缀）
        const note = `项目终止联动流标（${formatNoteTimestamp(terminatedAt)}${terminatorLabel ? `，操作人 ${terminatorLabel}` : ''}，终止原因：${reason}）`;
        await tx.bidProject.update({
          where: { id: bp.id },
          data: { stage: 'ABORTED', riskNote: note },
        });
        await tx.bidSupervisionLog.create({
          data: {
            projectId: bp.id, time: terminatedAt, role: '系统', target: bp.name,
            action: '流标', result: note, riskFlag: '高风险',
          },
        });
      }

      // 下游联动②：已发布公告下架（PUBLISHED→ARCHIVED，publicList 只列 PUBLISHED → 公开门户即时不可见）
      if (linkedProjectCodes.length > 0) {
        await tx.announcement.updateMany({
          where: { relatedProjectCode: { in: linkedProjectCodes }, status: 'PUBLISHED' },
          data: { status: 'ARCHIVED' },
        });
      }

      // 下游联动③：未完成工作安排自动取消（TODO/IN_PROGRESS/BLOCKED → CANCELLED）
      await tx.workArrangement.updateMany({
        where: { projectManagementItemId: projectId, status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] } },
        data: { status: 'CANCELLED', completionSummary: `项目于 ${terminatedAt.toLocaleDateString('zh-CN')} 终止，安排自动取消（原因：${reason}）` },
      });

      return updated;
    }).then(async (updated) => {

    // 终止通知（事务后发送，失败不阻断终止）：notify 由用户在终止弹窗选择
    // 收件人解析：InvitationRsvp 兼容 PMI id / BidProject id 两个 projectId 空间（与归档快照同口径）；
    // accepted=仅已确认参加（status=ACCEPTED），all=全部受邀（任意回执状态）。
    let notifiedCount = 0;
    if (dto.notify && dto.notify !== 'none') {
      try {
        const bpIds = await this.prisma.bidProject.findMany({
          where: { projectManagementItemId: projectId },
          select: { id: true },
        });
        const rsvps = await this.prisma.invitationRsvp.findMany({
          where: {
            OR: [{ projectId }, { projectId: { in: bpIds.map((b) => b.id) } }],
            ...(dto.notify === 'accepted' ? { status: 'ACCEPTED' } : {}),
          },
          select: { supplierId: true, supplierName: true },
        });
        // 同一供应商多批次邀请去重 → 解析登录账号（Supplier.userId 非空列）
        const supplierIds = [...new Set(rsvps.map((r) => r.supplierId))];
        const suppliers = await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { userId: true },
        });
        const dateLabel = terminatedAt.toLocaleDateString('zh-CN');
        const content =
          `您参与的采购项目「${project.title}」${project.projectCode ? `（${project.projectCode}）` : ''}已于 ${dateLabel} 终止。` +
          `终止原因：${reason}。相关采购活动已停止，如有疑问请联系采购单位。`;
        const recipients = suppliers.flatMap((s) => (s.userId ? [s.userId] : []));
        await Promise.allSettled(
          recipients.map((uid) =>
            this.notificationService.create({
              userId: uid,
              type: 'PROJECT_TERMINATED',
              title: '采购项目终止通知',
              content,
              link: '/dashboard',
            }),
          ),
        );
        notifiedCount = recipients.length;
      } catch (err) {
        this.logger.error(`项目终止通知发送失败 projectId=${projectId}:`, err);
      }
    }

    // 联动流标通知（平台内部）：bid_host + 已确认正选专家（与 abortBidProject 同口径）
    if (activeBidProjects.length > 0) {
      try {
        const bpList = activeBidProjects.map((bp) => `${bp.name}（${bp.procurementMethod}）`).join('、');
        // 2026-10-09 串号修复：只发各关联项目指派的主持人（原按 bid_host 全平台广播；
        // 同一主持人多项目去重；未指派/停用不发送）
        const hostCandidates = [...new Set(activeBidProjects.map((bp) => bp.assignedHostUserId).filter((u): u is string => !!u))];
        const hostUserIds = (
          await Promise.all(hostCandidates.map((uid) => resolveActiveUserId(this.prisma, uid)))
        ).filter((u): u is string => !!u);
        await Promise.allSettled(
          hostUserIds.map((uid) =>
            this.notificationService.sendToUser(uid, ['in_app'], {
              type: 'BID_ABORTED',
              title: `项目终止联动流标：${project.title}`,
              content: `采购项目「${project.title}」已终止（原因：${reason}），关联招标项目 ${bpList} 已联动流标。`,
              link: '/bid/archive', // 联动流标覆盖多项目：:3007 归档端（流标项目归属地）
            }),
          ),
        );
        const experts = await this.prisma.bidExpert.findMany({
          where: { projectId: { in: activeBidProjects.map((bp) => bp.id) }, expertRole: '正选', invitationStatus: 'confirmed' },
          select: { userId: true },
        });
        const expertIds = [...new Set(experts.map((e) => e.userId).filter((u): u is string => !!u))];
        await Promise.allSettled(
          expertIds.map((uid) =>
            this.notificationService.create({
              userId: uid,
              type: 'BID_ABORTED',
              title: '评审项目已终止',
              content: `您参与评审的项目「${project.title}」已终止，评审任务取消。终止原因：${reason}。`,
              link: '/',
            }),
          ),
        );
      } catch (err) {
        this.logger.error(`终止联动流标通知发送失败 projectId=${projectId}:`, err);
      }
    }

      return { ...updated, notifiedCount, abortedBidProjects: activeBidProjects.map((bp) => bp.name) };
    });
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
    await this.assertPmiMutable(projectId);
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
      const parsedDate = parseInitiationDateInput(dto.initiationDate);
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
          const txt = await this.readAttachmentText(a.objectKey, a.mimeType, a.fileName);
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

  /**
   * 步骤分析：为指定阶段生成「过程综述 + 关键事实 + 合规核对」叙述段落（2026-10-13 起覆盖
   * 全部阶段键——含公告公示/直接采购备案，并兼并原「阶段合规审查」的展示职责）。
   * 数据面（充分性要求）：①各阶段结构化事实（名单/评审/成交，各取真实链路）②按钮窗口留痕
   * （阶段备注含豁免理由、正式文件选择、抽取方式审计、公告发布、多轮记录）③阶段材料内容摘要
   * （文件分析缓存，未分析降级文件名）——审批充分性由第三段对照审查要点核材料判定。
   */
  /** 步骤分析阶段元数据：每阶段的分析要点（按各阶段实际情况定制） */
  private static readonly STAGE_ANALYSIS_META: Record<string, { label: string; focus: string }> = {
    PROCUREMENT_DEMAND: { label: '采购需求', focus: '需求来源与内容（需求申请要点、提出部门与经办人、预算规模与资金性质）' },
    INITIATION: { label: '采购立项', focus: '立项事由与审批（立项依据、供方要求、预算审定）' },
    TENDER_DOCUMENT: { label: '采购文件', focus: '采购文件编制（文件构成、资格与评审要点、采购组织形式与计价方式）' },
    PUBLIC_ANNOUNCEMENT: { label: '采购公告公示', focus: '公告发布与公示（公告类型与发布时间、公示期、参与供应商情况）' },
    SUPPLIER_INVITATION: { label: '供应商邀请', focus: '邀请过程与名单（选取方式、逐家确认状态）' },
    EXPERT_SELECTION: { label: '专家抽取', focus: '抽取过程与名单（配额/随机/回避原则、专家信息）' },
    BID_EVALUATION: { label: '开标评标', focus: '开评标过程（开标时间、参评供应商、多轮报价与评审结果）' },
    AWARD_DECISION: { label: '定标', focus: '定标结果（成交供应商、成交金额、定标依据）' },
    CONTRACT: { label: '合同', focus: '合同签订（合同编号、合同金额、与定标结果一致性）' },
    DIRECT_PURCHASE_FILING: { label: '直接采购备案表', focus: '直接采购备案（直接采购理由、备案要件与审批齐全性）' },
  };

  async analyzeStep(projectId: string, stageKey: string, forceRefresh = false, round?: number): Promise<{ content: string; empty: boolean }> {
    const meta = ProjectManagementService.STAGE_ANALYSIS_META[stageKey];
    if (!meta) {
      throw new BadRequestException('未知的项目阶段。');
    }

    // 全轮次阶段行（多轮谈判一轮一行）：完成判定、备注/豁免理由、正式文件选择留痕都挂在行上
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      include: {
        stages: {
          where: { stageKey },
          orderBy: { round: 'asc' },
          select: {
            status: true, round: true, note: true, completedAt: true,
            officialTenderConfirmedAt: true, officialTenderAttachment: { select: { fileName: true } },
            attachments: { select: { fileName: true, objectKey: true } },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }
    const stageRows = project.stages;
    // 2026-10-28 二轮隔离：前端按选中轮传 round（查看历史轮步骤时分析该轮）；缺省仍取最新轮
    const stageRow = (round != null ? stageRows.find((s) => s.round === round) : undefined)
      ?? stageRows[stageRows.length - 1];
    // 步骤分析仅对已完成阶段开放（与前端闸门一致，防直调 API 绕过）：进行中/待解锁数据未定型
    if (!stageRow || stageRow.status !== 'COMPLETED') {
      return { content: '', empty: true };
    }
    const attachments = stageRow.attachments ?? [];
    const fmtTime = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

    /* ── 按钮窗口留痕（2026-10-13 充分性要求）：弹窗/面板里的行为、选择与结果 ── */
    const traceParts: string[] = [];
    const roundStatus: Record<string, string> = { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', COMPLETED: '已完成' };
    if (stageRows.length > 1) {
      traceParts.push(`轮次记录：${stageRows.map(s => `第${s.round}轮${roundStatus[s.status] ?? s.status}${s.note?.trim() ? `（备注：${s.note.trim().slice(0, 120)}）` : ''}`).join('；')}`);
    }
    // 阶段备注 = updateStage 落列的说明文字，归档豁免理由（waiveArchiveGate）也经此留痕
    if (stageRow.note?.trim()) traceParts.push(`阶段备注（含豁免理由）：${stageRow.note.trim().slice(0, 300)}`);
    if (stageRow.completedAt) traceParts.push(`本阶段完成时间：${fmtTime(stageRow.completedAt)}`);
    if (stageRow.officialTenderConfirmedAt) {
      traceParts.push(`正式盖章版采购文件：${stageRow.officialTenderAttachment?.fileName ?? '（原附件已删除）'}（确认于 ${fmtTime(stageRow.officialTenderConfirmedAt)}）`);
    }

    // 按阶段构建分析数据（各取真实链路）
    const isExpert = stageKey === 'EXPERT_SELECTION';
    const parts: string[] = [];
    let expertRosterRaw = '';
    const stageContext = `当前阶段：${meta.label}（${stageKey}）。采购方式：${project.procurementMethod || '未知'}。`;

    if (isExpert) {
      expertRosterRaw = (project.expertInfo ?? '').trim();
      // 抽取行为留痕：最近一次确认审计（方式/候选池/命中数；resourceId 是 BidProject id 空间）
      // 2026-10-28 二轮隔离：round 指定时只看该轮的抽取留痕
      const roundBpForAudit = round != null ? await this.resolveRoundBidProject(projectId, round, { id: true }) : null;
      const bpIds = roundBpForAudit
        ? [roundBpForAudit]
        : await this.prisma.bidProject.findMany({
            where: { projectManagementItemId: projectId },
            select: { id: true },
          });
      const audit = bpIds.length > 0
        ? await this.prisma.auditLog.findFirst({
            where: { action: 'EXPERT_EXTRACTION_CONFIRMED', resourceId: { in: bpIds.map((b) => b.id) } },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, details: true },
          })
        : null;
      if (audit) {
        const d = (audit.details ?? {}) as { extractMode?: string | null; poolUserIds?: unknown[]; drawnUserIds?: unknown[] };
        const modeLabel: Record<string, string> = { specialty_match: '专业匹配', random: '随机抽取', merit_best: '择优抽取' };
        traceParts.push(`抽取确认：${fmtTime(audit.createdAt)}，方式=${d.extractMode ? (modeLabel[d.extractMode] ?? d.extractMode) : '未记录'}，候选池 ${d.poolUserIds?.length ?? 0} 人、正选命中 ${d.drawnUserIds?.length ?? 0} 人`);
      }
    } else if (stageKey === 'SUPPLIER_INVITATION') {
      // 供应商邀请：invitedSuppliers 快照字段由邀请通知发送时累计写入（ai.service 2026-09-01 补链）；
      // 存量/直改数据可能仍空 → 兜底改用 InvitationRsvp 真实链路数据（通知名单 + 逐家确认状态，
      // 含正选/补选/采购端手动标记，兼容 PMI/BP 两个 id 空间）
      const bpIds = await this.prisma.bidProject.findMany({
        where: { projectManagementItemId: projectId },
        select: { id: true },
      });
      // 2026-10-28 二轮隔离：round 指定时只读该轮回执（bpIds 全轮列表仅作缺省/存量兜底）
      const roundBpForRsvp = round != null ? await this.resolveRoundBidProject(projectId, round, { id: true }) : null;
      const rsvps = await this.prisma.invitationRsvp.findMany({
        where: roundBpForRsvp
          ? { projectId: roundBpForRsvp.id }
          : { OR: [{ projectId }, { projectId: { in: bpIds.map((b) => b.id) } }] },
        orderBy: { createdAt: 'asc' },
        select: { supplierName: true, status: true, note: true },
      });
      const rsvpLabel: Record<string, string> = { ACCEPTED: '已确认参加', DECLINED: '已放弃', PENDING: '待确认' };
      if (rsvps.length > 0) {
        parts.push(`邀请与回执：${rsvps.map((r) => `${r.supplierName}（${rsvpLabel[r.status] ?? r.status}${r.note ? `；备注：${r.note}` : ''}）`).join('、')}`);
      } else if (project.invitedSuppliers?.trim()) {
        parts.push(`邀请名单（快照）：${project.invitedSuppliers.trim().slice(0, 300)}`);
      }
    } else if (stageKey === 'BID_EVALUATION' || stageKey === 'AWARD_DECISION') {
      // 开评标/定标：BidProject 及其评审/成交数据（2026-10-28 二轮隔离：按轮解析）
      const bp = await this.resolveRoundBidProject(projectId, round, {
        id: true, stage: true, openTime: true, deadline: true, evaluationMethod: true,
      });
      if (bp) {
        const stageLabel: Record<string, string> = { DOWNLOAD: '标书下载', SUBMIT: '投标递交', OPENING: '开标中', EVALUATING: '评标中', ARCHIVED: '已归档' };
        parts.push(`招标项目当前状态：${stageLabel[bp.stage] ?? bp.stage}`);
        if (bp.openTime) parts.push(`开标时间：${fmtTime(bp.openTime)}`);
        if (bp.deadline) parts.push(`截标时间：${fmtTime(bp.deadline)}`);
        if (bp.evaluationMethod) parts.push(`评标办法：${bp.evaluationMethod}`);
        // 参评供应商 + 评审得分排名（按分数降序）+ 多轮报价（谈判/竞价，最近一轮）
        const [bidSuppliers, evalResults, roundRows] = await Promise.all([
          this.prisma.bidSupplier.findMany({ where: { projectId: bp.id }, select: { supplierName: true } }),
          this.prisma.bidEvaluationResult.findMany({
            where: { projectId: bp.id },
            orderBy: { totalScore: 'desc' },
            select: { supplierName: true, totalScore: true, averageScore: true, bidPrice: true },
          }),
          this.prisma.bidRound.findMany({
            where: { projectId: bp.id },
            orderBy: { roundNo: 'desc' },
            take: 1,
            include: { quotes: { include: { bidSupplier: { select: { supplierName: true } } } } },
          }),
        ]);
        if (bidSuppliers.length > 0) parts.push(`参评供应商：${bidSuppliers.map((s) => s.supplierName).join('、')}`);
        if (evalResults.length > 0) {
          parts.push(`评审结果（按总分降序）：${evalResults.map((r) => `${r.supplierName} ${Number(r.totalScore)}分${r.bidPrice != null ? `/报价${Number(r.bidPrice).toLocaleString('zh-CN')}元` : ''}`).join('、')}`);
        }
        const latestRound = roundRows[0];
        if (latestRound) {
          const roundTypeLabel: Record<string, string> = { negotiation: '谈判', final_quote: '最终报价', sealed_auction: '密封竞价' };
          const opened = latestRound.quotes.filter((q) => q.status === 'opened');
          parts.push(`多轮报价：进行至第${latestRound.roundNo}轮（${roundTypeLabel[latestRound.roundType] ?? latestRound.roundType}）${opened.length > 0 ? `，本轮已开封报价：${opened.map((q) => `${q.bidSupplier?.supplierName ?? '—'} ${Number(q.quotePrice).toLocaleString('zh-CN')}元`).join('、')}` : ''}`);
        }
      }
      if (stageKey === 'AWARD_DECISION') {
        if (project.awardedSupplier) parts.push(`成交供应商：${project.awardedSupplier}`);
        if (project.contractAmount) parts.push(`成交金额：${Number(project.contractAmount).toLocaleString('zh-CN')} 元`);
        if (project.biddingUnits) parts.push(`中标单位：${project.biddingUnits}`);
      }
    } else if (stageKey === 'PUBLIC_ANNOUNCEMENT') {
      // 公告公示：本项目编号关联的全部公告（发布行为与公示期留痕）+ 参与供应商快照
      if (project.projectCode) {
        const anns = await this.prisma.announcement.findMany({
          where: { relatedProjectCode: project.projectCode },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { title: true, type: true, status: true, publishDate: true, publicityEnd: true },
        });
        const annTypeLabel: Record<string, string> = {
          BID_NOTICE: '招标公告', ADDENDUM: '补遗公告', PREQUAL_NOTICE: '资格预审公告', PRE_WIN_NOTICE: '预成交公示',
          WIN_NOTICE: '成交公告', CONTRACT_NOTICE: '合同公告', PERFORMANCE_NOTICE: '履约结果公告',
          FAILED_BID_NOTICE: '流标公告', WIN_BID_NOTICE: '中标公告', CLARIFY_NOTICE: '澄清修改公告',
        };
        if (anns.length > 0) {
          parts.push(`已发布公告：${anns.map((a) => `《${a.title}》（${annTypeLabel[a.type] ?? a.type}/${a.status}${a.publishDate ? `，${fmtTime(a.publishDate)}发布` : ''}${a.publicityEnd ? `，公示至${fmtTime(a.publicityEnd)}` : ''}）`).join('；')}`);
        }
      }
      if (project.invitedSuppliers?.trim()) parts.push(`登记的参与供应商：${project.invitedSuppliers.trim().slice(0, 300)}`);
      if (project.projectOverview) parts.push(`采购概况：${project.projectOverview.slice(0, 300)}`);
    } else {
      // 需求/立项/采购文件/合同/直接采购备案：以 PMI 阶段相关字段构成
      if (stageKey === 'PROCUREMENT_DEMAND') {
        if (project.demandProcurementTitle) parts.push(`需求事项：${project.demandProcurementTitle}`);
        if (project.demandRequesterName || project.demandDepartment) parts.push(`需求提出：${project.demandRequesterName ?? ''}${project.demandDepartment ? `（${project.demandDepartment}）` : ''}`);
        if (project.demandBudgetAmount) parts.push(`需求预算：${Number(project.demandBudgetAmount).toLocaleString('zh-CN')} 元`);
        if (project.demandProjectReason) parts.push(`需求说明：${project.demandProjectReason.slice(0, 400)}`);
      }
      if (stageKey === 'INITIATION') {
        if (project.projectReason) parts.push(`立项事由：${project.projectReason.slice(0, 400)}`);
        if (project.supplierRequirements) parts.push(`供方要求：${project.supplierRequirements.slice(0, 300)}`);
        if (project.initiationDate) parts.push(`立项日期：${project.initiationDate.toISOString().slice(0, 10)}`);
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
      if (stageKey === 'DIRECT_PURCHASE_FILING') {
        const bp = await this.resolveRoundBidProject(projectId, round, { directSourcingReason: true });
        if (bp?.directSourcingReason) parts.push(`直接采购理由：${bp.directSourcingReason.slice(0, 300)}`);
      }
      if (project.budgetAmount && stageKey !== 'PROCUREMENT_DEMAND') parts.push(`预算金额：${Number(project.budgetAmount).toLocaleString('zh-CN')} 元`);
    }

    /* ── 阶段材料内容摘要（审批充分性的证据面）：读文件分析缓存（上传时自动生成）；
       未分析/缺缓存时降级为文件名并显式标注——绝不臆造文件内容 ── */
    const summaryByKey = new Map<string, { contentSummary?: string }>();
    try {
      const fileCache = JSON.parse(await readFile(getStageAnalysisCachePath(projectId, stageKey), 'utf8')) as {
        files?: Array<{ objectKey?: string; fileName?: string; contentSummary?: string }>;
      };
      for (const f of fileCache.files ?? []) {
        const key = f.objectKey ?? f.fileName;
        if (key) summaryByKey.set(key, f);
      }
    } catch {
      // 文件分析缓存不存在 → 走文件名降级
    }
    const filesBlock = attachments.length > 0
      ? attachments.map((a) => {
          const c = summaryByKey.get(a.objectKey) ?? summaryByKey.get(a.fileName);
          // 旧/异常缓存可能存非字符串摘要——typeof 守卫，绝不因缓存形状让分析 500
          const summary = typeof c?.contentSummary === 'string' ? c.contentSummary.trim() : '';
          return `- ${a.fileName}：${summary ? summary.slice(0, 300) : '（未生成内容摘要，不得据此判断文件内容）'}`;
        }).join('\n')
      : '（本阶段未上传任何材料）';

    const traceRaw = traceParts.join('；');
    const stageFacts = isExpert ? expertRosterRaw : parts.join('；');
    // 空数据判定放宽：无结构化字段但有材料/留痕（如纯上传审批件的阶段）同样可分析
    if (!stageFacts && !traceRaw && attachments.length === 0) {
      return { content: '', empty: true };
    }

    // 合规审查要点（2026-10-13 并入步骤分析，用户裁定）：原「阶段合规审查」区块下线后，
    // 规则库（DB 覆盖层 → 内置表兜底）改由步骤分析消费——第三段对照核对
    const { checkpoints } = await this.stageCompliance.getRules(stageKey);

    // fingerprint = 过程数据 + 操作留痕 + 材料摘要 + 审查要点（任一变更即失效；
    // 各维并入 fingerprint 使本次扩面后旧缓存自然失效重生成）
    const fingerprint = createHash('sha256')
      .update([stageFacts, traceRaw, filesBlock, `rules:${JSON.stringify(checkpoints)}`].filter(Boolean).join('\n|--|\n'))
      .digest('hex')
      .slice(0, 16);

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

    // 构建 LLM prompt（阶段要点由元数据字典驱动；有合规要点时追加第三段核对要求）
    const hasCheckpoints = checkpoints.length > 0;
    const checkpointsText = checkpoints
      .map((c, i) => `${i + 1}. 【${c.dimension}】${c.name}：${c.criteria}（依据：${c.regulationRef}）`)
      .join('\n');

    const systemPrompt = [
      '你是四川省水利发展集团有限公司招采ERP的 AI 采购步骤分析助手。请根据提供的项目信息与本阶段实际数据，',
      `生成一段描述「${meta.label}」步骤开展情况的分析文字。本阶段分析要点：${meta.focus}。`,
      '',
      '输出要求：',
      `1. 分为${hasCheckpoints ? '三' : '两'}段自然语言段落（用空行分隔），不要使用标题、编号或 Markdown 格式。`,
      `2. 第一段「过程综述」：围绕${meta.label}阶段的实际数据与操作留痕描述该步骤如何开展（${isExpert ? '专家抽取涵盖专业配额/随机抽取或智能抽取/回避原则/需求方代表等' : '结合提供的项目字段、时间、状态、操作留痕与材料事实'}）。`,
      '3. 第二段直接逐项陈述关键对象与结果，首词即事实本身——严禁任何引导句开头（如「关键事实如下：」「本阶段关键事实包括：」「主要情况：」等），也不得输出「、」等残留列表符（名单类逐家说明：供应商含确认状态，专家含姓名/部门/专业/职称；结果类含成交供应商与金额等）。',
      ...(hasCheckpoints ? [
        '4. 第三段对照「合规审查要点」逐项核对，并评估本阶段材料（重点审批文件）的充分性：依据「本阶段材料」的内容摘要判断审批链是否覆盖该阶段要点——谁提出、谁审核批准、金额是否在相应审批权限内、签章与日期是否可辨。只点名存在疑点、材料缺失或与要点冲突的项，各给一句整改建议（括注法规依据简称）；全部正常时用一句话概括已核对 N 项要点及材料未见异常。本段同样严禁引导句开头；「未生成内容摘要」的文件不得臆造内容，信息不足以印证的要点按「未见相关材料」如实点名，不得推定满足。',
      ] : []),
      `${hasCheckpoints ? '5' : '4'}. 只描述提供数据中的事实，不得编造未提供的内容。`,
      `${hasCheckpoints ? '6' : '5'}. 总字数控制在 ${hasCheckpoints ? '300-600' : '200-400'} 字。`,
    ].join('\n');

    // 解析专家名单（pipe 分隔 → 可读文本）
    let rosterText: string;
    if (isExpert) {
      const experts = expertRosterRaw.split('\n').filter(l => l.trim()).map(line => {
        const p = line.split('|');
        return { name: p[0]?.trim() ?? '', dept: p[1]?.trim() ?? '', spec: p[2]?.trim() ?? '', title: p[3]?.trim() ?? '', role: p[4]?.trim() ?? '' };
      });
      rosterText = experts.map(e => `${e.name}（${e.dept}/${e.spec}/${e.title}${e.role ? '/' + e.role : ''}）`).join('、');
    } else {
      rosterText = stageFacts;
    }

    const userPrompt = [
      `项目名称：${project.title}`,
      stageContext,
      `项目概况：${project.projectOverview || '未提供'}`,
      `立项事由：${project.projectReason || '未提供'}`,
      `供应商要求：${project.supplierRequirements || '未提供'}`,
      '',
      '=== 本阶段过程数据与操作留痕 ===',
      [rosterText, traceRaw].filter(Boolean).join('\n') || '（无结构化过程数据，仅材料与留痕）',
      '',
      '=== 本阶段材料（审批/归档文件及内容摘要） ===',
      filesBlock,
      ...(hasCheckpoints ? ['', '=== 合规审查要点（第三段逐项核对用） ===', checkpointsText] : []),
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
   * 终止项目详情：与归档详情同构（复用 ArchiveDetailModal），无归档 TXT——
   * 数据取实时表（终止后只读，实时即终止时点快照），附件 filePath=null（不走归档文件预览链路）。
   */
  private buildTerminatedDetail(pmItem: any) {
    const terminatedAt = pmItem.terminatedAt as Date;
    const stageStatusLabel = (s: string) => (s === 'COMPLETED' ? '已完成' : s === 'IN_PROGRESS' ? '进行中' : '未开始');
    return {
      projectId: pmItem.id,
      projectTitle: pmItem.title,
      archivedAt: terminatedAt ? terminatedAt.toISOString().split('T')[0] : null,
      archiveHook: null,
      archiveDir: null,
      /** 终止时轮次（流标再采项目可能在第 N 轮终止） */
      terminatedRound: pmItem.currentRound ?? 1,
      kind: 'terminated' as const,
      basicInfo: {
        '项目编号': pmItem.projectCode ?? '',
        '申请部门': pmItem.requesterDepartment ?? '',
        '申请人': pmItem.requesterName ?? '',
        '采购方式': pmItem.procurementMethod ?? '',
        '采购类别': pmItem.procurementCategory ?? '',
        '预算金额': pmItem.budgetAmount ? `${Number(pmItem.budgetAmount).toLocaleString('zh-CN')}元` : '',
        '终止日期': terminatedAt ? terminatedAt.toISOString().split('T')[0] : '',
        '终止时所在阶段': pmItem.terminatedStage ?? '',
        '终止人': pmItem.terminatedBy?.displayName ?? pmItem.terminatedBy?.username ?? '',
      },
      extractedInfo: {
        '终止原因': pmItem.terminationReason ?? '',
        '投标单位': pmItem.biddingUnits ?? '',
        '专家信息': pmItem.expertInfo ?? '',
        '中标单位': '',
        '合同金额': '',
        '经办人': pmItem.createdBy?.displayName ?? '',
      },
      stages: pmItem.stages.map((stage: any, idx: number) => ({
        stageKey: stage.stageKey,
        stageName: stage.stageName,
        stageDirName: `${idx + 1}.${stage.stageName}`,
        round: stage.round ?? 1, // 轮次透出（流标再采适配，与 TXT 路径同构）
        status: stageStatusLabel(stage.status),
        attachments: stage.attachments.map((att: any) => ({
          id: att.id,
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          filePath: null,
          analysis: '',
        })),
      })),
      summary: `项目于 ${pmItem.terminatedStage ? `「${pmItem.terminatedStage}」阶段` : ''}终止${
        terminatedAt ? `（${terminatedAt.toISOString().split('T')[0]}）` : ''
      }。终止原因：${pmItem.terminationReason ?? '未填写'}。终止后项目只读，如需继续采购请重新建立项目。`,
    };
  }

  /**
   * 归档详情降级组装（TXT 缺失时）：DB 直组，与 TXT 解析同构。
   * 归档项目数据定型 → 实时即归档时点；附件 filePath=null（无归档物理文件，不可预览）。
   */
  private buildFallbackArchiveDetail(pmItem: any) {
    const stageStatusLabel = (s: string) => (s === 'COMPLETED' ? '已完成' : s === 'IN_PROGRESS' ? '进行中' : '未开始');
    return {
      projectId: pmItem.id,
      projectTitle: pmItem.title,
      archivedAt: pmItem.archivedAt ? pmItem.archivedAt.toISOString().split('T')[0] : null,
      archiveHook: pmItem.archiveHook ?? null,
      archiveDir: null,
      archivedRound: pmItem.currentRound ?? 1,
      kind: 'archived' as const,
      basicInfo: {
        '项目编号': pmItem.projectCode ?? '',
        '申请人': pmItem.requesterName ?? '',
        '申请部门': pmItem.requesterDepartment ?? '',
        '采购方式': pmItem.procurementMethod ?? '',
        '采购类别': pmItem.procurementCategory ?? '',
        '预算金额': pmItem.budgetAmount ? `${Number(pmItem.budgetAmount).toLocaleString('zh-CN')}元` : '',
        '合同编号': pmItem.contractNumber ?? pmItem.demandContractNumber ?? '',
        '部门编号': pmItem.departmentNumber ?? '',
      },
      extractedInfo: {
        '立项时间': pmItem.initiationDate ? pmItem.initiationDate.toISOString().split('T')[0] : '',
        '投标单位': pmItem.biddingUnits ?? '',
        '专家信息': pmItem.expertInfo ?? '',
        '中标单位': pmItem.awardedSupplier ?? '',
        '合同金额': pmItem.contractAmount ? `${Number(pmItem.contractAmount).toLocaleString('zh-CN')}元` : '',
      },
      stages: pmItem.stages.map((stage: any, idx: number) => ({
        stageKey: stage.stageKey,
        stageName: stage.stageName,
        stageDirName: `${idx + 1}.${stage.stageName}`,
        round: stage.round ?? 1, // 轮次透出（流标再采适配，与 TXT 路径同构）
        status: stageStatusLabel(stage.status),
        attachments: stage.attachments.map((att: any) => ({
          id: att.id,
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          filePath: null,
          analysis: '',
        })),
      })),
      summary: `项目已完成归档${
        pmItem.archivedAt ? `（${pmItem.archivedAt.toISOString().split('T')[0]}）` : ''
      }。中标单位：${pmItem.awardedSupplier ?? '—'}；合同金额：${
        pmItem.contractAmount ? `${Number(pmItem.contractAmount).toLocaleString('zh-CN')}元` : '—'
      }。`,
    };
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

    // 终止项目详情：终止轮次无归档 TXT 链路，按 terminationSnapshot 时点的
    //    实时数据（终止后项目只读，实时即快照）组装与归档详情同构的数据，前端复用同一弹窗。
    if (!pmItem) {
      const terminatedItem = await this.prisma.projectManagementItem.findFirst({
        where: { terminatedProcurementRoundId: procurementRoundId },
        include: {
          stages: {
            orderBy: { stageOrder: 'asc' },
            include: { attachments: true },
          },
          terminatedBy: { select: { displayName: true, username: true } },
          createdBy: { select: { displayName: true, username: true } },
        },
      });
      if (terminatedItem?.status === 'TERMINATED') {
        return this.buildTerminatedDetail(terminatedItem);
      }
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
      // 归档 TXT 缺失（目录被清理/后台生成失败）→ 降级 DB 组装：
      // 不再硬 404——弹窗/步骤分析仍可用，逐文件 analysis 为空。补齐需重新生成归档文件。
      const fallback = this.buildFallbackArchiveDetail(pmItem);
      fallback.summary = `（归档文件缺失，以下信息由数据库组装）\n${fallback.summary}`;
      return fallback;
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
        // 轮次透出（2026-10-26 流标再采适配）：多轮归档项目同 stageKey 两轮各一行，
        // 前端按 round 限定 tab 唯一键/标签；目录匹配仍按 stageDirName 不受影响
        round: stage.round ?? 1,
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
    // 项目编号以库内为准（TXT 生成时点早于编号改版的情况以库内三段式为准）
    if (pmItem.projectCode) {
      parsed.basicInfo['项目编号'] = pmItem.projectCode;
    }

    return {
      projectId: pmItem.id,
      projectTitle: pmItem.title,
      archivedAt: archivedAt.toISOString().split('T')[0],
      archiveHook: parsed.archiveHook || pmItem.archiveHook || null,
      archiveDir: projectDir,
      /** 归档时轮次（流标再采项目=末轮；前端进度计数/标签口径） */
      archivedRound: pmItem.currentRound ?? 1,
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
    round?: number,
  ) {
    // Find the project management item
    const pmItem = await this.prisma.projectManagementItem.findFirst({
      where: { archivedProcurementRoundId: procurementRoundId },
      include: {
        // round 消歧（2026-10-26 流标再采适配）：多轮项目同 stageKey 两轮各一行，
        // 不传 round 时 stages[0] 恒命中第 1 轮（旧行为兼容单轮）
        stages: {
          where: { stageKey, ...(round != null ? { round } : {}) },
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

    // Creator-only (2026-10-10 读写分级：leader/admin 对他人项目只读)
    this.assertCanManageProject(user, project, '仅项目创建人可将项目移至回收站。');

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

    // Creator-only (2026-10-10 读写分级：leader/admin 对他人项目只读)
    this.assertCanManageProject(user, project, '仅项目创建人可恢复该项目。');

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

    // Creator-only (2026-10-10 读写分级：leader/admin 对他人项目只读)
    this.assertCanManageProject(user, project, '仅项目创建人可彻底删除该项目。');

    if (project.status !== PROJECT_MANAGEMENT_STATUS.RECYCLED) {
      throw new BadRequestException('请先将项目移入回收站后再彻底删除。');
    }

    // DA/T 103-2024 §8.5 保留策略（S1）
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
    await this.assertPmiMutable(projectId);
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        fileName: true,
        projectManagementItemId: true,
        objectKey: true,
        projectManagementStageId: true,
      },
    });

    if (!attachment) {
      throw new NotFoundException('未找到对应的附件。');
    }

    // 属主校验 + 旧轮内容只读闸（2026-10-26 补漏——旧轮附件不可删，见 helper 注释）
    await this.assertStageAttachmentMutable(projectId, attachment);

    // 冻结锁（2026-09-27）：已完成的 03 正式盖章版不可删除（防归档断链）
    await this.assertAttachmentNotFrozen(attachment);

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
        // 删除的是采购文件主文件——/tmp 文本缓存一并失效（防止提取继续读已删内容）
        if (stage.stageKey === 'TENDER_DOCUMENT' && isTenderMainFile(attachment.fileName)) {
          await this.invalidateTenderTextCache(projectId);
        }
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
      // 乱码率（U+FFFD 替换符占比）：pdf-parse 对部分中文 PDF 产出「长但含替换符」
      // 的文本——此前仅 <50 字符才走 OCR，这类文本长度可观被直接放行（实测
      // 项目概况入库含 「调试��正常」）。≥0.5% 视为编码失败，走 OCR 兜底。
      const garbled = (text.match(/\uFFFD/g) || []).length;
      const garbledRatio = garbled / Math.max(1, text.length);
      // If text extraction yielded meaningful content, return it
      if (text.trim().length > 50 && garbledRatio < 0.005) {
        return text.slice(0, 8000);
      }
      // Text too sparse or garbled — fall back to OCR
      if (garbledRatio >= 0.005) {
        this.logger.log(`Text from ${fileName} garbled (${(garbledRatio * 100).toFixed(2)}% U+FFFD, ${garbled} chars), trying OCR fallback`);
      } else {
        this.logger.log(`Text too sparse from ${fileName} (${text.trim().length} chars), trying OCR fallback`);
      }
      const ocrText = await this.documentParser.parseWithOcr(buffer, mimeType, fileName);
      const ocrGarbledRatio = (ocrText.match(/\uFFFD/g) || []).length / Math.max(1, ocrText.length);
      if (ocrText.trim().length > text.trim().length && ocrGarbledRatio <= garbledRatio) {
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

    // 直接采购：2026-09-09 起模板标签统一为「开标时间」（原「递交和谈判时间」），正则须两者都认
    // 谈判/询比：文档使用"递交及谈判时间"、"响应截止及谈判时间"等
    const patterns: RegExp[] = isDirect
      ? [
          /开标时间[：:]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\d:时分]*)/,
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

    // Fallbacks: 适配不同采购方式的关键词（直接采购含 2026-09-09 起新标签「开标时间」）
    const timeKeywords = isDirect
      ? '开标时间|递交和谈判时间|递交及谈判时间|谈判时间|递交时间'
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
      // 预算上限：v4-flash 为推理模型，默认 180s 超时×2 重试会让左栏「AI 提取」
      // 转圈十几分钟无反馈；此处收紧为 60s×1 重试（输出 ≤500 字，2048 token 充裕）
      const result = await this.aiService.chat(systemPrompt, text, 0.2, undefined, undefined, {
        maxTokens: 2048, timeoutMs: 60_000, retries: 1,
      });
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
  /** AI 从采购文件文本中提取「开标时间」（规则/关键词提取失败时的兜底）。
   *  文档标签随采购方式各异（开标时间/递交和谈判时间/投标截止时间等），规则覆盖不全时由此兜底。 */
  private async aiExtractBidOpeningTime(text: string): Promise<string | null> {
    try {
      const systemPrompt =
        '从以下采购文件文本中提取"开标时间"（开标/递交响应文件/谈判开始的具体日期时间，字段名可能是"开标时间""递交和谈判时间""投标截止时间"等），' +
        '必须保留日期与时分（如09:00、14:00）。只输出一个日期时间（如"2026年9月20日14:00"），不要其他说明。' +
        '如果文本中没有该信息，输出"无"。';
      const result = await this.aiService.chat(systemPrompt, text.slice(0, 4000), 0.1, undefined, undefined, {
        maxTokens: 512, timeoutMs: 30_000, retries: 1,
      });
      const cleaned = result?.trim();
      if (cleaned && cleaned !== '无' && /\d{4}年/.test(cleaned)) {
        return cleaned;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async aiNormalizeBidOpeningTime(text: string): Promise<string> {
    if (!text) return text;
    try {
      const systemPrompt =
        '你是开标时间规范化助手。把输入的开标时间文本规范化为"YYYY年M月D日H:MM"格式（24小时制，分钟两位）。' +
        '规则：① 保留原文的日期与时分；② 若原文只有日期没有具体时分，按线索补全：含"下午/午后"补 14:00、含"上午"补 9:00、无线索默认补 9:00；' +
        '③ 把"X时X分""X点X分"统一为"H:MM"；④ 直接输出规范化结果，不要解释、引号或前后缀。' +
        '示例：输入"2026年7月25日"→"2026年7月25日9:00"；输入"2026.7.25 下午两点"→"2026年7月25日14:00"；输入"2026-07-25 14:00"→"2026年7月25日14:00"。';
      const result = await this.aiService.chat(systemPrompt, text, 0.2, undefined, undefined, {
        maxTokens: 512, timeoutMs: 30_000, retries: 1,
      });
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
      const result = await this.aiService.chat(systemPrompt, text, 0.0, undefined, undefined, {
        maxTokens: 512, timeoutMs: 30_000, retries: 1,
      });
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
      const result = await this.aiService.chat(systemPrompt, text.slice(0, 4000), 0.1, undefined, undefined, {
        maxTokens: 512, timeoutMs: 30_000, retries: 1,
      });
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
          '将提取到的实质内容概括改写为80-200字的简介：一两句话点明采购事项，核心采购内容（标的/品类/数量级）可写但只作概括，不逐项罗列参数、型号、批次清单，不整段照抄原文。不要保留章节编号、不要输出"采购内容"标题本身、不要添加解释或评价。' +
          '如果文本中没有实质性的采购内容描述，输出"无"。'
        : isNegotiationOrInquiry
          ? '从以下采购文件文本中提取"采购内容/采购需求"部分的实质描述，' +
            '限定范围：仅提取采购标的名称、规格、数量、质量要求等描述"买什么"的信息。' +
            '严格排除："供应商资格条件""商务条款""技术门槛""供货期限""验收方式""付款方式"以及对供方的资质要求。' +
            '将提取到的实质内容概括改写为80-200字的简介：一两句话点明采购事项，核心采购内容（标的/品类/数量级）可写但只作概括，不逐项罗列参数、型号、批次清单，不整段照抄原文。不要保留章节编号、不要输出标题、不要添加解释或评价。' +
            '如果文本中没有实质性的采购内容描述，输出"无"。'
          : '从以下采购文件文本中提取"项目概况"部分的实质描述，' +
            '限定范围：仅提取项目背景、采购范围、建设规模、采购标的等描述"买什么/建什么"的信息。' +
            '严格排除："投标人资格要求""供应商资格条件""技术规格要求""商务条款""评审办法"以及任何对投标方的资质/业绩门槛。' +
            '将提取到的实质内容概括改写为80-200字的简介：一两句话点明项目背景与采购事项，核心采购内容（标的/品类/规模）可写但只作概括，不逐项罗列参数、型号、批次清单，不整段照抄原文。不要保留章节编号、不要输出"项目概况"标题本身、不要添加解释或评价。' +
            '如果文本中没有项目概况内容，输出"无"。';
      // 预算上限：8k 字输入对推理型模型属重负载，默认 180s×2 重试会让「AI 提取项目概况」
      // 长时间转圈无反馈；60s×1 重试 + 2048 token（输出 80-200 字概括，思维链另有余量）
      const result = await this.aiService.chat(systemPrompt, text.slice(0, 8000), 0.2, undefined, undefined, {
        maxTokens: 2048, timeoutMs: 60_000, retries: 1,
      });
      const cleaned = result?.trim();
      if (cleaned && cleaned !== '无' && cleaned.length >= 20) {
        // 出口硬闸：prompt 字数约束是软约束，模型超长输出兜底截断（2026-10-16 稳健性加固）
        return capOverviewLength(cleaned);
      }
      return null;
    } catch {
      return null;
    }
  }



  /**
   * 读取项目管理阶段附件文本。persistUploadedFile 将附件保存至本地
   * uploads/project-management/<storedFileName>，objectKey 为其相对路径。
   * 优先读取本地文件，缺失时回退 MinIO，以兼容对象存储中的附件。
   */

  private async readAttachmentText(objectKey: string, mimeType?: string | null, fileName?: string): Promise<string> {
    const storedName = objectKey.split('/').pop() ?? objectKey;
    const localPath = resolve(getUploadDir(), storedName);
    // 出口剔除替换符（2026-10-15 公告乱码实录）：解析器偶发产出含 U+FFFD 的文本，
    // 直接落 text 缓存后每次提取都带着乱码进字段/公告
    try {
      const stat = await (await import('fs/promises')).stat(localPath).catch(() => null);
      if (stat?.isFile()) {
        const buffer = await (await import('fs/promises')).readFile(localPath);
        return stripMojibake(await this.documentParser.parse(buffer, mimeType ?? '', fileName ?? storedName));
      }
    } catch { /* 本地读取失败继续尝试 MinIO */ }
    const buffer = await this.storage.download(objectKey);
    return stripMojibake(await this.documentParser.parse(buffer, mimeType ?? '', fileName ?? storedName));
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

  async getProjectAttributions(user?: AuthenticatedUser, requestedCompanyId?: string) {
    // 0. 公司隔离（2026-10-27 用户裁定：项目归属不同公司不互通）——归属库由 PMI 聚合
    //    派生，隔离在聚合源上注入（数据库层过滤，非全量算完再减）；admin 默认全量、
    //    ?companyId= 过滤，非 admin 强制本人公司（写侧天然隔离：归属随 PMI.companyId 落快照）
    const scopeWhere = this.companyScope.filter(
      await this.companyScope.resolveScope(user, requestedCompanyId),
    );
    // 1. 全量项目聚合（2026-10-23 用户口径：确认归属即入库——原只聚 ARCHIVED，
    //    新建项目的归属永不进库，后续创建下拉里只剩「其他」）
    const archivedProjects = await this.prisma.projectManagementItem.findMany({
      where: {
        demandProject: { not: null },
        status: { not: 'RECYCLED' }, // 回收站项目不入库（已删除的归属污染选项）
        ...scopeWhere,
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

    // 提取 styles.xml 用于字号映射
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

    // 第一步：提取每段的纯文本 + HTML
    const rawParagraphs: Array<{ text: string; html: string; style: string; origIdx: number }> = [];
    const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let match;

    while ((match = pRegex.exec(docXml)) !== null) {
      const pXml = match[0];

      // 提取样式名和段级别字号
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

    // 1.5：后处理 ─ 去噪、去重、识别章标题
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

    // 第二步：AI 语义分析章节结构，回退到纯规则
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
      // fallback：遇 [H] 即切章
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
    await this.assertPmiMutable(projectId);
    const oldAttachment = await this.prisma.attachment.findUnique({
      where: { id: dto.attachmentId },
      select: { id: true, fileName: true, objectKey: true, projectManagementItemId: true, projectManagementStageId: true },
    });
    if (!oldAttachment) throw new NotFoundException('未找到对应附件');
    await this.assertStageAttachmentMutable(projectId, oldAttachment); // 属主+旧轮闸（2026-10-26 补漏，此前两查皆无）

    const filePath = resolve(process.cwd(), 'uploads', oldAttachment.objectKey);
    const buffer = await readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new NotFoundException('无法解析 DOCX 文档');

    // 第一步：提取所有非空 <w:p>（含在 docXml 中的字节起止位置）
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

    // 第二步：为每个编辑段构建编辑指令（仅修改前端发送的段落）
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

    // 第三步：从后往前应用编辑（保证位置索引不被前序修改偏移）
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

    // 采购文件主文件段落内容已变——失效 /tmp 文本缓存（同 saveAttachmentHtml 口径）
    if (oldAttachment.projectManagementStageId) {
      const stage = await this.prisma.projectManagementStage.findUnique({
        where: { id: oldAttachment.projectManagementStageId },
        select: { stageKey: true },
      });
      if (stage?.stageKey === 'TENDER_DOCUMENT' && isTenderMainFile(oldAttachment.fileName)) {
        await this.invalidateTenderTextCache(projectId);
      }
    }

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
    await this.assertPmiMutable(projectId);
    const oldAttachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, fileName: true, objectKey: true, projectManagementItemId: true, projectManagementStageId: true },
    });
    if (!oldAttachment) throw new NotFoundException('未找到对应附件');
    await this.assertStageAttachmentMutable(projectId, oldAttachment); // 属主+旧轮闸（2026-10-26 补漏，此前两查皆无）

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

    // 采购文件被文本替换——旧或新文件名命中主文件判定即失效 /tmp 文本缓存
    if (oldAttachment.projectManagementStageId) {
      const stage = await this.prisma.projectManagementStage.findUnique({
        where: { id: oldAttachment.projectManagementStageId },
        select: { stageKey: true },
      });
      if (
        stage?.stageKey === 'TENDER_DOCUMENT' &&
        (isTenderMainFile(oldAttachment.fileName) || isTenderMainFile(fileName))
      ) {
        await this.invalidateTenderTextCache(projectId);
      }
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

      // 1. 提取批注引用范围 <w:commentRangeStart>/<w:commentRangeEnd>
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

        // 2. 提取高亮 run
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

        // 3. 提取修订插入 <w:ins>
        for (const m of docXml.matchAll(/<w:ins[\s>][\s\S]*?<\/w:ins>/g)) {
          const fp = xmText(m[0]);
          if (fp.length >= 2) inlineAnnotations.push({ fingerprint: fp, type: 'insertion' });
        }

        // 4. 提取修订删除 <w:del>
        for (const m of docXml.matchAll(/<w:del[\s>][\s\S]*?<\/w:del>/g)) {
          const fp = xmText(m[0]);
          if (fp.length >= 2) inlineAnnotations.push({ fingerprint: fp, type: 'deletion' });
        }
      }

      this.logger.log(`审阅文件解析完成：${inlineAnnotations.length} 条内嵌标注`);
    } catch (e: any) {
      this.logger.warn(`审阅文件标注提取失败: ${e?.message}`);
    }

    // mammoth 转换（审阅版渲染专用：annotation 后处理依赖 mammoth 的 HTML 结构）
    const result = await this.convertDocxToHtmlLegacy(buffer);

    let html = result.value;

    // 后处理：在 HTML 中为每条标注包裹 <mark class="tfe-review-xxx">
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
    await this.assertPmiMutable(projectId);
    const oldAttachment = await this.prisma.attachment.findUnique({
      where: { id: dto.attachmentId },
      select: { id: true, fileName: true, objectKey: true, projectManagementItemId: true, projectManagementStageId: true },
    });
    if (!oldAttachment) throw new NotFoundException('未找到对应附件');
    await this.assertStageAttachmentMutable(projectId, oldAttachment); // 属主+旧轮闸（2026-10-26 补漏，此前两查皆无）

    // 冻结锁（2026-09-27）：已完成的 03 正式盖章版不可替换内容
    await this.assertAttachmentNotFrozen(oldAttachment);

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
        // 文件内容已整体替换——提取文本懒缓存同步失效（AI 提取/OCR 按新内容重跑）
        extractedText: null,
        extractedTextAt: null,
      },
    });

    // 清理旧物理文件（patcher 路径已在归档步骤复制到 tender-doc-versions/）
    try { await unlink(oldPath); } catch {}

    // 采购文件主文件内容已整体替换——失效 /tmp 文本缓存。
    // （上面 extractedText 置空只覆盖 DB 懒缓存；/tmp 缓存不清，
    //  左栏「AI 提取」仍命中旧文本，提出旧的开标时间/获取时间/项目概况）
    if (oldAttachment.projectManagementStageId) {
      const stage = await this.prisma.projectManagementStage.findUnique({
        where: { id: oldAttachment.projectManagementStageId },
        select: { stageKey: true },
      });
      if (stage?.stageKey === 'TENDER_DOCUMENT' && isTenderMainFile(oldAttachment.fileName)) {
        await this.invalidateTenderTextCache(projectId);
      }
    }

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
      // 最新上传优先（与 extractTenderFields 同口径）
      include: { attachments: { orderBy: { createdAt: 'desc' } } },
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
        '你是采购公告字段提取助手。从招标文件原文中提取以下字段，输出严格的 JSON 对象（key 为字段名，value 为提取值）。只包含能提取到的字段，不确定的字段不要输出。字段：projectName(项目名称)、projectOverview(项目概况/采购内容简介，概括为80-200字，不逐项罗列参数细目)、maxPriceNumeric(预算金额/最高限价)、contactName(联系人)、contactPhone(联系电话)、contactEmail(联系邮箱)、qualificationRequirements(供应商资格要求)、bidOpeningTime(开标时间)。' +
        '注意：bidOpeningTime 必须是「开标」的时刻，严禁把「投标/响应文件递交截止时间」「递交及截止时间」当作开标时间（采购文件中两者常同时出现且相差24小时）——优先取明确标注「开标时间」的字段值。',
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

    // 开标时间权威覆盖：PMI 项目基本信息已有规则引擎从同一采购文件提取的开标时间
    // （extractTenderFields，含 AI 归一化），AI 提取偶发把「递交截止」（=开标−24h，
    // 同文出现）误当开标时间（2026-10-12 实录：公告草稿被灌入开标−24h 值）——
    // 有项目值时直接覆盖 AI 结果，杜绝时间漂移
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { bidOpeningTime: true },
    });
    if (item?.bidOpeningTime?.trim()) {
      fields.bidOpeningTime = item.bidOpeningTime.trim();
    }

    return { fields, extractedText };
  }
}

