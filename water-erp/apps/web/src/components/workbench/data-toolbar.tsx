import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DataToolbarProps {
  children: ReactNode;
  className?: string;
}

export function DataToolbar({ children, className }: DataToolbarProps) {
  return <div className={cn('mb-4 flex flex-wrap items-center gap-3', className)}>{children}</div>;
}
