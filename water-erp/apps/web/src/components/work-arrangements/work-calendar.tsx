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
};

const URGENCY_COLORS: Record<WorkArrangementUrgency, string> = {
  CRITICAL: '#EF4444',
  HIGH: '#F59E0B',
  MEDIUM: '#3B82F6',
  LOW: '#10B981',
};

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MAX_DOTS = 4;
const GRID_STYLE: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' };

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
    const map = new Map<string, WorkArrangementUrgency[]>();
    for (const item of items) {
      if (!item.dueAt || item.status === 'COMPLETED' || item.status === 'CANCELLED') continue;
      const d = new Date(item.dueAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(key) ?? [];
      if (list.length < MAX_DOTS) {
        list.push(item.urgency);
      }
      map.set(key, list);
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
        dots: dotMap.get(key) ?? [],
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
    <div
      className="relative rounded-[18px] px-4 pt-4 pb-3"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(242,247,255,0.85))',
        border: '1px solid rgba(192,208,235,0.55)',
        boxShadow: 'var(--shadow-panel)',
        overflow: 'hidden',
      }}
    >
      {/* Ambient light overlay — separate div avoids isolation/isolation issues */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: '-18% -12% 24% -10%',
          zIndex: 0,
          pointerEvents: 'none',
          background: [
            'radial-gradient(circle at 14% 26%, rgba(108,149,244,0.14), transparent 26%)',
            'radial-gradient(circle at 84% 20%, rgba(248,201,128,0.13), transparent 22%)',
            'radial-gradient(circle at 56% 82%, rgba(102,194,173,0.12), transparent 24%)',
          ].join(', '),
          filter: 'blur(28px)',
          animation: 'chromaShift 16s cubic-bezier(0.22,1,0.36,1) infinite',
        }}
      />

      {/* Content layer — above the ambient overlay */}
      <div style={{ position: 'relative', zIndex: 1 }}>
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
          <button
            type="button"
            onClick={goToToday}
            className="rounded-[10px] px-3 py-1 text-[11px] font-semibold transition"
            style={{
              background: 'linear-gradient(135deg, rgba(96,139,239,0.1), rgba(96,139,239,0.06))',
              color: 'var(--accent)',
              boxShadow: '0 1px 3px rgba(96,139,239,0.1)',
            }}
          >
            今天
          </button>
        </div>

        {/* Weekday headers */}
        <div className="mb-[2px]" style={GRID_STYLE}>
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
        <div style={GRID_STYLE}>
          {calendarDays.map((day, idx) => {
            const dayNum = day.date.getDate();
            const hasTasks = day.dots.length > 0;

            let bgStyle: React.CSSProperties = {};
            let cellClass = 'flex flex-col items-center justify-center rounded-[10px] cursor-pointer transition-all duration-200 text-xs leading-none select-none py-2';

            if (!day.isCurrentMonth) {
              cellClass += ' text-gray-300';
            } else if (day.isToday && day.isSelected) {
              bgStyle = {
                background: 'linear-gradient(135deg, #4F7DF5, #6C9BF2)',
                boxShadow: '0 2px 10px rgba(79,125,245,0.35), 0 0 0 2px rgba(108,155,242,0.25)',
              };
              cellClass += ' text-white font-bold';
            } else if (day.isSelected) {
              bgStyle = {
                background: 'linear-gradient(135deg, rgba(96,139,239,0.15), rgba(96,139,239,0.08))',
                boxShadow: '0 0 0 1.5px rgba(96,139,239,0.3), inset 0 1px 2px rgba(255,255,255,0.6)',
              };
              cellClass += ' text-[color:var(--accent)] font-bold';
            } else if (day.isToday) {
              bgStyle = {
                background: 'linear-gradient(135deg, #4F7DF5, #6C9BF2)',
                boxShadow: '0 2px 10px rgba(79,125,245,0.35)',
              };
              cellClass += ' text-white font-bold';
            } else if (hasTasks) {
              bgStyle = {
                background: 'linear-gradient(135deg, rgba(242,247,255,0.9), rgba(235,242,255,0.7))',
              };
              cellClass += ' text-[color:var(--foreground)] font-medium';
              cellClass += ' hover:shadow-[0_1px_6px_rgba(96,139,239,0.12)]';
            } else if (day.isWeekend) {
              cellClass += ' text-gray-400 hover:bg-[rgba(242,247,255,0.5)]';
            } else {
              cellClass += ' text-[color:var(--foreground)] hover:bg-[rgba(242,247,255,0.5)]';
            }

            return (
              <button
                key={idx}
                type="button"
                onClick={() => day.isCurrentMonth && onDateSelect(day.date)}
                className={cellClass}
                style={bgStyle}
                aria-label={`${day.date.getMonth() + 1}月${dayNum}日`}
              >
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
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div
          className="mt-3 flex items-center justify-center gap-5 pt-2 text-[10px]"
          style={{
            borderTop: '1px solid rgba(192,208,235,0.3)',
            color: 'var(--muted-foreground)',
          }}
        >
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
