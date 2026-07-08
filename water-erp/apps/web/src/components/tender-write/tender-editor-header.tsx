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
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 px-3.5">
      <h2 className="text-[0.85rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
        {section.title}
      </h2>
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
  );
}
