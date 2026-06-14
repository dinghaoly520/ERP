'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import {
  changeCatalogStatus,
  getCatalogStats,
  listCatalogItems,
  type CatalogItem,
  type CatalogStats,
} from '@/lib/api/catalog-admin';
import { ShoppingCart, Package } from 'lucide-react';

const statuses = ['全部', '有效', '价格波动', '即将过期', '待复核', '下架', '停用'];

export default function CatalogManagementPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [status, setStatus] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([listCatalogItems({ status }), getCatalogStats()]);
      setItems(list);
      setStats(s);
    } catch (err: any) {
      toast.error(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const kw = search.trim();
    return items.filter(item => !kw || [item.code, item.name, item.specification, item.category, item.supplier].some(v => v.includes(kw)));
  }, [items, search]);

  const setItemStatus = async (item: CatalogItem, nextStatus: string) => {
    const ok = window.confirm(`确认将 ${item.name} 状态改为「${nextStatus}」？`);
    if (!ok) return;
    try {
      await changeCatalogStatus(item.id, nextStatus, `管理端${nextStatus}`);
      toast.success('状态已更新');
      await load();
    } catch (err: any) {
      toast.error(err.message || '状态更新失败');
    }
  };

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="电子商城管理"
        title="集中采购目录管理"
        description="维护商城目录，支持筛选、查看、启用和下架。下架不会删除历史数据。"
        tone="blue"
        icon={<ShoppingCart size={14} />}
      />

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="目录总数" value={stats?.total ?? '—'} tone="blue" icon={<Package size={18} strokeWidth={1.7} />} />
        <MetricCard label="有效目录" value={stats?.active ?? '—'} tone="green" />
        <MetricCard label="下架/停用" value={stats?.inactive ?? '—'} tone="gray" />
        <MetricCard label="待复核/预警" value={stats?.review ?? '—'} tone="orange" />
        <MetricCard label="本月更新" value={stats?.updatedThisMonth ?? '—'} tone="cyan" />
      </div>

      <DataToolbar>
        <select value={status} onChange={e => setStatus(e.target.value)} className="workbench-input text-sm">
          {statuses.map(s => <option key={s}>{s}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索编码、名称、规格、分类、供应商" className="workbench-input flex-1 text-sm" />
        <button onClick={load} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white">刷新</button>
      </DataToolbar>

      <SectionCard className="overflow-hidden p-0">
        <table className="workbench-table">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
            <tr>
              <th className="px-4 py-3">目录编码</th>
              <th className="px-4 py-3">名称/规格</th>
              <th className="px-4 py-3">分类</th>
              <th className="px-4 py-3">参考价</th>
              <th className="px-4 py-3">供应商</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8a99ad]">加载中...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8a99ad]">暂无目录</td></tr>
            ) : filtered.map(item => (
              <tr key={item.id} className="border-t border-[#edf2f7]">
                <td className="px-4 py-3 font-mono text-xs text-[#123a6e]">{item.code}</td>
                <td className="px-4 py-3"><div className="font-bold text-[#18243a]">{item.name}</div><div className="text-xs text-[#8a99ad]">{item.specification}</div></td>
                <td className="px-4 py-3">{item.category}</td>
                <td className="px-4 py-3 font-bold">¥{item.referencePrice.toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3">{item.supplier}</td>
                <td className="px-4 py-3"><StatusBadge tone={item.status === "有效" ? "green" : item.status === "下架" || item.status === "停用" ? "gray" : item.status === "待复核" || item.status === "价格波动" ? "orange" : item.status === "即将过期" ? "red" : "blue"}>{item.status}</StatusBadge></td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {item.status === '有效' ? (
                      <button onClick={() => setItemStatus(item, '下架')} className="rounded-lg border border-orange-200 px-2 py-1 text-xs font-bold text-orange-700">下架</button>
                    ) : (
                      <button onClick={() => setItemStatus(item, '有效')} className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-bold text-emerald-700">启用</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
