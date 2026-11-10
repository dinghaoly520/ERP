import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Public } from '../common/decorators/public.decorator';
import { AiService } from './ai.service';
import { SupplierEvaluationAnalysisService } from './supplier-evaluation-analysis.service';
import { SupplierPortraitAnalysisService } from './supplier-portrait-analysis.service';
import { SupplierQualificationMatchService } from './supplier-qualification-match.service';
import { InvitationLetterService } from './invitation-letter.service';
import { ShareShortlistDto } from './dto/share-shortlist.dto';
import { DashboardAnalysisDto } from './dto/dashboard-analysis.dto';
import { MobileGreetingService } from './mobile-greeting.service';
import { MobileBriefService } from './mobile-brief.service';
import { portalSourceOf } from '../common/portal-source.util';
import { ProcurementAnalysisDto } from './dto/procurement-analysis.dto';
import { TenderFieldGenerateDto } from './dto/tender-field-generate.dto';
import { ReferenceBudgetDto } from './dto/reference-budget.dto';
import { Throttle } from '@nestjs/throttler';
import { sanitizeHardConditions } from './supplier-hard-conditions';

@ApiTags('AI辅助评标')
@ApiCookieAuth('token')
@Controller('ai')
// P0-13：所有 AI 路由默认限流 20/min/用户，防脚本刷爆 DeepSeek 账单；重路由再单独收紧到 10/min。
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AiController {
  constructor(
    private aiService: AiService,
    private supplierEvalAnalysis: SupplierEvaluationAnalysisService,
    private supplierPortraitAnalysis: SupplierPortraitAnalysisService,
    private qualificationMatch: SupplierQualificationMatchService,
    private invitationLetter: InvitationLetterService,
    private mobileGreeting: MobileGreetingService,
    private mobileBrief: MobileBriefService,
  ) {}

  @Get('mobile-greeting')
  @ApiOperation({ summary: '移动驾驶舱（:3011）欢迎语——LLM 每次现场生成（无缓存）' })
  @Roles('admin', 'leader', 'staff')
  getMobileGreeting(@CurrentUser() user: AuthenticatedUser) {
    return this.mobileGreeting.getGreeting(user);
  }

  @Get('mobile-brief')
  @ApiOperation({ summary: '移动驾驶舱（:3011）今日要报——LLM 现场生成（不缓存；区间随页面 startDate/endDate+rangeKey，缺省本月）' })
  @Roles('admin', 'leader', 'staff')
  getMobileBrief(
    @CurrentUser() user: AuthenticatedUser,
    @Request() req: any = {},
    @Query('companyId') companyId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('rangeKey') rangeKey?: string,
  ) {
    // 日期裸 string 直入 new Date() 会产出 Invalid Date → Prisma 校验错 500；
    // 形状（ISO）+ 日历有效性双校验——「2026-13-45」形状合法但 Invalid Date（评审 F9）
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const assertValidDate = (name: string, v?: string) => {
      if (v == null || v === '') return;
      if (!ISO_DATE.test(v) || Number.isNaN(new Date(v).getTime())) {
        throw new BadRequestException(`${name} 须为合法的 yyyy-mm-dd 日期`);
      }
    };
    assertValidDate('startDate', startDate);
    assertValidDate('endDate', endDate);
    return this.mobileBrief.getBrief(user, companyId, startDate, endDate, rangeKey, portalSourceOf(req));
  }

  @Get('projects/:projectId/analyze/:supplierId')
  @ApiOperation({ summary: 'AI全方位分析供应商投标' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async analyzeBid(
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.aiService.analyzeBid(projectId, supplierId);
  }

  @Get('projects/:projectId/anomalies')
  @ApiOperation({ summary: 'AI评分异常检测' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async detectAnomalies(@Param('projectId') projectId: string) {
    return this.aiService.detectAnomalies(projectId);
  }

  @Get('projects/:projectId/risk-scores')
  @ApiOperation({ summary: 'AI供应商风险评分' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async getSupplierRiskScores(@Param('projectId') projectId: string) {
    return this.aiService.getSupplierRiskScores(projectId);
  }

  @Post('supplier-selection')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI智能推荐供应商（按采购需求）' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async recommendSuppliers(
    @Body() body: { requirement?: string; tags?: string[]; maxCount?: number; excludedSupplierIds?: string[]; projectContext?: Record<string, string>; companyId?: string; hardConditions?: unknown },
    @Request() req: any = {},
  ) {
    const requirement = (body?.requirement ?? '').trim();
    if (!requirement) {
      throw new BadRequestException({ error: '请填写采购需求', code: 'REQUIREMENT_REQUIRED' });
    }
    const tags = Array.isArray(body?.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : undefined;
    try {
      return await this.aiService.recommendSuppliers(requirement, {
        tags: tags && tags.length > 0 ? tags : undefined,
        maxCount: body.maxCount,
        excludedSupplierIds: Array.isArray(body.excludedSupplierIds) ? body.excludedSupplierIds.filter(Boolean) : undefined,
        projectContext: body.projectContext,
        // 公司级隔离：候选池限定登录人公司；admin 可传项目归属公司切换（非 admin 传参被 resolveScope 忽略）
        companyId: typeof body?.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : undefined,
        // 硬性筛选条件（2026-11-04 spec）：入参消毒（字典 key 白名单/数字夹取），空对象=行为与现状一致
        hardConditions: sanitizeHardConditions(body?.hardConditions),
        actor: req.user,
      });
    } catch (e: any) {
      throw new BadRequestException({ error: e?.message || '智能推荐服务暂时不可用，请稍后重试', code: 'RECOMMEND_FAILED' });
    }
  }

  @Get('hard-condition-vocab')
  @ApiOperation({ summary: '硬性条件词表（行业=库内公司视野聚合 + 资质字典）' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async getHardConditionVocab(@Query('companyId') companyId?: string, @Request() req: any = {}) {
    return this.aiService.getHardConditionVocab(req.user, companyId);
  }

  @Post('suggest-hard-conditions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI 按项目上下文从词表预填硬性筛选条件' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async suggestHardConditions(
    @Body() body: { projectContext?: Record<string, string>; industries?: string[]; qualifications?: { key: string; label: string }[] },
  ) {
    const industries = Array.isArray(body?.industries)
      ? body.industries.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean).slice(0, 40)
      : [];
    const qualifications = Array.isArray(body?.qualifications)
      ? body.qualifications
          .filter((q) => q && typeof q === 'object' && typeof (q as Record<string, unknown>).key === 'string')
          .map((q) => ({ key: String(q.key), label: String((q as Record<string, unknown>).label || '') }))
          .filter((q) => q.label)
          .slice(0, 60)
      : [];
    const hardConditions = await this.aiService.suggestHardConditions({
      projectContext: body?.projectContext,
      industries,
      qualifications,
    });
    return { hardConditions };
  }

  @Post('suggest-tags')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI 按项目上下文从词表预选业务标签（供应商选取页预填）' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async suggestBusinessTags(
    @Body() body: {
      projectName?: string;
      projectCode?: string;
      procurementMethod?: string;
      stage?: string;
      requirement?: string;
      fileSummary?: string;
      vocabulary?: string[];
    },
  ) {
    const vocabulary = Array.isArray(body?.vocabulary)
      ? body.vocabulary.map((t) => String(t).trim()).filter(Boolean).slice(0, 200)
      : [];
    try {
      const tags = await this.aiService.suggestBusinessTags({
        projectName: body?.projectName,
        projectCode: body?.projectCode,
        procurementMethod: body?.procurementMethod,
        stage: body?.stage,
        requirement: body?.requirement,
        fileSummary: body?.fileSummary,
        vocabulary,
      });
      return { tags };
    } catch (e: any) {
      throw new BadRequestException({ error: e?.message || '标签预选服务暂时不可用', code: 'SUGGEST_TAGS_FAILED' });
    }
  }

  @Post('dashboard-analysis')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI采购仪表盘深度分析（从procurement迁入；admin 带 cacheKey 时生成结果落服务端缓存——每公司视野一份最新）' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async dashboardAnalysis(@CurrentUser() user: AuthenticatedUser, @Body() payload: DashboardAnalysisDto) {
    // 缓存写仅 admin（2026-11-10 稳健轮）：非 admin 的 companyId 参数本被数据端点忽略，
    // 若放行 cacheKey 会用本公司数据污染他公司缓存键（管理员命中错内容=跨公司错标）
    if (user.role !== 'admin') payload.cacheKey = undefined;
    return this.aiService.analyzeDashboard(payload);
  }

  @Get('dashboard-analysis/cache')
  @ApiOperation({ summary: '仪表盘 AI 分析缓存提取（2026-11-10）：按公司视野+日期区间取最新一份，数据指纹未变即命中，不再每次重新生成（仅 admin——公司选择器为 admin 专用，非 admin 一律 miss 走隔离链路）' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async dashboardAnalysisCache(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId = 'all',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (user.role !== 'admin') return { hit: false, fingerprint: '' };
    return this.aiService.getDashboardAnalysisCache(companyId, startDate, endDate);
  }

  @Post('procurement-analysis')
  @ApiOperation({ summary: 'AI采购台账分析' })
  @Roles('admin', 'leader', 'staff')
  async procurementAnalysis(@Body() payload: ProcurementAnalysisDto) {
    return this.aiService.analyzeProcurementLedger(payload);
  }

  @Post('tender-field-generate')
  @ApiOperation({ summary: 'AI招标字段内容生成' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async tenderFieldGenerate(@Body() payload: TenderFieldGenerateDto) {
    // 供应商名称不允许 AI 生成（2026-10-16 用户裁定）：直接采购的供应商必须真实
    // 选定/手填，AI 会编造公司名——前端按钮已隐藏，此处纵深拦截 API 直调
    if (payload.fieldKey === 'supplierName') {
      throw new BadRequestException({ error: '供应商名称不支持 AI 生成', code: 'SUPPLIER_NAME_NO_AI' });
    }
    // 项目名称不允许 AI 生成（2026-10-30 实录）：名称的权威来源是 PMI 标题（打开弹窗
    // 即预填），LLM 拿到全套项目素材只会写出整段项目综述盖掉名称——与供应商名同款纵深拦截
    if (payload.fieldKey === 'projectName') {
      throw new BadRequestException({ error: '项目名称不支持 AI 生成——已按项目信息预填，如需调整请在编辑器中直接修改', code: 'PROJECT_NAME_NO_AI' });
    }
    return this.aiService.generateTenderFieldContent(payload);
  }

  @Post('generate-notification')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI生成供应商通知文案' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async generateNotificationContent(
    @Body() payload: {
      projectName?: string; projectCode?: string; supplierNames: string[];
      supplierIds?: string[]; projectId?: string | null; deadline?: string;
      procurementMethod?: string; procurementCategory?: string;
      budgetAmount?: string; requesterDepartment?: string; requesterName?: string;
      projectReason?: string; supplierRequirements?: string; projectOverview?: string;
      fileAnalysisContext?: string; validityDays?: number;
      contentMode?: 'ai' | 'template'; // 'template'（2026-10-27）：跳过 LLM，返回固定语句骨架（:3005 邀请第三步关键词设计）
      forceNewRsvpToken?: boolean; // 强制换发确认链接（未回复行换新 token；已回复行保持原链接）
    },
    @Request() req: any = {},
  ) {
    // 请求头透传：RSVP 回执链接按「当前访问主机」生成（局域网自适应，防 localhost 链接发给供应商）
    const { requestHeaders: _clientIgnored, ...context } = payload as typeof payload & { requestHeaders?: unknown };
    const h = (req.headers || {}) as Record<string, string>;
    return this.aiService.generateNotificationContent({
      ...context,
      requestHeaders: { origin: h.origin, referer: h.referer, 'x-forwarded-host': h['x-forwarded-host'], 'x-forwarded-proto': h['x-forwarded-proto'] },
    });
  }

  @Post('polish-requirement')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI润色采购需求描述' })
  @Roles('admin', 'bid_expert', 'leader', 'staff')
  async polishRequirement(@Body() payload: { text: string; projectName?: string; procurementMethod?: string; deadline?: string; additionalContext?: string }) {
    if (!payload.text?.trim()) throw new BadRequestException('请提供需求文本');
    // P1-24：截断超长文本，防 prompt 撑爆模型上下文与成本失控。
    const text = payload.text.trim().slice(0, 4000);
    return this.aiService.polishRequirement(text, {
      projectName: payload.projectName,
      procurementMethod: payload.procurementMethod,
      deadline: payload.deadline,
      additionalContext: payload.additionalContext,
    });
  }

  @Post('polish-initiation-field')
  @ApiOperation({ summary: 'AI优化立项事由/供方要求（基于上传的需求表与立项表）' })
  @Roles('admin', 'leader', 'staff')
  async polishInitiationField(@Body() payload: {
    field: 'projectReason' | 'supplierRequirements';
    text: string;
    demandDocText?: string;
    initiationDocText?: string;
    projectContext?: { title?: string; category?: string; method?: string };
  }) {
    if (!payload.text?.trim()) throw new BadRequestException('请提供待优化的文本');
    if (payload.field !== 'projectReason' && payload.field !== 'supplierRequirements') {
      throw new BadRequestException('field 必须是 projectReason 或 supplierRequirements');
    }
    return this.aiService.polishInitiationField({
      field: payload.field,
      text: payload.text.trim(),
      demandDocText: payload.demandDocText,
      initiationDocText: payload.initiationDocText,
      projectContext: payload.projectContext,
    });
  }

  @Post('supplier-evaluation-analysis')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI供应商评价维度分析' })
  @Roles('admin', 'bid_expert', 'leader', 'staff')
  async supplierEvaluationAnalysis(@Body() payload: { supplierId: string }) {
    if (!payload.supplierId) throw new BadRequestException('请提供 supplierId');
    return this.supplierEvalAnalysis.analyze(payload.supplierId);
  }

  @Post('supplier-portrait-analysis')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI供应商综合画像分析' })
  @Roles('admin', 'bid_expert', 'leader', 'staff')
  async getSupplierPortraitAnalysis(@Body() payload: { supplierId: string; bypassCache?: boolean }) {
    if (!payload.supplierId) throw new BadRequestException('请提供 supplierId');
    return this.supplierPortraitAnalysis.analyze(payload.supplierId, !!payload.bypassCache);
  }

  // ── A2 选取历史 / 候选名单 / 分享（此前路由缺失致前端死链）──
  @Get('selection-history')
  @ApiOperation({ summary: '选取历史列表' })
  @Roles('admin', 'leader', 'staff')
  async listSelectionHistory() { return this.aiService.listSelectionHistory(); }

  @Get('selection-history/:id')
  @ApiOperation({ summary: '选取历史详情' })
  @Roles('admin', 'leader', 'staff')
  async getSelectionHistory(@Param('id') id: string) { return this.aiService.getSelectionHistoryDetail(id); }

  @Get('selection-history/:id/shortlist')
  @ApiOperation({ summary: '恢复候选名单（返回该次推荐）' })
  @Roles('admin', 'leader', 'staff')
  async getSelectionShortlist(@Param('id') id: string) { return this.aiService.getSelectionHistoryShortlist(id); }

  @Patch('selection-history/:id/shortlist')
  @ApiOperation({ summary: '更新候选名单勾选' })
  @Roles('admin', 'leader', 'staff')
  async updateSelectionShortlist(@Param('id') id: string, @Body() body: { shortlistedIds: string[] }) {
    return this.aiService.updateSelectionShortlist(id, body?.shortlistedIds ?? []);
  }

  @Delete('selection-history/:id')
  @ApiOperation({ summary: '删除选取历史' })
  @Roles('admin', 'leader', 'staff')
  async deleteSelectionHistory(@Param('id') id: string) { return this.aiService.deleteSelectionHistory(id); }

  // ── 采购邀请书（供应商邀请·附件步骤：AI 起草九项 → 排版导出 Word） ──

  @Post('supplier-qualification-match')
  @ApiOperation({ summary: '供应商资格符合性分析：对照本项目资格条件逐条判定（LLM 不可用回退结构化粗判）' })
  @Roles('admin', 'leader', 'staff')
  async supplierQualificationMatch(@Body() body: { supplierId: string; projectId: string; requirementText?: string }) {
    if (!body?.supplierId || !body?.projectId) throw new BadRequestException('supplierId 与 projectId 必填');
    // requirementText=邀请页步骤1「供应商要求」全文（优先于项目/立项登记的资格条件）
    return this.qualificationMatch.analyze(body.supplierId, body.projectId, body.requirementText);
  }

  @Post('invitation-letter/generate')
  @ApiOperation({ summary: 'AI 根据项目已知信息起草采购邀请书公文体正文（LLM 不可用时回退结构化成稿）' })
  @Roles('admin', 'leader', 'staff')
  async generateInvitationLetter(@Body() body: {
    projectId: string;
    acquireStart?: string;
    acquireEnd?: string;
    bidAt?: string;
  }) {
    if (!body?.projectId) throw new BadRequestException('projectId 必填');
    return this.invitationLetter.generate(body.projectId, {
      acquireStart: body.acquireStart,
      acquireEnd: body.acquireEnd,
      bidAt: body.bidAt,
    });
  }

  @Post('invitation-letter/export')
  @ApiOperation({ summary: '公文排版导出采购邀请书 Word（落 MinIO 建 FileAsset，可直接加入附件清单）' })
  @Roles('admin', 'leader', 'staff')
  async exportInvitationLetter(@Body() body: {
    paragraphs: string[];
    project: { name: string; code: string };
  }, @Request() req: any) {
    return this.invitationLetter.exportDocx({
      paragraphs: body?.paragraphs ?? [],
      project: body?.project,
      uploaderId: req.user?.sub,
    });
  }
}
