/**
 * 站内通知（:3011 顶栏铃铛，2026-11-03）——只读消费：列表浏览与未读角标；
 * 不提供已读标记/全部已读（驾驶舱只读铁律，写操作留 :3005）。
 */
import { api } from "../api";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  /** 指向 :3005 的处理入口——移动端不可路由，仅作来源标识展示 */
  link?: string | null;
};

export type NotificationListResult = {
  total: number;
  page: number;
  pageSize: number;
  items: NotificationItem[];
  unreadCount: number;
  todoCount: number;
  segmentCounts: { all: number; todo: number; done: number; toread: number; read: number };
};

export async function fetchUnreadCount(): Promise<number> {
  const r = await api.get<{ count: number }>("/notifications/unread-count");
  return r.count;
}

export async function fetchNotifications(tab: "all" | "todo", page = 1, pageSize = 20): Promise<NotificationListResult> {
  return api.get<NotificationListResult>(`/notifications?tab=${tab}&page=${page}&pageSize=${pageSize}`);
}
