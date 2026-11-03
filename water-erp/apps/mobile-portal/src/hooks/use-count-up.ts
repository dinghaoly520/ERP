"use client";
import { useEffect, useRef, useState } from "react";

/**
 * 数字滚动（:3011 科技感动效层，2026-11-03）：rAF 600ms ease-out——精密感的
 * 「数字活起来」。仅接受纯数字字符串（"12"/"749.9"）；带单位/中文/破折号的值
 * 原样直通（调用方零适配）；prefers-reduced-motion 直通。
 */
export function useCountUp(raw: string, durationMs = 600): string {
  const [display, setDisplay] = useState(raw);
  const fromRef = useRef<number | null>(null);
  useEffect(() => {
    // 非纯数字（"—"/"1,200万"/百分比带号）不做滚动
    if (!/^-?\d+(\.\d+)?$/.test(raw)) {
      setDisplay(raw);
      return;
    }
    const target = parseFloat(raw);
    // 首个值直达不动画（fromRef 置目标）——避免「闪现终值→归零→再滚上来」的首帧跳变；
    // 后续值变化才从旧值滚到新值（2026-11-03 稳健性修订）
    if (fromRef.current === null) {
      fromRef.current = target;
      setDisplay(raw);
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = target;
      setDisplay(raw);
      return;
    }
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out-cubic：快起缓收，仪表指针感
      setDisplay((from + (target - from) * eased).toFixed(decimals));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [raw, durationMs]);
  return display;
}
