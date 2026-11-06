/**
 * @water-erp/client — 统一 API fetch 客户端（全部门户共用）。
 *
 * 背景（2026-08 审计）：fetchApi 封装曾在 6 个 app 各复制一份（web/bid-portal/
 * expert-portal/public-portal/assistant/web-erp-old）。本包收敛为一份实现，
 * 各门户只保留 2-10 行的门户配置。
 *
 * 设计约束：
 *  - 纯 fetch，无框架依赖（各 Next.js 门户均可用）；
 *  - 浏览器与 SSR 均可运行（401 跳转等浏览器行为通过 on401 回调由各 app 注入）；
 *  - 错误统一抛 ApiError（携带后端规范化错误体的 status/code/message/data）；
 *  - post() 自动识别 FormData（浏览器自动设置 multipart boundary，不强制 JSON）。
 *
 * 已知例外：assistant 的 lib/api.ts 保留了独立的超时/重试/退避实现（公共聊天机器人
 * 的长请求特性），未收敛到本包——如需统一，先把 FetchOptions 移植进来再迁移。
 *
 * 用法（app 内建一个 lib/api.ts）：
 *   import { createApiClient } from '@water-erp/client';
 *   export const api = createApiClient({ portal: 'web' });
 *   await api.get('/auth/heartbeat');
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
  /** 每次请求动态附加的额外头（如 :3005 单设备登录的 tab 级会话标识 X-Web-Token） */
  extraHeaders?: () => Record<string, string>;
}

export interface ApiClient {
  /** 原始 fetch（已注入 X-Portal + credentials），返回 Response，调用方自行处理 */
  raw(path: string, init?: RequestInit): Promise<Response>;
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  postForm<T>(path: string, body: FormData): Promise<T>;
  /**
   * XHR 上传（fetch 无上传进度事件，2026-11-06 上传进度条底座）：头注入/错误归一/
   * 401 回调/断网翻译与 doFetch 同语义；FormData 由浏览器设置 multipart boundary。
   */
  upload<T>(path: string, body: FormData, opts?: UploadOptions): Promise<T>;
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
}

/** upload() 选项：字节进度回调 + 取消 */
export interface UploadOptions {
  /** 上传字节进度（lengthComputable 才回调） */
  onProgress?: (loaded: number, total: number) => void;
  /** 取消：abort 后 reject DOMException('…','AbortError')，与 fetch 同语义 */
  signal?: AbortSignal;
}

function mergeHeaders(init: RequestInit | undefined, extra: Record<string, string>): Record<string, string> {
  const base = (init?.headers as Record<string, string>) || {};
  return { ...extra, ...base };
}

/**
 * 解析错误响应为 ApiError（尽量提取后端规范体的 code/error 字段）。
 *
 * message 取值优先级：body.error（后端规范体中文消息）→ body.message（Nest 旧
 * 格式，ValidationPipe 数组取首条）→ fallback（调用方语境中文，如「加载仪表盘
 * 数据失败」）→ `请求失败 (status)`。完整原始错误体挂 ApiError.data 供排查——
 * **不得把响应体原文塞进 message 直出用户**（2026-09-30 P2022 裸 JSON 事件起，
 * 各门户 lib/api 统一经此函数构造错误）。
 */
export async function toApiError(res: Response, fallback?: string): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = fallback ?? `请求失败 (${res.status})`;
  let data: unknown;
  try {
    data = await res.json();
    if ((data as any)?.code) code = (data as any).code;
    if ((data as any)?.error) {
      message = String((data as any).error);
    } else if ((data as any)?.message) {
      const raw = (data as any).message;
      message = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw);
      if (!message) message = fallback ?? `请求失败 (${res.status})`;
    }
  } catch {
    // 响应体非 JSON，保留 fallback/默认消息
  }
  return new ApiError(res.status, code, message, data);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = (options.baseUrl ?? '/api').replace(/\/$/, '');
  const isBrowser = typeof window !== 'undefined';

  /** 底层请求：注入 X-Portal + credentials；401 触发 on401（浏览器端） */
  async function doFetch(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        credentials: 'include',
        ...init,
        headers: mergeHeaders(init, { 'X-Portal': options.portal, ...(options.extraHeaders?.() ?? {}) }),
      });
    } catch (err) {
      // 调用方主动取消（如组件卸载清理的 AbortController.abort）原样放行，保持 AbortError 语义
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // 断网/超时（fetch 直接 reject，无状态码）：翻译为统一中文，避免 "Failed to fetch" 直出用户 toast
      throw new ApiError(0, 'NETWORK_ERROR', '网络异常或请求超时，请检查网络');
    }
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

  /**
   * XHR 底座上传（fetch 规范无上传进度事件，唯一可靠途径是 xhr.upload.onprogress）。
   * 头注入（X-Portal + extraHeaders）/错误归一（ApiError，body.error 优先）/401 回调/
   * 断网 NETWORK_ERROR 中文翻译均与 doFetch 同语义；空响应体返回 undefined（同 fetchApi）。
   * XMLHttpRequest 运行时取 globalThis（SSR 不触达；Node 测试注入 stub 即可测）。
   */
  function upload<T>(path: string, body: FormData, opts: UploadOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const xhr = new globalThis.XMLHttpRequest();
      xhr.open('POST', `${base}${path}`);
      xhr.withCredentials = true;
      const headers = { 'X-Portal': options.portal, ...(options.extraHeaders?.() ?? {}) };
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      const onAbort = () => xhr.abort();
      opts.signal?.addEventListener('abort', onAbort);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && opts.onProgress) opts.onProgress(e.loaded, e.total);
      };
      const settle = (fn: () => void) => {
        opts.signal?.removeEventListener('abort', onAbort);
        fn();
      };
      xhr.onerror = () => settle(() => {
        // 调用方取消（abort 触发 onerror）保持 AbortError 语义，不误报断网
        if (opts.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
        else reject(new ApiError(0, 'NETWORK_ERROR', '网络异常或请求超时，请检查网络'));
      });
      xhr.onload = () => settle(() => {
        if (opts.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          const text = xhr.responseText ?? '';
          try {
            resolve((text ? JSON.parse(text) : undefined) as T);
          } catch {
            reject(new ApiError(xhr.status, 'BAD_JSON', `响应解析失败 (${xhr.status})`));
          }
          return;
        }
        let code = 'UNKNOWN';
        let message = `请求失败 (${xhr.status})`;
        let data: unknown;
        try {
          data = JSON.parse(xhr.responseText);
          if ((data as any)?.code) code = String((data as any).code);
          if ((data as any)?.error) message = String((data as any).error);
          else if ((data as any)?.message) {
            const raw = (data as any).message;
            const first = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw);
            if (first) message = first;
          }
        } catch {
          // 响应体非 JSON，保留默认消息
        }
        if (xhr.status === 401 && isBrowser && options.on401) {
          options.on401(new ApiError(xhr.status, code, message, data));
        }
        reject(new ApiError(xhr.status, code, message, data));
      });
      xhr.send(body);
    });
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
    upload: <T>(path: string, body: FormData, opts?: UploadOptions) =>
      upload<T>(path, body, opts),
    // put/patch/delete 支持可选 init（2026-10-28）：调用方需要传 signal/timeout 等
    // RequestInit 时不必再退回 raw——raw 返回 Response 且 fetch 对 4xx/5xx 是 resolve，
    // 绕过 fetchApi 的 !ok → toApiError 通道（供应商门户 api.put 曾因此吞掉一切非 2xx
    // 错误并漏发 Content-Type，后端收空 DTO 返回 200 假成功）。
    put: <T>(path: string, body?: unknown, init?: RequestInit) => {
      const { headers, body: bodyInit } = jsonBody(body);
      return fetchApi<T>(path, {
        ...init,
        method: 'PUT',
        headers: mergeHeaders(init, headers),
        body: bodyInit,
      });
    },
    patch: <T>(path: string, body?: unknown, init?: RequestInit) => {
      const { headers, body: bodyInit } = jsonBody(body);
      return fetchApi<T>(path, {
        ...init,
        method: 'PATCH',
        headers: mergeHeaders(init, headers),
        body: bodyInit,
      });
    },
    delete: <T>(path: string, init?: RequestInit) =>
      fetchApi<T>(path, { ...init, method: 'DELETE' }),
  };
}
