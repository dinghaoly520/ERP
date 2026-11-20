"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * 数据分析分区组件（2026-11-19 用户裁定：两区各包一个瓷面容器）——
 * AnalysisZone = 分区壳（瓷面板 + 图标井标题行 + 计数），内含若干 ZoneRow；
 * ZoneRow = 区内折叠行（图标+标题+右注+箭头），hairline 分隔、点开显内容。
 */
export function AnalysisZone({
  icon: Icon,
  title,
  count,
  color = "var(--accent)",
  children,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  count: string;
  color?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-3 rounded-[18px] p-3 m-pagebar">
      <div className="flex items-center gap-2.5 border-b border-[oklch(0.6_0.04_258_/_0.14)] pb-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: `color-mix(in oklch, ${color} 12%, transparent)`, color }}
        >
          <Icon size={16} strokeWidth={1.5} />
        </span>
        <span className="text-[16px] font-bold tracking[-0.01em] text-[var(--foreground)]">{title}</span>
        <span className="ml-auto shrink-0 text-[12px] font-semibold tabular-nums text-[var(--muted-foreground)]">{count}</span>
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

/** 区内折叠行：默认收起；hairline 分隔，箭头翻转，内容展开直显 */
export function ZoneRow({
  icon: Icon,
  title,
  right,
  children,
}: {
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[oklch(0.6_0.04_258_/_0.08)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 py-2.5 text-left active:scale-[0.995]"
      >
        {Icon ? <Icon size={15} strokeWidth={1.5} className="shrink-0 text-[var(--accent)]" /> : null}
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--foreground)]">{title}</span>
        {right}
        <ChevronDown size={14} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="pb-3">{children}</div> : null}
    </div>
  );
}
