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

  return (
    <div className="wb-panel py-2.5 px-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.85rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {section.title}
          </h2>
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
      <div className="mt-3 flex items-center gap-3">
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
