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
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
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
