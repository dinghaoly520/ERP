import Link from 'next/link';
import { FolderOpen } from 'lucide-react';

/**
 * 开标大厅（/bid/open）在未指定项目（?id=）时展示的引导。
 */
export default function NoProjectGuide() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[oklch(0.985_0.005_258)] text-[color:var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258_/_0.14),inset_-2px_-2px_5px_oklch(1_0_0_/_0.75)]">
        <FolderOpen size={24} strokeWidth={1.5} />
      </div>
      <p className="mb-1 text-sm font-semibold text-[color:var(--foreground)]">未选择项目</p>
      <p className="mb-4 text-xs text-[color:var(--muted-foreground)]">请从开标任务板选择一个开标中的项目，进入开标大厅</p>
      <Link href="/bid" className="neu-btn-primary !h-[38px] text-xs">
        返回开标任务板
      </Link>
    </div>
  );
}
