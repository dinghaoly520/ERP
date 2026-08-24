"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { getWebToken } from "@/lib/session-store";

/**
 * 单设备登录心跳（2026-08-21）：15s 轮询 /auth/heartbeat（带 X-Web-Token）。
 * 空闲标签页/设备没有业务请求，靠心跳让被顶下线/冻结的会话在 15s 内
 * 触发 on401 弹窗并回到登录页。未登录（无 webToken）不发请求。
 */
export function SessionWatchdog() {
  useEffect(() => {
    const tick = () => {
      if (!getWebToken()) return;
      api.get("/auth/heartbeat").catch(() => {
        /* 401 由 on401 统一弹窗处理 */
      });
    };
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
