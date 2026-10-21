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
  // 已完结的任务没有活的提醒——与 reminder.ts checkReminders 同口径跳过；
  // 否则完成后 reminderAt 仍过期，「需注意」列表/徽章会一直留着已完成任务（2026-10-21 修复）
  if (item.status === 'COMPLETED' || item.status === 'CANCELLED') {
    return 'NONE';
  }

  if (!item.reminderAt) {
    return 'NONE';
  }

  const reminderAt = new Date(item.reminderAt);
  const deltaMs = reminderAt.getTime() - now.getTime();

  if (deltaMs > 0) {
    // 未到提醒时刻：临近（≤2h）为「即将提醒」，更远不占提示位
    return deltaMs <= 2 * 60 * 60 * 1000 ? 'UPCOMING' : 'NONE';
  }

  // 已到提醒时刻：1 分钟内「提醒已到」（与 reminder.ts 通知口径一致），超过即「提醒超时」。
  // 勿把未到的窗口并入 DUE_NOW——否则提醒时间没到就显示「提醒已到」（2026-10-21 修复）。
  return deltaMs > -60 * 1000 ? 'DUE_NOW' : 'OVERDUE';
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
 * `dueToday` 不限状态（含今日已完成）；`risk` 含受阻与「提醒已过期」的未完结项
 * （已完成/已取消不进 risk——完结即无活的提醒，见 deriveReminderState）。
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

