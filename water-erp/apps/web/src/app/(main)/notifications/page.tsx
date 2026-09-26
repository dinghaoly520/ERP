'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getNotificationMeta, getNotificationLabel } from '@water-erp/shared';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, fetchMyActivities,
  type NotificationItem, type NotificationTab, type AuditActivity,
} from '@/lib/api/notification';
import { fetchCurrentUser } from '@/lib/api/auth';
import {
  fetchPendingProfileChanges, approveProfileChange, rejectProfileChange,
  fetchPendingRegistrations, approveRegistration, rejectRegistration,
} from '@/lib/api/auth';
import { getSupplier, approveSupplier, rejectSupplier, returnSupplier } from '@/lib/api/supplier';
import { Modal } from '@/components/workbench';
import type { Supplier } from '@/lib/types';
import {
  Bell, CheckCheck, Clock, History, Inbox, ClipboardList, CircleCheck, BookOpen,
  RefreshCw, Loader2, CheckCircle2, XCircle, RotateCcw, UserPlus, IdCard,
} from 'lucide-react';

/* ════════════════════════════════════════════════════════════════
 * 通知中心（2026-09-26 五段状态重构）
 *
 * 顶部分段：全部 / 待办 / 已办 / 待阅 / 已阅
 *  - 待办/已办 = 可操作类型（注册表 actionable）；resolvedAt 分界（已读兜底归已办）
 *  - 待阅/已阅 = 知会类型；isRead 分界，已阅带查阅时间 readAt
 * 不聚合：每条平铺，按时间倒序。待办/待阅行淡红、已办/已阅行灰。
 * 操作：
 *  - 待办「处理」→ 处理窗（窗内直接审批：资料变更/注册审核/供应商注册）
 *  - 已办「查看」→ 查看窗（全文 + 处理时间 + 操作结果记录）
 *  - 待阅/已阅「查看」→ 查看窗（全文；已阅显示查阅时间）
 * 标题栏右上角「操作历史」= 当前用户 AuditLog 时间线。
 * ════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 20;

/** 条目状态（与后端 list 五段口径一致） */
function itemState(n: NotificationItem): 'todo' | 'done' | 'toread' | 'read' {
  const actionable = getNotificationMeta(n.type).actionable;
  if (actionable) return (n.resolvedAt || n.isRead) ? 'done' : 'todo';
  return n.isRead ? 'read' : 'toread';
}

const SEGMENT: { key: NotificationTab; label: string; icon: any }[] = [
  { key: 'all', label: '全部', icon: Inbox },
  { key: 'todo', label: '待办', icon: ClipboardList },
  { key: 'done', label: '已办', icon: CircleCheck },
  { key: 'toread', label: '待阅', icon: BookOpen },
  { key: 'read', label: '已阅', icon: CheckCheck },
];

/** 审计动作 → 中文（操作历史/已办结果展示） */
const ACTION_LABEL: Record<string, string> = {
  PROFILE_CHANGE_APPROVED: '资料变更审批 · 通过',
  PROFILE_CHANGE_REJECTED: '资料变更审批 · 拒绝',
  USER_REGISTRATION_APPROVED: '注册审核 · 通过',
  USER_REGISTRATION_REJECTED: '注册审核 · 拒绝',
  SUPPLIER_APPROVED: '供应商审批 · 通过',
  SUPPLIER_REJECTED: '供应商审批 · 拒绝',
  SUPPLIER_RETURNED: '供应商审批 · 退回补正',
};

function fmt(dt: string | null | undefined) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function NotificationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<NotificationTab>('all'); // 默认打开「全部」
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // 窗口
  const [detail, setDetail] = useState<NotificationItem | null>(null);        // 查看（已办/待阅/已阅）
  const [handleItem, setHandleItem] = useState<NotificationItem | null>(null); // 处理（待办）
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activities, setActivities] = useState<AuditActivity[]>([]);
  const [detailActs, setDetailActs] = useState<AuditActivity[]>([]); // 已办窗内的结果记录

  const load = useCallback(() => {
    setLoading(true);
    listNotifications(tab, page, PAGE_SIZE)
      .then(r => { setItems(r.items); setTotal(r.total); })
      .catch(() => { setItems([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [tab, page]);

  useEffect(() => { load(); }, [load]);

  // 打开已办查看窗时拉取相关操作记录（同类型、时间晚于通知）
  const openDetail = useCallback((n: NotificationItem) => {
    setDetail(n);
    setDetailActs([]);
    if (itemState(n) === 'done') {
      fetchMyActivities(50).then(r => {
        const key = n.type === 'USER_REGISTRATION_PENDING' ? 'USER_REGISTRATION_'
          : n.type === 'PROFILE_CHANGE_PENDING' ? 'PROFILE_CHANGE_'
          : n.type === 'SUPPLIER_PENDING' ? 'SUPPLIER_' : null;
        setDetailActs(key
          ? r.items.filter(a => a.action.startsWith(key) && new Date(a.createdAt) >= new Date(n.createdAt)).slice(0, 3)
          : []);
      }).catch(() => {});
    }
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onRead = (id: string) => {
    void markNotificationRead(id).catch(() => {});
    setItems(xs => xs.map(x => (x.id === id ? { ...x, isRead: true, readAt: new Date().toISOString() } : x)));
  };

  const handleRowClick = (n: NotificationItem) => {
    if (itemState(n) === 'todo') setHandleItem(n);
    else openDetail(n);
  };

  /* ════════════ 渲染 ════════════ */
  return (
    <div className="flex flex-col gap-4">
      {/* ── 标题栏：右上角 全部标已读 / 操作历史 / 刷新 ── */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Bell size={17} /></div>
            <div>
              <div className="page-hero__title">通知中心</div>
              <div className="page-hero__sub">待办与已办按处理进度区分 · 待阅与已阅按查阅进度区分</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button className="neu-btn-xs" onClick={() => { void markAllNotificationsRead().then(() => load()); }}>
              <CheckCheck size={13} /> 全部标已读
            </button>
            <button className="neu-btn-soft" onClick={() => { setHistoryOpen(true); fetchMyActivities(50).then(r => setActivities(r.items)).catch(() => setActivities([])); }}>
              <History size={14} /> 操作历史
            </button>
            <button className="neu-btn-xs" onClick={load} aria-label="刷新"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>
        {/* hairline 下横线（cgzxui 规定：标题行与下方内容之间必有分割线，与其他页面高度一致） */}
        <div className="page-hero__divider" />
      </div>

      {/* ── 工具行：五段状态切换（左）+ 计数/图例（右）——仿公告页面工具行设计，不置于标题栏内 ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 五段分段器 */}
        <div className="neu-segment" role="group" aria-label="通知状态" data-count="5"
          data-index={String(Math.max(0, SEGMENT.findIndex(t => t.key === tab)))}
          style={{ '--segs': 5 } as React.CSSProperties}>
          <span className="neu-segment-thumb" aria-hidden="true" />
          {SEGMENT.map(t => (
            <button key={t.key} type="button" className="neu-segment-btn" aria-pressed={tab === t.key}
              onClick={() => { setTab(t.key); setPage(1); }}>
              <t.icon size={13} strokeWidth={1.9} aria-hidden="true" /> {t.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">共 {total} 条 · 第 {page}/{totalPages} 页</span>
        <div className="ml-auto flex items-center gap-3 text-[10px] font-semibold text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[4px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--danger)_28%,transparent)]" />待处理 / 待查阅</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[4px] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--muted-foreground)_22%,transparent)]" />已处理 / 已查阅</span>
        </div>
      </div>

      {/* ── 平铺列表（不聚合，时间倒序） ── */}
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[820px]">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th style={{ textAlign: 'left' }}>消息内容</th>
                <th>状态</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-16 text-center"><Loader2 size={16} className="mx-auto animate-spin text-[var(--muted-foreground)]" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="py-16 text-center text-sm text-[var(--muted-foreground)]">此分类下暂无通知</td></tr>
              ) : items.map(n => {
                const st = itemState(n);
                const isHot = st === 'todo' || st === 'toread';
                return (
                  <tr key={n.id}
                    className={`row-clickable cursor-pointer ${isHot
                      ? 'bg-[color-mix(in_oklch,var(--danger)_4%,transparent)] hover:bg-[color-mix(in_oklch,var(--danger)_7%,transparent)]'
                      : 'bg-[color-mix(in_oklch,var(--muted-foreground)_4%,transparent)] opacity-70 hover:opacity-100'}`}
                    onClick={() => handleRowClick(n)}>
                    <td className="whitespace-nowrap text-[0.78rem] tabular-nums text-[var(--muted-foreground)]">{fmt(n.createdAt)}</td>
                    <td><NotifTypeBadge type={n.type} /></td>
                    <td style={{ textAlign: 'left' }}>
                      <span className="line-clamp-1 text-[0.82rem] leading-relaxed text-[var(--foreground)]" title={n.content}>{n.content}</span>
                    </td>
                    <td><StateChip state={st} /></td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      {st === 'todo' ? (
                        <button className="neu-btn-xs" onClick={() => setHandleItem(n)}>处理</button>
                      ) : (
                        <button className="neu-btn-xs" onClick={() => openDetail(n)}>查看</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="neu-table-card-footer">
            <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button className="neu-btn-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
              <button className="neu-btn-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>→</button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ 查看窗（已办/待阅/已阅） ═══ */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title ?? '通知详情'}
        description={detail ? `${getNotificationLabel(detail.type)} · ${fmt(detail.createdAt)}` : undefined}
        footer={
          <>
            {detail && itemState(detail) === 'toread' && (
              <button className="neu-btn-soft !h-[38px]" onClick={() => { onRead(detail.id); setDetail(d => (d ? { ...d, isRead: true, readAt: new Date().toISOString() } : d)); }}>
                <CheckCheck size={14} /> 标为已阅
              </button>
            )}
            {detail?.link && itemState(detail) !== 'done' && (
              <button className="neu-btn-soft" onClick={() => { const n = detail; setDetail(null); router.push(n.link!); }}>
                跳转页面
              </button>
            )}
            <button className="neu-btn-soft" onClick={() => setDetail(null)}>关闭</button>
          </>
        }
      >
        {detail && <ViewBody n={detail} acts={detailActs} />}
      </Modal>

      {/* ═══ 处理窗（待办：窗内直接审批） ═══ */}
      {handleItem && (
        <HandleModal item={handleItem} onClose={() => setHandleItem(null)} onDone={() => { setHandleItem(null); load(); }} />
      )}

      {/* ═══ 操作历史（标题栏右上角） ═══ */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="操作历史"
        description="我在本系统的审批与处理操作记录（每次操作一条）"
        footer={<button className="neu-btn-soft" onClick={() => setHistoryOpen(false)}>关闭</button>}>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {activities.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无操作记录</p>
          ) : activities.map(a => (
            <div key={a.id} className="flex items-start gap-2.5 rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-3.5 py-2.5">
              <Clock size={13} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-[var(--foreground)]">{ACTION_LABEL[a.action] ?? a.action}</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {a.resourceType}{a.resourceId ? ` · ${a.resourceId}` : ''} · {fmt(a.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/* ════════════ 查看窗内容（已办带处理时间+结果；已阅带查阅时间） ════════════ */
function ViewBody({ n, acts }: { n: NotificationItem; acts: AuditActivity[] }) {
  const st = itemState(n);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <NotifTypeBadge type={n.type} />
        <StateChip state={st} />
      </div>
      <p className="whitespace-pre-wrap break-words rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)] px-4 py-3 text-[0.85rem] leading-relaxed text-[var(--foreground)]">
        {n.content}
      </p>
      {st === 'done' && (
        <div className="space-y-1.5 rounded-xl border border-dashed border-[color-mix(in_oklch,var(--muted-foreground)_25%,transparent)] px-4 py-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--foreground)]">
            <CircleCheck size={13} className="text-[var(--success)]" />
            处理时间：{n.resolvedAt ? fmt(n.resolvedAt) : n.readAt ? `${fmt(n.readAt)}（标记已阅）` : '—'}
          </p>
          {acts.length > 0 ? (
            acts.map(a => (
              <p key={a.id} className="pl-[19px] text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
                处理结果：{ACTION_LABEL[a.action] ?? a.action}{a.resourceId ? `（${a.resourceId}）` : ''} · {fmt(a.createdAt)}
              </p>
            ))
          ) : (
            <p className="pl-[19px] text-[11.5px] text-[var(--muted-foreground)]">处理结果：未找到留痕记录（早期操作或无需审批动作）</p>
          )}
        </div>
      )}
      {st === 'read' && (
        <p className="flex items-center gap-1.5 rounded-xl border border-dashed border-[color-mix(in_oklch,var(--muted-foreground)_25%,transparent)] px-4 py-3 text-[12px] font-semibold text-[var(--foreground)]">
          <BookOpen size={13} className="text-[var(--muted-foreground)]" />
          查阅时间：{n.readAt ? fmt(n.readAt) : '—'}
        </p>
      )}
    </div>
  );
}

/* ════════════ 处理窗：窗内直接处理（审批类通过/拒绝+原因必填；反馈类底部跳转） ════════════ */
type PendingRow = { id: string; title: string; sub: string };

function HandleModal({ item, onClose, onDone }: { item: NotificationItem; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<PendingRow[] | null>(null); // null=加载中，[]=无可审批项
  const [selected, setSelected] = useState(0);

  const supplierId = useMemo(() => {
    const m = /\/supplier\/([^/?]+)/.exec(item.link ?? '');
    return m?.[1] ?? null;
  }, [item.link]);

  const isApproval = ['PROFILE_CHANGE_PENDING', 'USER_REGISTRATION_PENDING', 'SUPPLIER_PENDING'].includes(item.type);
  const isSupplier = item.type === 'SUPPLIER_PENDING';

  // 拉取当前待处理项
  useEffect(() => {
    if (!isApproval) return;
    const setter = (list: PendingRow[]) => { setRows(list); setSelected(0); };
    if (item.type === 'PROFILE_CHANGE_PENDING') {
      fetchPendingProfileChanges().then(rs => setter((rs as any[]).map(r => ({
        id: r.id,
        title: r.user?.displayName ?? r.user?.username ?? '',
        sub: `变更字段：${Object.keys(r.payload ?? {}).join('、')} · ${fmt(r.requestedAt)}`,
      })))).catch(() => setter([]));
    } else if (item.type === 'USER_REGISTRATION_PENDING') {
      fetchPendingRegistrations().then(rs => setter((rs as any[]).map(r => ({
        id: r.id,
        title: `${r.displayName ?? r.username}${r.company ? `（${r.company}）` : ''}`,
        sub: '申请管理端账号',
      })))).catch(() => setter([]));
    } else if (supplierId) {
      getSupplier(supplierId).then(s => setter([{
        id: supplierId,
        title: s.name,
        sub: `信用代码 ${s.creditCode ?? '—'} · ${s.legalPerson ?? '—'} · 注册于 ${new Date(s.createdAt).toLocaleDateString('zh-CN')}`,
      }])).catch(() => setter([]));
    } else setter([]);
  }, [item.type, supplierId]);

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try { await fn(); toast.success(okMsg); onDone(); }
    catch (e: any) { toast.error(e?.message ?? '操作失败'); }
    setBusy(false);
  };

  const cur = rows && rows.length > 0 ? rows[Math.min(selected, rows.length - 1)] : null;

  const doApprove = () => {
    if (!cur) return;
    if (item.type === 'PROFILE_CHANGE_PENDING') return void act(() => approveProfileChange(cur.id), '已通过');
    if (item.type === 'USER_REGISTRATION_PENDING') return void act(() => approveRegistration(cur.id), '已通过');
    return void act(() => approveSupplier(cur.id), '已通过入库');
  };
  const doReject = () => {
    if (!cur) return;
    if (!reason.trim()) { toast.error('请填写原因'); return; }
    if (item.type === 'PROFILE_CHANGE_PENDING') return void act(() => rejectProfileChange(cur.id, reason.trim()), '已拒绝');
    if (item.type === 'USER_REGISTRATION_PENDING') return void act(() => rejectRegistration(cur.id, reason.trim()), '已拒绝');
    return void act(() => rejectSupplier(cur.id, reason.trim()), '已拒绝');
  };
  const doReturn = () => {
    if (!cur) return;
    if (!reason.trim()) { toast.error('请填写原因'); return; }
    void act(() => returnSupplier(cur.id, reason.trim()), '已退回补正');
  };

  return (
    <Modal open onClose={onClose}
      title={`处理 · ${getNotificationLabel(item.type)}`}
      description={fmt(item.createdAt)}
      footer={
        <>
          {isApproval ? (
            <>
              <button className="neu-btn-soft" onClick={onClose}>关闭</button>
              {isSupplier && <button className="neu-btn-soft" disabled={busy || !cur} onClick={doReturn}><RotateCcw size={14} /> 退回补正</button>}
              <button className="neu-btn-soft is-danger" disabled={busy || !cur} onClick={doReject}><XCircle size={14} /> 拒绝</button>
              <button className="neu-btn-soft is-success !h-[38px]" disabled={busy || !cur} onClick={doApprove}><CheckCircle2 size={14} /> 通过</button>
            </>
          ) : (
            <>
              <button className="neu-btn-soft" onClick={onClose}>关闭</button>
              {item.link && (
                <button className="neu-btn-soft !h-[38px]" onClick={() => { onClose(); router.push(item.link!); }}>跳转页面</button>
              )}
            </>
          )}
        </>
      }>
      <div className="flex flex-col gap-3">
        {isApproval ? (
          rows === null ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="mx-auto animate-spin" /></p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">当前没有待处理项（可能已被其他审批人处理）</p>
          ) : (
            <>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <button key={r.id} type="button" onClick={() => setSelected(i)}
                    className={`w-full rounded-xl px-4 py-3 text-left transition-all ${i === selected
                      ? 'bg-[oklch(1_0_0)] shadow-[inset_0_1px_0_oklch(1_0_0/0.95),2px_2px_6px_oklch(0.55_0.03_258/0.16),-1px_-1px_2px_oklch(1_0_0/0.9)] ring-1 ring-[color-mix(in_oklch,var(--accent)_35%,transparent)]'
                      : 'bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] hover:bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)]'}`}>
                    <span className={`block text-[13px] font-bold ${i === selected ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'}`}>{r.title}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">{r.sub}</span>
                  </button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-[var(--muted-foreground)]">审批原因（拒绝{isSupplier ? ' / 退回' : ''}时必填）</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="填写原因…" className="neu-input w-full !text-xs" />
              </div>
            </>
          )
        ) : (
          <p className="whitespace-pre-wrap break-words rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)] px-4 py-3 text-[0.85rem] leading-relaxed text-[var(--foreground)]">
            {item.content}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ════════════ 小组件 ════════════ */
const TONE_VAR: Record<string, string> = {
  green: 'var(--success)', blue: 'var(--accent)', orange: 'var(--warning)',
  red: 'var(--danger)', purple: 'var(--accent-strong)', gray: 'var(--muted-foreground)',
};

function NotifTypeBadge({ type }: { type: string }) {
  const meta = getNotificationMeta(type);
  const colorVar = TONE_VAR[meta.tone] ?? TONE_VAR.gray;
  return (
    <span className="inline-flex items-center rounded-[6px] px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: colorVar, background: `color-mix(in oklch, ${colorVar} 9%, transparent)` }}>
      {getNotificationLabel(type)}
    </span>
  );
}

function StateChip({ state }: { state: 'todo' | 'done' | 'toread' | 'read' }) {
  const M: Record<string, { t: string; cls: string }> = {
    todo: { t: '待办', cls: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]' },
    toread: { t: '待阅', cls: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]' },
    done: { t: '已办', cls: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]' },
    read: { t: '已阅', cls: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]' },
  };
  const m = M[state];
  return <span className={`inline-flex items-center rounded-[5px] px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.t}</span>;
}
