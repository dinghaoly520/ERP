import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
  tone?: 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const toneClass = {
  blue: 'border-[#bfdbfe] bg-[#eff6ff] text-[#064ea2]',
  cyan: 'border-[#a5f3fc] bg-[#ecfeff] text-[#0891b2]',
  green: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#11a874]',
  orange: 'border-[#fed7aa] bg-[#fff7ed] text-[#f5a623]',
  red: 'border-[#fecaca] bg-[#fef2f2] text-[#e74c3c]',
  purple: 'border-[#ddd6fe] bg-[#f5f3ff] text-[#7c3aed]',
  gray: 'border-[#e5ecf4] bg-[#f8fafc] text-[#5a6d8a]',
};

export function PageHero({ eyebrow, title, description, tone = 'blue', icon, actions, children, className }: PageHeroProps) {
  const toneGlass = {
    blue: 'from-[rgba(96,165,250,0.12)] to-[rgba(147,197,253,0.06)]',
    cyan: 'from-[rgba(6,182,212,0.12)] to-[rgba(34,211,238,0.06)]',
    green: 'from-[rgba(52,211,153,0.12)] to-[rgba(110,231,183,0.06)]',
    orange: 'from-[rgba(251,191,36,0.14)] to-[rgba(252,211,77,0.07)]',
    red: 'from-[rgba(251,113,133,0.12)] to-[rgba(253,164,175,0.06)]',
    purple: 'from-[rgba(168,139,250,0.14)] to-[rgba(196,167,250,0.07)]',
    gray: 'from-[rgba(148,163,184,0.08)] to-[rgba(203,213,225,0.04)]',
  }[tone] || 'from-[rgba(96,165,250,0.12)] to-[rgba(147,197,253,0.06)]';

  return (
    <section className={cn(
      'glass-card relative rounded-[24px] p-6',
      'bg-gradient-to-br',
      toneGlass,
      className
    )}>
      {/* 光晕容器 — 独立裁剪，不干扰玻璃透叠 */}
      <div className="absolute inset-0 overflow-hidden rounded-[24px] pointer-events-none">
        <div className="absolute -top-14 -left-14 h-[220px] w-[220px] rounded-full opacity-25 animate-[glass-glow-drift_20s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle, rgba(147,197,253,0.22), transparent 70%)' }} />
        <div className="absolute -bottom-12 -right-12 h-[180px] w-[180px] rounded-full opacity-20 animate-[glass-glow-drift-reverse_22s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle, rgba(196,181,253,0.18), transparent 70%)' }} />
      </div>

      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className={cn('mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold', toneClass[tone])}>
              {icon}
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-black tracking-tight text-[#0f2f57]">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5a6d8a]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 relative z-10">{actions}</div>}
      </div>
      {children && <div className="relative z-10 mt-5">{children}</div>}
    </section>
  );
}
