"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { fetchCurrentUser } from "@/lib/api/auth";
import { api } from "@/lib/api";

/**
 * admin 专用公司选择器（公司级数据隔离，2026-08-20；2026-09-16 重设计）。
 * 默认「全部公司」；选择挂 URL query（?companyId=，可分享/刷新保持）+ localStorage 记忆。
 * 非 admin 不渲染——后端对其传参一律忽略，双保险。
 *
 * 重设计要点：neumorphic 触发胶囊 + portal 下拉面板（page-hero overflow:hidden 不裁切）；
 * 选中公司时触发器亮品牌蓝示意「筛选生效」；下拉项 = 白瓷片激活（与 tab v2 同语义）。
 */
export const COMPANY_STORAGE_KEY = "companyFilter";

export function readInitialCompanyId(): string {
  if (typeof window === "undefined") return "all";
  const url = new URLSearchParams(window.location.search).get("companyId");
  if (url) return url;
  return window.localStorage.getItem(COMPANY_STORAGE_KEY) || "all";
}

interface CompanyOption {
  id: string;
  name: string;
  shortName: string | null;
  _count: { users: number };
}

export function CompanySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (companyId: string) => void;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [options, setOptions] = useState<CompanyOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => setRole(u.role))
      .catch(() => setRole("anonymous"));
  }, []);

  useEffect(() => {
    if (role !== "admin") return;
    api
      .get<CompanyOption[]>("/companies")
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [role]);

  const syncAnchor = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 8, left: r.left, width: Math.max(r.width, 264) });
  }, []);

  // 外点 / ESC / 滚动 / 变更尺寸 → 关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onAway = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onAway);
    window.addEventListener("scroll", onAway, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("scroll", onAway, true);
    };
  }, [open]);

  if (role !== "admin") return null;

  const selected = options?.find((c) => c.id === value) ?? null;
  const isAll = value === "all";
  const loading = options === null;

  const handleChange = (next: string) => {
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("companyId");
    else url.searchParams.set("companyId", next);
    window.history.replaceState(null, "", url.toString());
    window.localStorage.setItem(COMPANY_STORAGE_KEY, next);
    onChange(next);
  };

  const pick = (next: string) => {
    setOpen(false);
    if (next !== value) handleChange(next);
  };

  const optionRow = (key: string, active: boolean, label: string, sub: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors ${
        active
          ? "bg-white font-semibold text-[var(--accent)] shadow-[inset_0_1px_0_oklch(1_0_0/0.95),1px_1px_4px_oklch(0.55_0.03_258/0.14),-1px_-1px_2px_oklch(1_0_0/0.9)]"
          : "text-[color:var(--foreground)] hover:bg-white/55"
      }`}
    >
      <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[11px] font-bold ${active ? "bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]" : "bg-[color-mix(in_oklch,var(--muted-foreground)_9%,transparent)] text-[color:var(--muted-foreground)]"}`}>
        {label.slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs leading-4">{label}</span>
        <span className="block truncate text-[10px] leading-4 font-normal text-[color:var(--muted-foreground)]">{sub}</span>
      </span>
      {active && <Check size={13} strokeWidth={2.4} className="shrink-0 text-[var(--accent)]" />}
    </button>
  );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择查看的公司"
        onClick={() => {
          if (!open) syncAnchor();
          setOpen((o) => !o);
        }}
        className={`inline-flex h-9 items-center gap-2 rounded-[12px] px-2.5 transition-all ${
          isAll
            ? "bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.6),1px_1px_3px_oklch(0.55_0.03_258/0.1),-1px_-1px_2px_oklch(1_0_0/0.85)]"
            : "bg-[color-mix(in_oklch,var(--accent)_8%,white)] shadow-[inset_0_1px_0_oklch(1_0_0/0.7),1px_1px_3px_oklch(0.45_0.1_258/0.14),-1px_-1px_2px_oklch(1_0_0/0.9)]"
        } hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1`}
      >
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-[8px] ${isAll ? "bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] text-[color:var(--muted-foreground)]" : "bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-[var(--accent)]"}`}>
          <Building2 size={13} strokeWidth={1.9} />
        </span>
        <span className={`max-w-[210px] truncate text-xs ${isAll ? "font-medium text-[color:var(--foreground)]" : "font-semibold text-[var(--accent)]"}`}>
          {loading ? "加载中…" : isAll ? "全部公司" : selected?.name ?? "已选公司"}
        </span>
        {!isAll && !loading && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" title={`筛选中：${selected?.name ?? ""}`} />}
        <ChevronDown size={13} strokeWidth={2} className={`text-[color:var(--muted-foreground)] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={popRef}
          role="listbox"
          aria-label="公司列表"
          style={{ position: "fixed", top: anchor.top, left: anchor.left, minWidth: anchor.width }}
          className="z-[90] max-h-[320px] overflow-y-auto rounded-[14px] bg-[var(--background)]/96 p-1.5 shadow-[0_18px_44px_rgba(24,40,70,0.18),inset_0_1px_0_oklch(1_0_0/0.8)] backdrop-blur-md"
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
            已入驻{options ? ` · ${options.length} 家` : ""}
          </div>
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-[color:var(--muted-foreground)]">
              <Loader2 size={13} className="animate-spin" /> 正在加载公司列表…
            </div>
          ) : (
            <>
              {optionRow(
                "all",
                isAll,
                "全部公司",
                `不限公司 · 共 ${options!.reduce((sum, c) => sum + (c._count?.users ?? 0), 0)} 账号`,
                () => pick("all"),
              )}
              {options!.map((c) =>
                optionRow(c.id, value === c.id, c.name, `${c._count?.users ?? 0} 账号`, () => pick(c.id)),
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
