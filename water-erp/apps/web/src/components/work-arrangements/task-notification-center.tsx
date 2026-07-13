'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getNotificationMeta } from '@water-erp/shared';
import { NotificationKpiBar } from '@/components/work-arrangements/notification-kpi-bar';
import {
  NotificationCard,
  type NotificationUrgency,
} from '@/components/work-arrangements/notification-card';
import {
  AiPlanningPanel,
  type PlannedItem,
} from '@/components/work-arrangements/ai-planning-panel';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import { useNotifications } from '@/lib/hooks/use-notifications';
import type { NotificationItem } from '@/lib/api/notification';

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
    // 同紧急度：未读在前，再按时间倒序
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
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
        {/* KPI 区 */}
        <NotificationKpiBar derivedTodo={derivedTodo} todoItems={todoItems} />

        {/* 通知卡片流 */}
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

        <hr className="wb-section-rule" />

        {/* AI 智能规划区 */}
        <AiPlanningPanel
          dailyPlan={dailyPlan}
          derivedTodo={derivedTodo}
          todoItems={todoItems}
          refreshingPlan={refreshingPlan}
          showProjectBrief={showProjectBrief}
          onRefreshPlan={onRefreshPlan}
          onSelectTimeBlock={onSelectTimeBlock}
          onAddToCalendar={onAddToCalendar}
          onShowHistory={onShowHistory}
        />
      </div>
    </section>
  );
}
