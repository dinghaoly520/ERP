import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@water-erp/shared';

interface StatusBadgeProps {
  children: ReactNode;
  tone?: WorkbenchTone;
  className?: string;
}

export function StatusBadge({ children, tone = 'gray', className }: StatusBadgeProps) {
  const t = statusTone[tone];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold', className)} style={{ color: t.color, backgroundColor: t.bg, borderColor: t.border }}>
      {children}
    </span>
  );
}
