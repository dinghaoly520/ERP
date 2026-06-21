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

/** per-call overrides */
export interface FetchOptions {
  /** timeout in ms — 0 disables (default 90s for POST, 15s for GET) */
  timeout?: number;
  /** max retry count for transient network errors (default 2) */
  retries?: number;
  /** pass-through AbortSignal from caller */
  signal?: AbortSignal;
  /** backoff base in ms (default 1000) */
  backoffBase?: number;
}

/**
 * Is this error a transient network failure worth retrying?
 * - TypeError (ECONNRESET, socket hang up, failed to fetch)
 * NOT: user abort, timeout abort, HTTP errors (4xx/5xx)
 */
function isNetworkError(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false;
  // AbortError inherits from DOMException, not TypeError
  return true;
}

/** sleep helper for backoff */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchApi<T>(
  path: string,
  init?: RequestInit,
  opts?: FetchOptions,
): Promise<T> {
  const timeout = opts?.timeout ?? (init?.method ? 90000 : 15000);
  const maxRetries = opts?.retries ?? 2;
  const backoffBase = opts?.backoffBase ?? 1000;
  const userSignal = opts?.signal;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();

    // User cancel → abort our controller
    const onUserAbort = () => controller.abort();
    userSignal?.addEventListener('abort', onUserAbort, { once: true });

    const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

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

      if (timeoutId) clearTimeout(timeoutId);
      userSignal?.removeEventListener('abort', onUserAbort);

      // Check if user cancelled (race between user signal and fetch)
      if (userSignal?.aborted) {
        throw new DOMException('用户取消请求', 'AbortError');
      }

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
      if (timeoutId) clearTimeout(timeoutId);
      userSignal?.removeEventListener('abort', onUserAbort);

      lastError = e;

      const isAbort = (e as Error).name === 'AbortError';

      // User cancelled — don't retry
      if (userSignal?.aborted) {
        throw new ApiError(499, 'CANCELLED', '请求已取消');
      }

      // Timeout — don't retry (server likely overloaded)
      if (isAbort && !userSignal?.aborted) {
        throw new ApiError(408, 'TIMEOUT', '请求超时，请检查网络后重试');
      }

      // HTTP errors (ApiError) — don't retry
      if (e instanceof ApiError) throw e;

      // Network error — retry if attempts remain
      if (isNetworkError(e) && attempt < maxRetries) {
        console.warn(
          `[api] 网络错误 (第 ${attempt + 1} 次尝试): ${(e as Error).message}，${backoffBase * Math.pow(2, attempt)}ms 后重试...`,
        );
        await sleep(backoffBase * Math.pow(2, attempt));
        continue;
      }

      // Re-throw on last attempt or unknown error
      if (e instanceof Error && !(e instanceof ApiError)) {
        throw new ApiError(0, 'NETWORK_ERROR', `网络请求失败: ${e.message}`);
      }
      throw e;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

export const api = {
  get: <T>(path: string, opts?: FetchOptions) =>
    fetchApi<T>(path, undefined, opts),
  post: <T>(path: string, body: unknown, opts?: FetchOptions) =>
    fetchApi<T>(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      opts,
    ),
  patch: <T>(path: string, body: unknown, opts?: FetchOptions) =>
    fetchApi<T>(
      path,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      opts,
    ),
  delete: <T>(path: string, opts?: FetchOptions) =>
    fetchApi<T>(path, { method: 'DELETE' }, opts),
};
