import {
  PROJECT_MANAGEMENT_STATUS_LABELS,
  PROJECT_STAGE_STATUS_LABELS,
  type ProjectManagementItem,
} from '@/lib/types/project-management';

export function ProjectCard({
  item,
  onOpen,
}: {
  item: ProjectManagementItem;
  onOpen: () => void;
}) {
  const completedCount = item.stages.filter(
    (stage) => stage.status === 'COMPLETED',
  ).length;
  const currentStage =
    item.stages.find((stage) => stage.stageKey === item.currentStage) ?? item.stages[0];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="pm-list-card group relative w-full overflow-hidden rounded-[24px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(244,248,255,0.74))] p-5 text-left shadow-[0_18px_36px_rgba(65,96,154,0.08)] transition-[transform,box-shadow,border-color] duration-300 ease-[var(--ease-out-quint,cubic-bezier(0.22,1,0.36,1))] hover:-translate-y-1 hover:border-white/80 hover:shadow-[0_26px_52px_rgba(62,95,155,0.14),0_0_0_1px_rgba(113,152,242,0.08),inset_0_1px_0_rgba(255,255,255,0.96)] active:translate-y-0 active:shadow-[0_14px_28px_rgba(65,96,154,0.08)]"
    >
      {/* Subtle inner glow on hover */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(108,152,246,0.06), transparent)' }} />
      {/* Light sweep effect */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
        <span className="pm-list-card__sheen absolute inset-0" />
      </span>
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)] transition-colors duration-200 group-hover:text-[color:var(--accent)]">
            {item.title}
          </div>
          <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            {item.requesterDepartment} · {item.requesterName}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-[rgba(122,168,255,0.12)] px-3 py-1 text-[11px] font-semibold text-[color:var(--accent)] transition-colors duration-200 group-hover:bg-[rgba(122,168,255,0.18)]">
            {PROJECT_MANAGEMENT_STATUS_LABELS[item.status]}
          </span>
          {item.createdByName && (
            <span className="text-[10px] text-[color:var(--muted-foreground)] bg-white/60 rounded-full px-2 py-0.5">
              {item.createdByName}
            </span>
          )}
        </div>
      </div>
      <div className="relative mt-4 grid gap-2 text-sm text-[color:var(--muted-foreground)] sm:grid-cols-2">
        <div>采购方式：{item.procurementMethod || '待补充'}</div>
        <div>预算金额：{item.budgetAmount.toLocaleString('zh-CN')}</div>
        <div>当前阶段：{currentStage?.stageName ?? item.currentStage}</div>
        <div>阶段状态：{PROJECT_STAGE_STATUS_LABELS[currentStage?.status ?? 'NOT_STARTED']}</div>
      </div>
      <div className="relative mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
          <span>流程进度</span>
          <span>
            {completedCount}/{item.stages.length}
          </span>
        </div>
        <div className="flex gap-2">
          {item.stages.map((stage) => {
            const status = stage.status;
            return (
              <div
                key={stage.stageKey}
                className={[
                  'h-2 rounded-full transition-all duration-300 min-w-0 flex-1',
                  status === 'COMPLETED'
                    ? 'bg-[rgba(92,181,150,1)] shadow-[0_0_6px_rgba(92,181,150,0.3)]'
                    : status === 'IN_PROGRESS'
                      ? 'bg-[rgba(96,139,239,0.2)] border border-[rgba(96,139,239,0.8)] group-hover:border-[rgba(96,139,239,1)] group-hover:shadow-[0_0_8px_rgba(96,139,239,0.2)]'
                      : 'bg-white border border-[rgba(150,165,195,0.5)]',
                ].join(' ')}
              />
            );
          })}
        </div>
      </div>
    </button>
  );
}
