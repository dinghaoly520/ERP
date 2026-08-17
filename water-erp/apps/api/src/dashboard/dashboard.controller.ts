import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewGlobalBusinessData, INTERNAL_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@Roles(...INTERNAL_ROLES)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    return this.dashboardService.getDashboard(startDate, endDate);
  }
}
