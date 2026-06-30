import { Check, Minus } from 'lucide-react';

export type AiReadinessItem = {
  label: string;
  passed: boolean;
  description?: string;
  severity?: 'normal' | 'warning' | 'danger';
};

interface AiReadinessChecklistProps {
  items: AiReadinessItem[];
}

function getPendingClasses(severity: AiReadinessItem['severity']) {
  if (severity === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

export default function AiReadinessChecklist({ items }: AiReadinessChecklistProps) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-3">
          <div className={item.passed ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white' : `mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${getPendingClasses(item.severity)}`}>
            {item.passed ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800">{item.label}</div>
            {item.description && <div className="mt-0.5 text-xs leading-5 text-slate-500">{item.description}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
