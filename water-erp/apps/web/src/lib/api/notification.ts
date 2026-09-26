import { api } from '@/lib/api';

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  readAt?: string | null;
  resolvedAt: string | null;
  link?: string | null;
  createdAt: string;
}

export type NotificationTab = 'all' | 'todo' | 'done' | 'toread' | 'read';
export function listNotifications(tab: NotificationTab = 'all', page = 1, pageSize = 20, types?: string[], countTypes?: string[]) {
  const q = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) });
  if (types?.length) q.set('types', types.join(','));
  if (countTypes?.length) q.set('countTypes', countTypes.join(','));
  return api.get<{ total: number; page: number; pageSize: number; items: NotificationItem[]; unreadCount: number; todoCount: number; typeCounts: { type: string; count: number }[] }>(`/notifications?${q.toString()}`);
}
export function getUnreadCount() {
  return api.get<{ count: number }>('/notifications/unread-count');
}
export function markNotificationRead(id: string) {
  return api.post<NotificationItem>(`/notifications/${id}/read`, {});
}
export function markAllNotificationsRead() {
  return api.post<{ count: number }>('/notifications/mark-all-read', {});
}

export interface AuditActivity {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: unknown;
  createdAt: string;
}

/** 当前用户操作历史（AuditLog）——通知中心「操作历史」与已办结果记录数据源 */
export function fetchMyActivities(limit = 50) {
  return api.get<{ items: AuditActivity[]; total: number }>(`/audit-log/my-activities?limit=${limit}`);
}
