'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getSupplierList, getSupplierStats, getClassifications,
  updateSupplierStatus, createClassification, updateClassification, deleteClassification,
  toggleFavorite, getFavorites,
} from '@/lib/api/supplier';
import type { Supplier, SupplierClassification, SupplierListResponse } from '@/lib/types';
import { StatusBadge, TableSkeleton, Modal } from '@/components/workbench';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';
import { Building2, Layers, Search, Plus, RefreshCw, X, ChevronUp, ChevronDown, ChevronsUpDown, Star, FileSpreadsheet, Check, Activity, AlertTriangle, Trash2 } from 'lucide-react';
import { exportSuppliersToExcel } from '@/lib/excel-export';

export default function SupplierRepositoryPage() {
  const router = useRouter();
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, disabled: 0, blacklist: 0 });
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [loading, setLoading] = useState(true);

  const [sortMode, setSortMode] = useState<'completeness' | 'createdAt'>('completeness');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClassification, setFilterClassification] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advEnterpriseTypes, setAdvEnterpriseTypes] = useState<string[]>([]);
  const [advDateFrom, setAdvDateFrom] = useState('');
  const [advDateTo, setAdvDateTo] = useState('');
  const [advEvalLevel, setAdvEvalLevel] = useState('');
  const [advQualStatus, setAdvQualStatus] = useState('');

  const ENTERPRISE_TYPES = ['有限责任公司','股份有限公司','国有企业','集体企业','合伙企业','个人独资企业','外商投资企业','其他'];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchModal, setBatchModal] = useState<{ type: 'DISABLED' | 'BLACKLIST' } | null>(null);
  const [batchReason, setBatchReason] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === sortedItems.length) setSelected(new Set());
    else setSelected(new Set(sortedItems.map(s => (s as Supplier).id)));
  };
  const handleBatch = async () => {
    if (!batchModal || !batchReason.trim()) { toast.error('请填写原因'); return; }
    setBatchLoading(true); let done = 0;
    for (const id of selected) { try { await updateSupplierStatus(id, batchModal.type, batchReason); done++; } catch {} }
    toast.success(`已批量${batchModal.type === 'DISABLED' ? '停用' : '拉黑'} ${done} 个供应商`);
    setBatchModal(null); setBatchReason(''); setSelected(new Set()); setBatchLoading(false); loadData();
  };

  const handleToggleFav = async (supplierId: string) => {
    try {
      const res = await toggleFavorite(supplierId);
      setFavIds(prev => { const n = new Set(prev); res.favorited ? n.add(supplierId) : n.delete(supplierId); return n; });
    } catch {}
  };

  const [statusModal, setStatusModal] = useState<{ type: 'disable' | 'blacklist'; supplier: Supplier } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);

  const [showClassMgr, setShowClassMgr] = useState(false);
  const [editClass, setEditClass] = useState<SupplierClassification | null>(null);
  const [classForm, setClassForm] = useState({ name: '', code: '', description: '' });
  const [classSaving, setClassSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        status: filterStatus || undefined,
        classificationId: filterClassification || undefined,
        search: search || undefined, page, pageSize, sort: sortMode,
      };
      if (advEnterpriseTypes.length > 0) params.enterpriseTypes = advEnterpriseTypes.join(',');
      if (advDateFrom) params.dateFrom = advDateFrom;
      if (advDateTo) params.dateTo = advDateTo;
      if (advEvalLevel) params.evalLevel = advEvalLevel;
      if (advQualStatus) params.qualificationStatus = advQualStatus;
      const res = await getSupplierList(params);
      setData(res);
    } catch {}
    setLoading(false);
  }, [filterStatus, filterClassification, search, page, pageSize, sortMode, advEnterpriseTypes, advDateFrom, advDateTo, advEvalLevel, advQualStatus]);

  const refreshMeta = useCallback(() => {
    getSupplierStats().then(setStats).catch(() => {});
    getClassifications().then(setClassifications).catch(() => {});
    getFavorites().then(fs => setFavIds(new Set(fs.map(f => f.supplierId)))).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { refreshMeta(); }, [refreshMeta, data.total]);
  const { sortKey, sortDir, toggle, sorted } = useSort<Supplier>('createdAt', 'desc');
  const sortedItems = sorted(data.items);
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  const handleStatusAction = async () => {
    if (!statusModal || !statusReason.trim()) { toast.error('请填写原因'); return; }
    setStatusLoading(true);
    try {
      await updateSupplierStatus(statusModal.supplier.id, statusModal.type.toUpperCase() as 'DISABLED' | 'BLACKLIST', statusReason);
      toast.success(statusModal.type === 'disable' ? '已停用' : '已加入黑名单');
      setStatusModal(null); setStatusReason(''); loadData();
    } catch (e: any) { toast.error(e?.message || '操作失败'); }
    setStatusLoading(false);
  };

  const openClassEditor = (c: SupplierClassification | null) => {
    setEditClass(c);
    setClassForm(c ? { name: c.name, code: c.code, description: c.description || '' } : { name: '', code: '', description: '' });
  };
  const saveClass = async () => {
    if (!classForm.name.trim() || !classForm.code.trim()) { toast.error('请填写分类名称和代码'); return; }
    setClassSaving(true);
    try {
      if (editClass) { await updateClassification(editClass.id, classForm); toast.success('分类已更新'); }
      else { await createClassification(classForm); toast.success('分类已创建'); }
      openClassEditor(null); refreshMeta();
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
    setClassSaving(false);
  };
  const removeClass = async (c: SupplierClassification) => {
    if (!confirm(`确认删除分类「${c.name}」？`)) return;
    try { await deleteClassification(c.id); toast.success('分类已删除'); refreshMeta(); } catch (e: any) { toast.error(e?.message || '删除失败'); }
  };

  const STATUS_TABS = [
    { label: '全部', status: '' },
    { label: '已入库', status: 'APPROVED', tone: 'green' as const },
    { label: '待审核', status: 'PENDING', tone: 'blue' as const },
    { label: '退回补正', status: 'RETURNED', tone: 'orange' as const },
    { label: '已停用', status: 'DISABLED', tone: 'gray' as const },
    { label: '黑名单', status: 'BLACKLIST', tone: 'red' as const },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Building2 size={17} /></div>
            <div>
              <div className="page-hero__title">供应商库</div>
              <div className="page-hero__sub">全量供应商目录、分类管理与状态维护</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/supplier/dashboard')} className="neu-btn-soft"><Activity size={15} />总览</button>
            <button onClick={() => router.push('/supplier/qualification-alerts')} className="neu-btn-soft"><AlertTriangle size={15} />资质预警</button>
            <button onClick={() => router.push('/supplier/elimination')} className="neu-btn-soft"><Trash2 size={15} />淘汰候选</button>
            <button onClick={loadData} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">供应商总数</span>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{stats.total}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">全量入库</span>
          </div>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">已入库</span>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{stats.approved}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">正常运营</span>
          </div>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">待审核</span>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{stats.pending}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">新注册申请</span>
          </div>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">已停用</span>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{stats.disabled}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">状态冻结</span>
          </div>
        </div>
        </div>
      </div>

      {/* ══════ 分类管理面板 ══════ */}
      {showClassMgr && (
        <div className="neu-table-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black text-[var(--foreground)]">业务分类管理</h2>
            <button onClick={() => openClassEditor(null)} className="neu-btn-soft"><Plus size={13} />新增分类</button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {classifications.map(c => (
              <div key={c.id} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[var(--foreground)]">{c.name}</span>
                  <span className="neu-tab-count">{c._count?.suppliers ?? 0}</span>
                </div>
                <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{c.code}</span>
                {c.description && <span className="text-[10px] text-[var(--muted-foreground)] line-clamp-2">{c.description}</span>}
                <div className="mt-1 flex gap-2">
                  <button onClick={() => openClassEditor(c)} className="neu-btn-xs">编辑</button>
                  <button onClick={() => removeClass(c)} className="neu-btn-xs is-danger">删除</button>
                </div>
              </div>
            ))}
          </div>
          {(editClass || classForm.name || classForm.code) && (
            <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.75rem" }}>
              <h3 className="text-sm font-black text-[var(--foreground)] mb-3">{editClass ? '编辑分类' : '新增分类'}</h3>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <input value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} placeholder="分类名称" className="neu-input text-sm" />
                <input value={classForm.code} onChange={e => setClassForm({ ...classForm, code: e.target.value })} placeholder="分类代码" className="neu-input text-sm font-mono" />
                <input value={classForm.description} onChange={e => setClassForm({ ...classForm, description: e.target.value })} placeholder="描述（可选）" className="neu-input text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveClass} disabled={classSaving} className="neu-btn-soft">{classSaving ? '保存中...' : '保存'}</button>
                <button onClick={() => openClassEditor(null)} className="neu-btn-soft">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════ 工具栏卡片 ══════ */}
      <div className="wb-toolbar">
        <div className="neu-tab-bar">
          {STATUS_TABS.map(t => (
            <button key={t.status} onClick={() => { setFilterStatus(t.status); setPage(1); }} className={`neu-tab ${filterStatus === t.status ? 'is-active' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索企业名称 / 信用代码" className="neu-input !pl-9" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10"><X size={14} /></button>}
        </div>
        <select value={filterClassification} onChange={e => { setFilterClassification(e.target.value); setPage(1); }} className="workbench-input !w-auto min-w-[110px]">
          <option value="">全部分类</option>
          {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterClassification(''); setAdvEnterpriseTypes([]); setAdvDateFrom(''); setAdvDateTo(''); setAdvEvalLevel(''); setAdvQualStatus(''); setPage(1); }} className="neu-btn-xs">重置</button>
        <button onClick={() => router.push('/supplier/approval')} className="neu-btn-xs gap-1">供应商审批</button>
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="neu-btn-xs gap-1 text-[var(--muted-foreground)]">{showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}高级筛选</button>
        <button onClick={() => setShowClassMgr(v => !v)} className="neu-btn-xs gap-1">{showClassMgr ? '收起分类' : '分类管理'}</button>
        <button onClick={() => exportSuppliersToExcel(data.items)} className="neu-btn-xs gap-1"><FileSpreadsheet size={12} />导出 Excel</button>
      </div>

      {showAdvanced && (
        <div className="wb-toolbar !gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--muted-foreground)]/70 mr-1">企业类型：</span>
            {ENTERPRISE_TYPES.map(t => (
              <button key={t} onClick={() => setAdvEnterpriseTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                className={`neu-tab text-[11px] !px-2 !py-1 ${advEnterpriseTypes.includes(t) ? 'is-active' : ''}`}>{t}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            入库时间：<input type="date" value={advDateFrom} onChange={e => setAdvDateFrom(e.target.value)} className="neu-input !h-7 !text-[11px] !w-auto !px-2" /> ~ <input type="date" value={advDateTo} onChange={e => setAdvDateTo(e.target.value)} className="neu-input !h-7 !text-[11px] !w-auto !px-2" />
          </div>
          <select value={advEvalLevel} onChange={e => setAdvEvalLevel(e.target.value)} className="workbench-input !w-auto !h-7 !text-[11px]">
            <option value="">评价等级</option>
            {['A','B','C','D'].map(l => <option key={l} value={l}>{l} 级</option>)}
          </select>
          <select value={advQualStatus} onChange={e => setAdvQualStatus(e.target.value)} className="workbench-input !w-auto !h-7 !text-[11px]">
            <option value="">资质状态</option>
            <option value="有效">有效</option>
            <option value="即将过期">即将过期</option>
            <option value="已过期">已过期</option>
          </select>
        </div>
      )}

      {/* ══════ 数据表格 ══════ */}
      <div className="neu-table-card">
        {selected.size > 0 && (
          <div className="neu-batch-bar">
            <span className="neu-batch-bar-count">已选 <strong>{selected.size}</strong> 条</span>
            <div className="neu-batch-bar-spacer" />
            <button onClick={() => { setBatchReason(''); setBatchModal({ type: 'DISABLED' }); }} className="neu-btn-xs is-warning">批量停用</button>
            <button onClick={() => { setBatchReason(''); setBatchModal({ type: 'BLACKLIST' }); }} className="neu-btn-xs is-danger">批量拉黑</button>
            <button onClick={() => setSelected(new Set())} className="neu-btn-xs"><X size={12} />取消选择</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[780px]">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" className="neu-checkbox" checked={selected.size > 0 && selected.size === sortedItems.length} ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < sortedItems.length; }} onChange={toggleAll} /></th>
                <SortableTh label="企业名称" field="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <th className="text-center">统一社会信用代码</th>
                <SortableTh label="企业类型" field="enterpriseType" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <th className="text-center">状态</th>
                <th className="text-center">分类</th>
                <SortableTh label="入库时间" field="createdAt" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={8} rows={5} />
              ) : sortedItems.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><Building2 size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无供应商数据</p>
                  </div>
                </td></tr>
              ) : sortedItems.map((s: Supplier) => {
                const statusTone = s.status === 'APPROVED' ? 'green' : s.status === 'PENDING' ? 'blue' : s.status === 'RETURNED' ? 'orange' : s.status === 'DISABLED' ? 'gray' : s.status === 'BLACKLIST' ? 'red' : 'gray';
                const statusLabel = s.status === 'APPROVED' ? '已入库' : s.status === 'PENDING' ? '待审核' : s.status === 'RETURNED' ? '退回补正' : s.status === 'DISABLED' ? '已停用' : s.status === 'BLACKLIST' ? '黑名单' : s.status;
                return (
                  <tr key={s.id} className="row-clickable" onClick={() => router.push(`/supplier/${s.id}`)}>
                    <td onClick={e => e.stopPropagation()} className="pl-3">
                      <input type="checkbox" className="neu-checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{s.name[0]}</div>
                        <span className="text-sm font-bold text-[var(--foreground)] truncate hover:text-[var(--accent)] transition-colors">{s.name}</span>
                        <button onClick={e => { e.stopPropagation(); handleToggleFav(s.id); }} className="text-[var(--muted-foreground)]/30 hover:text-[var(--warning)] transition" title={favIds.has(s.id) ? '取消收藏' : '收藏'}>
                          <Star size={13} fill={favIds.has(s.id) ? 'var(--warning)' : 'none'} stroke={favIds.has(s.id) ? 'var(--warning)' : 'currentColor'} />
                        </button>
                      </div>
                    </td>
                    <td className="text-center font-mono text-xs text-[var(--muted-foreground)]">{s.creditCode || '—'}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{s.enterpriseType || '—'}</td>
                    <td className="text-center"><StatusBadge tone={statusTone}>{statusLabel}</StatusBadge></td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{s.classification?.name || '—'}</td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex flex-wrap justify-center gap-1">
                        <button onClick={() => router.push(`/supplier/${s.id}`)} className="neu-btn-xs is-info">详情</button>
                        {s.status === 'APPROVED' && (
                          <>
                            <button onClick={() => { setStatusReason(''); setStatusModal({ type: 'disable', supplier: s }); }} className="neu-btn-xs is-warning">停用</button>
                            <button onClick={() => { setStatusReason(''); setStatusModal({ type: 'blacklist', supplier: s }); }} className="neu-btn-xs is-danger">黑名单</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.total > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{data.total}</strong> 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-[-90deg]" /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-90" /></button>
            </div>
          </div>
        )}
      </div>

      {/* ══════ 批量操作弹窗 ══════ */}
      {batchModal && (
        <Modal
          open
          onClose={() => setBatchModal(null)}
          title={batchModal.type === 'DISABLED' ? '批量停用' : '批量拉黑'}
          description={<>将对选中的 <strong>{selected.size}</strong> 个供应商统一处理</>}
          footer={
            <>
              <button onClick={() => setBatchModal(null)} className="neu-btn-soft">取消</button>
              <button onClick={handleBatch} disabled={batchLoading || !batchReason.trim()} className={`neu-btn-soft ${batchModal.type === 'DISABLED' ? 'is-warning' : 'is-danger'}`}>{batchLoading ? '处理中...' : '确认'}</button>
            </>
          }
        >
          <textarea value={batchReason} onChange={e => setBatchReason(e.target.value)} placeholder="请填写原因..." className="neu-input w-full h-24 resize-none text-sm" />
        </Modal>
      )}

      {/* ══════ 状态变更弹窗 ══════ */}
      {statusModal && (
        <Modal
          open
          onClose={() => setStatusModal(null)}
          title={statusModal.type === 'disable' ? '停用供应商' : '加入黑名单'}
          description={<>供应商：<strong className="text-[var(--foreground)]">{statusModal.supplier.name}</strong></>}
          footer={
            <>
              <button onClick={() => setStatusModal(null)} className="neu-btn-soft">取消</button>
              <button onClick={handleStatusAction} disabled={statusLoading || !statusReason.trim()} className="neu-btn-soft is-danger">{statusLoading ? '处理中...' : '确认'}</button>
            </>
          }
        >
          <textarea value={statusReason} onChange={e => setStatusReason(e.target.value)} placeholder="请填写原因..." className="neu-input w-full h-24 resize-none text-sm" />
        </Modal>
      )}
    </div>
  );
}
