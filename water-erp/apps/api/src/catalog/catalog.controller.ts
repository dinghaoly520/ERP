import { Controller, Get, Param, Post, Query, Request, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Response } from 'express';
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
