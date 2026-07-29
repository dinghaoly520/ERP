'use client';

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface DateRangeFilterProps {
  value: { start: string; end: string };
  onChange: (range: { start: string; end: string }) => void;
}

const PRESETS = [
  { key: '1m' as const, label: '近一月', days: 30 },
  { key: '3m' as const, label: '近一季', days: 90 },
  { key: '6m' as const, label: '近半年', days: 180 },
  { key: '1y' as const, label: '近一年', days: 365 },
] as const;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function fmtDateStr(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function formatDisplayRange(start: string, end: string): string {
  if (!start && !end) return '选择日期范围';
  if (start && !end) return start;
  if (start && end) {
    const s = start.slice(5);
    const e = end.slice(5);
    if (start.slice(0, 7) === end.slice(0, 7)) return `${s} ~ ${e}`;
    return `${start} ~ ${end}`;
  }
  return '选择日期范围';
}

export default function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const [leftYear, setLeftYear] = useState(today.getFullYear());
  const [leftMonth, setLeftMonth] = useState(today.getMonth());
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;

  const [selecting, setSelecting] = useState<'start' | 'end'>('start');
  const [draftStart, setDraftStart] = useState(value.start);
  const [draftEnd, setDraftEnd] = useState(value.end);

  // 外部 value 变化时间步草稿
  useEffect(() => {
    setDraftStart(value.start);
    setDraftEnd(value.end);
  }, [value.start, value.end]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleDayClick = (year: number, month: number, day: number) => {
    const dateStr = fmtDateStr(year, month, day);
    if (selecting === 'start') {
      setDraftStart(dateStr);
      setDraftEnd('');
      setSelecting('end');
    } else {
      if (dateStr < draftStart) {
        setDraftStart(dateStr);
        setDraftEnd(draftStart);
      } else {
        setDraftEnd(dateStr);
      }
      setSelecting('start');
    }
  };

  const applyPreset = (days: number) => {
    const end = new Date();
    const endStr = fmtDateStr(end.getFullYear(), end.getMonth(), end.getDate());
    const start = new Date(Date.now() - days * 86400000);
    const startStr = fmtDateStr(start.getFullYear(), start.getMonth(), start.getDate());
    onChange({ start: startStr, end: endStr });
    setOpen(false);
  };

  const applyCustom = () => {
    if (draftStart && draftEnd) {
      onChange({ start: draftStart, end: draftEnd });
    }
    setOpen(false);
  };

  const clearFilter = () => {
    setDraftStart('');
    setDraftEnd('');
    setSelecting('start');
    onChange({ start: '', end: '' });
    setOpen(false);
  };

  const isInDraftRange = (year: number, month: number, day: number) => {
    const d = fmtDateStr(year, month, day);
    if (draftStart && draftEnd) return d >= draftStart && d <= draftEnd;
    if (draftStart && !draftEnd) return d === draftStart;
    return false;
  };

  const isDraftBoundary = (d: string) => d === draftStart || d === draftEnd;

  const renderMonth = (year: number, month: number) => {
    const days = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(<div key={`pad-${i}`} className="h-8 w-8" />);
    for (let day = 1; day <= days; day++) {
      const dateStr = fmtDateStr(year, month, day);
      const isToday = dateStr === fmtDateStr(today.getFullYear(), today.getMonth(), today.getDate());
      const inRange = isInDraftRange(year, month, day);
      const isBoundary = isDraftBoundary(dateStr);
      cells.push(
        <button
          key={day}
          type="button"
          onClick={() => handleDayClick(year, month, day)}
          className={`flex h-8 w-8 items-center justify-center rounded-[10px] text-[12px] font-medium transition-colors relative ${
            isBoundary
              ? 'bg-[var(--accent)] text-white shadow-[0_4px_12px_rgba(6,78,162,0.25)]'
              : inRange
                ? 'bg-[oklch(0.62_0.16_258_/_0.1)] text-[color:var(--accent-strong)]'
                : 'text-[color:var(--muted-foreground)] hover:bg-[oklch(0.985_0.006_258_/_0.7)]'
          }`}
        >
          {isToday && !isBoundary && (
            <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[color:var(--accent)]" />
          )}
          {day}
        </button>,
      );
    }
    return cells;
  };

  const monthLabel = (year: number, month: number) => `${year}年 ${month + 1}月`;
  const hasValue = value.start || value.end;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`neu-btn-soft inline-flex items-center gap-1.5 !px-3 !py-2 text-[12px] whitespace-nowrap ${
          hasValue ? '!border-[var(--accent)] !bg-[oklch(0.62_0.16_258_/_0.08)] !text-[color:var(--accent-strong)]' : ''
        }`}
      >
        <Calendar size={14} strokeWidth={1.5} />
        <span>{formatDisplayRange(value.start, value.end)}</span>
        {hasValue && (
          <X
            size={12}
            strokeWidth={1.5}
            className="text-[color:var(--muted-foreground)] hover:text-[var(--danger)]"
            onClick={e => {
              e.stopPropagation();
              clearFilter();
            }}
          />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[580px] rounded-2xl border border-[oklch(0.6_0.04_258_/_0.18)] bg-white p-4 shadow-[0_18px_60px_rgba(15,47,87,0.14)]">
          {/* 快捷预设 */}
          <div className="mb-3 flex items-center gap-1.5 border-b border-[oklch(0.6_0.04_258_/_0.14)] pb-3">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              快捷
            </span>
            {PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.days)}
                className="rounded-[10px] px-2.5 py-1 text-[11px] font-bold text-[color:var(--muted-foreground)] transition hover:bg-[oklch(0.62_0.16_258_/_0.08)] hover:text-[color:var(--accent-strong)]"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={clearFilter}
              className="ml-auto rounded-[10px] px-2.5 py-1 text-[11px] font-bold text-[color:var(--muted-foreground)] transition hover:bg-[oklch(0.66_0.175_27_/_0.08)] hover:text-[var(--danger)]"
            >
              全部
            </button>
          </div>

          {/* 双月历 */}
          <div className="flex gap-4">
            {[ { year: leftYear, month: leftMonth }, { year: rightYear, month: rightMonth } ].map(
              ({ year, month }, panelIdx) => (
                <div key={panelIdx} className="flex-1">
                  <div className="mb-2 flex items-center justify-between">
                    {panelIdx === 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          leftMonth === 0
                            ? (setLeftMonth(11), setLeftYear(leftYear - 1))
                            : setLeftMonth(leftMonth - 1)
                        }
                        className="rounded p-1 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
                      >
                        <ChevronLeft size={14} strokeWidth={1.5} />
                      </button>
                    ) : (
                      <div className="w-6" />
                    )}
                    <span className="text-[12px] font-bold text-[color:var(--foreground)]">
                      {monthLabel(year, month)}
                    </span>
                    {panelIdx === 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          leftMonth === 11
                            ? (setLeftMonth(0), setLeftYear(leftYear + 1))
                            : setLeftMonth(leftMonth + 1)
                        }
                        className="rounded p-1 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
                      >
                        <ChevronRight size={14} strokeWidth={1.5} />
                      </button>
                    ) : (
                      <div className="w-6" />
                    )}
                  </div>
                  <div className="mb-1 grid grid-cols-7 gap-0.5">
                    {WEEKDAYS.map(w => (
                      <div
                        key={w}
                        className="flex h-6 w-8 items-center justify-center text-[10px] font-semibold text-[color:var(--muted-foreground)]"
                      >
                        {w}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5">{renderMonth(year, month)}</div>
                </div>
              ),
            )}
          </div>

          {/* 底部操作栏 */}
          <div className="mt-3 flex items-center justify-between border-t border-[oklch(0.6_0.04_258_/_0.14)] pt-3">
            <span className="text-[11px] text-[color:var(--muted-foreground)]">
              {selecting === 'start'
                ? draftStart
                  ? `已选起始: ${draftStart} — 点击结束日期`
                  : '点击选择起始日期'
                : `已选: ${draftStart} ~ ${draftEnd || '...'}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearFilter}
                className="rounded-[10px] px-3 py-1.5 text-[11px] font-bold text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
              >
                清除
              </button>
              <button
                type="button"
                onClick={applyCustom}
                className="neu-btn-primary !h-auto !rounded-[10px] !px-4 !py-1.5 text-[11px]"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
