'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, getNotificationLabel } from '@water-erp/shared';
import { portalURL } from '@water-erp/config';
import { AiPlanningPanel } from '@/components/work-arrangements/ai-planning-panel';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { NotificationItem, NotificationTab } from '@/lib/api/notification';
import { listNotifications, markNotificationRead } from '@/lib/api/notification';
import { Bell, Inbox, ClipboardList, CircleCheck, BookOpen, CheckCheck, ArrowRight, Loader2 } from 'lucide-react';
import { handleNotificationClick } from '@/lib/notification-click';

export interface PlannedItem {
  title: string;
  estimatedMinutes: number;
  link: string;
}

/* ════════════════════════════════════════════════════════════════
 * 任务通知卡片（2026-09-27 重设计：与通知中心 /notifications 五段状态一致）
 *
 * 原为「业务域 tab + 同类聚合折叠」，现改为：
 *  - 五段状态分段器（全部/待办/已办/待阅/已阅），计数角标红/灰
 *  - 平铺不聚合，每条独立一行
 *  - 状态 chip（待办/待阅红、已办/已阅灰），行底色淡红/灰
 *  - 点击条目 = 标已读 + 跳 link（工作台是入口，完整审批/查看窗在通知中心）
 *  - 底部「查看全部」跳 /notifications；AI 规划面板保留
 * ════════════════════════════════════════════════════════════════ */

/** 条目状态（与通知中心 page.tsx 同口径） */
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

/** 兜底链接：仅在后端未下发 link 时使用（历史/种子写死的死链兜底修正）。
 *  澄清答疑/开标大厅归 :3007（分工 v3），:3005 无对应页面。 */
const TYPE_LINKS: Record<string, string> = {
  SUPPLIER_PENDING: '/supplier/approval',
  QUALIFICATION_EXPIRING: '/supplier/qualification-alerts',
  CATALOG_APPLICATION: '/mall-management/catalog?tab=approval',
  CATALOG_PRICE_ALERT: '/mall-management/catalog?tab=alerts',
  USER_REGISTRATION_PENDING: '/admin/accounts',
  ACCOUNT_SECURITY_FEEDBACK: '/admin/accounts',
};

function enrich(item: NotificationItem): NotificationItem & { link: string } {
  const forced =
    item.type === 'BID_OPENING' ? portalURL('bid', '/bid')
    : item.type === 'CLARIFICATION_REPLIED' ? portalURL('bid', '/bid')
    : null;
  const link = (forced ?? item.link ?? TYPE_LINKS[item.type]) || '/notifications';
  return { ...item, link };
}

interface TaskNotificationCenterProps {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  onRefreshPlan: () => void;
  onSelectTimeBlock: (taskIds: string[]) => void;
  onAddToCalendar: (items: PlannedItem[]) => void;
  hasActiveTasks?: boolean;
}

export function TaskNotificationCenter({
  dailyPlan, refreshingPlan,
  onRefreshPlan, onSelectTimeBlock, onAddToCalendar,
  hasActiveTasks = true,
}: TaskNotificationCenterProps) {
  const router = useRouter();
  const [tab, setTab] = useState<NotificationTab>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [segmentCounts, setSegmentCounts] = useState<{ all: number; todo: number; done: number; toread: number; read: number }>({ all: 0, todo: 0, done: 0, toread: 0, read: 0 });

  const load = (t: NotificationTab) => {
    setLoading(true);
    listNotifications(t, 1, 10)
      .then(r => { setItems(r.items); if (r.segmentCounts) setSegmentCounts(r.segmentCounts); })
      .catch(() => { setItems([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(tab); }, [tab]);

  const onAck = (id: string) => {
    // 标已读后刷新当前段（该条从待办/待阅转入已办/已阅）
    markNotificationRead(id).then(() => load(tab)).catch(() => load(tab));
  };

  const shown = items.slice(0, 8);

  return (
    <section className="wb-panel flex-1">
      <div className="wb-panel-header flex items-center justify-between">
        <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
        <span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">共 {segmentCounts.all} 条</span>
      </div>

      {/* 五段状态分段器（与通知中心一致） */}
      <div className="mx-3 mt-2">
        <div className="neu-segment" role="group" aria-label="通知状态" data-count="5"
          data-index={String(SEGMENT.findIndex(t => t.key === tab))}
          style={{ '--segs': 5 } as React.CSSProperties}>
          <span className="neu-segment-thumb" aria-hidden="true" />
          {SEGMENT.map(t => (
            <button key={t.key} type="button" className="neu-segment-btn" aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}>
              <t.icon size={13} strokeWidth={1.9} aria-hidden="true" /> {t.label}
              {t.key !== 'all' && segmentCounts[t.key] > 0 && (
                <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  t.key === 'todo' || t.key === 'toread'
                    ? 'bg-[var(--danger)] text-white'
                    : 'bg-[color-mix(in_oklch,var(--muted-foreground)_16%,transparent)] text-[var(--muted-foreground)]'}`}>
                  {segmentCounts[t.key] > 99 ? '99+' : segmentCounts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 平铺列表（不聚合） */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center"><Loader2 size={14} className="mx-auto animate-spin text-[var(--muted-foreground)]" /></div>
        ) : shown.length === 0 ? (
          <div className="py-8 text-center text-sm text-[color:var(--muted-foreground)]">此分类下暂无通知</div>
        ) : (
          <div>
            {shown.map(n => {
              const st = itemState(n);
              const isHot = st === 'todo' || st === 'toread';
              const e = enrich(n);
              const meta = getNotificationMeta(e.type);
              const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
              const toneColor = st === 'done' || st === 'read' ? 'var(--muted-foreground)' : st === 'todo' || st === 'toread' ? 'var(--danger)' : 'var(--accent)';
              return (
                <div key={e.id}
                  role="button" tabIndex={0}
                  onClick={() => handleNotificationClick(e, router)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleNotificationClick(e, router); } }}
                  className={`group flex w-full cursor-pointer flex-col gap-1 border-b border-[#eef3f8] px-4 py-3 text-left transition last:border-b-0 ${
                    isHot
                      ? 'bg-[color-mix(in_oklch,var(--danger)_4%,transparent)] hover:bg-[color-mix(in_oklch,var(--danger)_7%,transparent)]'
                      : 'bg-[color-mix(in_oklch,var(--muted-foreground)_4%,transparent)] opacity-70 hover:opacity-100'}`}
                >
                  {/* 首行：类型徽标 + 标题 + 状态 chip */}
                  <span className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                      style={{ backgroundColor: `color-mix(in oklch, ${toneColor} 10%, transparent)` }}>
                      <Icon size={12} style={{ color: toneColor }} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#18243a]">{e.title}</span>
                    <StateChip state={st} />
                  </span>
                  {/* 次行：内容 + 时间 */}
                  <span className="ml-[34px] flex items-center gap-2 text-[12px] text-[#5a6d8a]">
                    <span className="min-w-0 flex-1 truncate">{e.content}</span>
                    <time className="shrink-0 text-[10px] tabular-nums text-[#5a6d8a]/60">
                      {new Date(e.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </span>
                </div>
              );
            })}

            {/* 查看全部 */}
            <button
              type="button"
              onClick={() => router.push('/notifications')}
              className="flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-[12px] font-semibold text-[color:var(--accent)] transition hover:bg-[var(--accent-soft)]/10"
            >
              查看全部 <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>

      <hr className="wb-section-rule" />

      <div className="wb-panel-body">
        <AiPlanningPanel
          dailyPlan={dailyPlan} refreshingPlan={refreshingPlan}
          onRefreshPlan={() => onRefreshPlan()}
          onSelectTimeBlock={onSelectTimeBlock}
          hasActiveTasks={hasActiveTasks}
        />
      </div>
    </section>
  );
}

/** 状态 chip（与通知中心 StateChip 同配色）：待办/待阅红、已办/已阅灰 */
function StateChip({ state }: { state: 'todo' | 'done' | 'toread' | 'read' }) {
  const M: Record<string, { t: string; cls: string }> = {
    todo: { t: '待办', cls: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]' },
    toread: { t: '待阅', cls: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]' },
    done: { t: '已办', cls: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]' },
    read: { t: '已阅', cls: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]' },
  };
  const m = M[state];
  return <span className={`inline-flex shrink-0 items-center rounded-[5px] px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.t}</span>;
}
