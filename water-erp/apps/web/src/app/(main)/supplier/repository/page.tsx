'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getSupplierList, getSupplierStats,
  updateSupplierStatus,
  toggleFavorite, getFavorites,
  listInvitations, createInvitation, revokeInvitation,
  importSuppliers, getImportTemplateUrl,
} from '@/lib/api/supplier';
import type { Supplier, SupplierListResponse } from '@/lib/types';
import type { SupplierInvitation } from '@/lib/api/supplier';
import { StatusBadge, TableSkeleton, Modal } from '@/components/workbench';
import { SupplierEvaluationDialog } from '@/components/supplier/supplier-evaluation-dialog';
import { ClassificationManagerDialog } from '@/components/supplier/classification-manager-dialog';
import { Building2, Search, Plus, RefreshCw, X, ChevronUp, ChevronDown, Star, FileSpreadsheet, Check, Activity, AlertTriangle, Trash2, Key, Copy, Ban, Tags, Upload, Download, Loader2 } from 'lucide-react';
import { exportSuppliersToExcel } from '@/lib/excel-export';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import { LEVEL_LABEL, LEVEL_COLOR } from '@water-erp/shared';

export default function SupplierRepositoryPage() {
  const router = useRouter();
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, disabled: 0, blacklist: 0, returned: 0, temporaryApproved: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const [sortMode, setSortMode] = useState<'completeness' | 'createdAt'>('completeness');
  const [filterStatus, setFilterStatus] = useState('APPROVED');
  // 临时供应商子视图：与 filterStatus='APPROVED' 叠加，仅看凭邀请码注册的临时入库供应商。
  const [filterIsTemporary, setFilterIsTemporary] = useState(false);
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

  const [favFilter, setFavFilter] = useState(false);

  // 状态标签定义须先于 loadData 声明（loadData 用到 effectiveStatus，避免 TDZ）。
  // key 为唯一标识（已入库/临时供应商同为 APPROVED，须靠 key+isTemporary 区分激活态）。
  const STATUS_TABS: { key: string; label: string; status: string; isTemporary?: boolean; tone?: string; count?: number; badge?: 'danger' | 'warning' }[] = [
    { key: 'APPROVED', label: '已入库', status: 'APPROVED', tone: 'green' },
    { key: 'TEMPORARY', label: '临时供应商', status: 'APPROVED', isTemporary: true, tone: 'teal', count: stats.temporaryApproved, badge: 'warning' as const },
    { key: 'PENDING', label: '待审核', status: 'PENDING', tone: 'blue', count: stats.pending, badge: 'danger' as const },
    { key: 'RETURNED', label: '退回补正', status: 'RETURNED', tone: 'orange', count: stats.returned, badge: 'warning' as const },
    { key: 'DISABLED', label: '已停用', status: 'DISABLED', tone: 'gray' },
    { key: 'BLACKLIST', label: '黑名单', status: 'BLACKLIST', tone: 'red' },
  ];
  const effectiveStatus = filterStatus;
  const activeTabKey = filterIsTemporary ? 'TEMPORARY' : filterStatus;

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === displayItems.length) setSelected(new Set());
    else setSelected(new Set(displayItems.map(s => s.id)));
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
  // 评价弹窗（由操作列「评价」按钮触发）
  const [evalTarget, setEvalTarget] = useState<Supplier | null>(null);
  // 分类管理弹窗
  const [showClassMgr, setShowClassMgr] = useState(false);

  // ── 临时供应商邀请码（采购端生成，有效期 30/180/360 天）──
  const [invitations, setInvitations] = useState<SupplierInvitation[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invForm, setInvForm] = useState({ validityDays: 180, note: '', boundCreditCode: '' });
  const [invCreating, setInvCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [invModalOpen, setInvModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ total: number; created: number; skipped: number; errors: string[] } | null>(null);
  const INV_STATUS_META: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: '可用', cls: 'text-[var(--success)] bg-[color-mix(in_oklch,var(--success)_14%,transparent)]' },
    USED: { label: '已使用', cls: 'text-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_14%,transparent)]' },
    EXPIRED: { label: '已过期', cls: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--muted-foreground)_14%,transparent)]' },
    REVOKED: { label: '已作废', cls: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_14%,transparent)]' },
  };
  const loadInvitations = useCallback(async () => {
    setInvLoading(true);
    try { const res = await listInvitations({ pageSize: 50 }); setInvitations(res.items); }
    catch { toast.error('邀请码加载失败'); }
    finally { setInvLoading(false); }
  }, []);
  useEffect(() => { loadInvitations(); }, [loadInvitations]);
  const handleCreateInvitation = async () => {
    setInvCreating(true);
    try {
      await createInvitation({ validityDays: invForm.validityDays, note: invForm.note.trim() || undefined, boundCreditCode: invForm.boundCreditCode.trim() || undefined });
      toast.success('邀请码已生成');
      setInvForm(f => ({ validityDays: f.validityDays, note: '', boundCreditCode: '' }));
      await loadInvitations();
    } catch (e: any) { toast.error(e?.message || '生成失败'); }
    finally { setInvCreating(false); }
  };
  const handleRevokeInvitation = async (id: string) => {
    if (!confirm('确定作废此邀请码？未使用的将无法再用于注册。')) return;
    try { await revokeInvitation(id); toast.success('已作废'); await loadInvitations(); }
    catch { toast.error('作废失败'); }
  };
  const copyCode = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setCopiedCode(code); setTimeout(() => setCopiedCode(null), 1500); } catch {}
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = {
        status: effectiveStatus ?? undefined,
        search: search || undefined, page, pageSize, sort: sortMode,
      };
      if (filterIsTemporary) params.isTemporary = true;
      if (advEnterpriseTypes.length > 0) params.enterpriseTypes = advEnterpriseTypes.join(',');
      if (advDateFrom) params.dateFrom = advDateFrom;
      if (advDateTo) params.dateTo = advDateTo;
      if (advEvalLevel) params.evalLevel = advEvalLevel;
      if (advQualStatus) params.qualificationStatus = advQualStatus;
      const res = await getSupplierList(params);
      setData(res);
    } catch (e: any) {
      // B13：区分「真空」与「接口挂掉」——失败时显示错误态+重试，而非静默显示空表。
      setError(e?.message || '供应商列表加载失败');
    }
    setLoading(false);
  }, [effectiveStatus, filterStatus, filterIsTemporary, search, page, pageSize, sortMode, advEnterpriseTypes, advDateFrom, advDateTo, advEvalLevel, advQualStatus]);

  const refreshMeta = useCallback(() => {
    getSupplierStats().then(setStats).catch(() => {});
    getFavorites().then(fs => setFavIds(new Set(fs.map(f => f.supplierId)))).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { refreshMeta(); }, [refreshMeta, data.total]);
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  // 收藏筛选：在前端对当前页数据做过滤
  const displayItems = favFilter ? data.items.filter(s => favIds.has(s.id)) : data.items;

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

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Building2 size={17} /></div>
            <div>
              <div className="page-hero__title">供应商库</div>
              <div className="page-hero__sub">全量供应商目录与状态维护</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/supplier/dashboard')} className="neu-btn-soft"><Activity size={15} />总览</button>
            <button onClick={() => router.push('/supplier/qualification-alerts')} className="neu-btn-soft"><AlertTriangle size={15} />资质预警</button>
            <button onClick={() => router.push('/supplier/elimination')} className="neu-btn-soft"><Trash2 size={15} />淘汰候选</button>
            <button onClick={() => setInvModalOpen(true)} className="neu-btn-soft"><Key size={15} />邀请码</button>
            <button onClick={loadData} disabled={loading} className="neu-btn-xs" aria-label="刷新"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
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
          <button type="button" onClick={() => { setFilterStatus('PENDING'); setFilterIsTemporary(false); setPage(1); }} title="查看待审核供应商" className="kpi-card group flex h-full flex-col gap-1.5 p-3 text-left cursor-pointer w-full">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">待审核</span>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{stats.pending}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">新注册申请 · 点击查看</span>
          </button>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">已停用</span>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{stats.disabled}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">状态冻结</span>
          </div>
        </div>
        </div>
      </div>

      {/* ══════ 临时供应商邀请码弹窗（标题栏「邀请码」按钮触发）══════ */}
      {invModalOpen && (
        <Modal open onClose={() => setInvModalOpen(false)} title="临时供应商邀请码" size="2xl" footer={<span className="text-xs text-[var(--muted-foreground)]">凭码注册的供应商在有效期内可登录，到期自动失效；同样需审核</span>}>
        {/* 生成区 */}
        <div className="flex flex-wrap items-end gap-3 pb-4 mb-3" style={{ boxShadow: 'inset 0 -1px 0 var(--hairline)' }}>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">有效期</span>
            <div className="neu-tab-bar">
              {[{ d: 30, l: '30 天' }, { d: 180, l: '180 天' }, { d: 360, l: '360 天' }].map(opt => (
                <button key={opt.d} className={`neu-tab ${invForm.validityDays === opt.d ? 'is-active' : ''}`} onClick={() => setInvForm(f => ({ ...f, validityDays: opt.d }))}>{opt.l}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">备注（选填）</span>
            <input className="workbench-input" placeholder="如：XX 项目临时供应商" value={invForm.note} onChange={e => setInvForm(f => ({ ...f, note: e.target.value }))} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">绑定信用代码（选填）</span>
            <input className="workbench-input" placeholder="指定企业可用，留空则任意企业" value={invForm.boundCreditCode} onChange={e => setInvForm(f => ({ ...f, boundCreditCode: e.target.value.toUpperCase() }))} maxLength={18} />
          </div>
          <button onClick={handleCreateInvitation} disabled={invCreating} className="neu-btn-primary !h-[40px]">
            <Plus size={14} />{invCreating ? '生成中…' : '生成邀请码'}
          </button>
          <button onClick={loadInvitations} disabled={invLoading} className="neu-btn-xs mb-[2px]" title="刷新列表">
            <RefreshCw size={13} className={invLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {/* 列表 */}
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[760px]">
            <thead>
              <tr>
                <th>邀请码</th><th>有效期</th><th>状态</th><th>创建人</th><th>使用者</th><th>创建时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {invitations.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-[var(--muted-foreground)] py-10">暂无邀请码，选择有效期后点击「生成邀请码」</td></tr>
              ) : invitations.map(inv => (
                <tr key={inv.id}>
                  <td>
                    <button onClick={() => copyCode(inv.code)} title="点击复制" className="font-mono font-bold tracking-wider text-[var(--accent)] inline-flex items-center gap-1.5">
                      {inv.code.slice(0, 4)}-{inv.code.slice(4)}
                      {copiedCode === inv.code ? <Check size={12} className="text-[var(--success)]" /> : <Copy size={12} className="opacity-50" />}
                    </button>
                  </td>
                  <td className="tabular-nums">
                    {inv.validityDays} 天
                    <div className="text-[10px] text-[var(--muted-foreground)]">至 {new Date(inv.expiresAt).toLocaleDateString()}</div>
                  </td>
                  <td>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${INV_STATUS_META[inv.status]?.cls || ''}`}>
                      {INV_STATUS_META[inv.status]?.label || inv.status}
                    </span>
                  </td>
                  <td>{inv.createdBy?.displayName || '—'}</td>
                  <td>{inv.usedBy?.name || '—'}</td>
                  <td className="tabular-nums text-[var(--muted-foreground)]">{new Date(inv.createdAt).toLocaleString()}</td>
                  <td>
                    {inv.status === 'ACTIVE' && (
                      <button onClick={() => handleRevokeInvitation(inv.id)} className="neu-btn-xs is-danger"><Ban size={12} />作废</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Modal>
      )}

      {/* B13 错误态：接口失败时明确提示+重试，避免与「真空」混淆 */}
      {error && !loading && (
        <div className="neu-card-static !rounded-2xl p-4 flex items-center gap-3" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)' }}>
          <AlertTriangle size={16} className="text-[var(--danger)] shrink-0" />
          <span className="text-sm text-[var(--foreground)] flex-1">加载失败：{error}</span>
          <button onClick={loadData} className="neu-btn-xs gap-1"><RefreshCw size={12} />重试</button>
        </div>
      )}

      {/* ══════ 工具栏卡片 ══════ */}
      <div className="wb-toolbar">
        <div className="neu-tab-bar">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => { setFilterStatus(t.status); setFilterIsTemporary(!!t.isTemporary); setPage(1); }} className={`neu-tab ${activeTabKey === t.key ? 'is-active' : ''}`}>
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums leading-none text-white bg-[var(--danger)] data-[tone=warning]:bg-[var(--warning)]" data-tone={t.badge}>{t.count}</span>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索企业名称 / 信用代码" className="neu-input !pl-9" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10"><X size={14} /></button>}
        </div>
        <button onClick={() => { setSearch(''); setAdvEnterpriseTypes([]); setAdvDateFrom(''); setAdvDateTo(''); setAdvEvalLevel(''); setAdvQualStatus(''); setPage(1); }} className="neu-btn-xs" title="清空搜索与筛选条件（保留当前状态标签）">重置筛选</button>

        <button
          onClick={() => setFavFilter(f => !f)}
          className={`neu-btn-xs gap-1 ${favFilter ? 'is-active' : ''}`}
          title={favFilter ? '显示全部（取消收藏筛选）' : '仅显示收藏'}
        >
          <Star size={12} fill={favFilter ? 'var(--warning)' : 'none'} stroke={favFilter ? 'var(--warning)' : 'currentColor'} />
          {favFilter ? '收藏中' : '收藏'}
        </button>
        <button onClick={() => { setImportModalOpen(true); setImportFile(null); setImportResult(null); }} className="neu-btn-xs gap-1"><Upload size={12} />导入</button>
        <button onClick={() => setShowClassMgr(true)} className="neu-btn-xs gap-1"><Tags size={12} />分类管理</button>
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="neu-btn-xs gap-1 text-[var(--muted-foreground)]">{showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}高级筛选</button>
        <button onClick={() => exportSuppliersToExcel(data.items)} title="导出当前筛选结果" className="neu-btn-xs gap-1"><FileSpreadsheet size={12} />导出 Excel</button>
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
            {['A','B','C','D','E'].map(l => <option key={l} value={l}>{l} 级</option>)}
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
                <th style={{ width: 36 }}><input type="checkbox" className="neu-checkbox" checked={selected.size > 0 && selected.size === displayItems.length} ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < displayItems.length; }} onChange={toggleAll} /></th>
                <th style={{ width: 100 }}>企业名称</th>
                <th className="text-center" style={{ width: 160 }}>统一社会信用代码</th>
                <th style={{ width: 140 }}>企业类型</th>
                <th className="text-center" style={{ width: 84 }}>评价次数</th>
                <th className="text-center" style={{ width: 96 }}>平均等级</th>
                <th className="text-center" style={{ width: 96 }}>最近评价</th>
                <th className="text-center" style={{ width: 96 }}>入库时间</th>
                <th className="text-center" style={{ width: 100 }}>状态</th>
                <th className="text-center" style={{ width: 240 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={10} rows={5} />
              ) : displayItems.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><Building2 size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无供应商数据</p>
                  </div>
                </td></tr>
              ) : displayItems.map((s: Supplier) => {
                const statusTone = s.status === 'APPROVED' ? 'green' : s.status === 'PENDING' ? 'blue' : s.status === 'RETURNED' ? 'orange' : s.status === 'DISABLED' ? 'gray' : s.status === 'BLACKLIST' ? 'red' : 'gray';
                const statusLabel = s.status === 'APPROVED' ? '已入库' : s.status === 'PENDING' ? '待审核' : s.status === 'RETURNED' ? '退回补正' : s.status === 'DISABLED' ? '已停用' : s.status === 'BLACKLIST' ? '黑名单' : s.status;
                return (
                  <tr key={s.id} className="row-clickable" onClick={() => router.push(`/supplier/${s.id}`)}>
                    <td onClick={e => e.stopPropagation()} className="pl-3">
                      <input type="checkbox" className="neu-checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{s.name[0]}</div>
                        <span className="text-sm font-bold text-[var(--foreground)] truncate hover:text-[var(--accent)] transition-colors" title={s.name}>{s.name}</span>
                        <button onClick={e => { e.stopPropagation(); handleToggleFav(s.id); }} className="text-[var(--muted-foreground)]/30 hover:text-[var(--warning)] transition" title={favIds.has(s.id) ? '取消收藏' : '收藏'} aria-label={favIds.has(s.id) ? '取消收藏' : '收藏'}>
                          <Star size={13} fill={favIds.has(s.id) ? 'var(--warning)' : 'none'} stroke={favIds.has(s.id) ? 'var(--warning)' : 'currentColor'} />
                        </button>
                      </div>
                    </td>
                    <td className="text-center font-mono text-xs text-[var(--muted-foreground)] max-w-[160px] truncate" title={s.creditCode || ''}>{s.creditCode || '—'}</td>
                    <td className="text-sm text-[var(--muted-foreground)] max-w-[140px] truncate" title={s.enterpriseType || ''}>{normalizeEnterpriseType(s.enterpriseType)}</td>
                    <td className="text-center"><span className="neu-tab-count">{s._count?.evaluations ?? 0}</span></td>
                    <td className="text-center">
                      {s._avgGrade ? (
                        <div className="flex items-center justify-center gap-1.5" title={`平均评价等级 ${s._avgGrade}（${LEVEL_LABEL[s._avgGrade] ?? ''}）`}>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[s._avgGrade] ?? 'var(--muted-foreground)' }}>{s._avgGrade}</span>
                          <span className="text-[11px] text-[var(--muted-foreground)]">{LEVEL_LABEL[s._avgGrade] ?? '—'}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {s._latestEvalLevel ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[s._latestEvalLevel] ?? 'var(--muted-foreground)' }}>{s._latestEvalLevel}</span>
                      ) : (
                        <span className="text-sm text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                    <td className="text-center text-sm text-[var(--muted-foreground)]">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td className="text-center"><StatusBadge tone={statusTone}>{statusLabel}</StatusBadge></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex flex-nowrap justify-center gap-1 whitespace-nowrap">
                        {s.status === 'APPROVED' && (
                          <>
                            <button onClick={() => setEvalTarget(s)} className="neu-btn-xs is-info">评价</button>
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

      {/* ══════ 评价弹窗 ══════ */}
      <SupplierEvaluationDialog supplier={evalTarget} onClose={() => setEvalTarget(null)} onSubmitted={loadData} />
      <ClassificationManagerDialog open={showClassMgr} onClose={() => setShowClassMgr(false)} />

      {/* ══════ Excel 批量导入弹窗 ══════ */}
      {importModalOpen && (
        <Modal open onClose={() => { setImportModalOpen(false); setImportFile(null); setImportResult(null); }} title="批量导入供应商" size="md">
          {!importResult ? (
            <div className="space-y-4">
              <div className="text-sm text-[var(--muted-foreground)]">
                下载模板后按格式填写企业信息，上传即可批量创建为待审核供应商。
              </div>
              <a href={getImportTemplateUrl()} download className="neu-btn-xs gap-1 inline-flex"><Download size={13} />下载导入模板</a>
              <div className="neu-card-static !rounded-xl p-6 text-center border-2 border-dashed border-[var(--border)]">
                <Upload size={24} className="mx-auto mb-2 text-[var(--muted-foreground)]" />
                <label className="neu-btn-xs gap-1 cursor-pointer inline-flex">
                  <Plus size={12} />{importFile ? importFile.name : '选择 Excel 文件'}
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setImportFile(f);
                  }} />
                </label>
                <p className="text-[10px] text-[var(--muted-foreground)] mt-2">支持 .xlsx / .xls 格式，最大 10MB</p>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setImportModalOpen(false)} className="neu-btn-soft">取消</button>
                <button
                  onClick={async () => {
                    if (!importFile) { toast.error('请选择文件'); return; }
                    setImportLoading(true);
                    try {
                      const result = await importSuppliers(importFile);
                      setImportResult(result);
                      if (result.created > 0) { toast.success(`成功导入 ${result.created} 家供应商`); loadData(); refreshMeta(); }
                    } catch (e: any) { toast.error(e?.message || '导入失败'); }
                    setImportLoading(false);
                  }}
                  disabled={importLoading || !importFile}
                  className="neu-btn-primary"
                >
                  {importLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {importLoading ? '导入中...' : '开始导入'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="neu-card-static !rounded-xl p-3 text-center">
                  <p className="text-[10px] text-[var(--muted-foreground)]">总行数</p>
                  <p className="text-xl font-black tabular-nums text-[var(--foreground)]">{importResult.total}</p>
                </div>
                <div className="neu-card-static !rounded-xl p-3 text-center">
                  <p className="text-[10px] text-[var(--muted-foreground)]">成功导入</p>
                  <p className="text-xl font-black tabular-nums text-[var(--success)]">{importResult.created}</p>
                </div>
                <div className="neu-card-static !rounded-xl p-3 text-center">
                  <p className="text-[10px] text-[var(--muted-foreground)]">跳过/失败</p>
                  <p className="text-xl font-black tabular-nums text-[var(--warning)]">{importResult.skipped}</p>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="max-h-[200px] overflow-y-auto space-y-1 text-xs">
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-[var(--danger)]">{e}</p>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={() => { setImportModalOpen(false); setImportFile(null); setImportResult(null); }} className="neu-btn-soft">关闭</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
