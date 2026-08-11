import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request, Res, ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupplierPortalService } from './supplier-portal.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { UpdateContactDto } from '../supplier/dto/update-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
import { ConvertToRegularDto } from './dto/convert-to-regular.dto';
import { ReactivateDto } from './dto/reactivate.dto';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('supplier-portal')

export class SupplierPortalController {
  constructor(
    private portalService: SupplierPortalService,
    private prisma: PrismaService,
    private bidDocumentService: BidDocumentService,
  ) {}

  private async getSupplierId(userId: string): Promise<string> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
    return supplier.id;
  }

  // ─── Profile ───

  @Get('profile')
  async getProfile(@Request() req: any) {
    return this.portalService.getMyProfile(req.user.sub);
  }

  @Get('status')
  async getStatus(@Request() req: any) {
    return this.portalService.getMyStatus(req.user.sub);
  }

  @Get('dashboard-stats')
  async getDashboardStats(@Request() req: any) {
    return this.portalService.getDashboardStats(req.user.sub);
  }

  // ─── Contacts ───

  @Get('contacts')
  async listContacts(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listContacts(supplierId);
  }

  @Post('contacts')
  async addContact(@Request() req: any, @Body() dto: CreateContactDto) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.addContact(supplierId, dto);
  }

  @Put('contacts/:contactId')
  async updateContact(
    @Request() req: any,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.updateContact(supplierId, contactId, dto);
  }

  @Delete('contacts/:contactId')
  async deleteContact(@Request() req: any, @Param('contactId') contactId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.deleteContact(supplierId, contactId);
  }

  // ─── Qualifications ───

  @Get('qualifications')
  async listQualifications(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listQualifications(supplierId);
  }

  @Post('qualifications')
  async addQualification(@Request() req: any, @Body() dto: CreateQualificationDto) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.addQualification(supplierId, dto);
  }

  @Delete('qualifications/:qualificationId')
  async deleteQualification(@Request() req: any, @Param('qualificationId') qualificationId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.deleteQualification(supplierId, qualificationId);
  }

  // ─── Change Requests ───

  @Get('change-records')
  async listChangeRecords(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listChangeRecords(supplierId);
  }

  @Post('change-requests')
  async createChangeRequest(@Request() req: any, @Body() dto: CreateChangeRequestDto) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.createChangeRequest(supplierId, req.user.sub, dto);
  }

  @Post('convert-request')
  async convertToRegular(@Request() req: any, @Body() dto: ConvertToRegularDto) {
    return this.portalService.convertToRegular(req.user.sub, dto);
  }

  @Post('reactivate')
  @Public()
  async reactivate(@Body() dto: ReactivateDto) {
    return this.portalService.reactivateTemporary(dto);
  }

  // ─── Evaluations ───

  @Get('evaluations')
  async listEvaluations(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listMyEvaluations(supplierId);
  }

  @Get('evaluation-stats')
  async getEvaluationStats(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getEvaluationStats(supplierId);
  }

  // ─── Bid Projects (投标机会) ───

  @Get('bid-projects')
  async listBidProjects(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('scope') scope?: string,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub).catch(() => undefined);
    return this.portalService.listBidProjects(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
      { search, scope },
      supplierId,
    );
  }

  @Get('bid-projects/:id')
  async getBidProject(@Param('id') id: string) {
    return this.portalService.getBidProject(id);
  }

  @Get('bid-projects/:id/overview')
  async getBidProjectOverview(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getBidProjectOverview(id, supplierId);
  }

  @Get('bid-projects/:id/bid-document')
  async getBidProjectDocument(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getBidProjectDocument(id, supplierId);
  }

  @Get('bid-projects/:id/negotiation-files')
  async getNegotiationFiles(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getNegotiationFiles(id, supplierId);
  }

  // ─── Bid Submissions ───

  @Get('bid-submissions')
  async listBidSubmissions(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getMySubmissions(supplierId);
  }

  @Get('bid-submissions/:projectId')
  async getBidSubmission(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getSubmission(supplierId, projectId);
  }

  @Post('bid-submissions/:projectId/draft')
  async saveBidDraft(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: {
      bidPrice?: string; deliveryPeriod?: string;
      technicalFile?: string; businessFile?: string; coverLetter?: string;
      technicalFileAssetId?: string; businessFileAssetId?: string; coverLetterAssetId?: string;
      bidBondAssetId?: string;
      // P0-1：前端完整/拆分模型字段（服务层 normalizeBidFileAssets 归一到三角色契约）
      fullBidFileAssetId?: string; coverLetterFileAssetId?: string;
      splitFiles?: { tech?: any; biz?: any; other?: any };
      // E2EE
      clientDeks?: Record<string, string>;
    },
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.saveBidDraft(supplierId, projectId, body);
  }

  @Post('bid-submissions/:projectId/submit')
  async submitBid(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: {
      bidPrice?: string; deliveryPeriod?: string;
      technicalFile?: string; businessFile?: string; coverLetter?: string;
      technicalFileAssetId?: string; businessFileAssetId?: string; coverLetterAssetId?: string;
      bidBondAssetId?: string;
      // P0-1：前端完整/拆分模型字段（服务层 normalizeBidFileAssets 归一到三角色契约）
      fullBidFileAssetId?: string; coverLetterFileAssetId?: string;
      splitFiles?: { tech?: any; biz?: any; other?: any };
      // E2EE: 客户端加密密钥（assetId → "keyHex:ivHex:authTagHex"）
      clientDeks?: Record<string, string>;
    },
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.submitBid(supplierId, projectId, body);
  }

  @Post('bid-submissions/:submissionId/withdraw')
  async withdrawSubmission(@Request() req: any, @Param('submissionId') submissionId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.withdrawSubmission(supplierId, submissionId);
  }

  // ─── 开标确认（供应商侧）───

  @Get('bid-submissions/:projectId/opening-record')
  async getMyOpeningRecord(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getMyOpeningRecord(supplierId, projectId);
  }

  @Post('bid-submissions/:projectId/opening-confirm')
  async confirmOpening(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.confirmOpening(supplierId, projectId);
  }

  @Post('bid-submissions/:projectId/opening-dispute')
  async disputeOpening(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: { reason: string },
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.disputeOpening(supplierId, projectId, body.reason);
  }

  // ─── Password ───

  @Post('change-password')
  async changePassword(
    @Request() req: any,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    if (!body.oldPassword || !body.newPassword) {
      throw new BadRequestException({ error: '请填写完整信息', code: 'MISSING_FIELDS' });
    }
    if (body.newPassword.length < 6) {
      throw new BadRequestException({ error: '新密码不少于6位', code: 'INVALID_PASSWORD' });
    }
    return this.portalService.changePassword(req.user.sub, body.oldPassword, body.newPassword);
  }

  // ─── 招标文件（加密 + 受控下载）───

  @Get('bid-documents/:announcementId')
  async getBidDocument(@Request() req: any, @Param('announcementId') announcementId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.bidDocumentService.getForSupplier(announcementId, supplierId);
  }

  @Post('bid-documents/:announcementId/pay')
  async payBidDocument(@Request() req: any, @Param('announcementId') announcementId: string, @Body() body: { paymentRef?: string }) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.bidDocumentService.initiatePayment(announcementId, supplierId, body.paymentRef);
  }

  @Get('bid-documents/:announcementId/download')
  async downloadBidDocument(@Request() req: any, @Param('announcementId') announcementId: string, @Query('password') password: string | undefined, @Res() res: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    const { buffer, fileName, mimeType } = await this.bidDocumentService.downloadForSupplier(announcementId, supplierId, password);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.end(buffer);
  }

  // ─── 集中采购目录（脱敏浏览：仅品类，不含价格）───

  @Get('catalog/categories')
  async listCatalogCategories() {
    return this.portalService.listCatalogCategories();
  }

  @Get('catalog/items')
  async listCatalogItems(
    @Query('category') category?: string,
    @Query('group') group?: string,
    @Query('search') search?: string,
  ) {
    return this.portalService.listCatalogItems({ category, group, search });
  }

  @Get('catalog/items/:id')
  async getCatalogItem(@Param('id') id: string) {
    return this.portalService.getCatalogItem(id);
  }

  @Get('catalog/items/:id/supply-status')
  async getCatalogItemSupplyStatus(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getCatalogItemSupplyStatus(supplierId, id);
  }

  // ─── 目录供货申请 ───

  @Get('catalog-applications')
  async listMyCatalogApplications(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listMyCatalogApplications(supplierId);
  }

  @Post('catalog-applications')
  async createCatalogApplication(@Request() req: any, @Body() body: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.createCatalogApplication(supplierId, body);
  }

  @Patch('catalog-applications/:id')
  async updateCatalogApplication(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.updateMyCatalogApplication(supplierId, req.user.sub, id, body);
  }

  @Post('catalog-applications/:id/accept-counter')
  async acceptCatalogCounter(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.acceptCatalogCounter(supplierId, req.user.sub, id);
  }

  @Post('catalog-applications/:id/withdraw')
  async withdrawCatalogApplication(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.withdrawCatalogApplication(supplierId, req.user.sub, id);
  }

  // ─── 我的已准入供货关系 ───

  @Get('catalog-supply')
  async listMyCatalogSupply(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listMyCatalogSupply(supplierId);
  }

  // ─── A3: 中标通知书签收 ───

  @Get('award-letters')
  async listAwardLetters(@Request() req: any) {
    const supplierTableId = await this.getSupplierId(req.user.sub);
    // AwardLetterDelivery.supplierId = BidSupplier.id；需通过 BidSupplier 关联到 Supplier
    const bidSuppliers = await this.prisma.bidSupplier.findMany({
      where: { supplierId: supplierTableId },
      select: { id: true },
    });
    if (bidSuppliers.length === 0) return [];
    return this.prisma.awardLetterDelivery.findMany({
      where: { supplierId: { in: bidSuppliers.map(s => s.id) } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('award-letters/:id/sign')
  async signAwardLetter(@Request() req: any, @Param('id') id: string) {
    const record = await this.prisma.awardLetterDelivery.findUnique({ where: { id } });
    if (!record) throw new BadRequestException({ error: '通知书不存在', code: 'NOT_FOUND' });
    // 验证所有权：该 delivery 的 supplierId 必须属于当前供应商
    const supplierTableId = await this.getSupplierId(req.user.sub);
    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: record.supplierId, supplierId: supplierTableId },
    });
    if (!bidSupplier) throw new ForbiddenException({ error: '无权签收此通知书', code: 'FORBIDDEN' });

    return this.prisma.awardLetterDelivery.update({
      where: { id },
      data: { signedAt: new Date(), signedBy: req.user.sub, receivedAt: record.receivedAt ?? new Date() },
    });
  }

  @Post('award-letters/:id/received')
  async markAwardLetterReceived(@Request() req: any, @Param('id') id: string) {
    const supplierTableId = await this.getSupplierId(req.user.sub);
    const bidSuppliers = await this.prisma.bidSupplier.findMany({
      where: { supplierId: supplierTableId },
      select: { id: true },
    });
    const record = await this.prisma.awardLetterDelivery.findFirst({
      where: { id, supplierId: { in: bidSuppliers.map(s => s.id) } },
    });
    if (!record) throw new BadRequestException({ error: '通知书不存在', code: 'NOT_FOUND' });
    if (!record.receivedAt) {
      await this.prisma.awardLetterDelivery.update({ where: { id }, data: { receivedAt: new Date() } });
    }
    return { received: true };
  }

  // ─── P2c: 多轮报价(供应商端) ───

  @Get('projects/:projectId/my-bid-supplier')
  async getMyBidSupplier(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    const bs = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId },
      select: { id: true },
    });
    if (!bs) throw new BadRequestException({ error: '未参与该项目', code: 'NOT_PROJECT_MEMBER' });
    return bs;
  }

  @Get('projects/:projectId/rounds')
  async listProjectRounds(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    const member = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException({ error: '未参与该项目', code: 'NOT_PROJECT_MEMBER' });
    return this.prisma.bidRound.findMany({
      where: { projectId },
      orderBy: { roundNo: 'asc' },
      select: { id: true, roundNo: true, roundType: true, status: true, deadline: true },
    });
  }

  @Get('projects/:projectId/my-quotes')
  async getMyQuotes(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    const member = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException({ error: '未参与该项目', code: 'NOT_PROJECT_MEMBER' });
    return this.prisma.bidQuote.findMany({
      where: { bidSupplierId: member.id },
      select: { id: true, roundId: true, quotePrice: true, submittedAt: true, status: true },
      orderBy: { submittedAt: 'desc' },
    });
  }

  @Post('projects/:projectId/rounds/:roundId/quote')
  async submitQuote(@Request() req: any, @Param('projectId') projectId: string, @Param('roundId') roundId: string, @Body() body: { bidSupplierId: string; quotePrice: number }) {
    // 验证供应商属于该项目且属于当前登录用户
    const supplierTableId = await this.getSupplierId(req.user.sub);
    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: body.bidSupplierId, projectId, supplierId: supplierTableId },
    });
    if (!bidSupplier) throw new ForbiddenException({ error: '无权报价', code: 'FORBIDDEN' });

    // 验证轮次开放
    const round = await this.prisma.bidRound.findUnique({ where: { id: roundId } });
    if (!round || round.projectId !== projectId) throw new BadRequestException({ error: '轮次不存在', code: 'NOT_FOUND' });
    if (round.status !== 'open') throw new ForbiddenException({ error: '轮次不在开放状态', code: 'ROUND_NOT_OPEN' });
    if (round.deadline && new Date(round.deadline) < new Date()) throw new BadRequestException({ error: '报价已截止', code: 'ROUND_DEADLINE_PASSED' });

    // 校验供应商在轮次合格名单中（legacy 兼容：空数组=不限制）
    if (round.eligibleSupplierIds?.length > 0 && !round.eligibleSupplierIds.includes(body.bidSupplierId)) {
      throw new ForbiddenException({ error: '您不在本轮可参与名单中', code: 'NOT_ELIGIBLE_FOR_ROUND' });
    }
    // 废标供应商不可报价
    if (bidSupplier.bidValidity === 'invalid') {
      throw new ForbiddenException({ error: '已废标，不可报价', code: 'SUPPLIER_DISQUALIFIED' });
    }

    // C4: 严格一报制——try-create-catch（原子操作，消除 TOCTOU 竞态）
    try {
      return await this.prisma.bidQuote.create({
        data: { roundId, bidSupplierId: body.bidSupplierId, quotePrice: body.quotePrice },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException({ error: '本轮已提交报价，不可修改', code: 'ALREADY_QUOTED' });
      throw e;
    }
  }

  @Get('projects/:projectId/rounds/:roundId/quotes')
  async getRoundQuotes(@Request() req: any, @Param('projectId') projectId: string, @Param('roundId') roundId: string) {
    // 供应商只能看 published/closed 轮次的报价
    const round = await this.prisma.bidRound.findUnique({ where: { id: roundId } });
    if (!round || round.projectId !== projectId) return [];
    if (round.status !== 'published' && round.status !== 'closed') return [];
    const supplierId = await this.getSupplierId(req.user.sub);
    const myBidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId }, select: { id: true } });
    // M1: 脱敏——非 self 的 bidSupplierId 替换为序号，防止跨轮次关联竞争对手
    const quotes = await this.prisma.bidQuote.findMany({ where: { roundId }, orderBy: { quotePrice: 'asc' } });
    let seq = 0;
    return quotes.map(q => ({
      ...q,
      bidSupplierId: q.bidSupplierId === myBidSupplier?.id ? q.bidSupplierId : `competitor_${++seq}`,
    }));
  }
}
