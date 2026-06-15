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
import { ChatMessage } from './model/assistant-model-provider';
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

    await this.prisma.assistantMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: dto.message },
    });

    const history: ChatMessage[] = conversation.messages?.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })) || [];

    const toolList = this.toolRegistry.list()
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
- 回答必须遵循系统提示词中的总-分结构和数据引用原则，直接引用工具返回的项目名称、金额、日期等具体信息，不写空洞的概括。
- 禁止使用任何 emoji 表情符号。
- 涉及修改/审批/删除/禁用/退回时，说明操作预案和风险，不要直接执行。`;

    const messages = [
      { role: 'system' as const, content: fullSystemPrompt },
      ...history.slice(-20),
      { role: 'user' as const, content: dto.message },
    ];

    let answer: string;
    let cards: unknown[] = [];
    const citations: unknown[] = [];
    const pendingActions: unknown[] = [];

    // Quick path: direct tool dispatch from frontend quick cards
    const directToolMatch = dto.message.match(
      /请调用\s+(\w+)\s+工具[，,]\s*参数\s+(\{[\s\S]*?\})/,
    );

    try {
      if (directToolMatch) {
        answer = await this.handleDirectToolCall(
          directToolMatch, messages, cards, citations,
        );
      } else {
        answer = await this.handleNormalChat(messages, cards, citations);
      }
    } catch (e) {
      answer = `抱歉，AI 服务暂时不可用：${(e as Error).message}。请检查 DeepSeek API Key 配置或稍后重试。`;
    }

    await this.prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
        cardsJson: (cards.length > 0 ? cards : undefined) as any,
        citationsJson: (citations.length > 0 ? citations : undefined) as any,
      },
    });

    if (!conversation.messages?.length) {
      await this.prisma.assistantConversation.update({
        where: { id: conversation.id },
        data: { title: dto.message.slice(0, 30) },
      });
    }

    return { conversationId: conversation.id, answer, cards, citations, pendingActions };
  }

  private async handleDirectToolCall(
    match: RegExpMatchArray,
    messages: ChatMessage[],
    cards: unknown[],
    citations: unknown[],
  ): Promise<string> {
    const toolName = match[1];
    let toolArgs: Record<string, unknown> = {};
    try {
      toolArgs = JSON.parse(match[2]);
    } catch { /* keep empty args */ }

    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      const res = await this.model.chat(messages);
      return res.text;
    }

    const result = await tool.execute(toolArgs);
    if (result.success && result.cards) {
      for (const c of result.cards) cards.push(c);
    }
    if (result.citations) {
      for (const c of result.citations) citations.push(c);
    }

    const toolSummary = result.success
      ? `查询成功，已生成 ${(result.cards || []).length} 张数据卡片。请基于这些卡片中的数据，按照系统提示词中的回答格式规范，给董事长一份针对性的分析与建议。`
      : `工具调用失败: ${result.error}`;

    const directMessages = [
      ...messages,
      {
        role: 'user' as const,
        content: `（系统消息）工具 ${toolName} 已执行完毕。${toolSummary}\n\n请基于卡片中的真实数据，用自然段落给出你的判断和建议。不要罗列数字，卡片已在前端渲染。`,
      },
    ];
    const res = await this.model.chat(directMessages);
    return res.text;
  }

  private async handleNormalChat(
    messages: ChatMessage[],
    cards: unknown[],
    citations: unknown[],
  ): Promise<string> {
    const res = await this.model.chat(messages);
    let answer = res.text;

    // Check for TOOL_CALL in model response
    const toolCallMatch = answer.match(/TOOL_CALL:\s*(\{[\s\S]*?"tool"[\s\S]*?\})/);
    if (!toolCallMatch) return answer;

    // Parse JSON — extend if braces unbalanced
    let jsonStr = toolCallMatch[1];
    let braceCount = 0;
    for (const ch of jsonStr) {
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    if (braceCount !== 0) {
      const startIdx = answer.indexOf(jsonStr);
      let endIdx = startIdx + jsonStr.length;
      while (braceCount > 0 && endIdx < answer.length) {
        if (answer[endIdx] === '{') braceCount++;
        if (answer[endIdx] === '}') braceCount--;
        endIdx++;
      }
      jsonStr = answer.slice(startIdx, endIdx);
    }

    let toolCall: { tool: string; args: Record<string, unknown> };
    try {
      toolCall = JSON.parse(jsonStr);
    } catch {
      return answer; // parse failed, return raw
    }

    const tool = this.toolRegistry.get(toolCall.tool);
    if (!tool) return answer;

    const result = await tool.execute(toolCall.args || {});
    if (result.success && result.cards) {
      for (const c of result.cards) cards.push(c);
    }
    if (result.citations) {
      for (const c of result.citations) citations.push(c);
    }

    // Second model call to synthesize
    const toolDataStr = JSON.stringify(result.data || result).slice(0, 3000);
    const toolSummary = result.success
      ? `查询成功。以下是工具返回的真实数据（JSON格式，请直接引用其中的项目名称、金额、日期、状态等具体信息）：\n\`\`\`json\n${toolDataStr}\n\`\`\`\n\n请基于以上真实数据，按系统提示词的总-分结构输出回答。必须引用具体的项目名称、金额数字、时间节点和状态信息。不要写空泛的概括。`
      : `工具调用失败: ${result.error}`;

    try {
      const followUp = await this.model.chat([
        ...messages,
        { role: 'assistant' as const, content: answer },
        {
          role: 'user' as const,
          content: `工具 ${toolCall.tool} 返回了数据。${toolSummary}`,
        },
      ]);
      answer = followUp.text;
    } catch {
      // keep original
    }

    return answer;
  }

  async getQuickStats() {
    const [
      procurementTotal,
      procurementPending,
      bidTotal,
      bidActive,
      supplierTotal,
      supplierApproved,
      supplierPending,
      supplierRisk,
      expertTotal,
      expertAvailable,
      announcementPublished,
      catalogItemCount,
      notificationUnread,
    ] = await Promise.all([
      this.prisma.procurementProject.count(),
      this.prisma.procurementProject.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.bidProject.count(),
      this.prisma.bidProject.count({ where: { stage: { in: ['OPENING', 'EVALUATING'] } } }),
      this.prisma.supplier.count(),
      this.prisma.supplier.count({ where: { status: 'APPROVED' } }),
      this.prisma.supplier.count({ where: { status: 'PENDING' } }),
      this.prisma.supplier.count({ where: { status: { in: ['DISABLED', 'BLACKLIST'] } } }),
      this.prisma.expertProfile.count(),
      this.prisma.expertProfile.count({ where: { availability: '可用' } }),
      this.prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.catalogItem.count(),
      this.prisma.notification.count({ where: { isRead: false } }),
    ]);

    // Detect the most notable system state for each dimension
    const focusAreas: string[] = [];
    if (procurementTotal === 0) focusAreas.push('采购立项为空');
    if (procurementPending > 0) focusAreas.push(`${procurementPending}个项目待审批`);
    if (bidActive > 0) focusAreas.push(`${bidActive}个招标进行中`);
    if (supplierPending > 0) focusAreas.push(`${supplierPending}家供应商待审核`);
    if (supplierRisk > 0) focusAreas.push(`${supplierRisk}家供应商有风险`);
    if (notificationUnread > 0) focusAreas.push(`${notificationUnread}条未读通知`);

    return {
      procurement: { total: procurementTotal, pending: procurementPending },
      bid: { total: bidTotal, active: bidActive },
      supplier: { total: supplierTotal, approved: supplierApproved, pending: supplierPending, risk: supplierRisk },
      expert: { total: expertTotal, available: expertAvailable },
      announcement: { published: announcementPublished },
      catalog: { items: catalogItemCount },
      notification: { unread: notificationUnread },
      focusAreas: focusAreas.slice(0, 4),
      generatedAt: new Date().toISOString(),
    };
  }

  async listConversations() {
    const conversations = await this.prisma.assistantConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          where: { role: 'user' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
      take: 20,
    });

    return conversations.map((c) => ({
      id: c.id,
      title: c.title,
      firstMessage: c.messages[0]?.content?.slice(0, 100) || '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  async getConversation(id: string) {
    return this.prisma.assistantConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async confirmAction(id: string) {
    const log = await this.prisma.assistantActionLog.findUnique({ where: { id } });
    if (!log) return { status: 'failed', message: '操作记录不存在' };
    if (log.status !== 'pending') return { status: 'failed', message: '操作已处理，无需重复确认' };

    await this.prisma.assistantActionLog.update({
      where: { id },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });
    return this.actionExecutor.execute(id);
  }

  async cancelAction(id: string) {
    const log = await this.prisma.assistantActionLog.findUnique({ where: { id } });
    if (!log) return { status: 'failed', message: '操作记录不存在' };

    await this.prisma.assistantActionLog.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    return { status: 'success', message: '操作已取消' };
  }

  async deleteConversation(id: string) {
    // Messages cascade-delete via onDelete: Cascade in schema
    await this.prisma.assistantConversation.delete({
      where: { id },
    });
    return { status: 'success', message: '会话已删除' };
  }
}
