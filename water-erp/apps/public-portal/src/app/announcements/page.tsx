'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Megaphone, Search } from 'lucide-react';
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

  // ── KPI 统计（公众端口径：全部/采购/中标精确 total；本月发布按全部前 100 条过滤，月量超 100 时为下限值）──
  const [stats, setStats] = useState({ all: 0, bid: 0, win: 0, month: 0 });
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchPublicAnnouncements({ pageSize: 1 }),
      fetchPublicAnnouncements({ type: 'BID_NOTICE', pageSize: 1 }),
      fetchPublicAnnouncements({ type: 'WIN_BID_NOTICE', pageSize: 1 }),
      fetchPublicAnnouncements({ type: 'PRE_WIN_NOTICE', pageSize: 1 }),
      fetchPublicAnnouncements({ pageSize: 100 }),
    ]).then(([allR, bidR, winR, preR, monthR]) => {
      if (cancelled) return;
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const month = monthR.items.filter(a => new Date(`${a.date}T00:00:00`).getTime() >= monthStart.getTime()).length;
      setStats({ all: allR.total, bid: bidR.total, win: winR.total + preR.total, month });
    }).catch(() => { /* KPI 静默降级为 0，不阻塞列表 */ });
    return () => { cancelled = true; };
  }, []);

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
        {/* ═══ 页面标题卡（复刻 :3005 公告发布中心：hero + 下横线 + KPI 瓷片行）═══ */}
        <div className="page-hero mb-4">
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon"><Megaphone size={17} strokeWidth={1.9} /></div>
              <div>
                <div className="page-hero__title">信息公告</div>
                <div className="page-hero__sub">采购公告、中标公告、政策法规与平台通知的公开发布</div>
              </div>
            </div>
          </div>
          <div className="page-hero__divider" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">
            {([
              ['全部公告', stats.all, '公开发布'],
              ['采购公告', stats.bid, '招标信息'],
              ['中标公告', stats.win, '成交结果'],
              ['本月发布', stats.month, '本月新增公告'],
            ] as const).map(([label, value, sub]) => (
              <div key={label} className="kpi-card flex h-full flex-col gap-1.5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-2)] leading-none">{label}</span>
                <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--ink)]">{value}</span>
                <span className="min-h-[14px] text-[10px] font-medium text-[var(--fg-2)] leading-tight">{sub}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ 工具行：类型分段切换（左）+ 搜索（右，固定 280px）═══ */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div
            className="neu-segment"
            role="group"
            aria-label="公告类型"
            data-count="8"
            data-index={String(ANNOUNCEMENT_TABS.findIndex(t => t.key === type))}
          >
            <span className="neu-segment-thumb" aria-hidden="true" />
            {ANNOUNCEMENT_TABS.map(tab => (
              <button key={tab.key} onClick={() => setType(tab.key)}
                className="neu-segment-btn"
                aria-pressed={tab.key === type}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative ml-auto shrink-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a96aa]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索公告标题..."
              className="w-[280px] h-9 pl-9 pr-3 bg-white border border-[#d0dae8] rounded-[10px] text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]" />
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
