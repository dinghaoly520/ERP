'use client';

import type { ReactNode } from 'react';

export type AssistKpiTone = 'blue' | 'green' | 'amber' | 'red' | 'slate';

interface AssistKpiCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: AssistKpiTone;
  hint?: string;
}

const toneClasses: Record<AssistKpiTone, { card: string; value: string; iconBg: string }> = {
  blue: {
    card: 'glass-card glass-card-blue',
    value: 'text-[var(--color-primary)]',
    iconBg: 'bg-[var(--color-primary-light)] text-[var(--color-primary)]',
  },
  green: {
    card: 'glass-card glass-card-emerald',
    value: 'text-[var(--color-success)]',
    iconBg: 'bg-emerald-50 text-emerald-600',
  },
  amber: {
    card: 'glass-card glass-card-amber',
    value: 'text-[var(--color-warning)]',
    iconBg: 'bg-amber-50 text-amber-600',
  },
  red: {
    card: 'glass-card glass-card-rose',
    value: 'text-[var(--color-danger)]',
    iconBg: 'bg-rose-50 text-rose-600',
  },
  slate: {
    card: 'glass-card',
    value: 'text-[var(--color-text)]',
    iconBg: 'bg-slate-100 text-slate-500',
  },
};

export function AssistKpiCard({
  label,
  value,
  icon,
  tone = 'slate',
  hint,
}: AssistKpiCardProps) {
  const classes = toneClasses[tone];

  return (
    <div
      className={`${classes.card} relative rounded-xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}
    >
      <div className="relative z-[1] flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {label}
        </span>
        <div className="flex items-end justify-between gap-2">
          <span className={`text-2xl font-semibold tabular-nums leading-none ${classes.value}`}>
            {value}
          </span>
          {icon && (
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${classes.iconBg}`}>
              {icon}
            </div>
          )}
        </div>
        {hint && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{hint}</span>
        )}
      </div>
    </div>
  );
}
