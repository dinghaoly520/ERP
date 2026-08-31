import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Request, Res, UseInterceptors, UploadedFile, UploadedFiles, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { SupplierPortalService } from './supplier-portal.service';
import { TenderClarificationService } from '../tender-clarification/tender-clarification.service';
import { AskClarificationDto } from '../tender-clarification/dto/ask-clarification.dto';
import { BidDocumentService } from '../announcement/bid-document.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { UpdateContactDto } from '../supplier/dto/update-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
import { ConvertToRegularDto } from './dto/convert-to-regular.dto';
import { SaveBidDraftDto, SubmitBidDto } from './dto/bid-submission.dto';
import { OpeningConfirmDto } from './dto/opening-confirm.dto';
import type { EnvelopeRole } from '@water-erp/ukey';
import { ReactivateDto } from './dto/reactivate.dto';
import { ClarificationReplyDraftDto, SubmitClarificationReplyDto } from './dto/clarification-reply.dto';
import { CreateCatalogApplicationDto, UpdateCatalogApplicationDto } from './dto/catalog-application.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ObjectionService } from './objection.service';
import { PrequalService } from '../prequal/prequal.service';
import { FrameworkService } from '../framework/framework.service';
import { PerformanceService } from '../performance/performance.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('supplier-portal')
@Roles('supplier')
export class SupplierPortalController {
  constructor(
    private portalService: SupplierPortalService,
    private prisma: PrismaService,
    private bidDocumentService: BidDocumentService,
    private clarifications: TenderClarificationService,
    private objectionService: ObjectionService,
    private prequalService: PrequalService,
    private frameworkService: FrameworkService,
    private performanceService: PerformanceService,
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

  /** A-80：供应商就招标文件提出澄清问题（须已下载、截止前 10 日窗口） */
  /** W11-①（A-101）：取投标回执待签负载（canonical 字符串供 U盾签名） */
  @Get('bid-submissions/:submissionId/receipt-payload')
  async getReceiptPayload(@Param('submissionId') submissionId: string, @Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getReceiptPayloadFor(submissionId, supplierId);
  }

  /** W11-①（A-101）：提交回执 SM2 签名（服务端验签存档，幂等） */
  @Post('bid-submissions/:submissionId/receipt-signature')
  async signReceipt(@Param('submissionId') submissionId: string, @Body() body: { signature: string }, @Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.signSubmissionReceipt(submissionId, supplierId, body?.signature ?? '');
  }

  @Post('projects/:id/clarifications')
  async askClarification(
    @Param('id') id: string,
    @Body() dto: AskClarificationDto,
    @Request() req: any,
  ) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: req.user.sub },
      select: { id: true, name: true },
    });
    if (!supplier) throw new ForbiddenException('非供应商账号');
    return this.clarifications.askQuestion(id, supplier, dto);
  }

  /** A-85/A-86：下载澄清文件（下载即回执） */
  @Post('projects/:id/clarification-docs/:docId/download')
  async downloadClarificationDoc(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Request() req: any,
  ) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: req.user.sub },
      select: { id: true, name: true },
    });
    if (!supplier) throw new ForbiddenException('非供应商账号');
    return this.clarifications.downloadDoc(id, docId, supplier);
  }

  /** 供应商视角澄清问答+澄清文件列表（Task 7 实装） */
  @Get('projects/:id/clarifications')
  async listClarifications(@Param('id') id: string, @Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.clarifications.listForSupplier(id, supplierId);
  }

  // ─── A-143：评标澄清在线答复（编辑+附件+SM2 电子签名）───

  /** 寻址本司的评标澄清列表（仅本人可见；EVALUATING 可答，ARCHIVED 只读） */
  @Get('projects/:id/bid-clarifications')
  async listBidClarifications(@Param('id') id: string, @Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listBidClarificationsForSupplier(id, supplierId);
  }

  /** 取待签 canonical 串（前端 U盾直接对此串签名；无状态） */
  @Post('projects/:id/bid-clarifications/:cid/reply-payload')
  async getClarificationReplyPayload(
    @Param('id') id: string, @Param('cid') cid: string,
    @Body() dto: ClarificationReplyDraftDto, @Request() req: any,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getClarificationReplyPayload(id, cid, supplierId, req.user, dto);
  }

  /** 提交签名答复（服务端重算 canonical + SM2 验签 + 归档 + WS） */
  @Post('projects/:id/bid-clarifications/:cid/reply')
  async submitClarificationReply(
    @Param('id') id: string, @Param('cid') cid: string,
    @Body() dto: SubmitClarificationReplyDto, @Request() req: any,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.submitClarificationReply(id, cid, supplierId, req.user, dto);
  }

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

  // ─── CA 证书绑定（双信封 v2：DN↔企业名校验）───

  // 管理方加密证书公钥公开端点（投递端取用；类级 @Roles('supplier') 已覆盖）
  @Get('admin-cert')
  async getAdminCert() {
    return this.portalService.getActiveAdminCert();
  }

  @Get('profile/cert')
  async listMyCerts(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listMyCerts(supplierId);
  }

  @Post('profile/cert')
  async bindCert(
    @Request() req: any,
    @Body() body: { certSn: string; certDn: string; publicKey: string; alg?: string },
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.bindCert(supplierId, body);
  }

  @Delete('profile/cert/:id')
  async revokeCert(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.revokeCert(supplierId, id);
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

  // ─── C6：异议/投诉（GB/T 43711 4.2.2 供应商在线提交）───

  @Get('objections')
  async listMyObjections(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.objectionService.listMine(supplierId);
  }

  @Post('objections')
  async createObjection(@Request() req: any, @Body() dto: { announcementId?: string; projectCode?: string; phase: string; title: string; content: string; attachments?: any }) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: req.user.sub },
      select: { id: true, name: true, userId: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
    return this.objectionService.create(dto, supplier);
  }

  // ─── B3：资格预审（GB/T 43711 7.2.3 供应商侧）───

  @Get('prequals')
  async listPrequals(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.prequalService.listForSupplier(supplierId);
  }

  @Post('prequals/:id/apply')
  async applyPrequal(@Request() req: any, @Param('id') id: string, @Body() dto: { note?: string }) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: req.user.sub },
      select: { id: true, name: true, userId: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
    return this.prequalService.apply(id, supplier, dto.note);
  }

  // ─── E1（第 9.2 条）：供应商满意度简表 ───

  @Post('satisfaction')
  async submitSatisfaction(@Request() req: any, @Body() dto: { projectCode: string; score: number; comment?: string }) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: req.user.sub },
      select: { id: true, name: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
    return this.performanceService.submitSatisfaction(supplier, dto);
  }

  // ─── B4：我的框架协议（GB/T 43711 附录 D 供应商侧）───

  @Get('framework-agreements')
  async myFrameworks(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.frameworkService.listForSupplier(supplierId);
  }

  // ─── C3：我的合同（GB/T 43711 7.5.4/7.6 供应商侧）───

  @Get('contracts')
  async myContracts(@Request() req: any) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.prisma.contract.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
    });
  }

  /** 供应商上传履约/验收证明（先走 /upload 拿 fileAssetId，再挂到履行节点） */
  @Post('contracts/:id/fulfillments/:fid/proof')
  async attachFulfillmentProof(@Request() req: any, @Param('id') id: string, @Param('fid') fid: string, @Body() dto: { proofAssetId: string }) {
    const supplierId = await this.getSupplierId(req.user.sub);
    const contract = await this.prisma.contract.findFirst({ where: { id, supplierId }, select: { id: true } });
    if (!contract) throw new BadRequestException({ error: '合同不存在', code: 'NOT_FOUND' });
    if (!dto.proofAssetId) throw new BadRequestException({ error: '缺少证明文件', code: 'BAD_PARAMS' });
    return this.prisma.contractFulfillment.update({
      where: { id: fid },
      data: { proofAssetId: dto.proofAssetId },
    });
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
  async getBidProject(@Request() req: any, @Param('id') id: string) {
    return this.portalService.getBidProject(id, await this.getSupplierId(req.user?.sub));
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

  // A-94：草稿/递交 body 由 DTO 做 class-validator 格式校验（whitelist 防字段注入/剥落见 dto 注释）
  @Post('bid-submissions/:projectId/draft')
  async saveBidDraft(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: SaveBidDraftDto,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.saveBidDraft(supplierId, projectId, dto);
  }

  /** A-88：删除未递交的投标草稿（已提交走撤回） */
  @Delete('bid-submissions/:projectId/draft')
  async deleteBidDraft(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.deleteBidDraft(supplierId, projectId);
  }

  // A-94：递交在草稿字段之上增加双信封 v2 信封与证书签名（服务层验签）
  @Post('bid-submissions/:projectId/submit')
  async submitBid(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: SubmitBidDto,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.submitBid(supplierId, projectId, dto);
  }

  // ─── 新轨补传（双信封 v2：解密异常恢复由供应商端双层重封，Task 10）───
  // file 字段收的是新 C_outer 密文（客户端重新双层加密产物，非明文）；envelope 为整体新信封 JSON string。
  @Post('bid-submissions/:projectId/reupload-dual')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 旧轨 reupload 5/min 同款，防刷拦截路径灌监督日志
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async reuploadDual(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { role: string; envelope: string; signature?: string; ciphertextSha256?: string },
  ) {
    if (!file) throw new BadRequestException({ error: '请选择文件', code: 'NO_FILE' });
    if (!body?.role || !body?.envelope) {
      throw new BadRequestException({ error: '缺少 role 或 envelope 参数', code: 'MISSING_PARAMS' });
    }
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.reuploadDualEnvelope(supplierId, projectId, {
      role: body.role,
      envelopeJson: body.envelope,
      signature: body.signature,
      ciphertext: file.buffer,
      ciphertextSha256: body.ciphertextSha256,
    });
  }

  @Post('bid-submissions/:submissionId/withdraw')
  async withdrawSubmission(@Request() req: any, @Param('submissionId') submissionId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.withdrawSubmission(supplierId, submissionId);
  }

  // ─── 双信封 v2 开标解密（Task 13：供应商解内层）───

  /** 取开标解密包：C_inner 下载凭证 + K_self + sealedFields + 窗口状态（记 packageFetchedAt 归因锚点） */
  @Get('bid-submissions/:projectId/opening-package')
  async getOpeningPackage(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getOpeningPackage(supplierId, projectId);
  }

  /** 解密上传：各角色解密明文（file_* 四文件 optional）+ F+nonce 承诺（fieldsJson/nonce）——服务端双闸校验 */
  @Post('bid-submissions/:projectId/decrypt-upload')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // reupload-dual 同款防刷（审查 fix round 1）
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'file_technical', maxCount: 1 },
    { name: 'file_business', maxCount: 1 },
    { name: 'file_coverLetter', maxCount: 1 },
    { name: 'file_bond', maxCount: 1 },
  ], { limits: { fileSize: 50 * 1024 * 1024 } }))
  async decryptUpload(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @UploadedFiles() uploaded: {
      file_technical?: Express.Multer.File[];
      file_business?: Express.Multer.File[];
      file_coverLetter?: Express.Multer.File[];
      file_bond?: Express.Multer.File[];
    },
    @Body() body: { fieldsJson?: string; nonce?: string },
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    const FIELD_ROLE_MAP: ReadonlyArray<readonly [string, EnvelopeRole]> = [
      ['file_technical', 'technical'],
      ['file_business', 'business'],
      ['file_coverLetter', 'coverLetter'],
      ['file_bond', 'bond'],
    ];
    const files: Partial<Record<EnvelopeRole, Buffer>> = {};
    for (const [field, role] of FIELD_ROLE_MAP) {
      const f = (uploaded as any)?.[field]?.[0] as Express.Multer.File | undefined;
      if (f) files[role] = f.buffer;
    }
    return this.portalService.decryptUpload(supplierId, projectId, files, body?.fieldsJson ?? '', body?.nonce ?? '');
  }

  // ─── 开标确认（供应商侧）───

  @Get('bid-submissions/:projectId/opening-record')
  async getMyOpeningRecord(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getMyOpeningRecord(supplierId, projectId);
  }

  @Get('bid-submissions/:projectId/opening-records')
  async listOpeningRecords(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listOpeningRecords(supplierId, projectId);
  }

  /** W-A114：取开标确认待签负载（记录待确认，或已确认未签名供补签） */
  @Get('bid-submissions/:projectId/opening-confirm-payload')
  async getOpeningConfirmPayload(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.getOpeningConfirmPayload(supplierId, projectId);
  }

  // A-114：确认/补签单端点双语义（purpose 由记录态派生）——body 签名必填（DTO whitelist 防剥落）
  @Post('bid-submissions/:projectId/opening-confirm')
  async confirmOpening(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: OpeningConfirmDto,
  ) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.confirmOpening(supplierId, projectId, dto.signature);
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
    // W9-②（A-215）：黑名单主体禁止下载招标文件
    const self = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { status: true } });
    if (self?.status === 'BLACKLIST') {
      throw new ForbiddenException({ error: '贵单位已被列入黑名单，无法获取招标文件', code: 'SUPPLIER_BLACKLISTED' });
    }
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
  async createCatalogApplication(@Request() req: any, @Body() body: CreateCatalogApplicationDto) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.createCatalogApplication(supplierId, body);
  }

  @Patch('catalog-applications/:id')
  async updateCatalogApplication(@Request() req: any, @Param('id') id: string, @Body() body: UpdateCatalogApplicationDto) {
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
