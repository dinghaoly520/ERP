'use client';

import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  WORK_ARRANGEMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementItem,
} from '@/lib/types/work-arrangements';
import { History } from 'lucide-react';
import { Modal } from '@/components/workbench';

function formatDateTimeLabel(value: string | null) {
  if (!value) {
    return '未设置';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function HistoryDrawer({
  open,
  items,
  onClose,
  onSelectTask,
}: {
  open: boolean;
  items: WorkArrangementItem[];
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  if (!open) return null;

  // 只显示已完成和已取消的任务
  const historyItems = items.filter(
    (item) => item.status === 'COMPLETED' || item.status === 'CANCELLED'
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <History size={20} className="text-[color:var(--accent)]" />
          历史记录
          <span className="text-sm font-normal text-[color:var(--muted-foreground)]">
            共 {historyItems.length} 条
          </span>
        </span>
      }
      size="lg"
    >
      {historyItems.length === 0 ? (
        <div className="text-center py-12 text-[color:var(--muted-foreground)]">
          暂无历史记录
        </div>
      ) : (
        <div className="space-y-4">
          {historyItems.map((item) => (
            <div
              key={item.id}
              className="rounded-[16px] bg-[var(--accent-soft)]/15 overflow-hidden"
            >
              {/* 任务标题和状态 */}
              <div
                className="px-4 py-3 cursor-pointer hover:bg-[var(--accent-soft)]/30 transition"
                onClick={() => {
                  onSelectTask(item.id);
                  onClose();
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          item.status === 'COMPLETED' ? 'bg-[var(--success)]' : 'bg-[var(--muted-foreground)]'
                        }`}
                      />
                      <span className="text-sm font-semibold text-[color:var(--muted-foreground)] line-through truncate">
                        {item.title}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)] ml-4">
                      {WORK_ARRANGEMENT_TYPE_LABELS[item.type]} · {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-[10px] px-2.5 py-1 text-xs font-semibold flex-shrink-0 ${
                      item.status === 'COMPLETED'
                        ? 'bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-[var(--success)]'
                        : 'bg-[color-mix(in_oklch,var(--muted-foreground)_15%,transparent)] text-[var(--muted-foreground)]'
                    }`}
                  >
                    {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
                  </span>
                </div>
              </div>

              {/* 时间信息 */}
              <div className="px-4 py-3 bg-[var(--accent-soft)]/10 border-t border-[var(--border)]/30">
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[color:var(--muted-foreground)]">创建时间：</span>
                    <span className="tabular-nums text-[color:var(--foreground)]">
                      {formatDateTimeLabel(item.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[color:var(--muted-foreground)]">更新时间：</span>
                    <span className="tabular-nums text-[color:var(--foreground)]">
                      {formatDateTimeLabel(item.updatedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[color:var(--muted-foreground)]">截止时间：</span>
                    <span className="tabular-nums text-[color:var(--foreground)]">
                      {formatDateTimeLabel(item.dueAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[color:var(--muted-foreground)]">紧急程度：</span>
                    <span className="text-[color:var(--foreground)]">
                      {WORK_ARRANGEMENT_URGENCY_LABELS[item.urgency]}
                    </span>
                  </div>
                </div>

                {/* 描述 */}
                {item.description && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]/30">
                    <div className="text-xs text-[color:var(--muted-foreground)] mb-1">描述</div>
                    <div className="text-sm text-[color:var(--foreground)] leading-relaxed">
                      {item.description}
                    </div>
                  </div>
                )}

                {/* 完成摘要 */}
                {item.completionSummary && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]/30">
                    <div className="text-xs font-semibold text-[var(--success)] mb-1">完成摘要</div>
                    <div className="text-sm text-[var(--success)] leading-relaxed">
                      {item.completionSummary}
                    </div>
                  </div>
                )}

                {/* 心得反思 */}
                {item.reflectionSummary && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]/30">
                    <div className="text-xs font-semibold text-[var(--warning)] mb-1">心得反思</div>
                    <div className="text-sm text-[var(--warning)] leading-relaxed">
                      {item.reflectionSummary}
                    </div>
                  </div>
                )}

                {/* 笔记记录 */}
                {item.notes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]/30">
                    <div className="text-xs font-semibold text-[color:var(--accent)] mb-2">
                      过程记录 ({item.notes.length} 条)
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {item.notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded-[12px] bg-[var(--accent-soft)]/20 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-semibold text-[color:var(--accent)]">
                              {note.type === 'PROGRESS' ? '进展' : note.type === 'INSIGHT' ? '心得' : '记录'}
                            </span>
                            <span className="text-xs text-[color:var(--muted-foreground)] tabular-nums">
                              {formatDateTimeLabel(note.createdAt)}
                            </span>
                          </div>
                          <div className="text-sm text-[color:var(--foreground)] leading-relaxed">
                            {note.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
