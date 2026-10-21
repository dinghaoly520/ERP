import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { portalURL } from '@water-erp/config';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   统一顶栏 — 品牌 + 导航菜单
   （2026-10-21 用户裁定：撤下中间公告搜索框及全部搜索机器——
   防抖全库搜索/历史/键盘导航/占位语轮播连同 announcements 兜底 prop 一并移除；
   全库搜索仍可经 /announcements 列表页顶栏进行）
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function UnifiedHeader() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // 导航菜单状态
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const [aboutMenuPos, setAboutMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [contactMenuPos, setContactMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
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

  const handleMenuEnter = (menu: string) => {
    if (menuTimeout.current) { clearTimeout(menuTimeout.current); menuTimeout.current = null; }
    setActiveMenu(menu);
  };
  const handleMenuLeave = () => {
    menuTimeout.current = setTimeout(() => setActiveMenu(null), 160);
  };

  return (
    <header className="sticky top-0 z-50 flow-header-bg" style={{ willChange: 'transform' }}>
      {/* 底部静态光泽边 — 中间微亮两端淡出，无动画 */}
      <div className="absolute bottom-0 left-0 right-0 h-px z-30 pointer-events-none" style={{
        background: 'linear-gradient(90deg, transparent 0%, oklch(0.72 0.06 245 / 0.18) 25%, oklch(0.78 0.08 235 / 0.30) 50%, oklch(0.72 0.06 245 / 0.18) 75%, transparent 100%)',
      }} />
      <div className="relative">
        <div className="relative z-10 flex h-[68px] items-center px-[clamp(16px,4vw,48px)]">
        {/* ── 左侧：品牌 ── */}
        <div className="flex flex-1 items-center">
          <a href={portalURL('assistant')} suppressHydrationWarning className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="四川水发集团" className="h-[45px] w-auto object-contain" />
            <div className="flex flex-col gap-0">
              <strong
                className="brand-wordmark whitespace-nowrap text-[27px] leading-tight tracking-[0.10em] text-[#0a2540]"
              >
                四川水发集团
              </strong>
              <small className="whitespace-nowrap text-[7px] font-medium tracking-wide text-[#8a96aa]">
                SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.
              </small>
            </div>
          </a>
        </div>

        {/* ── 右侧：导航菜单 ── */}
        <div className="flex flex-1 items-center justify-end gap-4">
          {/* ── 集团简介 ── */}
          <div
            ref={aboutRef}
            className="relative"
            onMouseEnter={() => handleMenuEnter('about')}
            onMouseLeave={handleMenuLeave}
          >
            <button
              className="flow-nav-pill"
              aria-expanded={activeMenu === 'about'}
            >
              集团简介
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`mt-px ${activeMenu === 'about' ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* 下拉面板 — Portal 到 body 以越过 header 层叠上下文 */}
            {activeMenu === 'about' && mounted && createPortal(
              <div
                className="flow-nav-menu fixed z-[9999]"
                style={{ top: aboutMenuPos.top, left: aboutMenuPos.left }}
              >
                <a href="/about" target="_blank" rel="noopener noreferrer" className="flow-nav-menu-item">
                  集团概况
                  <svg className="flow-nav-menu-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
                </a>
                <a href="https://www.scsfjt.com/" target="_blank" rel="noopener noreferrer" className="flow-nav-menu-item">
                  集团官网
                  <svg className="flow-nav-menu-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
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
              className="flow-nav-pill"
              aria-expanded={activeMenu === 'contact'}
            >
              联系我们
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`mt-px ${activeMenu === 'contact' ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* 下拉面板 — Portal 到 body */}
            {activeMenu === 'contact' && mounted && createPortal(
              <div
                className="flow-nav-menu fixed z-[9999]"
                style={{ top: contactMenuPos.top, left: contactMenuPos.left }}
              >
                <a href="/contact" className="flow-nav-menu-item">
                  联系方式
                  <svg className="flow-nav-menu-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
                </a>
                <a href="/contact/visitor" className="flow-nav-menu-item">
                  供应商来访接待
                  <svg className="flow-nav-menu-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
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
