import type {
  TenderDocumentType,
  TenderHistoryRecord,
  TenderDraftRecord,
} from '@/lib/types/tender-write';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

function parseErrorMessage(text: string) {
  const trimmed = text.trim();
  return trimmed || '保存历史记录失败';
}

export async function createTenderHistory(payload: {
  documentType: TenderDocumentType;
  title: string;
  draftData: TenderDraftRecord;
}): Promise<TenderHistoryRecord> {
  const response = await fetch(`${API_BASE}/tender-history`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(parseErrorMessage(text));
  }

  return response.json();
}

export async function fetchTenderHistory(
  documentType: TenderDocumentType,
  limit = 20,
): Promise<TenderHistoryRecord[]> {
  const params = new URLSearchParams({
    documentType,
    limit: String(limit),
  });

  const response = await fetch(`${API_BASE}/tender-history?${params.toString()}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('获取历史记录失败');
  }

  return response.json();
}

export async function fetchTenderHistoryDetail(
  id: string,
): Promise<TenderHistoryRecord> {
  const response = await fetch(`${API_BASE}/tender-history/${id}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('获取历史记录详情失败');
  }

  return response.json();
}

export async function deleteTenderHistory(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/tender-history/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('删除历史记录失败');
  }
}
