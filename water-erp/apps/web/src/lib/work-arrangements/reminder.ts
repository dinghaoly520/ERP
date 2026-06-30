/**
 * 提醒服务模块
 * 负责检查任务提醒时间、触发浏览器通知、管理提醒状态
 */

import type { WorkArrangementItem, WorkArrangementReminderState } from '@/lib/types/work-arrangements';

export type ReminderAction = 'view' | 'postpone' | 'dismiss';

export type ReminderInfo = {
  taskId: string;
  taskTitle: string;
  reminderState: WorkArrangementReminderState;
  dueAt: string | null;
};

export type ReminderCallback = (info: ReminderInfo, action: ReminderAction) => void;

// 检查浏览器通知权限
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('浏览器不支持通知功能');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    console.warn('用户已拒绝通知权限');
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

// 发送浏览器通知
export function sendBrowserNotification(title: string, body: string, onClick?: () => void): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const notification = new Notification(title, {
    body,
    icon: '/favicon.ico',
    tag: 'work-arrangement-reminder',
    requireInteraction: false,
  });

  if (onClick) {
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  }

  // 5秒后自动关闭
  setTimeout(() => notification.close(), 5000);
}

// 检查哪些任务需要提醒
export function checkReminders(
  items: WorkArrangementItem[],
  now: Date,
): ReminderInfo[] {
  const reminders: ReminderInfo[] = [];

  for (const item of items) {
    // 跳过已完成或已取消的任务
    if (item.status === 'COMPLETED' || item.status === 'CANCELLED') {
      continue;
    }

    // 没有设置提醒时间
    if (!item.reminderAt) {
      continue;
    }

    const reminderTime = new Date(item.reminderAt).getTime();
    const nowTime = now.getTime();

    // 提醒时间在未来 60 秒内（即将提醒）
    const diffSeconds = (reminderTime - nowTime) / 1000;

    if (diffSeconds <= 60 && diffSeconds > -300) {
      // 提醒时间在 1 分钟内到达，或者已经过了但不超过 5 分钟
      const reminderState = deriveReminderState(item, now);
      reminders.push({
        taskId: item.id,
        taskTitle: item.title,
        reminderState,
        dueAt: item.dueAt,
      });
    }
  }

  return reminders;
}

// 计算提醒状态
function deriveReminderState(item: WorkArrangementItem, now: Date): WorkArrangementReminderState {
  if (!item.reminderAt) {
    return 'NONE';
  }

  const reminderTime = new Date(item.reminderAt).getTime();
  const nowTime = now.getTime();
  const diffMinutes = (reminderTime - nowTime) / (1000 * 60);

  if (diffMinutes > 0 && diffMinutes <= 60) {
    return 'UPCOMING';
  }

  if (diffMinutes <= 0 && diffMinutes > -1) {
    return 'DUE_NOW';
  }

  if (diffMinutes <= -1) {
    return 'OVERDUE';
  }

  return 'NONE';
}

// 格式化提醒时间显示
export function formatReminderMessage(info: ReminderInfo): string {
  switch (info.reminderState) {
    case 'UPCOMING':
      return `任务「${info.taskTitle}」即将到达提醒时间`;
    case 'DUE_NOW':
      return `任务「${info.taskTitle}」提醒时间已到`;
    case 'OVERDUE':
      return `任务「${info.taskTitle}」提醒已超时`;
    default:
      return `任务「${info.taskTitle}」需要处理`;
  }
}

// 提醒管理器类
export class ReminderManager {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private lastReminderIds: Set<string> = new Set();
  private onReminder: ((infos: ReminderInfo[]) => void) | null = null;

  // 开始定期检查
  start(items: WorkArrangementItem[], onReminder: (infos: ReminderInfo[]) => void): void {
    this.onReminder = onReminder;

    // 立即检查一次
    this.check(items);

    // 每分钟检查一次
    this.checkInterval = setInterval(() => {
      this.check(items);
    }, 60 * 1000);
  }

  // 停止检查
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.lastReminderIds.clear();
    this.onReminder = null;
  }

  // 更新任务列表（用于动态更新）
  updateItems(items: WorkArrangementItem[]): void {
    this.check(items);
  }

  // 检查提醒
  private check(items: WorkArrangementItem[]): void {
    const now = new Date();
    const reminders = checkReminders(items, now);

    // 过滤掉已经提醒过的任务
    const newReminders = reminders.filter(r => !this.lastReminderIds.has(r.taskId));

    if (newReminders.length > 0 && this.onReminder) {
      // 记录已提醒的任务
      newReminders.forEach(r => this.lastReminderIds.add(r.taskId));
      this.onReminder(newReminders);
    }

    // 清理过期的提醒记录（超过 10 分钟的）
    const validIds = new Set(reminders.map(r => r.taskId));
    for (const id of this.lastReminderIds) {
      if (!validIds.has(id)) {
        this.lastReminderIds.delete(id);
      }
    }
  }
}

// 单例实例
export const reminderManager = new ReminderManager();
