'use client';
import { Check } from 'lucide-react';

export interface PointDecisionValue { checked: boolean; awardedScore: number; note?: string }
export interface PointDef { id: string; name: string; fullScore: number | string; objective: boolean; evidenceHint?: string | null; seq: number }

interface Props {
  points: PointDef[];
  value: Record<string, PointDecisionValue>; // pointId -> decision
  onChange: (pointId: string, v: PointDecisionValue) => void;
  readOnly?: boolean;
  compact?: boolean; // tablet 用更紧凑布局
  /** 当前选中得分点 id（高亮） */
  selectedPointId?: string | null;
  /** 点击得分点行 → 选中用于手写备忘 */
  onPointClick?: (pointId: string, pointName: string) => void;
}

/**
 * 打分 checklist 共享组件：
 * - objective point → 复选框（勾选默认满分，可下调）
 * - subjective point → 直接数值输入
 * 桌面端与 tablet 端复用（compact 切换紧凑布局）。
 */
export function PointChecklistScoring({ points, value, onChange, readOnly, compact, selectedPointId, onPointClick }: Props) {
  const sorted = [...points].sort((a, b) => a.seq - b.seq);
  return (
    <div className="space-y-2">
      {sorted.map(p => {
        const v = value[p.id] ?? { checked: false, awardedScore: 0 };
        const max = Number(p.fullScore);
        const isSelected = selectedPointId === p.id;
        return (
          <div key={p.id} role="button" tabIndex={0}
            onClick={() => onPointClick?.(p.id, p.name)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPointClick?.(p.id, p.name); } }}
            className={`flex items-center gap-3 rounded-lg border bg-white cursor-pointer transition ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} ${
              isSelected ? 'border-[#064ea2] bg-blue-50/30 ring-1 ring-[#064ea2]/20' : 'border-blue-100'
            }`}>
            {p.objective ? (
              <button type="button" disabled={readOnly} onClick={() => onChange(p.id, { checked: !v.checked, awardedScore: !v.checked ? max : 0 })}
                className={`flex h-6 w-6 items-center justify-center rounded border ${v.checked ? 'bg-[#11a874] border-[#11a874] text-white' : 'border-[oklch(0.8_0.005_264)] text-transparent'} disabled:opacity-50`}>
                <Check size={14} strokeWidth={2.5} />
              </button>
            ) : (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">主观</span>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[oklch(0.18_0.012_265)] truncate">{p.name}</div>
              {p.evidenceHint && <div className="text-xs text-[oklch(0.55_0.01_264)] truncate">{p.evidenceHint}</div>}
            </div>
            <input type="number" min={0} max={max} step={0.5} value={v.awardedScore} disabled={readOnly}
              onChange={e => onChange(p.id, { ...v, awardedScore: Math.max(0, Math.min(Number(e.target.value) || 0, max)) })}
              className={`w-16 text-center border border-blue-100 rounded-lg px-1.5 py-1 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2] outline-none disabled:opacity-60`} />
            <span className="text-xs text-[oklch(0.55_0.01_264)]">/ {max}</span>
          </div>
        );
      })}
    </div>
  );
}
