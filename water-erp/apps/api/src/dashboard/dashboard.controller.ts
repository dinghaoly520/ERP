import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
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
    @Query('compare') compare?: string, // 'true' 时响应附带环比上期块
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.dashboardService.getDashboard(
      startDate,
      endDate,
      this.companyScope.filter(scope),
      compare === 'true',
    );
  }

  @Get('badges')
  @ApiOperation({ summary: ':3011 Tab 角标（异常/待处理/停滞）' })
  async getBadges(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.dashboardService.getBadges(this.companyScope.filter(scope));
  }

  /** 公司龙虎榜天然跨公司（比的是全集团排位）——无 companyId 入参：admin 全榜、leader 本公司排位 */
  @Get('company-ranking')
  @ApiOperation({ summary: ':3011 公司龙虎榜（admin 全榜 / leader 本公司排位+集团均值）' })
  async getCompanyRanking(
    @CurrentUser() user: AuthenticatedUser,
    @Query('range') range?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    return this.dashboardService.getCompanyRankingView(user, range);
  }
}
