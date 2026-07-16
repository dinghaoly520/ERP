'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, ShoppingBag } from 'lucide-react';
import { portalURL } from '@water-erp/config';
import { getCatalogStats, getCategoryTree, type CatalogStats } from '@/lib/api/catalog-admin';

function countLeaves(nodes: { children?: unknown[] | null }[] = []): number {
  return nodes.reduce((s, n) => s + (n.children && (n.children as unknown[]).length ? countLeaves(n.children as unknown[]) : 1), 0);
}

export default function CentralCatalogPage() {
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [categoryCount, setCategoryCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCatalogStats(), getCategoryTree()])
      .then(([s, tree]) => { if (!cancelled) { setStats(s); setCategoryCount(countLeaves(tree)); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleOpen = () => {
    window.open(portalURL('mall', '/'), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-center">
      <div className="neu-card rounded-2xl p-8 flex flex-col items-center gap-5 max-w-md">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-[var(--accent-tint)] text-[var(--accent)]">
          <ShoppingBag size={22} />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-[color:var(--foreground)]">集中采购目录</h2>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)] leading-relaxed">
            集中采购目录的浏览、检索与申购在「采购商城」进行。
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-4 gap-2 w-full">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="kpi-card p-3 rounded-xl flex flex-col gap-1 animate-pulse">
                <div className="h-3 w-10 bg-[var(--muted)] rounded" />
                <div className="h-5 w-12 bg-[var(--muted)] rounded" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-4 gap-2 w-full">
            {[
              ['目录总数', stats.total],
              ['有效', stats.active],
              ['品类', categoryCount ?? '—'],
              ['本月更新', stats.updatedThisMonth],
            ].map(([label, value]) => (
              <div key={label} className="kpi-card p-3 rounded-xl flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>
                <span className="text-[1.2rem] font-black tabular-nums text-[var(--foreground)]">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-[var(--muted-foreground)]">
          在采购商城中可查看完整目录、搜索筛选、收藏与提交申购申请
        </p>
        <button type="button" onClick={handleOpen} className="neu-btn is-info inline-flex items-center gap-1.5">
          <ExternalLink size={16} /> 打开采购商城目录
        </button>
      </div>
    </div>
  );
}
