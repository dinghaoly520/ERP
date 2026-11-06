import { api } from '../api';
import type { Notification } from '../types';

/**
 * :3007 仅保留通知角标所需函数（2026-08 裁剪）：
 * 供应商 CRUD/评价/分类等函数为 :3005 时代残留死副本（零引用），已删除；
 * 供应商管理功能在采购管理工作台（:3005），本端不持有写操作。
 */

/** 铃铛用通知行——比共享类型多 resolvedAt（待办/已办判据，:3005 NotificationItem 同款） */
export interface BellNotification extends Notification {
  readAt?: string | null;
  resolvedAt?: string | null;
}

export function getNotifications(page?: number, pageSize?: number) {
  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  if (pageSize) query.set('pageSize', String(pageSize));
  return api.get<{ total: number; page: number; pageSize: number; items: BellNotification[] }>(`/notifications?${query.toString()}`);
}

export function getUnreadNotificationCount() {
  return api.get<{ count: number }>('/notifications/unread-count');
}

export function markNotificationRead(id: string) {
  return api.post<Notification>(`/notifications/${id}/read`, {});
}

export function markAllNotificationsRead() {
  return api.post<{ count: number }>('/notifications/mark-all-read', {});
}

// 办结自己的待办（resolvedAt 落库并置已读）——markAsRead 对 actionable 未办结通知是
// 服务端 no-op（2026-09-27 五段语义：待办不走已读出口），勿混用
export function resolveNotification(id: string) {
  return api.post<Notification>(`/notifications/${id}/resolve`, {});
}
