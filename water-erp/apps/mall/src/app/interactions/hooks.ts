'use client';

import { useEffect, useRef, useState } from 'react';
import { useMotionValue, useSpring, useTransform, animate } from 'framer-motion';

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
