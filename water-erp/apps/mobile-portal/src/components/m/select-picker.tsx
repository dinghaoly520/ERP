"use client";

import { useState, type ComponentType } from "react";
import { Check, ChevronDown } from "lucide-react";
import { BottomSheet } from "@/components/m/bottom-sheet";

/**
 * 单选筛选下拉（2026-11-17 台账改版：状态/方式 chips 长条 → 下拉按钮+弹层）。
 * 与 RangePicker/CompanyPicker 同构：m-input 触发器（44px 与搜索框同高）+ BottomSheet
 * 选项列表；value=null 表示「全部」（allLabel）；点选即生效并关层。
 */
export function SelectPicker({
  icon: Icon,
  title,
  allLabel,
  options,
  value,
  onChange,
  className = "",
}: {
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  value: string | null;
  onChange: (v: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const triggerLabel = selected?.label ?? allLabel;

  function pick(v: string | null) {
    setOpen(false);
    onChange(v);
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
        {Icon ? <Icon size={15} className="shrink-0 text-[var(--muted-foreground)]" /> : null}
        <span className={`min-w-0 flex-1 truncate ${selected ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}>{triggerLabel}</span>
        {selected ? (
          <span
            aria-label="清除筛选"
            onClick={(e) => {
              e.stopPropagation();
              pick(null);
            }}
            className="shrink-0 rounded-full px-1 text-[16px] font-bold leading-none text-[var(--muted-foreground)] active:scale-90"
          >
            ×
          </span>
        ) : null}
        <ChevronDown size={15} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            {Icon ? <Icon size={16} className="text-[var(--accent)]" /> : null}
            {title}
          </span>
        }
      >
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => pick(null)}
            aria-pressed={value == null}
            className="m-tile flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left active:scale-[0.99]"
            style={value == null ? { background: "color-mix(in oklch, var(--accent) 8%, oklch(0.985 0.005 258))" } : undefined}
          >
            <span className={`min-w-0 flex-1 truncate text-[16px] ${value == null ? "font-bold text-[var(--accent)]" : "font-semibold text-[var(--foreground)]"}`}>{allLabel}</span>
            {value == null ? <Check size={15} className="shrink-0 text-[var(--accent)]" /> : null}
          </button>
          {options.map((o) => {
            const active = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                aria-pressed={active}
                className="m-tile flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left active:scale-[0.99]"
                style={active ? { background: "color-mix(in oklch, var(--accent) 8%, oklch(0.985 0.005 258))" } : undefined}
              >
                <span className={`min-w-0 flex-1 truncate text-[16px] ${active ? "font-bold text-[var(--accent)]" : "font-semibold text-[var(--foreground)]"}`}>{o.label}</span>
                {active ? <Check size={15} className="shrink-0 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
