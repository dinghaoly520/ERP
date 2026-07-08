import type { TenderSectionProgress, TenderSectionKey } from '@/lib/types/tender-write';

const sectionStateCopy = {
  idle: '未开始',
  completed: '已完成',
  'active-complete': '当前章节',
  'active-missing': '当前待补充',
  missing: '待完善',
} as const;

const sectionStateTone = {
  idle: 'border-[oklch(0.6_0.04_258_/_0.22)] bg-[oklch(1_0_0_/_0.35)] text-[color:var(--muted-foreground)]',
  completed:
    'border-[rgba(92,181,150,0.18)] bg-[rgba(92,181,150,0.08)] text-[rgba(78,150,124,1)]',
  'active-complete':
    'border-[rgba(96,139,239,0.22)] bg-[rgba(96,139,239,0.1)] text-[rgba(87,126,214,1)]',
  'active-missing':
    'border-[rgba(234,188,110,0.18)] bg-[rgba(234,188,110,0.12)] text-[rgba(191,142,52,1)]',
  missing:
    'border-[rgba(230,129,102,0.16)] bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]',
} as const;

export function TenderSectionNav({
  sections,
  activeSectionKey,
  onSelect,
}: {
  sections: TenderSectionProgress[];
  activeSectionKey: TenderSectionKey;
  onSelect: (key: TenderSectionKey) => void;
}) {
  const completedCount = sections.filter((section) => section.missingFields === 0).length;
  const totalMissing = sections.reduce((sum, section) => sum + section.missingFields, 0);
  const completionPercent = Math.round(
    (completedCount / Math.max(sections.length, 1)) * 100,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Summary — lightweight, no card frame */}
      <div className="px-1 pb-3" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          章节导航 · {completedCount}/{sections.length} 组已完成
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[oklch(0.55_0.03_258_/_0.1)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${completionPercent}%`,
                background: completionPercent === 100
                  ? 'oklch(0.6 0.13 164)'
                  : 'linear-gradient(90deg, oklch(0.5 0.16 258 / 0.9), oklch(0.6 0.1 258 / 0.7))',
              }}
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-[color:var(--muted-foreground)]">
            {completionPercent}%
          </span>
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 tender-scroll">
        {sections.map((section, index) => {
          const isActive = section.key === activeSectionKey;
          return (
            <button
              key={section.key}
              type="button"
              data-active={isActive}
              onClick={() => onSelect(section.key)}
              className={[
                'group relative w-full rounded-[10px] px-3 py-2.5 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(107,149,240,0.24)]',
                isActive
                  ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)]'
                  : 'hover:bg-[oklch(1_0_0_/_0.35)]',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        'inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-[6px] px-1.5 text-[10px] font-bold tracking-[0.04em] transition-all duration-300',
                        isActive
                          ? 'bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] text-[color:var(--accent)]'
                          : 'bg-[oklch(0.55_0.03_258_/_0.08)] text-[color:var(--muted-foreground)]',
                      ].join(' ')}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[13px] font-semibold leading-snug text-[color:var(--foreground)]">
                      {section.title}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 rounded-[6px] bg-[oklch(0.55_0.03_258_/_0.06)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[color:var(--muted-foreground)]">
                  {section.filledFields}/{section.totalFields}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span
                  className={[
                    'rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold',
                    sectionStateTone[section.state],
                  ].join(' ')}
                >
                  {sectionStateCopy[section.state]}
                </span>
                <span className="text-[10px] text-[color:var(--muted-foreground)]">
                  {section.missingFields === 0
                    ? '✓'
                    : `+${section.missingFields}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
