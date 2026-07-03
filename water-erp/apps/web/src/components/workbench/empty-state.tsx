import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="neu-icon-well mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-[var(--muted-foreground)]">
        {icon ?? <Search size={24} />}
      </div>
      <p className="text-sm font-extrabold text-[var(--foreground)]">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-xs text-[var(--muted-foreground)] leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
