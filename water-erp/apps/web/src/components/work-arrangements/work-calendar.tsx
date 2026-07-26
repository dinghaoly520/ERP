'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkArrangementItem, WorkArrangementUrgency } from '@/lib/types/work-arrangements';

type CalendarDay = {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isWeekend: boolean;
  dots: WorkArrangementUrgency[];
  taskCount: number;
};

const URGENCY_COLORS: Record<WorkArrangementUrgency, string> = {
  CRITICAL: '#EF4444',
  HIGH: '#F59E0B',
  MEDIUM: '#3B82F6',
  LOW: '#10B981',
};

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MAX_DOTS = 4;

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function WorkCalendar({
  items,
  selectedDate,
  onDateSelect,
}: {
  items: WorkArrangementItem[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() =>
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
  );

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const dotMap = useMemo(() => {
    const map = new Map<string, { dots: WorkArrangementUrgency[]; count: number }>();
    for (const item of items) {
      if (!item.dueAt || item.status === 'COMPLETED' || item.status === 'CANCELLED') continue;
      const d = new Date(item.dueAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const entry = map.get(key) ?? { dots: [], count: 0 };
      entry.count++;
      if (entry.dots.length < MAX_DOTS) {
        entry.dots.push(item.urgency);
      }
      map.set(key, entry);
    }
    return map;
  }, [items]);

  const calendarDays = useMemo(() => {
    const days: CalendarDay[] = [];
    const monthStart = startOfMonth(viewMonth);

    let startDow = monthStart.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const startDate = new Date(monthStart);
    startDate.setDate(startDate.getDate() - startDow);

    for (let i = 0; i < 42; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);

      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const dow = date.getDay();

      days.push({
        date,
        isCurrentMonth: date.getMonth() === viewMonth.getMonth(),
        isToday: isSameDay(date, today),
        isSelected: isSameDay(date, selectedDate),
        isWeekend: dow === 0 || dow === 6,
        dots: dotMap.get(key)?.dots ?? [],
        taskCount: dotMap.get(key)?.count ?? 0,
      });
    }

    return days;
  }, [viewMonth, today, selectedDate, dotMap]);

  const goToPrevMonth = useCallback(() => {
    setViewMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const goToNextMonth = useCallback(() => {
    setViewMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

  const goToToday = useCallback(() => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    onDateSelect(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }, [onDateSelect]);

  const monthLabel = `${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`;

  return (
    <div className="rounded-[18px] px-1 pt-1 pb-1">
      <div className="relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="rounded-[10px] p-1.5 text-[color:var(--muted-foreground)] transition hover:bg-[rgba(96,139,239,0.08)] hover:text-[color:var(--accent)]"
              aria-label="上个月"
            >
              <ChevronLeft size={16} strokeWidth={2.5} />
            </button>
            <span className="px-2 text-[15px] font-bold tracking-tight text-[color:var(--foreground)]">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={goToNextMonth}
              className="rounded-[10px] p-1.5 text-[color:var(--muted-foreground)] transition hover:bg-[rgba(96,139,239,0.08)] hover:text-[color:var(--accent)]"
              aria-label="下个月"
            >
              <ChevronRight size={16} strokeWidth={2.5} />
            </button>
          </div>
          <button type="button" onClick={goToToday} className="neu-btn-xs is-info">今天</button>
        </div>

        {/* Weekday headers */}
        <div className="mb-[2px] grid grid-cols-7">
          {WEEKDAY_LABELS.map(label => (
            <div
              key={label}
              className="flex items-center justify-center py-1.5 text-[10px] font-semibold tracking-wide"
              style={{ color: 'rgba(96,139,239,0.5)' }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            const dayNum = day.date.getDate();
            const hasTasks = day.dots.length > 0;

            let cellClass = 'flex flex-col items-center justify-center rounded-[10px] cursor-pointer transition-all duration-200 text-xs leading-none select-none py-2';
            if (!day.isCurrentMonth) {
              cellClass += ' text-[var(--muted-foreground)] opacity-30';
            } else if (day.isToday && day.isSelected) {
              cellClass += ' text-white font-bold bg-[var(--accent)] shadow-[0_2px_10px_var(--accent)/35] ring-2 ring-[var(--accent)]/25';
            } else if (day.isSelected) {
              cellClass += ' text-[var(--accent)] font-bold bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/30';
            } else if (day.isToday) {
              cellClass += ' text-white font-bold bg-[var(--accent)] shadow-[0_2px_8px_var(--accent)/35]';
            } else if (hasTasks) {
              cellClass += ' text-[var(--foreground)] font-medium bg-[var(--accent-soft)]/60 hover:shadow-[0_1px_6px_var(--accent)/12]';
            } else if (day.isWeekend) {
              cellClass += ' text-[var(--muted-foreground)] opacity-60 hover:bg-[var(--accent-soft)]/30';
            } else {
              cellClass += ' text-[var(--foreground)] hover:bg-[var(--accent-soft)]/30';
            }
            return (
              <button key={idx} type="button" onClick={() => day.isCurrentMonth && onDateSelect(day.date)} className={cellClass} aria-label={`${day.date.getMonth() + 1}月${dayNum}日`}>
                <span>{dayNum}</span>
                {day.dots.length > 0 && (
                  <div className="mt-[2px] flex gap-[2px] justify-center">
                    {day.dots.map((urgency, dotIdx) => (
                      <span
                        key={dotIdx}
                        className="block rounded-full"
                        style={{
                          width: '4px',
                          height: '4px',
                          backgroundColor: day.isToday || day.isSelected
                            ? 'rgba(255,255,255,0.9)'
                            : URGENCY_COLORS[urgency],
                          boxShadow: day.isToday || day.isSelected
                            ? 'none'
                            : `0 0 4px ${URGENCY_COLORS[urgency]}40`,
                        }}
                      />
                    ))}
                    {day.taskCount > MAX_DOTS && (
                      <span className="text-[7px] font-bold leading-none text-[color:var(--muted-foreground)]">+{day.taskCount - MAX_DOTS}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center justify-center gap-5 pt-2 text-[10px] text-[var(--muted-foreground)] border-t border-[var(--border)]/40">
          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(level => (
            <span key={level} className="flex items-center gap-1.5">
              <span
                className="inline-block rounded-full"
                style={{
                  width: '7px',
                  height: '7px',
                  backgroundColor: URGENCY_COLORS[level],
                  boxShadow: `0 0 6px ${URGENCY_COLORS[level]}30`,
                }}
              />
              {level === 'CRITICAL' ? '紧急' : level === 'HIGH' ? '高' : level === 'MEDIUM' ? '中' : '低'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
