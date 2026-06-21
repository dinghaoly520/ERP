import type { ReactNode } from 'react';
import { cn } from './utils';

interface DataToolbarProps {
  children: ReactNode;
  className?: string;
}

export function DataToolbar({ children, className }: DataToolbarProps) {
  // glass-card-lighter（最透的玻璃变体）只有一层近白描边、无色光晕，
  // 边缘会泛出深色阴影线。显式给定设计系统色 #dbe6f3（与 workbench-input /
  // 工具栏内按钮一致），仅作用于本组件，不影响 SectionCard / MetricCard。
  return (
    <div
      className={cn('glass-card glass-card-lighter rounded-2xl p-4 flex flex-wrap items-center gap-3', className)}
      style={{ borderColor: '#dbe6f3' }}
    >
      {children}
    </div>
  );
}
