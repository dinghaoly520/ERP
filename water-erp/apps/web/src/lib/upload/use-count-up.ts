'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 数字滚动（spec §4.3）：rAF 插值 ~200ms 逼近目标值，等宽数字仪表感；
 * prefers-reduced-motion 或 ms<=0 时直接跳变终值。用于百分比/速度等展示位。
 */
export function useCountUp(target: number, ms = 200): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || ms <= 0) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    const from = displayRef.current;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = Math.round(from + (target - from) * k);
      displayRef.current = v;
      setDisplay(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return display;
}
