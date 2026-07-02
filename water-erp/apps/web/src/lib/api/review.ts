// Use relative /api path to leverage Next.js rewrites for cookie handling
const API_BASE = '/api';

import type { ReviewTask } from '../types/tender-review';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch {
      // ignore json parse error
    }
    throw new Error(message);
  }
  return res.json();
}

export async function uploadReviewDocument(
  file: File,
): Promise<{
  documentName: string;
  objectKey: string;
  content: string;
  contentLength: number;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/review/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return handleResponse(res);
}

export async function executeReview(params: {
  knowledgeBaseId: string;
  reviewMode: 'strict' | 'general';
  documentContent: string;
  documentName: string;
  objectKey: string;
}): Promise<{ taskId: string; status: string }> {
  const res = await fetch(`${API_BASE}/review/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  return handleResponse(res);
}

export async function fetchReviewTask(id: string): Promise<ReviewTask> {
  const res = await fetch(`${API_BASE}/review/tasks/${id}`, { credentials: 'include' });
  return handleResponse(res);
}

export interface TodayStats {
  totalReviews: number;
  passedCount: number;
  failedCount: number;
  warningCount: number;
}

export async function fetchTodayStats(): Promise<TodayStats> {
  const res = await fetch(`${API_BASE}/review/stats/today`, { credentials: 'include' });
  return handleResponse(res);
}

export async function fetchReviewTasks(): Promise<ReviewTask[]> {
  const res = await fetch(`${API_BASE}/review/tasks`, { credentials: 'include' });
  return handleResponse(res);
}

export async function stopReviewTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/review/tasks/${id}/stop`, { method: 'POST', credentials: 'include' });
  return handleResponse(res);
}

export async function deleteReviewTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/review/tasks/${id}`, { method: 'DELETE', credentials: 'include' });
  return handleResponse(res);
}

export function getDownloadUrl(taskId: string): string {
  return `${API_BASE}/review/tasks/${taskId}/download`;
}

export async function resolveIssue(
  taskId: string,
  issueIndex: number,
  action: 'accept' | 'reject',
  editedSuggestion?: string,
): Promise<ReviewTask> {
  const res = await fetch(`${API_BASE}/review/tasks/${taskId}/issues/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ issueIndex, action, editedSuggestion }),
  });
  return handleResponse(res);
}
