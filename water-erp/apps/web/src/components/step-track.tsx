'use client';

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
 * 水流管道式步骤轨道 — 凹槽通道 + 浮起节点 + 流光填充
 *
 * 使用 cgzxui 设计系统：
 * - 方向性双影 + 内高光线
 * - oklch() 色彩空间
 * - 无外侧框线
 * - 三态交互（clickable 节点：默认 → hover 抬升 → active 内凹）
 * - reduced-motion 降级
 */
export function StepTrack({ steps, current, onStepClick, reachable }: StepTrackProps) {
  const total = steps.length;
  // Progress width as percentage of the track channel
  const progressPct = total > 1 ? ((current - 1) / (total - 1)) * 100 : 0;

  const isReachable = (num: number) => {
    if (reachable) return reachable(num);
    return num <= current;
  };

  return (
    <div className="step-track">
      {/* 流光填充进度条 */}
      <div
        className="step-track__progress"
        style={{ width: `calc(${progressPct}% - ${progressPct > 0 ? 0 : 0}px)` }}
      />

      {steps.map((s) => {
        const isActive = s.num === current;
        const isDone = s.num < current;
        const isFuture = s.num > current;
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
              {isDone ? <Check size={14} strokeWidth={2.5} /> : s.num}
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
