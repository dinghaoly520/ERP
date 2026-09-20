"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * 单设备登录心跳（2026-09-18，移植自 :3005）：15s 轮询 /auth/heartbeat。
 * 空闲标签页/设备没有业务请求，靠心跳让被顶下线/冻结的会话在 15s 内
 * 触发 401 弹窗并回到登录页。token_supplier cookie 是 httpOnly（JS 读不到），
 * 故以认证上下文的登录态作门禁信号：未登录不发请求（登录页等游客路由静默）。
 */
export function SessionWatchdog() {
  const { isLoggedIn } = useAuth();
  // interval 闭包只建一次，经 ref 每拍读取最新登录态（在 effect 中同步，不在渲染期写 ref）
  const loggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    loggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  useEffect(() => {
    const tick = () => {
      if (!loggedInRef.current) return;
      api.get("/auth/heartbeat", { silent: true }).catch(() => {
        /* 401 由 api guard 统一弹窗处理 */
      });
    };
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
