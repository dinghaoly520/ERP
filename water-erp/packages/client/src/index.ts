/**
 * @water-erp/client — 统一 API fetch 客户端（全部门户共用）。
 *
 * 背景（2026-08 审计）：fetchApi 封装曾在 6 个 app 各复制一份（web/bid-portal/
 * expert-portal/public-portal/assistant/web-erp-old），mall 完全没有封装（裸 fetch
 * 手写 X-Portal 头）。本包收敛为一份实现，各门户只保留 2-10 行的门户配置。
 *
 * 设计约束：
 *  - 纯 fetch，无框架依赖（Next.js React 门户与 Vue supplier-portal 均可用）；
 *  - 浏览器与 SSR 均可运行（401 跳转等浏览器行为通过 on401 回调由各 app 注入）；
 *  - 错误统一抛 ApiError（携带后端规范化错误体的 status/code/message/data）；
 *  - post() 自动识别 FormData（浏览器自动设置 multipart boundary，不强制 JSON）。
 *
 * 已知例外：assistant 的 lib/api.ts 保留了独立的超时/重试/退避实现（公共聊天机器人
 * 的长请求特性），未收敛到本包——如需统一，先把 FetchOptions 移植进来再迁移。
 *
 * 用法（app 内建一个 lib/api.ts）：
 *   import { createApiClient } from '@water-erp/client';
 *   export const api = createApiClient({ portal: 'mall' });
 *   await api.get<CatalogItem[]>('/catalog');
 */

/** 后端规范化错误体：{ statusCode, code, error, timestamp, path } */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** 后端返回的完整错误体（若可解析为 JSON），供需要细粒度判断的调用方使用 */
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  /** 门户标识，注入 X-Portal 头（后端 cookie 命名空间与端口-角色校验依据） */
  portal: string;
  /** API 基址；默认 '/api'（各 Next 门户经 rewrites/middleware 代理到 :4001） */
  baseUrl?: string;
  /**
   * 401 回调（通常是跳转登录页）。仅浏览器端触发；SSR 下由调用方 catch ApiError。
   * 参数为解析后的 ApiError——回调方可据 code 区分场景
   * （如 SESSION_REPLACED = 账号被其他设备顶下线，需专门提示）。
   */
  on401?: (error: ApiError) => void;
  /** 每次请求动态附加的额外头（如 :3005 单设备登录的 tab 级会话标识 X-Web-Sid） */
  extraHeaders?: () => Record<string, string>;
}

export interface ApiClient {
  /** 原始 fetch（已注入 X-Portal + credentials），返回 Response，调用方自行处理 */
  raw(path: string, init?: RequestInit): Promise<Response>;
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  postForm<T>(path: string, body: FormData): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

function mergeHeaders(init: RequestInit | undefined, extra: Record<string, string>): Record<string, string> {
  const base = (init?.headers as Record<string, string>) || {};
  return { ...extra, ...base };
}

/** 解析错误响应为 ApiError（尽量提取后端规范体的 code/error 字段） */
async function toApiError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `请求失败 (${res.status})`;
  let data: unknown;
  try {
    data = await res.json();
    if ((data as any)?.code) code = (data as any).code;
    if ((data as any)?.error) message = String((data as any).error);
  } catch {
    // 响应体非 JSON，保留默认消息
  }
  return new ApiError(res.status, code, message, data);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = (options.baseUrl ?? '/api').replace(/\/$/, '');
  const isBrowser = typeof window !== 'undefined';

  /** 底层请求：注入 X-Portal + credentials；401 触发 on401（浏览器端） */
  async function doFetch(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${base}${path}`, {
      credentials: 'include',
      ...init,
      headers: mergeHeaders(init, { 'X-Portal': options.portal, ...(options.extraHeaders?.() ?? {}) }),
    });
    if (res.status === 401 && isBrowser && options.on401) {
      // clone 保证 fetchApi 侧仍能正常读取响应体；toApiError 解析失败时兜底返回通用错误
      options.on401(await toApiError(res.clone()));
    }
    return res;
  }

  async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(path, init);
    if (!res.ok) {
      throw await toApiError(res);
    }
    // 优雅处理空响应（204 No Content 或空 body）——避免 "Unexpected end of JSON input"
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /** JSON 或 FormData 自动分流（FormData 时交给浏览器设置 multipart boundary） */
  function jsonBody(body: unknown): { headers: Record<string, string>; body: BodyInit | undefined } {
    if (body instanceof FormData) return { headers: {}, body };
    return { headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) };
  }

  return {
    raw: (path, init) => doFetch(path, init),
    get: <T>(path: string, init?: RequestInit) => fetchApi<T>(path, init),
    post: <T>(path: string, body?: unknown, init?: RequestInit) => {
      const { headers, body: bodyInit } = jsonBody(body);
      return fetchApi<T>(path, {
        ...init,
        method: 'POST',
        headers: mergeHeaders(init, headers),
        body: bodyInit,
      });
    },
    postForm: <T>(path: string, body: FormData) =>
      fetchApi<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => {
      const { headers, body: bodyInit } = jsonBody(body);
      return fetchApi<T>(path, { method: 'PUT', headers, body: bodyInit });
    },
    patch: <T>(path: string, body?: unknown) => {
      const { headers, body: bodyInit } = jsonBody(body);
      return fetchApi<T>(path, { method: 'PATCH', headers, body: bodyInit });
    },
    delete: <T>(path: string) => fetchApi<T>(path, { method: 'DELETE' }),
  };
}
