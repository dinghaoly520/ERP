# 开评标管理端交互重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 bid-portal 从"先进页面再选项目"重构为"先选项目再进入工作台"的层级交互模式。

**Architecture:** Next.js App Router 层级路由 `/bid/project/[id]?tab=xxx`，React Context 共享项目上下文，精简侧边栏为全局选择器 + 最近项目 + 2 个汇总入口。

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, TypeScript, NestJS (API), Prisma

## Global Constraints

- 项目选择器仅显示阶段 ≥ OPENING 的项目（即过滤 DOWNLOAD 和 SUBMIT）
- 最近项目存储在 localStorage key `bid-recent-projects`，最多 5 条
- 所有新组件遵循 design system：1px hairline dividers, rounded-2xl cards, monospace numerals, Lucide 1.5px icons
- API 所有请求走 `lib/api.ts` 的 `fetchApi` 封装，携带 `credentials: 'include'` 和 `X-Portal: web`
- 保留所有现有页面文件不删除（仅不再导航到它们），便于回滚

---

### Task 1: API — `GET /api/bid/projects` 新增 stage[] 查询参数

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.controller.ts:30-32`
- Modify: `water-erp/apps/api/src/bid/bid.service.ts:76-81`

**Interfaces:**
- Produces: `GET /api/bid/projects?stage[]=OPENING&stage[]=EVALUATING` — 返回阶段过滤后的项目列表
- Produces: `GET /api/bid/projects` (no params) — 行为不变，返回全部项目

- [ ] **Step 1: 修改 Controller — 接收 stage[] query param**

在 `bid.controller.ts` 第 30-32 行，修改 `listProjects` 方法：

```ts
@Get('projects')
@ApiOperation({ summary: '项目列表（可选阶段过滤）' })
listProjects(@Query('stage') stage?: string | string[]) {
  const stages = stage
    ? (Array.isArray(stage) ? stage : [stage])
    : undefined;
  return this.bidService.listProjects(stages);
}
```

需要在文件顶部导入 `Query`（第 1 行已存在，确认已导入）。

- [ ] **Step 2: 修改 Service — 添加 stage 过滤逻辑**

在 `bid.service.ts` 第 76-81 行，修改 `listProjects` 方法：

```ts
listProjects(stages?: string[]) {
  const where = stages && stages.length > 0
    ? { stage: { in: stages } }
    : {};
  return this.prisma.bidProject.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      projectCode: true,
      name: true,
      stage: true,
    },
  });
}
```

注意：原来 `include: { _count: { select: { suppliers: true } } }` 改为 `select` 以提高效率并匹配前端 SlimProject 类型。前端全局选择器只需要 `{ id, projectCode, name, stage }`。

- [ ] **Step 3: 验证 API 工作正常**

启动 API：
```bash
cd water-erp && pnpm dev:api
```

测试：
```bash
# 无过滤 — 返回所有项目
curl http://localhost:4001/api/bid/projects -b "token_web=..."

# 阶段过滤 — 仅返回 OPENING + EVALUATING
curl "http://localhost:4001/api/bid/projects?stage[]=OPENING&stage[]=EVALUATING" -b "token_web=..."

# 单个阶段
curl "http://localhost:4001/api/bid/projects?stage=ARCHIVED" -b "token_web=..."
```

- [ ] **Step 4: Commit**

```bash
git add water-erp/apps/api/src/bid/bid.controller.ts water-erp/apps/api/src/bid/bid.service.ts
git commit -m "feat(bid-api): add stage[] query filter to GET /api/bid/projects"
```

---

### Task 2: localStorage 工具函数

**Files:**
- Create: `water-erp/apps/bid-portal/src/lib/storage.ts`

**Interfaces:**
- Produces: `getRecentProjects(): RecentProject[]` — 读取最近项目
- Produces: `addRecentProject(project: RecentProject): void` — 添加/更新最近项目
- Produces: `removeRecentProject(id: string): void` — 移除单条
- Produces: `RecentProject { id: string; projectCode: string; name: string; accessedAt: number }`

- [ ] **Step 1: 创建 storage.ts**

```ts
const RECENT_KEY = 'bid-recent-projects';
const MAX_RECENT = 5;

export interface RecentProject {
  id: string;
  projectCode: string;
  name: string;
  accessedAt: number; // Date.now()
}

export function getRecentProjects(): RecentProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentProject[];
  } catch {
    return [];
  }
}

export function addRecentProject(project: Omit<RecentProject, 'accessedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const list = getRecentProjects();
    const idx = list.findIndex(p => p.id === project.id);
    const entry: RecentProject = { ...project, accessedAt: Date.now() };
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.unshift(entry);
    }
    // 截断至 MAX_RECENT
    const trimmed = list.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  } catch { /* localStorage 不可用时静默失败 */ }
}

export function removeRecentProject(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const list = getRecentProjects().filter(p => p.id !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* 静默失败 */ }
}
```

- [ ] **Step 2: Commit**

```bash
git add water-erp/apps/bid-portal/src/lib/storage.ts
git commit -m "feat(bid): add localStorage utility for recent projects"
```

---

### Task 3: BidProjectContext — 共享项目状态

**Files:**
- Create: `water-erp/apps/bid-portal/src/contexts/bid-project-context.tsx`

**Interfaces:**
- Produces: `<BidProjectProvider>` — 包裹 layout 的 Context Provider
- Produces: `useBidProjectContext(): BidProjectContextValue`
- Produces: `BidProjectContextValue { projectId: string | null; project: BidProjectDetail | null; isLoading: boolean; error: string | null; refetch: () => void }`

- [ ] **Step 1: 创建 bid-project-context.tsx**

```tsx
'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import { addRecentProject, removeRecentProject } from '@/lib/storage';

export interface BidProjectContextValue {
  projectId: string | null;
  project: BidProjectDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const BidProjectContext = createContext<BidProjectContextValue>({
  projectId: null,
  project: null,
  isLoading: false,
  error: null,
  refetch: () => {},
});

export function useBidProjectContext() {
  return useContext(BidProjectContext);
}

export function BidProjectProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const id = params?.id as string | undefined;

  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef<string | undefined>(undefined);

  const fetchProject = useCallback(async (projectId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(data);
      // 写入最近项目
      addRecentProject({
        id: data.id,
        projectCode: (data as any).projectCode || '',
        name: data.name,
      });
    } catch (e: any) {
      if (e?.status === 404) {
        setError('项目不存在或已被删除');
        removeRecentProject(projectId);
      } else {
        setError(e?.message || '加载项目失败');
      }
      setProject(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setProject(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    // 避免重复请求同一个 id
    if (fetchIdRef.current === id && project) return;
    fetchIdRef.current = id;
    fetchProject(id);
  }, [id, fetchProject, project]);

  const refetch = useCallback(() => {
    if (id) fetchProject(id);
  }, [id, fetchProject]);

  return (
    <BidProjectContext.Provider
      value={{
        projectId: id ?? null,
        project,
        isLoading,
        error,
        refetch,
      }}
    >
      {children}
    </BidProjectContext.Provider>
  );
}
```

- [ ] **Step 2: 在 layout 中集成 Provider**

修改 `water-erp/apps/bid-portal/src/app/(dashboard)/layout.tsx`：

```tsx
import AppShell from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { BidProjectProvider } from '@/contexts/bid-project-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <BidProjectProvider>
      <AppShell>
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </BidProjectProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add water-erp/apps/bid-portal/src/contexts/bid-project-context.tsx water-erp/apps/bid-portal/src/app/\(dashboard\)/layout.tsx
git commit -m "feat(bid): add BidProjectProvider context for shared project state"
```

---

### Task 4: 全局项目搜索选择器组件

**Files:**
- Create: `water-erp/apps/bid-portal/src/components/global-project-search.tsx`

**Interfaces:**
- Produces: `<GlobalProjectSearch />` — 可搜索的下拉选择器，选中后导航到 `/bid/project/[id]`
- Consumes: `api.get` from `@/lib/api`
- Consumes: `STAGE_LABEL`, `STAGE_COLOR` from `@water-erp/shared`

- [ ] **Step 1: 创建 global-project-search.tsx**

```tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Search, ChevronDown, Loader2 } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

interface SlimProject {
  id: string;
  projectCode: string;
  name: string;
  stage: string;
}

// 全局选择器的阶段过滤：仅 ≥ OPENING
const VISIBLE_STAGES = ['OPENING', 'EVALUATING', 'ARCHIVED'];

export default function GlobalProjectSearch() {
  const router = useRouter();
  const [projects, setProjects] = useState<SlimProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 获取项目列表（仅 OPENING+）
  useEffect(() => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    VISIBLE_STAGES.forEach(s => params.append('stage[]', s));
    api.get<SlimProject[]>(`/bid/projects?${params.toString()}`)
      .then(ps => { setProjects(ps); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // 前端搜索过滤
  const filtered = query.trim()
    ? projects.filter(p =>
        p.projectCode.toLowerCase().includes(query.toLowerCase()) ||
        p.name.toLowerCase().includes(query.toLowerCase())
      )
    : projects;

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && filtered[highlightIdx]) {
      e.preventDefault();
      selectProject(filtered[highlightIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const selectProject = useCallback((p: SlimProject) => {
    setOpen(false);
    setQuery('');
    setHighlightIdx(-1);
    router.push(`/bid/project/${p.id}`);
  }, [router]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative px-2 pt-3 pb-1">
      <div className="relative">
        <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="搜索项目编号或名称…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); setHighlightIdx(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full rounded-xl border border-[#e5ecf4] bg-white py-2.5 pl-9 pr-8 text-xs font-medium text-[#18243a] placeholder:text-[#94a3b8] focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2]/15 transition"
        />
        <button
          onClick={() => setOpen(!open)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#94a3b8] hover:text-[#18243a] transition"
        >
          <ChevronDown size={14} strokeWidth={1.5} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute left-2 right-2 top-full mt-1 z-50 max-h-[320px] overflow-y-auto rounded-xl border border-[#dbe6f3] bg-white shadow-[0_18px_60px_rgba(15,47,87,0.14)] backdrop-blur">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-[#8a96aa] justify-center">
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
              加载项目列表…
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-[#e74c3c] mb-2">加载失败</p>
              <button
                onClick={() => {
                  setLoading(true); setError(false);
                  const params = new URLSearchParams();
                  VISIBLE_STAGES.forEach(s => params.append('stage[]', s));
                  api.get<SlimProject[]>(`/bid/projects?${params.toString()}`)
                    .then(ps => { setProjects(ps); })
                    .catch(() => setError(true))
                    .finally(() => setLoading(false));
                }}
                className="text-[10px] font-bold text-[#064ea2] hover:underline"
              >
                点击重试
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#8a96aa]">
              {query.trim() ? '未找到匹配项目' : '暂无可操作的项目'}
            </div>
          ) : (
            filtered.map((p, idx) => {
              const stageLabel = STAGE_LABEL[p.stage] || p.stage;
              const stageColor = STAGE_COLOR[p.stage] || '#94a3b8';
              return (
                <button
                  key={p.id}
                  onClick={() => selectProject(p)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    idx === highlightIdx ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-[#064ea2] truncate">
                      {p.projectCode}
                    </span>
                    <span
                      className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-bold whitespace-nowrap flex-shrink-0"
                      style={{ color: stageColor, backgroundColor: `${stageColor}15` }}
                    >
                      {stageLabel}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#5a6d8a] truncate mt-0.5">{p.name}</div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add water-erp/apps/bid-portal/src/components/global-project-search.tsx
git commit -m "feat(bid): add global project search dropdown with stage filter"
```

---

### Task 5: 最近项目列表组件

**Files:**
- Create: `water-erp/apps/bid-portal/src/components/recent-projects.tsx`

**Interfaces:**
- Produces: `<RecentProjects />` — 显示最近 5 个项目，点击进入工作台，可移除
- Consumes: `getRecentProjects`, `removeRecentProject` from `@/lib/storage`
- Consumes: `useRouter` from `next/navigation`

- [ ] **Step 1: 创建 recent-projects.tsx**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getRecentProjects, removeRecentProject, type RecentProject } from '@/lib/storage';
import { Clock, X } from 'lucide-react';

export default function RecentProjects() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<RecentProject[]>([]);

  // 每次 pathname 变化时刷新列表（进入新项目时会更新 localStorage）
  useEffect(() => {
    setItems(getRecentProjects());
  }, [pathname]);

  if (items.length === 0) return null;

  const handleClick = (p: RecentProject) => {
    router.push(`/bid/project/${p.id}`);
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeRecentProject(id);
    setItems(getRecentProjects());
  };

  const currentId = pathname.startsWith('/bid/project/')
    ? pathname.split('/')[3]
    : null;

  return (
    <div className="px-2 pt-1 pb-2">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <Clock size={11} strokeWidth={1.5} className="text-[#94a3b8]" />
        <span className="text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wider">最近访问</span>
      </div>
      {items.map(p => (
        <button
          key={p.id}
          onClick={() => handleClick(p)}
          className={`group relative flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors mb-0.5 ${
            p.id === currentId
              ? 'bg-[#eff6ff] text-[#064ea2]'
              : 'text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a]'
          }`}
          title={`${p.projectCode} — ${p.name}`}
        >
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: p.id === currentId ? '#064ea2' : '#cbd5e1' }}
          />
          <span className="text-xs font-medium truncate flex-1">
            <span className="font-mono font-semibold text-[#064ea2]">{p.projectCode}</span>
            <span className="text-[#8a96aa] mx-1">—</span>
            {p.name}
          </span>
          <button
            onClick={e => handleRemove(e, p.id)}
            className="flex-shrink-0 p-0.5 rounded text-[#94a3b8] opacity-0 group-hover:opacity-100 hover:text-[#e74c3c] hover:bg-[#fef2f2] transition-all"
            title="移除此记录"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </button>
      ))}
      <div className="mx-2 mt-1.5 border-t border-[#edf2f7]" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add water-erp/apps/bid-portal/src/components/recent-projects.tsx
git commit -m "feat(bid): add recent projects list component"
```

---

### Task 6: 重构 AppShell 侧边栏

**Files:**
- Modify: `water-erp/apps/bid-portal/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `<GlobalProjectSearch>` from `@/components/global-project-search`
- Consumes: `<RecentProjects>` from `@/components/recent-projects`

- [ ] **Step 1: 修改 navItems — 精简为 2 项**

将 `app-shell.tsx` 第 24-31 行的 `navItems` 替换为：

```tsx
const navItems: NavItem[] = [
  { label: '开评标总览', caption: '项目总览', path: '/bid', icon: LayoutDashboard },
  { label: '归档端', caption: '项目归档', path: '/bid/archive', icon: Archive },
];
```

同步修改第 7 行的 import — 移除不再使用的图标：

```tsx
import {
  LayoutDashboard, Archive,
  LogOut, PanelLeftClose, PanelLeft,
} from 'lucide-react';
```

- [ ] **Step 2: 在侧边栏插入全局选择器和最近项目**

在侧边栏 `<nav>` 标签（第 96 行）之前插入：

```tsx
{/* ── Global project search + recent projects ── */}
{!collapsed && (
  <>
    <GlobalProjectSearch />
    <RecentProjects />
  </>
)}
```

需要在文件顶部添加 import：

```tsx
import GlobalProjectSearch from './global-project-search';
import RecentProjects from './recent-projects';
```

- [ ] **Step 3: 更新 isActive 逻辑**

`isActive` 函数需要处理 `/bid/project/[id]` 路径不高亮任何导航项的情况。当前逻辑已经满足 — 它检查精确匹配 `/bid` 或前缀匹配其他路径，而 `/bid/project/*` 不匹配任何导航项的 path。

验证现有逻辑（第 53-54 行）无需修改：

```tsx
const isActive = (path: string) =>
  path === '/bid' ? pathname === '/bid' : pathname === path || pathname.startsWith(path + '/');
```

`/bid/project/xxx` 不匹配 `/bid`（不等），不匹配 `/bid/archive`。✅

- [ ] **Step 4: Commit**

```bash
git add water-erp/apps/bid-portal/src/components/app-shell.tsx
git commit -m "feat(bid): simplify sidebar to global search + recent projects + 2 nav items"
```

---

### Task 7: 项目工作台 Tab 面板组件

**Files:**
- Create: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/project/[id]/components/project-tabs.tsx`
- Create: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/project/[id]/components/project-header.tsx`
- Create: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/project/[id]/page.tsx`

**Interfaces:**
- Consumes: `useBidProjectContext()` from `@/contexts/bid-project-context`
- Consumes: `STAGE_LABEL` from `@water-erp/shared`
- Produces: `<ProjectTabs>` — 5 个 Tab 的内容区域（直接复用现有页面组件）

- [ ] **Step 1: 创建 project-header.tsx**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';

export default function ProjectHeader() {
  const router = useRouter();
  const { project, isLoading, error, refetch } = useBidProjectContext();

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-5 py-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={18} strokeWidth={1.5} className="text-[#e74c3c]" />
          <div>
            <p className="text-sm font-bold text-[#e74c3c]">{error}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refetch}
            className="rounded-xl border border-[#e74c3c] px-3 py-1.5 text-xs font-bold text-[#e74c3c] hover:bg-[#e74c3c]/10 transition"
          >
            重试
          </button>
          <button
            onClick={() => router.push('/bid')}
            className="rounded-xl border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
          >
            返回总览
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !project) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#edf2f7] bg-white px-5 py-4">
        <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-[#8a96aa]" />
        <span className="text-sm text-[#8a96aa]">加载项目信息…</span>
      </div>
    );
  }

  const stageLabel = STAGE_LABEL[project.stage] || project.stage;
  const stageColor = STAGE_COLOR[project.stage] || '#94a3b8';
  const projectCode = (project as any).projectCode || '';
  const supplierCount = (project as any)._count?.suppliers ?? (project as any).suppliers?.length ?? '—';
  const expertCount = (project as any)._count?.experts ?? (project as any).experts?.length ?? '—';

  return (
    <div className="rounded-2xl border border-[#edf2f7] bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => router.push('/bid')}
            className="flex items-center gap-1 rounded-xl border border-[#e5ecf4] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition flex-shrink-0"
          >
            <ArrowLeft size={14} strokeWidth={1.5} />
            返回总览
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-black text-[#18243a] truncate">
              {projectCode && (
                <span className="font-mono text-[#064ea2] mr-2">{projectCode}</span>
              )}
              {project.name}
            </h1>
            <div className="flex items-center gap-4 mt-1">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ color: stageColor, backgroundColor: `${stageColor}15` }}
              >
                {stageLabel}
              </span>
              <span className="text-xs text-[#8a96aa]">
                供应商：<span className="font-mono font-semibold text-[#18243a]">{supplierCount}</span>
              </span>
              <span className="text-xs text-[#8a96aa]">
                专家：<span className="font-mono font-semibold text-[#18243a]">{expertCount}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 project-tabs.tsx**

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { STAGE_LABEL } from '@water-erp/shared';
import { Unlock, ListChecks, Shield, ClipboardCheck, MessageSquare, AlertCircle } from 'lucide-react';

interface TabDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  minStage: string[]; // 允许的阶段列表
  stageHint: string;  // 阶段不满足时的提示语
}

const TABS: TabDef[] = [
  {
    key: 'open',
    label: '开标大厅',
    icon: Unlock,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '开标尚未开始。请等待项目进入开标阶段。',
  },
  {
    key: 'standard',
    label: '评分标准',
    icon: ListChecks,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '评分标准尚未开放。请等待项目进入开标阶段。',
  },
  {
    key: 'supervise',
    label: '监督端',
    icon: Shield,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '监督功能尚未开放。请等待项目进入开标阶段。',
  },
  {
    key: 'evaluate',
    label: '评标端',
    icon: ClipboardCheck,
    minStage: ['EVALUATING', 'ARCHIVED'],
    stageHint: '评标尚未开始。当前项目阶段：{stage}。请等待开标完成后进入评标阶段。',
  },
  {
    key: 'clarify',
    label: '澄清答疑',
    icon: MessageSquare,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '澄清答疑尚未开放。请等待项目进入开标阶段。',
  },
];

/** 根据项目阶段返回默认 tab key */
export function getDefaultTab(stage: string): string {
  switch (stage) {
    case 'EVALUATING': return 'evaluate';
    case 'ARCHIVED': return 'open'; // 归档后默认看开标记录
    default: return 'open';
  }
}

export default function ProjectTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { project } = useBidProjectContext();

  const currentTab = searchParams.get('tab') || (project ? getDefaultTab(project.stage) : 'open');

  const switchTab = (key: string) => {
    // 使用 replace 而非 push，避免堆积历史
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const isStageAllowed = (def: TabDef) => {
    if (!project) return true;
    return def.minStage.includes(project.stage);
  };

  const currentDef = TABS.find(t => t.key === currentTab);

  return (
    <div>
      {/* Tab 导航栏 */}
      <div className="flex items-center gap-1 border-b border-[#edf2f7] overflow-x-auto -mx-1 px-1">
        {TABS.map(tab => {
          const active = currentTab === tab.key;
          const allowed = isStageAllowed(tab);
          return (
            <button
              key={tab.key}
              onClick={() => allowed && switchTab(tab.key)}
              disabled={!allowed && !active}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold whitespace-nowrap rounded-t-xl border-b-2 transition-all flex-shrink-0 ${
                active
                  ? 'border-[#064ea2] text-[#064ea2] bg-white'
                  : allowed
                  ? 'border-transparent text-[#5a6d8a] hover:text-[#18243a] hover:bg-[#f8fafc]'
                  : 'border-transparent text-[#cbd5e1] cursor-not-allowed'
              }`}
            >
              <tab.icon size={14} strokeWidth={1.5} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 内容 */}
      <div className="pt-4">
        {currentDef && !isStageAllowed(currentDef) ? (
          /* 阶段不满足 - 引导提示 */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#f8fafc] border border-[#edf2f7] flex items-center justify-center mb-4">
              <AlertCircle size={24} strokeWidth={1.5} className="text-[#94a3b8]" />
            </div>
            <p className="text-sm font-semibold text-[#5a6d8a] max-w-sm">
              {currentDef.stageHint.replace('{stage}', project ? (STAGE_LABEL[project.stage] || project.stage) : '未知')}
            </p>
          </div>
        ) : (
          /* 正常渲染 Tab 内容 — 由 page.tsx 根据 currentTab 条件渲染 */
          <div id="tab-content" />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建项目工作台 page.tsx**

```tsx
'use client';

import { use, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import ProjectHeader from './components/project-header';
import ProjectTabs from './components/project-tabs';
import { Loader2 } from 'lucide-react';

// 动态导入子页面内容 — 复用现有组件
import BidOpenPage from '../../open/page';
import BidStandardPage from '../../standard/page';
import BidSupervisePage from '../../supervise/page';
import BidEvaluatePage from '../../evaluate/page';
import BidClarificationsPage from '../../clarifications/page';

function TabContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'open';

  // 注意：现有子页面组件内部调用了 useBidProjects() + ProjectSelector。
  // 在 Task 9 中会修改它们以读取 Context。当前先保持兼容，Tab 渲染可能显示
  // 旧版项目选择器。此处仅搭建外壳，子页面适配在 Task 9 完成。
  switch (tab) {
    case 'open': return <BidOpenPage />;
    case 'standard': return <BidStandardPage />;
    case 'supervise': return <BidSupervisePage />;
    case 'evaluate': return <BidEvaluatePage />;
    case 'clarify': return <BidClarificationsPage />;
    default: return <BidOpenPage />;
  }
}

export default function ProjectWorkspacePage() {
  const { isLoading } = useBidProjectContext();

  return (
    <div className="space-y-4">
      <ProjectHeader />

      <Suspense fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-[#8a96aa]" />
        </div>
      }>
        <ProjectTabs />
      </Suspense>

      {/* Tab 内容区 */}
      <Suspense fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-[#8a96aa]" />
        </div>
      }>
        <TabContent />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add water-erp/apps/bid-portal/src/app/\(dashboard\)/bid/project/
git commit -m "feat(bid): add project workspace with header and tabs"
```

---

### Task 8: 修改子页面 — 从 Context 读取项目，移除独立选择器

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/supervise/page.tsx`
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/evaluate/page.tsx`
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/archive/page.tsx`
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/clarifications/page.tsx`

**Interfaces:**
- Consumes: `useBidProjectContext()` from `@/contexts/bid-project-context`
- Removes: `useBidProjects()` import and call
- Removes: `<ProjectSelector>` from the JSX

- [ ] **Step 1: 修改 open/page.tsx — 移除 useBidProjects + ProjectSelector**

**改动点 1:** 删除 import（第 6-7 行）：
```tsx
// 删除：
import { useBidProjects } from '@/hooks/use-bid-projects';
import ProjectSelector from '@/components/project-selector';

// 添加：
import { useBidProjectContext } from '@/contexts/bid-project-context';
```

**改动点 2:** 将所有 `const { projectId, setProjectId } = useBidProjects();` 替换为：
```tsx
const { projectId, project: ctxProject } = useBidProjectContext();
```

**改动点 3:** 找到 `<PageHero>` 中的 `<ProjectSelector>` 并删除（通常在 `PageHero` 的 actions prop 或子元素中）。

**改动点 4:** 移除依赖 `setProjectId` 的任何状态重置逻辑 — 项目切换现在由 URL 驱动，Provider 自动处理。

**改动点 5:** 将 WebSocket 的 `projectId` 从本地 state 改为使用 Context 的 `projectId`（当时为 undefined 时跳过连接）— 这已经满足，`useBidWebSocket` 接受 `string | undefined`。

- [ ] **Step 2: 同样修改 standard/page.tsx, supervise/page.tsx, evaluate/page.tsx, clarifications/page.tsx**

每个文件相同的改动模式：
1. 删除 `import { useBidProjects }` + `import ProjectSelector`
2. 添加 `import { useBidProjectContext } from '@/contexts/bid-project-context'`
3. 将 `const { projectId, setProjectId } = useBidProjects()` 替换为 `const { projectId } = useBidProjectContext()`
4. 删除 JSX 中的 `<ProjectSelector value={projectId} onChange={setProjectId} />`
5. 删除或调整 `useEffect([projectId])` — 保留数据加载逻辑，但移除 `if (!projectId) return;` 之外的 setProjectId 引用

**关键：** `useEffect` 依赖 `[projectId]` 保持不变 — Context 在 `projectId` 变化时自动更新，每个页面监听到变化后重新加载自己的数据。

- [ ] **Step 3: 修改 archive/page.tsx**

归档端虽然保持独立路由，但也需要从 Context 读取项目（或保持自己的逻辑）。**决策：归档端保持独立，不读取 Context**，因为它不依赖"选定项目"模式 — 它是多项目汇总视图。但可以保留 `useBidProjects` 用于其内部的单个项目操作（如"一键归档"）。

对于归档端：保持 `useBidProjects` + `ProjectSelector` 不变，因为它是独立的多项目视图。未来可在第二步将其改为列表展示多项目。

- [ ] **Step 4: 验证**

运行 `pnpm dev:bid` 并检查：
- 进入 `/bid/project/[id]?tab=open` 时，开标大厅内容正常显示
- 不再有双份 project 列表请求
- PageHero 区域不再有 ProjectSelector
- 项目详情从 Context 正确获取

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/bid-portal/src/app/\(dashboard\)/bid/open/page.tsx \
        water-erp/apps/bid-portal/src/app/\(dashboard\)/bid/standard/page.tsx \
        water-erp/apps/bid-portal/src/app/\(dashboard\)/bid/supervise/page.tsx \
        water-erp/apps/bid-portal/src/app/\(dashboard\)/bid/evaluate/page.tsx \
        water-erp/apps/bid-portal/src/app/\(dashboard\)/bid/clarifications/page.tsx
git commit -m "refactor(bid): sub-pages read project from Context, remove independent selectors"
```

---

### Task 9: 更新总览页 — 表格行点击指向项目工作台

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: 修改 STAGE_ROUTE 映射**

将第 37-43 行替换为：

```tsx
/** Stage → sub-route mapping for context-aware row navigation */
const STAGE_ROUTE: Record<string, string> = {
  DOWNLOAD: '',
  SUBMIT: '',
  OPENING: '/bid/project',
  EVALUATING: '/bid/project',
  ARCHIVED: '/bid/project',
};
```

- [ ] **Step 2: 修改 handleRowClick — 使用新路由格式**

将第 141-147 行替换为：

```tsx
const handleRowClick = (p: DashboardProject) => {
  const route = STAGE_ROUTE[p.stage];
  if (route) {
    const defaultTab = p.stage === 'EVALUATING' ? 'evaluate' : 'open';
    router.push(`${route}/${p.id}?tab=${defaultTab}`);
  }
};
```

- [ ] **Step 3: 修改操作按钮 — 更新为新的工作台路由**

**第 473-483 行**（"启动开标"按钮）：
```tsx
router.push(`/bid/project/${p.id}?tab=open`);
```

**第 487-495 行**（"进入评标"按钮）：
```tsx
router.push(`/bid/project/${p.id}?tab=evaluate`);
```

**第 497-507 行**（"查看归档"按钮）：
```tsx
router.push(`/bid/project/${p.id}?tab=open`); // 或保持 /bid/archive?projectId=
// 注：归档逻辑后续可调整
```

- [ ] **Step 4: 修改快速入口卡片 — 指向项目工作台或保持独立**

第 115-119 行的 `entries` 快速入口卡片需要调整。开标主持端、专家评标端、监督端的入口改为引导用户先选项目（或在总览页表格中选择）。**决策：保留卡片但点击后跳转到总览页表格区域（滚动到表格），而非直接进入页面。**

简化为：移除 `entries` 的 `onClick`，改为在卡片下方显示"请在下方表格中选择项目"。

实际修改：
```tsx
const entries = [
  { label: '开标主持端', hint: '在线解密 · 开标记录', path: '/bid', tone: 'blue' as const, count: opening },
  { label: '专家评标端', hint: '独立评分 · 报告确认', path: '/bid', tone: 'purple' as const, count: evaluating },
  { label: '监督端',     hint: '日志追溯 · 不可干预', path: '/bid', tone: 'orange' as const, count: undefined },
  { label: '归档端',     hint: '资料归档 · 防篡改',   path: '/bid/archive', tone: 'green' as const, count: archived },
];
```

即仅归档端保留独立跳转，其余指向总览页本身。

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/bid-portal/src/app/\(dashboard\)/bid/page.tsx
git commit -m "refactor(bid): update dashboard row clicks to new workspace routes"
```

---

### Task 10: 归档端调整 — 保持独立路由

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/archive/page.tsx`

- [ ] **Step 1: 检查归档端是否需要修改**

归档端保持独立 `/bid/archive` 路由，内部逻辑（`useBidProjects` + `ProjectSelector`）不变。在侧边栏精简中已保留"归档端"入口，路由不变。

**无需代码修改** — 仅验证可正常访问。

- [ ] **Step 2: 验证侧边栏归档端入口**

确认 `app-shell.tsx` 中 navItems 包含 `{ label: '归档端', path: '/bid/archive', icon: Archive }`（已在 Task 6 完成）。

- [ ] **Step 3: Commit（如有修改）**

无修改则跳过。

---

### Task 11: 清理 — 删除未使用代码

**Files:**
- No delete — 保留文件作为回滚参考，仅确保无 import 引用它们

- [ ] **Step 1: 确认 use-bid-projects.ts 的引用已全部移除**

```bash
cd water-erp/apps/bid-portal && grep -r "use-bid-projects" src/ --include="*.ts" --include="*.tsx"
```

预期：仅 `archive/page.tsx` 仍引用（归档端保留独立逻辑），其余已移除。

- [ ] **Step 2: 确认 project-selector.tsx 的引用已全部移除**

```bash
cd water-erp/apps/bid-portal && grep -r "project-selector" src/ --include="*.ts" --include="*.tsx"
```

预期：仅 `archive/page.tsx` 仍引用。

- [ ] **Step 3: 保留旧路由页面**

旧的 `/bid/open`, `/bid/standard`, `/bid/supervise`, `/bid/evaluate`, `/bid/clarifications` 页面文件**保留不删除** — 它们作为 Tab 内容被复用（通过 import 在 project workspace page.tsx 中引用）。旧的独立路由访问（`/bid/open`）仍然可用但不被侧边栏导航到。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(bid): verify cleanup — old hooks/components preserved for rollback"
```

---

### Task 12: 端到端测试验证

- [ ] **Step 1: 启动全栈**

```bash
cd water-erp
pnpm infra:up
pnpm db:seed
pnpm dev
```

- [ ] **Step 2: 测试流程**

1. 浏览器访问 `http://localhost:3007/bid`
2. 验证：侧边栏仅显示全局搜索 + 最近项目（空）+ 开评标总览 + 归档端
3. 在总览表格中点击一个 OPENING 阶段项目 → 应跳转到 `/bid/project/[id]?tab=open`
4. 验证：项目工作台顶栏显示项目信息 + 返回按钮
5. 验证：Tab 导航显示 5 个选项，开标大厅高亮
6. 切换 Tab → URL 更新为 `?tab=standard` 等
7. 验证：项目信息在 Tab 间保持不变（Context 共享）
8. 点击侧边栏"开评标总览" → 回到 `/bid`
9. 点击侧边栏最近项目 → 直接进入该工作台
10. 使用侧边栏搜索选择器 → 输入项目编号 → 选中 → 跳转
11. 测试归档端 `/bid/archive` → 保持原有功能

- [ ] **Step 3: 验证边界情况**

- URL 直接访问 `/bid/project/nonexistent-id` → 显示"项目不存在"错误
- WebSocket 连接在项目工作台建立，离开后断开
- 最近项目最多 5 条，正确排序
- 移除最近项目后列表正确更新

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A && git commit -m "fix(bid): edge case fixes from e2e testing"
```
