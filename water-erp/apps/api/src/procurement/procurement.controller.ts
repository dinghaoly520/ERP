import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ProcurementService } from './procurement.service';
import { CreateProcurementDto, UpdateProcurementDto, RejectProcurementDto } from './dto/create-procurement.dto';
import { CreateBidDto } from './dto/create-bid.dto';

@ApiTags('采购管理')
@ApiCookieAuth('token')
@Controller('procurement')

@Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
export class ProcurementController {
  constructor(private procurementService: ProcurementService) {}

  @Get('stats')
  @ApiOperation({ summary: '采购项目统计' })
  getStats() { return this.procurementService.getStats(); }

  @Get()
  @ApiOperation({ summary: '采购项目列表' })
  list(@Query('status') status?: string) { return this.procurementService.list(status); }

  @Get(':id')
  @ApiOperation({ summary: '采购项目详情' })
  get(@Param('id') id: string) { return this.procurementService.get(id); }

  @Post()
  @ApiOperation({ summary: '创建采购项目' })
  create(@Body() dto: CreateProcurementDto, @Request() req: any) {
    return this.procurementService.create(dto, req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新采购项目' })
  update(@Param('id') id: string, @Body() dto: UpdateProcurementDto) {
    return this.procurementService.update(id, dto);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: '提交审批' })
  submit(@Param('id') id: string) { return this.procurementService.submit(id); }

  @Post(':id/approve')
  @ApiOperation({ summary: '审批通过' })
  approve(@Param('id') id: string) { return this.procurementService.approve(id); }

  @Post(':id/reject')
  @ApiOperation({ summary: '审批驳回' })
  reject(@Param('id') id: string, @Body() dto: RejectProcurementDto) {
    return this.procurementService.reject(id, dto.reason);
  }

  @Post(':id/create-bid')
  @ApiOperation({ summary: '采购项目转招标（可指定开标/截标时间）' })
  createBid(@Param('id') id: string, @Body() dto: CreateBidDto) {
    return this.procurementService.createBid(id, dto);
  }
}
