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
    // 缓存写仅 admin（2026-11-10 稳健轮）：companyId 参数对非 admin 本被 resolveScope
    // 忽略（按本人公司过滤）——若照传 cacheCompanyId 会把本公司内容写进他公司缓存键
    return this.progressService.getAiInsights(userId, stage, this.companyScope.filter(scope), user.role === 'admin' ? companyId : undefined);
  }

  @Get('ai-insights/cache')
  @ApiOperation({ summary: '进度洞察缓存提取（2026-11-10）：按公司视野取最新一份，数据指纹未变即命中，不再每次重新生成（仅 admin——公司选择器为 admin 专用，非 admin 一律 miss 走隔离链路）' })
  async getAiInsightsCache(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId = 'all',
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    if (user.role !== 'admin') return { hit: false, fingerprint: '' };
    return this.progressService.getProgressInsightCache(companyId);
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
