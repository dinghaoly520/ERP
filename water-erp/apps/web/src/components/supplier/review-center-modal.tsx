'use client';

/**
 * 供应商审批中心（2026-09-29 窗口式重设计，cgzxui/impeccable 规范）
 *
 * 浮窗形态：右上角「审批」按钮 / 供应商库「审批」按钮触发（window 事件 'open-review-center'），
 * 不占用整页路由。双 panel：
 *  - 注册审批（三级）：左列表（状态+级筛选）/ 右详情（三级进度时间线含前级同意缘由 + 操作）
 *  - 信息更新审批（办公权限）：业务标签 / 密码重置 / 资料变更 三类（复用既有面板）
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BadgeCheck, Building2, FileClock, History, Loader2,
  ShieldCheck, Stamp,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import {
  getSupplierList, getSupplier, approveSupplier, rejectSupplier, returnSupplier, reactivateSupplier,
  getApprovalHistory, fetchMyPendingReviewCount,
  type ApprovalRecord,
} from '@/lib/api/supplier';
import { BusinessTagReview } from './business-tag-review';
import { SupplierPasswordResetPanel } from './password-reset-panel';
import { ChangeReviewPanel } from './change-review-panel';
import type { Supplier, SupplierListResponse } from '@/lib/types';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { AuthUser } from '@/lib/api/auth';
import { fetchCurrentUser } from '@/lib/api/auth';

type SupplierWithParts = Supplier & {
  contacts?: Array<{ id: string; name: string; phone: string; position?: string | null; isPrimary?: boolean }>;
  qualifications?: Array<{ id: string; type: string; name: string; fileUrl?: string | null; validFrom?: string | null; validTo?: string | null }>;
};

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
const PAGE_SIZE = 8;

export function ReviewCenterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [panel, setPanel] = useState<'registration' | 'changes'>('registration');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [myCount, setMyCount] = useState({ registration: 0, changes: 0 });

  useEffect(() => {
    if (open) fetchCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, [open]);
  const refreshBadge = useCallback(() => {
    fetchMyPendingReviewCount().then(setMyCount).catch(() => {});
  }, []);
  useEffect(() => { if (open) refreshBadge(); }, [open, refreshBadge]);

  const myRole = currentUser?.role;
  const canReview = myRole === 'admin' || myRole === 'leader' || myRole === 'staff';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="供应商审批"
      description="注册三级审核（初审 → 复审 → 终审）· 信息更新审批"
      size="2xl"
      className="!max-w-[min(1180px,96vw)]"
    >
      {!canReview ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
            <ShieldCheck size={22} className="text-[var(--muted-foreground)]" />
          </div>
          <p className="text-sm font-bold text-[var(--foreground)]">供应商审批仅对管理权限账号开放</p>
          <p className="text-xs text-[var(--muted-foreground)]">如有需要请联系管理员</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* panel 切换 */}
          <div className="neu-segment" role="group" aria-label="审批类型"
            data-count="2" data-index={String(panel === 'registration' ? 0 : 1)}>
            <span className="neu-segment-thumb" aria-hidden="true" />
            {([
              { key: 'registration', label: '注册审批（三级）', icon: Stamp, count: myCount.registration },
              { key: 'changes', label: '信息更新审批', icon: FileClock, count: myCount.changes },
            ] as const).map(p => (
              <button key={p.key} type="button" className="neu-segment-btn" aria-pressed={panel === p.key}
                onClick={() => setPanel(p.key)}>
                <p.icon size={12} className="shrink-0" />
                {p.label}
                {p.count > 0 && <span className="neu-segment-count">{p.count}</span>}
              </button>
            ))}
          </div>

          {panel === 'registration'
            ? <RegistrationPanel myRole={myRole} onChanged={refreshBadge} />
            : (
              <div className="flex flex-col gap-4">
                <ChangesTabs />
              </div>
            )}
        </div>
      )}
    </Modal>
  );
}

/* ═══ 信息更新审批：三类 tab（现成面板复用）═══ */
type ChangeTabKey = 'tags' | 'resets' | 'changes';
function ChangesTabs() {
  const [tab, setTab] = useState<ChangeTabKey>('changes');
  const [counts, setCounts] = useState<Record<ChangeTabKey, number>>({ tags: 0, resets: 0, changes: 0 });
  useEffect(() => {
    import('@/lib/api/supplier').then(({ listBusinessTags, fetchSupplierPasswordResets, fetchPendingSupplierChanges }) =>
      Promise.all([
        listBusinessTags('PENDING').catch(() => []),
        fetchSupplierPasswordResets().catch(() => []),
        fetchPendingSupplierChanges().catch(() => []),
      ]).then(([tags, resets, changes]) => {
        setCounts({ tags: (tags as unknown[]).length, resets: (resets as unknown[]).length, changes: (changes as unknown[]).length });
      }));
  }, []);
  const TABS: { key: ChangeTabKey; label: string }[] = [
    { key: 'changes', label: '资料变更' },
    { key: 'tags', label: '业务标签' },
    { key: 'resets', label: '密码重置' },
  ];
  return (
    <>
      <div className="neu-tab-bar">
        {TABS.map(t => (
          <button key={t.key} type="button" className={`neu-tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {counts[t.key] > 0 && <span className="neu-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>
      {tab === 'changes' && <ChangeReviewPanel />}
      {tab === 'tags' && <BusinessTagReview />}
      {tab === 'resets' && <SupplierPasswordResetPanel />}
      <p className="text-[11px] text-[var(--muted-foreground)]">信息更新类审批到办公权限（归属公司 leader/staff，admin 可见）为止。</p>
    </>
  );
}

/* ═══ 注册审批（三级）· 双栏：左列表 / 右详情+操作 ═══ */
function RegistrationPanel({ myRole, onChanged }: { myRole?: string; onChanged: () => void }) {
  const [statusTab, setStatusTab] = useState<'PENDING' | 'RETURNED' | 'REJECTED'>('PENDING');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: PAGE_SIZE, items: [] });
  const [counts, setCounts] = useState<Record<string, number>>({ PENDING: 0, RETURNED: 0, REJECTED: 0 });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<ApprovalRecord[] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗数据加载（选中态驱动的标准拉取模式） */
  const loadData = useCallback(() => {
    setLoading(true);
    getSupplierList({
      status: statusTab, page, pageSize: PAGE_SIZE, sort: 'completeness',
      ...(stageFilter !== 'ALL' ? { reviewStage: stageFilter } : {}),
    }).then(setData).catch(() => setData({ total: 0, page: 1, pageSize: PAGE_SIZE, items: [] }))
      .finally(() => setLoading(false));
  }, [statusTab, page, stageFilter]);

  const loadCounts = useCallback(() => {
    Promise.all([
      getSupplierList({ status: 'PENDING', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'RETURNED', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'REJECTED', page: 1, pageSize: 1 }),
    ]).then(([p, r, j]) => setCounts({ PENDING: p.total, RETURNED: r.total, REJECTED: j.total })).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { setPage(1); setSelected(null); }, [statusTab, stageFilter]);

  // 选中行 → 拉三级留痕 + 完整注册资料（联系人/资质/账户/业绩，审批核对用）
  const [full, setFull] = useState<Supplier | null>(null);
  useEffect(() => {
    if (!selected) { setHistory(null); setFull(null); setReason(''); return; }
    setHistory(null);
    setFull(null);
    getApprovalHistory(selected.id).then(setHistory).catch(() => setHistory([]));
    getSupplier(selected.id).then(setFull).catch(() => setFull(null));
  }, [selected]);

  /** 我是否可能操作该供应商当前级（前端粗判给操作区；后端 assertStageApprover 是权威闸） */
  const canActOnStage = (s: Supplier): boolean => {
    const st = (s.reviewStage ?? 'STAFF') as string;
    if (myRole === 'admin') return true;
    if (myRole === 'leader') return st === 'LEADER' || st === 'STAFF';
    if (myRole === 'staff') return st === 'STAFF';
    return false;
  };

  const act = async (type: 'approve' | 'reject' | 'return' | 'reactivate') => {
    if (!selected) return;
    const st = (selected.reviewStage ?? 'STAFF') as string;
    if (type === 'reject' || type === 'return') {
      if (!reason.trim()) { toast.error('请填写处理理由'); return; }
    } else if (type === 'approve' && st !== 'ADMIN' && !reason.trim()) {
      toast.error('请填写同意缘由（后级审批人将据此复核）');
      return;
    }
    setBusy(true);
    try {
      if (type === 'approve') {
        const res = await approveSupplier(selected.id, reason.trim() || undefined);
        toast.success(res.stage === 'DONE' ? `「${selected.name}」三级审核全部通过，已正式入库` : `「${selected.name}」已通过${STAGE_META[st]?.short ?? ''}，流转至${STAGE_META[res.stage ?? '']?.short ?? '下一级'}`);
      } else if (type === 'reject') {
        await rejectSupplier(selected.id, reason.trim());
        toast.success(`已驳回「${selected.name}」（${STAGE_META[st]?.short ?? ''}环节）`);
      } else if (type === 'return') {
        await returnSupplier(selected.id, reason.trim());
        toast.success(`已退回「${selected.name}」补正（补正后回到${STAGE_META[st]?.short ?? ''}环节）`);
      } else {
        await reactivateSupplier(selected.id);
        toast.success(`「${selected.name}」已复活，重新进入三级审核`);
      }
      setSelected(null); setReason('');
      loadData(); loadCounts(); onChanged();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  /* eslint-enable react-hooks/set-state-in-effect */
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const selStage = (selected?.reviewStage ?? 'STAFF') as string;

  return (
    <div className="rc-split">
      {/* ── 左栏：筛选 + 列表 ── */}
      <div className="rc-split-list">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map(t => (
            <button key={t.key} type="button"
              className={['rc-stage-chip-btn', statusTab === t.key ? '' : ''].join(' ')}
              data-active={statusTab === t.key}
              style={statusTab === t.key ? undefined : undefined}
              onClick={() => setStatusTab(t.key)}>
              {t.label}{counts[t.key] > 0 ? ` ${counts[t.key]}` : ''}
            </button>
          ))}
        </div>
        {statusTab !== 'REJECTED' && (
          <div className="rc-stage-chip-group mt-2">
            {(['ALL', 'STAFF', 'LEADER', 'ADMIN'] as const).map(sf => (
              <button key={sf} type="button" className="rc-stage-chip-btn" data-active={stageFilter === sf}
                onClick={() => setStageFilter(sf)}>
                {sf === 'ALL' ? '全部级' : STAGE_META[sf].short}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--muted-foreground)]"><Loader2 size={14} className="animate-spin" />加载中…</div>
          ) : data.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-xs text-[var(--muted-foreground)]">
              <Building2 size={18} className="opacity-60" />
              暂无{statusTab === 'PENDING' ? '在审' : statusTab === 'RETURNED' ? '退回补正' : '已驳回'}申请
            </div>
          ) : data.items.map((s: Supplier) => {
            const st = (statusTab === 'REJECTED' ? s.reviewStage : (s.reviewStage ?? 'STAFF')) as string | null;
            const meta = st ? STAGE_META[st] : null;
            const isSel = selected?.id === s.id;
            const mine = statusTab !== 'REJECTED' && canActOnStage(s);
            return (
              <button key={s.id} type="button" onClick={() => setSelected(s)}
                className={['rc-list-row', isSel ? 'is-selected' : ''].join(' ')}
                data-mine={mine ? 'true' : 'false'}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold"
                  style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
                  {s.name[0]}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[13px] font-bold text-[var(--foreground)]" title={s.name}>{s.name}</div>
                  <div className="truncate font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{s.creditCode || '—'}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {meta && <span className="rc-stage-chip" style={{ '--rc-accent': meta.color } as React.CSSProperties}>{meta.short}</span>}
                  {mine && <span className="text-[9px] font-bold text-[var(--success)]">待我审</span>}
                </div>
              </button>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
            <span className="tabular-nums">{page} / {totalPages} · 共 {data.total} 条</span>
            <span className="flex gap-1.5">
              <button type="button" className="neu-btn-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
              <button type="button" className="neu-btn-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
            </span>
          </div>
        )}
      </div>

      {/* ── 右栏：摘要 → 三级进度 → 注册申请资料 → 操作 ── */}
      <div className="rc-split-detail">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><Stamp size={22} className="text-[var(--muted-foreground)]" /></div>
            <p className="text-sm font-bold text-[var(--foreground)]">选择左侧申请查看资料并审核</p>
            <p className="max-w-[260px] text-xs leading-5 text-[var(--muted-foreground)]">三级审核：同公司 staff 初审 → 同公司 leader 复审 → 管理员终审；后级可查看前级的同意缘由。</p>
          </div>
        ) : (
          <div className="rc-detail-scroll flex min-h-0 flex-1 flex-col gap-3">
            {/* 摘要行（锚点，避免与左栏重复堆叠信息） */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold"
                style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
                {selected.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-[var(--foreground)]" title={selected.name}>{selected.name}</div>
                <div className="truncate font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{selected.creditCode || '—'}</div>
              </div>
              {statusTab !== 'REJECTED' && STAGE_META[selStage] && (
                <span className="rc-stage-chip" style={{ '--rc-accent': STAGE_META[selStage].color } as React.CSSProperties}>
                  <BadgeCheck size={10} />{STAGE_META[selStage].short}
                </span>
              )}
            </div>

            {/* 三级审核进度（紧凑单行级） */}
            <div className="rc-timeline-card">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                <History size={11} />三级审核进度
              </div>
              {history === null ? (
                <div className="flex items-center gap-2 py-1.5 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="animate-spin" />加载审核记录…</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(['STAFF', 'LEADER', 'ADMIN'] as const).map(st => {
                    const rec = history.find(h => h.stage === st && h.action === 'APPROVED');
                    const done = !!rec;
                    const current = selStage === st && statusTab !== 'REJECTED';
                    const meta = STAGE_META[st];
                    return (
                      <div key={st} className="flex items-start gap-2">
                        <span className={['rc-stage-dot', done ? 'rc-stage-dot--done' : current ? '' : 'rc-stage-dot--idle'].join(' ')}
                          style={current ? ({ '--rc-accent': meta.color } as React.CSSProperties) : undefined}>
                          {done ? '✓' : current ? '•' : '○'}
                        </span>
                        <div className="min-w-0 flex-1 leading-4">
                          <span className="text-[11px] font-bold text-[var(--foreground)]">{meta.short}</span>
                          {current && <span className="rc-cur-badge ml-1.5">当前级</span>}
                          {selected.status === 'REJECTED' && !done && st === selStage && <span className="ml-1.5 text-[9px] font-bold text-[var(--danger)]">在此级被驳回</span>}
                          {rec && (
                            <span className="ml-1.5 text-[10px] text-[var(--muted-foreground)]">
                              <span className="tabular-nums">{rec.reviewer?.displayName}</span>
                              {rec.reason && <> · <span className="text-[var(--foreground)]">{rec.reason}</span></>}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 注册申请资料（完整核对区，恢复旧详情窗能力） */}
            {full === null ? (
              <div className="flex items-center gap-2 py-3 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="animate-spin" />加载注册资料…</div>
            ) : (
              <div className="rc-timeline-card flex flex-col gap-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                  <FileClock size={11} />注册申请资料
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] leading-4">
                  {([
                    ['法定代表人', full.legalPerson], ['法人电话', full.legalPersonPhone],
                    ['企业类型', normalizeEnterpriseType(full.enterpriseType || '')], ['注册资本', full.registeredCapital],
                    ['所属行业', full.industry], ['成立日期', full.establishedDate ? new Date(full.establishedDate).toLocaleDateString('zh-CN') : null],
                    ['国别/区域', [full.country, full.region].filter(Boolean).join(' · ') || null], ['归属公司', full.companyName],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="flex min-w-0 gap-1.5">
                      <dt className="shrink-0 text-[var(--muted-foreground)]">{k}</dt>
                      <dd className="min-w-0 flex-1 truncate font-semibold text-[var(--foreground)]" title={v ?? ''}>{v || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <div className="text-[11px] leading-4">
                  <span className="text-[var(--muted-foreground)]">注册地址：</span>
                  <span className="text-[var(--foreground)]">{full.registeredAddress || '—'}</span>
                </div>
                {full.businessScope && (
                  <div className="text-[11px] leading-4">
                    <span className="text-[var(--muted-foreground)]">经营范围：</span>
                    <span className="text-[var(--foreground)]">{full.businessScope}</span>
                  </div>
                )}
                {(full as SupplierWithParts).contacts?.length ? (
                  <div>
                    <div className="mb-1 text-[10px] font-bold text-[var(--muted-foreground)]">联系人</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(full as SupplierWithParts).contacts!.map(c => (
                        <span key={c.id} className="rounded-lg px-2 py-1 text-[10px] leading-4"
                          style={{ background: 'oklch(1 0 0 / 0.55)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 1px 2px oklch(0.55 0.03 258 / 0.07)' }}>
                          <b className="text-[var(--foreground)]">{c.name}</b>
                          {c.isPrimary && <span className="ml-1 text-[var(--accent)]">主</span>}
                          <span className="ml-1 font-mono tabular-nums text-[var(--muted-foreground)]">{c.phone}</span>
                          {c.position && <span className="ml-1 text-[var(--muted-foreground)]">{c.position}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {((full as SupplierWithParts).qualifications ?? []).length ? (
                  <div>
                    <div className="mb-1 text-[10px] font-bold text-[var(--muted-foreground)]">资质证照</div>
                    <div className="flex flex-col gap-1">
                      {(full as SupplierWithParts).qualifications!.map(q => (
                        <div key={q.id} className="flex flex-wrap items-center gap-1.5 text-[10px] leading-4">
                          <span className="rc-stage-chip" style={{ '--rc-accent': 'var(--accent)' } as React.CSSProperties}>{q.type}</span>
                          <span className="font-semibold text-[var(--foreground)]">{q.name}</span>
                          {(q.validFrom || q.validTo) && (
                            <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
                              {q.validFrom ? new Date(q.validFrom).toLocaleDateString('zh-CN') : ''} ~ {q.validTo ? new Date(q.validTo).toLocaleDateString('zh-CN') : '长期'}
                            </span>
                          )}
                          {q.fileUrl && <a href={q.fileUrl} target="_blank" rel="noreferrer" className="font-bold text-[var(--accent)] hover:underline">查看文件</a>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <p className="text-[10px] text-[var(--muted-foreground)]">未提交资质证照</p>}
              </div>
            )}

            {/* 操作区 */}
            {statusTab === 'REJECTED' ? (
              myRole === 'admin' ? (
                <div className="flex items-center justify-end gap-2">
                  <button type="button" className="neu-btn-soft" disabled={busy} onClick={() => void act('reactivate')}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : null}复活重审（重走三级）
                  </button>
                </div>
              ) : (
                <p className="text-right text-[11px] text-[var(--muted-foreground)]">被拒申请仅管理员可复活重审</p>
              )
            ) : canActOnStage(selected) ? (
              <div className="rc-timeline-card flex flex-col gap-2.5">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold text-[var(--foreground)]">
                    {selStage === 'ADMIN' ? '终审意见（可选）' : `同意缘由（${STAGE_META[selStage]?.short ?? ''}必填，后级审批人将据此复核）`}
                  </span>
                  <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                    className="neu-input !text-[13px]" placeholder={selStage === 'ADMIN' ? '终审确认意见…' : '如：证照齐全、经营范围与采购需求匹配…'} />
                </label>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" className="neu-btn-xs is-danger" disabled={busy} onClick={() => void act('reject')}>驳回</button>
                  <button type="button" className="neu-btn-xs" disabled={busy} onClick={() => void act('return')}>退回补正</button>
                  <button type="button" className="neu-btn-primary !h-[34px]" disabled={busy} onClick={() => void act('approve')}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />}
                    {selStage === 'ADMIN' ? '终审通过 · 正式入库' : `通过 · 流转至${STAGE_META[selStage === 'STAFF' ? 'LEADER' : 'ADMIN']?.short}`}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-center text-[11px] text-[var(--muted-foreground)]">
                当前为{STAGE_META[selStage]?.short ?? '—'}级，非本级审批人（后端按级校验）
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
