'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta } from '@water-erp/shared';
import { useNotifications } from '@/lib/hooks/use-notifications';
import { statusTone } from '@water-erp/shared';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function NotificationCenter() {
  const router = useRouter();
  const { unreadCount, todoItems, recent, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'todo' | 'all'>('todo');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const items = tab === 'todo' ? todoItems : recent;

  const handleClick = async (id: string, link?: string | null) => {
    await markRead(id);
    if (link) { router.push(link); setOpen(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`通知${unreadCount > 0 ? `（${unreadCount} 条未读）` : ''}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5ecf4] bg-white text-[#064ea2] transition hover:border-[#bfdbfe] hover:bg-[#eff6ff]"
      >
        <Bell size={16} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e74c3c] px-1 text-[10px] font-extrabold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="modal-content absolute right-0 top-11 z-50 w-[380px] overflow-hidden rounded-2xl border border-[#e5ecf4] bg-white shadow-[0_18px_60px_rgba(15,47,87,0.16)]">
          <div className="flex items-center justify-between border-b border-[#eef3f8] px-4 py-3">
            <span className="text-sm font-extrabold text-[#18243a]">通知</span>
            <button onClick={markAllRead} className="text-xs font-bold text-[#064ea2] hover:underline">全部已读</button>
          </div>
          <div className="flex border-b border-[#e5ecf4]">
            {(['todo', 'all'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`relative flex-1 px-4 py-2.5 text-xs font-extrabold transition ${tab === t ? 'text-[#064ea2]' : 'text-[#5a6d8a] hover:text-[#18243a]'}`}>
                {t === 'todo' ? `待办 ${todoItems.length}` : '全部'}
                {tab === t && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[#064ea2]" />}
              </button>
            ))}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#8a99ad]">
                {tab === 'todo' ? <><Check size={20} className="mx-auto mb-2 text-[#11a874]" />今日待办已清零</> : '暂无通知'}
              </div>
            ) : items.map((n) => {
              const meta = getNotificationMeta(n.type);
              const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
              const tone = statusTone[meta.tone] ?? statusTone.gray;
              return (
                <button key={n.id} onClick={() => handleClick(n.id, n.link)}
                  className={`flex w-full items-start gap-2.5 border-b border-[#eef3f8] px-4 py-3 text-left transition hover:bg-[#f8fafc] ${!n.isRead ? 'bg-[#f0f7ff]' : ''} ${n.resolvedAt ? 'opacity-50' : ''}`}>
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ color: tone.color, backgroundColor: tone.bg }}><Icon size={13} strokeWidth={2} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-[#18243a]">{n.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[#5a6d8a]">{n.content}</span>
                    <span className="mt-1 block text-[10px] text-[#8a99ad]">{relTime(n.createdAt)}{meta.actionable && n.link && !n.resolvedAt && <span className="ml-2 font-bold text-[#064ea2]">去处理 →</span>}</span>
                  </span>
                  {!n.isRead && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#064ea2]" />}
                </button>
              );
            })}
          </div>
          <button onClick={() => { router.push('/notifications'); setOpen(false); }}
            className="block w-full border-t border-[#eef3f8] py-2.5 text-center text-xs font-bold text-[#064ea2] hover:bg-[#f8fafc]">查看全部通知 →</button>
        </div>
      )}
    </div>
  );
}
