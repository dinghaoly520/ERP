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
    <div className="min-h-screen bg-[#f7f9fc]">
      {/* ═══ Header with brand ═══ */}
      <header className="sticky top-0 z-50 bg-white border-b border-[#e5ecf4]">
        <div className="max-w-5xl mx-auto px-6 h-[72px] flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-11 w-auto rounded-lg object-contain" />
            <div className="flex flex-col gap-0">
              <strong className="text-[#123a6e] text-lg tracking-[0.12em] leading-tight whitespace-nowrap" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川水发集团</strong>
              <small className="text-[7px] text-[#8a96aa] font-medium tracking-wide">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
            </div>
          </a>
          <a href="/" className="text-sm text-[#5a6d8a] hover:text-[#064ea2] font-semibold transition">← 返回首页</a>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#18243a] mb-1">信息公告</h1>
          <p className="text-sm text-[#5a6d8a]">招标公告、中标公示、政策法规、平台通知</p>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-8">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索公告标题" className="flex-1 px-4 py-2.5 bg-white border border-[#e5ecf4] rounded-xl text-sm focus:border-[#064ea2] outline-none" />
          <select value={type} onChange={e => setType(e.target.value)}
            className="px-4 py-2.5 bg-white border border-[#e5ecf4] rounded-xl text-sm focus:border-[#064ea2] outline-none">
            <option value="">全部类型</option>
            {Object.entries(ANNOUNCEMENT_TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-12 text-[#5a6d8a]">加载中...</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e5ecf4] p-12 text-center">
            <div className="text-5xl mb-3">📢</div>
            <p className="text-[#5a6d8a]">暂无公告</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(a => {
              const t = ANNOUNCEMENT_TYPE_MAP[a.type] || ANNOUNCEMENT_TYPE_MAP.PLATFORM;
              return (
                <div key={a.id} onClick={() => router.push(`/announcements/${a.id}`)}
                  className="bg-white rounded-xl border border-[#e5ecf4] p-5 hover:shadow-md hover:border-[#064ea240] transition-all cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs px-2.5 py-1 rounded font-semibold" style={{ color: t.color, backgroundColor: t.bg }}>{t.label}</span>
                    {a.isTop && <span className="text-xs bg-[#fff1f0] text-[#d43030] px-2 py-0.5 rounded font-bold">置顶</span>}
                    <span className="text-sm font-bold text-[#18243a] flex-1">{a.title}</span>
                  </div>
                  {a.summary && <p className="text-xs text-[#5a6d8a] ml-1 mb-2">{a.summary}</p>}
                  <div className="flex items-center gap-4 text-xs text-[#8a96aa] ml-1">
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
