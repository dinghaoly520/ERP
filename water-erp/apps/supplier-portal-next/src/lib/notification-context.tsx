"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { notificationApi } from "@/lib/api/notification";
import type { SupplierNotification } from "@/lib/api/notification";
import { notificationActionMode } from "@/lib/notification-meta";

/**
 * 消息通知上下文 — 移植自 Vue notification store。
 * 未读数 30s 轮询（外壳挂载时）；标记已读走乐观更新 + 失败回滚。
 */
interface NotificationContextValue {
  notifications: SupplierNotification[];
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
  const [notifications, setNotifications] = useState<SupplierNotification[]>([]);
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
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchUnreadCount();
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [poll, fetchUnreadCount]);

  const markAsRead = useCallback(async (id: string) => {
    let target: SupplierNotification | null = null;
    let wasUnread = false;
    // 2026-11-17：actionable 未办结的「标为已读」后端是 no-op——不做乐观置读（30s 轮询会回弹，
    // 用户感知「点了没反应、角标不减」）；待办的出口是「标记已办」（消息中心页 resolveTodo）
    let optimistic = false;
    setNotifications((prev) => {
      target = prev.find((x) => x.id === id) || null;
      wasUnread = !!target && !target.isRead;
      optimistic = wasUnread && !!target && notificationActionMode(target).canMarkRead;
      return optimistic ? prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)) : prev;
    });
    if (optimistic) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await notificationApi.markAsRead(id);
    } catch {
      if (optimistic) {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: false } : n)));
        setUnreadCount((c) => c + 1);
      }
      throw new Error("failed");
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    const previous = notifications;
    const prevUnread = previous.filter((notification) => !notification.isRead).length;
    const readonlyUnread = previous.filter((n) => !n.isRead && notificationActionMode(n).canMarkRead).length;
    // 后端 mark-all 只清知会类（READONLY_TYPES）——乐观镜像同口径：待办行保持未读、
    // 角标只减知会份额，随后 fetchUnreadCount 落真实余量（不再是「清零又弹回」的假动作）
    setNotifications((prev) => prev.map((n) => (
      notificationActionMode(n).canMarkRead ? { ...n, isRead: true } : n
    )));
    setUnreadCount((c) => Math.max(0, c - readonlyUnread));
    try {
      await notificationApi.markAllAsRead();
      await fetchUnreadCount();
    } catch {
      setNotifications(previous);
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
