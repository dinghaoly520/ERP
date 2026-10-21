/**
 * 提醒服务模块
 * 负责浏览器通知权限与通知发送。
 * 提醒状态判定统一走 workbench.ts 的 deriveReminderState（单一口径），
 * 本模块曾有一份私有的同名判定与未被引用的 checkReminders——已删（2026-10-21），
 * 勿再在此复制时间窗口逻辑。
 */

import type { WorkArrangementReminderState } from '@/lib/types/work-arrangements';

export type ReminderAction = 'view' | 'postpone' | 'dismiss';

export type ReminderInfo = {
  taskId: string;
  taskTitle: string;
  reminderState: WorkArrangementReminderState;
  /** 触发本次提醒的提醒时刻——忽略去重键（taskId:reminderAt）用 */
  reminderAt: string | null;
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

