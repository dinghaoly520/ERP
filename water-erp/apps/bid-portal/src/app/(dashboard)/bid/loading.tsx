import { TableSkeleton } from '@/components/skeleton';
import { Gavel } from 'lucide-react';

export default function BidLoading() {
  return (
    <div className="space-y-6">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Gavel size={17} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">开评标管理系统</div>
              <div className="page-hero__sub">统一入口 · 多端协同 · 限时开标 · 全程留痕</div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="neu-card-static h-24 animate-pulse" />
        ))}
      </div>
      <TableSkeleton rows={5} cols={8} />
    </div>
  );
}
