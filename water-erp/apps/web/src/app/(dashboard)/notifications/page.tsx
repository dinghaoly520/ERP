'use client';
import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta } from '@water-erp/shared';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '@/lib/api/notification';
import { PageHero } from '@/components/workbench';
import { statusTone } from '@water-erp/shared';

export default function NotificationsPage() {
  const [tab, setTab] = useState<'todo' | 'all'>('todo');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listNotifications(tab, page, 20).then((r) => { setItems(r.items); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [tab, page]);

  const totalPages = Math.ceil(total / 20);

  const onRead = async (id: string) => { await markNotificationRead(id); setItems((xs) => xs.map((n) => (n.id === id ? { ...n, isRead: true } : n))); };
  const onAllRead = async () => { await markAllNotificationsRead(); setItems((xs) => xs.map((n) => ({ ...n, isRead: true }))); };

  return (
    <div className="space-y-6">
      <PageHero title="通知中心" description="全部站内通知与待办。支持按「待办/全部」查看、标记已读。" tone="blue" icon={<Bell size={14} />} />
      <div className="flex items-center justify-between">
        <div className="flex gap-2 border-b border-[#e5ecf4]">
          {(['todo', 'all'] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setPage(1); }} className={`relative px-4 py-2 text-sm font-extrabold transition ${tab === t ? 'text-[#064ea2]' : 'text-[#5a6d8a] hover:text-[#18243a]'}`}>
              {t === 'todo' ? '待办' : '全部'}
              {tab === t && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[#064ea2]" />}
            </button>
          ))}
        </div>
        <button onClick={onAllRead} className="rounded-xl border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc]">全部已读</button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e5ecf4] bg-white">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#8a99ad]">加载中...</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center"><Check size={24} className="mx-auto mb-2 text-[#11a874]" /><p className="text-sm font-bold text-[#18243a]">{tab === 'todo' ? '待办已清零' : '暂无通知'}</p></div>
        ) : items.map((n) => {
          const meta = getNotificationMeta(n.type);
          const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
          const tone = statusTone[meta.tone] ?? statusTone.gray;
          return (
            <button key={n.id} onClick={() => onRead(n.id)} className={`flex w-full items-start gap-3 border-b border-[#eef3f8] px-5 py-4 text-left transition hover:bg-[#f8fafc] ${!n.isRead ? 'bg-[#f0f7ff]' : ''} ${n.resolvedAt ? 'opacity-50' : ''}`}>
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ color: tone.color, backgroundColor: tone.bg }}><Icon size={15} strokeWidth={1.8} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-sm font-bold text-[#18243a]">{n.title}</span>{n.resolvedAt && <span className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] font-bold text-[#8a99ad]">已处理</span>}</div>
                <div className="mt-0.5 text-xs text-[#5a6d8a]">{n.content}</div>
                <div className="mt-1 text-[11px] text-[#8a99ad]">{new Date(n.createdAt).toLocaleString('zh-CN')}{n.link && <span className="ml-2 font-bold text-[#064ea2]">查看 →</span>}</div>
              </div>
              {!n.isRead && <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#064ea2]" />}
            </button>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#8a99ad]">共 {total} 条，第 {page}/{totalPages} 页</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-[#e5ecf4] px-3 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-40">上一页</button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-[#e5ecf4] px-3 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-40">下一页</button>
          </div>
        </div>
      )}
    </div>
  );
}
