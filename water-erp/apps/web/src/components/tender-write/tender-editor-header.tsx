import type { TenderSectionProgress } from '@/lib/types/tender-write';

export function TenderEditorHeader({
  section,
  onPrevious,
  onNext,
  isFirst,
  isLast,
}: {
  section: TenderSectionProgress;
  onPrevious: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const progressPercent = Math.round(
    (section.filledFields / Math.max(section.totalFields, 1)) * 100,
  );
  const remainingFields = Math.max(section.totalFields - section.filledFields, 0);
  const statusText =
    remainingFields === 0
      ? '本节已完成，可继续检查与润色内容。'
      : `还差 ${remainingFields} 项即可完成本节填写。`;

  return (
    <div className="wb-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[5px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color-mix(in_oklch,var(--accent)_75%,black)]">
              当前章节
            </span>
            <span className="text-[11px] font-medium tabular-nums text-[color:var(--muted-foreground)]">
              {section.filledFields}/{section.totalFields}
            </span>
            {remainingFields > 0 && (
              <span className="text-[10px] text-[color:var(--muted-foreground)]">{statusText}</span>
            )}
          </div>
          <h2 className="mt-2 text-[0.85rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {section.title}
          </h2>
          <p className="mt-1.5 max-w-[58ch] text-xs leading-5 text-[color:var(--muted-foreground)]">
            {section.description}
          </p>
        </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onPrevious}
              disabled={isFirst}
              className="neu-btn-soft !h-[36px] !px-4 !min-w-0"
            >
              上一组
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={isLast}
              className="neu-btn-primary !h-[36px] !px-4 !min-w-0"
            >
              下一组
            </button>
          </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[oklch(0.55_0.03_258_/_0.1)]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPercent}%`,
              background: progressPercent === 100
                ? 'oklch(0.6 0.13 164)'
                : 'linear-gradient(90deg, oklch(0.5 0.16 258 / 0.9), oklch(0.6 0.1 258 / 0.7))',
            }}
          />
        </div>
        <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
          {progressPercent}%
        </span>
      </div>
    </div>
  );
}
