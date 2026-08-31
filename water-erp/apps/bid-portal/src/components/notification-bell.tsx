'use client';

import { useEffect, useState, useRef } from 'react';
import { getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead } from '@/lib/api/supplier';
import type { Notification } from '@/lib/types';
import { Bell, CheckCheck, CheckCircle, XCircle, RefreshCw, Info, Gavel, AlertTriangle } from 'lucide-react';

type TypeCfg = { Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; cls: string };

/** O8（2026-08-28）：原 typeCfg 仅供应商审批三类（:3005 时代遗留），本端开评标通知
 *  （BID_*，后端 20+ 类型）全落 Info 兜底。改两级解析：语义明确者精确映射，其余
 *  BID_* 前缀按开评标执行类兜底；未识别类型维持 Info。 */
const EXACT_TYPE_CFG: Record<string, TypeCfg> = {
  SUPPLIER_APPROVED: { Icon: CheckCircle, cls: 'text-emerald-600 bg-emerald-50' },
  SUPPLIER_REJECTED: { Icon: XCircle, cls: 'text-red-600 bg-red-50' },
  SUPPLIER_RETURNED: { Icon: RefreshCw, cls: 'text-amber-600 bg-amber-50' },
  BID_ABORTED: { Icon: XCircle, cls: 'text-red-600 bg-red-50' },
  BID_DECRYPT_FAILED: { Icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50' },
  BID_DISPUTE_TIMEOUT: { Icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50' },
  AWARD_LETTER: { Icon: CheckCircle, cls: 'text-emerald-600 bg-emerald-50' },
  PRE_WIN_NOTICE: { Icon: CheckCircle, cls: 'text-emerald-600 bg-emerald-50' },
  BID_OPENING_HANDED_OVER: { Icon: CheckCircle, cls: 'text-emerald-600 bg-emerald-50' },
};

function resolveTypeCfg(type?: string | null): TypeCfg | undefined {
  if (!type) return undefined;
  if (EXACT_TYPE_CFG[type]) return EXACT_TYPE_CFG[type];
  if (type.startsWith('BID_')) return { Icon: Gavel, cls: 'text-sky-600 bg-sky-50' };
  return undefined;
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
                const cfg = resolveTypeCfg(n.type);
                const IconComp = cfg?.Icon || Info;
                return (
                  <div key={n.id}
                    className={`px-4 py-3 border-b border-[oklch(0.94_0.004_264)] hover:bg-[oklch(0.992_0.003_264)] cursor-pointer ${!n.isRead ? 'bg-[oklch(0.97_0.008_262)]' : ''}`}
                    onClick={() => !n.isRead && handleRead(n.id)}>
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 flex-shrink-0 mt-0.5 ${cfg?.cls || 'text-slate-500 bg-slate-50'}`}>
                        <IconComp size={14} strokeWidth={1.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] truncate tracking-tight">{n.title}</p>
                        <p className="text-[12px] text-[oklch(0.55_0.01_264)] mt-0.5 line-clamp-2">{n.content}</p>
                        <p className="text-[11px] text-[oklch(0.72_0.008_264)] mt-1 font-mono">{new Date(n.createdAt).toLocaleString('zh-CN')}</p>
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
