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
  BadgeCheck, Building2, FileClock, History, Loader2, Paperclip, Upload, X,
  ShieldCheck, Stamp,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import {
  getSupplierList, getSupplier, approveSupplier, rejectSupplier, returnSupplier, reactivateSupplier,
  getApprovalHistory, fetchMyPendingReviewCount,
  resolveApprovalAttachments, uploadReviewAttachment,
  type ApprovalRecord, type ApprovalAttachment,
} from '@/lib/api/supplier';
import { BusinessTagReview } from './business-tag-review';
import { ApprovalHistoryModal } from './approval-history-modal';
import { FilePreviewModal, type FilePreviewTarget } from './file-preview-modal';
import { CompanySectionHeader, buildCompanyCounts, NO_COMPANY } from '@/components/company/company-tag';
import { SupplierPasswordResetPanel } from './password-reset-panel';
import { ChangeReviewPanel } from './change-review-panel';
import type { Supplier, SupplierListResponse } from '@/lib/types';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { AuthUser } from '@/lib/api/auth';
import { fetchCurrentUser } from '@/lib/api/auth';

type SupplierWithParts = Supplier & {
  contacts?: Array<{ id: string; name: string; phone: string; position?: string | null; isPrimary?: boolean }>;
  qualifications?: Array<{ id: string; type: string; name: string; fileUrl?: string | null; validFrom?: string | null; validTo?: string | null; attachments?: Array<{ name?: string; url: string } | null> | null }>;
  /** 代审件标记（A 方案 2026-10-08；2026-10-09 扩 STAFF 孤儿 + leader 代初审）：后端展开查询时
   *  落标——admin 展开（ADMIN 级 OR 无 leader 公司的 LEADER 级 OR 无办公账号公司的 STAFF 级）对
   *  LEADER/STAFF 级落标；leader 展开（LEADER 级 OR 本公司无 staff 的 STAFF 级）仅对 STAFF 级落标 */
  delegatedReview?: boolean;
};

// ── 三级审批常量（与后端 SupplierService 同口径）──
const STAGE_META: Record<string, { label: string; short: string; color: string }> = {
  STAFF: { label: '初审', short: '初审', color: 'var(--accent)' },
  LEADER: { label: '复审', short: '复审', color: 'oklch(0.58 0.12 188)' },
  ADMIN: { label: '终审', short: '终审', color: 'oklch(0.57 0.15 25)' },
};
const STATUS_TABS = [
  { key: 'PENDING', label: '在审' },
  { key: 'RETURNED', label: '退回补正' },
  { key: 'REJECTED', label: '已驳回' },
] as const;
const PAGE_SIZE = 8;

export function ReviewCenterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [panel, setPanel] = useState<'registration' | 'changes'>('registration');
  // 通知直达预选（2026-09-30）：event detail supplierId → sessionStorage → 打开时预选该供应商
  const [preselectId, setPreselectId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [myCount, setMyCount] = useState({ registration: 0, changes: 0 });
  // 审核历史（admin only，2026-09-30）
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (open) fetchCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, [open]);
  useEffect(() => {
    if (open) {
      const id = sessionStorage.getItem('review-center-preselect');
      if (id) { setPreselectId(id); sessionStorage.removeItem('review-center-preselect'); }
    } else setPreselectId(null);
  }, [open]);
  // 关闭重开回到默认 panel（避免残留上次「信息更新审批」/某个状态筛选）
  useEffect(() => { if (!open) setPanel('registration'); }, [open]);
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
      description="注册审批 · 信息更新审批"
      size="2xl"
      className="!max-w-[min(1180px,96vw)]"
      headerExtra={myRole === 'admin' ? (
        <button type="button" onClick={() => setHistoryOpen(true)} className="neu-btn-soft !h-[30px] !px-3 !text-xs" title="查看全流程审批记录（三级通过+驳回+退回补正）">
          <History size={14} />审核历史
        </button>
      ) : undefined}
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
          <div className="neu-segment rc-segment-inline" role="group" aria-label="审批类型"
            data-count="2" data-index={String(panel === 'registration' ? 0 : 1)}>
            <span className="neu-segment-thumb" aria-hidden="true" />
            {([
              { key: 'registration', label: '注册审批', icon: Stamp, count: myCount.registration },
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

          <div className="rc-panel-stage">
            {panel === 'registration'
              ? <RegistrationPanel key={String(open)} myRole={myRole} onChanged={refreshBadge} preselectId={preselectId} />
              : <ChangesTabs />}
          </div>
        </div>
      )}

      {/* 审核历史窗口（admin，全流程记录） */}
      {myRole === 'admin' && <ApprovalHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />}

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
      <div className="neu-segment rc-segment-inline mb-3" role="group" aria-label="信息更新审批类型"
        data-count="3" data-index={String(TABS.findIndex(t => t.key === tab))}>
        <span className="neu-segment-thumb" aria-hidden="true" />
        {TABS.map(t => (
          <button key={t.key} type="button" className="neu-segment-btn" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
            {counts[t.key] > 0 && <span className="neu-segment-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>
      <div className="rc-changes-body">
        {tab === 'changes' && <ChangeReviewPanel />}
        {tab === 'tags' && <BusinessTagReview />}
        {tab === 'resets' && <SupplierPasswordResetPanel />}
      </div>
    </>
  );
}

/* ═══ 注册审批（三级）· 双栏：左列表 / 右详情+操作 ═══ */
function RegistrationPanel({ myRole, onChanged, preselectId }: { myRole?: string; onChanged: () => void; preselectId?: string | null }) {
  const [statusTab, setStatusTab] = useState<'PENDING' | 'RETURNED' | 'REJECTED'>('PENDING');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: PAGE_SIZE, items: [] });
  const [counts, setCounts] = useState<Record<string, number>>({ PENDING: 0, RETURNED: 0, REJECTED: 0 });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<ApprovalRecord[] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗数据加载（选中态驱动的标准拉取模式） */
  /** 可见性规则（2026-09-30 用户裁定）：
   *  在审（PENDING）按级隔离——每级只见待自己审的（staff=初审/leader=复审/admin=终审）；
   *  退回补正/已驳回不按级——admin 全见、同公司 leader 全见（公司域隔离已注入）、
   *  同公司 staff 仅见自己经手的（后端按 ApprovalRecord.reviewerUserId 过滤）。 */
  const myStageKey = myRole === 'admin' ? 'ADMIN' : myRole === 'leader' ? 'LEADER' : myRole === 'staff' ? 'STAFF' : null;
  const scopedStage = (status: string): string | undefined =>
    !myStageKey || status !== 'PENDING' ? undefined : myStageKey;

  const loadData = useCallback(() => {
    setLoading(true);
    getSupplierList({
      status: statusTab, page, pageSize: PAGE_SIZE, sort: 'completeness',
      ...(scopedStage(statusTab) ? { reviewStage: scopedStage(statusTab) } : {}),
    }).then(res => {
      setData(res);
      // 通知直达预选：命中则选中该供应商（仅首次，选中后清空）
      if (preselectId) {
        const hit = res.items.find(x => x.id === preselectId);
        if (hit) { setSelected(hit); }
      }
    }).catch(() => setData({ total: 0, page: 1, pageSize: PAGE_SIZE, items: [] }))
      .finally(() => setLoading(false));
  }, [statusTab, page, myRole, preselectId]);

  const loadCounts = useCallback(() => {
    Promise.all([
      getSupplierList({ status: 'PENDING', page: 1, pageSize: 1, ...(scopedStage('PENDING') ? { reviewStage: scopedStage('PENDING') } : {}) }),
      myRole === 'admin' ? Promise.resolve({ total: 0 }) : getSupplierList({ status: 'RETURNED', page: 1, pageSize: 1, ...(scopedStage('RETURNED') ? { reviewStage: scopedStage('RETURNED') } : {}) }),
      myRole === 'admin' ? Promise.resolve({ total: 0 }) : getSupplierList({ status: 'REJECTED', page: 1, pageSize: 1, ...(scopedStage('REJECTED') ? { reviewStage: scopedStage('REJECTED') } : {}) }),
    ]).then(([p, r, j]) => setCounts({ PENDING: p.total, RETURNED: r.total, REJECTED: j.total })).catch(() => {});
  }, [myRole]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { setPage(1); setSelected(null); }, [statusTab]);

  // 选中行 → 拉三级留痕（含附件解析）+ 完整注册资料（联系人/资质/账户/业绩，审批核对用）
  const [full, setFull] = useState<Supplier | null>(null);
  // 附件展示（2026-09-30）：recordId → 附件列表
  const [attachments, setAttachments] = useState<Record<string, ApprovalAttachment[]>>({});
  // 操作区待上传附件
  const [pendingAtts, setPendingAtts] = useState<Array<{ id: string; name: string; size: number }>>([]);
  const [attUploading, setAttUploading] = useState(false);
  // 文件窗口预览（2026-10-09）：查看文件/附件在弹窗内渲染，不再新开标签页
  const [filePreview, setFilePreview] = useState<FilePreviewTarget>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗选中项初始化重置，符合模态惯例 */
  useEffect(() => {
    if (!selected) { setHistory(null); setFull(null); setReason(''); setAttachments({}); return; }
    setHistory(null);
    setFull(null);
    setAttachments({});
    getApprovalHistory(selected.id).then(recs => {
      setHistory(recs);
      const ids = recs.flatMap(r => r.attachmentIds ?? []);
      if (ids.length) {
        resolveApprovalAttachments([...new Set(ids)]).then(list => {
          const map: Record<string, ApprovalAttachment[]> = {};
          for (const r of recs) {
            const mine = (r.attachmentIds ?? []).map(id => list.find(a => a.id === id)).filter(Boolean) as ApprovalAttachment[];
            if (mine.length) map[r.id] = mine;
          }
          setAttachments(map);
        }).catch(() => {});
      }
    }).catch(() => setHistory([]));
    getSupplier(selected.id).then(setFull).catch(() => setFull(null));
  }, [selected]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** 严格本级判定（2026-09-30 用户裁定）：「待我审」标记与操作区只对我本人的级亮起——
   *  admin=终审(ADMIN)、leader=复审(LEADER)、staff=初审(STAFF)。
   *  代审兜底（公司无 staff/leader）由后端 assertStageApprover 放行，前端不预亮，防错位标记——
   *  例外一（2026-10-08 A 方案；扩 STAFF 孤儿）：admin 对代审件亮起（无 leader 公司的
   *  LEADER 级=代复审、无办公账号公司的 STAFF 级=代初审）；例外二（2026-10-09 用户报告）：
   *  leader 对本公司 STAFF 代审件亮起（公司无在编 staff 时 leader 代初审）。均依据后端
   *  delegatedReview 标记（列表/角标已同口径展开），对齐「能审就可见」。 */
  const isMyStage = (s: Supplier): boolean => {
    const st = (s.reviewStage ?? 'STAFF') as string;
    if (myRole === 'admin') return st === 'ADMIN' || !!(s as SupplierWithParts).delegatedReview;
    if (myRole === 'leader') return st === 'LEADER' || (st === 'STAFF' && !!(s as SupplierWithParts).delegatedReview);
    if (myRole === 'staff') return st === 'STAFF';
    return false;
  };
  const canActOnStage = isMyStage;

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
      const attIds = pendingAtts.map(a => a.id); // 意见附件（2026-09-30）
      if (type === 'approve') {
        const res = await approveSupplier(selected.id, reason.trim() || undefined, attIds);
        toast.success(res.stage === 'DONE' ? `「${selected.name}」三级审核全部通过，已正式入库` : `「${selected.name}」已通过${STAGE_META[st]?.short ?? ''}，流转至${STAGE_META[res.stage ?? '']?.short ?? '下一级'}`);
      } else if (type === 'reject') {
        await rejectSupplier(selected.id, reason.trim(), attIds);
        toast.success(`已驳回「${selected.name}」（${STAGE_META[st]?.short ?? ''}环节）`);
      } else if (type === 'return') {
        await returnSupplier(selected.id, reason.trim(), attIds);
        toast.success(`已退回「${selected.name}」补正（补正后回到${STAGE_META[st]?.short ?? ''}环节）`);
      } else {
        await reactivateSupplier(selected.id);
        toast.success(`「${selected.name}」已复活，重新进入三级审核`);
      }
      setSelected(null); setReason(''); setPendingAtts([]);
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
        {(() => {
        // admin 不可见退回/驳回（2026-09-30 用户裁定）：其状态切换只保留「在审」
        const visibleTabs = myRole === 'admin' ? STATUS_TABS.filter(t => t.key === 'PENDING') : STATUS_TABS;
        return (
        <div className="neu-segment rc-segment-inline !text-xs" role="group" aria-label="按状态筛选申请"
          style={{ '--segs': visibleTabs.length } as React.CSSProperties}
          data-index={String(visibleTabs.findIndex(t => t.key === statusTab))}>
          <span className="neu-segment-thumb" aria-hidden="true" />
          {visibleTabs.map(t => (
            <button key={t.key} type="button" className="neu-segment-btn" aria-pressed={statusTab === t.key}
              onClick={() => setStatusTab(t.key)}>
              {t.label}
              {counts[t.key] > 0 && <span className="neu-segment-count">{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        );
        })()}
        <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto">
          {loading ? (
            [0, 1, 2].map(i => (
              <div key={i} className="rc-skel-row">
                <div className="rc-skel h-8 w-8 rounded-lg" />
                <div className="flex-1"><div className="rc-skel h-3 w-3/5" /><div className="rc-skel mt-1.5 h-2 w-2/5" /></div>
                <div className="rc-skel h-4 w-10 rounded-full" />
              </div>
            ))
          ) : data.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-xs text-[var(--muted-foreground)]">
              <Building2 size={18} className="opacity-60" />
              暂无{statusTab === 'PENDING' ? '在审' : statusTab === 'RETURNED' ? '退回补正' : '已驳回'}申请
            </div>
          ) : (() => {
            // admin 按公司分组（供应商管理/专家管理同款，CompanySectionHeader）；其余角色平铺
            const groups = myRole === 'admin'
              ? buildCompanyCounts(data.items.map(x => ({ company: x.companyName })))
              : null;
            const renderRow = (s: Supplier) => {
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
                    {meta && (
                      <span className="rc-stage-chip" style={{ '--rc-accent': meta.color } as React.CSSProperties}
                        title={(s as SupplierWithParts).delegatedReview
                          ? (st === 'STAFF'
                            ? (myRole === 'leader' ? '归属公司无在编 staff，由您（同公司 leader）代初审' : '归属公司无在编办公账号，平台 admin 代初审')
                            : '归属公司无在编 leader，平台 admin 代复审')
                          : undefined}>
                        {(s as SupplierWithParts).delegatedReview ? (st === 'STAFF' ? '初审·代审' : '复审·代审') : meta.short}
                      </span>
                    )}
                    {mine && <span className="text-[9px] font-bold text-[var(--success)]">待我审</span>}
                  </div>
                </button>
              );
            };
            if (groups) {
              return (
                <div className="flex flex-col gap-2">
                  {groups.map(g => {
                    const rows = data.items.filter(x => ((x.companyName ?? '').trim() || NO_COMPANY) === g.name);
                    return (
                      <div key={g.name}>
                        <CompanySectionHeader name={g.name} count={g.count} />
                        <div className="mt-1.5 flex flex-col">{rows.map(renderRow)}</div>
                      </div>
                    );
                  })}
                </div>
              );
            }
            return data.items.map(renderRow);
          })()}
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

      {/* ── 右栏：单一详情卡（hairline 分段：摘要头 → 三级进度 → 注册资料 → 固定操作区）── */}
      <div className="rc-split-detail">
        {!selected ? (
          <div className="rc-detail-card flex-1 items-center justify-center">
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center flex-1">
              <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><Stamp size={22} className="text-[var(--muted-foreground)]" /></div>
              <p className="text-sm font-bold text-[var(--foreground)]">选择左侧申请查看资料并审核</p>
            </div>
          </div>
        ) : (
          <div className="rc-detail-card">
            {/* 卡头：摘要 */}
            <div className="rc-detail-head">
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

            <div className="rc-detail-body">
              {/* 分段一：三级审核进度（stepper） */}
              <div className="rc-section">
                <div className="rc-section-label">审核进度</div>
                {history === null ? (
                  <div className="flex flex-col gap-2">
                    <div className="rc-skel h-3 w-1/2" /><div className="rc-skel h-3 w-2/5" />
                  </div>
                ) : (
                  <div className="rc-stepper">
                    {(['STAFF', 'LEADER', 'ADMIN'] as const).map(st => {
                      const rec = history.find(h => h.stage === st && h.action === 'APPROVED');
                      const done = !!rec;
                      const current = selStage === st && selected.status !== 'REJECTED';
                      const meta = STAGE_META[st];
                      const rejectedHere = selected.status === 'REJECTED' && !done && st === selStage;
                      return (
                        <div key={st} className={['rc-step', done ? 'rc-step--done' : '', current ? 'rc-step--current' : ''].join(' ').trim()}
                          style={current ? ({ '--rc-accent': meta.color } as React.CSSProperties) : undefined}>
                          <span className="rc-step-dot">{done ? '✓' : current ? '•' : rejectedHere ? '×' : '○'}</span>
                          <div className="min-w-0 pb-1 leading-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-bold text-[var(--foreground)]">{meta.label}</span>
                              {rec && rec.stage === 'LEADER' && rec.reviewer?.role === 'admin' && (
                                <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]" title="归属公司无在编 leader，平台 admin 代复审">代复审</span>
                              )}
                              {rec && rec.stage === 'STAFF' && (rec.reviewer?.role === 'leader' || rec.reviewer?.role === 'admin') && (
                                <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]"
                                  title={rec.reviewer?.role === 'leader' ? '归属公司无在编 staff，同公司 leader 代初审' : '归属公司无在编办公账号，平台 admin 代初审'}>代初审</span>
                              )}
                              {current && <span className="rc-cur-badge">当前级</span>}
                              {rejectedHere && <span className="text-[9px] font-bold text-[var(--danger)]">在此级被驳回</span>}
                            </div>
                            {rec && (
                              <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                                <span className="tabular-nums">{rec.reviewer?.displayName}</span>
                                <span className="tabular-nums"> · {new Date(rec.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                                {rec.reason && <span className="text-[var(--foreground)]"> — {rec.reason}</span>}
                              </div>
                            )}
                            {rec && (attachments[rec.id] ?? []).length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {attachments[rec.id].map(att => (
                                  <button key={att.id} type="button"
                                    onClick={() => setFilePreview({ src: `/api/upload/files/${att.id}`, name: att.name })}
                                    className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold text-[var(--accent)] hover:underline"
                                    style={{ background: 'oklch(1 0 0 / 0.55)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 1px 2px oklch(0.55 0.03 258 / 0.07)' }}
                                    title={`${att.name} · ${(att.size / 1024).toFixed(0)}KB · 窗口预览附件内容`}>
                                    <Paperclip size={10} />{att.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 分段二：注册申请资料 */}
              {full === null ? (
                <div className="rc-section"><div className="rc-section-label">注册申请资料</div>
                  <div className="flex flex-col gap-2"><div className="rc-skel h-3 w-2/3" /><div className="rc-skel h-3 w-1/2" /><div className="rc-skel h-3 w-3/5" /></div>
                </div>
              ) : (
                <div className="rc-section">
                  <div className="rc-section-label">注册申请资料</div>
                  <dl className="rc-field-grid">
                    {([
                      ['法定代表人', full.legalPerson], ['法人电话', full.legalPersonPhone],
                      ['企业类型', normalizeEnterpriseType(full.enterpriseType || '')], ['注册资本', full.registeredCapital],
                      ['所属行业', full.industry], ['成立日期', full.establishedDate ? new Date(full.establishedDate).toLocaleDateString('zh-CN') : null],
                      ['国别/区域', [full.country, full.region].filter(Boolean).join(' · ') || null], ['归属公司', full.companyName],
                      ['注册地址', full.registeredAddress], ['经营范围', full.businessScope],
                    ] as const).map(([k, v]) => (
                      <div key={k} className="rc-field"><dt>{k}</dt><dd title={v ?? ''}>{v || '—'}</dd></div>
                    ))}
                  </dl>
                  {(full as SupplierWithParts).contacts?.length ? (
                    <div className="mt-2.5">
                      <div className="mb-1 text-[10px] font-bold text-[var(--muted-foreground)]">联系人</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(full as SupplierWithParts).contacts!.map(c => (
                          <span key={c.id} className="rounded-lg px-2 py-1 text-[10px] leading-4"
                            style={{ background: 'oklch(0.965 0.012 258 / 0.8)' }}>
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
                    <div className="mt-2.5">
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
                            {q.fileUrl && (
                              <button type="button" onClick={() => setFilePreview({ src: q.fileUrl!, name: q.name })}
                                className="font-bold text-[var(--accent)] hover:underline" title="窗口预览">查看文件</button>
                            )}
                            {(q.attachments ?? []).filter((a) => a?.url).map((a, ai) => (
                              <button key={`${q.id}-att-${ai}`} type="button"
                                onClick={() => setFilePreview({ src: a.url, name: a.name || `${q.name}·附加材料${ai + 1}` })}
                                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-px font-bold text-[var(--accent)] hover:underline"
                                style={{ background: 'oklch(1 0 0 / 0.55)' }}
                                title="窗口预览附加材料">
                                <Paperclip size={10} />{a.name || `附加材料${ai + 1}`}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">未提交资质证照</p>}
                </div>
              )}
            </div>

            {/* 固定操作区（卡内底部） */}
            {statusTab === 'REJECTED' ? (
              <div className="rc-detail-foot flex items-center justify-between">
                <span className="text-[10px] text-[var(--muted-foreground)]">被拒申请仅管理员可复活</span>
                {myRole === 'admin' && (
                  <button type="button" className="neu-btn-soft !h-[32px] !text-xs" disabled={busy} onClick={() => void act('reactivate')}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : null}复活重审（重走三级）
                  </button>
                )}
              </div>
            ) : canActOnStage(selected) ? (
              <div className="rc-detail-foot flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-[var(--foreground)]">
                    {selStage === 'ADMIN' ? '终审意见（可选）' : `同意缘由（${STAGE_META[selStage]?.short ?? ''}必填 · 后级据此复核）`}
                  </span>
                  <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                    className="neu-input !text-[13px]" placeholder={selStage === 'ADMIN' ? '终审确认意见…' : '如：证照齐全、经营范围与采购需求匹配…'} />
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="neu-btn-xs cursor-pointer" title="随本次审核意见上传佐证附件">
                    {attUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}上传附件
                    <input type="file" multiple hidden onChange={e => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (!files.length) return;
                      // 加固：单文件 ≤20MB、总数 ≤10（超限拦截，不浪费上传带宽）
                      const oversize = files.filter(f => f.size > 20 * 1024 * 1024);
                      if (oversize.length) { toast.error(`文件超过 20MB：${oversize.map(f => f.name).join('、')}`); return; }
                      if (pendingAtts.length + files.length > 10) { toast.error('单个审核意见最多 10 个附件'); return; }
                      setAttUploading(true);
                      Promise.all(files.map(f => uploadReviewAttachment(f).then(r => ({ id: r.id, name: r.originalName, size: r.size })).catch(err => {
                        toast.error(`「${f.name}」上传失败：${(err as Error)?.message || '未知错误'}`);
                        return null;
                      })))
                        .then(added => {
                          const ok = added.filter(Boolean) as Array<{ id: string; name: string; size: number }>;
                          if (ok.length) setPendingAtts(prev => [...prev, ...ok]);
                        })
                        .finally(() => setAttUploading(false));
                    }} />
                  </label>
                  {pendingAtts.map((a, i) => (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold text-[var(--foreground)]"
                      style={{ background: 'oklch(1 0 0 / 0.55)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 1px 2px oklch(0.55 0.03 258 / 0.07)' }}
                      title={`${a.name} · ${(a.size / 1024).toFixed(0)}KB`}>
                      <Paperclip size={10} />{a.name}
                      <button type="button" className="opacity-60 hover:opacity-100" onClick={() => setPendingAtts(prev => prev.filter((_, j) => j !== i))} aria-label={`移除 ${a.name}`}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" className="neu-btn-xs is-danger" disabled={busy || attUploading} onClick={() => void act('reject')}>驳回</button>
                  <button type="button" className="neu-btn-xs" disabled={busy || attUploading} onClick={() => void act('return')}>退回补正</button>
                  <button type="button" className="neu-btn-soft is-success !h-[32px] !text-xs !font-bold" disabled={busy || attUploading} title={attUploading ? '附件上传中…' : undefined} onClick={() => void act('approve')}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />}
                    {selStage === 'ADMIN' ? '终审通过 · 正式入库' : `通过 · 流转至${STAGE_META[selStage === 'STAFF' ? 'LEADER' : 'ADMIN']?.short}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rc-detail-foot text-center text-[11px] text-[var(--muted-foreground)]">
                当前为{STAGE_META[selStage]?.short ?? '—'}级，非本级审批人（后端按级校验）
              </div>
            )}
          </div>
        )}
      </div>

      {/* 文件窗口预览（2026-10-09）：查看文件/附件在弹窗内渲染，不再新开标签页 */}
      <FilePreviewModal target={filePreview} onClose={() => setFilePreview(null)} />
    </div>
  );
}
