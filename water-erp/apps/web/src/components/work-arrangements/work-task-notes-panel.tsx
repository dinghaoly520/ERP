import type { WorkArrangementNoteType, WorkArrangementItem } from '@/lib/types/work-arrangements';

type WorkTaskNotesPanelProps = {
  open: boolean;
  selectedItem: WorkArrangementItem | null;
  noteType: WorkArrangementNoteType;
  noteDraft: string;
  noteSubmitting: boolean;
  onNoteTypeChange: (value: WorkArrangementNoteType) => void;
  onNoteDraftChange: (value: string) => void;
  onSubmit: () => void;
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

export function WorkTaskNotesPanel({
  open,
  selectedItem,
  noteType,
  noteDraft,
  noteSubmitting,
  onNoteTypeChange,
  onNoteDraftChange,
  onSubmit,
}: WorkTaskNotesPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="mt-4 rounded-[22px] border border-white/60 bg-[rgba(248,251,255,0.84)] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
        过程记录与心得
      </div>
      {selectedItem ? (
        <>
          <div className="mt-3 grid gap-2">
            <select
              value={noteType}
              onChange={(event) => onNoteTypeChange(event.target.value as WorkArrangementNoteType)}
              className="rounded-[16px] border border-white/62 bg-white/78 px-3 py-2.5 text-sm outline-none"
            >
              <option value="PROGRESS">过程记录</option>
              <option value="INSIGHT">心得补充</option>
            </select>
            <textarea
              value={noteDraft}
              onChange={(event) => onNoteDraftChange(event.target.value)}
              rows={3}
              placeholder="记录今天推进到了哪一步、遇到了什么问题、下一步准备怎么做。"
              className="rounded-[18px] border border-white/62 bg-white/78 px-3 py-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={noteSubmitting || !noteDraft.trim()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/72 bg-white/82 px-4 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {noteSubmitting ? '提交中...' : '添加记录'}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {selectedItem.notes.length ? (
              selectedItem.notes.map((note) => (
                <div key={note.id} className="rounded-[18px] bg-white/82 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-[rgba(111,153,237,0.12)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--accent)]">
                      {note.type === 'PROGRESS' ? '过程记录' : '心得补充'}
                    </span>
                    <span className="text-[11px] text-[color:var(--muted-foreground)]">
                      {formatDateTimeLabel(note.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">{note.content}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] bg-white/82 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
                还没有过程记录，从今天的推进情况开始写第一条。
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-[18px] bg-white/82 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
          先创建或选择一条工作安排，再补充过程记录和心得总结。
        </div>
      )}
    </div>
  );
}
