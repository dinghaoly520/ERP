import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewAllUserActivity, AUTHENTICATED_ROLES } from '../auth/auth-scope';
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
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    return this.auditLog.getUserActivities(user.sub, {
      limit: Math.min(parsedLimit, 100),
      offset: parsedOffset,
    });
  }

  @Get('all-activities')
  async getAllActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('userId') targetUserId?: string,
  ) {
    if (!canViewAllUserActivity(user.role)) {
      throw new ForbiddenException('仅管理员可查看所有使用记录。');
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    return this.auditLog.getAllActivities({
      limit: Math.min(parsedLimit, 100),
      offset: parsedOffset,
      userId: targetUserId,
    });
  }
}
