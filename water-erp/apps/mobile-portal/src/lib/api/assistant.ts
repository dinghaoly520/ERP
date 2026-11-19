/**
 * 水叮当会话 API（:3011 第四 Tab）——认证用户按 JWT 属主隔离会话，
 * 服务端按角色裁剪工具门禁（内部管理角色全量，匿名仅公开域）。
 * companyIds 第三参为 admin 公司口径（chat 页读 filter-store 传入）。
 */
import { api } from "../api";

export type ChatCard =
  | {
      type: "metric" | "table";
      title: string;
      metrics?: Array<{ label: string; value: string }>;
      /** 表格列定义（后端工具给中文 label；表头必须用它而非行键，防英文键漏出） */
      columns?: Array<{ key: string; label: string }>;
      rows?: Array<Record<string, string>>;
      [k: string]: unknown;
    }
  | { type: "chart"; title: string; chartType: string; caption?: string;
      /** 数值单位（2026-11-19）：后端 viz 声明下发（'%'/'万'），柱标拼接——与表格展示列同口径 */
      unit?: string;
      /** 自包含派生数据（2026-11-03）：与 :3005 ECharts option 同源；缺省=存量历史卡（回退占位） */
      data?: {
        rows?: Array<Record<string, unknown>>;
        points?: Array<{ name: string; value: number }>;
        labels?: string[];
        series?: Array<{ name: string; values: number[] }>;
        total?: number;
      };
      [k: string]: unknown };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  cards?: ChatCard[];
  /** 服务端消息 id（反馈定位用；失败重试的本地气泡无 id） */
  id?: string;
};

export type ChatResult = {
  conversationId: string;
  /** 本次回答的消息 id（2026-11-19 反馈落库：落库失败时缺省） */
  messageId?: string;
  answer: string;
  cards: ChatCard[];
};

export async function sendChat(message: string, conversationId?: string | null, companyIds?: string[], signal?: AbortSignal): Promise<ChatResult> {
  return api.post<ChatResult>("/assistant/chat", {
    message,
    ...(conversationId ? { conversationId } : {}),
    /* 总数据口径（2026-11-03 用户裁定）经 :3011 代理注入的 x-portal-source 头
     * 服务端判定（评审 F1：body 自报可冒充，已弃用）——此处只带 admin 公司多选 */
    ...(companyIds?.length ? { context: { companyIds } } : {}),
  }, signal ? { signal } : undefined);
}

/** 回答反馈（2026-11-19 问答改造）：同属主同消息覆盖、再点同值取消（服务端语义） */
export async function sendFeedback(messageId: string, rating: "UP" | "DOWN"): Promise<{ messageId: string; rating: "UP" | "DOWN" | null }> {
  return api.post("/assistant/feedback", { messageId, rating });
}

/** 我的反馈回显（载入会话后标激活态；服务端无属主时空数组） */
export async function fetchMyFeedback(conversationId?: string): Promise<Array<{ messageId: string; rating: "UP" | "DOWN" }>> {
  const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
  return api.get(`/assistant/feedback/mine${qs}`);
}

export async function fetchConversation(id: string): Promise<{ messages?: Array<{ id: string; role: string; content: string; cardsJson?: ChatCard[] }> } | null> {
  return api.get(`/assistant/conversations/${id}`);
}

export async function createConversation(): Promise<{ id: string }> {
  return api.post<{ id: string }>("/assistant/conversations", { title: "移动驾驶舱对话" });
}

/** 历史会话摘要（属主隔离；后端实返 firstMessage=首条用户消息前 100 字——
 * 2026-11-04 审查修正：此前误声明 messages 字段，历史弹层标题恒「（无标题）」） */
export type ConversationSummary = {
  id: string;
  title?: string;
  updatedAt: string;
  firstMessage?: string;
};

export async function fetchConversationList(): Promise<ConversationSummary[]> {
  return api.get<ConversationSummary[]>("/assistant/conversations");
}

export async function removeConversation(id: string): Promise<void> {
  await api.delete(`/assistant/conversations/${id}`);
}
