import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeepSeekProvider } from './model/deepseek.provider';
import { ToolRegistry } from './tools/tool-registry';
import type { ToolResult } from './tools/assistant-tool';
import { AssistantToolCtx } from './tools/assistant-tool';
import { GlobalOverviewTool } from './tools/global-overview.tool';
import { ProcurementTool } from './tools/procurement.tool';
import { PmiTool } from './tools/pmi.tool';
import { BidTool } from './tools/bid.tool';
import { SupplierTool } from './tools/supplier.tool';
import { ExpertTool } from './tools/expert.tool';
import { PUBLIC_VISIBLE_CLASSES } from '@water-erp/shared';
import { AnnouncementTool } from './tools/announcement.tool';
import { NotificationTool } from './tools/notification.tool';
import { CockpitTool } from './tools/cockpit.tool';
import { ActionPlannerService } from './actions/action-planner.service';
import { ActionExecutorService } from './actions/action-executor.service';
import { SYSTEM_KNOWLEDGE } from './knowledge/system-knowledge';
import { AssistantRagService } from './knowledge/rag-retrieval.service';
import { ChatMessage } from './model/assistant-model-provider';
import { ChatDto } from './dto/chat.dto';
import { mapToChart } from './chart.mapper';
import { applyCardGate } from './card-gate';
import { toolCompanyWhere } from './tools/company-filter';

/** 会话属主：认证用户（JWT）或匿名访客（X-Assistant-Guest 头） */
export interface AssistantOwner {
  /** 认证用户 id（有值即视为已认证——敏感工具仅此态可用） */
  userId?: string;
  /** 匿名访客键（:3008 localStorage 生成） */
  guestKey?: string;
  /** 认证用户角色（来自 JWT payload，不可由前端声明） */
  role?: string;
}

/** 属主 → 会话表写入口径（认证记 userId，匿名记 guestKey；二者互斥，认证优先） */
function ownerData(owner: AssistantOwner | null) {
  if (!owner) return {};
  if (owner.userId) return { userId: owner.userId };
  if (owner.guestKey) return { guestKey: owner.guestKey };
  return {};
}

/** 会话与属主是否匹配（无属主的存量会话对所有人不可见） */
function ownedBy(
  conv: { userId: string | null; guestKey: string | null },
  owner: AssistantOwner | null,
): boolean {
  if (!owner) return false;
  if (owner.userId) return conv.userId === owner.userId;
  if (owner.guestKey) return conv.guestKey === owner.guestKey;
  return false;
}

export function pickAdminCompanyIds(raw: unknown, role: string): string[] | undefined {
  if (role !== 'admin' || !Array.isArray(raw)) return undefined;
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 50);
  return ids.length ? ids : undefined;
}

export async function resolveToolCtx(
  prisma: { user: { findUnique(args: { where: { id: string }; select: { companyId: boolean } }): Promise<{ companyId: string | null } | null> } },
  owner: { userId?: string; guestKey?: string; role?: string } | null,
  contextCompanyIdList: unknown,
  contextPortal?: unknown,
): Promise<import('./tools/assistant-tool').AssistantToolCtx> {
  if (!owner?.userId) return {};
  const u = await prisma.user.findUnique({ where: { id: owner.userId }, select: { companyId: true } });
  const role = owner.role ?? '';
  const ctx: import('./tools/assistant-tool').AssistantToolCtx = {
    user: { sub: owner.userId, role, companyId: u?.companyId ?? null },
  };
  /* :3011 总数据裁定（2026-11-03 用户）：移动驾驶舱不做公司隔离——leader/staff/
   * bid_host 在 :3011 提问同样取全库口径（ctx.totalData 短路公司过滤）。
   * 判据=代理注入头 x-portal-source: mobile-3011（评审 F1：不信 body 自报——
   * 浏览器层不可伪造；持 token 直连 :4001 自设头属内部信任域，数据为内部统计）。
   * :3005/:3008 不带该头，维持 2026-10-22 公司隔离语义与 e2e 闸 */
  if (contextPortal === 'mobile-3011' && ['leader', 'staff', 'bid_host'].includes(role)) {
    ctx.totalData = true;
  }
  const ids = pickAdminCompanyIds(contextCompanyIdList, role);
  if (ids) ctx.companyIds = ids;
  return ctx;
}

@Injectable()
export class AssistantService {
  /**
   * 匿名/外部角色可用的工具：仅公开域数据（已发布公告）。
   * 供应商联系人、专家库、项目/通知等内部数据工具仅内部管理角色可用
   * （P0 收口 2026-09-28；2026-09-29 二审收紧：认证≠授权——supplier/bid_expert/mall
   * 等外部角色登录后同样不得经 AI 拉供应商联系人/专家证件等 PII）。
   */
  private static readonly PUBLIC_TOOLS = new Set(['announcement']);
  private static readonly INTERNAL_ROLES = ['admin', 'leader', 'staff', 'bid_host'];
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly model: DeepSeekProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly globalOverviewTool: GlobalOverviewTool,
    private readonly procurementTool: ProcurementTool,
    private readonly pmiTool: PmiTool,
    private readonly bidTool: BidTool,
    private readonly supplierTool: SupplierTool,
    private readonly expertTool: ExpertTool,
    private readonly announcementTool: AnnouncementTool,
    private readonly notificationTool: NotificationTool,
    private readonly cockpitTool: CockpitTool,
    private readonly actionPlanner: ActionPlannerService,
    private readonly actionExecutor: ActionExecutorService,
    private readonly rag: AssistantRagService,
  ) {
    this.registerTools();
  }

  private registerTools() {
    this.toolRegistry.register(this.globalOverviewTool);
    this.toolRegistry.register(this.procurementTool);
    this.toolRegistry.register(this.pmiTool);
    this.toolRegistry.register(this.bidTool);
    this.toolRegistry.register(this.supplierTool);
    this.toolRegistry.register(this.expertTool);
    this.toolRegistry.register(this.announcementTool);
    this.toolRegistry.register(this.notificationTool);
    this.toolRegistry.register(this.cockpitTool);
  }

  async createConversation(title?: string, owner: AssistantOwner | null = null) {
    const conv = await this.prisma.assistantConversation.create({
      data: { title: title || '新对话', ...ownerData(owner) },
    });
    return {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  async chat(dto: ChatDto, owner: AssistantOwner | null = null, portalSource?: unknown) {
    const conversation = dto.conversationId
      ? await this.prisma.assistantConversation.findUnique({
          where: { id: dto.conversationId },
          /* 历史窗口取最近 20 条（2026-11-04 审查 P0：asc+take=20 取的是最旧 20 条，
           * 长会话最新上下文全丢、模型「失忆」）——desc 取最新再反转回时序 */
          include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } },
        })
      : await this.prisma.assistantConversation.create({
          data: { title: dto.message.slice(0, 50), ...ownerData(owner) },
          include: { messages: { orderBy: { createdAt: 'asc' }, take: 0 } },
        });
    if (conversation?.messages?.length) {
      conversation.messages = [...conversation.messages].reverse();
    }

    if (!conversation || (dto.conversationId && !ownedBy(conversation, owner))) {
      // 他人会话与不存在同口径，不泄露存在性（P0 会话隔离）；
      // 新建分支（无 conversationId）天然属本次调用——无属主=临时会话，列表不可见但可对话
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

    const toolCtx = await resolveToolCtx(
      this.prisma,
      owner,
      (dto.context as Record<string, unknown> | undefined)?.companyIds,
      /* 来源头（评审 F1 加固）：由 :3011 代理注入（x-portal-source），浏览器 JS
       * 不可伪造——body 自报 portal 已弃用（任意客户端可冒充破公司隔离） */
      portalSource,
    );

    // 工具门禁：内部管理角色全量；匿名访客与外部角色（supplier/bid_expert/mall 等）
    // 仅公开域工具（服务端按 JWT 角色裁决，不信前端 context）
    const allowedTools =
      owner?.userId && AssistantService.INTERNAL_ROLES.includes(owner.role ?? '')
        ? null
        : AssistantService.PUBLIC_TOOLS;
    const toolList = this.toolRegistry.list()
      .filter((t) => !allowedTools || allowedTools.has(t.name))
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    // 角色取 JWT（认证态）而非请求体——dto.context.userRole 可被任意伪造，仅作历史兼容字段
    const userRole = owner?.userId ? owner.role : undefined;
    const roleContext = userRole
      ? `\n\n【当前用户的身份信息】\n用户的系统角色是"${userRole}"。${
          ['admin', 'bid_host', 'leader', 'staff'].includes(userRole)
            ? userRole === 'admin'
              ? '该用户属于管理层，拥有全系统数据访问权限。你可以综合分析所有模块的数据，给出全局视角的建议。'
              : '该用户属于公司管理层（leader/staff/bid_host），数据权限限于其所属公司；工具会自动按公司过滤，回答时不要跨公司汇总，除非用户明确是管理员。'
            : '该用户属于业务层角色，你只应分析与其业务范围直接相关的数据。如果用户询问跨模块或全系统性的问题，应说明数据权限限制并聚焦到其可访问的范围内。'
        }\n`
      : '';

    const fullSystemPrompt = `${SYSTEM_KNOWLEDGE}${roleContext}

【你可以使用的数据工具】
${toolList}

【重要规则 —— 违反即为错误回复】
- 先判断问题类型，再决定是否调用工具（2026-11-04 口径：回答跟随提问，不强行扯数据）：
  1) 需要系统实时数据的问题（统计、数量、清单、详情、状态、趋势、排名、系统内业务分析）→ 必须先通过 TOOL_CALL 调用工具取真数据。你没有内置数据库，不调用工具就回复系统数据 = 编造。
  2) 不需要系统数据的问题——问候、闲聊、概念解释、法规政策条文、流程指引、写作起草、通用建议——→ 直接回答，禁止 TOOL_CALL，禁止把系统数据或统计扯进回答。
- 第一轮若调用工具，回复只包含 TOOL_CALL 指令、不写实质内容；工具返回真实数据后再撰写第二轮回复。
- 工具调用格式（放在回答最前面，独占一行）：
  TOOL_CALL: {"tool": "<工具名>", "args": {"action": "<action>", ...}}
- 综合概览类问题（如"整体运行状况""全面梳理"）调用 global_overview；清单/详情类调用对应工具的 list/detail；趋势类调用 monthly。
- 分布/结构类问题（如"专家分布""供应商结构""各公司项目情况"）是多结构数据——调用对应工具的 stats 动作并覆盖其返回的全部维度卡（如专家=专业/归属公司/职称/评审负荷），不得只挑一个维度作答。
- 数据类回答遵循系统提示词中的总-分结构和数据引用原则，直接引用工具返回的项目名称、金额、日期等具体信息，不写空洞的概括；非数据类回答按常规对话，简洁直接。
- 禁止使用任何 emoji 表情符号。
- 涉及修改/审批/删除/禁用/退回时，说明操作预案和风险，不要直接执行。`;

    // RAG 注入（2026-11-03 水叮当知识库设计 §4.1）：登录用户从「自己的∪共享」知识库
    // 检索 top5；降级铁律——null/异常一律按普通流程，对话永不因 RAG 失败报错
    let ragContext: { block: string; fileNames: string[] } | null = null;
    if (toolCtx.user) {
      ragContext = await this.rag.buildContext(dto.message, toolCtx.user).catch(() => null);
    }

    const messages = [
      { role: 'system' as const, content: fullSystemPrompt + (ragContext ? `\n\n${ragContext.block}` : '') },
      ...history,
      { role: 'user' as const, content: dto.message },
    ];

    let answer: string;
    const cards: unknown[] = [];
    const citations: unknown[] = [];
    const pendingActions: unknown[] = [];

    // Quick path: direct tool dispatch from frontend quick cards
    const directToolMatch = dto.message.match(
      /请调用\s+(\w+)\s+工具[，,]\s*参数\s+(\{[\s\S]*?\})/,
    );

    try {
      if (directToolMatch) {
        answer = await this.handleDirectToolCall(
          directToolMatch, messages, cards, citations, allowedTools, toolCtx,
        );
      } else {
        answer = await this.handleNormalChat(messages, cards, citations, allowedTools, toolCtx);
      }
    } catch (e) {
      answer = '抱歉，AI 服务暂时不可用，请稍后重试。';
      this.logger.error(`chat() 主流程异常: ${(e as Error).message}`, (e as Error).stack);
    }

    this.logger.debug(`chat() 主流程完成，answer 长度=${answer?.length || 0}, cards=${cards.length}`);

    // 安全网：剥离 Markdown 格式符号（无论模型是否遵守提示词规则）
    answer = this.stripMarkdown(answer);
// 安全网：剥离残留的英文字母/单词（无论模型是否遵守提示词规则）
    answer = this.stripEnglish(answer);
    this.logger.log(`stripEnglish 完成, 长度=${answer.length}`);

    // Guard against empty answers — if all paths produced nothing, give a fallback
    if (!answer || !answer.trim()) {
      answer = '抱歉，AI 未能生成有效回复。请重新提问或换一种方式描述您的问题。';
    }

    // RAG 来源标注（仅命中时）：回答尾部注明参考的知识库文件——先拼尾注再落库
    // （2026-11-04 审查 P1：此前落库后才追加，实时回答带尾注而历史回放没有，两副面孔）
    if (ragContext && ragContext.fileNames.length && answer) {
      answer += `\n\n（参考知识库：${ragContext.fileNames.join('、')}）`;
    }

    try {
      await this.prisma.assistantMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: answer,
          cardsJson: (cards.length > 0 ? cards : undefined) as any,
          citationsJson: (citations.length > 0 ? citations : undefined) as any,
        },
      });
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
    allowedTools: Set<string> | null = null,
    ctx: AssistantToolCtx = {},
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

    if (allowedTools && !allowedTools.has(toolName)) {
      this.logger.warn(`handleDirectToolCall: 匿名访客请求内部工具 ${toolName}，已拒绝`);
      return '抱歉，该类数据需要登录采购管理系统后才能查询。您可以询问公开的采购公告信息，或进行采购业务知识咨询。';
    }

    const result = await tool.execute(toolArgs, ctx);
    const { attachedCount, droppedData } = this.pushCardsWithCharts(result, cards);
    if (result.citations) {
      for (const c of result.citations) citations.push(c);
    }

    /* 提示词随挂载结果自适应（2026-11-03 回答跟随提问）：挂了卡→现文案；
       规则闸全弃（一句话可答）→ 关键数字写进正文，不再假装「卡片已渲染」 */
    const toolSummary = result.success
      ? attachedCount > 0
        ? `查询成功，已生成 ${attachedCount} 张数据卡片。请基于这些卡片中的数据，按照系统提示词中的回答格式规范，给董事长一份针对性的分析与建议。`
        : `查询成功。本次不展示数据卡片，查询结果：${droppedData.join('；')}。请把这些关键数字自然地写进正文回答（原样引用，一个不能改），不要罗列元描述。`
      : `工具调用失败: ${result.error}`;

    const directMessages = [
      ...messages,
      {
        role: 'user' as const,
        content:
          attachedCount > 0
            ? `（系统消息）工具 ${toolName} 已执行完毕。${toolSummary}\n\n请基于卡片中的真实数据，用自然段落给出你的判断和建议。不要罗列数字，卡片已在前端渲染。`
            : `（系统消息）工具 ${toolName} 已执行完毕。${toolSummary}\n\n请把上述关键数字写进自然段落正文。`,
      },
    ];
    const res = await this.model.chat(directMessages);
    return res.text;
  }

  /**
   * 安全兜底：模型没有调用任何工具就直接输出回复（大概率编造数据），
   * 强制调用 global_overview 获取真实数据，再以此为基础生成第二轮回復。
   */
  private async handleFallbackWithGlobalOverview(
    messages: ChatMessage[],
    cards: unknown[],
    citations: unknown[],
    allowedTools: Set<string> | null = null,
    ctx: AssistantToolCtx = {},
  ): Promise<string> {
    // 匿名访客不允许注入内部全局概览（采购/投标/供应商/专家分布属内部运营数据）
    if (allowedTools && !allowedTools.has('global_overview')) {
      return '抱歉，该问题涉及系统内部数据，需要登录采购管理系统后才能查询。您可以询问公开的采购公告信息。';
    }

    // 执行 global_overview 获取真实统计数据（公司口径随 ctx 穿参——漏穿即全公司卡片泄漏）
    const tool = this.toolRegistry.get('global_overview');
    if (tool) {
      const result = await tool.execute({}, ctx);
      this.pushCardsWithCharts(result, cards);
    }

    if (cards.length === 0) {
      return '抱歉，数据查询服务暂时不可用，请稍后重试。';
    }

    // 提取全局概览数字为纯文本摘要
    const overviewCard = (cards as Array<Record<string, unknown>>)
      .find((c) => c.type === 'table' && (c.title as string || '').includes('全局概览'));
    let overviewText = '';
    if (overviewCard && Array.isArray(overviewCard.rows)) {
      const items = (overviewCard.rows as Array<Record<string, unknown>>)
        .filter((r) => !r._total)
        .map((r) => `${r.item}：${r.value}个${r.note ? `（${r.note}）` : ''}`);
      overviewText = '【数据库实时查询结果】\n' + items.join('\n') + '\n\n';
    }

    const systemMsg = `${overviewText}以上是系统从数据库查询到的真实数据。你必须原样引用这些数字写回答，一个不能改。不要写"有N条记录"这种元描述，直接说数据本身。英文状态码必须翻译为中文。`;

    const followUpMessages: ChatMessage[] = [
      ...messages,
      { role: 'user' as const, content: systemMsg },
    ];

    try {
      const res = await this.model.chat(followUpMessages);
      this.logger.debug(`handleFallback: LLM 返回 ${res.text?.length || 0} 字`);
      return res.text?.trim() || '抱歉，AI 未能生成有效回复，请重新提问。';
    } catch (e) {
      this.logger.error(`handleFallbackWithGlobalOverview: 模型调用失败: ${(e as Error).message}`);
      return '抱歉，AI 服务暂时不可用，请稍后重试。';
    }
  }

  private async handleNormalChat(
    messages: ChatMessage[],
    cards: unknown[],
    citations: unknown[],
    allowedTools: Set<string> | null = null,
    ctx: AssistantToolCtx = {},
  ): Promise<string> {
    const res = await this.model.chat(messages);
    let answer = res.text;
    this.logger.debug(`handleNormalChat: 第一轮 LLM 返回 ${answer.length} 字`);

    // Parse ALL TOOL_CALL directives (model may emit several for comprehensive questions)
    const toolCalls = this.parseAllToolCalls(answer);
    if (toolCalls.length === 0) {
      /* 「回答跟随提问」（2026-11-04）：非数据类问题（问候/概念/法规/写作）按提示词
       * 直答、无工具调用是正常形态——直答不含系统数据断言时原样放行；只有直答里
       * 出现「数字+计量单位 / 系统口径措辞+数字」这类未查先答的数据断言，才视为
       * 编造风险走 global_overview 数据兜底 */
      if (this.looksLikeDataClaim(answer)) {
        this.logger.warn('handleNormalChat: 模型未调用工具但直答含数据断言，走数据兜底核查');
        return this.handleFallbackWithGlobalOverview(messages, cards, citations, allowedTools, ctx);
      }
      this.logger.log('handleNormalChat: 非数据直答（无工具调用、无数据断言），原样放行');
      return answer;
    }

    this.logger.log(
      `handleNormalChat: 解析到 ${toolCalls.length} 个 TOOL_CALL: ${toolCalls.map((t) => `${t.tool}(${JSON.stringify(t.args)})`).join(', ')}`,
    );

    // Strip every TOOL_CALL line from the narrative upfront
    answer = this.stripAllToolCalls(answer);

    // （2026-11-03 删除）「保证每次产出图表」的强制 global_overview 补挂——与
    // 「回答跟随提问」新口径相反：模型自己的工具选择决定挂什么卡；无工具调用的
    // 真实性兜底仍由 handleFallbackWithGlobalOverview 承担，此处不再画蛇添足。

    // Execute each tool, aggregate cards for LLM summary
    let successCount = 0;
    const dataSnippets: string[] = [];
    const droppedAll: string[] = []; // 规则闸丢弃的小表数据——数字进正文（2026-11-03）
    /* 异常隔离 + 并行执行（2026-11-04 审查 P1-4/P2-23）：单工具 DB 抖动此前直接冒泡
     * 到 chat() 外层 catch——整答换「服务不可用」且已挂卡片照常返回（答文与卡自相矛盾）。
     * 现逐工具 try/catch 转 success:false 继续答其余工具；独立查询无依赖 → Promise.all。 */
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const tool = this.toolRegistry.get(tc.tool);
        if (!tool) {
          this.logger.warn(`handleNormalChat: 未知工具 ${tc.tool}`);
          return { tc, result: null };
        }
        if (allowedTools && !allowedTools.has(tc.tool)) {
          this.logger.warn(`handleNormalChat: 匿名访客请求内部工具 ${tc.tool}，已跳过`);
          return { tc, result: null };
        }
        try {
          return { tc, result: await tool.execute(tc.args || {}, ctx) };
        } catch (e) {
          this.logger.error(`handleNormalChat: 工具 ${tc.tool} 执行异常: ${(e as Error).message}`, (e as Error).stack);
          return { tc, result: { success: false, error: `工具 ${tc.tool} 查询失败，请稍后重试` } as ToolResult };
        }
      }),
    );
    for (const { tc, result } of results) {
      if (!result) continue;
      const gate = this.pushCardsWithCharts(result, cards);
      droppedAll.push(...gate.droppedData);
      if (result.citations) {
        for (const c of result.citations) citations.push(c);
      }
      if (result.success) successCount++;
      // 安全网：部分工具的 list/detail 动作只返回 data、不产出 cards，
      // 而 service 只消费 cards → 真实实体名（供应商/专家/公告/项目详情）会被丢弃，
      // 模型只能凭汇总数字写宏观散文。这里把 data 序列化进上下文兜底。
      if (result.success && result.data != null && !result.cards?.length) {
        const snippet = this.serializeDataForLlm(tc.tool, result.data);
        if (snippet) dataSnippets.push(snippet);
      }
    }

    this.logger.log(
      `handleNormalChat: 生成 ${cards.length} 张卡片（含 ${cards.filter((c) => (c as any).type === 'chart').length} 张图表），${successCount} 个工具成功返回数据`,
    );

    /* 早退仅当工具全部失败（2026-11-03）：规则闸可能把小结果卡全弃——此时走
       第二轮 LLM 把 droppedAll 数字写进正文，而不是误报「查询失败」 */
    if (cards.length === 0 && successCount === 0) {
      return answer.trim() ||
        '抱歉，数据查询失败，请稍后重试或换一种方式提问。';
    }

    // 从全局概览卡片中提取关键数字，做成纯文本摘要——模型更容易准确引用
    const overviewCard = (cards as Array<Record<string, unknown>>)
      .find((c) => c.type === 'table' && (c.title as string || '').includes('全局概览'));
    let overviewText = '';
    if (overviewCard && Array.isArray(overviewCard.rows)) {
      const items = (overviewCard.rows as Array<Record<string, unknown>>)
        .filter((r) => !r._total)
        .map((r) => `${r.item}：${r.value}个${r.note ? `（${r.note}）` : ''}`);
      overviewText = '【数据库实时查询结果 —— 这些就是你回答时必须使用的数字，一个字不能改】\n' + items.join('\n') + '\n\n';
    }

    const toolSummary = `${droppedAll.length ? '【不挂卡片的小结果 —— 关键数字必须原样写进正文】\n' + droppedAll.join('\n') + '\n\n' : ''}${overviewText}${dataSnippets.length ? '【实体清单/详情 —— 数据库查到的真实记录，回答必须引用其中的名称、编号等具体信息，不得泛泛而谈】\n' + dataSnippets.join('\n') + '\n\n' : ''}以下是各模块状态分布表——用于支撑你展开分析，丰富细节：\n${JSON.stringify(
      (cards as Array<Record<string, unknown>>)
        .filter((c) => c.type === 'table' && !(c.title as string || '').includes('全局概览'))
        .slice(0, 4)
        .map((c) => ({
          title: c.title,
          rows: (c.rows as Array<Record<string, unknown>> || []).slice(0, 15).map((r: Record<string, unknown>) => {
            const { _total, ...rest } = r;
            return rest;
          }),
        })),
    ).slice(0, 3000)}\n\n【严格写作要求 —— 违反即为编造数据】\n0. 所有工具已执行完毕、上述即全部数据——你的回复中【禁止出现任何 TOOL_CALL 指令】，直接给出面向用户的最终中文回答（2026-11-03 实录：第二轮再发 TOOL_CALL 被剥离后正文为空，用户拿到「未能生成有效回复」）。\n1. 若用户问"有哪些项目/供应商/专家"等清单类问题，必须逐条列出实体清单中的名称，不得只给汇总数字。\n2. 涉及统计/数量时，必须原样引用上面的关键数字，例如"系统共有 23 个采购项目、25 个投标项目"——数字一个不能改。\n3. 后续每段也必须引用上面的具体数字，不能只说"有多条记录"。\n4. 英文状态码（OPENING、PENDING等）在回答中必须译为中文。`;

    try {
      // 若剥离 TOOL_CALL 后 answer 为空，不传空 assistant 消息（DeepSeek 会拒绝空 content）
      const followUpMessages: ChatMessage[] = [...messages];
      const narrative = answer.trim();
      if (narrative) {
        followUpMessages.push({ role: 'assistant', content: narrative });
      }
      followUpMessages.push({ role: 'user', content: toolSummary });

    const followUp = await this.model.chat(followUpMessages);
      let followUpText = followUp.text?.trim();
      this.logger.debug(`handleNormalChat: 第二轮 LLM 回复长度=${followUpText?.length || 0}`);
      /* 防御网（2026-11-03 实录）：第二轮偶发再输出纯 TOOL_CALL/空文——剥离后正文
       * 为空、用户拿到「未能生成有效回复」。追加一条显式禁令重试一次（仅失败路径付费） */
      if (!followUpText || !this.stripAllToolCalls(followUpText).trim()) {
        this.logger.warn('handleNormalChat: 第二轮为空/纯 TOOL_CALL，追加禁令重试一次');
        const retry = await this.model.chat([
          ...followUpMessages,
          { role: 'user' as const, content: '（系统消息）禁止再输出任何 TOOL_CALL——所有工具已执行完毕、上述即全部数据。请直接给出面向用户的最终中文回答。' },
        ]);
        const retryText = retry.text?.trim();
        if (retryText && this.stripAllToolCalls(retryText).trim()) {
          followUpText = retryText;
          this.logger.log(`handleNormalChat: 重试成功，回复长度=${retryText.length}`);
        }
      }
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
   * 直答是否含「系统数据式断言」——用于区分「非数据类问题的正常直答」（放行）
   * 与「未查先答的编造数据」（走兜底）。只认系统盘点口径的措辞，不裸配
   * 「数字+计量单位」：法定门槛（不足3家）、时长（延期30天）、日期（10日）
   * 都不是系统数据断言（2026-11-04 实录：宽判据把概念/写作直答也打成兜底）。
   */
  private looksLikeDataClaim(text: string): boolean {
    return /(系统|平台|库内|在库|现有|目前|当前|我们)[^。！？]{0,20}?\d/.test(text)
      || /(共有|总计|合计|已有|多达|仅剩|剩下)\s*\d/.test(text);
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
    const result = text;
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
   * 白名单（2026-10-28 界面文案裁定「格式名/键名/标准编号/U盾PIN 保留英文」+
   * 2026-11-04 审查 P0：裸剥曾把 SWHI-TP-2026102003 毁成 --2026102003、
   * GB/T 43711→43711、U盾→盾，与提示词「直接引用项目编号」自相矛盾）：
   * 项目/轮次类编码（字母-数字连串）、GB/T 等标准号、U盾、ISO 类缩写——
   * 先占位保护、剥完还原。
   */
  private stripEnglish(text: string): string {
    const kept: string[] = [];
    const protect = (m: string): string => {
      kept.push(m);
      return `\u0000${kept.length - 1}\u0000`;
    };
    return text
      // 1) 占位保护英文白名单：编码（SWHI-TP-2026102003 / TP-2026101901）、
      //    标准号（GB/T 43711、DB51/T）、U盾、常见缩写（ISO、PDF、DOCX、XML、CSV）
      .replace(/\b[A-Z]{1,10}(?:-[A-Z0-9]{1,12})+\b/g, protect)
      .replace(/\b[A-Z]{1,6}\d{0,4}\s*\/\s*[A-Z]{1,6}(?:\s*\d{1,8})?\b/g, protect)
      .replace(/U盾/g, protect)
      .replace(/\b(?:ISO|PDF|DOCX?|XLSX?|XML|CSV|JSON)\b/g, protect)
      // 2) 删除所有 ASCII 字母（a-z, A-Z）
      .replace(/[a-zA-Z]+/g, '')
      // 删除英文标点符号（保留 % 和 . 因为它们可能属于数字如 47.1%、0.8%）
      .replace(/[`*_#~$^&|\\@!=\[\]{};:'"<>?,\/()]+/g, '')
      // 清理可能残留的单个字母
      .replace(/\s+[a-zA-Z]\s+/g, ' ')
      // 清理多余空格
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      // 3) 还原白名单
      .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? '');
  }

  /**
   * 把工具的 data 负载（list/detail 结果）序列化成紧凑文本，喂给第二轮 LLM。
   * 兜底用：仅当工具返回了 data 但未产出 cards 时调用——避免真实实体名（项目/
   * 供应商/专家/公告）被 service 丢弃，导致模型只能凭汇总数字编宏观散文。
   */
  private serializeDataForLlm(toolName: string, data: unknown): string {
    const trunc = (s: unknown): unknown =>
      typeof s === 'string' ? (s.length > 80 ? s.slice(0, 80) + '…' : s) : s;
    const trimObj = (obj: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v == null || k === 'id') continue;
        if (typeof v === 'object' && !Array.isArray(v)) {
          // 嵌套对象（如 department）——只取 name/displayName/title 一层
          const name = (v as Record<string, unknown>).name ?? (v as Record<string, unknown>).displayName ?? (v as Record<string, unknown>).title;
          if (name != null) out[k] = trunc(name);
          continue;
        }
        out[k] = trunc(v);
      }
      return out;
    };
    try {
      const arr = Array.isArray(data) ? data : [data];
      const rows = arr.slice(0, 15).map((item) =>
        item && typeof item === 'object' ? trimObj(item as Record<string, unknown>) : item,
      );
      return `[${toolName} 返回 ${arr.length} 条]\n${JSON.stringify(rows).slice(0, 1500)}`;
    } catch {
      return '';
    }
  }

  /**
   * Push cards from a tool result, auto-generating chart cards for any table with viz.
   * Deduplicates by type+title to avoid duplicate tables/charts when multiple tools
   * produce the same distribution (e.g. global_overview + individual tool stats).
   */
  private pushCardsWithCharts(
    result: { success: boolean; cards?: unknown[] },
    cards: unknown[],
  ): { attachedCount: number; droppedData: string[] } {
    const droppedData: string[] = [];
    if (!result.success || !result.cards) return { attachedCount: 0, droppedData };
    let attachedCount = 0;
    for (const c of result.cards) {
      const ct = c as Record<string, unknown>;
      // 规则闸（2026-11-03 回答跟随提问）：一句话可答的小表不挂卡，数字转正文
      const gate = applyCardGate(ct);
      if (!gate.keep) {
        droppedData.push(gate.droppedText ?? '');
        continue;
      }
      const cardKey = `${ct.type}:${ct.title}`;
      // 跳过完全重复的卡片（同类型+同标题=真重复，如 global_overview 和 cockpit 都产出"采购阶段分布（在办）"）
      if (cards.some((existing) => {
        const et = existing as Record<string, unknown>;
        return `${et.type}:${et.title || ''}` === cardKey;
      })) continue;
      cards.push(c);
      attachedCount++;
      if (ct.type !== 'table' || !ct.viz) continue;
      // 图表标题加"图表："前缀以区分同名的表格卡片
      const chartCard = mapToChart({
        title: `图表：${(ct.title as string) || ''}`,
        columns: ct.columns as Array<{ key: string; label: string }>,
        rows: ct.rows as Array<Record<string, unknown>>,
        viz: ct.viz as Parameters<typeof mapToChart>[0]['viz'],
      });
      if (chartCard) {
        cards.push(chartCard);
        attachedCount++;
      }
    }
    return { attachedCount, droppedData };
  }

  async getQuickStats(ownerUserId?: string | null) {
    // 公共域聚合（两类调用方都要）
    const [announcementPublished] = await Promise.all([
      /* 公开域过滤（2026-11-04 审查 P2-20）：与 announcement 工具 PUBLIC_WHERE 同口径——
       * 裸 PUBLISHED 会把 RESTRICTED/保密类也计入，向匿名泄露内部公告计数 */
      this.prisma.announcement.count({
        where: {
          status: 'PUBLISHED',
          AND: [
            { OR: [{ dataClass: { in: PUBLIC_VISIBLE_CLASSES } }, { dataClass: null }] },
            { OR: [{ metadata: { path: ['visibility'], not: 'RESTRICTED' } }, { metadata: null }] },
          ],
        } as never,
      }),
    ]);

    /* 认证≠授权（2026-09-29 口径，评审 F2 补全）：匿名访客与外部角色
     * （supplier/bid_expert 等）都只返回公开域数字——内部审批/风险/未读等
     * 运营数字不对未授权方暴露；字段保形置 0，避免前端解构缺键 */
    const user = ownerUserId
      ? await this.prisma.user.findUnique({
          where: { id: ownerUserId },
          select: { role: true, companyId: true },
        })
      : null;
    const role = user?.role ?? '';
    if (!ownerUserId || !['admin', 'leader', 'staff', 'bid_host'].includes(role)) {
      return {
        procurement: { total: 0, pending: 0 },
        bid: { total: 0, active: 0 },
        supplier: { total: 0, approved: 0, pending: 0, risk: 0 },
        expert: { total: 0, available: 0 },
        announcement: { published: announcementPublished },
        notification: { unread: 0 },
        focusAreas: [],
        generatedAt: new Date().toISOString(),
      };
    }

    /* 公司隔离（2026-11-03 审计 F16）：leader/staff 计数注入本公司（与工具层
     * toolCompanyWhere 同口径）；未读通知此前数的是全平台所有人的未读——收口本人 */
    const companyWhere = toolCompanyWhere({
      user: user ? { sub: ownerUserId, role: user.role, companyId: user.companyId } : undefined,
    });

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
      notificationUnread,
    ] = await Promise.all([
      /* 「采购项目」口径（2026-11-04 用户裁定）：PMI 为准（非邀请招标、不含回收站）；
       * pending=台账立项待审批（旧台账审批概念，语义收窄为台账） */
      this.prisma.projectManagementItem.count({
        where: { ...companyWhere, status: { not: 'RECYCLED' }, procurementMethod: { not: '邀请招标' } },
      }),
      this.prisma.procurementProject.count({ where: { ...companyWhere, status: 'PENDING_REVIEW' } }),
      this.prisma.bidProject.count({ where: { ...companyWhere, isExtractionOnly: false } }),
      this.prisma.bidProject.count({ where: { ...companyWhere, stage: { in: ['OPENING', 'EVALUATING'] }, isExtractionOnly: false } }),
      this.prisma.supplier.count({ where: { ...companyWhere } }),
      this.prisma.supplier.count({ where: { ...companyWhere, status: 'APPROVED' } }),
      this.prisma.supplier.count({ where: { ...companyWhere, status: 'PENDING' } }),
      this.prisma.supplier.count({ where: { ...companyWhere, status: { in: ['DISABLED', 'BLACKLIST'] } } }),
      this.prisma.expertProfile.count({ where: { user: { ...companyWhere } } }),
      this.prisma.expertProfile.count({ where: { user: { ...companyWhere }, availability: '可用' } }),
      this.prisma.notification.count({ where: { userId: ownerUserId, isRead: false } }),
    ]);

    // Detect the most notable system state for each dimension
    const focusAreas: string[] = [];
    if (procurementTotal === 0) focusAreas.push('尚无采购项目');
    if (procurementPending > 0) focusAreas.push(`${procurementPending}个台账立项待审批`);
    if (bidActive > 0) focusAreas.push(`${bidActive}个开评标项目进行中`);
    if (supplierPending > 0) focusAreas.push(`${supplierPending}家供应商待审核`);
    if (supplierRisk > 0) focusAreas.push(`${supplierRisk}家供应商有风险`);
    if (notificationUnread > 0) focusAreas.push(`${notificationUnread}条未读通知`);

    return {
      procurement: { total: procurementTotal, pending: procurementPending },
      bid: { total: bidTotal, active: bidActive },
      supplier: { total: supplierTotal, approved: supplierApproved, pending: supplierPending, risk: supplierRisk },
      expert: { total: expertTotal, available: expertAvailable },
      announcement: { published: announcementPublished },
      notification: { unread: notificationUnread },
      focusAreas: focusAreas.slice(0, 4),
      generatedAt: new Date().toISOString(),
    };
  }

  async listConversations(owner: AssistantOwner | null = null) {
    // 无属主（未认证且无访客键）不返回任何会话
    if (!owner?.userId && !owner?.guestKey) return [];
    const conversations = await this.prisma.assistantConversation.findMany({
      where: owner.userId ? { userId: owner.userId } : { guestKey: owner.guestKey },
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

  async getConversation(id: string, owner: AssistantOwner | null = null) {
    const conv = await this.prisma.assistantConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    // 他人会话与不存在同口径返回 null（P0 会话隔离）
    return conv && ownedBy(conv, owner) ? conv : null;
  }

  /** 操作预案鉴权（2026-09-29 二审 P1）：confirm 会经 ActionExecutor 执行真实写操作
   *  （供应商状态流转等）——须登录且为预案所属会话的属主（admin 直通）；匿名/他人一律拒。 */
  private async assertActionOwnership(id: string, user?: { sub?: string; role?: string }) {
    if (!user?.sub) {
      throw new UnauthorizedException({ error: '请登录后操作', code: 'UNAUTHORIZED' });
    }
    if (user.role === 'admin') return;
    const log = await this.prisma.assistantActionLog.findUnique({
      where: { id },
      select: { conversationId: true },
    });
    if (log?.conversationId) {
      const conv = await this.prisma.assistantConversation.findUnique({
        where: { id: log.conversationId },
        select: { userId: true },
      });
      if (conv?.userId && conv.userId === user.sub) return;
    }
    throw new ForbiddenException({ error: '无权操作此预案', code: 'FORBIDDEN' });
  }

  async confirmAction(id: string, user?: { sub?: string; role?: string }) {
    await this.assertActionOwnership(id, user);
    const log = await this.prisma.assistantActionLog.findUnique({ where: { id } });
    if (!log) return { status: 'failed', message: '操作记录不存在' };
    if (log.status !== 'pending') return { status: 'failed', message: '操作已处理，无需重复确认' };

    await this.prisma.assistantActionLog.update({
      where: { id },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });
    return this.actionExecutor.execute(id, user);
  }

  async cancelAction(id: string, user?: { sub?: string; role?: string }) {
    await this.assertActionOwnership(id, user);
    const log = await this.prisma.assistantActionLog.findUnique({ where: { id } });
    if (!log) return { status: 'failed', message: '操作记录不存在' };
    // 终态闸（2026-11-04 审查 P1-10）：success/failed/cancelled 不可再改写——防污染审计轨迹
    if (log.status !== 'pending') {
      return { status: 'failed', message: `操作已处于终态（${log.status}），不可取消` };
    }

    await this.prisma.assistantActionLog.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    return { status: 'success', message: '操作已取消' };
  }

  async deleteConversation(id: string, owner: AssistantOwner | null = null) {
    const conv = await this.prisma.assistantConversation.findUnique({
      where: { id },
      select: { userId: true, guestKey: true },
    });
    if (!conv || !ownedBy(conv, owner)) {
      return { status: 'failed', message: '会话不存在或无权删除' };
    }
    // Messages cascade-delete via onDelete: Cascade in schema
    await this.prisma.assistantConversation.delete({
      where: { id },
    });
    return { status: 'success', message: '会话已删除' };
  }
}
