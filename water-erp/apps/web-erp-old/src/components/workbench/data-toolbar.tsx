import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DataToolbarProps {
  children: ReactNode;
  className?: string;
}

export function DataToolbar({ children, className }: DataToolbarProps) {
  return <div className={cn('glass-card glass-card-lighter rounded-2xl p-4 flex flex-wrap items-center gap-3', className)}>{children}</div>;
}
