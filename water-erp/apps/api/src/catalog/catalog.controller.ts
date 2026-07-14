import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Request, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import { CatalogAdminListQueryDto, CatalogItemAdminDto, CatalogStatusDto, CreateCatalogCategoryDto, UpdateCatalogCategoryDto, MoveCategoryDto, CreateAttributeTemplateDto, UpdateAttributeTemplateDto, SetItemAttributesDto } from './dto';

@ApiTags('采购目录')
@ApiCookieAuth('token')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiOperation({ summary: '采购目录列表' })
  async list(@Query() query: CatalogAdminListQueryDto) {
    return this.catalogService.list({
      category: query.category,
      region: query.region,
      status: query.status,
      source: query.source,
      search: query.search,
      includeInactive: query.includeInactive,
    });
  }

  // ── Admin endpoints (must be static routes before dynamic :id routes) ──

  @Get('admin/stats')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '电子商城目录管理统计' })
  async adminStats() {
    return this.catalogService.stats();
  }

  @Post('admin/items')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '管理端新增目录' })
  async createAdminItem(@Request() req: any, @Body() dto: CatalogItemAdminDto) {
    return this.catalogService.createAdminItem(req.user.sub, dto);
  }

  @Patch('admin/items/:id')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '管理端编辑目录' })
  async updateAdminItem(@Request() req: any, @Param('id') id: string, @Body() dto: CatalogItemAdminDto) {
    return this.catalogService.updateAdminItem(req.user.sub, id, dto);
  }

  @Patch('admin/items/:id/status')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '管理端变更目录状态' })
  async changeStatus(@Request() req: any, @Param('id') id: string, @Body() dto: CatalogStatusDto) {
    return this.catalogService.changeStatus(req.user.sub, id, dto);
  }

  @Get('admin/import-template')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
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
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: '导入电子商城目录' })
  async importItems(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.catalogService.importItems(req.user.sub, file);
  }

  @Get('admin/audit-logs')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '电子商城管理操作日志' })
  async adminAuditLogs() {
    return this.catalogService.adminAuditLogs();
  }

  // ── 品类树管理 ──

  @Get('categories/tree')
  @ApiOperation({ summary: '获取完整品类树' })
  async categoryTree() {
    return this.catalogService.getCategoryTree();
  }

  @Get('categories/:id')
  @ApiOperation({ summary: '获取品类节点详情' })
  async categoryDetail(@Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.getCategory(id);
  }

  @Post('admin/categories')
  @Roles('admin')
  @ApiOperation({ summary: '创建品类节点' })
  async createCategory(@Request() req: any, @Body() dto: CreateCatalogCategoryDto) {
    return this.catalogService.createCategory(req.user.sub, dto);
  }

  @Patch('admin/categories/:id')
  @Roles('admin')
  @ApiOperation({ summary: '更新品类节点' })
  async updateCategory(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: UpdateCatalogCategoryDto) {
    return this.catalogService.updateCategory(req.user.sub, id, dto);
  }

  @Delete('admin/categories/:id')
  @Roles('admin')
  @ApiOperation({ summary: '删除品类节点' })
  async deleteCategory(@Request() req: any, @Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.deleteCategory(req.user.sub, id);
  }

  @Patch('admin/categories/:id/sort')
  @Roles('admin')
  @ApiOperation({ summary: '移动品类节点' })
  async moveCategory(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: MoveCategoryDto) {
    return this.catalogService.moveCategory(req.user.sub, id, dto);
  }

  @Patch('admin/categories/:id/status')
  @Roles('admin')
  @ApiOperation({ summary: '启用/停用品类节点' })
  async toggleCategoryStatus(@Request() req: any, @Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.toggleCategoryStatus(req.user.sub, id);
  }

  // ── 属性模板 ──

  @Get('categories/:id/attribute-templates')
  @ApiOperation({ summary: '获取品类的属性模板列表' })
  async categoryAttributeTemplates(@Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.getCategory(id);
  }

  @Post('admin/categories/:id/attribute-templates')
  @Roles('admin')
  @ApiOperation({ summary: '新增属性模板' })
  async createAttributeTemplate(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: CreateAttributeTemplateDto) {
    return this.catalogService.createAttributeTemplate(req.user.sub, id, dto);
  }

  @Patch('admin/attribute-templates/:id')
  @Roles('admin')
  @ApiOperation({ summary: '更新属性模板' })
  async updateAttributeTemplate(@Request() req: any, @Param('id', new ParseIntPipe()) id: number, @Body() dto: UpdateAttributeTemplateDto) {
    return this.catalogService.updateAttributeTemplate(req.user.sub, id, dto);
  }

  @Delete('admin/attribute-templates/:id')
  @Roles('admin')
  @ApiOperation({ summary: '删除属性模板' })
  async deleteAttributeTemplate(@Request() req: any, @Param('id', new ParseIntPipe()) id: number) {
    return this.catalogService.deleteAttributeTemplate(req.user.sub, id);
  }

  // ── 目录项属性值 ──

  @Patch('admin/items/:id/attributes')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '设置目录项属性值' })
  async setItemAttributes(@Param('id') id: string, @Body() body: SetItemAttributesDto) {
    return this.catalogService.setItemAttributes(id, body.attributes);
  }

  // ── 价格预警 ──

  @Get('admin/alert-rules') @Roles('admin', 'procurement_staff') async listAlertRules() { return this.catalogService.listAlertRules(); }
  @Post('admin/alert-rules') @Roles('admin') async createAlertRule(@Body() dto: any) { return this.catalogService.createAlertRule(dto); }
  @Patch('admin/alert-rules/:id') @Roles('admin') async updateAlertRule(@Param('id', new ParseIntPipe()) id: number, @Body() dto: any) { return this.catalogService.updateAlertRule(id, dto); }
  @Delete('admin/alert-rules/:id') @Roles('admin') async deleteAlertRule(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.deleteAlertRule(id); }
  @Patch('admin/alert-rules/:id/toggle') @Roles('admin') async toggleAlertRule(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.toggleAlertRule(id); }
  @Get('admin/alerts') @Roles('admin', 'procurement_staff') async listAlerts(@Query('isRead') isRead?: string, @Query('isResolved') isResolved?: string) { return this.catalogService.listAlerts({ isRead: isRead !== undefined ? isRead === 'true' : undefined, isResolved: isResolved !== undefined ? isResolved === 'true' : undefined }); }
  @Patch('admin/alerts/:id/read') @Roles('admin', 'procurement_staff') async markAlertRead(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.markAlertRead(id); }
  @Patch('admin/alerts/:id/resolve') @Roles('admin', 'procurement_staff') async markAlertResolved(@Param('id', new ParseIntPipe()) id: number) { return this.catalogService.markAlertResolved(id); }

  // ── 供应商目录供货申请（管理员审核）──

  @Get('applications')
  @Roles('procurement_staff', 'admin', 'leader', 'staff')
  @ApiOperation({ summary: '供货申请审核列表' })
  async applications(@Query('status') status?: string, @Query('type') type?: string) {
    return this.catalogService.listApplications({ status, type });
  }

  @Get('applications/:id')
  @Roles('procurement_staff', 'admin', 'leader', 'staff')
  @ApiOperation({ summary: '供货申请详情' })
  async application(@Param('id') id: string) {
    return this.catalogService.getApplication(id);
  }

  @Post('applications/:id/review')
  @Roles('procurement_staff', 'admin', 'leader', 'staff')
  @ApiOperation({ summary: '审核供货申请（通过/拒绝/退回/议价）' })
  async review(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.catalogService.reviewApplication(req.user.sub, id, body);
  }

  @Get('items/:itemId/suppliers')
  @Roles('procurement_staff', 'admin', 'leader', 'staff')
  @ApiOperation({ summary: '某目录条目的准入供应商（含报价）' })
  async itemSuppliers(@Param('itemId') itemId: string) {
    return this.catalogService.listItemSuppliers(itemId);
  }

  // ── Public / shared endpoints ──

  @Get('suppliers')
  @ApiOperation({ summary: '供应商维度聚合（目录内）' })
  async suppliers() {
    return this.catalogService.listSuppliers();
  }

  @Get('favorites')
  @ApiOperation({ summary: '我的收藏目录' })
  async favorites(@Request() req: any) {
    return this.catalogService.listFavorites(req.user.sub);
  }

  @Get('export')
  @ApiOperation({ summary: '导出采购目录 Excel' })
  async exportCatalog(
    @Request() req: any,
    @Res() res: Response,
    @Query('category') category?: string,
    @Query('region') region?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
  ) {
    const buf = await this.catalogService.exportCatalog(req.user.sub, { category, region, status, source, search });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('采购目录-' + new Date().toISOString().slice(0, 10) + '.xlsx')}`,
    });
    res.end(buf);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: '收藏 / 取消收藏' })
  async toggleFavorite(@Request() req: any, @Param('id') id: string) {
    return this.catalogService.toggleFavorite(req.user.sub, id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: '采购目录价格历史' })
  async history(@Param('id') id: string) {
    return this.catalogService.getHistory(id);
  }

  @Get(':id')
  @ApiOperation({ summary: '采购目录详情' })
  async get(@Param('id') id: string) {
    return this.catalogService.get(id);
  }
}
