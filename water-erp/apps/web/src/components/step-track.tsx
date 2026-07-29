'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Check } from 'lucide-react';

export interface StepDef {
  num: number;
  label: string;
  desc?: string;
}

interface StepTrackProps {
  steps: readonly StepDef[];
  current: number;
  onStepClick?: (step: number) => void;
  /** Which steps are reachable (clickable). Defaults to steps <= current. */
  reachable?: (step: number) => boolean;
}

/**
 * 步骤轨道 — 节点圆心与进度条严格对齐。
 *
 * 使用 ResizeObserver 测量第一个 / 最后一个节点的实际圆心，
 * 进度条 left/width 精确到像素，不依赖硬编码偏移。
 *
 * 视觉提升：
 * - 节点 36px（原 32px），进度条 5px（原 4px）
 * - 当前步骤外圈光环 + 脉冲，已完成绿色渐变 + ✓
 * - 进度条从节点 1 圆心到节点 N 圆心，边缘精确对准
 */
export function StepTrack({ steps, current, onStepClick, reachable }: StepTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [barMetrics, setBarMetrics] = useState<{ left: number; width: number } | null>(null);
  const total = steps.length;

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const circles = el.querySelectorAll<HTMLElement>('.step-node__circle');
    if (circles.length < 2) {
      setBarMetrics(null);
      return;
    }
    const trackRect = el.getBoundingClientRect();
    const firstRect = circles[0].getBoundingClientRect();
    const lastRect = circles[circles.length - 1].getBoundingClientRect();
    const startX = firstRect.left + firstRect.width / 2 - trackRect.left;
    const endX = lastRect.left + lastRect.width / 2 - trackRect.left;
    setBarMetrics({ left: startX, width: Math.max(0, endX - startX) });
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [measure, steps.length]);

  // 填充进度 = 实际进度条宽度的 (current-1)/(total-1)
  const fillPct = barMetrics && total > 1
    ? ((current - 1) / (total - 1)) * 100
    : 0;

  const isReachable = (num: number) => {
    if (reachable) return reachable(num);
    return num <= current;
  };

  return (
    <div ref={trackRef} className="step-track" style={{ '--n': total } as React.CSSProperties}>
      {/* 凹槽通道 */}
      {barMetrics && (
        <div
          className="step-track__groove"
          style={{ position: 'absolute', left: barMetrics.left, width: barMetrics.width }}
        />
      )}

      {/* 流光填充 */}
      {barMetrics && (
        <div
          className="step-track__progress"
          style={{ position: 'absolute', left: barMetrics.left, width: barMetrics.width }}
        >
          <div
            className="step-track__progress-fill"
            style={{ width: `${fillPct}%` }}
          />
        </div>
      )}

      {steps.map((s) => {
        const isActive = s.num === current;
        const isDone = s.num < current;
        const clickable = isReachable(s.num) && !!onStepClick;

        const stateClass = isActive
          ? 'step-node--active'
          : isDone
            ? 'step-node--done'
            : 'step-node--future';

        return (
          <button
            key={s.num}
            type="button"
            className={`step-node ${stateClass} ${clickable ? 'step-node--clickable' : ''}`}
            onClick={() => clickable && onStepClick?.(s.num)}
            disabled={!clickable}
            tabIndex={clickable ? 0 : -1}
          >
            <span className="step-node__circle">
              {isDone ? <Check size={15} strokeWidth={2.5} /> : s.num}
            </span>
            <div className="step-node__label">
              <div className="step-node__title">{s.label}</div>
              {s.desc && <div className="step-node__desc">{s.desc}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
