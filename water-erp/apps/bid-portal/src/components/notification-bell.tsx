'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import { getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead } from '@/lib/api/supplier';
import type { Notification } from '@/lib/types';
import { getNotificationMeta, getNotificationLabel } from '@water-erp/shared';
import { resolveBidLink } from './notification/realtime-notifications';
import { Bell, CheckCheck } from 'lucide-react';

/** 类型图标从 shared 注册表派生（2026-09-26 单一事实源；原本地 9 条兜底表已删） */
function resolveIcon(type?: string | null): { Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; cls: string } {
  const meta = getNotificationMeta(type ?? '');
  const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
  const cls =
    meta.tone === 'red' ? 'text-red-600 bg-red-50' :
    meta.tone === 'green' ? 'text-emerald-600 bg-emerald-50' :
    meta.tone === 'orange' ? 'text-amber-600 bg-amber-50' :
    meta.tone === 'purple' ? 'text-violet-600 bg-violet-50' :
    meta.tone === 'gray' ? 'text-slate-500 bg-slate-50' :
    'text-sky-600 bg-sky-50';
  return { Icon, cls };
}

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
    // 实时弹窗（notification/realtime-notifications）触达时即时刷新角标
    const onReceived = () => loadUnread();
    window.addEventListener('notification:received', onReceived);
    return () => { clearInterval(timer); window.removeEventListener('notification:received', onReceived); };
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

  const router = useRouter();

  const handleItemClick = async (n: Notification) => {
    if (!n.isRead) {
      await markNotificationRead(n.id).catch(() => {});
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      setUnread(prev => Math.max(0, prev - 1));
    }
    const href = resolveBidLink(n.link);
    if (href) { setOpen(false); router.push(href); }
  };

  const handleAllRead = async () => {
    await markAllNotificationsRead();
    setItems(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnread(0);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="sp-header-icon" aria-label="通知">
        <Bell size={18} strokeWidth={1.5} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--danger)] px-1 font-mono text-[9px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="bid-bell-panel">
          <div className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258_/_0.14)] px-4 py-3">
            <span className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">
              通知 <span className="text-[oklch(0.62_0.008_264)] font-medium">({unread} 未读)</span>
            </span>
            {unread > 0 && (
              <button onClick={handleAllRead} className="flex items-center gap-1 text-[12px] text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] font-medium tracking-tight transition-colors">
                <CheckCheck size={13} strokeWidth={1.5} /> 全部已读
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂无通知</div>
            ) : (
              items.map(n => {
                const { Icon: IconComp, cls } = resolveIcon(n.type);
                return (
                  <div key={n.id}
                    className={`px-4 py-3 border-b border-[oklch(0.94_0.004_264)] hover:bg-[oklch(0.992_0.003_264)] cursor-pointer ${!n.isRead ? 'bg-[oklch(0.97_0.008_262)]' : ''}`}
                    onClick={() => handleItemClick(n)}>
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 flex-shrink-0 mt-0.5 ${cls}`}>
                        <IconComp size={14} strokeWidth={1.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] truncate tracking-tight">{n.title}</p>
                        <p className="text-[12px] text-[oklch(0.55_0.01_264)] mt-0.5 line-clamp-2">{n.content}</p>
                        <p className="text-[11px] text-[oklch(0.72_0.008_264)] mt-1 font-mono">
                          {getNotificationLabel(n.type)} · {new Date(n.createdAt).toLocaleString('zh-CN')}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
