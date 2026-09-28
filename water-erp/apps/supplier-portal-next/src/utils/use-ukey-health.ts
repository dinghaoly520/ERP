"use client";
/* 中间件健康轮询 —— U盾管理页的常驻监护（2026-09-17）。
 *
 * 与 use-ukey-presence 的分工：presence 只在严格模式 + 弹窗/PIN 表单打开时轮询、
 * 返回布尔；本 hook 总在线轮询（不分严格/开发模式），暴露 /health 全量信息
 * （version/shields/unlocked），供 U盾管理页做三件事：
 *   1. 卡片头部实时状态徽标（驱动在线 · vX · N 盾 · M 已解锁 / 驱动离线）
 *   2. dev 横幅与轨别（ukeyKind）随在线状态活起来（进页一次性快照的替代）
 *   3. 解锁后的中间件监护（拔盾/会话失效/离线 → 自动锁定，页面侧接线）
 *
 * 离线判定去抖：连续 OFFLINE_MISS_THRESHOLD 次未命中才置离线（防 300ms 探测
 * 偶发超时闪跳）；恢复在线即时。初始为 null（首个探测周期完成前）。
 *
 * 离线指数退避（2026-09-28）：中间件进程未跑时每次 probe 都是注定失败的 fetch，
 * 浏览器会对连接拒绝逐条打控制台日志——判定离线后轮询间隔逐级放大（×4 → ×15 封顶），
 * 恢复在线立即回到基础间隔。中间件上线最多一个封顶周期（30s）内即恢复监护。
 */
import { useEffect, useRef, useState } from "react";
import { VendorUKeyAdapter } from "@water-erp/ukey";

export interface UkeyHealthState {
  online: boolean;
  /** 中间件版本（/health 携带才有） */
  version: string | null;
  shields: number;
  unlocked: number;
}

const OFFLINE_MISS_THRESHOLD = 3;
/** 离线退避乘数：基础 pollMs → ×4 → ×15 封顶（默认 2s → 8s → 30s） */
const OFFLINE_BACKOFF_MULTS = [1, 4, 15];

export function useUkeyHealth(pollMs = 2000): UkeyHealthState | null {
  const [state, setState] = useState<UkeyHealthState | null>(null);
  const missRef = useRef(0);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let backoffStage = 0;
    const tick = async () => {
      const h = await VendorUKeyAdapter.probe();
      if (!alive) return;
      if (h) {
        missRef.current = 0;
        backoffStage = 0;
        setState({ online: true, version: h.version ?? null, shields: h.shields, unlocked: h.unlocked });
      } else if (missRef.current + 1 >= OFFLINE_MISS_THRESHOLD) {
        missRef.current = 0;
        backoffStage = Math.min(backoffStage + 1, OFFLINE_BACKOFF_MULTS.length - 1);
        setState({ online: false, version: null, shields: 0, unlocked: 0 });
      } else {
        missRef.current += 1;
      }
      timer = window.setTimeout(tick, pollMs * OFFLINE_BACKOFF_MULTS[backoffStage]);
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [pollMs]);
  return state;
}
