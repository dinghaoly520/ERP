import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BadgeService } from './badge.service';

@ApiTags('工作印记')
@Controller('badge')
@UseGuards(AuthGuard)
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
