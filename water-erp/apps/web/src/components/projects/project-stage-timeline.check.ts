import { PROJECT_WORKFLOW_STAGES } from '../../lib/types/project-management';

type ArchiveStepState = 'PENDING' | 'READY' | 'DONE';

type TimelineStage = {
  id: string;
  stageKey: string;
  stageName: string;
  stageOrder: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
};

type TimelineItem =
  | {
      kind: 'workflow';
      key: string;
      label: string;
      orderLabel: string;
      statusLabel: string;
      tone: 'completed' | 'active' | 'idle';
      summary: string;
      showConnector: boolean;
    }
  | {
      kind: 'archive';
      key: 'ARCHIVE_COMPLETION';
      label: '归档完成';
      orderLabel: '归';
      statusLabel: string;
      tone: 'done' | 'ready';
      summary: string;
      showConnector: boolean;
    };

const PROJECT_STAGE_STATUS_LABELS: Record<
  TimelineStage['status'],
  string
> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
};

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

export function buildTimelineItems(
  stages: TimelineStage[],
  showArchiveStep: boolean,
  archiveStepState: ArchiveStepState,
): TimelineItem[] {
  const workflowItems: TimelineItem[] = stages.map((stage, index) => {
    const isCompleted = stage.status === 'COMPLETED';
    const isInProgress = stage.status === 'IN_PROGRESS';

    return {
      kind: 'workflow',
      key: stage.stageKey,
      label: stage.stageName,
      orderLabel: String(stage.stageOrder).padStart(2, '0'),
      statusLabel: PROJECT_STAGE_STATUS_LABELS[stage.status],
      tone: isCompleted ? 'completed' : isInProgress ? 'active' : 'idle',
      summary: isCompleted
        ? '当前阶段已完成，可继续补充材料。'
        : isInProgress
          ? '当前推进阶段，完成后才会解锁下一步。'
          : '等待上一阶段完成后解锁。',
      showConnector: index < stages.length - 1 || showArchiveStep,
    };
  });

  if (!showArchiveStep) {
    return workflowItems;
  }

  return [
    ...workflowItems,
    {
      kind: 'archive',
      key: 'ARCHIVE_COMPLETION',
      label: '归档完成',
      orderLabel: '归',
      statusLabel: archiveStepState === 'DONE' ? '已归档' : '待归档',
      tone: archiveStepState === 'DONE' ? 'done' : 'ready',
      summary: getArchiveStepCopy(archiveStepState),
      showConnector: false,
    },
  ];
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const stages: TimelineStage[] = PROJECT_WORKFLOW_STAGES.map((stage, index) => ({
  id: `stage-${stage.key}`,
  stageKey: stage.key,
  stageName: stage.label,
  stageOrder: index + 1,
  status: index < 5 ? 'COMPLETED' : 'IN_PROGRESS',
}));

const withoutArchive = buildTimelineItems(stages, false, 'PENDING');
assert(withoutArchive.length === 6, '应该只保留六个主流程步骤');
assert(
  withoutArchive.every((item) => item.kind === 'workflow'),
  '未解锁归档时不应出现额外步骤',
);
assert(
  withoutArchive[withoutArchive.length - 1]?.showConnector === false,
  '六步流程的最后一步不应额外连接到不存在的步骤',
);

const withArchive = buildTimelineItems(stages, true, 'READY');
assert(withArchive.length === 7, '合同完成后应追加一个额外归档步骤');
assert(
  withArchive.filter((item) => item.kind === 'workflow').length === 6,
  '额外归档步骤不能计入六步主流程',
);
const archiveItem = withArchive[withArchive.length - 1];
assert(archiveItem.kind === 'archive', '最后一个步骤应为归档完成');
assert(archiveItem.label === '归档完成', '额外步骤标题应为归档完成');
assert(
  archiveItem.summary === '合同已完成，等待执行归档',
  '归档待处理状态文案不正确',
);
assert(
  withArchive[withArchive.length - 2]?.showConnector === true,
  '合同步骤应连接到额外归档步骤',
);

console.log('timeline-check:ok');
