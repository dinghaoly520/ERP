import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BidCompanyScopeGuard } from './bid-company-scope.guard';
import { NonTenderDealService, type RegisterNonTenderDealDto } from './non-tender-deal.service';

/** C3 转非招标方式成交登记（CTS-EBS01 A-199）：流标项目的非招标成交结果入档。 */
@Controller('bid')
// P2-6（2026-11-20 全链路审查）：对齐 BidController 类级公司隔离——原实现跨公司 staff/leader
// 可对他司 ABORTED 项目登记成交并把任意 FileAsset 挂入他司 PMI 定标附件。仅 :3005 调用
//（管理侧动作，非主持现场执行权，不挂 AssignedHostGuard）。
@UseGuards(BidCompanyScopeGuard)
@Roles('staff', 'leader', 'admin')
export class NonTenderDealController {
  constructor(private readonly deals: NonTenderDealService) {}

  @Post('projects/:id/non-tender-deal')
  register(@Param('id') id: string, @Body() dto: RegisterNonTenderDealDto, @CurrentUser('sub') userId?: string) {
    return this.deals.register(id, dto, userId);
  }

  @Get('projects/:id/non-tender-deal')
  get(@Param('id') id: string) {
    return this.deals.get(id);
  }
}
