import { PageSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';

export default function OpenLoading() {
  return (
    <div className="space-y-6">
      <PageHero tone="blue" title="开标大厅" description="在线解密 · 唱标记录 · 异议处理" />
      <PageSkeleton />
    </div>
  );
}
