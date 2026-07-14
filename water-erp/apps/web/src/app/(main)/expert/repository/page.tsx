'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { listExperts, listSpecialties, setExpertAvailability, batchOperation, exportExperts, importCsv } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';
import { StatusBadge, TableSkeleton } from '@/components/workbench';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';
import { UsersRound, PlusCircle, Search, RefreshCw, X, ChevronUp, Download, CheckSquare, Square, TrendingUp, UserX, Trophy, Upload } from 'lucide-react';

export default function ExpertRepositoryPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<ExpertListItem[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  // 批量操作
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [batchAction, setBatchAction] = useState<'enable' | 'disable'>('disable');
  const [batchReason, setBatchReason] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);
  // 高级搜索
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advTitle, setAdvTitle] = useState('');
  const [advEmployer, setAdvEmployer] = useState('');
  const [advAvailability, setAdvAvailability] = useState('');
  // CSV 导入
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setExperts(await listExperts({ search: search || undefined, specialty: specialty || undefined }) as ExpertListItem[]); } catch (err: any) { toast.error(err?.message || '加载专家列表失败'); }
    setLoading(false);
  }, [search, specialty]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { listSpecialties().then(setSpecialties).catch(() => {}); }, []);

  const toggle = async (e: ExpertListItem) => {
    try { await setExpertAvailability(e.id, !e.isActive); toast.success(e.isActive ? '已停用' : '已启用'); load(); }
    catch (err: any) { toast.error(err?.message || '操作失败'); }
  };

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selectedIds.size === pagedExperts.length && pagedExperts.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(pagedExperts.map(e => e.id)));
  };
  const doBatch = async () => {
    if (selectedIds.size === 0) return; setBatchSaving(true);
    try {
      await batchOperation({ action: batchAction, ids: [...selectedIds], reason: batchAction === 'disable' && batchReason ? batchReason : undefined });
      toast.success(`${batchAction === 'enable' ? '启用' : '停用'} ${selectedIds.size} 位专家`);
      setSelectedIds(new Set()); setBatchMode(false); setBatchReason(''); load();
    } catch (e: any) { toast.error(e?.message || '批量操作失败'); }
    setBatchSaving(false);
  };
  const doExport = async () => {
    try {
      const data = await exportExperts(selectedIds.size > 0 ? [...selectedIds] : undefined);
      if (!data || data.length === 0) { toast.error('无数据可导出'); return; }
      const csv = [Object.keys(data[0]).join(',')].concat(data.map((r: any) => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `专家库导出_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      toast.success(`导出 ${data.length} 条记录`);
    } catch (e: any) { toast.error(e?.message || '导出失败'); }
  };
  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) { toast.error('CSV 文件至少需要表头行和一数据行'); return; }
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = vals[i] || ''; });
      return row;
    });
    setImporting(true); setImportResult(null);
    try {
      const result = await importCsv(rows);
      setImportResult(result);
      toast.success(`导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`);
      load();
    } catch (err: any) { toast.error(err?.message || '导入失败'); }
    setImporting(false);
    e.target.value = '';
  };

  const { sortKey, sortDir, toggle: sortToggle, sorted } = useSort<ExpertListItem>('displayName', 'asc');
  // 高级筛选（前端二次过滤）
  const filteredExperts = useMemo(() => {
    let list = sorted(experts);
    if (advTitle) list = list.filter(e => (e.expertProfile?.title || '').includes(advTitle));
    if (advEmployer) list = list.filter(e => (e.expertProfile?.employer || '').includes(advEmployer));
    if (advAvailability) list = list.filter(e => e.expertProfile?.availability === advAvailability);
    return list;
  }, [experts, advTitle, advEmployer, advAvailability, sortKey, sortDir, sorted]);

  const totalPages = Math.max(1, Math.ceil(filteredExperts.length / PAGE_SIZE));
  const pagedExperts = useMemo(() => filteredExperts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredExperts, page]);

  const total = experts.length;
  const available = experts.filter(e => e.isActive && e.expertProfile?.availability === '可用').length;
  const inProgress = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED').length, 0);
  const completed = experts.reduce((s, e) => s + e.bidExperts.filter(a => a.progress >= 100).length, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UsersRound size={17} /></div>
            <div><div className="page-hero__title">专家库</div><div className="page-hero__sub">评审专家目录、专业分类与启停管理，支持按专业和姓名筛选</div></div>
          </div>
          <div className="page-hero__right">
            <Link href="/expert/ranking" className="neu-btn-soft"><Trophy size={15} />排名</Link>
            <Link href="/expert/statistics" className="neu-btn-soft"><TrendingUp size={15} />统计</Link>
            <Link href="/expert/retirement" className="neu-btn-soft"><UserX size={15} />退库</Link>
            <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
            <Link href="/expert/entry" className="neu-btn-soft"><PlusCircle size={15} />录入专家</Link>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">
          {[
            ['专家总数', total, '录入总量'],
            ['可用', available, '可参与评审'],
            ['参与项目中', inProgress, '正在评审'],
            ['履职完成', completed, '已完成项目'],
          ].map(([label, value, sub]) => (
            <div key={label} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{String(value)}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* ══════ 工具栏 ══════ */}
      <div className="wb-toolbar flex-wrap gap-2">
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索专家姓名" className="neu-input !pl-9" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10"><X size={14} /></button>}
        </div>
        <select value={specialty} onChange={e => { setSpecialty(e.target.value); setPage(1); }} className="workbench-input !w-auto min-w-[110px]"><option value="">全部专业</option>{specialties.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <button onClick={() => setShowAdvanced(v => !v)} className={`neu-btn-xs ${showAdvanced ? 'is-active' : ''}`}>高级筛选</button>
        {!batchMode ? (
          <button onClick={() => setBatchMode(true)} className="neu-btn-xs">批量操作</button>
        ) : (
          <button onClick={() => { setBatchMode(false); setSelectedIds(new Set()); }} className="neu-btn-xs is-danger">退出批量</button>
        )}
        <label className="neu-btn-xs cursor-pointer"><Upload size={12} />导入CSV<input type="file" accept=".csv" onChange={handleCsvFile} className="hidden" /></label>
        <button onClick={doExport} className="neu-btn-xs"><Download size={12} />导出CSV</button>
        {(search || specialty) && <button onClick={() => { setSearch(''); setSpecialty(''); setPage(1); }} className="neu-btn-xs">重置</button>}
      </div>

      {/* 导入结果 */}
      {importResult && (
        <div className="neu-table-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[var(--foreground)]">CSV 导入结果</span>
            <button onClick={() => setImportResult(null)} className="neu-btn-xs is-danger"><X size={12} /></button>
          </div>
          <div className="flex gap-4 text-xs text-[var(--muted-foreground)] mb-3">
            <span>总计 <strong className="text-[var(--foreground)]">{importResult.total}</strong> 行</span>
            <span>成功 <strong className="text-[var(--success)]">{importResult.imported}</strong></span>
            <span>跳过 <strong className="text-[var(--warning)]">{importResult.skipped}</strong></span>
            <span>失败 <strong className="text-[var(--danger)]">{importResult.failed}</strong></span>
          </div>
          {importResult.results?.length > 0 && (
            <div className="max-h-[200px] overflow-y-auto space-y-0.5">
              {importResult.results.map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <StatusBadge tone={r.状态 === '成功' ? 'green' : r.状态 === '跳过' ? 'orange' : 'red'}>{r.状态}</StatusBadge>
                  <span className="font-medium text-[var(--foreground)]">{r.姓名}</span>
                  {r.原因 && <span className="text-[var(--muted-foreground)] truncate">{r.原因}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 高级筛选 */}
      {showAdvanced && (
        <div className="neu-table-card p-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1"><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">职称</span><input value={advTitle} onChange={e => setAdvTitle(e.target.value)} placeholder="如 高级工程师" className="workbench-input !w-[150px]" /></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">工作单位</span><input value={advEmployer} onChange={e => setAdvEmployer(e.target.value)} placeholder="单位名称" className="workbench-input !w-[180px]" /></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">状态</span><select value={advAvailability} onChange={e => setAdvAvailability(e.target.value)} className="workbench-input !w-[110px]"><option value="">全部</option><option value="可用">可用</option><option value="占用">占用</option><option value="停用">停用</option></select></label>
          <button onClick={() => { setAdvTitle(''); setAdvEmployer(''); setAdvAvailability(''); }} className="neu-btn-xs">清除筛选</button>
        </div>
      )}

      {/* 批量操作栏 */}
      {batchMode && selectedIds.size > 0 && (
        <div className="neu-batch-bar">
          <span className="neu-batch-bar-count">已选 <strong>{selectedIds.size}</strong> 位</span>
          <div className="neu-batch-bar-spacer" />
          <select value={batchAction} onChange={e => setBatchAction(e.target.value as any)} className="workbench-input !w-[90px] !h-[30px] text-xs"><option value="disable">批量停用</option><option value="enable">批量启用</option></select>
          {batchAction === 'disable' && <input value={batchReason} onChange={e => setBatchReason(e.target.value)} placeholder="停用原因" className="workbench-input !w-[140px] !h-[30px] text-xs" />}
          <button onClick={doBatch} disabled={batchSaving} className="neu-btn-xs is-warning">{batchSaving ? '处理中...' : '执行'}</button>
          <button onClick={() => { setSelectedIds(new Set()); setBatchMode(false); }} className="neu-btn-xs">取消选择</button>
        </div>
      )}

      {/* ══════ 数据表格 ══════ */}
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[780px]">
            <thead>
              <tr>
                {batchMode && (
                  <th style={{ width: 44 }}>
                    <button onClick={toggleAll} className="neu-btn-xs">
                      {selectedIds.size === pagedExperts.length && pagedExperts.length > 0 ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>
                  </th>
                )}
                <SortableTh label="专家" field="displayName" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <SortableTh label="专业" field="specialty" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <SortableTh label="职称" field="title" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <th className="text-center">部门</th>
                <th className="text-center">参评项目</th>
                <SortableTh label="评价次数" field="evaluations" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <th className="text-center">最近评价</th>
                <th className="text-center">状态</th>
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={batchMode ? 9 : 8} rows={5} />
              ) : pagedExperts.length === 0 ? (
                <tr><td colSpan={batchMode ? 9 : 8} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><UsersRound size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无专家</p>
                    <button onClick={() => router.push('/expert/entry')} className="neu-btn-xs is-info">前往录入专家 →</button>
                  </div>
                </td></tr>
              ) : pagedExperts.map(e => {
                const activeProjects = e.bidExperts.filter(a => a.project.stage !== 'ARCHIVED');
                return (
                  <tr key={e.id} className="row-clickable" onClick={() => !batchMode && router.push(`/expert/${e.id}`)}>
                    {batchMode && (
                      <td onClick={ev => ev.stopPropagation()}>
                        <button onClick={() => toggleSelect(e.id)} className="neu-btn-xs">
                          {selectedIds.has(e.id) ? <CheckSquare size={15} /> : <Square size={15} />}
                        </button>
                      </td>
                    )}
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{e.displayName[0]}</div>
                        <span className="text-sm font-bold text-[var(--foreground)] truncate hover:text-[var(--accent)] transition-colors">{e.displayName}</span>
                      </div>
                    </td>
                    <td className="text-center">{e.expertProfile?.specialty && <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.title || '—'}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.employer || '—'}</td>
                    <td className="text-center"><span className="text-sm font-semibold text-[var(--foreground)] tabular-nums">{activeProjects.length}</span><span className="text-xs text-[var(--muted-foreground)] ml-1">/{e.bidExperts.length}</span></td>
                    <td className="text-center text-sm font-semibold text-[var(--foreground)] tabular-nums">{e._count.expertEvaluations}</td>
                    <td className="text-center">{e.latestEval ? <StatusBadge tone={e.latestEval.level === 'A' ? 'green' : e.latestEval.level === 'B' ? 'blue' : e.latestEval.level === 'D' ? 'red' : 'orange'}>{e.latestEval.level}级 · {e.latestEval.overallScore}分</StatusBadge> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                    <td className="text-center"><StatusBadge tone={e.isActive ? 'green' : 'gray'}>{e.isActive ? '可用' : '已停用'}</StatusBadge></td>
                    <td onClick={e => e.stopPropagation()} className="text-center">
                      <button onClick={() => toggle(e)} className={e.isActive ? 'neu-btn-xs is-warning' : 'neu-btn-xs is-success'}>{e.isActive ? '停用' : '启用'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredExperts.length > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{filteredExperts.length}</strong> 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-[-90deg]" /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-90" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
