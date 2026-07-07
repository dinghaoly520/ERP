'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  WORK_ARRANGEMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementItem,
  type WorkArrangementUrgency,
  type WorkArrangementUrgency,
} from '@/lib/types/work-arrangements';

const urgencyBadge: Record<WorkArrangementUrgency, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-emerald-100 text-emerald-700',
};
const statusDotStyles: Record<string, string> = {
  TODO: 'bg-slate-400',
  IN_PROGRESS: 'bg-blue-500',
  BLOCKED: 'bg-red-500 animate-pulse',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-gray-400',
};

function formatDateTimeLabel(value: string | null) {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateDay(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${month}月${day}日 ${weekDays[date.getDay()]}`;
}

export function WorkDateTaskList({
  selectedDate,
  items,
  unscheduledItems,
  selectedItemId,
  highlightedTaskIds,
  onSelectTask,
  onCreateNew,
}: {
  selectedDate: Date;
  items: WorkArrangementItem[];
  unscheduledItems: WorkArrangementItem[];
  selectedItemId: string | null;
  highlightedTaskIds: string[];
  onSelectTask: (taskId: string) => void;
  onCreateNew: () => void;
}) {
  const dateLabel = formatDateDay(selectedDate);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {items.length > 0 ? (
          items.map(item => (
            <TaskCard
              key={item.id}
              item={item}
              selected={item.id === selectedItemId}
              highlighted={highlightedTaskIds.includes(item.id)}
              onSelect={() => onSelectTask(item.id)}
            />
          ))
        ) : (
          <div className="rounded-[18px] bg-gray-50 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
            这一天暂无任务。
          </div>
        )}

        {unscheduledItems.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-2">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">
                未排期 · {unscheduledItems.length}项
              </span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
            {unscheduledItems.map(item => (
              <TaskCard
                key={item.id}
                item={item}
                selected={item.id === selectedItemId}
                highlighted={highlightedTaskIds.includes(item.id)}
                onSelect={() => onSelectTask(item.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  item,
  selected,
  highlighted,
  onSelect,
}: {
  item: WorkArrangementItem;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
}) {
  const isFinished = item.status === 'COMPLETED' || item.status === 'CANCELLED';
  return (
    <button type="button" onClick={onSelect} aria-label={`选择任务：${item.title}`}
      className={['wb-list-item', selected ? 'wb-selected' : ''].filter(Boolean).join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full flex-shrink-0 ${statusDotStyles[item.status] || 'bg-gray-400'}`}
              aria-hidden="true"
            />
            <div className={`text-sm font-semibold truncate ${isFinished ? 'text-gray-500 line-through' : 'text-[color:var(--foreground)]'}`}>
              {item.title}
            </div>
          </div>
          <div className="mt-1 text-xs text-[color:var(--muted-foreground)] ml-4">
            {WORK_ARRANGEMENT_TYPE_LABELS[item.type]} · {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
          </div>
        </div>
        {!isFinished ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold flex-shrink-0 ${urgencyBadge[item.urgency]}`}>
            {WORK_ARRANGEMENT_URGENCY_LABELS[item.urgency]}
          </span>
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold flex-shrink-0 ${
            item.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {item.projectManagementItem ? (
          <Link
            href={`/projects?highlight=${item.projectManagementItem.id}`}
            className={`rounded-full px-2.5 py-1 text-xs transition hover:shadow-sm ${isFinished ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-[color:var(--accent)] hover:bg-blue-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {item.projectManagementItem.title}
          </Link>
        ) : null}
        {item.customTags.slice(0, 3).map(tag => (
          <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-[color:var(--muted-foreground)]">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-2 text-xs tabular-nums text-[color:var(--muted-foreground)] sm:grid-cols-2">
        <div>截止：{formatDateTimeLabel(item.dueAt)}</div>
        <div>提醒：{formatDateTimeLabel(item.reminderAt)}</div>
      </div>
    </button>
  );
}
