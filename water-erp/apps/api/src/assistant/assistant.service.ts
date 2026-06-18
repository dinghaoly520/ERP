import { Injectable, Logger } from '@nestjs/common';
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
import { mapToChart } from './chart.mapper';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

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
- 优先调用能产出"统计/分布"数据的 action（如 global_overview、各工具的 stats 动作），这些数据会自动生成可视化图表。
- 对于综合概览类问题（如"整体运行状况""全面梳理""体检"），必须首先调用 global_overview 工具，它会返回采购/招标/供应商/专家的状态分布统计。
- 回答必须遵循系统提示词中的总-分结构和数据引用原则，直接引用工具返回的项目名称、金额、日期等具体信息，不写空洞的概括。
- 禁止使用任何 emoji 表情符号。
- 涉及修改/审批/删除/禁用/退回时，说明操作预案和风险，不要直接执行。`;

    const messages = [
      { role: 'system' as const, content: fullSystemPrompt },
      ...history,
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
      this.logger.error(`chat() 主流程异常: ${(e as Error).message}`, (e as Error).stack);
    }

    this.logger.log(`chat() 主流程完成，准备清理 answer。当前 answer 长度=${answer?.length || 0}, cards=${cards.length}`);

    // 安全网：剥离 Markdown 格式符号（无论模型是否遵守提示词规则）
    answer = this.stripMarkdown(answer);
    this.logger.log('stripMarkdown 完成');
    // 安全网：剥离残留的英文字母/单词（无论模型是否遵守提示词规则）
    answer = this.stripEnglish(answer);
    this.logger.log('stripEnglish 完成');

    // Guard against empty answers — if all paths produced nothing, give a fallback
    if (!answer || !answer.trim()) {
      answer = '抱歉，AI 未能生成有效回复。请重新提问或换一种方式描述您的问题。';
    }

    try {
      this.logger.log(`准备保存会话消息，cardsJson 大小=${JSON.stringify(cards).length} 字节`);
      await this.prisma.assistantMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: answer,
          cardsJson: (cards.length > 0 ? cards : undefined) as any,
          citationsJson: (citations.length > 0 ? citations : undefined) as any,
        },
      });
      this.logger.log('会话消息保存成功');
    } catch (e) {
      this.logger.error(`保存助手消息失败: ${(e as Error).message}`, (e as Error).stack);
    }

    if (!conversation.messages?.length) {
      try {
        await this.prisma.assistantConversation.update({
          where: { id: conversation.id },
          data: { title: dto.message.slice(0, 30) },
        });
      } catch {
        // title update is best-effort
      }
    }

    this.logger.log(`chat() 返回响应: conversationId=${conversation.id}, answerLen=${answer.length}, cards=${cards.length}`);
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
    this.pushCardsWithCharts(result, cards);
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

    // Parse ALL TOOL_CALL directives (model may emit several for comprehensive questions)
    const toolCalls = this.parseAllToolCalls(answer);
    if (toolCalls.length === 0) return answer;

    this.logger.log(
      `handleNormalChat: 解析到 ${toolCalls.length} 个 TOOL_CALL: ${toolCalls.map((t) => `${t.tool}(${JSON.stringify(t.args)})`).join(', ')}`,
    );

    // Strip every TOOL_CALL line from the narrative upfront
    answer = this.stripAllToolCalls(answer);

    // 保证每次数据查询都产出图表：若模型未调用 global_overview，自动补一个
    // global_overview 产出采购/招标/供应商/专家四张分布表 → 自动生成图表
    const toolNames = new Set(toolCalls.map((t) => t.tool));
    if (!toolNames.has('global_overview')) {
      toolCalls.unshift({ tool: 'global_overview', args: {} });
      this.logger.log('handleNormalChat: 自动补充 global_overview 调用以保证图表产出');
    }

    // Execute each tool, aggregate cards for LLM summary
    let successCount = 0;
    for (const tc of toolCalls) {
      const tool = this.toolRegistry.get(tc.tool);
      if (!tool) {
        this.logger.warn(`handleNormalChat: 未知工具 ${tc.tool}`);
        continue;
      }
      const result = await tool.execute(tc.args || {});
      this.pushCardsWithCharts(result, cards);
      if (result.citations) {
        for (const c of result.citations) citations.push(c);
      }
      if (result.success) successCount++;
    }

    this.logger.log(
      `handleNormalChat: 生成 ${cards.length} 张卡片（含 ${cards.filter((c) => (c as any).type === 'chart').length} 张图表），${successCount} 个工具成功返回数据`,
    );

    if (cards.length === 0) {
      return answer.trim() ||
        '抱歉，数据查询失败，请稍后重试或换一种方式提问。';
    }

    // 用已有的 cards 摘要传给 LLM 做第二轮调用 —— 避免传递原始 Prisma 实体
    let toolDataStr = '';
    try {
      // cards 里都是纯 JS 对象（table 的 rows/columns, chart 的 option），安全序列化
      const cardDigest = (cards as Array<Record<string, unknown>>).map((c) => ({
        type: c.type,
        title: c.title,
        ...(c.type === 'table'
          ? { rowCount: Array.isArray(c.rows) ? (c.rows as unknown[]).length : 0 }
          : { chartType: (c as Record<string, unknown>).chartType }),
      }));
      toolDataStr = JSON.stringify(cardDigest).slice(0, 3000);
    } catch (e) {
      this.logger.warn(`handleNormalChat: cards JSON 摘要失败: ${(e as Error).message}`);
      toolDataStr = `${cards.length} 张卡片已生成`;
    }

    const toolSummary = `以下是 ${successCount} 个工具返回的真实数据摘要，请综合引用其中的项目名称、金额、日期等具体信息：\n\`\`\`json\n${toolDataStr}\n\`\`\`\n\n请基于以上真实数据，按系统提示词的总-分结构输出回答。必须引用具体的项目名称、金额数字、时间节点。注意：数据中的英文状态码（如OPENING、PENDING）仅供你理解使用，在回答中必须转换为中文（如"开标阶段""待审核"），严禁在回答中输出英文代码。不要写空泛的概括。`;

    try {
      // 若剥离 TOOL_CALL 后 answer 为空，不传空 assistant 消息（DeepSeek 会拒绝空 content）
      const followUpMessages: ChatMessage[] = [...messages];
      const narrative = answer.trim();
      if (narrative) {
        followUpMessages.push({ role: 'assistant', content: narrative });
      }
      followUpMessages.push({ role: 'user', content: toolSummary });

      this.logger.log('handleNormalChat: 开始第二轮 DeepSeek 调用...');
      const followUp = await this.model.chat(followUpMessages);
      const followUpText = followUp.text?.trim();
      this.logger.log(`handleNormalChat: 第二轮 DeepSeek 调用完成，回复长度=${followUpText?.length || 0}`);
      if (followUpText) {
        answer = followUpText;
      }
      // If empty, keep the stripped narrative (answer already had TOOL_CALL removed)
    } catch (e) {
      this.logger.error(`handleNormalChat: 第二轮模型调用失败: ${(e as Error).message}`);
      // Second call failed — keep stripped narrative
    }

    // Safety net: strip any TOOL_CALL that may have leaked into the final answer
    answer = this.stripAllToolCalls(answer).trim();
    this.logger.log(`handleNormalChat: 最终 answer 长度=${answer.length}, cards=${cards.length}`);
    return answer ||
      '抱歉，AI 未能生成有效回复，请重新提问。';
  }

  /**
   * Parse all TOOL_CALL directives from text, with balanced-brace JSON extraction.
   */
  private parseAllToolCalls(text: string): Array<{ tool: string; args: Record<string, unknown> }> {
    const results: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const marker = 'TOOL_CALL:';
    let searchFrom = 0;

    while (true) {
      const idx = text.indexOf(marker, searchFrom);
      if (idx === -1) break;

      // Find the opening brace after the marker
      let i = idx + marker.length;
      while (i < text.length && text[i] !== '{') i++;
      if (i >= text.length) break;

      // Read balanced braces
      const start = i;
      let depth = 0;
      let inStr = false;
      let escape = false;
      let end = -1;
      for (; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }

      if (end === -1) break; // unbalanced — stop

      const jsonStr = text.slice(start, end + 1);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed.tool === 'string') {
          results.push({ tool: parsed.tool, args: parsed.args || {} });
        }
      } catch {
        // skip malformed
      }
      searchFrom = end + 1;
    }

    return results;
  }

  /**
   * Remove all TOOL_CALL directives (with balanced braces) from text.
   */
  private stripAllToolCalls(text: string): string {
    const calls = this.parseAllToolCalls(text);
    let result = text;
    // Re-scan and remove each TOOL_CALL:{...} block by balanced braces
    const marker = 'TOOL_CALL:';
    let output = '';
    let i = 0;
    while (i < result.length) {
      const idx = result.indexOf(marker, i);
      if (idx === -1) {
        output += result.slice(i);
        break;
      }
      output += result.slice(i, idx);
      // Skip past the balanced JSON
      let j = idx + marker.length;
      while (j < result.length && result[j] !== '{') j++;
      if (j >= result.length) { output += result.slice(idx); break; }
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (; j < result.length; j++) {
        const ch = result[j];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
      }
      i = j;
    }
    // Collapse extra blank lines left behind
    return output.replace(/\n{3,}/g, '\n\n');
  }

  /**
   * 安全网：剥离所有 Markdown 格式字符。
   * 无论系统提示词是否生效，最终输出不会有粗体/斜体/代码等格式。
   */
    private stripMarkdown(text: string): string {
    return text
      // 暴力清除所有星号
      .replace(/[*]+/g, '')
      // 清除下划线
      .replace(/_+/g, '')
      // 清除波浪号
      .replace(/~+/g, '')
      // 清除反引号
      .replace(/`+/g, '')
      // 清除井号标题
      .replace(/^#{1,6}\s+/gm, '')
      // 清除引用标记
      .replace(/^>\s?/gm, '')
      // 清除列表标记
      .replace(/^[\s]*[\-\+\*]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      // 清除水平线
      .replace(/^[-=]{3,}\s*$/gm, '')
      // 清除代码块标记
      .replace(/```[\s\S]*?```/gm, '')
      // 清理多余空行
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 安全网：剥离残留的英文字母和英文标点。
   * 只保留中文字符、中文标点、数字、空格、换行和常用的中文分隔符。
   */
  private stripEnglish(text: string): string {
    return text
      // 删除所有 ASCII 字母（a-z, A-Z）
      .replace(/[a-zA-Z]+/g, '')
      // 删除英文标点符号
      .replace(/[`*_#~$%^&|\\@!=\[\]{};:'"<>?,.\/()]+/g, '')
      // 清理可能残留的单个字母
      .replace(/\s+[a-zA-Z]\s+/g, ' ')
      // 清理多余空格
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Push cards from a tool result, auto-generating chart cards for any table with viz.
   * Deduplicates by type+title to avoid duplicate tables/charts when multiple tools
   * produce the same distribution (e.g. global_overview + individual tool stats).
   */
  private pushCardsWithCharts(
    result: { success: boolean; cards?: unknown[] },
    cards: unknown[],
  ): void {
    if (!result.success || !result.cards) return;
    for (const c of result.cards) {
      const ct = c as Record<string, unknown>;
      const cardKey = `${ct.type}:${ct.title}`;
      // 跳过完全重复的卡片（同类型+同标题=真重复，如 global_overview 和 bid stats 都产出"招标项目阶段分布"）
      if (cards.some((existing) => {
        const et = existing as Record<string, unknown>;
        return `${et.type}:${et.title || ''}` === cardKey;
      })) continue;
      cards.push(c);
      if (ct.type !== 'table' || !ct.viz) continue;
      // 图表标题加"图表："前缀以区分同名的表格卡片
      const chartCard = mapToChart({
        title: `图表：${(ct.title as string) || ''}`,
        columns: ct.columns as Array<{ key: string; label: string }>,
        rows: ct.rows as Array<Record<string, unknown>>,
        viz: ct.viz as Parameters<typeof mapToChart>[0]['viz'],
      });
      if (chartCard) cards.push(chartCard);
    }
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
      firstMessage: c.messages?.[0]?.content?.slice(0, 100) || '',
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
