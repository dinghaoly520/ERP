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
    body: JSON.stringify({ title }),
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

// ---- Send message (SSE streaming) ----

export type SseCallbacks = {
  onToken: (content: string) => void;
  onToolCall: (tool: string, args: Record<string, unknown>) => void;
  onToolResult: (tool: string, result: unknown, success: boolean) => void;
  onAction: (action: AssistantAction) => void;
  onDone: (messageId: string) => void;
  onError: (message: string) => void;
};

export async function sendMessageStream(
  conversationId: string,
  content: string,
  context: AssistantPageContext | undefined,
  callbacks: SseCallbacks,
  options?: { signal?: AbortSignal },
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/assistant/conversations/${conversationId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, context }),
      signal: options?.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return; // 静默处理 abort
    }
    callbacks.onError('无法连接到服务');
    return;
  }

  if (!response.ok || !response.body) {
    callbacks.onError('AI 服务暂时不可用');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const eventPattern = /event: (\w+)\ndata: (.+)\n\n/g;
      let match: RegExpExecArray | null;
      let lastIndex = 0;

      while ((match = eventPattern.exec(buffer)) !== null) {
        lastIndex = match.index + match[0].length;
        const eventName = match[1];
        const eventData = match[2];

        try {
          const parsed = JSON.parse(eventData);

          switch (eventName) {
            case 'token':
              callbacks.onToken(parsed.content ?? '');
              break;
            case 'tool_call':
              callbacks.onToolCall(parsed.tool, parsed.args ?? {});
              break;
            case 'tool_result':
              callbacks.onToolResult(parsed.tool, parsed.result, parsed.success);
              break;
            case 'action':
              callbacks.onAction(parsed as AssistantAction);
              break;
            case 'done':
              callbacks.onDone(parsed.message_id ?? '');
              break;
            case 'error':
              callbacks.onError(parsed.message ?? '未知错误');
              break;
          }
        } catch {
          // Skip malformed JSON
        }
      }

      // Keep unprocessed part in buffer
      if (lastIndex > 0) {
        buffer = buffer.slice(lastIndex);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
