/** 用户向导草稿（账号维度，跨设备续作）——localStorage 仅作本机离线缓存 */
import { api } from '../api';

export interface DraftPayload { key: string; payload: unknown; updatedAt: string }

export function fetchDraft(key: string) {
  return api.get<DraftPayload | null>(`/drafts/${encodeURIComponent(key)}`);
}

export function saveDraft(key: string, payload: unknown) {
  return api.put<{ savedAt: string }>(`/drafts/${encodeURIComponent(key)}`, { payload });
}

export function deleteDraft(key: string) {
  return api.delete<{ deleted: boolean }>(`/drafts/${encodeURIComponent(key)}`);
}
