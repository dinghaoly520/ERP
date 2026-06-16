'use client';
import { useEffect, useState } from 'react';

export type TrendDirection = 'up-good' | 'up-bad' | 'neutral';

export interface TrendValue { delta: number; }

/** localStorage 基线：记录每次访问值，返回与上次不同值的差。首次访问返回 null。 */
export function useTrend(metricKey: string, currentValue: number | null): TrendValue | null {
  const [trend, setTrend] = useState<TrendValue | null>(null);

  useEffect(() => {
    if (currentValue == null || typeof currentValue !== 'number' || isNaN(currentValue)) {
      setTrend(null);
      return;
    }
    try {
      // 用 portal 名区分存储（web 门户独立）
      const storageKey = `erp:trend:web:${metricKey}`;
      const raw = localStorage.getItem(storageKey);
      const prev = raw ? Number(JSON.parse(raw).value) : null;
      if (prev != null && !isNaN(prev) && prev !== currentValue) {
        setTrend({ delta: currentValue - prev });
      } else {
        setTrend(null);
      }
      localStorage.setItem(storageKey, JSON.stringify({ value: currentValue, at: Date.now() }));
    } catch { setTrend(null); }
  }, [metricKey, currentValue]);

  return trend;
}
