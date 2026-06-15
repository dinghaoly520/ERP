'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useMotionValue, useSpring, useTransform, animate, useScroll } from 'framer-motion';

/**
 * 数字滚动动画 hook
 * 值变化时从旧值平滑 spring-tween 到新值
 */
export function useCountUp(
  target: number,
  opts?: { duration?: number; decimals?: number; spring?: boolean },
) {
  const { duration = 1.2, decimals = 0, spring = true } = opts ?? {};
  const motionVal = useMotionValue(0);
  const springVal = useSpring(motionVal, {
    stiffness: spring ? 100 : 500,
    damping: spring ? 30 : 50,
  });
  const prevRef = useRef(target);

  useEffect(() => {
    if (prevRef.current !== target) {
      animate(motionVal, target, { duration, ease: 'easeOut' });
      prevRef.current = target;
    } else {
      motionVal.set(target);
    }
  }, [target, motionVal, duration]);

  const display = useTransform(springVal, (v) => {
    if (decimals > 0) {
      return v.toFixed(decimals);
    }
    return Math.round(v).toLocaleString('zh-CN');
  });

  return display;
}

/**
 * 打字机效果 hook
 * 逐字显示文本
 */
export function useTypewriter(
  text: string,
  opts?: { speed?: number; enabled?: boolean },
) {
  const { speed = 30, enabled = true } = opts ?? {};
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !text) {
      setDisplayed(text);
      setDone(true);
      return;
    }

    indexRef.current = 0;
    setDisplayed('');
    setDone(false);

    timerRef.current = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current > text.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        setDone(true);
        return;
      }
      setDisplayed(text.slice(0, indexRef.current));
    }, speed);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, speed, enabled]);

  return { displayed, done };
}

/**
 * 列表 stagger 入场参数生成
 */
export function useStaggeredEntrance(count: number, opts?: { baseDelay?: number; perItemDelay?: number }) {
  const { baseDelay = 0, perItemDelay = 0.05 } = opts ?? {};
  return {
    container: {
      hidden: {},
      show: { transition: { staggerChildren: perItemDelay, delayChildren: baseDelay } },
    },
    item: {
      hidden: { opacity: 0, y: 20 },
      show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 28 } },
    },
  };
}

/**
 * Header 滚动行为 hook
 * 向下滚动隐藏，向上滚动显示
 */
export function useScrollAwareHeader(opts?: { threshold?: number }) {
  const { threshold = 80 } = opts ?? {};
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    let rafId: number;
    const onScroll = () => {
      rafId = requestAnimationFrame(() => {
        const currentY = window.scrollY;
        if (currentY < threshold) {
          setVisible(true);
        } else if (currentY > lastScrollY.current + 10) {
          setVisible(false);
        } else if (currentY < lastScrollY.current - 10) {
          setVisible(true);
        }
        lastScrollY.current = currentY;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [threshold]);

  return visible;
}

/**
 * 数据变化检测 hook
 * 返回自上次调用以来是否变化
 */
export function useDataChanged<T>(value: T): boolean {
  const prevRef = useRef(value);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (prevRef.current !== value) {
      setChanged(true);
      prevRef.current = value;
      const timer = setTimeout(() => setChanged(false), 600);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return changed;
}
