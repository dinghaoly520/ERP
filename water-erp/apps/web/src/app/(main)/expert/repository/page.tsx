'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listExperts, listSpecialties, setExpertAvailability, batchOperation, exportExperts, updateExpertEntryStatus } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';
import { StatusBadge, TableSkeleton } from '@/components/workbench';
import { ExpertEvaluationDialog } from '@/components/expert/expert-evaluation-dialog';
import { ExpertEntryDialog } from '@/components/expert/expert-entry-dialog';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';
import { UsersRound, PlusCircle, Search, RefreshCw, X, ChevronLeft, ChevronRight, Download, CheckSquare, Square, TrendingUp, UserX, Trophy, AlertTriangle } from 'lucide-react';
import type { WorkbenchTone } from '@water-erp/shared';
import { LEVEL_COLOR, LEVEL_LABEL } from '@water-erp/shared';

const SPECIALTY_TONES: WorkbenchTone[] = ['blue', 'cyan', 'green', 'orange', 'red', 'purple'];
function specialtyTone(s: string): WorkbenchTone {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return SPECIALTY_TONES[Math.abs(hash) % SPECIALTY_TONES.length];
}

export default function ExpertRepositoryPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<ExpertListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // 防抖后的搜索词，驱动实际请求
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
  // 启用/停用二次确认
  const [confirmToggle, setConfirmToggle] = useState<ExpertListItem | null>(null);
  const [toggling, setToggling] = useState(false);
  // 评价弹窗（由操作列「评价」按钮触发）
  const [evalTarget, setEvalTarget] = useState<ExpertListItem | null>(null);
  // 录入专家弹窗
  const [showEntryModal, setShowEntryModal] = useState(false);
  // 批量操作二次确认
  const [confirmBatch, setConfirmBatch] = useState(false);

  // 搜索防抖：输入即时反映在 search，300ms 后同步到 query 再触发请求
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // 搜索竞态守卫：递增 requestId，过期响应直接丢弃，避免旧结果覆盖新结果
  const loadReqIdRef = useRef(0);
  // CTS A-218/222 入库状态操作（暂停/退库须事由；权限由后端 admin/leader 把关）
  const handleEntryStatus = async (e: ExpertListItem, target: 'ACTIVE' | 'SUSPENDED' | 'RETIRED') => {
    let reason: string | undefined;
    if (target !== 'ACTIVE') {
      const input = window.prompt(target === 'SUSPENDED' ? '请输入暂停事由：' : '请输入退库事由：');
      if (!input || !input.trim()) return;
      reason = input.trim();
    }
    try {
      await updateExpertEntryStatus(e.id, { status: target, reason });
      toast.success('入库状态已更新');
      load();
    } catch (err: any) { toast.error(err?.message || '操作失败'); }
  };

  const load = useCallback(async () => {
    const rid = ++loadReqIdRef.current;
    setLoading(true); setErrored(false);
    try {
      const res = await listExperts({ search: query || undefined, specialty: specialty || undefined, page, pageSize: PAGE_SIZE });
      if (rid !== loadReqIdRef.current) return;
      // 兼容新旧 API 返回格式：新版返回 { total, items }，旧版返回数组
      if (Array.isArray(res)) {
        setExperts(res as any as ExpertListItem[]);
        setTotal((res as any as ExpertListItem[]).length);
      } else {
        setExperts((res as any).items || []);
        setTotal((res as any).total || 0);
      }
    } catch (err: any) {
      if (rid !== loadReqIdRef.current) return;
      setErrored(true); toast.error(err?.message || '加载专家列表失败');
    }
    setLoading(false);
  }, [query, specialty, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { listSpecialties().then(setSpecialties).catch(() => {}); }, []);

  const doToggle = async () => {
    if (!confirmToggle) return;
    const target = confirmToggle;
    setToggling(true);
    try {
      await setExpertAvailability(target.id, !target.isActive);
      toast.success(target.isActive ? '已停用' : '已启用');
      setConfirmToggle(null);
      load();
    } catch (err: any) { toast.error(err?.message || '操作失败'); }
    setToggling(false);
  };

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selectedIds.size === displayedExperts.length && displayedExperts.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(displayedExperts.map(e => e.id)));
  };
  const doBatch = async () => {
    if (selectedIds.size === 0) return; setBatchSaving(true);
    try {
      await batchOperation({ action: batchAction, ids: [...selectedIds], reason: batchAction === 'disable' && batchReason ? batchReason : undefined });
      toast.success(`${batchAction === 'enable' ? '启用' : '停用'} ${selectedIds.size} 位专家${batchAction === 'disable' && batchReason.trim() ? `（原因：${batchReason.trim()}）` : ''}，已记录至操作日志`);
      setConfirmBatch(false); setSelectedIds(new Set()); setBatchMode(false); setBatchReason(''); load();
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
  const { sortKey, sortDir, toggle: sortToggle, sorted } = useSort<ExpertListItem>('displayName', 'asc');
  // 高级筛选（前端二次过滤，仅作用于当前页——后续可考虑后端过滤）
  const filteredExperts = useMemo(() => {
    let list = sorted(experts);
    if (advTitle) list = list.filter(e => (e.expertProfile?.title || '').includes(advTitle));
    if (advEmployer) list = list.filter(e => (e.expertProfile?.employer || '').includes(advEmployer));
    if (advAvailability) list = list.filter(e => e.expertProfile?.availability === advAvailability);
    return list;
  }, [experts, advTitle, advEmployer, advAvailability, sortKey, sortDir, sorted]);

  // 分页：total 来自服务端；高级筛选无匹配时可能少于 pageSize
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const displayedExperts = filteredExperts;

  // Hero KPI：总数来自服务端，其余指标基于当前页近似
  const available = experts.filter(e => e.isActive && e.expertProfile?.availability === '可用').length;
  const occupied = experts.filter(e => e.isActive && e.expertProfile?.availability === '占用').length;
  const disabled = experts.filter(e => !e.isActive || e.expertProfile?.availability === '停用').length;
  const totalEvals = experts.reduce((s, e) => s + e._count.expertEvaluations, 0);
  const gradeDistribution = useMemo(() => {
    const dist = { A: 0, B: 0, C: 0, D: 0, E: 0, '-': 0 };
    for (const e of experts) {
      const g = e.avgGrade || e.latestEval?.level;
      if (g) dist[g as keyof typeof dist] = (dist[g as keyof typeof dist] ?? 0) + 1;
      else dist['-']++;
    }
    return dist;
  }, [experts]);

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
          </div>
        </div>
        <div className="page-hero__divider">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6 items-stretch">
          {[
            ['专家总数', total, '录入总量'],
            ['可用', available, '可参与抽取'],
            ['占用中', occupied, '正参与评审'],
            ['已停用', disabled, '退库/停用'],
            ['总评价次数', totalEvals, '累计评价'],
          ].map(([label, value, sub]) => (
            <div key={label} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{String(value)}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>
            </div>
          ))}
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">优良率</span>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">
              {(() => { const graded = gradeDistribution.A + gradeDistribution.B + gradeDistribution.C + gradeDistribution.D + gradeDistribution.E; return graded > 0 ? Math.round((gradeDistribution.A + gradeDistribution.B) / graded * 100) : 0; })()}%
            </span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight flex items-center gap-1.5">
              {(['A','B','C','D','E'] as const).map(g => (
                <span key={g} className="inline-flex items-baseline gap-0.5">
                  <span className="font-bold" style={{color: g==='A'?'#059669':g==='B'?'#0a5eb8':g==='C'?'#d97706':g==='D'?'#ca8a04':'#dc2626'}}>{g}</span>
                  <span className="tabular-nums">{gradeDistribution[g]}</span>
                </span>
              ))}
            </span>
          </div>
        </div>
        </div>
      </div>

      {/* ══════ 工具栏 ══════ */}
      <div className="wb-toolbar flex-wrap gap-2">
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索姓名/专业/单位" className="neu-input !pl-9" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--muted-foreground)] z-10" aria-label="清除搜索"><X size={14} /></button>}
        </div>
        <select value={specialty} onChange={e => { setSpecialty(e.target.value); setPage(1); }} className="workbench-input !w-auto min-w-[110px]"><option value="">全部专业</option>{specialties.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <button onClick={() => setShowAdvanced(v => !v)} className={`neu-btn-xs ${showAdvanced ? 'is-active' : ''}`}>高级筛选</button>
        {!batchMode ? (
          <button onClick={() => setBatchMode(true)} className="neu-btn-xs">批量操作</button>
        ) : (
          <button onClick={() => { setBatchMode(false); setSelectedIds(new Set()); }} className="neu-btn-xs is-danger">退出批量</button>
        )}
        <button onClick={() => setShowEntryModal(true)} className="neu-btn-xs"><PlusCircle size={12} />录入专家</button>
        <button onClick={doExport} className="neu-btn-xs" title={selectedIds.size > 0 ? `导出已选的 ${selectedIds.size} 位专家` : '导出全部专家'}><Download size={12} />导出CSV{selectedIds.size > 0 && <span className="ml-1 rounded bg-[var(--accent)] px-1 py-0 text-[10px] font-bold text-white">{selectedIds.size}</span>}</button>
        {(search || specialty) && <button onClick={() => { setSearch(''); setSpecialty(''); setPage(1); }} className="neu-btn-xs">重置</button>}
      </div>

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
      {batchMode && (
        <div className={`neu-batch-bar ${selectedIds.size === 0 ? 'opacity-50' : ''}`}>
          <span className="neu-batch-bar-count">已选 <strong>{selectedIds.size}</strong> 位</span>
          {selectedIds.size > 0 && totalPages > 1 && <span className="text-[10px] text-[var(--muted-foreground)] ml-2">跨页已保留 · 翻页不丢失</span>}
          <div className="neu-batch-bar-spacer" />
          {selectedIds.size === 0 && <span className="text-[11px] text-[var(--muted-foreground)] mr-2">勾选当前页专家或翻页继续选择</span>}
          {selectedIds.size > 0 && (
            <>
              <select value={batchAction} onChange={e => setBatchAction(e.target.value as any)} className="workbench-input !w-[90px] !h-[30px] text-xs"><option value="disable">批量停用</option><option value="enable">批量启用</option></select>
              {batchAction === 'disable' && <input value={batchReason} onChange={e => setBatchReason(e.target.value)} placeholder="停用原因" className="workbench-input !w-[140px] !h-[30px] text-xs" />}
              <button onClick={() => setConfirmBatch(true)} disabled={batchSaving} className="neu-btn-xs is-warning">{batchSaving ? '处理中...' : '执行'}</button>
            </>
          )}
          <button onClick={() => { setSelectedIds(new Set()); setBatchMode(false); }} className="neu-btn-xs">取消选择</button>
        </div>
      )}

      {/* ══════ 数据表格 ══════ */}
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[880px]">
            <thead>
              <tr>
                {batchMode && (
                  <th style={{ width: 44 }}>
                    <button onClick={toggleAll} className="neu-btn-xs">
                      {selectedIds.size === displayedExperts.length && displayedExperts.length > 0 ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>
                  </th>
                )}
                <SortableTh label="专家" field="displayName" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <SortableTh label="专业" field="expertProfile.specialty" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <SortableTh label="职称" field="expertProfile.title" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <th className="text-center">工作单位</th>
                <th className="text-center">部门</th>
                <th className="text-center">参评项目</th>
                <SortableTh label="评价次数" field="_count.expertEvaluations" sortKey={sortKey} sortDir={sortDir} onToggle={sortToggle} />
                <th className="text-center">平均等级</th>
                <th className="text-center">最近评价</th>
                <th className="text-center">入库状态</th>
                <th className="text-center">状态</th>
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={batchMode ? 12 : 11} rows={5} />
              ) : errored ? (
                <tr><td colSpan={batchMode ? 12 : 11} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><AlertTriangle size={22} className="text-[var(--danger)]" /></div>
                    <p className="text-sm font-semibold text-[var(--danger)]">专家列表加载失败</p>
                    <button onClick={load} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
                  </div>
                </td></tr>
              ) : displayedExperts.length === 0 ? (
                <tr><td colSpan={batchMode ? 12 : 11} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><UsersRound size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无专家</p>
                    <button onClick={() => setShowEntryModal(true)} className="neu-btn-xs is-info">前往录入专家 →</button>
                  </div>
                </td></tr>
              ) : displayedExperts.map(e => {
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
                    <td className="text-center">{e.expertProfile?.specialty && <StatusBadge tone={specialtyTone(e.expertProfile.specialty)}>{e.expertProfile.specialty}</StatusBadge>}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.title || '—'}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.employer || '—'}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{e.department?.name || '—'}</td>
                    <td className="text-center"><span className="text-sm font-semibold text-[var(--foreground)] tabular-nums">{e.bidExperts.length}</span></td>
                    <td className="text-center text-sm font-semibold text-[var(--foreground)] tabular-nums">{e._count.expertEvaluations}</td>
                    <td className="text-center">
                      {e.avgGrade ? (
                        <div className="flex items-center justify-center gap-1.5" title={`平均评价等级 ${e.avgGrade}（${LEVEL_LABEL[e.avgGrade] ?? ''}）`}>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[e.avgGrade] ?? 'var(--muted-foreground)' }}>{e.avgGrade}</span>
                          <span className="text-[11px] text-[var(--muted-foreground)]">{LEVEL_LABEL[e.avgGrade] ?? '—'}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {e.latestEval ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[e.latestEval.level] ?? 'var(--muted-foreground)' }}>{e.latestEval.level}</span>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                    <td className="text-center" title={e.expertProfile?.statusNote ?? undefined}>
                      {(() => {
                        const es = (e.expertProfile?.entryStatus ?? 'ACTIVE');
                        if (es === 'PENDING') return <StatusBadge tone="orange">待审核</StatusBadge>;
                        if (es === 'SUSPENDED') return <StatusBadge tone="gray">暂停</StatusBadge>;
                        if (es === 'RETIRED') return <StatusBadge tone="red">已退库</StatusBadge>;
                        return <StatusBadge tone="green">在库</StatusBadge>;
                      })()}
                    </td>
                    <td className="text-center">{!e.isActive ? <StatusBadge tone="gray">已停用</StatusBadge> : e.expertProfile?.availability === '占用' ? <StatusBadge tone="orange">评审中</StatusBadge> : e.expertProfile?.availability === '停用' ? <StatusBadge tone="gray">已停用</StatusBadge> : <StatusBadge tone="green">可用</StatusBadge>}</td>
                    <td onClick={e => e.stopPropagation()} className="text-center">
                      <div className="flex flex-nowrap justify-center gap-1 whitespace-nowrap">
                        <button onClick={() => setEvalTarget(e)} className="neu-btn-xs is-info">履职评价</button>
                        <button onClick={() => setConfirmToggle(e)} className={e.isActive ? 'neu-btn-xs is-warning' : 'neu-btn-xs is-success'}>{e.isActive ? '停用' : '启用'}</button>
                        {/* CTS A-218/222 入库状态操作（领导/管理员） */}
                        {(() => {
                          const es = (e.expertProfile?.entryStatus ?? 'ACTIVE');
                          if (es === 'PENDING') return <button onClick={() => void handleEntryStatus(e, 'ACTIVE')} className="neu-btn-xs is-success">审核入库</button>;
                          if (es === 'SUSPENDED') return <button onClick={() => void handleEntryStatus(e, 'ACTIVE')} className="neu-btn-xs is-success">恢复</button>;
                          if (es === 'RETIRED') return <button onClick={() => void handleEntryStatus(e, 'ACTIVE')} className="neu-btn-xs is-success">恢复入库</button>;
                          return (
                            <>
                              <button onClick={() => void handleEntryStatus(e, 'SUSPENDED')} className="neu-btn-xs is-warning">暂停</button>
                              <button onClick={() => void handleEntryStatus(e, 'RETIRED')} className="neu-btn-xs is-danger">退库</button>
                            </>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {displayedExperts.length > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{total}</strong> 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30"><ChevronLeft size={14} /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {/* ══════ 启用/停用二次确认 ══════ */}
      {confirmToggle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => !toggling && setConfirmToggle(null)} />
          <div className="relative w-full max-w-[min(420px,92vw)] rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog" aria-modal="true">
            <div className="flex items-center gap-3">
              <div className="neu-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <AlertTriangle size={18} className={confirmToggle.isActive ? 'text-[var(--warning)]' : 'text-[var(--success)]'} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-[-0.02em] text-[var(--foreground)]">确认{confirmToggle.isActive ? '停用' : '启用'}专家 {confirmToggle.displayName}？</h3>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{confirmToggle.isActive ? '停用后该专家将无法参与新的评审抽取' : '启用后该专家可重新参与评审抽取，并清除退库标记'}</p>
              </div>
            </div>
            <hr className="wb-section-rule my-4" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmToggle(null)} disabled={toggling} className="neu-btn-soft h-[38px]">取消</button>
              <button onClick={doToggle} disabled={toggling} className={`neu-btn-primary !h-[38px]${confirmToggle.isActive ? ' is-danger' : ''}`}>{toggling ? '处理中...' : '确认'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ 批量操作二次确认 ══════ */}
      {confirmBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => !batchSaving && setConfirmBatch(false)} />
          <div className="relative w-full max-w-[min(420px,92vw)] rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog" aria-modal="true">
            <div className="flex items-center gap-3">
              <div className="neu-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <AlertTriangle size={18} className={batchAction === 'disable' ? 'text-[var(--warning)]' : 'text-[var(--success)]'} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-[-0.02em] text-[var(--foreground)]">确认{batchAction === 'enable' ? '批量启用' : '批量停用'} {selectedIds.size} 位专家？</h3>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {batchAction === 'disable' ? `停用后这 ${selectedIds.size} 位专家将无法参与新的评审抽取` : `启用后这 ${selectedIds.size} 位专家可重新参与评审抽取`}
                  {batchAction === 'disable' && batchReason.trim() ? ` · 停用原因：${batchReason.trim()}` : ''}
                </p>
              </div>
            </div>
            <hr className="wb-section-rule my-4" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmBatch(false)} disabled={batchSaving} className="neu-btn-soft h-[38px]">取消</button>
              <button onClick={doBatch} disabled={batchSaving} className={`neu-btn-primary !h-[38px]${batchAction === 'disable' ? ' is-danger' : ''}`}>{batchSaving ? '处理中...' : '确认执行'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ 评价弹窗 ══════ */}
      <ExpertEvaluationDialog expert={evalTarget} onClose={() => setEvalTarget(null)} onSubmitted={load} />

      {/* ══════ 录入专家弹窗 ══════ */}
      <ExpertEntryDialog open={showEntryModal} onClose={() => setShowEntryModal(false)} onSubmitted={load} />
    </div>
  );
}
