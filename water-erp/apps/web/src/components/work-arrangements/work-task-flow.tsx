'use client';

import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  WORK_ARRANGEMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementItem,
  type WorkArrangementTaskFlowGroup,
  type WorkArrangementUrgency,
} from '@/lib/types/work-arrangements';

function formatDateTimeLabel(value: string | null) {
  if (!value) {
    return '未设置';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

// 紧急程度对应的视觉样式（用于卡片左侧边框和标签）
const urgencyStyles: Record<WorkArrangementUrgency, {
  card: string;
  badge: string;
}> = {
  CRITICAL: {
    card: 'border-l-4 border-l-rose-500 bg-gradient-to-r from-rose-50/80 to-white',
    badge: 'bg-rose-100 text-rose-700',
  },
  HIGH: {
    card: 'border-l-4 border-l-orange-400 bg-gradient-to-r from-orange-50/60 to-white',
    badge: 'bg-orange-100 text-orange-700',
  },
  MEDIUM: {
    card: 'border-l-4 border-l-amber-400 bg-gradient-to-r from-amber-50/40 to-white',
    badge: 'bg-amber-100 text-amber-700',
  },
  LOW: {
    card: 'border-l-4 border-l-emerald-400 bg-gradient-to-r from-emerald-50/30 to-white',
    badge: 'bg-emerald-100 text-emerald-700',
  },
};

// 状态指示点样式
const statusDotStyles: Record<string, string> = {
  TODO: 'bg-slate-400',
  IN_PROGRESS: 'bg-blue-500',
  BLOCKED: 'bg-red-500 animate-pulse',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-gray-400',
};

export function WorkTaskFlow({
  groups,
  selectedItemId,
  highlightedTaskIds,
  onSelectTask,
}: {
  groups: WorkArrangementTaskFlowGroup[];
  selectedItemId: string | null;
  highlightedTaskIds: string[];
  onSelectTask: (taskId: string) => void;
}) {
  // 直接使用第一个有内容的分组，不再显示切换按钮
  const activeGroup = groups.find((g) => g.items.length > 0) ?? groups[0];

  if (!activeGroup) {
    return null;
  }

  return (
    <div className="mt-4 flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-sm font-semibold text-[color:var(--foreground)]">{activeGroup.title}</div>
        <div className="text-xs tabular-nums text-[color:var(--muted-foreground)]">
          共 {activeGroup.count} 项
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto pr-1">
        <div className="space-y-3">
          {activeGroup.items.length ? (
            activeGroup.items.map((item: WorkArrangementItem) => {
              const selected = item.id === selectedItemId;
              const highlighted = highlightedTaskIds.includes(item.id);
              const urgencyStyle = urgencyStyles[item.urgency];
              const isFinished = item.status === 'COMPLETED' || item.status === 'CANCELLED';

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTask(item.id)}
                  aria-label={`选择任务：${item.title}`}
                  className={[
                    'w-full rounded-[20px] border px-4 py-4 text-left transition',
                    isFinished
                      ? 'border-gray-200 bg-gray-50/60 opacity-70'
                      : 'border-gray-200',
                    selected
                      ? 'ring-2 ring-blue-300 ring-offset-1 shadow-md'
                      : highlighted
                        ? 'ring-1 ring-blue-200 shadow-sm'
                        : !isFinished && 'hover:-translate-y-0.5 hover:shadow-md',
                    // 应用紧急程度的背景样式（非选中、非完成状态）
                    !selected && !isFinished ? urgencyStyle.card : '',
                    selected && !isFinished ? 'bg-blue-50' : '',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {/* 状态指示点 */}
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
                    {/* 右侧标签：未完成显示紧急程度，已完成显示状态 */}
                    {!isFinished ? (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold flex-shrink-0 ${urgencyStyle.badge}`}>
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

                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.projectManagementItem ? (
                      <span className={`rounded-full px-2.5 py-1 text-xs ${isFinished ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-[color:var(--accent)]'}`}>
                        {item.projectManagementItem.title}
                      </span>
                    ) : null}
                    {item.customTags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-[color:var(--muted-foreground)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-2 text-xs tabular-nums text-[color:var(--muted-foreground)] sm:grid-cols-2">
                    <div>截止：{formatDateTimeLabel(item.dueAt)}</div>
                    <div>提醒：{formatDateTimeLabel(item.reminderAt)}</div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-[18px] bg-gray-50 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
              当前分组暂无任务。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
