const BASE = '/api';
const PORTAL = 'expert';

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
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || body.message || res.statusText);
    (err as any).data = body;
    throw err;
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
