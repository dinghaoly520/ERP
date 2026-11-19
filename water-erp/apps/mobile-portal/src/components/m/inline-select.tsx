"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

/**
 * 原地下拉选择（2026-11-19 用户裁定：口径选择不走弹层——锚定触发器展开菜单）。
 * 菜单 portal 到 body 按触发器实测坐标 fixed 定位：卡片 .m-rise 动画保留 transform
 * 形成层叠上下文，absolute 菜单的 z 值被困卡内会被 DOM 靠后的兄弟卡整块遮挡
 * （2026-11-19 实录「存在内容遮挡」）；页面滚动即收起（菜单内滚动除外）。
 * 单选：点选即收起；多选：点选切换不收起（继续勾选）。点外部（document
 * pointerdown）/再点触发器/滚动关闭。
 * 提供 onCustomApply 时追加「自定义」行：展开起止日期编辑器，应用后由调用方落
 * selected=["custom"]。selected 由调用方全权解释（如「全部公司」哨兵值）。
 */
export function InlineSelect({
  label,
  active = false,
  options,
  selected,
  onSelect,
  multiple = false,
  ariaLabel,
  onCustomApply,
  customValue,
  customFirst = false,
}: {
  /** 触发器文案（调用方算好——区间档名/日期段/公司名组合） */
  label: string;
  /** 非默认态高亮（品牌蓝） */
  active?: boolean;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onSelect: (next: string[]) => void;
  multiple?: boolean;
  ariaLabel?: string;
  /** 提供即启用「自定义」日期区间行 */
  onCustomApply?: (from: string, to: string) => void;
  customValue?: { from: string; to: string } | null;
  /** 自定义行置顶（2026-11-19 用户裁定：区间菜单倒序——自定义/全部/本年/本季/本月/本日） */
  customFirst?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [keyword, setKeyword] = useState("");
  /** 触发器实测坐标（开菜单时测量；fixed 菜单锚定用） */
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    /* 页面滚动即收（菜单内滚动除外）——省去滚动追锚的重组德，也防视口外悬空 */
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  /* 开菜单即对齐编辑器态与草稿 + 测量触发器坐标（selected/customValue 仅作开盒初始值，勿入 deps） */
  useEffect(() => {
    if (!open) return;
    setEditorOpen(selected.includes("custom"));
    setDraftFrom(customValue?.from ?? "");
    setDraftTo(customValue?.to ?? "");
    setKeyword("");
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: r.right });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const draftOk = draftFrom !== "" && draftTo !== "" && draftFrom <= draftTo; // ISO 日期串字典序即时间序

  function pick(v: string) {
    if (v === "custom") {
      setEditorOpen((e) => !e);
      return;
    }
    if (multiple) {
      onSelect(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    } else {
      onSelect([v]);
      setOpen(false);
    }
  }

  /* 菜单视口内限高：顶部锚点之下留 12px，且不超过半屏 */
  const maxMenuH = pos ? Math.max(160, Math.min(window.innerHeight * 0.52, window.innerHeight - pos.top - 12)) : 0;

  /* 自定义日期区间块（customFirst=置顶+下分隔线；默认尾置+上分隔线） */
  const customBlock = onCustomApply ? (
    <div
      className={
        customFirst
          ? "mb-1 border-b border-[color-mix(in_oklch,var(--border)_50%,transparent)] pb-1"
          : "mt-1 border-t border-[color-mix(in_oklch,var(--border)_50%,transparent)] pt-1"
      }
    >
      <button
        type="button"
        role="option"
        aria-selected={selected.includes("custom")}
        onClick={() => pick("custom")}
        className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] active:scale-[0.99] ${
          selected.includes("custom") ? "bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] font-bold text-[var(--accent)]" : "text-[var(--foreground)]"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">自定义</span>
        {selected.includes("custom") ? <Check size={14} className="shrink-0" /> : null}
      </button>
      {editorOpen ? (
        <div className="mt-1 rounded-[10px] bg-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)] p-2">
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              aria-label="开始日期"
              className="m-input h-9 min-w-0 flex-1 rounded-[10px] px-2 text-[13px]"
            />
            <span className="shrink-0 text-[12px] text-[var(--muted-foreground)]">至</span>
            <input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              aria-label="结束日期"
              className="m-input h-9 min-w-0 flex-1 rounded-[10px] px-2 text-[13px]"
            />
          </div>
          <button
            type="button"
            disabled={!draftOk}
            onClick={() => {
              onCustomApply(draftFrom, draftTo);
              setOpen(false);
            }}
            className="neu-btn-primary mt-2 h-9 w-full rounded-[10px] text-[14px] disabled:opacity-50"
          >
            应用
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        className={`m-tile flex max-w-[10rem] items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold active:scale-[0.97] ${active ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-multiselectable={multiple || undefined}
              className="m-menu fixed z-[60] min-w-[13rem] p-1.5"
              /* 动态锚定坐标必须内联（类名无法承载测量值）：右缘对齐触发器右缘 */
              style={{ top: pos.top, left: pos.right, transform: "translateX(-100%)", maxHeight: maxMenuH }}
            >
              {/* 选项>12 自动出菜单内搜索（2026-11-19：台账公司筛选 66 家长名单） */}
              {options.length > 12 ? (
                <div className="relative mb-1.5">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜索选项"
                    aria-label="搜索选项"
                    autoFocus
                    className="m-input h-9 w-full rounded-[10px] pl-8 pr-2 text-[13px]"
                  />
                </div>
              ) : null}
              {customFirst ? customBlock : null}
              <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: maxMenuH - (options.length > 12 ? 46 : 0) }}>
              {options
                .filter((o) => !keyword.trim() || o.label.includes(keyword.trim()))
                .map((o) => {
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
              {options.length > 0 && options.every((o) => keyword.trim() && !o.label.includes(keyword.trim())) ? (
                <p className="py-4 text-center text-[13px] text-[var(--muted-foreground)]">无匹配「{keyword.trim()}」</p>
              ) : null}
              {!customFirst ? customBlock : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
