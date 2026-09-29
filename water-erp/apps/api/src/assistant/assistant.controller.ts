import { Controller, Get, Post, Delete, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';
import { AssistantService, AssistantOwner } from './assistant.service';
import { ChatDto } from './dto/chat.dto';

/**
 * 水叮当助手：:3008 公共匿名 + :3005 登录用户共用。
 *
 * P0 安全收口（2026-09-28）——此前整个 controller @Public 且会话无属主：
 * 未登录可读/删全体用户会话、经 chat 触发内部数据工具（供应商联系人等 PII）。
 * 现按认证态分层：认证用户（任意门户 token）按 JWT 属主隔离会话、可用全量工具；
 * 匿名访客按 X-Assistant-Guest 头（:3008 localStorage 生成的访客键）隔离会话、
 * 仅可用公开域工具（公告/商城目录）。
 */
@ApiTags('水叮当智能助手')
@Controller('assistant')
@OptionalAuth()
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  /** 会话属主解析：认证用户（JWT sub，优先）或匿名访客键（格式校验后放行） */
  private ownerFrom(req: Request): AssistantOwner | null {
    const payload = (req as any).user;
    if (payload?.sub) return { userId: payload.sub, role: payload.role };
    const raw = req.headers['x-assistant-guest'];
    const guestKey = Array.isArray(raw) ? raw[0] : raw;
    if (guestKey && /^[A-Za-z0-9_-]{8,64}$/.test(guestKey)) return { guestKey };
    return null;
  }

  @Post('chat')
  @ApiOperation({ summary: '发送对话消息' })
  async chat(@Body() dto: ChatDto, @Req() req: Request) {
    return this.assistantService.chat(dto, this.ownerFrom(req));
  }

  @Get('conversations')
  @ApiOperation({ summary: '会话列表（按属主隔离）' })
  async listConversations(@Req() req: Request) {
    return this.assistantService.listConversations(this.ownerFrom(req));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '会话详情（含消息历史，仅属主可见）' })
  async getConversation(@Param('id') id: string, @Req() req: Request) {
    return this.assistantService.getConversation(id, this.ownerFrom(req));
  }

  @Post('actions/:id/confirm')
  @ApiOperation({ summary: '确认执行操作预案（须登录且为会话属主）' })
  async confirmAction(@Param('id') id: string, @Req() req: Request) {
    return this.assistantService.confirmAction(id, (req as any).user);
  }

  @Post('actions/:id/cancel')
  @ApiOperation({ summary: '取消操作预案（须登录且为会话属主）' })
  async cancelAction(@Param('id') id: string, @Req() req: Request) {
    return this.assistantService.cancelAction(id, (req as any).user);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除会话（仅属主）' })
  async deleteConversation(@Param('id') id: string, @Req() req: Request) {
    return this.assistantService.deleteConversation(id, this.ownerFrom(req));
  }

  @Post('conversations')
  @ApiOperation({ summary: '创建新会话' })
  async createConversation(@Body() body: { title?: string }, @Req() req: Request) {
    return this.assistantService.createConversation(body.title, this.ownerFrom(req));
  }

  @Get('quick-stats')
  @ApiOperation({ summary: '首页快捷入口实时状态（匿名仅公开域聚合）' })
  async getQuickStats(@Req() req: Request) {
    return this.assistantService.getQuickStats(!!this.ownerFrom(req)?.userId);
  }
}
