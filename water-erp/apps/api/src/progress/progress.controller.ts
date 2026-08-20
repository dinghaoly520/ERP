import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewGlobalBusinessData, INTERNAL_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { ProgressService, ProgressStats } from './progress.service';
import { CompanyScopeService } from '../company/company-scope';

@Controller('progress')
@Roles(...INTERNAL_ROLES)
export class ProgressController {
  constructor(
    private readonly progressService: ProgressService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  @Get('stats')
  async getProgressStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('stage') stage?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司
  ): Promise<ProgressStats> {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.progressService.getProgressStats(userId, stage, this.companyScope.filter(scope));
  }

  @Get('ai-insights')
  async getAiInsights(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('stage') stage?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.progressService.getAiInsights(userId, stage, this.companyScope.filter(scope));
  }
}
