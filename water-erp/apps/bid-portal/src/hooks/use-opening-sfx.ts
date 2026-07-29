'use client';

/**
 * 开标解密音效 hook — 从 page.tsx 提取，独立管理 AudioContext 生命周期。
 * 提供 decryptSuccess / decryptFail / tick / warning 四个音效函数。
 */

import { useEffect, useRef, useCallback } from 'react';

function playTone(ctx: AudioContext, freq: number, duration: number, type: OscillatorType = 'sine') {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    /* silent fail */
  }
}

export interface OpeningSfx {
  decryptSuccess: () => void;
  decryptFail: () => void;
  tick: () => void;
  warning: () => void;
}

export function useOpeningSfx(): OpeningSfx {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    ctxRef.current = new AudioContext();
    return () => {
      ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  // 浏览器首次交互前 AudioContext 可能处于 suspended —— 首次点击/按键时 resume
  useEffect(() => {
    const resume = () => {
      ctxRef.current?.resume?.();
    };
    window.addEventListener('click', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('click', resume);
      window.removeEventListener('keydown', resume);
    };
  }, []);

  const decryptSuccess = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    playTone(ctx, 880, 0.12);
    setTimeout(() => {
      const c = ctxRef.current;
      if (c) playTone(c, 1100, 0.15);
    }, 120);
  }, []);

  const decryptFail = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx) playTone(ctx, 180, 0.3, 'square');
  }, []);

  const tick = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx) playTone(ctx, 600, 0.05);
  }, []);

  const warning = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx) playTone(ctx, 440, 0.4, 'sawtooth');
  }, []);

  return { decryptSuccess, decryptFail, tick, warning };
}
