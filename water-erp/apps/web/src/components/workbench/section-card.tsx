import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  id?: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ id, title, description, icon, action, children, className }: SectionCardProps) {
  return (
    <section id={id} className={cn('mb-8', className)}>
      {(title || description || icon || action) && (
        <div className="mb-4 flex items-start justify-between gap-4 pb-4 border-b border-[rgba(184,199,227,0.35)]">
          <div className="flex items-start gap-3">
            {icon && <div className="mt-0.5 text-[var(--accent)]">{icon}</div>}
            <div>
              {title && <h2 className="text-lg font-black text-[var(--foreground)]">{title}</h2>}
              {description && <p className="mt-1 text-sm leading-5 text-[var(--muted-foreground)]">{description}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
