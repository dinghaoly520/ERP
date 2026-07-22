const BASE = '/api';
const PORTAL = 'web';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'X-Portal': PORTAL, ...((init?.headers as Record<string, string>) || {}) },
  });
  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body.code) code = body.code;
      if (body.error) message = body.error;
    } catch {
      // response body is not JSON, keep default message
    }
    // Error handling is the caller's responsibility — each page .catch handles toast display.
    throw new ApiError(res.status, code, message);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown, options?: RequestInit) =>
    fetchApi<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options }),
  patch: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    fetchApi<T>(path, { method: 'DELETE' }),
};

export * from './api/supplier';
export * from './api/bid';
