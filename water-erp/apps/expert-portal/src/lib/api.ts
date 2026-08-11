import type { ExpertMemo } from '@water-erp/shared';

const BASE = '/api';
const PORTAL = 'expert';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  // Merge headers safely: handle both plain objects and Headers instances
  const mergedHeaders = new Headers({ 'X-Portal': PORTAL });
  if (init?.headers) {
    const src = new Headers(init.headers as HeadersInit);
    for (const [k, v] of src) mergedHeaders.set(k, v);
  }

  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: mergedHeaders,
  });
  if (!res.ok) {
    // 401 全局兜底：JWT 过期 / 服务端踢人 / cookie 被清 → 直接跳登录页，
    // 不让调用方的 .catch(() => {}) 静默吞掉鉴权失败。
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    let message = `请求失败 (${res.status})`;
    let body: Record<string, unknown> = {};
    try {
      body = await res.json();
      if (body.error) message = String(body.error);
      else if (body.message) message = String(body.message);
    } catch {
      // Response body is not JSON — keep default message
    }
    throw new ApiError(message, res.status, body);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown) => {
    // FormData: let the browser set multipart/form-data + boundary
    if (body instanceof FormData) {
      return fetchApi<T>(path, { method: 'POST', body });
    }
    return fetchApi<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
  patch: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    fetchApi<T>(path, { method: 'DELETE' }),
};

// ── Expert score-review verify ──
export interface ScoreReviewVerifyResult {
  id: string;
  status: string;
  verifiedAt: string | null;
}

export async function verifyScoreReview(
  projectId: string,
  supplierId: string,
): Promise<ScoreReviewVerifyResult> {
  return api.post<ScoreReviewVerifyResult>(
    `/expert/projects/${projectId}/suppliers/${supplierId}/score-review/verify`,
    {},
  );
}

// ── 评审邀请确认（通知链接落地页）──
export interface MyInvitation {
  projectId: string;
  projectName: string;
  projectCode: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  stage: string;
  isExtractionOnly?: boolean;
  expertRole: string;
  invitationStatus: string;
  signedIn: boolean;
}
export function getMyInvitation(projectId: string) {
  return api.get<MyInvitation>(`/expert/projects/${projectId}/invitation`);
}
export function confirmMyInvitation(projectId: string) {
  return api.post<{ success: boolean; status: string }>(
    `/expert/projects/${projectId}/invitation/confirm`,
    {},
  );
}
export function declineMyInvitation(projectId: string) {
  return api.post<{ success: boolean; status: string; promoted?: { userId: string; expertName: string; major: string } | null }>(
    `/expert/projects/${projectId}/invitation/decline`,
    {},
  );
}

// ── Expert memo (手写备忘) ──

export async function listMemos(
  projectId: string,
  supplierId?: string,
  scorePointId?: string,
  scoreItemId?: string,
): Promise<ExpertMemo[]> {
  const params = new URLSearchParams();
  if (supplierId) params.set('supplierId', supplierId);
  if (scorePointId) params.set('scorePointId', scorePointId);
  if (scoreItemId) params.set('scoreItemId', scoreItemId);
  const qs = params.toString();
  return api.get<ExpertMemo[]>(
    `/expert/projects/${projectId}/memos${qs ? `?${qs}` : ''}`,
  );
}

export async function createMemo(
  projectId: string,
  data: {
    contentText?: string;
    supplierId?: string;
    scoreItemId?: string;
    scorePointId?: string;
    sourceDevice?: string;
    inkBlob?: Blob;
  },
): Promise<ExpertMemo> {
  const fd = new FormData();
  if (data.contentText !== undefined) fd.append('contentText', data.contentText);
  if (data.supplierId) fd.append('supplierId', data.supplierId);
  if (data.scoreItemId) fd.append('scoreItemId', data.scoreItemId);
  if (data.scorePointId) fd.append('scorePointId', data.scorePointId);
  if (data.sourceDevice) fd.append('sourceDevice', data.sourceDevice);
  if (data.inkBlob) fd.append('ink', data.inkBlob, 'memo-ink.png');
  return api.post<ExpertMemo>(`/expert/projects/${projectId}/memos`, fd);
}

export async function updateMemo(
  projectId: string,
  memoId: string,
  contentText: string,
): Promise<ExpertMemo> {
  return api.patch<ExpertMemo>(
    `/expert/projects/${projectId}/memos/${memoId}`,
    { contentText },
  );
}

export async function deleteMemo(
  projectId: string,
  memoId: string,
): Promise<void> {
  return api.delete<void>(`/expert/projects/${projectId}/memos/${memoId}`);
}

export async function getMemoInkUrl(
  projectId: string,
  memoId: string,
): Promise<{ url: string }> {
  return api.get<{ url: string }>(
    `/expert/projects/${projectId}/memos/${memoId}/ink`,
  );
}

// ── 多轮报价历史（专家只读）──

export interface QuoteHistoryRound {
  roundNo: number;
  roundType: string;
  status: string;
  deadline: string | null;
  quotes: Array<{ supplierName: string; quotePrice: string }>;
}

export async function getQuoteHistory(projectId: string): Promise<QuoteHistoryRound[]> {
  return api.get<QuoteHistoryRound[]>(`/expert/projects/${projectId}/quote-history`);
}

// ── 评分历史（当前值 + 修改快照，按评分项分组）──

export interface ScoreHistoryEntry {
  score: number;
  passed: boolean | null;
  reason: string | null;
  action: string;
  createdAt: string;
}

export interface ScoreHistoryItem {
  scoreItemId: string;
  scoreItemName: string;
  category: string;
  current: { score: number; passed: boolean | null; reason: string | null; updatedAt: string };
  draft: { score: number; passed: boolean | null; reason: string | null } | null;
  history: ScoreHistoryEntry[];
}

export async function getScoreHistory(
  projectId: string,
  supplierId: string,
): Promise<ScoreHistoryItem[]> {
  return api.get<ScoreHistoryItem[]>(
    `/expert/projects/${projectId}/score-history?supplierId=${encodeURIComponent(supplierId)}`,
  );
}
