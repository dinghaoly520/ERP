'use client';

import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, getNotificationLabel, NOTIFICATION_LABEL } from '@water-erp/shared';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '@/lib/api/notification';
import { handleNotificationClick } from '@/lib/notification-click';
import { Check, Bell, RefreshCw, CheckCheck, X, ChevronUp, ChevronDown, ChevronsUpDown, ArrowRight, CornerDownRight, Inbox, Users, Gavel, FileArchive, Megaphone, ClipboardList } from 'lucide-react';

type SortKey = 'createdAt' | 'type' | 'isRead';
type SortDir = 'asc' | 'desc';

/** 通知域分组（tab）——按业务域聚合类型，处理入口一目了然 */
const DOMAIN_TABS: { key: string; label: string; icon: any; types: string[] }[] = [
  { key: 'all', label: '全部', icon: Inbox, types: [] },
  { key: 'todo', label: '待办', icon: ClipboardList, types: [] },
  { key: 'supplier', label: '供应商', icon: Users, types: ['SUPPLIER_PENDING', 'SUPPLIER_APPROVED', 'SUPPLIER_REJECTED', 'SUPPLIER_RETURNED', 'SUPPLIER_BLACKLISTED', 'SUPPLIER_UNBLACKLISTED', 'SUPPLIER_ELIMINATE_CANDIDATE', 'USER_REGISTRATION_PENDING', 'ACCOUNT_SECURITY_FEEDBACK', 'SELECTION_SHARED'] },
  { key: 'bid', label: '开评标', icon: Gavel, types: ['BID_INVITED', 'BID_NUDGE_EXPERT', 'BID_NUDGE_SUPPLIER', 'BID_OPENING_STARTED', 'BID_OPENING_CONFIRMED', 'BID_OPENING_HANDED_OVER', 'BID_EVALUATION_STARTED', 'BID_ABORTED', 'EXPERT_ASSIGNED', 'EXPERT_RETIRE_CANDIDATE', 'CLARIFICATION'] },
  { key: 'archive', label: '归档', icon: FileArchive, types: ['ARCHIVE_READY', 'ARCHIVE_TRANSFER_DUE', 'ARCHIVE_OVERDUE'] },
  { key: 'ann', label: '公告', icon: Megaphone, types: ['ANNOUNCEMENT_PUBLISHED', 'AWARD_LETTER', 'PROFILE_CHANGE_REVIEWED', 'PASSWORD_CHANGE_REVIEWED', 'PASSWORD_RESET_APPROVED', 'QUALIFICATION_EXPIRING'] },
];

export default function NotificationsPage() {
  const router = useRouter();
  const [domain, setDomain] = useState('todo');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [todoCount, setTodoCount] = useState(0);
  const [totalAll, setTotalAll] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [typeCounts, setTypeCounts] = useState<{ type: string; count: number }[]>([]);

  // 当前业务域的类型集合（全部/待办 域为 [] = 不限定类型）
  const domainBaseTypes = useMemo(
    () => DOMAIN_TABS.find(t => t.key === domain)?.types ?? [],
    [domain],
  );

  const activeTypes = useMemo(() => {
    if (typeFilter) return [typeFilter];
    return domainBaseTypes;
  }, [domainBaseTypes, typeFilter]);

  // 竞态守卫：切标签时旧请求的响应不得覆盖新标签的列表（快速切换时旧响应晚到
  // 会把内容换回上一个域——即「点每个标签内容都一样/卡顿」的根源）
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    // todo 域 = 服务端待办 tab + 可叠加类型筛选；其余域 = all + types
    const tab = domain === 'todo' ? 'todo' : 'all';
    const types = activeTypes.length ? activeTypes : undefined;
    // countTypes = 域基底（不含单类型筛选），保证类型 chip 选中后不消失
    const countTypes = domainBaseTypes.length ? domainBaseTypes : undefined;
    listNotifications(tab, page, 20, types, countTypes)
      .then((r) => {
        if (seq !== loadSeq.current) return; // 已切走，丢弃过期响应
        setItems(r.items);
        setTotal(r.total);
        setUnreadCount(r.unreadCount ?? 0);
        setTodoCount(r.todoCount ?? 0);
        if (tab === 'all') setTotalAll(r.total);
        setTypeCounts(r.typeCounts ?? []);
      })
      .catch(() => { if (seq === loadSeq.current) { setItems([]); setTypeCounts([]); } })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }, [domain, page, activeTypes, domainBaseTypes]);

  useEffect(() => { load(); }, [load]);
  // 注：page/typeFilter 的重置已并入各点击 handler（与 setDomain 同批渲染），
  // 不再用独立 effect 重置——那会触发第二次 load，快速切换时双请求竞态

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

  /* ── 同类聚合（2026-09-16）：type+title 相同折叠为一组，展开看逐条记录 ──
     定时任务/批量场景会让同内容通知反复生成（如归档待办一天 8 条），逐条平铺刷屏 */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  type NotifGroup = { key: string; list: NotificationItem[]; latest: NotificationItem; unread: number };

  const groups = useMemo<NotifGroup[]>(() => {
    const map = new Map<string, NotificationItem[]>();
    for (const n of sortedItems) {
      const k = `${n.type}::${n.title}`;
      const arr = map.get(k);
      if (arr) arr.push(n);
      else map.set(k, [n]);
    }
    const gs = [...map.values()].map((list) => {
      const byTime = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return {
        key: `${byTime[0].type}::${byTime[0].title}`,
        list: byTime,
        latest: byTime[0],
        unread: list.filter((x) => !x.isRead).length,
      };
    });
    // 组级排序沿用表头排序键：时间→组最新时间；类型→组类型；状态→组内是否有未读
    const dir = sortDir === 'asc' ? 1 : -1;
    return gs.sort((a, b) => {
      if (sortKey === 'type') return (a.latest.type < b.latest.type ? -1 : a.latest.type > b.latest.type ? 1 : 0) * dir;
      if (sortKey === 'isRead') return ((a.unread > 0 ? 0 : 1) - (b.unread > 0 ? 0 : 1)) * dir;
      return (a.latest.createdAt < b.latest.createdAt ? -1 : a.latest.createdAt > b.latest.createdAt ? 1 : 0) * dir;
    });
  }, [sortedItems, sortKey, sortDir]);

  // 待办域：已读即从列表移除（待办=未读+未处理，标记已读后不应继续显示）
  const onRead = async (id: string) => {
    await markNotificationRead(id);
    setUnreadCount((c) => Math.max(0, c - 1));
    setTodoCount((c) => Math.max(0, c - 1));
    if (domain === 'todo') {
      setItems((xs) => xs.filter((n) => n.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } else {
      setItems((xs) => xs.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    }
  };
  const onAllRead = async () => {
    await markAllNotificationsRead();
    setUnreadCount(0);
    setTodoCount(0);
    if (domain === 'todo') { setItems([]); setTotal(0); }
    else setItems((xs) => xs.map((n) => ({ ...n, isRead: true })));
  };

  const handleAction = (n: NotificationItem) => {
    handleNotificationClick(n, router, (id) => {
      if (domain === 'todo') {
        setItems((xs) => xs.filter((x) => x.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      } else {
        setItems((xs) => xs.map((x) => (x.id === id ? { ...x, isRead: true } : x)));
      }
    });
  };

  /* ── 统计（2026-09-09：服务端元信息口径，不再用当前页 items 估算导致与实际不符） ── */
  const unread = unreadCount;
  const actionable = todoCount;
  const resolved = Math.max(0, totalAll - unreadCount); // 已知晓 ≈ 全部 - 未读（含已处理/已读）

  /* ── 当前域下出现的类型（供类型筛选条，服务端 typeCounts 口径） ── */
  const presentTypes = typeCounts;

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <Bell size={17} />
            </div>
            <div>
              <div className="page-hero__title">通知管理</div>
              <div className="page-hero__sub">站内通知统一收发：供应商事务、开评标调度、归档督办与账号安全待办</div>
            </div>
          </div>

          <div className="page-hero__right">
            {unread > 0 && (
              <button onClick={onAllRead} className="neu-btn-soft">
                <CheckCheck size={15} /> 全部已读
              </button>
            )}
            <button onClick={() => { setPage(1); setTypeFilter(null); load(); }} disabled={loading} className="neu-btn-xs" aria-label="刷新">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* KPI 行常驻（2026-09-09 拍板：选类型/切域均不隐藏），全局服务端口径 */}
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <HeroStat label="未读消息" value={unread} signal={unread > 0 ? "warning" : "success"} sub="全局待查看" />
          <HeroStat label="待办事项" value={actionable} signal={actionable > 0 ? "danger" : "success"} sub="需立即处理" />
          <HeroStat label="已处理" value={resolved} sub="已完成归档" />
        </div>
      </div>

      {/* ══════ 工具栏 + 表格 ══════ */}
      <div className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <div className="neu-tab-bar">
            {DOMAIN_TABS.map(t => (
              <button key={t.key} onClick={() => { setDomain(t.key); setPage(1); setTypeFilter(null); }} className={`neu-tab ${domain === t.key ? 'is-active' : ''}`}>
                <t.icon size={13} strokeWidth={1.9} />
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
            {total} 条{!loading && sortedItems.length > 0 ? ` · 聚合 ${groups.length} 组` : ''}
          </span>
        </div>

        {/* 类型筛选条（当前域实际出现的类型） */}
        {(presentTypes.length > 1 || typeFilter) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] px-4 py-2.5">
            <button onClick={() => { setTypeFilter(null); setPage(1); }} className={`neu-btn-xs !h-6 !text-[10px] ${!typeFilter ? 'is-info' : ''}`}>全部类型</button>
            {presentTypes.slice(0, 12).map(({ type, count }) => (
              <button key={type} onClick={() => { setTypeFilter(typeFilter === type ? null : type); setPage(1); }}
                className={`neu-btn-xs !h-6 !text-[10px] ${typeFilter === type ? 'is-info' : ''}`}>
                {getNotificationLabel(type)} <span className="tabular-nums opacity-60">{count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[820px]">
            <thead>
              <tr>
                <SortTh label="时间" sortKey="createdAt" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <SortTh label="类型" sortKey="type" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <th>消息内容</th>
                <SortTh label="状态" sortKey="isRead" current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" width={110} />
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                      <RefreshCw size={22} className="animate-spin text-[var(--muted-foreground)]" />
                    </div>
                    <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
                  </div>
                </td></tr>
              ) : sortedItems.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                      <Check size={22} className="text-[var(--success)]" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {typeFilter ? '该类型下暂无通知' : domain === 'todo' ? '待办已清零' : '此分类下暂无通知'}
                    </p>
                    <p className="max-w-[260px] text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
                      供应商审批、开评标调度、归档督办等消息将按业务域在此汇集
                    </p>
                  </div>
                </td></tr>
              ) : groups.map(g => {
                const meta = getNotificationMeta(g.latest.type);
                const canAct = meta.actionable && !g.latest.resolvedAt && !!g.latest.link;
                const expanded = expandedGroups.has(g.key);
                return (
                  <Fragment key={g.key}>
                    {/* ── 组主行：最新一条 + 条数徽标；单条组行为与旧版一致 ── */}
                    <tr className={`row-clickable cursor-pointer ${g.latest.resolvedAt ? 'opacity-45' : ''}`}
                      data-selected={g.unread > 0 ? 'true' : 'false'}
                      onClick={() => {
                        if (g.list.length > 1) toggleGroup(g.key);
                        else if (!g.latest.isRead) onRead(g.latest.id);
                      }}>
                      <td>
                        <div className="flex flex-col items-start gap-1 whitespace-nowrap">
                          <time className="text-[0.8rem] tabular-nums text-[var(--muted-foreground)]">
                            {fmtTime(g.latest.createdAt)}
                          </time>
                          {g.list.length > 1 && (
                            <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--muted-foreground)]" title={`同类通知 ${g.list.length} 条`}>
                              ×{g.list.length}
                            </span>
                          )}
                        </div>
                      </td>
                      <td><NotifTypeBadge type={g.latest.type} meta={meta} /></td>
                      <td style={{ textAlign: 'left' }} onClick={e => { e.stopPropagation(); if (g.latest.link) router.push(g.latest.link); }}>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[0.82rem] text-[var(--foreground)] line-clamp-2 leading-relaxed" title={g.latest.content}>{g.latest.content}</span>
                          {g.list.length > 1 && (
                            <button onClick={e => { e.stopPropagation(); toggleGroup(g.key); }}
                              className="neu-btn-xs !h-5 !px-1.5 !text-[10px] mt-0.5 w-fit">
                              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                              {g.list.length} 条记录
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-center">
                          <StatusChip item={g.latest} unreadCount={g.unread} grouped={g.list.length > 1} />
                        </div>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center">
                          {canAct ? (
                            <button onClick={() => handleAction(g.latest)} className="neu-btn-xs is-info">
                              <ArrowRight size={12} /> 处理
                            </button>
                          ) : g.latest.link ? (
                            <button onClick={() => g.latest.link && router.push(g.latest.link)} className="neu-btn-xs">查看</button>
                          ) : (
                            <span className="text-[var(--muted-foreground)]/40">—</span>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ── 展开子行：该组每条记录（时间/内容/状态/操作独立） ── */}
                    {expanded && g.list.map(n => {
                      const nMeta = getNotificationMeta(n.type);
                      const nCanAct = nMeta.actionable && !n.resolvedAt && !!n.link;
                      return (
                        <tr key={n.id}
                          className={`row-clickable cursor-pointer bg-[color-mix(in_oklch,var(--muted-foreground)_4%,transparent)] [&>td]:!py-1.5 ${n.resolvedAt ? 'opacity-45' : ''}`}
                          data-selected={!n.isRead ? 'true' : 'false'}
                          onClick={() => !n.isRead && onRead(n.id)}>
                          <td>
                            <time className="text-[0.72rem] tabular-nums text-[var(--muted-foreground)]/80 whitespace-nowrap">
                              {fmtTime(n.createdAt)}
                            </time>
                          </td>
                          <td className="text-center">
                            <CornerDownRight size={13} className="mx-auto text-[var(--muted-foreground)]/50" aria-hidden />
                          </td>
                          <td style={{ textAlign: 'left' }} onClick={e => { e.stopPropagation(); if (n.link) router.push(n.link); }}>
                            <span className="text-[0.72rem] text-[var(--muted-foreground)] line-clamp-1 leading-relaxed" title={n.content}>{n.content}</span>
                          </td>
                          <td>
                            <div className="flex items-center justify-center">
                              <StatusChip item={n} />
                            </div>
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-center">
                              {nCanAct ? (
                                <button onClick={() => handleAction(n)} className="neu-btn-xs is-info !h-6">
                                  <ArrowRight size={11} /> 处理
                                </button>
                              ) : n.link ? (
                                <button onClick={() => n.link && router.push(n.link)} className="neu-btn-xs !h-6">查看</button>
                              ) : (
                                <span className="text-[var(--muted-foreground)]/40">—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
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
      </div>
    </div>
  );
}

/* ════════════ NotifTypeBadge ════════════ */
const TONE_VAR: Record<string, string> = {
  green: 'var(--success)', blue: 'var(--accent)', orange: 'var(--warning)',
  red: 'var(--danger)', purple: 'var(--accent-strong)', gray: 'var(--muted-foreground)',
};

/** 通知时间紧凑格式：MM/DD + HH:mm（弱化时分） */
function fmtTime(createdAt: string) {
  const d = new Date(createdAt);
  return (
    <>
      {d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
      <span className="ml-1.5 text-[var(--muted-foreground)]/60">
        {d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </>
  );
}

/** 状态 chip：单条=已处理/未读/已读；聚合组=带未读条数（如「未读 ×8」） */
function StatusChip({ item, unreadCount, grouped = false }: {
  item: Pick<NotificationItem, 'isRead' | 'resolvedAt'>;
  unreadCount?: number;
  grouped?: boolean;
}) {
  if (item.resolvedAt) {
    return <span className="rounded-[5px] bg-[var(--muted)]/60 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">已处理</span>;
  }
  if (!item.isRead) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[5px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        未读{grouped && unreadCount ? ` ×${unreadCount}` : ''}
      </span>
    );
  }
  return <span className="rounded-[5px] bg-[var(--muted)]/50 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">已读</span>;
}

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

/* ════════════ HeroStat ════════════ */
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

/* ════════════ SortTh ════════════ */
function SortTh({ label, sortKey, current, dir, onToggle, align = 'center', width }: {
  label: string; sortKey: SortKey; current: SortKey | null; dir: SortDir; onToggle: (k: SortKey) => void; align?: 'left' | 'right' | 'center'; width?: number;
}) {
  const active = current === sortKey;
  const Indicator = active ? (dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th data-sortable="true" data-sort={active ? dir : undefined} style={{ textAlign: align, width }}>
      <button type="button" className="neu-th-sort" onClick={() => onToggle(sortKey)}>
        <span>{label}</span>
        <span className="neu-sort-indicator"><Indicator size={12} /></span>
      </button>
    </th>
  );
}
