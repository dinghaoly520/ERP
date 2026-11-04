"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import type { CompanyOption } from "@/lib/api/accounts";

/**
 * 供应商归属公司多选（账号管理表格单元格，2026-11-04）：
 * 触发器 = surface 内凹瓷片 + 公司名串（空=未归属）；弹层 = 瓷片渐变 + 复选行 +
 * 保存/取消（草稿勾选，保存才提交——避免逐勾连发替换集请求）。视觉语言同 SearchSelect
 * （portal 挂 body + 视口翻转 + 外点/Esc/滚动离开关闭）。
 */
export function SupplierCompanyMultiSelect({
  companies,
  selectedIds,
  onSave,
}: {
  /** 全量可选公司（Company 主数据） */
  companies: CompanyOption[];
  /** 当前归属中公司 id（APPROVED 链接集合） */
  selectedIds: string[];
  /** 保存（提交替换集）；错误由调用方自行 toast，此处不再捕获 */
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = companies.filter((c) => selectedIds.includes(c.id));
  const label = selected.map((c) => c.name).join("、");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScrollAway = (e: Event) => { if (popRef.current?.contains(e.target as Node)) return; setOpen(false); };
    const away = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollAway, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollAway, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setDraft(new Set(selectedIds));
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const POP_H = 300;
    const flip = r.bottom + POP_H + 8 > window.innerHeight && r.top > POP_H + 16;
    setRect({ top: flip ? r.top - POP_H - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, 240) });
    setOpen(true);
  };

  const commit = async () => {
    setSaving(true);
    try {
      await onSave([...draft]);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={anchorRef} className="relative w-full">
      {/* 触发器：surface 内凹 + 名称串/未归属 + chevron（打开旋转） */}
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label || "未归属"}
        className="flex h-8 w-full items-center justify-between gap-1 rounded-[10px] px-2.5 text-left outline-none transition-all focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1"
        style={open
          ? { background: "oklch(0.985 0.01 252)", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 5px oklch(1 0 0 / 0.9)" }
          : { background: "var(--surface)", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)" }}
      >
        <span className={`truncate text-xs ${label ? "text-[color:var(--foreground)]" : "text-[color:var(--muted-foreground)]"}`}>
          {label || "未归属"}
        </span>
        <ChevronDown size={12} strokeWidth={2} className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 700, borderRadius: 16, padding: "6px 6px 6px", background: "linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)", boxShadow: "6px 6px 18px oklch(0.55 0.03 258 / 0.16), -3px -3px 10px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.9)" }}
        >
          <div className="max-h-[220px] overflow-y-auto px-1">
            {companies.length === 0 && (
              <div className="px-2 py-2 text-center text-[10px] text-[color:var(--muted-foreground)]">暂无可选公司</div>
            )}
            {companies.map((c) => {
              const checked = draft.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => setDraft((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2 py-[7px] text-left text-xs text-[color:var(--foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
                >
                  {/* 复选方瓷片：勾选=品牌蓝实底+对勾（neu-tab v2 激活语义） */}
                  <span
                    className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px]"
                    style={checked
                      ? { background: "var(--accent)", color: "#fff" }
                      : { background: "var(--surface)", boxShadow: "inset 1.5px 1.5px 3px oklch(0.55 0.03 258 / 0.14), inset -1px -1px 2px oklch(1 0 0 / 0.85)" }}
                  >
                    {checked && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
          {/* 底部操作行：hairline 分隔 + 取消/保存 */}
          <div className="mt-1 flex items-center justify-end gap-1.5 border-t px-1 pt-2" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
            <button type="button" onClick={() => setOpen(false)} className="neu-btn-xs !h-7">取消</button>
            <button type="button" onClick={() => void commit()} disabled={saving} className="neu-btn-xs !h-7 gap-1" style={{ color: "var(--accent)", fontWeight: 700 }}>
              {saving && <Loader2 size={11} className="animate-spin" />}
              保存{draft.size > 0 ? `（${draft.size} 家）` : ""}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
