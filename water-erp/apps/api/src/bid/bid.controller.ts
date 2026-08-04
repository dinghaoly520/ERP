import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiCookieAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { BidService } from './bid.service';
import { verifyKmsHealth } from '../common/crypto/envelope-crypto';
import { ScorePointExtractorService } from './score-point-extractor.service';
import { BidBackupService } from '../bid-backup/bid-backup.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';
import { ReplyClarificationDto } from './dto/reply-clarification.dto';
import { StartOpeningDto } from './dto/start-opening.dto';
import { ArchiveAllDto } from './dto/archive-all.dto';
import { DecryptSupplierDto } from './dto/decrypt-supplier.dto';
import { CreateScoreItemDto } from './dto/create-score-item.dto';
import { UpdateScoreItemDto } from './dto/update-score-item.dto';
import { CreateScorePointDto } from './dto/create-score-point.dto';
import { UpdateScorePointDto } from './dto/update-score-point.dto';
import { BatchCreateScorePointsDto } from './dto/batch-create-score-points.dto';
import { CreateOpeningRecordDto } from './dto/create-opening-record.dto';
import { ResolveOpeningDisputeDto } from './dto/resolve-opening-dispute.dto';
import { ResolveExpertDisputeDto } from './dto/resolve-expert-dispute.dto';
import { UpsertSupervisionAnnotationDto } from './dto/upsert-supervision-annotation.dto';

@ApiTags('开评标管理')
@ApiCookieAuth('token')
@Controller('bid')
@Roles('admin', 'bid_host', 'leader', 'staff')
export class BidController {
  constructor(
    private readonly bidService: BidService,
    private readonly scorePointExtractor: ScorePointExtractorService,
    private readonly bidBackup: BidBackupService,
  ) {}

  @Get('dashboard-stats')
  @ApiOperation({ summary: '驾驶舱统计' })
  getDashboardStats() { return this.bidService.getDashboardStats(); }

  @Get('crypto-health')
  @ApiOperation({ summary: 'KMS 加密封装健康检查' })
  cryptoHealth() { return verifyKmsHealth(process.env.KMS_SECRET!); }

  @Get('projects')
  @ApiOperation({ summary: '项目列表（可选阶段过滤）' })
  listProjects(@Query('stage') stage?: string | string[]) {
    const stages = stage
      ? (Array.isArray(stage) ? stage : [stage])
      : undefined;
    return this.bidService.listProjects(stages);
  }

  @Get('projects/dashboard')
  @ApiOperation({ summary: 'Dashboard 聚合：项目列表 + 就绪状态 + 阶段分布' })
  getProjectsDashboard() { return this.bidService.getProjectsDashboard(); }

  @Get('projects/:id/ai-adoption')
  @ApiOperation({ summary: 'P1-E：项目级 AI 建议采纳率（专家 vs AI 评分 delta）' })
  getAiAdoption(@Param('id') id: string) { return this.bidService.getAiAdoption(id); }

  @Get('projects/archive-summary')
  @ApiOperation({ summary: '归档项目汇总（单次聚合，避免 N+1）' })
  getArchiveSummary() { return this.bidService.getArchiveSummary(); }

  @Post('projects')
  @ApiOperation({ summary: '创建项目' })
  createProject(@Body() dto: CreateBidProjectDto) { return this.bidService.createProject(dto); }

  @Get('projects/:id')
  @ApiOperation({ summary: '项目详情' })
  getProject(@Param('id') id: string) { return this.bidService.getProject(id); }

  @Get('projects/:id/publicity-status')
  @ApiOperation({ summary: 'A1: 公示状态（公示截止时间 + 是否可发中标通知书）' })
  getPublicityStatus(@Param('id') id: string) { return this.bidService.getPublicityStatus(id); }

  @Get('projects/:id/award-letter/status')
  @ApiOperation({ summary: 'A3: 中标通知书签收状态' })
  getAwardLetterStatus(@Param('id') id: string) { return this.bidService.getAwardLetterStatus(id); }

  @Post('projects/:id/award-letter/deliver')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: 'A3: 推送中标通知书给中标供应商' })
  deliverAwardLetter(
    @Param('id') id: string,
    @Body() dto: { winnerName: string; winnerSupplierId?: string; content?: Record<string, unknown>; letterAssetId?: string },
    @CurrentUser('sub') userId?: string,
  ) { return this.bidService.deliverAwardLetter(id, dto, userId); }

  @Get('projects/:id/workspace')
  @ApiOperation({ summary: '项目工作台（供应商/标书/专家组聚合，开标准备判断）' })
  getWorkspace(@Param('id') id: string) { return this.bidService.getWorkspace(id); }

  @Patch('projects/:id/price-config')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: 'P1: 设置最高限价 + 价格分公式配置 + 评标办法' })
  updatePriceConfig(
    @Param('id') id: string,
    @Body() dto: { ceilingPrice?: number; evaluationMethod?: string; priceFormulaConfig?: Record<string, unknown> },
    @CurrentUser('sub') userId?: string,
  ) { return this.bidService.updatePriceConfig(id, dto, userId); }

  // ── P2c: 多轮报价管理 ──
  @Get('projects/:id/rounds')
  @ApiOperation({ summary: '查询报价轮次列表' })
  listRounds(@Param('id') id: string) { return this.bidService.listRounds(id); }

  @Post('projects/:id/rounds')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '创建报价轮次' })
  createRound(@Param('id') id: string, @Body() dto: { roundType: string; deadline?: string }, @CurrentUser('sub') userId?: string) {
    return this.bidService.createRound(id, dto.roundType, dto.deadline, userId);
  }

  @Post('projects/:id/rounds/:roundId/seal')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '截止报价(密封)' })
  sealRound(@Param('id') id: string, @Param('roundId') roundId: string, @CurrentUser('sub') userId?: string) {
    return this.bidService.sealRound(id, roundId, userId);
  }

  @Post('projects/:id/rounds/:roundId/publish')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '公布报价(开标)' })
  publishRound(@Param('id') id: string, @Param('roundId') roundId: string, @CurrentUser('sub') userId?: string) {
    return this.bidService.publishRound(id, roundId, userId);
  }

  @Post('projects/:id/rounds/:roundId/close')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '结束轮次(进入下一轮或评标)' })
  closeRound(@Param('id') id: string, @Param('roundId') roundId: string, @Body() dto: { proceedToEvaluation?: boolean }, @CurrentUser('sub') userId?: string) {
    return this.bidService.closeRound(id, roundId, dto.proceedToEvaluation ?? false, userId);
  }

  @Get('projects/:id/rounds/:roundId/quotes')
  @ApiOperation({ summary: '查询轮次报价' })
  getRoundQuotes(@Param('id') id: string, @Param('roundId') roundId: string, @CurrentUser('sub') userId?: string) {
    return this.bidService.getRoundQuotes(id, roundId, 'staff');
  }

  @Patch('projects/:id')
  @ApiOperation({ summary: '更新项目' })
  updateProject(@Param('id') id: string, @Body() dto: UpdateBidProjectDto) { return this.bidService.updateProject(id, dto); }

  @Get('projects/:id/suppliers')
  @ApiOperation({ summary: '投标供应商列表' })
  listSuppliers(@Param('id') id: string) { return this.bidService.listSuppliers(id); }

  @Post('projects/:id/suppliers')
  @ApiOperation({ summary: '邀请供应商加入名册（仅发标/投标期，邀请招标用）' })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  inviteSuppliers(
    @Param('id') id: string,
    @Body() dto: { supplierIds?: string[] },
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.inviteSuppliers(id, dto?.supplierIds ?? [], userId); }

  @Post('projects/:id/open-submission')
  @ApiOperation({ summary: '开放投递 (DOWNLOAD→SUBMIT)' })
  openSubmission(@Param('id') id: string, @CurrentUser('sub') userId: string) { return this.bidService.openSubmission(id, userId); }

  @Post('projects/:id/open')
  @ApiOperation({ summary: '启动开标' })
  startOpening(@Param('id') id: string, @Body() dto?: StartOpeningDto, @CurrentUser('sub') userId?: string) { return this.bidService.startOpening(id, dto, userId); }

  @Post('projects/:id/abort')
  @ApiOperation({ summary: '流标（SUBMIT/OPENING→ABORTED）' })
  abortBidProject(@Param('id') id: string, @CurrentUser('sub') userId?: string, @Body() body?: { reason?: string }) { return this.bidService.abortBidProject(id, userId, body?.reason); }

  @Post('projects/:id/disputes/:disputeId/resolve')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: 'D2: 采购端裁决专家异议工单' })
  resolveExpertDispute(@Param('id') id: string, @Param('disputeId') disputeId: string, @Body() dto: ResolveExpertDisputeDto, @CurrentUser('sub') userId?: string) {
    return this.bidService.resolveExpertDispute(id, disputeId, dto, userId);
  }

  @Post('projects/:id/invalidate-bid/:supplierId')
  @Roles('admin', 'bid_host', 'leader')
  @ApiOperation({ summary: 'B1: 手动标记废标(围标/串标/资质造假)' })
  manualMarkInvalidBid(@Param('id') id: string, @Param('supplierId') supplierId: string, @Body() dto: { reason: string }, @CurrentUser('sub') userId?: string) {
    return this.bidService.manualMarkInvalidBid(id, supplierId, dto.reason, userId);
  }

  @Post('projects/:id/reopen')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '从流标项目重启（创建新项目，复制基础信息，递增轮次）' })
  reopenBidProject(@Param('id') id: string, @CurrentUser('sub') userId?: string) { return this.bidService.reopenFromAborted(id, userId); }

  @Post('projects/:id/pause')
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '暂停开标（冻结解密窗口，拒绝解密操作）' })
  pauseOpening(@Param('id') id: string, @CurrentUser('sub') userId?: string, @Body() body?: { reason?: string }) { return this.bidService.pauseOpening(id, userId, body?.reason); }

  @Post('projects/:id/resume')
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '恢复开标（解冻窗口，补偿暂停时长）' })
  resumeOpening(@Param('id') id: string, @CurrentUser('sub') userId?: string) { return this.bidService.resumeOpening(id, userId); }

  @Post('projects/:id/start-evaluation')
  @ApiOperation({ summary: '启动评标 (OPENING→EVALUATING)' })
  startEvaluation(@Param('id') id: string, @CurrentUser('sub') userId: string) { return this.bidService.startEvaluation(id, userId); }

  @Post('projects/:id/complete-opening')
  @ApiOperation({ summary: '完成开标·资料移交（生成开标文件包回传 :3005；幂等，不改 stage）' })
  completeOpening(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.bidService.completeOpening(id, userId);
  }

  @Post('projects/:id/decrypt-all')
  @ApiOperation({ summary: '一键解密窗口内待解密供应商（4.4）' })
  @Throttle({ default: { ttl: 60000, limit: 2 } })
  decryptAll(@Param('id') id: string, @CurrentUser('sub') userId: string) { return this.bidService.decryptAllSuppliers(id, userId); }

  @Post('projects/:id/rerun-ai-analysis')
  @ApiOperation({ summary: '重新触发 AI 辅助分析（B8/15.5）——清除旧结果并重新入队' })
  rerunAiAnalysis(@Param('id') id: string, @CurrentUser('sub') userId: string) { return this.bidService.rerunAiAnalysis(id, userId); }

  @Post('projects/:id/suppliers/:supplierId/invalid-bid/revoke')
  @ApiOperation({ summary: '废标复核撤销（reportConfirmed 前可逆）' })
  revokeInvalidBid(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @Body() body: { scoreItemId: string },
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.revokeInvalidBid(id, supplierId, body.scoreItemId, userId); }

  @Post('projects/:id/suppliers/:supplierId/manual-invalid-bid/revoke')
  @ApiOperation({ summary: 'B1: 撤销手动废标（恢复供应商有效状态，reportConfirmed 前可逆）' })
  revokeManualInvalidBid(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.revokeManualInvalidBid(id, supplierId, userId); }

  @Post('projects/:id/nudge-suppliers')
  @ApiOperation({ summary: '催促供应商投标（站内信+Email 多通道）' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  nudgeSuppliers(
    @Param('id') id: string,
    @Body() dto: { onlyUnsubmitted?: boolean },
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.nudgeSuppliers(id, dto?.onlyUnsubmitted ?? true, userId); }

  @Post('projects/:id/nudge-experts')
  @ApiOperation({ summary: '催促专家签到/评分（站内信+Email 多通道）' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  nudgeExperts(
    @Param('id') id: string,
    @Body() dto: { reason?: 'signin' | 'score' },
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.nudgeExperts(id, dto?.reason ?? 'signin', userId); }

  @Post('projects/:id/notify-schedule-change')
  @ApiOperation({ summary: '通知开标时间变更（向投标供应商 + 评标专家）' })
  notifyScheduleChange(
    @Param('id') id: string,
    @Body() dto: { openTime: string },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.bidService.notifyScheduleChange(id, dto.openTime, userId);
  }

  @Post('projects/:id/decrypt/:supplierId')
  @ApiOperation({ summary: '解密供应商投标' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  decryptSupplier(@Param('id') id: string, @Param('supplierId') supplierId: string, @Body() dto?: DecryptSupplierDto, @CurrentUser('sub') userId?: string) { return this.bidService.decryptSupplier(id, supplierId, dto, userId); }

  @Post('projects/:id/suppliers/:supplierId/files/:role/reupload')
  @Roles('admin', 'bid_host')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '管理员补传异常投标文件（SHA-256 闸门校验，仅 OPENING 阶段）' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  reuploadBidFile(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @Param('role') role: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('sub') userId: string,
  ) {
    if (!file) throw new BadRequestException({ error: '请选择文件', code: 'NO_FILE' });
    return this.bidService.reuploadBidFile(id, supplierId, role, file, userId);
  }

  @Post('projects/:id/suppliers/:supplierId/reseal')
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '管理员一键重新封标（从系统内原始明文恢复，无需上传文件）' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  resealBidFiles(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.bidService.resealBidFiles(id, supplierId, userId);
  }

  @Post('projects/:id/tender-document/reload')
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '重新加载招标文件（验证可解密 + 自动修复关联）' })
  reloadTenderDocument(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.bidService.reloadTenderDocument(id, userId);
  }

  @Get('projects/:id/backup-verify/:supplierId')
  @ApiOperation({ summary: '核验未解密投标文件备份（争议举证：三方哈希比对，只读，仅 admin/bid_host）' })
  @Roles('admin', 'bid_host')
  verifyBackup(@Param('id') id: string, @Param('supplierId') supplierId: string, @CurrentUser('sub') userId?: string) {
    return this.bidBackup.verify(id, supplierId, userId);
  }

  @Get('projects/:id/opening-records')
  @ApiOperation({ summary: '开标记录' })
  listOpeningRecords(@Param('id') id: string) { return this.bidService.listOpeningRecords(id); }

  @Post('projects/:id/opening-records')
  @ApiOperation({ summary: '录入唱标信息（建/更新开标记录）' })
  enterOpeningRecord(@Param('id') id: string, @Body() dto: CreateOpeningRecordDto) {
    return this.bidService.enterOpeningRecord(id, dto);
  }

  @Get('projects/:id/suppliers/:supplierId/opening-draft')
  @ApiOperation({ summary: '唱标预填草稿（OPENING 阶段聚合报价/工期/质量目标/保证金凭证）' })
  getOpeningRecordDraft(@Param('id') id: string, @Param('supplierId') supplierId: string) {
    return this.bidService.getOpeningRecordDraft(id, supplierId);
  }

  @Post('projects/:id/opening-records/:recordId/resolve-dispute')
  @ApiOperation({ summary: '处理开标异议' })
  resolveOpeningDispute(
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() dto: ResolveOpeningDisputeDto,
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.resolveOpeningDispute(id, recordId, dto, userId); }

  @Post('projects/:id/suppliers/:supplierId/override-dispute')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '强制裁决异议（监督人应急通道，DISPUTED→EXCEPTION）' })
  overrideDispute(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @Body() dto: { reason: string },
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.overrideDispute(id, supplierId, dto.reason, userId); }

  @Post('projects/:id/suppliers/:supplierId/accept-danger')
  @ApiOperation({ summary: '主持人确认接受供应商解密失败（不可恢复）' })
  acceptSupplierDanger(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @Body() dto: { reason: string },
    @CurrentUser('sub') userId: string,
  ) { return this.bidService.acceptSupplierDanger(id, supplierId, dto.reason, userId); }

  @Get('projects/:id/experts')
  @ApiOperation({ summary: '评标专家列表' })
  listExperts(@Param('id') id: string) { return this.bidService.listExperts(id); }

  @Get('projects/:id/evaluation-results')
  @ApiOperation({ summary: '评标结果汇总' })
  listEvaluationResults(@Param('id') id: string) { return this.bidService.listEvaluationResults(id); }

  @Post('projects/:id/evaluation-results/generate')
  @ApiOperation({ summary: '生成评标结果与候选人' })
  generateEvaluationResults(@Param('id') id: string, @CurrentUser('sub') userId: string) { return this.bidService.generateEvaluationResults(id, userId); }

  @Post('projects/:id/scores')
  @ApiOperation({ summary: '提交评分' })
  submitScore(@Param('id') id: string, @Body() dto: CreateScoreDto, @CurrentUser('sub') actorId: string) { return this.bidService.submitScore(id, dto, actorId); }

  @Get('projects/:id/scores')
  @ApiOperation({ summary: '评分列表' })
  listScores(@Param('id') id: string) { return this.bidService.listScores(id); }

  @Get('projects/:id/score-history')
  @ApiOperation({ summary: 'P5: 评分修订历史（防篡改取证）' })
  getScoreHistory(@Param('id') id: string) { return this.bidService.getScoreHistory(id); }

  @Get('projects/:id/score-items')
  @ApiOperation({ summary: '评分标准（评分项）列表' })
  listScoreItems(@Param('id') id: string) { return this.bidService.listScoreItems(id); }

  @Post('projects/:id/score-items')
  @ApiOperation({ summary: '新增评分项' })
  createScoreItem(
    @Param('id') id: string,
    @Body() dto: CreateScoreItemDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.createScoreItem(id, dto, { userId, role });
  }

  @Post('projects/:id/score-items/template')
  @ApiOperation({ summary: '应用标准评分模板（幂等）' })
  applyScoreItemTemplate(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.applyScoreItemTemplate(id, { userId, role });
  }

  @Post('projects/:id/score-items/publish')
  @ApiOperation({ summary: '发布评分标准(发布后只读)' })
  publishScoreStandard(@Param('id') id: string, @CurrentUser('sub') userId: string, @CurrentUser('role') role: string, @CurrentUser('username') username: string) {
    return this.bidService.publishScoreStandard(id, { userId, role, username });
  }

  @Patch('projects/:id/score-items/:itemId')
  @ApiOperation({ summary: '更新评分项' })
  updateScoreItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateScoreItemDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.updateScoreItem(id, itemId, dto, { userId, role });
  }

  @Delete('projects/:id/score-items/:itemId')
  @ApiOperation({ summary: '删除评分项' })
  deleteScoreItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.deleteScoreItem(id, itemId, { userId, role });
  }

  // ── 评分模板（整套评分标准的保存 / 列表 / 应用 / 删除）──

  @Get('score-templates')
  @ApiOperation({ summary: '评分标准模板列表（自己 + 公共）' })
  listScoreTemplates(@CurrentUser('sub') userId?: string) {
    return this.bidService.listScoreTemplates(userId);
  }

  @Post('score-templates')
  @ApiOperation({ summary: '保存当前项目评分标准为模板（含得分点）' })
  saveScoreTemplate(
    @Body() dto: { projectId: string; name: string },
    @CurrentUser('sub') userId?: string,
    @CurrentUser('username') username?: string,
  ) {
    return this.bidService.saveScoreTemplate(dto.projectId, dto.name, userId, username);
  }

  @Delete('score-templates/:templateId')
  @ApiOperation({ summary: '删除评分模板（私有仅创建者，公共仅管理员）' })
  deleteScoreTemplate(@Param('templateId') templateId: string, @CurrentUser('sub') userId?: string, @CurrentUser('role') role?: string) {
    return this.bidService.deleteScoreTemplate(templateId, userId, role);
  }

  @Post('projects/:id/apply-score-template/:templateId')
  @ApiOperation({ summary: '应用评分模板到项目（幂等：同名分项跳过）' })
  applyScoreTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.applyScoreTemplateById(id, templateId, { userId, role });
  }

  // ── 得分点（checklist 子项）CRUD ──
  @Get('projects/:id/score-items/:itemId/points')
  @ApiOperation({ summary: '列出某评分项的得分点' })
  listScorePoints(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.bidService.listScorePoints(id, itemId);
  }

  @Post('projects/:id/score-items/:itemId/points')
  @ApiOperation({ summary: '新增得分点' })
  createScorePoint(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateScorePointDto,
  ) {
    return this.bidService.createScorePoint(id, itemId, dto);
  }

  @Patch('projects/:id/score-items/:itemId/points/:pointId')
  @ApiOperation({ summary: '更新得分点' })
  updateScorePoint(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('pointId') pointId: string,
    @Body() dto: UpdateScorePointDto,
  ) {
    return this.bidService.updateScorePoint(id, itemId, pointId, dto);
  }

  @Delete('projects/:id/score-items/:itemId/points/:pointId')
  @ApiOperation({ summary: '删除得分点' })
  deleteScorePoint(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('pointId') pointId: string,
  ) {
    return this.bidService.deleteScorePoint(id, itemId, pointId);
  }

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('projects/:id/score-items/:itemId/points/extract')
  @ApiOperation({ summary: 'AI 从招标文件提取得分点建议（同步，不落库）' })
  extractScorePoints(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.scorePointExtractor.extractScorePoints(id, itemId);
  }

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('projects/:id/score-items/points/extract-all')
  @ApiOperation({ summary: '一键 AI 提取全部评分项的得分点建议（同步，不落库）' })
  extractAllScorePoints(@Param('id') id: string) {
    return this.scorePointExtractor.extractAllScorePoints(id);
  }

  @Post('projects/:id/score-items/:itemId/points/batch')
  @ApiOperation({ summary: '批量导入得分点（管理员审核 AI 建议后）' })
  batchCreateScorePoints(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: BatchCreateScorePointsDto,
  ) {
    return this.bidService.batchCreateScorePoints(id, itemId, dto);
  }

  @Get('projects/:id/clarifications')
  @ApiOperation({ summary: '澄清记录' })
  listClarifications(@Param('id') id: string) { return this.bidService.listClarifications(id); }

  @Patch('projects/:id/clarifications/:cid/reply')
  replyClarification(@Param('id') id: string, @Param('cid') cid: string, @Body() dto: ReplyClarificationDto) {
    return this.bidService.replyClarification(id, cid, dto);
  }

  @Post('projects/:id/clarifications')
  @ApiOperation({ summary: '发起澄清' })
  createClarification(@Param('id') id: string, @Body() dto: CreateClarificationDto) { return this.bidService.createClarification(id, dto); }

  @Post('projects/:id/clarifications/draft')
  @ApiOperation({ summary: 'P1-F：AI 起草澄清问题候选（不落库）' })
  draftClarification(@Param('id') id: string, @Body() body: { supplierId: string }) {
    return this.bidService.draftClarification(id, body.supplierId);
  }

  @Post('projects/:id/clarifications/:cid/summarize')
  @ApiOperation({ summary: 'P1-F：AI 提炼回复要点 → aiSummary' })
  summarizeClarification(@Param('id') id: string, @Param('cid') cid: string) {
    return this.bidService.summarizeClarification(id, cid);
  }

  @Get('projects/:id/supervision-logs')
  @ApiOperation({ summary: '监督日志' })
  listSupervisionLogs(@Param('id') id: string) { return this.bidService.listSupervisionLogs(id); }

  @Get('projects/:id/archives')
  @ApiOperation({ summary: '归档资料' })
  listArchives(@Param('id') id: string) { return this.bidService.listArchives(id); }

  @Get('projects/:id/archives/verify')
  @ApiOperation({ summary: '独立验证归档哈希链完整性' })
  verifyArchiveIntegrity(@Param('id') id: string) { return this.bidService.verifyArchiveIntegrity(id); }

  @Post('projects/:id/archive-all')
  @ApiOperation({ summary: '一键归档（scope=opening 仅归档开标文件，不要求评标结果；full 完整归档）' })
  archiveAll(@Param('id') id: string, @Body() dto: ArchiveAllDto, @CurrentUser('sub') userId: string) {
    return this.bidService.archiveAll(id, userId, dto.scope ?? 'full');
  }

  @Get('projects/:id/winner-notice')
  @ApiOperation({ summary: '查询项目关联的中标公示（G1，草稿或已发布）' })
  getWinnerNotice(@Param('id') id: string) { return this.bidService.getWinnerNotice(id); }

  @Post('projects/:id/supervision-annotations')
  @ApiOperation({ summary: '创建或更新监督标注' })
  upsertSupervisionAnnotation(@Param('id') id: string, @Body() dto: UpsertSupervisionAnnotationDto) {
    return this.bidService.upsertSupervisionAnnotation(id, dto);
  }

  @Delete('projects/:id/supervision-annotations/:supplierId')
  @ApiOperation({ summary: '清除监督标注' })
  deleteSupervisionAnnotation(@Param('id') id: string, @Param('supplierId') supplierId: string) {
    return this.bidService.deleteSupervisionAnnotation(id, supplierId);
  }

  @Get('projects/:id/supervision-annotations')
  @ApiOperation({ summary: '查看项目监督标注列表' })
  listSupervisionAnnotations(@Param('id') id: string) {
    return this.bidService.listSupervisionAnnotations(id);
  }

  @Post('projects/:id/claim-host')
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '声明主持操作者身份（并发检测）' })
  claimActiveHost(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('username') userName: string,
  ) { return this.bidService.claimActiveHost(id, userId, userName); }

  @Post('projects/:id/release-host')
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '释放主持操作者身份' })
  releaseActiveHost(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.bidService.releaseActiveHost(id, userId);
  }

  @Get('projects/:id/opening-session/time')
  @ApiOperation({ summary: '获取服务器当前时间及解密窗口剩余秒数' })
  async getSessionTime(@Param('id') id: string) {
    const session = await this.bidService.getOpeningSession(id);
    if (!session) throw new BadRequestException({ error: '开标会话不存在', code: 'NOT_FOUND' });
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - now) / 1000));
    return { serverTime: now, remainingSeconds: remaining, decryptWindowStart: session.decryptWindowStart, decryptWindowEnd: session.decryptWindowEnd };
  }

  @Get('projects/:id/archive-package/export')
  @ApiOperation({ summary: '导出归档包（JSON/CSV，可选 scope=summary|full，含哈希链）' })
  async exportArchivePackage(
    @Param('id') id: string,
    @Query('format') format?: string,
    @Query('scope') scope?: string,
    // passthrough：JSON 分支依赖 Nest 自动发送返回值；非 passthrough 的 @Res
    // 会使返回值被丢弃、请求永久挂起（预存 bug，验收 Phase 2 时发现）
    @Res({ passthrough: true }) res?: any,
  ) {
    const data = await this.bidService.exportArchivePackage(id, (format === 'csv' ? 'csv' : 'json'), (scope === 'summary' ? 'summary' : 'full'));
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="archive-${id.slice(-12)}.csv"`);
      // F4：passthrough 模式下必须 return undefined——返回 res.send() 的返回值（Response 对象）
      // 会使 Nest 二次 apply → res.json(res) → 循环引用 TypeError（每次导出打全栈日志）。
      // 返回 undefined 时 Nest 的兜底是无参 res.send()，Express 5 中为无害 no-op。
      res.send(data);
      return;
    }
    return data;
  }
}
