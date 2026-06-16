const BASE = '/api';
const PORTAL = 'assistant';

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      signal: controller.signal,
      ...init,
      headers: {
        'X-Portal': PORTAL,
        ...((init?.headers as Record<string, string>) || {}),
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      let code = 'UNKNOWN';
      let message = `请求失败 (${res.status})`;
      try {
        const body = await res.json();
        if (body.code) code = body.code;
        if (body.error) message = body.error;
      } catch {
        // response body is not JSON
      }
      throw new ApiError(res.status, code, message);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new ApiError(408, 'TIMEOUT', '请求超时，请检查网络后重试');
    }
    throw e;
  }
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string) => fetchApi<T>(path, { method: 'DELETE' }),
};
