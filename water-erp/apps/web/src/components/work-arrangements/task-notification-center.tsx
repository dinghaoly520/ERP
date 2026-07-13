'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  CalendarPlus,
  ArrowRight,
  UserCheck,
  Tag,
  AlertTriangle,
  Sparkles,
  Brain,
  RefreshCw,
  Lightbulb,
  ShieldAlert,
} from 'lucide-react';
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
  link: string;
}

// ── helpers ──

const URGENCY_ORDER: Record<NotificationUrgency, number> = {
  urgent: 0, important: 1, normal: 2,
};

const URGENCY_MAP: Record<string, NotificationUrgency> = {
  SUPPLIER_PENDING: 'urgent', PRICE_REVIEW: 'important',
  QUALIFICATION_EXPIRING: 'important', BID_REMINDER: 'normal',
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

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function formatSlot(raw: string): string {
  if (!raw) return '--:--';
  const t = raw.trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(t)) return t.slice(0, 5);
  const m = t.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : t;
}

// ── 通知分组 ──

interface PlanningGroup {
  type: string;
  count: number;
  label: string;
  icon: typeof UserCheck;
  iconBg: string;
  iconColor: string;
  link: string;
  minutesPerItem: number;
  contextNote: string;
}

function buildPlanningGroups(
  todoItems: NotificationItem[],
  derivedTodo: { supplierPending: number; priceReview: number; expiringQualifications: number },
): PlanningGroup[] {
  const byType = new Map<string, NotificationItem[]>();
  for (const item of todoItems) {
    const list = byType.get(item.type) || [];
    list.push(item);
    byType.set(item.type, list);
  }

  const groups: PlanningGroup[] = [];

  const supplierItems = byType.get('SUPPLIER_PENDING') || [];
  const supplierCount = Math.max(supplierItems.length, derivedTodo.supplierPending);
  if (supplierCount > 0) {
    const earliest = supplierItems.length
      ? supplierItems.reduce((a, b) => (new Date(a.createdAt) < new Date(b.createdAt) ? a : b), supplierItems[0])
      : null;
    groups.push({
      type: 'SUPPLIER_PENDING', count: supplierCount, label: '供应商审批',
      icon: UserCheck, iconBg: '#eff6ff', iconColor: '#064ea2',
      link: '/supplier/approval', minutesPerItem: 15,
      contextNote: earliest
        ? `${supplierCount}家待审 · ${earliest.title.slice(0, 12)}${earliest.title.length > 12 ? '…' : ''}等 · 最早${relTime(earliest.createdAt)}`
        : `${supplierCount}家供应商等待审核`,
    });
  }

  const priceItems = byType.get('PRICE_REVIEW') || [];
  const priceCount = Math.max(priceItems.length, derivedTodo.priceReview);
  if (priceCount > 0) {
    const earliest = priceItems.length
      ? priceItems.reduce((a, b) => (new Date(a.createdAt) < new Date(b.createdAt) ? a : b), priceItems[0])
      : null;
    groups.push({
      type: 'PRICE_REVIEW', count: priceCount, label: '价格复核',
      icon: Tag, iconBg: '#f5f3ff', iconColor: '#7c3aed',
      link: '/mall-management/approval', minutesPerItem: 10,
      contextNote: earliest
        ? `${priceCount}项待审 · ${earliest.title.slice(0, 12)}${earliest.title.length > 12 ? '…' : ''}`
        : `${priceCount}项价格变动待复核`,
    });
  }

  const qualCount = derivedTodo.expiringQualifications;
  if (qualCount > 0) {
    groups.push({
      type: 'QUALIFICATION_EXPIRING', count: qualCount, label: '资质到期确认',
      icon: AlertTriangle, iconBg: '#fff7ed', iconColor: '#f5a623',
      link: '/supplier/repository', minutesPerItem: 3,
      contextNote: `${qualCount}项资质即将到期，需确认续期`,
    });
  }

  const order = ['SUPPLIER_PENDING', 'PRICE_REVIEW', 'QUALIFICATION_EXPIRING'];
  groups.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return groups;
}

// ── AI 分析结果提取 ──

interface AiInsight {
  prioritization: string;
  timeAllocation: string;
  riskAlert: string;
  strategy: string;
}

function extractAiInsights(
  dailyPlan: WorkArrangementDailyPlan | null,
  groups: PlanningGroup[],
  totalMinutes: number,
): AiInsight | null {
  if (!dailyPlan) return null;

  // 从 dailyPlan 的 AI 生成字段中提取通知相关的洞察
  const groupLabels = groups.map((g) => `「${g.label}」(${g.count}项)`).join('、');

  return {
    prioritization:
      dailyPlan.aiSuggestion ||
      dailyPlan.overview ||
      `今日共有 ${groups.length} 类 ${groups.reduce((s, g) => s + g.count, 0)} 项待办（${groupLabels}），总计约需 ${totalMinutes} 分钟。`,
    timeAllocation:
      dailyPlan.timeBlocks && dailyPlan.timeBlocks.length > 0
        ? `AI 已为今日排出 ${dailyPlan.timeBlocks.length} 个时间块：${dailyPlan.timeBlocks.slice(0, 3).map((b) => `「${b.label}」${formatSlot(b.start)}–${formatSlot(b.end)}`).join('、')}`
        : `建议上午集中处理审批类事务（约${groups.filter(g => g.type !== 'QUALIFICATION_EXPIRING').reduce((s, g) => s + g.count * g.minutesPerItem, 0)}分钟），资质到期确认可在下午空闲时段完成。`,
    riskAlert:
      dailyPlan.riskSummary ||
      (groups.some((g) => g.type === 'SUPPLIER_PENDING')
        ? '供应商审批积压可能影响后续采购流程，建议今日内完成。'
        : '当前无高风险待办。'),
    strategy:
      dailyPlan.completionAdvice ||
      `建议处理顺序：${groups.map((g, i) => `${i + 1}.${g.label}`).join(' → ')}。完成后可在日程中标记完成。`,
  };
}

const MAX_VISIBLE = 6;

// ── 主组件 ──

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

  const planningGroups = useMemo(
    () => buildPlanningGroups(todoItems, derivedTodo),
    [todoItems, derivedTodo],
  );

  const totalMinutes = planningGroups.reduce(
    (s, g) => s + g.count * g.minutesPerItem,
    0,
  );

  const aiInsight = useMemo(
    () => extractAiInsights(dailyPlan, planningGroups, totalMinutes),
    [dailyPlan, planningGroups, totalMinutes],
  );

  const hasNotifications = planningGroups.length > 0;

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

  const handleAddAllToCalendar = () => {
    const items: PlannedItem[] = planningGroups.map((g) => ({
      title: `${g.label}（${g.count}项）`,
      estimatedMinutes: g.count * g.minutesPerItem,
      link: g.link,
    }));
    onAddToCalendar(items);
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
                    <ChevronUp size={12} />收起
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

        {/* ── 通知待办规划（含 AI 分析）── */}
        {hasNotifications && (
          <div className="space-y-3 rounded-[16px] bg-[var(--accent-soft)]/10 p-4">
            {/* 标题栏 */}
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[color:var(--accent)]">
                <Brain size={13} />
                通知待办规划
              </p>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-[rgba(96,139,239,0.12)] px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-[color:var(--accent)]">
                  {planningGroups.length}类 · {planningGroups.reduce((s, g) => s + g.count, 0)}项 · 约{totalMinutes}分钟
                </span>
                <button
                  type="button"
                  onClick={onRefreshPlan}
                  disabled={refreshingPlan}
                  className="neu-btn-xs"
                  title="让 AI 重新分析待办通知并规划时间"
                >
                  <Sparkles size={11} className={refreshingPlan ? 'animate-pulse' : ''} />
                  AI 分析
                </button>
              </div>
            </div>

            {/* 按类别分组 — 快速导航卡片 */}
            <div className="space-y-2">
              {planningGroups.map((group, idx) => (
                <button
                  key={group.type}
                  type="button"
                  onClick={() => router.push(group.link)}
                  className="neu-card group flex w-full cursor-pointer items-start gap-3 rounded-[14px] px-3.5 py-3 text-left transition-all hover:-translate-y-px"
                >
                  <span className="mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-[rgba(96,139,239,0.15)] text-[11px] font-bold text-[color:var(--accent)]">
                    {idx + 1}
                  </span>
                  <span
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: group.iconBg }}
                  >
                    <group.icon size={14} style={{ color: group.iconColor }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-[#18243a]">
                        {group.label}
                      </span>
                      <span className="rounded-md bg-[rgba(96,139,239,0.1)] px-1.5 py-px text-[11px] font-bold tabular-nums text-[color:var(--accent)]">
                        {group.count}项
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-[#5a6d8a]">
                      {group.contextNote}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[color:var(--accent)] opacity-0 transition group-hover:opacity-100">
                      去处理 <ArrowRight size={10} />
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-[rgba(96,139,239,0.08)] px-2 py-1 text-[11px] tabular-nums text-[color:var(--accent)]">
                    <Clock3 size={10} />
                    约{group.count * group.minutesPerItem}分钟
                  </span>
                </button>
              ))}
            </div>

            {/* ── AI 分析结果 ── */}
            {refreshingPlan ? (
              <div className="flex flex-col items-center gap-3 rounded-[12px] bg-white/50 py-5">
                <div className="neu-icon-well flex h-9 w-9 items-center justify-center rounded-xl">
                  <Brain size={16} className="animate-pulse text-[color:var(--accent)]" />
                </div>
                <p className="text-[11px] text-[color:var(--muted-foreground)]">
                  AI 正在分析你的待办通知，结合日程进行时间规划...
                </p>
              </div>
            ) : aiInsight ? (
              <div className="space-y-2.5 rounded-[12px] bg-white/50 p-3.5">
                {/* 优先级 */}
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                    <Sparkles size={11} />
                    AI 优先级建议
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--foreground)]">
                    {aiInsight.prioritization}
                  </p>
                </div>

                {/* 时间分配 */}
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                    <Clock3 size={11} />
                    时间分配
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--foreground)]">
                    {aiInsight.timeAllocation}
                  </p>
                </div>

                {/* 风险提示 */}
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                    <ShieldAlert size={11} />
                    风险提示
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--foreground)]">
                    {aiInsight.riskAlert}
                  </p>
                </div>

                {/* 执行策略 */}
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                    <Lightbulb size={11} />
                    执行策略
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--foreground)]">
                    {aiInsight.strategy}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-[12px] bg-white/50 py-4">
                <Brain size={16} className="text-[color:var(--muted-foreground)] opacity-40" />
                <p className="text-[11px] text-[color:var(--muted-foreground)]">
                  点击「AI 分析」让 AI 结合日程分析待办优先级
                </p>
              </div>
            )}

            {/* 一键添加 */}
            <button
              type="button"
              onClick={handleAddAllToCalendar}
              className="neu-btn-primary w-full justify-center"
            >
              <CalendarPlus size={14} />
              一键添加到日历
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
