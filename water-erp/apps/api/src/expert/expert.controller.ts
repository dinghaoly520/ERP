import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Body,
  Param,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpertService } from './expert.service';
import { ExpertAdminService } from './expert-admin.service';
import { ExpertMemoService } from './expert-memo.service';
import { BatchScoreDto } from './dto/batch-score.dto';
import { UpdateExpertProfileDto } from './dto/update-profile.dto';
import { ConfirmContactDto } from './dto/confirm-contact.dto';
import { CreateExpertClarificationDto } from './dto/create-expert-clarification.dto';
import { DraftClarificationDto } from './dto/draft-clarification.dto';
import { UpsertRequirementReviewDto } from './dto/upsert-requirement-review.dto';
import { ConfirmReportDto } from './dto/confirm-report.dto';
import { ConfirmAvoidanceDto } from './dto/confirm-avoidance.dto';
import { UpdateAgreementsDto } from './dto/update-agreements.dto';
import { CreateMemoDto } from './dto/create-memo.dto';
import { UpdateMemoDto } from './dto/update-memo.dto';

@ApiTags('专家评审')
@Controller('expert')
@Roles('bid_expert')
export class ExpertController {
  constructor(
    private expertService: ExpertService,
    private expertAdminService: ExpertAdminService,
    private memoService: ExpertMemoService,
  ) {}

  /* ── 个人资料 ── */
  @Get('profile')
  getProfile(@CurrentUser('sub') userId: string) {
    return this.expertService.getProfile(userId);
  }

  @Patch('profile')
  updateProfile(@CurrentUser('sub') userId: string, @Body() dto: UpdateExpertProfileDto) {
    return this.expertService.updateProfile(userId, dto);
  }

  @Get('profile/contact-check')
  getContactCheck(@CurrentUser('sub') userId: string) {
    return this.expertService.getContactCheck(userId);
  }

  @Post('profile/confirm-contact')
  confirmContact(@CurrentUser('sub') userId: string, @Body() dto: ConfirmContactDto) {
    return this.expertService.confirmContact(userId, dto);
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

  /* ── 评审邀请确认（通知链接落地页用，专家操作本人邀请）── */
  @Get('projects/:projectId/invitation')
  getMyInvitation(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getMyInvitation(userId, projectId);
  }

  @Post('projects/:projectId/invitation/confirm')
  confirmMyInvitation(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertAdminService.confirmInvitation(projectId, userId);
  }

  @Post('projects/:projectId/invitation/decline')
  declineMyInvitation(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertAdminService.declineInvitation(projectId, userId);
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
  confirmAvoidance(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string, @Body() body?: ConfirmAvoidanceDto) {
    return this.expertService.confirmAvoidance(userId, projectId, body?.conflictedSupplierIds);
  }

  @Post('projects/:projectId/ai-consent')
  confirmAiConsent(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.confirmAiConsent(userId, projectId);
  }

  @Patch('projects/:projectId/agreements')
  @ApiOperation({ summary: '签署保密承诺/评标纪律 (P4)' })
  updateAgreements(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateAgreementsDto,
  ) {
    return this.expertService.updateAgreements(userId, projectId, dto);
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

  /* ── 招标文件预览（专家独立核对原文）── */

  @ApiOperation({ summary: '招标文件元信息（专家核对原文，无则 null）' })
  @Get('projects/:projectId/tender-document')
  getTenderDocument(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getTenderDocument(userId, projectId);
  }

  @ApiOperation({ summary: '解密下载招标文件 PDF（inline 预览）' })
  @Get('projects/:projectId/tender-document/download')
  async downloadTenderDocument(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    const { buffer, fileName, mimeType } = await this.expertService.downloadTenderDocument(userId, projectId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  /* ── 投标文件解密下载（专家预览投标人 PDF）── */
  @ApiOperation({ summary: '解密下载投标文件 PDF（inline 预览）' })
  @Get('projects/:projectId/suppliers/:supplierId/documents/:fileId/download')
  async downloadBidDocument(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const { buffer, fileName, mimeType } = await this.expertService.downloadBidDocument(userId, projectId, supplierId, fileId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  /* ── 辅助评标 ── */

  /** 跨供应商对比概览 — 必须在 :supplierId 路由前注册，否则 "compare" 会被当作 supplierId */
  @Get('projects/:projectId/assist/compare')
  getAssistCompare(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.expertService.getAssistCompare(userId, projectId);
  }

  @Get('projects/:projectId/assist/:supplierId')
  getAssistData(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.expertService.getAssistData(userId, projectId, supplierId);
  }

  /* ── 招标条款标注（本人 CRUD，Task 9）── 子路径 reviews 必须在 assist/:supplierId 之后、
   *   assist/compare 之前注册（assist/compare 已在更上方，此处不影响）。── */

  @ApiOperation({ summary: '本人条款标注列表（仅当前专家）' })
  @Get('projects/:projectId/assist/:supplierId/reviews')
  listReviews(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.expertService.listRequirementReviews(userId, projectId, supplierId);
  }

  @ApiOperation({ summary: 'Upsert 本人条款标注（幂等：同一 requirementId 覆盖）' })
  @Post('projects/:projectId/assist/:supplierId/reviews')
  upsertReview(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
    @Body() dto: UpsertRequirementReviewDto,
  ) {
    return this.expertService.upsertRequirementReview(userId, projectId, supplierId, dto);
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

  /* ── 核对评分（draft → verified）── */

  @Post('projects/:projectId/suppliers/:supplierId/score-review/verify')
  @ApiOperation({ summary: '核对评分（draft→verified，桌面核对关口）' })
  verifyScoreReview(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.expertService.verifyScoreReview(userId, projectId, supplierId);
  }

  /* ── 澄清答疑 ── */
  @Get('projects/:projectId/clarifications')
  listClarifications(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.listClarifications(userId, projectId);
  }

  @Post('projects/:projectId/clarifications')
  createClarification(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateExpertClarificationDto,
  ) {
    return this.expertService.createClarification(userId, projectId, dto);
  }

  @Post('projects/:projectId/clarifications/draft')
  draftClarification(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: DraftClarificationDto,
  ) {
    return this.expertService.draftClarification(userId, projectId, dto.supplierId);
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

  /* ── 评审备忘（手写备忘 CRUD + 墨迹原图上传 / 预签名下载）── */

  @ApiOperation({ summary: '备忘列表（仅当前专家，可按供应商过滤）' })
  @Get('projects/:projectId/memos')
  listMemos(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Query('supplierId') supplierId?: string,
    @Query('scorePointId') scorePointId?: string,
  ) {
    return this.memoService.getMemos(userId, projectId, supplierId, scorePointId);
  }

  @ApiOperation({ summary: '创建备忘（支持 multipart 墨迹 PNG 上传，OCR 自动降级）' })
  @Post('projects/:projectId/memos')
  @UseInterceptors(FileInterceptor('ink', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async createMemo(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateMemoDto,
    @UploadedFile() ink?: Express.Multer.File,
  ) {
    return this.memoService.createMemo(userId, projectId, {
      ...dto,
      inkBuffer: ink?.buffer,
      sourceDevice: dto.sourceDevice,
    });
  }

  @ApiOperation({ summary: '修改备忘文字内容' })
  @Patch('projects/:projectId/memos/:memoId')
  updateMemo(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('memoId') memoId: string,
    @Body() dto: UpdateMemoDto,
  ) {
    return this.memoService.updateMemo(userId, projectId, memoId, dto);
  }

  @ApiOperation({ summary: '删除备忘' })
  @Delete('projects/:projectId/memos/:memoId')
  deleteMemo(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('memoId') memoId: string,
  ) {
    return this.memoService.deleteMemo(userId, projectId, memoId);
  }

  @ApiOperation({ summary: '获取墨迹原图预签名 URL' })
  @Get('projects/:projectId/memos/:memoId/ink')
  getInkUrl(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Param('memoId') memoId: string,
  ) {
    return this.memoService.getInkUrl(userId, projectId, memoId);
  }
}
