import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { PrequalService } from './prequal.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * B3（GB/T 43711 7.2.3）：资格预审——采购人侧（:3005）。
 * 发起（可同步发公告）→ 收申请 → 线下评审 → decide 登记结果（通知书 DOCX + 双向告知）。
 */
@ApiTags('资格预审')
@Roles('admin', 'leader', 'staff', 'bid_host')
@Controller('prequals')
export class PrequalController {
  constructor(
    private prequalService: PrequalService,
    private companyScope: CompanyScopeService,
  ) {}

  @Get()
  @ApiOperation({ summary: '资格预审列表（含申请）' })
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.prequalService.list({ status, q });
  }

  @Post()
  @ApiOperation({ summary: '发起资格预审（默认同步发布 PREQUAL_NOTICE 公告）' })
  async create(@Request() req: any, @Body() dto: any) {
    const stamp = await this.companyScope.stampFor(req.user);
    return this.prequalService.create(dto, { companyId: stamp.companyId, companyName: stamp.companyName });
  }

  @Get(':id')
  @ApiOperation({ summary: '预审详情（含申请）' })
  get(@Param('id') id: string) {
    return this.prequalService.get(id);
  }

  @Post(':id/decide')
  @ApiOperation({ summary: '登记评审结果（合格→通知书 DOCX；未通过同步告知；预审关闭）' })
  decide(@Param('id') id: string, @Body() dto: { results: Array<{ applicationId: string; passed: boolean }>; note?: string }) {
    return this.prequalService.decide(id, dto);
  }
}
