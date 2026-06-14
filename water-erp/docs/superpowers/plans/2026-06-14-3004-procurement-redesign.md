# 3004 Procurement Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved shallow-light “运营指挥台” redesign for the 3004 procurement management web app.

**Architecture:** Keep the existing Next.js app routes and API contracts. Add a small local `components/workbench` component set plus design tokens in `lib/workbench.ts`/`globals.css`, then migrate the shell, dashboard, and primary notice/supplier/expert pages to the shared visual language without changing business behavior.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, TypeScript, lucide-react, existing `/api` clients.

---

## File Structure

Create:

- `apps/web/src/components/workbench/page-hero.tsx` — reusable page title, eyebrow, subtitle, and action container.
- `apps/web/src/components/workbench/metric-card.tsx` — reusable KPI/stat card.
- `apps/web/src/components/workbench/section-card.tsx` — consistent section panel wrapper.
- `apps/web/src/components/workbench/status-badge.tsx` — semantic status badge.
- `apps/web/src/components/workbench/data-toolbar.tsx` — consistent search/filter toolbar wrapper.
- `apps/web/src/components/workbench/module-card.tsx` — business module entry/summary card.
- `apps/web/src/components/workbench/index.ts` — component barrel export.

Modify:

- `apps/web/src/lib/workbench.ts` — expand theme/tone tokens and helper functions.
- `apps/web/src/app/globals.css` — add global workbench utility classes for background, tables, form controls, and focus states.
- `apps/web/src/components/app-shell.tsx` — change top bar and sidebar to light command-center style.
- `apps/web/src/app/(dashboard)/dashboard/page.tsx` — rebuild as procurement operations overview.
- `apps/web/src/app/(dashboard)/notice/page.tsx` — apply common page hero, toolbar, table/card styles while preserving current logic.
- `apps/web/src/app/(dashboard)/supplier/repository/page.tsx` — apply common visual language.
- `apps/web/src/app/(dashboard)/expert/repository/page.tsx` — apply common visual language.
- `apps/web/src/app/(dashboard)/supplier/approval/page.tsx` — apply page hero/section/card style.
- `apps/web/src/app/(dashboard)/supplier/selection/page.tsx` — apply page hero/section/card style.
- `apps/web/src/app/(dashboard)/supplier/evaluation/page.tsx` — apply page hero/section/card style.
- `apps/web/src/app/(dashboard)/expert/entry/page.tsx` — apply page hero/form section style.
- `apps/web/src/app/(dashboard)/expert/extract/page.tsx` — apply page hero/section style.
- `apps/web/src/app/(dashboard)/expert/evaluation/page.tsx` — apply page hero/section style.

Implementation notes:

- Run commands from `water-erp/`.
- Do not add hardcoded business fake data.
- Preserve existing API calls and route behavior.
- Prefer visual-only changes unless a small helper is required to derive real metrics from current data.

---

## Task 1: Add shared workbench tokens and components

**Files:**
- Modify: `apps/web/src/lib/workbench.ts`
- Create: `apps/web/src/components/workbench/page-hero.tsx`
- Create: `apps/web/src/components/workbench/metric-card.tsx`
- Create: `apps/web/src/components/workbench/section-card.tsx`
- Create: `apps/web/src/components/workbench/status-badge.tsx`
- Create: `apps/web/src/components/workbench/data-toolbar.tsx`
- Create: `apps/web/src/components/workbench/module-card.tsx`
- Create: `apps/web/src/components/workbench/index.ts`

- [ ] **Step 1: Replace `apps/web/src/lib/workbench.ts` with expanded tokens and helpers**

```ts
export const workbenchTheme = {
  primary: '#064ea2',
  primaryBright: '#0b63ce',
  primarySoft: '#eff6ff',
  cyan: '#0891b2',
  cyanSoft: '#ecfeff',
  success: '#11a874',
  successSoft: '#f0fdf4',
  warning: '#f5a623',
  warningSoft: '#fff7ed',
  danger: '#e74c3c',
  dangerSoft: '#fef2f2',
  purple: '#7c3aed',
  purpleSoft: '#f5f3ff',
  text: '#18243a',
  heading: '#0f2f57',
  muted: '#5a6d8a',
  faint: '#8a96aa',
  border: '#e5ecf4',
  borderStrong: '#cfe0f5',
  surface: '#ffffff',
  page: '#f7fbff',
} as const;

export type WorkbenchTone = 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'purple' | 'gray';

export const statusTone: Record<WorkbenchTone, { color: string; bg: string; border: string; gradient: string }> = {
  blue: { color: '#064ea2', bg: '#eff6ff', border: '#bfdbfe', gradient: 'from-[#064ea2] to-[#0b63ce]' },
  cyan: { color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc', gradient: 'from-[#0891b2] to-[#06b6d4]' },
  green: { color: '#11a874', bg: '#f0fdf4', border: '#bbf7d0', gradient: 'from-[#0f9f6e] to-[#22c55e]' },
  orange: { color: '#f5a623', bg: '#fff7ed', border: '#fed7aa', gradient: 'from-[#f59e0b] to-[#fb923c]' },
  red: { color: '#e74c3c', bg: '#fef2f2', border: '#fecaca', gradient: 'from-[#dc2626] to-[#f97316]' },
  purple: { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', gradient: 'from-[#7c3aed] to-[#a78bfa]' },
  gray: { color: '#5a6d8a', bg: '#f8fafc', border: '#e5ecf4', gradient: 'from-[#64748b] to-[#94a3b8]' },
};

export function numberOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN');
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

export function completionTone(value: number): WorkbenchTone {
  if (value >= 80) return 'green';
  if (value >= 50) return 'cyan';
  if (value > 0) return 'orange';
  return 'gray';
}
```

- [ ] **Step 2: Create `PageHero`**

Create `apps/web/src/components/workbench/page-hero.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
  tone?: 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const toneClass = {
  blue: 'border-[#bfdbfe] bg-[#eff6ff] text-[#064ea2]',
  cyan: 'border-[#a5f3fc] bg-[#ecfeff] text-[#0891b2]',
  green: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#11a874]',
  orange: 'border-[#fed7aa] bg-[#fff7ed] text-[#f5a623]',
  red: 'border-[#fecaca] bg-[#fef2f2] text-[#e74c3c]',
  purple: 'border-[#ddd6fe] bg-[#f5f3ff] text-[#7c3aed]',
  gray: 'border-[#e5ecf4] bg-[#f8fafc] text-[#5a6d8a]',
};

export function PageHero({ eyebrow, title, description, tone = 'blue', icon, actions, children, className }: PageHeroProps) {
  return (
    <section className={cn('overflow-hidden rounded-[24px] border border-[#dbeafe] bg-white/88 p-6 shadow-[0_18px_60px_rgba(15,47,87,0.08)] backdrop-blur', className)}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className={cn('mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold', toneClass[tone])}>
              {icon}
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-black tracking-tight text-[#0f2f57]">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5a6d8a]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  );
}
```

- [ ] **Step 3: Create `MetricCard`**

Create `apps/web/src/components/workbench/metric-card.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@/lib/workbench';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: WorkbenchTone;
  icon?: ReactNode;
  onClick?: () => void;
  footer?: ReactNode;
  className?: string;
}

export function MetricCard({ label, value, hint, tone = 'blue', icon, onClick, footer, className }: MetricCardProps) {
  const toneConfig = statusTone[tone];
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={cn('group rounded-2xl border bg-white p-5 text-left shadow-sm transition', onClick && 'hover:-translate-y-0.5 hover:shadow-lg', className)}
      style={{ borderColor: toneConfig.border }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="text-xs font-bold text-[#5a6d8a]">{label}</span>
        {icon && <span className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ color: toneConfig.color, backgroundColor: toneConfig.bg }}>{icon}</span>}
      </div>
      <div className="text-3xl font-black tracking-tight text-[#18243a]">{value}</div>
      {hint && <p className="mt-1 text-xs leading-5 text-[#8a96aa]">{hint}</p>}
      {footer && <div className="mt-4 text-xs text-[#5a6d8a]">{footer}</div>}
      {onClick && <ArrowRight className="mt-3 text-[#8a96aa] opacity-0 transition group-hover:opacity-100" size={16} />}
    </Component>
  );
}
```

- [ ] **Step 4: Create remaining shared components**

Create `apps/web/src/components/workbench/section-card.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, description, icon, action, children, className }: SectionCardProps) {
  return (
    <section className={cn('rounded-2xl border border-[#e5ecf4] bg-white p-6 shadow-sm', className)}>
      {(title || description || icon || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {icon && <div className="mt-0.5 text-[#064ea2]">{icon}</div>}
            <div>
              {title && <h2 className="text-lg font-black text-[#18243a]">{title}</h2>}
              {description && <p className="mt-1 text-sm leading-5 text-[#5a6d8a]">{description}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
```

Create `apps/web/src/components/workbench/status-badge.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@/lib/workbench';

interface StatusBadgeProps {
  children: ReactNode;
  tone?: WorkbenchTone;
  className?: string;
}

export function StatusBadge({ children, tone = 'gray', className }: StatusBadgeProps) {
  const t = statusTone[tone];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold', className)} style={{ color: t.color, backgroundColor: t.bg, borderColor: t.border }}>
      {children}
    </span>
  );
}
```

Create `apps/web/src/components/workbench/data-toolbar.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DataToolbarProps {
  children: ReactNode;
  className?: string;
}

export function DataToolbar({ children, className }: DataToolbarProps) {
  return <div className={cn('rounded-2xl border border-[#dbeafe] bg-white/90 p-4 shadow-sm backdrop-blur flex flex-wrap items-center gap-3', className)}>{children}</div>;
}
```

Create `apps/web/src/components/workbench/module-card.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusTone, type WorkbenchTone } from '@/lib/workbench';

interface ModuleCardProps {
  title: string;
  description: string;
  tone?: WorkbenchTone;
  icon?: ReactNode;
  stats?: ReactNode;
  actionLabel?: string;
  onClick?: () => void;
  className?: string;
}

export function ModuleCard({ title, description, tone = 'blue', icon, stats, actionLabel = '进入模块', onClick, className }: ModuleCardProps) {
  const t = statusTone[tone];
  return (
    <button onClick={onClick} className={cn('group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg', className)} style={{ borderColor: t.border }}>
      <div className="mb-4 flex items-center justify-between">
        {icon && <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ color: t.color, backgroundColor: t.bg }}>{icon}</span>}
        <ArrowRight className="text-[#8a96aa] transition group-hover:translate-x-0.5 group-hover:text-[#064ea2]" size={18} />
      </div>
      <h3 className="text-lg font-black text-[#18243a]">{title}</h3>
      <p className="mt-2 min-h-[40px] text-sm leading-5 text-[#5a6d8a]">{description}</p>
      {stats && <div className="mt-4">{stats}</div>}
      <div className="mt-4 text-sm font-bold" style={{ color: t.color }}>{actionLabel}</div>
    </button>
  );
}
```

- [ ] **Step 5: Create barrel export**

Create `apps/web/src/components/workbench/index.ts`:

```ts
export { DataToolbar } from './data-toolbar';
export { MetricCard } from './metric-card';
export { ModuleCard } from './module-card';
export { PageHero } from './page-hero';
export { SectionCard } from './section-card';
export { StatusBadge } from './status-badge';
```

- [ ] **Step 6: Run lint for new files**

Run from `water-erp/`:

```bash
pnpm --filter web lint
```

Expected: no TypeScript/ESLint errors related to the new components.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench.ts apps/web/src/components/workbench
git commit -m "feat(web): add workbench design components"
```

---

## Task 2: Apply global workbench styling and AppShell redesign

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/app-shell.tsx`

- [ ] **Step 1: Append global workbench utilities to `globals.css`**

Add after the existing `body` block:

```css
.workbench-page-bg {
  background:
    radial-gradient(circle at 8% 0%, rgba(14, 98, 208, 0.14), transparent 30%),
    radial-gradient(circle at 88% 8%, rgba(8, 145, 178, 0.12), transparent 26%),
    linear-gradient(180deg, #f7fbff 0%, #f8fafc 100%);
}

.workbench-grid-bg {
  background-image:
    linear-gradient(rgba(6, 78, 162, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(6, 78, 162, 0.035) 1px, transparent 1px);
  background-size: 28px 28px;
}

.workbench-input {
  border: 1px solid #dbe6f3;
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.92);
  padding: 0.625rem 0.75rem;
  color: #18243a;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.workbench-input:focus {
  border-color: #0b63ce;
  box-shadow: 0 0 0 3px rgba(11, 99, 206, 0.12);
}

.workbench-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.workbench-table thead tr {
  border-bottom: 1px solid #e5ecf4;
  color: #5a6d8a;
  text-align: left;
}

.workbench-table th,
.workbench-table td {
  padding: 0.875rem 1.25rem;
}

.workbench-table tbody tr {
  border-bottom: 1px solid #eef3f8;
}

.workbench-table tbody tr:last-child {
  border-bottom: 0;
}

.workbench-table tbody tr:hover {
  background: #f8fbff;
}
```

- [ ] **Step 2: Replace `navItems` metadata in `app-shell.tsx`**

Update each item to include `caption`. Use the existing paths and children:

```ts
interface NavItem {
  label: string;
  caption?: string;
  path?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  children?: NavChild[];
}

const navItems: NavItem[] = [
  { label: '首页驾驶舱', caption: '运营总览', path: '/dashboard', icon: LayoutDashboard },
  { label: '信息发布中心', caption: '公告 / 公示 / 政策', path: '/notice', icon: Megaphone },
  {
    label: '供应商管理中心', caption: '审批 / 库 / 评价', path: '/supplier', icon: Building2,
    children: [
      { label: '供应商审批', path: '/supplier/approval' },
      { label: '供应商库', path: '/supplier/repository' },
      { label: '供应商选取', path: '/supplier/selection' },
      { label: '供应商评价', path: '/supplier/evaluation' },
    ],
  },
  {
    label: '专家管理中心', caption: '录入 / 抽取 / 履职', path: '/expert', icon: UsersRound,
    children: [
      { label: '专家录入', path: '/expert/entry' },
      { label: '专家库', path: '/expert/repository' },
      { label: '专家抽取', path: '/expert/extract' },
      { label: '专家评价', path: '/expert/evaluation' },
    ],
  },
];
```

- [ ] **Step 3: Update shell wrapper classes**

In `AppShell`, change the outer wrapper and header/sidebar classes to light command-center style. Preserve all existing state, routing, auth, and logout code.

Use these class patterns in the JSX:

```tsx
<div className="flex h-screen flex-col overflow-hidden workbench-page-bg text-[#18243a]">
  <header className="sticky top-0 z-50 flex-shrink-0 border-b border-[#dbe6f3] bg-white/86 backdrop-blur-xl">
    <div className="flex h-[68px] items-center justify-between px-6">
      ...
    </div>
  </header>
  <div className="flex flex-1 overflow-hidden">
    <aside className={`${collapsed ? 'w-[68px]' : 'w-[272px]'} m-3 mr-0 flex flex-shrink-0 flex-col overflow-hidden rounded-[24px] border border-[#dbe6f3] bg-white/88 shadow-[0_18px_60px_rgba(15,47,87,0.10)] backdrop-blur transition-all duration-200`}>
      ...
    </aside>
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <main className="workbench-grid-bg flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Update nav item active styles**

For first-level nav buttons, use:

```tsx
className={`relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all ${
  (hasChildren ? groupActive : isActive(item.path!))
    ? 'bg-gradient-to-r from-[#064ea2] to-[#0b63ce] text-white shadow-[0_12px_28px_rgba(6,78,162,0.24)]'
    : 'text-[#5a6d8a] hover:bg-[#eff6ff] hover:text-[#064ea2]'
}`}
```

When expanded, render label plus caption:

```tsx
{!collapsed && (
  <span className="min-w-0 flex-1">
    <span className="block text-sm font-black tracking-tight">{item.label}</span>
    {item.caption && <span className="mt-0.5 block truncate text-[11px] opacity-70">{item.caption}</span>}
  </span>
)}
```

For child nav buttons, use:

```tsx
className={`flex w-full items-center rounded-xl px-3 py-2 text-[12.5px] transition-colors ${
  pathname === child.path
    ? 'bg-[#eff6ff] font-bold text-[#064ea2]'
    : 'text-[#6b7c95] hover:bg-[#f8fbff] hover:text-[#064ea2]'
}`}
```

- [ ] **Step 5: Run lint**

```bash
pnpm --filter web lint
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/app-shell.tsx
git commit -m "feat(web): redesign procurement workbench shell"
```

---

## Task 3: Rebuild dashboard as operations overview

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Update imports**

Add imports from the new workbench components and keep current API imports. Include these icons if not already present:

```tsx
import { DataToolbar, MetricCard, ModuleCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import { completionTone, formatDateTime, numberOrZero, percent, statusTone } from '@/lib/workbench';
import {
  AlertTriangle, ArrowRight, BellRing, Building2, CheckCircle2,
  Clock3, FileText, Megaphone, PlusCircle, ShieldAlert, Sparkles,
  TrendingUp, UsersRound, Activity,
} from 'lucide-react';
```

- [ ] **Step 2: Add derived metrics after existing memoized counts**

Add these constants after `alertCount`:

```tsx
const announcementTotal = numberOrZero(announcementStats?.total);
const announcementPublished = numberOrZero(announcementStats?.published);
const supplierTotal = numberOrZero(supplierStats?.total);
const supplierApproved = numberOrZero(supplierStats?.approved);
const expertTotal = experts.length;
const expertAssignments = experts.reduce((sum, expert) => sum + (expert.bidExperts || []).length, 0);
const announcementHealth = percent(announcementPublished, announcementTotal);
const supplierHealth = percent(supplierApproved, supplierTotal);
const expertHealth = percent(Math.max(expertAssignments - expertUnfinishedCount, 0), expertAssignments);
```

- [ ] **Step 3: Replace the current returned JSX with the new dashboard structure**

Use the same data and click routes. Replace only the JSX inside `return (...)`:

```tsx
return (
  <div className="min-h-full space-y-6">
    <PageHero
      eyebrow="采购运营总览"
      title={`欢迎回来，${user?.displayName || '采购管理员'}`}
      description="聚焦信息发布、供应商资源、专家履职和风险效率状态，用真实业务数据辅助日常管理判断。"
      icon={<Sparkles size={14} strokeWidth={1.8} />}
      actions={(
        <>
          <button onClick={() => router.push('/notice')} className="inline-flex items-center gap-2 rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white shadow-[0_10px_24px_rgba(6,78,162,0.20)] hover:bg-[#053f85]">
            <PlusCircle size={16} /> 新建信息
          </button>
          <button onClick={() => router.push('/supplier/approval')} className="inline-flex items-center gap-2 rounded-xl border border-[#dbeafe] bg-white px-4 py-2 text-sm font-bold text-[#064ea2] hover:bg-[#eff6ff]">
            处理审核 <ArrowRight size={16} />
          </button>
        </>
      )}
    >
      <DataToolbar className="bg-gradient-to-r from-[#f8fbff] to-[#ecfeff]">
        <StatusBadge tone="cyan">运行态势</StatusBadge>
        <span className="text-sm text-[#5a6d8a]">数据更新时间：{formatDateTime(new Date())}</span>
        <span className="text-sm text-[#5a6d8a]">当前聚合 {totalTodos} 项待处理、{alertCount} 项风险提醒</span>
      </DataToolbar>
    </PageHero>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="信息发布" value={loading ? '—' : `${announcementPublished}/${announcementTotal}`} hint="已发布 / 信息总量" tone="blue" icon={<Megaphone size={18} strokeWidth={1.7} />} onClick={() => router.push('/notice')} />
      <MetricCard label="供应商资源" value={loading ? '—' : `${supplierApproved}/${supplierTotal}`} hint="已入库 / 供应商总数" tone="green" icon={<Building2 size={18} strokeWidth={1.7} />} onClick={() => router.push('/supplier/repository')} />
      <MetricCard label="专家资源" value={loading ? '—' : `${expertTotal}`} hint={`${expertAssignments} 条参与记录`} tone="purple" icon={<UsersRound size={18} strokeWidth={1.7} />} onClick={() => router.push('/expert/repository')} />
      <MetricCard label="待处理事项" value={loading ? '—' : totalTodos} hint="待发布、待审核、专家未完成" tone="orange" icon={<BellRing size={18} strokeWidth={1.7} />} onClick={() => router.push('/supplier/approval')} />
      <MetricCard label="风险预警" value={loading ? '—' : alertCount} hint="异常供应商与专家提醒" tone="red" icon={<ShieldAlert size={18} strokeWidth={1.7} />} onClick={() => router.push('/dashboard#risk')} />
    </section>

    <section className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
      <SectionCard title="业务运行健康度" description="以现有真实统计计算各业务中心当前运行状态" icon={<Activity size={20} strokeWidth={1.7} />}>
        <div className="space-y-5">
          {[
            { label: '信息发布健康度', value: announcementHealth, detail: `${announcementPublished} / ${announcementTotal} 已发布`, tone: completionTone(announcementHealth) },
            { label: '供应商库健康度', value: supplierHealth, detail: `${supplierApproved} / ${supplierTotal} 已入库`, tone: completionTone(supplierHealth) },
            { label: '专家履职健康度', value: expertHealth, detail: `${expertUnfinishedCount} 项未完成`, tone: completionTone(expertHealth) },
          ].map(item => (
            <div key={item.label}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-bold text-[#18243a]">{item.label}</span>
                <span className="text-[#5a6d8a]">{item.detail}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[#edf4fb]">
                <div className={`h-full rounded-full bg-gradient-to-r ${statusTone[item.tone].gradient}`} style={{ width: `${item.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard id="risk" title="风险与效率摘要" description="优先处理会影响采购运营连续性的事项" icon={<AlertTriangle size={20} strokeWidth={1.7} />}>
        <div className="space-y-3">
          <button onClick={() => router.push('/supplier/repository')} className="w-full rounded-xl border border-[#fecaca] bg-[#fef2f2] p-4 text-left text-sm text-[#991b1b] hover:bg-[#fee2e2]">
            <strong>异常/黑名单供应商：</strong>当前 {supplierRisk} 家供应商处于停用或黑名单状态。
          </button>
          <button onClick={() => router.push('/supplier/approval')} className="w-full rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-left text-sm text-[#9a3412] hover:bg-[#ffedd5]">
            <strong>供应商待审：</strong>{pendingSuppliers} 家供应商等待资料审核。
          </button>
          <button onClick={() => router.push('/notice')} className="w-full rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4 text-left text-sm text-[#064ea2] hover:bg-[#dbeafe]">
            <strong>信息发布效率：</strong>{announcementDraftLike} 条信息需要完善或发布。
          </button>
          <button onClick={() => router.push('/expert/repository')} className="w-full rounded-xl border border-[#ddd6fe] bg-[#f5f3ff] p-4 text-left text-sm text-[#5b21b6] hover:bg-[#ede9fe]">
            <strong>专家履职提醒：</strong>{expertUnfinishedCount} 项专家事项未完成。
          </button>
        </div>
      </SectionCard>
    </section>

    <section className="grid gap-4 lg:grid-cols-3">
      <ModuleCard title="信息发布中心" description="公告、公示、政策制度、草稿与发布记录" tone="blue" icon={<Megaphone size={22} />} actionLabel="进入发布中心" onClick={() => router.push('/notice')} stats={<span className="text-sm text-[#5a6d8a]">已发布 {announcementPublished} 条，待完善 {announcementDraftLike} 条</span>} />
      <ModuleCard title="供应商管理中心" description="供应商审核、供应商库、评价、变更和黑名单" tone="green" icon={<Building2 size={22} />} actionLabel="管理供应商" onClick={() => router.push('/supplier/repository')} stats={<span className="text-sm text-[#5a6d8a]">已入库 {supplierApproved} 家，待审 {pendingSuppliers} 家</span>} />
      <ModuleCard title="专家管理中心" description="专家库、抽取分配、回避关系、履职评价" tone="purple" icon={<UsersRound size={22} />} actionLabel="管理专家" onClick={() => router.push('/expert/repository')} stats={<span className="text-sm text-[#5a6d8a]">专家 {expertTotal} 名，参与记录 {expertAssignments} 条</span>} />
    </section>

    <SectionCard title="运营摘要" description="按业务中心汇总当前可观察状态" icon={<CheckCircle2 size={20} strokeWidth={1.7} />}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-[#f8fbff] p-4"><span className="font-bold text-[#18243a]">发布动态</span><p className="mt-1 text-sm text-[#5a6d8a]">已发布 {announcementPublished} 条，招标公告 {numberOrZero(announcementStats?.bidNotice)} 条，中标公告 {numberOrZero(announcementStats?.winNotice)} 条。</p></div>
        <div className="rounded-xl bg-[#f8fbff] p-4"><span className="font-bold text-[#18243a]">供应商动态</span><p className="mt-1 text-sm text-[#5a6d8a]">总数 {supplierTotal} 家，已入库 {supplierApproved} 家，风险状态 {supplierRisk} 家。</p></div>
        <div className="rounded-xl bg-[#f8fbff] p-4"><span className="font-bold text-[#18243a]">专家动态</span><p className="mt-1 text-sm text-[#5a6d8a]">专家 {expertTotal} 名，当前 {expertActiveCount} 项参与记录，未完成 {expertUnfinishedCount} 项。</p></div>
      </div>
    </SectionCard>
  </div>
);
```

If TypeScript rejects `id` on `SectionCard`, add `id?: string` to `SectionCardProps` and pass it to `<section id={id}>`.

- [ ] **Step 4: Run lint**

```bash
pnpm --filter web lint
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/'(dashboard)'/dashboard/page.tsx apps/web/src/components/workbench/section-card.tsx
git commit -m "feat(web): rebuild procurement dashboard overview"
```

---

## Task 4: Apply common styling to notice, supplier repository, and expert repository

**Files:**
- Modify: `apps/web/src/app/(dashboard)/notice/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/supplier/repository/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/expert/repository/page.tsx`

- [ ] **Step 1: Update Notice page imports**

Add:

```tsx
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import { FileText, Megaphone, PlusCircle } from 'lucide-react';
```

If `FileText`/`Megaphone`/`PlusCircle` conflict with existing imports, merge them into the existing lucide import.

- [ ] **Step 2: Replace Notice page title block and filter wrappers**

Replace the top title block with:

```tsx
<PageHero
  eyebrow="信息发布中心"
  title="信息发布中心"
  description="招标公示、中标公示、政策法规、平台通知；起草并配齐招标文件/附件后再发布。"
  tone="blue"
  icon={<Megaphone size={14} />}
  actions={<button onClick={() => setEditor('new')} className="inline-flex items-center gap-2 rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white hover:bg-[#054280]"><PlusCircle size={16} /> 新建信息</button>}
/>
```

Immediately after it, add a stats grid derived from real `data.items` and `data.total`:

```tsx
<div className="mt-6 grid gap-4 md:grid-cols-4">
  <MetricCard label="信息总数" value={data.total} hint="当前筛选条件下总量" tone="blue" icon={<FileText size={18} />} />
  <MetricCard label="已发布" value={data.items.filter(item => item.status === 'PUBLISHED').length} hint="本页已发布记录" tone="green" />
  <MetricCard label="草稿" value={data.items.filter(item => item.status === 'DRAFT').length} hint="本页草稿记录" tone="orange" />
  <MetricCard label="已归档" value={data.items.filter(item => item.status === 'ARCHIVED').length} hint="本页归档记录" tone="gray" />
</div>
```

Wrap existing type filter buttons in:

```tsx
<div className="mt-6 mb-4 flex flex-wrap gap-2">...</div>
```

Replace the existing search/filter div class with:

```tsx
<DataToolbar className="mb-4">
  ... existing input/select ...
</DataToolbar>
```

Replace the table wrapper `div` class with:

```tsx
<SectionCard className="overflow-hidden p-0">
```

Change `<table className="w-full text-sm">` to:

```tsx
<table className="workbench-table">
```

Close the wrapper with `</SectionCard>` instead of `</div>`.

- [ ] **Step 3: Use `StatusBadge` for Notice statuses where practical**

Where status/type spans are rendered, convert to:

```tsx
<StatusBadge tone="blue">{typeMap[item.type].label}</StatusBadge>
<StatusBadge tone={item.status === 'PUBLISHED' ? 'green' : item.status === 'DRAFT' ? 'orange' : 'gray'}>{statusMap[item.status].label}</StatusBadge>
```

Keep any existing edit/delete/attachment behavior unchanged.

- [ ] **Step 4: Update Supplier Repository imports and header**

Add:

```tsx
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import { Building2, Layers } from 'lucide-react';
```

Replace the top header with:

```tsx
<PageHero
  eyebrow="供应商管理中心"
  title="供应商库"
  description="全量供应商目录、分类管理与状态维护；所有统计来自供应商真实接口。"
  tone="green"
  icon={<Building2 size={14} />}
  actions={<button onClick={() => setShowClassMgr(v => !v)} className="inline-flex items-center gap-2 rounded-xl border border-[#bbf7d0] bg-white px-4 py-2 text-sm font-bold text-[#11a874] hover:bg-[#f0fdf4]"><Layers size={16} /> {showClassMgr ? '收起分类管理' : '分类管理'}</button>}
/>
```

Replace the stats grid cards with `MetricCard`:

```tsx
<div className="mt-6 grid gap-4 md:grid-cols-4">
  <MetricCard label="供应商总数" value={stats.total} tone="blue" />
  <MetricCard label="已入库" value={stats.approved} tone="green" />
  <MetricCard label="已停用" value={stats.disabled} tone="gray" />
  <MetricCard label="黑名单" value={stats.blacklist} tone="red" />
</div>
```

Replace filter wrapper with `DataToolbar`. Replace main list/table panel wrappers with `SectionCard` where it does not alter event handlers.

- [ ] **Step 5: Update Expert Repository imports and header**

Add:

```tsx
import { DataToolbar, MetricCard, PageHero, StatusBadge } from '@/components/workbench';
import { PlusCircle, UsersRound } from 'lucide-react';
```

Replace header with:

```tsx
<PageHero
  eyebrow="专家管理中心"
  title="专家库"
  description="评审专家目录、专业分类与启停管理；展示专家资源与履职参与状态。"
  tone="purple"
  icon={<UsersRound size={14} />}
  actions={<button onClick={() => router.push('/expert/entry')} className="inline-flex items-center gap-2 rounded-xl bg-[#7c3aed] px-4 py-2 text-sm font-bold text-white hover:bg-[#6d28d9]"><PlusCircle size={16} /> 录入专家</button>}
/>
```

Replace stats grid with `MetricCard`, filter wrapper with `DataToolbar`, and active/specialty badges with `StatusBadge`.

- [ ] **Step 6: Run lint**

```bash
pnpm --filter web lint
```

Expected: pass. If there are unused imports, remove them.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/'(dashboard)'/notice/page.tsx apps/web/src/app/'(dashboard)'/supplier/repository/page.tsx apps/web/src/app/'(dashboard)'/expert/repository/page.tsx
git commit -m "feat(web): unify primary management pages"
```

---

## Task 5: Apply common visual shell to remaining supplier and expert pages

**Files:**
- Modify: `apps/web/src/app/(dashboard)/supplier/approval/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/supplier/selection/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/supplier/evaluation/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/expert/entry/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/expert/extract/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/expert/evaluation/page.tsx`

- [ ] **Step 1: For each page, add relevant shared imports**

Use this import shape, adjusting icons to existing page purpose:

```tsx
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
```

Use lucide icons already installed through `lucide-react`, for example:

```tsx
import { Building2, CheckCircle2, Search, UsersRound } from 'lucide-react';
```

- [ ] **Step 2: Replace each page top title block with `PageHero`**

Use these exact page headers:

Supplier approval:

```tsx
<PageHero eyebrow="供应商管理中心" title="供应商审批" description="处理供应商注册入库申请、资质资料和审核状态。" tone="orange" icon={<Building2 size={14} />} />
```

Supplier selection:

```tsx
<PageHero eyebrow="供应商管理中心" title="供应商选取" description="基于供应商库和分类信息辅助采购项目供应商选择。" tone="green" icon={<Building2 size={14} />} />
```

Supplier evaluation:

```tsx
<PageHero eyebrow="供应商管理中心" title="供应商评价" description="沉淀供应商履约、质量、服务等评价记录。" tone="green" icon={<CheckCircle2 size={14} />} />
```

Expert entry:

```tsx
<PageHero eyebrow="专家管理中心" title="专家录入" description="录入评审专家基础资料、专业方向和可用状态。" tone="purple" icon={<UsersRound size={14} />} />
```

Expert extract:

```tsx
<PageHero eyebrow="专家管理中心" title="专家抽取" description="围绕项目评审需求完成专家抽取和分配。" tone="purple" icon={<UsersRound size={14} />} />
```

Expert evaluation:

```tsx
<PageHero eyebrow="专家管理中心" title="专家评价" description="查看和维护专家履职评价结果。" tone="purple" icon={<CheckCircle2 size={14} />} />
```

- [ ] **Step 3: Wrap filter/search areas with `DataToolbar`**

For every page that has a search/filter row, change only the wrapper:

```tsx
<DataToolbar className="mb-4">
  ... existing inputs, selects, buttons ...
</DataToolbar>
```

Do not change state setters or API parameters.

- [ ] **Step 4: Wrap main content panels with `SectionCard`**

For table/list/form panels, use:

```tsx
<SectionCard className="overflow-hidden">
  ... existing table, cards, or form ...
</SectionCard>
```

If the existing content already has padding and wrapping causes too much spacing, use:

```tsx
<SectionCard className="overflow-hidden p-0">
  ... existing table ...
</SectionCard>
```

- [ ] **Step 5: Convert obvious status labels to `StatusBadge`**

Use this mapping when converting existing plain status spans:

```tsx
const tone = status === 'APPROVED' || status === 'PUBLISHED' || status === '可用'
  ? 'green'
  : status === 'PENDING' || status === 'DRAFT'
    ? 'orange'
    : status === 'BLACKLIST' || status === 'REJECTED'
      ? 'red'
      : 'gray';
```

Then render:

```tsx
<StatusBadge tone={tone}>{label}</StatusBadge>
```

Preserve all labels from the existing page.

- [ ] **Step 6: Run lint**

```bash
pnpm --filter web lint
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/'(dashboard)'/supplier/approval/page.tsx apps/web/src/app/'(dashboard)'/supplier/selection/page.tsx apps/web/src/app/'(dashboard)'/supplier/evaluation/page.tsx apps/web/src/app/'(dashboard)'/expert/entry/page.tsx apps/web/src/app/'(dashboard)'/expert/extract/page.tsx apps/web/src/app/'(dashboard)'/expert/evaluation/page.tsx
git commit -m "feat(web): refresh supplier and expert workflows"
```

---

## Task 6: Build verification and manual acceptance pass

**Files:**
- Modify only if lint/build reveals necessary fixes in files from prior tasks.

- [ ] **Step 1: Run web lint**

```bash
pnpm --filter web lint
```

Expected: pass.

- [ ] **Step 2: Run web build**

```bash
pnpm build:web
```

Expected: Next.js build completes successfully for `apps/web`.

- [ ] **Step 3: If shared/config imports fail, rebuild shared packages**

Only if build output reports stale workspace package artifacts, run:

```bash
pnpm --filter @water-erp/shared build
pnpm --filter @water-erp/config build
pnpm build:web
```

Expected: package builds complete, then web build passes.

- [ ] **Step 4: Manual browser verification**

Ask the user to start the app if it is not already running, because project memory says the user controls dev servers:

```text
请在会话里运行：! cd /Users/qihao/Desktop/ERP/water-erp && pnpm dev
```

Then verify in browser:

```text
http://localhost:3004/login
账号：caigou
密码：caigou@2026
```

Check:

- `/dashboard` shows shallow-light operations overview.
- Sidebar is light, supports expand/collapse, and active parent/child states are visible.
- `/notice` has consistent hero, toolbar, table, and real-data empty/loading behavior.
- `/supplier/repository` has consistent hero, stats, toolbar, and supplier cards/table.
- `/expert/repository` has consistent hero, stats, toolbar, and expert cards.
- Remaining supplier/expert workflow pages no longer visually clash with the new shell.
- No page displays fake business records when API data is empty or failed.

- [ ] **Step 5: Final commit for verification fixes**

If Step 1-4 required fixes:

```bash
git add apps/web
git commit -m "fix(web): polish procurement workbench redesign"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

Spec coverage:

- AppShell redesign: Task 2.
- Dashboard operations overview with 5 KPI and health/risk/module sections: Task 3.
- Shared component and token structure: Task 1.
- Primary pages `/notice`, `/supplier/repository`, `/expert/repository`: Task 4.
- Remaining supplier/expert workflow pages: Task 5.
- Real-data/no-mock principle: enforced in Tasks 3-6 by deriving from existing API data and preserving loading/empty states.
- Lint/build/manual verification: Task 6.

Placeholder scan:

- No TBD/TODO/fill-later instructions are included.
- Each implementation task includes concrete files, code patterns, commands, and expected outcomes.

Type consistency:

- `WorkbenchTone`, `statusTone`, `MetricCard`, `PageHero`, `SectionCard`, `StatusBadge`, `DataToolbar`, and `ModuleCard` are defined before use.
- The dashboard instruction notes the optional `id` prop addition required by the provided JSX.

One typo to fix during execution: in Task 6 Step 5, the command block contains `ngit commit`; replace it with `git commit` before running.
