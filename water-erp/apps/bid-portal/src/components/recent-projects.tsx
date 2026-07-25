'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { getRecentProjects, removeRecentProject, type RecentProject } from '@/lib/storage';
import { Clock, X } from 'lucide-react';

export default function RecentProjects() {
  // useSearchParams 需 Suspense 边界（与 bid-project-context 同款手法）
  return (
    <Suspense fallback={null}>
      <RecentProjectsInner />
    </Suspense>
  );
}

function RecentProjectsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<RecentProject[]>([]);

  // pathname 或 ?id= 变化时刷新列表（进入新项目会更新 localStorage）
  useEffect(() => {
    setItems(getRecentProjects());
  }, [pathname, searchParams]);

  if (items.length === 0) return null;

  const handleClick = (p: RecentProject) => {
    // Phase 3：project 工作区已退役，最近项目直达开标大厅
    router.push(`/bid/open?id=${p.id}`);
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeRecentProject(id);
    setItems(getRecentProjects());
  };

  // F10：改从 useSearchParams 响应式读取（同 pathname 切 ?id= 时高亮随之更新）
  const currentId = searchParams.get('id');

  return (
    <div className="px-2 pt-1 pb-2">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <Clock size={11} strokeWidth={1.5} className="text-[#94a3b8]" />
        <span className="text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wider">最近访问</span>
      </div>
      {items.map(p => (
        <div key={p.id} className="group relative mb-0.5">
          <button
            onClick={() => handleClick(p)}
            className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 pr-7 text-left transition-colors ${
              p.id === currentId
                ? 'bg-[#eff6ff] text-[#064ea2]'
                : 'text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a]'
            }`}
            title={`${p.projectCode} — ${p.name}`}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: p.id === currentId ? '#064ea2' : '#cbd5e1' }}
            />
            <span className="text-xs font-medium truncate flex-1">
              <span className="font-mono font-semibold text-[#064ea2]">{p.projectCode}</span>
              <span className="text-[#8a96aa] mx-1">—</span>
              {p.name}
            </span>
          </button>
          <button
            onClick={e => handleRemove(e, p.id)}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-[#94a3b8] opacity-0 group-hover:opacity-100 hover:text-[#e74c3c] hover:bg-[#fef2f2] transition-all"
            title="移除此记录"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </div>
      ))}
      <div className="mx-2 mt-1.5 border-t border-[#edf2f7]" />
    </div>
  );
}
