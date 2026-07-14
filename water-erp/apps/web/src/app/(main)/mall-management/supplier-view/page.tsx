'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Building2, RefreshCw } from 'lucide-react';
import { getSupplierCoverage, getSupplierPriceComparison, type SupplierCoverage, type SupplierPriceItem } from '@/lib/api/catalog-admin';

export default function SupplierViewPage() {
  const [tab, setTab] = useState<'coverage' | 'price'>('coverage');
  const [coverage, setCoverage] = useState<SupplierCoverage[]>([]);
  const [priceData, setPriceData] = useState<SupplierPriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const promise = tab === 'coverage' ? getSupplierCoverage() : getSupplierPriceComparison();
    promise.then(data => {
      if (tab === 'coverage') setCoverage(data as unknown as SupplierCoverage[]);
      else setPriceData(data as unknown as SupplierPriceItem[]);
    }).catch(e => toast.error(e.message)).finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left"><div className="page-hero__icon"><Building2 size={17} /></div>
            <div><div className="page-hero__title">供应商维度</div><div className="page-hero__sub">按供应商查看品类覆盖和价格水平对比</div></div></div>
        </div>
      </div>
      <div className="neu-tab-bar">
        <button onClick={() => setTab('coverage')} className={`neu-tab ${tab === 'coverage' ? 'is-active' : ''}`}>品类覆盖</button>
        <button onClick={() => setTab('price')} className={`neu-tab ${tab === 'price' ? 'is-active' : ''}`}>价格对比</button>
      </div>

      {loading ? <div className="flex items-center justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : tab === 'coverage' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {coverage.length === 0 ? <div className="col-span-3 text-center py-8 text-sm text-[var(--muted-foreground)]">暂无供应商数据</div>
              : coverage.map(s => (
                <div key={s.supplier} className="neu-card rounded-2xl p-4 flex flex-col gap-2 cursor-pointer hover:bg-[rgba(96,139,239,0.04)]" onClick={() => setSelectedSupplier(selectedSupplier === s.supplier ? null : s.supplier)}>
                  <div className="flex items-center justify-between"><span className="text-sm font-bold text-[var(--foreground)]">{s.supplier}</span><span className="text-xs font-mono tabular-nums text-[var(--accent)]">{s.categoryCount} 类</span></div>
                  {selectedSupplier === s.supplier && <p className="text-xs text-[var(--muted-foreground)] mt-1">{s.categories.join('、')}</p>}
                </div>
              ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {priceData.length === 0 ? <div className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无价格数据</div>
              : priceData.map(s => (
                <div key={s.supplier} className="neu-card rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-[var(--foreground)]">{s.supplier}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">均价 <strong className="text-[var(--foreground)] tabular-nums">¥{s.avgPrice.toLocaleString()}</strong> · {s.items.length} 项</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="neu-table w-full text-xs">
                      <thead><tr><th>编码</th><th>名称</th><th className="text-right">参考价</th></tr></thead>
                      <tbody>{s.items.map(i => (
                        <tr key={i.code}><td className="font-mono text-[var(--accent)]">{i.code}</td><td>{i.name}</td><td className="text-right tabular-nums font-medium">¥{i.price.toLocaleString()}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              ))}
          </div>
        )}
    </div>
  );
}
