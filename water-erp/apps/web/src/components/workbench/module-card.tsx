import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@water-erp/shared';

interface ModuleCardProps {
  title: string;
  description: string;
  tone?: WorkbenchTone;
  icon?: ReactNode;
  stats?: ReactNode;
  actionLabel?: string;
  onClick?: () => void;
  className?: string;
}

export function ModuleCard({ title, description, tone = 'blue', icon, stats, actionLabel = '进入模块', onClick, className }: ModuleCardProps) {
  const t = statusTone[tone];
  return (
    <button onClick={onClick} className={cn('group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg', className)} style={{ borderColor: t.border }}>
      <div className="mb-4 flex items-center justify-between">
        {icon && <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ color: t.color, backgroundColor: t.bg }}>{icon}</span>}
        <ArrowRight className="text-[#8a96aa] transition group-hover:translate-x-0.5 group-hover:text-[#064ea2]" size={18} />
      </div>
      <h3 className="text-lg font-black text-[#18243a]">{title}</h3>
      <p className="mt-2 min-h-[40px] text-sm leading-5 text-[#5a6d8a]">{description}</p>
      {stats && <div className="mt-4">{stats}</div>}
      <div className="mt-4 text-sm font-bold" style={{ color: t.color }}>{actionLabel}</div>
    </button>
  );
}
