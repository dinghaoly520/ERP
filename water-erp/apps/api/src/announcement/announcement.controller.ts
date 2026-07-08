import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, Res, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidDocumentService } from './bid-document.service';
import { AnnouncementAttachmentService } from './announcement-attachment.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';

@ApiTags('信息公告')
@Controller('announcements')
export class AnnouncementController {
  constructor(
    private announcementService: AnnouncementService,
    private announcementAiService: AnnouncementAiService,
    private bidDocumentService: BidDocumentService,
    private attachmentService: AnnouncementAttachmentService,
  ) {}

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
  @ApiOperation({ summary: '公告列表（管理端）' })
  async list(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.announcementService.list({ type, status, search, page, pageSize });
  }

  @Get('stats')
  @ApiOperation({ summary: '公告统计' })
  async getStats() {
    return this.announcementService.getStats();
  }

  @Get(':id/participants')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '招标公示投标情况（参与供应商 + 是否已投标）' })
  async getParticipants(@Param('id') id: string) {
    return this.announcementService.getParticipants(id);
  }

  // ─── 普通附件 ───

  @Get(':id/attachments')
  @ApiOperation({ summary: '公告附件列表' })
  async listAttachments(@Param('id') id: string) {
    return this.attachmentService.list(id);
  }

  @Post(':id/attachments')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '添加公告附件' })
  async addAttachment(@Param('id') id: string, @Body() body: { fileAssetId: string; title?: string }) {
    return this.attachmentService.add(id, body.fileAssetId, body.title || '');
  }

  @Delete('attachments/:aid')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '删除公告附件' })
  async removeAttachment(@Param('aid') aid: string) {
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
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '查看招标文件配置（管理端）' })
  async getBidDocument(@Param('id') id: string) {
    return this.bidDocumentService.getForManagement(id);
  }

  @Post(':id/bid-document')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
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
    @Body() body: any,
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException({ error: '请选择文件', code: 'NO_FILE' });
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
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '更新招标文件访问配置' })
  async updateBidDocument(@Param('id') id: string, @Body() body: any) {
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
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '确认供应商付款到账' })
  async confirmPayment(@Param('id') id: string, @Body() body: { supplierId: string; paymentRef?: string }) {
    return this.bidDocumentService.confirmPayment(id, body.supplierId, body.paymentRef);
  }

  @Delete(':id/bid-document')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '删除招标文件' })
  async removeBidDocument(@Param('id') id: string) {
    return this.bidDocumentService.remove(id);
  }

  // ─── 公告详情（管理端，含招标文件配置）───

  @Get(':id')
  @ApiOperation({ summary: '公告详情' })
  async get(@Param('id') id: string) {
    return this.announcementService.get(id);
  }

  @Post()
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '创建公告' })
  async create(@Body() dto: CreateAnnouncementDto, @Request() req: any) {
    return this.announcementService.create(dto, req.user.sub);
  }

  @Put(':id')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '更新公告' })
  async update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcementService.update(id, dto);
  }

  @Post(':id/generate-summary')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: 'AI 重新生成摘要' })
  async generateSummary(@Param('id') id: string) {
    const ann = await this.announcementService.get(id);
    if (!ann) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (!ann.content) throw new BadRequestException({ error: '公告无正文内容，无法生成摘要', code: 'NO_CONTENT' });
    const typeMap: Record<string, string> = { BID_NOTICE:'招标公告', WIN_NOTICE:'中标公示', POLICY:'政策法规', PLATFORM:'平台通知' };
    const summary = await this.announcementAiService.summarize({
      title: ann.title,
      type: typeMap[ann.type] ?? ann.type,
      content: ann.content,
    });
    if (!summary) throw new BadRequestException({ error: 'AI 摘要生成失败，请确认 DeepSeek API Key 已配置且网络可达', code: 'AI_FAILED' });
    await this.announcementService.update(id, { summary } as any);
    return { summary };
  }

  @Delete(':id')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '删除公告' })
  async remove(@Param('id') id: string) {
    return this.announcementService.remove(id);
  }
}
