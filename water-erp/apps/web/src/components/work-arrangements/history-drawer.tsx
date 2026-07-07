'use client';

import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  WORK_ARRANGEMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementItem,
} from '@/lib/types/work-arrangements';
import { History, X } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 对话框 */}
      <div className="relative z-10 w-full max-w-[min(672px,92vw)] max-h-[80vh] mx-4 bg-[var(--background)] rounded-[20px] flex flex-col overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <History size={20} className="text-[color:var(--accent)]" />
            <h2 className="text-lg font-semibold text-[color:var(--foreground)]">历史记录</h2>
            <span className="text-sm text-[color:var(--muted-foreground)]">
              共 {historyItems.length} 条
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="neu-btn-xs"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
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
                              item.status === 'COMPLETED' ? 'bg-green-500' : 'bg-gray-400'
                            }`}
                          />
                          <span className="text-sm font-semibold text-gray-500 line-through truncate">
                            {item.title}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--muted-foreground)] ml-4">
                          {WORK_ARRANGEMENT_TYPE_LABELS[item.type]} · {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold flex-shrink-0 ${
                          item.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
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
                        <div className="text-xs font-semibold text-green-700 mb-1">完成摘要</div>
                        <div className="text-sm text-green-800 leading-relaxed">
                          {item.completionSummary}
                        </div>
                      </div>
                    )}

                    {/* 心得反思 */}
                    {item.reflectionSummary && (
                      <div className="mt-3 pt-3 border-t border-[var(--border)]/30">
                        <div className="text-xs font-semibold text-amber-700 mb-1">心得反思</div>
                        <div className="text-sm text-amber-800 leading-relaxed">
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
        </div>
      </div>
    </div>
  );
}
