import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewGlobalBusinessData, INTERNAL_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { CompanyScopeService } from '../company/company-scope';

@Controller('dashboard')
@Roles(...INTERNAL_ROLES)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  @Get()
  async getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.dashboardService.getDashboard(startDate, endDate, this.companyScope.filter(scope));
  }
}
