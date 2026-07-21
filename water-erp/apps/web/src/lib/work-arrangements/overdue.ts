import type { WorkArrangementItem } from '@/lib/types/work-arrangements';

const STORAGE_KEY = 'workspace:overdue-dialog-shown';

const URGENCY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * 筛选逾期任务：status 不是 COMPLETED/CANCELLED 且 dueAt 已过当前时间。
 * 结果按紧急程度降序、截止时间升序排列。
 */
export function getOverdueTasks(
  items: WorkArrangementItem[],
  now: Date = new Date(),
): WorkArrangementItem[] {
  const nowMs = now.getTime();

  return items
    .filter((item) => {
      if (item.status === 'COMPLETED' || item.status === 'CANCELLED') return false;
      if (!item.dueAt) return false;
      return new Date(item.dueAt).getTime() < nowMs;
    })
    .sort((a, b) => {
      const urgencyDiff = (URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9);
      if (urgencyDiff !== 0) return urgencyDiff;
      return new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime();
    });
}

/** 判断今天是否已经显示过逾期对话框 */
export function hasShownOverdueDialogToday(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    const today = new Date().toISOString().slice(0, 10);
    return new Date(stored).toISOString().slice(0, 10) === today;
  } catch {
    return false;
  }
}

/** 标记今天已显示逾期对话框 */
export function markOverdueDialogShownToday(): void {
  try {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } catch {
    // 静默失败（无痕模式下 localStorage 不可用）
  }
}
