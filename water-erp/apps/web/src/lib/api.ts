/**
 * web 门户 API 客户端 —— 基于 @water-erp/client 统一封装。
 * （2026-08 审计收敛：此前为本地复制的 fetchApi 副本之一，共 6 份。）
 */
import { createApiClient } from '@water-erp/client';
import { showSessionReplacedOverlay, showFrozenOverlay } from './session-kick';
import { getWebToken } from './session-store';

export { ApiError } from '@water-erp/client';

const client = createApiClient({
  portal: 'web',
  baseUrl: process.env.NEXT_PUBLIC_API_BASE || '/api',
  // tab 级会话 token（sessionStorage 各标签页独立）：同浏览器登录不同账号互不覆盖；
  // token 内 sid 与库中比对实现同账号仅一处在线
  extraHeaders: (): Record<string, string> => {
    const token = getWebToken();
    return token ? { 'X-Web-Token': token } : {};
  },
  // 单设备登录（2026-08-21）：被顶下线/账号冻结时弹提示并回登录页；
  // 其余 401（未登录浏览等）保持原有行为，交给各页面自行处理。
  on401: (error) => {
    if (error?.code === 'SESSION_REPLACED') showSessionReplacedOverlay(error.message);
    if (error?.code === 'ACCOUNT_FROZEN') showFrozenOverlay(error.message);
  },
});

export const api = {
  get: <T>(path: string) => client.get<T>(path),
  post: <T>(path: string, body?: unknown, init?: RequestInit) => client.post<T>(path, body, init),
  postForm: <T>(path: string, body: FormData) => client.postForm<T>(path, body),
  /** XHR 上传（2026-11-06 上传进度条）：fetch 无上传进度事件，此通道带字节进度+取消 */
  upload: <T>(path: string, body: FormData, opts?: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal }) =>
    client.upload<T>(path, body, opts),
  put: <T>(path: string, body: unknown) => client.put<T>(path, body),
  patch: <T>(path: string, body: unknown) => client.patch<T>(path, body),
  delete: <T>(path: string) => client.delete<T>(path),
};
