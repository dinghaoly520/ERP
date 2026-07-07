'use client';

import { Plus } from 'lucide-react';
import { WorkCalendar } from '@/components/work-arrangements/work-calendar';
import { WorkDateTaskList } from '@/components/work-arrangements/work-date-task-list';
import type { WorkArrangementItem } from '@/lib/types/work-arrangements';

export function SchedulePanel({ selectedDate, items, tasksForSelectedDate, unscheduledItems, selectedItemId, highlightedTaskIds, onDateSelect, onSelectTask, onCreateNew }: {
  selectedDate: Date; items: WorkArrangementItem[]; tasksForSelectedDate: WorkArrangementItem[];
  unscheduledItems: WorkArrangementItem[]; selectedItemId: string | null; highlightedTaskIds: string[];
  onDateSelect: (d: Date) => void; onSelectTask: (id: string) => void; onCreateNew: () => void;
}) {
  const m = selectedDate.getMonth()+1, d = selectedDate.getDate();
  const w = ['周日','周一','周二','周三','周四','周五','周六'][selectedDate.getDay()];
  return (
    <section className="wb-panel h-full">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">{m}月{d}日 {w} · {tasksForSelectedDate.length}项</span>
        <button type="button" onClick={onCreateNew} className="neu-btn-xs"><Plus size={12}/><span>新建</span></button>
      </div>
      <div className="wb-panel-body flex flex-col gap-4">
        <div className="shrink-0 rounded-[16px] bg-[var(--accent-soft)]/20 px-2 py-1"><WorkCalendar items={items} selectedDate={selectedDate} onDateSelect={onDateSelect}/></div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <WorkDateTaskList selectedDate={selectedDate} items={tasksForSelectedDate} unscheduledItems={unscheduledItems} selectedItemId={selectedItemId} highlightedTaskIds={highlightedTaskIds} onSelectTask={onSelectTask} onCreateNew={onCreateNew}/>
        </div>
      </div>
    </section>
  );
}
