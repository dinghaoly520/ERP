import {
  buildWorkbenchOverview,
  buildTaskFlowGroups,
  deriveReminderState,
  selectTaskIdsFromWorkbenchSignal,
} from '../../lib/work-arrangements/workbench';
import type {
  WorkArrangementDailyPlan,
  WorkArrangementItem,
} from '../../lib/types/work-arrangements';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const items: WorkArrangementItem[] = [
  {
    id: 'task-focus',
    title: '完成投标澄清',
    description: '今天中午前给出回复',
    type: 'FOLLOW_UP',
    urgency: 'CRITICAL',
    status: 'TODO',
    dueAt: '2026-05-13T10:00:00.000Z',
    reminderAt: '2026-05-13T08:30:00.000Z',
    estimatedMinutes: 45,
    isAllDay: false,
    customTags: ['今日重点'],
    recurrence: 'NONE',
    completionSummary: null,
    reflectionSummary: null,
    completedAt: null,
    createdAt: '2026-05-12T08:00:00.000Z',
    updatedAt: '2026-05-13T07:50:00.000Z',
    notes: [],
    template: null,
    projectManagementItem: null,
    dependencies: [],
  },
  {
    id: 'task-progress',
    title: '整理谈判纪要',
    description: null,
    type: 'WRITING',
    urgency: 'MEDIUM',
    status: 'IN_PROGRESS',
    dueAt: '2026-05-14T09:00:00.000Z',
    reminderAt: null,
    estimatedMinutes: 60,
    isAllDay: false,
    customTags: [],
    recurrence: 'NONE',
    completionSummary: null,
    reflectionSummary: null,
    completedAt: null,
    createdAt: '2026-05-12T10:00:00.000Z',
    updatedAt: '2026-05-13T06:30:00.000Z',
    notes: [
      {
        id: 'note-1',
        type: 'PROGRESS',
        content: '已完成第一版纪要。',
        createdAt: '2026-05-13T06:00:00.000Z',
        updatedAt: '2026-05-13T06:00:00.000Z',
      },
    ],
    template: null,
    projectManagementItem: null,
    dependencies: [],
  },
  {
    id: 'task-blocked',
    title: '提交归档材料',
    description: null,
    type: 'ARCHIVE',
    urgency: 'HIGH',
    status: 'BLOCKED',
    dueAt: '2026-05-12T09:00:00.000Z',
    reminderAt: '2026-05-12T08:30:00.000Z',
    estimatedMinutes: 30,
    isAllDay: false,
    customTags: [],
    recurrence: 'NONE',
    completionSummary: null,
    reflectionSummary: null,
    completedAt: null,
    createdAt: '2026-05-12T07:00:00.000Z',
    updatedAt: '2026-05-12T07:30:00.000Z',
    notes: [],
    template: null,
    projectManagementItem: null,
    dependencies: [],
  },
];

const dailyPlan: WorkArrangementDailyPlan = {
  date: '2026-05-13T00:00:00.000Z',
  headerGreeting: '早上好',
  namePraise: '今日继续保持高效推进。',
  dailyGreeting: '新的一天，加油。',
  riskSummary: '提交归档材料已超时，且处于受阻状态。',
  aiSuggestion: '下午补齐纪要并确认归档阻塞原因。',
  overview: '今天优先处理高紧急跟进，再清理阻塞事项。',
  focusItems: [
    {
      id: 'task-focus',
      title: '完成投标澄清',
      reason: '到期时间最早，且影响后续答疑。',
      priorityRank: 1,
    },
  ],
  timeBlocks: [
    {
      label: '上午答疑',
      start: '09:00',
      end: '10:00',
      focus: '优先完成投标澄清并同步材料。',
      taskIds: ['task-focus', 'task-progress'],
    },
  ],
  riskAlerts: ['提交归档材料已超时，且处于受阻状态。'],
  completionAdvice: '下午补齐纪要并确认归档阻塞原因。',
  projectBrief: '',
};

assert(
  deriveReminderState(items[0], new Date('2026-05-13T08:00:00.000Z')) === 'UPCOMING',
  '即将提醒任务状态不正确',
);
assert(
  deriveReminderState(items[2], new Date('2026-05-13T08:00:00.000Z')) === 'OVERDUE',
  '超时提醒任务状态不正确',
);

const overview = buildWorkbenchOverview(
  items,
  dailyPlan,
  new Date('2026-05-13T08:00:00.000Z'),
);
assert(overview.todoCount === 1, '待处理数量应为 1');
assert(overview.inProgressCount === 1, '进行中数量应为 1');
assert(overview.dueTodayCount === 1, '今日到期数量应为 1');
assert(overview.riskCount === 1, '风险数量应为 1');

const groups = buildTaskFlowGroups(
  items,
  items,
  dailyPlan,
  new Date('2026-05-13T08:00:00.000Z'),
);
assert(groups[0]?.key === 'FOCUS', '首个分组应为 AI 优先事项');
assert(groups[0]?.items[0]?.id === 'task-focus', '今日重点分组应包含 focus 任务');
assert(groups[2]?.key === 'TODO', '第三个分组应为待处理');
const blockedGroup = groups.find((group) => group.key === 'BLOCKED');
assert(blockedGroup?.items.some((item) => item.id === 'task-blocked'), '受阻分组应包含超时受阻任务');

const timeBlockSelection = selectTaskIdsFromWorkbenchSignal({
  type: 'TIME_BLOCK',
  taskIds: ['task-focus', 'task-progress'],
});
assert(timeBlockSelection.length === 2, '时间块联动应返回两个任务');

const summarySignalSelection = selectTaskIdsFromWorkbenchSignal({
  type: 'SUMMARY',
  filter: 'RISK',
});
assert(Array.isArray(summarySignalSelection), '摘要联动返回值必须是数组');

const focusSelection = selectTaskIdsFromWorkbenchSignal({
  type: 'FOCUS_ITEM',
  taskId: 'task-focus',
});
assert(focusSelection[0] === 'task-focus', '焦点任务联动应返回单个任务 id');

const emptyOverview = buildWorkbenchOverview(
  [],
  null,
  new Date('2026-05-13T08:00:00.000Z'),
);
assert(emptyOverview.overview.includes('今天'), '空数据时也应返回默认概览文案');
assert(
  deriveReminderState(items[0], new Date('2026-05-13T08:20:00.000Z')) === 'DUE_NOW',
  '15 分钟内提醒应视为 DUE_NOW',
);

console.log('work-arrangements-workbench-check:ok');
