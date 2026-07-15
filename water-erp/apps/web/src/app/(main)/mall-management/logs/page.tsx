'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listCatalogAuditLogs, type CatalogAuditLog } from '@/lib/api/catalog-admin';
import { StatusBadge } from '@/components/workbench';
import { FileText, RefreshCw, X, Search } from 'lucide-react';

const labels: Record<string, string> = {
  CATALOG_CREATED: '新增目录', CATALOG_UPDATED: '编辑目录', CATALOG_PRICE_CHANGED: '价格调整',
  CATALOG_STATUS_CHANGED: '状态变更', CATALOG_IMPORTED: '批量导入', CATALOG_TEMPLATE_DOWNLOADED: '模板下载', CATALOG_EXPORTED: '目录导出',
};

function HumanizeDetail({ detail }: { details: unknown }) {
  if (!detail || typeof detail !== 'object') return <span className="text-xs text-[var(--muted-foreground)]">—</span>;
  const record = detail as Record<string, any>;
  const entries = Object.entries(record);
  if (entries.length === 0) return <span className="text-xs text-[var(--muted-foreground)]">—</span>;
  if (entries.length <= 4) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([k, v]) => {
          const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return (<span key={k} className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface)] px-2 py-0.5 text-xs shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]"><span className="font-semibold text-[var(--muted-foreground)]">{k}:</span><span className="text-[var(--foreground)] max-w-[200px] truncate">{val}</span></span>);
        })}
      </div>
    );
  }
  return <details><summary className="text-xs font-semibold text-[var(--accent)] cursor-pointer">{entries.length} 个字段</summary><pre className="mt-1 max-w-xl whitespace-pre-wrap rounded-xl bg-[var(--surface)] p-2 text-[11px] text-[var(--muted-foreground)]">{JSON.stringify(record, null, 2)}</pre></details>;
}

export default function MallManagementLogsPage() {
  const [logs, setLogs] = useState<CatalogAuditLog[]>([]);
  const [action, setAction] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    listCatalogAuditLogs().then(setLogs).catch((err: any) => toast.error(err.message || '日志加载失败')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => logs.filter(log => {
    const matchAction = action === '全部' || log.action === action;
    const kw = search.trim();
    return matchAction && (!kw || log.resourceType.includes(kw) || JSON.stringify(log.details || {}).includes(kw));
  }), [logs, action, search]);

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><FileText size={17} /></div>
            <div>
              <div className="page-hero__title">同步与操作日志</div>
              <div className="page-hero__sub">目录导入、改价、下架和导出等操作记录，商城读取同一套目录数据</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
          </div>
        </div>
      </div>

      <div className="wb-toolbar">
        <div className="neu-tab-bar">
          <button onClick={() => setAction('全部')} className={`neu-tab ${action === '全部' ? 'is-active' : ''}`}>全部</button>
          {Object.keys(labels).map(key => (<button key={key} onClick={() => setAction(key)} className={`neu-tab ${action === key ? 'is-active' : ''}`}>{labels[key]}</button>))}
        </div>
        <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" /><input value={search} onChange={e => setSearch(e.target.value)} aria-label="搜索操作日志" placeholder="搜索操作对象或详情" className="neu-input !pl-9 w-full text-sm" />{search && <button onClick={() => setSearch('')} aria-label="清除搜索" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[var(--accent-tint-strong)] text-[var(--muted-foreground)] z-10"><X size={14} /></button>}</div>
      </div>

      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[680px]">
            <thead><tr><th>时间</th><th>操作人</th><th>类型</th><th>对象</th><th>详情</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><FileText size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无操作日志</p>
                  </div>
                </td></tr>
              ) : filtered.map(log => (
                <tr key={log.id} className="align-top">
                  <td className="text-xs text-[var(--muted-foreground)]">{log.createdAt.slice(0, 19).replace('T', ' ')}</td>
                  <td>{log.user?.displayName || log.user?.username || '-'}</td>
                  <td><StatusBadge tone="blue">{labels[log.action] || log.action}</StatusBadge></td>
                  <td className="font-mono text-xs">{log.resourceType}</td>
                  <td><HumanizeDetail detail={log.details} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {logs.length > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{filtered.length}</strong> 条操作记录</span>
          </div>
        )}
      </div>
    </div>
  );
}
