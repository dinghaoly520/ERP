# 工作台任务通知中心 & 任务弹窗重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作台右侧面板从"任务详情+AI辅助"改造为"任务通知中心(KPI+通知卡片流+AI智能规划)"，任务详情改为居中模态弹窗。

**Architecture:** 新建 5 个组件（TaskNotificationCenter → NotificationKpiBar + NotificationCardList + AiPlanningPanel，以及 TaskDetailModal），修改 work-arrangements-page.tsx 行布局和数据流，删除 task-detail-panel.tsx。通知数据复用现有 `useNotifications()` hook，AI 面板复用现有 `dailyPlan` 数据结构。

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, Framer Motion, Lucide React, TypeScript, neumorphic CSS (neu-* / wb-* classes from globals.css)

## Global Constraints

- 通知数据源复用现有 `/api/notifications` 和 `use-notifications` hook，不再新增通知 API
- KPI 统计复用 derivedTodo: `supplierPending` / `priceReview` / `expiringQualifications`
- UI 风格遵循 `neu-card` / `neu-btn-soft` / `wb-panel` / `wb-section-rule` / `neu-content-block` neumorphic 设计规范
- AI 分析对接后端新增接口（TBD），前端先做界面+交互，数据接入后续对接
- Chairman 视图（`WorkArrangementsPageChairman`）本次不做变动，仅重构普通用户版
- 左侧 SchedulePanel 不做任何改动
- 所有组件必须为 `"use client"` 客户端组件
- 方案二：丰富通知中心 + 深度AI融合

---

### Task 1: NotificationKpiBar — KPI 三组统计卡片

**Files:**
- Create: `apps/web/src/components/work-arrangements/notification-kpi-bar.tsx`

**Interfaces:**
- Consumes: `DerivedTodo` from `@/lib/hooks/use-notifications` (`{ supplierPending: number; priceReview: number; expiringQualifications: number }`), `todoItems` from useNotifications for supplier counting
- Produces: Component with no callback props — uses Next.js `useRouter` for navigation

- [ ] **Step 1: Create the component file**

```typescript
// apps/web/src/components/work-arrangements/notification-kpi-bar.tsx
'use client';

import { useRouter } from 'next/navigation';
import { UserCheck, Tag, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useNotifications, type DerivedTodo } from '@/lib/hooks/use-notifications';
import type { NotificationItem } from '@/lib/api/notification';

interface NotificationKpiBarProps {
  derivedTodo: DerivedTodo;
  todoItems: NotificationItem[];
}

const kpiDefs = [
  {
    key: 'supplier' as const,
    label: '待审批',
    sublabel: '供应商审批',
    icon: UserCheck,
    toneBg: '#eff6ff',
    toneColor: '#064ea2',
    link: '/supplier/approval',
    deriveCount: (derived: DerivedTodo, items: NotificationItem[]) =>
      Math.max(
        items.filter((n) => n.type === 'SUPPLIER_PENDING').length,
        derived.supplierPending,
      ),
  },
  {
    key: 'price' as const,
    label: '待复核',
    sublabel: '价格复核',
    icon: Tag,
    toneBg: '#f5f3ff',
    toneColor: '#7c3aed',
    link: '/mall-management/approval',
    deriveCount: (derived: DerivedTodo) => derived.priceReview,
  },
  {
    key: 'qual' as const,
    label: '即将到期',
    sublabel: '资质+投标',
    icon: AlertTriangle,
    toneBg: '#fff7ed',
    toneColor: '#f5a623',
    link: '/notifications',
    deriveCount: (derived: DerivedTodo) => derived.expiringQualifications,
  },
];

export function NotificationKpiBar({ derivedTodo, todoItems }: NotificationKpiBarProps) {
  const router = useRouter();
  const total = kpiDefs.reduce(
    (s, d) => s + d.deriveCount(derivedTodo, todoItems),
    0,
  );

  if (total === 0) {
    return (
      <div className="card-enter flex items-center gap-3 rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] px-5 py-3">
        <CheckCircle2 size={18} className="text-[#11a874]" />
        <div className="text-sm font-extrabold text-[#18243a]">今日待办已清零 ✓</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {kpiDefs.map((d) => {
        const count = d.deriveCount(derivedTodo, todoItems);
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => router.push(d.link)}
            className="neu-card group flex cursor-pointer flex-col items-start gap-1.5 px-4 py-3 text-left transition hover:-translate-y-0.5"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ backgroundColor: d.toneBg }}
            >
              <d.icon size={14} style={{ color: d.toneColor }} />
            </span>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-2xl font-black tabular-nums"
                style={{ color: d.toneColor }}
              >
                {count}
              </span>
              <span className="text-xs font-semibold text-[#18243a]">
                {d.label}
              </span>
            </div>
            <div className="text-[11px] text-[#8a99ad]">{d.sublabel}</div>
            <div className="mt-0.5 text-[11px] font-bold text-[#064ea2] opacity-0 transition group-hover:opacity-100">
              去处理 →
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/work-arrangements/notification-kpi-bar.tsx
git commit -m "feat: add NotificationKpiBar component — 3 KPI stat cards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: NotificationCard — 单条通知卡片

**Files:**
- Create: `apps/web/src/components/work-arrangements/notification-card.tsx`

**Interfaces:**
- Consumes: `NotificationItem` from `@/lib/api/notification`, `getNotificationMeta` from `@water-erp/shared`, `statusTone` from `@water-erp/shared`
- Produces: `NotificationCard` component with `onAction` callback

- [ ] **Step 1: Create the component file**

```typescript
// apps/web/src/components/work-arrangements/notification-card.tsx
'use client';

import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, statusTone } from '@water-erp/shared';
import type { NotificationItem } from '@/lib/api/notification';

export type NotificationUrgency = 'urgent' | 'important' | 'normal';

const URGENCY_MAP: Record<string, NotificationUrgency> = {
  SUPPLIER_PENDING: 'urgent',
  PRICE_REVIEW: 'important',
  QUALIFICATION_EXPIRING: 'important',
  BID_REMINDER: 'normal',
};

function getUrgency(type: string): NotificationUrgency {
  return URGENCY_MAP[type] ?? 'normal';
}

const urgencyStyles: Record<
  NotificationUrgency,
  { bar: string; label: string; labelColor: string }
> = {
  urgent: {
    bar: 'bg-[#ef4444]',
    label: '紧急',
    labelColor: 'text-[#ef4444] bg-[#fef2f2]',
  },
  important: {
    bar: 'bg-[#f59e0b]',
    label: '重要',
    labelColor: 'text-[#f59e0b] bg-[#fffbeb]',
  },
  normal: {
    bar: 'bg-[#3b82f6]',
    label: '普通',
    labelColor: 'text-[#3b82f6] bg-[#eff6ff]',
  },
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

interface NotificationCardProps {
  item: NotificationItem;
  onAction: (item: NotificationItem) => void;
}

export function NotificationCard({ item, onAction }: NotificationCardProps) {
  const meta = getNotificationMeta(item.type);
  const Icon = (LucideIcons as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>)[meta.icon] ?? LucideIcons.Bell;
  const tone = statusTone[meta.tone] ?? statusTone.gray;
  const urgency = getUrgency(item.type);
  const urgStyle = urgencyStyles[urgency];
  const resolved = !!item.resolvedAt;

  return (
    <button
      type="button"
      onClick={() => onAction(item)}
      className={`neu-card group relative flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition ${
        resolved ? 'opacity-60' : ''
      }`}
    >
      {/* 紧急度左侧色条 */}
      <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${urgStyle.bar}`} />

      {/* 未读小圆点 */}
      {!item.isRead && (
        <span className="absolute left-[7px] top-2 h-1.5 w-1.5 rounded-full bg-[#064ea2]" />
      )}

      {/* 图标 */}
      <span
        className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ color: tone.color, backgroundColor: tone.bg }}
      >
        <Icon size={14} strokeWidth={2} />
      </span>

      {/* 内容 */}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold ${urgStyle.labelColor}`}
          >
            {urgStyle.label}
          </span>
          <span className="text-[11px] text-[#8a99ad] tabular-nums">
            {relTime(item.createdAt)}
          </span>
        </span>
        <span className="mt-1 block text-[13px] font-semibold leading-snug text-[#18243a]">
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-[#5a6d8a]">
          {item.content}
        </span>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#064ea2] opacity-0 transition group-hover:opacity-100">
          {meta.actionable && !resolved ? '去处理' : '查看'}
          <LucideIcons.ArrowRight size={11} />
        </span>
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/work-arrangements/notification-card.tsx
git commit -m "feat: add NotificationCard component with urgency-based styling

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: AiPlanningPanel — AI 时间规划建议面板

**Files:**
- Create: `apps/web/src/components/work-arrangements/ai-planning-panel.tsx`

**Interfaces:**
- Consumes: `WorkArrangementDailyPlan` from types, `DerivedTodo` from use-notifications, `NotificationItem` from api
- Produces: Panel with notification-aware analysis display + [刷新分析]/[添加到日历]/[历史] buttons

- [ ] **Step 1: Create the component file**

```typescript
// apps/web/src/components/work-arrangements/ai-planning-panel.tsx
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

function formatTimeSlot(raw: string): string {
  if (!raw) return '--:--';
  const trimmed = raw.trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return trimmed.slice(0, 5);
  const isoMatch = trimmed.match(/T(\d{2}):(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;
  return trimmed;
}

/** Derive a planned-item list from notifications + dailyPlan context. */
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
  dailyPlan,
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
          <div className="mt-3 flex items-center gap-4">
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
            📝 上午处理审批类事务效率最高，建议在11点前完成，
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/work-arrangements/ai-planning-panel.tsx
git commit -m "feat: add AiPlanningPanel with notification-aware schedule analysis

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: TaskNotificationCenter — 右侧面板主组件

**Files:**
- Create: `apps/web/src/components/work-arrangements/task-notification-center.tsx`

**Interfaces:**
- Consumes: NotificationKpiBar, NotificationCard, AiPlanningPanel, useNotifications hook types
- Produces: The full right-column replacement panel combining KPI + card list + AI planning

- [ ] **Step 1: Create the component file**

```typescript
// apps/web/src/components/work-arrangements/task-notification-center.tsx
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
  onRefreshPlan: () => void;
  onAddToCalendar: (items: PlannedItem[]) => void;
  onShowHistory: () => void;
  onTaskNotificationClick?: (item: NotificationItem) => void;
}

export function TaskNotificationCenter({
  dailyPlan,
  refreshingPlan,
  onRefreshPlan,
  onAddToCalendar,
  onShowHistory,
  onTaskNotificationClick,
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
          onRefreshPlan={onRefreshPlan}
          onAddToCalendar={onAddToCalendar}
          onShowHistory={onShowHistory}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/work-arrangements/task-notification-center.tsx
git commit -m "feat: add TaskNotificationCenter — KPI + notification cards + AI planning panel

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: TaskDetailModal — 任务详情模态弹窗

**Files:**
- Create: `apps/web/src/components/work-arrangements/task-detail-modal.tsx`

**Interfaces:**
- Consumes: All work-arrangement types, status label maps, neumorphic CSS classes, Framer Motion
- Produces: Modal component following `WorkTaskEditorDrawer` pattern (createPortal + backdrop + AnimatePresence)

- [ ] **Step 1: Create the component file**

```typescript
// apps/web/src/components/work-arrangements/task-detail-modal.tsx
'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Clock3,
  Bell,
  FolderOpen,
  CalendarPlus,
  PlayCircle,
  CheckCheck,
  AlertTriangle,
  RotateCcw,
  XCircle,
  FilePenLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  type WorkArrangementItem,
  type WorkArrangementReminderState,
  type WorkArrangementNoteType,
  type WorkArrangementStatus,
} from '@/lib/types/work-arrangements';

// ── helpers ──

function formatDateTimeLabel(value: string | null) {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function reminderStateLabel(state: WorkArrangementReminderState) {
  switch (state) {
    case 'UPCOMING':
      return '即将提醒';
    case 'DUE_NOW':
      return '提醒已到';
    case 'OVERDUE':
      return '提醒超时';
    default:
      return '未设置提醒';
  }
}

const statusAccentMap: Record<
  WorkArrangementStatus,
  { bg: string; border: string; dot: string }
> = {
  TODO: {
    bg: 'linear-gradient(135deg, rgba(140,140,140,0.08), rgba(140,140,140,0.02))',
    border: 'border-[rgba(140,140,140,0.15)]',
    dot: 'bg-[rgba(140,140,140,1)]',
  },
  IN_PROGRESS: {
    bg: 'linear-gradient(135deg, rgba(96,139,239,0.1), rgba(96,139,239,0.02))',
    border: 'border-[rgba(96,139,239,0.2)]',
    dot: 'bg-[rgba(96,139,239,1)]',
  },
  BLOCKED: {
    bg: 'linear-gradient(135deg, rgba(230,129,102,0.1), rgba(230,129,102,0.02))',
    border: 'border-[rgba(230,129,102,0.2)]',
    dot: 'bg-[rgba(230,129,102,1)]',
  },
  COMPLETED: {
    bg: 'linear-gradient(135deg, rgba(92,181,150,0.1), rgba(92,181,150,0.02))',
    border: 'border-[rgba(92,181,150,0.2)]',
    dot: 'bg-[rgba(92,181,150,1)]',
  },
  CANCELLED: {
    bg: 'linear-gradient(135deg, rgba(140,140,140,0.05), rgba(140,140,140,0.01))',
    border: 'border-[rgba(140,140,140,0.1)]',
    dot: 'bg-[rgba(140,140,140,0.6)]',
  },
};

const statusStyles: Record<
  WorkArrangementStatus,
  { bg: string; text: string; border: string }
> = {
  TODO: {
    bg: 'bg-[rgba(140,140,140,0.12)]',
    text: 'text-[rgba(140,140,140,1)]',
    border: 'border-[rgba(140,140,140,0.25)]',
  },
  IN_PROGRESS: {
    bg: 'bg-[rgba(96,139,239,0.12)]',
    text: 'text-[rgba(96,139,239,1)]',
    border: 'border-[rgba(96,139,239,0.25)]',
  },
  BLOCKED: {
    bg: 'bg-[rgba(230,129,102,0.12)]',
    text: 'text-[rgba(230,129,102,1)]',
    border: 'border-[rgba(230,129,102,0.25)]',
  },
  COMPLETED: {
    bg: 'bg-[rgba(92,181,150,0.12)]',
    text: 'text-[rgba(92,181,150,1)]',
    border: 'border-[rgba(92,181,150,0.25)]',
  },
  CANCELLED: {
    bg: 'bg-[rgba(140,140,140,0.12)]',
    text: 'text-[rgba(140,140,140,0.8)]',
    border: 'border-[rgba(140,140,140,0.25)]',
  },
};

function getAvailableActions(
  status: WorkArrangementStatus,
): Array<'start' | 'complete' | 'block' | 'unblock' | 'cancel'> {
  switch (status) {
    case 'TODO':
      return ['start', 'complete', 'block', 'cancel'];
    case 'IN_PROGRESS':
      return ['complete', 'block', 'cancel'];
    case 'BLOCKED':
      return ['unblock', 'complete', 'cancel'];
    case 'COMPLETED':
    case 'CANCELLED':
      return [];
    default:
      return [];
  }
}

interface TaskDetailModalProps {
  open: boolean;
  item: WorkArrangementItem | null;
  reminderState: WorkArrangementReminderState;
  noteType: WorkArrangementNoteType;
  noteDraft: string;
  noteSubmitting: boolean;
  onClose: () => void;
  onStart: () => void;
  onComplete: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onCancel: () => void;
  onPostponeReminder: () => void;
  onOpenFullEditor: () => void;
  onNoteTypeChange: (v: WorkArrangementNoteType) => void;
  onNoteDraftChange: (v: string) => void;
  onSubmitNote: () => void;
}

export function TaskDetailModal({
  open,
  item,
  reminderState,
  noteType,
  noteDraft,
  noteSubmitting,
  onClose,
  onStart,
  onComplete,
  onBlock,
  onUnblock,
  onCancel,
  onPostponeReminder,
  onOpenFullEditor,
  onNoteTypeChange,
  onNoteDraftChange,
  onSubmitNote,
}: TaskDetailModalProps) {
  const [notesExpanded, setNotesExpanded] = useState(true);

  // Esc key handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  // Empty state
  if (!item) {
    return createPortal(
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <motion.div
          className="relative w-full max-w-[640px] rounded-[20px] bg-[var(--background)] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', duration: 0.3 }}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={onClose}
            className="neu-btn-xs absolute right-4 top-4"
          >
            <X size={16} />
          </button>
          <div className="flex flex-col items-center justify-center py-10 text-sm text-[color:var(--muted-foreground)]">
            <div className="neu-icon-well mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
            </div>
            选择一条任务后查看详情。
          </div>
        </motion.div>
      </motion.div>,
      document.body,
    );
  }

  const accent = statusAccentMap[item.status];
  const statusStyle = statusStyles[item.status];
  const availableActions = getAvailableActions(item.status);
  const isFinished =
    item.status === 'COMPLETED' || item.status === 'CANCELLED';

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <motion.div
        className="relative flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[20px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', duration: 0.3 }}
        role="dialog"
        aria-modal="true"
      >
        {/* ── 头部 (渐变背景) ── */}
        <div
          className={`relative shrink-0 border-b px-6 py-5 ${accent.border}`}
          style={{ background: accent.bg }}
        >
          <button
            type="button"
            onClick={onClose}
            className="neu-btn-xs absolute right-4 top-4"
            aria-label="关闭"
          >
            <X size={16} />
          </button>

          {/* 状态指示 */}
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
            <span
              className={`inline-flex items-center rounded-[10px] border px-2.5 py-0.5 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
            >
              {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
            </span>
          </div>

          {/* 标题 */}
          <h2
            className={`mt-2 text-lg font-bold leading-snug text-balance ${
              isFinished
                ? 'text-[color:var(--muted-foreground)] line-through'
                : 'text-[color:var(--foreground)]'
            }`}
          >
            {item.title}
          </h2>

          {/* 描述 */}
          {item.description && (
            <p className="mt-1 truncate text-sm text-[color:var(--muted-foreground)]">
              {item.description}
            </p>
          )}
        </div>

        {/* ── 可滚动内容区 ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* 信息卡网格 2×2 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="neu-content-block px-3 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                <Clock3 size={12} />
                截止时间
              </div>
              <div className="mt-1.5 text-sm tabular-nums font-semibold text-[color:var(--foreground)]">
                {formatDateTimeLabel(item.dueAt)}
              </div>
            </div>
            <div className="neu-content-block px-3 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                <Bell size={12} />
                提醒状态
              </div>
              <div className="mt-1.5 text-sm font-semibold text-[color:var(--foreground)]">
                {reminderStateLabel(reminderState)}
              </div>
            </div>
            <div className="neu-content-block px-3 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                <FolderOpen size={12} />
                关联项目
              </div>
              {item.projectManagementItem ? (
                <Link
                  href={`/projects?highlight=${item.projectManagementItem.id}`}
                  className="mt-1.5 block truncate text-sm font-semibold text-[color:var(--accent)] underline decoration-blue-300 underline-offset-2 hover:decoration-blue-500"
                >
                  {item.projectManagementItem.title}
                </Link>
              ) : (
                <div className="mt-1.5 text-sm text-[color:var(--muted-foreground)]">
                  未关联项目
                </div>
              )}
            </div>
            <div className="neu-content-block px-3 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                <CalendarPlus size={12} />
                创建时间
              </div>
              <div className="mt-1.5 text-sm tabular-nums font-semibold text-[color:var(--foreground)]">
                {formatDateTimeLabel(item.createdAt)}
              </div>
            </div>
          </div>

          {/* 操作栏 */}
          {!isFinished && (
            <>
              <hr className="wb-section-rule" />
              <div className="flex flex-wrap gap-2">
                {availableActions.includes('start') && (
                  <button
                    type="button"
                    onClick={onStart}
                    className="neu-btn-soft"
                  >
                    <PlayCircle size={16} />
                    开始处理
                  </button>
                )}
                {availableActions.includes('complete') && (
                  <button
                    type="button"
                    onClick={onComplete}
                    className="neu-btn-soft is-success"
                  >
                    <CheckCheck size={16} />
                    标记完成
                  </button>
                )}
                {availableActions.includes('block') && (
                  <button
                    type="button"
                    onClick={onBlock}
                    className="neu-btn-soft is-danger"
                  >
                    <AlertTriangle size={16} />
                    标记受阻
                  </button>
                )}
                {availableActions.includes('unblock') && (
                  <button
                    type="button"
                    onClick={onUnblock}
                    className="neu-btn-soft is-info"
                  >
                    <RotateCcw size={16} />
                    恢复处理
                  </button>
                )}
                {availableActions.includes('cancel') && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="neu-btn-soft"
                  >
                    <XCircle size={16} />
                    取消任务
                  </button>
                )}
                {reminderState !== 'NONE' && (
                  <button
                    type="button"
                    onClick={onPostponeReminder}
                    className="neu-btn-soft"
                  >
                    <Clock3 size={16} />
                    延后提醒
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenFullEditor}
                  className="neu-btn-soft"
                >
                  <FilePenLine size={16} />
                  添加记录
                </button>
              </div>
            </>
          )}

          {/* 完成摘要 (已完成任务) */}
          {isFinished && item.completionSummary && (
            <>
              <hr className="wb-section-rule" />
              <div
                className="neu-content-block mt-3"
                style={
                  { '--block-accent': 'var(--success)' } as React.CSSProperties
                }
              >
                <div className="text-xs font-semibold text-[rgba(92,181,150,1)]">
                  完成摘要
                </div>
                <div className="mt-1 text-sm leading-relaxed text-[color:var(--foreground)]">
                  {item.completionSummary}
                </div>
              </div>
            </>
          )}

          {/* 过程记录 (折叠面板) */}
          <hr className="wb-section-rule" />
          <div>
            <button
              type="button"
              onClick={() => setNotesExpanded((v) => !v)}
              className="flex w-full items-center justify-between"
            >
              <span className="text-xs font-semibold text-[color:var(--accent)]">
                过程记录
                {item.notes.length > 0 && ` (${item.notes.length}条)`}
              </span>
              {notesExpanded ? (
                <ChevronUp size={14} className="text-[color:var(--muted-foreground)]" />
              ) : (
                <ChevronDown size={14} className="text-[color:var(--muted-foreground)]" />
              )}
            </button>

            {notesExpanded && (
              <div className="mt-3 space-y-2">
                {item.notes.length > 0 ? (
                  item.notes.map((note) => (
                    <div
                      key={note.id}
                      className="neu-surface-subtle rounded-[12px] px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[color:var(--accent)]">
                          {note.type === 'PROGRESS'
                            ? '📝 进展'
                            : '💡 心得'}
                        </span>
                        <span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
                          {formatDateTimeLabel(note.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-[color:var(--foreground)]">
                        {note.content}
                      </p>
                    </div>
                  ))
                ) : (
                  <div
                    className="neu-content-block text-sm text-[color:var(--muted-foreground)]"
                    style={
                      { '--block-accent': 'var(--accent)' } as React.CSSProperties
                    }
                  >
                    还没有过程记录，可从当前推进情况开始补第一条。
                  </div>
                )}

                {/* 新增记录 */}
                <div className="mt-3 space-y-2">
                  <select
                    value={noteType}
                    onChange={(e) =>
                      onNoteTypeChange(
                        e.target.value as WorkArrangementNoteType,
                      )
                    }
                    className="workbench-input text-sm"
                  >
                    <option value="PROGRESS">过程记录</option>
                    <option value="INSIGHT">心得补充</option>
                  </select>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => onNoteDraftChange(e.target.value)}
                    rows={2}
                    placeholder="记录今天推进到了哪一步..."
                    className="neu-input text-sm"
                  />
                  <button
                    type="button"
                    onClick={onSubmitNote}
                    disabled={noteSubmitting || !noteDraft.trim()}
                    className="neu-btn-primary self-start"
                  >
                    {noteSubmitting ? '提交中...' : '添加记录'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/work-arrangements/task-detail-modal.tsx
git commit -m "feat: add TaskDetailModal — full task detail in portal modal

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Modify work-arrangements-page.tsx — Wire everything together

**Files:**
- Modify: `apps/web/src/components/work-arrangements/work-arrangements-page.tsx`

**Interfaces:**
- Consumes: All new components (TaskNotificationCenter, TaskDetailModal)
- Change: Replace TaskDetailPanel + AiAssistPanel imports with TaskNotificationCenter, add modal state, rewrite right column JSX

- [ ] **Step 1: Update imports in work-arrangements-page.tsx**

Replace lines 1-25 (imports section) — change:

```typescript
// Remove these imports:
import { TaskDetailPanel } from "@/components/work-arrangements/task-detail-panel";
import { AiAssistPanel } from "@/components/work-arrangements/ai-assist-panel";

// Add these imports:
import { TaskNotificationCenter } from "@/components/work-arrangements/task-notification-center";
import { TaskDetailModal } from "@/components/work-arrangements/task-detail-modal";
import type { PlannedItem } from "@/components/work-arrangements/ai-planning-panel";
```

- [ ] **Step 2: Add modal open/close state in the component**

Add right after the existing state declarations (around line 258, after `const [activeReminders, setActiveReminders] = useState<ReminderInfo[]>([]);`):

```typescript
const [showTaskModal, setShowTaskModal] = useState(false);
```

- [ ] **Step 3: Update handleSelectTask to also open the modal**

Replace the existing `handleSelectTask` function (lines 546-549):

```typescript
const handleSelectTask = (taskId: string) => {
  setSelectedItemId(taskId);
  setNoteDraft("");
  setCreating(false);
  setShowTaskModal(true);  // Open modal on task select
};
```

- [ ] **Step 4: Add handleAddToCalendar function**

Add after `handlePostponeReminder` (around line 680):

```typescript
const handleAddToCalendar = async (plannedItems: PlannedItem[]) => {
  setSaving(true);
  setErrorMessage(null);
  let createdCount = 0;
  try {
    for (const item of plannedItems) {
      // Create a time-block task for each planned item
      const now = new Date();
      const startHour = 10 + Math.floor(createdCount * 0.5);
      const startMinute = (createdCount * 30) % 60;
      const blockStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        startHour,
        startMinute,
      );
      const blockEnd = new Date(
        blockStart.getTime() + item.estimatedMinutes * 60 * 1000,
      );
      await createWorkArrangement({
        title: `[待办] ${item.title}`,
        description: item.notificationId
          ? `关联通知: ${item.notificationId}`
          : undefined,
        type: 'FOLLOW_UP',
        urgency: 'HIGH',
        status: 'TODO',
        dueAt: blockEnd.toISOString(),
        reminderAt: blockStart.toISOString(),
        estimatedMinutes: item.estimatedMinutes,
        isAllDay: false,
        customTags: ['AI安排'],
        recurrence: 'NONE',
        projectManagementItemId: null,
        dependencyIds: [],
        completionSummary: null,
        reflectionSummary: null,
      });
      createdCount++;
    }
    // Show toast via sonner
    const { toast } = await import('sonner');
    toast.success(`已添加 ${createdCount} 个事项到今日日程`);
    // Refresh everything
    await loadWorkspace(false, true);
  } catch (error) {
    setErrorMessage(
      error instanceof Error ? error.message : '添加日程失败。',
    );
  } finally {
    setSaving(false);
  }
};
```

- [ ] **Step 5: Replace right column JSX**

Replace lines 767-770 (the right column div contents):

```typescript
{/* OLD — remove these two lines:
<TaskDetailPanel item={selectedItem} reminderState={selectedReminderState} noteType={noteType} noteDraft={noteDraft} noteSubmitting={noteSubmitting} showNotesPanel={showNotesPanel} onStart={() => void handleQuickStatusUpdate('IN_PROGRESS')} onComplete={() => void handleQuickStatusUpdate('COMPLETED')} onBlock={() => void handleQuickStatusUpdate('BLOCKED')} onUnblock={() => void handleUnblock()} onCancel={() => void handleCancel()} onPostponeReminder={() => void handlePostponeReminder()} onOpenFullEditor={() => setShowFullEditor(true)} onOpenNotes={() => setShowNotesPanel(true)} onNoteTypeChange={setNoteType} onNoteDraftChange={setNoteDraft} onSubmitNote={() => void handleAddNote()}/>
<AiAssistPanel dailyPlan={dailyPlan} refreshingPlan={refreshingPlan} isChairman={false} showProjectBrief={currentUser?.role === 'leader' || currentUser?.role === 'admin'} onSelectTimeBlock={(taskIds) => { setHighlightedTaskIds(taskIds); const id = taskIds[0]; if (id) handleSelectTask(id); }} onRefreshPlan={() => void loadDailyPlan()} onShowHistory={() => setShowHistoryDrawer(true)}/>
*/}

{/* NEW — TaskNotificationCenter replacing both panels */}
<TaskNotificationCenter
  dailyPlan={dailyPlan}
  refreshingPlan={refreshingPlan}
  onRefreshPlan={() => void loadDailyPlan()}
  onAddToCalendar={handleAddToCalendar}
  onShowHistory={() => setShowHistoryDrawer(true)}
/>
```

- [ ] **Step 6: Add TaskDetailModal after WorkTaskEditorDrawer**

Add after the `WorkTaskEditorDrawer` closing tag (around line 806) and before the HistoryDrawer:

```typescript
{/* Task Detail Modal */}
<TaskDetailModal
  open={showTaskModal}
  item={selectedItem}
  reminderState={selectedReminderState}
  noteType={noteType}
  noteDraft={noteDraft}
  noteSubmitting={noteSubmitting}
  onClose={() => {
    setShowTaskModal(false);
    // Refresh if there were state changes during modal session
    refreshTasksOnly(true);
  }}
  onStart={() => void handleQuickStatusUpdate('IN_PROGRESS')}
  onComplete={() => void handleQuickStatusUpdate('COMPLETED')}
  onBlock={() => void handleQuickStatusUpdate('BLOCKED')}
  onUnblock={() => void handleUnblock()}
  onCancel={() => void handleCancel()}
  onPostponeReminder={() => void handlePostponeReminder()}
  onOpenFullEditor={() => {
    setShowTaskModal(false);
    setShowFullEditor(true);
  }}
  onNoteTypeChange={setNoteType}
  onNoteDraftChange={setNoteDraft}
  onSubmitNote={() => void handleAddNote()}
/>
```

- [ ] **Step 7: Remove unused state variables**

Remove these state declarations (no longer used since TaskDetailPanel inline panel is removed):
- `showNotesPanel` state + setter (was used to toggle notes panel visibility in-side panel)
Remove `const [showNotesPanel, setShowNotesPanel] = useState(false);` on line 256.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/work-arrangements/work-arrangements-page.tsx
git commit -m "feat: wire TaskNotificationCenter + TaskDetailModal into workbench page

Replace TaskDetailPanel + AiAssistPanel with TaskNotificationCenter.
Add TaskDetailModal triggered by task selection.
Add handleAddToCalendar for AI-planned time blocks.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Remove deprecated files

**Files:**
- Delete: `apps/web/src/components/work-arrangements/task-detail-panel.tsx`

**Note:** `work-task-quick-view.tsx` is kept — it was the inline rendering inside task-detail-panel that no longer has a consumer. But it's a standalone component that could be reused. We'll leave it for now and let dead-code elimination be a separate task.

- [ ] **Step 1: Delete task-detail-panel.tsx**

```bash
rm apps/web/src/components/work-arrangements/task-detail-panel.tsx
```

- [ ] **Step 2: Commit**

```bash
git rm apps/web/src/components/work-arrangements/task-detail-panel.tsx
git commit -m "refactor: remove TaskDetailPanel — replaced by TaskNotificationCenter + TaskDetailModal

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Verify build compiles

**Files:**
- (All new/modified files from Tasks 1-7)

- [ ] **Step 1: Build the web app to verify no compilation errors**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors. If errors appear, fix them before proceeding.

- [ ] **Step 2: Commit any fixes**

Only needed if build errors were found and fixed.

---

### Task 9: Visual verification — run and screenshot

**Files:**
- (No code changes)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm dev:web
```

- [ ] **Step 2: Open browser and navigate to workbench**

Navigate to `http://localhost:3005/work-arrangements` (login as 陈主任 / czr@2026)

- [ ] **Step 3: Verify visual elements**

Check each of these:
1. Right panel shows `TaskNotificationCenter` with KPI bar → notification card list → AI planning section
2. KPI bar shows three stat cards (待审批/待复核/即将到期) with real numbers
3. Notification cards appear sorted by urgency, with color bars and action buttons
4. AI planning section shows "刷新分析" and "添加到日历" buttons
5. Click a task in the left calendar list → `TaskDetailModal` opens centered
6. Modal shows: gradient header with status, title, description, 2×2 info grid, action buttons, process notes
7. Close modal via X button, backdrop click, or Esc key
8. Modal action buttons (start/complete/block) work and refresh the left task list
9. When all KPIs are zero, "今日待办已清零 ✓" shows
10. Check responsive: left panel goes full-width on mobile, right panel still accessible

- [ ] **Step 4: Document any visual issues**

Take screenshots and note any alignment, spacing, or color issues for follow-up polish.
