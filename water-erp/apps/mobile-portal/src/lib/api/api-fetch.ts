/**
 * web 门户模块级裸 fetch 统一包装（2026-09-26 串台修复）：token_web cookie 全浏览器仅一份，
 * 双标签页登录不同账号会互覆——统一注入 tab 级 X-Web-Token + X-Portal（cookie 仍带，作 SSR/无头回退）。
 */
import { ApiError } from '@water-erp/client';
import { getWebToken } from '@/lib/session-store';

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getWebToken();
  const headers = new Headers(init.headers);
  headers.set('X-Portal', 'web');
  if (token) headers.set('X-Web-Token', token);
  try {
    return await fetch(input, { ...init, credentials: init.credentials ?? 'include', headers });
  } catch (err) {
    // 调用方主动取消（AbortController.abort）原样放行，保持 AbortError 语义
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // 断网/超时（fetch 直接 reject 的 TypeError "Failed to fetch"）翻译为中文，
    // 与 @water-erp/client 的 doFetch 同款——避免英文浏览器原生报错直出用户
    throw new ApiError(0, 'NETWORK_ERROR', '网络异常或请求超时，请检查网络');
  }
}
