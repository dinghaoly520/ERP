import type { ReactNode } from 'react';

export type AiStageKpiTone = 'blue' | 'purple' | 'green' | 'amber' | 'red' | 'slate';

interface AiStageKpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: AiStageKpiTone;
  trend?: ReactNode;
  icon?: ReactNode;
}

const toneClasses: Record<AiStageKpiTone, { card: string; value: string; icon: string }> = {
  blue: { card: 'from-blue-50/90 via-white to-sky-50/80 border-blue-100', value: 'text-blue-700', icon: 'bg-blue-100 text-blue-700' },
  purple: { card: 'from-violet-50/90 via-white to-purple-50/80 border-violet-100', value: 'text-violet-700', icon: 'bg-violet-100 text-violet-700' },
  green: { card: 'from-emerald-50/90 via-white to-green-50/80 border-emerald-100', value: 'text-emerald-700', icon: 'bg-emerald-100 text-emerald-700' },
  amber: { card: 'from-amber-50/90 via-white to-orange-50/80 border-amber-100', value: 'text-amber-700', icon: 'bg-amber-100 text-amber-700' },
  red: { card: 'from-rose-50/90 via-white to-red-50/80 border-rose-100', value: 'text-rose-700', icon: 'bg-rose-100 text-rose-700' },
  slate: { card: 'from-slate-50/90 via-white to-slate-50/80 border-slate-200', value: 'text-slate-800', icon: 'bg-slate-100 text-slate-700' },
};

export default function AiStageKpiCard({ label, value, hint, tone = 'slate', trend, icon }: AiStageKpiCardProps) {
  const styles = toneClasses[tone];
  return (
    <div className={`rounded-[18px] border bg-gradient-to-br p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.1)] ${styles.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className={`mt-2 text-2xl font-semibold tracking-tight ${styles.value}`}>{value}</div>
        </div>
        {icon && <div className={`rounded-2xl p-2 ${styles.icon}`}>{icon}</div>}
      </div>
      {(hint || trend) && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
          {hint && <span className="truncate">{hint}</span>}
          {trend && <span className="shrink-0">{trend}</span>}
        </div>
      )}
    </div>
  );
}
