'use client';

import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, ScrollText, Search } from 'lucide-react';
import { fetchOperationLogs, type OperationLogRow } from '@/lib/api/operation-log';

/* ═══════════════════════════════════════════════════════════════
   操作日志（办法第42条法定留存的 OperationLog 全量查询，admin）
   数据管理页标准三层：page-hero + 工具栏 + neu-table-card
   ═══════════════════════════════════════════════════════════════ */

type Filters = {
  portal: string;
  role: string;
  method: string;
  statusClass: string; // '' | success | client | server
  username: string;
  keyword: string;
  startTime: string; // datetime-local 原始值
  endTime: string;
};

const EMPTY_FILTERS: Filters = {
  portal: '', role: '', method: '', statusClass: '', username: '', keyword: '', startTime: '', endTime: '',
};

const PORTAL_OPTIONS = [
  ['web', '采购管理端'], ['bid', '开评标端'], ['supplier', '供应商门户'],
  ['expert', '专家门户'], ['mall', '采购商城'], ['public', '信息门户'], ['assistant', '助手'],
] as const;

const ROLE_OPTIONS = [
  'admin', 'leader', 'staff', 'bid_host', 'bid_expert', 'supplier', 'mall', 'anonymous',
] as const;

function buildParams(f: Filters, limit: number, offset: number): URLSearchParams {
  const p = new URLSearchParams();
  if (f.portal) p.set('portal', f.portal);
  if (f.role) p.set('role', f.role);
  if (f.method) p.set('method', f.method);
  if (f.statusClass) p.set('statusClass', f.statusClass);
  if (f.username.trim()) p.set('username', f.username.trim());
  if (f.keyword.trim()) p.set('keyword', f.keyword.trim());
  if (f.startTime) p.set('startTime', new Date(f.startTime).toISOString());
  if (f.endTime) p.set('endTime', new Date(f.endTime).toISOString());
  p.set('limit', String(limit));
  p.set('offset', String(offset));
  return p;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function statusColor(code: number): string {
  if (code >= 500) return 'text-[var(--danger)]';
  if (code >= 400) return 'text-[var(--warning)]';
  return 'text-[var(--success)]';
}

export default function OperationLogPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<OperationLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 普通函数（每渲染重建）直接读当前 state——useCallback([]) 会冻结首渲染的 filters，
  // 导致翻页/提交时丢筛选条件（浏览器实测：statusClass=client 后翻页查询变裸查询）
  async function load(opts?: { limit?: number; offset?: number; filters?: Filters }) {
    const lim = opts?.limit ?? limit;
    const off = opts?.offset ?? offset;
    const f = opts?.filters ?? filters;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchOperationLogs(buildParams(f, lim, off));
      setRows(r.items);
      setTotal(r.total);
      setLimit(lim);
      setOffset(off);
      setExpandedId(null);
    } catch (e) {
      setError((e as Error)?.message ?? '查询失败');
    } finally {
      setLoading(false);
    }
  }

  // 仅首次挂载取数；筛选变化由 applyFilter/表单提交显式触发
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load({ offset: 0 }); }, []);

  /** 下拉即筛选（传值避免 setState 异步导致用旧值） */
  function applyFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    void load({ offset: 0, filters: next });
  }

  function reset() {
    setFilters(EMPTY_FILTERS);
    void load({ offset: 0, filters: EMPTY_FILTERS });
  }

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flow-page">
      <div className="px-[clamp(28px,4vw,72px)] pt-4 pb-8">
        {/* ═══ page-hero ═══ */}
        <div className="page-hero">
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon"><ScrollText size={17} /></div>
              <div>
                <div className="page-hero__title">操作日志</div>
                <div className="page-hero__sub">全站 API 操作审计查询 · 法定留存（办法第42条 ≥15 年，过期月分区归档 MinIO）</div>
              </div>
            </div>
            <div className="page-hero__right">
              <span className="page-hero__stat page-hero__stat--info">命中 {total} 条</span>
              <button onClick={() => void load()} disabled={loading} className="neu-btn-xs">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)', paddingTop: '1rem' }} />
          <form
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
            onSubmit={(e) => { e.preventDefault(); void load({ offset: 0 }); }}
          >
            <input
              className="workbench-input" placeholder="关键词（路径 / 查询串）"
              value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
            />
            <input
              className="workbench-input" placeholder="用户名（精确）"
              value={filters.username}
              onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            />
            <select className="workbench-input" value={filters.portal} onChange={(e) => applyFilter('portal', e.target.value)}>
              <option value="">全部门户</option>
              {PORTAL_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <select className="workbench-input" value={filters.role} onChange={(e) => applyFilter('role', e.target.value)}>
              <option value="">全部角色</option>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="workbench-input" value={filters.method} onChange={(e) => applyFilter('method', e.target.value)}>
              <option value="">全部方法</option>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="workbench-input" value={filters.statusClass} onChange={(e) => applyFilter('statusClass', e.target.value)}>
              <option value="">全部状态</option>
              <option value="success">成功 2xx/3xx</option>
              <option value="client">客户端错误 4xx</option>
              <option value="server">服务端错误 5xx</option>
            </select>
            <input
              className="workbench-input" type="datetime-local" title="开始时间"
              value={filters.startTime}
              onChange={(e) => setFilters({ ...filters, startTime: e.target.value })}
            />
            <input
              className="workbench-input" type="datetime-local" title="结束时间"
              value={filters.endTime}
              onChange={(e) => setFilters({ ...filters, endTime: e.target.value })}
            />
            <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
              <button type="submit" className="neu-btn-soft" disabled={loading}>
                <Search size={14} /> 查询
              </button>
              <button type="button" className="neu-btn-xs" onClick={reset} disabled={loading}>
                <RotateCcw size={13} /> 重置
              </button>
            </div>
          </form>
        </div>

        {/* ═══ 数据表 ═══ */}
        <div className="neu-table-card mt-4">
          <div className="overflow-x-auto">
            <table className="neu-table w-full min-w-[1080px]">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th style={{ width: 150 }}>时间</th>
                  <th style={{ width: 130 }}>用户</th>
                  <th style={{ width: 90 }}>角色</th>
                  <th style={{ width: 96 }}>门户</th>
                  <th style={{ width: 64 }}>方法</th>
                  <th>路径</th>
                  <th style={{ width: 60 }}>状态</th>
                  <th style={{ width: 76 }}>耗时</th>
                  <th style={{ width: 118 }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expanded = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        className="row-clickable"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                        title={expanded ? '收起详情' : '展开详情（请求体 / UA / 错误）'}
                      >
                        <td>
                          {expanded
                            ? <ChevronDown size={13} className="text-[var(--muted-foreground)]" />
                            : <ChevronRight size={13} className="text-[var(--muted-foreground)]" />}
                        </td>
                        <td className="font-mono text-[0.72rem] tabular-nums">{fmtTime(r.createdAt)}</td>
                        <td>
                          <span className="text-[0.78rem] font-semibold">{r.username ?? '—'}</span>
                        </td>
                        <td><span className="text-[0.75rem]">{r.role ?? '—'}</span></td>
                        <td>
                          <span className="text-[0.75rem] text-[var(--muted-foreground)]">
                            {PORTAL_OPTIONS.find(([v]) => v === r.portal)?.[1] ?? r.portal ?? '—'}
                          </span>
                        </td>
                        <td><span className="font-mono text-[0.72rem] font-bold">{r.method}</span></td>
                        <td>
                          <span className="block max-w-[420px] truncate font-mono text-[0.72rem]" title={`${r.path}${r.query ? `?${r.query}` : ''}`}>
                            {r.path}
                          </span>
                        </td>
                        <td>
                          <span className={`font-mono text-[0.75rem] font-bold tabular-nums ${statusColor(r.statusCode)}`}>
                            {r.statusCode}
                          </span>
                        </td>
                        <td>
                          <span className={`font-mono text-[0.72rem] tabular-nums ${r.durationMs > 1000 ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)]'}`}>
                            {r.durationMs}ms
                          </span>
                        </td>
                        <td>
                          <span className="font-mono text-[0.7rem] text-[var(--muted-foreground)]">{r.ipAddress ?? '—'}</span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={10}>
                            <div className="grid gap-2 px-1 py-2 sm:grid-cols-2">
                              <div className="space-y-2">
                                <DetailItem label="查询串" value={r.query || '—'} mono />
                                <DetailItem label="Referer" value={r.referer || '—'} mono />
                                <DetailItem label="User-Agent" value={r.userAgent || '—'} mono />
                                {r.error && (
                                  <DetailItem label="错误信息" value={r.error} mono danger />
                                )}
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                                    请求体（服务端脱敏后，≤4KB 截断）
                                  </div>
                                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-[oklch(0.55_0.03_258/0.06)] p-3 font-mono text-[0.68rem] leading-relaxed text-[var(--foreground)]">
{r.body == null ? '—' : JSON.stringify(r.body, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {loading && rows.length === 0 && (
                  <tr><td colSpan={10} className="py-10 text-center text-sm text-[var(--muted-foreground)]">加载中…</td></tr>
                )}
                {!loading && rows.length === 0 && !error && (
                  <tr><td colSpan={10} className="py-10 text-center text-sm text-[var(--muted-foreground)]">暂无日志记录（当前筛选条件下）</td></tr>
                )}
                {error && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center">
                      <span className="text-sm font-semibold text-[var(--danger)]">{error}</span>
                      <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                        非管理员账号无权查询全站操作日志（403）
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ═══ 分页 ═══ */}
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">
              共 {total} 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex items-center gap-1.5">
              <select
                className="workbench-input !h-[30px] !w-auto !py-0 !text-xs"
                value={limit}
                onChange={(e) => void load({ limit: Number(e.target.value), offset: 0 })}
              >
                {[20, 50, 100].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
              </select>
              <button className="neu-btn-xs" disabled={loading || offset === 0} onClick={() => void load({ offset: Math.max(0, offset - limit) })}>
                <ChevronLeft size={13} />
              </button>
              <button className="neu-btn-xs" disabled={loading || offset + limit >= total} onClick={() => void load({ offset: offset + limit })}>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value, mono, danger }: { label: string; value: string; mono?: boolean; danger?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</div>
      <div className={`break-all text-[0.72rem] ${mono ? 'font-mono' : ''} ${danger ? 'text-[var(--danger)]' : 'text-[var(--foreground)]'}`}>
        {value}
      </div>
    </div>
  );
}
