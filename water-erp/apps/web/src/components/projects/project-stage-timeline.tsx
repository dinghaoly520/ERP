import {
  PROJECT_STAGE_STATUS_LABELS,
  type ProjectManagementStage,
  type ProjectWorkflowStageKey,
} from '@/lib/types/project-management';

type ArchiveStepState = 'PENDING' | 'READY' | 'DONE';

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
  isInProgress: boolean;
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
  BID_EVALUATION: '开评标管理',
  AWARD_DECISION: '中标通知书制作',
  CONTRACT: '合同编制',
};

export function ProjectStageTimeline({
  stages,
  activeStageKey,
  onSelect,
  onStageAction,
  showArchiveStep,
  archiveStepState,
  tenderDocxAttachments,
  onEditTenderFile,
}: {
  stages: ProjectManagementStage[];
  activeStageKey: ProjectWorkflowStageKey;
  onSelect: (stageKey: ProjectWorkflowStageKey) => void;
  onStageAction?: (stageKey: ProjectWorkflowStageKey) => void;
  showArchiveStep: boolean;
  archiveStepState: ArchiveStepState;
  tenderDocxAttachments?: Array<{ id: string; fileName: string }>;
  onEditTenderFile?: (attachmentId: string, fileName: string) => void;
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
      isInProgress,
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

  return (
    <div className="pm-stage-rail px-1 py-1 sm:px-2">
      <div className="pm-stage-track">
        {entries.map((entry, index) => {
          const isLastEntry = index === entries.length - 1;
          const segmentClassName = [
            'pm-stage-track__segment',
            !isLastEntry ? 'pm-stage-track__segment--linked' : '',
          ]
            .filter(Boolean)
            .join(' ');

          if (entry.selectable) {
            const isSelected = entry.stageKey === activeStageKey;
            const stageKey = entry.stageKey;
            const actionLabel = STAGE_ACTION_LABELS[stageKey];

            return (
              <div key={entry.key} className={segmentClassName}>
                <button
                  type="button"
                  onClick={() => onSelect(stageKey)}
                  data-selected={isSelected}
                  className={[
                    'pm-stage-card interactive-surface group relative flex min-h-[172px] min-w-0 flex-1 flex-col rounded-[28px] px-4 py-4 text-left',
                    entry.toneClassName,
                  ].join(' ')}
                >
                  <span aria-hidden="true" className="pm-stage-card__flow" />

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

                  <div className="mt-4 flex-1 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className={['pm-stage-card__title text-[15px] font-semibold leading-6 sm:text-[15px]', entry.accentClassName].join(' ')}>
                        {entry.title}
                      </div>
                      <div className="mt-2 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)] sm:text-[11px]">
                        {entry.statusLabel}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      {actionLabel && onStageAction && entry.stageKey !== 'PROCUREMENT_DEMAND' && entry.stageKey !== 'INITIATION' && (
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
                      {/* 采购文件修改按钮 — 仅 TENDER_DOCUMENT 阶段，始终显示（无附件时禁用） */}
                      {onEditTenderFile && stageKey === 'TENDER_DOCUMENT' && (
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
                  <div className={['pm-stage-card__title text-[15px] font-semibold leading-6 sm:text-[15px]', entry.accentClassName].join(' ')}>
                    {entry.title}
                  </div>
                  <div className="mt-2 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)] sm:text-[11px]">
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
    </div>
  );
}
