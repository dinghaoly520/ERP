import { api } from '@/lib/api';

/**
 * 开标大厅 REST 客户端（专家端只读）。
 *
 * 复用 `lib/api.ts` 的 fetch 封装：自带 `credentials: 'include'` 与
 * `X-Portal: 'expert'` 头，`/api` 前缀由 next.config rewrites 转发至
 * `http://localhost:4001/api`。失败时抛 `ApiError`（含 status/code）。
 *
 * 对应后端 `apps/api/src/opening-hall/opening-hall.controller.ts`。
 * 专家端仅需公聊历史 + 未读计数 + 标记已读，不发送消息/控制交流。
 */
export const openingHallApi = {
  messages: (projectId: string, params: { limit?: number }) => {
    const qs = new URLSearchParams();
    qs.set('roomType', 'PUBLIC');
    if (params.limit) qs.set('limit', String(params.limit));
    return api.get<any>(`/opening-hall/${projectId}/messages?${qs}`);
  },

  unread: (projectId: string) =>
    api.get<any>(`/opening-hall/${projectId}/unread`),

  markRead: (projectId: string, lastMessageId?: string) =>
    api.post<any>(`/opening-hall/${projectId}/read`, {
      roomKey: 'public',
      ...(lastMessageId ? { lastMessageId } : {}),
    }),
};
