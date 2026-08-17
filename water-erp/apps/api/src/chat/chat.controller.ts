import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { INTERNAL_ROLES } from '../auth/auth-scope';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

@ApiTags('即时聊天')
@ApiCookieAuth('token')
@Controller('chat')
@Roles(...INTERNAL_ROLES)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get('users')
  @ApiOperation({ summary: '所有账号列表（含在线状态）' })
  async listUsers() {
    return this.chatService.listUsers(this.gateway.getOnlineUserIds());
  }

  @Get('conversations')
  @ApiOperation({ summary: '我的会话列表' })
  async conversations(@Request() req: any) {
    return this.chatService.listConversations(req.user.sub);
  }

  @Get('messages/:peerId')
  @ApiOperation({ summary: '与某人的历史消息（游标分页 ?before=&limit=）' })
  async messages(
    @Param('peerId') peerId: string,
    @Query('before') before: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: any,
  ) {
    const n = limit ? parseInt(limit, 10) : 30;
    if (Number.isNaN(n) || n < 1 || n > 100) {
      throw new BadRequestException({ error: 'limit 范围 1-100', code: 'INVALID_LIMIT' });
    }
    return this.chatService.listMessages(req.user.sub, peerId, before, n);
  }

  @Post('messages/:peerId/read')
  @ApiOperation({ summary: '标记与某人的消息为已读' })
  async markRead(@Param('peerId') peerId: string, @Request() req: any) {
    const result = await this.chatService.markRead(req.user.sub, peerId);
    // 通知对方：你的消息已被读
    this.gateway.notifyRead(req.user.sub, peerId, result.updated);
    return result;
  }
}
