'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  changeCatalogStatus,
  getCatalogStats,
  listCatalogItems,
  type CatalogItem,
  type CatalogStats,
} from '@/lib/api/catalog-admin';

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
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">集中采购目录管理</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">维护商城目录，支持筛选、查看、启用和下架。下架不会删除历史数据。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {[
          ['目录总数', stats?.total ?? '--'],
          ['有效目录', stats?.active ?? '--'],
          ['下架/停用', stats?.inactive ?? '--'],
          ['待复核/预警', stats?.review ?? '--'],
          ['本月更新', stats?.updatedThisMonth ?? '--'],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-[#5a6d8a]">{label}</div>
            <div className="mt-3 text-2xl font-black text-[#123a6e]">{value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm">
            {statuses.map(s => <option key={s}>{s}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索编码、名称、规格、分类、供应商" className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm" />
          <button onClick={load} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white">刷新</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#dce6f3] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
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
                <td className="px-4 py-3"><span className="rounded-full bg-[#f3f7fc] px-2 py-1 text-xs font-bold text-[#123a6e]">{item.status}</span></td>
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
      </div>
    </div>
  );
}
