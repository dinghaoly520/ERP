import { api } from '@/lib/api';

/**
 * 开标大厅 REST 客户端（澄清答疑/在线交流）。
 *
 * 复用 `lib/api.ts` 的 fetch 封装：自带 `credentials: 'include'` 与
 * `X-Portal: 'web'` 头，`/api` 前缀由 next.config rewrites 转发至
 * `http://localhost:4001/api`。失败时抛 `ApiError`（含 status/code）。
 *
 * 对应后端 `apps/api/src/opening-hall/opening-hall.controller.ts`。
 */
export const openingHallApi = {
  presence: (projectId: string) =>
    api.get<any>(`/opening-hall/${projectId}/presence`),

  send: (projectId: string, body: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; content: string }) =>
    api.post<any>(`/opening-hall/${projectId}/messages`, body),

  messages: (projectId: string, params: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    qs.set('roomType', params.roomType);
    if (params.supplierId) qs.set('supplierId', params.supplierId);
    if (params.limit) qs.set('limit', String(params.limit));
    return api.get<any>(`/opening-hall/${projectId}/messages?${qs}`);
  },

  unread: (projectId: string) =>
    api.get<any>(`/opening-hall/${projectId}/unread`),

  markRead: (projectId: string, roomKey: string, lastMessageId?: string) =>
    api.post<any>(`/opening-hall/${projectId}/read`, { roomKey, ...(lastMessageId ? { lastMessageId } : {}) }),

  setControl: (projectId: string, control: 'OPEN' | 'MUTED' | 'CLOSED') =>
    api.patch<any>(`/opening-hall/${projectId}/exchange-control`, { control }),
};
