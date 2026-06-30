'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface RulesPopoverProps {
  /** Popover body content */
  children: ReactNode;
  /** Trigger button label */
  label?: string;
  /** Button accent color hex, e.g. '#064ea2' */
  accentColor?: string;
}

/**
 * Hover-triggered tooltip portaled to document.body.
 *
 * PageHero's glass-card uses `backdrop-filter: blur()`, which per CSS spec
 * becomes the containing block for ALL descendant positioned elements (fixed
 * included). So an absolute/fixed panel inside the hero is clipped by it.
 * Portal to <body> is the only way to float above the page.
 *
 * - Mouse enters button → panel shows, portaled to body, right-aligned to button.
 * - Mouse leaves button+panel → hides after 200ms (lets pointer cross the gap).
 * - No backdrop, no layout shift.
 */
export function RulesPopover({
  children,
  label = '规则',
  accentColor = '#064ea2',
}: RulesPopoverProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const computePos = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  };

  const show = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    computePos();
    setOpen(true);
  };

  const scheduleHide = () => {
    hideTimer.current = setTimeout(() => setOpen(false), 200);
  };

  const cancelHide = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  };

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  // Keep panel aligned on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const reposition = () => computePos();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={(e) => { show(); e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.color = accentColor; }}
        onMouseLeave={(e) => { scheduleHide(); e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = ''; }}
        onFocus={(e) => { show(); e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.color = accentColor; }}
        onBlur={(e) => { scheduleHide(); e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = ''; }}
        className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5ecf4] bg-white px-3 py-1.5 text-xs font-bold text-[#5a6d8a] transition"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        </svg>
        {label}
      </button>

      {mounted && createPortal(
        open ? (
          <div
            ref={panelRef}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            className="fixed w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white/95 backdrop-blur-xl border border-white/55 p-5 shadow-2xl"
            style={{ top: `${pos.top}px`, right: `${pos.right}px`, zIndex: 99999 }}
          >
            {children}
          </div>
        ) : null,
        document.body,
      )}
    </>
  );
}
