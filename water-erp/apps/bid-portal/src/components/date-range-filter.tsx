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
  if (!start && !end) return '选择日期';
  if (start && !end) return start;
  if (start && end) {
    const s = start.slice(5);
    const e = end.slice(5);
    if (start.slice(0, 7) === end.slice(0, 7)) return `${s} ~ ${e}`;
    return `${start} ~ ${end}`;
  }
  return '选择日期';
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
    onChange({ start: draftStart, end: draftEnd });
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
    for (let i = 0; i < firstDay; i++) cells.push(<div key={`pad-${i}`} className="w-8 h-8" />);
    for (let day = 1; day <= days; day++) {
      const dateStr = fmtDateStr(year, month, day);
      const isToday = dateStr === fmtDateStr(today.getFullYear(), today.getMonth(), today.getDate());
      const inRange = isInDraftRange(year, month, day);
      const isBoundary = isDraftBoundary(dateStr);
      cells.push(
        <button
          key={day}
          onClick={() => handleDayClick(year, month, day)}
          className={`w-8 h-8 flex items-center justify-center text-[12px] font-medium rounded-lg transition-colors relative ${
            isBoundary ? 'bg-[#064ea2] text-white' : inRange ? 'bg-[#eff6ff] text-[#064ea2]' : 'text-[#5a6d8a] hover:bg-[#f8fafc]'
          }`}
        >
          {isToday && !isBoundary && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#064ea2]" />}
          {day}
        </button>
      );
    }
    return cells;
  };

  const monthLabel = (year: number, month: number) => `${year}年 ${month + 1}月`;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold transition whitespace-nowrap ${
          (value.start || value.end)
            ? 'border-[#064ea2] bg-[#eff6ff] text-[#064ea2]'
            : 'border-[#e8f0fa] bg-white text-[#5a6d8a] hover:border-[#064ea2] hover:text-[#18243a]'
        }`}
      >
        <Calendar size={12} strokeWidth={1.5} />
        <span>{formatDisplayRange(value.start, value.end)}</span>
        {(value.start || value.end) && (
          <X size={12} strokeWidth={1.5} className="text-[#94a3b8] hover:text-[#e74c3c]"
            onClick={(e) => { e.stopPropagation(); clearFilter(); }} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 rounded-2xl border border-[#dbe6f3] bg-white shadow-[0_18px_60px_rgba(15,47,87,0.12)] p-4 w-[580px]">
          <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-[#edf2f7]">
            <span className="text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wider mr-1">快捷</span>
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => applyPreset(p.days)}
                className="px-2.5 py-1 text-[11px] font-bold rounded-lg text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#064ea2] transition">
                {p.label}
              </button>
            ))}
            <button onClick={clearFilter}
              className="px-2.5 py-1 text-[11px] font-bold rounded-lg text-[#8a96aa] hover:bg-[#f8fafc] hover:text-[#e74c3c] transition ml-auto">
              全部
            </button>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => leftMonth === 0 ? (setLeftMonth(11), setLeftYear(leftYear - 1)) : setLeftMonth(leftMonth - 1)}
                  className="p-1 rounded text-[#94a3b8] hover:text-[#18243a]">
                  <ChevronLeft size={14} strokeWidth={1.5} />
                </button>
                <span className="text-[12px] font-bold text-[#18243a]">{monthLabel(leftYear, leftMonth)}</span>
                <div className="w-6" />
              </div>
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {WEEKDAYS.map(w => <div key={w} className="w-8 h-6 flex items-center justify-center text-[10px] font-semibold text-[#94a3b8]">{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">{renderMonth(leftYear, leftMonth)}</div>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <div className="w-6" />
                <span className="text-[12px] font-bold text-[#18243a]">{monthLabel(rightYear, rightMonth)}</span>
                <button onClick={() => leftMonth === 11 ? (setLeftMonth(0), setLeftYear(leftYear + 1)) : setLeftMonth(leftMonth + 1)}
                  className="p-1 rounded text-[#94a3b8] hover:text-[#18243a]">
                  <ChevronRight size={14} strokeWidth={1.5} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {WEEKDAYS.map(w => <div key={w} className="w-8 h-6 flex items-center justify-center text-[10px] font-semibold text-[#94a3b8]">{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">{renderMonth(rightYear, rightMonth)}</div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#edf2f7]">
            <span className="text-[11px] text-[#8a96aa]">
              {selecting === 'start'
                ? draftStart ? `已选起始: ${draftStart} — 点击结束日期` : '点击选择起始日期'
                : `已选: ${draftStart} ~ ${draftEnd || '...'}`}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={clearFilter} className="px-3 py-1.5 text-[11px] font-bold text-[#8a96aa] hover:text-[#18243a] transition">清除</button>
              <button onClick={applyCustom} className="px-4 py-1.5 text-[11px] font-bold rounded-xl bg-[#064ea2] text-white hover:bg-[#0b63ce] transition">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
