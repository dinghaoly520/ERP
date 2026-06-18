'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getRecentProjects, removeRecentProject, type RecentProject } from '@/lib/storage';
import { Clock, X } from 'lucide-react';

export default function RecentProjects() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<RecentProject[]>([]);

  // 每次 pathname 变化时刷新列表（进入新项目时会更新 localStorage）
  useEffect(() => {
    setItems(getRecentProjects());
  }, [pathname]);

  if (items.length === 0) return null;

  const handleClick = (p: RecentProject) => {
    router.push(`/bid/project/${p.id}`);
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeRecentProject(id);
    setItems(getRecentProjects());
  };

  const currentId = pathname.startsWith('/bid/project/')
    ? pathname.split('/')[3]
    : null;

  return (
    <div className="px-2 pt-1 pb-2">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <Clock size={11} strokeWidth={1.5} className="text-[#94a3b8]" />
        <span className="text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wider">最近访问</span>
      </div>
      {items.map(p => (
        <button
          key={p.id}
          onClick={() => handleClick(p)}
          className={`group relative flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors mb-0.5 ${
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
          <button
            onClick={e => handleRemove(e, p.id)}
            className="flex-shrink-0 p-0.5 rounded text-[#94a3b8] opacity-0 group-hover:opacity-100 hover:text-[#e74c3c] hover:bg-[#fef2f2] transition-all"
            title="移除此记录"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </button>
      ))}
      <div className="mx-2 mt-1.5 border-t border-[#edf2f7]" />
    </div>
  );
}
