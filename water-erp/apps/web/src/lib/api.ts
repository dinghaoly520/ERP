/**
 * web 门户 API 客户端 —— 基于 @water-erp/client 统一封装。
 * （2026-08 审计收敛：此前为本地复制的 fetchApi 副本之一，共 6 份。）
 */
import { createApiClient } from '@water-erp/client';

export { ApiError } from '@water-erp/client';

const client = createApiClient({
  portal: 'web',
  baseUrl: process.env.NEXT_PUBLIC_API_BASE || '/api',
});

export const api = {
  get: <T>(path: string) => client.get<T>(path),
  post: <T>(path: string, body: unknown, init?: RequestInit) => client.post<T>(path, body, init),
  postForm: <T>(path: string, body: FormData) => client.postForm<T>(path, body),
  put: <T>(path: string, body: unknown) => client.put<T>(path, body),
  patch: <T>(path: string, body: unknown) => client.patch<T>(path, body),
  delete: <T>(path: string) => client.delete<T>(path),
};
