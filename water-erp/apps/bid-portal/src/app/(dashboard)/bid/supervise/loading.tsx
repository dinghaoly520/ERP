import { PageSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';

export default function SuperviseLoading() {
  return (
    <div className="space-y-6">
      <PageHero tone="orange" title="监督端" description="日志追溯 · 异常监控 · 不可干预" />
      <PageSkeleton />
    </div>
  );
}
