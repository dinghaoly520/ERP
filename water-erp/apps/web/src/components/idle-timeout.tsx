"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { getWebToken, clearWebToken, clearLoginPrefill } from "@/lib/session-store";

/**
 * 12 小时无操作自动退出（2026-09-24）。
 *
 * 监听全局用户交互事件（鼠标/键盘/触摸/滚动），每次交互重置计时器。
 * 连续 12h 无任何操作 → 调用后端 logout（销毁会话+吊销 webSessionId）→ 清 token → 回登录页。
 * - 与 SessionWatchdog（15s 心跳）互补：Watchdog 管「被顶下线/冻结」即时感知，本组件管「长时间无操作」主动退出
 * - 心跳轮询（自动）不计为用户操作——只有真实交互（鼠标/键盘/触摸/滚动）才重置计时
 * - 未登录（无 webToken）不启动计时
 */
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12h
const CHECK_INTERVAL_MS = 60_000; // 每分钟检查一次

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  "mousedown",
  "mousemove",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
  "focus",
];

export function IdleTimeout() {
  const lastActivityRef = useRef<number>(Date.now());
  const logoutTriggeredRef = useRef(false);

  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };

    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, onActivity, { passive: true, capture: true });
    }

    const doLogout = () => {
      if (logoutTriggeredRef.current) return;
      logoutTriggeredRef.current = true;
      // 调用后端 logout（销毁 webSessionId + 清 cookie），失败也照常清本地态回登录页
      api.post("/auth/logout").catch(() => {});
      clearWebToken();
      clearLoginPrefill();
      window.location.href = "/login";
    };

    const timer = window.setInterval(() => {
      if (!getWebToken()) return; // 未登录不计时
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        doLogout();
      }
    }, CHECK_INTERVAL_MS);

    // 页面恢复可见时立即检查（防止 setInterval 被浏览器节流延迟）
    const onVisible = () => {
      if (document.visibilityState === "visible" && getWebToken()) {
        if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
          doLogout();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        document.removeEventListener(evt, onActivity, { capture: true } as EventListenerOptions);
      }
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
