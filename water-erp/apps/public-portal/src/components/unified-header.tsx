'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AnnouncementItem } from '@/lib/announcements';
import { portalURL } from '@water-erp/config';
import FluidHeader from '@/components/fluid-header';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   统一顶栏 — 品牌 + 公告搜索 + 登录注册
   搜索仅匹配首页已加载的公告数据（标题/编号），
   结果在下拉中即时展示，点击跳转详情页。
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface UnifiedHeaderProps {
  announcements: AnnouncementItem[];
  onLoginClick: () => void;
  onRegisterClick: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  BID_NOTICE: '招标公告',
  WIN_NOTICE: '中标公示',
  POLICY: '政策法规',
  PLATFORM: '平台通知',
};

const PLACEHOLDERS = [
  '搜索公告标题、编号…',
  '试试搜索「招标公告」或「中标公示」…',
];

const PLACEHOLDER_INTERVAL = 4000;

export function UnifiedHeader({
  announcements,
  onLoginClick,
  onRegisterClick,
}: UnifiedHeaderProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [placeholderKey, setPlaceholderKey] = useState(0);

  // 最近搜索历史
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    try {
      const s = localStorage.getItem('public_search_history');
      if (s) setHistory(JSON.parse(s).slice(0, 4));
    } catch { /* ignore */ }
  }, []);

  const pushHistory = useCallback((q: string) => {
    const t = q.trim();
    if (!t) return;
    setHistory((prev) => {
      const next = [t, ...prev.filter((h) => h !== t)].slice(0, 4);
      try { localStorage.setItem('public_search_history', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // placeholder 轮播
  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length);
      setPlaceholderKey((k) => k + 1);
    }, PLACEHOLDER_INTERVAL);
    return () => clearInterval(t);
  }, []);

  // 快捷键 / 聚焦
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        const a = document.activeElement;
        if (!a || a === document.body || (a as HTMLElement).tagName === 'BODY') {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const trimmed = query.trim().toLowerCase();

  // 客户端搜索：仅匹配公告标题、编号
  const results = useMemo(() => {
    if (!trimmed) return [];
    return announcements
      .filter((a) => a.title.toLowerCase().includes(trimmed) || a.code.toLowerCase().includes(trimmed))
      .slice(0, 8);
  }, [announcements, trimmed]);

  const hasInput = trimmed.length > 0;

  const executeSearch = useCallback(
    (term: string) => {
      const t = term.trim();
      if (!t) return;
      pushHistory(t);
      setShowDropdown(false);
      setQuery('');
      router.push(`/announcements?search=${encodeURIComponent(t)}`);
    },
    [router, pushHistory],
  );

  const goToDetail = useCallback(
    (id: string) => {
      pushHistory(query);
      setShowDropdown(false);
      setQuery('');
      router.push(`/announcements/${id}`);
    },
    [router, pushHistory, query],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const list = hasInput ? results : history.map((h) => ({ text: h, type: 'history' as const }));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((p) => (p < list.length - 1 ? p + 1 : 0));
      setShowDropdown(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((p) => (p > 0 ? p - 1 : list.length - 1));
      setShowDropdown(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && showDropdown) {
        if (hasInput) {
          goToDetail(results[selectedIdx].id);
        } else {
          executeSearch(history[selectedIdx]);
        }
        setSelectedIdx(-1);
      } else {
        executeSearch(query);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSelectedIdx(-1);
      inputRef.current?.blur();
    }
  };

  const placeholder = PLACEHOLDERS[placeholderIdx];

  return (
    <header className="sticky top-0 z-50 border-b border-[#e5ecf4] bg-white" style={{ willChange: 'transform' }}>
      <div className="relative">
        <div className="absolute inset-0 bg-white" />
        <FluidHeader />
        <div className="relative z-10 flex h-[68px] items-center px-[clamp(16px,4vw,48px)]">
        {/* ── 左侧：品牌 ── */}
        <div className="flex flex-1 items-center">
          <a href={portalURL('assistant')} className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="四川水发集团" className="h-[45px] w-auto object-contain" />
            <div className="flex flex-col gap-0">
              <strong
                className="whitespace-nowrap text-[27px] font-black leading-tight tracking-[0.10em] text-[#123a6e]"
                style={{ fontFamily: '"SimHei","黑体","Heiti SC","STHeiti",sans-serif', textShadow: '0 0 0.5px #123a6e' }}
              >
                四川水发集团
              </strong>
              <small className="whitespace-nowrap text-[7px] font-medium tracking-wide text-[#8a96aa]">
                SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.
              </small>
            </div>
          </a>
        </div>

        {/* ── 中间：搜索栏 ── */}
        <div ref={containerRef} className="relative w-full max-w-[480px] shrink-0 px-4">
          {/* 外层：流动光影边框 — 始终流动，聚焦时加速并增强色彩 */}
          <div
            className={`rounded-lg p-[1px] ${
              showDropdown
                ? 'shadow-[0_4px_20px_rgba(6,78,162,.10),0_0_0_4px_rgba(6,78,162,.04)]'
                : 'shadow-none hover:shadow-[0_4px_16px_rgba(6,78,162,.06),0_0_0_2px_rgba(6,78,162,.02)]'
            }`}
            style={{
              backgroundImage: showDropdown
                ? 'linear-gradient(110deg, #bfd5ee, #064ea2 20%, #0b63ce 40%, #0891b2 60%, #0b63ce 80%, #bfd5ee)'
                : 'linear-gradient(110deg, #dce3eb 0%, #c8d6e6 20%, #bccbde 40%, #cbd5e1 60%, #d3dce8 80%, #dce3eb 100%)',
              backgroundSize: '300% 100%',
              animation: `search-border-flow ${showDropdown ? '2.2s' : '6s'} ease-in-out infinite`,
            }}
          >
            {/* 内层：白色容器 */}
            <div className={`flex items-center rounded-[7px] bg-white transition-colors duration-300 ${showDropdown ? '' : 'bg-[#fafbfc]'}`}>
            {/* 搜索图标 — 始终呼吸，聚焦时加速 */}
            <span
              className={`shrink-0 pl-3.5 transition-all duration-300 ${
                showDropdown ? 'text-[#5a6d8a] scale-95' : 'text-[#94a3b8]'
              }`}
              style={{ animation: `search-icon-breathe ${showDropdown ? '1.6s' : '2.8s'} ease-in-out infinite` }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
            </span>

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); setSelectedIdx(-1); }}
              onFocus={() => setShowDropdown(true)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              key={placeholderKey}
              className="h-8 min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-[#18243a] outline-none focus:outline-none focus:ring-0 placeholder:text-[#94a3b8] animate-placeholder-in"
              style={{ outline: 'none', boxShadow: 'none', WebkitAppearance: 'none' }}
              spellCheck={false}
              aria-label="搜索公告（按 / 聚焦）"
            />

            {/* 清除 — 弹性缩放入场 + 悬停旋转 */}
            {hasInput && (
              <button
                type="button"
                onClick={() => { setQuery(''); setSelectedIdx(-1); inputRef.current?.focus(); }}
                className="mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#b0bcc9] transition-all duration-200 hover:rotate-90 hover:bg-[#eef1f6] hover:text-[#5a6d8a] animate-[scaleIn_150ms_ease-out]"
                aria-label="清空输入"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 1l10 10M11 1L1 11" /></svg>
              </button>
            )}

            {/* 搜索按钮 — 微光脉冲 + glow 径向扩散 + hover 流光爆发 */}
            <button
              type="button"
              onClick={() => executeSearch(query)}
              className={`group relative h-8 shrink-0 overflow-hidden rounded-r-[7px] text-xs font-bold transition-all duration-300 active:scale-95 ${
                hasInput
                  ? 'bg-gradient-to-r from-[#064ea2] to-[#0b63ce] text-white shadow-[0_1px_3px_rgba(6,78,162,.15)] hover:shadow-[0_2px_8px_rgba(6,78,162,.25)] hover:from-[#05428a] hover:to-[#0a56b3]'
                  : 'bg-[#e9ecf2] text-[#5a6d8a] hover:bg-[#dde1e8] hover:text-[#18243a]'
              }`}
            >
              {/* 辉光环 — 按钮居中脉冲扩散 */}
              <span
                className="pointer-events-none absolute inset-0 rounded-[inherit]"
                style={{
                  background: 'radial-gradient(circle at center, rgba(6,78,162,0.18) 0%, transparent 70%)',
                  animation: 'dingdang-breathe 2.2s ease-in-out infinite',
                }}
                aria-hidden="true"
              />
              {/* 表面细流光 — 始终慢扫，hover 加速 */}
              <span
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                style={{
                  backgroundSize: '300% 100%',
                  animation: `search-btn-shimmer ${showDropdown ? '1.5s' : '4s'} ease-in-out infinite`,
                }}
                aria-hidden="true"
              />
              <span className="relative z-[1] px-3.5">搜索</span>
            </button>
            </div>
          </div>

          {/* ── 下拉面板 ── */}
          {showDropdown && (
            <div className="absolute left-4 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-[#e5ecf4] bg-white shadow-[0_12px_40px_rgba(15,35,65,.10)] animate-[dropdown-slide-in_200ms_ease-out]">
              <div className="flex items-center gap-2 border-b border-[#eef2f8] px-4 py-2">
                <span className="text-[11px] font-semibold text-[#94a3b8]">{hasInput ? `搜索「${trimmed}」` : '最近搜索'}</span>
                {hasInput && <span className="text-[11px] text-[#c0c9d4]">{results.length} 条结果</span>}
              </div>

              {hasInput ? (
                results.length > 0 ? (
                  <ul className="py-1" role="listbox">
                    {results.map((item, idx) => (
                      <li key={item.id} role="option" aria-selected={idx === selectedIdx}>
                        <button
                          type="button" onClick={() => goToDetail(item.id)} onMouseEnter={() => setSelectedIdx(idx)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${idx === selectedIdx ? 'bg-[#f5f7fa]' : 'hover:bg-[#f8fafb]'}`}
                        >
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: item.color, backgroundColor: `${item.color}14` }}>{TYPE_LABEL[item.type] || item.tag}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#18243a]">{item.title}</span>
                          <span className="shrink-0 text-xs text-[#bcc6d4] font-mono">{item.code}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-[#94a3b8]">
                    <p className="mb-2">未找到匹配的公告</p>
                    <button type="button" onClick={() => executeSearch(query)} className="text-xs font-bold text-[#5a6d8a] hover:text-[#18243a] hover:underline">前往公告页搜索「{trimmed}」→</button>
                  </div>
                )
              ) : (
                history.length > 0 ? (
                  <ul className="py-1" role="listbox">
                    {history.map((h, idx) => (
                      <li key={h} role="option" aria-selected={idx === selectedIdx}>
                        <button type="button" onClick={() => executeSearch(h)} onMouseEnter={() => setSelectedIdx(idx)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition ${idx === selectedIdx ? 'bg-[#f5f7fa]' : 'text-[#24364f] hover:bg-[#f8fafb]'}`}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#bcc6d4]"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                          <span className="flex-1 truncate text-left">{h}</span>
                          <span className="text-[10px] text-[#bcc6d4]">历史</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-4 py-6 text-center text-xs text-[#94a3b8]">输入公告标题或编号进行搜索</div>
                )
              )}
            </div>
          )}
        </div>

        {/* ── 右侧：登录/注册 ── */}
        <div className="flex flex-1 items-center justify-end gap-3">
          <button
            onClick={onLoginClick}
            className="group relative h-9 rounded-full border border-[#c5d3e8] bg-white px-6 text-sm font-semibold text-[#064ea2] transition-all duration-300 hover:-translate-y-px hover:border-[#064ea2] hover:bg-gradient-to-b hover:from-white hover:to-[#f5f9ff] hover:text-[#064ea2] hover:shadow-[0_4px_14px_rgba(6,78,162,.18)] active:translate-y-0 active:scale-[0.98]"
          >
            登录
          </button>
          <button
            onClick={onRegisterClick}
            className="group relative h-9 overflow-hidden rounded-full bg-gradient-to-r from-[#064ea2] to-[#0b63ce] px-6 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(6,78,162,.30)] hover:from-[#05428a] hover:to-[#0957b8] active:translate-y-0 active:scale-[0.98]"
          >
            <span className="relative z-[1]">注册</span>
          </button>
        </div>
      </div>
      </div>
    </header>
  );
}
