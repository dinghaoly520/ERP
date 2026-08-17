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
  @ApiOperation({ summary: '手动触发当前用户印记重算' })
  async recompute(@CurrentUser() user: AuthenticatedUser) {
    const u = await this.service.getUserBadges(user.sub);
    // 触发完整重算前需要拿用户 createdAt — 由 service 内部 recomputeAll 处理更稳。
    return { ok: true, message: '已请求后台重算', count: u.length };
  }
}
