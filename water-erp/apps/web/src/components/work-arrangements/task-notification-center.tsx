'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Clock3, CalendarPlus, Sparkles } from 'lucide-react';
import { getNotificationMeta } from '@water-erp/shared';
import { NotificationKpiBar } from '@/components/work-arrangements/notification-kpi-bar';
import {
  NotificationCard,
  type NotificationUrgency,
} from '@/components/work-arrangements/notification-card';
import { AiPlanningPanel } from '@/components/work-arrangements/ai-planning-panel';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import { useNotifications } from '@/lib/hooks/use-notifications';
import type { NotificationItem } from '@/lib/api/notification';

export interface PlannedItem {
  title: string;
  estimatedMinutes: number;
  notificationId?: string;
}

const URGENCY_ORDER: Record<NotificationUrgency, number> = {
  urgent: 0,
  important: 1,
  normal: 2,
};

const URGENCY_MAP: Record<string, NotificationUrgency> = {
  SUPPLIER_PENDING: 'urgent',
  PRICE_REVIEW: 'important',
  QUALIFICATION_EXPIRING: 'important',
  BID_REMINDER: 'normal',
};

function getUrgency(type: string): NotificationUrgency {
  return URGENCY_MAP[type] ?? 'normal';
}

function sortByUrgency(items: NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => {
    const ua = URGENCY_ORDER[getUrgency(a.type)] ?? 99;
    const ub = URGENCY_ORDER[getUrgency(b.type)] ?? 99;
    if (ua !== ub) return ua - ub;
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function derivePlannedItems(
  todoItems: NotificationItem[],
  derivedTodo: { supplierPending: number; priceReview: number; expiringQualifications: number },
): PlannedItem[] {
  const items: PlannedItem[] = [];
  if (derivedTodo.supplierPending > 0) {
    items.push({
      title: '供应商审批',
      estimatedMinutes: 15,
      notificationId: todoItems.find((n) => n.type === 'SUPPLIER_PENDING')?.id,
    });
  }
  if (derivedTodo.priceReview > 0) {
    items.push({
      title: '价格复核',
      estimatedMinutes: 10,
      notificationId: todoItems.find((n) => n.type === 'PRICE_REVIEW')?.id,
    });
  }
  if (derivedTodo.expiringQualifications > 0) {
    items.push({
      title: '资质到期处理',
      estimatedMinutes: 10,
      notificationId: todoItems.find((n) => n.type === 'QUALIFICATION_EXPIRING')?.id,
    });
  }
  return items;
}

const MAX_VISIBLE = 6;

interface TaskNotificationCenterProps {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  showProjectBrief?: boolean;
  onRefreshPlan: () => void;
  onSelectTimeBlock: (taskIds: string[]) => void;
  onAddToCalendar: (items: PlannedItem[]) => void;
  onShowHistory: () => void;
}

export function TaskNotificationCenter({
  dailyPlan,
  refreshingPlan,
  showProjectBrief = false,
  onRefreshPlan,
  onSelectTimeBlock,
  onAddToCalendar,
  onShowHistory,
}: TaskNotificationCenterProps) {
  const router = useRouter();
  const { derivedTodo, todoItems, markRead } = useNotifications();
  const [expanded, setExpanded] = useState(false);

  const sortedItems = useMemo(() => sortByUrgency(todoItems), [todoItems]);

  const plannedItems = useMemo(
    () => derivePlannedItems(todoItems, derivedTodo),
    [todoItems, derivedTodo],
  );

  const totalMinutes = plannedItems.reduce((s, i) => s + i.estimatedMinutes, 0);
  const hasNotifications =
    derivedTodo.supplierPending > 0 ||
    derivedTodo.priceReview > 0 ||
    derivedTodo.expiringQualifications > 0;

  const visibleItems = expanded
    ? sortedItems
    : sortedItems.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, sortedItems.length - MAX_VISIBLE);

  const handleAction = async (item: NotificationItem) => {
    await markRead(item.id);
    const meta = getNotificationMeta(item.type);
    if (meta.actionable && item.link) {
      router.push(item.link);
    } else if (item.link) {
      router.push(item.link);
    }
  };

  return (
    <section className="wb-panel">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">
          任务通知
        </span>
      </div>
      <div className="wb-panel-body flex flex-col gap-4">
        {/* ── KPI 区 ── */}
        <NotificationKpiBar derivedTodo={derivedTodo} todoItems={todoItems} />

        {/* ── 通知卡片流 ── */}
        {sortedItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                待办事项 · {sortedItems.length} 项
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {visibleItems.map((item) => (
                <NotificationCard
                  key={item.id}
                  item={item}
                  onAction={handleAction}
                />
              ))}
            </div>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="neu-btn-xs mx-auto mt-1"
              >
                {expanded ? (
                  <>
                    <ChevronUp size={12} />
                    收起
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    查看全部 {hiddenCount} 条
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* ── 通知待办规划 ── */}
        {hasNotifications && (
          <div className="mt-1 rounded-[16px] bg-[var(--accent-soft)]/10 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--accent)]">
              <Sparkles size={13} />
              通知待办规划
            </p>

            {/* 处理顺序 */}
            <div className="mt-3 space-y-2">
              {plannedItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-[rgba(96,139,239,0.15)] text-[11px] font-bold text-[color:var(--accent)]">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-[13px] font-semibold text-[color:var(--foreground)]">
                    {item.title}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
                    <Clock3 size={10} />
                    约{item.estimatedMinutes}分钟
                  </span>
                </div>
              ))}
            </div>

            {/* 总数 + 推荐时段 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-[8px] bg-[rgba(96,139,239,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--accent)]">
                ⏱️ 预估 {totalMinutes} 分钟
              </span>
              <span className="rounded-[8px] bg-[rgba(96,139,239,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--accent)]">
                📍 建议 10:30-{totalMinutes > 30 ? '11:30' : '11:00'}
              </span>
            </div>

            {/* 策略简述 */}
            <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
              上午处理审批类事务效率最高，下午可专注项目跟进。
            </p>

            {/* 添加到日历 */}
            <button
              type="button"
              onClick={() => onAddToCalendar(plannedItems)}
              className="neu-btn-primary mt-3"
            >
              <CalendarPlus size={14} />
              添加到日历
            </button>
          </div>
        )}

        <hr className="wb-section-rule" />

        {/* ── AI 智能规划区 ── */}
        <AiPlanningPanel
          dailyPlan={dailyPlan}
          refreshingPlan={refreshingPlan}
          showProjectBrief={showProjectBrief}
          onRefreshPlan={onRefreshPlan}
          onSelectTimeBlock={onSelectTimeBlock}
          onShowHistory={onShowHistory}
        />
      </div>
    </section>
  );
}
