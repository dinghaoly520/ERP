# 项目管理开标锁触发时机修正 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** :3005 项目管理详情面板的开标锁从「到达开标确认页即锁」改为「真正启动开标（点按时开标 → BidProject→OPENING）才锁」，与后端四道闸口径对齐。

**Architecture:** 纯前端换源——锁判定从 PMI 阶段行状态（`BID_EVALUATION` IN_PROGRESS/COMPLETED）换成面板已有的 `bpRefs`（每轮 BidProject 实际阶段）；新增纯函数 helper `lib/bid-lock.ts`（结构类型参数，可 node:test 直测）；BidConfirmPanel 三处关闭路径统一回流刷新（`bpDataTick`+`handleUpdated`）。后端零改动。

**Tech Stack:** Next.js 16 App Router + React 19、node:test + tsx（web 侧测试范式：colocated `*.test.ts`、显式 `.ts` 扩展 import）。

**Spec:** `docs/superpowers/specs/2026-11-13-pmi-bid-lock-timing-design.md`（已提交 f78159d12）

## Global Constraints

- 后端（apps/api）零改动；`change.service.ts`/`reopenStage`/`ADDENDUM_BID_STARTED`/`mine` 过滤四道闸不动。
- toast 文案不变（「开标已确认…」等——真正开标后出现，语义仍准确；UI 改动字面最小）。
- helper 参数用结构类型 `ReadonlyArray<{ round?: number | null; stage: string }>`，**不 import api 模块**（node:test 直测、无副作用链）。
- 测试文件 import 用显式 `.ts` 扩展 + `@ts-expect-error` 压行（对齐 `lib/qualification-split.test.ts` 既有范式）。
- 仓库根为 `/Users/qihao/ERP2/ERP`，工作目录 `/Users/qihao/ERP2/ERP/water-erp`；git 命令一律 `git -C /Users/qihao/ERP2/ERP`，只 add 明确改动文件（并行会话约定，禁 `git add -A`）。
- commit 信息中文、`fix(projects):` 前缀，尾部 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

### Task 1: 纯函数 helper `lib/bid-lock.ts` + 单测（TDD）

**Files:**
- Create: `apps/web/src/lib/bid-lock.ts`
- Test: `apps/web/src/lib/bid-lock.test.ts`

**Interfaces:**
- Produces（Task 2 消费）:
  - `roundBidOpened(bpRefs: ReadonlyArray<{ round?: number | null; stage: string }>, round: number): boolean` —— 该轮 bp 已启动开标（OPENING/EVALUATING/ARCHIVED）；ABORTED/未命中/无 bp → false
  - `latestBidOpened(bpRefs: ReadonlyArray<{ round?: number | null; stage: string }>): boolean` —— 最新非 ABORTED bp 同判

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/lib/bid-lock.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { roundBidOpened, latestBidOpened } from "./bid-lock.ts";

const bp = (round: number, stage: string) => ({ round, stage });

test("roundBidOpened：该轮已启动开标（OPENING/EVALUATING/ARCHIVED）→ true", () => {
  for (const stage of ["OPENING", "EVALUATING", "ARCHIVED"]) {
    assert.equal(roundBidOpened([bp(1, stage)], 1), true);
  }
});

test("roundBidOpened：未启动（DOWNLOAD/SUBMIT）→ false——到达开标确认页不锁（修复主径）", () => {
  assert.equal(roundBidOpened([bp(1, "SUBMIT")], 1), false);
  assert.equal(roundBidOpened([bp(1, "DOWNLOAD")], 1), false);
});

test("roundBidOpened：该轮流标（ABORTED）→ false——流标轮穿闸可重开，对齐后端 reopenStage", () => {
  assert.equal(roundBidOpened([bp(1, "ABORTED")], 1), false);
});

test("roundBidOpened：无 bp / round 未命中 → false（未发公告项目不因开标锁）", () => {
  assert.equal(roundBidOpened([], 1), false);
  assert.equal(roundBidOpened([bp(1, "OPENING")], 2), false);
});

test("roundBidOpened：round 归一（null/undefined 视为 1，与组件 (s.round ?? 1) 同式）", () => {
  assert.equal(roundBidOpened([{ round: null, stage: "OPENING" }], 1), true);
});

test("latestBidOpened：多轮取最新非流标轮——最新轮 SUBMIT → false（旧轮状态不代管）", () => {
  assert.equal(latestBidOpened([bp(1, "OPENING"), bp(2, "SUBMIT")]), false);
});

test("latestBidOpened：最新非流标轮 OPENING → true；全流标/空 → false", () => {
  assert.equal(latestBidOpened([bp(1, "ABORTED"), bp(2, "OPENING")]), true);
  assert.equal(latestBidOpened([bp(1, "ABORTED")]), false);
  assert.equal(latestBidOpened([]), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && npx tsx --test src/lib/bid-lock.test.ts
```

Expected: FAIL（`Cannot find module './bid-lock.ts'` 或等价的模块不存在错误）。

- [ ] **Step 3: 最小实现**

创建 `apps/web/src/lib/bid-lock.ts`：

```ts
/** 开标锁触发时机判定（spec 2026-11-13）：只有真正启动开标（开标确认面板点「按时开标」→
 *  BidProject→OPENING）才落锁——到达开标确认页（阶段行 IN_PROGRESS）或延时开标（仅改
 *  openTime）不锁。口径对齐后端四道闸（reopenStage / change.service / ADDENDUM_BID_STARTED /
 *  mine 过滤，全部锚定 BidProject 实际阶段）。参数用结构类型：不 import api 模块，
 *  node:test 直测无副作用链；round null/undefined 归一为 1（与组件 (s.round ?? 1) 同式）。 */

const OPENED_STAGES = ['OPENING', 'EVALUATING', 'ARCHIVED'] as const;

type BpLike = { round?: number | null; stage: string };

/** 该轮 bp 是否已启动开标——对齐后端 reopenStage 开标锁（同轮 bp；ABORTED=流标不锁，穿闸可重开） */
export function roundBidOpened(bpRefs: ReadonlyArray<BpLike>, round: number): boolean {
  const bp = bpRefs.find((r) => (r.round ?? 1) === round);
  return !!bp && (OPENED_STAGES as readonly string[]).includes(bp.stage);
}

/** 最新非流标 bp 是否已启动开标——对齐后端 change.service bidOpened（变更弹窗/基本信息闸口径） */
export function latestBidOpened(bpRefs: ReadonlyArray<BpLike>): boolean {
  const latest = bpRefs
    .filter((r) => r.stage !== 'ABORTED')
    .reduce<BpLike | null>((acc, r) => (!acc || (r.round ?? 1) > (acc.round ?? 1) ? r : acc), null);
  return !!latest && (OPENED_STAGES as readonly string[]).includes(latest.stage);
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && npx tsx --test src/lib/bid-lock.test.ts
```

Expected: PASS（7 tests）。

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/web/src/lib/bid-lock.ts water-erp/apps/web/src/lib/bid-lock.test.ts
git -C /Users/qihao/ERP2/ERP commit -m "feat(projects): 开标锁判定纯函数 roundBidOpened/latestBidOpened——判据=该轮 BidProject 实际阶段（OPENING+），流标轮穿闸、无 bp 不锁

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: project-detail-panel.tsx 换源 + 关闭回流刷新

**Files:**
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`
  - imports（:45 附近）
  - 锁判定块（:476-498）
  - bp 系 useState 块（:524-530，上移）
  - `stageLocked` 消费区不变；`closeBidConfirm` 新增（512 行 canArchive 之后）
  - BidConfirmPanel 三处关闭（onClose :2635 / onAbort :2654 / onPublishNotice :2659）
  - :1373 陈旧注释修正

**Interfaces:**
- Consumes: Task 1 的 `roundBidOpened(bpRefs, round)` / `latestBidOpened(bpRefs)`
- Consumes（面板既有）: `bpRefs` state（`PmBidProjectRefItem[]`，:527——结构兼容 `BpLike`）、`setBpDataTick`、`handleUpdated`（:294）、`setBidConfirmOpen`

- [ ] **Step 1: 加 import**

在 `import { bindChangeAnnouncement, registerChange } from '@/lib/api/project-changes';`（:42）之后新增一行：

```ts
import { roundBidOpened, latestBidOpened } from '@/lib/bid-lock';
```

- [ ] **Step 2: 上移 bp 系 useState 块**

删除 :524-530 现块：

```ts
  // ── 评分标准卡（2026-09-24 方案 v2：自开标确认面板迁至 03「采购文件」）──
  // 只读解析（fetchPmBidProjectRefs 只查不建）+ 逐 BP 详情/评分项，驱动卡片与 03 徽标。
  // 状态用于完成前预检与弹层；权威判定在服务端闸门（SCORE_STANDARD_REQUIRED）。
  const [bpRefs, setBpRefs] = useState<Awaited<ReturnType<typeof fetchPmBidProjectRefs>>>([]);
  const [bpDetails, setBpDetails] = useState<Record<string, BidProjectDetail>>({});
  const [bpScoreItems, setBpScoreItems] = useState<Record<string, BidScoreItem[]>>({});
  const [bpDataTick, setBpDataTick] = useState(0);
```

（`bpDetails`/`bpScoreItems` 两行随块一起移动；其后 :531 起的 `currentRoundBp`/`bidAborted` 派生与 :548 的 useEffect 原地不动。）

在 `isCurrentStage` 行（:474）之后、原锁判定注释块之前插入：

```ts
  // ── BP（各轮 BidProject）只读解析（fetchPmBidProjectRefs 只查不建）──
  // 驱动 03 徽标/评分标准卡/流标提示条（bpDetails/bpScoreItems 逐 BP 拉取），以及下方
  // 开标锁判定（2026-11-13 时机修正：判据换源=该轮 bp 实际阶段）。
  // 状态用于完成前预检与弹层；权威判定在服务端闸门（SCORE_STANDARD_REQUIRED）。
  const [bpRefs, setBpRefs] = useState<Awaited<ReturnType<typeof fetchPmBidProjectRefs>>>([]);
  const [bpDetails, setBpDetails] = useState<Record<string, BidProjectDetail>>({});
  const [bpScoreItems, setBpScoreItems] = useState<Record<string, BidScoreItem[]>>({});
  const [bpDataTick, setBpDataTick] = useState(0);
```

- [ ] **Step 3: 替换锁判定块**

将 :476-498 原块（`bidEvalStage` 判式）整体替换为：

```ts
  // ★ 开标锁定（2026-11-13 时机修正，spec docs/superpowers/specs/2026-11-13-pmi-bid-lock-timing-design.md）：
  // 只有真正启动开标（开标确认面板点「按时开标」→ BidProject→OPENING）才落锁——到达开标确认页
  // （阶段行 IN_PROGRESS）或延时开标（仅改 openTime）不锁。判据换源 bpRefs（该轮 BidProject 实际
  // 阶段），与后端四道闸同口径（reopenStage/change.service/ADDENDUM_BID_STARTED/mine 过滤）；
  // 流标轮（ABORTED）不锁——后端重开闸穿闸，此前按阶段行状态误锁。仍只锁「开标评标」之前的
  // 前置阶段（定标/合同后置不受锁，线下定标→扫描回填可达）。
  const isBidLocked = latestBidOpened(bpRefs);

  const isLockedByBid = (stageKey: string, round?: number) => {
    // 2026-11-05：按被判条目自身轮次定位（时间轴逐卡判定时旧轮条目此前误读当前选中轮）——
    // 锁定与否看该轮自己的开标状态（bp 实际阶段），与该轮阶段序比较
    const targetRound = round ?? selectedRound;
    if (!roundBidOpened(bpRefs, targetRound)) return false;
    const targetBidEval = localItem.stages.find(
      (s) => s.stageKey === 'BID_EVALUATION' && (s.round ?? 1) === targetRound,
    );
    // 该轮无「开标评标」阶段行（方式链差异）→ 不锁——对齐后端 reopenStage 的 if (bidEval && …) 口径
    if (!targetBidEval) return false;
    const stageOrder = localItem.stages.find(
      (s) => s.stageKey === stageKey && (s.round ?? 1) === targetRound,
    )?.stageOrder ?? Infinity;
    return stageOrder < targetBidEval.stageOrder;
  };
```

- [ ] **Step 4: 新增 closeBidConfirm 并接三处关闭路径**

在 `const canArchive = ...`（原 :512）之后新增：

```ts
  /** 开标确认面板统一关闭（2026-11-13 时机修正）：面板内任何变更（按时/延时开标·流标·归档）
   *  关闭时回流——bpRefs 重拉驱动锁态翻转；handleUpdated 重拉列表与 PMI 字段（延时后开标时间同步值）。
   *  面板是模态覆盖层，打开期间父层不可交互，关闭即刷新足够即时。 */
  const closeBidConfirm = useCallback(() => {
    setBidConfirmOpen(false);
    setBpDataTick((t) => t + 1);
    handleUpdated().catch(() => {});
  }, [handleUpdated]);
```

三处关闭路径改造（:2633-2663 一带）：

```ts
      <BidConfirmPanel
        isOpen={bidConfirmOpen}
        onClose={closeBidConfirm}
```

```ts
        onAbort={() => {
          closeBidConfirm();
          setAnnouncementCategory('failed_bid');
          setAnnouncementPublishOpen(true);
        }}
        onPublishNotice={() => {
          closeBidConfirm();
          setAnnouncementCategory('failed_bid');
          setAnnouncementPublishOpen(true);
        }}
```

（onAbort/onPublishNotice 原首行 `setBidConfirmOpen(false)` 换成 `closeBidConfirm()`，其余行不动。）

- [ ] **Step 5: 修正 :1373 陈旧注释**

原文（时间轴前置阶段入口守卫处）：

```ts
                //（阶段推进后 status=IN_PROGRESS 即 isBidLocked=true，旧守卫把面板唯一入口拦死）
```

替换为：

```ts
                //（isLockedByBid 只按 stageOrder 锁前置——BID_EVALUATION 自身不小于自身序，天然可达）
```

- [ ] **Step 6: 全量验证**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web
npx tsc --noEmit          # 基线 exit=0，改后须同为 0
pnpm test                 # 含 bid-lock.test.ts 与既有 *.test.ts 全绿
pnpm lint                 # eslint 通过
```

Expected: 三项全过（tsc 基线已在计划期验证 exit=0）。

- [ ] **Step 7: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/web/src/components/projects/project-detail-panel.tsx
git -C /Users/qihao/ERP2/ERP commit -m "fix(projects): 开标锁触发时机修正——到达开标确认页不再落锁，点「按时开标」（BidProject→OPENING）后才锁；延时开标不锁；流标轮穿闸不再误锁（前端对齐后端四道闸口径，2026-11-13 用户裁定）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 手动验收（可选，dev 环境点击径）

无代码改动；供用户或执行者用运行中的 dev 环境核对（spec §6 主径）：

- [ ] 项目推进到开标确认页、bp 仍 SUBMIT/DOWNLOAD：前置步骤可重开、附件可传、基本信息/变更弹窗标前区可编辑（修复主径）。
- [ ] 开标确认面板点「按时开标」→ 关闭面板：前置步骤/附件/基本信息/变更标前区锁、标后区解锁。
- [ ] 点「延时开标」→ 关闭面板：不锁；hero 时间轴开标时间已回流为新值。
