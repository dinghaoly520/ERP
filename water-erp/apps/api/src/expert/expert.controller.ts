import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Body,
  Param,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
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
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('专家评审')
@Controller('expert')
export class ExpertController {
  constructor(
    private expertService: ExpertService,
    private expertAdminService: ExpertAdminService,
    private memoService: ExpertMemoService,
    private prisma: PrismaService,
    private bidGateway: BidGateway,
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

  /* ── 免登录 RSVP（token 链接，15分钟有效期）── */
  @Public()
  @Get('rsvp/verify')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: '校验专家邀请链接（公开，返回项目信息+状态）' })
  async rsvpVerify(@Query('t') t?: string) {
    if (!t) throw new BadRequestException({ error: '缺少邀请凭证', code: 'MISSING_TOKEN' });
    const be = await this.prisma.bidExpert.findUnique({
      where: { rsvpToken: t },
      include: { project: { select: { name: true, projectCode: true, procurementMethod: true, openTime: true, projectManagementItemId: true, scope: true, qualification: true, riskNote: true } } },
    });
    if (!be) throw new BadRequestException({ error: '邀请链接无效', code: 'RSVP_NOT_FOUND' });
    // 用项目管理编号覆盖 BidProject 的自动生成编号
    let projectCode = be.project.projectCode;
    if (be.project.projectManagementItemId) {
      const pm = await this.prisma.projectManagementItem.findUnique({ where: { id: be.project.projectManagementItemId }, select: { projectCode: true } });
      if (pm?.projectCode) projectCode = pm.projectCode;
    }
    const expired = be.rsvpExpiresAt ? new Date(be.rsvpExpiresAt).getTime() < Date.now() : false;
    // 超时且未回复 → 自动弃权 + 递补候补
    if (expired && be.invitationStatus === 'pending') {
      await this.prisma.bidExpert.update({ where: { id: be.id }, data: { invitationStatus: 'declined', rsvpRespondedAt: new Date() } });
      be.invitationStatus = 'declined';
    }
    return {
      expertName: be.expertName,
      major: be.major,
      expertRole: be.expertRole,
      projectName: be.project.name,
      projectCode,
      procurementMethod: be.project.procurementMethod,
      openTime: be.project.openTime,
      status: be.invitationStatus,
      expired,
      expiresAt: be.rsvpExpiresAt,
      isLead: be.isLead,
      projectScope: (() => {
        const raw = [be.project.scope, be.project.qualification, be.project.riskNote].filter(Boolean).join('；');
        // 剔除"见附件"等引用语句
        const cleaned = raw.replace(/[（(]?详见?附件[^。）\n]*[）)]?|[。；]?\s*详细技术规格[^。]*。/g, '').replace(/，。|。。|；；/g, '；').replace(/^\s*[；，、]+\s*|[；，、]+\s*$/g, '').trim();
        return cleaned.slice(0, 500) || null;
      })(),
      rsvpNo: be.id.slice(-8).toUpperCase(),
      respondedAt: be.rsvpRespondedAt,
    };
  }

  @Public()
  @Post('rsvp/respond')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '专家确认/婉拒邀请（公开，token 验证）' })
  async rsvpRespond(@Query('t') t: string, @Body() body: { status: 'confirmed' | 'declined' }) {
    if (!t) throw new BadRequestException({ error: '缺少邀请凭证', code: 'MISSING_TOKEN' });
    if (!body?.status) throw new BadRequestException({ error: '请选择操作', code: 'MISSING_STATUS' });
    const be = await this.prisma.bidExpert.findUnique({ where: { rsvpToken: t } });
    if (!be) throw new BadRequestException({ error: '邀请链接无效', code: 'RSVP_NOT_FOUND' });
    if (be.rsvpExpiresAt && new Date(be.rsvpExpiresAt).getTime() < Date.now()) {
      throw new BadRequestException({ error: '邀请链接已过期（15分钟），请联系采购方', code: 'RSVP_EXPIRED' });
    }
    if (be.invitationStatus !== 'pending') {
      throw new BadRequestException({ error: '您已回复过此邀请', code: 'ALREADY_RESPONDED' });
    }
    await this.prisma.bidExpert.update({
      where: { id: be.id },
      data: { invitationStatus: body.status, rsvpRespondedAt: new Date() },
    });
    // 婉拒 → 自动递补候补
    const rsvpNo = be.id.slice(-8).toUpperCase();
    const respondedAt = new Date().toISOString();
    if (body.status === 'declined') {
      const promoted = await this.expertAdminService.autoPromoteCandidate(be.projectId).catch(() => null);
      return { success: true, status: body.status, rsvpNo, respondedAt, promoted };
    }
    return { success: true, status: body.status, rsvpNo, respondedAt };
  }

  @Get('projects/:projectId')
  getProject(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getProject(userId, projectId);
  }

  /* ── 身份核验 ── */
  @Post('projects/:projectId/sign-in')
  signIn(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Req() req: any,
  ) {
    return this.expertService.signIn(userId, projectId, {
      ip: req.ip ?? req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'] ?? null,
    });
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

  /** 多轮报价历史（专家只读，仅 published/closed 轮次） */
  @Get('projects/:projectId/quote-history')
  getQuoteHistory(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.expertService.getQuoteHistory(userId, projectId);
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
  async submitScores(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: BatchScoreDto,
  ) {
    const result = await this.expertService.submitScores(userId, projectId, dto);
    // WS 广播评分提交里程碑（不含分数值）→ 同项目其他专家端自行刷新
    try {
      const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
      const supplierId = dto.scores?.[0]?.supplierId;
      if (expert && supplierId) {
        this.bidGateway.notifyScoresSubmitted(projectId, expert.id, supplierId);
      }
    } catch { /* WS 非关键路径——静默降级 */ }
    return result;
  }

  @Get('projects/:projectId/my-scores')
  getMyScores(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getMyScores(userId, projectId);
  }

  /* ── C1: 投票/合议/决议 ── */

  @Get('projects/:projectId/motions')
  @ApiOperation({ summary: '查询项目动议列表（含投票状态）' })
  listMotions(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.listMotions(userId, projectId);
  }

  @Post('projects/:projectId/motions')
  @ApiOperation({ summary: '发起动议（组长或任意专家）' })
  createMotion(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string, @Body() dto: { type: string; title: string; description?: string }) {
    return this.expertService.createMotion(userId, projectId, dto);
  }

  @Post('motions/:motionId/vote')
  @ApiOperation({ summary: '投票（一票制，不可改投）' })
  castVote(@CurrentUser('sub') userId: string, @Param('motionId') motionId: string, @Body() dto: { vote: string; reason?: string }) {
    return this.expertService.castVote(userId, motionId, dto.vote, dto.reason);
  }

  @Post('motions/:motionId/close')
  @ApiOperation({ summary: '结束投票并统计结果（仅组长或动议发起人）' })
  closeMotion(@CurrentUser('sub') userId: string, @Param('motionId') motionId: string) {
    return this.expertService.closeMotion(userId, motionId);
  }

  /* ── D2: 专家异议工单 ── */

  @Get('projects/:projectId/disputes')
  @ApiOperation({ summary: '查询项目异议工单列表' })
  listDisputes(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.listDisputes(userId, projectId);
  }

  @Post('projects/:projectId/disputes')
  @ApiOperation({ summary: '提交专家异议工单' })
  createDispute(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string, @Body() dto: { type: string; title: string; content: string }) {
    return this.expertService.createDispute(userId, projectId, dto);
  }

  /* ── C2: 组长末签 ── */

  @Post('projects/:projectId/leader-cosign')
  @ApiOperation({ summary: '组长末签——所有专家确认后,组长执行最终末签' })
  leaderCoSign(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.leaderCoSign(userId, projectId);
  }

  /* ── G3: 评分草稿持久化 ── */

  @Post('projects/:projectId/score-draft')
  async saveScoreDraft(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() draft: Record<string, unknown>,
    @Query('device') device?: string,
  ) {
    const d = (device === 'tablet' || device === 'desktop') ? device : 'desktop';
    const result = await this.expertService.saveScoreDraft(userId, projectId, draft, d);
    // WS 通知同项目其他专家端（自己的 device 不会收到——由客户端过滤）
    try {
      const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
      if (expert) this.bidGateway.notifyDraftSaved(projectId, expert.id, d);
    } catch { /* WS 非关键路径 */ }
    return result;
  }

  @Get('projects/:projectId/score-draft')
  getScoreDraft(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Query('device') device?: string,
  ) {
    const d = (device === 'tablet' || device === 'desktop') ? device : undefined;
    return this.expertService.getScoreDraft(userId, projectId, d);
  }

  @Get('projects/:projectId/score-history')
  @ApiOperation({ summary: '评分历史（当前值 + 修改快照，按评分项分组）' })
  getScoreHistory(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Query('supplierId') supplierId: string,
  ) {
    return this.expertService.getScoreHistory(userId, projectId, supplierId);
  }

  /* ── E: 「去打分平板」跨设备联动（Redis focus hint）── */

  @Post('projects/:projectId/focus-hint')
  @ApiOperation({ summary: '桌面端发送打分项定位到平板（Redis，TTL 120s）' })
  setFocusHint(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Body() body: { supplierId: string; scoreItemId?: string; pointId?: string },
  ) {
    return this.expertService.setFocusHint(userId, projectId, body);
  }

  @Get('projects/:projectId/focus-hint')
  @ApiOperation({ summary: '平板端轮询打分项定位（无则 null）' })
  getFocusHint(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.getFocusHint(userId, projectId);
  }

  @Get('projects/:projectId/focus-hint/ack')
  @ApiOperation({ summary: '桌面端查询平板是否已接收 focus hint（ACK 回执）' })
  getFocusHintAck(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Query('seq') seq: string,
  ) {
    return this.expertService.getFocusHintAck(userId, projectId, Number(seq));
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
    @Query('scoreItemId') scoreItemId?: string,
  ) {
    return this.memoService.getMemos(userId, projectId, supplierId, scorePointId, scoreItemId);
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

  /* ── 评审待办：跨项目聚合 ── */

  @Get('tasks')
  @ApiOperation({ summary: '汇总当前专家所有活跃项目的动议(投票中)与异议工单' })
  getMyTasks(@CurrentUser('sub') userId: string) {
    return this.expertService.getMyTasks(userId);
  }
}
