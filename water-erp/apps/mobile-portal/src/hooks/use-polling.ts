"use client";
import { useEffect, useRef } from "react";

/**
 * 轻量轮询 hook（:3011 实时层，2026-11-03——评审裁定不做 WS：移动浏览器后台
 * WebSocket 不可靠，轮询 + visibilitychange 即时补取是同效低成本方案）。
 * - 挂载即取一次，此后每 intervalMs 一轮
 * - document.hidden 暂停（不烧流量）；回前台立即补取一轮
 * - fn 失败静默（调用方保留旧数据——O5/O6 失败保数据模式）
 * - fn 引用变化不重置计时（ref 持有最新 fn）
 */
export function usePolling(fn: () => Promise<unknown>, intervalMs: number) {
  const ref = useRef(fn);
  /* latest-ref 模式：render 期不碰 ref（react-hooks/refs），effect 内同步最新 fn */
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          await ref.current();
        } catch {
          /* 失败保旧数据 */
        }
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs]);
}
