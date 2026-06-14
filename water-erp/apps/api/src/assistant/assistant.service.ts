import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeepSeekProvider } from './model/deepseek.provider';
import { ToolRegistry } from './tools/tool-registry';
import { GlobalOverviewTool } from './tools/global-overview.tool';
import { ProcurementTool } from './tools/procurement.tool';
import { BidTool } from './tools/bid.tool';
import { SupplierTool } from './tools/supplier.tool';
import { ExpertTool } from './tools/expert.tool';
import { AnnouncementTool } from './tools/announcement.tool';
import { NotificationTool } from './tools/notification.tool';
import { MallTool } from './tools/mall.tool';
import { ActionPlannerService } from './actions/action-planner.service';
import { ActionExecutorService } from './actions/action-executor.service';
import { SYSTEM_KNOWLEDGE } from './knowledge/system-knowledge';
import { ChatDto } from './dto/chat.dto';

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly model: DeepSeekProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly globalOverviewTool: GlobalOverviewTool,
    private readonly procurementTool: ProcurementTool,
    private readonly bidTool: BidTool,
    private readonly supplierTool: SupplierTool,
    private readonly expertTool: ExpertTool,
    private readonly announcementTool: AnnouncementTool,
    private readonly notificationTool: NotificationTool,
    private readonly mallTool: MallTool,
    private readonly actionPlanner: ActionPlannerService,
    private readonly actionExecutor: ActionExecutorService,
  ) {
    this.registerTools();
  }

  private registerTools() {
    this.toolRegistry.register(this.globalOverviewTool);
    this.toolRegistry.register(this.procurementTool);
    this.toolRegistry.register(this.bidTool);
    this.toolRegistry.register(this.supplierTool);
    this.toolRegistry.register(this.expertTool);
    this.toolRegistry.register(this.announcementTool);
    this.toolRegistry.register(this.notificationTool);
    this.toolRegistry.register(this.mallTool);
  }

  async chat(dto: ChatDto) {
    // Find or create conversation
    const conversation = dto.conversationId
      ? await this.prisma.assistantConversation.findUnique({
          where: { id: dto.conversationId },
          include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
        })
      : await this.prisma.assistantConversation.create({
          data: { title: dto.message.slice(0, 50) },
          include: { messages: { orderBy: { createdAt: 'asc' }, take: 0 } },
        });

    if (!conversation) {
      return {
        conversationId: '',
        answer: '抱歉，会话不存在，请刷新页面重试。',
        cards: [],
        citations: [],
        pendingActions: [],
      };
    }

    // Save user message
    await this.prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: dto.message,
      },
    });

    // Build message history for model
    const history =
      conversation.messages?.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })) || [];

    // Build tool list for system prompt
    const toolList = this.toolRegistry
      .list()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    const fullSystemPrompt = `${SYSTEM_KNOWLEDGE}

【你可以使用的数据工具】
${toolList}

【重要规则】
- 当用户询问数据/统计/列表/详情/分析问题时，你必须调用相应的工具获取真实数据。
- 工具调用格式（放在回答最前面，独占一行）：
  TOOL_CALL: {"tool": "<工具名>", "args": {"action": "<action>", ...}}
- 每次回答调用一个或者多个工具。先获取数据，再基于数据提炼洞察。
- 卡片已在前端渲染，文字回答只做判断和建议，不重复罗列数字。
- 涉及修改/审批/删除/禁用/退回时，说明操作预案和风险，不要直接执行。`;

    const messages = [
      { role: 'system' as const, content: fullSystemPrompt },
      ...history.slice(-20),
      { role: 'user' as const, content: dto.message },
    ];

    // Call model (first pass)
    let answer: string;
    let cards: unknown[] = [];
    const citations: unknown[] = [];
    const pendingActions: unknown[] = [];

    try {
      const res = await this.model.chat(messages);
      answer = res.text;

      // Check for tool call in response
      const toolCallMatch = answer.match(
        /TOOL_CALL:\s*(\{[\s\S]*?"tool"[\s\S]*?\})/,
      );
      if (!toolCallMatch) {
        // no tool call, continue with raw answer
      } else {
        // Try to parse JSON; if regex-cut is incomplete, walk forward to balance braces
        let jsonStr = toolCallMatch[1];
        let braceCount = 0;
        for (const ch of jsonStr) {
          if (ch === '{') braceCount++;
          if (ch === '}') braceCount--;
        }
        // If braces unbalanced, extend jsonStr from original answer
        if (braceCount !== 0) {
          const startIdx = answer.indexOf(jsonStr);
          let endIdx = startIdx + jsonStr.length;
          while (braceCount > 0 && endIdx < answer.length) {
            const ch = answer[endIdx];
            if (ch === '{') braceCount++;
            if (ch === '}') braceCount--;
            endIdx++;
          }
          jsonStr = answer.slice(startIdx, endIdx);
        }
        try {
          const toolCall = JSON.parse(jsonStr);
          const tool = this.toolRegistry.get(toolCall.tool);
          if (tool) {
            const result = await tool.execute(toolCall.args || {});
            if (result.success && result.cards) {
              cards = result.cards;
            }
            if (result.citations) {
              citations.push(...result.citations);
            }
            // Second model call: incorporate tool result into final answer
            // Build a clean summary for the model — don't dump raw JSON
            let toolSummary = '';
            if (result.success) {
              const cardCount = (result.cards || []).length;
              const dataObj = result.data as Record<string, unknown> | undefined;
              const itemCount = Array.isArray(result.data) ? result.data.length : 0;
              if (cardCount > 0) {
                const cardTypes = (result.cards || []).map((c: any) => c.type).join('、');
                toolSummary = `查询成功，已生成 ${cardCount} 张卡片（类型：${cardTypes}）。卡片已在前端渲染展示，你不需要在文字中重复卡片中的数字。`;
              } else if (itemCount > 0) {
                toolSummary = `查询到 ${itemCount} 条记录。`;
              } else if (dataObj) {
                toolSummary = `查询到 1 条详情记录。`;
              } else {
                toolSummary = '查询成功，但结果为空。';
              }
            } else {
              toolSummary = `工具调用失败: ${result.error}`;
            }

            const followUpMessages = [
              ...messages,
              { role: 'assistant' as const, content: answer },
              {
                role: 'user' as const,
                content: `工具 ${toolCall.tool} 的查询结果：${toolSummary}

请以董事长的视角，基于这些数据给出你的判断和建议。记住：
- 【绝对不要】逐条罗列卡片中的数字——卡片已经在页面上展示了。
- 【你要做的】提炼出最重要的 2-3 个洞察，每个用 1-2 句话讲清楚现状和含义。
- 如果有异常或待办事项，明确提出。
- 按照系统提示词中的回答格式规范来组织你的回答。`,
              },
            ];
            try {
              const followUp = await this.model.chat(followUpMessages);
              answer = followUp.text;
            } catch {
              // Keep original answer if follow-up call fails
            }
          }
        } catch {
          // Tool call parse failed, keep raw answer
        }
      }
    } catch (e) {
      answer = `抱歉，AI 服务暂时不可用：${(e as Error).message}。请检查 DeepSeek API Key 配置或稍后重试。`;
    }

    // Save assistant message
    await this.prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
        cardsJson: (cards.length > 0 ? cards : undefined) as any,
        citationsJson: (citations.length > 0 ? citations : undefined) as any,
      },
    });

    // Update conversation title on first message
    if (!conversation.messages?.length) {
      await this.prisma.assistantConversation.update({
        where: { id: conversation.id },
        data: { title: dto.message.slice(0, 30) },
      });
    }

    return {
      conversationId: conversation.id,
      answer,
      cards,
      citations,
      pendingActions,
    };
  }

  async listConversations() {
    return this.prisma.assistantConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 20,
    });
  }

  async getConversation(id: string) {
    return this.prisma.assistantConversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async confirmAction(id: string) {
    const log = await this.prisma.assistantActionLog.findUnique({
      where: { id },
    });
    if (!log) return { status: 'failed', message: '操作记录不存在' };
    if (log.status !== 'pending')
      return { status: 'failed', message: '操作已处理，无需重复确认' };

    await this.prisma.assistantActionLog.update({
      where: { id },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });

    return this.actionExecutor.execute(id);
  }

  async cancelAction(id: string) {
    const log = await this.prisma.assistantActionLog.findUnique({
      where: { id },
    });
    if (!log) return { status: 'failed', message: '操作记录不存在' };

    await this.prisma.assistantActionLog.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    return { status: 'success', message: '操作已取消' };
  }
}
