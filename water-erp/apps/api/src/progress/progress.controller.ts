import { Controller, Get, Query, Req, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewGlobalBusinessData, INTERNAL_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { ProgressService, ProgressStats } from './progress.service';
import { CompanyScopeService } from '../company/company-scope';
import { portalSourceOf } from '../common/portal-source.util';

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
    @Req() req?: Request,
  ): Promise<ProgressStats> {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    return this.progressService.getProgressStats(userId, stage, this.companyScope.filter(scope));
  }

  @Get('ai-insights')
  async getAiInsights(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('stage') stage?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司；显式传入时生成结果落服务端缓存
    @Req() req?: Request,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    // 缓存键由已解析 scope 派生（2026-11-10 二次修订：admin=选择器参数；非 admin=本人
    // 公司，传参忽略）——非 admin 同样吃本公司缓存（不因越权收紧而每次重生成），
    // 且键不来自客户端（污染面为零）
    const cacheKey = scope.all ? 'all' : scope.companyIds.slice().sort().join(',');
    return this.progressService.getAiInsights(userId, stage, this.companyScope.filter(scope), cacheKey);
  }

  @Get('ai-insights/cache')
  @ApiOperation({ summary: '进度洞察缓存提取（2026-11-10）：按登录人 scope（admin=选择器参数、非 admin=本公司）取最新一份，数据指纹未变即命中' })
  async getAiInsightsCache(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req?: Request,
    @Query('companyId') companyId = 'all',
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    return this.progressService.getProgressInsightCache(scope.all ? 'all' : scope.companyIds.slice().sort().join(','));
  }

  @Get('upcoming')
  @ApiOperation({ summary: ':3011 未来关键节点（截标/开标）' })
  async getUpcoming(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司
    @Req() req?: Request,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    const n = Math.min(Math.max(parseInt(days ?? '14', 10) || 14, 1), 60);
    return this.progressService.getUpcoming(n, this.companyScope.filter(scope));
  }
}
