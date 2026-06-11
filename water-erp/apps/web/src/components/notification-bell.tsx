'use client';

import { useEffect, useState, useRef } from 'react';
import { getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead } from '@/lib/api/supplier';
import type { Notification } from '@/lib/types';

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const loadUnread = () => {
    getUnreadNotificationCount().then(d => setUnread(d.count)).catch(() => {});
  };

  useEffect(() => {
    loadUnread();
    const timer = setInterval(loadUnread, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    getNotifications(1, 10).then(d => setItems(d.items)).catch(() => {});
  }, [open]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleRead = async (id: string) => {
    await markNotificationRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnread(prev => Math.max(0, prev - 1));
  };

  const handleAllRead = async () => {
    await markAllNotificationsRead();
    setItems(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnread(0);
  };

  const typeIcon: Record<string, string> = {
    SUPPLIER_APPROVED: '✅',
    SUPPLIER_REJECTED: '❌',
    SUPPLIER_RETURNED: '🔄',
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="relative p-2 text-[#5a6d8a] hover:text-[#064ea2] transition">
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-xl border border-[#e8f0fa] z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8f0fa]">
            <span className="font-bold text-sm text-[#18243a]">通知 ({unread} 未读)</span>
            {unread > 0 && (
              <button onClick={handleAllRead} className="text-xs text-[#064ea2] hover:underline">全部已读</button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-[#5a6d8a] text-sm">暂无通知</div>
            ) : items.map(n => (
              <div key={n.id} className={`px-4 py-3 border-b border-[#f0f4f8] hover:bg-[#f8fbff] cursor-pointer ${!n.isRead ? 'bg-[#f0f7ff]' : ''}`}
                onClick={() => !n.isRead && handleRead(n.id)}>
                <div className="flex items-start gap-2">
                  <span className="text-sm mt-0.5">{typeIcon[n.type] || '📢'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#18243a] truncate">{n.title}</p>
                    <p className="text-xs text-[#5a6d8a] mt-0.5 line-clamp-2">{n.content}</p>
                    <p className="text-[10px] text-[#8a9aaa] mt-1">{new Date(n.createdAt).toLocaleString('zh-CN')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
