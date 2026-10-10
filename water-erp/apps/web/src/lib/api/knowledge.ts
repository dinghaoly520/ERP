// Use relative /api path to leverage Next.js rewrites for cookie handling
const API_BASE = '/api';

import type { KnowledgeBase, KnowledgeFile } from '../types/tender-review';
import { apiFetch } from './api-fetch';
import { toApiError } from '@water-erp/client';

export async function fetchKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await apiFetch(`${API_BASE}/knowledge`, { credentials: 'include' });
  if (!res.ok) throw await toApiError(res, '加载知识库列表失败');
  return res.json();
}

export async function createKnowledgeBase(data: {
  name: string;
  description?: string;
  isShared?: boolean;
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
): Promise<KnowledgeFile> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`${API_BASE}/knowledge/${kbId}/files`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Upload file error:', res.status, errorData);
    throw await toApiError(res, '上传文件失败');
  }
  return res.json();
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

export async function reindexKnowledgeBase(kbId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/knowledge/${kbId}/reindex`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw await toApiError(res, '重建知识库索引失败，请稍后重试');
}
