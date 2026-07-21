'use client';

import { Plus, History, AlertTriangle, LayoutList } from 'lucide-react';
import { WorkCalendar } from '@/components/work-arrangements/work-calendar';
import { WorkDateTaskList } from '@/components/work-arrangements/work-date-task-list';
import type { WorkArrangementItem } from '@/lib/types/work-arrangements';

export function SchedulePanel({ selectedDate, items, tasksForSelectedDate, unscheduledItems, selectedItemId, highlightedTaskIds, overdueCount, isOverview, onDateSelect, onSelectTask, onCreateNew, onShowHistory, onShowOverdue, onToggleOverview }: {
  selectedDate: Date; items: WorkArrangementItem[]; tasksForSelectedDate: WorkArrangementItem[];
  unscheduledItems: WorkArrangementItem[]; selectedItemId: string | null; highlightedTaskIds: string[];
  overdueCount: number; isOverview: boolean; onDateSelect: (d: Date) => void; onSelectTask: (id: string) => void; onCreateNew: () => void; onShowHistory: () => void; onShowOverdue: () => void; onToggleOverview: () => void;
}) {
  const m = selectedDate.getMonth()+1, d = selectedDate.getDate();
  const w = ['周日','周一','周二','周三','周四','周五','周六'][selectedDate.getDay()];
  return (
    <section className="wb-panel h-full">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">
          {isOverview ? `总览 · ${tasksForSelectedDate.length}项` : `${m}月${d}日 ${w} · ${tasksForSelectedDate.length}项`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleOverview}
            className={`neu-btn-xs ${isOverview ? 'is-info' : ''}`}
          >
            <LayoutList size={12}/>
            <span>{isOverview ? '返回日历' : '总览'}</span>
          </button>
          <button type="button" onClick={onCreateNew} className="neu-btn-xs"><Plus size={12}/><span>新建</span></button>
          {overdueCount > 0 && (
            <button type="button" onClick={onShowOverdue} className="neu-btn-xs is-danger">
              <AlertTriangle size={12}/><span>逾期 {overdueCount}</span>
            </button>
          )}
          <button type="button" onClick={onShowHistory} className="neu-btn-xs"><History size={12}/><span>历史</span></button>
        </div>
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
