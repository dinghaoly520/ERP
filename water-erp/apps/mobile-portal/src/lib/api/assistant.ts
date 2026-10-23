/**
 * 水叮当会话 API（:3011 第四 Tab）——认证用户按 JWT 属主隔离会话，
 * 服务端按角色裁剪工具门禁（内部管理角色全量，匿名仅公开域）。
 * companyIds 第三参为 admin 公司口径切换预留（Task 12 后按 filter-store 接线）。
 */
import { api } from "../api";

export type ChatCard =
  | { type: "metric" | "table"; title: string; metrics?: Array<{ label: string; value: string }>; rows?: Array<Record<string, string>>; [k: string]: unknown }
  | { type: "chart"; title: string; chartType: string; caption?: string; [k: string]: unknown };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  cards?: ChatCard[];
  pending?: boolean;
};

export type ChatResult = {
  conversationId: string;
  answer: string;
  cards: ChatCard[];
  citations?: unknown[];
  pendingActions?: unknown[];
};

export async function sendChat(message: string, conversationId?: string | null, companyIds?: string[]): Promise<ChatResult> {
  return api.post<ChatResult>("/assistant/chat", {
    message,
    ...(conversationId ? { conversationId } : {}),
    ...(companyIds?.length ? { context: { companyIds } } : {}),
  });
}

export async function fetchConversation(id: string): Promise<{ messages?: Array<{ role: string; content: string; cardsJson?: ChatCard[] }> } | null> {
  return api.get(`/assistant/conversations/${id}`);
}

export async function createConversation(): Promise<{ id: string }> {
  return api.post<{ id: string }>("/assistant/conversations", { title: "移动驾驶舱对话" });
}
