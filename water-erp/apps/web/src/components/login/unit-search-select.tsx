"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { SASAC_UNITS } from "@/lib/data/sasac-units";

/**
 * 集团单位选择器（:3005 版，2026-09-17 v2）：62 家全级次企业名单 + 首行搜索。
 * 设计语言（与 :3004 供应商门户版同源，cgzxui 适配）：
 *  面板 = 145° 白→浅灰渐变瓷片 + 方向性双影（无外框线）+ 视口翻转；
 *  搜索区 = sticky 贴顶（外层无顶 padding 防滚动透字）+ 内凹小输入 + hairline 分隔；
 *  当前值 = 白瓷片凸起 + 品牌蓝粗体 + 对勾（与 neu-tab v2 激活语义统一）；选项 hover 品牌蓝淡染。
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
    const onScrollAway = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return; // 面板内部滚动不关闭
      setOpen(false); setQ("");
    };
    const away = () => { setOpen(false); setQ(""); };
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

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const pick = (v: string) => { setOpen(false); setQ(""); onChange(v); };
  const POP_H = 248;

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      {/* 触发器：neu-input 内凹（44px），打开态底色提亮 + chevron 旋转 */}
      <button
        type="button"
        onClick={() => {
          if (!open) {
            const r = anchorRef.current?.getBoundingClientRect();
            if (r) {
              const flip = r.bottom + POP_H + 8 > window.innerHeight && r.top > POP_H + 16; // 下方放不下且上方够 → 向上弹
              setRect({ top: flip ? r.top - POP_H - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, 220) });
            }
          }
          setOpen((o) => !o);
        }}
        className={`flex h-[38px] w-full items-center justify-between gap-1 rounded-[10px] px-3 text-left text-[13px] outline-none transition-all ${open ? "bg-[oklch(0.985_0.01_252)]" : current ? "" : ""} focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1`}
        style={!open ? { background: "var(--surface)", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)", border: "none" } : { boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 5px oklch(1 0 0 / 0.9)", border: "none" }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择公司"
      >
        <span className={`truncate ${current ? "text-[var(--foreground)]" : "text-[color:var(--muted-foreground)]"}`}>{current || placeholder}</span>
        <ChevronDown size={13} strokeWidth={2} className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 700, maxHeight: POP_H, overflowY: "auto", borderRadius: 16, padding: "0 6px 6px", background: "linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)", boxShadow: "6px 6px 18px oklch(0.55 0.03 258 / 0.16), -3px -3px 10px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.9)" }}
        >
          {/* 搜索区：sticky 贴顶（外层无顶 padding），内凹小输入 + 图标 + hairline 分隔 */}
          <div className="sticky top-0 z-10 mb-1 px-1 pb-1.5 pt-1.5" style={{ background: "linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)", borderRadius: "16px 16px 0 0", boxShadow: "0 2px 4px -2px oklch(0.55 0.03 258 / 0.18)" }}>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索公司…"
                className="h-[34px] w-full rounded-[10px] pl-[30px] pr-2 text-[12.5px] text-[var(--foreground)] outline-none"
                style={{ background: "var(--surface)", border: "none", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)" }}
              />
            </div>
            {allowCustom && text && !filtered.includes(q.trim()) && (
              <button type="button" onClick={() => pick(q.trim())} className="mt-1 w-full rounded-[8px] px-2 py-1.5 text-left text-xs text-[var(--accent)] hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]">
                使用自定义名称「{q.trim()}」
              </button>
            )}
          </div>
          {/* 当前值：白瓷片凸起 + 品牌蓝粗体 + 对勾（neu-tab v2 激活语义） */}
          {current && filtered.includes(current) ? (
            <button type="button" role="option" aria-selected onClick={() => pick(current)}
              className="mb-0.5 flex w-full items-center justify-between rounded-[10px] px-2.5 py-[7px] text-left text-xs font-bold text-[var(--accent)]"
              style={{ background: "oklch(1 0 0)", boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.95), 2px 2px 6px oklch(0.55 0.03 258 / 0.16), -1px -1px 2px oklch(1 0 0 / 0.9)" }}>
              <span className="truncate">{current}</span>
              <Check size={12} strokeWidth={2.6} className="shrink-0" />
            </button>
          ) : null}
          {current && !filtered.includes(current) ? (
            <button type="button" role="option" onClick={() => pick(current)} className="w-full truncate rounded-[8px] px-2.5 py-[7px] text-left text-xs text-[color:var(--foreground)] hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]">
              {current}（当前值，不在名单）
            </button>
          ) : null}
          {filtered.filter((o) => o !== current).map((o) => (
            <button key={o} type="button" role="option" aria-selected={false} onClick={() => pick(o)} className="w-full truncate rounded-[8px] px-2.5 py-[7px] text-left text-xs text-[color:var(--foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]">
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
