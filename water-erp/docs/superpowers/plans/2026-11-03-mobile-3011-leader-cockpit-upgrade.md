# :3011 移动驾驶舱·领导视角升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复评审发现的 P1×3 缺陷，落地「两步铁律」交互、四张高价值数据卡、动效/实时层与风险卡转发，把 :3011 从「能刷到」升级为「能盯住、能推动」。

**Architecture:** 以后端既有端点为主（新增仅 台账 abnormalOnly 筛选 与 brief 区间参数两处小改），前端在 mobile-portal 内扩展 lib/api 客户端与组件；实时层用轮询 hook（不做 WS——移动浏览器后台不可靠，评审已裁定）；动效零新依赖（rAF + CSS）。

**Tech Stack:** Next.js 16 App Router + React 19 + Tailwind v4（cgzxui 新拟态体系）、NestJS 11 + Prisma、jest（仅 API 侧有单测基建；门户侧验证 = tsc + lint + 手动冒烟）。

## Global Constraints

- **只读铁律边界（2026-11-03 用户裁定）**：允许「转发/分享/复制」类动作；仍禁止任何确认/审批/写操作按钮（通知不提供已读标记）。
- **cgzxui 铁律**：禁渐变按钮、禁 emoji 图标、Lucide 图标、方向性双影（禁全向投影）、`rounded-2xl` 卡片体系；新增视觉一律复用 `m-tile/neu-card-static/neu-btn-soft` 既有类。
- **无 mock fallback**：真实数据/加载/空/错误四态，失败保留旧数据（O5/O6 模式）。
- **并行会话约定**：禁 `git add -A`/`git add .`，只 add 任务列出的文件；提交信息带 `feat(3011):`/`fix(3011):` 前缀，结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- **界面文案禁英文/黑话**（2026-10-28 裁定）：新文案全部中文领导语汇。
- **动画**：全部尊重 `prefers-reduced-motion: reduce`。
- 端口/进程：改 API 源码后 watch 树会竞速重启（叠树现状），验证前先 `lsof -nP -iTCP:4001 -sTCP:LISTEN` 确认现役进程启动时间晚于改动。

## 接口契约（已实测钉死，2026-11-03）

| 端点 | 返回（关键字段） |
|---|---|
| `GET /notifications/unread-count` | `{count: number}` |
| `GET /notifications?page=&pageSize=&tab=all\|todo` | `{total, page, pageSize, items[], unreadCount, todoCount, typeCounts, segmentCounts}` |
| `GET /alerts/overview` | `{expiringQualifications: number, overloadedExperts: number}` |
| `GET /performance/metrics` | `{period{from,to}, projectCount, contractCount, avgCycleDays, savingsRate, competitionAvg, objectionRate, acceptanceRate, satisfactionAvg}`（近 1 年口径，与 :3005 PerformancePanel 同源；无 companyId 参数——**与 :3005 保持同口径，不单独收口**） |
| `GET /bid/projects/dashboard` | `{projects: [{id, projectCode, name, procurementMethod, openTime, deadline, stage, budget, supplierCount, supplierSubmitted, expertCount, ...}]}` |
| ABNORMAL 四态 | `['FAILED_REVIEW','FILE_REVISION_REQUIRED','INVALID_RESPONSE','CANCELLED']`（procurements.service.ts:442，任务 3 提升为模块级导出） |

---

## Phase A · 修复包

### Task 1: `--neu-*` 令牌归位 `:root`（P1-1，五分钟级）

**Files:**
- Modify: `apps/mobile-portal/src/app/globals.css:255-267`

**Steps:**

- [ ] **Step 1: 剪切六行令牌出 `@keyframes`，粘进 `:root`**

把 `globals.css` 中 `@keyframes glow-drift { ... }` 块**内部**的这段（含注释行）：

```css
/* ── 新拟态阴影令牌 ── */
  --neu-dark-soft: oklch(0.45 0.08 258);
  --neu-brand: var(--accent-strong);
  --neu-brand-deep: oklch(0.42 0.16 251);
  --neu-raised-bg: #edf2f8;
  --neu-raised-bg-hover: #e4eaf3;
  --neu-link-bg: #dce3ee;
```

整段删除，使 `@keyframes glow-drift` 恢复为只含 0%/100% 两帧。然后在文件顶部 `:root {` 块内（`--accent-strong` 定义之后，约 line 16）追加同样六行（无缩进）。

- [ ] **Step 2: 验证结构正确**

Run: `sed -n '/@keyframes glow-drift/,/^}/p' apps/mobile-portal/src/app/globals.css`
Expected: 块内仅两帧，无 `--neu-`。
Run: `awk '/^:root/{f=1} f&&/--neu-brand:/{print "root-has-token"; exit}' apps/mobile-portal/src/app/globals.css`
Expected: `root-has-token`

- [ ] **Step 3: 构建验证**

Run: `cd apps/mobile-portal && pnpm build`
Expected: 构建成功。

- [ ] **Step 4: 目测四个按钮场景**（浏览器 :3011）——登录主按钮（底色应为由白渐染的品牌浅蓝、字色藏蓝）、顶栏登出次按钮（浅蓝灰底 `#edf2f8`）、弹层关闭 X、禁用态。修复前这些全是透明底。

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-portal/src/app/globals.css
git commit -m "fix(3011): --neu-* 令牌从 @keyframes 内归位 :root——按钮层底色/字色复活（P1-1）"
```

---

### Task 2: 后端台账 `abnormalOnly` 筛选参数（TDD）

**Files:**
- Modify: `apps/api/src/procurements/procurements.service.ts`（list ~:400-530、getStats :790-860）
- Modify: `apps/api/src/procurements/procurements.controller.ts:58-70`（stats 端点补 Query 参数）
- Test: `apps/api/src/procurements/procurements.service.spec.ts`（若无此文件则创建）

**Interfaces:**
- Produces: `GET /procurements?abnormalOnly=true` 与 `GET /procurements/stats?abnormalOnly=true&searchKeyword=&resultStatus=`（Task 4/5 前端消费）；模块级导出 `export const ABNORMAL_RESULT_STATES = ['FAILED_REVIEW','FILE_REVISION_REQUIRED','INVALID_RESPONSE','CANCELLED'] as const;`

**Steps:**

- [ ] **Step 1: 写失败测试**（在 procurements.service.spec.ts 追加；沿用该文件既有 mock Prisma 模式，若无文件则最小新建 `describe('abnormalOnly')` + mock PrismaService）

```typescript
it('abnormalOnly=true 时 where.resultStatus 收敛为 ABNORMAL 四态', async () => {
  await service.list(/* page */ 1, /* pageSize */ 12, /* user */ adminUser, /* filters */ {
    abnormalOnly: true,
  } as any);
  // 视既有 list 签名调整传参；断言最终 prisma.procurementRound.findMany 收到的 where
  expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        resultStatus: { in: ['FAILED_REVIEW', 'FILE_REVISION_REQUIRED', 'INVALID_RESPONSE', 'CANCELLED'] },
      }),
    }),
  );
});

it('getStats 带 searchKeyword/resultStatus/abnormalOnly 时聚合在同一 where 上', async () => {
  await service.getStats(undefined, undefined, adminUser, {}, { searchKeyword: '水利', resultStatus: undefined, abnormalOnly: true });
  expect(prisma.procurementRound.count).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
  );
});
```

（断言按实际 mock 落点调整——关键是 **where 形状**，不是返回值。）

- [ ] **Step 2: 跑测试确认红**

Run: `cd apps/api && npx jest src/procurements --silent`
Expected: 新用例 FAIL（abnormalOnly 未实现 / getStats 第 5 参不存在）。

- [ ] **Step 3: 实现**

1) `procurements.service.ts` 顶部（import 之后）：

```typescript
/** 异常四态（hero「异常 N」口径；list/getStats/dashboard 三处共用，2026-11-03 提升为模块级） */
export const ABNORMAL_RESULT_STATES = [
  'FAILED_REVIEW',
  'FILE_REVISION_REQUIRED',
  'INVALID_RESPONSE',
  'CANCELLED',
] as const;
```

list 方法内原 `const ABNORMAL_STATES = [...]`（:442）改为 `const ABNORMAL_STATES = [...ABNORMAL_RESULT_STATES];`；并在 list 的 where 组装处（读 `searchKeyword/resultStatus` 的同段）增加：

```typescript
if (abnormalOnly) {
  where.resultStatus = { in: [...ABNORMAL_RESULT_STATES] };
}
```

（list 签名追加 `abnormalOnly?: boolean`；controller 的 `@Query('abnormalOnly')` 透传，照抄 searchKeyword 的解析写法。）

2) `getStats` 签名追加第 5 参 `filters?: { searchKeyword?: string; resultStatus?: string; abnormalOnly?: boolean } = {}`，在 `where.isRecycled = false;` 之前插入与 list 相同的三段筛选逻辑（searchKeyword 的 OR 查询直接复制 list 内实现）：

```typescript
if (filters.searchKeyword) {
  const kw = filters.searchKeyword;
  where.OR = [
    { projectName: { contains: kw, mode: 'insensitive' } },
    { projectCode: { contains: kw, mode: 'insensitive' } },
  ]; // 以 list 内实际字段为准照抄，保持两处同构
}
if (filters.resultStatus) where.resultStatus = filters.resultStatus;
if (filters.abnormalOnly) where.resultStatus = { in: [...ABNORMAL_RESULT_STATES] };
```

3) controller `@Get('stats')` 增 `@Query('searchKeyword') searchKeyword?: string, @Query('resultStatus') resultStatus?: string, @Query('abnormalOnly') abnormalOnly?: string` 并以 `{ searchKeyword, resultStatus, abnormalOnly: abnormalOnly === 'true' }` 传入。

- [ ] **Step 4: 跑测试确认绿 + 回归**

Run: `cd apps/api && npx jest src/procurements --silent`
Expected: 全绿（含既有用例）。

- [ ] **Step 5: curl 实证**（等待 :4001 现役进程重启后）

```bash
TOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login -H "Content-Type: application/json" -H "X-Portal: web" -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s "http://localhost:4001/api/procurements/stats?abnormalOnly=true" -H "X-Portal: web" -H "X-Web-Token: $TOKEN"
```
Expected: `totalCount === abnormalCount`（异常口径自洽）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/procurements/procurements.service.ts apps/api/src/procurements/procurements.controller.ts apps/api/src/procurements/procurements.service.spec.ts
git commit -m "feat(api): 台账 list/stats 支持 abnormalOnly+searchKeyword/resultStatus 同参聚合——:3011 两步铁律地基"
```

---

### Task 3: 台账页——汇总条同参 + URL 预置筛选 + 异常 chip（P1-2 + 断桥③）

**Files:**
- Modify: `apps/mobile-portal/src/lib/api/procurements.ts:44-50`
- Modify: `apps/mobile-portal/src/app/(main)/ledger/page.tsx:130-175, 270-330`

**Interfaces:**
- Consumes: Task 2 的 `abnormalOnly` 参数。
- Produces: URL 契约 `/ledger?abnormal=1|status=<key>|q=<词>|focusPmi=<id>`（brief jump、风险卡、弹层互跳均用它）；`fetchLedgerStats(filter: {startDate?, endDate?, companyId?, searchKeyword?, resultStatus?, abnormalOnly?})` 新签名。

**Steps:**

- [ ] **Step 1: 扩 `fetchLedgerStats` 签名**（procurements.ts，保持旧调用兼容）

```typescript
export async function fetchLedgerStats(filter: {
  startDate?: string; endDate?: string; companyId?: string;
  searchKeyword?: string; resultStatus?: string; abnormalOnly?: boolean;
} = {}) {
  const query = new URLSearchParams();
  if (filter.startDate) query.set('startDate', filter.startDate);
  if (filter.endDate) query.set('endDate', filter.endDate);
  if (filter.companyId && filter.companyId !== 'all') query.set('companyId', filter.companyId);
  if (filter.searchKeyword) query.set('searchKeyword', filter.searchKeyword);
  if (filter.resultStatus) query.set('resultStatus', filter.resultStatus);
  if (filter.abnormalOnly) query.set('abnormalOnly', 'true');
  return api.get<LedgerSummary>(`/procurements/stats?${query.toString()}`);
}
```

- [ ] **Step 2: 台账页消费同参**

ledger/page.tsx:159-169 的 stats effect 改为与列表同参（searchKeyword、statusFilter、abnormalFilter 全部传入）；列表请求（:130-137）同样带 `abnormalOnly`。汇总条在筛选生效时副注「按当前筛选」：

```tsx
const filtered = Boolean(search || statusFilter || abnormalFilter);
<div className="text-[12px] text-[var(--muted-foreground)]">{filtered ? '汇总口径：按当前筛选' : '汇总口径：全部'}</div>
```

- [ ] **Step 3: URL 预置筛选（useSearchParams 初值 + 一次性消费）**

页面顶部 `export default function LedgerPage()` 内、state 初始化处（沿用 `readSavedFilters` 的惰性初始化位）：

```tsx
const searchParams = useSearchParams();
const [urlConsumed, setUrlConsumed] = useState(false);
useEffect(() => {
  if (urlConsumed) return;
  setUrlConsumed(true);
  const st = searchParams.get('status');
  const q = searchParams.get('q');
  if (st) setStatusFilter(st as ResultStatusKey);
  if (q) setSearch(q);
  if (searchParams.get('abnormal') === '1') setAbnormalFilter(true);
}, [searchParams, urlConsumed]);
```

筛选 chips 区（:270-330）首位插入异常 chip（与状态 chips 同款 `Chip` 组件）：

```tsx
<Chip active={abnormalFilter} onClick={() => setAbnormalFilter((v) => !v)}>异常</Chip>
```

- [ ] **Step 4: focusPmi 直开弹层**——列表加载 effect 完成后：

```tsx
useEffect(() => {
  const pmi = searchParams.get('focusPmi');
  if (!pmu_done && pmi && items.length) { const it = items.find((x) => x.projectManagementId === pmi); if (it) setActiveItem(it); setPmuDone(true); }
}, [items, searchParams]);
```

（`pmuDone` 为本地 state；命名按页面既有风格。）

- [ ] **Step 5: 验证**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`
手动：:3011/ledger?abnormal=1 → 异常 chip 激活且列表只出异常四态；`?q=绿化` → 搜索预填；筛选后汇总条数字随动。

- [ ] **Step 6: Commit**

```bash
git add apps/mobile-portal/src/lib/api/procurements.ts "apps/mobile-portal/src/app/(main)/ledger/page.tsx"
git commit -m "fix(3011): 台账汇总条同参口径+URL 预置筛选(abnormal/status/q/focusPmi)+异常 chip（P1-2/断桥③）"
```

---

### Task 4: 死数字断桥——MetricCard 可点 + 异常/待处理卡下钻 + 风险卡行直达 + 角标公司口径（P1-3）

**Files:**
- Modify: `apps/mobile-portal/src/components/m/metric-card.tsx`
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx:536-545`（汇总指标）、`:1001-1027`（风险卡）
- Modify: `apps/mobile-portal/src/app/(main)/layout.tsx:61-69`（角标）

**Steps:**

- [ ] **Step 1: MetricCard 支持点击**（有 onClick 时整卡变 button，触觉反馈同既有按钮）

```tsx
export function MetricCard({ label, value, sub, tone = "default", delta, onClick }: {
  label: string; value: string; sub?: string;
  tone?: keyof typeof TONE_COLOR;
  delta?: { pct: number; tone: "good" | "bad" | "neutral" };
  onClick?: () => void;
}) {
  const body = (<>
    <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</div>
    <div className="mt-1 flex items-baseline justify-between gap-1.5">
      <div className="text-[21px] font-black leading-none tabular-nums tracking-[-0.02em]" style={{ color: TONE_COLOR[tone] }}>{value}</div>
      {delta ? (<span className={`shrink-0 text-[12px] font-bold tabular-nums ${delta.tone === "good" ? "text-[var(--success)]" : delta.tone === "bad" ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}>
        {delta.pct > 0 ? "↑" : delta.pct < 0 ? "↓" : "—"}{Math.abs(delta.pct)}%
      </span>) : null}
    </div>
    {sub ? <div className="mt-1 truncate text-[13px] text-[var(--muted-foreground)]">{sub}</div> : null}
  </>);
  if (!onClick) return <div className="m-tile rounded-[14px] px-3 py-2.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="m-tile rounded-[14px] px-3 py-2.5 text-left active:scale-[0.99]">
      <div className="flex items-center justify-between">
        <div className="flex-1">{body}</div>
        <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
      </div>
    </button>
  );
}
```

（`import { ChevronRight } from "lucide-react";`）

- [ ] **Step 2: dashboard 汇总指标接线**——异常卡 `onClick={() => router.push("/ledger?abnormal=1")}`、待处理卡（若有）`onClick={() => router.push("/ledger?status=PENDING")}`；其余卡不接。同时 brief 三句的 `jump` 值经 URL 契约增强：metric 句落 `/ledger`，focus 句保持 `/dashboard`。

- [ ] **Step 3: 风险预警卡行可点**——行 div（dashboard:1013）改 button，`onClick={() => router.push(`/ledger?q=${encodeURIComponent(p.project)}`)}`，保留原样式类，加 `active:scale-[0.99] w-full text-left`。

- [ ] **Step 4: 角标公司口径**——layout.tsx badges effect 读数据库页同一筛选记忆：

```tsx
import { readSavedFilters } from "@/lib/filter-store";
// effect 内：
const companyIds = (readSavedFilters<{ companyIds: string[] }>("dashboard").companyIds ?? []).join(",");
const load = () => fetchDashboardBadges(companyIds || undefined).then((b) => { if (active) setBadges(b); }).catch(() => undefined);
```

（`fetchDashboardBadges` 已支持 companyId 逗号串——与 dashboard 页 fetchDashboardData 同参；确认 lib/api/dashboard.ts 的 badges 函数签名，若无参则同步补。）

- [ ] **Step 5: 验证**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`
手动：异常卡点击 → 台账异常筛选；风险行点击 → 台账搜索预填；admin 选 1 家公司 → 角标数字变化。

- [ ] **Step 6: Commit**

```bash
git add apps/mobile-portal/src/components/m/metric-card.tsx "apps/mobile-portal/src/app/(main)/dashboard/page.tsx" "apps/mobile-portal/src/app/(main)/layout.tsx" apps/mobile-portal/src/lib/api/dashboard.ts
git commit -m "fix(3011): 头条数字两步可达——MetricCard 可点/风险行直达台账/角标随公司口径（P1-3）"
```

---

### Task 5: P2 精选四小修

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/chat/page.tsx:99-104`（删除确认）
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx:504-510`（日期校验）、`:458-461`（要报文案）、`:246-250`（龙虎榜错误态）
- Modify: `apps/mobile-portal/src/app/(main)/progress/page.tsx:218-224`（下拉不丢洞察）

**Steps:**

- [ ] **Step 1: 删除会话确认**——`deleteHistory` 首行加 `if (!window.confirm("删除该会话？删除后不可恢复。")) return;`

- [ ] **Step 2: 自定义日期校验**——应用按钮 onClick 处：`if (customStart && customEnd && customStart > customEnd) { setCustomError("开始日期不能晚于结束日期"); return; }`（错误文案显示于日期行下方 12px danger 文本；`setCustomError` 新 state）。

- [ ] **Step 3: 要报失败文案**——`今日要报生成中，点击重试` → `今日要报生成失败，点击重试`。

- [ ] **Step 4: 龙虎榜失败不再伪装空态**——ranking effect 的 catch 设 `setRankingError(true)`（新 state）；渲染处 `rankingError` 时显示 `数据加载失败，点击重试`（点击 bump retryTick），与 EmptyState 区分。

- [ ] **Step 5: 进展页下拉不丢 AI 洞察**——下拉回调里保留 `aiResult` 不清（找到 :218-224 中重置洞察的 setAiResult(null)/setAiInsights(null) 删除；AI 洞察仅在口径变化时作废，注释同步修正 :221/:311 两处「自动重取」不实注释）。

- [ ] **Step 6: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`

```bash
git add "apps/mobile-portal/src/app/(main)/chat/page.tsx" "apps/mobile-portal/src/app/(main)/dashboard/page.tsx" "apps/mobile-portal/src/app/(main)/progress/page.tsx"
git commit -m "fix(3011): P2 精选——删除确认/日期校验/要报失败文案/龙虎榜错误态/下拉不丢AI洞察"
```

---

## Phase B · 两步铁律

### Task 6: 今日要报口径对齐页面区间（后端 range 参数，TDD）

**Files:**
- Modify: `apps/api/src/ai/ai.controller.ts:51-56`
- Modify: `apps/api/src/ai/mobile-brief.service.ts:61-66`
- Test: `apps/api/src/ai/mobile-brief.service.spec.ts`

**Interfaces:**
- Produces: `GET /ai/mobile-brief?companyIds=&startDate=&endDate=`——startDate/endDate 缺省仍为本月（向后兼容）；prompt 前缀随区间标签化（「本年数据：」/「近 30 天数据：」/自定义「X 至 Y 数据：」）。

**Steps:**

- [ ] **Step 1: 失败测试**

```typescript
it('传 startDate/endDate 时 prompt 用该区间数据与区间标签，不再固定「本月」', async () => {
  const llm: any = { chatJson: jest.fn().mockResolvedValue({
    focus: { text: 'a' }, metric: { text: 'b' }, reminder: { text: 'c' }, shareText: 'd',
  }) };
  const svc = new MobileBriefService(llm, dashboard, scope as any, progress as any);
  await svc.getBrief({ sub: 'u1', role: 'admin' } as any, undefined, '2026-01-01', '2026-12-31');
  const prompt = (llm.chatJson as jest.Mock).mock.calls[0][1];
  expect(prompt).toContain('本年数据');   // 或按实现取「自定义区间」标签——以实现标签为准调整断言
  expect(prompt).not.toContain('本月数据');
});
```

- [ ] **Step 2: 红** — `cd apps/api && npx jest src/ai/mobile-brief.service.spec.ts`

- [ ] **Step 3: 实现**——`getBrief(user, companyId?, startDate?, endDate?)`：区间缺省回退本月（现逻辑）；区间标签推导：跨度≥330 天→「本年」、当前自然月→「本月」、否则 `startDate~endDate`；`getDashboard(startDate ?? monthStart, endDate, filter)`。controller 加两个 `@Query` 透传。前端 dashboard brief effect 传当前 `queryRange`（`fetchMobileBrief` 增可选参）。

- [ ] **Step 4: 绿 + Commit**

```bash
git add apps/api/src/ai/ai.controller.ts apps/api/src/ai/mobile-brief.service.ts apps/api/src/ai/mobile-brief.service.spec.ts apps/mobile-portal/src/lib/api/ai.ts "apps/mobile-portal/src/app/(main)/dashboard/page.tsx"
git commit -m "feat(3011): 今日要报区间随页面范围——消灭「本月 0 万 vs 本年 749 万」同屏打架"
```

---

### Task 7: 台账↔进展弹层互跳（projectManagementId 桥）

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/ledger/page.tsx:399-461`（详情弹层）
- Modify: `apps/mobile-portal/src/app/(main)/progress/page.tsx:447+`（项目弹层）

**Steps:**

- [ ] **Step 1: 台账弹层加「查看进展」**——底部按钮行（关闭钮旁）：

```tsx
{activeItem.projectManagementId ? (
  <button type="button" onClick={() => router.push(`/progress?focusPmi=${activeItem.projectManagementId}`)}
    className="neu-btn-soft h-9 flex-1 rounded-[10px] px-3 text-[14px] active:scale-95">
    <TrendingUp size={13} /> 查看进展
  </button>
) : null}
```

- [ ] **Step 2: 进展弹层加「查看台账」**——同款按钮 `router.push(`/ledger?focusPmi=${item.id}`)`（进展页项目行持 PMI id；确认字段名后落码）。

- [ ] **Step 3: 进展页读 focusPmi 直开弹层**——同 Task 3 Step 4 模式（列表加载后按 id 匹配 setActive）。

- [ ] **Step 4: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`；手动双向往返跳转。

```bash
git add "apps/mobile-portal/src/app/(main)/ledger/page.tsx" "apps/mobile-portal/src/app/(main)/progress/page.tsx"
git commit -m "feat(3011): 台账↔进展弹层互跳——projectManagementId 桥接两页半张信息"
```

---

## Phase C · 数据四卡

### Task 8: lib/api 四客户端 + 通知铃铛

**Files:**
- Create: `apps/mobile-portal/src/lib/api/notifications.ts`
- Create: `apps/mobile-portal/src/lib/api/cockpit.ts`（alerts/performance/bid-dashboard 三合一，避免碎文件）
- Modify: `apps/mobile-portal/src/app/(main)/layout.tsx`（铃铛）

**Steps:**

- [ ] **Step 1: notifications.ts**（类型即契约，字段以 §接口契约表为准）

```typescript
import { api } from "../api";

export type NotificationItem = {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  isRead: boolean;
  /** body/link 字段以 GET /notifications 实测为准补齐 */
};
export type NotificationListResult = {
  total: number; page: number; pageSize: number;
  items: NotificationItem[];
  unreadCount: number; todoCount: number;
};
export async function fetchUnreadCount(): Promise<number> {
  const r = await api.get<{ count: number }>("/notifications/unread-count");
  return r.count;
}
export async function fetchNotifications(tab: "all" | "todo", page = 1, pageSize = 20): Promise<NotificationListResult> {
  return api.get<NotificationListResult>(`/notifications?tab=${tab}&page=${page}&pageSize=${pageSize}`);
}
```

（执行时先 curl 一次 items 首条补全 NotificationItem 字段——标题/时间/类型以真实返回为准，多余字段删掉。）

- [ ] **Step 2: cockpit.ts**

```typescript
import { api } from "../api";

export type AlertsOverview = { expiringQualifications: number; overloadedExperts: number };
export type PerformanceMetrics = {
  period: { from: string; to: string };
  projectCount: number; contractCount: number;
  avgCycleDays: number | null; savingsRate: number | null;
  competitionAvg: number | null; objectionRate: number | null;
  acceptanceRate: number | null; satisfactionAvg: number | null;
};
export type BidLiveProject = {
  id: string; projectCode: string; name: string;
  procurementMethod: string; stage: string;
  openTime: string | null; deadline: string | null;
  supplierCount: number; supplierSubmitted: number; expertCount: number;
};
export const fetchAlertsOverview = () => api.get<AlertsOverview>("/alerts/overview");
export const fetchPerformanceMetrics = () => api.get<PerformanceMetrics>("/performance/metrics");
export const fetchBidLiveProjects = () => api.get<{ projects: BidLiveProject[] }>("/bid/projects/dashboard");
```

- [ ] **Step 3: 顶栏铃铛**（layout.tsx 登出钮左侧）——`Bell` 图标 neu-btn-soft 同款 + 未读点；点击开 BottomSheet（复用 `components/m/bottom-sheet.tsx`）：待办/全部两 chip + 20 条列表（标题/类型/时间），无已读操作（只读铁律）。unreadCount 拉取并入 badges effect 同轮。

- [ ] **Step 4: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`；手动铃铛角标与列表。

```bash
git add apps/mobile-portal/src/lib/api/notifications.ts apps/mobile-portal/src/lib/api/cockpit.ts "apps/mobile-portal/src/app/(main)/layout.tsx"
git commit -m "feat(3011): 通知铃铛+待办列表——领导手机端首次可见站内通知"
```

---

### Task 9: 资源告警卡 + 质效卡（数据库页）

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx`（风险预警卡下方插告警卡；汇总指标后插质效卡）

**Steps:**

- [ ] **Step 1: 资源告警卡**（SectionCard index 顺延，icon `Radar`）——两行计数行，非零 danger 色：

```tsx
<SectionCard icon={Radar} title="资源告警" index={9}>
  <div className="space-y-2">
    {[
      { label: "供应商资质 90 天内到期", n: alerts?.expiringQualifications ?? 0 },
      { label: "在编专家项目过载", n: alerts?.overloadedExperts ?? 0 },
    ].map((a) => (
      <div key={a.label} className="flex items-center justify-between rounded-[12px] border border-[color-mix(in_oklch,var(--warning)_18%,transparent)] bg-[color-mix(in_oklch,var(--warning)_4%,transparent)] px-3 py-2.5">
        <span className="text-[14px] text-[var(--foreground)]">{a.label}</span>
        <span className={`text-[16px] font-black tabular-nums ${a.n > 0 ? "text-[var(--warning)]" : "text-[var(--muted-foreground)]"}`}>{a.n}</span>
      </div>
    ))}
  </div>
</SectionCard>
```

（alerts state 失败保留旧数据、空态省略——`fetchAlertsOverview` 进 retryTick effect 家族。）

- [ ] **Step 2: 质效卡**（SectionCard icon `Gauge`，紧随汇总指标）——2 列 m-tile 六格：项目数 / 平均周期(天) / 节资率(%) / 竞争度(家/项) / 异议率(%) / 验收率(%)，null 显示 `—`；卡片头副注「近一年」。失败整卡隐藏（静默，不占位）。

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`

```bash
git add "apps/mobile-portal/src/app/(main)/dashboard/page.tsx"
git commit -m "feat(3011): 数据库页新增资源告警卡+项目质效卡（/alerts/overview+/performance/metrics 接入）"
```

---

### Task 10: 开评标进行时卡（进展页顶 + 30s 轮询 + 呼吸点）

**Files:**
- Create: `apps/mobile-portal/src/hooks/use-polling.ts`
- Modify: `apps/mobile-portal/src/app/(main)/progress/page.tsx`（未来 14 天卡之后）

**Steps:**

- [ ] **Step 1: usePolling hook**（页面隐藏暂停、卸载清理、立即首取）

```typescript
"use client";
import { useEffect, useRef } from "react";

/** 轻量轮询（评审裁定不做 WS）：document.hidden 暂停；fn 变化不重置计时 */
export function usePolling(fn: () => Promise<unknown>, intervalMs: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") { try { await ref.current(); } catch { /* 保旧数据 */ } }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick();
    const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [intervalMs]);
}
```

- [ ] **Step 2: 进行时卡**——`fetchBidLiveProjects` 经 usePolling 30s；本地派生：

```tsx
const opening = live?.projects.filter((p) => p.stage === "OPENING") ?? [];
const evaluating = live?.projects.filter((p) => p.stage === "EVALUATING") ?? [];
const submitting = live?.projects.filter((p) => p.stage === "SUBMIT") ?? [];
```

卡头（SectionCard icon `Radio`，title「开评标进行时」）右上呼吸点（仅 opening+evaluating>0）：

```tsx
<span className="relative flex h-2.5 w-2.5">
  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--danger)] opacity-60" />
  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
</span>
```

体：三计数行（截标进行中 N / 开标现场 N / 评标进行 N）+ active 项目名列表（opening+evaluating 各前 3，含 supplierSubmitted/expertCount）。

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`；手动观察 30s 刷新与后台暂停。

```bash
git add apps/mobile-portal/src/hooks/use-polling.ts "apps/mobile-portal/src/app/(main)/progress/page.tsx"
git commit -m "feat(3011): 开评标进行时卡——30s 轮询+呼吸点，驾驶舱首次有「现在时」"
```

---

## Phase D · 科技感（动效 + 实时）

### Task 11: useCountUp + MetricCard 数字滚动

**Files:**
- Create: `apps/mobile-portal/src/hooks/use-count-up.ts`
- Modify: `apps/mobile-portal/src/components/m/metric-card.tsx`

**Steps:**

- [ ] **Step 1: hook**（rAF 600ms ease-out；reduced-motion/非数值直通）

```typescript
"use client";
import { useEffect, useRef, useState } from "react";

/** 数字滚动：仅接受纯数字字符串（"12"/"749.9"）；含单位/文案的原样返回 */
export function useCountUp(raw: string, durationMs = 600): string {
  const [display, setDisplay] = useState(raw);
  const fromRef = useRef(0);
  useEffect(() => {
    const m = raw.match(/^-?\d+(\.\d+)?$/);
    if (!m) { setDisplay(raw); return; }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setDisplay(raw); return; }
    const target = parseFloat(raw);
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay((from + (target - from) * eased).toFixed(decimals));
      if (p < 1) raf = requestAnimationFrame(step); else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [raw, durationMs]);
  return display;
}
```

- [ ] **Step 2: MetricCard 接入**——`const shown = useCountUp(value);` 渲染 `shown`。（带单位/中文的值自动直通，无需调用方改。）

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`；手动：切区间看数字滚动；系统开启「减弱动态效果」后无动画。

```bash
git add apps/mobile-portal/src/hooks/use-count-up.ts apps/mobile-portal/src/components/m/metric-card.tsx
git commit -m "feat(3011): 指标数字滚动 count-up（rAF，尊重减弱动态效果）"
```

---

### Task 12: 图表入场动画（趋势线描画 + 环形图分段展开）

**Files:**
- Modify: `apps/mobile-portal/src/app/globals.css`（两个 keyframes + 工具类）
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx:642-830`（趋势/环形渲染处）

**Steps:**

- [ ] **Step 1: CSS**（globals.css 动画区追加；`@media (prefers-reduced-motion: reduce)` 下禁用）

```css
/* ── 图表入场（2026-11-03）：趋势线描画 / 环形分段展开 ── */
@keyframes m-draw-line { from { stroke-dashoffset: var(--m-path-len, 1200); } to { stroke-dashoffset: 0; } }
@keyframes m-seg-in { from { opacity: 0; transform: rotate(-8deg) scale(0.92); } to { opacity: 1; transform: rotate(0) scale(1); } }
.m-draw-line { stroke-dasharray: var(--m-path-len, 1200); animation: m-draw-line 900ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.m-seg-in { transform-origin: center; animation: m-seg-in 500ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@media (prefers-reduced-motion: reduce) { .m-draw-line, .m-seg-in { animation: none; } }
```

- [ ] **Step 2: 趋势线**——path（linePath）加 `className="m-draw-line"` 与 `style={{ "--m-path-len": 1200 }}`（趋势区长度上界，直接用常量即可）；面积填充 path 不动。环形图各分段 path/圆 加 `className="m-seg-in"` + `style={{ animationDelay: `${i * 60}ms` }}`。

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`；手动入场观感（一次即可，勿循环）。

```bash
git add apps/mobile-portal/src/app/globals.css "apps/mobile-portal/src/app/(main)/dashboard/page.tsx"
git commit -m "feat(3011): 趋势线描画+环形图分段展开入场动画（reduced-motion 直通）"
```

---

### Task 13: 角标/铃铛自动刷新（实时层收尾）

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/layout.tsx`

**Steps:**

- [ ] **Step 1: badges 与 unreadCount 换用 `usePolling(load, 60_000)`**（替换原 visibilitychange effect，hook 已含可见性处理；公司口径沿用 Task 4 的 readSavedFilters）。铃铛计数同轮。

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`

```bash
git add "apps/mobile-portal/src/app/(main)/layout.tsx"
git commit -m "feat(3011): 角标/铃铛 60s 轮询自动刷新（usePolling 统一实时层）"
```

---

## Phase E · 转发类

### Task 14: 风险项目行一键转发

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx:1011-1026`

**Steps:**

- [ ] **Step 1: 行内转发钮**（风险行右上、滞留天数旁，与要报转发同款交互）：

```tsx
async function shareRisk(p: { project: string; pendingDays: number; reason: string }) {
  const text = `【风险提示】${p.project}已滞留 ${p.pendingDays} 天：${p.reason}——来自蜀水云采驾驶舱`;
  if (navigator.share) {
    try { await navigator.share({ title: "蜀水云采·风险项目", text }); return; } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }
  const ok = await copyToClipboard(text);
  setRiskShared(ok ? "ok" : "fail");
  window.setTimeout(() => setRiskShared("idle"), 2000);
}
```

按钮：`<button aria-label="转发" onClick={() => shareRisk(p)} className="neu-btn-soft h-8 w-8 rounded-[10px] p-0 active:scale-95"><Share2 size={13} /></button>`（成功/失败态文案同要报转发：已复制/复制失败）。

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`；手机实测 navigator.share 面板。

```bash
git add "apps/mobile-portal/src/app/(main)/dashboard/page.tsx"
git commit -m "feat(3011): 风险项目行一键转发（share/剪贴板降级）——领导看得见也能推动"
```

---

## 收尾

### Task 15: 全量回归 + 文档

**Steps:**

- [ ] **Step 1: 门户三闸** — `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint && pnpm build`
- [ ] **Step 2: API 回归** — `cd apps/api && npx jest src/procurements src/ai --silent`（全绿）
- [ ] **Step 3: 手动冒烟清单**——登录(按钮底色)→铃铛→要报(区间随页面)→异常卡两步链→风险行转发→台账↔进展互跳→进行时卡呼吸点→reduced-motion 下无动画→375px 无横向滚动。
- [ ] **Step 4: CLAUDE.md :3011 行补一句 2026-11-03 升级摘要（通知/告警/质效/进行时四卡+两步铁律+动效实时层）。**

```bash
git add ../CLAUDE.md  # 即 water-erp/CLAUDE.md——注意仓库根路径
git commit -m "docs(3011): 移动驾驶舱升级摘要入 CLAUDE.md 门户表"
```

---

## Self-Review 记录

- 覆盖对照：修复包（T1-T5）/两步铁律（T3、T4、T6、T7）/数据四卡（T8-T10）/动效（T11-T12）/实时层（T10、T13）/转发（T14）——用户勾选五方向全覆盖；深色模式与语音输入按用户裁定不做。
- 类型一致性：`fetchLedgerStats` 新对象签名在 T2/T3 间一致；`abnormalOnly` 前后端同名；`usePolling` T10 定义 T13 复用；`ABNORMAL_RESULT_STATES` T2 导出仅后端内部使用。
- 已知留白（执行时按实测微调，非占位符）：NotificationItem 字段补全（T8 Step1 注明 curl 步骤）、进展页项目行的 PMI id 字段名（T7 Step2 注明确认动作）。
