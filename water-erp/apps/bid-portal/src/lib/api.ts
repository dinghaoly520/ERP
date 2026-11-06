/**
 * bid-portal 开评标管理端 API 客户端 —— 基于 @water-erp/client 统一封装。
 * （2026-08 审计收敛：此前为本地复制的 fetchApi 副本之一。）
 *
 * 注意：本门户 X-Portal 发 'bid'（auth port-roles 体系；token_bid cookie 命名空间，
 * :3006 登录分流时由后端写入）。CLAUDE.md 中「共用 token_web」的说法是旧文，已过时。
 */
import { createApiClient } from '@water-erp/client';
import { showSessionReplacedOverlay, showFrozenOverlay, expertLoginUrl } from '@/lib/session-guard';

export { ApiError } from '@water-erp/client';

const client = createApiClient({
  portal: 'bid',
  // X-P2-01（2026-09-29）：401 全局兜底——冻结/失效此前在 :3007 无遮罩无跳转，
  // 主持人无感知继续操作全部失败。分流与 :3006 同款：
  //  - SESSION_REPLACED：被顶下线 → 全屏遮罩
  //  - ACCOUNT_FROZEN：冻结 → 冻结遮罩
  //  - 其余（JWT 过期/cookie 被清）→ 跳 :3006 登录（Host 相对构建，勿用绝对常量）
  on401: (error) => {
    if (error.code === 'SESSION_REPLACED') { showSessionReplacedOverlay(error.message); return; }
    if (error.code === 'ACCOUNT_FROZEN') { showFrozenOverlay(error.message); return; }
    window.location.href = expertLoginUrl();
  },
});

export const api = {
  get: <T>(path: string, init?: RequestInit) => client.get<T>(path, init),
  post: <T>(path: string, body: unknown, options?: RequestInit) => client.post<T>(path, body, options),
  put: <T>(path: string, body: unknown) => client.put<T>(path, body),
  patch: <T>(path: string, body: unknown) => client.patch<T>(path, body),
  delete: <T>(path: string) => client.delete<T>(path),
  /** 2026-11-06 上传进度条：原为 postForm 别名（fetch 无进度）；指回 client.upload XHR 轨——
   *  签名向后兼容（不传 opts 行为不变），错误归一语义一致 */
  upload: <T>(path: string, formData: FormData, opts?: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal }) =>
    client.upload<T>(path, formData, opts),
};

export * from './api/supplier';
export * from './api/bid';
