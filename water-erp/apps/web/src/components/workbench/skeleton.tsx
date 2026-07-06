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

/** A set of MetricCard-shaped skeleton blocks */
export function MetricCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={cn('grid gap-4', count <= 4 ? 'md:grid-cols-4' : 'md:grid-cols-5')}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-enter rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-8 rounded-xl" />
          </div>
          <Skeleton className="h-8 w-20 rounded" />
          <Skeleton className="mt-1 h-3 w-28 rounded" />
        </div>
      ))}
    </div>
  );
}
