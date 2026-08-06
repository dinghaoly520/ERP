# :3007 评标管理 AI 进度卡片（含补救操作）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 :3007 评标管理 tab 顶部新增一行「AI 辅助评标」进度卡片，展示后台 AI 分析进度与异常，并支持就地补救（重试失败/卡住项、全量重新分析）。

**Architecture:** 后端在现有 `bid` 模块新增两个端点——`GET /bid/projects/:id/ai-analysis-progress`（聚合 `AiBidAnalysisTask` + `AiBidderResult` 并在后端判定异常）与 `POST /bid/projects/:id/retry-ai-bidders`（重置目标 bidder 并重入队 BullMQ，worker 无需改动）；全量重跑复用现有 `rerun-ai-analysis`（补角色守卫）。前端新组件 3 秒轮询进度端点（worker 独立进程无 WebSocket），异常时显示操作按钮。

**Tech Stack:** NestJS 11 + Prisma + BullMQ（后端）；Next.js 16 + React 19 + Tailwind v4（前端 :3007）；jest（测试）。

**Spec:** `docs/superpowers/specs/2026-08-06-bid-portal-ai-progress-card-design.md`

## Global Constraints

- **不改阶段流转**：本任务所有写操作（retry/rerun）都发生在 EVALUATING 阶段内，不触碰 stage 状态机；「启动评标迁移至 :3007」是后续独立任务，本次不做。
- **不修 :3005 断链**：不给 `ai-bid-analysis` 补 controller，不动 `/bid-analysis` 页面。
- **不改 worker**：`bidder.processor` / `tender.processor` 一行不动；重试依赖其既有幂等收尾逻辑（`checkTaskCompletion` 全部终态后重新生成报告）。
- **操作日志**：3s 轮询端点必须加入 `operation-log.filter.ts` 排除列表（GET-only），否则 OperationLog 膨胀。
- **视觉规范**：cgzxui——`neu-card-static`、oklch 色板、tabular-nums 数字、10px 大写小标题；禁止渐变按钮/emoji 图标。
- **测试约定**：jest + pnpm；`pnpm --filter api test -- <pattern>` 跑单测；新 ESM-only 依赖若报 `Cannot use import statement` 加进 jest 两份 allowlist（本任务不新增依赖，不应触发）。
- **git**：每个任务结束 commit；**不 push**（用户明确要求只提醒不推送）；commit 前确认分支为 main（多会话共用仓库）。
- 后端常量 `AI_STUCK_THRESHOLD_MS = 30 * 60 * 1000`：非终态停摆超 30 分钟判「卡住」。

---

## File Structure

**后端（apps/api）**

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/bid/bid.service.ts` | 修改 | 新增 `getAiAnalysisProgress()`、`retryAiBidders()` 两个方法 + 注入 `bidderQueue` |
| `src/bid/bid.controller.ts` | 修改 | 新增 GET progress / POST retry 两端点；rerun-ai-analysis 补 @Roles |
| `src/bid/bid.module.ts` | 修改 | BullModule 增注册 `BIDDER_PROCESSING` 队列 |
| `src/bid/dto/retry-ai-bidders.dto.ts` | 新建 | retry 请求体校验 |
| `src/operation-log/operation-log.filter.ts` | 修改 | 排除列表加 progress 端点（GET-only） |
| `src/bid/bid.service.spec.ts` | 修改 | 新增两个 describe（progress / retry） |
| `src/operation-log/operation-log.filter.spec.ts` | 修改 | 新增排除规则断言 |

**前端（apps/bid-portal）**

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/lib/api/bid.ts` | 修改 | 新增 3 个 API 函数 + 类型 |
| `src/components/workspace/ai-analysis-card.tsx` | 新建 | AI 进度卡片组件（轮询 + 状态渲染 + 补救操作 + 确认对话框） |
| `src/components/workspace/evaluation-view.tsx` | 修改 | 四卡 grid 之前渲染 `<AiAnalysisCard />` |

---

## Task 1: 后端 — 进度聚合服务方法 `getAiAnalysisProgress`（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（类内新增常量与方法；构造函数不动）
- Test: `apps/api/src/bid/bid.service.spec.ts`（文件末尾追加 describe）

**Interfaces:**
- Produces: `BidService.getAiAnalysisProgress(projectId: string, now?: Date): Promise<AiAnalysisProgressResult>`，返回结构（后续 controller 与前端类型以此为准）：

```ts
{
  exists: boolean;
  taskStatus: string | null;        // AiAnalysisTaskStatus
  updatedAt: string | null;
  total: number; completed: number; failed: number;
  bidders: Array<{ id: string; bidSupplierId: string; name: string; status: string; updatedAt: string }>;
  anomaly: {
    hasAnomaly: boolean;
    failedNames: string[];   // status=FAILED 的供应商名
    stuckNames: string[];    // 中间态（非 PENDING/COMPLETED/FAILED）停摆超阈值
    taskFailed: boolean;     // task.status=FAILED
    allPending: boolean;     // task∈{PENDING,TENDER_PROCESSING} 停摆超阈值且全部 bidder=PENDING
  };
}
```

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 文件末尾追加（沿用文件既有的 mock prisma + TestingModule 风格；`now` 参数显式传入保证可复现）：

```ts
/* ── AI 辅助评标进度聚合（getAiAnalysisProgress）── */

describe('BidService — getAiAnalysisProgress', () => {
  let service: BidService;
  let prisma: any;
  const NOW = new Date('2026-08-06T12:00:00Z');
  const fresh = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000);

  const mkTask = (over: any = {}) => ({
    id: 't1', projectId: 'p1', status: 'ANALYZING', updatedAt: fresh(2), completedAt: null,
    bidderResults: [],
    ...over,
  });
  const mkBidder = (over: any = {}) => ({
    id: 'br1', taskId: 't1', bidSupplierId: 'bs1', status: 'SCORING', updatedAt: fresh(2),
    bidSupplier: { supplierName: '甲公司' },
    ...over,
  });

  beforeEach(async () => {
    prisma = { aiBidAnalysisTask: { findUnique: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('无分析任务 → exists=false 且零值无异常', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.exists).toBe(false);
    expect(res.total).toBe(0);
    expect(res.anomaly.hasAnomaly).toBe(false);
  });

  it('正常进行中 → 计数正确且无异常', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ bidderResults: [
      mkBidder({ id: 'br1', status: 'COMPLETED', bidSupplierId: 'bs1', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'SCORING', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' }, updatedAt: fresh(3) }),
      mkBidder({ id: 'br3', status: 'PENDING', bidSupplierId: 'bs3', bidSupplier: { supplierName: '丙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.exists).toBe(true);
    expect(res.total).toBe(3);
    expect(res.completed).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.bidders).toHaveLength(3);
    expect(res.anomaly.hasAnomaly).toBe(false);
  });

  it('存在 FAILED → failedNames 命中', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'COMPLETED_WITH_ERRORS', bidderResults: [
      mkBidder({ id: 'br1', status: 'COMPLETED', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'FAILED', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.failed).toBe(1);
    expect(res.anomaly.hasAnomaly).toBe(true);
    expect(res.anomaly.failedNames).toEqual(['乙公司']);
  });

  it('中间态停摆超 30 分钟 → stuckNames 命中；未超时不算', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ bidderResults: [
      mkBidder({ id: 'br1', status: 'OCR_PROCESSING', updatedAt: fresh(40), bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'EXTRACTING', updatedAt: fresh(5), bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.stuckNames).toEqual(['甲公司']);
    expect(res.anomaly.hasAnomaly).toBe(true);
  });

  it('task PENDING 停摆 + 全部 bidder PENDING → allPending', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'PENDING', updatedAt: fresh(45), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'PENDING', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.allPending).toBe(true);
    expect(res.anomaly.hasAnomaly).toBe(true);
  });

  it('有 bidder 已启动过则不算 allPending', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'TENDER_PROCESSING', updatedAt: fresh(45), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'COMPLETED', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.allPending).toBe(false);
  });

  it('task FAILED → taskFailed', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'FAILED', bidderResults: [] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.taskFailed).toBe(true);
    expect(res.anomaly.hasAnomaly).toBe(true);
  });

  it('全部 COMPLETED → 无异常', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'COMPLETED', completedAt: fresh(1), bidderResults: [
      mkBidder({ id: 'br1', status: 'COMPLETED', bidSupplier: { supplierName: '甲公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.completed).toBe(1);
    expect(res.anomaly.hasAnomaly).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test -- bid.service.spec.ts -t "getAiAnalysisProgress"`
Expected: FAIL（`service.getAiAnalysisProgress is not a function`）

- [ ] **Step 3: 实现**

`bid.service.ts` 顶部 import 区之后（类外）加常量；类内（`rerunAiAnalysis` 方法附近）加方法：

```ts
/** AI 分析「卡住」判定阈值：bidder 处于中间态且 updatedAt 停摆超过该时长（单家 OCR+LLM 约 5-15 分钟，30 分钟留足余量） */
const AI_STUCK_THRESHOLD_MS = 30 * 60 * 1000;
```

```ts
  /**
   * AI 辅助评标进度聚合（:3007 评标管理进度卡片轮询，3s）。
   * 异常判定在后端完成：FAILED / 中间态停摆 / task FAILED / allPending（疑似 worker 未运行）。
   * `now` 可注入以便测试。
   */
  async getAiAnalysisProgress(projectId: string, now: Date = new Date()) {
    const emptyAnomaly = { hasAnomaly: false, failedNames: [] as string[], stuckNames: [] as string[], taskFailed: false, allPending: false };
    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      include: { bidderResults: { include: { bidSupplier: { select: { supplierName: true } } } } },
    });
    if (!task) {
      return { exists: false, taskStatus: null, updatedAt: null, total: 0, completed: 0, failed: 0, bidders: [], anomaly: emptyAnomaly };
    }
    const isStuck = (d: Date | null) => !!d && now.getTime() - new Date(d).getTime() > AI_STUCK_THRESHOLD_MS;
    const TERMINAL = new Set(['COMPLETED', 'FAILED']);
    const failed = task.bidderResults.filter((b) => b.status === 'FAILED');
    const stuck = task.bidderResults.filter((b) => b.status !== 'PENDING' && !TERMINAL.has(b.status) && isStuck(b.updatedAt));
    const taskFailed = task.status === 'FAILED';
    const allPending = !taskFailed
      && (task.status === 'PENDING' || task.status === 'TENDER_PROCESSING')
      && task.bidderResults.length > 0
      && task.bidderResults.every((b) => b.status === 'PENDING')
      && isStuck(task.updatedAt);
    const anomaly = {
      hasAnomaly: failed.length > 0 || stuck.length > 0 || taskFailed || allPending,
      failedNames: failed.map((b) => b.bidSupplier.supplierName),
      stuckNames: stuck.map((b) => b.bidSupplier.supplierName),
      taskFailed,
      allPending,
    };
    return {
      exists: true,
      taskStatus: task.status,
      updatedAt: task.updatedAt?.toISOString() ?? null,
      total: task.bidderResults.length,
      completed: task.bidderResults.filter((b) => b.status === 'COMPLETED').length,
      failed: failed.length,
      bidders: task.bidderResults.map((b) => ({
        id: b.id,
        bidSupplierId: b.bidSupplierId,
        name: b.bidSupplier.supplierName,
        status: b.status,
        updatedAt: b.updatedAt.toISOString(),
      })),
      anomaly,
    };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test -- bid.service.spec.ts -t "getAiAnalysisProgress"`
Expected: 8 个用例 PASS

- [ ] **Step 5: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git branch --show-current   # 确认 main；不是则停下报告
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): AI 评标进度聚合服务 getAiAnalysisProgress（含异常判定）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 后端 — 进度查询端点 + 操作日志排除（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.controller.ts`（`projects/:id/evaluation-results` 附近新增 GET 端点）
- Modify: `apps/api/src/operation-log/operation-log.filter.ts`（排除列表）
- Test: `apps/api/src/operation-log/operation-log.filter.spec.ts`

**Interfaces:**
- Consumes: `BidService.getAiAnalysisProgress(projectId, now?)`（Task 1）
- Produces: `GET /api/bid/projects/:id/ai-analysis-progress` → Task 1 的返回结构原样透传

- [ ] **Step 1: 写 filter 失败测试**

在 `operation-log.filter.spec.ts` 的「高频轮询 GET 排除」用例里追加两行断言，并新增一条方法限定断言（追加到「方法限定：写操作仍被记录」用例内）：

```ts
    // 「高频轮询 GET 排除」用例内追加：
    expect(shouldExclude('GET', '/api/bid/projects/p1/ai-analysis-progress', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    // 「方法限定」用例内追加（该前缀下还有 retry POST，必须保留审计）：
    expect(shouldExclude('POST', '/api/bid/projects/p1/retry-ai-bidders', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    expect(shouldExclude('GET', '/api/bid/projects/p1', DEFAULT_EXCLUDE_PATHS)).toBe(false);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test -- operation-log.filter.spec.ts`
Expected: FAIL（新断言不通过）

- [ ] **Step 3: 实现 filter 规则**

`operation-log.filter.ts` 的 `DEFAULT_EXCLUDE_PATHS` 数组末尾（`{ method: 'GET', path: '/api/ai-bid-analysis/tasks' }` 之后）追加：

```ts
  { method: 'GET', path: /^\/api\/bid\/projects\/[^/]+\/ai-analysis-progress$/ }, // 3s 轮询 AI 评标进度（:3007 卡片）；同前缀写端点（retry/rerun）保留审计
```

- [ ] **Step 4: 新增 controller 端点**

`bid.controller.ts` 中 `listEvaluationResults`（`@Get('projects/:id/evaluation-results')`）之后新增：

```ts
  @Get('projects/:id/ai-analysis-progress')
  @ApiOperation({ summary: 'AI 辅助评标进度聚合（:3007 进度卡片轮询；异常判定在后端）' })
  getAiAnalysisProgress(@Param('id') id: string) { return this.bidService.getAiAnalysisProgress(id); }
```

- [ ] **Step 5: 跑测试确认通过 + API 编译**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test -- operation-log.filter.spec.ts && pnpm --filter api build`
Expected: filter 测试 PASS；nest build（含 TS 编译）无错

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.controller.ts apps/api/src/operation-log/operation-log.filter.ts apps/api/src/operation-log/operation-log.filter.spec.ts
git commit -m "feat(bid): AI 评标进度查询端点 + 轮询排除操作日志

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 后端 — 单家重试服务 `retryAiBidders` + 队列注入（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.module.ts`（BullModule 增注册）
- Modify: `apps/api/src/bid/bid.service.ts`（构造函数注入 bidderQueue + 新方法）
- Test: `apps/api/src/bid/bid.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `AI_STUCK_THRESHOLD_MS` 常量（同文件）
- Produces: `BidService.retryAiBidders(projectId: string, bidderResultIds: string[] | undefined, actorId?: string): Promise<{ retried: Array<{ id: string; name: string }> }>`；不传 ids 时重试全部 FAILED + 卡住家。错误码：`NOT_FOUND` / `PROJECT_NOT_EVALUATING` / `TASK_NOT_FOUND` / `TASK_STATE_NOT_RETRYABLE` / `NO_RETRYABLE_BIDDERS`。

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 文件顶部 import 区追加：

```ts
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
```

文件末尾追加：

```ts
/* ── AI 单家重试（retryAiBidders）── */

describe('BidService — retryAiBidders', () => {
  let service: BidService;
  let prisma: any;
  let bidderQueue: { add: jest.Mock };
  const NOW = Date.now();
  const mkBidder = (over: any = {}) => ({
    id: 'br1', taskId: 't1', bidSupplierId: 'bs1', status: 'FAILED',
    updatedAt: new Date(NOW - 2 * 60_000),
    bidSupplier: { supplierName: '甲公司' },
    ...over,
  });

  beforeEach(async () => {
    bidderQueue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
    prisma = {
      bidProject: { findUnique: jest.fn(async () => ({ stage: 'EVALUATING', name: '测试项目' })) },
      aiBidAnalysisTask: {
        findUnique: jest.fn(async () => ({
          id: 't1', projectId: 'p1', status: 'COMPLETED_WITH_ERRORS', bidderResults: [mkBidder()],
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      aiBidderResult: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: getQueueToken(QUEUE_NAMES.BIDDER_PROCESSING), useValue: bidderQueue },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('阶段非 EVALUATING → 拒绝', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('评标阶段') });
    expect(bidderQueue.add).not.toHaveBeenCalled();
  });

  it('无分析任务 → 拒绝', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('未找到') });
  });

  it('task 状态 COMPLETED（全部成功）→ 拒绝', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'COMPLETED', bidderResults: [mkBidder({ status: 'COMPLETED' })] });
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('不支持') });
  });

  it('无可重试对象（bidder 全正常）→ 拒绝', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'ANALYZING', bidderResults: [mkBidder({ status: 'COMPLETED' }), mkBidder({ id: 'br2', status: 'SCORING', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } })] });
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('无可重试') });
  });

  it('指定 ids → 仅重置并入队该 bidder；task 置回 ANALYZING', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'COMPLETED_WITH_ERRORS', bidderResults: [
      mkBidder({ id: 'br1', status: 'FAILED', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'FAILED', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] });
    const res = await service.retryAiBidders('p1', ['br1'], 'u1');
    expect(res.retried).toEqual([{ id: 'br1', name: '甲公司' }]);
    expect(prisma.aiBidderResult.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['br1'] } }, data: expect.objectContaining({ status: 'PENDING', processedAt: null }) }));
    expect(bidderQueue.add).toHaveBeenCalledTimes(1);
    expect(bidderQueue.add).toHaveBeenCalledWith('process', { bidderResultId: 'br1', taskId: 't1' }, expect.objectContaining({ attempts: 3 }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('不传 ids → 重试全部 FAILED + 卡住家（PENDING 与正常中间态不参与）', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'ANALYZING', bidderResults: [
      mkBidder({ id: 'br1', status: 'FAILED', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'OCR_PROCESSING', updatedAt: new Date(NOW - 40 * 60_000), bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
      mkBidder({ id: 'br3', status: 'SCORING', updatedAt: new Date(NOW - 3 * 60_000), bidSupplierId: 'bs3', bidSupplier: { supplierName: '丙公司' } }),
      mkBidder({ id: 'br4', status: 'PENDING', bidSupplierId: 'bs4', bidSupplier: { supplierName: '丁公司' } }),
    ] });
    const res = await service.retryAiBidders('p1', undefined, 'u1');
    expect(res.retried.map((r: any) => r.id).sort()).toEqual(['br1', 'br2']);
    expect(bidderQueue.add).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test -- bid.service.spec.ts -t "retryAiBidders"`
Expected: FAIL（`service.retryAiBidders is not a function`）

- [ ] **Step 3: 实现——模块注册队列**

`bid.module.ts` 中现有 `BullModule.registerQueue({ name: QUEUE_NAMES.TENDER_PROCESSING })` 改为：

```ts
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TENDER_PROCESSING },
      { name: QUEUE_NAMES.BIDDER_PROCESSING }, // 单家重试 AI 分析（retryAiBidders）
    ),
```

- [ ] **Step 4: 实现——注入 bidderQueue**

`bid.service.ts` 构造函数中 `tenderQueue` 参数之后追加：

```ts
    @Optional()
    @InjectQueue(QUEUE_NAMES.BIDDER_PROCESSING)
    private readonly bidderQueue?: Queue,
```

- [ ] **Step 5: 实现——retryAiBidders 方法**

在 `rerunAiAnalysis` 方法之后追加：

```ts
  /**
   * AI 单家重试：重置 FAILED / 中间态卡住的 bidderResult 并重入队（不清空其它已完成结果）。
   * 不传 bidderResultIds 时重试全部可重试家。worker 无需改动——bidder.processor 按
   * bidderResultId 全流程重跑，收尾 checkTaskCompletion 全部终态后重新生成报告并复位 task 终态。
   */
  async retryAiBidders(projectId: string, bidderResultIds: string[] | undefined, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, name: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段，无法重试 AI 分析', code: 'PROJECT_NOT_EVALUATING' });
    }
    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      include: { bidderResults: { include: { bidSupplier: { select: { supplierName: true } } } } },
    });
    if (!task) throw new BadRequestException({ error: '未找到 AI 分析任务', code: 'TASK_NOT_FOUND' });
    if (task.status !== 'ANALYZING' && task.status !== 'COMPLETED_WITH_ERRORS') {
      throw new ConflictException({ error: `当前任务状态（${task.status}）不支持单家重试`, code: 'TASK_STATE_NOT_RETRYABLE' });
    }
    const nowMs = Date.now();
    const retryable = task.bidderResults.filter((b) =>
      b.status === 'FAILED'
      || (b.status !== 'PENDING' && b.status !== 'COMPLETED' && nowMs - new Date(b.updatedAt).getTime() > AI_STUCK_THRESHOLD_MS),
    );
    const targets = bidderResultIds && bidderResultIds.length > 0
      ? retryable.filter((b) => bidderResultIds.includes(b.id))
      : retryable;
    if (targets.length === 0) {
      throw new BadRequestException({ error: '无可重试的分析项（仅失败或卡住的可重试）', code: 'NO_RETRYABLE_BIDDERS' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aiBidderResult.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: { status: 'PENDING', processedAt: null },
      });
      await tx.aiBidAnalysisTask.update({ where: { id: task.id }, data: { status: 'ANALYZING', completedAt: null } });
    });

    // 入队（jobId 带时间戳防与等待中的旧 job 冲突；worker 未运行时 job 持久 Redis，恢复后自动消费）
    if (this.bidderQueue) {
      for (const t of targets) {
        await this.bidderQueue.add('process', { bidderResultId: t.id, taskId: task.id }, {
          jobId: `bidderResult-retry-${t.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 7 * 24 * 3600 },
          removeOnFail: { age: 30 * 24 * 3600 },
        });
      }
    } else {
      this.logger.warn(`bidderQueue unavailable, retried ${targets.length} bidders not enqueued for project ${projectId}`);
    }

    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: project.name, action: '重试AI辅助分析', result: `${targets.length}家：${targets.map((t) => t.bidSupplier.supplierName).join('、')}`, riskFlag: '无' },
    }).catch(() => {});
    if (actorId) {
      await this.prisma.auditLog.create({
        data: { userId: actorId, action: 'BID_AI_RETRY_BIDDERS', resourceType: `BidProject:${projectId}`, details: { bidderResultIds: targets.map((t) => t.id) } },
      }).catch(() => {});
    }
    return { retried: targets.map((t) => ({ id: t.id, name: t.bidSupplier.supplierName })) };
  }
```

注意：`ConflictException` 已在 bid.service.ts 顶部 import（`assertOpeningDone` 在用）；确认一下，没有则补。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test -- bid.service.spec.ts`
Expected: retryAiBidders 6 用例 PASS，且文件内既有测试无回归

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bid/bid.module.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): AI 单家重试 retryAiBidders（重置+重入队，不动已完成结果）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 后端 — retry 端点 + DTO + rerun 角色守卫补齐

**Files:**
- Create: `apps/api/src/bid/dto/retry-ai-bidders.dto.ts`
- Modify: `apps/api/src/bid/bid.controller.ts`

**Interfaces:**
- Consumes: `BidService.retryAiBidders(projectId, ids, actorId)`（Task 3）
- Produces: `POST /api/bid/projects/:id/retry-ai-bidders`，body `{ bidderResultIds?: string[] }`

- [ ] **Step 1: 新建 DTO**

`apps/api/src/bid/dto/retry-ai-bidders.dto.ts`：

```ts
import { IsArray, IsOptional, IsString } from 'class-validator';

export class RetryAiBiddersDto {
  /** 要重试的 AiBidderResult id 列表；不传 = 重试全部 FAILED + 卡住家 */
  @IsArray() @IsOptional()
  @IsString({ each: true })
  bidderResultIds?: string[];
}
```

- [ ] **Step 2: controller 端点 + rerun 补守卫**

`bid.controller.ts`：

（a）顶部 DTO import 区追加 `RetryAiBiddersDto`；

（b）`rerun-ai-analysis` 端点（当前无任何装饰器在 @Post 与 @ApiOperation 之间）补角色守卫：

```ts
  @Post('projects/:id/rerun-ai-analysis')
  @Roles('admin', 'bid_host', 'leader', 'staff')
```

（c）其后新增 retry 端点：

```ts
  @Post('projects/:id/retry-ai-bidders')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: 'AI 单家重试（重置 FAILED/卡住的 bidderResult 并重入队）' })
  retryAiBidders(@Param('id') id: string, @Body() dto: RetryAiBiddersDto, @CurrentUser('sub') userId: string) {
    return this.bidService.retryAiBidders(id, dto.bidderResultIds, userId);
  }
```

确认 `@Roles` / `@CurrentUser` / `@Body` 已在文件顶部 import（现有端点在用，应该都有）。

- [ ] **Step 3: 编译 + 全量单测回归**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api build && pnpm --filter api test -- bid.service.spec.ts operation-log.filter.spec.ts`
Expected: build 成功；测试 PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bid/dto/retry-ai-bidders.dto.ts apps/api/src/bid/bid.controller.ts
git commit -m "feat(bid): retry-ai-bidders 端点；rerun-ai-analysis 补角色守卫

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 前端 — API 封装（lib/api/bid.ts）

**Files:**
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（「工作区·评标管理」区块后追加）

**Interfaces:**
- Consumes: 后端 Task 1/Task 4 的响应结构
- Produces: `getAiAnalysisProgress(projectId)` / `retryAiBidders(projectId, ids?)` / `rerunAiAnalysis(projectId)` 及类型 `AiAnalysisProgress`、`AiBidderProgressRow`（Task 6 组件消费）

- [ ] **Step 1: 追加类型与函数**

在 `listEvaluationResults` 之后、「多轮报价」区块之前追加：

```ts
/* ── 工作区·AI 辅助评标进度与补救（评标管理 tab 顶部卡片）── */

export interface AiBidderProgressRow {
  id: string;             // AiBidderResult id
  bidSupplierId: string;
  name: string;           // 供应商名
  status: string;         // AiBidderStatus
  updatedAt: string;
}

export interface AiAnalysisProgress {
  exists: boolean;
  taskStatus: string | null;
  updatedAt: string | null;
  total: number;
  completed: number;
  failed: number;
  bidders: AiBidderProgressRow[];
  anomaly: {
    hasAnomaly: boolean;
    failedNames: string[];
    stuckNames: string[];
    taskFailed: boolean;
    allPending: boolean;
  };
}

export function getAiAnalysisProgress(projectId: string) {
  return api.get<AiAnalysisProgress>(`/bid/projects/${projectId}/ai-analysis-progress`);
}

export function retryAiBidders(projectId: string, bidderResultIds?: string[]) {
  return api.post<{ retried: Array<{ id: string; name: string }> }>(`/bid/projects/${projectId}/retry-ai-bidders`, { bidderResultIds });
}

export function rerunAiAnalysis(projectId: string) {
  return api.post(`/bid/projects/${projectId}/rerun-ai-analysis`, {});
}
```

- [ ] **Step 2: 类型检查**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/bid-portal && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git add apps/bid-portal/src/lib/api/bid.ts
git commit -m "feat(bid-portal): AI 评标进度/补救 API 封装

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 前端 — `ai-analysis-card.tsx` 组件

**Files:**
- Create: `apps/bid-portal/src/components/workspace/ai-analysis-card.tsx`

**Interfaces:**
- Consumes: Task 5 的 `getAiAnalysisProgress` / `retryAiBidders` / `rerunAiAnalysis` / `AiAnalysisProgress`
- Produces: 默认导出组件 `<AiAnalysisCard projectId={string} stage={string} />`（Task 7 在 EvaluationView 渲染）

- [ ] **Step 1: 写组件**

```tsx
'use client';

/**
 * AI 辅助评标进度卡片——评标管理 tab 顶部独立一行。
 * 3s 轮询 GET /bid/projects/:id/ai-analysis-progress（worker 独立进程无 WS，只能轮询）；
 * task 终态且无异常后停止轮询。异常时显示补救按钮：
 *   - 重试失败项：POST retry-ai-bidders（不传 ids = 全部 FAILED+卡住家）
 *   - 重新分析：POST rerun-ai-analysis（清空全部结果重跑，二次确认）
 * 只读评标管理 tab 的窄例外：写操作不改阶段、不流转（阶段流转仍归 :3005）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, AlertTriangle, RefreshCw, Loader, X, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAiAnalysisProgress, retryAiBidders, rerunAiAnalysis,
  type AiAnalysisProgress,
} from '@/lib/api/bid';

const POLL_MS = 3000;

/* 任务状态中文文案 */
const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: '等待分析启动',
  TENDER_PROCESSING: '招标文件处理中',
  ANALYZING: '逐家分析中',
  COMPLETED: '分析完成',
  COMPLETED_WITH_ERRORS: '分析完成（部分失败）',
  FAILED: '招标文件处理失败',
  CANCELLED: '已取消',
};

function ProgressRing({ pct, size = 40, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, pct / 100);
  const color = pct >= 100 ? 'oklch(0.54 0.16 158)' : 'oklch(0.56 0.153 251)';
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.94 0.004 264)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className="absolute text-[10px] font-extrabold tabular-nums" style={{ color }}>{Math.round(pct)}%</span>
    </div>
  );
}

export default function AiAnalysisCard({ projectId, stage }: { projectId: string; stage: string }) {
  const [progress, setProgress] = useState<AiAnalysisProgress | null>(null);
  const [busy, setBusy] = useState<'retry' | 'rerun' | null>(null);
  const [rerunConfirm, setRerunConfirm] = useState(false);
  const stoppedRef = useRef(false);

  const load = useCallback(async (): Promise<AiAnalysisProgress | null> => {
    try {
      const p = await getAiAnalysisProgress(projectId);
      if (!stoppedRef.current) setProgress(p);
      return p;
    } catch {
      return null; // 轮询静默容错；下次 tick 再试
    }
  }, [projectId]);

  useEffect(() => {
    stoppedRef.current = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const tick = async () => {
      const p = await load();
      if (cancelled) return;
      // 停止条件：task 存在且终态（COMPLETED/COMPLETED_WITH_ERRORS/FAILED/CANCELLED）——终态不再变化
      if (p?.exists && p.taskStatus && !['PENDING', 'TENDER_PROCESSING', 'ANALYZING'].includes(p.taskStatus)) {
        if (timer) { clearInterval(timer); timer = null; }
      }
    };

    void tick();
    timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; stoppedRef.current = true; if (timer) clearInterval(timer); };
  }, [load]);

  const doRetry = async () => {
    setBusy('retry');
    try {
      const res = await retryAiBidders(projectId);
      toast.success(`已重新入队 ${res.retried.length} 家：${res.retried.map((r) => r.name).join('、')}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || '重试失败');
    } finally {
      setBusy(null);
    }
  };

  const doRerun = async () => {
    setRerunConfirm(false);
    setBusy('rerun');
    try {
      await rerunAiAnalysis(projectId);
      toast.success('已清空旧结果并重新入队全量分析');
      await load();
    } catch (e: any) {
      toast.error(e?.message || '重新分析失败');
    } finally {
      setBusy(null);
    }
  };

  /* ── 未启动（无 task）── */
  if (progress && !progress.exists) {
    return (
      <div className="neu-card-static flex items-center gap-3 p-4">
        <Bot size={16} strokeWidth={1.5} className="shrink-0 text-[color:var(--muted-foreground)]" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">AI辅助评标</span>
        <span className="text-[12px] text-[color:var(--muted-foreground)]">
          {stage === 'EVALUATING' ? '评标已启动，等待分析任务创建…' : '启动评标后自动开始 AI 辅助分析'}
        </span>
      </div>
    );
  }

  if (!progress) return null; // 首次加载中不占位（避免跳动）

  const { total, completed, failed, anomaly, taskStatus } = progress;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const inProgress = taskStatus === 'PENDING' || taskStatus === 'TENDER_PROCESSING' || taskStatus === 'ANALYZING';
  const showRetry = anomaly.failedNames.length > 0 || anomaly.stuckNames.length > 0;
  const showRerun = anomaly.taskFailed || anomaly.allPending || showRetry;

  return (
    <div className={`neu-card-static p-4 ${anomaly.hasAnomaly ? 'bg-[oklch(0.97_0.03_83_/_0.35)]' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* 左：环 + 计数 */}
        <div className="flex items-center gap-3">
          {anomaly.taskFailed
            ? <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[oklch(0.97_0.03_22_/_0.6)]"><AlertTriangle size={16} className="text-[var(--danger)]" /></span>
            : <ProgressRing pct={pct} />}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">AI辅助评标</span>
              {inProgress && !anomaly.hasAnomaly && <Loader size={11} className="animate-spin text-[oklch(0.56_0.153_251)]" />}
            </div>
            <div className="text-[1.15rem] font-black leading-tight tracking-[-0.04em] tabular-nums text-[color:var(--foreground)]">
              <span className={failed > 0 ? 'text-[var(--danger)]' : 'text-[oklch(0.54_0.16_158)]'}>{completed}</span>
              <span className="text-[color:var(--muted-foreground)]">/{total} 家</span>
            </div>
          </div>
        </div>

        {/* 中：状态文案 */}
        <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
          {anomaly.taskFailed ? (
            <span className="font-semibold text-[var(--danger)]">招标文件处理失败——需重新分析</span>
          ) : anomaly.allPending ? (
            <span className="font-semibold text-[oklch(0.64_0.16_82)]">分析未启动——请确认 AI 分析 worker 进程已运行；worker 恢复后队列将自动消费</span>
          ) : anomaly.failedNames.length > 0 ? (
            <span><span className="font-semibold text-[var(--danger)]">{failed} 家分析失败：</span>{anomaly.failedNames.join('、')}</span>
          ) : anomaly.stuckNames.length > 0 ? (
            <span><span className="font-semibold text-[oklch(0.64_0.16_82)]">疑似卡住：</span>{anomaly.stuckNames.join('、')}（超 30 分钟无进展）</span>
          ) : (
            <span>{TASK_STATUS_LABEL[taskStatus ?? ''] ?? taskStatus}</span>
          )}
        </div>

        {/* 右：操作按钮（仅异常时出现） */}
        {showRerun && (
          <div className="flex shrink-0 items-center gap-2">
            {showRetry && (
              <button onClick={doRetry} disabled={busy !== null}
                className="neu-btn-xs inline-flex items-center gap-1.5 text-[11px] font-semibold text-[oklch(0.56_0.153_251)] disabled:opacity-50">
                {busy === 'retry' ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                重试失败项
              </button>
            )}
            <button onClick={() => setRerunConfirm(true)} disabled={busy !== null}
              className="neu-btn-xs inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--danger)] disabled:opacity-50">
              <RefreshCw size={11} />
              重新分析
            </button>
          </div>
        )}
      </div>

      {/* 重新分析二次确认 */}
      {rerunConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setRerunConfirm(false)} />
          <div className="bid-dialog relative mx-4 w-full max-w-[min(440px,92vw)]" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
              <h3 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight text-[color:var(--foreground)]">
                <ShieldAlert size={16} className="text-[var(--danger)]" />
                确认重新分析
              </h3>
              <button type="button" onClick={() => setRerunConfirm(false)} className="neu-btn-xs" aria-label="关闭"><X size={15} /></button>
            </div>
            <hr className="wb-section-rule mx-6" />
            <div className="space-y-4 px-6 py-5">
              <div className="flex items-start gap-2.5 rounded-xl bg-[oklch(0.78_0.12_83_/_0.16)] p-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[oklch(0.46_0.11_65)]" />
                <div className="space-y-1 text-[12px] leading-relaxed tracking-tight text-[oklch(0.46_0.11_65)]">
                  <p className="font-bold">将清空全部已完成的 AI 分析结果并重新分析所有供应商</p>
                  <p>已生成的评分、一致性与报告数据将被删除，分析需重新 OCR 全部标书，耗时较长。</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setRerunConfirm(false)} className="neu-btn-xs text-[12px]">取消</button>
                <button onClick={doRerun} className="neu-btn-xs bg-[var(--danger)] text-[12px] font-semibold text-white">确认重新分析</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

注意：`neu-btn-xs` / `neu-card-static` / `bid-dialog` / `wb-section-rule` 均为 bid-portal 既有 cgzxui 工具类（`decrypt-confirm-dialog.tsx` 同款）。实现前用 `grep -rn "neu-btn-xs" src/app/globals.css` 确认类名存在；若按钮样式类实际叫别的（如 `neu-btn`），替换为真实类名——以 globals.css 定义为准，不新造 CSS。

- [ ] **Step 2: 类型检查**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/bid-portal && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git add apps/bid-portal/src/components/workspace/ai-analysis-card.tsx
git commit -m "feat(bid-portal): AI 辅助评标进度卡片组件（轮询+异常补救）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 前端 — EvaluationView 集成 + 全量验证

**Files:**
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`（import + 四卡 grid 之前插入一行）

**Interfaces:**
- Consumes: Task 6 的 `<AiAnalysisCard projectId stage />`

- [ ] **Step 1: 集成**

`evaluation-view.tsx`：

（a）import 区（`listEvaluationResults` 行之后）：

```ts
import AiAnalysisCard from './ai-analysis-card';
```

（b）`return` 内 `{/* ═══ Progress dashboard ═══ */}` 注释之后、`{dashMetrics && (` 之前插入：

```tsx
      {/* ═══ AI 辅助评标进度（只读 tab 的窄例外：补救操作不改阶段）═══ */}
      <AiAnalysisCard projectId={projectId} stage={project.stage} />
```

- [ ] **Step 2: 全量验证**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter api test -- bid.service.spec.ts operation-log.filter.spec.ts   # 后端回归
pnpm --filter api lint                                                        # 后端 lint
cd apps/bid-portal && npx tsc --noEmit && cd ../..                            # 前端类型
pnpm --filter bid-portal lint                                                 # 前端 lint（包名以 package.json name 为准）
```

Expected: 全部通过

- [ ] **Step 3: 手动验收（浏览器）**

前提：infra（postgres/redis）与 API 已运行；`pnpm dev:bid` 启动 :3007。
以 `陈源远`（bid_host，口令 `陈源远@2026`）从信息门户登录进入 :3007，打开
`http://localhost:3007/bid/project/cmqhero-bid-proj01?tab=evaluate`，核对：
1. 卡片出现在四个 KPI 卡之上（独立一行）；
2. 项目若无 AI task → 显示「启动评标后自动开始…」灰条；有 task → 显示环 + N/M 家 + 状态文案；
3. 网络面板确认 3s 轮询 `/api/bid/projects/cmqhero-bid-proj01/ai-analysis-progress`，终态后停止；
4. （可构造异常）用 prisma studio 把某 `AiBidderResult.status` 改为 `FAILED`，等 ≤3s 卡片显示失败家名与「重试失败项」按钮；点击后 toast 成功、该 bidder 回 PENDING（studio 验证）、BullMQ 有 retry job；
5. 「重新分析」按钮出现时，点击弹出二次确认，确认后全部 bidderResult 重置 PENDING。

- [ ] **Step 4: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git add apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "feat(bid-portal): 评标管理 tab 集成 AI 进度卡片

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 汇报**

向用户汇报：各任务 commit 清单、手动验收结果、提醒「有 N 个未推送 commit」（**不 push**）。
若手动验收发现 worker 未运行导致 allPending，按卡片文案提示用户启动
`pnpm --filter api dev:worker:ai-bid-analysis`。
