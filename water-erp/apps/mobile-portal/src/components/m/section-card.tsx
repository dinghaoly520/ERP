"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** 移动端区块卡——cgzxui 玻璃静态卡 + 标题行；index 驱动入场阶梯（50ms/卡，.m-rise）。
 *  collapsible（2026-11-19 用户裁定「内容点击展示」）：标题行即开关，默认收起、
 *  点按展开/收起；right 槽与折叠箭头并存，展开态箭头翻转。 */
export function SectionCard({
  icon: Icon,
  title,
  right,
  index = 0,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  right?: ReactNode;
  index?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {Icon ? <Icon size={17} className="shrink-0 text-[var(--accent)]" /> : null}
      <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.02em] text-[var(--foreground)]">{title}</h2>
      {right}
      {collapsible ? (
        <ChevronDown size={15} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
        ) : null}
    </div>
  );
  return (
    <section
      className="neu-card-static m-rise mb-3 rounded-[18px] p-3.5"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {collapsible ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center text-left">
          {header}
        </button>
      ) : (
        <div className="mb-3 flex items-center gap-2">{header}</div>
      )}
      {collapsible ? (open ? <div className="mt-3">{children}</div> : null) : children}
    </section>
  );
}
