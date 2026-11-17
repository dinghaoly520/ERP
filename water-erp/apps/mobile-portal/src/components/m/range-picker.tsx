"use client";

import { useEffect, useState } from "react";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { BottomSheet } from "@/components/m/bottom-sheet";

export type RangeKey = "month" | "quarter" | "year" | "all";

export const RANGE_LABELS: Record<RangeKey, string> = { month: "本月", quarter: "本季", year: "本年", all: "全部" };

/**
 * 时间范围选择器（2026-11-17 改版：chips 横滚行 → 下拉按钮+弹层，与 CompanyPicker
 * 同构）。快捷四档一键选；自定义日期在弹层内两输入 + 应用（草稿本地暂存，应用才生效）。
 * value.custom 非空 = 自定义生效中（优先展示日期段标签，页面侧 usingCustom 同源语义）。
 */
export function RangePicker({
  value,
  onPickKey,
  onApplyCustom,
  className = "",
}: {
  value: { rangeKey: RangeKey; custom: { startDate?: string; endDate?: string } };
  onPickKey: (key: RangeKey) => void;
  onApplyCustom: (custom: { startDate?: string; endDate?: string }) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStart(value.custom.startDate ?? "");
      setEnd(value.custom.endDate ?? "");
      setError(null);
    }
  }, [open, value.custom.startDate, value.custom.endDate]);

  const usingCustom = Boolean(value.custom.startDate || value.custom.endDate);
  const md = (iso?: string) => (iso ? iso.slice(5) : "");
  const triggerLabel = usingCustom
    ? `${md(value.custom.startDate)} ~ ${value.custom.endDate ? md(value.custom.endDate) : "今天"}`
    : RANGE_LABELS[value.rangeKey];

  function applyCustom() {
    if (start && end && start > end) {
      setError("开始日期不能晚于结束日期");
      return;
    }
    setOpen(false);
    onApplyCustom({ startDate: start || undefined, endDate: end || undefined });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`m-input relative mb-3 flex w-full items-center gap-2 text-left font-medium ${className}`}
      >
        <CalendarRange size={15} className="shrink-0 text-[var(--muted-foreground)]" />
        <span className={`min-w-0 flex-1 truncate ${usingCustom ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}>{triggerLabel}</span>
        <ChevronDown size={15} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <CalendarRange size={16} className="text-[var(--accent)]" />
            选择时间范围
          </span>
        }
      >
        <div className="space-y-1.5">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => {
            const active = value.rangeKey === key && !usingCustom;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPickKey(key);
                }}
                aria-pressed={active}
                className="m-tile flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left active:scale-[0.99]"
                style={active ? { background: "color-mix(in oklch, var(--accent) 8%, oklch(0.985 0.005 258))" } : undefined}
              >
                <span className={`min-w-0 flex-1 truncate text-[16px] ${active ? "font-bold text-[var(--accent)]" : "font-semibold text-[var(--foreground)]"}`}>
                  {RANGE_LABELS[key]}
                </span>
                {active ? <Check size={15} className="shrink-0 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>

        {/* 自定义区间：草稿本地暂存，应用才生效（同 CompanyPicker 确定制） */}
        <div className="mt-3 rounded-[12px] bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-3 py-3">
          <div className="mb-2 text-[14px] font-bold tracking-[0.06em] text-[var(--muted-foreground)]">自定义区间</div>
          <div className="flex items-center gap-2">
            <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setError(null); }} aria-label="开始日期" className="m-input h-10 min-w-0 flex-1 px-2 tabular-nums" />
            <span className="shrink-0 text-[15px] text-[var(--muted-foreground)]">至</span>
            <input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setError(null); }} aria-label="结束日期" className="m-input h-10 min-w-0 flex-1 px-2 tabular-nums" />
            <button type="button" onClick={applyCustom} className="neu-btn-soft h-10 shrink-0 rounded-[9px] px-3 text-[15px]">
              应用
            </button>
          </div>
          {error ? <div className="mt-1.5 text-[12px] text-[var(--danger)]">{error}</div> : null}
        </div>
      </BottomSheet>
    </>
  );
}
