/**
 * bid-portal 开评标管理端 API 客户端 —— 基于 @water-erp/client 统一封装。
 * （2026-08 审计收敛：此前为本地复制的 fetchApi 副本之一。）
 *
 * 注意：本门户 X-Portal 发 'bid'（auth port-roles 体系；token_bid cookie 命名空间，
 * :3006 登录分流时由后端写入）。CLAUDE.md 中「共用 token_web」的说法是旧文，已过时。
 */
import { createApiClient } from '@water-erp/client';

export { ApiError } from '@water-erp/client';

const client = createApiClient({ portal: 'bid' });

export const api = {
  get: <T>(path: string, init?: RequestInit) => client.get<T>(path, init),
  post: <T>(path: string, body: unknown, options?: RequestInit) => client.post<T>(path, body, options),
  patch: <T>(path: string, body: unknown) => client.patch<T>(path, body),
  delete: <T>(path: string) => client.delete<T>(path),
  upload: <T>(path: string, formData: FormData) => client.postForm<T>(path, formData),
};

export * from './api/supplier';
export * from './api/bid';
