import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
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
}
