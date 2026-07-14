'use client';

import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { ShoppingBag, Search, X, Package, RefreshCw, ChevronRight } from 'lucide-react';
import { useCategoryTree } from '@/lib/hooks/use-category-tree';
import { findNode, getNodePath } from '@/lib/category-tree-utils';
import { CategoryTree } from '@/components/catalog/CategoryTree';
import { listCatalogItems, type CatalogItem } from '@/lib/api/catalog-admin';
import { StatusBadge } from '@/components/workbench';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';

export default function CentralCatalogPage() {
  const { tree, loading: treeLoading } = useCategoryTree();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [detailItem, setDetailItem] = useState<CatalogItem | null>(null);

  const selectedNode = selectedId ? findNode(tree, selectedId) : null;
  const pathNodes = selectedId ? getNodePath(tree, selectedId) : [];

  useEffect(() => {
    if (!selectedId || !selectedNode?.isLeaf) { setItems([]); return; }
    setLoading(true);
    listCatalogItems({ categoryId: selectedId }).then(setItems).catch(e => toast.error(e.message)).finally(() => setLoading(false));
  }, [selectedId]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return items.filter(it => !kw || [it.code, it.name, it.specification, it.supplier].some(v => v.toLowerCase().includes(kw)));
  }, [items, search]);

  const { sortKey, sortDir, toggle, sorted } = useSort<CatalogItem>('code', 'asc');
  const sortedItems = sorted(filtered);

  const statusTone = (s: string): 'green' | 'gray' | 'orange' | 'red' | 'blue' =>
    s === '有效' ? 'green' : s === '下架' || s === '停用' ? 'gray' : 'orange';

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ShoppingBag size={17} /></div>
            <div>
              <div className="page-hero__title">集中采购目录</div>
              <div className="page-hero__sub">浏览和维护集中采购目录，按品类逐层查看，支持价格对比和快速操作</div>
            </div>
          </div>
        </div>
        {pathNodes.length > 0 && (
          <div className="flex items-center gap-1.5 mt-3 text-sm text-[var(--muted-foreground)]">
            {pathNodes.map((n, i) => (
              <span key={n.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={14} />}
                <button onClick={() => setSelectedId(n.id)} className={`hover:text-[var(--accent)] transition-colors ${n.id === selectedId ? 'text-[var(--accent)] font-semibold' : ''}`}>{n.name}</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <div className="h-[calc(100vh-280px)]">
          <CategoryTree tree={tree} loading={treeLoading} selectedId={selectedId} onSelect={(node) => setSelectedId(node.id)} />
        </div>
        <div className="flex flex-col gap-3">
          {selectedNode?.isLeaf ? (
            <>
              <div className="flex items-center gap-3">
                <h3 className="text-base font-semibold text-[var(--foreground)]">{selectedNode.name}</h3>
                <span className="text-xs text-[var(--muted-foreground)]">{items.length} 个目录项</span>
                <div className="relative flex-1 max-w-[300px] ml-auto">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索编码、名称、规格" className="neu-input !pl-9 w-full text-xs" />
                  {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={12} /></button>}
                </div>
              </div>
              <div className="neu-table-card">
                <div className="overflow-x-auto">
                  <table className="neu-table w-full min-w-[700px]">
                    <thead>
                      <tr>
                        <SortableTh label="编码" field="code" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                        <SortableTh label="名称/规格" field="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                        <SortableTh label="参考价" field="referencePrice" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                        <th className="text-center">供应商</th>
                        <th className="text-center">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={5} className="px-4 py-12 text-center"><RefreshCw size={20} className="animate-spin mx-auto text-[var(--muted-foreground)]" /></td></tr>
                      ) : sortedItems.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-12">
                          <div className="flex flex-col items-center gap-2"><Package size={22} className="text-[var(--muted-foreground)]" /><p className="text-sm text-[var(--muted-foreground)]">该品类暂无目录项</p></div>
                        </td></tr>
                      ) : sortedItems.map(item => (
                        <tr key={item.id} className="row-clickable" onClick={() => setDetailItem(detailItem?.id === item.id ? null : item)}>
                          <td className="text-center font-mono text-xs text-[var(--accent)]">{item.code}</td>
                          <td><div className="font-bold text-[var(--foreground)]">{item.name}</div><div className="text-xs text-[var(--muted-foreground)]">{item.specification}</div></td>
                          <td className="text-center font-bold tabular-nums">¥{item.referencePrice.toLocaleString('zh-CN')}</td>
                          <td className="text-center text-sm">{item.supplier || '—'}</td>
                          <td className="text-center"><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {detailItem && (
                <div className="neu-card rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-[var(--foreground)]">{detailItem.name}</h4>
                    <button onClick={() => setDetailItem(null)} className="p-1 rounded hover:bg-[rgba(96,139,239,0.1)]"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div><span className="text-[var(--muted-foreground)] text-xs">编码</span><p className="font-medium font-mono text-xs">{detailItem.code}</p></div>
                    <div><span className="text-[var(--muted-foreground)] text-xs">规格</span><p className="font-medium">{detailItem.specification || '—'}</p></div>
                    <div><span className="text-[var(--muted-foreground)] text-xs">参考价</span><p className="font-bold tabular-nums">¥{detailItem.referencePrice.toLocaleString('zh-CN')}</p></div>
                    <div><span className="text-[var(--muted-foreground)] text-xs">价格区间</span><p className="font-medium tabular-nums">¥{detailItem.priceMin.toLocaleString()} - ¥{detailItem.priceMax.toLocaleString()}</p></div>
                    <div><span className="text-[var(--muted-foreground)] text-xs">供应商</span><p className="font-medium">{detailItem.supplier || '—'}</p></div>
                    <div><span className="text-[var(--muted-foreground)] text-xs">区域</span><p className="font-medium">{detailItem.region}</p></div>
                    <div><span className="text-[var(--muted-foreground)] text-xs">单位</span><p className="font-medium">{detailItem.unit}</p></div>
                    <div><span className="text-[var(--muted-foreground)] text-xs">有效期</span><p className="font-medium">{detailItem.validUntil?.slice(0, 10) || '—'}</p></div>
                  </div>
                </div>
              )}
            </>
          ) : selectedNode ? (
            <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">📁 这是一个分组节点，点击左侧叶子节点查看目录项</div>
          ) : (
            <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">👈 从左侧品类树选择一个叶子节点查看目录项</div>
          )}
        </div>
      </div>
    </div>
  );
}
