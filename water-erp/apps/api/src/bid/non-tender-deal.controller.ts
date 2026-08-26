import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NonTenderDealService, type RegisterNonTenderDealDto } from './non-tender-deal.service';

/** C3 转非招标方式成交登记（CTS-EBS01 A-199）：流标项目的非招标成交结果入档。 */
@Controller('bid')
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
