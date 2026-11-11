// Use relative /api path to leverage Next.js rewrites for cookie handling
const API_BASE = '/api';

import type { KnowledgeBase, KnowledgeFile } from '../types/tender-review';
import { apiFetch } from './api-fetch';
import { toApiError } from '@water-erp/client';
import { api } from '../api';

export async function fetchKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await apiFetch(`${API_BASE}/knowledge`, { credentials: 'include' });
  if (!res.ok) throw await toApiError(res, '加载知识库列表失败');
  return res.json();
}

export async function createKnowledgeBase(data: {
  name: string;
  description?: string;
  isShared?: boolean;
  /** 所属域：水叮当面板传 'assistant'（审查端不传=默认 tender_review，两域互不可见） */
  domain?: 'tender_review' | 'assistant';
}): Promise<KnowledgeBase> {
  const res = await apiFetch(`${API_BASE}/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Create knowledge base error:', res.status, errorData);
    throw await toApiError(res, '创建知识库失败');
  }
  return res.json();
}

export async function updateKnowledgeBase(
  id: string,
  data: { name?: string; description?: string; isShared?: boolean; isActive?: boolean },
): Promise<KnowledgeBase> {
  const res = await apiFetch(`${API_BASE}/knowledge/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw await toApiError(res, '更新知识库失败');
  }
  return res.json();
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/knowledge/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Delete knowledge base error:', res.status, errorData);
    throw await toApiError(res, '删除知识库失败');
  }
}

export async function uploadKnowledgeFile(
  kbId: string,
  file: File,
  opts?: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal },
): Promise<KnowledgeFile> {
  const formData = new FormData();
  formData.append('file', file);
  // api.upload XHR 轨（2026-11-06 上传进度条）：错误经 ApiError（后端 error 文案）同旧语义
  return api.upload<KnowledgeFile>(`/knowledge/${kbId}/files`, formData, opts);
}

export async function deleteKnowledgeFile(
  kbId: string,
  fileId: string,
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/knowledge/${kbId}/files/${fileId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    console.error('Delete file error:', res.status);
    throw await toApiError(res, '删除文件失败');
  }
}

/* ── 水叮当知识库面板（2026-11-03）：取数聚合 / 重建索引 / 解析状态 ── */

export type KbFile = {
  id: string; fileName: string; fileSize: number; chunkCount: number; createdAt: string;
  status?: 'PARSING' | 'READY' | 'FAILED';
  processedPages?: number; totalPages?: number | null; error?: string | null; indexed?: boolean;
};
export type KbCard = { id: string; name: string; isShared: boolean; ownerId: string; ownerName: string; files: KbFile[] };

/** 面板取数（mine=本人库；shared=他人共享库）——后端 assistant-overview 聚合端点 */
export async function fetchAssistantKnowledge(): Promise<{ mine: KbCard[]; shared: KbCard[] }> {
  const res = await apiFetch(`${API_BASE}/knowledge/assistant-overview`, { credentials: 'include' });
  if (!res.ok) throw await toApiError(res, '知识库加载失败');
  return res.json();
}

/** 上传收件即回（2026-11-06 异步化，202）：返回 PARSING 行（或同 sha 既有行 deduplicated:true）——
 *  解析完成时点已移后台；indexed 语义见行上字段（READY+indexed=false=嵌入降级待重建索引）。
 *  opts.onProgress 仍可用于上传传输段进度（118MB 收件本身仍需时间） */
export async function uploadKnowledgeFileWithStatus(
  kbId: string,
  file: File,
  opts?: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal },
): Promise<KnowledgeFile & { deduplicated?: boolean }> {
  return uploadKnowledgeFile(kbId, file, opts);
}

/** FAILED 行一键重试（重置 PARSING 重入队；OCR 批次缓存命中时秒级完成） */
export async function retryKnowledgeFile(kbId: string, fileId: string): Promise<KnowledgeFile> {
  const res = await apiFetch(`${API_BASE}/knowledge/${kbId}/files/${fileId}/retry`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw await toApiError(res, '重试失败');
  return res.json();
}

/** 重建向量索引（异步：202 立即返回，后台逐文件重建；force=整库全量，默认增量只修未索引文件） */
export async function reindexKnowledgeBase(kbId: string, force = false): Promise<{
  started: boolean;
  alreadyRunning?: boolean;
  fileCount: number;
  pendingCount: number;
  skippedCount: number;
}> {
  const res = await apiFetch(
    `${API_BASE}/knowledge/${kbId}/reindex${force ? '?force=true' : ''}`,
    {
      method: 'POST',
      credentials: 'include',
    },
  );
  if (!res.ok) throw await toApiError(res, '重建索引失败');
  return res.json();
}
