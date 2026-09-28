'use client';

import { Paperclip, TriangleAlert } from 'lucide-react';
import type { ScorePointSuggestion } from '@/lib/api/bid';

export type EditableSuggestion = ScorePointSuggestion & { selected: boolean };

type Props = {
  suggestion: EditableSuggestion;
  onToggleSelected: () => void;
  onChange: (patch: Partial<ScorePointSuggestion>) => void;
};

/** 客观/主观色调胶囊（2026-09-28 P2 cgzxui 迁移：与 score-points-editor 同款） */
const objPillCls = (objective: boolean) =>
  `rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
    objective
      ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent-strong)]'
      : 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[oklch(0.52_0.13_70)]'
  }`;

/** AI 提取得分点建议行：单项审核弹窗与一键提取分组弹窗共用。
 *  2026-09-28 P2 cgzxui 迁移：描边容器→色调底、emoji→Lucide、hex 色板→token。 */
export function SuggestionRow({ suggestion: s, onToggleSelected, onChange }: Props) {
  const conf = s.confidence ?? 0;
  const confColor = conf >= 0.8 ? 'text-[var(--success)]' : conf >= 0.5 ? 'text-[oklch(0.52_0.13_70)]' : 'text-[var(--danger)]';
  return (
    <div
      className={`rounded-[10px] px-2 py-2 text-sm ${
        s.duplicate
          ? 'bg-[color-mix(in_oklch,var(--warning)_10%,transparent)]'
          : s.adjusted
            ? 'bg-[color-mix(in_oklch,var(--warning)_5%,transparent)]'
            : 'bg-[oklch(1_0_0_/_0.55)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <input type="checkbox" className="neu-checkbox shrink-0" checked={s.selected} onChange={onToggleSelected} />
        <input
          className="workbench-input min-w-[120px] flex-1 !h-7 !px-1.5 !text-xs"
          value={s.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <input
          type="number"
          min={0}
          step={0.5}
          className="workbench-input w-16 !h-7 !px-1 !text-xs text-right font-mono"
          value={s.fullScore}
          onChange={(e) => onChange({ fullScore: Number(e.target.value) })}
        />
        {s.adjusted && (
          <TriangleAlert size={12} className="shrink-0 text-[color-mix(in_oklch,var(--warning)_82%,var(--foreground))]" aria-label="分数被等比缩放" />
        )}
        <button
          onClick={() => onChange({ objective: !s.objective })}
          className={objPillCls(s.objective)}
        >
          {s.objective ? '客观' : '主观'}
        </button>
        <span className={`font-mono text-xs ${confColor}`} title={`信心分 ${conf}`}>
          {conf >= 0.8 ? '●●●' : conf >= 0.5 ? '●●○' : '●○○'}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        {s.evidenceSection && (
          <span className="flex min-w-0 items-center gap-1 truncate" title={s.evidenceSection}>
            <Paperclip size={11} className="shrink-0" /> {s.evidenceSection}
          </span>
        )}
        {s.evidenceHint && (
          <span className="max-w-[200px] truncate" title={s.evidenceHint}>
            {s.evidenceHint}
          </span>
        )}
        {s.duplicate && (
          <span className="rounded-full bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[oklch(0.46_0.1_70)]">可能重复</span>
        )}
      </div>
    </div>
  );
}
