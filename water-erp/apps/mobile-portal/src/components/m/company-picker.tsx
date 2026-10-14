"use client";

import { useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import type { CompanyOption } from "@/lib/api/auth";
import { BottomSheet } from "@/components/m/bottom-sheet";

/**
 * 公司选择器（admin 专属）——替代原生 <select>：原生下拉弹层为 OS 样式无法定制，
 * 与 cgzxui 不同源。触发器保持 .m-input 内凹外观；选项列表用 BottomSheet 呈现
 * （移动端既定下钻面），选中行 accent 高亮 + 勾选。
 */
export function CompanyPicker({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string;
  options: CompanyOption[];
  onChange: (next: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((c) => c.id === value);
  const label = value === "all" ? "全部公司" : current?.shortName || current?.name || "全部公司";

  function pick(next: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  const rows: Array<{ id: string; label: string; sub?: string }> = [
    { id: "all", label: "全部公司", sub: `${options.length} 家公司汇总口径` },
    ...options.map((c) => ({ id: c.id, label: c.shortName || c.name, sub: c.shortName && c.name !== c.shortName ? c.name : undefined })),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`m-input relative mb-3 flex w-full items-center gap-2 text-left font-medium ${className}`}
      >
        <Building2 size={15} className="shrink-0 text-[var(--muted-foreground)]" />
        <span className={`min-w-0 flex-1 truncate ${value === "all" ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]"}`}>{label}</span>
        <ChevronDown size={15} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Building2 size={16} className="text-[var(--accent)]" />
            公司筛选
          </span>
        }
      >
        <div className="space-y-1.5">
          {rows.map((r) => {
            const active = r.id === value;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r.id)}
                aria-pressed={active}
                className="m-tile flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left active:scale-[0.99]"
                style={active ? { background: "color-mix(in oklch, var(--accent) 8%, oklch(0.985 0.005 258))" } : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] ${active ? "font-bold text-[var(--accent)]" : "font-semibold text-[var(--foreground)]"}`}>{r.label}</span>
                  {r.sub ? <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">{r.sub}</span> : null}
                </span>
                {active ? <Check size={15} className="shrink-0 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
