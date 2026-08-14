import { api } from '../api';
import type { Notification } from '../types';

/**
 * :3007 仅保留通知角标所需 4 个函数（2026-08 裁剪）：
 * 供应商 CRUD/评价/分类等函数为 :3005 时代残留死副本（零引用），已删除；
 * 供应商管理功能在采购管理工作台（:3005），本端不持有写操作。
 */

// 通知列表
export function getNotifications(page?: number, pageSize?: number) {
  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  if (pageSize) query.set('pageSize', String(pageSize));
  return api.get<{ total: number; page: number; pageSize: number; items: Notification[] }>(`/notifications?${query.toString()}`);
}

// 未读通知数量
export function getUnreadNotificationCount() {
  return api.get<{ count: number }>('/notifications/unread-count');
}

// 标记已读
export function markNotificationRead(id: string) {
  return api.post<Notification>(`/notifications/${id}/read`, {});
}

// 全部标记已读
export function markAllNotificationsRead() {
  return api.post<{ count: number }>('/notifications/mark-all-read', {});
}
