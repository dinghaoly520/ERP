"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

/**
 * 下拉选择器（cgzxui 通用形态，2026-10-14 定版——自 UnitSearchSelect 泛化）
 *
 * 适用：实体/名单类单值选择（公司、归属项目、专家、目录…）；短静态选项（是/否、
 * 排序、状态 ≤8 项）用 workbench-input 原生 select，勿滥用本组件（见 cgzxui 分型）。
 *
 * 设计语言（与 :3005 注册页公司选择器同源，cgzxui 适配）：
 *  面板 = 145° 白→浅灰渐变瓷片 + 方向性双影（无外框线）+ 视口翻转定位，portal 挂 body；
 *  搜索区 = sticky 贴顶（外层无顶 padding 防滚动透字）+ 内凹小输入 + hairline 分隔；
 *  搜索行在选项 ≤8 且无 allowCustom 需求时自动省略（短名单免搜索）；
 *  当前值 = 白瓷片凸起 + 品牌蓝粗体 + 对勾（neu-tab v2 激活语义）；选项 hover 品牌蓝淡染；
 *  触发器 = surface 内凹 + chevron（打开旋转 180°），compact 档与表单 28px 输入等高。
 * 交互语义：外点/Esc/滚动离开/resize 关闭；打开即聚焦搜索框。
 */

export interface SearchSelectOption {
  /** 选中值（唯一键） */
  value: string;
  /** 展示主标 */
  label: string;
  /** 右侧次标（如合同号、编号）——不占换行 */
  meta?: string;
  /** 副标行（如分类、说明）——主标下方一行小字 */
  sub?: string;
}

export function SearchSelect({
  options,
  value,
  onPick,
  placeholder = "选择或搜索…",
  searchPlaceholder = "搜索…",
  emptyText = "无匹配项",
  allowCustom = false,
  /** 搜索行显式开关；缺省自动——选项 >8 或 allowCustom 时显示 */
  searchable,
  /** 紧凑档：触发器 28px（表单行内联，与 workbench-input !h-[28px] 等高）；缺省 38px */
  compact = false,
  triggerClassName = "",
  panelMinWidth = 280,
  disabled = false,
}: {
  options: SearchSelectOption[];
  value: string;
  /** 选中回调：回传完整选项（含 meta/sub，供联动填写）与值 */
  onPick: (option: SearchSelectOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustom?: boolean;
  searchable?: boolean;
  compact?: boolean;
  triggerClassName?: string;
  panelMinWidth?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const showSearch = searchable ?? (options.length > 8 || allowCustom);
  const text = (q || "").trim().toLowerCase();
  const filtered = options.filter((o) => !text || o.label.toLowerCase().includes(text) || o.value.toLowerCase().includes(text));
  const currentOption = options.find((o) => o.value === value) ?? (value ? { value, label: value } : undefined);
  const currentLabel = currentOption?.label ?? "";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) { setOpen(false); setQ(""); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQ(""); } };
    const onScrollAway = (e: Event) => { if (popRef.current?.contains(e.target as Node)) return; setOpen(false); setQ(""); };
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
    if (open && showSearch) searchRef.current?.focus();
  }, [open]);

  const pick = (o: SearchSelectOption) => { setOpen(false); setQ(""); onPick(o); };
  const toggle = () => {
    if (disabled) return;
    if (open) { setOpen(false); setQ(""); return; }
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const POP_H = 260;
    const flip = r.bottom + POP_H + 8 > window.innerHeight && r.top > POP_H + 16;
    setRect({ top: flip ? r.top - POP_H - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, panelMinWidth) });
    setOpen(true);
  };

  return (
    <div ref={anchorRef} className={`relative ${triggerClassName}`}>
      {/* 触发器：surface 内凹瓷片 + chevron（打开旋转 180°） */}
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-1 rounded-[10px] px-2.5 text-left outline-none transition-all focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "h-[28px] text-xs" : "h-[38px] text-[13px]"}`}
        style={open
          ? { background: "oklch(0.985 0.01 252)", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 5px oklch(1 0 0 / 0.9)", border: "none" }
          : { background: "var(--surface)", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)", border: "none" }}
      >
        <span className={`truncate ${currentLabel ? "text-[color:var(--foreground)]" : "text-[color:var(--muted-foreground)]"}`}>{currentLabel || placeholder}</span>
        <ChevronDown size={compact ? 12 : 13} strokeWidth={2} className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 700, maxHeight: 260, overflowY: "auto", borderRadius: 16, padding: "0 6px 6px", background: "linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)", boxShadow: "6px 6px 18px oklch(0.55 0.03 258 / 0.16), -3px -3px 10px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.9)" }}
        >
          {/* 搜索区：sticky 贴顶（外层无顶 padding 防滚动透字）+ 内凹小输入 + hairline 分隔 */}
          {showSearch && (
            <div className="sticky top-0 z-10 mb-1 px-1 pb-1.5 pt-1.5" style={{ background: "linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)", borderRadius: "16px 16px 0 0", boxShadow: "0 2px 4px -2px oklch(0.55 0.03 258 / 0.18)" }}>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter 直接采用自定义值（allowCustom 且无精确匹配时）——
                    // 原只能点小字链接，键入流被打断（用户实录「只能搜索无法新建」）
                    if (e.key === 'Enter' && allowCustom && text && !filtered.some((o) => o.label === q.trim() || o.value === q.trim())) {
                      e.preventDefault();
                      pick({ value: q.trim(), label: q.trim() });
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="h-[34px] w-full rounded-[10px] pl-[30px] pr-2 text-[12.5px] text-[var(--foreground)] outline-none"
                  style={{ background: "var(--surface)", border: "none", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)" }}
                />
              </div>
              {/* allowCustom：搜索词非名单项 → 新建并选用（整行选项样式 + Enter 可达） */}
              {allowCustom && text && !filtered.some((o) => o.label === q.trim() || o.value === q.trim()) && (
                <button
                  type="button"
                  onClick={() => pick({ value: q.trim(), label: q.trim() })}
                  className="mt-1 flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-xs font-bold text-[var(--accent)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]"
                  style={{ background: 'color-mix(in oklch, var(--accent) 4%, transparent)' }}
                >
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] text-[13px] font-black leading-none"
                    style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)' }}>+</span>
                  新建并使用「{q.trim()}」
                </button>
              )}
            </div>
          )}
          {/* 当前值：白瓷片凸起 + 品牌蓝粗体 + 对勾（neu-tab v2 激活语义） */}
          {(() => {
            const cur = filtered.find((o) => o.value === value);
            return cur ? (
              <button
                type="button"
                role="option"
                aria-selected
                onClick={() => pick(cur)}
                className="mb-0.5 flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-[7px] text-left text-xs font-bold text-[var(--accent)]"
                style={{ background: "oklch(1 0 0)", boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.95), 2px 2px 6px oklch(0.55 0.03 258 / 0.16), -1px -1px 2px oklch(1 0 0 / 0.9)" }}
              >
                <span className="truncate">{cur.label}</span>
                <Check size={12} strokeWidth={2.6} className="shrink-0" />
              </button>
            ) : null;
          })()}
          {filtered.filter((o) => o.value !== value).map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => pick(o)}
              className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-[7px] text-left text-xs text-[color:var(--foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
            >
              <span className="min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.sub && <span className="block truncate text-[10px] font-normal text-[color:var(--muted-foreground)]">{o.sub}</span>}
              </span>
              {o.meta && <span className="shrink-0 text-[10px] text-[color:var(--muted-foreground)]">{o.meta}</span>}
            </button>
          ))}
          {filtered.length === 0 && !((allowCustom && text)) && (
            <div className="px-2 py-2 text-center text-[10px] text-[color:var(--muted-foreground)]">{emptyText}</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
