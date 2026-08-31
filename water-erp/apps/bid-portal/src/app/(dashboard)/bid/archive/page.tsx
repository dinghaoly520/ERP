'use client';

/**
 * 归档端（只读回看）——方案 A 恢复 + 日期筛选 + 分页。
 * :3007 为纯开标执行终端，归档操作（触发/导出/资料清单）归 :3005。
 * 本页展示所有已归档/已流标项目，支持搜索、日期范围筛选，默认按归档时间降序，点击进入工作区回看。
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Search, ChevronRight, ExternalLink, Ban, AlertTriangle } from 'lucide-react';
import { portalURL } from '@water-erp/config';
import { getProjectsDashboard, type DashboardProject } from '@/lib/api/bid';
import DateRangeFilter from '@/components/date-range-filter';
import { Pagination } from '@/components/pagination';

const PAGE_SIZE = 10;

function fmtDateOnly(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default function BidArchivePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<DashboardProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    getProjectsDashboard()
      .then(d => { setProjects(d.projects); setError(null); })
      .catch((e: any) => {
        // O6（2026-08-28）：不再把故障吞成「暂无已归档项目」空态误导排障（已有数据保留展示）
        setError(e?.message || '归档项目加载失败');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 过滤：仅已归档/已流标
  const ended = useMemo(() => {
    if (!projects) return [];
    return projects.filter(p => p.stage === 'ARCHIVED' || p.stage === 'ABORTED');
  }, [projects]);

  // 搜索 + 日期范围过滤 + 排序（按 updatedAt 降序）
  const filtered = useMemo(() => {
    let list = ended;

    // 文本搜索
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => p.projectCode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }

    // 日期范围（按 updatedAt 筛选）
    if (dateRange.start || dateRange.end) {
      list = list.filter(p => {
        const ts = new Date(p.updatedAt).getTime();
        if (isNaN(ts)) return false;
        if (dateRange.start) {
          const startTs = new Date(dateRange.start).setHours(0, 0, 0, 0);
          if (ts < startTs) return false;
        }
        if (dateRange.end) {
          const endTs = new Date(dateRange.end).setHours(23, 59, 59, 999);
          if (ts > endTs) return false;
        }
        return true;
      });
    }

    // 按归档时间降序（最新归档在前）
    list = [...list].sort((a, b) => {
      if (a.updatedAt > b.updatedAt) return -1;
      if (a.updatedAt < b.updatedAt) return 1;
      return 0;
    });

    return list;
  }, [ended, search, dateRange]);

  // 分页
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 过滤条件变化时回到第 1 页
  useEffect(() => { setPage(1); }, [search, dateRange.start, dateRange.end]);

  const enterWorkspace = (id: string) => router.push(`/bid/project/${id}`);

  return (
    <div className="space-y-5">
      {/* ── 筛选工具栏 ── */}
      <div className="neu-card-static flex flex-wrap items-center gap-3 px-4 py-2.5">
        {/* 搜索 */}
        <div className="flex min-w-[200px] flex-1 items-center gap-2">
          <Search size={14} strokeWidth={1.5} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索项目编号或名称…"
            className="flex-1 bg-transparent text-[13px] text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted-foreground)]"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-[11px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
              清除
            </button>
          )}
        </div>

        {/* 日期范围 */}
        <DateRangeFilter value={dateRange} onChange={setDateRange} />

        {/* 刷新 */}
        <button type="button" onClick={load} disabled={loading} title="刷新" className="neu-btn-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* 结果计数 */}
        <span className="ml-auto text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
          {filtered.length} 个项目
        </span>
      </div>

      {error && !loading && (
        <div className="neu-card-static flex flex-wrap items-center gap-3 px-5 py-3 text-[13px] text-[var(--danger)]">
          <AlertTriangle size={15} /> 归档项目加载失败{projects ? '（下方为最近一次成功加载）' : ''}：{error}
          <button type="button" onClick={load} disabled={loading} className="neu-btn-soft !h-[30px] !text-xs">重试</button>
        </div>
      )}
      {loading && !projects ? (
        <div className="flex min-h-[240px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          <RefreshCw size={18} className="mr-2 animate-spin" /> 加载归档项目…
        </div>
      ) : !error && filtered.length === 0 ? (
        <div className="neu-card-static flex min-h-[200px] items-center justify-center text-[13px] text-[color:var(--muted-foreground)]">
          {search || dateRange.start || dateRange.end ? '没有匹配的项目，请调整筛选条件' : '暂无已归档或已流标的项目'}
        </div>
      ) : filtered.length === 0 ? null : (
        <>
          {/* ── 项目列表 ── */}
          <div className="neu-card-static overflow-hidden p-0">
            <div className="divide-y divide-[oklch(0.6_0.04_258_/_0.1)]">
              {paged.map(p => {
                const aborted = p.stage === 'ABORTED';
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => enterWorkspace(p.id)}
                    className="group flex w-full flex-wrap items-center gap-x-5 gap-y-1.5 px-5 py-3.5 text-left transition-colors hover:bg-[oklch(0.985_0.006_258_/_0.5)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[12px] font-bold ${aborted ? 'text-[color:var(--muted-foreground)]' : 'text-[color:var(--accent-strong)]'}`}>
                          {p.projectCode}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          aborted
                            ? 'bg-[oklch(0.66_0.175_27_/_0.14)] text-[var(--danger)]'
                            : 'bg-[oklch(0.71_0.11_164_/_0.14)] text-[var(--success)]'
                        }`}>
                          {aborted ? <><Ban size={9} /> 已流标</> : '已归档'}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm font-bold tracking-tight text-[color:var(--foreground)]">{p.name}</div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-[color:var(--muted-foreground)]">
                      <span>截标 {fmtDateOnly(p.deadline)}</span>
                      <span>{p.supplierCount} 家供应商</span>
                      <span className="hidden sm:inline">归档 {fmtDateOnly(p.updatedAt)}</span>
                    </div>
                    <ChevronRight size={13} className="text-[color:var(--muted-foreground)]" />
                  </button>
                );
              })}
            </div>

            <Pagination
              page={safePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={PAGE_SIZE}
              onPage={setPage}
            />
          </div>

          {/* ── 跨端入口 ── */}
          <div className="neu-card-static flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <p className="text-[12px] text-[color:var(--muted-foreground)]">
              归档触发、档案导出、资料清单管理 → 在采购管理工作台的项目「开标确认」面板中操作
            </p>
            <a href={portalURL('web', '/projects')} target="_blank" rel="noopener" className="neu-btn-soft">
              <ExternalLink size={13} /> 前往采购管理工作台
            </a>
          </div>
        </>
      )}
    </div>
  );
}
