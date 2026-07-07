import { Controller, Get, Post, Delete, Body, Param, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AssistantService } from './assistant.service';
import { ChatDto } from './dto/chat.dto';

@ApiTags('水叮当智能助手')
@Controller('assistant')
@Public()
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  @ApiOperation({ summary: '发送对话消息' })
  async chat(@Body() dto: ChatDto) {
    return this.assistantService.chat(dto);
  }

  @Get('conversations')
  @ApiOperation({ summary: '会话列表' })
  async listConversations() {
    return this.assistantService.listConversations();
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '会话详情（含消息历史）' })
  async getConversation(@Param('id') id: string) {
    return this.assistantService.getConversation(id);
  }

  @Post('actions/:id/confirm')
  @ApiOperation({ summary: '确认执行操作预案' })
  async confirmAction(@Param('id') id: string) {
    return this.assistantService.confirmAction(id);
  }

  @Post('actions/:id/cancel')
  @ApiOperation({ summary: '取消操作预案' })
  async cancelAction(@Param('id') id: string) {
    return this.assistantService.cancelAction(id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除会话' })
  async deleteConversation(@Param('id') id: string) {
    return this.assistantService.deleteConversation(id);
  }

  @Post('conversations')
  @ApiOperation({ summary: '创建新会话' })
  async createConversation(@Body() body: { title?: string }) {
    return this.assistantService.createConversation(body.title);
  }

  @Get('quick-stats')
  @ApiOperation({ summary: '首页快捷入口实时状态' })
  async getQuickStats() {
    return this.assistantService.getQuickStats();
  }
}
