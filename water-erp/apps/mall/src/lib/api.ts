/**
 * mall 门户 API 客户端 —— 基于 @water-erp/client 统一封装。
 * （2026-08 审计收敛：此前 mall 完全没有封装，各处裸 fetch 手写 X-Portal 头。）
 */
import { createApiClient } from '@water-erp/client';

export const api = createApiClient({
  portal: 'mall',
  baseUrl: process.env.NEXT_PUBLIC_API_BASE || '/api',
  // 401 统一兜底：JWT 过期 / 被踢 / cookie 被清 → 跳登录页
  on401: () => {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  },
});

export { ApiError } from '@water-erp/client';
