import type {
  WorkArrangementDailyPlan,
  WorkArrangementItem,
  WorkArrangementReminderState,
  WorkArrangementWorkbenchOverview,
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

/** 标题栏统计徽章的可点击分类。`notif` 走通知接口，其余四类走工作安排列表。 */
export type WorkbenchStatKey =
  | 'notif'
  | 'todo'
  | 'inProgress'
  | 'dueToday'
  | 'risk';

type WorkbenchWorkStatKey = Exclude<WorkbenchStatKey, 'notif'>;

/**
 * 单一来源判定：标题栏某个工作类徽章计数与「点击查看」弹窗列表共用此谓词，
 * 以保证弹窗条数与徽章数字恒等。注意口径与计数完全一致——
 * `dueToday` 不限状态（含今日已完成），`risk` 含「提醒已过期」的任意状态项。
 */
export function isWorkbenchOverviewMatch(
  item: WorkArrangementItem,
  key: WorkbenchWorkStatKey,
  now: Date,
): boolean {
  switch (key) {
    case 'todo':
      return item.status === 'TODO';
    case 'inProgress':
      return item.status === 'IN_PROGRESS';
    case 'dueToday':
      return !!item.dueAt && isSameDay(new Date(item.dueAt), now);
    case 'risk':
      return (
        item.status === 'BLOCKED' || deriveReminderState(item, now) === 'OVERDUE'
      );
  }
}

/** 取某个工作类徽章对应的真实任务列表（与计数同源同谓词）。 */
export function selectWorkbenchOverviewItems(
  items: WorkArrangementItem[],
  key: WorkbenchWorkStatKey,
  now: Date,
): WorkArrangementItem[] {
  return items.filter((item) => isWorkbenchOverviewMatch(item, key, now));
}

export function buildWorkbenchOverview(
  items: WorkArrangementItem[],
  dailyPlan: WorkArrangementDailyPlan | null,
  now: Date,
): WorkArrangementWorkbenchOverview {
  return {
    todoCount: selectWorkbenchOverviewItems(items, 'todo', now).length,
    inProgressCount: selectWorkbenchOverviewItems(items, 'inProgress', now).length,
    dueTodayCount: selectWorkbenchOverviewItems(items, 'dueToday', now).length,
    riskCount: selectWorkbenchOverviewItems(items, 'risk', now).length,
    overview: dailyPlan?.overview ?? '今天先处理重点事项，再推进进行中工作。',
  };
}

