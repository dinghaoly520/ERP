import Link from 'next/link';
import { FolderOpen } from 'lucide-react';

/**
 * standalone 路由（/bid/open 等）在未选项目时展示的引导。
 * 这些路由的页面同时被 /bid/project/[id] 作为 tab 组件复用，
 * 仅在脱离项目上下文直接访问时落到此引导。
 */
export default function NoProjectGuide() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#f8fafc] border border-[#edf2f7] flex items-center justify-center mb-4">
        <FolderOpen size={24} strokeWidth={1.5} className="text-[#94a3b8]" />
      </div>
      <p className="text-sm font-semibold text-[#5a6d8a] mb-1">未选择项目</p>
      <p className="text-xs text-[#8a96aa] mb-4">请从开评标总览选择一个项目，进入对应工作台</p>
      <Link
        href="/bid"
        className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b63ce] transition"
      >
        返回开评标总览
      </Link>
    </div>
  );
}
