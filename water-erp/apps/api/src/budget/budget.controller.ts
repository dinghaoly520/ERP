import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Request, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { BudgetService } from './budget.service';
import { CloneBudgetListDto, CreateBudgetListDto, SyncBudgetItemsDto, UpdateBudgetListDto } from './dto';

@ApiTags('预算清单')
@ApiCookieAuth('token')
@Controller('budget')
@Roles('admin', 'leader', 'staff')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get('lists')
  @ApiOperation({ summary: '我的预算清单列表' })
  async lists(@Request() req: any) {
    return this.budgetService.listLists(req.user.sub);
  }

  @Post('lists')
  @ApiOperation({ summary: '新建预算清单' })
  async create(@Request() req: any, @Body() dto: CreateBudgetListDto) {
    return this.budgetService.createList(req.user.sub, dto.name);
  }

  @Get('lists/:id')
  @ApiOperation({ summary: '预算清单详情（含条目）' })
  async get(@Request() req: any, @Param('id') id: string) {
    return this.budgetService.getDetail(req.user.sub, id);
  }

  @Get('lists/:id/export')
  @ApiOperation({ summary: '导出预算清单 Excel' })
  async exportList(@Request() req: any, @Param('id') id: string, @Res() res: Response) {
    const buf = await this.budgetService.exportList(req.user.sub, id);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('预算清单-' + new Date().toISOString().slice(0, 10) + '.xlsx')}`,
    });
    res.end(buf);
  }

  @Patch('lists/:id')
  @ApiOperation({ summary: '更新预算清单（名称/备注/状态）' })
  async update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateBudgetListDto) {
    return this.budgetService.updateList(req.user.sub, id, dto);
  }

  @Delete('lists/:id')
  @ApiOperation({ summary: '删除预算清单' })
  async remove(@Request() req: any, @Param('id') id: string) {
    return this.budgetService.deleteList(req.user.sub, id);
  }

  @Put('lists/:id/items')
  @ApiOperation({ summary: '同步预算条目（全量替换，自动保存）' })
  async sync(@Request() req: any, @Param('id') id: string, @Body() dto: SyncBudgetItemsDto) {
    return this.budgetService.syncItems(req.user.sub, id, dto.items);
  }

  @Post('lists/:id/clone')
  @ApiOperation({ summary: '克隆预算清单' })
  async clone(@Request() req: any, @Param('id') id: string, @Body() dto: CloneBudgetListDto) {
    return this.budgetService.cloneList(req.user.sub, id, dto.name);
  }

  @Post('lists/:id/convert')
  @ApiOperation({ summary: '生成询价单（转采购立项草稿）' })
  async convert(@Request() req: any, @Param('id') id: string) {
    return this.budgetService.convert(req.user.sub, id);
  }
}
