import { TableSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';
import { Archive } from 'lucide-react';

export default function ArchiveLoading() {
  return (
    <div className="space-y-6">
      <PageHero
        tone="green"
        icon={<Archive size={14} strokeWidth={1.5} />}
        title="归档端"
        description="已归档 / 已流标项目只读回看"
      />
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
}
