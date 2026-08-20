"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { notificationApi } from "@/lib/api/notification";

/**
 * 消息通知上下文 — 移植自 Vue notification store。
 * 未读数 30s 轮询（外壳挂载时）；标记已读走乐观更新 + 失败回滚。
 */
interface NotificationContextValue {
  notifications: any[];
  unreadCount: number;
  total: number;
  loading: boolean;
  fetchNotifications: (page?: number, pageSize?: number) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children, poll = true }: { children: React.ReactNode; poll?: boolean }) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const res = await notificationApi.list({ page, pageSize });
      setNotifications(res?.items || []);
      setTotal(res?.total || 0);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await notificationApi.getUnreadCount();
      setUnreadCount(res?.count || 0);
    } catch { /* 静默 */ }
  }, []);

  useEffect(() => {
    if (!poll) return;
    fetchUnreadCount();
    const timer = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(timer);
  }, [poll, fetchUnreadCount]);

  const markAsRead = useCallback(async (id: string) => {
    let target: any = null;
    let wasUnread = false;
    setNotifications((prev) => {
      target = prev.find((x) => x.id === id) || null;
      wasUnread = !!target && !target.isRead;
      return wasUnread ? prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)) : prev;
    });
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await notificationApi.markAsRead(id);
    } catch {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: false } : n)));
      if (wasUnread) setUnreadCount((c) => c + 1);
      throw new Error("failed");
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    let prevUnread = 0;
    setNotifications((prev) => {
      prevUnread = prev.filter((n) => !n.isRead).length;
      return prev.map((n) => ({ ...n, isRead: true }));
    });
    setUnreadCount(0);
    try {
      await notificationApi.markAllAsRead();
      await fetchUnreadCount();
    } catch {
      setNotifications((prev) => prev.map((n) => (n.id && notifications.find((o) => o.id === n.id && !o.isRead) ? { ...n, isRead: false } : n)));
      setUnreadCount(prevUnread);
      throw new Error("failed");
    }
  }, [fetchUnreadCount, notifications]);

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, total, loading, fetchNotifications, fetchUnreadCount, markAsRead, markAllAsRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
