'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ── 可折叠段落（cgzxui 新拟态容器）──

export function CollapsibleSection({
  title,
  icon,
  accent,
  defaultOpen = false,
  summary,
}: {
  title: string;
  icon?: React.ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  /** 常驻内容（折叠+展开都显示）；可为函数 (isOpen) => ReactNode，按展开态切换 reason 截断/完整 */
  summary?: React.ReactNode | ((isOpen: boolean) => React.ReactNode);
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const summaryNode = typeof summary === 'function' ? summary(isOpen) : summary;

  return (
    <div className="neu-card-static overflow-hidden !rounded-[14px]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[oklch(1_0_0/0.35)]"
      >
        {accent && (
          <span
            className="h-6 w-1 shrink-0 rounded-full bg-[var(--cat)]"
            style={{ '--cat': accent } as React.CSSProperties}
          />
        )}
        {icon && <span className="shrink-0 text-[var(--accent-strong)]">{icon}</span>}
        <span className="flex-1 truncate text-sm font-semibold text-[var(--foreground)]">{title}</span>
        <span className="shrink-0 rounded-[7px] bg-[oklch(0.985_0.005_258)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
          {isOpen ? '收起' : '展开'}
        </span>
        {isOpen ? (
          <ChevronUp size={14} className="shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-[var(--muted-foreground)]" />
        )}
      </button>
      {summaryNode && <div className="px-4 pb-4 pt-1">{summaryNode}</div>}
    </div>
  );
}
