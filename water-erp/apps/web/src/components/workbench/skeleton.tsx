import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('skeleton', className)} />;
}

/** N rows of table skeleton matching workbench-table column layout */
export function TableSkeleton({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-[var(--border)]">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-5 py-3.5">
              <Skeleton className={`h-4 rounded ${c === 0 ? 'w-5/6' : 'w-2/3'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
