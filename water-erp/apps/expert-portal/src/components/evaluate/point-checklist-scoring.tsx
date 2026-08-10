'use client';

import { MessageSquare, MessageSquarePlus } from 'lucide-react';

export interface PointDecisionValue { checked: boolean; awardedScore: number; note?: string }
export interface PointDef { id: string; name: string; fullScore: number | string; objective: boolean; evidenceHint?: string | null; seq: number }

interface Props {
  points: PointDef[];
  value: Record<string, PointDecisionValue>; // pointId -> decision
  onChange: (pointId: string, v: PointDecisionValue) => void;
  readOnly?: boolean;
  compact?: boolean; // tablet 用更紧凑布局
  /** 隐藏逐小点批注框（调用方自带批注 UI 时用，如条款核对面板） */
  hideNotes?: boolean;
  /** 当前选中得分点 id（高亮） */
  selectedPointId?: string | null;
  /** 点击得分点行 → 选中用于手写备忘 */
  onPointClick?: (pointId: string, pointName: string) => void;
  /** 得分点批注计数（pointId → count），用于角标渲染 */
  pointMemoCounts?: Record<string, number>;
}

/**
 * 打分 checklist 共享组件（cgzxui 新拟态）：
 * - objective point → .neu-checkbox（勾选默认满分，可下调）
 * - subjective point → .exp-score-input 数值输入
 * 桌面端与 tablet 端复用（compact 切换紧凑布局）。
 */
export function PointChecklistScoring({ points, value, onChange, readOnly, compact, hideNotes, selectedPointId, onPointClick, pointMemoCounts }: Props) {
  const sorted = [...points].sort((a, b) => a.seq - b.seq);
  return (
    <div className="space-y-2">
      {sorted.map(p => {
        const v = value[p.id] ?? { checked: false, awardedScore: 0 };
        const max = Number(p.fullScore);
        const isSelected = selectedPointId === p.id;
        return (
          <div key={p.id}
            className={`rounded-[10px] transition ${
              isSelected
                ? 'bg-[oklch(0.96_0.03_251/0.3)] shadow-[inset_0_0_0_1.5px_color-mix(in_oklch,var(--accent-strong)_45%,transparent)]'
                : 'bg-[oklch(1_0_0/0.55)]'
            }`}>
            <div role="button" tabIndex={0}
              onClick={() => onPointClick?.(p.id, p.name)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPointClick?.(p.id, p.name); } }}
              className={`flex cursor-pointer items-center gap-3 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
              {p.objective ? (
                <input
                  type="checkbox"
                  className="neu-checkbox"
                  checked={v.checked}
                  disabled={readOnly}
                  aria-label={`${p.name} 客观得分点`}
                  onClick={e => e.stopPropagation()}
                  onChange={() => onChange(p.id, { ...v, checked: !v.checked, awardedScore: !v.checked ? max : 0 })}
                />
              ) : (
                <span className="exp-pill shrink-0" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>主观</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--foreground)]">{p.name}</div>
                {p.evidenceHint && <div className="truncate text-xs text-[var(--muted-foreground)]">{p.evidenceHint}</div>}
              </div>
              <input type="number" min={0} max={max} step={0.5} value={v.awardedScore} disabled={readOnly}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => onChange(p.id, { ...v, awardedScore: Math.max(0, Math.min(Number(e.target.value) || 0, max)) })}
                className="exp-score-input shrink-0 !h-[34px] !w-[64px] !text-[13px] disabled:opacity-60"
                aria-label={`${p.name} 得分`} />
              <span className="shrink-0 text-xs text-[var(--muted-foreground)]">/ {max}</span>
              {/* 批注角标（只读状态指示） */}
              {!hideNotes && (() => {
                const count = pointMemoCounts?.[p.id] ?? 0;
                if (readOnly && count === 0) return null;
                return (
                  <span
                    className={`relative flex shrink-0 items-center justify-center rounded-md h-8 w-8 ${
                      count > 0
                        ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent-strong)]'
                        : 'text-[var(--muted-foreground)]'
                    }`}>
                    {count > 0
                      ? <MessageSquare size={compact ? 12 : 14} strokeWidth={1.5} />
                      : <MessageSquarePlus size={compact ? 12 : 14} strokeWidth={1.5} />}
                    {count > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-strong)] px-1 text-[9px] font-bold tabular-nums text-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </span>
                );
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
