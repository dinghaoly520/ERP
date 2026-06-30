// Use relative /api path to leverage Next.js rewrites for cookie handling
const API_BASE = '/api';

import type { KnowledgeBase, KnowledgeFile } from '../types/tender-review';

export async function fetchKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await fetch(`${API_BASE}/knowledge`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch knowledge bases');
  return res.json();
}

export async function fetchKnowledgeBase(id: string): Promise<KnowledgeBase> {
  const res = await fetch(`${API_BASE}/knowledge/${id}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch knowledge base');
  return res.json();
}

export async function createKnowledgeBase(data: {
  name: string;
  description?: string;
}): Promise<KnowledgeBase> {
  const res = await fetch(`${API_BASE}/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Create knowledge base error:', res.status, errorData);
    throw new Error(errorData.message || 'Failed to create knowledge base');
  }
  return res.json();
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/knowledge/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Delete knowledge base error:', res.status, errorData);
    throw new Error(errorData.message || 'Failed to delete knowledge base');
  }
}

export async function uploadKnowledgeFile(
  kbId: string,
  file: File,
): Promise<KnowledgeFile> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/knowledge/${kbId}/files`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Upload file error:', res.status, errorData);
    throw new Error(errorData.message || 'Failed to upload file');
  }
  return res.json();
}

export async function deleteKnowledgeFile(
  kbId: string,
  fileId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/knowledge/${kbId}/files/${fileId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Delete file error:', res.status, errorData);
    throw new Error(errorData.message || 'Failed to delete file');
  }
}

export async function reindexKnowledgeBase(kbId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/knowledge/${kbId}/reindex`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to reindex knowledge base');
}
