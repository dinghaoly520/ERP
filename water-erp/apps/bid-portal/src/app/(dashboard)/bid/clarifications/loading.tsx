import { PageSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';

export default function ClarificationsLoading() {
  return (
    <div className="space-y-6">
      <PageHero tone="blue" title="澄清答疑" description="供应商答疑 · 回复管理" />
      <PageSkeleton />
    </div>
  );
}
