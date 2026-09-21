"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { SASAC_UNITS } from "@/lib/data/sasac-units";

/**
 * 集团单位选择器（供应商门户版，2026-09-17）：62 家全级次企业名单 + 首行搜索。
 * 与 :3005 同款交互；面板遵循 sp 注册页 neumorphic 语言（reg-inp 内凹、瓷片凸起、无外框线）。
 */
export function UnitSearchSelect({
  value,
  onChange,
  placeholder = "请选择归属公司（须正确选择，否则影响投标）",
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null);

  const options = SASAC_UNITS.map((u) => u.name);
  const text = (q || "").trim().toLowerCase();
  const filtered = options.filter((o) => !text || o.toLowerCase().includes(text));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) { setOpen(false); setQ(""); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQ(""); } };
    const onScrollAway = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
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

  /* sp neumorphic 色板（与 reg-inp 同源）：内凹 inset / 瓷片凸起方向性双影 */
  const SHADOW_SUNK = "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)";
  const SHADOW_PLATE = "inset 0 1px 0 oklch(1 0 0 / 0.9), 2px 2px 6px oklch(0.55 0.03 258 / 0.16), -1px -1px 2px oklch(1 0 0 / 0.9)";

  return (
    <div ref={anchorRef} className="relative">
      {/* 触发器：与 reg-inp 同规格（52px 内凹），右侧 chevron */}
      <button
        type="button"
        onClick={() => {
          if (!open) {
            const r = anchorRef.current?.getBoundingClientRect();
            if (r) {
              const flip = r.bottom + 256 > window.innerHeight && r.top > 280; // 下方放不下且上方够 → 向上弹
              setRect({ top: flip ? r.top - 256 - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, 260), flip });
            }
          }
          setOpen((o) => !o);
        }}
        className="uss-shadow-sunk flex w-full items-center justify-between gap-2 text-left"
        style={{ height: 52, borderRadius: 14, padding: "0 16px", background: open ? "oklch(0.985 0.01 252)" : "var(--surface, oklch(0.965 0.012 252))", border: "none", outline: "none", fontSize: 15, cursor: "pointer", transition: "box-shadow .2s" }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择归属公司"
      >
        <span className="truncate" style={{ color: value ? "var(--reg-ink, #1e293b)" : "oklch(0.62 0.03 258)" }}>{value || placeholder}</span>
        <ChevronDown size={15} strokeWidth={2} className="shrink-0 transition-transform duration-200" style={{ color: "oklch(0.62 0.03 258)", transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 700, maxHeight: 248, overflowY: "auto", borderRadius: 16, padding: "0 6px 6px", background: "linear-gradient(145deg, #ffffff 0%, #f1f4f9 100%)" }}
          className="uss-shadow-pop"
        >
          {/* 搜索行：内凹小输入 + 图标 */}
          <div className="uss-shadow-sticky" style={{ position: "sticky", top: 0, zIndex: 1, background: "linear-gradient(145deg, #ffffff 0%, #f1f4f9 100%)", borderRadius: "16px 16px 0 0", padding: "4px 4px 6px" }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "oklch(0.62 0.03 258)" }} />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索公司…"
                style={{ width: "100%", height: 34, border: "none", outline: "none", borderRadius: 10, paddingLeft: 30, paddingRight: 10, fontSize: 12.5, color: "var(--reg-ink, #1e293b)", background: "var(--surface, oklch(0.965 0.012 252))" }}
                className="uss-shadow-sunk"
              />
            </div>
          </div>
          {/* 当前值：白瓷片凸起 + 品牌蓝（全站激活语义） */}
          {value && filtered.includes(value) ? (
            <button type="button" role="option" aria-selected onClick={() => pick(value)}
              className="uss-shadow-plate flex w-full items-center justify-between"
              style={{ borderRadius: 10, padding: "7px 10px", marginBottom: 3, background: "#ffffff", color: "var(--sp-primary, #064ea2)", fontSize: 12.5, fontWeight: 700, textAlign: "left", cursor: "pointer" }}>
              <span className="truncate">{value}</span>
              <Check size={12} strokeWidth={2.6} className="shrink-0" />
            </button>
          ) : null}
          {/* 其余选项：平伏，hover 抬起 */}
          {filtered.filter((o) => o !== value).map((o) => (
            <button key={o} type="button" role="option" aria-selected={false} onClick={() => pick(o)}
              className="unit-opt w-full truncate"
              style={{ borderRadius: 10, padding: "7px 10px", fontSize: 12.5, color: "var(--reg-ink, #1e293b)", textAlign: "left", cursor: "pointer", background: "transparent", border: "none", outline: "none", transition: "background .15s" }}>
              {o}
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: "10px 0", textAlign: "center", fontSize: 11, color: "oklch(0.62 0.03 258)" }}>无匹配公司</div>}
          <style>{`.unit-opt:hover { background: rgba(6, 78, 162, 0.06); }`}</style>
        </div>,
        document.body,
      )}
    </div>
  );
}
