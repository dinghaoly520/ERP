import { useState } from 'react';
import {
  AlertTriangle,
  CheckCheck,
  Clock3,
  FilePenLine,
  PlayCircle,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementItem,
  type WorkArrangementReminderState,
  type WorkArrangementStatus,
} from '@/lib/types/work-arrangements';

// 颜色映射 - 与项目设计系统一致
const accentMap = {
  blue: "rgba(96,139,239,1)",
  blueLight: "rgba(96,139,239,0.12)",
  teal: "rgba(92,181,150,1)",
  tealLight: "rgba(92,181,150,0.12)",
  gold: "rgba(234,188,110,1)",
  goldLight: "rgba(234,188,110,0.14)",
  coral: "rgba(230,129,102,1)",
  coralLight: "rgba(230,129,102,0.12)",
};

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

// 状态对应的颜色样式 - 使用项目设计系统的颜色
const statusStyles: Record<WorkArrangementStatus, { bg: string; text: string; border: string }> = {
  TODO: { bg: 'bg-[rgba(140,140,140,0.12)]', text: 'text-[rgba(140,140,140,1)]', border: 'border-[rgba(140,140,140,0.25)]' },
  IN_PROGRESS: { bg: 'bg-[rgba(96,139,239,0.12)]', text: 'text-[rgba(96,139,239,1)]', border: 'border-[rgba(96,139,239,0.25)]' },
  BLOCKED: { bg: 'bg-[rgba(230,129,102,0.12)]', text: 'text-[rgba(230,129,102,1)]', border: 'border-[rgba(230,129,102,0.25)]' },
  COMPLETED: { bg: 'bg-[rgba(92,181,150,0.12)]', text: 'text-[rgba(92,181,150,1)]', border: 'border-[rgba(92,181,150,0.25)]' },
  CANCELLED: { bg: 'bg-[rgba(140,140,140,0.12)]', text: 'text-[rgba(140,140,140,0.8)]', border: 'border-[rgba(140,140,140,0.25)]' },
};

// 根据当前状态返回可用的操作按钮
function getAvailableActions(status: WorkArrangementStatus): Array<'start' | 'complete' | 'block' | 'unblock' | 'cancel'> {
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

export function WorkTaskQuickView({
  item,
  reminderState,
  onStart,
  onComplete,
  onBlock,
  onUnblock,
  onCancel,
  onPostponeReminder,
  onResetReminder,
  onOpenFullEditor,
  onOpenNotes,
}: {
  item: WorkArrangementItem | null;
  reminderState: WorkArrangementReminderState;
  onStart: () => void;
  onComplete: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onCancel: () => void;
  onPostponeReminder: () => void;
  onResetReminder: (targetAt: string) => void;
  onOpenFullEditor: () => void;
  onOpenNotes: () => void;
}) {
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-sm text-center text-[color:var(--muted-foreground)]">
        <div className="neu-icon-well mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
        </div>
        选择一条任务后，这里会显示快捷处理信息。
      </div>
    );
  }

  const statusStyle = statusStyles[item.status];
  const availableActions = getAvailableActions(item.status);
  const isFinished = item.status === 'COMPLETED' || item.status === 'CANCELLED';
  const [showReminderPicker, setShowReminderPicker] = useState(false);

  return (
    <section className={isFinished ? 'opacity-75' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className={`text-lg font-semibold text-balance ${isFinished ? 'text-[color:var(--muted-foreground)] line-through' : 'text-[color:var(--foreground)]'}`}>
            {item.title}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-[10px] border px-2.5 py-0.5 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
              {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
            </span>
            <span className="text-sm text-[color:var(--muted-foreground)]">
              {WORK_ARRANGEMENT_URGENCY_LABELS[item.urgency]}
            </span>
          </div>
        </div>

      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="neu-content-block px-3 py-3 text-sm text-[color:var(--foreground)]">
          <div className="text-xs font-semibold text-[color:var(--accent)]">截止时间</div>
          <div className="mt-2 tabular-nums">{formatDateTimeLabel(item.dueAt)}</div>
        </div>
        <div className="neu-content-block px-3 py-3 text-sm text-[color:var(--foreground)]">
          <div className="text-xs font-semibold text-[color:var(--accent)]">提醒状态</div>
          <div className="mt-2">{reminderStateLabel(reminderState)}</div>
        </div>
        <div className="neu-content-block px-3 py-3 text-sm text-[color:var(--foreground)]">
          <div className="text-xs font-semibold text-[color:var(--accent)]">关联项目</div>
          {item.projectManagementItem ? (
            <Link
              href={`/projects?highlight=${item.projectManagementItem.id}`}
              className="mt-2 block truncate text-[color:var(--accent)] underline decoration-blue-300 underline-offset-2 hover:decoration-blue-500 transition"
            >
              {item.projectManagementItem.title}
            </Link>
          ) : (
            <div className="mt-2">未关联项目</div>
          )}
        </div>
      </div>

      <hr className="wb-section-rule" />

      {/* 操作按钮区 - 根据状态动态显示 */}
      {!isFinished && (
        <div className="mt-4 flex flex-wrap gap-2">
          {availableActions.includes('start') && (
            <button type="button" onClick={onStart} aria-label="开始处理任务" className="neu-btn-soft">
              <PlayCircle size={16} />开始处理
            </button>
          )}
          {availableActions.includes('complete') && (
            <button type="button" onClick={onComplete} aria-label="标记任务完成" className="neu-btn-soft is-success">
              <CheckCheck size={16} />标记完成
            </button>
          )}
          {availableActions.includes('block') && (
            <button type="button" onClick={onBlock} aria-label="标记任务受阻" className="neu-btn-soft is-danger">
              <AlertTriangle size={16} />标记受阻
            </button>
          )}
          {availableActions.includes('unblock') && (
            <button type="button" onClick={onUnblock} aria-label="恢复处理" className="neu-btn-soft is-info">
              <RotateCcw size={16} />恢复处理
            </button>
          )}
          {availableActions.includes('cancel') && (
            <button type="button" onClick={onCancel} aria-label="取消任务" className="neu-btn-soft">
              <XCircle size={16} />取消任务
            </button>
          )}
          {(reminderState === 'NONE' || reminderState === 'OVERDUE') && (
            <>
              <button type="button" onClick={() => setShowReminderPicker((v) => !v)} className={`neu-btn-soft ${reminderState === 'OVERDUE' ? 'is-warning' : ''}`}>
                <Clock3 size={16} />{reminderState === 'NONE' ? '设置提醒' : '新设提醒'}
              </button>
              {showReminderPicker && (
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    defaultValue={new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16)}
                    className="neu-input text-sm h-9"
                    id="qv-reset-reminder-time"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById('qv-reset-reminder-time') as HTMLInputElement;
                      if (el?.value) {
                        onResetReminder(new Date(el.value).toISOString());
                        setShowReminderPicker(false);
                      }
                    }}
                    className="neu-btn-soft is-success h-9"
                  >
                    确定
                  </button>
                  <button type="button" onClick={() => setShowReminderPicker(false)} className="neu-btn-soft h-9">
                    取消
                  </button>
                </div>
              )}
            </>
          )}
          {reminderState !== 'NONE' && reminderState !== 'OVERDUE' && (
            <button type="button" onClick={onPostponeReminder} aria-label="延后提醒 30 分钟" className="neu-btn-soft">
              <Clock3 size={16} />延后提醒
            </button>
          )}
          <button type="button" onClick={onOpenNotes} aria-label="添加进展记录" className="neu-btn-soft">
            <FilePenLine size={16} />添加记录
          </button>
        </div>
      )}

      {/* 已完成任务的完成信息 */}
      {isFinished ? <hr className="wb-section-rule" /> : null}
      {isFinished && item.completionSummary && (
        <div className="mt-4 neu-content-block" style={{ '--block-accent': 'var(--success)' } as React.CSSProperties}>
          <div className="text-xs font-semibold text-[rgba(92,181,150,1)] mb-1">完成摘要</div>
          <div className="text-sm text-[color:var(--foreground)]">{item.completionSummary}</div>
        </div>
      )}

      {/* 笔记历史 - 显示所有笔记 */}
      <div className="mt-4">
        <div className="text-xs font-semibold text-[color:var(--accent)] mb-2">过程记录</div>
        {item.notes.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {item.notes.map((note) => (
              <div
                key={note.id}
                className="neu-surface-subtle rounded-[12px] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-[color:var(--accent)]">
                    {note.type === 'PROGRESS' ? '进展' : note.type === 'INSIGHT' ? '心得' : '记录'}
                  </span>
                  <span className="text-xs text-[color:var(--muted-foreground)] tabular-nums">
                    {formatDateTimeLabel(note.createdAt)}
                  </span>
                </div>
                <div className="text-[color:var(--foreground)] leading-relaxed">{note.content}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="neu-content-block text-sm text-[color:var(--muted-foreground)]" style={{ '--block-accent': 'var(--accent)' } as React.CSSProperties}>
            还没有过程记录，可从当前推进情况开始补第一条。
          </div>
        )}
      </div>
    </section>
  );
}
