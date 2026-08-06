import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ExpertAdminService } from './expert-admin.service';
import { CreateExpertDto } from './dto/create-expert.dto';
import { ExtractPreviewDto } from './dto/extract-preview.dto';
import { ConfirmExtractionDto } from './dto/confirm-extraction.dto';
import { ExtractionNotifyDto } from './dto/extraction-notify.dto';
import { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';
import { SetAvailabilityDto, ConfirmRetireDto } from './dto/expert-status.dto';
import {
  UpdateExpertProfileDto,
  GenerateNotificationDto,
  BatchOperationDto,
  ImportCsvDto,
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
  constructor(private expertAdminService: ExpertAdminService) {}

  @Public()
  @Get('bigscreen-stats')
  @ApiOperation({ summary: '大屏专家库聚合统计（公开，无需登录）' })
  getBigscreenStats() {
    return this.expertAdminService.getBigscreenStats();
  }

  @Get()
  @ApiOperation({ summary: '专家库列表' })
  listExperts(@Query('search') search?: string, @Query('specialty') specialty?: string) {
    return this.expertAdminService.listExperts(search, specialty);
  }

  @Get('specialties')
  @ApiOperation({ summary: '专家专业列表（去重）' })
  listSpecialties() {
    return this.expertAdminService.listSpecialties();
  }

  @Get('evaluations/stats')
  @ApiOperation({ summary: '专家评价统计' })
  getEvaluationStats() {
    return this.expertAdminService.getEvaluationStats();
  }

  @Get('evaluations/dimensions')
  @ApiOperation({ summary: '三维评分分布（出勤/质量/廉洁全局均分）' })
  getEvaluationDimensionStats() {
    return this.expertAdminService.getEvaluationDimensionStats();
  }

  @Post()
  @ApiOperation({ summary: '录入专家' })
  createExpert(@Body() dto: CreateExpertDto) {
    return this.expertAdminService.createExpert(dto);
  }

  @Post('extract')
  @ApiOperation({ summary: '专家智能抽取预览（三种模式：specialty_match/random/merit_best）' })
  previewExtraction(@Body() dto: ExtractPreviewDto) {
    return this.expertAdminService.previewExtraction(dto.projectId, dto);
  }

  @Post('notification/generate')
  @ApiOperation({ summary: 'AI 生成单专家个性化通知内容（DeepSeek）' })
  generateNotification(@Body() dto: GenerateNotificationDto) {
    return this.expertAdminService.generateNotificationAi(dto);
  }

  @Post('extract/confirm')
  @ApiOperation({ summary: '确认专家抽取（建 BidExpert + 写审计日志）' })
  confirmExtraction(@Body() dto: ConfirmExtractionDto, @Request() req: any) {
    return this.expertAdminService.confirmExtraction(dto.projectId, dto, req.user?.sub);
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

  @Post('extract/notify')
  @ApiOperation({ summary: '抽取确认后发送通知（OA/短信/电话多渠道）' })
  sendExtractionNotify(@Body() dto: ExtractionNotifyDto) {
    return this.expertAdminService.sendExtractionNotify(dto.projectId, dto.expertIds, dto.channels, dto.message);
  }

  @Post('projects/:projectId/rsvp-links')
  @ApiOperation({ summary: '预生成 RSVP 确认链接（进入通知页时调用，写入通知模板）' })
  prersvpLinks(@Param('projectId') projectId: string) {
    return this.expertAdminService.prersvpLinks(projectId);
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

  @Post('invitations/:projectId/:userId/confirm')
  @ApiOperation({ summary: '标记专家已确认参与评审邀请' })
  confirmInvitation(@Param('projectId') projectId: string, @Param('userId') userId: string) {
    return this.expertAdminService.confirmInvitation(projectId, userId);
  }

  @Post('invitations/:projectId/:userId/decline')
  @ApiOperation({ summary: '标记专家已拒绝参与评审邀请' })
  declineInvitation(@Param('projectId') projectId: string, @Param('userId') userId: string) {
    return this.expertAdminService.declineInvitation(projectId, userId);
  }

  @Get('retire-candidates')
  @ApiOperation({ summary: '专家退库候选扫描（预警，不自动停用）' })
  reviewRetirementCandidates() {
    return this.expertAdminService.reviewRetirementCandidates();
  }

  @Get('statistics')
  @ApiOperation({ summary: '专家库整体态势统计' })
  getStatistics() {
    return this.expertAdminService.getStatistics();
  }

  @Get('ranking')
  @ApiOperation({ summary: '专家排名（按履职评价均分）' })
  getRanking(@Query('period') period?: 'month' | 'quarter' | 'all') {
    return this.expertAdminService.getRanking(period);
  }

  @Get('load-distribution')
  @ApiOperation({ summary: '专家负荷分布（按活跃评审项目数）' })
  getLoadDistribution() {
    return this.expertAdminService.getLoadDistribution();
  }

  @Get('ai-adoption')
  @ApiOperation({ summary: 'AI 采纳率（专家分 vs AI 建议分）' })
  getAiAdoptionRate(@Query('expertId') expertId?: string) {
    return this.expertAdminService.getAiAdoptionRate(expertId);
  }

  @Get('violations')
  @ApiOperation({ summary: '违规记录列表' })
  getViolations(@Query('expertId') expertId?: string) {
    return this.expertAdminService.getViolations(expertId);
  }

  @Get('export')
  @ApiOperation({ summary: '导出专家库（扁平结构）' })
  exportExperts(@Query('ids') ids?: string) {
    return this.expertAdminService.exportExperts(ids ? ids.split(',').filter(Boolean) : undefined);
  }

  @Post('batch')
  @ApiOperation({ summary: '批量启用/停用专家' })
  batchOperation(@Body() dto: BatchOperationDto) {
    return this.expertAdminService.batchOperation(dto);
  }

  @Post('import-csv')
  @ApiOperation({ summary: 'CSV 批量导入专家' })
  importCsv(@Body() dto: ImportCsvDto) {
    return this.expertAdminService.importCsv(dto.rows);
  }

  // ── 动态 :id 路由 ──

  @Get(':id')
  @ApiOperation({ summary: '专家详情' })
  getExpert(@Param('id') id: string) {
    return this.expertAdminService.getExpert(id);
  }

  @Patch(':id/availability')
  @ApiOperation({ summary: '启用/停用专家' })
  setAvailability(@Param('id') id: string, @Body() dto: SetAvailabilityDto) {
    return this.expertAdminService.setAvailability(id, dto.available);
  }

  @Patch(':id/profile')
  @ApiOperation({ summary: '更新专家资料' })
  updateProfile(@Param('id') id: string, @Body() dto: UpdateExpertProfileDto) {
    return this.expertAdminService.updateProfile(id, dto);
  }

  @Get(':id/portrait')
  @ApiOperation({ summary: '专家画像' })
  getPortrait(@Param('id') id: string) {
    return this.expertAdminService.getExpertPortrait(id);
  }

  @Get(':id/risk-brief')
  @ApiOperation({ summary: '评标风险预警简报（偏离度+履职+违规，LLM 增强）' })
  getRiskBrief(@Param('id') id: string) {
    return this.expertAdminService.getRiskBrief(id);
  }

  @Get(':id/evaluations')
  @ApiOperation({ summary: '专家履职评价历史' })
  getExpertEvaluations(@Param('id') id: string) {
    return this.expertAdminService.getExpertEvaluations(id);
  }

  @Post(':id/violation')
  @ApiOperation({ summary: '记录专家违规' })
  recordViolation(@Param('id') id: string, @Body() dto: RecordViolationDto, @Request() req: any) {
    return this.expertAdminService.recordViolation(id, dto, req.user?.sub);
  }

  @Get(':id/notify-prefs')
  @ApiOperation({ summary: '专家通知偏好' })
  getNotifyPrefs(@Param('id') id: string) {
    return this.expertAdminService.getNotifyPrefs(id);
  }

  @Patch(':id/notify-prefs')
  @ApiOperation({ summary: '更新专家通知偏好' })
  updateNotifyPrefs(@Param('id') id: string, @Body() dto: NotifyPrefsDto) {
    return this.expertAdminService.updateNotifyPrefs(id, dto);
  }

  @Post(':id/retire')
  @ApiOperation({ summary: '人工确认专家退库' })
  confirmRetire(@Param('id') id: string, @Body() dto: ConfirmRetireDto) {
    return this.expertAdminService.confirmRetire(id, dto.reason);
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
  @ApiOperation({ summary: '从种子数据批量导入专家（跳过已存在的）' })
  importFromSeed() {
    return this.expertAdminService.importFromSeed();
  }

  @Post('ocr-intake')
  @ApiOperation({ summary: '资质 OCR 自动录入（识别证件图片 → 结构化字段回填）' })
  ocrIntake(@Body() dto: OcrIntakeDto) {
    return this.expertAdminService.ocrIntake(dto.imageBase64, dto.mimeType, dto.filename);
  }

  @Post('evaluations/ai-suggest')
  @ApiOperation({ summary: 'AI 辅助评价建议（LLM 综合历史评价/偏离度/违规/负荷给出建议分数）' })
  aiSuggestEvaluation(@Body() dto: AiSuggestEvaluationDto) {
    return this.expertAdminService.aiSuggestEvaluation(dto.expertUserId);
  }

  @Post('evaluations')
  @ApiOperation({ summary: '发起专家履职评价' })
  createEvaluation(@Body() dto: CreateExpertEvaluationDto, @Request() req: any) {
    return this.expertAdminService.createEvaluation(req.user.sub, dto);
  }
}
