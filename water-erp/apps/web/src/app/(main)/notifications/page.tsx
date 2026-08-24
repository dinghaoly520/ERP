'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, getNotificationLabel } from '@water-erp/shared';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '@/lib/api/notification';
import { handleNotificationClick } from '@/lib/notification-click';
import { Check, Bell, RefreshCw, CheckCheck, X, ChevronUp, ChevronDown, ChevronsUpDown, ArrowRight } from 'lucide-react';

type SortKey = 'createdAt' | 'type' | 'isRead';
type SortDir = 'asc' | 'desc';

export default function NotificationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'todo' | 'all'>('todo');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(() => {
    setLoading(true);
    listNotifications(tab, page, 20)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab, page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  const sortedItems = useMemo(() => {
    if (!sortKey) return items;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      if (sortKey === 'createdAt') { av = a.createdAt; bv = b.createdAt; }
      else if (sortKey === 'type') { av = a.type; bv = b.type; }
      else if (sortKey === 'isRead') { av = a.isRead ? 1 : 0; bv = b.isRead ? 1 : 0; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [items, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc'); }
    else if (sortDir === 'desc') setSortDir('asc');
    else { setSortKey(null); setSortDir('desc'); }
  };

  const onRead = async (id: string) => {
    await markNotificationRead(id);
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  };
  const onAllRead = async () => {
    await markAllNotificationsRead();
    setItems((xs) => xs.map((n) => ({ ...n, isRead: true })));
  };

  const handleAction = (n: NotificationItem) => {
    handleNotificationClick(n, router, (id) =>
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, isRead: true } : x))),
    );
  };

  /* ── 统计 ── */
  const unread = items.filter(n => !n.isRead).length;
  const actionable = items.filter(n => !n.isRead && !n.resolvedAt && getNotificationMeta(n.type).actionable).length;
  const resolved = items.filter(n => !!n.resolvedAt).length;

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero — 标题卡片 ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <Bell size={17} />
            </div>
            <div>
              <div className="page-hero__title">通知中心</div>
              <div className="page-hero__sub">供应商审批、价格审核、开标提醒等消息的统一收发与待办处理</div>
            </div>
          </div>

          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            {unread > 0 && (
              <button onClick={onAllRead} className="neu-btn-soft">
                <CheckCheck size={15} /> 全部已读
              </button>
            )}
          </div>
        </div>

        {/* hairline 分割线 + KPI 行 */}
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <HeroStat label="未读消息" value={unread} signal={unread > 0 ? "warning" : "success"} sub="待查看通知" />
          <HeroStat label="待办事项" value={actionable} signal={actionable > 0 ? "danger" : "success"} sub="需立即处理" />
          <HeroStat label="已处理" value={resolved} sub="已完成归档" />
        </div>
        </div>
      </div>

      {/* ══════ 工具栏 + 表格 ══════ */}
      <div className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <div className="neu-tab-bar">
            <button onClick={() => { setTab('todo'); setPage(1); }} className={`neu-tab ${tab === 'todo' ? 'is-active' : ''}`}>
              待办
              {unread > 0 && <span className="neu-tab-count">{unread}</span>}
            </button>
            <button onClick={() => { setTab('all'); setPage(1); }} className={`neu-tab ${tab === 'all' ? 'is-active' : ''}`}>
              全部
              <span className="neu-tab-count">{total}</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[780px]">
            <thead>
              <tr>
                <SortTh label="时间" sortKey="createdAt" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <SortTh label="类型" sortKey="type" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <th>消息内容</th>
                <SortTh label="状态" sortKey="isRead" current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" />
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <RefreshCw size={22} className="animate-spin text-[var(--muted-foreground)]" />
                      </div>
                      <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
                    </div>
                  </td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <Check size={22} className="text-[var(--success)]" />
                      </div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {tab === 'todo' ? '待办已清零' : '暂无通知'}
                      </p>
                      <p className="max-w-[240px] text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
                        {tab === 'todo' ? '所有消息已处理完毕' : '开启信息发布或供应商审批后，消息将在此汇集'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : sortedItems.map(n => {
                const meta = getNotificationMeta(n.type);
                const canAct = meta.actionable && !n.resolvedAt && !!n.link;
                return (
                  <tr
                    key={n.id}
                    className={`row-clickable ${n.resolvedAt ? 'opacity-45' : ''}`}
                    data-selected={!n.isRead ? 'true' : 'false'}
                    onClick={() => !n.isRead && onRead(n.id)}
                  >
                    <td>
                      <time className="text-[0.8rem] tabular-nums text-[var(--muted-foreground)] whitespace-nowrap">
                        {new Date(n.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                        <span className="ml-1.5 text-[var(--muted-foreground)]/60">
                          {new Date(n.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </time>
                    </td>
                    <td>
                      <NotifTypeBadge type={n.type} meta={meta} />
                    </td>
                    <td onClick={e => { e.stopPropagation(); if (n.link) router.push(n.link); }}>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[0.85rem] font-bold text-[var(--foreground)] truncate">{n.title}</span>
                        <span className="text-[0.75rem] text-[var(--muted-foreground)] line-clamp-2 leading-relaxed">{n.content}</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center justify-center">
                        {n.resolvedAt ? (
                          <span className="rounded-[5px] bg-[var(--muted)]/60 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">已处理</span>
                        ) : !n.isRead ? (
                          <span className="inline-flex items-center gap-1 rounded-[5px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />未读
                          </span>
                        ) : (
                          <span className="rounded-[5px] bg-[var(--muted)]/50 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">已读</span>
                        )}
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center">
                        {canAct ? (
                          <button onClick={() => handleAction(n)} className="neu-btn-xs is-info">
                            <ArrowRight size={12} /> 处理
                          </button>
                        ) : n.link ? (
                          <button onClick={() => n.link && router.push(n.link)} className="neu-btn-xs">
                            查看
                          </button>
                        ) : (
                          <span className="text-[var(--muted-foreground)]/40">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">
              共 <strong className="font-semibold text-[var(--foreground)]">{total}</strong> 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30">
                <ChevronUp size={14} className="rotate-[-90deg]" />
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30">
                <ChevronUp size={14} className="rotate-90" />
              </button>
            </div>
          </div>
        )}
      </div>{/* /neu-table-card */}
    </div>
  );
}

/* ════════════ NotifTypeBadge — 通知类型胶囊标签 ════════════ */
const TONE_VAR: Record<string, string> = {
  green: 'var(--success)', blue: 'var(--accent)', orange: 'var(--warning)',
  red: 'var(--danger)', purple: 'var(--accent-strong)', gray: 'var(--muted-foreground)',
};

function NotifTypeBadge({ type, meta }: { type: string; meta: ReturnType<typeof getNotificationMeta> }) {
  const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
  const colorVar = TONE_VAR[meta.tone] ?? TONE_VAR.gray;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: colorVar, backgroundColor: `color-mix(in oklch, ${colorVar} 10%, transparent)` }}>
      <Icon size={13} strokeWidth={1.8} />
      {getNotificationLabel(type)}
    </span>
  );
}

/* ════════════ HeroStat — 与信息发布中心同款 kpi-card ════════════ */
function HeroStat({ label, value, sub, signal }: {
  label: string; value: number; sub?: string;
  signal?: "success" | "warning" | "danger";
}) {
  const sc = signal === "success" ? "bg-[var(--success)]" : signal === "warning" ? "bg-[var(--warning)]" : signal === "danger" ? "bg-[var(--danger)]" : "";
  const st = signal === "success" ? "text-[var(--success)]" : signal === "warning" ? "text-[var(--warning)]" : signal === "danger" ? "text-[var(--danger)]" : "";
  return (
    <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
        {signal && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] ${st}`}>
            <span className={`h-1 w-1 rounded-full shrink-0 ${sc}`} />{signal === "warning" ? "待处理" : signal === "danger" ? "待办" : "正常"}
          </span>
        )}
      </div>
      <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">
        {value >= 1000 ? value.toLocaleString() : value}
      </span>
      {sub && <span className="text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>}
    </div>
  );
}

/* ════════════ 可排序表头 ════════════ */
function SortTh({ label, sortKey, current, dir, onToggle, align = 'center' }: {
  label: string; sortKey: SortKey; current: SortKey | null; dir: SortDir; onToggle: (k: SortKey) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = current === sortKey;
  const Indicator = active ? (dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th data-sortable="true" data-sort={active ? dir : undefined} style={{ textAlign: align }}>
      <button type="button" className="neu-th-sort" onClick={() => onToggle(sortKey)}>
        <span>{label}</span>
        <span className="neu-sort-indicator"><Indicator size={12} /></span>
      </button>
    </th>
  );
}
