import { TableSkeleton } from '@/components/skeleton';
import { PageHero } from '@water-erp/ui';
import { Gavel } from 'lucide-react';

export default function BidLoading() {
  return (
    <div className="space-y-6">
      <PageHero
        tone="blue"
        icon={<Gavel size={14} strokeWidth={1.5} />}
        title="开评标管理系统"
        description="统一入口 · 多端协同 · 限时开标 · 全程留痕"
      />
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-24 rounded-2xl bg-[#f3f7fc] animate-pulse" />
        ))}
      </div>
      <TableSkeleton rows={5} cols={8} />
    </div>
  );
}
