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
    <div className="wb-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[rgba(96,139,239,0.12)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.82)]">
              当前章节
            </span>
            <span className="text-[11px] font-medium text-[color:var(--muted-foreground)]">
              {section.filledFields}/{section.totalFields} 已填写
            </span>
            <span className="rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[10px] font-medium text-[rgba(92,116,160,0.88)]">
              {statusText}
            </span>
          </div>
          <h2 className="mt-3 text-[1.1rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
            {section.title}
          </h2>
          <p className="mt-2 max-w-[58ch] text-sm leading-6 text-[color:var(--muted-foreground)]">
            {section.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onPrevious}
            disabled={isFirst}
            className="neu-btn-soft"
          >
            上一组
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={isLast}
            className="neu-btn-primary"
          >
            下一组
          </button>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[rgba(221,230,246,0.82)]">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(96,139,239,0.92),rgba(129,167,244,0.86))] tender-progress-bar"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
          {progressPercent}%
        </span>
      </div>
    </div>
  );
}
