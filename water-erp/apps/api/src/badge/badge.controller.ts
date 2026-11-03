import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AUTHENTICATED_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { BadgeService } from './badge.service';

@ApiTags('工作印记')
@Controller('badge')
@Roles(...AUTHENTICATED_ROLES)
export class BadgeController {
  constructor(private readonly service: BadgeService) {}

  @Get('my')
  @ApiOperation({ summary: '获取当前用户的全部印记进度' })
  async getMyBadges(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getUserBadges(user.sub);
  }

  @Post('recompute')
  @ApiOperation({ summary: '手动触发当前用户印记重算（同步执行，返回最新印记）' })
  async recompute(@CurrentUser() user: AuthenticatedUser) {
    return this.service.recomputeCurrentUser(user.sub);
  }
}
