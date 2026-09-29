'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { getSupplierList, approveSupplier, rejectSupplier, returnSupplier, reactivateSupplier, getClassifications, setSupplierClassifications } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import type { Supplier, SupplierListResponse } from '@/lib/types';
import { StatusBadge, TableSkeleton, Modal } from '@/components/workbench';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { AuthUser } from '@/lib/api/auth';
import { fetchCurrentUser } from '@/lib/api/auth';
import { Building2, Check, RefreshCw, Search, X, ChevronUp, ChevronDown, AlertTriangle, ShieldCheck, User } from 'lucide-react';

const TABS: { key: 'PENDING' | 'RETURNED' | 'REJECTED'; label: string; tone: 'blue' | 'orange' | 'red' }[] = [
  { key: 'PENDING', label: '待审核', tone: 'blue' },
  { key: 'RETURNED', label: '退回补正', tone: 'orange' },
  { key: 'REJECTED', label: '审核不通过', tone: 'red' },
];

function SupplierApprovalPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get('status') as typeof TABS[number]['key'] | null;
  const tab = (tabParam && TABS.some(t => t.key === tabParam)) ? tabParam : 'PENDING';
  const page = parseInt(params.get('page') || '1', 10) || 1;
  const pageSize = parseInt(params.get('pageSize') || '20', 10) || 20;
  const setTab = (t: typeof TABS[number]['key']) => { const q = new URLSearchParams(params); q.set('status', t); q.delete('page'); router.push(`?${q.toString()}`); };
  const setPage = (p: number) => { const q = new URLSearchParams(params); q.set('page', String(p)); router.push(`?${q.toString()}`); };
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [counts, setCounts] = useState<Record<string, number>>({ PENDING: 0, RETURNED: 0, REJECTED: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  // 注册审批仅管理权限账号（2026-09-24 用户裁定；后端 @Roles('admin') 已同步收紧）
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  useEffect(() => {
    fetchCurrentUser()
      .then(setCurrentUser)
      .catch(() => { /* 拿不到角色按非 admin 处理，后端守卫仍兜底 */ })
      .finally(() => setRoleReady(true));
  }, []);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchApproving, setBatchApproving] = useState(false);
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject' | 'return'; supplier: Supplier } | null>(null);
  const [actionReason, setActionReason] = useState('');
  // REJECTED 复活确认（仅 admin）
  const [reactivateTarget, setReactivateTarget] = useState<Supplier | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const handleReactivate = async () => {
    if (!reactivateTarget) return;
    setReactivating(true);
    try {
      await reactivateSupplier(reactivateTarget.id);
      toast.success(`已复活「${reactivateTarget.name}」的注册申请，重新进入待审核`);
      setReactivateTarget(null);
      loadData(); loadCounts();
    } catch (e: any) { toast.error(e?.message || '复活失败'); }
    setReactivating(false);
  };

  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); }, []);

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === data.items.length) setSelected(new Set());
    else setSelected(new Set(data.items.map(s => s.id)));
  };
  const allSelected = data.items.length > 0 && selected.size === data.items.length;
  const someSelected = !allSelected && selected.size > 0;

  const batchApprove = async () => {
    if (selected.size === 0) return;
    setBatchApproving(true);
    let done = 0; const failed: string[] = [];
    for (const id of selected) { try { await approveSupplier(id); done++; } catch { failed.push(id); } }
    // 暴露失败项，而非静默吞错只报成功数。
    if (failed.length > 0) toast.error(`${done} 个成功，${failed.length} 个失败（可能已被他人处理或状态变更），已自动刷新`);
    else toast.success(`已批量通过 ${done} 个供应商`);
    setSelected(new Set());
    setBatchApproving(false);
    setBatchApproveModal(false);
    loadData(); loadCounts();
  };

  const [batchModal, setBatchModal] = useState<{ type: 'return' | 'reject'; ids: Set<string> } | null>(null);
  const [batchApproveModal, setBatchApproveModal] = useState(false);
  const [batchReason, setBatchReason] = useState('');

  const executeBatchReturnReject = async () => {
    if (!batchModal || !batchReason.trim()) { toast.error('请填写原因'); return; }
    const { type, ids } = batchModal;
    let done = 0; const failed: string[] = [];
    for (const id of ids) {
      try {
        if (type === 'return') await returnSupplier(id, batchReason);
        else await rejectSupplier(id, batchReason);
        done++;
      } catch { failed.push(id); }
    }
    // 暴露失败项。
    if (failed.length > 0) toast.error(`${done} 个成功，${failed.length} 个失败（可能已被他人处理或状态变更），已自动刷新`);
    else toast.success(`已批量${type === 'return' ? '退回' : '拒绝'} ${done} 个供应商`);
    setBatchModal(null);
    setBatchReason('');
    setSelected(new Set());
    loadData(); loadCounts();
  };

  const loadCounts = useCallback(() => {
    Promise.all([
      getSupplierList({ status: 'PENDING', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'RETURNED', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'REJECTED', page: 1, pageSize: 1 }),
    ]).then(([p, r, j]) => setCounts({ PENDING: p.total, RETURNED: r.total, REJECTED: j.total })).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try { const res = await getSupplierList({ status: tab, page, pageSize, sort: 'completeness' }); setData(res); }
    catch (e: any) { setError(e?.message || '审批列表加载失败'); } // B13 错误态
    setLoading(false);
  }, [tab, page, pageSize]);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setSelected(new Set()); }, [tab, page]);

  const handleAction = async () => {
    if (!actionModal) return;
    if (actionModal.type !== 'approve' && !actionReason.trim()) { toast.error('请填写处理原因'); return; }
    const { type, supplier: s } = actionModal;
    const reason = actionReason;
    const label = type === 'approve' ? '已通过' : type === 'reject' ? '已拒绝' : '已退回补正';
    const prevItems = data.items;
    setData(d => ({ ...d, items: d.items.filter(x => (x as Supplier).id !== s.id) }));
    setActionModal(null);
    setActionReason('');
    toast.success(`${label}「${s.name}」`);
    try {
      if (type === 'approve') await approveSupplier(s.id);
      else if (type === 'reject') await rejectSupplier(s.id, reason);
      else if (type === 'return') await returnSupplier(s.id, reason);
    } catch (e: any) {
      toast.error(e?.message || '操作失败');
      setData(d => ({ ...d, items: prevItems }));
    }
    loadCounts();
  };

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const activeTab = TABS.find(t => t.key === tab)!;

  // 无审批权（既非归属公司管理账号）：就绪前渲染空态防闪现，就绪后给无权限卡
  // （2026-09-26 改定：审批=admin/leader/staff，与后端 @Roles('admin','leader','staff') 及
  // 详情页审批栏/供应商库待审 tab 同口径——旧"仅 admin"口径曾致 leader/staff 详情页能审、
  // 列表页却看不到队列的互相矛盾）
  if (!roleReady) return null;
  if (!['admin', 'leader', 'staff'].includes(currentUser?.role ?? '')) {
    return (
      <div className="neu-card-static flex flex-col items-center justify-center gap-3 p-14 text-center">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <ShieldCheck size={22} className="text-[var(--muted-foreground)]" />
        </div>
        <p className="text-sm font-bold text-[var(--foreground)]">供应商注册审批仅对管理权限账号开放</p>
        <p className="text-xs text-[var(--muted-foreground)]">新供应商的注册审批由归属公司管理账号处理，如有需要请联系管理员</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* page-hero — 标题卡片 */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <Building2 size={17} />
            </div>
            <div>
              <div className="page-hero__title">供应商审批</div>
              <div className="page-hero__sub">审核供应商注册申请，支持审核通过、退回补正和审核不通过</div>
            </div>
          </div>

          <div className="page-hero__right">
            <button onClick={loadData} disabled={loading} className="neu-btn-xs">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* hairline 分割线 + KPI 行 */}
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 items-stretch">
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2 min-h-[18px]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">待审核</span>
              {counts.PENDING > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--accent)]">
                  <span className="h-1 w-1 rounded-full shrink-0 bg-[var(--accent)]" />待处理
                </span>
              )}
            </div>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{counts.PENDING}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">新注册申请</span>
          </div>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2 min-h-[18px]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">退回补正</span>
              {counts.RETURNED > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] text-[var(--warning)]">
                  <span className="h-1 w-1 rounded-full shrink-0 bg-[var(--warning)]" />待补交
                </span>
              )}
            </div>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{counts.RETURNED}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">待补正修改</span>
          </div>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2 min-h-[18px]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">审核不通过</span>
            </div>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{counts.REJECTED}</span>
            <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">已拒绝归档</span>
          </div>
        </div>
        </div>
      </div>

      {/* B13 错误态 */}
      {error && !loading && (
        <div className="neu-card-static !rounded-2xl p-4 flex items-center gap-3" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)' }}>
          <AlertTriangle size={16} className="text-[var(--danger)] shrink-0" />
          <span className="text-sm text-[var(--foreground)] flex-1">加载失败：{error}</span>
          <button onClick={loadData} className="neu-btn-xs gap-1"><RefreshCw size={12} />重试</button>
        </div>
      )}

      {/* 工具栏卡片（tab + 搜索） */}
      <div className="wb-toolbar">
        <div className="neu-tab-bar">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`neu-tab ${tab === t.key ? 'is-active' : ''}`}>
              {t.label}
              <span className="neu-tab-count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 数据表格 */}
      <div className="neu-table-card">
        {selected.size > 0 && (
          <div className="neu-batch-bar">
            <span className="neu-batch-bar-count">已选 <strong>{selected.size}</strong> 条</span>
            <div className="neu-batch-bar-spacer" />
            {tab !== 'REJECTED' && (
              <>
                <button onClick={() => setBatchApproveModal(true)} disabled={batchApproving} className="neu-btn-xs is-success">
                  <Check size={12} />{batchApproving ? '批量通过中...' : '批量通过'}
                </button>
                <button onClick={() => { setBatchReason(''); setBatchModal({ type: 'return', ids: new Set(selected) }); }} className="neu-btn-xs is-warning">
                  批量退回
                </button>
                <button onClick={() => { setBatchReason(''); setBatchModal({ type: 'reject', ids: new Set(selected) }); }} className="neu-btn-xs is-danger">
                  批量拒绝
                </button>
              </>
            )}
            <button onClick={() => setSelected(new Set())} className="neu-btn-xs"><X size={12} /> 取消选择</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[760px]">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input type="checkbox" className="neu-checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected; }} onChange={toggleAll} aria-label="全选" />
                </th>
                <th>企业名称</th>
                <th style={{ textAlign: 'center' }}>统一社会信用代码</th>
                <th>企业类型</th>
                <th className="text-center">资料</th>
                <th style={{ textAlign: 'center' }}>状态</th>
                <th style={{ textAlign: 'center' }}>申请时间</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={8} rows={5} />
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <Building2 size={22} className="text-[var(--muted-foreground)]" />
                      </div>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {`暂无${activeTab.label}申请`}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : data.items.map((s: Supplier) => {
                const isSel = selected.has(s.id);
                return (
                  <tr key={s.id} className="row-clickable" data-selected={isSel ? 'true' : 'false'} onClick={() => router.push(`/supplier/${s.id}`)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="neu-checkbox" checked={isSel} onChange={() => toggleSelect(s.id)} aria-label={`选择 ${s.name}`} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">
                          {s.name[0]}
                        </div>
                        <span className="text-sm font-bold text-[var(--foreground)] truncate">{s.name}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="font-mono text-xs text-[var(--muted-foreground)]">{s.creditCode || '—'}</span>
                    </td>
                    <td className="text-center text-sm text-[var(--muted-foreground)] max-w-[140px] truncate" title={s.enterpriseType || ''}>{normalizeEnterpriseType(s.enterpriseType)}</td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {((s as any)._count?.qualifications ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)]" title="资质材料数量">
                            <ShieldCheck size={10} />{(s as any)._count.qualifications}
                          </span>
                        )}
                        {((s as any)._count?.contacts ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--success)]" title="联系人数量">
                            <User size={10} />{(s as any)._count.contacts}
                          </span>
                        )}
                        {((s as any)._count?.qualifications ?? 0) === 0 && ((s as any)._count?.contacts ?? 0) === 0 && (
                          <span className="text-[10px] text-[var(--muted-foreground)]">—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-col items-center gap-0.5">
                        <StatusBadge tone={s.status === 'PENDING' ? 'blue' : s.status === 'RETURNED' ? 'orange' : 'red'}>
                          {s.status === 'PENDING' ? '待审核' : s.status === 'RETURNED' ? '退回补正' : '审核不通过'}
                        </StatusBadge>
                        {s.status === 'RETURNED' && s.returnReason && (
                          <span className="text-[10px] text-[var(--warning)]">退回：{s.returnReason}</span>
                        )}
                        {s.status === 'REJECTED' && s.rejectReason && (
                          <span className="text-[10px] text-[var(--danger)]">原因：{s.rejectReason}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <time className="text-[0.8rem] tabular-nums text-[var(--muted-foreground)] whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString('zh-CN')}
                      </time>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <button onClick={() => router.push(`/supplier/${s.id}`)} className="neu-btn-xs is-info">详情</button>
                        {tab !== 'REJECTED' && (
                          <>
                            {classifications.length > 0 && (
                              <select
                                value={s.classificationId || ''}
                                onChange={async (ev) => {
                                  const cid = ev.target.value;
                                  if (!cid) return;
                                  try {
                                    await setSupplierClassifications(s.id, [cid]);
                                    toast.success(`已为「${s.name}」分配分类`);
                                  } catch (err: any) { toast.error(err?.message || '分配失败'); }
                                }}
                                onClick={e => e.stopPropagation()}
                                className="neu-input !h-7 !text-[11px] !px-2 !py-0 !w-auto"
                              >
                                <option value="">分配分类</option>
                                {classifications.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            )}
                            <button onClick={() => setActionModal({ type: 'approve', supplier: s })} className="neu-btn-xs is-success">通过</button>
                            <button onClick={() => { setActionReason(''); setActionModal({ type: 'return', supplier: s }); }} className="neu-btn-xs is-warning">退回</button>
                            <button onClick={() => { setActionReason(''); setActionModal({ type: 'reject', supplier: s }); }} className="neu-btn-xs is-danger">拒绝</button>
                          </>
                        )}
                        {/* 断头路接线（2026-09-28 审计 S2）：REJECTED → PENDING 复活（后端 @Roles('admin')） */}
                        {tab === 'REJECTED' && currentUser?.role === 'admin' && (
                          <button
                            onClick={() => setReactivateTarget(s)}
                            className="neu-btn-xs is-success">复活申请</button>
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
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">
              共 <strong className="font-semibold text-[var(--foreground)]">{data.total}</strong> 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="neu-btn-xs disabled:opacity-30">
                <ChevronUp size={14} className="rotate-[-90deg]" />
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="neu-btn-xs disabled:opacity-30">
                <ChevronUp size={14} className="rotate-90" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 处理弹窗 */}
      {actionModal && (
        <Modal
          open
          onClose={() => setActionModal(null)}
          title={actionModal.type === 'approve' ? '确认审核通过' : actionModal.type === 'reject' ? '审核不通过' : '退回补正'}
          description={<>供应商：<strong className="text-[var(--foreground)]">{actionModal.supplier.name}</strong></>}
          footer={
            <>
              <button onClick={() => setActionModal(null)} className="neu-btn-soft">取消</button>
              <button
                onClick={handleAction}
                disabled={actionModal.type !== 'approve' && !actionReason.trim()}
                className={`neu-btn-soft ${actionModal.type === 'approve' ? 'is-success' : actionModal.type === 'return' ? 'is-warning' : 'is-danger'}`}
              >确认</button>
            </>
          }
        >
          {actionModal.type !== 'approve' && (
            <textarea
              value={actionReason}
              onChange={e => setActionReason(e.target.value)}
              placeholder={actionModal.type === 'return' ? '请填写退回补正原因...' : '请填写不通过原因...'}
              className="neu-input w-full h-24 resize-none text-sm"
            />
          )}
        </Modal>
      )}

      {/* REJECTED 复活确认（仅 admin；REJECTED → PENDING 重新进审） */}
      {reactivateTarget && (
        <Modal
          open
          onClose={() => setReactivateTarget(null)}
          title="复活注册申请"
          description={<>供应商：<strong className="text-[var(--foreground)]">{reactivateTarget.name}</strong></>}
          footer={
            <>
              <button onClick={() => setReactivateTarget(null)} className="neu-btn-soft">取消</button>
              <button onClick={handleReactivate} disabled={reactivating} className="neu-btn-soft is-success">
                {reactivating ? '处理中...' : '确认复活'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--muted-foreground)]">
            复活后该供应商状态将从「审核不通过」回到「待审核」，重新进入审批队列；原拒绝记录保留在操作历史中。
          </p>
        </Modal>
      )}

      {/* 批量退回/拒绝弹窗 */}
      {batchModal && (
        <Modal
          open
          onClose={() => setBatchModal(null)}
          title={batchModal.type === 'return' ? '批量退回补正' : '批量审核不通过'}
          description={<>将对选中的 <strong>{batchModal.ids.size}</strong> 个供应商统一处理</>}
          footer={
            <>
              <button onClick={() => setBatchModal(null)} className="neu-btn-soft">取消</button>
              <button onClick={executeBatchReturnReject} disabled={!batchReason.trim()}
                className={`neu-btn-soft ${batchModal.type === 'return' ? 'is-warning' : 'is-danger'}`}>确认</button>
            </>
          }
        >
          <textarea value={batchReason} onChange={e => setBatchReason(e.target.value)}
            placeholder={batchModal.type === 'return' ? '请填写批量退回补正原因...' : '请填写批量不通过原因...'}
            className="neu-input w-full h-24 resize-none text-sm" />
        </Modal>
      )}

      {/* 批量通过确认弹窗 */}
      {batchApproveModal && (
        <Modal
          open
          onClose={() => setBatchApproveModal(false)}
          title="确认批量通过"
          description={<>将对选中的 <strong className="text-[var(--foreground)]">{selected.size}</strong> 个供应商统一审核通过，通过后供应商将入库并激活账户。</>}
          footer={
            <>
              <button onClick={() => setBatchApproveModal(false)} className="neu-btn-soft">取消</button>
              <button onClick={batchApprove} disabled={batchApproving} className="neu-btn-soft is-success">
                {batchApproving ? '审核中...' : '确认通过'}
              </button>
            </>
          }
        >
          {null}
        </Modal>
      )}
    </div>
  );
}

export default function SupplierApprovalPageWrapper() {
  return <Suspense><SupplierApprovalPage /></Suspense>;
}
