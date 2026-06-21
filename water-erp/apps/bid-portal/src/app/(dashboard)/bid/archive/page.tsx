'use client';

import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { exportArchivePackage } from '@/lib/api/bid';
import type { BidProjectDetail } from '@/lib/types';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { STATUS_COLOR } from '@water-erp/shared';
import { Archive, CheckCircle, AlertTriangle, Package, Download, Search, ArrowLeft, RefreshCw, ChevronRight } from 'lucide-react';
import { SectionCard, MetricCard, DataToolbar } from '@water-erp/ui';
import DateRangeFilter from '@/components/date-range-filter';

interface SlimProject {
  id: string;
  projectCode: string;
  name: string;
}

interface ArchiveSummary {
  id: string;
  projectCode: string;
  name: string;
  totalItems: number;
  archivedItems: number;
  completionRate: number;
  lastArchivedAt: string | null;
  createdAt: string;
}

export default function BidArchivePage() {
  // ── 视图模式 ──
  const [viewMode, setViewMode] = useState<'summary' | 'detail'>('summary');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // ── 汇总数据 ──
  const [summaryData, setSummaryData] = useState<ArchiveSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Map<string, BidProjectDetail>>(new Map());

  // ── 筛选 ──
  const [search, setSearch] = useState('');
  const [rateFilter, setRateFilter] = useState('');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

  // ── 详情操作 ──
  const [archiving, setArchiving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // ══════════════════════════════════════════════
  // 数据加载
  // ══════════════════════════════════════════════

  const fetchSummary = () => {
    setSummaryLoading(true);
    setSummaryError(null);
    api.get<SlimProject[]>('/bid/projects?stage=ARCHIVED')
      .then(async (ps) => {
        if (ps.length === 0) {
          setSummaryData([]);
          setSummaryLoading(false);
          return;
        }
        // 并行获取所有项目详情
        const results = await Promise.allSettled(
          ps.map(p => api.get<BidProjectDetail>(`/bid/projects/${p.id}`))
        );
        const cache = new Map<string, BidProjectDetail>();
        const summaries: ArchiveSummary[] = [];
        ps.forEach((p, i) => {
          const r = results[i];
          if (r.status === 'fulfilled') {
            cache.set(p.id, r.value);
            const items = r.value.archiveItems || [];
            const archived = items.filter(a => a.status === 'ARCHIVED');
            const lastAt = archived.length > 0
              ? archived.reduce((max, a) => (a.archivedAt && a.archivedAt > max ? a.archivedAt : max), '')
              : null;
            summaries.push({
              id: p.id, projectCode: p.projectCode, name: p.name,
              totalItems: items.length,
              archivedItems: archived.length,
              completionRate: items.length > 0 ? Math.round((archived.length / items.length) * 100) : 0,
              lastArchivedAt: lastAt,
              createdAt: (r.value as any).createdAt || (r.value as any).updatedAt || '',
            });
          } else {
            summaries.push({
              id: p.id, projectCode: p.projectCode, name: p.name,
              totalItems: 0, archivedItems: 0, completionRate: 0, lastArchivedAt: null,
              createdAt: '',
            });
          }
        });
        setDetailCache(cache);
        setSummaryData(summaries);
      })
      .catch((e: any) => {
        if (e?.status !== 401) setSummaryError(e?.message || '加载归档数据失败');
      })
      .finally(() => setSummaryLoading(false));
  };

  useEffect(() => { fetchSummary(); }, []);

  // 进入详情时可能需要单独加载（缓存未命中）
  const enterDetail = (id: string) => {
    setSelectedProjectId(id);
    if (!detailCache.has(id)) {
      setDetailLoading(true);
      api.get<BidProjectDetail>(`/bid/projects/${id}`)
        .then(p => {
          setDetailCache(prev => new Map(prev).set(id, p));
        })
        .catch((e: any) => toast.error(e?.message || '加载项目详情失败'))
        .finally(() => setDetailLoading(false));
    }
    setViewMode('detail');
  };

  const refreshDetail = () => {
    if (!selectedProjectId) return;
    setDetailLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${selectedProjectId}`)
      .then(p => {
        setDetailCache(prev => new Map(prev).set(selectedProjectId, p));
        // 同时更新汇总中的该项目
        const items = p.archiveItems || [];
        const archived = items.filter(a => a.status === 'ARCHIVED');
        const lastAt = archived.length > 0
          ? archived.reduce((max, a) => (a.archivedAt && a.archivedAt > max ? a.archivedAt : max), '')
          : null;
        setSummaryData(prev => prev.map(s => s.id === selectedProjectId ? {
          ...s, totalItems: items.length, archivedItems: archived.length,
          completionRate: items.length > 0 ? Math.round((archived.length / items.length) * 100) : 0,
          lastArchivedAt: lastAt,
        } : s));
      })
      .catch((e: any) => toast.error(e?.message || '刷新失败'))
      .finally(() => setDetailLoading(false));
  };

  // ══════════════════════════════════════════════
  // 筛选逻辑
  // ══════════════════════════════════════════════

  // 日期筛选范围（时间戳）
  const dateFilter = useMemo(() => {
    if (!dateRange.start && !dateRange.end) return null;
    return {
      start: dateRange.start ? new Date(dateRange.start).getTime() : 0,
      end: dateRange.end ? new Date(dateRange.end).getTime() + 86400000 - 1 : Infinity,
    };
  }, [dateRange]);

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summaryData.filter(s => {
      if (q && !s.name.toLowerCase().includes(q) && !s.projectCode.toLowerCase().includes(q)) return false;
      if (rateFilter === '100' && s.completionRate < 100) return false;
      if (rateFilter === '80' && s.completionRate < 80) return false;
      if (rateFilter === 'incomplete' && s.completionRate >= 100) return false;
      if (dateFilter) {
        const at = s.lastArchivedAt ? new Date(s.lastArchivedAt).getTime() : null;
        if (!at || at < dateFilter.start || at > dateFilter.end) return false;
      }
      return true;
    });
  }, [summaryData, search, rateFilter, dateFilter]);

  const fullComplete = summaryData.filter(s => s.completionRate === 100).length;
  const partialCount = summaryData.filter(s => s.completionRate > 0 && s.completionRate < 100).length;

  // 平均归档耗时（天）
  const avgDurationDays = useMemo(() => {
    const withDates = summaryData.filter(s => s.createdAt && s.lastArchivedAt);
    if (withDates.length === 0) return 0;
    const totalDays = withDates.reduce((sum, s) => {
      const start = new Date(s.createdAt).getTime();
      const end = new Date(s.lastArchivedAt!).getTime();
      return sum + (end - start) / (1000 * 60 * 60 * 24);
    }, 0);
    return Math.round(totalDays / withDates.length);
  }, [summaryData]);

  // ══════════════════════════════════════════════
  // 导出
  // ══════════════════════════════════════════════

  const handleExportArchive = async (projectCode: string, format: 'json' | 'csv') => {
    if (!selectedProjectId) return;
    try {
      if (format === 'csv') {
        const a = document.createElement('a');
        a.href = `/api/bid/projects/${selectedProjectId}/archive-package/export?format=csv`;
        a.download = `归档包_${projectCode}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
      } else {
        const data = await exportArchivePackage(selectedProjectId, 'json');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `归档包_${projectCode}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.success('归档包导出成功');
    } catch { toast.error('导出失败'); }
  };

  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // ══════════════════════════════════════════════
  // 渲染：加载态 / 错误态 / 空态
  // ══════════════════════════════════════════════

  if (summaryLoading) return (
    <div className="space-y-6">
      <div className="h-10 bg-[#f3f7fc] rounded-xl w-48 animate-pulse" />
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-[#f8fafc] rounded-2xl animate-pulse" />)}
      </div>
      <TableSkeleton rows={6} cols={5} />
    </div>
  );

  if (summaryError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertTriangle size={28} strokeWidth={1.5} className="text-[#e74c3c] mb-3" />
      <p className="text-sm font-semibold text-[#5a6d8a] mb-4">{summaryError}</p>
      <button onClick={fetchSummary} className="px-4 py-2 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#0b63ce] transition">重试</button>
    </div>
  );

  if (summaryData.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Archive size={32} strokeWidth={1.5} className="text-[#94a3b8] mb-4" />
      <p className="text-sm font-semibold text-[#5a6d8a]">暂无已归档项目</p>
      <p className="text-xs text-[#8a96aa] mt-1">项目评标完成并归档后将在此显示</p>
    </div>
  );

  // ══════════════════════════════════════════════
  // 详情视图
  // ══════════════════════════════════════════════

  if (viewMode === 'detail' && selectedProjectId) {
    const project = detailCache.get(selectedProjectId);
    if (!project) return <TableSkeleton rows={6} cols={4} />;

    const aItems = project.archiveItems || [];
    const archived = aItems.filter(a => a.status === 'ARCHIVED').length;
    const rate = aItems.length > 0 ? Math.round((archived / aItems.length) * 100) : 0;

    return (
      <div className="space-y-6">
        {/* 返回条 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setViewMode('summary'); setSelectedProjectId(null); }}
              className="flex items-center gap-1.5 rounded-xl border border-[#e5ecf4] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition"
            >
              <ArrowLeft size={14} strokeWidth={1.5} />
              返回归档总览
            </button>
            <span className="font-mono text-sm font-semibold text-[#064ea2]">{project.projectCode}</span>
            <span className="text-sm font-bold text-[#18243a]">{project.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8a96aa]">
              归档率 <span className="font-mono font-bold text-[#18243a]">{rate}%</span>
            </span>
            <button
              onClick={refreshDetail}
              className="rounded-xl p-1.5 text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#064ea2] transition"
              title="刷新"
            >
              {detailLoading ? <RefreshCw size={14} strokeWidth={1.5} className="animate-spin" /> : <RefreshCw size={14} strokeWidth={1.5} />}
            </button>
          </div>
        </div>

        {/* 状态头部 */}
        <SectionCard className="flex items-center gap-6">
          <div className="flex-1">
            <h2 className="text-[13px] font-semibold text-[#18243a] tracking-tight">
              电子档案编号：ARCH-{project.projectCode}
            </h2>
            {(() => {
              const archivedItems = aItems.filter(a => a.status === 'ARCHIVED' && a.hashDigest)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
              const root = archivedItems.length > 0 ? archivedItems[archivedItems.length - 1].hashDigest! : '';
              return (
                <p className="text-[12px] text-[#8a96aa] font-mono mt-0.5 flex items-center gap-1.5" title={root || '归档后自动生成'}>
                  <span className="text-[#5a6d8a]">档案指纹：</span>
                  {root ? (
                    <>
                      <span className="text-[#064ea2]">{root.slice(0, 7)}…{root.slice(-6)}</span>
                      <button onClick={() => { navigator.clipboard.writeText(root); toast.success('档案指纹已复制'); }}
                        className="text-[#94a3b8] hover:text-[#064ea2] transition" title="复制完整指纹">⧉</button>
                    </>
                  ) : (
                    <span className="text-[#8a96aa]">归档后自动生成</span>
                  )}
                </p>
              );
            })()}
          </div>
          <div className="text-center px-6">
            <div className="text-[2rem] font-bold font-mono text-[#064ea2] tracking-tight">{rate}%</div>
            <div className="text-[11px] text-[#8a96aa] uppercase tracking-wider">归档率</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={project.stage !== 'EVALUATING' || archiving}
              onClick={async () => {
                setArchiving(true);
                try {
                  await api.post(`/bid/projects/${selectedProjectId}/archive-all`, {});
                  toast.success('归档完成');
                  refreshDetail();
                } catch {
                  toast.error('归档失败，请重试');
                } finally {
                  setArchiving(false);
                }
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#0b63ce] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Package size={14} strokeWidth={1.5} /> {archiving ? '归档中…' : project.stage === 'ARCHIVED' ? '已归档' : '一键归档'}
            </button>
            <button
              onClick={() => handleExportArchive(project.projectCode, 'json')}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#064ea2] text-[#064ea2] hover:bg-[#064ea2] hover:text-white transition"
              title="导出 JSON（含完整哈希链）"
            >
              <Download size={14} strokeWidth={1.5} /> JSON
            </button>
            <button
              onClick={() => handleExportArchive(project.projectCode, 'csv')}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#dce6f3] text-[#064ea2] hover:bg-[#f8fafc] transition text-xs"
              title="导出 CSV"
            >
              CSV
            </button>
          </div>
        </SectionCard>

        {/* 归档清单 + 缺失提醒 */}
        <div className="grid grid-cols-[2fr_1fr] gap-6">
          <SectionCard className="overflow-hidden p-0">
            <div className="px-6 py-4 border-b border-[#e5ecf4]">
              <h2 className="text-sm font-black text-[#18243a]">归档资料清单</h2>
            </div>
            <table className="workbench-table">
              <thead>
                <tr>
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider text-[#5a6d8a]">资料名称</th>
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider text-[#5a6d8a]">责任端</th>
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider text-[#5a6d8a]">状态</th>
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider text-[#5a6d8a]">归档时间</th>
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider text-[#5a6d8a]">哈希摘要</th>
                </tr>
              </thead>
              <tbody>
                {aItems.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-12 text-center text-[13px] text-[#8a96aa]">尚未生成归档清单，点击「一键归档」将自动生成标准材料清单并归档。</td></tr>
                ) : aItems.map(a => {
                  const s = STATUS_COLOR[a.status] || { label: a.status, color: '#94a3b8' };
                  const digest = a.hashDigest;
                  return (
                    <tr key={a.id}>
                      <td className="px-5 py-3 font-medium text-[#18243a]">{a.name}</td>
                      <td className="px-5 py-3 text-[12px] text-[#5a6d8a]">{a.ownerRole}</td>
                      <td className="px-5 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: s.color, backgroundColor: `${s.color}18` }}>{s.label}</span></td>
                      <td className="px-5 py-3 text-[12px] text-[#8a96aa]">{a.archivedAt ? new Date(a.archivedAt).toLocaleString('zh-CN') : '—'}</td>
                      <td className="px-5 py-3 text-[12px] font-mono">
                        {digest ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[#064ea2]" title={digest}>{digest.slice(0, 10)}…{digest.slice(-6)}</span>
                            <button onClick={() => { navigator.clipboard.writeText(digest); toast.success('哈希已复制'); }}
                              className="text-[#94a3b8] hover:text-[#064ea2] transition" title="复制完整哈希">⧉</button>
                          </span>
                        ) : <span className="text-[#8a96aa]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard title="缺失提醒">
            <div className="space-y-2">
              {aItems.filter(a => a.status !== 'ARCHIVED').map(a => (
                <div key={a.id} className="flex items-start gap-2 bg-[#fef9f5] border border-[#fde68a] p-3 rounded-xl">
                  <AlertTriangle size={14} strokeWidth={1.5} className="text-[#f5a623] mt-0.5 flex-shrink-0" />
                  <span className="text-[12px] text-[#18243a] tracking-tight">{a.name} — {STATUS_COLOR[a.status]?.label}</span>
                </div>
              ))}
              {aItems.filter(a => a.status !== 'ARCHIVED').length === 0 && (
                <div className="flex items-start gap-2 bg-[#f0faf6] border border-[#a7f0d0] p-3 rounded-xl">
                  <CheckCircle size={14} strokeWidth={1.5} className="text-[#11a874] mt-0.5 flex-shrink-0" />
                  <span className="text-[12px] text-[#18243a] tracking-tight">所有资料已完整归档</span>
                </div>
              )}
              {archived > 0 && (
                <div className="flex items-start gap-2 bg-[#f0faf6] border border-[#a7f0d0] p-3 rounded-xl mt-2">
                  <CheckCircle size={14} strokeWidth={1.5} className="text-[#11a874] mt-0.5 flex-shrink-0" />
                  <span className="text-[12px] text-[#18243a] tracking-tight">{archived} 项已归档</span>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // 汇总视图
  // ══════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* 指标卡 */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="归档项目" value={summaryData.length} tone="blue" />
        <MetricCard
          label="完整归档"
          value={fullComplete}
          tone="green"
          hint={`${summaryData.length > 0 ? Math.round((fullComplete / summaryData.length) * 100) : 0}% 完整率`}
        />
        <MetricCard
          label="部分归档"
          value={partialCount}
          tone="orange"
          hint={partialCount > 0 ? '仍有资料待补' : '—'}
        />
        <MetricCard
          label="平均耗时"
          value={avgDurationDays > 0 ? `${avgDurationDays}天` : '—'}
          tone={avgDurationDays > 30 ? 'red' : avgDurationDays > 14 ? 'orange' : 'green'}
          hint={avgDurationDays > 0 ? '项目创建至归档完成' : '暂无数据'}
        />
      </div>

      {/* 筛选栏 */}
      <DataToolbar>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input
            type="text"
            placeholder="搜索项目编号或名称…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 py-2.5 text-[13px] border border-[#dbe6f3] rounded-xl bg-white/55 backdrop-blur-sm text-[#18243a] outline-none focus:border-[#0b63ce] focus:bg-white/88 focus:ring-[3px] focus:ring-[#0b63ce]/10 transition"
          />
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <select
          value={rateFilter}
          onChange={e => setRateFilter(e.target.value)}
          className="py-2.5 text-[13px] border border-[#dbe6f3] rounded-xl bg-white/55 backdrop-blur-sm text-[#18243a] outline-none focus:border-[#0b63ce] focus:bg-white/88 cursor-pointer appearance-none pr-8 bg-no-repeat transition" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center'}}
        >
          <option value="">全部完整率</option>
          <option value="100">100% 完整</option>
          <option value="80">≥ 80%</option>
          <option value="incomplete">未完整</option>
        </select>
        <button
          onClick={fetchSummary}
          className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition"
        >
          <RefreshCw size={12} strokeWidth={1.5} />
          刷新
        </button>
      </DataToolbar>

      {/* 项目汇总表 */}
      <SectionCard className="overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-[#e5ecf4]">
          <h2 className="text-sm font-black text-[#18243a]">归档项目汇总</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="workbench-table">
            <thead>
              <tr className="bg-[#f3f7fc]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">项目编号</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">项目名称</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">归档进度</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">最后归档时间</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a] whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredSummaries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-sm text-[#8a96aa]">
                    {search || rateFilter ? '无匹配的归档项目' : '暂无归档项目'}
                  </td>
                </tr>
              ) : filteredSummaries.map(s => (
                <tr
                  key={s.id}
                  onClick={() => enterDetail(s.id)}
                  className="cursor-pointer hover:bg-[#f8fafc] transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-semibold text-[#064ea2]">{s.projectCode}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-[#18243a]">{s.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-[#e8f0fa] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${s.completionRate}%`,
                            backgroundColor: s.completionRate === 100 ? '#11a874' : s.completionRate >= 80 ? '#f5a623' : s.completionRate > 0 ? '#e74c3c' : '#d1d5db',
                          }}
                        />
                      </div>
                      <span className="text-xs font-mono font-semibold text-[#5a6d8a]">{s.archivedItems}/{s.totalItems}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5a6d8a]">{fmtDate(s.lastArchivedAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); enterDetail(s.id); }}
                      className="flex items-center gap-1 rounded-lg border border-[#dce6f3] px-2.5 py-1 text-[11px] font-bold text-[#064ea2] hover:bg-[#eff6ff] transition"
                    >
                      查看详情 <ChevronRight size={12} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
