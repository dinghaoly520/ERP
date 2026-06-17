import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpertService } from './expert.service';
import { BatchScoreDto } from './dto/batch-score.dto';
import { UpdateExpertProfileDto } from './dto/update-profile.dto';
import { CreateExpertClarificationDto } from './dto/create-expert-clarification.dto';
import { ConfirmReportDto } from './dto/confirm-report.dto';

@ApiTags('专家评审')
@Controller('expert')
@Roles('bid_expert')
export class ExpertController {
  constructor(private expertService: ExpertService) {}

  /* ── 个人资料 ── */
  @Get('profile')
  getProfile(@CurrentUser('sub') userId: string) {
    return this.expertService.getProfile(userId);
  }

  @Patch('profile')
  updateProfile(@CurrentUser('sub') userId: string, @Body() dto: UpdateExpertProfileDto) {
    return this.expertService.updateProfile(userId, dto);
  }

  /* ── 统计概览 ── */
  @Get('statistics')
  getStatistics(@CurrentUser('sub') userId: string) {
    return this.expertService.getStatistics(userId);
  }

  /* ── 项目列表 ── */
  @Get('projects')
  listProjects(@CurrentUser('sub') userId: string) {
    return this.expertService.listProjects(userId);
  }

  @Get('projects/:projectId')
  getProject(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getProject(userId, projectId);
  }

  /* ── 身份核验 ── */
  @Post('projects/:projectId/sign-in')
  signIn(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.signIn(userId, projectId);
  }

  @Post('projects/:projectId/avoidance')
  confirmAvoidance(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string, @Body() body?: { conflictedSupplierIds?: string[] }) {
    return this.expertService.confirmAvoidance(userId, projectId, body?.conflictedSupplierIds);
  }

  /* ── 标书解密获取 ── */
  @Get('projects/:projectId/documents/:supplierId')
  getDecryptedDocuments(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.expertService.getDecryptedDocuments(userId, projectId, supplierId);
  }

  /* ── 辅助评标 ── */
  @Get('projects/:projectId/assist/:supplierId')
  getAssistData(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.expertService.getAssistData(userId, projectId, supplierId);
  }

  /* ── 专家打分 ── */
  @Post('projects/:projectId/scores')
  @ApiOperation({
    summary: '提交评分（按供应商批量）',
    description: '每次调用提交一个供应商的全部评分项。**需提交全部 5 类评分项**（含资格性审查/符合性审查，可打 0 分）方可达到 progress=100% 并确认报告。supplierName 为供应商企业全称，scores 数组中每项包含 scoreItemId/supplierId/score/reason。',
  })
  submitScores(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: BatchScoreDto,
  ) {
    return this.expertService.submitScores(userId, projectId, dto);
  }

  @Get('projects/:projectId/my-scores')
  getMyScores(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getMyScores(userId, projectId);
  }

  /* ── 澄清答疑 ── */
  @Get('projects/:projectId/clarifications')
  listClarifications(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getProject(userId, projectId).then(p => p.clarifications);
  }

  @Post('projects/:projectId/clarifications')
  createClarification(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateExpertClarificationDto,
  ) {
    return this.expertService.createClarification(userId, projectId, dto);
  }

  /* ── 评审报告 ── */
  @Get('projects/:projectId/report')
  getReport(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getReport(userId, projectId);
  }

  @Post('projects/:projectId/report/confirm')
  confirmReport(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto?: ConfirmReportDto,
  ) {
    return this.expertService.confirmReport(userId, projectId, dto?.comment);
  }
}
