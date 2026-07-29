import { TableSkeleton } from '@/components/skeleton';

export default function BidLoading() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <div className="neu-card-static h-8 w-8 animate-pulse rounded-[10px]" />
      </div>
      <div className="h-4 w-24 animate-pulse rounded bg-[oklch(0.9_0.004_258_/_0.6)]" />
      <TableSkeleton rows={5} cols={8} />
    </div>
  );
}
