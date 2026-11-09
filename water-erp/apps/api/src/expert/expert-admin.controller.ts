import { Controller, Get, Post, Put, Patch, Body, Param, Query, Request, Res, BadRequestException, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ExpertAdminService } from './expert-admin.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { ExpertMemoService } from './expert-memo.service';
import { CreateExpertDto } from './dto/create-expert.dto';
import { ExtractPreviewDto } from './dto/extract-preview.dto';
import { ConfirmExtractionDto } from './dto/confirm-extraction.dto';
import { ExtractionNotifyDto } from './dto/extraction-notify.dto';
import { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';
import { SetAvailabilityDto, ConfirmRetireDto } from './dto/expert-status.dto';
import { UpdateExpertStatusDto } from './dto/update-expert-status.dto';
import { CommitteeAssignmentDto } from '../bid/dto/committee-assignment.dto';
import {
  UpdateExpertProfileDto,
  RevealExpertFieldDto,
  GenerateNotificationDto,
  BatchOperationDto,
  ImportCsvDto,
  ImportBatchApproveDto,
  RecordViolationDto,
  NotifyPrefsDto,
  OcrIntakeDto,
  AiSuggestEvaluationDto,
  AnalyzeExtractionFilesDto,
  AnalyzeProjectDto,
  CreateCustomProjectDto,
} from './dto/expert-admin-misc.dto';

@ApiTags('专家管理')
@ApiCookieAuth('token')
@Controller('expert-admin')

@Roles('admin', 'bid_host', 'leader', 'staff')
export class ExpertAdminController {
  constructor(
    private expertAdminService: ExpertAdminService,
    private memoService: ExpertMemoService,
    private extractionService: ExpertExtractionService,
  ) {}

  @Public()
  @Get('bigscreen-stats')
  @ApiOperation({ summary: '大屏专家库聚合统计（公开，无需登录）' })
  getBigscreenStats() {
    return this.expertAdminService.getBigscreenStats();
  }

  @Get()
  @ApiOperation({ summary: '专家库列表（分页；公司隔离——admin 可 ?companyId= 切单公司，非 admin 强制本公司）' })
  listExperts(
    @Query('search') search?: string,
    @Query('specialty') specialty?: string,
    @Query('employer') employer?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效
    @Request() req: any = {},
  ) {
    return this.expertAdminService.listExperts(
      search,
      specialty,
      employer,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
      req.user,
      companyId,
    );
  }

  @Get('company-counts')
  @ApiOperation({ summary: '按公司分组全量计数（admin 全部公司视图的分组标题，与列表同 where）' })
  companyCounts(
    @Query('search') search?: string,
    @Query('specialty') specialty?: string,
    @Query('employer') employer?: string,
    @Request() req: any = {},
  ) {
    return this.expertAdminService.companyCounts(search, specialty, employer, req.user);
  }

  @Get('specialties')
  @ApiOperation({ summary: '专家专业列表（去重；显式 companyId=配额公司白名单并集可跨公司，未指定=登录人公司隔离；?scope=group 全库口径——抽取页专业池与 AI 配额/跨公司抽取同口径）' })
  listSpecialties(@Query('companyId') companyId?: string, @Query('scope') scope?: string, @Request() req: any = {}) {
    return this.expertAdminService.listSpecialties(req.user, companyId, scope);
  }

  @Get('specialty-pool-counts')
  @ApiOperation({ summary: '全库各专业人数（抽取页配额卡「N人·库内」提示；不分公司）' })
  specialtyPoolCounts() {
    return this.expertAdminService.specialtyPoolCounts();
  }

  @Get('department-options')
  @ApiOperation({ summary: '录入表单所属部门联想：专家域已用部门名（按专家使用数降序；自定义输入仍可新建）' })
  departmentOptions() {
    return this.expertAdminService.departmentOptions();
  }

  @Get('pool-companies')
  @ApiOperation({ summary: '配额「公司」下拉候选：仅列库内确有可抽取专家的公司（与抽取池同资格口径，可跨公司）' })
  listPoolCompanies() {
    return this.expertAdminService.listPoolCompanies();
  }

  @Get('demand-rep-directory')
  @ApiOperation({
    summary: '需求方代表目录（全库，不隔离）：抽取页「公司→部门→专业」级联与指定代表搜索的数据源',
    description: '仅输出目录级字段（姓名/单位/部门/专业/公司id），不含电话、证件号、评价等 PII；跨公司选需求方代表为既定口径（2026-09-24 抽取配置公司白名单），专家库列表端点的公司隔离保护的是全量档案浏览，本端点不适用',
  })
  getDemandRepDirectory() {
    return this.expertAdminService.getDemandRepDirectory();
  }

  @Post('demand-rep/external')
  @ApiOperation({
    summary: '手动录入需求方代表（库外人员，2026-11-05）：建临时专家账号（username/初始口令=身份证号）',
    description: '登录与 :3006 功能同正式专家，但仅项目存续期有效——确认抽取入组后可登录；项目归档/流标/终止/废标或重抽换人后，登录与会话即时失效（TEMP_ACCOUNT_EXPIRED）。身份证号已绑定库内专家时报 409 引导改从库内指定。',
  })
  createExternalDemandRep(
    @Body() body: { name?: string; idCard?: string; phone?: string; employer?: string; departmentName?: string; specialty?: string },
    @Request() req: any = {},
  ) {
    return this.expertAdminService.createExternalDemandRep(
      {
        name: String(body?.name || ''),
        idCard: String(body?.idCard || ''),
        phone: String(body?.phone || ''),
        employer: body?.employer,
        departmentName: body?.departmentName,
        specialty: body?.specialty,
      },
      req.user?.sub,
    );
  }

  @Get('evaluations/stats')
  @ApiOperation({ summary: '专家评价统计（公司隔离）' })
  getEvaluationStats(@Request() req: any = {}) {
    return this.expertAdminService.getEvaluationStats(req.user);
  }

  @Post()
  @Roles('admin') // 方法级收窄（类默认含 bid_host/leader/staff）：专家录入仅 admin（2026-10-15 用户裁定）
  @ApiOperation({ summary: '录入专家（仅 admin）' })
  createExpert(@Body() dto: CreateExpertDto, @Request() req: any) {
    return this.expertAdminService.createExpert(dto, req.user?.sub);
  }

  @Post('extract')
  @ApiOperation({ summary: '专家智能抽取预览（三种模式：specialty_match/random/merit_best；候选池按操作人公司隔离）' })
  previewExtraction(@Body() dto: ExtractPreviewDto, @Request() req: any = {}) {
    return this.extractionService.previewExtraction(dto.projectId, dto, req.user);
  }

  @Post('extract/profiles')
  @ApiOperation({ summary: '批量专家画像（抽取结果重进/恢复场景补拉）：联系方式+库内等级/履职等级/负荷/参评数/偏离度，与抽取候选池同口径' })
  extractionProfiles(@Body() body: { userIds?: string[] }) {
    const userIds = Array.isArray(body?.userIds)
      ? body.userIds.filter((x) => typeof x === 'string' && x.trim()).slice(0, 30)
      : [];
    return this.extractionService.candidateProfiles(userIds);
  }

  @Post('extract/analysis')
  @ApiOperation({ summary: '组队逻辑总结（重进/恢复场景）：AI 按已分配评审组名单总结组队逻辑，替代前端占位句' })
  committeeAnalysis(@Body() body: { projectId?: string }) {
    const projectId = String(body?.projectId || '').trim();
    if (!projectId) throw new BadRequestException({ error: '缺少 projectId', code: 'PROJECT_ID_REQUIRED' });
    return this.extractionService.committeeAnalysis(projectId);
  }

  @Post('extract/confirm')
  @ApiOperation({ summary: '确认专家抽取（建 BidExpert + 写审计日志；复核专家归属公司）' })
  confirmExtraction(@Body() dto: ConfirmExtractionDto, @Request() req: any) {
    return this.extractionService.confirmExtraction(dto.projectId, dto, req.user?.sub, req.user);
  }

  @Patch('extract/leader')
  @ApiOperation({ summary: '设置/切换评审组长（取消旧组长 isLead，设置新组长）' })
  setLeader(@Body() dto: { projectId: string; userId: string }) {
    return this.expertAdminService.setLeader(dto.projectId, dto.userId);
  }

  @Post('extract/ai-leader')
  @ApiOperation({ summary: 'AI 选定评审组长（综合职称/经验/偏离度等推荐）' })
  aiSelectLeader(@Body() dto: { projectId: string }) {
    return this.expertAdminService.aiSelectLeader(dto.projectId);
  }

  @Put('projects/:id/committee/assignment')
  @ApiOperation({ summary: 'A-132: 评委职责分工（分组/主审复核，partial）' })
  setCommitteeAssignment(@Param('id') projectId: string, @Body() dto: CommitteeAssignmentDto, @Request() req: any) {
    return this.expertAdminService.setCommitteeAssignment(projectId, dto, req.user?.sub);
  }

  @Post('extract/notify')
  @ApiOperation({ summary: '抽取确认后发送通知（短信渠道）' })
  sendExtractionNotify(@Body() dto: ExtractionNotifyDto, @Request() req: any = {}) {
    // 请求头透传：RSVP 链接按「当前访问主机」三态生成（域名→expert-ssyc 子域 https、IP:端口→同 IP 换 :3006、localhost→本机 LAN IP）
    const h = (req.headers || {}) as Record<string, string>;
    return this.expertAdminService.sendExtractionNotify(dto.projectId, dto.expertIds, dto.channels, dto.message, {
      origin: h.origin, referer: h.referer, 'x-forwarded-host': h['x-forwarded-host'], 'x-forwarded-proto': h['x-forwarded-proto'],
    });
  }

  @Post('projects/:projectId/rsvp-links')
  @ApiOperation({ summary: '预生成 RSVP 确认链接（进入通知页时调用，写入通知模板）；body.force=强制换发（未回复行换新 token）' })
  prersvpLinks(@Param('projectId') projectId: string, @Request() req: any = {}, @Body() dto: { force?: boolean } = {}) {
    const h = (req.headers || {}) as Record<string, string>;
    return this.expertAdminService.prersvpLinks(projectId, {
      origin: h.origin, referer: h.referer, 'x-forwarded-host': h['x-forwarded-host'], 'x-forwarded-proto': h['x-forwarded-proto'],
    }, dto.force === true);
  }

  @Post('extract/analyze-project')
  @ApiOperation({ summary: '已有项目 AI 推断专业配额（仅分析项目不实际抽取，用于预填配额）' })
  analyzeProject(@Body() dto: AnalyzeProjectDto) {
    return this.expertAdminService.analyzeProjectSpecialties(dto.projectId);
  }

  @Post('extract/analyze-files')
  @ApiOperation({ summary: '自定义抽取：分析已上传文件，AI 从项目背景推断所需专业/人数' })
  analyzeExtractionFiles(@Body() dto: AnalyzeExtractionFilesDto, @Request() req: any) {
    return this.expertAdminService.analyzeExtractionFiles(dto.fileIds, req.user?.sub);
  }

  @Post('extract/custom-project')
  @ApiOperation({ summary: '自定义抽取：创建影子项目（仅承载抽取/通知/确认，不进项目管理列表）' })
  createCustomProject(@Body() dto: CreateCustomProjectDto, @Request() req: any) {
    return this.expertAdminService.createCustomExtractionProject(dto, req.user?.sub);
  }

  @Get('extract/history')
  @ApiOperation({ summary: '抽取历史记录（从审计日志查询）' })
  getExtractionHistory(
    @Query('projectId') projectId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.expertAdminService.getExtractionHistory(
      projectId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Get('extract/retrospect')
  @ApiOperation({ summary: '抽取质量复盘（专家组构成 vs 履职表现，LLM 总结）' })
  retrospectExtraction(@Query('projectId') projectId: string) {
    return this.expertAdminService.retrospectExtraction(projectId);
  }

  @Get('invitations/:projectId')
  @ApiOperation({ summary: '查询项目专家邀请状态（正选+候补）' })
  getProjectInvitations(@Param('projectId') projectId: string) {
    return this.expertAdminService.getProjectInvitations(projectId);
  }

  @Get('projects/:projectId/extraction-export')
  @ApiOperation({ summary: '导出专家抽取情况（Word：抽取方式细节 + 正选/候补专家详情表证明材料）' })
  async extractionExport(@Param('projectId') projectId: string, @Res({ passthrough: true }) res: any) {
    const { buffer, filename } = await this.expertAdminService.buildExtractionExport(projectId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return new StreamableFile(buffer);
  }

  @Post('invitations/:projectId/:userId/proxy-mark')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: '工作人员代回应/代变更专家邀请（理由必填；确认→婉拒联动通知本人并触发递补）' })
  proxyMarkInvitation(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body() body: { status?: 'confirmed' | 'declined'; reason?: string },
    @CurrentUser('sub') actorId?: string,
  ) {
    if (!body?.status || !['confirmed', 'declined'].includes(body.status)) {
      throw new BadRequestException({ error: 'status 仅支持 confirmed/declined', code: 'BAD_INPUT' });
    }
    if (!actorId) throw new BadRequestException({ error: '缺少操作人身份', code: 'BAD_INPUT' });
    return this.expertAdminService.proxyMarkInvitation({
      projectId, userId, status: body.status, actorId, reason: body.reason ?? '',
    });
  }

  @Get('retire-candidates')
  @ApiOperation({ summary: '专家退库候选扫描（预警，不自动停用；公司隔离）' })
  reviewRetirementCandidates(@Request() req: any = {}) {
    return this.expertAdminService.reviewRetirementCandidates(req.user);
  }

  @Get('statistics')
  @ApiOperation({ summary: '专家库整体态势统计（公司隔离）' })
  getStatistics(@Query('companyId') companyId?: string, @Request() req: any = {}) {
    return this.expertAdminService.getStatistics(req.user, companyId);
  }

  @Get('ranking')
  @ApiOperation({ summary: '专家排名（按履职评价均分；公司隔离）' })
  getRanking(@Query('period') period?: 'month' | 'quarter' | 'all', @Query('companyId') companyId?: string, @Request() req: any = {}) {
    return this.expertAdminService.getRanking(period, req.user, companyId);
  }

  @Get('load-distribution')
  @ApiOperation({ summary: '专家负荷分布（按活跃评审项目数；公司隔离）' })
  getLoadDistribution(@Query('companyId') companyId?: string, @Request() req: any = {}) {
    return this.expertAdminService.getLoadDistribution(req.user, companyId);
  }

  @Get('ai-adoption')
  @ApiOperation({ summary: 'AI 采纳率（专家分 vs AI 建议分；公司隔离）' })
  getAiAdoptionRate(@Query('expertId') expertId?: string, @Request() req: any = {}) {
    return this.expertAdminService.getAiAdoptionRate(expertId, req.user);
  }

  @Get('violations')
  @ApiOperation({ summary: '违规记录列表（公司隔离）' })
  getViolations(@Query('expertId') expertId?: string, @Request() req: any = {}) {
    return this.expertAdminService.getViolations(expertId, req.user);
  }

  @Get('export')
  @ApiOperation({ summary: '导出专家库（扁平结构；公司隔离——只导出可见专家）' })
  exportExperts(@Query('ids') ids?: string, @Request() req: any = {}) {
    return this.expertAdminService.exportExperts(ids ? ids.split(',').filter(Boolean) : undefined, req.user);
  }

  @Get('operation-history')
  @ApiOperation({ summary: '专家管理操作历史（审计，只读：入库/评价/停用/暂停/退库等，附操作人/时间/事由）' })
  getOperationHistory(
    @Query('expertId') expertId?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.expertAdminService.getExpertOperationHistory({
      expertId,
      action,
      startDate,
      endDate,
      ...(search?.trim() ? { search: search.trim() } : {}),
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  /** 一键清空专家库名单（2026-11-09 用户裁定）——强保险：admin only + 生产禁用 +
   *  确认词「清空」 + 开评标中挡闸 + 审计留痕；评审记录（BidExpert/评分/抽取）保留 */
  @Post('clear-expert-roster')
  @Roles('admin')
  @ApiOperation({ summary: '一键清空专家库名单（仅名单与随账号档案；评审记录保留；生产禁用）' })
  clearExpertRoster(@Body() body: { confirm?: string }, @Request() req: any = {}) {
    return this.expertAdminService.clearExpertRoster(req.user?.sub, body?.confirm ?? '');
  }

  @Post('batch')
  @ApiOperation({ summary: '批量启用/停用专家（公司隔离）' })
  batchOperation(@Body() dto: BatchOperationDto, @Request() req: any) {
    return this.expertAdminService.batchOperation(dto, req.user?.sub, req.user);
  }

  @Post('import-csv')
  @Roles('admin') // 录入通道随「录入专家」一并收窄 admin（CSV 导入在录入弹窗内）
  @ApiOperation({ summary: 'CSV 批量导入专家（仅 admin；按表格工作单位归属、导入后待审核）' })
  importCsv(@Body() dto: ImportCsvDto, @Request() req: any) {
    return this.expertAdminService.importCsv(dto.rows, req.user?.sub);
  }

  @Post('import-batch-approve')
  @Roles('admin') // 与 CSV 导入同权（2026-11-09 用户裁定：导入后一键启用）
  @ApiOperation({ summary: 'CSV 导入后一键启用：批量审核入库本次导入专家（只动 PENDING 行，幂等）' })
  importBatchApprove(@Body() dto: ImportBatchApproveDto, @Request() req: any) {
    return this.expertAdminService.importBatchApprove(dto.ids, req.user?.sub);
  }

  @Get('projects/:projectId/memos')
  @ApiOperation({ summary: '管理端：查看项目专家备忘/批注（只读，按 expert/supplier/scoreItem 过滤）' })
  listProjectMemos(
    @Param('projectId') projectId: string,
    @Query('expertId') expertId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('scoreItemId') scoreItemId?: string,
  ) {
    return this.memoService.getMemosForAdmin(projectId, { expertId, supplierId, scoreItemId });
  }

  @Get('projects/:projectId/memos/:memoId/ink')
  @ApiOperation({ summary: '管理端：获取专家笔迹原图预签名 URL' })
  getProjectMemoInkUrl(
    @Param('projectId') projectId: string,
    @Param('memoId') memoId: string,
  ) {
    return this.memoService.getInkUrlForAdmin(projectId, memoId);
  }

  // ── 动态 :id 路由 ──

  @Get(':id')
  @ApiOperation({ summary: '专家详情（公司隔离：他人公司专家 → 403）' })
  getExpert(@Param('id') id: string, @Request() req: any = {}) {
    return this.expertAdminService.getExpert(id, req.user);
  }

  @Post(':id/reveal')
  @Roles('admin', 'leader', 'staff') // 方法级收窄（类默认含 bid_host）：密评最小授权，明文揭示仅工作台角色
  @ApiOperation({ summary: '专家 PII 明文揭示（默认掩码，明文走此处；SensitiveAccessLog 留痕）' })
  revealField(@Param('id') id: string, @Body() dto: RevealExpertFieldDto, @Request() req: any) {
    return this.expertAdminService.revealExpertField(id, dto.field, req.user, req.ip);
  }

  @Patch(':id/availability')
  @ApiOperation({ summary: '启用/停用专家（公司隔离）' })
  setAvailability(@Param('id') id: string, @Body() dto: SetAvailabilityDto, @Request() req: any) {
    return this.expertAdminService.setAvailability(id, dto.available, req.user?.sub, req.user);
  }

  @Patch(':id/profile')
  @ApiOperation({ summary: '更新专家资料（公司隔离）' })
  updateProfile(@Param('id') id: string, @Body() dto: UpdateExpertProfileDto, @Request() req: any) {
    return this.expertAdminService.updateProfile(id, dto, req.user?.sub, req.user);
  }

  @Get(':id/portrait')
  @ApiOperation({ summary: '专家画像（公司隔离）' })
  getPortrait(@Param('id') id: string, @Request() req: any = {}) {
    return this.expertAdminService.getExpertPortrait(id, req.user);
  }

  @Get(':id/risk-brief')
  @ApiOperation({ summary: '评标风险预警简报（偏离度+履职+违规，LLM 增强；公司隔离）' })
  getRiskBrief(@Param('id') id: string, @Request() req: any = {}) {
    return this.expertAdminService.getRiskBrief(id, req.user);
  }

  @Get(':id/evaluations')
  @ApiOperation({ summary: '专家履职评价历史（公司隔离）' })
  getExpertEvaluations(@Param('id') id: string, @Request() req: any = {}) {
    return this.expertAdminService.getExpertEvaluations(id, req.user);
  }

  @Get(':id/evaluation-projects')
  @ApiOperation({ summary: '专家真实参评项目列表（BidExpert 分配 + 评标结果有无；公司隔离）' })
  listEvaluationProjects(@Param('id') id: string, @Request() req: any = {}) {
    return this.expertAdminService.listEvaluationProjects(id, req.user);
  }

  @Get(':id/evaluation-projects/:projectId')
  @ApiOperation({ summary: '关联项目评标结果与该专家评分对照（履职评价弹窗窗口数据；公司隔离）' })
  getEvaluationProjectDetail(@Param('id') id: string, @Param('projectId') projectId: string, @Request() req: any = {}) {
    return this.expertAdminService.getEvaluationProjectDetail(id, projectId, req.user);
  }

  @Post(':id/behavior-analysis/:projectId')
  @ApiOperation({ summary: 'AI 专家行为分析（该项目打分偏离/极值/修改/合规 + 历史履职；LLM+规则兜底；公司隔离）' })
  analyzeExpertBehavior(@Param('id') id: string, @Param('projectId') projectId: string, @Request() req: any = {}) {
    return this.expertAdminService.analyzeExpertBehavior(id, projectId, req.user);
  }

  @Post(':id/violation')
  @ApiOperation({ summary: '记录专家违规（公司隔离）' })
  recordViolation(@Param('id') id: string, @Body() dto: RecordViolationDto, @Request() req: any) {
    return this.expertAdminService.recordViolation(id, dto, req.user?.sub, req.user);
  }

  @Get(':id/notify-history')
  @ApiOperation({ summary: '专家通知发送历史（最近 50 条；公司隔离）' })
  getNotifyHistory(@Param('id') id: string, @Request() req: any = {}) {
    return this.expertAdminService.getNotifyHistory(id, req.user);
  }

  @Get(':id/notify-prefs')
  @ApiOperation({ summary: '专家通知偏好（公司隔离）' })
  getNotifyPrefs(@Param('id') id: string, @Request() req: any = {}) {
    return this.expertAdminService.getNotifyPrefs(id, req.user);
  }

  @Patch(':id/notify-prefs')
  @ApiOperation({ summary: '更新专家通知偏好（公司隔离）' })
  updateNotifyPrefs(@Param('id') id: string, @Body() dto: NotifyPrefsDto, @Request() req: any = {}) {
    return this.expertAdminService.updateNotifyPrefs(id, dto, req.user);
  }

  @Post(':id/retire-ignore')
  @ApiOperation({ summary: '忽略本轮退库预警（90 天内跳过此专家的扫描；公司隔离）' })
  ignoreRetirement(@Param('id') id: string, @Request() req: any) {
    return this.expertAdminService.ignoreRetirementWarning(id, req.user?.sub, req.user);
  }

  @Post(':id/retire')
  @Roles('admin', 'leader') // R6-7 B7：与 @Patch(:id/status) 同权限面（此前无角色限，staff/bid_host 可退库）
  @ApiOperation({ summary: '人工确认专家退库（公司隔离）' })
  confirmRetire(@Param('id') id: string, @Body() dto: ConfirmRetireDto, @Request() req: any) {
    return this.expertAdminService.confirmRetire(id, dto.reason, req.user?.sub, req.user);
  }

  @Patch(':id/status')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: 'CTS A-218/222 专家库状态：待审核/在库/暂停/退库（审核留痕 verifiedBy/At）' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateExpertStatusDto, @Request() req: any) {
    return this.expertAdminService.updateProfileStatus(id, dto, req.user);
  }

  @Post('projects/:projectId/experts/:expertId/unconfirm-report')
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '撤销专家报告确认（允许专家修改评分后重新确认）' })
  unconfirmReport(
    @Param('projectId') projectId: string,
    @Param('expertId') expertId: string,
    @Body() dto: { reason: string },
    @Request() req: any,
  ) {
    return this.expertAdminService.unconfirmReport(projectId, expertId, dto.reason, req.user?.sub);
  }

  @Post('import-from-seed')
  @Roles('admin') // 录入通道随「录入专家」一并收窄 admin
  @ApiOperation({ summary: '从种子数据批量导入专家（仅 admin；跳过已存在的；归操作人公司）' })
  importFromSeed(@Request() req: any = {}) {
    return this.expertAdminService.importFromSeed(req.user?.sub);
  }

  @Post('ai-evaluations/refresh')
  @Roles('admin') // AI 综合评价批量生成（2026-11-04）：Scheduler 每月 1 日自动跑，此端点供上线/补跑
  @ApiOperation({ summary: '全量刷新专家 AI 综合评价（仅 admin；无履职数据的专家跳过）' })
  refreshAiEvaluations() {
    return this.expertAdminService.refreshAiEvaluations();
  }

  @Post('ocr-intake')
  @Roles('admin') // 录入辅助随「录入专家」收窄 admin（OCR 仅在录入弹窗内使用）
  @ApiOperation({ summary: '资质 OCR 自动录入（仅 admin；识别证件图片 → 结构化字段回填）' })
  ocrIntake(@Body() dto: OcrIntakeDto) {
    return this.expertAdminService.ocrIntake(dto.imageBase64, dto.mimeType, dto.filename);
  }

  @Post('evaluations/ai-suggest')
  @ApiOperation({ summary: 'AI 辅助评价建议（LLM 综合历史评价/偏离度/违规/负荷给出建议分数；公司隔离）' })
  aiSuggestEvaluation(@Body() dto: AiSuggestEvaluationDto, @Request() req: any = {}) {
    return this.expertAdminService.aiSuggestEvaluation(dto.expertUserId, req.user);
  }

  @Post('evaluations')
  @ApiOperation({ summary: '发起专家履职评价（公司隔离）' })
  createEvaluation(@Body() dto: CreateExpertEvaluationDto, @Request() req: any) {
    return this.expertAdminService.createEvaluation(req.user.sub, dto, req.user);
  }
}
