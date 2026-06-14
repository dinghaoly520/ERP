import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DataToolbarProps {
  children: ReactNode;
  className?: string;
}

export function DataToolbar({ children, className }: DataToolbarProps) {
  return <div className={cn('rounded-2xl border border-[#dbeafe] bg-white/90 p-4 shadow-sm backdrop-blur flex flex-wrap items-center gap-3', className)}>{children}</div>;
}
