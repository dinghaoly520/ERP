import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
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
