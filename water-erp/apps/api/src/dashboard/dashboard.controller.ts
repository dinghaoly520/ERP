import { Controller, Get, Query, Req, ForbiddenException } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewGlobalBusinessData, INTERNAL_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { CompanyScopeService } from '../company/company-scope';
import { portalSourceOf } from '../common/portal-source.util';

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
    @Req() req: Request,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司
    @Query('compare') compare?: string, // 'true' 时响应附带环比上期块
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
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
    @Req() req: Request,
    @Query('companyId') companyId?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    return this.dashboardService.getBadges(this.companyScope.filter(scope));
  }

  /** :3011 数据总览首排——项目盘点（headline 全时段 + 所选窗 cur/yoy/prev 流量供同比/环比子行） */
  @Get('project-status')
  @ApiOperation({ summary: ':3011 数据总览项目盘点（归档/进行中/异常=终止/总数 + 同比环比流量）' })
  async getProjectStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Query('companyId') companyId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    return this.dashboardService.getProjectStatusCounts(this.companyScope.filter(scope), startDate, endDate);
  }

  /** :3011 实时运行态势四 KPI——标段生命周期盘点（标前/标中/标后/运行中 + 同比环比流量） */
  @Get('bid-stage-status')
  @ApiOperation({ summary: ':3011 实时态势标段盘点（运行中/标前/标中/标后 + 同比环比流量）；pmi=1 进展页模式——时间/方式/部门/经办人走 PMI 关系过滤且 headline 按窗计（2026-11-23）' })
  async getBidStageStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Query('companyId') companyId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('pmi') pmi?: string,
    @Query('procurementMethod') procurementMethod?: string, // 采购方式逗号多选（进展页多选并行）
    @Query('department') department?: string, // 部门名逗号多选（进展页部门筛选按名匹配 PMI.requesterDepartment）
    @Query('createdBy') createdBy?: string, // 经办人 id 逗号多选（PMI.createdById）
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    const csv = (v?: string) => v?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
    // pmi=1：进展页模式（对象存在即切换语义，空字段也算）——态势卡内容跟随页级全部选择器
    const pmiFilter = pmi === '1'
      ? {
          procurementMethods: csv(procurementMethod),
          departments: csv(department),
          createdBy: csv(createdBy),
        }
      : undefined;
    return this.dashboardService.getBidStageStatus(this.companyScope.filter(scope), startDate, endDate, pmiFilter);
  }

  /** :3011 实时态势 KPI 下方项目列表——桶内最新 N 项 + 复合状态行（规则见 service注释） */
  @Get('bid-stage-projects')
  @ApiOperation({ summary: ':3011 实时态势项目列表（桶=running/pre/in/post，最新 5 项+状态行）' })
  async getBidStageProjects(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Query('companyId') companyId?: string,
    @Query('bucket') bucket?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId, portalSourceOf(req));
    return this.dashboardService.getBidStageProjects(this.companyScope.filter(scope), bucket);
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
