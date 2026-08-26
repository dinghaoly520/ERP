import {
  PROJECT_STAGE_STATUS_LABELS,
  type ProjectManagementStage,
  type ProjectWorkflowStageKey,
} from '@/lib/types/project-management';
import { Fragment, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw, X } from 'lucide-react';

type ArchiveStepState = 'PENDING' | 'READY' | 'DONE';

// 阶段 → CSS 变量映射，驱动卡片 per-stage 底色 / 节点 / 徽章 / 辉光
const STAGE_ACCENT_VARS: Record<string, string> = {
  procurement_demand: 'var(--stage-demand)',
  initiation: 'var(--stage-initiation)',
  tender_document: 'var(--stage-tender)',
  supplier_invitation: 'var(--stage-supplier)',
  public_announcement: 'var(--stage-announce)',
  expert_selection: 'var(--stage-expert)',
  bid_evaluation: 'var(--stage-evaluation)',
  award_decision: 'var(--stage-award)',
  contract: 'var(--stage-contract)',
};

type TimelineEntryBase = {
  key: string;
  orderLabel: string;
  title: string;
  statusLabel: string;
  summary: string;
  toneClassName: string;
  nodeClassName: string;
  progressLabel: string;
  progressClassName: string;
  accentClassName: string;
};

type SelectableTimelineEntry = TimelineEntryBase & {
  selectable: true;
  stageKey: ProjectWorkflowStageKey;
  round: number;
  isInProgress: boolean;
  isCompleted: boolean;
};

type ArchiveTimelineEntry = TimelineEntryBase & {
  selectable: false;
};

type TimelineEntry = SelectableTimelineEntry | ArchiveTimelineEntry;

function getArchiveStepCopy(state: ArchiveStepState) {
  switch (state) {
    case 'DONE':
      return '项目已归档完成';
    case 'READY':
      return '合同已完成，等待执行归档';
    default:
      return '合同完成后解锁';
  }
}

function getArchiveStepStatusLabel(state: ArchiveStepState) {
  switch (state) {
    case 'DONE':
      return '已归档';
    case 'READY':
      return '待归档';
    default:
      return '未解锁';
  }
}

// 阶段快捷操作标签
const STAGE_ACTION_LABELS: Record<string, string> = {
  PROCUREMENT_DEMAND: '采购需求编制',
  INITIATION: '项目立项',
  TENDER_DOCUMENT: '采购文件编写',
  SUPPLIER_INVITATION: '供应商邀请',
  PUBLIC_ANNOUNCEMENT: '公告制作与发布',
  EXPERT_SELECTION: '专家抽取',
  BID_EVALUATION: '开标确认',
  AWARD_DECISION: '文件制作',
  CONTRACT: '合同编制',
};

export function ProjectStageTimeline({
  stages,
  activeStageKey,
  activeRound,
  onSelect,
  onStageAction,
  showArchiveStep,
  archiveStepState,
  tenderDocxAttachments,
  onEditTenderFile,
  onReopenStage,
}: {
  stages: ProjectManagementStage[];
  activeStageKey: ProjectWorkflowStageKey;
  activeRound: number;
  onSelect: (stageKey: ProjectWorkflowStageKey, round: number) => void;
  onStageAction?: (stageKey: ProjectWorkflowStageKey) => void;
  showArchiveStep: boolean;
  archiveStepState: ArchiveStepState;
  tenderDocxAttachments?: Array<{ id: string; fileName: string }>;
  onEditTenderFile?: (attachmentId: string, fileName: string) => void;
  /** 重开已完成步骤：目标→进行中，后续→待解锁；由父组件调 API 后刷新。 */
  onReopenStage?: (stageKey: ProjectWorkflowStageKey, round: number) => Promise<void>;
}) {
  const entries: TimelineEntry[] = stages.map((stage): SelectableTimelineEntry => {
    const isCompleted = stage.status === 'COMPLETED';
    const isInProgress = stage.status === 'IN_PROGRESS';

    return {
      key: stage.id,
      orderLabel: String(stage.stageOrder).padStart(2, '0'),
      title: stage.stageName,
      statusLabel: PROJECT_STAGE_STATUS_LABELS[stage.status],
      summary: isCompleted
        ? '当前阶段已完成，可继续补充材料。'
        : isInProgress
          ? '当前推进阶段，完成后才会解锁下一步。'
          : '等待上一阶段完成后解锁。',
      toneClassName: isCompleted
        ? 'pm-stage-card--completed'
        : isInProgress
          ? 'pm-stage-card--current'
          : 'pm-stage-card--idle',
      nodeClassName: isCompleted
        ? 'pm-stage-node--completed'
        : isInProgress
          ? 'pm-stage-node--current'
          : 'pm-stage-node--idle',
      selectable: true,
      stageKey: stage.stageKey,
      round: stage.round ?? 1,
      isInProgress,
      isCompleted,
      progressLabel: isCompleted ? '已完成' : isInProgress ? '进行中' : '待解锁',
      progressClassName: isCompleted
        ? 'pm-stage-progress--completed'
        : isInProgress
          ? 'pm-stage-progress--current'
          : 'pm-stage-progress--idle',
      accentClassName: `pm-stage-accent--${stage.stageKey.toLowerCase()}`,
    };
  });

  if (showArchiveStep) {
    entries.push({
      key: 'archive-step',
      orderLabel: '归',
      title: '归档完成',
      statusLabel: getArchiveStepStatusLabel(archiveStepState),
      summary: getArchiveStepCopy(archiveStepState),
      toneClassName:
        archiveStepState === 'DONE'
          ? 'pm-stage-card--archive-done'
          : 'pm-stage-card--archive-ready',
      nodeClassName:
        archiveStepState === 'DONE'
          ? 'pm-stage-node--completed'
          : 'pm-stage-node--archive',
      selectable: false,
      progressLabel:
        archiveStepState === 'DONE'
          ? '已归档'
          : archiveStepState === 'READY'
            ? '待确认'
            : '未解锁',
      progressClassName:
        archiveStepState === 'DONE'
          ? 'pm-stage-progress--archive-done'
          : 'pm-stage-progress--archive-ready',
      accentClassName: 'pm-stage-accent--archive',
    } satisfies ArchiveTimelineEntry);
  }

  // 分组：采购阶段按 round 分；CONTRACT 跟随其所属轮次，紧跟定标排在右侧
  const groups: { label?: string; items: TimelineEntry[] }[] = [];
  const purchaseEntries = entries.filter((e) => e.selectable);
  const roundMap = new Map<number, TimelineEntry[]>();
  for (const e of purchaseEntries) {
    const r = (e as SelectableTimelineEntry).round;
    if (!roundMap.has(r)) roundMap.set(r, []);
    roundMap.get(r)!.push(e);
  }
  const sortedRounds = [...roundMap.keys()].sort((a, b) => a - b);
  const showRoundLabels = sortedRounds.length > 1;
  for (const r of sortedRounds) {
    groups.push({
      label: showRoundLabels ? (r === 1 ? '首轮采购' : `第 ${r} 轮`) : undefined,
      items: roundMap.get(r)!,
    });
  }
  const archiveEntry = entries.find((e) => !e.selectable);
  if (archiveEntry) groups.push({ items: [archiveEntry] });

  // #11 多轮分组折叠：旧轮默认收起，当前轮展开；round>1 显示"流标重采"
  const maxRound = sortedRounds.length > 0 ? sortedRounds[sortedRounds.length - 1] : 1;
  const [collapsedRounds, setCollapsedRounds] = useState<Set<number>>(
    new Set(sortedRounds.filter((r) => r < maxRound)),
  );

  // ── 重开已完成步骤：确认对话框状态 ──
  const [reopenTarget, setReopenTarget] = useState<{ key: ProjectWorkflowStageKey; round: number; title: string } | null>(null);
  const [reopening, setReopening] = useState(false);

  const confirmReopen = async () => {
    if (!reopenTarget || !onReopenStage) return;
    setReopening(true);
    try {
      await onReopenStage(reopenTarget.key, reopenTarget.round);
      setReopenTarget(null);
    } finally {
      setReopening(false);
    }
  };

  return (
    <div className="pm-stage-rail px-1 py-1 sm:px-2">
      {groups.map((group, gi) => (
        <Fragment key={gi}>
          {group.label && (() => {
            const round = (group.items[0] as any).round as number;
            const collapsed = collapsedRounds.has(round);
            return (
              <button
                type="button"
                onClick={() => setCollapsedRounds(prev => {
                  const next = new Set(prev);
                  collapsed ? next.delete(round) : next.add(round);
                  return next;
                })}
                className="flex items-center justify-center gap-2 py-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--muted-foreground)] w-full cursor-pointer hover:text-[var(--foreground)] transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.18)' }}>
                  {group.label}
                  {round > 1 && (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--warning) 14%, transparent)', color: 'var(--warning)' }}>
                      流标重采
                    </span>
                  )}
                </span>
                <span className="text-[9px]">{collapsed ? '▶' : '▼'}</span>
              </button>
            );
          })()}
          <div className="pm-stage-track" hidden={group.label && ((group.items as any)[0] as any)?.round > 0 ? collapsedRounds.has(((group.items as any)[0] as any)?.round) : undefined}>
            {group.items.map((entry, index) => {
              const isLastEntry = index === group.items.length - 1;
              const segmentClassName = [
                'pm-stage-track__segment',
                !isLastEntry ? 'pm-stage-track__segment--linked' : '',
              ]
                .filter(Boolean)
                .join(' ');

              if (entry.selectable) {
                const isSelected = entry.stageKey === activeStageKey && entry.round === activeRound;
                const stageKey = entry.stageKey;
                const actionLabel = STAGE_ACTION_LABELS[stageKey];

                return (
                  <div key={entry.key} className={segmentClassName}>
                    <button
                      type="button"
                      onClick={() => onSelect(stageKey, entry.round)}
                      data-selected={isSelected}
                      className={[
                        'pm-stage-card interactive-surface group relative flex min-h-[172px] min-w-0 flex-1 flex-col rounded-[28px] px-4 py-4 text-left',
                        entry.toneClassName,
                      ].join(' ')}
                      style={{ '--card-accent': STAGE_ACCENT_VARS[stageKey] ?? 'var(--accent)' } as React.CSSProperties}
                    >
                      <span aria-hidden="true" className="pm-stage-card__flow" />

                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={[
                            'pm-stage-node flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                            entry.nodeClassName,
                          ].join(' ')}
                          style={{ '--card-accent': STAGE_ACCENT_VARS[stageKey] ?? 'var(--accent)' } as React.CSSProperties}
                        >
                          {entry.orderLabel}
                        </span>
                        <div className="flex min-w-0 flex-col items-end gap-2 text-right">
                          {entry.isCompleted && !isSelected && onReopenStage ? (
                            /* 已完成徽章 → 可点击重开（卡片是 button，内层用 span role=button 避免嵌套 button 的 hydration 错误） */
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); setReopenTarget({ key: stageKey, round: entry.round, title: entry.title }); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setReopenTarget({ key: stageKey, round: entry.round, title: entry.title }); } }}
                              title="点击可将该步骤重新设置为进行中"
                              className={['pm-stage-progress pm-stage-progress--completed', 'cursor-pointer hover:brightness-95 active:scale-95 transition-all'].join(' ')}
                            >
                              已完成 ↺
                            </span>
                          ) : (
                            <span
                              className={['pm-stage-progress', isSelected ? 'pm-stage-progress--selected' : entry.progressClassName].join(' ')}
                              style={isSelected ? { background: 'oklch(0.78 0.122 83)', color: 'white' } : undefined}
                            >
                              {isSelected ? '当前选择' : entry.progressLabel}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex-1 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className={['pm-stage-card__title text-[13px] font-medium leading-5', entry.accentClassName].join(' ')}>
                            {entry.title}
                          </div>
                          <div className="mt-1.5 text-[10px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)] opacity-70">
                            {entry.statusLabel}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          {/* 步骤操作按钮仅对"进行中"步骤开放——已完成/待解锁均不可再操作 */}
                          {actionLabel && onStageAction && entry.isInProgress && entry.stageKey !== 'PROCUREMENT_DEMAND' && entry.stageKey !== 'INITIATION' && entry.stageKey !== 'CONTRACT' && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); onStageAction(stageKey); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onStageAction(stageKey); } }}
                              className="pm-stage-action-btn shrink-0"
                            >
                              {actionLabel}
                            </span>
                          )}
                          {onEditTenderFile && entry.isInProgress && stageKey === 'TENDER_DOCUMENT' && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (tenderDocxAttachments && tenderDocxAttachments.length > 0) {
                                  onEditTenderFile(tenderDocxAttachments[0].id, tenderDocxAttachments[0].fileName);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  if (tenderDocxAttachments && tenderDocxAttachments.length > 0) {
                                    onEditTenderFile(tenderDocxAttachments[0].id, tenderDocxAttachments[0].fileName);
                                  }
                                }
                              }}
                              className={[
                                'pm-stage-action-btn shrink-0',
                                (!tenderDocxAttachments || tenderDocxAttachments.length === 0) ? 'opacity-40 cursor-not-allowed' : '',
                              ].join(' ')}
                              title={(!tenderDocxAttachments || tenderDocxAttachments.length === 0) ? '请先在详情区上传 .docx 文件' : undefined}
                            >
                              {entry.title === '招标文件' ? '招标文件修改' : '采购文件修改'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 text-xs leading-6 text-[color:var(--muted-foreground)] sm:text-xs">
                        {entry.summary}
                      </div>
                    </button>
                  </div>
                );
              }

              return (
                <div key={entry.key} className={segmentClassName}>
                  <button
                    type="button"
                    data-archive-state={archiveStepState}
                    disabled
                    className={[
                      'pm-stage-card group relative flex min-h-[172px] min-w-0 flex-1 cursor-default flex-col rounded-[28px] px-4 py-4 text-left',
                      entry.toneClassName,
                    ].join(' ')}
                  >
                    <span
                      aria-hidden="true"
                      className={['pm-stage-card__flow', 'pm-stage-card__flow--archive'].join(' ')}
                    />
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={[
                          'pm-stage-node flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                          entry.nodeClassName,
                        ].join(' ')}
                      >
                        {entry.orderLabel}
                      </span>
                      <div className="flex min-w-0 flex-col items-end gap-2 text-right">
                        <span className={['pm-stage-progress', entry.progressClassName].join(' ')}>
                          {entry.progressLabel}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex-1">
                      <div className={['pm-stage-card__title text-[13px] font-medium leading-5', entry.accentClassName].join(' ')}>
                        {entry.title}
                      </div>
                      <div className="mt-1.5 text-[10px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)] opacity-70">
                        {entry.statusLabel}
                      </div>
                      <div className="mt-3 text-xs leading-6 text-[color:var(--muted-foreground)] sm:text-xs">
                        {entry.summary}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </Fragment>
      ))}

      {/* ══════ 重开已完成步骤确认对话框 ══════ */}
      {reopenTarget && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center" onClick={() => !reopening && setReopenTarget(null)}>
          <div className="absolute inset-0" style={{ background: 'oklch(0.975 0.012 258 / 0.6)', backdropFilter: 'blur(3px)' }} />
          <div className="relative z-10 mx-5 w-full max-w-[420px] rounded-[22px] p-6"
            style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 18px oklch(0.46 0.07 258 / 0.18)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                  style={{ background: 'color-mix(in oklch, var(--warning) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                  <RotateCcw size={17} className="text-[var(--warning)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">重新设置为进行中</div>
                  <div className="text-[11px] text-[color:var(--muted-foreground)]">{reopenTarget.title}</div>
                </div>
              </div>
              <button type="button" onClick={() => !reopening && setReopenTarget(null)} className="neu-btn-xs"><X size={16} /></button>
            </div>
            <p className="text-sm leading-6 text-[color:var(--muted-foreground)] mb-3">
              将「{reopenTarget.title}」重新设置为进行中？该步骤之后的<b>所有步骤将重置为待解锁</b>。
            </p>
            <div className="rounded-[10px] px-3.5 py-2.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)] mb-4"
              style={{ background: 'color-mix(in oklch, var(--success) 7%, transparent)' }}>
              <span className="font-semibold text-[color:var(--success)]">保留内容：</span>已上传的文件、文件分析与步骤检查的结果均会保留，不会删除。
            </div>
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto flex items-center gap-1 text-[10px] text-[color:var(--danger)]"><AlertTriangle size={11} />后续步骤需重新推进</span>
              <button type="button" onClick={() => setReopenTarget(null)} disabled={reopening} className="neu-btn-soft gap-1.5">取消</button>
              <button type="button" onClick={() => void confirmReopen()} disabled={reopening} className="neu-btn-soft gap-1.5">
                {reopening ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {reopening ? '处理中…' : '确认重开'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
