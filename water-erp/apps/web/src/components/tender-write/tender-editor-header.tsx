import { ChevronLeft, ChevronRight } from 'lucide-react';
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
    <div className="wb-panel py-2 pl-3.5 pr-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="rounded-[5px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color-mix(in_oklch,var(--accent)_75%,black)]">
            当前章节
          </span>
          <h2 className="text-[0.85rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {section.title}
          </h2>
          <p className="mt-0.5 text-[9px] leading-4 text-[color:var(--muted-foreground)]">{section.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onPrevious} disabled={isFirst} className="neu-btn-soft !px-2" title="上一组">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={onNext} disabled={isLast} className="neu-btn-soft !px-2" title="下一组">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
