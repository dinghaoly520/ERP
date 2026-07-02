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
    <section id={id} className={cn('glass-card glass-card-blue rounded-2xl p-6 section-enter overflow-x-auto', className)}>
      {(title || description || icon || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {icon && <div className="mt-0.5 text-[#064ea2]">{icon}</div>}
            <div>
              {title && <h2 className="text-lg font-black text-[#18243a]">{title}</h2>}
              {description && <p className="mt-1 text-sm leading-5 text-[#5a6d8a]">{description}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
