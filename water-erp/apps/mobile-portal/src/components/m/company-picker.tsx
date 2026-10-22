"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Search } from "lucide-react";
import type { CompanyOption } from "@/lib/api/auth";
import { BottomSheet } from "@/components/m/bottom-sheet";

/**
 * 公司选择器（admin 专属，搜索 + 多选）——替代原生 <select>：原生弹层为 OS 样式
 * 无法定制且不支持搜索。value 为数组（空 = 全部公司）；后端 resolveScope 原生
 * 支持逗号多选（companyId=id1,id2 → in 查询）。选择本地暂存，点「确定」才 onChange。
 */
export function CompanyPicker({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string[];
  options: CompanyOption[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value); // 暂存集（确定才生效）
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(value);
      setKeyword("");
    }
  }, [open, value]);

  const nameOf = (id: string) => {
    const c = options.find((o) => o.id === id);
    return c?.shortName || c?.name || id;
  };

  const triggerLabel = useMemo(() => {
    if (value.length === 0) return "全部公司";
    const names = value.map(nameOf);
    return names.length <= 2 ? names.join("、") : `${names.slice(0, 2).join("、")} 等 ${names.length} 家`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options]);

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return options;
    return options.filter((c) => (c.shortName || c.name).includes(kw) || c.name.includes(kw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, options]);

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function confirm() {
    setOpen(false);
    onChange(draft);
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
        <Building2 size={15} className="shrink-0 text-[var(--muted-foreground)]" />
        <span className={`min-w-0 flex-1 truncate ${value.length === 0 ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]"}`}>{triggerLabel}</span>
        {value.length > 0 ? <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-1.5 py-0.5 text-[13px] font-bold text-[var(--accent)]">{value.length}</span> : null}
        <ChevronDown size={15} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Building2 size={16} className="text-[var(--accent)]" />
            公司筛选
            <span className="text-[14px] font-normal text-[var(--muted-foreground)]">多选 · {options.length} 家</span>
          </span>
        }
      >
        <div className="relative mb-2.5">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索公司名称"
            className="m-input h-10 w-full pl-9"
          />
        </div>

        <div className="max-h-[46dvh] space-y-1.5 overflow-y-auto overscroll-contain">
          <button
            type="button"
            onClick={() => setDraft([])}
            aria-pressed={draft.length === 0}
            className="m-tile flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left active:scale-[0.99]"
            style={draft.length === 0 ? { background: "color-mix(in oklch, var(--accent) 8%, oklch(0.985 0.005 258))" } : undefined}
          >
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[16px] ${draft.length === 0 ? "font-bold text-[var(--accent)]" : "font-semibold text-[var(--foreground)]"}`}>全部公司</span>
              <span className="mt-0.5 block truncate text-[14px] text-[var(--muted-foreground)]">{options.length} 家公司汇总口径</span>
            </span>
            {draft.length === 0 ? <Check size={15} className="shrink-0 text-[var(--accent)]" /> : null}
          </button>

          {filtered.map((c) => {
            const active = draft.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={active}
                className="m-tile flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left active:scale-[0.99]"
                style={active ? { background: "color-mix(in oklch, var(--accent) 8%, oklch(0.985 0.005 258))" } : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[16px] ${active ? "font-bold text-[var(--accent)]" : "font-semibold text-[var(--foreground)]"}`}>{c.shortName || c.name}</span>
                  {c.shortName && c.name !== c.shortName ? <span className="mt-0.5 block truncate text-[14px] text-[var(--muted-foreground)]">{c.name}</span> : null}
                </span>
                {active ? <Check size={15} className="shrink-0 text-[var(--accent)]" /> : null}
              </button>
            );
          })}

          {filtered.length === 0 ? (
            <p className="py-5 text-center text-[15px] text-[var(--muted-foreground)]">无匹配「{keyword.trim()}」的公司</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={confirm}
          className="neu-btn-primary mt-3 h-11 w-full rounded-[13px] text-[17px]"
        >
          确定{draft.length > 0 ? `（已选 ${draft.length} 家）` : "（全部公司）"}
        </button>
      </BottomSheet>
    </>
  );
}
