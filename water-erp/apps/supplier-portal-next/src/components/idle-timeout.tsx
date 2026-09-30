"use client";

import { useEffect, useRef } from "react";
import { authApi } from "@/lib/api/auth";
import { useAuth } from "@/lib/auth-context";
import { clearSupplierToken } from "@/lib/session-store";

/**
 * 12 小时无操作自动退出（2026-09-24）。
 *
 * 监听全局用户交互事件（鼠标/键盘/触摸/滚动），每次交互重置计时器。
 * 连续 12h 无任何操作 → 调用后端 logout（销毁会话）→ 跳转登录页。
 * - 任何一次交互（含心跳轮询以外的真实操作）都会重置计时
 * - 未登录不启动计时
 * - 页面隐藏（切 tab）期间仍会计时——恢复可见时立即检查
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
  const { isLoggedIn } = useAuth();
  const lastActivityRef = useRef<number>(Date.now());
  const logoutTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn) return;

    // B4-3（2026-09-30）：最后活动落 localStorage——空闲判定跨 tab 共享（任一 tab 活跃即整账号不空闲），
    // 否则被遗忘的后台 tab 到点会销毁账号级会话，把正活跃的另一 tab 顶下线（与 tab 级会话模型冲突）
    const LS_KEY = "supplier:lastActivity";
    const readLastActivity = () => {
      const shared = Number(window.localStorage.getItem(LS_KEY));
      lastActivityRef.current = Number.isFinite(shared) && shared > 0 ? Math.max(lastActivityRef.current, shared) : lastActivityRef.current;
      return lastActivityRef.current;
    };
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      try { window.localStorage.setItem(LS_KEY, String(lastActivityRef.current)); } catch { /* 存储满等忽略 */ }
    };

    // 记录用户交互
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, onActivity, { passive: true, capture: true });
    }

    // 定期检查：距今上次交互是否已超 12h
    const timer = window.setInterval(async () => {
      if (logoutTriggeredRef.current) return;
      if (Date.now() - readLastActivity() < IDLE_TIMEOUT_MS) return;

      logoutTriggeredRef.current = true;
      // 调用后端 logout（销毁服务端会话 + 清 cookie），失败也照常清本地态回登录页
      try { await authApi.logout(); } catch { /* 网络异常不影响本地退出 */ }
      clearSupplierToken(); // B4-3：与 auth-context.logout 同口径清本 tab token
      window.location.href = "/login";
    }, CHECK_INTERVAL_MS);

    // 页面恢复可见时立即检查（防止 setInterval 被浏览器节流延迟）
    const onVisible = () => {
      if (document.visibilityState === "visible" && !logoutTriggeredRef.current) {
        if (Date.now() - readLastActivity() >= IDLE_TIMEOUT_MS) {
          logoutTriggeredRef.current = true;
          authApi.logout().catch(() => {});
          clearSupplierToken(); // B4-3
          window.location.href = "/login";
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
  }, [isLoggedIn]);

  return null;
}
