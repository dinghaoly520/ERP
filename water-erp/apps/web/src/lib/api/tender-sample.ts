import type { TenderFieldKey } from '@/lib/types/tender-write';

const API_BASE = '/api';

export type TenderFieldSample = {
  id: string;
  fieldKey: string;
  content: string;
  isFavorite: boolean;
  sourceType: 'manual' | 'ai_generated';
  context: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchFieldSamples(
  fieldKey: string,
  isFavorite?: boolean,
): Promise<TenderFieldSample[]> {
  const params = new URLSearchParams({ fieldKey });
  if (isFavorite !== undefined) {
    params.append('isFavorite', String(isFavorite));
  }

  const response = await fetch(`${API_BASE}/tender-sample?${params}`, {
    credentials: 'include',
    headers: { 'X-Portal': 'web' },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch field samples');
  }
  return response.json();
}

export async function createFieldSample(payload: {
  fieldKey: TenderFieldKey;
  content: string;
  isFavorite?: boolean;
  sourceType?: 'manual' | 'ai_generated';
  context?: Record<string, unknown>;
}): Promise<TenderFieldSample> {
  const response = await fetch(`${API_BASE}/tender-sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to create field sample');
  }
  return response.json();
}

export async function updateFieldSample(
  id: string,
  payload: { content?: string; isFavorite?: boolean },
): Promise<TenderFieldSample> {
  const response = await fetch(`${API_BASE}/tender-sample/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to update field sample');
  }
  return response.json();
}

export async function toggleFieldSampleFavorite(
  id: string,
): Promise<TenderFieldSample> {
  const response = await fetch(
    `${API_BASE}/tender-sample/${id}/toggle-favorite`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'X-Portal': 'web' },
    },
  );
  if (!response.ok) {
    throw new Error('Failed to toggle favorite');
  }
  return response.json();
}

export async function deleteFieldSample(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/tender-sample/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-Portal': 'web' },
  });
  if (!response.ok) {
    throw new Error('Failed to delete field sample');
  }
}

export async function generateFieldContent(payload: {
  fieldKey: string;
  fieldLabel: string;
  currentValue: string;
  aiPrompt?: string;
  context: Record<string, string>;
}): Promise<{ content: string }> {
  const response = await fetch(`${API_BASE}/ai/tender-field-generate`, {
    method: 'POST',
    // 裸 fetch 必须带 X-Portal 头，否则后端 portal-cookie 无法识别 cookie 会话 → 401
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // 把服务端真实错误透传出来，避免永远显示笼统的"AI 生成失败"
    // 让用户/开发者能区分 DeepSeek 限流、超时、JSON 解析失败等不同原因
    let detail = '';
    try {
      const body = await response.json();
      // 后端 HttpExceptionFilter 归一化错误体为 { statusCode, code, error }（无 message 字段）；
      // message 仅作 ValidationPipe 等少数场景的兼容回退
      detail = Array.isArray(body?.message)
        ? body.message[0]
        : body?.error ?? body?.message ?? '';
    } catch {
      try {
        detail = (await response.text()).trim();
      } catch {
        /* ignore */
      }
    }
    const suffix = detail ? `（${detail.slice(0, 120)}）` : '';
    throw new Error(`AI 生成失败，请稍后重试${suffix}`);
  }
  return response.json();
}
