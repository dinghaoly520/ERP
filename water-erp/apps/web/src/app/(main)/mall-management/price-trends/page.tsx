'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { TrendingUp, Plus, X, RefreshCw } from 'lucide-react';
import { CategoryTreeSelect } from '@/components/catalog/CategoryTreeSelect';
import { PriceTrendChart } from '@/components/catalog/PriceTrendChart';
import { listCatalogItems, getPriceHistory, type CatalogItem } from '@/lib/api/catalog-admin';

const PALETTE = ['oklch(0.55 0.18 258)', 'oklch(0.55 0.18 30)', 'oklch(0.55 0.18 150)', 'oklch(0.55 0.18 330)', 'oklch(0.55 0.18 80)'];
interface SeriesData { name: string; color: string; data: { date: string; price: number }[] }

export default function PriceTrendsPage() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<CatalogItem[]>([]);
  const [seriesData, setSeriesData] = useState<SeriesData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedCategoryId) { setItems([]); return; }
    listCatalogItems({ categoryId: selectedCategoryId }).then(setItems).catch(e => toast.error(e.message));
  }, [selectedCategoryId]);

  useEffect(() => {
    if (selectedItems.length === 0) { setSeriesData([]); return; }
    setLoading(true);
    Promise.all(selectedItems.map(async (item, i) => {
      try {
        const history = await getPriceHistory(item.id);
        return { name: `${item.name}`, color: PALETTE[i % PALETTE.length], data: history.map(p => ({ date: p.recordedAt.slice(0, 10), price: p.price })) };
      } catch { return { name: item.name, color: PALETTE[i % PALETTE.length], data: [] }; }
    })).then(data => { setSeriesData(data); setLoading(false); }).catch(() => setLoading(false));
  }, [selectedItems]);

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><TrendingUp size={17} /></div>
            <div><div className="page-hero__title">价格趋势</div><div className="page-hero__sub">查看目录项价格历史走势，支持多品对比分析</div></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        <div className="flex flex-col gap-4">
          <CategoryTreeSelect value={selectedCategoryId} onChange={(id) => setSelectedCategoryId(id)} placeholder="按品类筛选目录项" />
          {selectedItems.length > 0 && (
            <div className="neu-card rounded-xl p-3">
              <p className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">已选对比项</p>
              <div className="flex flex-col gap-1">
                {selectedItems.map(item => (
                  <div key={item.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded-lg bg-[var(--accent-tint)]">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: PALETTE[selectedItems.indexOf(item) % PALETTE.length] }} />
                    <span className="flex-1 truncate">{item.name}</span>
                    <button onClick={() => setSelectedItems(prev => prev.filter(i => i.id !== item.id))} aria-label="移除对比" className="p-0.5 rounded hover:bg-[var(--danger-soft)]"><X size={12} className="text-[var(--danger)]" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="neu-card rounded-xl p-3 flex-1 overflow-y-auto max-h-[50vh]">
            <p className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">选择目录项（点击添加）</p>
            <div className="flex flex-col gap-1">
              {items.slice(0, 50).map(item => (
                <button key={item.id} onClick={() => { if (selectedItems.find(i => i.id === item.id)) return; if (selectedItems.length >= 5) { toast.error('最多对比 5 个'); return; } setSelectedItems(prev => [...prev, item]); }}
                  className="text-left text-sm px-2 py-1.5 rounded-lg hover:bg-[var(--accent-tint)] flex items-center justify-between">
                  <span className="truncate">{item.name}</span><Plus size={14} className="text-[var(--muted-foreground)] flex-shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </div>
        </div>
        {loading ? <div className="flex items-center justify-center h-64"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
          : <PriceTrendChart series={seriesData} title={seriesData.length > 0 ? '价格趋势对比' : '请从左侧选择目录项以查看价格趋势'} />}
      </div>
    </div>
  );
}
