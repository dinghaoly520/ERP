'use client';

import { Bell, Clock, X } from 'lucide-react';
import type { ReminderInfo } from '@/lib/work-arrangements/reminder';

export function ReminderBanner({
  reminders,
  onDismiss,
  onView,
  onPostpone,
}: {
  reminders: ReminderInfo[];
  onDismiss: () => void;
  onView: (taskId: string) => void;
  onPostpone: (taskId: string) => void;
}) {
  if (reminders.length === 0) return null;

  const firstReminder = reminders[0];
  const hasMultiple = reminders.length > 1;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 animate-slide-down">
      <div className="mx-auto max-w-2xl px-4 py-3">
        <div className="rounded-[20px] border border-amber-200 px-4 py-3 shadow-lg" style={{ background: 'linear-gradient(to right, #fffbeb, #fff7ed)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="flex-shrink-0 mt-0.5">
                <Bell size={18} className="text-amber-600 animate-bounce" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-amber-900">
                  {hasMultiple
                    ? `您有 ${reminders.length} 条任务需要处理`
                    : `任务提醒：${firstReminder.taskTitle}`}
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  {hasMultiple
                    ? '点击查看详情处理这些任务'
                    : getReminderHint(firstReminder.reminderState)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {hasMultiple ? (
                <button
                  type="button"
                  onClick={() => onView(firstReminder.taskId)}
                  className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-200"
                >
                  查看全部
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onView(firstReminder.taskId)}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
                  >
                    查看
                  </button>
                  <button
                    type="button"
                    onClick={() => onPostpone(firstReminder.taskId)}
                    className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-200"
                  >
                    <Clock size={12} className="inline mr-1" />
                    延后
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onDismiss}
                aria-label="关闭提醒"
                className="rounded-lg p-1.5 text-amber-600 transition-all hover:bg-white hover:rotate-90"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getReminderHint(state: ReminderInfo['reminderState']): string {
  switch (state) {
    case 'UPCOMING':
      return '即将到达提醒时间';
    case 'DUE_NOW':
      return '提醒时间已到，请及时处理';
    case 'OVERDUE':
      return '提醒已超时，请尽快处理';
    default:
      return '需要处理';
  }
}
