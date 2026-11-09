'use client';

import { Fragment, useEffect, useState, useRef } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, RotateCcw, ScrollText, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { fetchOperationLogs, type OperationLogRow } from '@/lib/api/operation-log';
import { TableSkeleton } from '@/components/workbench';
import { downloadOperationLogTxt } from '@/lib/history-export';

/* ═══════════════════════════════════════════════════════════════
   系统健康 · 操作日志 Tab（2026-10-30 自 /admin/operation-log 平移）
   办法第42条法定留存的 OperationLog 全量查询（admin）——wb-toolbar + neu-table-card
   懒加载：首次激活（active=true）才发起查询；非激活 CSS 隐藏保持筛选状态
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

const ROLE_CN: Record<string, string> = {
  admin: '管理员', leader: '领导', staff: '员工', bid_host: '开标主持人',
  bid_expert: '评标专家', supplier: '供应商', mall: '商城', anonymous: '匿名',
};

const STATUS_CLASS_CN: Record<string, string> = {
  success: '成功（2xx/3xx）', client: '客户端错误（4xx）', server: '服务端错误（5xx）',
};

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

export function OperationLogTab({ active }: { active: boolean }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const loadReqIdRef = useRef(0);
  const [rows, setRows] = useState<OperationLogRow[]>([]);
  const [total, setTotal] = useState(0);
  // 初始即 true：首次激活前隐藏无所谓，激活瞬间直接骨架屏（防「暂无记录」闪一帧）
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  // 普通函数（每渲染重建）直接读当前 state——useCallback([]) 会冻结首渲染的 filters，
  // 导致翻页/提交时丢筛选条件（浏览器实测：statusClass=client 后翻页查询变裸查询）
  async function load(opts?: { limit?: number; offset?: number; filters?: Filters }) {
    const lim = opts?.limit ?? limit;
    const off = opts?.offset ?? offset;
    const f = opts?.filters ?? filters;
    const rid = ++loadReqIdRef.current; // R7-4② 请求序守卫
    setLoading(true);
    setError(null);
    try {
      const r = await fetchOperationLogs(buildParams(f, lim, off));
      if (rid !== loadReqIdRef.current) return;
      setRows(r.items);
      setTotal(r.total);
      setLimit(lim);
      setOffset(off);
      setExpandedId(null);
    } catch (e) {
      if (rid !== loadReqIdRef.current) return;
      setError((e as Error)?.message ?? '查询失败');
    } finally {
      setLoading(false);
    }
  }

  // 懒加载：首次激活才取数；之后筛选变化由 applyFilter/表单提交显式触发
  useEffect(() => { if (active) setArmed(true); }, [active]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (armed) void load({ offset: 0 }); }, [armed]);

  /** 导出 txt（2026-11-09 操作历史统一配下载）：按当前筛选逐页拉全量（100/页上限），
   *  超 5000 条截取最近段并提示收窄筛选——防无筛选全量 8 万+条的巨量导出 */
  const [exporting, setExporting] = useState(false);
  const EXPORT_CAP = 5000;
  async function exportLogs() {
    setExporting(true);
    try {
      let all: OperationLogRow[] = [];
      for (;;) {
        const r = await fetchOperationLogs(buildParams(filters, 100, all.length));
        all = all.concat(r.items);
        if (r.items.length === 0 || all.length >= r.total || all.length >= EXPORT_CAP) break;
      }
      const truncated = all.length >= EXPORT_CAP && total > all.length ? EXPORT_CAP : undefined;
      const scope = [
        filters.portal ? `门户：${PORTAL_OPTIONS.find(([v]) => v === filters.portal)?.[1] ?? filters.portal}` : null,
        filters.role ? `角色：${ROLE_CN[filters.role] ?? filters.role}` : null,
        filters.username.trim() ? `操作人：${filters.username.trim()}` : null,
        filters.method ? `方法：${filters.method}` : null,
        filters.statusClass ? `状态：${STATUS_CLASS_CN[filters.statusClass] ?? filters.statusClass}` : null,
        filters.keyword.trim() ? `关键词：${filters.keyword.trim()}` : null,
        filters.startTime || filters.endTime ? `时间：${filters.startTime ? new Date(filters.startTime).toLocaleString('zh-CN', { hour12: false }) : '…'} ～ ${filters.endTime ? new Date(filters.endTime).toLocaleString('zh-CN', { hour12: false }) : '…'}` : null,
      ].filter(Boolean).join(' · ') || '全部记录（无筛选）';
      const n = downloadOperationLogTxt(scope, all.map(r => ({
        at: r.createdAt,
        operator: r.displayName || r.username || undefined,
        role: r.role ? ROLE_CN[r.role] ?? r.role : null,
        portal: r.portal,
        method: r.method,
        path: r.path,
        query: r.query,
        statusCode: r.statusCode,
        durationMs: r.durationMs,
        ip: r.ipAddress,
      })), truncated);
      toast.success(truncated ? `已导出最近 ${n} 条（共 ${total} 条，请收窄筛选后导出完整）` : `已导出 ${n} 条操作日志`);
    } catch {
      toast.error('导出失败，请重试');
    }
    setExporting(false);
  }

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
  const hasFilters = Object.values(filters).some((v) => v !== '');

  return (
    <div className="space-y-5">
      {/* ═══ 工具栏（筛选，wb-toolbar 弹性换行）═══ */}
      <form className="wb-toolbar gap-2" onSubmit={(e) => { e.preventDefault(); void load({ offset: 0 }); }}>
        <div className="relative min-w-[160px] xl:min-w-[220px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input
            className="neu-input neu-input-sm !pl-9" placeholder="关键词（路径 / 查询串）"
            value={filters.keyword}
            onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
          />
          {filters.keyword && (
            <button type="button" onClick={() => setFilters({ ...filters, keyword: '' })} aria-label="清除关键词"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--muted-foreground)] z-10">
              <X size={14} />
            </button>
          )}
        </div>
        <input
          className="workbench-input workbench-input-sm !w-auto min-w-[130px]" placeholder="姓名 / 账号（精确）"
          value={filters.username}
          onChange={(e) => setFilters({ ...filters, username: e.target.value })}
        />
        <select className="workbench-input workbench-input-sm !w-auto min-w-[110px]" value={filters.portal} onChange={(e) => applyFilter('portal', e.target.value)}>
          <option value="">全部门户</option>
          {PORTAL_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <select className="workbench-input workbench-input-sm !w-auto min-w-[100px]" value={filters.role} onChange={(e) => applyFilter('role', e.target.value)}>
          <option value="">全部角色</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="workbench-input workbench-input-sm !w-auto min-w-[96px]" value={filters.method} onChange={(e) => applyFilter('method', e.target.value)}>
          <option value="">全部方法</option>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="workbench-input workbench-input-sm !w-auto min-w-[120px]" value={filters.statusClass} onChange={(e) => applyFilter('statusClass', e.target.value)}>
          <option value="">全部状态</option>
          <option value="success">成功 2xx/3xx</option>
          <option value="client">客户端错误 4xx</option>
          <option value="server">服务端错误 5xx</option>
        </select>
        <span className="text-[11px] font-semibold text-[var(--muted-foreground)] flex items-center gap-1">时间</span>
        <input
          className="workbench-input workbench-input-sm !w-auto min-w-[168px]" type="datetime-local" title="开始时间"
          value={filters.startTime}
          onChange={(e) => setFilters({ ...filters, startTime: e.target.value })}
        />
        <span className="text-[11px] text-[var(--muted-foreground)]">至</span>
        <input
          className="workbench-input workbench-input-sm !w-auto min-w-[168px]" type="datetime-local" title="结束时间"
          value={filters.endTime}
          onChange={(e) => setFilters({ ...filters, endTime: e.target.value })}
        />
        <div className="flex-1" />
        {hasFilters && (
          <button type="button" className="neu-btn-xs" onClick={reset} disabled={loading}>
            <RotateCcw size={13} /> 重置
          </button>
        )}
        <button type="submit" className="neu-btn-primary !h-9 !px-4" disabled={loading}>
          <Search size={14} /> 查询
        </button>
      </form>

      {/* ═══ 数据表 ═══ */}
      <div className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold tracking-wide">操作记录</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted-foreground)]">按监管要求留存不少于 15 年 · 命中 {total} 条</span>
            <button type="button" className="neu-btn-xs gap-1" onClick={() => void exportLogs()} disabled={exporting || total === 0}>
              {exporting ? <><Loader2 size={12} className="animate-spin" /> 导出中…</> : <><Download size={12} /> 导出 txt</>}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[960px]">
            <thead>
              <tr>
                <th className="w-9" />
                <th className="w-[150px]">时间</th>
                <th className="w-[130px]">用户</th>
                <th className="w-[90px]">角色</th>
                <th className="w-[96px]">门户</th>
                <th className="w-16">方法</th>
                <th>路径</th>
                <th className="w-[60px]">状态</th>
                <th className="w-[76px]">耗时</th>
                <th className="w-[118px]">IP</th>
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
                        <span className="text-[0.78rem] font-semibold">{r.displayName || r.username || '—'}</span>
                      </td>
                      <td><span className="text-[0.75rem]">{r.role ?? '—'}</span></td>
                      <td>
                        <span className="text-[0.75rem] text-[var(--muted-foreground)]">
                          {PORTAL_OPTIONS.find(([v]) => v === r.portal)?.[1] ?? r.portal ?? '—'}
                        </span>
                      </td>
                      <td><span className="font-mono text-[0.72rem] font-bold">{r.method}</span></td>
                      <td>
                        <span className="inline-block max-w-full truncate align-baseline font-mono text-[0.72rem]" title={`${r.path}${r.query ? `?${r.query}` : ''}`}>
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
                          <div className="grid gap-2 px-1 py-2 text-left sm:grid-cols-2">
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
                                <pre className="neu-pre max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[12px] p-3 font-mono text-[0.68rem] leading-relaxed text-[var(--foreground)]">
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
                <TableSkeleton cols={10} rows={6} />
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={10} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <ScrollText size={22} className="text-[var(--muted-foreground)]" />
                      </div>
                      <p className="text-sm text-[var(--muted-foreground)]">暂无日志记录（当前筛选条件下）</p>
                    </div>
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={10} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <AlertTriangle size={22} className="text-[var(--danger)]" />
                      </div>
                      <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">非管理员账号无权查询全站操作日志（403）</p>
                      <button onClick={() => void load()} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
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
