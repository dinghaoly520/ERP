import type {
  WorkArrangementDailyPlan,
  WorkArrangementItem,
  WorkArrangementReminderState,
  WorkArrangementTaskFlowGroup,
  WorkArrangementWorkbenchOverview,
  WorkArrangementWorkbenchSignal,
} from '@/lib/types/work-arrangements';

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function deriveReminderState(
  item: WorkArrangementItem,
  now: Date,
): WorkArrangementReminderState {
  if (!item.reminderAt) {
    return 'NONE';
  }

  const reminderAt = new Date(item.reminderAt);
  const deltaMs = reminderAt.getTime() - now.getTime();

  if (deltaMs < 0) {
    return 'OVERDUE';
  }

  if (deltaMs <= 15 * 60 * 1000) {
    return 'DUE_NOW';
  }

  if (deltaMs <= 2 * 60 * 60 * 1000) {
    return 'UPCOMING';
  }

  return 'NONE';
}

export function buildWorkbenchOverview(
  items: WorkArrangementItem[],
  dailyPlan: WorkArrangementDailyPlan | null,
  now: Date,
): WorkArrangementWorkbenchOverview {
  return {
    todoCount: items.filter((item) => item.status === 'TODO').length,
    inProgressCount: items.filter((item) => item.status === 'IN_PROGRESS').length,
    dueTodayCount: items.filter((item) => item.dueAt && isSameDay(new Date(item.dueAt), now)).length,
    riskCount: items.filter(
      (item) =>
        item.status === 'BLOCKED' || deriveReminderState(item, now) === 'OVERDUE',
    ).length,
    overview: dailyPlan?.overview ?? '今天先处理重点事项，再推进进行中工作。',
  };
}

export function buildTaskFlowGroups(
  allItems: WorkArrangementItem[],
  browsingItems: WorkArrangementItem[],
  dailyPlan: WorkArrangementDailyPlan | null,
  now: Date,
  scope: 'AI_FOCUS' | 'TODAY' | 'WEEK' | 'ALL' = 'AI_FOCUS',
): WorkArrangementTaskFlowGroup[] {
  const focusIds = new Set(dailyPlan?.focusItems.map((item) => item.id) ?? []);
  const focusItems = allItems.filter((item) => focusIds.has(item.id));

  // 根据 scope 返回不同的分组结构
  if (scope === 'AI_FOCUS') {
    // AI 优先事项模式：只返回 AI 推荐的任务
    return [
      { key: 'FOCUS', title: 'AI 优先事项', count: focusItems.length, items: focusItems },
    ];
  }

  // 今日/本周/全部模式：直接使用已过滤的 browsingItems，避免重复
  // browsingItems 已经在页面层完成了所有过滤，直接使用即可
  if (scope === 'TODAY') {
    return [
      { key: 'TODAY', title: '今日任务', count: browsingItems.length, items: browsingItems },
    ];
  }

  if (scope === 'WEEK') {
    return [
      { key: 'WEEK', title: '本周任务', count: browsingItems.length, items: browsingItems },
    ];
  }

  // 全部模式
  return [
    { key: 'ALL', title: '全部任务', count: browsingItems.length, items: browsingItems },
  ];
}

export function selectTaskIdsFromWorkbenchSignal(
  signal: WorkArrangementWorkbenchSignal,
): string[] {
  switch (signal.type) {
    case 'FOCUS_ITEM':
      return [signal.taskId];
    case 'TIME_BLOCK':
    case 'RISK_ALERT':
      return signal.taskIds;
    case 'SUMMARY':
      return [];
  }
}
