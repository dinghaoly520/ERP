"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 下拉刷新（2026-10-14 spec，零依赖）：仅窗口滚顶时响应；拖距阻尼 0.45、
 * 阈值 64px；指示器随 pull 渐显、refreshing 时旋转。touch 事件驱动——
 * 桌面无触摸自然禁用，不影响鼠标交互。
 */
const TRIGGER_PX = 64;
const DAMPING = 0.45;
const MAX_PULL = 96;

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      /* 应用壳内部滚动容器契约：(main) layout 注入 id="m-app-scroll"；
         无此容器（如登录页 body 滚动）回退 window */
      const scrollEl = document.getElementById("m-app-scroll");
      const scrollTop = scrollEl ? scrollEl.scrollTop : window.scrollY || document.documentElement.scrollTop;
      startYRef.current = scrollTop <= 0 ? e.touches[0].clientY : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy > 0) {
        pullRef.current = Math.min(dy * DAMPING, MAX_PULL);
        setPull(pullRef.current);
      }
    };
    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      const reached = pullRef.current >= TRIGGER_PX;
      pullRef.current = 0;
      setPull(0);
      if (reached) {
        setRefreshing(true);
        refreshingRef.current = true;
        void Promise.resolve(onRefreshRef.current()).finally(() => {
          setRefreshing(false);
          refreshingRef.current = false;
        });
      }
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return { pull, refreshing };
}
