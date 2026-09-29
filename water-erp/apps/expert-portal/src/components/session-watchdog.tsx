'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import { isTransferClaimed } from '@/lib/transfer-claimed-flag';

/**
 * 单设备登录心跳（2026-09-20，移植自 :3004/:3005）：15s 轮询 /auth/heartbeat。
 * 空闲标签页/设备没有业务请求，靠心跳让被顶下线/冻结的会话在 15s 内
 * 触发 401 弹窗并回到登录页。token_expert cookie 是 httpOnly（JS 读不到），
 * 且本门户无认证 Context——故本组件仅挂载于已登录区域布局（(app)/(tablet)），
 * 游客路由（/login、/rsvp、/invitation）不挂载、不发心跳。
 * EXP-P2-07（2026-09-29）：本端签发的工位迁移已被平板领取后停跳——桌面旧 token
 * 失效是预期移交结果，继续心跳只会把自家迁移弹成「异地登录疑似冒用」。
 */
export function SessionWatchdog() {
  useEffect(() => {
    if (isTransferClaimed()) return; // 迁移已领取：不再发心跳
    const tick = () => {
      if (isTransferClaimed()) return;
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
