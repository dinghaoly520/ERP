'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/workbench';
import {
  changeCatalogStatus, getCatalogStats, listCatalogItems,
  type CatalogItem, type CatalogStats,
} from '@/lib/api/catalog-admin';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';
import { ShoppingCart, Package, RefreshCw, ChevronUp, X, Search } from 'lucide-react';

const statuses = ['全部', '有效', '价格波动', '即将过期', '待复核', '下架', '停用'];

export default function CatalogManagementPage() {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [status, setStatus] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([listCatalogItems({ status }), getCatalogStats()]);
      setItems(list); setStats(s);
    } catch (err: any) { toast.error(err.message || '加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const kw = search.trim();
    return items.filter(item => !kw || [item.code, item.name, item.specification, item.category, item.supplier].some(v => v.includes(kw)));
  }, [items, search]);

  const { sortKey, sortDir, toggle, sorted } = useSort<CatalogItem>('code', 'asc');
  const sortedItems = sorted(filtered);

  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const pagedItems = useMemo(() => sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sortedItems, page]);

  const setItemStatus = async (item: CatalogItem, nextStatus: string) => {
    if (!window.confirm(`确认将 ${item.name} 状态改为「${nextStatus}」？`)) return;
    try { await changeCatalogStatus(item.id, nextStatus, `管理端${nextStatus}`); toast.success('状态已更新'); await load(); }
    catch (err: any) { toast.error(err.message || '状态更新失败'); }
  };

  const statusTone = (s: string): 'green' | 'gray' | 'orange' | 'red' | 'blue' =>
    s === '有效' ? 'green' : s === '下架' || s === '停用' ? 'gray' : s === '待复核' || s === '价格波动' ? 'orange' : s === '即将过期' ? 'red' : 'blue';

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ShoppingCart size={17} /></div>
            <div>
              <div className="page-hero__title">集中采购目录管理</div>
              <div className="page-hero__sub">维护商城目录，支持筛选、查看、启用和下架，下架不删除历史数据</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 items-stretch">
          {[
            ['目录总数', stats?.total ?? '—', '全量目录'],
            ['有效目录', stats?.active ?? '—', '正常使用'],
            ['下架/停用', stats?.inactive ?? '—', '已归档'],
            ['待复核/预警', stats?.review ?? '—', '需关注'],
            ['本月更新', stats?.updatedThisMonth ?? '—', '30日内'],
          ].map(([label, value, sub]) => (
            <div key={label} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{value}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      <div className="wb-toolbar">
        <div className="neu-tab-bar">
          {statuses.map(s => (<button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`neu-tab ${status === s ? 'is-active' : ''}`}>{s}</button>))}
        </div>
        <div className="relative flex-1 min-w-[180px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" /><input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索编码、名称、规格、分类、供应商" className="neu-input !pl-9 w-full text-sm" />{search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10"><X size={14} /></button>}</div>
      </div>

      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[780px]">
            <thead>
              <tr>
                <SortableTh label="编码" field="code" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortableTh label="名称/规格" field="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortableTh label="分类" field="category" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortableTh label="参考价" field="referencePrice" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <th className="text-center">供应商</th>
                <th className="text-center">状态</th>
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><RefreshCw size={22} className="animate-spin text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
                  </div>
                </td></tr>
              ) : sortedItems.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><Package size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无目录</p>
                    <button onClick={() => router.push('/mall-management/price-entry')} className="neu-btn-xs is-info">前往价格录入 →</button>
                  </div>
                </td></tr>
              ) : pagedItems.map(item => (
                <tr key={item.id} className="row-clickable">
                  <td className="text-center font-mono text-xs text-[var(--accent)]">{item.code}</td>
                  <td><div className="font-bold text-[var(--foreground)]">{item.name}</div><div className="text-xs text-[var(--muted-foreground)]">{item.specification}</div></td>
                  <td className="text-center">{item.category}</td>
                  <td className="text-center font-bold tabular-nums">¥{item.referencePrice.toLocaleString('zh-CN')}</td>
                  <td className="text-center">{item.supplier}</td>
                  <td className="text-center"><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge></td>
                  <td onClick={e => e.stopPropagation()} className="text-center">
                    {item.status === '有效'
                      ? <button onClick={() => setItemStatus(item, '下架')} className="neu-btn-xs is-warning">下架</button>
                      : <button onClick={() => setItemStatus(item, '有效')} className="neu-btn-xs is-success">启用</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedItems.length > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{sortedItems.length}</strong> 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-[-90deg]" /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-90" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
