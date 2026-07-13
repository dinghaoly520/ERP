'use client';

import { useMemo } from 'react';
import {
  Sparkles,
  RefreshCw,
  CalendarPlus,
  History,
  Clock3,
  Lightbulb,
} from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { DerivedTodo } from '@/lib/hooks/use-notifications';
import type { NotificationItem } from '@/lib/api/notification';

export interface PlannedItem {
  title: string;
  estimatedMinutes: number;
  notificationId?: string;
}

interface AiPlanningPanelProps {
  dailyPlan: WorkArrangementDailyPlan | null;
  derivedTodo: DerivedTodo;
  todoItems: NotificationItem[];
  refreshingPlan: boolean;
  onRefreshPlan: () => void;
  onAddToCalendar: (items: PlannedItem[]) => void;
  onShowHistory: () => void;
}

/** Derive a planned-item list from notifications. */
function derivePlannedItems(
  todoItems: NotificationItem[],
  derivedTodo: DerivedTodo,
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
      notificationId: todoItems.find(
        (n) => n.type === 'QUALIFICATION_EXPIRING',
      )?.id,
    });
  }

  return items;
}

export function AiPlanningPanel({
  derivedTodo,
  todoItems,
  refreshingPlan,
  onRefreshPlan,
  onAddToCalendar,
  onShowHistory,
}: AiPlanningPanelProps) {
  const plannedItems = useMemo(
    () => derivePlannedItems(todoItems, derivedTodo),
    [todoItems, derivedTodo],
  );

  const totalMinutes = plannedItems.reduce(
    (s, i) => s + i.estimatedMinutes,
    0,
  );

  const hasNotifications =
    derivedTodo.supplierPending > 0 ||
    derivedTodo.priceReview > 0 ||
    derivedTodo.expiringQualifications > 0;

  return (
    <section className="flex flex-col">
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]">
          <Sparkles size={14} className="mr-1.5 inline-block" />
          AI 智能规划
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefreshPlan}
            disabled={refreshingPlan}
            className="neu-btn-xs"
          >
            <RefreshCw
              size={12}
              className={refreshingPlan ? 'animate-spin' : ''}
            />
            <span className="hidden sm:inline">刷新分析</span>
          </button>
          <button
            type="button"
            onClick={onShowHistory}
            className="neu-btn-xs"
          >
            <History size={12} />
          </button>
        </div>
      </div>

      <hr className="wb-section-rule" />

      {refreshingPlan ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="neu-icon-well flex h-10 w-10 items-center justify-center rounded-xl">
            <Sparkles
              size={18}
              className="animate-pulse text-[color:var(--accent)]"
            />
          </div>
          <span className="text-sm text-[color:var(--muted-foreground)]">
            正在分析你的待办事项...
          </span>
        </div>
      ) : !hasNotifications ? (
        <div className="py-4 text-center text-sm text-[color:var(--muted-foreground)]">
          <Lightbulb
            size={20}
            className="mx-auto mb-2 text-[#f5a623] opacity-50"
          />
          今日无待办事项，可以专注于项目推进
        </div>
      ) : (
        <>
          {/* 建议处理顺序 */}
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--accent)]">
              <Clock3 size={12} />
              建议处理顺序
            </p>
            <div className="mt-2 space-y-1.5">
              {plannedItems.map((item, idx) => (
                <div
                  key={idx}
                  className="neu-surface-subtle flex items-center gap-2.5 rounded-[10px] px-3 py-2"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(96,139,239,0.15)] text-[11px] font-bold text-[color:var(--accent)]">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-[13px] font-semibold text-[color:var(--foreground)]">
                    {item.title}
                  </span>
                  <span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
                    约{item.estimatedMinutes}分钟
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 预估总耗时 + 推荐时段 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="neu-content-block flex items-center gap-2 px-3 py-2 text-xs">
              <span className="font-semibold text-[color:var(--muted-foreground)]">
                ⏱️ 预估总耗时:
              </span>
              <span className="font-black tabular-nums text-[color:var(--foreground)]">
                {totalMinutes} 分钟
              </span>
            </div>
            <div className="neu-content-block flex items-center gap-2 px-3 py-2 text-xs">
              <span className="font-semibold text-[color:var(--muted-foreground)]">
                📍 推荐时段:
              </span>
              <span className="font-black tabular-nums text-[color:var(--foreground)]">
                今日 10:30-{totalMinutes > 30 ? '11:30' : '11:00'}
              </span>
            </div>
          </div>

          {/* 策略简述 */}
          <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
            上午处理审批类事务效率最高，建议在11点前完成，
            下午可专注项目跟进。
          </p>

          {/* 添加到日历按钮 */}
          <button
            type="button"
            onClick={() => onAddToCalendar(plannedItems)}
            className="neu-btn-primary mt-3 self-start"
          >
            <CalendarPlus size={14} />
            添加到日历
          </button>
        </>
      )}
    </section>
  );
}
