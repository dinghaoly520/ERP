'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
}: UnifiedHeaderProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [placeholderKey, setPlaceholderKey] = useState(0);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // 导航菜单状态
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const [aboutMenuPos, setAboutMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [contactMenuPos, setContactMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [searchMenuPos, setSearchMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const menuTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 面板打开时同步计算位置，避免闪动；窗口 resize/scroll 时更新
  useLayoutEffect(() => {
    if (activeMenu === 'about') {
      const calc = () => {
        if (!aboutRef.current) return;
        const r = aboutRef.current.getBoundingClientRect();
        setAboutMenuPos({ top: r.bottom, left: r.left });
      };
      calc();
      window.addEventListener('resize', calc);
      window.addEventListener('scroll', calc, { passive: true });
      return () => {
        window.removeEventListener('resize', calc);
        window.removeEventListener('scroll', calc);
      };
    }
  }, [activeMenu]);

  // 联系我们面板位置
  useLayoutEffect(() => {
    if (activeMenu === 'contact') {
      const calc = () => {
        if (!contactRef.current) return;
        const r = contactRef.current.getBoundingClientRect();
        setContactMenuPos({ top: r.bottom, left: r.left });
      };
      calc();
      window.addEventListener('resize', calc);
      window.addEventListener('scroll', calc, { passive: true });
      return () => {
        window.removeEventListener('resize', calc);
        window.removeEventListener('scroll', calc);
      };
    }
  }, [activeMenu]);

  // 搜索下拉面板位置
  useLayoutEffect(() => {
    if (showDropdown) {
      const calc = () => {
        if (!containerRef.current) return;
        const r = containerRef.current.getBoundingClientRect();
        setSearchMenuPos({ top: r.bottom + 6, left: r.left, width: r.width });
      };
      calc();
      window.addEventListener('resize', calc);
      window.addEventListener('scroll', calc, { passive: true });
      return () => {
        window.removeEventListener('resize', calc);
        window.removeEventListener('scroll', calc);
      };
    }
  }, [showDropdown]);
  const handleMenuEnter = (menu: string) => {
    if (menuTimeout.current) { clearTimeout(menuTimeout.current); menuTimeout.current = null; }
    setActiveMenu(menu);
  };
  const handleMenuLeave = () => {
    menuTimeout.current = setTimeout(() => setActiveMenu(null), 160);
  };

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
    <header className="sticky top-0 z-50 flow-header-bg" style={{ willChange: 'transform' }}>
      {/* 底部动态光影线 — 青色调 */}
      <div className="absolute bottom-0 left-0 right-0 h-px z-30" style={{
        background: 'linear-gradient(90deg, transparent 0%, #9ec5f0 20%, #6090d8 40%, #88b8f0 50%, #6090d8 60%, #9ec5f0 80%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'header-edge-flow 4s ease-in-out infinite',
      }} />
      <div className="relative">
        <div className="absolute inset-0 bg-transparent" />
        <FluidHeader />
        <div className="relative z-10 flex h-[68px] items-center px-[clamp(16px,4vw,48px)]">
        {/* ── 左侧：品牌 ── */}
        <div className="flex flex-1 items-center">
          <a href={portalURL('assistant')} className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="四川水发集团" className="h-[45px] w-auto object-contain" />
            <div className="flex flex-col gap-0">
              <strong
                className="whitespace-nowrap text-[27px] font-black leading-tight tracking-[0.10em] text-[#072e30]"
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
                ? 'shadow-[0_4px_20px_rgba(37,99,235,.10),0_0_0_4px_rgba(37,99,235,.04)]'
                : 'shadow-none hover:shadow-[0_4px_16px_rgba(37,99,235,.06),0_0_0_2px_rgba(37,99,235,.02)]'
            }`}
            style={{
              backgroundImage: showDropdown
                ? 'linear-gradient(110deg, #b8d4f4, #3b82f6 20%, #2563eb 40%, #1d4ed8 60%, #2563eb 80%, #b8d4f4)'
                : 'linear-gradient(110deg, #dce4f4 0%, #c8d6ec 20%, #bcd0e8 40%, #cbdaee 60%, #d3e0f2 80%, #dce4f4 100%)',
              backgroundSize: '300% 100%',
              animation: `search-border-flow ${showDropdown ? '2.2s' : '6s'} ease-in-out infinite`,
            }}
          >
            {/* 内层：白色容器 */}
            <div className={`flex items-center rounded-[7px] transition-colors duration-300 ${showDropdown ? 'bg-[oklch(1,0,0/0.6)]' : 'bg-[oklch(1,0,0/0.35)]'}`}>
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
                  ? 'bg-gradient-to-r from-[#3b82f6] to-[#2563eb] text-white shadow-[0_1px_3px_rgba(37,99,235,.15)] hover:shadow-[0_2px_8px_rgba(37,99,235,.25)] hover:from-[#2563eb] hover:to-[#1d4ed8]'
                  : 'bg-[#e9ecf2] text-[#5a6d8a] hover:bg-[#dde1e8] hover:text-[#18243a]'
              }`}
            >
              {/* 辉光环 — 按钮居中脉冲扩散 */}
              <span
                className="pointer-events-none absolute inset-0 rounded-[inherit]"
                style={{
                  background: 'radial-gradient(circle at center, rgba(37,99,235,0.18) 0%, transparent 70%)',
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

          {/* ── 搜索下拉面板 — Portal 到 body ── */}
          {showDropdown && mounted && createPortal(
            <div
              className="fixed overflow-hidden rounded-lg bg-[#f2f4f6] shadow-[0_12px_40px_rgba(15,35,65,.08)] z-[9999]"
              style={{ top: searchMenuPos.top, left: searchMenuPos.left, width: searchMenuPos.width }}
            >
              <div className="flex items-center gap-2 border-b border-[#dde1e8] px-4 py-2">
                <span className="text-[11px] font-semibold text-[#5a6d8a]">{hasInput ? `搜索「${trimmed}」` : '最近搜索'}</span>
                {hasInput && <span className="text-[11px] text-[#94a3b8]">{results.length} 条结果</span>}
              </div>

              {hasInput ? (
                results.length > 0 ? (
                  <ul className="py-1" role="listbox">
                    {results.map((item, idx) => (
                      <li key={item.id} role="option" aria-selected={idx === selectedIdx}>
                        <button
                          type="button" onClick={() => goToDetail(item.id)} onMouseEnter={() => setSelectedIdx(idx)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${idx === selectedIdx ? 'bg-[#e8ebf0]' : 'hover:bg-[#e8ebf0]'}`}
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
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition ${idx === selectedIdx ? 'bg-[#e8ebf0]' : 'text-[#24364f] hover:bg-[#e8ebf0]'}`}>
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
            </div>,
            document.body,
          )}
        </div>

        {/* 右侧：导航菜单 */}
        <div className="flex flex-1 items-center justify-end">
          {/* ── 集团简介 ── */}
          <div
            ref={aboutRef}
            className="relative"
            onMouseEnter={() => handleMenuEnter('about')}
            onMouseLeave={handleMenuLeave}
          >
            <button
              className="flex items-center gap-1 px-4 py-2 text-[14px] font-semibold tracking-wide text-[#072e30] hover:text-[#0d9488] transition-colors duration-200 whitespace-nowrap"
              aria-expanded={activeMenu === 'about'}
            >
              集团简介
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`mt-px transition-transform duration-300 ${activeMenu === 'about' ? 'rotate-180 text-[#0891a0]' : 'text-[#b0bcc9]'}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* 下拉面板 — Portal 到 body 以越过 header 层叠上下文 */}
            {activeMenu === 'about' && mounted && createPortal(
              <div
                className="fixed min-w-[140px] rounded-lg bg-[#f2f4f6] py-1 shadow-[0_12px_40px_rgba(15,35,65,.08)] z-[9999]"
                style={{ top: aboutMenuPos.top, left: aboutMenuPos.left }}
              >
                <a href="/about" target="_blank" rel="noopener noreferrer"
                  className="block px-4 py-2 text-[13px] font-medium text-[#18243a] hover:bg-[#e8ebf0] hover:text-[#0891a0] transition-colors duration-150 text-center"
                >
                  集团概况
                </a>
                <a href="https://www.scsfjt.com/" target="_blank" rel="noopener noreferrer"
                  className="block px-4 py-2 text-[13px] font-medium text-[#18243a] hover:bg-[#e8ebf0] hover:text-[#0891a0] transition-colors duration-150 text-center"
                >
                  集团官网
                </a>
              </div>,
              document.body,
            )}
          </div>

          {/* ── 联系我们 ── */}
          <div
            ref={contactRef}
            className="relative"
            onMouseEnter={() => handleMenuEnter('contact')}
            onMouseLeave={handleMenuLeave}
          >
            <button
              className="flex items-center gap-1 px-4 py-2 text-[14px] font-semibold tracking-wide text-[#072e30] hover:text-[#0d9488] transition-colors duration-200 whitespace-nowrap"
              aria-expanded={activeMenu === 'contact'}
            >
              联系我们
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`mt-px transition-transform duration-300 ${activeMenu === 'contact' ? 'rotate-180 text-[#0891a0]' : 'text-[#b0bcc9]'}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* 下拉面板 — Portal 到 body */}
            {activeMenu === 'contact' && mounted && createPortal(
              <div
                className="fixed min-w-[140px] rounded-lg bg-[#f2f4f6] py-1 shadow-[0_12px_40px_rgba(15,35,65,.08)] z-[9999]"
                style={{ top: contactMenuPos.top, left: contactMenuPos.left }}
              >
                <a href="/contact"
                  className="block px-4 py-2 text-[13px] font-medium text-[#18243a] hover:bg-[#e8ebf0] hover:text-[#0891a0] transition-colors duration-150 text-center"
                >
                  联系方式
                </a>
                <a href="/contact/visitor"
                  className="block px-4 py-2 text-[13px] font-medium text-[#18243a] hover:bg-[#e8ebf0] hover:text-[#0891a0] transition-colors duration-150 text-center"
                >
                  来访接待
                </a>
              </div>,
              document.body,
            )}
          </div>
        </div>
      </div>
      </div>
    </header>
  );
}
