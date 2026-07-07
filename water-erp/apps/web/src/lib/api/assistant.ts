import type { Conversation, Message, AssistantPageContext, AssistantAction } from '@/components/assistant/types';

const API_BASE = '/api';

// ---- REST helpers ----

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
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
  await fetch(`${API_BASE}/assistant/conversations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
}

export async function generateTitle(conversationId: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/assistant/conversations/${conversationId}/title`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[Assistant] Title generation failed with status ${res.status}`);
      return '新对话';
    }
    const data = await res.json() as { title: string };
    return data.title ?? '新对话';
  } catch (err) {
    console.error('[Assistant] Title generation network error:', err);
    return '新对话';
  }
}

// ---- Send message ----

export type SendCallbacks = {
  onToken: (content: string) => void;
  onToolCall: (tool: string, args: Record<string, unknown>) => void;
  onToolResult: (tool: string, result: unknown, success: boolean) => void;
  onAction: (action: AssistantAction) => void;
  onDone: (messageId: string) => void;
  onError: (message: string) => void;
};

interface ChatResponse {
  conversationId: string;
  answer: string;
  cards?: Array<{ type: string; title?: string }>;
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
    const response = await fetch(`${API_BASE}/assistant/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message: content, context }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'AI 服务异常' }));
      callbacks.onError((err as { message?: string }).message || 'AI 服务暂时不可用');
      return;
    }

    const data: ChatResponse = await response.json();
    callbacks.onToken(data.answer);
    callbacks.onDone(data.conversationId);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return;
    }
    callbacks.onError('无法连接到服务');
  }
}
