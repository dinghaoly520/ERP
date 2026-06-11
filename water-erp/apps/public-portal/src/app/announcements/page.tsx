'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Announcement } from '@/lib/types';

const ANNOUNCEMENT_TYPE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  BID_NOTICE: { label: '招标公告', color: '#064ea2', bg: '#064ea218' },
  WIN_NOTICE: { label: '中标公示', color: '#11a874', bg: '#11a87418' },
  POLICY: { label: '政策法规', color: '#f5a623', bg: '#f5a62318' },
  PLATFORM: { label: '平台通知', color: '#5a6d8a', bg: '#5a6d8a18' },
};

export default function AnnouncementsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Announcement[]>([]);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (type) query.set('type', type);
    if (search) query.set('search', search);
    query.set('pageSize', '20');
    api.get<{ items: Announcement[] }>(`/announcements/public?${query.toString()}`)
      .then(res => setItems(res.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [type, search]);

  return (
    <div className="min-h-screen bg-[oklch(0.982_0.003_264)]">
      <header className="bg-white shadow-sm border-b border-[oklch(0.91_0.006_264)]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 text-[oklch(0.18_0.012_265)] font-bold hover:text-[#064ea2] transition">
            ← 返回首页
          </a>
          <span className="text-sm text-[oklch(0.55_0.01_264)]">信息公告</span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)] mb-1">信息公告</h1>
        <p className="text-sm text-[oklch(0.55_0.01_264)] mb-8">招标公告、中标公示、政策法规、平台通知</p>

        {/* 筛选 */}
        <div className="flex gap-4 mb-8">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索公告标题" className="flex-1 px-4 py-2.5 bg-white border border-[oklch(0.91_0.006_264)] rounded-xl text-sm focus:border-[#064ea2] outline-none" />
          <select value={type} onChange={e => setType(e.target.value)}
            className="px-4 py-2.5 bg-white border border-[oklch(0.91_0.006_264)] rounded-xl text-sm focus:border-[#064ea2] outline-none">
            <option value="">全部类型</option>
            {Object.entries(ANNOUNCEMENT_TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">加载中...</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center">
            <div className="text-5xl mb-3">📢</div>
            <p className="text-[oklch(0.55_0.01_264)]">暂无公告</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(a => {
              const t = ANNOUNCEMENT_TYPE_MAP[a.type] || ANNOUNCEMENT_TYPE_MAP.PLATFORM;
              return (
                <div key={a.id} onClick={() => router.push(`/announcements/${a.id}`)}
                  className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5 hover:shadow-md hover:border-[oklch(0.80_0.04_258)] transition-all cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ color: t.color, backgroundColor: t.bg }}>{t.label}</span>
                    {a.isTop && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded font-bold">置顶</span>}
                    <span className="text-sm font-bold text-[oklch(0.18_0.012_265)] flex-1">{a.title}</span>
                  </div>
                  {a.summary && <p className="text-xs text-[oklch(0.55_0.01_264)] ml-1 mb-2">{a.summary}</p>}
                  <div className="flex items-center gap-4 text-xs text-[oklch(0.72_0.008_264)] ml-1">
                    <span>{a.publishDate ? new Date(a.publishDate).toLocaleDateString('zh-CN') : ''}</span>
                    <span>浏览 {a.viewCount} 次</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
