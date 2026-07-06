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
  blue: 'border-[var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent-strong)]',
  cyan: 'border-cyan-200 bg-cyan-50 text-cyan-600',
  green: 'border-green-200 bg-green-50 text-green-600',
  orange: 'border-amber-200 bg-amber-50 text-amber-600',
  red: 'border-red-200 bg-red-50 text-red-600',
  purple: 'border-purple-200 bg-purple-50 text-purple-600',
  gray: 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)]',
};

export function PageHero({ eyebrow, title, description, tone = 'blue', icon, actions, children, className }: PageHeroProps) {
  return (
    <section className={cn(
      'mb-5 pb-5 border-b border-[rgba(184,199,227,0.4)]',
      className
    )}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className={cn('mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold', toneClass[tone])}>
              {icon}
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-black tracking-tight text-[var(--foreground)]">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  );
}
