'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, statusTone } from '@water-erp/shared';
import { NotificationKpiBar } from '@/components/work-arrangements/notification-kpi-bar';
import { AiPlanningPanel } from '@/components/work-arrangements/ai-planning-panel';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import { useNotifications } from '@/lib/hooks/use-notifications';
import type { NotificationItem } from '@/lib/api/notification';

export interface PlannedItem {
  title: string;
  estimatedMinutes: number;
  link: string;
}

// ── helpers ──

type NotificationUrgency = 'urgent' | 'important' | 'normal';

const URGENCY_MAP: Record<string, NotificationUrgency> = {
  SUPPLIER_PENDING: 'urgent', PRICE_REVIEW: 'important',
  QUALIFICATION_EXPIRING: 'important', BID_REMINDER: 'normal',
};
const URGENCY_ORDER: Record<NotificationUrgency, number> = { urgent: 0, important: 1, normal: 2 };

const urgencyColors: Record<NotificationUrgency, { dot: string; label: string }> = {
  urgent:    { dot: 'bg-[#ef4444]', label: '紧急' },
  important: { dot: 'bg-[#f59e0b]', label: '重要' },
  normal:    { dot: 'bg-[#3b82f6]', label: '普通' },
};

function getUrgency(type: string): NotificationUrgency { return URGENCY_MAP[type] ?? 'normal'; }

function sortByUrgency(items: NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => {
    const ua = URGENCY_ORDER[getUrgency(a.type)] ?? 99;
    const ub = URGENCY_ORDER[getUrgency(b.type)] ?? 99;
    if (ua !== ub) return ua - ub;
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

const MAX_VISIBLE = 6;

// ── 主组件 ──

interface TaskNotificationCenterProps {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  showProjectBrief?: boolean;
  onRefreshPlan: (notificationContext?: string) => void;
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

  const visibleItems = expanded ? sortedItems : sortedItems.slice(0, MAX_VISIBLE);
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

  const handleRefreshWithNotifications = () => {
    const parts: string[] = [];
    if (derivedTodo.supplierPending > 0) parts.push(`${derivedTodo.supplierPending}项供应商审批`);
    if (derivedTodo.priceReview > 0) parts.push(`${derivedTodo.priceReview}项价格复核`);
    if (derivedTodo.expiringQualifications > 0) parts.push(`${derivedTodo.expiringQualifications}项资质到期`);
    const ctx = parts.length > 0 ? parts.join('、') : undefined;
    onRefreshPlan(ctx);
  };

  return (
    <section className="wb-panel">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
      </div>
      <div className="wb-panel-body flex flex-col gap-4">
        {/* KPI */}
        <NotificationKpiBar derivedTodo={derivedTodo} todoItems={todoItems} />

        {/* 通知内容 */}
        {sortedItems.length > 0 && (
          <div className="flex flex-col">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                通知内容 · {sortedItems.length} 条
              </span>
              <span className="text-[10px] text-[color:var(--muted-foreground)]">
                {sortedItems.filter((n) => !n.isRead).length} 条未读
              </span>
            </div>
            <div className="flex flex-col divide-y divide-[#eef3f8]">
              {visibleItems.map((item) => {
                const meta = getNotificationMeta(item.type);
                const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
                const tone = statusTone[meta.tone] ?? statusTone.gray;
                const urgency = getUrgency(item.type);
                const colors = urgencyColors[urgency];
                const resolved = !!item.resolvedAt;

                return (
                  <div
                    key={item.id}
                    className={`group py-3 first:pt-0 last:pb-0 ${
                      resolved ? 'opacity-50' : ''
                    }`}
                  >
                    {/* 元信息行：图标 + 紧急度 + 时间 */}
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md"
                        style={{ color: tone.color, backgroundColor: tone.bg }}
                      >
                        <Icon size={11} strokeWidth={2} />
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${
                          urgency === 'urgent'
                            ? 'bg-[#fef2f2] text-[#ef4444]'
                            : urgency === 'important'
                              ? 'bg-[#fffbeb] text-[#d97706]'
                              : 'bg-[#eff6ff] text-[#2563eb]'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                        {colors.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-[#8a99ad]">
                        {relTime(item.createdAt)}
                      </span>
                      {resolved && (
                        <span className="rounded-full bg-[#ecfdf5] px-1.5 py-px text-[10px] font-semibold text-[#11a874]">
                          已处理
                        </span>
                      )}
                    </div>

                    {/* 标题 */}
                    <p
                      className={`mt-1.5 text-[13px] font-semibold leading-snug ${
                        resolved
                          ? 'text-[color:var(--muted-foreground)] line-through'
                          : 'text-[#18243a]'
                      }`}
                    >
                      {item.title}
                    </p>

                    {/* 内容 */}
                    {item.content && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[#5a6d8a]">
                        {item.content}
                      </p>
                    )}

                    {/* 操作 */}
                    {meta.actionable && !resolved && item.link ? (
                      <button
                        type="button"
                        onClick={() => handleAction(item)}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-[rgba(96,139,239,0.08)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--accent)] transition hover:bg-[rgba(96,139,239,0.15)]"
                      >
                        去处理
                        <ArrowRight size={10} />
                      </button>
                    ) : item.link ? (
                      <button
                        type="button"
                        onClick={() => handleAction(item)}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-[rgba(140,140,140,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[#5a6d8a] transition hover:bg-[rgba(140,140,140,0.15)]"
                      >
                        查看
                        <ArrowRight size={10} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="neu-btn-xs mx-auto mt-3"
              >
                {expanded ? (
                  <><ChevronUp size={12} />收起</>
                ) : (
                  <><ChevronDown size={12} />查看全部 {hiddenCount} 条</>
                )}
              </button>
            )}
          </div>
        )}

        <hr className="wb-section-rule" />

        {/* AI 智能规划 */}
        <AiPlanningPanel
          dailyPlan={dailyPlan}
          refreshingPlan={refreshingPlan}
          showProjectBrief={showProjectBrief}
          notificationContext={{
            supplierPending: derivedTodo.supplierPending,
            priceReview: derivedTodo.priceReview,
            expiringQualifications: derivedTodo.expiringQualifications,
          }}
          onRefreshPlan={handleRefreshWithNotifications}
          onSelectTimeBlock={onSelectTimeBlock}
          onShowHistory={onShowHistory}
        />
      </div>
    </section>
  );
}
