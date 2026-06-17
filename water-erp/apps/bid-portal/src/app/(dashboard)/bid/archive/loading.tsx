import { PageSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';

export default function ArchiveLoading() {
  return (
    <div className="space-y-6">
      <PageHero tone="green" title="归档端" description="资料归档 · 哈希链 · 防篡改" />
      <PageSkeleton />
    </div>
  );
}
