'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type IdlePhase = 'idle' | 'warning' | 'timeout';

interface UseIdleTimeoutOptions {
  /** 总超时时长（ms），默认 15 分钟 */
  timeoutMs?: number;
  /** 超时前预警时长（ms），默认 2 分钟——进入此阶段后触发 onWarning */
  warningMs?: number;
  /** 进入预警阶段时回调（显示倒计时弹窗） */
  onWarning?: () => void;
  /** 超时回调（执行退出） */
  onTimeout?: () => void;
  /** 设为 true 时强制重置回 idle（弹窗「继续评标」按钮驱动） */
  isActive?: boolean;
}

/**
 * 空闲超时 hook —— 平板 kiosk 场景专用。
 *
 * 三阶段：idle（正常操作）→ warning（距超时 ≤ warningMs，倒计时预警）→ timeout（自动退出）。
 * 监听触屏四件套：pointerdown / keydown / input / touchstart（不监听 mousemove——平板无鼠标）。
 * 页面切到后台标签页时计时器会漂移，visibilitychange 切回时立即校验。
 *
 * @see (tablet)/layout.tsx — 唯一调用方
 */
export function useIdleTimeout({
  timeoutMs = 15 * 60 * 1000,
  warningMs = 2 * 60 * 1000,
  onWarning,
  onTimeout,
  isActive = false,
}: UseIdleTimeoutOptions) {
  const [phase, setPhase] = useState<IdlePhase>('idle');
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const lastActivityRef = useRef<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningFiredRef = useRef(false);
  // 用 ref 保留最新回调，避免每次渲染都重订阅事件
  const onWarningRef = useRef(onWarning);
  const onTimeoutRef = useRef(onTimeout);
  onWarningRef.current = onWarning;
  onTimeoutRef.current = onTimeout;

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (phase !== 'idle') setPhase('idle');
    warningFiredRef.current = false;
  }, [phase]);

  const clearTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  // 主计时循环：每秒检查 elapsed = now - lastActivity
  useEffect(() => {
    clearTick();
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed >= timeoutMs) {
        setPhase('timeout');
        clearTick();
        onTimeoutRef.current?.();
        return;
      }

      if (elapsed >= timeoutMs - warningMs) {
        // 进入或停留在 warning 阶段
        if (!warningFiredRef.current) {
          warningFiredRef.current = true;
          setPhase('warning');
          onWarningRef.current?.();
        }
        setRemainingSeconds(Math.ceil((timeoutMs - elapsed) / 1000));
      } else {
        // 还在 idle 阶段
        if (phase !== 'idle') setPhase('idle');
      }
    }, 1000);

    return clearTick;
  }, [timeoutMs, warningMs, phase, clearTick]);

  // 监听用户活动事件 → reset
  useEffect(() => {
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'input', 'touchstart'];
    // input 是 Event 不是 WindowEventMap，但 addEventListener 接受字符串
    const handler = () => resetActivity();
    for (const ev of events) {
      window.addEventListener(ev, handler);
    }
    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, handler);
      }
    };
  }, [resetActivity]);

  // 页面从后台切回前台时立即校验（防止 setTimeout 漂移）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed >= timeoutMs) {
          setPhase('timeout');
          clearTick();
          onTimeoutRef.current?.();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [timeoutMs, clearTick]);

  // isActive 信号：外部强制重置（弹窗「继续评标」按钮）
  useEffect(() => {
    if (isActive) resetActivity();
  }, [isActive, resetActivity]);

  return { phase, remainingSeconds };
}
