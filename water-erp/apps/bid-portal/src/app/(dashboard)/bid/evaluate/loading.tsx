import { PageSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';

export default function EvaluateLoading() {
  return (
    <div className="space-y-6">
      <PageHero tone="purple" title="评标管理端" description="专家状态 · 评分监控 · 结果汇总" />
      <PageSkeleton />
    </div>
  );
}
