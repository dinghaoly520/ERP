import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, Res, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidDocumentService } from './bid-document.service';
import { BidDocumentUploadDto, UpdateBidDocumentConfigDto } from './dto/bid-document-config.dto';
import { AnnouncementAttachmentService } from './announcement-attachment.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementHistoryService } from './announcement-history.service';
import { CompanyScopeService } from '../company/company-scope';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('信息公告')
@Controller('announcements')
export class AnnouncementController {
  constructor(
    private announcementService: AnnouncementService,
    private announcementAiService: AnnouncementAiService,
    private bidDocumentService: BidDocumentService,
    private attachmentService: AnnouncementAttachmentService,
    private history: AnnouncementHistoryService,
    private companyScope: CompanyScopeService,
    private prisma: PrismaService,
  ) {}

  /** 附件越权校验：经附件反查所属公告再校验公司 */
  private async assertAttachmentScope(attachmentId: string, user: AuthenticatedUser | undefined) {
    const att = await this.prisma.announcementAttachment.findUnique({
      where: { id: attachmentId },
      select: { announcementId: true },
    }).catch(() => null);
    if (att) await this.assertAnnouncementScope(att.announcementId, user);
  }

  /** 公告公司越权校验：非 admin 视野只能操作本公司公告（admin 全量） */
  private async assertAnnouncementScope(id: string, user: AuthenticatedUser | undefined) {
    const scope = await this.companyScope.resolveScope(user);
    if (scope.all) return;
    const ann = await this.announcementService.get(id).catch(() => null);
    if (ann && (ann as any).companyId !== scope.companyId) {
      throw new ForbiddenException({ error: '该公告不属于本公司，无权访问', code: 'COMPANY_SCOPE_FORBIDDEN' });
    }
  }

  // ─── 公开接口 ───

  @Get('public')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: '公开公告列表' })
  async publicList(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.announcementService.publicList({ type, search, page, pageSize });
  }

  @Get('public/:id')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: '公开公告详情' })
  async getPublic(@Param('id') id: string) {
    return this.announcementService.getPublic(id);
  }

  // ─── 管理接口 ───

  @Get()
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '公告列表（管理端，按公司隔离）' })
  async list(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司
    @Request() req?: any,
  ) {
    const scope = await this.companyScope.resolveScope(req?.user, companyId);
    return this.announcementService.list(
      { type, status, search, page, pageSize },
      this.companyScope.filter(scope),
    );
  }

  @Get('stats')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '公告统计（按公司隔离）' })
  async getStats(@Query('companyId') companyId?: string, @Request() req?: any) {
    const scope = await this.companyScope.resolveScope(req?.user, companyId);
    return this.announcementService.getStats(this.companyScope.filter(scope));
  }

  @Get(':id/participants')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '招标公示投标情况（参与供应商 + 是否已投标）' })
  async getParticipants(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    return this.announcementService.getParticipants(id);
  }

  @Get('project/:projectCode/participants')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '按项目编号查询公告参与供应商（项目基本信息「供应商参与」）' })
  getProjectParticipants(@Param('projectCode') projectCode: string) {
    return this.announcementService.getProjectParticipants(projectCode);
  }

  // ─── 普通附件 ───

  @Get(':id/attachments')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '公告附件列表' })
  async listAttachments(@Param('id') id: string) {
    return this.attachmentService.list(id);
  }

  @Post(':id/attachments')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '添加公告附件' })
  async addAttachment(@Param('id') id: string, @Body() body: { fileAssetId: string; title?: string }, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    return this.attachmentService.add(id, body.fileAssetId, body.title || '');
  }

  @Post(':id/attachments/from-object')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '从已有对象挂载公告附件（引用项目采购文件）' })
  async attachFromObject(
    @Param('id') id: string,
    @Body() body: { objectKey: string; fileName?: string; title?: string; mimeType?: string; size?: number },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    await this.assertAnnouncementScope(id, user);
    return this.attachmentService.attachFromObject(id, body, user?.sub);
  }

  @Delete('attachments/:aid')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '删除公告附件' })
  async removeAttachment(@Param('aid') aid: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAttachmentScope(aid, user);
    return this.attachmentService.remove(aid);
  }

  @Get('attachments/:aid/download')
  @Public()
  @ApiOperation({ summary: '公开下载公告附件' })
  async downloadAttachment(@Param('aid') aid: string, @Res() res: any) {
    return this.attachmentService.stream(aid, res);
  }

  // ─── 招标文件（加密 + 受控分发）───

  @Get(':id/bid-document')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '查看招标文件配置（管理端）' })
  async getBidDocument(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    return this.bidDocumentService.getForManagement(id);
  }

  @Post(':id/bid-document')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        accessScope: { type: 'string', description: 'OPEN | INVITED' },
        requirePayment: { type: 'string', description: 'true/false' },
        price: { type: 'number' },
        bidProjectId: { type: 'string' },
        allowedSupplierIds: { type: 'string', description: '逗号分隔的供应商ID（INVITED 模式下手动指定受邀供应商）' },
      },
    },
  })
  @ApiOperation({ summary: '上传加密招标文件' })
  async uploadBidDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: BidDocumentUploadDto,
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException({ error: '请选择文件', code: 'NO_FILE' });
    await this.assertAnnouncementScope(id, req.user);
    return this.bidDocumentService.upload(
      id,
      file,
      {
        title: body.title,
        accessScope: (body.accessScope as any) || 'OPEN',
        requirePayment: body.requirePayment === 'true' || body.requirePayment === true,
        price: body.price ? Number(body.price) : undefined,
        bidProjectId: body.bidProjectId || undefined,
        allowedSupplierIds: body.allowedSupplierIds ? String(body.allowedSupplierIds).split(',').filter(Boolean) : [],
      },
      req.user.sub,
    );
  }

  @Put(':id/bid-document')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '更新招标文件访问配置' })
  async updateBidDocument(@Param('id') id: string, @Body() body: UpdateBidDocumentConfigDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    const toBool = (v: any): boolean | undefined => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'boolean') return v;
      return v === 'true';
    };
    return this.bidDocumentService.updateConfig(id, {
      title: body.title,
      accessScope: body.accessScope,
      requirePayment: toBool(body.requirePayment),
      price: body.price !== undefined ? Number(body.price) : undefined,
      bidProjectId: body.bidProjectId,
      allowedSupplierIds: body.allowedSupplierIds,
    });
  }

  @Post(':id/bid-document/confirm-payment')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '确认供应商付款到账' })
  async confirmPayment(@Param('id') id: string, @Body() body: { supplierId: string; paymentRef?: string }, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    return this.bidDocumentService.confirmPayment(id, body.supplierId, body.paymentRef);
  }

  @Delete(':id/bid-document')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '删除招标文件' })
  async removeBidDocument(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    return this.bidDocumentService.remove(id);
  }

  // ─── 公告详情（管理端，含招标文件配置）───

  @Get(':id')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '公告详情' })
  async get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    return this.announcementService.get(id);
  }

  @Post()
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '创建公告' })
  async create(@Body() dto: CreateAnnouncementDto, @Request() req: any) {
    const companyStamp = await this.companyScope.stampFor(req.user);
    const result = await this.announcementService.create(dto, req.user.sub, companyStamp);
    // 操作历史（append-only）：新建 + 直接发布各记一条
    await this.history.write({
      announcementId: result.id,
      action: 'CREATE',
      title: result.title,
      type: result.type,
      status: result.status,
      content: result.content,
      operatorId: req.user.sub,
      operatorName: req.user.username,
      ipAddress: this.clientIp(req),
      userAgent: req.headers?.['user-agent'],
    }).catch(() => undefined);
    if (result.status === 'PUBLISHED') {
      await this.history.write({
        announcementId: result.id,
        action: 'PUBLISH',
        title: result.title,
        type: result.type,
        status: result.status,
        operatorId: req.user.sub,
        operatorName: req.user.username,
        ipAddress: this.clientIp(req),
        userAgent: req.headers?.['user-agent'],
      }).catch(() => undefined);
    }
    return result;
  }

  @Put(':id')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '更新公告' })
  async update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto, @Request() req: any) {
    await this.assertAnnouncementScope(id, req.user);
    // 编辑前快照：判定状态流转与变更字段
    const before = await this.announcementService.get(id);
    const result = await this.announcementService.update(id, dto);
    const changedFields = Object.keys(dto).filter(
      (k) => (dto as any)[k] !== undefined && (dto as any)[k] !== (before as any)[k],
    );
    // 状态流转判定（发布/撤回/归档）
    const transition =
      result.status === 'PUBLISHED' && before.status !== 'PUBLISHED' ? 'PUBLISH'
      : result.status === 'DRAFT' && before.status === 'PUBLISHED' ? 'UNPUBLISH'
      : result.status === 'ARCHIVED' && before.status !== 'ARCHIVED' ? 'ARCHIVE'
      : null;
    // 纯状态流转（只改了 status）不重复记 UPDATE，只记流转动作
    const contentFields = changedFields.filter((f) => f !== 'status');
    if (contentFields.length > 0) {
      await this.history.write({
        announcementId: id,
        action: 'UPDATE',
        title: result.title,
        type: result.type,
        status: result.status,
        content: dto.content ?? before.content,
        changedFields: contentFields,
        operatorId: req.user.sub,
        operatorName: req.user.username,
        ipAddress: this.clientIp(req),
        userAgent: req.headers?.['user-agent'],
      }).catch(() => undefined);
    }
    if (transition) {
      await this.history.write({
        announcementId: id,
        action: transition as any,
        title: result.title,
        type: result.type,
        status: result.status,
        operatorId: req.user.sub,
        operatorName: req.user.username,
        ipAddress: this.clientIp(req),
        userAgent: req.headers?.['user-agent'],
      }).catch(() => undefined);
    }
    return result;
  }

  @Get(':id/history')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '公告操作历史（只读，不可删改）' })
  async historyOf(@Param('id') id: string) {
    return this.history.timeline(id);
  }

  @Get('histories/all')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '全部公告操作历史（只读）' })
  async allHistories(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.history.listAll({ page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  /** 提取客户端 IP（信任反代一跳） */
  private clientIp(req: any): string | undefined {
    const xff = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    return xff || req.socket?.remoteAddress || req.ip;
  }

  @Post('check-duplicate')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '发布前查重：同标题或同项目同类型的已发布公告（命中不阻断，前端提示确认）' })
  async checkDuplicate(
    @Body() dto: { title?: string; relatedProjectCode?: string; type?: string },
    @Request() req: any,
  ) {
    const scope = await this.companyScope.resolveScope(req.user);
    return this.announcementService.checkDuplicate(dto, this.companyScope.filter(scope));
  }

  @Post('bid-notice-checklist')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '采购公告要素完整性预检（GB/T 43711 7.2.2.5，dry-run，警告不阻断）' })
  previewChecklist(@Body() dto: Pick<CreateAnnouncementDto, 'title' | 'content' | 'metadata' | 'relatedProjectCode'>) {
    return this.announcementService.previewBidNoticeChecklist(dto);
  }

  @Post(':id/confirm-winner')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '预成交公示期满确认 → 发布成交公告（GB/T 43711 7.5.2.5，两段式第二段）' })
  async confirmWinner(@Param('id') id: string, @Request() req: any) {
    await this.assertAnnouncementScope(id, req.user);
    return this.announcementService.confirmWinnerNotice(id, {
      operatorId: req.user.sub,
      operatorName: req.user.username,
      ipAddress: this.clientIp(req),
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post(':id/generate-summary')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: 'AI 重新生成摘要' })
  async generateSummary(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertAnnouncementScope(id, user);
    if (!this.announcementAiService.isConfigured()) {
      throw new BadRequestException({ error: 'AI 摘要未启用：服务端未配置 DeepSeek（请在 apps/api/.env 设置 DEEPSEEK_API_KEY 后重启 API）', code: 'AI_NOT_CONFIGURED' });
    }
    const ann = await this.announcementService.get(id);
    if (!ann) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (!ann.content) throw new BadRequestException({ error: '公告无正文内容，无法生成摘要', code: 'NO_CONTENT' });
    const typeMap: Record<string, string> = { BID_NOTICE:'采购公告', PRE_WIN_NOTICE:'预成交公示', WIN_NOTICE:'成交公告', POLICY:'政策法规', PLATFORM:'平台通知' };
    const aiSummary = await this.announcementAiService.summarize({
      title: ann.title,
      type: typeMap[ann.type] ?? ann.type,
      content: ann.content,
    });
    if (!aiSummary) throw new BadRequestException({ error: 'AI 摘要生成失败：模型服务暂时不可用（网络波动或上游限流），请稍后重试', code: 'AI_FAILED' });
    await this.announcementService.update(id, { aiSummary } as any);
    return { aiSummary };
  }

  @Delete(':id')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '删除公告' })
  async remove(@Param('id') id: string, @Request() req: any) {
    await this.assertAnnouncementScope(id, req.user);
    // 删除前快照（删除后原记录不存在，历史须自含信息）
    const before = await this.announcementService.get(id);
    const result = await this.announcementService.remove(id);
    await this.history.write({
      announcementId: id,
      action: 'DELETE',
      title: before.title,
      type: before.type,
      status: before.status,
      content: before.content,
      operatorId: req.user.sub,
      operatorName: req.user.username,
      ipAddress: this.clientIp(req),
      userAgent: req.headers?.['user-agent'],
    }).catch(() => undefined);
    return result;
  }
}
