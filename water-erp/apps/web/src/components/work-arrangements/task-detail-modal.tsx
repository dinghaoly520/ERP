'use client';

import { useState } from 'react';
import {
  Clock3,
  Bell,
  FolderOpen,
  CalendarPlus,
  PlayCircle,
  CheckCheck,
  AlertTriangle,
  RotateCcw,
  XCircle,
  FilePenLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Link from 'next/link';
import { Modal } from '@/components/workbench';
import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  type WorkArrangementItem,
  type WorkArrangementReminderState,
  type WorkArrangementNoteType,
  type WorkArrangementStatus,
} from '@/lib/types/work-arrangements';

// ── helpers ──

function formatDateTimeLabel(value: string | null) {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function reminderStateLabel(state: WorkArrangementReminderState) {
  switch (state) {
    case 'UPCOMING':
      return '即将提醒';
    case 'DUE_NOW':
      return '提醒已到';
    case 'OVERDUE':
      return '提醒超时';
    default:
      return '未设置提醒';
  }
}

const statusAccentMap: Record<
  WorkArrangementStatus,
  { bg: string; border: string; dot: string }
> = {
  TODO: {
    bg: 'linear-gradient(135deg, rgba(140,140,140,0.08), rgba(140,140,140,0.02))',
    border: 'border-[rgba(140,140,140,0.15)]',
    dot: 'bg-[rgba(140,140,140,1)]',
  },
  IN_PROGRESS: {
    bg: 'linear-gradient(135deg, rgba(96,139,239,0.1), rgba(96,139,239,0.02))',
    border: 'border-[rgba(96,139,239,0.2)]',
    dot: 'bg-[rgba(96,139,239,1)]',
  },
  BLOCKED: {
    bg: 'linear-gradient(135deg, rgba(230,129,102,0.1), rgba(230,129,102,0.02))',
    border: 'border-[rgba(230,129,102,0.2)]',
    dot: 'bg-[rgba(230,129,102,1)]',
  },
  COMPLETED: {
    bg: 'linear-gradient(135deg, rgba(92,181,150,0.1), rgba(92,181,150,0.02))',
    border: 'border-[rgba(92,181,150,0.2)]',
    dot: 'bg-[rgba(92,181,150,1)]',
  },
  CANCELLED: {
    bg: 'linear-gradient(135deg, rgba(140,140,140,0.05), rgba(140,140,140,0.01))',
    border: 'border-[rgba(140,140,140,0.1)]',
    dot: 'bg-[rgba(140,140,140,0.6)]',
  },
};

const statusStyles: Record<
  WorkArrangementStatus,
  { bg: string; text: string; border: string }
> = {
  TODO: {
    bg: 'bg-[rgba(140,140,140,0.12)]',
    text: 'text-[rgba(140,140,140,1)]',
    border: 'border-[rgba(140,140,140,0.25)]',
  },
  IN_PROGRESS: {
    bg: 'bg-[rgba(96,139,239,0.12)]',
    text: 'text-[rgba(96,139,239,1)]',
    border: 'border-[rgba(96,139,239,0.25)]',
  },
  BLOCKED: {
    bg: 'bg-[rgba(230,129,102,0.12)]',
    text: 'text-[rgba(230,129,102,1)]',
    border: 'border-[rgba(230,129,102,0.25)]',
  },
  COMPLETED: {
    bg: 'bg-[rgba(92,181,150,0.12)]',
    text: 'text-[rgba(92,181,150,1)]',
    border: 'border-[rgba(92,181,150,0.25)]',
  },
  CANCELLED: {
    bg: 'bg-[rgba(140,140,140,0.12)]',
    text: 'text-[rgba(140,140,140,0.8)]',
    border: 'border-[rgba(140,140,140,0.25)]',
  },
};

function getAvailableActions(
  status: WorkArrangementStatus,
): Array<'start' | 'complete' | 'block' | 'unblock' | 'cancel'> {
  switch (status) {
    case 'TODO':
      return ['start', 'complete', 'block', 'cancel'];
    case 'IN_PROGRESS':
      return ['complete', 'block', 'cancel'];
    case 'BLOCKED':
      return ['unblock', 'complete', 'cancel'];
    case 'COMPLETED':
    case 'CANCELLED':
      return [];
    default:
      return [];
  }
}

interface TaskDetailModalProps {
  open: boolean;
  item: WorkArrangementItem | null;
  reminderState: WorkArrangementReminderState;
  noteType: WorkArrangementNoteType;
  noteDraft: string;
  noteSubmitting: boolean;
  onClose: () => void;
  onStart: () => void;
  onComplete: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onCancel: () => void;
  onPostponeReminder: () => void;
  onResetReminder: (targetAt: string) => void;
  onOpenFullEditor: () => void;
  onNoteTypeChange: (v: WorkArrangementNoteType) => void;
  onNoteDraftChange: (v: string) => void;
  onSubmitNote: () => void;
}

export function TaskDetailModal({
  open,
  item,
  reminderState,
  noteType,
  noteDraft,
  noteSubmitting,
  onClose,
  onStart,
  onComplete,
  onBlock,
  onUnblock,
  onCancel,
  onPostponeReminder,
  onResetReminder,
  onOpenFullEditor,
  onNoteTypeChange,
  onNoteDraftChange,
  onSubmitNote,
}: TaskDetailModalProps) {
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [showReminderPicker, setShowReminderPicker] = useState(false);

  if (!open) return null;

  // Empty state — no item selected
  if (!item) {
    return (
      <Modal open={open} onClose={onClose} title="任务详情" size="lg">
        <div className="flex flex-col items-center justify-center py-10 text-sm text-[color:var(--muted-foreground)]">
          <div className="neu-icon-well mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
          </div>
          选择一条任务后查看详情。
        </div>
      </Modal>
    );
  }

  const accent = statusAccentMap[item.status];
  const statusStyle = statusStyles[item.status];
  const availableActions = getAvailableActions(item.status);
  const isFinished =
    item.status === 'COMPLETED' || item.status === 'CANCELLED';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
          <span
            className={`inline-flex items-center rounded-[10px] border px-2.5 py-0.5 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
          >
            {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
          </span>
          <span
            className={`text-lg font-bold leading-snug text-balance ${
              isFinished
                ? 'text-[color:var(--muted-foreground)] line-through'
                : 'text-[color:var(--foreground)]'
            }`}
          >
            {item.title}
          </span>
        </span>
      }
      description={item.description ?? undefined}
      size="xl"
    >
      <div>
                      {/* 信息卡网格 2×2 */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="neu-content-block px-3 py-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                            <Clock3 size={12} />
                            截止时间
                          </div>
                          <div className="mt-1.5 text-sm tabular-nums font-semibold text-[color:var(--foreground)]">
                            {formatDateTimeLabel(item.dueAt)}
                          </div>
                        </div>
                        <div className="neu-content-block px-3 py-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                            <Bell size={12} />
                            提醒状态
                          </div>
                          <div className="mt-1.5 text-sm font-semibold text-[color:var(--foreground)]">
                            {reminderStateLabel(reminderState)}
                          </div>
                        </div>
                        <div className="neu-content-block px-3 py-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                            <FolderOpen size={12} />
                            关联项目
                          </div>
                          {item.projectManagementItem ? (
                            <Link
                              href={`/projects?highlight=${item.projectManagementItem.id}`}
                              className="mt-1.5 block truncate text-sm font-semibold text-[color:var(--accent)] underline decoration-blue-300 underline-offset-2 hover:decoration-blue-500"
                            >
                              {item.projectManagementItem.title}
                            </Link>
                          ) : (
                            <div className="mt-1.5 text-sm text-[color:var(--muted-foreground)]">
                              未关联项目
                            </div>
                          )}
                        </div>
                        <div className="neu-content-block px-3 py-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                            <CalendarPlus size={12} />
                            创建时间
                          </div>
                          <div className="mt-1.5 text-sm tabular-nums font-semibold text-[color:var(--foreground)]">
                            {formatDateTimeLabel(item.createdAt)}
                          </div>
                        </div>
                      </div>

                      {/* 操作栏 */}
                      {!isFinished && (
                        <>
                          <hr className="wb-section-rule" />
                          <div className="flex flex-wrap gap-2">
                            {availableActions.includes('start') && (
                              <button
                                type="button"
                                onClick={onStart}
                                className="neu-btn-soft"
                              >
                                <PlayCircle size={16} />
                                开始处理
                              </button>
                            )}
                            {availableActions.includes('complete') && (
                              <button
                                type="button"
                                onClick={onComplete}
                                className="neu-btn-soft is-success"
                              >
                                <CheckCheck size={16} />
                                标记完成
                              </button>
                            )}
                            {availableActions.includes('block') && (
                              <button
                                type="button"
                                onClick={onBlock}
                                className="neu-btn-soft is-danger"
                              >
                                <AlertTriangle size={16} />
                                标记受阻
                              </button>
                            )}
                            {availableActions.includes('unblock') && (
                              <button
                                type="button"
                                onClick={onUnblock}
                                className="neu-btn-soft is-info"
                              >
                                <RotateCcw size={16} />
                                恢复处理
                              </button>
                            )}
                            {availableActions.includes('cancel') && (
                              <button
                                type="button"
                                onClick={onCancel}
                                className="neu-btn-soft"
                              >
                                <XCircle size={16} />
                                取消任务
                              </button>
                            )}
                            {(reminderState === 'NONE' || reminderState === 'OVERDUE') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setShowReminderPicker((v) => !v)}
                                  className={`neu-btn-soft ${reminderState === 'OVERDUE' ? 'is-warning' : ''}`}
                                >
                                  <Clock3 size={16} />
                                  {reminderState === 'NONE' ? '设置提醒' : '新设提醒'}
                                </button>
                                {showReminderPicker && (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="datetime-local"
                                      defaultValue={new Date(Date.now() + 30 * 60 * 1000)
                                        .toISOString()
                                        .slice(0, 16)}
                                      className="neu-input text-sm h-9"
                                      id="reset-reminder-time"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const el = document.getElementById('reset-reminder-time') as HTMLInputElement;
                                        if (el?.value) {
                                          onResetReminder(new Date(el.value).toISOString());
                                          setShowReminderPicker(false);
                                        }
                                      }}
                                      className="neu-btn-soft is-success h-9"
                                    >
                                      确定
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setShowReminderPicker(false)}
                                      className="neu-btn-soft h-9"
                                    >
                                      取消
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                            {reminderState !== 'NONE' && reminderState !== 'OVERDUE' && (
                              <button
                                type="button"
                                onClick={onPostponeReminder}
                                className="neu-btn-soft"
                              >
                                <Clock3 size={16} />
                                延后提醒
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={onOpenFullEditor}
                              className="neu-btn-soft"
                            >
                              <FilePenLine size={16} />
                              添加记录
                            </button>
                          </div>
                        </>
                      )}

                      {/* 完成摘要 (已完成任务) */}
                      {isFinished && item.completionSummary && (
                        <>
                          <hr className="wb-section-rule" />
                          <div
                            className="neu-content-block mt-3"
                            style={
                              { '--block-accent': 'var(--success)' } as React.CSSProperties
                            }
                          >
                            <div className="text-xs font-semibold text-[rgba(92,181,150,1)]">
                              完成摘要
                            </div>
                            <div className="mt-1 text-sm leading-relaxed text-[color:var(--foreground)]">
                              {item.completionSummary}
                            </div>
                          </div>
                        </>
                      )}

                      {/* 过程记录 (折叠面板) */}
                      <hr className="wb-section-rule" />
                      <div>
                        <button
                          type="button"
                          onClick={() => setNotesExpanded((v) => !v)}
                          className="flex w-full items-center justify-between"
                        >
                          <span className="text-xs font-semibold text-[color:var(--accent)]">
                            过程记录
                            {item.notes.length > 0 && ` (${item.notes.length}条)`}
                          </span>
                          {notesExpanded ? (
                            <ChevronUp size={14} className="text-[color:var(--muted-foreground)]" />
                          ) : (
                            <ChevronDown size={14} className="text-[color:var(--muted-foreground)]" />
                          )}
                        </button>

                        {notesExpanded && (
                          <div className="mt-3 space-y-2">
                            {item.notes.length > 0 ? (
                              item.notes.map((note) => (
                                <div
                                  key={note.id}
                                  className="neu-surface-subtle rounded-[12px] px-3 py-2.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-[color:var(--accent)]">
                                      {note.type === 'PROGRESS'
                                        ? '进展'
                                        : '心得'}
                                    </span>
                                    <span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
                                      {formatDateTimeLabel(note.createdAt)}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm leading-relaxed text-[color:var(--foreground)]">
                                    {note.content}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <div
                                className="neu-content-block text-sm text-[color:var(--muted-foreground)]"
                                style={
                                  { '--block-accent': 'var(--accent)' } as React.CSSProperties
                                }
                              >
                                还没有过程记录，可从当前推进情况开始补第一条。
                              </div>
                            )}

                            {/* 新增记录 */}
                            <div className="mt-3 space-y-2">
                              <select
                                value={noteType}
                                onChange={(e) =>
                                  onNoteTypeChange(
                                    e.target.value as WorkArrangementNoteType,
                                  )
                                }
                                className="workbench-input text-sm"
                              >
                                <option value="PROGRESS">过程记录</option>
                                <option value="INSIGHT">心得补充</option>
                              </select>
                              <textarea
                                value={noteDraft}
                                onChange={(e) => onNoteDraftChange(e.target.value)}
                                rows={2}
                                placeholder="记录今天推进到了哪一步..."
                                className="neu-input text-sm"
                              />
                              <button
                                type="button"
                                onClick={onSubmitNote}
                                disabled={noteSubmitting || !noteDraft.trim()}
                                className="neu-btn-primary self-start"
                              >
                                {noteSubmitting ? '提交中...' : '添加记录'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
      </div>
    </Modal>
  );
}
