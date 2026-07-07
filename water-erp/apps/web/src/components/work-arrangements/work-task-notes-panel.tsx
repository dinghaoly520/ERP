import type { WorkArrangementNoteType, WorkArrangementItem } from '@/lib/types/work-arrangements';

type Props = { open: boolean; selectedItem: WorkArrangementItem | null; noteType: WorkArrangementNoteType; noteDraft: string; noteSubmitting: boolean; onNoteTypeChange: (v: WorkArrangementNoteType) => void; onNoteDraftChange: (v: string) => void; onSubmit: () => void; };

function fmt(v: string|null){ if(!v)return'未设置'; return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v)); }

export function WorkTaskNotesPanel({ open, selectedItem, noteType, noteDraft, noteSubmitting, onNoteTypeChange, onNoteDraftChange, onSubmit }: Props) {
  if(!open) return null;
  return (<div className="mt-4">
    <div className="neu-section-heading mb-3">过程记录与心得</div>
    {selectedItem ? (<>
      <div className="grid gap-2">
        <select value={noteType} onChange={e=>onNoteTypeChange(e.target.value as WorkArrangementNoteType)} className="workbench-input text-sm"><option value="PROGRESS">过程记录</option><option value="INSIGHT">心得补充</option></select>
        <textarea value={noteDraft} onChange={e=>onNoteDraftChange(e.target.value)} rows={3} placeholder="记录今天推进到了哪一步、遇到了什么问题、下一步准备怎么做。" className="neu-input text-sm"/>
        <button type="button" onClick={onSubmit} disabled={noteSubmitting||!noteDraft.trim()} className="neu-btn-primary self-start">{noteSubmitting?'提交中...':'添加记录'}</button>
      </div>
      <div className="mt-4 space-y-3">
        {selectedItem.notes.length ? selectedItem.notes.map(n=>(<div key={n.id} className="neu-surface-subtle px-3 py-3">
          <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-[rgba(111,153,237,0.12)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--accent)]">{n.type==='PROGRESS'?'过程记录':'心得补充'}</span><span className="text-[11px] text-[color:var(--muted-foreground)]">{fmt(n.createdAt)}</span></div>
          <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">{n.content}</p>
        </div>)) : (<div className="neu-content-block text-sm text-[color:var(--muted-foreground)]" style={{'--block-accent':'var(--accent)'} as React.CSSProperties}>还没有过程记录，从今天的推进情况开始写第一条。</div>)}
      </div>
    </>) : (<div className="neu-content-block text-sm text-[color:var(--muted-foreground)]" style={{'--block-accent':'var(--accent)'} as React.CSSProperties}>先创建或选择一条工作安排，再补充过程记录和心得总结。</div>)}
  </div>);
}
