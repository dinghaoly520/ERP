'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, ChevronDown, Eye, Megaphone, Search } from 'lucide-react';
import { fetchPublicAnnouncements, ANNOUNCEMENT_TABS, type AnnouncementItem } from '@/lib/announcements';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/** 浏览量人性化：≥1万折「万」保留一位小数（整数不带小数点），以下原样 */
function formatViews(n: number): string {
  if (n < 10000) return String(n);
  const w = n / 10000;
  return `${w % 1 === 0 ? w.toFixed(0) : w.toFixed(1)}万`;
}

/** 公告卡右上角浏览量徽标 */
function ViewsBadge({ count }: { count: number }) {
  return (
    <span className="announce-views" title="浏览量" aria-label={`浏览量 ${count}`}>
      <Eye size={13} strokeWidth={1.8} />
      {formatViews(count)}
    </span>
  );
}

function AnnouncementsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [type, setType] = useState('');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') || '');
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  /** 公司筛选项 — 从已拉取公告的发布单位动态去重（当前 4 家，原生 select 足够） */
  const companyOptions = useMemo(
    () => [...new Set(items.map(a => a.companyName).filter(Boolean))].sort(),
    [items]);
  /** 公司筛选为客户端精确匹配（数据量级=单页全量拉取，与服务端搜索互补） */
  const visibleItems = useMemo(
    () => (company ? items.filter(a => a.companyName === company) : items),
    [items, company]);

  // 同步 URL 参数到搜索框（顶栏 Enter / 外部跳转进入）
  useEffect(() => {
    const q = searchParams.get('search') || '';
    setSearch(q);
    setSearchInput(q);
  }, [searchParams]);

  // 输入防抖 300ms 再触发查询（服务端全库搜索：标题/正文/项目编号）
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    fetchPublicAnnouncements({ type: type || undefined, search: search || undefined, pageSize: 100 })
      .then(data => { if (!cancelled) setItems(data.items); })
      .catch(() => {
        // 2026-11-05 修复：API 失败不再回落本地 mock 假公告（虚构采购公告比报错更糟，
        // 违反仓库 No mock data fallbacks 约定）——改显式错误态 + 重试
        if (!cancelled) {
          setItems([]);
          setLoadFailed(true);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, search, reloadTick]);

  return (
    <div className="flow-page" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader />

      {/* ═══ 内容区 — 全宽与首页对齐 ═══ */}
      <div className="relative z-10 px-[clamp(40px,4vw,72px)] pt-3 pb-10">
        <a href="/" className="flow-back mb-8">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
          返回首页
        </a>
        {/* ═══ 页面标题卡（复刻 :3005 公告发布中心：hero + 下横线）═══ */}
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
        </div>

        {/* ═══ 工具行：公司筛选（最左，2026-11-06 用户裁定）+ 类型分段切换 + 搜索（右）═══ */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          {/* 公司筛选 — 发布单位动态去重；原生 select（≤8 项分型规则）。
              appearance-none 去原生箭头与焦点蓝环，聚焦内凹与搜索框同语言 */}
          <div className="relative shrink-0">
            <select
              value={company}
              onChange={e => setCompany(e.target.value)}
              aria-label="按发布单位筛选"
              className="peer h-10 w-[260px] max-w-[60vw] cursor-pointer appearance-none rounded-xl border border-[#dbe4ef] bg-[oklch(1_0_0/0.6)] pl-10 pr-9 text-sm text-[#18243a] transition-all
                shadow-[inset_0_1px_0_oklch(1_0_0/0.8),1px_1px_3px_oklch(0.55_0.03_258/0.08)]
                focus:border-[#cfd9e6]
                focus:shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.12),inset_-1px_-1px_2px_oklch(1_0_0/0.9)]">
              <option value="">全部单位</option>
              {companyOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Building2 size={15} strokeWidth={1.8}
              className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${company ? 'text-[#5a6d8a]' : 'text-[#9aa8ba] peer-focus:text-[#5a6d8a]'}`} />
            <ChevronDown size={14} strokeWidth={2}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#9aa8ba] transition-all duration-200 peer-focus:translate-y-[-55%] peer-focus:text-[#5a6d8a]" />
          </div>
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

          {/* ═══ 搜索框（2026-10-22 重设计）：玻璃瓷片质感，聚焦内凹（无蓝色框线）═══
              凸起（方向性双影）→ 聚焦内凹（与 neu-segment/瓷片同语言）；图标随聚焦加深；有输入显清空钮 */}
          <div className="relative ml-auto shrink-0">
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="搜索公告标题、项目编号…"
              aria-label="搜索公告"
              className="announce-search peer h-10 w-[280px] rounded-xl border border-[#dbe4ef] bg-[oklch(1_0_0/0.6)] pl-10 pr-9 text-sm text-[#18243a] transition-all placeholder:text-[#b6c0cf]
                shadow-[inset_0_1px_0_oklch(1_0_0/0.8),1px_1px_3px_oklch(0.55_0.03_258/0.08)]
                focus:outline-none focus:border-[#cfd9e6]
                focus:shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.12),inset_-1px_-1px_2px_oklch(1_0_0/0.9)]" />
            <Search size={15} strokeWidth={1.8}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9aa8ba] transition-colors peer-focus:text-[#5a6d8a]" />
            {searchInput && (
              <button type="button" onClick={() => setSearchInput('')} aria-label="清空搜索"
                className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[#b0bcc9] transition-all duration-200 hover:rotate-90 hover:bg-[#eef1f6] hover:text-[#5a6d8a]">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 1l10 10M11 1L1 11" /></svg>
              </button>
            )}
          </div>
        </div>

        {/* 列表 */}
        {loading ? (
          <div className="glass rounded-2xl p-16 text-center">
            <div className="text-5xl mb-4">⏳</div>
            <p className="text-[#5a6d8a] font-semibold">正在加载公告...</p>
          </div>
        ) : loadFailed ? (
          <div className="glass rounded-2xl p-16 text-center flex flex-col items-center gap-3">
            <div className="text-5xl mb-1">⚠️</div>
            <p className="text-[#5a6d8a] font-semibold">公告加载失败</p>
            <p className="text-xs text-[#8a96aa]">网络或服务暂时不可用，请稍后重试</p>
            <button onClick={() => setReloadTick(t => t + 1)} className="neu-btn-soft">重新加载</button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="glass rounded-2xl p-16 text-center">
            <div className="text-5xl mb-4">📢</div>
            <p className="text-[#5a6d8a] font-semibold mb-1">暂无相关公告</p>
            <p className="text-xs text-[#8a96aa]">试试切换分类、筛选发布单位或调整搜索关键词</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleItems.map(a => a.titleOnly ? (
              /* 已下线标题壳（2026-09-26 v2；2026-10-20 改可点）：详情为「公示期已过/已下线」提示页 */
              <div key={a.id} onClick={() => router.push(`/announcements/${a.id}`)}
                className="glass rounded-2xl p-5 hover:shadow-md transition-all cursor-pointer opacity-80">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ color: a.color, backgroundColor: a.color + '18' }}>{a.tag}</span>
                  <span className="text-xs bg-[#eef1f6] text-[#8a96aa] px-2 py-0.5 rounded-full font-bold">{a.offlinedReason === 'PUBLICITY_ENDED' ? '公示期满' : '已下线'}</span>
                  <span className="text-[15px] font-bold text-[#8a96aa] flex-1 truncate">{a.title}</span>
                  <ViewsBadge count={a.viewCount ?? 0} />
                </div>
                <div className="flex items-center gap-4 text-xs text-[#8a96aa] ml-1">
                  <span>{a.date}</span>
                  {a.companyName && <span>发布单位：{a.companyName}</span>}
                  {a.code && <span>编号：{a.code}</span>}
                </div>
              </div>
            ) : (
              <div key={a.id} onClick={() => router.push(`/announcements/${a.id}`)}
                className="glass rounded-2xl p-5 hover:shadow-md transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ color: a.color, backgroundColor: a.color + '18' }}>{a.tag}</span>
                  {a.urgent && <span className="text-xs bg-[#fff1f0] text-[#d43030] px-2 py-0.5 rounded-full font-bold">重要</span>}
                  <span className="text-[15px] font-bold text-[#18243a] flex-1">{a.title}</span>
                  <ViewsBadge count={a.viewCount ?? 0} />
                </div>
                <p className="text-xs text-[#5a6d8a] ml-1 mb-2 line-clamp-2">{a.desc}</p>
                <div className="flex items-center gap-4 text-xs text-[#8a96aa] ml-1">
                  <span>{a.date}</span>
                  {a.companyName && <span>发布单位：{a.companyName}</span>}
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
