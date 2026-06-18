import type { ReactNode } from 'react';
import { cn } from './utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconLike = any;

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
  tone?: 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  icon?: IconLike;
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
  const glassToneClass: Record<string, string> = {
    blue:   'glass-card-blue',
    cyan:   'glass-card-blue',
    green:  'glass-card-emerald',
    orange: 'glass-card-amber',
    red:    'glass-card-rose',
    purple: 'glass-card-purple',
    gray:   'glass-card-blue',
  };

  return (
    <section className={cn(
      'glass-card glass-card-deeper rounded-[28px] p-6',
      glassToneClass[tone] || 'glass-card-blue',
      className
    )}
    style={{
      boxShadow: '0 1px 3px rgba(15,47,87,0.04), 0 6px 24px rgba(91,155,213,0.06)',
    }}>
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
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative z-10 mt-5">{children}</div>}
    </section>
  );
}
