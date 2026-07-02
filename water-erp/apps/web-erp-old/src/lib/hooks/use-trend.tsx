'use client';
import { useEffect, useState } from 'react';

export type TrendDirection = 'up-good' | 'up-bad' | 'neutral';
export interface TrendValue { delta: number; }
export interface TrendHistory { values: number[]; delta: number | null; }

const HISTORY_LENGTH = 7;

/** 读/写 localStorage 基线：返回历史值数组 + 与上次不同值的差。 */
function useTrendStore(metricKey: string, currentValue: number | null): TrendHistory | null {
  const [history, setHistory] = useState<TrendHistory | null>(null);

  useEffect(() => {
    if (currentValue == null || typeof currentValue !== 'number' || isNaN(currentValue)) {
      setHistory(null);
      return;
    }
    try {
      const key = `erp:trend:web:${metricKey}`;
      const raw = localStorage.getItem(key);
      const prev = raw ? JSON.parse(raw) as { values: number[]; at: number } : null;
      const values = (prev?.values ?? []).slice(-HISTORY_LENGTH + 1);
      values.push(currentValue);
      const delta = prev?.values != null && prev.values.length > 0 && prev.values[prev.values.length - 1] !== currentValue
        ? currentValue - (prev.values[prev.values.length - 1] ?? currentValue) : null;
      localStorage.setItem(key, JSON.stringify({ values, at: Date.now() }));
      setHistory({ values, delta });
    } catch { setHistory(null); }
  }, [metricKey, currentValue]);

  return history;
}

/** React hook：返回趋势历史（7 日值 + delta）。首次访问返回 null。 */
export function useTrend(metricKey: string, currentValue: number | null): TrendHistory | null {
  return useTrendStore(metricKey, currentValue);
}

/** Mini sparkline: 1.5px SVG polyline, monotone curve. */
export function MiniSparkline({ values, tone = 'blue' }: { values: number[]; tone?: string }) {
  if (values.length < 2) return null;
  const color = { blue: '#064ea2', green: '#11a874', orange: '#f5a623', red: '#e74c3c', gray: '#8a99ad', cyan: '#0891b2', purple: '#7c3aed' }[tone];
  const w = 56, h = 24, pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * (w - pad * 2) + pad},${h - pad - ((v - min) / range) * (h - pad * 2)}`
  ).join(' ');

  return (
    <svg width={w} height={h} className="flex-shrink-0" style={{ marginBottom: 2 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts.split(' ').pop()!.split(',')[0]} cy={pts.split(' ').pop()!.split(',')[1]} r={2} fill={color} />
    </svg>
  );
}
