'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ── 可折叠段落 ──

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
    <div className="glass-card glass-card-lighter rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/40 transition-colors"
      >
        {accent && <span className="w-1 h-6 rounded-full shrink-0" style={{ background: accent }} />}
        {icon && <span className="text-[var(--color-primary)] shrink-0">{icon}</span>}
        <span className="font-semibold text-sm text-[var(--color-text)] flex-1 truncate">{title}</span>
        <span className="text-[10px] text-[var(--color-text-tertiary)] px-2 py-0.5 rounded bg-white/50 shrink-0">
          {isOpen ? '收起' : '展开'}
        </span>
        {isOpen ? (
          <ChevronUp size={14} className="text-[var(--color-text-tertiary)] shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-[var(--color-text-tertiary)] shrink-0" />
        )}
      </button>
      {summaryNode && <div className="px-4 pt-1 pb-4">{summaryNode}</div>}
    </div>
  );
}
