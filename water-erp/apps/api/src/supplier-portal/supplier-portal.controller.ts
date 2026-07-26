import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request, Res, ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupplierPortalService } from './supplier-portal.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { UpdateContactDto } from '../supplier/dto/update-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ConvertToRegularDto } from './dto/convert-to-regular.dto';
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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('scope') scope?: string,
  ) {
    return this.portalService.listBidProjects(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
      { search, scope },
    );
  }

  @Get('bid-projects/:id')
  async getBidProject(@Param('id') id: string) {
    return this.portalService.getBidProject(id);
  }

  @Get('bid-projects/:id/bid-document')
  async getBidProjectDocument(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getBidProjectDocument(id, supplierId);
  }

  // ─── 澄清答疑 ───

  @Post('bid-projects/:id/questions')
  async createQuestion(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateQuestionDto,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.createQuestion(supplierId, id, dto);
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
}
