import type { Conversation, Message, AssistantPageContext, AssistantAction } from '@/components/assistant/types';
import { apiFetch } from './api-fetch';

const API_BASE = '/api';

// ---- REST helpers ----

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: '请求失败' }));
    throw new Error((body as { message?: string }).message ?? '请求失败');
  }
  return res.json() as Promise<T>;
}

// ---- Conversations ----

export async function listConversations(): Promise<Conversation[]> {
  return requestJson<Conversation[]>(`${API_BASE}/assistant/conversations`);
}

export async function createConversation(title?: string): Promise<Conversation> {
  return requestJson<Conversation>(`${API_BASE}/assistant/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || '新对话' }),
  });
}

export async function getConversation(id: string): Promise<{ messages: Message[] } & Conversation> {
  return requestJson(`${API_BASE}/assistant/conversations/${id}`);
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/assistant/conversations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  // 401/500 等非 2xx 也要抛（apiFetch 是透传包装不自动抛）——否则 UI 假报删除成功（三审 P2）
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `删除失败（${res.status}）`);
  }
  // 后端非属主/不存在返回 200 + {status:'failed'}——须读响应体（二审 P2）
  const body = await res.json().catch(() => null);
  if (body && body.status === 'failed') throw new Error(body.message || '删除失败');
}

// ---- Send message ----

export type SendCallbacks = {
  onToken: (content: string) => void;
  onToolCall: (tool: string, args: Record<string, unknown>) => void;
  onToolResult: (tool: string, result: unknown, success: boolean) => void;
  onAction: (action: AssistantAction) => void;
  onDone: (messageId: string, cards?: unknown[], citations?: unknown[]) => void;
  onError: (message: string) => void;
};

interface ChatResponse {
  conversationId: string;
  answer: string;
  cards?: unknown[];
  citations?: unknown[];
  pendingActions?: unknown[];
}

export async function sendMessage(
  conversationId: string,
  content: string,
  context: AssistantPageContext | undefined,
  callbacks: SendCallbacks,
  options?: { signal?: AbortSignal },
): Promise<void> {
  try {
    const response = await apiFetch(`${API_BASE}/assistant/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message: content, context }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[Assistant] API 返回非 200: ${response.status} ${response.statusText}`, text.slice(0, 500));
      callbacks.onError(`服务异常（${response.status}），请确认 API 已重启并检查后端日志`);
      return;
    }

    const data: ChatResponse = await response.json();
    callbacks.onToken(data.answer);
    // 后端 ChatResponse 不返回 messageId —— 本地生成唯一 id 作为 React key。
    // 切勿传 data.conversationId：同一会话内多条 assistant 消息会共用会话 cuid 作 id，
    // 导致 React "two children with the same key" 报错。
    const msgId = globalThis.crypto?.randomUUID?.()
      ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    callbacks.onDone(msgId, data.cards, data.citations);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return;
    }
    console.error('[Assistant] sendMessage fetch 失败:', err);
    callbacks.onError('无法连接到服务，请确认 API 服务（端口 4001）已启动并重启');
  }
}
