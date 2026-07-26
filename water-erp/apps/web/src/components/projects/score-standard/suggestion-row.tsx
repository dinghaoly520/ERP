'use client';

import type { ScorePointSuggestion } from '@/lib/api/bid';

export type EditableSuggestion = ScorePointSuggestion & { selected: boolean };

type Props = {
  suggestion: EditableSuggestion;
  onToggleSelected: () => void;
  onChange: (patch: Partial<ScorePointSuggestion>) => void;
};

/** AI 提取得分点建议行：单项审核弹窗与一键提取分组弹窗共用 */
export function SuggestionRow({ suggestion: s, onToggleSelected, onChange }: Props) {
  const conf = s.confidence ?? 0;
  const confColor = conf >= 0.8 ? 'text-[#11a874]' : conf >= 0.5 ? 'text-[#f5a623]' : 'text-[#e74c3c]';
  return (
    <div
      className={`rounded-lg border px-2 py-2 text-sm ${s.duplicate ? 'border-[#fde68a] bg-[#fffbeb]' : s.adjusted ? 'border-[#fde68a] bg-[#fffdf5]' : 'border-[oklch(0.92_0.004_265)]'}`}
    >
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={s.selected} onChange={onToggleSelected} />
        <input
          className="min-w-[120px] flex-1 rounded border border-[oklch(0.9_0.005_264)] px-1.5 py-0.5"
          value={s.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <input
          type="number"
          min={0}
          step={0.5}
          className="w-16 rounded border border-[oklch(0.9_0.005_264)] px-1 py-0.5 text-right font-mono"
          value={s.fullScore}
          onChange={(e) => onChange({ fullScore: Number(e.target.value) })}
        />
        {s.adjusted && (
          <span title="分数被等比缩放" className="text-xs">
            ⚠️
          </span>
        )}
        <button
          onClick={() => onChange({ objective: !s.objective })}
          className={`rounded px-1.5 py-0.5 text-xs ${s.objective ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
        >
          {s.objective ? '客观' : '主观'}
        </button>
        <span className={`font-mono text-xs ${confColor}`} title={`信心分 ${conf}`}>
          {conf >= 0.8 ? '●●●' : conf >= 0.5 ? '●●○' : '●○○'}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-[oklch(0.55_0.01_264)]">
        {s.evidenceSection && (
          <span className="truncate" title={s.evidenceSection}>
            📎 {s.evidenceSection}
          </span>
        )}
        {s.evidenceHint && (
          <span className="truncate max-w-[200px]" title={s.evidenceHint}>
            {s.evidenceHint}
          </span>
        )}
        {s.duplicate && (
          <span className="rounded bg-[#fef3c7] px-1.5 py-0.5 text-[#92400e] font-bold">可能重复</span>
        )}
      </div>
    </div>
  );
}
