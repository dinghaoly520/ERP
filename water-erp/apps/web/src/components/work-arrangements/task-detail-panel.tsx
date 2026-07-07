'use client';

import { FilePenLine } from 'lucide-react';
import { WorkTaskQuickView } from '@/components/work-arrangements/work-task-quick-view';
import { WorkTaskNotesPanel } from '@/components/work-arrangements/work-task-notes-panel';
import type { WorkArrangementItem, WorkArrangementReminderState, WorkArrangementNoteType } from '@/lib/types/work-arrangements';

export function TaskDetailPanel({ item, reminderState, noteType, noteDraft, noteSubmitting, showNotesPanel, onStart, onComplete, onBlock, onUnblock, onCancel, onPostponeReminder, onOpenFullEditor, onOpenNotes, onNoteTypeChange, onNoteDraftChange, onSubmitNote }: {
  item: WorkArrangementItem|null; reminderState: WorkArrangementReminderState; noteType: WorkArrangementNoteType;
  noteDraft: string; noteSubmitting: boolean; showNotesPanel: boolean;
  onStart:()=>void; onComplete:()=>void; onBlock:()=>void; onUnblock:()=>void; onCancel:()=>void;
  onPostponeReminder:()=>void; onOpenFullEditor:()=>void; onOpenNotes:()=>void;
  onNoteTypeChange:(v:WorkArrangementNoteType)=>void; onNoteDraftChange:(v:string)=>void; onSubmitNote:()=>void;
}) {
  return (
    <section className="wb-panel">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">任务详情</span>
        <button type="button" onClick={onOpenFullEditor} className="neu-btn-xs"><FilePenLine size={14}/>编辑</button>
      </div>
      <div className="wb-panel-body">
        <WorkTaskQuickView item={item} reminderState={reminderState} onStart={onStart} onComplete={onComplete} onBlock={onBlock} onUnblock={onUnblock} onCancel={onCancel} onPostponeReminder={onPostponeReminder} onOpenFullEditor={onOpenFullEditor} onOpenNotes={onOpenNotes}/>
        <WorkTaskNotesPanel open={showNotesPanel} selectedItem={item} noteType={noteType} noteDraft={noteDraft} noteSubmitting={noteSubmitting} onNoteTypeChange={onNoteTypeChange} onNoteDraftChange={onNoteDraftChange} onSubmit={onSubmitNote}/>
      </div>
    </section>
  );
}
