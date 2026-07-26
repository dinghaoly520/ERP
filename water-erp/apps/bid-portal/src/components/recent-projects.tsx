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
    router.push(`/bid/project/${p.id}`);
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
    <div className="px-2 pt-2 pb-2">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <Clock size={11} strokeWidth={1.5} className="text-[color:var(--muted-foreground)]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">最近访问</span>
      </div>
      {items.map(p => {
        const active = p.id === currentId;
        return (
          <div key={p.id} data-active={active} className="bid-recent-row group relative mb-0.5">
            <button
              onClick={() => handleClick(p)}
              className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 pr-7 text-left transition-colors ${
                active
                  ? 'bg-[oklch(0.62_0.16_258_/_0.1)] text-[color:var(--accent-strong)]'
                  : 'text-[color:var(--muted-foreground)] hover:bg-[oklch(0.985_0.006_258_/_0.7)] hover:text-[color:var(--foreground)]'
              }`}
              title={`${p.projectCode} — ${p.name}`}
            >
              <span className="bid-recent-dot" />
              <span className="flex-1 truncate text-xs font-medium">
                <span className="font-mono font-semibold text-[color:var(--accent-strong)]">{p.projectCode}</span>
                <span className="mx-1 text-[color:var(--muted-foreground)]">—</span>
                {p.name}
              </span>
            </button>
            <button
              onClick={e => handleRemove(e, p.id)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-[color:var(--muted-foreground)] opacity-0 transition-all hover:bg-[oklch(0.66_0.175_27_/_0.1)] hover:text-[var(--danger)] group-hover:opacity-100"
              title="移除此记录"
            >
              <X size={11} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
      <div className="mx-2 mt-1.5 border-t border-[oklch(0.6_0.04_258_/_0.14)]" />
    </div>
  );
}
