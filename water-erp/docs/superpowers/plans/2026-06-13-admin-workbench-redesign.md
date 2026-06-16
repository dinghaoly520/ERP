# 3004 Admin Workbench Redesign Implementation Plan

> ⚠️ **端口变更提示（2026-06-15 端口重分配）：** 本计划编写时 web/采购管理端端口为 3004；重分配后 web 已改为 **3005**（见 `packages/config/src/ports.ts`）。文中出现的 `:3004` 均指如今的 `:3005`，标题/文件名中的 "3004" 为历史命名，保留以反映编写时状态。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the 3004 procurement management portal as a focused light-tech workbench with dashboard, information publishing center, supplier management center, and expert management center only.

**Architecture:** This is a frontend-first Next.js 16 App Router refactor inside `apps/web`. We will delete out-of-scope route directories, simplify the app shell navigation, and replace the dashboard/notice/supplier/expert pages with focused client components that reuse existing API wrappers and degrade gracefully when optional data is unavailable.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, `lucide-react`, existing `/api` cookie-auth client in `apps/web/src/lib/api.ts`.

---

## File Structure

### Delete

- `apps/web/src/app/(dashboard)/procurement/` — remove procurement project pages from 3004.
- `apps/web/src/app/(dashboard)/bid/` — remove bid/opening/evaluation/archive/supervision pages from 3004.
- `apps/web/src/app/(dashboard)/evaluation/` — remove evaluation page from 3004.
- `apps/web/src/app/(dashboard)/mall/` — remove mall page from 3004.

### Modify

- `apps/web/src/components/app-shell.tsx` — reduce navigation to dashboard, notice, supplier, expert and adjust labels to “采购管理工作台”.
- `apps/web/src/app/(dashboard)/dashboard/page.tsx` — replace generic bid/project dashboard with three-center procurement workbench.
- `apps/web/src/app/(dashboard)/notice/page.tsx` — upgrade from announcement list to information publishing center.
- `apps/web/src/app/(dashboard)/supplier/page.tsx` — upgrade from supplier table to supplier management center.
- `apps/web/src/app/(dashboard)/expert/page.tsx` — upgrade from expert list to expert management center.

### Create

- `apps/web/src/lib/workbench.ts` — focused shared helpers/constants for status colors, date formatting, card styles, and safe numeric fallbacks used by redesigned pages.

---

## Task 1: Remove Out-of-Scope Routes

**Files:**
- Delete: `apps/web/src/app/(dashboard)/procurement/`
- Delete: `apps/web/src/app/(dashboard)/bid/`
- Delete: `apps/web/src/app/(dashboard)/evaluation/`
- Delete: `apps/web/src/app/(dashboard)/mall/`

- [ ] **Step 1: Delete the route directories**

Run from `/Users/qihao/Desktop/ERP/water-erp`:

```bash
rm -rf \
  'apps/web/src/app/(dashboard)/procurement' \
  'apps/web/src/app/(dashboard)/bid' \
  'apps/web/src/app/(dashboard)/evaluation' \
  'apps/web/src/app/(dashboard)/mall'
```

Expected: command exits with no output.

- [ ] **Step 2: Verify deleted route directories are gone**

Run:

```bash
test ! -e 'apps/web/src/app/(dashboard)/procurement' && \
test ! -e 'apps/web/src/app/(dashboard)/bid' && \
test ! -e 'apps/web/src/app/(dashboard)/evaluation' && \
test ! -e 'apps/web/src/app/(dashboard)/mall'
```

Expected: command exits with status 0 and no output.

- [ ] **Step 3: Check for stale route references**

Run:

```bash
rg "(/procurement|/bid|/evaluation|/mall)" apps/web/src
```

Expected before later tasks: matches may remain in `app-shell.tsx` and `dashboard/page.tsx`. Do not leave matches after Task 3.

- [ ] **Step 4: Commit route deletion**

```bash
git add apps/web/src/app/(dashboard)
git commit -m "refactor(web): remove out-of-scope admin routes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If this repository is not initialized as git in the current environment, skip the commit and record: “Skipped commit: repository is not git-initialized.”

---

## Task 2: Add Shared Workbench Helpers

**Files:**
- Create: `apps/web/src/lib/workbench.ts`

- [ ] **Step 1: Create helper file**

Create `apps/web/src/lib/workbench.ts` with:

```ts
export const workbenchTheme = {
  primary: '#064ea2',
  primaryBright: '#0b63ce',
  cyan: '#0891b2',
  success: '#11a874',
  warning: '#f5a623',
  danger: '#e74c3c',
  purple: '#7c3aed',
  text: '#18243a',
  muted: '#5a6d8a',
  border: '#e5ecf4',
  surface: '#ffffff',
  page: '#f7fbff',
} as const;

export const statusTone = {
  blue: { color: '#064ea2', bg: '#064ea214', border: '#bfdbfe' },
  green: { color: '#11a874', bg: '#11a87414', border: '#bbf7d0' },
  orange: { color: '#f5a623', bg: '#f5a62316', border: '#fed7aa' },
  red: { color: '#e74c3c', bg: '#e74c3c14', border: '#fecaca' },
  purple: { color: '#7c3aed', bg: '#7c3aed14', border: '#ddd6fe' },
  gray: { color: '#5a6d8a', bg: '#5a6d8a12', border: '#e5ecf4' },
} as const;

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
  return Math.round((part / total) * 100);
}
```

- [ ] **Step 2: Type-check helper file by running web lint**

Run:

```bash
pnpm --filter web lint
```

Expected: existing lint may fail because stale route references remain until later tasks, but `apps/web/src/lib/workbench.ts` must not be listed as an error source.

- [ ] **Step 3: Commit helper file**

```bash
git add apps/web/src/lib/workbench.ts
git commit -m "feat(web): add workbench UI helpers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If git is unavailable, skip and record the reason.

---

## Task 3: Simplify App Shell Navigation

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`

- [ ] **Step 1: Replace imports**

In `apps/web/src/components/app-shell.tsx`, replace the `lucide-react` import with:

```ts
import {
  LayoutDashboard, Building2, Megaphone, UsersRound,
  LogOut, PanelLeftClose, PanelLeft,
} from 'lucide-react';
```

- [ ] **Step 2: Replace navigation items**

Replace the `navItems` constant with:

```ts
const navItems: NavItem[] = [
  { label: '首页驾驶舱', path: '/dashboard', icon: LayoutDashboard },
  { label: '信息发布中心', path: '/notice', icon: Megaphone },
  { label: '供应商管理中心', path: '/supplier', icon: Building2 },
  { label: '专家管理中心', path: '/expert', icon: UsersRound },
];
```

- [ ] **Step 3: Replace brand subtitle**

In the logo block, replace:

```tsx
<span className="text-[9px] text-white/35 font-medium whitespace-nowrap">智慧水发 · 管理端</span>
```

with:

```tsx
<span className="text-[9px] text-white/35 font-medium whitespace-nowrap">智慧水发 · 采购管理工作台</span>
```

- [ ] **Step 4: Simplify navigation render branch**

Replace the contents of the `<nav className="flex-1 overflow-y-auto py-3 px-2">...</nav>` block with this child mapping:

```tsx
{navItems.map(item => (
  <button
    key={item.path}
    onClick={() => router.push(item.path!)}
    className={`w-full flex items-center gap-2.5 px-3 py-2.5 mb-1 text-[13px] transition-colors relative rounded-lg ${
      isActive(item.path!)
        ? 'bg-[#064ea2] text-white font-semibold shadow-[0_8px_20px_rgba(6,78,162,0.28)]'
        : 'text-white/50 hover:text-white/85 hover:bg-white/[0.05]'
    }`}
  >
    {isActive(item.path!) && (
      <div className="w-[3px] h-4 bg-[#7dd3fc] rounded-r absolute left-0" />
    )}
    <div className="flex-shrink-0"><item.icon size={collapsed ? 18 : 16} strokeWidth={1.5} /></div>
    {!collapsed && <span className="tracking-tight">{item.label}</span>}
  </button>
))}
```

The full nav should remain wrapped in:

```tsx
<nav className="flex-1 overflow-y-auto py-3 px-2">
  {/* mapping above */}
</nav>
```

- [ ] **Step 5: Verify no deleted routes remain in app shell**

Run:

```bash
rg "(/procurement|/bid|/evaluation|/mall|采购管理|开评标|评价管理|电子商城)" apps/web/src/components/app-shell.tsx
```

Expected: no matches.

- [ ] **Step 6: Run web lint**

Run:

```bash
pnpm --filter web lint
```

Expected: no lint errors from `app-shell.tsx`.

- [ ] **Step 7: Commit app shell refactor**

```bash
git add apps/web/src/components/app-shell.tsx
git commit -m "refactor(web): focus admin navigation on three centers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If git is unavailable, skip and record the reason.

---

## Task 4: Rebuild Dashboard as Procurement Workbench

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Replace dashboard page with three-center workbench**

Replace the full file with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { formatDateTime, numberOrZero, statusTone } from '@/lib/workbench';
import {
  AlertTriangle, ArrowRight, BellRing, Building2, CheckCircle2,
  Clock3, FileText, Megaphone, PlusCircle, ShieldAlert, Sparkles,
  TrendingUp, UsersRound,
} from 'lucide-react';

interface SupplierStats {
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  blacklist: number;
}

interface AnnouncementStats {
  total: number;
  published: number;
  bidNotice: number;
  winNotice: number;
  policy: number;
}

interface ExpertAssignment {
  id: string;
  progress: number;
  signedIn: boolean;
  project?: { stage?: string };
}

interface ExpertItem {
  id: string;
  displayName: string;
  bidExperts?: ExpertAssignment[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [supplierStats, setSupplierStats] = useState<SupplierStats | null>(null);
  const [announcementStats, setAnnouncementStats] = useState<AnnouncementStats | null>(null);
  const [experts, setExperts] = useState<ExpertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);

    Promise.all([
      api.get<SupplierStats>('/supplier/stats').catch(() => null),
      api.get<AnnouncementStats>('/announcements/stats').catch(() => null),
      api.get<ExpertItem[]>('/expert-admin').catch(() => []),
    ]).then(([ss, as, expertList]) => {
      setSupplierStats(ss);
      setAnnouncementStats(as);
      setExperts(Array.isArray(expertList) ? expertList : []);
      setLoading(false);
    });
  }, []);

  const expertActiveCount = useMemo(() => experts.reduce((sum, expert) => {
    return sum + (expert.bidExperts || []).filter(item => item.project?.stage !== 'ARCHIVED').length;
  }, 0), [experts]);

  const expertUnfinishedCount = useMemo(() => experts.reduce((sum, expert) => {
    return sum + (expert.bidExperts || []).filter(item => numberOrZero(item.progress) < 100).length;
  }, 0), [experts]);

  const pendingSuppliers = numberOrZero(supplierStats?.pending);
  const announcementDraftLike = Math.max(numberOrZero(announcementStats?.total) - numberOrZero(announcementStats?.published), 0);
  const supplierRisk = numberOrZero(supplierStats?.disabled) + numberOrZero(supplierStats?.blacklist);
  const totalTodos = pendingSuppliers + announcementDraftLike + expertUnfinishedCount;
  const alertCount = supplierRisk + (expertUnfinishedCount > 0 ? 1 : 0);

  const metricCards = [
    { label: '今日待办', value: totalTodos, hint: '三大中心待处理事项', icon: BellRing, tone: statusTone.blue },
    { label: '待发布/待审核信息', value: announcementDraftLike, hint: '草稿、待发布、未发布信息', icon: Megaphone, tone: statusTone.orange },
    { label: '待审供应商', value: pendingSuppliers, hint: '注册入库审核', icon: Building2, tone: statusTone.green },
    { label: '专家待处理事项', value: expertUnfinishedCount, hint: '履职、分配、评价事项', icon: UsersRound, tone: statusTone.purple },
    { label: '风险预警', value: alertCount, hint: '异常供应商与专家提醒', icon: ShieldAlert, tone: statusTone.red },
  ];

  const todoItems = [
    { type: '信息发布', title: `${announcementDraftLike} 条信息需要完善或发布`, desc: '检查草稿、待发布和发布状态', path: '/notice', tone: statusTone.orange },
    { type: '供应商审核', title: `${pendingSuppliers} 家供应商等待审核`, desc: '处理注册资料、资质文件和入库状态', path: '/supplier', tone: statusTone.green },
    { type: '专家管理', title: `${expertUnfinishedCount} 项专家事项待跟进`, desc: '关注专家分配、回避和履职评价', path: '/expert', tone: statusTone.purple },
  ];

  const centerCards = [
    { title: '信息发布中心', desc: '公告、公示、政策制度、草稿与发布记录', path: '/notice', icon: Megaphone, tone: statusTone.blue, action: '进入发布中心' },
    { title: '供应商管理中心', desc: '供应商审核、供应商库、评价、变更和黑名单', path: '/supplier', icon: Building2, tone: statusTone.green, action: '处理供应商' },
    { title: '专家管理中心', desc: '专家库、抽取分配、回避关系、履职评价', path: '/expert', icon: UsersRound, tone: statusTone.purple, action: '管理专家' },
  ];

  return (
    <div className="min-h-full space-y-6 bg-[radial-gradient(circle_at_top_left,rgba(14,98,208,0.10),transparent_34%),linear-gradient(180deg,#f7fbff_0%,#f8fafc_100%)]">
      <section className="overflow-hidden rounded-2xl border border-[#dbeafe] bg-white/85 p-6 shadow-[0_18px_60px_rgba(15,47,87,0.08)] backdrop-blur">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#064ea2] text-white shadow-[0_12px_30px_rgba(6,78,162,0.28)]">
              <Sparkles size={26} strokeWidth={1.6} />
            </div>
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[#064ea2]">
                <TrendingUp size={13} strokeWidth={1.6} /> 采购管理工作台
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#0f2f57]">欢迎回来，{user?.displayName || '管理员'}</h1>
              <p className="mt-1 text-sm text-[#5a6d8a]">聚焦信息发布、供应商管理、专家管理，统一处理待办与风险。</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/notice')} className="inline-flex items-center gap-2 rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#053f85]">
              <PlusCircle size={16} /> 新建信息
            </button>
            <button onClick={() => router.push('/supplier')} className="inline-flex items-center gap-2 rounded-xl border border-[#dbeafe] bg-white px-4 py-2 text-sm font-semibold text-[#064ea2] hover:bg-[#eff6ff]">
              处理待办 <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-5 gap-4">
        {metricCards.map(card => (
          <button key={card.label} onClick={() => router.push(card.label.includes('信息') ? '/notice' : card.label.includes('供应商') ? '/supplier' : card.label.includes('专家') ? '/expert' : '/dashboard')} className="group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: card.tone.border }}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#5a6d8a]">{card.label}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: card.tone.color, backgroundColor: card.tone.bg }}><card.icon size={18} strokeWidth={1.6} /></span>
            </div>
            <div className="text-3xl font-black tracking-tight text-[#18243a]">{loading ? '—' : card.value}</div>
            <p className="mt-1 text-xs text-[#8a96aa]">{card.hint}</p>
          </button>
        ))}
      </section>

      <section className="grid grid-cols-[1.45fr_0.95fr] gap-6">
        <div className="rounded-2xl border border-[#e5ecf4] bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#18243a]">待办工作台</h2>
              <p className="text-sm text-[#5a6d8a]">按业务中心聚合需要立即处理的事项</p>
            </div>
            <Clock3 className="text-[#8a96aa]" size={20} />
          </div>
          <div className="space-y-3">
            {todoItems.map(item => (
              <button key={item.type} onClick={() => router.push(item.path)} className="w-full rounded-xl border p-4 text-left transition hover:bg-[#f8fbff]" style={{ borderColor: item.tone.border }}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ color: item.tone.color, backgroundColor: item.tone.bg }}>{item.type}</span>
                    <h3 className="mt-3 font-semibold text-[#18243a]">{item.title}</h3>
                    <p className="mt-1 text-sm text-[#5a6d8a]">{item.desc}</p>
                  </div>
                  <ArrowRight className="text-[#8a96aa]" size={18} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#fee2e2] bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#18243a]">风险与预警</h2>
              <p className="text-sm text-[#5a6d8a]">异常供应商、发布异常和专家履职提醒</p>
            </div>
            <AlertTriangle className="text-[#e74c3c]" size={20} />
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4">
              <div className="font-semibold text-[#9a3412]">异常/黑名单供应商</div>
              <p className="mt-1 text-sm text-[#9a3412]/75">当前 {supplierRisk} 家供应商处于停用或黑名单状态。</p>
            </div>
            <div className="rounded-xl border border-[#ddd6fe] bg-[#f5f3ff] p-4">
              <div className="font-semibold text-[#5b21b6]">专家履职提醒</div>
              <p className="mt-1 text-sm text-[#5b21b6]/75">{expertUnfinishedCount} 项专家事项未完成，请及时跟进。</p>
            </div>
            <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4">
              <div className="font-semibold text-[#064ea2]">数据更新时间</div>
              <p className="mt-1 text-sm text-[#064ea2]/75">{formatDateTime(new Date())}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-4">
        {centerCards.map(card => (
          <button key={card.title} onClick={() => router.push(card.path)} className="rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: card.tone.border }}>
            <div className="mb-4 flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ color: card.tone.color, backgroundColor: card.tone.bg }}><card.icon size={22} strokeWidth={1.6} /></span>
              <ArrowRight className="text-[#8a96aa]" size={18} />
            </div>
            <h3 className="text-lg font-bold text-[#18243a]">{card.title}</h3>
            <p className="mt-2 min-h-[40px] text-sm leading-5 text-[#5a6d8a]">{card.desc}</p>
            <div className="mt-4 text-sm font-semibold" style={{ color: card.tone.color }}>{card.action}</div>
          </button>
        ))}
      </section>

      <section className="rounded-2xl border border-[#e5ecf4] bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#18243a]">最近动态</h2>
          <CheckCircle2 className="text-[#11a874]" size={20} />
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="rounded-xl bg-[#f8fafc] p-4"><span className="font-semibold text-[#18243a]">发布动态</span><p className="mt-1 text-[#5a6d8a]">已发布 {numberOrZero(announcementStats?.published)} 条信息</p></div>
          <div className="rounded-xl bg-[#f8fafc] p-4"><span className="font-semibold text-[#18243a]">供应商动态</span><p className="mt-1 text-[#5a6d8a]">已入库 {numberOrZero(supplierStats?.approved)} 家供应商</p></div>
          <div className="rounded-xl bg-[#f8fafc] p-4"><span className="font-semibold text-[#18243a]">专家动态</span><p className="mt-1 text-[#5a6d8a]">当前 {expertActiveCount} 项专家参与记录</p></div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify deleted business routes are not referenced**

Run:

```bash
rg "(/procurement|/bid|/evaluation|/mall|招标项目|项目阶段|开评标|电子商城|评价管理)" 'apps/web/src/app/(dashboard)/dashboard/page.tsx'
```

Expected: no matches.

- [ ] **Step 3: Run web lint**

Run:

```bash
pnpm --filter web lint
```

Expected: no lint errors from `dashboard/page.tsx`.

- [ ] **Step 4: Commit dashboard rebuild**

```bash
git add apps/web/src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat(web): rebuild dashboard as procurement workbench

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If git is unavailable, skip and record the reason.

---

## Task 5: Upgrade Information Publishing Center

**Files:**
- Modify: `apps/web/src/app/(dashboard)/notice/page.tsx`

- [ ] **Step 1: Update page title and create button copy**

In `notice/page.tsx`, change the page heading area to:

```tsx
<div className="flex justify-between items-start mb-6">
  <div>
    <div className="mb-2 inline-flex rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[#064ea2]">信息发布中心</div>
    <h1 className="text-2xl font-bold text-[#0f2f57]">信息发布中心</h1>
    <p className="text-sm text-[#5a6d8a] mt-1">统一管理招标/采购公告、中标/成交公示、政策制度与通知公告</p>
  </div>
  <button onClick={() => setCreateModal(true)} className="px-5 py-2.5 bg-[#064ea2] text-white rounded-xl font-semibold hover:bg-[#053f85] transition shadow-[0_10px_24px_rgba(6,78,162,0.22)]">新建信息</button>
</div>
```

- [ ] **Step 2: Replace stats card labels**

In the stats array, use:

```tsx
[
  { label: '全部信息', value: stats.total, color: '#18243a' },
  { label: '已发布', value: stats.published, color: '#11a874' },
  { label: '招标/采购公告', value: stats.bidNotice, color: '#064ea2' },
  { label: '中标/成交公示', value: stats.winNotice, color: '#f5a623' },
  { label: '政策制度', value: stats.policy, color: '#5a6d8a' },
]
```

- [ ] **Step 3: Insert category cards after stats block**

After the stats cards block and before the filter bar, insert:

```tsx
<div className="grid grid-cols-4 gap-4 mb-6">
  {Object.entries(typeMap).map(([key, value]) => (
    <button
      key={key}
      onClick={() => { setFilterType(key); setPage(1); }}
      className="rounded-2xl border border-[#e5ecf4] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-md"
    >
      <div className="mb-3 inline-flex rounded-full px-2.5 py-1 text-xs font-bold" style={{ color: value.color, backgroundColor: value.bg }}>{value.label}</div>
      <div className="text-sm font-semibold text-[#18243a]">查看{value.label}</div>
      <div className="mt-1 text-xs text-[#8a96aa]">筛选并管理该类信息</div>
    </button>
  ))}
</div>
```

- [ ] **Step 4: Update table headers**

Replace the table header row with:

```tsx
<thead><tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
  <th className="px-5 py-3">标题</th>
  <th className="px-5 py-3">分类</th>
  <th className="px-5 py-3">状态</th>
  <th className="px-5 py-3">发布范围</th>
  <th className="px-5 py-3">更新时间</th>
  <th className="px-5 py-3 text-right">操作</th>
</tr></thead>
```

- [ ] **Step 5: Update table body metadata cells**

Inside each announcement row, replace the old publish date/browser count cells with:

```tsx
<td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">采购管理端 / 公共门户</td>
<td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{new Date(a.updatedAt).toLocaleDateString('zh-CN')}</td>
```

Keep the final operation cell as view button.

- [ ] **Step 6: Update modal titles and validation copy**

Replace “发布公告” modal title with “新建信息”. Replace submit button text from “发布” to “保存并发布”. Replace validation error from “请填写标题和内容” to “请填写信息标题和正文”.

- [ ] **Step 7: Run web lint**

Run:

```bash
pnpm --filter web lint
```

Expected: no lint errors from `notice/page.tsx`.

- [ ] **Step 8: Commit notice center upgrade**

```bash
git add apps/web/src/app/(dashboard)/notice/page.tsx
git commit -m "feat(web): upgrade notice page to publishing center

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If git is unavailable, skip and record the reason.

---

## Task 6: Upgrade Supplier Management Center

**Files:**
- Modify: `apps/web/src/app/(dashboard)/supplier/page.tsx`

- [ ] **Step 1: Update header**

Replace the existing header block with:

```tsx
<div className="flex justify-between items-start mb-6">
  <div>
    <div className="mb-2 inline-flex rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-semibold text-[#11a874]">供应商管理中心</div>
    <h1 className="text-2xl font-bold text-[#0f2f57]">供应商管理中心</h1>
    <p className="text-sm text-[#5a6d8a] mt-1">供应商审核、供应商库、信息变更、评价与异常/黑名单管理</p>
  </div>
</div>
```

- [ ] **Step 2: Insert lifecycle process cards after stats block**

After the stats cards block and before the filter bar, insert:

```tsx
<div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 mb-6">
  <div className="flex items-center justify-between mb-4">
    <div>
      <h2 className="font-bold text-[#18243a]">供应商生命周期</h2>
      <p className="text-sm text-[#5a6d8a] mt-1">注册申请 → 资料审核 → 入库管理 → 履约评价 → 异常处理</p>
    </div>
  </div>
  <div className="grid grid-cols-5 gap-3">
    {[
      { label: '注册申请', desc: '提交企业资料', color: '#064ea2' },
      { label: '资料审核', desc: '资质与基础信息审核', color: '#f5a623' },
      { label: '入库管理', desc: '分类、状态与联系人', color: '#11a874' },
      { label: '履约评价', desc: '服务质量与综合评分', color: '#7c3aed' },
      { label: '异常处理', desc: '停用、黑名单、恢复', color: '#e74c3c' },
    ].map((item, index) => (
      <div key={item.label} className="rounded-xl border border-[#e5ecf4] bg-[#f8fafc] p-4">
        <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: item.color }}>{index + 1}</div>
        <div className="font-semibold text-[#18243a]">{item.label}</div>
        <div className="mt-1 text-xs text-[#5a6d8a]">{item.desc}</div>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Insert function tabs before filter bar**

Before the filter bar, insert:

```tsx
<div className="mb-4 flex flex-wrap gap-2">
  {[
    { label: '全部供应商', status: '' },
    { label: '待审核', status: 'PENDING' },
    { label: '已入库', status: 'APPROVED' },
    { label: '退回补正', status: 'RETURNED' },
    { label: '异常/黑名单', status: 'BLACKLIST' },
  ].map(tab => (
    <button
      key={tab.label}
      onClick={() => { setFilterStatus(tab.status); setPage(1); }}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${filterStatus === tab.status ? 'bg-[#064ea2] text-white shadow-[0_8px_20px_rgba(6,78,162,0.2)]' : 'bg-white text-[#5a6d8a] border border-[#e5ecf4] hover:text-[#064ea2]'}`}
    >
      {tab.label}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Add score column to table header**

In the table header, insert a `评分` column before `注册时间`:

```tsx
<th className="px-5 py-3">评分</th>
```

- [ ] **Step 5: Add score cell to table rows**

In each supplier row, insert before the created date cell:

```tsx
<td className="px-5 py-3">
  <span className="rounded-full bg-[#eff6ff] px-2 py-1 text-xs font-semibold text-[#064ea2]">信用良好</span>
</td>
```

Update empty/loading `colSpan` values from `7` to `8`.

- [ ] **Step 6: Ensure high-risk actions still require reason**

Verify the existing action modal keeps `actionReason` for `reject`, `return`, `disable`, and `blacklist`. If the modal allows empty reasons for these actions, change the action button handler to guard:

```ts
if (actionModal.type !== 'approve' && !actionReason.trim()) {
  alert('请填写处理原因');
  return;
}
```

Place this at the start of `handleAction` after `if (!actionModal) return;`.

- [ ] **Step 7: Run web lint**

Run:

```bash
pnpm --filter web lint
```

Expected: no lint errors from `supplier/page.tsx`.

- [ ] **Step 8: Commit supplier center upgrade**

```bash
git add apps/web/src/app/(dashboard)/supplier/page.tsx
git commit -m "feat(web): upgrade supplier page to management center

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If git is unavailable, skip and record the reason.

---

## Task 7: Upgrade Expert Management Center

**Files:**
- Modify: `apps/web/src/app/(dashboard)/expert/page.tsx`

- [ ] **Step 1: Update header**

Replace the current header block with:

```tsx
<div className="flex items-start justify-between mb-6">
  <div>
    <div className="mb-2 inline-flex rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-1 text-xs font-semibold text-[#7c3aed]">专家管理中心</div>
    <h1 className="text-2xl font-bold text-[#0f2f57]">专家管理中心</h1>
    <p className="text-sm text-[#5a6d8a] mt-1">专家库、专家抽取/分配、回避关系、履职评价与参与项目记录</p>
  </div>
  <div className="flex gap-2">
    <button className="rounded-xl border border-[#ddd6fe] bg-white px-4 py-2 text-sm font-semibold text-[#7c3aed] hover:bg-[#f5f3ff]">专家抽取</button>
    <button className="rounded-xl bg-[#7c3aed] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6d28d9]">新增专家</button>
  </div>
</div>
```

- [ ] **Step 2: Insert lifecycle process cards after search bar**

After the search bar and before the stats block, insert:

```tsx
<div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 mb-6">
  <h2 className="font-bold text-[#18243a]">专家管理流程</h2>
  <p className="text-sm text-[#5a6d8a] mt-1 mb-4">专家入库 → 专家抽取 → 回避校验 → 评审履职 → 评价归档</p>
  <div className="grid grid-cols-5 gap-3">
    {[
      '专家入库', '专家抽取', '回避校验', '评审履职', '评价归档'
    ].map((label, index) => (
      <div key={label} className="rounded-xl border border-[#e5ecf4] bg-[#f8fafc] p-4">
        <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#7c3aed] text-xs font-bold text-white">{index + 1}</div>
        <div className="font-semibold text-[#18243a]">{label}</div>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Insert function tabs before expert list**

Before the expert list conditional rendering, insert:

```tsx
<div className="mb-4 flex flex-wrap gap-2">
  {['专家库', '专家抽取', '回避关系', '履职评价', '参与记录'].map((tab, index) => (
    <button
      key={tab}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${index === 0 ? 'bg-[#7c3aed] text-white shadow-[0_8px_20px_rgba(124,58,237,0.2)]' : 'bg-white text-[#5a6d8a] border border-[#e5ecf4] hover:text-[#7c3aed]'}`}
    >
      {tab}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Update stats card labels**

Change stats labels to:

```tsx
专家总数
参与项目中
履职完成
```

Use the existing calculated values. The third card should keep `completedProjects` logic.

- [ ] **Step 5: Add status/score summary to each expert card**

Inside each expert card, below the current project progress section, add:

```tsx
<div className="mt-3 grid grid-cols-3 gap-2 text-xs">
  <div className="rounded-lg bg-[#f8fafc] px-3 py-2">
    <span className="text-[#8a96aa]">可用状态</span>
    <div className="mt-1 font-semibold text-[#11a874]">可用</div>
  </div>
  <div className="rounded-lg bg-[#f8fafc] px-3 py-2">
    <span className="text-[#8a96aa]">履职评分</span>
    <div className="mt-1 font-semibold text-[#7c3aed]">良好</div>
  </div>
  <div className="rounded-lg bg-[#f8fafc] px-3 py-2">
    <span className="text-[#8a96aa]">回避提醒</span>
    <div className="mt-1 font-semibold text-[#5a6d8a]">无</div>
  </div>
</div>
```

If the surrounding JSX structure makes this exact placement awkward, put it inside the clickable expert card after the existing metadata block and before the closing card `</div>`.

- [ ] **Step 6: Run web lint**

Run:

```bash
pnpm --filter web lint
```

Expected: no lint errors from `expert/page.tsx`.

- [ ] **Step 7: Commit expert center upgrade**

```bash
git add apps/web/src/app/(dashboard)/expert/page.tsx
git commit -m "feat(web): upgrade expert page to management center

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If git is unavailable, skip and record the reason.

---

## Task 8: Final Verification and Cleanup

**Files:**
- Verify all modified files.
- Modify only files with lint/build failures.

- [ ] **Step 1: Check for deleted route references across web app**

Run:

```bash
rg "(/procurement|/bid|/evaluation|/mall|开评标管理|评价管理|电子商城|项目阶段分布|招标项目)" apps/web/src
```

Expected: no matches. If matches remain in comments or UI text, remove them unless they refer to API/domain names required by shared types.

- [ ] **Step 2: Run web lint**

Run:

```bash
pnpm --filter web lint
```

Expected: PASS.

- [ ] **Step 3: Build web app**

Run:

```bash
pnpm build:web
```

Expected: PASS. If Next.js reports deleted routes in generated cache, remove `.next` for the web app and rebuild:

```bash
rm -rf apps/web/.next
pnpm build:web
```

- [ ] **Step 4: Manual route verification**

Start the app if needed:

```bash
pnpm dev:web
```

Open `http://localhost:3004` and verify:

```text
/dashboard loads and shows 首页驾驶舱
/notice loads and shows 信息发布中心
/supplier loads and shows 供应商管理中心
/expert loads and shows 专家管理中心
/procurement returns 404
/bid returns 404
/bid/open returns 404
/evaluation returns 404
/mall returns 404
```

- [ ] **Step 5: Commit final cleanup**

```bash
git add apps/web docs/superpowers/specs/2026-06-13-admin-workbench-redesign-design.md docs/superpowers/plans/2026-06-13-admin-workbench-redesign.md
git commit -m "chore(web): verify admin workbench redesign

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If git is unavailable, skip and record the reason.

---

## Self-Review

- Spec coverage: covered route deletion, simplified navigation, redesigned dashboard, three center pages, UI tone, data reuse, and validation steps.
- Placeholder scan: no TBD/TODO placeholders. Optional follow-up API aggregation is intentionally excluded from this implementation plan because the first implementation can reuse existing APIs.
- Type consistency: helper functions and page-level interfaces use local names and existing `api`/`User` imports. Deleted routes are consistently `/procurement`, `/bid`, `/bid/*`, `/evaluation`, and `/mall`.
