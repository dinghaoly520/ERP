'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

/**
 * 单设备/冻结会话心跳（X-P2-01，2026-09-29——从 :3006 session-watchdog 移植）：
 * 15s 轮询 /auth/heartbeat，让账号被冻结/会话失效在 15s 内触发 401 →
 * api 客户端 on401 分流遮罩。token_bid cookie httpOnly（JS 读不到），本门户无
 * 认证 Context——仅挂载于 app-shell（已登录区），proxy 已挡游客路由。
 */
export function SessionWatchdog() {
  useEffect(() => {
    const tick = () => {
      api.get('/auth/heartbeat').catch(() => {
        /* 401 由 api 客户端 on401 统一弹遮罩处理 */
      });
    };
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
