'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listCatalogAuditLogs, type CatalogAuditLog } from '@/lib/api/catalog-admin';

const labels: Record<string, string> = {
  CATALOG_CREATED: '新增目录',
  CATALOG_UPDATED: '编辑目录',
  CATALOG_PRICE_CHANGED: '价格调整',
  CATALOG_STATUS_CHANGED: '状态变更',
  CATALOG_IMPORTED: '批量导入',
  CATALOG_TEMPLATE_DOWNLOADED: '模板下载',
  CATALOG_EXPORTED: '目录导出',
};

export default function MallManagementLogsPage() {
  const [logs, setLogs] = useState<CatalogAuditLog[]>([]);
  const [action, setAction] = useState('全部');
  const [search, setSearch] = useState('');

  useEffect(() => {
    listCatalogAuditLogs().then(setLogs).catch((err: any) => toast.error(err.message || '日志加载失败'));
  }, []);

  const filtered = useMemo(() => logs.filter(log => {
    const matchAction = action === '全部' || log.action === action;
    const kw = search.trim();
    const matchSearch = !kw || log.target.includes(kw) || JSON.stringify(log.detail || {}).includes(kw);
    return matchAction && matchSearch;
  }), [logs, action, search]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">同步与操作日志</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">商城读取同一套目录数据，无独立同步队列。这里展示目录导入、改价、下架和导出等操作记录。</p>
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <select value={action} onChange={e => setAction(e.target.value)} className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm">
            <option>全部</option>
            {Object.keys(labels).map(key => <option key={key} value={key}>{labels[key]}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索操作对象或详情" className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#dce6f3] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
            <tr><th className="px-4 py-3">时间</th><th className="px-4 py-3">操作人</th><th className="px-4 py-3">类型</th><th className="px-4 py-3">对象</th><th className="px-4 py-3">详情</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[#8a99ad]">暂无日志</td></tr>
            ) : filtered.map(log => (
              <tr key={log.id} className="border-t border-[#edf2f7] align-top">
                <td className="px-4 py-3 text-xs text-[#5a6d8a]">{log.createdAt.slice(0, 19).replace('T', ' ')}</td>
                <td className="px-4 py-3">{log.user?.displayName || log.user?.username || '-'}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-[#f3f7fc] px-2 py-1 text-xs font-bold text-[#123a6e]">{labels[log.action] || log.action}</span></td>
                <td className="px-4 py-3 font-mono text-xs">{log.target}</td>
                <td className="px-4 py-3"><pre className="max-w-xl whitespace-pre-wrap rounded-xl bg-[#f8fafc] p-3 text-xs text-[#5a6d8a]">{JSON.stringify(log.detail || {}, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
