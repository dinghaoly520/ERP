import { apiFetch } from '@/lib/api/api-fetch';

/** 项目变更体系 API（2026-11-11 spec）——基本信息唯一人工编辑通道=变更登记。 */

export type ChangeFieldType = 'text' | 'number' | 'datetime';

/** 变更记录（与后端 ProjectChangeRecord 模型同构） */
export type ProjectChangeRecord = {
  id: string;
  projectManagementItemId: string;
  round: number;
  type: 'CHANGE' | 'ADDENDUM';
  reason: string;
  changeset: Array<{ field: string; label: string; from: string; to: string; stageKey: string }>;
  needsAnnouncement: boolean;
  announcementId: string | null;
  operatorId: string;
  operatorName: string;
  createdAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/project-management${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `请求失败（${res.status}）`);
  return body as T;
}

/** 登记变更/补遗（写=仅创建人，服务端闸：白名单/阶段/开标锁/理由） */
export function registerChange(
  projectId: string,
  body: { type: 'CHANGE' | 'ADDENDUM'; reason: string; fields: Record<string, string | number | null> },
): Promise<{ record: ProjectChangeRecord; needsAnnouncement: boolean }> {
  return request(`/${projectId}/changes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** 变更流水（round 倒序，最多 100 条） */
export function listChanges(projectId: string): Promise<ProjectChangeRecord[]> {
  return request(`/${projectId}/changes`);
}

/** 变更公告发布后回填（闭环「公告待发」） */
export function bindChangeAnnouncement(recordId: string, announcementId: string): Promise<void> {
  return request(`/changes/${recordId}/announcement`, {
    method: 'PATCH',
    body: JSON.stringify({ announcementId }),
  });
}
