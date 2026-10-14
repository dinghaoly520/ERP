# 移动驾驶舱 :3011 体验打磨（第一轮）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 7 项打磨——下拉刷新/入场动效/趋势图整列触摸/Sheet 退场/项目规模分析补齐/用户态 Context 去重/筛选记忆。

**Architecture:** 全部改动限定 `apps/mobile-portal`；零新依赖（CSS keyframes + 自研 hook + React Context + localStorage）；桌面端与 API 零改动。

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4（现有栈）。

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-portal-polish-design.md`

## Global Constraints

- 零新依赖（无 framer-motion / 第三方刷新库）
- 动效尊重 `@media (prefers-reduced-motion: reduce)`（直显）
- 提交只 add `water-erp/apps/mobile-portal` 下明确路径 + 本计划/spec 文档；禁 `git add -A`
- 提交信息中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 1: 打磨基建——动效 CSS / AuthContext / filter-store / usePullToRefresh / Sheet 退场 / SectionCard 阶梯

**Files:**
- Modify: `apps/mobile-portal/src/app/globals.css`（追加动效段）
- Create: `apps/mobile-portal/src/components/m/auth-context.tsx`
- Create: `apps/mobile-portal/src/lib/filter-store.ts`
- Create: `apps/mobile-portal/src/hooks/use-pull-to-refresh.ts`
- Modify: `apps/mobile-portal/src/components/m/section-card.tsx`（`index` 阶梯 + `.m-rise`）
- Modify: `apps/mobile-portal/src/components/m/bottom-sheet.tsx`（closing 退场）
- Modify: `apps/mobile-portal/src/app/(main)/layout.tsx`（包 AuthProvider）

**Interfaces（Task 2/3 消费）:**
- `useAuth(): { user: AuthUser | null }`（`user.role` 判 admin）
- `usePullToRefresh(onRefresh: () => Promise<void>): { pull: number; refreshing: boolean }`
- `readSavedFilters<T>(page: string): Partial<T>` / `saveFilters(page: string, value: unknown): void`
- `SectionCard` 新增可选 `index?: number`（animationDelay = index*50ms）
- `BottomSheet` 行为变化：`onClose` 触发退场动画后卸载（对外签名不变）

- [ ] **Step 1: globals.css 追加**

在文件末尾追加：

```css

/* ══ 体验打磨一轮（2026-10-14 spec）：入场/退场动效 + 减弱动效尊重 ══ */
@keyframes m-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.m-rise { animation: m-rise 0.36s var(--ease-out-quint) both; }

@keyframes m-sheet-down {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}
.m-sheet-panel[data-closing="true"] {
  animation: m-sheet-down 0.24s var(--ease-out-quint) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .m-rise,
  .m-sheet-panel,
  .m-sheet-panel[data-closing="true"] { animation: none; }
}
```

- [ ] **Step 2: auth-context.tsx**

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthUser } from "@/lib/api/auth";

/** (main) 布局级用户态——layout 已取 /auth/me，页面经 context 消费（去重：每会话 1 次） */
const AuthCtx = createContext<{ user: AuthUser | null } | null>(null);

export function AuthProvider({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  return <AuthCtx.Provider value={{ user }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): { user: AuthUser | null } {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 3: filter-store.ts**

```ts
/**
 * 筛选记忆（2026-10-14 spec）：localStorage 单 key 分页存；
 * 搜索词不记忆（瞬态意图）。隐私模式/存储异常静默降级。
 */
const KEY = "mobile-portal:filters";

export function readSavedFilters<T>(page: string): Partial<T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, unknown>;
    return (all[page] ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}

export function saveFilters(page: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    all[page] = value;
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 存储不可用忽略 */
  }
}
```

- [ ] **Step 4: use-pull-to-refresh.ts**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 下拉刷新（2026-10-14 spec，零依赖）：仅窗口滚顶时响应；拖距阻尼 0.45、
 * 阈值 64px；指示器随 pull 渐显、refreshing 时旋转。touch 事件 + 桌面无触摸自然禁用。
 */
const TRIGGER_PX = 64;
const DAMPING = 0.45;
const MAX_PULL = 96;

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      startYRef.current = scrollTop <= 0 ? e.touches[0].clientY : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy > 0) {
        pullRef.current = Math.min(dy * DAMPING, MAX_PULL);
        setPull(pullRef.current);
      }
    };
    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      const reached = pullRef.current >= TRIGGER_PX;
      pullRef.current = 0;
      setPull(0);
      if (reached) {
        setRefreshing(true);
        refreshingRef.current = true;
        void onRefresh().finally(() => {
          setRefreshing(false);
          refreshingRef.current = false;
        });
      }
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [onRefresh]);

  /** 顶部指示器渲染状态：下拉中显拉动进度，刷新中旋转 */
  const indicator = useCallback(() => ({ pull, refreshing }), [pull, refreshing]);
  return { pull, refreshing, indicator };
}

/** 下拉刷新指示器——固定在顶栏下缘居中（页面根内渲染） */
export function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (!pull && !refreshing) return null;
  const progress = Math.min(pull / TRIGGER_PX, 1);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-1/2 z-40 -translate-x-1/2"
      style={{ top: `calc(3.5rem + ${(refreshing ? 8 : Math.min(pull, TRIGGER_PX) - 8).toFixed(0)}px)`, opacity: refreshing ? 1 : progress }}
    >
      <div
        className={`h-7 w-7 rounded-full border-2 border-[color-mix(in_oklch,var(--accent)_25%,transparent)] border-t-[var(--accent)] ${refreshing ? "animate-spin" : ""}`}
        style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
      />
    </div>
  );
}
```

- [ ] **Step 5: section-card.tsx 加阶梯**

完整重写为：

```tsx
import type { ComponentType, ReactNode } from "react";

/** 移动端区块卡——cgzxui 玻璃静态卡 + 标题行；index 驱动入场阶梯（50ms/卡，m-rise） */
export function SectionCard({
  icon: Icon,
  title,
  right,
  index = 0,
  children,
}: {
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  right?: ReactNode;
  index?: number;
  children: ReactNode;
}) {
  return (
    <section className="neu-card-static m-rise mb-3 rounded-[18px] p-3.5" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="mb-3 flex items-center gap-2">
        {Icon ? <Icon size={15} className="shrink-0 text-[var(--accent)]" /> : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold tracking-[-0.02em] text-[var(--foreground)]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 6: bottom-sheet.tsx 退场动画**

完整重写为：

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** 移动端底部弹层——入场 m-sheet-up / 退场 m-sheet-down（240ms 后卸载） */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);

  useEffect(() => {
    if (!open && !closing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing]);

  function requestClose() {
    setClosing(true);
  }

  function handleAnimationEnd(e: React.AnimationEvent) {
    // 退场动画播完才真正卸载；reduced-motion 下无动画不会触发——兜底定时卸载
    if (!closing) return;
    if (e.animationName === "m-sheet-down" || e.animationName === undefined) {
      setClosing(false);
      onClose();
    }
  }

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, 280);
    return () => window.clearTimeout(t);
  }, [closing, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[rgba(20,35,60,0.38)] backdrop-blur-[2px]" onClick={requestClose} />
      <div className="m-sheet-panel" data-closing={closing ? "true" : "false"} onAnimationEnd={handleAnimationEnd}>
        <div aria-hidden className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_28%,transparent)]" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 text-[15px] font-bold leading-snug tracking-[-0.02em] text-[var(--foreground)]">{title}</div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="关闭"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-white/70 text-[var(--muted-foreground)] active:scale-95"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: (main)/layout.tsx 包 AuthProvider**

import 增加 `import { AuthProvider } from "@/components/m/auth-context";`，`<main>` 内容改为：

```tsx
        <main className="relative z-10 flex-1 px-3.5 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-3.5">
          <AuthProvider user={user}>{children}</AuthProvider>
        </main>
```

- [ ] **Step 8: 类型检查 + Commit**

```bash
pnpm --filter mobile-portal exec tsc --noEmit
git add water-erp/apps/mobile-portal/src
git commit -m "feat(mobile-portal): 打磨基建——入场/退场动效、AuthContext、下拉刷新 hook、筛选记忆存储"
```

---

### Task 2: 三页接入（useAuth / 下拉刷新 / 筛选记忆 / SectionCard 阶梯 / 趋势图整列触摸）

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx`
- Modify: `apps/mobile-portal/src/app/(main)/ledger/page.tsx`
- Modify: `apps/mobile-portal/src/app/(main)/progress/page.tsx`

**Interfaces:**
- Consumes: Task 1 全部产物
- Produces: 无（页面内部改动）

- [ ] **Step 1: dashboard 接入**

改动点（其余不动）：
1. imports 增 `useAuth`、`usePullToRefresh, PullIndicator`、`readSavedFilters, saveFilters`；删 `fetchCurrentUser` import 与其 effect/role state。
2. `const { user } = useAuth();` + `const role = user?.role ?? null;`（companies effect 依赖 role 不变）。
3. 初始 state 从记忆恢复：`useState<RangeKey>(() => readSavedFilters<{ rangeKey: RangeKey }>("dashboard").rangeKey ?? "year")`、`useState<string>(() => readSavedFilters<{ companyId: string }>("dashboard").companyId ?? "all")`。
4. 写记忆：rangeKey chip onClick 与 companyId onChange 里 `saveFilters("dashboard", { rangeKey: key, companyId })` / `saveFilters("dashboard", { rangeKey, companyId: e.target.value })`。
5. `loadData` 已是 useCallback；`const { pull, refreshing } = usePullToRefresh(async () => { await loadData(); });`（loadData 内部 setLoading 会重显骨架，可接受）；页面根 `<div>` 内首行渲染 `<PullIndicator pull={pull} refreshing={refreshing} />`。
6. SectionCard 依序加 `index={0..n}`（汇总区非 SectionCard 可不动）。
7. **趋势图触摸**：新增 `const [activeIdx, setActiveIdx] = useState<number | null>(null);`；`trend` 对象补 `colW = plotW / n`、`colX = (i) => padL + i * colW`；点/柱渲染后追加整列热区与高亮：

```tsx
{trend.series.map((t, i) => (
  <g key={`hit-${i}`}>
                {activeIdx === i ? (
      <>
        <line x1={trend.x(i)} y1={trend.padT} x2={trend.x(i)} y2={trend.padT + trend.plotH} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
        <circle cx={trend.x(i)} cy={trend.amountY(t.amount)} r={5} fill="var(--success)" stroke="white" strokeWidth={1.5} />
      </>
    ) : null}
    <rect
      x={trend.colX(i)}
      y={trend.padT}
      width={trend.colW}
      height={trend.plotH}
      fill="transparent"
      style={{ cursor: "pointer" }}
      onPointerDown={() => setActiveIdx(i)}
      onPointerUp={() => {
        setActiveIdx(null);
        setActiveTrend(t);
      }}
      onPointerCancel={() => setActiveIdx(null)}
    />
  </g>
))}
```

删除原 `pt-*` 组中的透明命中圆（`r={11}` 那个 circle），保留数据点小圆与 x 轴 label 文本。

- [ ] **Step 2: ledger 接入**

1. 同页 useAuth 替换 role（删 fetchCurrentUser effect）。
2. 初始 state 记忆恢复：statusFilter/methodFilter/companyId 三项 `useState(() => readSavedFilters<...>("ledger").xxx ?? 默认)`；changeFilter 各分支调 `saveFilters("ledger", { statusFilter, methodFilter, companyId })`（用 setter 后最新值——在 changeFilter 里以参数直接写：`changeFilter((next) => { setX(next); saveFilters("ledger", {...current, x: next}); })` 模式，实现时用局部函数 `persistLedger(patch)` 合并写）。
3. 下拉刷新：`const reload = useCallback(() => { setPage(1); setRetryTick((t) => t + 1); }, []);` + `usePullToRefresh(async () => { await new Promise((r) => setTimeout(r, 200)); reload(); });`（page 已为 1 时 retryTick 强制重拉首页并替换 items——现有 effect 依赖含 retryTick，page===1 路径替换列表，成立）。
4. `<PullIndicator .../>` 进页面根；SectionCard 无（台账页未用 SectionCard，跳过）。

- [ ] **Step 3: progress 接入**

1. useAuth 替换 role；删 fetchCurrentUser effect。
2. companyId 记忆（readSavedFilters("progress")）+ onChange saveFilters。
3. 下拉刷新：`usePullToRefresh(async () => { setRetryTick((t) => t + 1); await new Promise((r) => setTimeout(r, 300)); });`（retryTick 变化重拉 stats+insights）；PullIndicator 进根。
4. SectionCard 加 index 0..3。

- [ ] **Step 4: 类型检查 + 手动验证 + Commit**

```bash
pnpm --filter mobile-portal exec tsc --noEmit
# curl 冒烟：三页 200；DevTools iPhone 视口人工过一遍下拉/触摸/动效
git add water-erp/apps/mobile-portal/src/app/\(main\)
git commit -m "feat(mobile-portal): 三页接入打磨——下拉刷新/用户态Context/筛选记忆/趋势整列触摸"
```

---

### Task 3: 数据库页「项目规模分析」补齐

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `DashboardData.trendSeries[].projects[].budgetLabel`；Task 1 `BottomSheet`/`SectionCard`；页内 `ProjectRow`
- Produces: 无

- [ ] **Step 1: 分桶逻辑 + 区块 UI + 下钻**

页内新增（imports 已有依赖，无需新增）：

```tsx
/* 项目规模分桶（移植自 web dashboard-home computeSegments——budgetLabel 字面值解析） */
type ScaleSegment = { label: string; range: string; min: number; max: number; count: number; amount: number; amountLabel: string; share: number; color: string };

const SCALE_SEGS: Array<Omit<ScaleSegment, "count" | "amount" | "amountLabel" | "share">> = [
  { label: "小额", range: "<10万", min: 0, max: 100000, color: "var(--accent)" },
  { label: "中小", range: "10-50万", min: 100000, max: 500000, color: "var(--success)" },
  { label: "中型", range: "50-200万", min: 500000, max: 2000000, color: "var(--warning)" },
  { label: "大型", range: ">200万", min: 2000000, max: Infinity, color: "var(--danger)" },
];

function computeSegments(data: DashboardData | null): ScaleSegment[] {
  const segs: ScaleSegment[] = SCALE_SEGS.map((s) => ({ ...s, count: 0, amount: 0, amountLabel: "", share: 0 }));
  (data?.trendSeries ?? []).forEach((ti) =>
    (ti.projects ?? []).forEach((p) => {
      const bs = p.budgetLabel;
      let b = 0;
      if (bs.includes("万")) b = parseFloat(bs.replace("万", "").replace(",", "").trim()) * 10000;
      else if (bs.includes("元")) b = parseFloat(bs.replace("元", "").replace(/,/g, ""));
      for (const s of segs) if (b >= s.min && b < s.max) { s.count++; s.amount += b; break; }
    }),
  );
  const t = segs.reduce((sum, s) => sum + s.count, 0);
  segs.forEach((s) => {
    s.share = t > 0 ? Math.round((s.count / t) * 100) : 0;
    s.amountLabel = s.amount >= 10000 ? `${(s.amount / 10000).toFixed(1)}万` : `${s.amount.toFixed(0)}元`;
  });
  return segs;
}

function segmentProjects(data: DashboardData | null, seg: ScaleSegment) {
  const out: Array<{ name: string; date: string; department: string; budgetLabel: string; status: string }> = [];
  (data?.trendSeries ?? []).forEach((ti) =>
    (ti.projects ?? []).forEach((p) => {
      const bs = p.budgetLabel;
      let b = 0;
      if (bs.includes("万")) b = parseFloat(bs.replace("万", "").replace(",", "").trim()) * 10000;
      else if (bs.includes("元")) b = parseFloat(bs.replace("元", "").replace(/,/g, ""));
      if (b >= seg.min && b < seg.max) out.push({ name: p.name, date: p.date, department: p.department, budgetLabel: p.budgetLabel, status: p.status });
    }),
  );
  return out;
}
```

页面组件内：`const scaleSegs = useMemo(() => computeSegments(data), [data]);`、`const [activeSeg, setActiveSeg] = useState<ScaleSegment | null>(null);`、`const scaleTotal = scaleSegs.reduce((s, x) => s + x.count, 0);`

在「采购方式分布」SectionCard 之后插入：

```tsx
{/* ── 项目规模分析 ── */}
<SectionCard
  icon={BarChart3}
  title="项目规模分析"
  index={4}
  right={<span className="shrink-0 text-[10px] font-bold text-[var(--warning)]">{scaleTotal} 项</span>}
>
  {scaleTotal > 0 ? (
    <div className="space-y-2">
      {scaleSegs.map((seg, i) => {
        const maxCount = Math.max(...scaleSegs.map((s) => s.count), 1);
        return (
          <button key={i} type="button" onClick={() => setActiveSeg(seg)} className="flex w-full items-center gap-2 rounded-[10px] px-1 py-1.5 text-left active:scale-[0.99]">
            <span className="w-12 shrink-0 leading-tight">
              <span className="block text-[11px] font-semibold text-[var(--foreground)]">{seg.label}</span>
              <span className="block text-[10px] text-[var(--muted-foreground)]">{seg.range}</span>
            </span>
            <span className="h-4 min-w-0 flex-1 overflow-hidden rounded-[5px] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
              <span className="block h-full rounded-[5px] opacity-85" style={{ width: `${(seg.count / maxCount) * 100}%`, background: seg.color }} />
            </span>
            <span className="w-11 shrink-0 text-right leading-tight">
              <span className="block text-[11px] font-bold tabular-nums" style={{ color: seg.color }}>{seg.count}项</span>
              <span className="block text-[10px] tabular-nums text-[var(--muted-foreground)]">{seg.share}%</span>
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <EmptyState text="暂无项目数据" />
  )}
</SectionCard>
```

弹层（与其它 BottomSheet 并列）：

```tsx
<BottomSheet
  open={!!activeSeg}
  onClose={() => setActiveSeg(null)}
  title={
    <span className="flex items-center gap-2">
      <BarChart3 size={16} className="text-[var(--warning)]" />
      {activeSeg?.label ?? ""}项目（{activeSeg?.range ?? ""}）
    </span>
  }
>
  {activeSeg ? (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="项目数" value={String(activeSeg.count)} tone="warning" />
        <MetricCard label="占比" value={`${activeSeg.share}%`} />
        <MetricCard label="金额合计" value={activeSeg.amountLabel} />
      </div>
      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">项目列表</div>
        <div className="space-y-1.5">
          {segmentProjects(data, activeSeg).length ? (
            segmentProjects(data, activeSeg).map((p, i) => (
              <ProjectRow key={i} name={p.name} meta={`${p.date} · ${p.department}`} amount={p.budgetLabel} status={p.status} />
            ))
          ) : (
            <EmptyState text="该区间暂无项目" />
          )}
        </div>
      </div>
    </div>
  ) : null}
</BottomSheet>
```

后续 SectionCard 的 index 顺延 +1。

- [ ] **Step 2: 类型检查 + 冒烟 + Commit**

```bash
pnpm --filter mobile-portal exec tsc --noEmit
git add water-erp/apps/mobile-portal/src/app/\(main\)/dashboard
git commit -m "feat(mobile-portal): 数据库页补齐项目规模分析——四桶分段+区间下钻（spec 首建遗漏项）"
```

---

### Task 4: 收尾——全量构建/lint/冒烟

**Files:** 无新增（验证性任务）

- [ ] **Step 1: 质量闸**

```bash
pnpm --filter mobile-portal exec tsc --noEmit
pnpm --filter mobile-portal lint          # 0 error
pnpm --filter mobile-portal build         # 成功
```

- [ ] **Step 2: 冒烟（spec 验证清单）**

1. 三页 200（带 cookie curl）；数据库页含「项目规模分析」区块（响应 HTML 为客户端渲染，以 Network 面板/页面目测为准）
2. DevTools iPhone：下拉刷新触发重拉；趋势图按列高亮+松开出弹层；sheet 关闭有下滑退场；卡片入场阶梯
3. DevTools Network：切三页仅登录时 1 次 /auth/me
4. 刷新页面：数据库范围档/公司、台账筛选、进展公司均保留
5. 模拟 prefers-reduced-motion：动效直显

- [ ] **Step 3: 收尾提交（如有零星修正）**

```bash
git add water-erp/apps/mobile-portal
git commit -m "chore(mobile-portal): 打磨一轮收尾——全量构建/冒烟通过"
```

（无改动则跳过本提交。）

---

## Self-Review 记录

- Spec 覆盖：spec ① 四项 ↔ Task 1（CSS/Sheet/SectionCard）+ Task 2（下拉刷新接入/趋势触摸）；② 三项 ↔ Task 1（context/filter-store）+ Task 2（接入）+ Task 3（规模分析）；③ 不改 ↔ 无任务（正确）——全覆盖
- 类型一致性：`useAuth/usePullToRefresh/PullIndicator/readSavedFilters/saveFilters/SectionCard.index` 在 Task 1 定义、Task 2/3 按同签名消费
- 已知取舍：BottomSheet 退场用「onAnimationEnd + 280ms 兜底定时」双保险（reduced-motion 下无动画事件也能卸载）
