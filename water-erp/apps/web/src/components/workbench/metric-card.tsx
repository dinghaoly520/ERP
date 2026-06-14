import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@/lib/workbench';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: WorkbenchTone;
  icon?: ReactNode;
  onClick?: () => void;
  footer?: ReactNode;
  className?: string;
}

export function MetricCard({ label, value, hint, tone = 'blue', icon, onClick, footer, className }: MetricCardProps) {
  const toneConfig = statusTone[tone];
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={cn('group rounded-2xl border bg-white p-5 text-left shadow-sm transition', onClick && 'hover:-translate-y-0.5 hover:shadow-lg', className)}
      style={{ borderColor: toneConfig.border }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="text-xs font-bold text-[#5a6d8a]">{label}</span>
        {icon && <span className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ color: toneConfig.color, backgroundColor: toneConfig.bg }}>{icon}</span>}
      </div>
      <div className="text-3xl font-black tracking-tight text-[#18243a]">{value}</div>
      {hint && <p className="mt-1 text-xs leading-5 text-[#8a96aa]">{hint}</p>}
      {footer && <div className="mt-4 text-xs text-[#5a6d8a]">{footer}</div>}
      {onClick && <ArrowRight className="mt-3 text-[#8a96aa] opacity-0 transition group-hover:opacity-100" size={16} />}
    </Component>
  );
}
