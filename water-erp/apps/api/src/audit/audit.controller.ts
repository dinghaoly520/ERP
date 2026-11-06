import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AUTHENTICATED_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit-log')
@Roles(...AUTHENTICATED_ROLES)
export class AuditController {
  constructor(private readonly auditLog: AuditService) {}

  @Get('my-activities')
  async getMyActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('exclude') exclude?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const excludeActions = exclude
      ? exclude.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    return this.auditLog.getUserActivities(user.sub, {
      limit: Math.min(parsedLimit, 500),
      offset: parsedOffset,
      excludeActions,
    });
  }

  /**
   * 全中心操作留痕（2026-11-06 用户裁定）：leader/admin 可见所有人 AuditLog，
   * 每条带操作人姓名/角色；staff 走 my-activities 仅本人。
   * 与 canViewAllUserActivity（tender 域 admin 专用闸）口径不同，勿合并。
   */
  @Get('all-activities')
  @Roles('leader', 'admin')
  async getAllActivities(
    @CurrentUser() _user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('exclude') exclude?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const excludeActions = exclude
      ? exclude.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    return this.auditLog.getOrgActivities({
      limit: Math.min(parsedLimit, 500),
      offset: parsedOffset,
      excludeActions,
    });
  }

}
