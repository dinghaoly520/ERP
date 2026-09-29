'use client';

/**
 * 供应商审批中心（2026-09-29 重设计）
 *
 * 入口：页面顶栏右上角「供应商审批」按钮（app-user-actions，带待我审角标）。
 * 两个面板：
 *  - 注册审批（三级）：同公司 staff 初审（须填同意缘由）→ 同公司 leader 复审（可见 staff 缘由）
 *    → 平台 admin 终审确认 → 三级闭环才入库；任一级可驳回/退回补正（补正后回到退回的那一级）
 *  - 信息更新审批：已入库供应商的资料变更（办公权限：同公司 leader/staff，admin 可见）
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  getSupplierList, approveSupplier, rejectSupplier, returnSupplier, reactivateSupplier,
  getApprovalHistory, fetchPendingSupplierChanges, approveChange, rejectChange,
  type ApprovalRecord, type SupplierChangePendingRow,
} from '@/lib/api/supplier';
import type { Supplier, SupplierListResponse } from '@/lib/types';
import { TableSkeleton, Modal } from '@/components/workbench';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { AuthUser } from '@/lib/api/auth';
import { fetchCurrentUser } from '@/lib/api/auth';
import {
  BadgeCheck, Building2, ChevronRight, FileClock, History, Loader2, RefreshCw,
  ShieldCheck, Stamp,
} from 'lucide-react';

// ── 三级审批常量（与后端 SupplierService 同口径）──
const STAGE_META: Record<string, { label: string; short: string; color: string }> = {
  STAFF: { label: '初审（经办 staff）', short: '初审', color: 'var(--accent)' },
  LEADER: { label: '复审（部门 leader）', short: '复审', color: 'oklch(0.58 0.12 188)' },
  ADMIN: { label: '终审（管理员确认）', short: '终审', color: 'oklch(0.57 0.15 25)' },
};

const STATUS_TABS = [
  { key: 'PENDING', label: '在审' },
  { key: 'RETURNED', label: '退回补正' },
  { key: 'REJECTED', label: '已驳回' },
] as const;

function SupplierApprovalPage() {
  const router = useRouter();
  const params = useSearchParams();
  const panel = params.get('panel') === 'changes' ? 'changes' : 'registration';
  const statusTab = (STATUS_TABS.find(t => t.key === params.get('status'))?.key ?? 'PENDING') as 'PENDING' | 'RETURNED' | 'REJECTED';
  const stageFilter = ['ALL', 'STAFF', 'LEADER', 'ADMIN'].includes(params.get('stage') || '') ? (params.get('stage') as string) : 'ALL';
  const page = parseInt(params.get('page') || '1', 10) || 1;
  const pageSize = 20;
  const setParam = (k: string, v: string) => {
    const q = new URLSearchParams(params);
    q.set(k, v);
    if (k !== 'page') q.delete('page');
    router.push(`?${q.toString()}`);
  };

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  useEffect(() => {
    fetchCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null)).finally(() => setRoleReady(true));
  }, []);
  const myRole = currentUser?.role;

  // ── 注册审批（三级）──
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [counts, setCounts] = useState<Record<string, number>>({ PENDING: 0, RETURNED: 0, REJECTED: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject' | 'return' | 'reactivate'; supplier: Supplier } | null>(null);
  const [history, setHistory] = useState<ApprovalRecord[] | null>(null);

  // ── 信息更新审批 ──
  const [changes, setChanges] = useState<SupplierChangePendingRow[]>([]);
  const [changesLoading, setChangesLoading] = useState(true);
  const [changeModal, setChangeModal] = useState<{ row: SupplierChangePendingRow; type: 'approve' | 'reject' } | null>(null);
  const [changeReason, setChangeReason] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getSupplierList({
        status: statusTab, page, pageSize, sort: 'completeness',
        ...(stageFilter !== 'ALL' ? { reviewStage: stageFilter } : {}),
      });
      setData(res);
    } catch (e: unknown) { setError((e as Error)?.message || '审批列表加载失败'); }
    setLoading(false);
  }, [statusTab, page, stageFilter]);

  const loadCounts = useCallback(() => {
    Promise.all([
      getSupplierList({ status: 'PENDING', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'RETURNED', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'REJECTED', page: 1, pageSize: 1 }),
    ]).then(([p, r, j]) => setCounts({ PENDING: p.total, RETURNED: r.total, REJECTED: j.total })).catch(() => {});
  }, []);

  const loadChanges = useCallback(() => {
    setChangesLoading(true);
    fetchPendingSupplierChanges().then(setChanges).catch(() => setChanges([])).finally(() => setChangesLoading(false));
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 页面数据加载（URL 参数驱动的标准拉取模式） */
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { if (panel === 'registration') loadData(); }, [panel, loadData]);
  useEffect(() => { if (panel === 'changes') loadChanges(); }, [panel, loadChanges]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 打开操作弹窗时拉取三级时间线（后级审批人查看前级同意缘由）
  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开时的初始化重置，符合模态惯例 */
  useEffect(() => {
    if (!actionModal) { setHistory(null); setActionReason(''); return; }
    setHistory(null);
    getApprovalHistory(actionModal.supplier.id).then(setHistory).catch(() => setHistory([]));
  }, [actionModal]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** 我是否可能操作该供应商当前级（前端粗判给按钮；后端 assertStageApprover 是权威闸） */
  const canActOnStage = (s: Supplier): boolean => {
    if (myRole === 'admin') return s.reviewStage === 'ADMIN' || s.reviewStage === 'LEADER' || s.reviewStage === 'STAFF';
    if (myRole === 'leader') return s.reviewStage === 'LEADER' || s.reviewStage === 'STAFF';
    if (myRole === 'staff') return s.reviewStage === 'STAFF';
    return false;
  };

  /** 弹窗内当前级（null 兜底 STAFF，与列表/后端口径一致） */
  const modalStage = (am: { supplier: Supplier }) => (am.supplier.reviewStage ?? 'STAFF') as string;

  const handleAction = async () => {
    if (!actionModal) return;
    const { type, supplier: s } = actionModal;
    const stage = modalStage(actionModal);
    const reason = actionReason.trim();
    // staff/leader 级通过须填同意缘由（后级审批依据）；驳回/退回理由必填；admin 终审缘由可选
    if (type === 'reject' || type === 'return') {
      if (!reason) { toast.error('请填写处理理由'); return; }
    } else if (type === 'approve' && stage !== 'ADMIN' && !reason) {
      toast.error('请填写同意缘由（后级审批人将据此复核）');
      return;
    }
    setActionBusy(true);
    try {
      if (type === 'approve') {
        const res = await approveSupplier(s.id, reason || undefined);
        toast.success(res.stage === 'DONE' ? `「${s.name}」三级审核全部通过，已正式入库` : `「${s.name}」已通过${STAGE_META[stage]?.short ?? ''}，流转至${STAGE_META[res.stage ?? '']?.short ?? '下一级'}`);
      } else if (type === 'reject') {
        await rejectSupplier(s.id, reason);
        toast.success(`已驳回「${s.name}」（${STAGE_META[stage]?.short ?? ''}环节）`);
      } else if (type === 'return') {
        await returnSupplier(s.id, reason);
        toast.success(`已退回「${s.name}」补正（补正后回到${STAGE_META[stage]?.short ?? ''}环节）`);
      } else if (type === 'reactivate') {
        await reactivateSupplier(s.id);
        toast.success(`「${s.name}」已复活，重新进入三级审核`);
      }
      setActionModal(null);
      loadData(); loadCounts();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || '操作失败');
    } finally {
      setActionBusy(false);
    }
  };

  const handleChangeAction = async () => {
    if (!changeModal) return;
    const { row, type } = changeModal;
    if (type === 'reject' && !changeReason.trim()) { toast.error('请填写拒绝理由'); return; }
    setActionBusy(true);
    try {
      if (type === 'approve') {
        await approveChange(row.id);
        toast.success(`已通过「${row.supplier.name}」的${row.fieldLabel || row.fieldName}变更`);
      } else {
        await rejectChange(row.id, changeReason.trim());
        toast.success(`已拒绝「${row.supplier.name}」的变更申请`);
      }
      setChangeModal(null);
      setChangeReason('');
      loadChanges();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || '操作失败');
    } finally {
      setActionBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  // 无审批权角色：就绪前空态防闪现，就绪后无权限卡（后端守卫兜底）
  if (!roleReady) return null;
  if (myRole !== 'admin' && myRole !== 'leader' && myRole !== 'staff') {
    return (
      <div className="neu-card-static flex flex-col items-center justify-center gap-3 p-14 text-center">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <ShieldCheck size={22} className="text-[var(--muted-foreground)]" />
        </div>
        <p className="text-sm font-bold text-[var(--foreground)]">供应商审批中心仅对管理权限账号开放</p>
        <p className="text-xs text-[var(--muted-foreground)]">如有需要请联系管理员</p>
      </div>
    );
  }

  const myStageHint = myRole === 'admin' ? '终审确认（ADMIN 级）' : myRole === 'leader' ? '复审（LEADER 级）' : '初审（STAFF 级）';

  return (
    <div className="flex flex-col gap-5">
      {/* 面板切换 */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          { key: 'registration', label: '注册审批（三级）', icon: Stamp },
          { key: 'changes', label: '信息更新审批', icon: FileClock },
        ] as const).map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => { const q = new URLSearchParams(params); q.set('panel', p.key); q.delete('page'); router.push(`?${q.toString()}`); }}
            className={[
              'inline-flex items-center gap-2 rounded-[14px] px-4 py-2.5 text-sm font-bold transition-all',
              panel === p.key
                ? 'border border-[color-mix(in_oklch,var(--accent)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--accent)]'
                : 'border border-[oklch(0.6_0.04_258_/_0.16)] bg-[oklch(1_0_0_/_0.5)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            ].join(' ')}
          >
            <p.icon size={15} strokeWidth={2} />
            {p.label}
            {p.key === 'registration' && counts.PENDING > 0 && (
              <span className="ml-1 rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-black text-[var(--accent)]">{counts.PENDING}</span>
            )}
            {p.key === 'changes' && changes.length > 0 && (
              <span className="ml-1 rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-black text-[var(--accent)]">{changes.length}</span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">
          我的角色：{myRole === 'admin' ? '管理员' : myRole === 'leader' ? '部门领导' : '经办'} · 主要负责 <b className="text-[var(--foreground)]">{myStageHint}</b>
        </span>
      </div>

      {panel === 'registration' ? (
        <>
          {/* 状态 tab + 级筛选 */}
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setParam('status', t.key)}
                className={[
                  'rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
                  statusTab === t.key
                    ? 'bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-[var(--accent)]'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                ].join(' ')}
              >
                {t.label}（{counts[t.key] ?? 0}）
              </button>
            ))}
            {statusTab !== 'REJECTED' && (
              <span className="mx-1 h-4 w-px" style={{ background: 'oklch(0.6 0.04 258 / 0.18)' }} />
            )}
            {statusTab !== 'REJECTED' && (['ALL', 'STAFF', 'LEADER', 'ADMIN'] as const).map(sf => (
              <button
                key={sf}
                type="button"
                onClick={() => setParam('stage', sf)}
                className={[
                  'rounded-full px-3 py-1 text-[11px] font-bold transition-colors',
                  stageFilter === sf
                    ? 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[var(--warning)]'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                ].join(' ')}
              >
                {sf === 'ALL' ? '全部级' : STAGE_META[sf].short}
              </button>
            ))}
            <button type="button" onClick={() => { loadData(); loadCounts(); }} className="neu-btn-xs ml-auto shrink-0"><RefreshCw size={12} />刷新</button>
          </div>

          {error && <div className="rounded-[12px] px-4 py-3 text-sm text-[var(--danger)]" style={{ background: 'color-mix(in oklch, var(--danger) 7%, transparent)' }}>{error}</div>}

          <div className="overflow-x-auto">
            <table className="neu-table w-full min-w-[880px]">
              <thead>
                <tr>
                  <th>企业名称</th>
                  <th style={{ textAlign: 'center' }}>统一社会信用代码</th>
                  <th style={{ textAlign: 'center' }}>当前审核级</th>
                  <th style={{ textAlign: 'center' }}>状态</th>
                  <th style={{ textAlign: 'center' }}>申请时间</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton cols={6} rows={5} />
                ) : data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16">
                      <div className="flex flex-col items-center gap-3">
                        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                          <Building2 size={22} className="text-[var(--muted-foreground)]" />
                        </div>
                        <p className="text-sm text-[var(--muted-foreground)]">暂无{statusTab === 'PENDING' ? '在审' : statusTab === 'RETURNED' ? '退回补正' : '已驳回'}的申请</p>
                      </div>
                    </td>
                  </tr>
                ) : data.items.map((s: Supplier) => {
                  // null 级（seed 直建/未回填存量）按首级 STAFF 兜底展示与操作（后端同口径）
                  const stage = (statusTab === 'REJECTED' ? s.reviewStage : (s.reviewStage ?? 'STAFF')) as string | null;
                  const meta = stage ? STAGE_META[stage] : null;
                  const actable = statusTab !== 'REJECTED' && canActOnStage({ ...s, reviewStage: stage } as Supplier);
                  return (
                    <tr key={s.id} className="row-clickable" onClick={() => router.push(`/supplier/${s.id}`)}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">
                            {s.name[0]}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-[var(--foreground)] truncate">{s.name}</div>
                            <div className="text-[11px] text-[var(--muted-foreground)]">{normalizeEnterpriseType(s.enterpriseType || '')}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="font-mono text-xs text-[var(--muted-foreground)]">{s.creditCode || '—'}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {meta ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black"
                            style={{ background: `color-mix(in oklch, ${meta.color} 12%, transparent)`, color: meta.color }}
                            title={meta.label}
                          >
                            <BadgeCheck size={10} />{meta.short}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">{statusTab === 'REJECTED' ? '—' : '—'}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={['text-xs font-bold', s.status === 'PENDING' ? 'text-[var(--accent)]' : s.status === 'RETURNED' ? 'text-[var(--warning)]' : 'text-[var(--danger)]'].join(' ')}>
                          {s.status === 'PENDING' ? '审核中' : s.status === 'RETURNED' ? '退回补正' : s.status === 'REJECTED' ? '已驳回' : s.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }} className="text-xs text-[var(--muted-foreground)]">
                        {s.createdAt ? new Date(s.createdAt).toLocaleDateString('zh-CN') : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        {statusTab === 'REJECTED' ? (
                          myRole === 'admin' ? (
                            <button type="button" className="neu-btn-xs" onClick={() => setActionModal({ type: 'reactivate', supplier: s })}>复活重审</button>
                          ) : <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        ) : actable ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button type="button" className="neu-btn-xs is-success" onClick={() => setActionModal({ type: 'approve', supplier: s })}>通过</button>
                            <button type="button" className="neu-btn-xs" onClick={() => setActionModal({ type: 'return', supplier: s })}>退回</button>
                            <button type="button" className="neu-btn-xs is-danger" onClick={() => setActionModal({ type: 'reject', supplier: s })}>驳回</button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[var(--muted-foreground)]" title="当前级非本人负责（后端按级校验）">
                            待{meta?.short ?? '其他'}级
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <button type="button" className="neu-btn-xs" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>上一页</button>
              <span className="text-xs text-[var(--muted-foreground)]">{page} / {totalPages}（共 {data.total} 条）</span>
              <button type="button" className="neu-btn-xs" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>下一页</button>
            </div>
          )}
        </>
      ) : (
        /* ── 信息更新审批（办公权限：同公司 leader/staff；admin 全部可见）── */
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[760px]">
            <thead>
              <tr>
                <th>供应商</th>
                <th style={{ textAlign: 'center' }}>变更字段</th>
                <th>原值 → 新值</th>
                <th style={{ textAlign: 'center' }}>申请时间</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {changesLoading ? (
                <TableSkeleton cols={5} rows={4} />
              ) : changes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <FileClock size={22} className="text-[var(--muted-foreground)]" />
                      </div>
                      <p className="text-sm text-[var(--muted-foreground)]">暂无待审的信息更新申请</p>
                    </div>
                  </td>
                </tr>
              ) : changes.map(row => (
                <tr key={row.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">
                        {row.supplier.name[0]}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[var(--foreground)]">{row.supplier.name}</div>
                        <div className="font-mono text-[10px] text-[var(--muted-foreground)]">{row.supplier.supplierNo}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }} className="text-sm font-bold text-[var(--foreground)]">{row.fieldLabel || row.fieldName}</td>
                  <td className="max-w-[320px]">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="truncate text-[var(--muted-foreground)] line-through" title={row.oldValue ?? ''}>{row.oldValue || '（空）'}</span>
                      <ChevronRight size={12} className="shrink-0 text-[var(--muted-foreground)]" />
                      <span className="truncate font-bold text-[var(--foreground)]" title={row.newValue ?? ''}>{row.newValue || '（空）'}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }} className="text-xs text-[var(--muted-foreground)]">{new Date(row.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="flex items-center justify-center gap-1.5">
                      <button type="button" className="neu-btn-xs is-success" onClick={() => setChangeModal({ row, type: 'approve' })}>通过</button>
                      <button type="button" className="neu-btn-xs is-danger" onClick={() => setChangeModal({ row, type: 'reject' })}>拒绝</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 注册审批操作弹窗：三级时间线 + 缘由 ── */}
      {actionModal && (
        <Modal
          open
          onClose={() => { if (!actionBusy) setActionModal(null); }}
          title={
            actionModal.type === 'approve' ? `通过${STAGE_META[modalStage(actionModal)]?.short ?? ''} — ${actionModal.supplier.name}`
            : actionModal.type === 'reject' ? `驳回申请 — ${actionModal.supplier.name}`
            : actionModal.type === 'return' ? `退回补正 — ${actionModal.supplier.name}`
            : `复活重审 — ${actionModal.supplier.name}`
          }
          description={actionModal.type === 'approve' && modalStage(actionModal) === 'ADMIN' ? '管理员终审确认：通过后供应商正式入库' : undefined}
          footer={
            <>
              <button type="button" className="neu-btn-soft" onClick={() => setActionModal(null)} disabled={actionBusy}>取消</button>
              <button
                type="button"
                className={[
                  'neu-btn-primary',
                  actionModal.type === 'reject' ? 'is-danger' : actionModal.type === 'return' ? 'is-warning' : 'is-success',
                ].join(' ')}
                onClick={() => void handleAction()}
                disabled={actionBusy}
              >
                {actionBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                {actionModal.type === 'approve' ? (modalStage(actionModal) === 'ADMIN' ? '确认通过并入库' : `通过并流转至${STAGE_META[modalStage(actionModal) === 'STAFF' ? 'LEADER' : 'ADMIN']?.short}`) : actionModal.type === 'reject' ? '确认驳回' : actionModal.type === 'return' ? '确认退回' : '确认复活'}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {/* 三级进度时间线（含前级同意缘由） */}
            <div className="rounded-[14px] px-4 py-3" style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7)' }}>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                <History size={12} />三级审核进度
              </div>
              {history === null ? (
                <div className="flex items-center gap-2 py-2 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="animate-spin" />加载审核记录…</div>
              ) : (
                <div className="space-y-2">
                  {(['STAFF', 'LEADER', 'ADMIN'] as const).map(st => {
                    const rec = history.find(h => h.stage === st && h.action === 'APPROVED');
                    const stage = modalStage(actionModal);
                    const done = !!rec;
                    const current = stage === st;
                    const meta = STAGE_META[st];
                    return (
                      <div key={st} className="flex items-start gap-2.5">
                        <span
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                          style={{
                            background: done ? `color-mix(in oklch, var(--success) 16%, transparent)` : current ? `color-mix(in oklch, ${meta.color} 16%, transparent)` : 'oklch(0.9 0.005 258)',
                            color: done ? 'var(--success)' : current ? meta.color : 'var(--muted-foreground)',
                          }}
                        >
                          {done ? '✓' : current ? '•' : '○'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--foreground)]">{meta.label}</span>
                            {current && <span className="rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-1.5 py-0 text-[9px] font-black text-[var(--warning)]">当前级</span>}
                          </div>
                          {rec && (
                            <div className="mt-0.5 text-[11px] leading-4 text-[var(--muted-foreground)]">
                              {rec.reviewer?.displayName || '—'} · {new Date(rec.createdAt).toLocaleString('zh-CN')}
                              {rec.reason && <span className="ml-1 text-[var(--foreground)]">缘由：{rec.reason}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {actionModal.type !== 'reactivate' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-[var(--foreground)]">
                  {actionModal.type === 'approve'
                    ? modalStage(actionModal) === 'ADMIN' ? '终审意见（可选）' : '同意缘由（必填，后级审批人将据此复核）'
                    : actionModal.type === 'reject' ? '驳回理由（必填，将通知供应商）' : '退回补正说明（必填，供应商补正后回到本级）'}
                </span>
                <textarea
                  value={actionReason}
                  onChange={e => setActionReason(e.target.value)}
                  rows={3}
                  className="workbench-input !text-sm"
                  placeholder={actionModal.type === 'approve' ? '如：证照齐全、经营范围与采购需求匹配…' : '请填写具体理由…'}
                />
              </label>
            )}
          </div>
        </Modal>
      )}

      {/* ── 信息更新审批弹窗 ── */}
      {changeModal && (
        <Modal
          open
          onClose={() => { if (!actionBusy) setChangeModal(null); }}
          title={`${changeModal.type === 'approve' ? '通过' : '拒绝'}信息更新 — ${changeModal.row.supplier.name}`}
          description={changeModal.type === 'approve' ? `${changeModal.row.fieldLabel || changeModal.row.fieldName}：${changeModal.row.oldValue || '（空）'} → ${changeModal.row.newValue || '（空）'}` : undefined}
          footer={
            <>
              <button type="button" className="neu-btn-soft" onClick={() => setChangeModal(null)} disabled={actionBusy}>取消</button>
              <button
                type="button"
                className={['neu-btn-primary', changeModal.type === 'reject' ? 'is-danger' : 'is-success'].join(' ')}
                onClick={() => void handleChangeAction()}
                disabled={actionBusy}
              >
                {actionBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                {changeModal.type === 'approve' ? '确认通过' : '确认拒绝'}
              </button>
            </>
          }
        >
          {changeModal.type === 'reject' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-[var(--foreground)]">拒绝理由（必填）</span>
              <textarea value={changeReason} onChange={e => setChangeReason(e.target.value)} rows={3} className="workbench-input !text-sm" placeholder="请填写拒绝理由…" />
            </label>
          )}
        </Modal>
      )}
    </div>
  );
}

export default function SupplierApprovalPageWithSuspense() {
  return (
    <Suspense fallback={<div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">加载中…</div>}>
      <SupplierApprovalPage />
    </Suspense>
  );
}
