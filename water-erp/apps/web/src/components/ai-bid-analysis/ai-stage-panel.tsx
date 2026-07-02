import type { ReactNode } from 'react';

export type AiStagePanelTone = 'default' | 'blue' | 'purple' | 'green' | 'amber' | 'red';

interface AiStagePanelProps {
  title?: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
  tone?: AiStagePanelTone;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<AiStagePanelTone, { surface: string; accent: string; eyebrow: string }> = {
  default: {
    surface: 'from-white via-slate-50/60 to-white',
    accent: 'bg-slate-300',
    eyebrow: 'text-slate-500',
  },
  blue: {
    surface: 'from-white via-sky-50/50 to-blue-50/60',
    accent: 'bg-blue-500',
    eyebrow: 'text-blue-600',
  },
  purple: {
    surface: 'from-white via-violet-50/45 to-purple-50/60',
    accent: 'bg-violet-500',
    eyebrow: 'text-violet-600',
  },
  green: {
    surface: 'from-white via-emerald-50/45 to-green-50/60',
    accent: 'bg-emerald-500',
    eyebrow: 'text-emerald-600',
  },
  amber: {
    surface: 'from-white via-amber-50/45 to-orange-50/60',
    accent: 'bg-amber-500',
    eyebrow: 'text-amber-600',
  },
  red: {
    surface: 'from-white via-rose-50/45 to-red-50/60',
    accent: 'bg-rose-500',
    eyebrow: 'text-rose-600',
  },
};

export default function AiStagePanel({ title, description, eyebrow, action, tone = 'default', children, className = '' }: AiStagePanelProps) {
  const styles = toneClasses[tone];
  return (
    <section className={`relative overflow-hidden rounded-[20px] border border-slate-200/70 bg-gradient-to-br ${styles.surface} p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] ${className}`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${styles.accent}`} />
      {(title || description || eyebrow || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {eyebrow && <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${styles.eyebrow}`}>{eyebrow}</div>}
            {title && <h3 className="text-lg font-semibold text-slate-950">{title}</h3>}
            {description && <p className="text-sm leading-6 text-slate-600">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
