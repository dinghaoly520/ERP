import { TableSkeleton } from '@/components/skeleton';
import { Archive } from 'lucide-react';

export default function ArchiveLoading() {
  return (
    <div className="space-y-6">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Archive size={17} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">归档端</div>
              <div className="page-hero__sub">已归档 / 已流标项目只读回看</div>
            </div>
          </div>
        </div>
      </div>
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
}
