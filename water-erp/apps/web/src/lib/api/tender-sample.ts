import type { TenderFieldKey } from '@/lib/types/tender-write';
import { apiFetch } from './api-fetch';
import { toApiError } from '@water-erp/client';

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

  const response = await apiFetch(`${API_BASE}/tender-sample?${params}`, {
    credentials: 'include',
    headers: { 'X-Portal': 'web' },
  });
  if (!response.ok) {
    throw await toApiError(response, '加载字段样本失败');
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
  const response = await apiFetch(`${API_BASE}/tender-sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('创建样本失败');
  }
  return response.json();
}

export async function updateFieldSample(
  id: string,
  payload: { content?: string; isFavorite?: boolean },
): Promise<TenderFieldSample> {
  const response = await apiFetch(`${API_BASE}/tender-sample/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('更新样本失败');
  }
  return response.json();
}

export async function toggleFieldSampleFavorite(
  id: string,
): Promise<TenderFieldSample> {
  const response = await apiFetch(
    `${API_BASE}/tender-sample/${id}/toggle-favorite`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'X-Portal': 'web' },
    },
  );
  if (!response.ok) {
    throw new Error('收藏操作失败');
  }
  return response.json();
}

export async function deleteFieldSample(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/tender-sample/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-Portal': 'web' },
  });
  if (!response.ok) {
    throw new Error('删除样本失败');
  }
}

export async function generateFieldContent(payload: {
  fieldKey: string;
  fieldLabel: string;
  currentValue: string;
  aiPrompt?: string;
  context: Record<string, string>;
}): Promise<{ content: string }> {
  const response = await apiFetch(`${API_BASE}/ai/tender-field-generate`, {
    method: 'POST',
    // 裸 fetch 必须带 X-Portal 头，否则后端 portal-cookie 无法识别 cookie 会话 → 401
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // toApiError 透传服务端真实错误（.error 优先），可区分 DeepSeek 限流、超时、
    // JSON 解析失败等不同原因；无错误体时回落语境中文
    throw await toApiError(response, 'AI 生成失败，请稍后重试');
  }
  return response.json();
}
