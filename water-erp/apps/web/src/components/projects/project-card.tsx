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
      className="neu-card group relative w-full p-5 text-left"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)] transition-colors duration-200 group-hover:text-[color:var(--accent)]">
            {item.title}
          </div>
          <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            {item.requesterDepartment} · {item.requesterName}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3 py-1 text-[11px] font-semibold text-[color:var(--accent)] transition-colors duration-200 group-hover:bg-[color-mix(in_oklch,var(--accent)_18%,transparent)]">
            {PROJECT_MANAGEMENT_STATUS_LABELS[item.status]}
          </span>
          {item.createdByName && (
            <span className="text-[10px] text-[color:var(--muted-foreground)] bg-[oklch(1_0_0_/_0.4)] rounded-full px-2 py-0.5">
              {item.createdByName}
            </span>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-[color:var(--muted-foreground)] sm:grid-cols-2">
        <div>采购方式：{item.procurementMethod || '待补充'}</div>
        <div>预算金额：{item.budgetAmount.toLocaleString('zh-CN')}</div>
        <div>当前阶段：{currentStage?.stageName ?? item.currentStage}</div>
        <div>阶段状态：{PROJECT_STAGE_STATUS_LABELS[currentStage?.status ?? 'NOT_STARTED']}</div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
          <span>流程进度</span>
          <span>
            {completedCount}/{item.stages.length}
          </span>
        </div>
        <div className="flex gap-2">
          {item.stages.map((stage, idx) => {
            const status = stage.status;
            return (
              <div
                key={`${stage.stageKey}-${stage.round ?? 1}-${idx}`}
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
