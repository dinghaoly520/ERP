import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Res, ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupplierPortalService } from './supplier-portal.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
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
    @Body() dto: Partial<CreateContactDto>,
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

  // ─── Bid Projects (招标机会) ───

  @Get('bid-projects')
  async listBidProjects() {
    return this.portalService.listBidProjects();
  }

  @Get('bid-projects/:id')
  async getBidProject(@Param('id') id: string) {
    return this.portalService.getBidProject(id);
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
    @Body() body: { bidPrice?: string; deliveryPeriod?: string; technicalFile?: string; businessFile?: string; coverLetter?: string },
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.saveBidDraft(supplierId, projectId, body);
  }

  @Post('bid-submissions/:projectId/submit')
  async submitBid(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: { bidPrice?: string; deliveryPeriod?: string; technicalFile?: string; businessFile?: string; coverLetter?: string },
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.submitBid(supplierId, projectId, body);
  }

  @Post('bid-submissions/:submissionId/withdraw')
  async withdrawSubmission(@Request() req: any, @Param('submissionId') submissionId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.withdrawSubmission(supplierId, submissionId);
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
  async downloadBidDocument(@Request() req: any, @Param('announcementId') announcementId: string, @Res() res: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    const { buffer, fileName, mimeType } = await this.bidDocumentService.downloadForSupplier(announcementId, supplierId);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.end(buffer);
  }
}
