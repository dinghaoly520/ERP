/**
 * public-portal 信息门户 API 客户端 —— 基于 @water-erp/client 统一封装。
 * （2026-08 审计收敛：此前为本地复制的 fetchApi 副本之一。）
 *
 * 本门户对调用方抛普通 Error（保持既有 catch 行为不变）。
 */
import { createApiClient } from '@water-erp/client';

const client = createApiClient({ portal: 'public' });

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await client.raw(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `API ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
};
