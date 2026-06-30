'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import AiStatusBadge from './ai-status-badge';

export type AiKeyInfoSectionTone = 'blue' | 'purple' | 'green' | 'amber';

interface AiKeyInfoSectionCardProps {
  icon?: ReactNode;
  title: string;
  summary: ReactNode;
  warnings?: string[];
  children: ReactNode;
  tone?: AiKeyInfoSectionTone;
  fieldCount?: number;
}

export const DEFAULT_KEY_INFO_SECTION_EXPANDED = true;

const toneClasses: Record<AiKeyInfoSectionTone, { border: string; accent: string; surface: string; text: string }> = {
  blue: { border: 'border-blue-200', accent: 'bg-blue-500', surface: 'from-white via-blue-50/50 to-sky-50/60', text: 'text-blue-700' },
  purple: { border: 'border-violet-200', accent: 'bg-violet-500', surface: 'from-white via-violet-50/50 to-purple-50/60', text: 'text-violet-700' },
  green: { border: 'border-emerald-200', accent: 'bg-emerald-500', surface: 'from-white via-emerald-50/50 to-green-50/60', text: 'text-emerald-700' },
  amber: { border: 'border-amber-200', accent: 'bg-amber-500', surface: 'from-white via-amber-50/50 to-orange-50/60', text: 'text-amber-700' },
};

export default function AiKeyInfoSectionCard({
  icon,
  title,
  summary,
  warnings = [],
  children,
  tone = 'blue',
  fieldCount,
}: AiKeyInfoSectionCardProps) {
  const [expanded, setExpanded] = useState(DEFAULT_KEY_INFO_SECTION_EXPANDED);
  const styles = toneClasses[tone];
  const hasWarnings = warnings.length > 0;
  const isEmpty = fieldCount === 0;

  return (
    <section className={`relative overflow-hidden rounded-[20px] border bg-gradient-to-br p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)] ${styles.border} ${styles.surface}`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${styles.accent}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {icon && <span className={styles.text}>{icon}</span>}
            <h4 className="text-base font-semibold text-slate-950">{title}</h4>
            <AiStatusBadge tone={hasWarnings || isEmpty ? 'warning' : 'ready'}>{hasWarnings ? '需关注' : isEmpty ? '待补充' : '已识别'}</AiStatusBadge>
          </div>
          <div className="text-sm leading-6 text-slate-600">{summary}</div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {hasWarnings && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-3 text-sm text-amber-800">
          <div className="mb-2 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" />
            关注项
          </div>
          <ul className="space-y-1.5">
            {warnings.map((warning) => (
              <li key={warning} className="ml-5 list-disc pl-1 leading-5">{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {expanded && <div className="mt-4 space-y-3 border-t border-white/80 pt-4">{children}</div>}
    </section>
  );
}
