import { api } from '@/lib/api';

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  resolvedAt: string | null;
  link?: string | null;
  createdAt: string;
}

export function listNotifications(tab: 'all' | 'todo' = 'all', page = 1, pageSize = 20) {
  const q = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) });
  return api.get<{ total: number; page: number; pageSize: number; items: NotificationItem[] }>(`/notifications?${q.toString()}`);
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
