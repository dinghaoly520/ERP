import { PageSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';

export default function StandardLoading() {
  return (
    <div className="space-y-6">
      <PageHero tone="blue" title="评分标准" description="评标标准编制 · 模板管理" />
      <PageSkeleton />
    </div>
  );
}
