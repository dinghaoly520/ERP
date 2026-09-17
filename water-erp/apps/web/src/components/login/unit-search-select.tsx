"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { SASAC_UNITS } from "@/lib/data/sasac-units";

/**
 * 集团单位选择器（2026-09-17）：62 家全级次企业名单 + 首行搜索过滤。
 * 与国资监管数据提取的 SelectCell 同款交互（portal 面板、毛玻璃、当前值置顶高亮），
 * 支持清空与自由输入回退（后端注册仍会归一化手输变体）。
 */
export function UnitSearchSelect({
  value,
  onChange,
  placeholder = "选择或输入公司名称",
  allowCustom = true,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 允许手输不在名单中的公司（注册场景需要）；国资提取场景关闭 */
  allowCustom?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const options = SASAC_UNITS.map((u) => u.name);
  const text = (q || "").trim().toLowerCase();
  const filtered = options.filter((o) => !text || o.toLowerCase().includes(text));
  const current = value;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) { setOpen(false); setQ(""); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQ(""); } };
    const away = () => { setOpen(false); setQ(""); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // 面板内部滚动不关闭（capture 捕获自身滚动曾致"无法滚动查看"）；仅外部滚动关闭
    const onScrollAway = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      away();
    };
    window.addEventListener("scroll", onScrollAway, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollAway, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const pick = (v: string) => { setOpen(false); setQ(""); onChange(v); };

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (!open) { const r = anchorRef.current?.getBoundingClientRect(); if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) }); }
          setOpen((o) => !o);
        }}
        className={`flex h-[38px] w-full items-center justify-between gap-1 rounded-[10px] px-3 text-left text-[13px] transition-colors ${current ? "text-[var(--foreground)]" : "text-[color:var(--muted-foreground)]"} ${open ? "bg-[color-mix(in_oklch,var(--accent)_8%,white)]" : ""} focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择公司"
      >
        <span className="truncate">{current || placeholder}</span>
        <ChevronDown size={13} strokeWidth={2} className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
          className="z-[700] max-h-[240px] overflow-y-auto rounded-[12px] bg-[var(--background)]/97 px-1 pb-1 shadow-[0_14px_36px_rgba(24,40,70,0.18),inset_0_1px_0_oklch(1_0_0/0.8)] backdrop-blur-md"
        >
          <div className="sticky top-0 z-10 mb-1 rounded-t-[11px] bg-[var(--background)] px-1 pb-1 pt-1 shadow-[0_1px_0_oklch(0.6_0.04_258/0.14)]">
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索公司…"
              className="neu-input w-full !h-8 !min-h-0 text-[11px]"
            />
            {allowCustom && text && !filtered.includes(q.trim()) && (
              <button type="button" onClick={() => pick(q.trim())} className="mt-1 w-full rounded-[8px] px-2 py-1.5 text-left text-xs text-[var(--accent)] hover:bg-white/60">
                使用自定义名称「{q.trim()}」
              </button>
            )}
          </div>
          {current && filtered.includes(current) ? (
            <button type="button" role="option" aria-selected onClick={() => pick(current)} className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-xs font-semibold text-[var(--accent)] bg-white shadow-[inset_0_1px_0_oklch(1_0_0/0.95),1px_1px_3px_oklch(0.55_0.03_258/0.12)]">
              <span className="truncate">{current}</span>
              <Check size={11} strokeWidth={2.4} className="shrink-0" />
            </button>
          ) : null}
          {current && !filtered.includes(current) ? (
            <button type="button" role="option" onClick={() => pick(current)} className="w-full truncate rounded-[8px] px-2 py-1.5 text-left text-xs text-[color:var(--foreground)] hover:bg-white/60">
              {current}（当前值，不在名单）
            </button>
          ) : null}
          {filtered.filter((o) => o !== current).map((o) => (
            <button key={o} type="button" role="option" aria-selected={false} onClick={() => pick(o)} className="w-full truncate rounded-[8px] px-2 py-1.5 text-left text-xs text-[color:var(--foreground)] transition-colors hover:bg-white/60">
              {o}
            </button>
          ))}
          {filtered.length === 0 && <div className="px-2 py-2 text-center text-[10px] text-[color:var(--muted-foreground)]">无匹配公司</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
