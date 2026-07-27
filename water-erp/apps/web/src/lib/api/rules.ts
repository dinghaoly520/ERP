// 后端迁移后规则端点挂在 tender-review 控制器下：/api/tender-review/rules*
// （与 review.ts / knowledge.ts 前缀保持一致；此前漏掉 tender-review 段导致全线 404）
const API_BASE = '/api/tender-review';

import type { ComplianceRule } from '../types/tender-review';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    if (res.status === 403) {
      message = '无权限执行此操作，需要管理员权限';
    } else {
      try {
        const data = await res.json();
        message = data.message || data.error || message;
      } catch {
        // ignore json parse error
      }
    }
    throw new Error(message);
  }
  return res.json();
}

export async function fetchRules(
  knowledgeBaseId?: string,
): Promise<ComplianceRule[]> {
  const params = knowledgeBaseId
    ? `?knowledgeBaseId=${knowledgeBaseId}`
    : '';
  const res = await fetch(`${API_BASE}/rules${params}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch rules');
  return res.json();
}

/** Find the active (running) extraction task for a KB, returns null if none */
export async function findActiveExtraction(
  knowledgeBaseId: string,
): Promise<{ id: string; status: string; extractedCount?: number } | null> {
  const res = await fetch(`${API_BASE}/rules/extract/active?knowledgeBaseId=${knowledgeBaseId}`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data ?? null;
}

// For rules-panel.tsx compatibility
export async function extractRules(
  knowledgeBaseId: string,
): Promise<{ taskId: string; status: string; extractedCount?: number; error?: string }> {
  const res = await fetch(`${API_BASE}/rules/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ knowledgeBaseId }),
  });
  return handleResponse(res);
}

export async function getExtractionTask(taskId: string): Promise<{
  id: string;
  status: 'running' | 'completed' | 'failed';
  extractedCount?: number;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/rules/extract/tasks/${taskId}`, {
    credentials: 'include',
  });
  return handleResponse(res);
}

// For use-tender-review.ts - returns the actual rules
export async function extractRulesFromKb(
  knowledgeBaseId: string,
): Promise<ComplianceRule[]> {
  const res = await fetch(`${API_BASE}/rules/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ knowledgeBaseId }),
  });
  return handleResponse(res);
}

// Original signature for rules-panel.tsx compatibility
export async function createRuleLegacy(
  data: Omit<ComplianceRule, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>,
): Promise<ComplianceRule> {
  const res = await fetch(`${API_BASE}/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// New signature for use-tender-review.ts
export async function createRule(
  kbId: string,
  data: Omit<ComplianceRule, 'id' | 'knowledgeBaseId' | 'createdAt' | 'updatedAt'>,
): Promise<ComplianceRule> {
  const res = await fetch(`${API_BASE}/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...data, knowledgeBaseId: kbId }),
  });
  return handleResponse(res);
}

export async function updateRule(
  id: string,
  data: Partial<ComplianceRule>,
): Promise<ComplianceRule> {
  const res = await fetch(`${API_BASE}/rules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteRule(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rules/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) {
    let message = 'Failed to delete rule';
    if (res.status === 403) {
      message = '无权限删除规则，需要管理员权限';
    }
    throw new Error(message);
  }
}
