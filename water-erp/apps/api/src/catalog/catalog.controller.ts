import { Controller, Get, Param, Post, Body, Query, Request, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';

@ApiTags('采购目录')
@ApiCookieAuth('token')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiOperation({ summary: '采购目录列表' })
  async list(
    @Query('category') category?: string,
    @Query('region') region?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
  ) {
    return this.catalogService.list({ category, region, status, source, search });
  }

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

  // ─── 供应商目录供货申请（管理员审核：仅 procurement_staff / admin）───
  // 注意：这些具体路径必须声明在 @Get(':id') 之前，否则会被 :id 通配捕获。

  @Get('applications')
  @Roles('procurement_staff', 'admin')
  @ApiOperation({ summary: '供货申请审核列表' })
  async applications(@Query('status') status?: string, @Query('type') type?: string) {
    return this.catalogService.listApplications({ status, type });
  }

  @Get('applications/:id')
  @Roles('procurement_staff', 'admin')
  @ApiOperation({ summary: '供货申请详情' })
  async application(@Param('id') id: string) {
    return this.catalogService.getApplication(id);
  }

  @Post('applications/:id/review')
  @Roles('procurement_staff', 'admin')
  @ApiOperation({ summary: '审核供货申请（通过/拒绝/退回/议价）' })
  async review(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.catalogService.reviewApplication(req.user.sub, id, body);
  }

  @Get('items/:itemId/suppliers')
  @Roles('procurement_staff', 'admin')
  @ApiOperation({ summary: '某目录条目的准入供应商（含报价）' })
  async itemSuppliers(@Param('itemId') itemId: string) {
    return this.catalogService.listItemSuppliers(itemId);
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
