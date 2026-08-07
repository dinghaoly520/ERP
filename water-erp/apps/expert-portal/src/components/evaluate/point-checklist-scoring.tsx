'use client';

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
}

/**
 * 打分 checklist 共享组件（cgzxui 新拟态）：
 * - objective point → .neu-checkbox（勾选默认满分，可下调）
 * - subjective point → .exp-score-input 数值输入
 * 桌面端与 tablet 端复用（compact 切换紧凑布局）。
 */
export function PointChecklistScoring({ points, value, onChange, readOnly, compact, hideNotes, selectedPointId, onPointClick }: Props) {
  const sorted = [...points].sort((a, b) => a.seq - b.seq);
  return (
    <div className="space-y-2">
      {sorted.map(p => {
        const v = value[p.id] ?? { checked: false, awardedScore: 0 };
        const max = Number(p.fullScore);
        const isSelected = selectedPointId === p.id;
        const showNote = !hideNotes && (!readOnly || Boolean((v.note ?? '').trim()));
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
            </div>
            {/* 逐小点批注框（得分点级 note）：与整项「评分理由」并存，readOnly 时仅有内容才展示 */}
            {showNote && (
              <div className={compact ? 'px-2 pb-1.5' : 'px-3 pb-2'}>
                <textarea
                  value={v.note ?? ''}
                  disabled={readOnly}
                  placeholder="小点批注（可选）"
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => onChange(p.id, { ...v, note: e.target.value })}
                  className="neu-input !min-h-[30px] !w-full !py-1 !text-xs disabled:opacity-60"
                  aria-label={`${p.name} 批注`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
