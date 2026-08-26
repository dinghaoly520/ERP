import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Request, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import { CatalogAdminListQueryDto, CatalogItemAdminDto, CatalogStatusDto, CreateCatalogCategoryDto, UpdateCatalogCategoryDto, MoveCategoryDto, CreateAttributeTemplateDto, UpdateAttributeTemplateDto, SetItemAttributesDto, CreateAlertRuleDto, UpdateAlertRuleDto, CreateVersionDto, ChangeVersionStatusDto, CreateInquiryDto, CreateContractPriceDto, UpdateContractPriceDto, CreateItemRelationDto, SearchLogDto, CreateAttachmentDto, AiClassifyDto, ReviewApplicationDto } from './dto';

@ApiTags('采购目录')
@ApiCookieAuth('token')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @Roles('admin', 'leader', 'staff', 'mall')
  @ApiOperation({ summary: '采购目录列表' })
  async list(@Query() query: CatalogAdminListQueryDto, @Request() req: any) {
    return this.catalogService.list(query, req.user?.role);
  }

  // ── Admin endpoints (must be static routes before dynamic :id routes) ──

  @Get('admin/stats')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '电子商城目录管理统计' })
  async adminStats() {
    return this.catalogService.stats();
  }

  @Post('admin/items')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '管理端新增目录' })
  async createAdminItem(@Request() req: any, @Body() dto: CatalogItemAdminDto) {
    return this.catalogService.createAdminItem(req.user.sub, dto);
  }

  // static route：须先于 admin/items/:id/* 动态路由注册
  @Post('admin/items/ai-classify')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: 'AI 自动分类 + 属性预填（仅返回建议，不写库）' })
  async aiClassify(@Body() dto: AiClassifyDto) {
    return this.catalogService.aiClassify(dto);
  }

  @Patch('admin/items/:id')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '管理端编辑目录' })
  async updateAdminItem(@Request() req: any, @Param('id') id: string, @Body() dto: CatalogItemAdminDto) {
    return this.catalogService.updateAdminItem(req.user.sub, id, dto);
  }

  @Patch('admin/items/:id/status')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '管理端变更目录状态' })
  async changeStatus(@Request() req: any, @Param('id') id: string, @Body() dto: CatalogStatusDto) {
    return this.catalogService.changeStatus(req.user.sub, id, dto);
  }

  @Get('admin/import-template')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '下载电子商城目录导入模板' })
  async importTemplate(@Request() req: any, @Res() res: Response) {
    const buf = await this.catalogService.importTemplate(req.user.sub);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('电子商城目录导入模板.xlsx')}`,
    });
    res.end(buf);
  }

  @Post('admin/import')
  @Roles('admin', 'leader', 'staff')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: '导入电子商城目录' })
  async importItems(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.catalogService.importItems(req.user.sub, file);
  }

  @Get('admin/audit-logs')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '电子商城管理操作日志' })
  async adminAuditLogs() {
    return this.catalogService.adminAuditLogs();
  }

  // ── 品类树管理 ──

  @Get('categories/tree')
  @Roles('admin', 'leader', 'staff', 'mall')
  @ApiOperation({ summary: '获取完整品类树' })
  async categoryTree() {
    return this.catalogService.getCategoryTree();
  }

  @Get('categories/:id')
  @Roles('admin', 'leader', 'staff', 'mall')
  @ApiOperation({ summary: '获取品类节点详情' })
  async categoryDetail(@Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.getCategory(id);
  }

  @Post('admin/categories')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '创建品类节点' })
  async createCategory(@Request() req: any, @Body() dto: CreateCatalogCategoryDto) {
    return this.catalogService.createCategory(req.user.sub, dto);
  }

  @Patch('admin/categories/:id')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '更新品类节点' })
  async updateCategory(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: UpdateCatalogCategoryDto) {
    return this.catalogService.updateCategory(req.user.sub, id, dto);
  }

  @Delete('admin/categories/:id')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '删除品类节点' })
  async deleteCategory(@Request() req: any, @Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.deleteCategory(req.user.sub, id);
  }

  @Patch('admin/categories/:id/sort')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '移动品类节点' })
  async moveCategory(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: MoveCategoryDto) {
    return this.catalogService.moveCategory(req.user.sub, id, dto);
  }

  @Patch('admin/categories/:id/status')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '启用/停用品类节点' })
  async toggleCategoryStatus(@Request() req: any, @Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.toggleCategoryStatus(req.user.sub, id);
  }

  // ── 属性模板 ──

  @Get('categories/:id/attribute-templates')
  @Roles('admin', 'leader', 'staff', 'mall')
  @ApiOperation({ summary: '获取品类的属性模板列表' })
  async categoryAttributeTemplates(@Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.getCategory(id);
  }

  @Post('admin/categories/:id/attribute-templates')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '新增属性模板' })
  async createAttributeTemplate(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: CreateAttributeTemplateDto) {
    return this.catalogService.createAttributeTemplate(req.user.sub, id, dto);
  }

  @Patch('admin/attribute-templates/:id')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '更新属性模板' })
  async updateAttributeTemplate(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: UpdateAttributeTemplateDto) {
    return this.catalogService.updateAttributeTemplate(req.user.sub, id, dto);
  }

  @Delete('admin/attribute-templates/:id')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '删除属性模板' })
  async deleteAttributeTemplate(@Request() req: any, @Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.deleteAttributeTemplate(req.user.sub, id);
  }

  // ── 目录项属性值 ──

  @Patch('admin/items/:id/attributes')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '设置目录项属性值' })
  async setItemAttributes(@Param('id') id: string, @Body() body: SetItemAttributesDto) {
    return this.catalogService.setItemAttributes(id, body.attributes);
  }

  @Get('admin/items/:id/ai-price-analysis')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '价格异常 AI 研判（LLM 挂时降级为 analysis:null）' })
  async aiPriceAnalysis(@Param('id') id: string) {
    return this.catalogService.aiPriceAnalysis(id);
  }

  // ── 价格预警 ──

  @Get('admin/alert-rules') @Roles('admin', 'leader', 'staff') async listAlertRules() { return this.catalogService.listAlertRules(); }
  @Post('admin/alert-rules') @Roles('admin', 'leader', 'staff') async createAlertRule(@Body() dto: CreateAlertRuleDto) { return this.catalogService.createAlertRule(dto); }
  @Patch('admin/alert-rules/:id') @Roles('admin', 'leader', 'staff') async updateAlertRule(@Param('id', new ParseIntPipe()) id: number, @Body() dto: UpdateAlertRuleDto) { return this.catalogService.updateAlertRule(id, dto); }
  @Delete('admin/alert-rules/:id') @Roles('admin', 'leader', 'staff') async deleteAlertRule(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.deleteAlertRule(id); }
  @Patch('admin/alert-rules/:id/toggle') @Roles('admin', 'leader', 'staff') async toggleAlertRule(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.toggleAlertRule(id); }
  @Get('admin/alerts') @Roles('admin', 'leader', 'staff') async listAlerts(@Query('isRead') isRead?: string, @Query('isResolved') isResolved?: string) { return this.catalogService.listAlerts({ isRead: isRead !== undefined ? isRead === 'true' : undefined, isResolved: isResolved !== undefined ? isResolved === 'true' : undefined }); }
  @Patch('admin/alerts/:id/read') @Roles('admin', 'leader', 'staff') async markAlertRead(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.markAlertRead(id); }
  @Patch('admin/alerts/:id/resolve') @Roles('admin', 'leader', 'staff') async markAlertResolved(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.markAlertResolved(id); }
  // static route：手动触发预警评估（便于验证与按需生成），须先于任何 admin/alerts/:id 的 POST 动态路由（当前无）
  @Post('admin/alerts/evaluate') @Roles('admin', 'leader', 'staff') async evaluateAlerts() { return this.catalogService.evaluateAlertRules(); }

  // ── 目录版本 ──

  @Get('admin/versions') @Roles('admin', 'leader', 'staff') async listVersions() { return this.catalogService.listVersions(); }
  // static route MUST precede the dynamic :id route, otherwise `compare` is captured by :id and fails ParseIntPipe
  @Get('admin/versions/compare') @Roles('admin', 'leader', 'staff') async compareVersions(@Query('a', new ParseIntPipe()) a: number, @Query('b', new ParseIntPipe()) b: number) { return this.catalogService.compareVersions(a, b); }
  @Get('admin/versions/:id') @Roles('admin', 'leader', 'staff') async getVersion(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.getVersion(id); }
  @Post('admin/versions') @Roles('admin', 'leader', 'staff') async createVersion(@Request() req: any, @Body() dto: CreateVersionDto) { return this.catalogService.createVersion(req.user.sub, dto); }
  @Patch('admin/versions/:id/status') @Roles('admin', 'leader', 'staff') async changeVersionStatus(@Param('id', new ParseIntPipe()) id: number, @Body() dto: ChangeVersionStatusDto) { return this.catalogService.changeVersionStatus(id, dto.status); }

  // ── 询价 ──

  @Get('admin/inquiries') @Roles('admin', 'leader', 'staff') async listInquiries() { return this.catalogService.listInquiries(); }
  @Post('admin/inquiries') @Roles('admin', 'leader', 'staff') async createInquiry(@Request() req: any, @Body() dto: CreateInquiryDto) { return this.catalogService.createInquiry(req.user.sub, dto); }

  // ── 合同价格 ──

  @Get('admin/contract-prices') @Roles('admin', 'leader', 'staff') async listContractPrices(@Query('catalogItemId') catalogItemId?: string, @Query('supplierId') supplierId?: string) { return this.catalogService.listContractPrices({ catalogItemId, supplierId }); }
  @Post('admin/contract-prices') @Roles('admin', 'leader', 'staff') async createContractPrice(@Body() dto: CreateContractPriceDto) { return this.catalogService.createContractPrice(dto); }
  @Patch('admin/contract-prices/:id') @Roles('admin', 'leader', 'staff') async updateContractPrice(@Param('id', new ParseIntPipe()) id: number, @Body() dto: UpdateContractPriceDto) { return this.catalogService.updateContractPrice(id, dto); }

  // ── 供应商维度 ──

  @Get('admin/supplier-coverage') @Roles('admin', 'leader', 'staff') async supplierCoverage() { return this.catalogService.supplierCoverage(); }
  @Get('admin/supplier-price-comparison') @Roles('admin', 'leader', 'staff') async supplierPriceComparison(@Query('categoryId') categoryId?: string) { return this.catalogService.supplierPriceComparison(categoryId ? Number(categoryId) : undefined); }

  // ── 目录项关联 ──

  @Get('items/:id/relations') @Roles('admin', 'leader', 'staff', 'mall') async listItemRelations(@Param('id') id: string, @Request() req: any) { return this.catalogService.listItemRelations(id, req.user?.role); }
  @Post('admin/items/:id/relations') @Roles('admin', 'leader', 'staff') async createItemRelation(@Request() req: any, @Param('id') id: string, @Body() dto: CreateItemRelationDto) { return this.catalogService.createItemRelation(req.user.sub, id, dto); }
  @Delete('admin/items/:id/relations/:relationId') @Roles('admin', 'leader', 'staff') async deleteItemRelation(@Param('relationId', new ParseIntPipe()) relationId: number) { return this.catalogService.deleteItemRelation(relationId); }

  // ── 供应商目录供货申请（管理员审核）──

  @Get('applications')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '供货申请审核列表' })
  async applications(@Query('status') status?: string, @Query('type') type?: string) {
    return this.catalogService.listApplications({ status, type });
  }

  @Get('applications/:id')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '供货申请详情' })
  async application(@Param('id') id: string) {
    return this.catalogService.getApplication(id);
  }

  @Post('applications/:id/review')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '审核供货申请（通过/拒绝/退回/议价）' })
  async review(@Request() req: any, @Param('id') id: string, @Body() dto: ReviewApplicationDto) {
    return this.catalogService.reviewApplication(req.user.sub, id, dto);
  }

  @Get('items/:itemId/suppliers')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '某目录条目的准入供应商（含报价）' })
  async itemSuppliers(@Param('itemId') itemId: string) {
    return this.catalogService.listItemSuppliers(itemId);
  }

  // ── Public / shared endpoints ──

  @Get('suppliers')
  @Roles('admin', 'leader', 'staff', 'mall')
  @ApiOperation({ summary: '供应商维度聚合（目录内）' })
  async suppliers(@Request() req: any) {
    return this.catalogService.listSuppliers(req.user?.role);
  }

  @Get('favorites')
  @Roles('mall')
  @ApiOperation({ summary: '我的收藏目录' })
  async favorites(@Request() req: any) {
    return this.catalogService.listFavorites(req.user.sub, req.user?.role);
  }

  @Get('export')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '导出采购目录 Excel（仅内部管理角色；供应商价格已脱敏，但全量目录清单收紧到管理端）' })
  async exportCatalog(
    @Request() req: any,
    @Res() res: Response,
    @Query('category') category?: string,
    @Query('region') region?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
  ) {
    const buf = await this.catalogService.exportCatalog(req.user.sub, { category, region, status, source, search }, req.user?.role);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('采购目录-' + new Date().toISOString().slice(0, 10) + '.xlsx')}`,
    });
    res.end(buf);
  }

  @Post(':id/favorite')
  @Roles('mall')
  @ApiOperation({ summary: '收藏 / 取消收藏' })
  async toggleFavorite(@Request() req: any, @Param('id') id: string) {
    return this.catalogService.toggleFavorite(req.user.sub, id);
  }

  @Get(':id/history')
  @Roles('admin', 'leader', 'staff', 'mall')
  @ApiOperation({ summary: '采购目录价格历史' })
  async history(@Param('id') id: string, @Request() req: any) {
    return this.catalogService.getHistory(id, req.user?.role);
  }

  // ── 新增端点：仪表盘 / 预测 / 附件 / 搜索 / 订阅 / 比价雷达 ──

  @Get('admin/dashboard-stats') @Roles('admin', 'leader', 'staff') async dashboardStats() { return this.catalogService.dashboardStats(); }

  // 价格预测/附件含敏感价格与合同材料：与 history/suppliers 一致收口为内部+mall，排除 supplier
  @Get(':id/prediction') @Roles('admin', 'leader', 'staff', 'mall') async prediction(@Param('id') id: string) { return this.catalogService.pricePrediction(id); }
  @Get(':id/attachments') @Roles('admin', 'leader', 'staff', 'mall') async attachments(@Param('id') id: string) { return this.catalogService.listAttachments(id); }

  @Post('admin/search-log') @Roles('admin', 'leader', 'staff') async logSearch(@Request() req: any, @Body() dto: SearchLogDto) { return this.catalogService.logSearch(dto.keyword, req.user?.sub); }
  @Get('admin/search-insights') @Roles('admin', 'leader', 'staff') async searchInsights() { return this.catalogService.searchInsights(); }

  @Post('admin/items/:id/attachments') @Roles('admin', 'leader', 'staff') async uploadAttachment(@Param('id') id: string, @Body() dto: CreateAttachmentDto) { return this.catalogService.createAttachment(id, dto.fileName, dto.fileUrl, dto.fileType, dto.fileSize); }
  @Delete('admin/attachments/:id') @Roles('admin', 'leader', 'staff') async deleteAttachment(@Param('id') id: string) { return this.catalogService.deleteAttachment(id); }

  @Post(':id/subscribe') @Roles('admin', 'leader', 'staff') async subscribe(@Request() req: any, @Param('id') id: string) { return this.catalogService.subscribe(req.user.sub, id); }
  @Delete(':id/subscribe') @Roles('admin', 'leader', 'staff') async unsubscribe(@Request() req: any, @Param('id') id: string) { return this.catalogService.unsubscribe(req.user.sub, id); }
  @Get('admin/subscriptions') @Roles('admin', 'leader', 'staff') async subscriptions(@Request() req: any) { return this.catalogService.listSubscriptions(req.user.sub); }

  @Get('admin/price-radar') @Roles('admin', 'leader', 'staff') async priceRadar(@Query('categoryId') categoryId?: string) { return this.catalogService.priceRadar(categoryId ? Number(categoryId) : undefined); }

  @Get(':id')
  @Roles('admin', 'leader', 'staff', 'mall')
  @ApiOperation({ summary: '采购目录详情' })
  async get(@Param('id') id: string, @Request() req: any) {
    return this.catalogService.get(id, req.user?.role);
  }
}
