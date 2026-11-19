"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * 原地下拉选择（2026-11-19 用户裁定：口径选择不走弹层——锚定触发器原地展开小菜单）。
 * 单选：点选即收起；多选：点选切换不收起（继续勾选）。点外部（document pointerdown）
 * /再点触发器关闭——不用 fixed 遮罩：卡片 .m-rise 动画保留 transform，fixed 后代
 * 会以卡片为包含块，遮罩盖不满视口。
 * selected 由调用方全权解释（如「全部公司」哨兵值），组件只做成员增减。
 */
export function InlineSelect({
  label,
  active = false,
  options,
  selected,
  onSelect,
  multiple = false,
  ariaLabel,
}: {
  /** 触发器文案（调用方算好——区间档名/公司名组合） */
  label: string;
  /** 非默认态高亮（品牌蓝） */
  active?: boolean;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onSelect: (next: string[]) => void;
  multiple?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  function pick(v: string) {
    if (multiple) {
      onSelect(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    } else {
      onSelect([v]);
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        className={`m-tile relative z-[31] flex max-w-[10rem] items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold active:scale-[0.97] ${active ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable={multiple || undefined}
          className="m-menu absolute right-0 top-full z-[31] mt-1.5 max-h-[42dvh] min-w-[12rem] overflow-y-auto overscroll-contain p-1.5"
        >
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => pick(o.value)}
                className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] active:scale-[0.99] ${
                  on ? "bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] font-bold text-[var(--accent)]" : "text-[var(--foreground)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {on ? <Check size={14} className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
