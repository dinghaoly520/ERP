'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────
// useFocusTrap — 弹窗焦点锁定 + 归还
// ─────────────────────────────────────────────

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(opts: { active: boolean; returnFocus?: boolean }) {
  const { active, returnFocus = true } = opts;
  const ref = useRef<HTMLDivElement>(null);
  const prevActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    // 记录触发元素，关闭时归还
    if (returnFocus) {
      prevActiveRef.current = document.activeElement as HTMLElement;
    }

    const container = ref.current;
    // 聚焦弹窗内第一个可聚焦元素
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      container.tabIndex = -1;
      container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (returnFocus && prevActiveRef.current) {
        prevActiveRef.current.focus();
      }
    };
  }, [active, returnFocus]);

  return ref;
}

// ─────────────────────────────────────────────
// useDismissable — Esc + 外部点击关闭
// ─────────────────────────────────────────────

export function useDismissable(opts: {
  active: boolean;
  onClose: () => void;
  outsideClick?: boolean;
  escapeKey?: boolean;
}) {
  const { active, onClose, outsideClick = true, escapeKey = true } = opts;
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (escapeKey && e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, escapeKey]);

  const onOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (outsideClick && e.target === overlayRef.current) {
        onCloseRef.current();
      }
    },
    [outsideClick],
  );

  return { overlayRef, onOverlayClick };
}

// ─────────────────────────────────────────────
// useReducedMotion — 尊重 prefers-reduced-motion
// ─────────────────────────────────────────────

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

// ─────────────────────────────────────────────
// useGlobalHotkey — 全局快捷键
// ─────────────────────────────────────────────

export function useGlobalHotkey(
  key: string,
  handler: () => void,
  opts: { ignoreInputs?: boolean; withMeta?: boolean; preventDefault?: boolean } = {},
) {
  const { ignoreInputs = true, withMeta = false, preventDefault = true } = opts;
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== key) return;
      if (withMeta && !(e.metaKey || e.ctrlKey)) return;
      if (!withMeta && (e.metaKey || e.ctrlKey || e.altKey)) return;

      if (ignoreInputs) {
        const target = e.target as HTMLElement;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      if (preventDefault) e.preventDefault();
      handlerRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [key, ignoreInputs, withMeta, preventDefault]);
}

// ─────────────────────────────────────────────
// useRovingIndex — 方向键导航（roving tabindex）
// ─────────────────────────────────────────────

export function useRovingIndex(count: number, opts: { onActivate?: (index: number) => void } = {}) {
  const { onActivate } = opts;
  const [activeIndex, setActiveIndex] = useState(0);
  const onActivateRef = useRef(onActivate);
  useEffect(() => { onActivateRef.current = onActivate; });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % count);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + count) % count);
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(count - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onActivateRef.current?.(activeIndex);
          break;
      }
    },
    [count, activeIndex],
  );

  const tabIndex = (index: number) => (index === activeIndex ? 0 : -1);

  return { activeIndex, setActiveIndex, onKeyDown, tabIndex };
}
