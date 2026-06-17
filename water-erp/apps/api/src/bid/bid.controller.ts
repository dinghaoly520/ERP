import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { BidService } from './bid.service';
import { Roles } from '../common/decorators/roles.decorator';
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

@ApiTags('开评标管理')
@ApiCookieAuth('token')
@Controller('bid')
@Roles('admin', 'bid_host', 'procurement_staff')
export class BidController {
  constructor(private bidService: BidService) {}

  @Get('dashboard-stats')
  @ApiOperation({ summary: '驾驶舱统计' })
  getDashboardStats() { return this.bidService.getDashboardStats(); }

  @Get('projects')
  @ApiOperation({ summary: '项目列表' })
  listProjects() { return this.bidService.listProjects(); }

  @Post('projects')
  @ApiOperation({ summary: '创建项目' })
  createProject(@Body() dto: CreateBidProjectDto) { return this.bidService.createProject(dto); }

  @Get('projects/:id')
  @ApiOperation({ summary: '项目详情' })
  getProject(@Param('id') id: string) { return this.bidService.getProject(id); }

  @Get('projects/:id/workspace')
  @ApiOperation({ summary: '项目工作台（供应商/标书/专家组聚合，开标准备判断）' })
  getWorkspace(@Param('id') id: string) { return this.bidService.getWorkspace(id); }

  @Patch('projects/:id')
  @ApiOperation({ summary: '更新项目' })
  updateProject(@Param('id') id: string, @Body() dto: UpdateBidProjectDto) { return this.bidService.updateProject(id, dto); }

  @Get('projects/:id/suppliers')
  @ApiOperation({ summary: '投标供应商列表' })
  listSuppliers(@Param('id') id: string) { return this.bidService.listSuppliers(id); }

  @Post('projects/:id/open-submission')
  @ApiOperation({ summary: '开放投递 (DOWNLOAD→SUBMIT)' })
  openSubmission(@Param('id') id: string) { return this.bidService.openSubmission(id); }

  @Post('projects/:id/open')
  @ApiOperation({ summary: '启动开标' })
  startOpening(@Param('id') id: string, @Body() dto?: StartOpeningDto) { return this.bidService.startOpening(id, dto); }

  @Post('projects/:id/start-evaluation')
  @ApiOperation({ summary: '启动评标 (OPENING→EVALUATING)' })
  startEvaluation(@Param('id') id: string) { return this.bidService.startEvaluation(id); }

  @Post('projects/:id/decrypt/:supplierId')
  @ApiOperation({ summary: '解密供应商投标' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  decryptSupplier(@Param('id') id: string, @Param('supplierId') supplierId: string, @Body() dto?: DecryptSupplierDto) { return this.bidService.decryptSupplier(id, supplierId, dto); }

  @Get('projects/:id/opening-records')
  @ApiOperation({ summary: '开标记录' })
  listOpeningRecords(@Param('id') id: string) { return this.bidService.listOpeningRecords(id); }

  @Post('projects/:id/opening-records')
  @ApiOperation({ summary: '录入唱标信息（建/更新开标记录）' })
  enterOpeningRecord(@Param('id') id: string, @Body() dto: CreateOpeningRecordDto) {
    return this.bidService.enterOpeningRecord(id, dto);
  }

  @Post('projects/:id/opening-records/:recordId/resolve-dispute')
  @ApiOperation({ summary: '处理开标异议' })
  resolveOpeningDispute(
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() dto: { result: string; confirm: boolean },
  ) { return this.bidService.resolveOpeningDispute(id, recordId, dto); }

  @Get('projects/:id/experts')
  @ApiOperation({ summary: '评标专家列表' })
  listExperts(@Param('id') id: string) { return this.bidService.listExperts(id); }

  @Get('projects/:id/evaluation-results')
  @ApiOperation({ summary: '评标结果汇总' })
  listEvaluationResults(@Param('id') id: string) { return this.bidService.listEvaluationResults(id); }

  @Post('projects/:id/evaluation-results/generate')
  @ApiOperation({ summary: '生成评标结果与候选人' })
  generateEvaluationResults(@Param('id') id: string) { return this.bidService.generateEvaluationResults(id); }

  @Post('projects/:id/scores')
  @ApiOperation({ summary: '提交评分' })
  submitScore(@Param('id') id: string, @Body() dto: CreateScoreDto) { return this.bidService.submitScore(id, dto); }

  @Get('projects/:id/scores')
  @ApiOperation({ summary: '评分列表' })
  listScores(@Param('id') id: string) { return this.bidService.listScores(id); }

  @Get('projects/:id/score-items')
  @ApiOperation({ summary: '评分标准（评分项）列表' })
  listScoreItems(@Param('id') id: string) { return this.bidService.listScoreItems(id); }

  @Post('projects/:id/score-items')
  @ApiOperation({ summary: '新增评分项' })
  createScoreItem(@Param('id') id: string, @Body() dto: CreateScoreItemDto) { return this.bidService.createScoreItem(id, dto); }

  @Post('projects/:id/score-items/template')
  @ApiOperation({ summary: '应用标准评分模板（幂等）' })
  applyScoreItemTemplate(@Param('id') id: string) { return this.bidService.applyScoreItemTemplate(id); }

  @Patch('projects/:id/score-items/:itemId')
  @ApiOperation({ summary: '更新评分项' })
  updateScoreItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: UpdateScoreItemDto) {
    return this.bidService.updateScoreItem(id, itemId, dto);
  }

  @Delete('projects/:id/score-items/:itemId')
  @ApiOperation({ summary: '删除评分项' })
  deleteScoreItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.bidService.deleteScoreItem(id, itemId);
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

  @Get('projects/:id/supervision-logs')
  @ApiOperation({ summary: '监督日志' })
  listSupervisionLogs(@Param('id') id: string) { return this.bidService.listSupervisionLogs(id); }

  @Get('projects/:id/archives')
  @ApiOperation({ summary: '归档资料' })
  listArchives(@Param('id') id: string) { return this.bidService.listArchives(id); }

  @Post('projects/:id/archive-all')
  @ApiOperation({ summary: '一键归档' })
  archiveAll(@Param('id') id: string) { return this.bidService.archiveAll(id); }

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
  @ApiOperation({ summary: '导出归档包（JSON 或 CSV 格式，含哈希链）' })
  async exportArchivePackage(
    @Param('id') id: string,
    @Query('format') format?: string,
    @Res() res?: any,
  ) {
    const data = await this.bidService.exportArchivePackage(id, (format === 'csv' ? 'csv' : 'json'));
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="archive-${id.slice(-12)}.csv"`);
      return res.send(data);
    }
    return data;
  }
}
