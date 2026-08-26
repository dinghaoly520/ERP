import {
  PROJECT_MANAGEMENT_STATUS_LABELS,
  type ProjectManagementItem,
} from '@/lib/types/project-management';

// 阶段 → CSS 变量映射（与流程卡片保持一致）
const STAGE_COLOR: Record<string, string> = {
  PROCUREMENT_DEMAND: 'var(--stage-demand)',
  INITIATION: 'var(--stage-initiation)',
  TENDER_DOCUMENT: 'var(--stage-tender)',
  SUPPLIER_INVITATION: 'var(--stage-supplier)',
  PUBLIC_ANNOUNCEMENT: 'var(--stage-announce)',
  EXPERT_SELECTION: 'var(--stage-expert)',
  BID_EVALUATION: 'var(--stage-evaluation)',
  AWARD_DECISION: 'var(--stage-award)',
  CONTRACT: 'var(--stage-contract)',
};

export function ProjectCard({
  item,
  onOpen,
  variant = 'active',
}: {
  item: ProjectManagementItem;
  onOpen: () => void;
  variant?: 'active' | 'archived';
}) {
  const completedCount = item.stages.filter(
    (stage) => stage.status === 'COMPLETED',
  ).length;
  const currentStage =
    item.stages.find((stage) => stage.stageKey === item.currentStage) ?? item.stages[0];
  const currentStageColor = STAGE_COLOR[currentStage?.stageKey ?? ''] ?? 'var(--accent)';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="neu-card group relative w-full p-5 text-left"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)] transition-colors duration-200 group-hover:text-[color:var(--accent)]">
              {item.title}
            </span>
            {item.projectCode && (
              <span className="inline-flex items-center rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2 py-0.5 font-mono text-[10px] font-bold tracking-tight text-[color:var(--accent-strong)]">
                {item.projectCode}
              </span>
            )}
          </div>
          <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            {item.requesterDepartment} · {item.requesterName}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3 py-1 text-[11px] font-semibold text-[color:var(--accent)] transition-colors duration-200 group-hover:bg-[color-mix(in_oklch,var(--accent)_18%,transparent)]">
            {PROJECT_MANAGEMENT_STATUS_LABELS[item.status]}
          </span>
          {item.reviewStatus === 'PENDING' && (
            <span className="rounded-full bg-[color-mix(in_oklch,oklch(0.75_0.14_75)_22%,transparent)] px-3 py-1 text-[11px] font-semibold text-[oklch(0.5_0.12_75)]">
              待审核
            </span>
          )}
          {item.reviewStatus === 'APPROVED' && (
            <span className="rounded-full bg-[color-mix(in_oklch,oklch(0.72_0.14_155)_18%,transparent)] px-3 py-1 text-[11px] font-semibold text-[oklch(0.48_0.12_155)]">
              审核通过
            </span>
          )}
          {item.reviewStatus === 'REJECTED' && (
            <span className="rounded-full bg-[color-mix(in_oklch,oklch(0.65_0.17_25)_16%,transparent)] px-3 py-1 text-[11px] font-semibold text-[oklch(0.5_0.16_25)]">
              已驳回
            </span>
          )}
          {item.createdByName && (
            <span className="text-[11px] text-[color:var(--muted-foreground)] bg-[oklch(1_0_0_/_0.4)] rounded-full px-2 py-0.5">
              经办人：{item.createdByName}
            </span>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-[color:var(--muted-foreground)] sm:grid-cols-2">
        <div>采购方式：{item.procurementMethod || '待补充'}</div>
        <div>采购类别：{item.procurementCategory || '待补充'}</div>
        <div>预算金额：{item.budgetAmount.toLocaleString('zh-CN')}</div>
        <div>
          当前阶段：<span className="font-semibold" style={{ color: currentStageColor }}>{currentStage?.stageName ?? item.currentStage}</span>
        </div>
      </div>
      {variant === 'archived' ? (
        <div className="mt-4 rounded-xl px-3 py-2.5 flex items-center gap-4 text-xs"
          style={{ background: 'color-mix(in oklch, var(--success) 6%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
          <span className="text-[color:var(--success)] font-bold">已归档</span>
          {item.contractAmount != null && (
            <span className="text-[color:var(--muted-foreground)]">合同金额 <strong className="tabular-nums text-[color:var(--foreground)]">{item.contractAmount.toLocaleString('zh-CN')} 元</strong></span>
          )}
          {item.updatedAt && (
            <span className="ml-auto text-[color:var(--muted-foreground)]">{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</span>
          )}
        </div>
      ) : (
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
      )}
    </button>
  );
}
