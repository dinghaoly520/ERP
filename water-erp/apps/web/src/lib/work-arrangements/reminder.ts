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

