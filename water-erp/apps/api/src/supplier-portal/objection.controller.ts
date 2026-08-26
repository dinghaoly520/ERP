import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ObjectionService } from './objection.service';

/**
 * C6（GB/T 43711 4.1.4）：采购人异议/投诉管理端（:3005 公告面板"异议/投诉"入口）。
 * 在线受理并答复供应商异议；答复不满转投诉的登记监管处理结果。
 */
@ApiTags('异议投诉')
@Roles('admin', 'leader', 'staff', 'bid_host')
@Controller('objections')
export class ObjectionController {
  constructor(private objectionService: ObjectionService) {}

  @Get()
  @ApiOperation({ summary: '异议/投诉工单列表（可按状态/类型/关键词筛选）' })
  list(@Query('status') status?: string, @Query('phase') phase?: string, @Query('q') q?: string) {
    return this.objectionService.listAdmin({ status, phase, q });
  }

  @Post(':id/answer')
  @ApiOperation({ summary: '在线答复异议（答复即通知供应商）' })
  answer(@Param('id') id: string, @Body() dto: { answer: string }, @Request() req: any) {
    return this.objectionService.answer(id, dto.answer, { userId: req.user.sub, username: req.user.username });
  }

  @Post(':id/escalate')
  @ApiOperation({ summary: '登记转投诉（移交监管处理）' })
  escalate(@Param('id') id: string, @Body() dto: { note?: string }) {
    return this.objectionService.escalate(id, dto.note ?? '');
  }

  @Post(':id/close')
  @ApiOperation({ summary: '登记投诉处理结果并办结' })
  close(@Param('id') id: string, @Body() dto: { note?: string }, @Request() req: any) {
    return this.objectionService.close(id, dto.note ?? '', { userId: req.user.sub, username: req.user.username });
  }
}
