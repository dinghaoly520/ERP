"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/**
 * 原生 select 的瓷片化直接替换（2026-11-24 全系统下拉统一裁定，web 同款移植）。
 *
 * 动机：macOS 原生 <select> 弹层与选中项对齐绘制、盖住触发框且无法锚定位置；
 * 且原生灰框与 cgzxui 瓷片语言不一致。
 *
 * API 镜像原生 select：子元素写 <option>，onChange 回传 { target: { value } } 假事件
 * ——既有受控绑定与处理器零改动，迁移只改标签名；className 只承载宽度约束
 * （w-、min-w-、flex-1 类），外观由组件统一（compact=28px 紧凑档）。
 * 单值受控（本门户原生 select 无 multiple/optgroup，2026-11-24 盘点）。
 */
export function NeuSelect({
  value,
  onChange,
  children,
  disabled = false,
  compact = false,
  className = "",
  title,
  id,
  "aria-label": ariaLabel,
}: {
  value: string | number | null | undefined;
  onChange?: (e: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  title?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const options = useMemo(() => collectOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

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
    if (disabled) return;
    if (open) { setOpen(false); return; }
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const POP_H = 260;
    const flip = r.bottom + POP_H + 8 > window.innerHeight && r.top > POP_H + 16;
    setRect({ top: flip ? r.top - POP_H - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, 220) });
    setOpen(true);
  };

  const current = options.find((o) => o.value === (value == null ? "" : String(value)));

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      {/* 触发器：内凹瓷片 + chevron（打开旋转 180°） */}
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        id={id}
        className={`flex w-full items-center justify-between gap-1 rounded-[10px] px-2.5 text-left outline-none transition-all focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "h-[28px] text-xs" : "h-[38px] text-[13px]"}`}
        style={open
          ? { background: "oklch(0.985 0.01 252)", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 5px oklch(1 0 0 / 0.9)", border: "none" }
          : { background: "var(--surface)", boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)", border: "none" }}
      >
        <span className={`truncate ${current ? "text-[color:var(--foreground)]" : "text-[color:var(--muted-foreground)]"}`}>{current?.label || ""}</span>
        <ChevronDown size={compact ? 12 : 13} strokeWidth={2} className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 700, maxHeight: 260, overflowY: "auto", borderRadius: 16, padding: "6px", background: "linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)", boxShadow: "6px 6px 18px oklch(0.55 0.03 258 / 0.16), -3px -3px 10px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.9)" }}
        >
          {options.map((o) => {
            const isCurrent = o.value === (value == null ? "" : String(value));
            return isCurrent ? (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected
                onClick={() => { setOpen(false); onChange?.({ target: { value: o.value } }); }}
                className="mb-0.5 flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-[7px] text-left text-xs font-bold text-[var(--accent)]"
                style={{ background: "oklch(1 0 0)", boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.95), 2px 2px 6px oklch(0.55 0.03 258 / 0.16), -1px -1px 2px oklch(1 0 0 / 0.9)" }}
              >
                <span className="truncate">{o.label}</span>
                <Check size={12} strokeWidth={2.6} className="shrink-0" />
              </button>
            ) : (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => { setOpen(false); onChange?.({ target: { value: o.value } }); }}
                className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-[7px] text-left text-xs text-[color:var(--foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
              >
                <span className="min-w-0 truncate">{o.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** 从 <option> 子元素收集选项：value 缺省取文本（同原生语义） */
function collectOptions(children: ReactNode): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (node: ReactNode) => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== "object") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = node as any;
    if (el.type === "option") {
      const label = textOf(el.props?.children as ReactNode);
      const explicit = el.props?.value;
      out.push({ value: explicit != null ? String(explicit) : label, label });
      return;
    }
    if (el.props?.children != null) walk(el.props.children as ReactNode);
  };
  walk(children);
  return out;
}

/** ReactNode 文本化（字符串/数字/嵌套数组拼接） */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = node as any;
  if (el.props?.children != null) return textOf(el.props.children as ReactNode);
  return "";
}
