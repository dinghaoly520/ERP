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
    <div className="flex h-full min-h-0 flex-col rounded-[20px] neu-card-static !rounded-[20px] p-3">
      <div className="rounded-[16px] bg-[oklch(1_0_0_/_0.35)] px-3 py-3" style={{ border: "1px solid oklch(0.6 0.04 258 / 0.18)" }}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(90,122,186,0.76)]">
          章节导航
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[color:var(--muted-foreground)]">
          <span>已完成 {completedCount}/{sections.length} 组</span>
          <span>待补充 {totalMissing} 项</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[rgba(221,230,246,0.82)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(96,139,239,0.9),rgba(132,168,244,0.84))] tender-progress-bar"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          <span className="text-[11px] font-semibold text-[rgba(92,116,160,0.92)]">
            {completionPercent}%
          </span>
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 tender-scroll">
        {sections.map((section, index) => {
          const isActive = section.key === activeSectionKey;
          return (
            <button
              key={section.key}
              type="button"
              data-active={isActive}
              onClick={() => onSelect(section.key)}
              className={[
                'tender-nav-card group relative w-full rounded-[20px] border px-3.5 py-3.5 text-left transition-all duration-300 tender-card-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(107,149,240,0.24)]',
                isActive
                  ? 'border-[rgba(107,149,240,0.34)] bg-[linear-gradient(145deg,rgba(241,247,255,0.99),rgba(232,240,255,0.9))] shadow-[0_14px_28px_rgba(78,110,168,0.12)]'
                  : 'border-[oklch(0.6_0.04_258_/_0.18)] bg-[oklch(1_0_0_/_0.35)] hover:border-[oklch(0.6_0.04_258_/_0.3)] hover:bg-[oklch(1_0_0_/_0.55)]',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        'inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-full px-2 text-[10px] font-semibold tracking-[0.08em] transition-all duration-300',
                        isActive
                          ? 'bg-[rgba(96,139,239,0.16)] text-[rgba(96,139,239,1)]'
                          : 'bg-[oklch(1_0_0_/_0.55)] text-[rgba(96,118,160,0.84)]',
                      ].join(' ')}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(96,139,239,0.72)]">
                      第 {index + 1} 组
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                    {section.title}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                    {section.description}
                  </div>
                </div>
                <span className="rounded-full border border-[oklch(0.6_0.04_258_/_0.22)] bg-[oklch(1_0_0_/_0.55)] px-2 py-1 text-[10px] font-semibold text-[color:var(--muted-foreground)]">
                  {section.filledFields}/{section.totalFields}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span
                  className={[
                    'rounded-full border px-2.5 py-1 text-[10px] font-semibold tender-status-badge',
                    sectionStateTone[section.state],
                  ].join(' ')}
                >
                  {sectionStateCopy[section.state]}
                </span>
                <span className="text-[11px] text-[color:var(--muted-foreground)]">
                  {section.missingFields === 0
                    ? '本组已填写完成'
                    : `还差 ${section.missingFields} 项`}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
