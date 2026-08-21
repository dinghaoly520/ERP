/**
 * 供应商门户 API 客户端 —— 基于 @water-erp/client 统一封装。
 *
 * 在统一客户端之上复刻 Vue 版 axios 拦截器的全局行为：
 *  - 401（非登录请求、非 ACCOUNT_PENDING）→ toast「登录已过期」+ 跳 /login
 *  - 403/400/5xx/其余状态码 → toast 后端业务错误消息
 *  - 断网/超时（fetch 直接 reject）→ toast「网络异常」（开标现场关键动作密集，不能静默）
 *  - 默认 15s 超时（上传等长请求可传 timeout 覆盖）
 * 调用方需要自行处理错误展示时传 { silent: true }（如登录页、查重软提示）。
 */
import { createApiClient, ApiError } from "@water-erp/client";
import { toast } from "sonner";

const client = createApiClient({
  portal: "supplier",
  baseUrl: process.env.NEXT_PUBLIC_API_BASE || "/api",
});

export { ApiError };

/** 请求选项：RequestInit 之上扩展 silent（跳过全局 toast）与 timeout（毫秒） */
export interface ReqOpts extends RequestInit {
  silent?: boolean;
  timeout?: number;
}

/** 序列化查询参数（跳过 undefined/null/空串） */
export function qs(params?: Record<string, unknown>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function guard<T>(p: Promise<T>, path: string, opts: ReqOpts = {}): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError) {
      const code = (e.data as Record<string, unknown> | undefined)?.code as string | undefined;
      const isLoginReq = /(^|\/)auth\/login$/.test(path);
      if (e.status === 401) {
        // 登录请求（含「密码正确但待审核/停用」的 ACCOUNT_PENDING）由调用方处理，
        // 这里不弹「登录已过期」、不跳转，避免在登录页给出误导性提示。
        const skip = code === "ACCOUNT_PENDING" || code === "TEMPORARY_EXPIRED" || isLoginReq;
        if (!skip) {
          if (!opts.silent) toast.warning("登录已过期，请重新登录");
          if (typeof window !== "undefined" && window.location.pathname !== "/login") {
            window.location.href = "/login";
          }
        }
      } else if (!opts.silent) {
        if (e.status === 403) toast.error(e.message || "无权访问");
        else if (e.status === 400) toast.error(e.message || "请求参数错误");
        else if (e.status >= 500) toast.error("服务器错误，请稍后重试");
        else toast.error(e.message || "请求失败");
      }
      throw e;
    }
    // 断网/超时（fetch 直接 reject，无 ApiError 包装）
    if (!opts.silent) toast.error("网络异常或请求超时，请检查网络");
    throw e;
  }
}

function withTimeout(opts: ReqOpts): RequestInit {
  const { silent: _silent, timeout, ...init } = opts;
  if (timeout === 0) return init;
  if (init.signal) return init;
  return { ...init, signal: AbortSignal.timeout(timeout ?? 15000) };
}

export const api = {
  get: <T>(path: string, opts: ReqOpts = {}) =>
    guard<T>(client.get<T>(path, withTimeout(opts)), path, opts),
  post: <T>(path: string, body?: unknown, opts: ReqOpts = {}) =>
    guard<T>(client.post<T>(path, body, withTimeout(opts)), path, opts),
  postForm: <T>(path: string, body: FormData, opts: ReqOpts = {}) =>
    guard<T>(client.postForm<T>(path, body), path, opts),
  // 注：@water-erp/client 的 put/patch/delete 签名不接受额外 init（无 signal 参数），
  // 这三个方法沿用默认 fetch 超时语义（快速小请求，与原 15s 超时差异可忽略）
  put: <T>(path: string, body?: unknown, opts: ReqOpts = {}) =>
    guard<T>(client.put<T>(path, body), path, opts),
  patch: <T>(path: string, body?: unknown, opts: ReqOpts = {}) =>
    guard<T>(client.patch<T>(path, body), path, opts),
  delete: <T>(path: string, opts: ReqOpts = {}) =>
    guard<T>(client.delete<T>(path), path, opts),
  /** 原始 fetch（blob 下载等），返回 Response，调用方自行处理 */
  raw: (path: string, opts: ReqOpts = {}) => client.raw(path, withTimeout(opts)),
};
