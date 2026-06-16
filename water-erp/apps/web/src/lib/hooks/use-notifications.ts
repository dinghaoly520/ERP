'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead, type NotificationItem } from '@/lib/api/notification';
import { getNotificationMeta } from '@water-erp/shared';

const POLL_MS = 30_000;

export interface DerivedTodo { supplierPending: number; priceReview: number; expiringQualifications: number; }

export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [todoItems, setTodoItems] = useState<NotificationItem[]>([]);
  const [recent, setRecent] = useState<NotificationItem[]>([]);
  const [derivedTodo, setDerivedTodo] = useState<DerivedTodo>({ supplierPending: 0, priceReview: 0, expiringQualifications: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [cnt, todoRes, allRes] = await Promise.all([
        getUnreadCount(),
        listNotifications('todo', 1, 20),
        listNotifications('all', 1, 8),
      ]);
      setUnreadCount(cnt.count);
      // 「待办」= 未 resolve 且 actionable
      setTodoItems(todoRes.items.filter((n) => getNotificationMeta(n.type).actionable));
      setRecent(allRes.items);

      // 双源：stats 派生（兜底，确保不遗漏 SUPPLIER_PENDING 之外的待办）
      const [ss, cs, alerts] = await Promise.all([
        fetch('/api/supplier/stats', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/catalog/admin/stats', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/alerts/overview', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      setDerivedTodo({
        supplierPending: ss?.pending ?? 0,
        priceReview: cs?.pendingApplications ?? 0,
        expiringQualifications: alerts?.expiringQualifications ?? 0,
      });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    setUnreadCount((c) => Math.max(0, c - 1));
    setRecent((items) => items.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setTodoItems((items) => items.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    setUnreadCount(0);
    setRecent((items) => items.map((n) => ({ ...n, isRead: true })));
    setTodoItems((items) => items.map((n) => ({ ...n, isRead: true })));
  }, []);

  return { unreadCount, todoItems, recent, derivedTodo, refresh, markRead, markAllRead };
}
