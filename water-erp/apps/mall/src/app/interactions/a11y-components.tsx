'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useId, useState, useRef, useCallback, useEffect } from 'react';

// ─────────────────────────────────────────────
// <LiveRegion> — 动态变化播报给屏幕阅读器
// ─────────────────────────────────────────────

export function LiveRegion({
  children,
  politeness = 'polite',
}: {
  children: React.ReactNode;
  politeness?: 'polite' | 'assertive';
}) {
  return (
    <div aria-live={politeness} aria-atomic="true" className="sr-only">
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// <Tooltip> — 上下文提示（hover/focus/long-press 触发）
// 包裹式：用 span 包裹 trigger，tooltip 绝对定位在 span 内
// ─────────────────────────────────────────────

export function Tooltip({
  content,
  children,
  position = 'auto',
  delay = 500,
}: {
  content: string;
  children: React.ReactNode;
  position?: 'auto' | 'top' | 'bottom';
  delay?: number;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [resolvedPos, setResolvedPos] = useState<'top' | 'bottom'>('top');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (position === 'auto' && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setResolvedPos(rect.top < 100 ? 'bottom' : 'top');
      } else if (position !== 'auto') {
        setResolvedPos(position);
      }
      setVisible(true);
    }, delay);
  }, [position, delay]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={show}
      onTouchEnd={hide}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: resolvedPos === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: resolvedPos === 'top' ? 4 : -4 }}
            transition={{ duration: 0.15 }}
            style={{ pointerEvents: 'none' }}
            className={`absolute left-1/2 z-[200] -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#334155] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg ${resolvedPos === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          >
            {content}
            <span className={`absolute left-1/2 -translate-x-1/2 h-0 w-0 border-l-4 border-r-4 border-transparent ${resolvedPos === 'top' ? 'top-full -mt-px border-t-4 border-t-[#334155]' : 'bottom-full -mb-px border-b-4 border-b-[#334155]'}`} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
