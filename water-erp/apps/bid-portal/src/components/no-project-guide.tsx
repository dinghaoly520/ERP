import Link from 'next/link';
import { FolderOpen } from 'lucide-react';

/**
 * 开标大厅（/bid/open）在未指定项目（?id=）时展示的引导。
 */
export default function NoProjectGuide() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#f8fafc] border border-[#edf2f7] flex items-center justify-center mb-4">
        <FolderOpen size={24} strokeWidth={1.5} className="text-[#94a3b8]" />
      </div>
      <p className="text-sm font-semibold text-[#5a6d8a] mb-1">未选择项目</p>
      <p className="text-xs text-[#8a96aa] mb-4">请从开标任务板选择一个开标中的项目，进入开标大厅</p>
      <Link
        href="/bid"
        className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b63ce] transition"
      >
        返回开标任务板
      </Link>
    </div>
  );
}
