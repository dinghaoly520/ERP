import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { FrameworkService } from './framework.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * B4（GB/T 43711 附录 D）：框架协议采购两阶段——采购人侧（:3005 项目管理详情「框架协议」入口）。
 */
@ApiTags('框架协议')
@Roles('admin', 'leader', 'staff', 'bid_host')
@Controller('framework-agreements')
export class FrameworkController {
  constructor(
    private frameworkService: FrameworkService,
    private companyScope: CompanyScopeService,
  ) {}

  @Get()
  @ApiOperation({ summary: '框架协议列表（含入围名单）' })
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.frameworkService.list({ status, q });
  }

  @Post()
  @ApiOperation({ summary: '创建框架协议（一阶段发起，D.2）' })
  async create(@Request() req: any, @Body() dto: any) {
    const stamp = await this.companyScope.stampFor(req.user);
    return this.frameworkService.create(dto, { companyId: stamp.companyId, companyName: stamp.companyName });
  }

  @Get(':id')
  @ApiOperation({ summary: '协议详情（含入围/变更记录）' })
  get(@Param('id') id: string) {
    return this.frameworkService.get(id);
  }

  @Post(':id/entries')
  @ApiOperation({ summary: '登记入围供应商（一阶段结果，生效后为增补 D.3.4.1）' })
  addEntries(@Param('id') id: string, @Body() dto: { entries: Array<{ supplierName: string; supplierId?: string; shareRatio?: number; note?: string }> }) {
    return this.frameworkService.addEntries(id, dto);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: '一阶段完成 → 协议生效（D.2.6 淘汰比例校验 + 协议 DOCX）' })
  activate(@Param('id') id: string, @Body() dto: { rounds?: number; participants?: number; overrideReason?: string }) {
    return this.frameworkService.activate(id, dto);
  }

  @Post(':id/second-stage-order')
  @ApiOperation({ summary: '二阶段成交登记 → 订单合同（D.3.7，复用合同域）' })
  secondStageOrder(@Param('id') id: string, @Body() dto: { entryId: string; title?: string; amount?: number; selectionRule?: string; keyTerms?: Record<string, any> }) {
    return this.frameworkService.secondStageOrder(id, dto);
  }

  @Post(':id/entries/:entryId/exit')
  @ApiOperation({ summary: '入围退出（开放式随时；封闭式须理由 D.3.4.2/D.3.5）' })
  exitEntry(@Param('id') id: string, @Param('entryId') entryId: string, @Body() dto: { reason?: string }) {
    return this.frameworkService.exitEntry(id, entryId, dto.reason);
  }

  @Post(':id/price-adjust')
  @ApiOperation({ summary: '价格调整（D.3.5，版本记录）' })
  adjustPriceRule(@Param('id') id: string, @Body() dto: { priceRule: any; note: string }) {
    return this.frameworkService.adjustPriceRule(id, dto);
  }

  @Post(':id/terminate')
  @ApiOperation({ summary: '终止协议（理由必填）' })
  terminate(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.frameworkService.terminate(id, dto.reason);
  }
}
