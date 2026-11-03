"use client";
import { useEffect, useRef } from "react";

/**
 * 轻量轮询 hook（:3011 实时层，2026-11-03——评审裁定不做 WS：移动浏览器后台
 * WebSocket 不可靠，轮询 + visibilitychange 即时补取是同效低成本方案）。
 * - enabled=true 即取一次，此后每 intervalMs 一轮；enabled 翻 true 立即重取
 *   （登录闸场景：checked 前不轮询、checked 后零延迟首拉——F2 修复）
 * - 单一调度权：只有完成本轮的 tick 才能排下一轮 + running 闸防重入——
 *   慢请求×visibilitychange 交叠不会分叉出并行循环/旧响应覆写新数据（F1 修复）
 * - document.hidden 跳过执行（不烧流量）；回前台立即补取一轮
 * - fn 失败静默（调用方保留旧数据——O5/O6 失败保数据模式）
 */
export function usePolling(fn: () => Promise<unknown>, intervalMs: number, enabled = true) {
  const ref = useRef(fn);
  /* latest-ref 模式：render 期不碰 ref（react-hooks/refs），effect 内同步最新 fn */
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const run = async () => {
      if (running || stopped) return;
      running = true;
      try {
        if (document.visibilityState === "visible") {
          try {
            await ref.current();
          } catch {
            /* 失败保旧数据 */
          }
        }
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(run, intervalMs);
      }
    };
    run();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      /* running 中被调用时 run 会早退，但本轮 finally 会续排下一轮——循环不丢不分叉 */
      run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs, enabled]);
}
