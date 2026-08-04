const BASE = process.env.NEXT_PUBLIC_API_BASE || '/api';
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
    throw new ApiError(res.status, code, message);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown, init?: RequestInit) =>
    fetchApi<T>(path, {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) },
      body: JSON.stringify(body),
    }),
  postForm: <T>(path: string, body: FormData) =>
    fetchApi<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    fetchApi<T>(path, { method: 'DELETE' }),
};
