'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchPublicAnnouncements, ANNOUNCEMENT_TABS, ANNOUNCEMENTS, type AnnouncementItem } from '@/lib/announcements';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

function AnnouncementsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [type, setType] = useState('');
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 同步 URL 参数到搜索框
  useEffect(() => {
    const q = searchParams.get('search') || '';
    setSearch(q);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPublicAnnouncements({ type: type || undefined, search: search || undefined, pageSize: 100 })
      .then(data => { if (!cancelled) setItems(data.items); })
      .catch(() => {
        // Fallback to local data
        if (!cancelled) {
          const filtered = ANNOUNCEMENTS.filter(a => {
            const matchType = !type || a.type === type;
            const matchSearch = !search || a.title.includes(search) || a.code.includes(search);
            return matchType && matchSearch;
          });
          setItems(filtered);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, search]);

  return (
    <div className="flow-page" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader announcements={items} onLoginClick={() => {}} onRegisterClick={() => {}} />

      {/* ═══ 内容区 — 全宽与首页对齐 ═══ */}
      <div className="relative z-10 px-[clamp(40px,4vw,72px)] pt-3 pb-10">
        <a href="/" className="flow-back mb-8">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
          返回首页
        </a>
        {/* 标题 */}
        <div className="mb-[clamp(28px,3vw,40px)] text-center">
          <h1 className="text-[clamp(28px,3vw,40px)] font-black text-[#18243a] mb-1.5" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>信息公告</h1>
          <p className="text-sm text-[#8a96aa]">采购公告 · 中标公示 · 政策法规 · 平台通知</p>
        </div>

        {/* Tab 切换 + 搜索 */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex gap-2">
            {ANNOUNCEMENT_TABS.map(tab => (
              <button key={tab.key} onClick={() => setType(tab.key)}
                className={`px-4 py-2 text-[13px] font-semibold rounded-full transition-all duration-200 cursor-pointer min-h-[36px] ${
                  tab.key === type
                    ? 'text-white'
                    : 'text-[#5a6d8a] bg-[#e8ecf2] hover:bg-[#dde3ed]'
                }`}
                style={tab.key === type ? { backgroundColor: tab.color || '#064ea2' } : undefined}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索公告标题..."
              className="w-64 h-9 pl-9 pr-3 bg-white border border-[#d0dae8] rounded-full text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]" />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#bbb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>

        {/* 列表 */}
        {loading ? (
          <div className="glass rounded-2xl p-16 text-center">
            <div className="text-5xl mb-4">⏳</div>
            <p className="text-[#5a6d8a] font-semibold">正在加载公告...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="glass rounded-2xl p-16 text-center">
            <div className="text-5xl mb-4">📢</div>
            <p className="text-[#5a6d8a] font-semibold mb-1">暂无相关公告</p>
            <p className="text-xs text-[#8a96aa]">试试切换分类或调整搜索关键词</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map(a => (
              <div key={a.id} onClick={() => router.push(`/announcements/${a.id}`)}
                className="glass rounded-2xl p-5 hover:shadow-md transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ color: a.color, backgroundColor: a.color + '18' }}>{a.tag}</span>
                  {a.urgent && <span className="text-xs bg-[#fff1f0] text-[#d43030] px-2 py-0.5 rounded-full font-bold">重要</span>}
                  <span className="text-[15px] font-bold text-[#18243a] flex-1">{a.title}</span>
                </div>
                <p className="text-xs text-[#5a6d8a] ml-1 mb-2 line-clamp-2">{a.desc}</p>
                <div className="flex items-center gap-4 text-xs text-[#8a96aa] ml-1">
                  <span>{a.date}</span>
                  {a.code && <span>编号：{a.code}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={
      <div className="flow-page flex items-center justify-center">
        <div className="text-[#5a6d8a] font-semibold">加载中...</div>
      </div>
    }>
      <AnnouncementsContent />
    </Suspense>
  );
}
