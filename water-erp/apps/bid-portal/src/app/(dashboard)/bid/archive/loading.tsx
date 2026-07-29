import { TableSkeleton } from '@/components/skeleton';

export default function ArchiveLoading() {
  return (
    <div className="space-y-5">
      <div className="neu-card-static h-12 animate-pulse" />
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
}
