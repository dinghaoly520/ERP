import { BadRequestException, Controller, Get, Post, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { AUTHENTICATED_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { NotificationService } from './notification.service';

@ApiTags('通知')
@ApiCookieAuth('token')
@Controller('notifications')
@Roles(...AUTHENTICATED_ROLES)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: '通知列表' })
  async list(
    @Request() req: any,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('tab') tab?: 'all' | 'todo',
    @Query('types') rawTypes?: string,
  ) {
    const types = rawTypes
      ? Array.from(new Set(rawTypes.split(',').map((value) => value.trim()).filter(Boolean)))
      : [];
    if (types.length > 40 || types.some((value) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(value))) {
      throw new BadRequestException({ error: '消息类型筛选参数无效', code: 'BAD_NOTIFICATION_TYPES' });
    }
    return this.notificationService.list(req.user.sub, page ?? 1, pageSize ?? 20, tab ?? 'all', types);
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读通知数量' })
  async getUnreadCount(@Request() req: any) {
    const count = await this.notificationService.getUnreadCount(req.user.sub);
    return { count };
  }

  @Post(':id/read')
  @ApiOperation({ summary: '标记已读' })
  async markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.notificationService.markAsRead(id, req.user.sub);
  }

  @Post('mark-all-read')
  @ApiOperation({ summary: '全部标记已读' })
  async markAllAsRead(@Request() req: any) {
    return this.notificationService.markAllAsRead(req.user.sub);
  }
}
