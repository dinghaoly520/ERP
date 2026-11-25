# 项目管理慢接口「处理中 + 自动重取」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目管理下会同步跑 OCR 或大模型的 16 条路由，HTTP 请求不再被慢计算拖到超时：限时等不到就转后台并立即返回，前端凭单号自动重取；附件上传落盘即返回成功。

**Architecture:** 后端新增进程内任务登记表 `PmiPendingJobService`（限时等待 → 转后台 → 长轮询重取）。`@PmiPending(label)` 装饰器把 14 条结果型路由的处理函数整个转后台。上传拆成「同步落盘」与「后台提取」两段，由 `PmiStageUploadService` 串起并按项目串行。转后台任务里的字段写入带任务启动时的基线，不覆盖启动后的改动。操作日志记最终结果。前端在封装层统一识别 `202 { pending, jobId }` 并自动重取，调用方不改。

**Tech Stack:** NestJS 11（拦截器、装饰器、Reflector、@nestjs/testing）、jest（ts-jest）+ supertest；Next.js 16、TypeScript，前端单测为 `node:test`（`tsx --test`）。

**Spec:** `docs/superpowers/specs/2026-11-25-pmi-heavy-endpoints-pending-design.md`

## Global Constraints

- 等待上限：`PM_PENDING_WAIT_MS` 默认 `8000`；总预算 `PM_PENDING_TOTAL_BUDGET_MS` 默认 `13000`（自请求头到达 API 算起）；下限 `PM_PENDING_MIN_WAIT_MS` 默认 `2000`。实际等待 = `min(max(总预算 − 已耗时, 下限), 等待上限)`。
- 重取长轮询 `PM_PENDING_POLL_WAIT_MS` 默认 `10000`；在途任务上限 `PM_PENDING_MAX_RUNNING` 默认 `16`；已结束任务保留 `PM_PENDING_TTL_MS` 默认 `600000`。环境变量非正整数时回落默认并告警一次。
- 响应契约：转后台的首次响应 `202 { pending: true, jobId }`；上传的状态码与今天一致（201）：等待上限内提取完成时 `{ ...附件记录, extractedInfo }`，没完成时 `{ ...附件记录, extractedInfo: null, extractedPending: true, pendingJobId }`，等待期内提取意外失败时 `{ ...附件记录, extractedInfo: null, extractedFailed: true }`；重取端点 `GET /api/project-management/pending-jobs/:jobId` 返回 `{ status: 'running' }` 或 `{ status: 'done', result }`；任务失败时重取端点直接抛出保存的原始异常，由全局异常过滤器格式化。
- 错误码与文案：`PM_SYSTEM_BUSY`（503「系统繁忙，请稍后重试」）、`PM_JOB_NOT_FOUND`（404「处理任务不存在或已结束，请重新发起」）；前端 `PM_PENDING_TIMEOUT`（「处理时间过长，后台仍在执行，请稍后刷新查看结果」）、`PM_JOB_LOST`（「处理被中断，请重试」）。前端总时长上限 `20 * 60_000` 毫秒，两次重取间隔 `1000` 毫秒。
- 字段写入规则（转后台任务）：任务开始执行时拍基线；只写当前值仍等于基线的字段；依赖步（`syncBidProjectOpeningFromPmi`）只在前一步真的写了才做；上传提取每次写入前确认自己的附件仍在。上传采购文件主文件时立即清掉项目的 `tender-text` 文本缓存；提取任务只在自己是该步骤最新的主文件时才回写缓存。
- 提取失败不算上传失败：附件记录建成后，提取无论成败都不影响「上传成功」。上传的提取任务不计入在途任务上限，只持有文件元信息——计入的话一次批量上传就会占满名额，让别人的操作报「系统繁忙」。
- 面向用户的文案不说 OCR、代理、大模型。提交前对改动文件跑 `bash scripts/copy-lint.sh <路径>`（在 `water-erp/` 下）。
- `apps/web/src/proxy.ts` 只补注释，不新增档位。
- 不改 `ProjectManagementService` 的构造函数（12 个按位参数，三个 spec 按位同步）。`ProjectManagementController` 只在末位追加依赖。
- 操作日志：上传照旧在响应时记（状态码随响应，今天是 201）；14 条结果型路由的首次 202 不记，任务结束时记最终状态。
- 命令的工作目录：后端在 `water-erp/apps/api`，前端在 `water-erp/apps/web`（隔离工作区里换成对应路径）。单测与类型检查不经 pnpm：后端用 `./node_modules/.bin/jest <pattern>` 与 `./node_modules/.bin/tsc --noEmit -p tsconfig.json`（必须是该目录自己的 tsc）；前端用 `./node_modules/.bin/tsx --test "<glob>"` 与 `./node_modules/.bin/tsc --noEmit -p tsconfig.json`。
- 提交：只 `git add` 本任务列出的文件，禁 `git add -A` / `.`；不 push；提交前 `git branch --show-current` 与 `git status --short` 确认分支与暂存区。
- 执行环境：仓库多会话共用。开工先 `git status` 并跑一遍后端全量单测记下既有红；对方有未提交改动时在 `.worktrees/pmi-pending` 隔离工作区开发（`git worktree add .worktrees/pmi-pending -b feat/pmi-pending main`，`node_modules` 与 `apps/api/.env` 用符号链接接主工作区，不跑任何安装命令）。合回前 `git rebase main` 并在新基点上重跑全部验证。
- 不在隔离工作区另起 API 实例连实时库（定时任务没有开关）。真实链路验证在合回 main 之后做（见最后一节）。
- 上线必须 api 与 web 门户镜像同批部署：只升 api 时旧前端会把 202 当成正常结果。

## Review Focus

1. 接近上限的大文件上传——请求体转发和落盘先耗掉好几秒，响应仍须在 15 秒内返回。（Task 1、Task 9）
2. 后台任务失败——用户看到的错误与今天同格式（状态码、`code`、文案），操作日志记该错误的状态码而不是 202。（Task 4、Task 5、Task 10）
3. 别人的单号，或已被清理的单号——404，不泄露结果。（Task 3、Task 6）
4. 识别期间附件被删除或被同名文件替换——旧任务不再写库，也不回写文本缓存。（Task 2、Task 7）
5. 服务重启丢了在途任务——前端明确提示「处理被中断，请重试」，不自动重发，不无限重取。（Task 3、Task 10）
6. 一次批量上传二十份扫描件——不能占满在途名额，让同一时间别人的「标记完成」报「系统繁忙」。（Task 3、Task 9）

---

### Task 1: 等待预算与配置（纯函数）

**Files:**
- Create: `water-erp/apps/api/src/project-management/pmi-pending.util.ts`
- Test: `water-erp/apps/api/src/project-management/pmi-pending.util.spec.ts`

**Interfaces:**
- Produces（后续任务按这些名字引用）:
  - `interface PmiPendingConfig { waitMs: number; pollWaitMs: number; maxRunning: number; ttlMs: number; totalBudgetMs: number; minWaitMs: number }`
  - `const PMI_PENDING_DEFAULTS: Readonly<PmiPendingConfig>`
  - `readPmiPendingConfig(env?: NodeJS.ProcessEnv, warn?: (msg: string) => void): PmiPendingConfig`
  - `pendingWaitBudgetMs(arrivedAt: number | undefined, now: number, cfg?: PmiPendingConfig): number`

- [ ] **Step 1: 写失败的测试**

```ts
import { PMI_PENDING_DEFAULTS, pendingWaitBudgetMs, readPmiPendingConfig } from './pmi-pending.util';

describe('readPmiPendingConfig', () => {
  it('环境变量缺省时全取默认', () => {
    expect(readPmiPendingConfig({})).toEqual(PMI_PENDING_DEFAULTS);
  });
  it('合法正整数覆盖默认', () => {
    expect(readPmiPendingConfig({ PM_PENDING_WAIT_MS: '3000', PM_PENDING_MAX_RUNNING: '4' }))
      .toMatchObject({ waitMs: 3000, maxRunning: 4 });
  });
  it('非法值回落默认并各告警一次', () => {
    const warn = jest.fn();
    const cfg = readPmiPendingConfig({ PM_PENDING_WAIT_MS: 'abc', PM_PENDING_TTL_MS: '0' }, warn);
    expect(cfg.waitMs).toBe(8000);
    expect(cfg.ttlMs).toBe(600_000);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('pendingWaitBudgetMs', () => {
  it('没有到达时刻：取等待上限', () => expect(pendingWaitBudgetMs(undefined, 1_000_000)).toBe(8000));
  it('刚到达：取等待上限', () => expect(pendingWaitBudgetMs(1_000_000, 1_000_000)).toBe(8000));
  it('已耗 6 秒：只剩 7 秒', () => expect(pendingWaitBudgetMs(1_000_000, 1_006_000)).toBe(7000));
  it('已超总预算：落到下限', () => expect(pendingWaitBudgetMs(1_000_000, 1_030_000)).toBe(2000));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest pmi-pending.util`
Expected: FAIL，找不到模块 `./pmi-pending.util`。

- [ ] **Step 3: 实现 `pmi-pending.util.ts`**

默认值即 Global Constraints 里的六个数。环境变量名依次为 `PM_PENDING_WAIT_MS`、`PM_PENDING_POLL_WAIT_MS`、`PM_PENDING_MAX_RUNNING`、`PM_PENDING_TTL_MS`、`PM_PENDING_TOTAL_BUDGET_MS`、`PM_PENDING_MIN_WAIT_MS`；用 `Number` 严格解析，非有限正整数回落默认并调一次 `warn`。`pendingWaitBudgetMs` 按 Global Constraints 的公式，先 `max` 后 `min`（这样下限大于上限时以上限为准）。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/jest pmi-pending.util`
Expected: PASS，7 个用例。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/project-management/pmi-pending.util.ts water-erp/apps/api/src/project-management/pmi-pending.util.spec.ts
git commit -m "feat(pmi): 处理中任务的等待预算与配置（等待上限随请求已耗时间收缩）"
```

---

### Task 2: 提取字段的条件写入

**Files:**
- Create: `water-erp/apps/api/src/project-management/extracted-field-writer.ts`
- Test: `water-erp/apps/api/src/project-management/extracted-field-writer.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `const EXTRACTED_FIELD_KEYS = ['initiationDate','expertInfo','biddingUnits','awardedSupplier','contractAmount','contractNumber','projectOverview','bidOpeningTime','paymentPerformance'] as const`
  - `type ExtractedFieldKey`、`type ExtractedFieldValues = Partial<Record<ExtractedFieldKey, unknown>>`
  - `ExtractedFieldWriter.start(prisma: Pick<PrismaService, 'projectManagementItem' | 'attachment'>, projectId: string, opts?: { attachmentId?: string | null }): Promise<ExtractedFieldWriter>`
  - `writer.update(data: ExtractedFieldValues): Promise<ExtractedFieldKey[]>`（返回真正写入的字段键；空数组表示一步都没写）
  - `writer.isAlive(): Promise<boolean>`
  - `sameFieldValue(a: unknown, b: unknown): boolean`

- [ ] **Step 1: 写失败的测试**

```ts
import { ExtractedFieldWriter, sameFieldValue } from './extracted-field-writer';

function makePrisma(row: Record<string, unknown>, attachment: { id: string } | null = { id: 'att-1' }) {
  return {
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) },
    attachment: { findUnique: jest.fn().mockResolvedValue(attachment) },
  };
}

describe('sameFieldValue', () => {
  it('空值互等；日期按时刻比；Decimal 与数字按数值比；字符串不等', () => {
    expect(sameFieldValue(null, undefined)).toBe(true);
    expect(sameFieldValue(new Date('2026-03-18T00:00:00'), new Date('2026-03-18T00:00:00'))).toBe(true);
    expect(sameFieldValue({ toString: () => '100.5' } as never, 100.5)).toBe(true);
    expect(sameFieldValue('A', 'B')).toBe(false);
  });
});

describe('ExtractedFieldWriter', () => {
  it('字段自基线以来未变 → 写入并返回写中的字段键', async () => {
    const prisma = makePrisma({ projectOverview: '旧概况', bidOpeningTime: null });
    const writer = await ExtractedFieldWriter.start(prisma as never, 'pm-1', { attachmentId: 'att-1' });
    expect(await writer.update({ projectOverview: '新概况', bidOpeningTime: '2027-01-01 09:00' }))
      .toEqual(['projectOverview', 'bidOpeningTime']);
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-1' }, data: { projectOverview: '新概况', bidOpeningTime: '2027-01-01 09:00' },
    });
  });

  it('任务开始后被改过的字段不写；同一调用里没改过的照写', async () => {
    const prisma = makePrisma({ projectOverview: '旧概况', bidOpeningTime: null });
    const writer = await ExtractedFieldWriter.start(prisma as never, 'pm-1');
    prisma.projectManagementItem.findUnique.mockResolvedValue({ projectOverview: '人工改过的概况', bidOpeningTime: null });
    expect(await writer.update({ projectOverview: '机器概况', bidOpeningTime: '2027-01-01 09:00' })).toEqual(['bidOpeningTime']);
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-1' }, data: { bidOpeningTime: '2027-01-01 09:00' },
    });
  });

  it('所有字段都被改过 → 不调 update', async () => {
    const prisma = makePrisma({ expertInfo: null });
    const writer = await ExtractedFieldWriter.start(prisma as never, 'pm-1');
    prisma.projectManagementItem.findUnique.mockResolvedValue({ expertInfo: '人工填的' });
    expect(await writer.update({ expertInfo: '机器提取的' })).toEqual([]);
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });

  it('绑定的附件已被删除 → isAlive 为 false，不写任何字段', async () => {
    const prisma = makePrisma({ expertInfo: null }, null);
    const writer = await ExtractedFieldWriter.start(prisma as never, 'pm-1', { attachmentId: 'att-gone' });
    expect(await writer.isAlive()).toBe(false);
    expect(await writer.update({ expertInfo: '张三、李四' })).toEqual([]);
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });

  it('不绑定附件时 isAlive 恒为 true', async () => {
    const writer = await ExtractedFieldWriter.start(makePrisma({}) as never, 'pm-1');
    expect(await writer.isAlive()).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest extracted-field-writer`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 `extracted-field-writer.ts`**

`start` 读一次项目行（只选 `EXTRACTED_FIELD_KEYS`）作基线。`update`：绑定了附件就先查 `attachment.findUnique`，查不到返回 `[]`；再读一次项目行，对 `data` 里每个键用 `sameFieldValue(当前值, 基线值)` 过滤；有剩才调一次 `projectManagementItem.update`，返回写入的键。写前复读后比对（不用原子 `updateMany`）：任务一跑几分钟，复读到写入之间的窗口只有毫秒级。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/jest extracted-field-writer`
Expected: PASS，6 个用例。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/project-management/extracted-field-writer.ts water-erp/apps/api/src/project-management/extracted-field-writer.spec.ts
git commit -m "feat(pmi): 转后台任务的字段条件写入——只写自任务启动以来未改过的字段"
```

---

### Task 3: 进程内任务登记表

**Files:**
- Create: `water-erp/apps/api/src/project-management/pmi-pending-job.service.ts`
- Test: `water-erp/apps/api/src/project-management/pmi-pending-job.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `readPmiPendingConfig`、`pendingWaitBudgetMs`、`PmiPendingConfig`。
- Produces:
  - `type PmiPendingOutcome<T> = { pending: false; result: T } | { pending: true; jobId: string }`
  - `interface PmiPendingSettlement { ok: boolean; status: number; error: unknown; durationMs: number }`
  - `interface PmiPendingRunOptions { arrivedAt?: number; onSettled?: (s: PmiPendingSettlement) => void; exemptFromLimit?: boolean }`
  - `class PmiPendingJobService implements OnModuleDestroy`
    - `run<T>(ownerId: string | undefined, label: string, compute: () => Promise<T>, opts?: PmiPendingRunOptions): Promise<PmiPendingOutcome<T>>`
    - `waitJob<T>(jobId: string, ownerId: string | undefined, maxWaitMs?: number): Promise<{ settled: true; result: T } | { settled: false }>`
    - `get runningCount(): number`（只计没有豁免上限的任务）
    - `onModuleDestroy(): void`

- [ ] **Step 1: 写失败的测试**

```ts
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as pendingUtil from './pmi-pending.util';
import { PmiPendingJobService } from './pmi-pending-job.service';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const KEYS = ['PM_PENDING_WAIT_MS', 'PM_PENDING_MIN_WAIT_MS', 'PM_PENDING_POLL_WAIT_MS', 'PM_PENDING_MAX_RUNNING', 'PM_PENDING_TTL_MS'];
const never = () => new Promise<never>(() => {});

describe('PmiPendingJobService', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PM_PENDING_WAIT_MS = '40';
    process.env.PM_PENDING_MIN_WAIT_MS = '10';
    process.env.PM_PENDING_POLL_WAIT_MS = '40';
    process.env.PM_PENDING_MAX_RUNNING = '2';
    process.env.PM_PENDING_TTL_MS = '60';
  });
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, saved);
    jest.restoreAllMocks();
  });

  it('等待上限内完成 → 原样返回结果', async () => {
    const service = new PmiPendingJobService();
    await expect(service.run('u1', 'fast', async () => ({ ok: 1 }))).resolves.toEqual({ pending: false, result: { ok: 1 } });
  });

  it('等待上限内抛错 → 原样抛出', async () => {
    const service = new PmiPendingJobService();
    await expect(service.run('u1', 'fast', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('超过等待上限 → 转后台返回单号；结束后凭单号取到结果', async () => {
    const service = new PmiPendingJobService();
    let release!: (v: { ok: number }) => void;
    const outcome = await service.run('u1', 'slow', () => new Promise<{ ok: number }>((resolve) => { release = resolve; }));
    expect(outcome.pending).toBe(true);
    if (!outcome.pending) return;
    expect(await service.waitJob(outcome.jobId, 'u1')).toEqual({ settled: false });
    release({ ok: 2 });
    await expect(service.waitJob(outcome.jobId, 'u1')).resolves.toEqual({ settled: true, result: { ok: 2 } });
  });

  it('等待预算取自请求到达时刻', async () => {
    const spy = jest.spyOn(pendingUtil, 'pendingWaitBudgetMs');
    const service = new PmiPendingJobService();
    await service.run('u1', 'fast', async () => 1, { arrivedAt: 123 });
    expect(spy).toHaveBeenCalledWith(123, expect.any(Number), expect.anything());
  });

  it('别人的单号或不存在的单号 → 404 PM_JOB_NOT_FOUND', async () => {
    const service = new PmiPendingJobService();
    const outcome = await service.run('u1', 'slow', never);
    if (!outcome.pending) throw new Error('应转后台');
    await expect(service.waitJob(outcome.jobId, 'u2')).rejects.toMatchObject({ status: 404, response: { code: 'PM_JOB_NOT_FOUND' } });
    await expect(service.waitJob('no-such-job', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('后台任务失败 → 凭单号重取时抛出原错误', async () => {
    const service = new PmiPendingJobService();
    let fail!: (e: Error) => void;
    const outcome = await service.run('u1', 'slow', () => new Promise<never>((_resolve, reject) => { fail = reject; }));
    if (!outcome.pending) throw new Error('应转后台');
    fail(new Error('后台失败'));
    await expect(service.waitJob(outcome.jobId, 'u1')).rejects.toThrow('后台失败');
  });

  it('在途任务达到上限 → 503 PM_SYSTEM_BUSY', async () => {
    const service = new PmiPendingJobService();
    await service.run('u1', 'a', never);
    await service.run('u1', 'b', never);
    await expect(service.run('u1', 'c', never)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('豁免上限的任务不占名额，也不会被拒', async () => {
    const service = new PmiPendingJobService();
    for (const label of ['x1', 'x2', 'x3']) {
      await expect(service.run('u1', label, never, { exemptFromLimit: true })).resolves.toMatchObject({ pending: true });
    }
    await expect(service.run('u1', 'result-1', never)).resolves.toMatchObject({ pending: true });
    await expect(service.run('u1', 'result-2', never)).resolves.toMatchObject({ pending: true });
    await expect(service.run('u1', 'result-3', never)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('已结束任务超过保留时长后被清理', async () => {
    const service = new PmiPendingJobService();
    const outcome = await service.run('u1', 'fast', async () => 1);
    if (outcome.pending) throw new Error('应同步完成');
    await sleep(120);
    await expect(service.waitJob(outcome.jobId, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('onSettled 在任务结束时调用一次，带成败、状态码与耗时', async () => {
    const service = new PmiPendingJobService();
    const onSettled = jest.fn();
    await service.run('u1', 'ok', async () => 1, { onSettled });
    await service.run('u1', 'bad', () => Promise.reject(new Error('x')), { onSettled }).catch(() => undefined);
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled.mock.calls[0][0]).toMatchObject({ ok: true, status: 200 });
    expect(onSettled.mock.calls[1][0]).toMatchObject({ ok: false, status: 500, error: expect.any(Error) });
  });

  it('业务异常按自己的状态码记（400、409）', async () => {
    const service = new PmiPendingJobService();
    const onSettled = jest.fn();
    await service.run('u1', 'biz', () => Promise.reject(new BadRequestException({ error: '缺件', code: 'ARCHIVE_GATE_MISSING' })), { onSettled }).catch(() => undefined);
    expect(onSettled.mock.calls[0][0]).toMatchObject({ ok: false, status: 400 });
  });

  it('进程关闭时对在途任务打 WARN', async () => {
    const service = new PmiPendingJobService();
    await service.run('u1', 'stuck', never);
    const logger = (service as unknown as { logger: { warn: (m: string) => void } }).logger;
    const warn = jest.spyOn(logger, 'warn');
    service.onModuleDestroy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stuck'));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest pmi-pending-job.service`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 `pmi-pending-job.service.ts`**

- `@Injectable()`。构造时读一次配置：`readPmiPendingConfig(process.env, (m) => this.logger.warn(m))`。
- `run`：在途数达到上限抛 `ServiceUnavailableException({ error: '系统繁忙，请稍后重试', code: 'PM_SYSTEM_BUSY' })`。`exemptFromLimit` 为真的任务不计入在途数，也不受这条拒绝。建记录（`randomUUID`、`ownerId`、`label`、`startedAt`、一个在结束时 resolve 的内部 Promise）。`compute` 经 `Promise.resolve().then(compute)` 启动（同步抛错也接住），成败都只落进记录，绝不产生未处理的 rejection。按 `pendingWaitBudgetMs(opts?.arrivedAt, Date.now(), cfg)` 等待：期限内结束就返回结果或抛出原错误；否则返回单号。
- 结束时：调一次 `onSettled`（状态码：成功 200，失败取 `getStatus()`，没有就 500）；起一个 `unref` 的定时器，到 `ttlMs` 删记录。
- `waitJob`：记录不存在或 `ownerId` 不符 → `NotFoundException({ error: '处理任务不存在或已结束，请重新发起', code: 'PM_JOB_NOT_FOUND' })`。未结束则最多等 `maxWaitMs`（默认 `pollWaitMs`），仍未结束返回 `{ settled: false }`；成功返回结果，失败抛原错误。
- `onModuleDestroy`：对每个在途任务打一条 WARN，含 `label` 与已运行毫秒数。
- 所有 `setTimeout` 都 `unref()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/jest pmi-pending-job.service`
Expected: PASS，12 个用例。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/project-management/pmi-pending-job.service.ts water-erp/apps/api/src/project-management/pmi-pending-job.service.spec.ts
git commit -m "feat(pmi): 进程内任务登记表——限时等待、转后台、凭单号长轮询重取"
```

---


### Task 4: 操作日志记最终结果

**Files:**
- Create: `water-erp/apps/api/src/operation-log/deferred-oplog.ts`
- Create: `water-erp/apps/api/src/operation-log/deferred-oplog.spec.ts`
- Modify: `water-erp/apps/api/src/operation-log/operation-log.interceptor.ts`
- Create: `water-erp/apps/api/src/operation-log/operation-log.interceptor.spec.ts`
- Modify: `water-erp/apps/api/src/operation-log/operation-log.filter.ts`（`DEFAULT_EXCLUDE_PATHS`）
- Modify: `water-erp/apps/api/src/operation-log/operation-log.filter.spec.ts`

**Interfaces:**
- Produces（Task 5 使用）:
  - `markOplogDeferred(req: Request): void`
  - `isOplogDeferred(req: Request): boolean`
  - `registerDeferredOplog(req: Request, record: (statusCode: number, error: unknown | null) => void): void`
  - `settleDeferredOplog(req: Request, settlement: { status: number; error: unknown | null }): boolean`（返回是否已当场补记）

- [ ] **Step 1: 写失败的测试**

`deferred-oplog.spec.ts`:

```ts
import type { Request } from 'express';
import { isOplogDeferred, markOplogDeferred, registerDeferredOplog, settleDeferredOplog } from './deferred-oplog';

const req = () => ({}) as Request;

describe('deferred oplog handshake', () => {
  it('未标记转后台：登记与结束都不触发记录', () => {
    const r = req(); const record = jest.fn();
    expect(isOplogDeferred(r)).toBe(false);
    registerDeferredOplog(r, record);
    expect(settleDeferredOplog(r, { status: 200, error: null })).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
  it('先登记记录函数、后结束：结束时补记一次', () => {
    const r = req(); markOplogDeferred(r); const record = jest.fn();
    registerDeferredOplog(r, record);
    expect(settleDeferredOplog(r, { status: 400, error: new Error('x') })).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(400, expect.any(Error));
  });
  it('先结束、后登记：登记时补记一次（任务在外层拦截器响应之前就结束了）', () => {
    const r = req(); markOplogDeferred(r); const record = jest.fn();
    expect(settleDeferredOplog(r, { status: 200, error: null })).toBe(false);
    registerDeferredOplog(r, record);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(200, null);
  });
  it('重复结束或重复登记不重复记录', () => {
    const r = req(); markOplogDeferred(r); const record = jest.fn();
    registerDeferredOplog(r, record);
    settleDeferredOplog(r, { status: 200, error: null });
    settleDeferredOplog(r, { status: 500, error: null });
    registerDeferredOplog(r, record);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
```

`operation-log.interceptor.spec.ts`（直接调用拦截器，手工拼上下文）:

```ts
import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { markOplogDeferred, settleDeferredOplog } from './deferred-oplog';
import { OperationLogInterceptor } from './operation-log.interceptor';

function make() {
  const req = {
    method: 'POST', path: '/api/t', originalUrl: '/api/t', body: {}, headers: {},
    query: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
  } as never;
  const res = { statusCode: 200 };
  const service = { create: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new OperationLogInterceptor(service as never);
  const ctx = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as never;
  return { req, service, interceptor, ctx };
}

describe('OperationLogInterceptor', () => {
  it('普通请求：响应时按状态码记一条', async () => {
    const { service, interceptor, ctx } = make();
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ ok: true }) }));
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create.mock.calls[0][0]).toMatchObject({ statusCode: 200, path: '/api/t' });
  });
  it('转后台的请求：响应时不记，任务结束后按最终状态码记', async () => {
    const { req, service, interceptor, ctx } = make();
    markOplogDeferred(req);
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ pending: true }) }));
    expect(service.create).not.toHaveBeenCalled();
    settleDeferredOplog(req, { status: 400, error: new BadRequestException('缺件') });
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect((req as { __oplogRecorded?: boolean }).__oplogRecorded).toBe(true);
  });
});
```

在 `operation-log.filter.spec.ts` 的 `describe('shouldExclude')` 里追加:

```ts
it('处理中任务重取 GET 排除（2026-11-25：长轮询不入操作日志）', () => {
  expect(shouldExclude('GET', '/api/project-management/pending-jobs/abc', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  expect(shouldExclude('POST', '/api/project-management/pending-jobs/abc', DEFAULT_EXCLUDE_PATHS)).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest "operation-log/(deferred-oplog|operation-log.interceptor|operation-log.filter)"`
Expected: FAIL（两个新模块找不到；filter 的新用例失败）。

- [ ] **Step 3: 实现**

- `deferred-oplog.ts`：状态放 `WeakMap<Request, { deferred: boolean; record?; settlement? }>`，不往请求对象上挂任意属性。两个方向的握手：登记时若已有结局就当场记；结束时若已有记录函数就当场记；每边只记一次。
- `operation-log.interceptor.ts` 的 `tap` 改成：`isOplogDeferred(req)` 为真 → `registerDeferredOplog(req, record)` 后返回；否则照旧 `record(...)`。其余不动。
- `operation-log.filter.ts` 的 `DEFAULT_EXCLUDE_PATHS` 追加 `{ method: 'GET', path: /^\/api\/project-management\/pending-jobs\/[^/]+$/ }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/jest operation-log`
Expected: PASS（含既有用例）。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/operation-log/deferred-oplog.ts water-erp/apps/api/src/operation-log/deferred-oplog.spec.ts water-erp/apps/api/src/operation-log/operation-log.interceptor.ts water-erp/apps/api/src/operation-log/operation-log.interceptor.spec.ts water-erp/apps/api/src/operation-log/operation-log.filter.ts water-erp/apps/api/src/operation-log/operation-log.filter.spec.ts
git commit -m "feat(oplog): 转后台的请求在任务结束时记最终结果；重取轮询不入操作日志"
```

---

### Task 5: `@PmiPending` 装饰器与拦截器，接入 14 条路由

**Files:**
- Create: `water-erp/apps/api/src/project-management/pmi-pending.interceptor.ts`
- Create: `water-erp/apps/api/src/project-management/pmi-pending.interceptor.spec.ts`
- Modify: `water-erp/apps/api/src/project-management/project-management.controller.ts`（14 处加装饰器）
- Modify: `water-erp/apps/api/src/project-management/project-management.module.ts`（`providers` 加 `PmiPendingJobService`）

**Interfaces:**
- Consumes: Task 3 的 `PmiPendingJobService.run`；Task 4 的 `markOplogDeferred`、`settleDeferredOplog`。
- Produces:
  - `const PMI_PENDING_LABEL = 'pmi:pending-label'`
  - `PmiPending(label: string)`：组合 `SetMetadata(PMI_PENDING_LABEL, label)` 与 `UseInterceptors(PmiPendingInterceptor)`
  - `class PmiPendingInterceptor implements NestInterceptor`（`@Injectable()`，构造注入 `Reflector` 与 `PmiPendingJobService`）

**已对着 Nest 11.1.24 源码核实的四个行为**（实现时不必再查，改动前提时要知道）：

- 拦截器里 `res.status(202)` 能生效：默认状态码在拦截器执行**之前**设置（`router-execution-context.js` 的 `create` 里先 `setStatus`），响应时不再带状态码（`createHandleResponseFn` 的调用处只传三个参数，`express-adapter.js:44` 的 `reply` 收到空状态码就不设置）。
- 类拦截器不必写进 `providers`：按类型从所在模块的 `injectables` 取实例（`interceptors-context-creator.js`）。它依赖的 `PmiPendingJobService` 必须在同一个模块里，所以本任务要把它加进 `ProjectManagementModule`。
- `@PmiPending` 写在装饰器栈最上面时排在最后、最内层执行：`extend-metadata.util.js` 把后应用的装饰器追加在数组后面。于是 `FileInterceptor` 在外层，先解析请求体。
- `next.handle()` 可以在拦截器返回之后再订阅：下游链是 `defer` 惰性创建（`interceptors-consumer.js`），订阅时才执行，只执行一次。

- [ ] **Step 1: 写失败的测试**

```ts
import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { OperationLogInterceptor } from '../operation-log/operation-log.interceptor';
import { OperationLogService } from '../operation-log/operation-log.service';
import { PmiPendingJobService } from './pmi-pending-job.service';
import { PMI_PENDING_LABEL, PmiPending } from './pmi-pending.interceptor';
import { ProjectManagementController } from './project-management.controller';

// 路径必须以 /api 开头：操作日志拦截器对非 /api 前缀的请求直接放行，否则下面关于操作日志的断言永远不成立
@Controller('api/t')
class DummyController {
  @PmiPending('slow')
  @Post('slow')
  slow(@Body() body: { ms: number; fail?: boolean }) {
    return new Promise<{ ok: true }>((resolve, reject) => setTimeout(
      () => (body.fail ? reject(new Error('后台失败')) : resolve({ ok: true })), body.ms));
  }

  @Post('plain')
  plain() { return { plain: true }; }
}

@Module({
  controllers: [DummyController],
  providers: [
    PmiPendingJobService,
    { provide: OperationLogService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
    { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor },
  ],
})
class DummyModule {}

const LABELS: Record<string, string> = {
  extractInitiation: 'extract-initiation', extractDemand: 'extract-demand', aiIdentifyField: 'ai-identify-field',
  updateStage: 'update-stage', analyzeProject: 'analyze', analyzeStep: 'analyze-step',
  parseAnnouncementFields: 'parse-announcement-fields', extractTenderFields: 'extract-tender-fields',
  analyzeDirectProcurement: 'analyze-direct-procurement', recommendSuppliersForProject: 'recommend-suppliers',
  checkSupplierChange: 'check-supplier-change', optimizeInitiation: 'optimize-initiation',
  refreshProjectSummary: 'refresh-summary', aiPolishAttachmentSelection: 'attachment-ai-polish',
};

describe('PmiPending over HTTP', () => {
  let app: INestApplication;
  let oplog: { create: jest.Mock };
  const saved = { ...process.env };
  beforeAll(async () => {
    process.env.PM_PENDING_WAIT_MS = '60';
    process.env.PM_PENDING_MIN_WAIT_MS = '10';
    const ref = await Test.createTestingModule({ imports: [DummyModule] }).compile();
    app = ref.createNestApplication();
    oplog = app.get(OperationLogService);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['PM_PENDING_WAIT_MS', 'PM_PENDING_MIN_WAIT_MS']) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('没标装饰器的路由照常', async () => {
    await request(app.getHttpServer()).post('/api/t/plain').send({}).expect(201, { plain: true });
  });

  it('期限内完成：照常 201 与原响应体', async () => {
    await request(app.getHttpServer()).post('/api/t/slow').send({ ms: 5 }).expect(201, { ok: true });
  });

  it('超时转后台：202 带单号；任务结束后操作日志记最终状态', async () => {
    oplog.create.mockClear();
    const res = await request(app.getHttpServer()).post('/api/t/slow').send({ ms: 400 }).expect(202);
    expect(res.body).toEqual({ pending: true, jobId: expect.any(String) });
    expect(oplog.create).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(oplog.create).toHaveBeenCalledTimes(1);
    expect(oplog.create.mock.calls[0][0]).toMatchObject({ statusCode: 200, path: '/api/t/slow' });
  });

  it('后台失败：仍是 202；任务结束后操作日志记 500', async () => {
    oplog.create.mockClear();
    await request(app.getHttpServer()).post('/api/t/slow').send({ ms: 400, fail: true }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(oplog.create).toHaveBeenCalledTimes(1);
    expect(oplog.create.mock.calls[0][0]).toMatchObject({ statusCode: 500 });
  });

  it.each(Object.entries(LABELS))('控制器方法 %s 标了 @PmiPending(%s)', (name, label) => {
    const proto = ProjectManagementController.prototype as unknown as Record<string, unknown>;
    expect(Reflect.getMetadata(PMI_PENDING_LABEL, proto[name])).toBe(label);
  });

  it('附件上传不标 @PmiPending（由上传协调服务处理）', () => {
    expect(Reflect.getMetadata(PMI_PENDING_LABEL, ProjectManagementController.prototype.uploadStageAttachment)).toBeUndefined();
  });
});
```

说明：POST 的默认状态码是 201，同步路径保持 201 不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest pmi-pending.interceptor`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现拦截器与装饰器**

- `intercept`：取不到标签就 `return next.handle()`。否则把整条下游链包进任务，包在 `from(async () => …)` 里返回：
  `this.jobs.run(req.user?.sub, label, () => firstValueFrom(next.handle()), { arrivedAt, onSettled })`。`onSettled` 调 `settleDeferredOplog(req, { status: s.status, error: s.ok ? null : s.error })`。没转后台就原样返回 `outcome.result`；转后台则先 `markOplogDeferred(req)`，再 `res.status(202)`，返回 `{ pending: true, jobId }`。`arrivedAt` 取 `(req as Request & { arrivedAt?: number }).arrivedAt`（Task 9 的中间件会打这个点，现在为 `undefined`，等于取整段等待上限）。
- `project-management.controller.ts`：给 `LABELS` 表里的 14 个方法加 `@PmiPending(<label>)`。装饰器写在各自装饰器栈的最上面（`@UseInterceptors(FileInterceptor(...))` 与 `@Post` 之上）。
- `project-management.module.ts`：`providers` 追加 `PmiPendingJobService`。

- [ ] **Step 4: 跑测试确认通过，并跑相关存量用例**

Run: `./node_modules/.bin/jest "project-management/(pmi-pending|project-management.controller)"`
Expected: PASS（拦截器 19 个用例 + 控制器存量用例）。

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/project-management/pmi-pending.interceptor.ts water-erp/apps/api/src/project-management/pmi-pending.interceptor.spec.ts water-erp/apps/api/src/project-management/project-management.controller.ts water-erp/apps/api/src/project-management/project-management.module.ts
git commit -m "feat(pmi): @PmiPending——14 条结果型路由限时等不到即转后台并回 202"
```

---


### Task 6: 重取端点

**Files:**
- Create: `water-erp/apps/api/src/project-management/pmi-pending-job.controller.ts`
- Create: `water-erp/apps/api/src/project-management/pmi-pending-job.controller.spec.ts`
- Modify: `water-erp/apps/api/src/project-management/project-management.module.ts`（`controllers` 追加）

**Interfaces:**
- Consumes: Task 3 的 `waitJob`。
- Produces: `GET /api/project-management/pending-jobs/:jobId`；`class PmiPendingJobController`，方法 `getPendingJob(jobId: string, user?: AuthenticatedUser)`。

- [ ] **Step 1: 写失败的测试**

```ts
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PmiPendingJobController } from './pmi-pending-job.controller';

describe('PmiPendingJobController', () => {
  it('任务已结束 → { status: "done", result }，且按发起人取', async () => {
    const waitJob = jest.fn().mockResolvedValue({ settled: true, result: { a: 1 } });
    const controller = new PmiPendingJobController({ waitJob } as never);
    await expect(controller.getPendingJob('job-1', { sub: 'u1' } as never)).resolves.toEqual({ status: 'done', result: { a: 1 } });
    expect(waitJob).toHaveBeenCalledWith('job-1', 'u1');
  });
  it('未结束 → { status: "running" }', async () => {
    const controller = new PmiPendingJobController({ waitJob: jest.fn().mockResolvedValue({ settled: false }) } as never);
    await expect(controller.getPendingJob('job-1', { sub: 'u1' } as never)).resolves.toEqual({ status: 'running' });
  });
  it('任务失败 → 原错误原样抛出', async () => {
    const err = new BadRequestException({ error: '业务拒绝', code: 'BIZ_REJECTED' });
    const controller = new PmiPendingJobController({ waitJob: jest.fn().mockRejectedValue(err) } as never);
    await expect(controller.getPendingJob('job-1', { sub: 'u1' } as never)).rejects.toBe(err);
  });
  it('类级角色为 leader / admin / staff', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PmiPendingJobController)).toEqual(['leader', 'admin', 'staff']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest pmi-pending-job.controller`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现控制器**

`@Roles('leader', 'admin', 'staff')` + `@Controller('project-management/pending-jobs')`。构造注入 `PmiPendingJobService`。`@Get(':jobId')` 加 `@SkipThrottle()`（长轮询不占每人每分钟 120 次的全局限流）。参数 `@Param('jobId', new ParseUUIDPipe()) jobId` 与 `@CurrentUser() user?: AuthenticatedUser`。返回 `settled ? { status: 'done', result } : { status: 'running' }`；失败不接，让异常过滤器处理。不挂 `PmiOwnershipGuard`（路由没有 `:id`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/jest pmi-pending-job.controller && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: PASS，4 个用例；tsc 无输出。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/project-management/pmi-pending-job.controller.ts water-erp/apps/api/src/project-management/pmi-pending-job.controller.spec.ts water-erp/apps/api/src/project-management/project-management.module.ts
git commit -m "feat(pmi): 处理中任务的重取端点（长轮询，仅发起人可读）"
```

---

### Task 7: 上传拆段——同步落盘与后台提取

**Files:**
- Create: `water-erp/apps/api/src/project-management/stage-extraction.types.ts`
- Modify: `water-erp/apps/api/src/project-management/project-management.service.ts`（`addStageAttachment`，`:1655`–`:2011`）
- Modify: `water-erp/apps/api/src/project-management/docx/file-utils.ts`（`getTenderTextCachePath` 旁加纯函数 `tenderTextCachePathFor`）
- Create: `water-erp/apps/api/src/project-management/stage-attachment-extraction.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `ExtractedFieldWriter`。
- Produces:
  - `type StageExtractedInfo = { initiationDate: string | null; evaluationMethod: string | null; expertInfo: string | null; biddingUnits: string | null; awardedSupplier: string | null; contractAmount: number | null; contractNumber: string | null; projectOverview: string | null; bidOpeningTime: string | null }`
  - `interface StageExtractionContext { absolutePath: string; attachmentId: string }`
  - `type StageExtractionFile = Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'size'>`（提取段只需要文件元信息，不需要上传缓冲区）
  - `ProjectManagementService.addStageAttachment(projectId, stageKey, file, uploadedById?, round?): Promise<{ record: Attachment; absolutePath: string }>`（`Attachment` 是 `@prisma/client` 的模型类型）
  - `ProjectManagementService.extractStageAttachmentFields(projectId, stageKey, file: StageExtractionFile, ctx: StageExtractionContext): Promise<{ extractedInfo: StageExtractedInfo | null }>`
  - `tenderTextCachePathFor(projectId: string): string`（`docx/file-utils.ts`，只算路径、不建目录）

- [ ] **Step 1: 写失败的测试**

新 spec 自带最小工厂 `makeService()`：照 `project-management.service.spec.ts` 的做法 `jest.mock('node:fs/promises')` 与 `jest.mock('../common/attachment-object-store')`，`new ProjectManagementService(...)` 仍按 12 个位置参数传（用不到的传 `{}`）。**不要像存量 spec 那样对 fs 替身调 `mockReset()`**——那会清掉用例给 fs 设的实现，`getTenderTextCachePath` 里 `mkdir(...).catch` 就会抛 TypeError。需要清理就只重置 prisma 与 parser 替身。工厂返回这些替身：

```ts
// prisma：projectManagementItem.{findUnique, update}、
//         projectManagementStage.findFirst（默认 { id: 'stage-1', attachments: [] }）、
//         attachment.{ create（默认 { id: 'att-1' }）, findUnique（默认 { id: 'att-1' }）}
// documentParser：parse / parseWithOcr（jest.fn）
// fs 替身：readFileMock、writeFileMock、mkdirMock、unlinkMock
```

```ts
import * as fieldExtractor from './docx/field-extractor';
import { ProjectManagementService } from './project-management.service';

const TEXT = 'x'.repeat(80);
const FILE = (name: string) => ({ originalname: name, mimetype: 'application/pdf', size: 1024, buffer: Buffer.from('x') }) as never;
type Internals = {
  aiMinimalPolish: (text: string) => Promise<string>;
  aiNormalizeBidOpeningTime: (text: string) => Promise<string>;
  extractBidOpeningTimeFromText: (text: string) => string | null;
  syncBidProjectOpeningFromPmi: (projectId: string, bidOpeningTime: string) => Promise<void>;
};
const internals = (service: ProjectManagementService) => service as unknown as Internals;

/** 固定「谈判文件」提取的两步产物，避开正则对文本的依赖；onNormalize 在慢步骤（大模型归一化）执行时回调 */
function armTenderExtract(service: ProjectManagementService, onNormalize?: () => void) {
  jest.spyOn(fieldExtractor, 'extractProjectOverviewFromText').mockReturnValue('机器概况');
  jest.spyOn(internals(service), 'aiMinimalPolish').mockImplementation(async (t) => t);
  jest.spyOn(internals(service), 'extractBidOpeningTimeFromText').mockReturnValue('2027-01-01 09:00');
  jest.spyOn(internals(service), 'aiNormalizeBidOpeningTime').mockImplementation(async (t) => { onNormalize?.(); return t; });
  return jest.spyOn(internals(service), 'syncBidProjectOpeningFromPmi').mockResolvedValue(undefined);
}

/** 内存里的项目行：findUnique 回它的快照，update 往里合并 */
function inMemoryRow(prisma: { projectManagementItem: { findUnique: jest.Mock; update: jest.Mock } }, row: Record<string, unknown>) {
  prisma.projectManagementItem.findUnique.mockImplementation(async () => ({ ...row, procurementMethod: '直接采购' }));
  prisma.projectManagementItem.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return {}; });
  return row;
}

const TENDER_TEXT = expect.stringContaining('tender-text-pm-01');

describe('addStageAttachment 同步段', () => {
  it('建完附件记录即返回，不碰文档解析', async () => {
    const { service, prisma, documentParser } = makeService();
    inMemoryRow(prisma, { status: 'ACTIVE', currentRound: 1 });
    const r = await service.addStageAttachment('pm-01', 'EXPERT_SELECTION', FILE('专家抽取结果单.pdf'), 'u1');
    expect(r.record).toMatchObject({ id: 'att-1' });
    expect(r.absolutePath).toEqual(expect.any(String));
    expect(prisma.attachment.create).toHaveBeenCalledTimes(1);
    expect(documentParser.parse).not.toHaveBeenCalled();
  });

  it('上传采购文件主文件 → 立即清掉项目的文本缓存', async () => {
    const { service, prisma, unlinkMock } = makeService();
    inMemoryRow(prisma, { status: 'ACTIVE', currentRound: 1 });
    await service.addStageAttachment('pm-01', 'TENDER_DOCUMENT', FILE('谈判文件.pdf'), 'u1');
    expect(unlinkMock).toHaveBeenCalledWith(TENDER_TEXT);
  });

  it('上传其他文件不清文本缓存', async () => {
    const { service, prisma, unlinkMock } = makeService();
    inMemoryRow(prisma, { status: 'ACTIVE', currentRound: 1 });
    await service.addStageAttachment('pm-01', 'EXPERT_SELECTION', FILE('专家抽取结果单.pdf'), 'u1');
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});

describe('extractStageAttachmentFields', () => {
  it('提取值经条件写入落库，并回传库里的提取信息', async () => {
    const { service, prisma, documentParser } = makeService();
    documentParser.parse.mockResolvedValue(TEXT);
    jest.spyOn(fieldExtractor, 'extractExpertInfoFromText').mockReturnValue('张三、李四');
    const row = inMemoryRow(prisma, { expertInfo: null });
    const r = await service.extractStageAttachmentFields('pm-01', 'EXPERT_SELECTION', FILE('专家抽取结果单.pdf'), { absolutePath: '/tmp/x.pdf', attachmentId: 'att-1' });
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({ where: { id: 'pm-01' }, data: { expertInfo: '张三、李四' } });
    expect(row.expertInfo).toBe('张三、李四');
    expect(r.extractedInfo).toMatchObject({ expertInfo: '张三、李四' });
  });

  it('开标时间真的写进去了才联动投标项目', async () => {
    const { service, prisma, documentParser } = makeService();
    documentParser.parse.mockResolvedValue(TEXT);
    const row = inMemoryRow(prisma, { projectOverview: null, bidOpeningTime: null });
    const sync = armTenderExtract(service);
    await service.extractStageAttachmentFields('pm-01', 'TENDER_DOCUMENT', FILE('谈判文件.pdf'), { absolutePath: '/tmp/x.pdf', attachmentId: 'att-1' });
    expect(row).toMatchObject({ projectOverview: '机器概况', bidOpeningTime: '2027-01-01 09:00' });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('pm-01', '2027-01-01 09:00');
  });

  it('识别期间人工改过的开标时间不写，联动也不做；没被改过的概况照写', async () => {
    const { service, prisma, documentParser } = makeService();
    documentParser.parse.mockResolvedValue(TEXT);
    const row = inMemoryRow(prisma, { projectOverview: null, bidOpeningTime: null });
    const sync = armTenderExtract(service, () => { row.bidOpeningTime = '人工确认的时间'; });
    await service.extractStageAttachmentFields('pm-01', 'TENDER_DOCUMENT', FILE('谈判文件.pdf'), { absolutePath: '/tmp/x.pdf', attachmentId: 'att-1' });
    expect(row).toMatchObject({ projectOverview: '机器概况', bidOpeningTime: '人工确认的时间' });
    expect(sync).not.toHaveBeenCalled();
  });

  it('附件已被删除 → 不写库、不联动、不回写文本缓存', async () => {
    const { service, prisma, documentParser, writeFileMock } = makeService();
    documentParser.parse.mockResolvedValue(TEXT);
    prisma.attachment.findUnique.mockResolvedValue(null);
    const row = inMemoryRow(prisma, { projectOverview: null, bidOpeningTime: null });
    const sync = armTenderExtract(service);
    await service.extractStageAttachmentFields('pm-01', 'TENDER_DOCUMENT', FILE('谈判文件.pdf'), { absolutePath: '/tmp/x.pdf', attachmentId: 'att-gone' });
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
    expect(row).toEqual({ projectOverview: null, bidOpeningTime: null });
    expect(sync).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalledWith(TENDER_TEXT, expect.anything(), expect.anything());
  });

  it('自己是本步骤最新的采购文件主文件 → 回写文本缓存', async () => {
    const { service, prisma, documentParser, writeFileMock } = makeService();
    documentParser.parse.mockResolvedValue(TEXT);
    inMemoryRow(prisma, { projectOverview: null, bidOpeningTime: null });
    prisma.attachment.findUnique.mockResolvedValue({ projectManagementStage: { attachments: [{ id: 'att-1', fileName: '谈判文件.pdf', createdAt: new Date('2026-11-01T00:00:00Z') }] } });
    armTenderExtract(service);
    await service.extractStageAttachmentFields('pm-01', 'TENDER_DOCUMENT', FILE('谈判文件.pdf'), { absolutePath: '/tmp/x.pdf', attachmentId: 'att-1' });
    expect(writeFileMock).toHaveBeenCalledWith(TENDER_TEXT, expect.any(String), 'utf8');
  });

  it('自己已不是最新的采购文件主文件 → 字段照写，但不回写文本缓存', async () => {
    const { service, prisma, documentParser, writeFileMock } = makeService();
    documentParser.parse.mockResolvedValue(TEXT);
    const row = inMemoryRow(prisma, { projectOverview: null, bidOpeningTime: null });
    prisma.attachment.findUnique.mockResolvedValue({ projectManagementStage: { attachments: [
      { id: 'att-9', fileName: '采购文件（新版）.pdf', createdAt: new Date('2026-11-02T00:00:00Z') },
      { id: 'att-1', fileName: '谈判文件.pdf', createdAt: new Date('2026-11-01T00:00:00Z') },
    ] } });
    armTenderExtract(service);
    await service.extractStageAttachmentFields('pm-01', 'TENDER_DOCUMENT', FILE('谈判文件.pdf'), { absolutePath: '/tmp/x.pdf', attachmentId: 'att-1' });
    expect(row).toMatchObject({ bidOpeningTime: '2027-01-01 09:00' });
    expect(writeFileMock).not.toHaveBeenCalledWith(TENDER_TEXT, expect.anything(), expect.anything());
  });
});
```

写测试前先确认 `isTenderMainFile` 对 `'谈判文件.pdf'` 和 `'采购文件（新版）.pdf'` 都为真（在 spec 里各加一条断言）；不为真就换成该函数认定的主文件名。

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest stage-attachment-extraction`
Expected: FAIL——`addStageAttachment` 的返回里没有 `record`，`extractStageAttachmentFields` 不是函数。

- [ ] **Step 3: 拆 `addStageAttachment`**

- **同步段**（留在 `addStageAttachment`）：`:1662`–`:1709` 原样（规则校验、可变性、轮次、历史轮只读闸、同名覆盖、`persistUploadedFile`），紧接着建附件记录（把 `:1961`–`:1972` 的 `attachment.create` 挪上来）。然后：若 `stageKey === 'TENDER_DOCUMENT'` 且规范化后的文件名满足 `isTenderMainFile`，就删掉项目的文本缓存——新文件一上传，旧的文本缓存就不能再被「AI 提取」读到。路径用新增的纯函数 `tenderTextCachePathFor(projectId)` 取；现有的 `getTenderTextCachePath` 会顺手建目录，在替身环境下 `mkdir()` 不回 Promise 会抛错，让它改调这个纯函数。删除放在 `try { await unlink(path) } catch {}` 里，文件本来就不存在不算错。最后执行 `:1975`–`:1977` 的归档联动，返回 `{ record, absolutePath }`。
- **提取段**（新方法 `extractStageAttachmentFields`）：把 `:1710`–`:1959` 整体搬进来（含 `decodedFileName` 的计算），末尾搬 `:1979`–`:2010` 组装 `extractedInfo` 的代码，返回 `{ extractedInfo }`。参数 `file` 只用到 `originalname` / `mimetype` / `size` 三个字段。
- 提取段开头：`const writer = await ExtractedFieldWriter.start(this.prisma, projectId, { attachmentId: ctx.attachmentId })`。
- 新增私有方法 `isLatestTenderMainFile(attachmentId: string): Promise<boolean>`：由这个附件找到它所在的步骤（提取段不知道轮次和步骤，反查最稳），取该步骤的附件（只取 `id`、`fileName`、`createdAt`，按 `createdAt` 倒序），第一个满足 `isTenderMainFile(fileName)` 的与 `attachmentId` 相等才返回 `true`；一个主文件都没找到返回 `false`。
- 九处写入改走 writer（行号为改动前的位置）：

| 位置 | 现在 | 改成 |
|---|---|---|
| `:1725` | `update({ data: { biddingUnits } })` | `await writer.update({ biddingUnits })` |
| `:1736`、`:1747` | `update({ data: { awardedSupplier } })` | `await writer.update({ awardedSupplier })` |
| `:1773` | `update({ data: { initiationDate } })`（保留前面「仅空值回填」的判断） | `await writer.update({ initiationDate })` |
| `:1799` | `update({ data: { expertInfo } })` | `await writer.update({ expertInfo })` |
| `:1832` | `update({ data: { projectOverview } })` | `await writer.update({ projectOverview })` |
| `:1841`–`:1846` | `update({ data: { bidOpeningTime } })` 后无条件联动 | `const applied = await writer.update({ bidOpeningTime })`；`applied.includes('bidOpeningTime')` 才调 `syncBidProjectOpeningFromPmi` |
| `:1853`–`:1858` | 无条件回写 `tender-text` 缓存 | `await writer.isAlive()` 且 `await this.isLatestTenderMainFile(ctx.attachmentId)` 都为真才写 |
| `:1950` | `update({ data: updateData })` | `await writer.update(updateData)` |

- 五段提取各自的 `try/catch` 与警告日志保持不变（提取失败不算上传失败）。

- [ ] **Step 4: 跑测试确认通过，并跑服务存量用例**

Run: `./node_modules/.bin/jest "project-management/(stage-attachment-extraction|project-management.service)"`
Expected: PASS（新用例 + 存量用例，包括「addStageAttachment 附件统一限制」四个）。

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/project-management/stage-extraction.types.ts water-erp/apps/api/src/project-management/project-management.service.ts water-erp/apps/api/src/project-management/stage-attachment-extraction.spec.ts
git commit -m "feat(pmi): 上传拆段——同步落盘即建附件记录，正文提取独立成可转后台的方法并走条件写入；上传主文件即清文本缓存"
```

---


### Task 8: 「AI 提取」落库改条件写入

**Files:**
- Modify: `water-erp/apps/api/src/project-management/project-management.service.ts`（`extractTenderFields`，`:919`–`:1008`）
- Test: `water-erp/apps/api/src/project-management/stage-attachment-extraction.spec.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的 `ExtractedFieldWriter`；Task 7 的测试工厂与 `armTenderExtract`、`inMemoryRow`。
- Produces: 无新接口，`extractTenderFields` 签名不变。

- [ ] **Step 1: 写失败的测试**

```ts
describe('extractTenderFields 落库', () => {
  beforeEach(async () => {
    // getTenderTextCachePath 内部会对 mkdir 的返回值调 .catch——替身必须回 Promise
    const realFs = await jest.requireActual('node:fs/promises');
    (mkdir as unknown as jest.Mock).mockImplementation(realFs.mkdir);
    (readFile as unknown as jest.Mock).mockResolvedValue(TEXT); // 命中文本缓存，不去读附件
  });

  it('字段没被人动过 → 照写，并联动投标项目', async () => {
    const { service, prisma } = makeService();
    const row = inMemoryRow(prisma, { projectOverview: null, bidOpeningTime: null });
    const sync = armTenderExtract(service);
    await service.extractTenderFields('pm-01');
    expect(row).toMatchObject({ projectOverview: '机器概况', bidOpeningTime: '2027-01-01 09:00' });
    expect(sync).toHaveBeenCalledWith('pm-01', '2027-01-01 09:00');
  });

  it('计算期间被人工改过的开标时间不写，联动也不做', async () => {
    const { service, prisma } = makeService();
    const row = inMemoryRow(prisma, { projectOverview: null, bidOpeningTime: null });
    const sync = armTenderExtract(service, () => { row.bidOpeningTime = '人工确认的时间'; });
    await service.extractTenderFields('pm-01');
    expect(row).toMatchObject({ projectOverview: '机器概况', bidOpeningTime: '人工确认的时间' });
    expect(sync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest "extractTenderFields 落库"`
Expected: 第二个用例 FAIL（现在是无条件写入，人工值被覆盖，联动也照做）；第一个用例 PASS（它是对照）。

- [ ] **Step 3: 改 `extractTenderFields`**

在取到 `itemMeta` 之后（`:925`）：`const writer = dryRun ? null : await ExtractedFieldWriter.start(this.prisma, itemId)`。把 `:1003` 的 `update` 换成 `const applied = await writer!.update(updateData)`，`:1005` 的条件换成 `applied.includes('bidOpeningTime')`。`updateStage`（「标记完成」）里的直接采购确认值不用改：它位于任何慢步骤之前，任务一开始就写了；之后的商谈报告闸和项目分析刷新不写提取字段。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/jest "project-management/stage-attachment-extraction" && ./node_modules/.bin/jest "extractTenderFields（AI提取"`
Expected: PASS（新用例 + 存量用例「不提取/不写入 awardedSupplier」）。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/api/src/project-management/project-management.service.ts water-erp/apps/api/src/project-management/stage-attachment-extraction.spec.ts
git commit -m "fix(pmi): AI 提取转后台后只写自任务启动以来未改过的字段"
```

---

### Task 9: 上传协调服务、请求到达打点、控制器接线

**Files:**
- Create: `water-erp/apps/api/src/project-management/pmi-stage-upload.service.ts`
- Create: `water-erp/apps/api/src/project-management/pmi-stage-upload.service.spec.ts`
- Create: `water-erp/apps/api/src/common/request-arrival.middleware.ts`
- Modify: `water-erp/apps/api/src/main.ts`（`app.use(json(...))` 之前挂中间件）
- Modify: `water-erp/apps/api/src/project-management/project-management.controller.ts`（构造函数末位加依赖；`uploadStageAttachment`）
- Modify: `water-erp/apps/api/src/project-management/project-management.module.ts`（`providers` 追加）

**Interfaces:**
- Consumes: Task 3 的 `PmiPendingJobService.run`；Task 7 的 `addStageAttachment`、`extractStageAttachmentFields`、`StageExtractedInfo`、`StageExtractionFile`。
- Produces:
  - `type StageUploadResponse = Attachment & { extractedInfo: StageExtractedInfo | null; extractedPending?: boolean; extractedFailed?: boolean; pendingJobId?: string }`
  - `class PmiStageUploadService`，方法 `upload(projectId: string, stageKey: string, file: Express.Multer.File, uploadedById: string | undefined, round: number | undefined, opts: { ownerId: string | undefined; arrivedAt?: number }): Promise<StageUploadResponse>`
  - `markRequestArrival(req, res, next): void`（`common/request-arrival.middleware.ts`）

- [ ] **Step 1: 写失败的测试**

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { PmiPendingJobService } from './pmi-pending-job.service';
import { PmiStageUploadService } from './pmi-stage-upload.service';

const FILE = { originalname: 'a.pdf', mimetype: 'application/pdf', size: 1, buffer: Buffer.from('x') } as never;
const KEYS = ['PM_PENDING_WAIT_MS', 'PM_PENDING_MIN_WAIT_MS', 'PM_PENDING_MAX_RUNNING'];
const never = () => new Promise<never>(() => {});
const saved = { ...process.env };
beforeEach(() => { process.env.PM_PENDING_WAIT_MS = '30'; process.env.PM_PENDING_MIN_WAIT_MS = '10'; });
afterEach(() => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, saved); });

function makeCoord() {
  const pmi = {
    addStageAttachment: jest.fn().mockResolvedValue({ record: { id: 'att-1', fileName: 'a.pdf' }, absolutePath: '/tmp/a.pdf' }),
    extractStageAttachmentFields: jest.fn().mockResolvedValue({ extractedInfo: { expertInfo: '张三' } }),
  };
  const jobs = new PmiPendingJobService();
  return { pmi, jobs, coord: new PmiStageUploadService(pmi as never, jobs) };
}

describe('PmiStageUploadService.upload', () => {
  it('提取在等待上限内完成 → 响应与今天一致，没有 pending 字段', async () => {
    const { coord } = makeCoord();
    const r = await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    expect(r).toEqual({ id: 'att-1', fileName: 'a.pdf', extractedInfo: { expertInfo: '张三' } });
  });

  it('提取超过等待上限 → 附件记录照常返回，带 extractedPending 与单号', async () => {
    const { pmi, coord } = makeCoord();
    pmi.extractStageAttachmentFields.mockImplementation(() => new Promise(() => {}));
    const r = await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    expect(r).toMatchObject({ id: 'att-1', extractedInfo: null, extractedPending: true, pendingJobId: expect.any(String) });
  });

  it('提取意外失败 → 上传仍成功，带 extractedFailed 标记', async () => {
    const { pmi, coord } = makeCoord();
    pmi.extractStageAttachmentFields.mockRejectedValue(new Error('提取炸了'));
    await expect(coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' }))
      .resolves.toEqual({ id: 'att-1', fileName: 'a.pdf', extractedInfo: null, extractedFailed: true });
  });

  it('登记表已被别人的任务占满时，上传的提取照常排队并转后台', async () => {
    process.env.PM_PENDING_MAX_RUNNING = '1';
    const { pmi, jobs, coord } = makeCoord();
    await jobs.run('someone-else', 'analyze', never);
    await expect(jobs.run('another', 'analyze', never)).rejects.toBeInstanceOf(ServiceUnavailableException); // 对照：普通任务此时确实被拒
    pmi.extractStageAttachmentFields.mockImplementation(() => new Promise(() => {}));
    const r = await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    expect(r).toMatchObject({ id: 'att-1', extractedPending: true });
  });

  it('传给提取的只有文件元信息，不带上传缓冲区', async () => {
    const { pmi, coord } = makeCoord();
    await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    expect(pmi.extractStageAttachmentFields.mock.calls[0][2]).toEqual({ originalname: 'a.pdf', mimetype: 'application/pdf', size: 1 });
  });

  it('同一项目的两次提取按先后执行', async () => {
    const { pmi, coord } = makeCoord();
    let release!: () => void;
    pmi.extractStageAttachmentFields.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ extractedInfo: null }); }));
    await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    await coord.upload('pm-1', 'CONTRACT', FILE, 'u1', 1, { ownerId: 'u1' });
    expect(pmi.extractStageAttachmentFields).toHaveBeenCalledTimes(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pmi.extractStageAttachmentFields).toHaveBeenCalledTimes(2);
  });

  it('不同项目并行，不等彼此', async () => {
    const { pmi, coord } = makeCoord();
    pmi.extractStageAttachmentFields.mockImplementation(() => new Promise(() => {}));
    await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    await coord.upload('pm-2', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    expect(pmi.extractStageAttachmentFields).toHaveBeenCalledTimes(2);
  });

  it('前一个提取失败不挡后一个', async () => {
    const { pmi, coord } = makeCoord();
    let fail!: (e: Error) => void;
    pmi.extractStageAttachmentFields.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1' });
    await coord.upload('pm-1', 'CONTRACT', FILE, 'u1', 1, { ownerId: 'u1' });
    expect(pmi.extractStageAttachmentFields).toHaveBeenCalledTimes(1);
    fail(new Error('第一个失败'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pmi.extractStageAttachmentFields).toHaveBeenCalledTimes(2);
  });

  it('请求到达时刻透传给任务登记表', async () => {
    const { jobs, coord } = makeCoord();
    const spy = jest.spyOn(jobs, 'run');
    await coord.upload('pm-1', 'EXPERT_SELECTION', FILE, 'u1', 1, { ownerId: 'u1', arrivedAt: 777 });
    expect(spy.mock.calls[0][3]).toMatchObject({ arrivedAt: 777 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/jest pmi-stage-upload.service`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

- `upload`：先 `addStageAttachment`（同步段）。然后把文件缩成元信息 `meta = { originalname, mimetype, size }`——排队中的任务会一直被闭包持有，带上缓冲区的话一次批量上传就会在内存里压住十几份文件。再调 `jobs.run(opts.ownerId, 'stage-attachment-extract', () => this.enqueue(projectId, () => this.pmi.extractStageAttachmentFields(projectId, stageKey, meta, { absolutePath, attachmentId: record.id })), { arrivedAt: opts.arrivedAt, exemptFromLimit: true })`。
- 三种结局：期限内完成返回 `{ ...record, extractedInfo }`；转后台返回 `{ ...record, extractedInfo: null, extractedPending: true, pendingJobId }`；`jobs.run` 在等待期内抛错（提取意外失败）时记一条 WARN，返回 `{ ...record, extractedInfo: null, extractedFailed: true }`——附件已经建好，上传必须算成功，但要让前端知道提取没成。
- `enqueue(projectId, task)`：每个项目一条 Promise 链（`Map<string, Promise<void>>`），新任务挂在前一个的后面，前一个成败都不影响后一个（用 `.then(task, task)`）；链尾结算后，若 Map 里仍是自己则删掉。
- `markRequestArrival`：`(req as Request & { arrivedAt?: number }).arrivedAt = Date.now(); next();`。在 `main.ts` 的 `app.use(json({ limit: bodyLimit }))` 之前 `app.use(markRequestArrival)`。
- `uploadStageAttachment`：加参数 `@Req() req: Request`，改调 `this.stageUpload.upload(id, stageKey, file, user?.sub, round, { ownerId: user?.sub, arrivedAt: (req as Request & { arrivedAt?: number }).arrivedAt })`。构造函数末位追加 `private readonly stageUpload: PmiStageUploadService`。
- `project-management.module.ts`：`providers` 追加 `PmiStageUploadService`。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/jest "project-management/(pmi-stage-upload|project-management.controller)" && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: PASS，9 个用例；tsc 无输出。

- [ ] **Step 5: 后端全量回归**

Run: `./node_modules/.bin/jest`
Expected: 与开工前记录的基线一致，没有新增失败。

- [ ] **Step 6: 提交**

```bash
git add water-erp/apps/api/src/project-management/pmi-stage-upload.service.ts water-erp/apps/api/src/project-management/pmi-stage-upload.service.spec.ts water-erp/apps/api/src/common/request-arrival.middleware.ts water-erp/apps/api/src/main.ts water-erp/apps/api/src/project-management/project-management.controller.ts water-erp/apps/api/src/project-management/project-management.module.ts
git commit -m "feat(pmi): 上传落盘即返回——提取按项目串行转后台、不占在途名额、只留文件元信息；请求到达打点供等待预算"
```

---


### Task 10: 前端——识别「处理中」并自动重取（核心逻辑与封装）

**Files:**
- Create: `water-erp/apps/web/src/lib/api/pm-pending-core.ts`
- Create: `water-erp/apps/web/src/lib/api/pm-pending-core.test.ts`
- Create: `water-erp/apps/web/src/lib/api/pm-pending.ts`
- Create: `water-erp/apps/web/src/lib/api/pm-pending.test.ts`

**Interfaces:**
- Consumes: `@water-erp/client` 的 `ApiError`、`toApiError`；`./api-fetch` 的 `apiFetch`。
- Produces（Task 12 使用）:
  - `const PM_PENDING_TIMEOUT_CODE = 'PM_PENDING_TIMEOUT'`、`const PM_JOB_LOST_CODE = 'PM_JOB_LOST'`、`const PM_PENDING_MAX_WAIT_MS = 20 * 60_000`、`const PM_PENDING_GAP_MS = 1000`
  - `interface PendingPollOptions { signal?: AbortSignal; maxWaitMs?: number; gapMs?: number }`
  - `isPendingBody(body: unknown): body is { pending: true; jobId: string }`
  - `resolvePendingBody<T>(body: T, opts?: PendingPollOptions, deps?: PendingPollDeps): Promise<T>`（`deps` 仅供测试注入：`fetchJob`、`sleep`、`now`）
  - `pm-pending.ts`：`parseJsonWithPending<T>(response: Response, opts?: PendingPollOptions): Promise<T>`、`resolvePending<T>(body: T, opts?: PendingPollOptions): Promise<T>`、`pollPendingJob<T>(jobId: string, opts?: PendingPollOptions): Promise<T>`、`postJsonWithPending<T>(url: string, init: RequestInit, opts?: PendingPollOptions): Promise<T>`

- [ ] **Step 1: 写失败的测试**

核心逻辑（依赖全部注入）`pm-pending-core.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@water-erp/client";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行（须单行）
import { isPendingBody, PM_PENDING_GAP_MS, resolvePendingBody } from "./pm-pending-core.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** 依次回 responses；用完后一直回最后一个。记录重取次数与每次等待的毫秒数 */
function deps(responses: Response[], now: () => number = () => 0) {
  const queue = [...responses];
  const state = { calls: 0, sleeps: [] as number[] };
  const d = {
    fetchJob: async () => { state.calls += 1; return queue.length > 1 ? queue.shift()! : queue[0]!; },
    sleep: async (ms: number) => { state.sleeps.push(ms); },
    now,
  };
  return { d, state };
}

test("不是处理中的响应体原样返回，不发起重取", async () => {
  const { d, state } = deps([json(200, {})]);
  const body = { ok: 1 };
  assert.equal(await resolvePendingBody(body, {}, d), body);
  assert.equal(isPendingBody(body), false);
  assert.equal(state.calls, 0);
});

test("处理中：运行中两次后拿到结果；两次之间按间隔等待", async () => {
  const { d, state } = deps([json(200, { status: "running" }), json(200, { status: "running" }), json(200, { status: "done", result: { ok: 2 } })]);
  assert.deepEqual(await resolvePendingBody({ pending: true, jobId: "j1" }, { gapMs: 5 }, d), { ok: 2 });
  assert.deepEqual(state.sleeps, [5, 5]);
  assert.equal(PM_PENDING_GAP_MS, 1000);
});

test("任务失败：抛出的错误与普通失败请求同格式", async () => {
  const { d } = deps([json(400, { statusCode: 400, code: "ARCHIVE_GATE_MISSING", error: "缺归档材料" })]);
  await assert.rejects(
    () => resolvePendingBody({ pending: true, jobId: "j1" }, {}, d),
    (err: unknown) => err instanceof ApiError && err.status === 400 && err.code === "ARCHIVE_GATE_MISSING" && err.message === "缺归档材料",
  );
});

test("任务丢失：提示处理被中断", async () => {
  const { d } = deps([json(404, { statusCode: 404, code: "PM_JOB_NOT_FOUND", error: "处理任务不存在或已结束，请重新发起" })]);
  await assert.rejects(
    () => resolvePendingBody({ pending: true, jobId: "j1" }, {}, d),
    (err: unknown) => err instanceof ApiError && err.code === "PM_JOB_LOST" && err.message === "处理被中断，请重试",
  );
});

test("一直运行中：超过总时长上限即报处理超时", async () => {
  let now = 0;
  const { d } = deps([json(200, { status: "running" })], () => now);
  d.sleep = async () => { now += 600; };
  await assert.rejects(
    () => resolvePendingBody({ pending: true, jobId: "j1" }, { maxWaitMs: 1000, gapMs: 1 }, d),
    (err: unknown) => err instanceof ApiError && err.code === "PM_PENDING_TIMEOUT" && err.message === "处理时间过长，后台仍在执行，请稍后刷新查看结果",
  );
});

test("调用方取消：停止重取，保持 AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  const { d, state } = deps([json(200, { status: "running" })]);
  await assert.rejects(
    () => resolvePendingBody({ pending: true, jobId: "j1" }, { signal: controller.signal }, d),
    (err: unknown) => (err as Error).name === "AbortError",
  );
  assert.equal(state.calls, 0);
});
```

封装层（替换全局 `fetch`，做法同 `lib/api/project-management.test.ts`）`pm-pending.test.ts`——钉住 202 的判定、重取地址与取消信号，这三样只有源码正则是查不出来的：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@water-erp/client";
import { parseJsonWithPending, resolvePending } from "./pm-pending";

/** 替换全局 fetch：handler 收到 URL 与 init，给出下一次响应；run 结束后还原 */
function withFetch(handler: (url: string, init?: RequestInit) => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("普通响应原样解析，不发起重取", async () => {
  await withFetch(() => { throw new Error("不应发起重取"); }, async () => {
    assert.deepEqual(await parseJsonWithPending(json(200, { ok: 1 })), { ok: 1 });
  });
});

test("202 处理中：按单号重取，直到拿到结果", async () => {
  const urls: string[] = [];
  await withFetch((url) => {
    urls.push(url);
    return urls.length === 1 ? json(200, { status: "running" }) : json(200, { status: "done", result: { ok: 2 } });
  }, async () => {
    assert.deepEqual(await parseJsonWithPending(json(202, { pending: true, jobId: "j1" }), { gapMs: 1 }), { ok: 2 });
  });
  assert.deepEqual(urls, ["/api/project-management/pending-jobs/j1", "/api/project-management/pending-jobs/j1"]);
});

test("重取时任务失败：抛出后端的状态码与 code", async () => {
  await withFetch(() => json(400, { statusCode: 400, code: "ARCHIVE_GATE_MISSING", error: "缺归档材料" }), async () => {
    await assert.rejects(
      () => parseJsonWithPending(json(202, { pending: true, jobId: "j1" }), { gapMs: 1 }),
      (err: unknown) => err instanceof ApiError && err.status === 400 && err.code === "ARCHIVE_GATE_MISSING" && err.message === "缺归档材料",
    );
  });
});

test("取消信号随重取请求发出", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | null | undefined;
  await withFetch((_url, init) => { seen = init?.signal; return json(200, { status: "done", result: { ok: 3 } }); }, async () => {
    assert.deepEqual(await parseJsonWithPending(json(202, { pending: true, jobId: "j1" }), { signal: controller.signal }), { ok: 3 });
  });
  assert.equal(seen, controller.signal);
});

test("resolvePending：不是处理中的响应体原样返回", async () => {
  const body = { fields: { a: "1" } };
  assert.equal(await resolvePending(body), body);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/tsx --test "src/lib/api/pm-pending*.test.ts"`
Expected: FAIL，找不到 `./pm-pending-core.ts` 与 `./pm-pending`。

- [ ] **Step 3: 实现**

- `pm-pending-core.ts` 只放纯逻辑，依赖全部经 `deps` 注入（不 import `apiFetch`，便于单测）。循环：先查 `signal.aborted`（为真抛 `new DOMException('Aborted', 'AbortError')`）→ `fetchJob(jobId, signal)` → 404 且 `code === 'PM_JOB_NOT_FOUND'` 抛 `new ApiError(404, 'PM_JOB_LOST', '处理被中断，请重试')` → 其他非 2xx 抛 `toApiError(res)` → 体里 `status === 'done'` 返回 `result` → 否则超过截止时刻抛 `new ApiError(0, 'PM_PENDING_TIMEOUT', '处理时间过长，后台仍在执行，请稍后刷新查看结果')`，没超就 `sleep(gapMs)` 再来。截止时刻 = 开始时 `now()` + `maxWaitMs`。
- `pm-pending.ts`：`fetchJob` 用 `apiFetch(`${API_BASE}/project-management/pending-jobs/${jobId}`, { credentials: 'include', signal })`；`API_BASE` 与 `lib/api/project-management.ts` 同口径（`process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api'`）。`pollPendingJob(jobId, opts)` 就是这套 `deps` 下的重取循环。`parseJsonWithPending`：`response.status === 202` 时解析出单号并走重取；非 2xx 抛 `toApiError(response, '请求失败，请稍后重试。')`；否则 `response.json()`。`resolvePending`：`isPendingBody` 为真就走重取，否则原样返回。`postJsonWithPending` = `apiFetch(url, init)` 后交给 `parseJsonWithPending`。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/tsx --test "src/lib/api/pm-pending*.test.ts"`
Expected: PASS，核心 6 个用例、封装 5 个用例。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/web/src/lib/api/pm-pending-core.ts water-erp/apps/web/src/lib/api/pm-pending-core.test.ts water-erp/apps/web/src/lib/api/pm-pending.ts water-erp/apps/web/src/lib/api/pm-pending.test.ts
git commit -m "feat(web): 处理中响应的自动重取——识别 202、凭单号长轮询、超时与中断提示"
```

---


### Task 11: 前端——封装层接入，调用方不改

**Files:**
- Modify: `water-erp/apps/web/src/lib/api/project-management.ts`（`parseJsonResponse`、`extractInitiationFields`、`extractDemandFields`、`UploadStageAttachmentResult`）
- Modify: `water-erp/apps/web/src/lib/api/announcement.ts`（`parseAnnouncementFields`，`:636`）
- Modify: `water-erp/apps/web/src/components/projects/tender-file-editor-modal.tsx`（`:739`、`:746` 两处直接调用）
- Create: `water-erp/apps/web/src/lib/api/pm-pending-wiring.test.ts`

**Interfaces:**
- Consumes: Task 10 的 `parseJsonWithPending`、`resolvePending`、`postJsonWithPending`。
- Produces: `UploadStageAttachmentResult` 多出 `extractedPending?: boolean; extractedFailed?: boolean; pendingJobId?: string`（Task 12 使用）。

- [ ] **Step 1: 写失败的测试**（沿用本仓库前端的做法：对源码做文本断言）

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pm = readFileSync(resolve("src/lib/api/project-management.ts"), "utf8");
const announcement = readFileSync(resolve("src/lib/api/announcement.ts"), "utf8");
const editor = readFileSync(resolve("src/components/projects/tender-file-editor-modal.tsx"), "utf8");

/** 取 name 到下一个顶层声明之间的源码 */
const decl = (src: string, name: string) => {
  const from = src.indexOf(name);
  assert.notEqual(from, -1, `找不到 ${name}`);
  const next = src.indexOf("\nexport ", from + name.length);
  return src.slice(from, next === -1 ? undefined : next);
};

test("parseJsonResponse 统一经 parseJsonWithPending", () => {
  assert.match(decl(pm, "async function parseJsonResponse"), /parseJsonWithPending/);
});
test("两个带文件上传的提取封装都经 resolvePending", () => {
  assert.match(decl(pm, "export async function extractInitiationFields"), /resolvePending\(/);
  assert.match(decl(pm, "export async function extractDemandFields"), /resolvePending\(/);
});
test("上传结果类型带处理中与失败字段", () => {
  assert.match(pm, /extractedPending\?: boolean;\s*extractedFailed\?: boolean;\s*pendingJobId\?: string;/);
});
test("公告字段解析经 resolvePending", () => {
  assert.match(decl(announcement, "export function parseAnnouncementFields"), /resolvePending\(/);
});
test("附件 AI 润色的两处直接调用都经 postJsonWithPending", () => {
  assert.equal((editor.match(/postJsonWithPending</g) ?? []).length, 2);
  assert.equal((editor.match(/attachment-ai-polish`/g) ?? []).length, 2);
});
```

说明：202 的判定、重取地址、取消信号这些行为由 Task 10 的 `pm-pending.test.ts` 钉住；这里只确认各调用点确实接上了那套封装。

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/tsx --test "src/lib/api/pm-pending-wiring.test.ts"`
Expected: FAIL。

- [ ] **Step 3: 改封装层**

- `project-management.ts`：`parseJsonResponse` 的函数体改成 `return parseJsonWithPending<T>(response);`（10 个走 `apiFetch` 的封装和 `updateProjectStage` 末尾都自动获得重取，不用逐个改）。`extractInitiationFields`、`extractDemandFields` 把 `api.upload<...>(...)` 的结果交给 `resolvePending(..., { signal: opts?.signal })`。类型 `UploadStageAttachmentResult` 追加三个字段。
- `announcement.ts`：`parseAnnouncementFields` 把 `api.post` 的结果交给 `resolvePending`。
- `tender-file-editor-modal.tsx`：`:739` 那条 `.then(r => r.ok ? r.json() : Promise.reject())` 链和 `:746` 的 `try` 块都改成 `postJsonWithPending<{ polished: string }>(url, init)`，失败仍是 reject。
- `extractTenderFields`、`analyzeDirectProcurement` 自带的 150 秒、180 秒 `AbortController` 超时不用动：重取请求不挂在那个 controller 上，定时器触发时没有请求可掐，`finally` 会在重取结束后清掉它。加一行注释说明。

- [ ] **Step 4: 跑测试与检查**

Run: `./node_modules/.bin/tsx --test "src/**/*.test.ts"`
Expected: PASS（含存量前端单测）。

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 无输出。

Run（在 `water-erp/` 下）: `bash scripts/copy-lint.sh apps/web/src/lib/api apps/web/src/components/projects/tender-file-editor-modal.tsx`
Expected: 无命中，退出码 0。

- [ ] **Step 5: 提交**

```bash
git add water-erp/apps/web/src/lib/api/project-management.ts water-erp/apps/web/src/lib/api/announcement.ts water-erp/apps/web/src/components/projects/tender-file-editor-modal.tsx water-erp/apps/web/src/lib/api/pm-pending-wiring.test.ts
git commit -m "feat(web): 项目管理封装层统一识别处理中并自动重取，调用方不改"
```

---


### Task 12: 前端——跟踪转后台的提取，上传行显示「文字识别中」，结果晚到自动更新

上传有两类调用方：详情面板的上传队列，以及直接调用 `uploadProjectStageAttachment` 的向导和弹窗（`tender-write-modal.tsx`、`official-tender-wizard.tsx`、`abort-restart-dialog.tsx` 等共 8 处）。后一类上传的采购文件主文件同样会转后台（那段提取含两次大模型调用，数字件也常常超等待上限），所以跟踪不能只做在上传队列里。本任务在封装层统一登记，详情面板统一订阅。

**Files:**
- Create: `water-erp/apps/web/src/lib/api/pmi-extraction-tracker.ts`
- Create: `water-erp/apps/web/src/lib/api/pmi-extraction-tracker.test.ts`
- Modify: `water-erp/apps/web/src/lib/api/project-management.ts`（`uploadProjectStageAttachment`）
- Modify: `water-erp/apps/web/src/components/upload/upload-progress-list.tsx`
- Modify: `water-erp/apps/web/src/components/projects/project-detail-panel.tsx`（`useFileUploads` 的 `onEachDone`，`:215`–`:239`；`openDirectConfirm`，`:840`–`:868`；`UploadProgressList` 调用处，`:2203`）
- Modify: `water-erp/apps/web/src/lib/api/pm-pending-wiring.test.ts`（追加）
- Modify（仅在核对后需要加守卫时）: Step 5 列出的调用方文件

**Interfaces:**
- Consumes: Task 10 的 `pollPendingJob`、`PendingPollOptions`；Task 11 的 `UploadStageAttachmentResult`。提取任务的结果是包了一层的 `{ extractedInfo }`（见 Task 7、Task 9），取值要再点一层。
- Produces:
  - `interface StageExtractionEvent { type: 'started' | 'settled' | 'failed'; projectId: string; jobId: string; extractedInfo?: ExtractedInfo | null }`
  - `trackStageExtraction(projectId: string, jobId: string, opts?: PendingPollOptions): void`（同一单号只登记一次）
  - `subscribeStageExtraction(listener: (e: StageExtractionEvent) => void): () => void`（返回退订函数）
  - `pendingStageExtractions(projectId: string): number`
  - `UploadProgressList` 新增可选属性 `recognizingIds?: ReadonlySet<string>`

- [ ] **Step 1: 写失败的测试**

跟踪器 `pmi-extraction-tracker.test.ts`（替换全局 `fetch`，做法同 `pm-pending.test.ts`；模块状态跨用例保留，每个用例用不同的单号）:

```ts
import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行（须单行）
import { pendingStageExtractions, subscribeStageExtraction, trackStageExtraction } from "./pmi-extraction-tracker.ts";

type Event = { type: string; projectId: string; jobId: string; extractedInfo?: unknown };

function withFetch(handler: (url: string, init?: RequestInit) => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; });
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test("登记后先发 started；任务结束后发 settled 并带上提取信息", async () => {
  const events: Event[] = [];
  const unsubscribe = subscribeStageExtraction((e) => events.push(e));
  await withFetch(() => json(200, { status: "done", result: { extractedInfo: { expertInfo: "张三" } } }), async () => {
    trackStageExtraction("pm-1", "job-a", { gapMs: 1 });
    assert.equal(pendingStageExtractions("pm-1"), 1);
    await settle();
  });
  unsubscribe();
  assert.deepEqual(events.map((e) => e.type), ["started", "settled"]);
  assert.deepEqual(events[1].extractedInfo, { expertInfo: "张三" });
  assert.equal(pendingStageExtractions("pm-1"), 0);
});

test("同一单号只登记一次", async () => {
  const events: Event[] = [];
  const unsubscribe = subscribeStageExtraction((e) => events.push(e));
  await withFetch(() => json(200, { status: "done", result: { extractedInfo: null } }), async () => {
    trackStageExtraction("pm-2", "job-b", { gapMs: 1 });
    trackStageExtraction("pm-2", "job-b", { gapMs: 1 });
    await settle();
  });
  unsubscribe();
  assert.deepEqual(events.map((e) => e.type), ["started", "settled"]);
});

test("任务失败发 failed，待处理数归零", async () => {
  const events: Event[] = [];
  const unsubscribe = subscribeStageExtraction((e) => events.push(e));
  await withFetch(() => json(404, { statusCode: 404, code: "PM_JOB_NOT_FOUND", error: "处理任务不存在或已结束，请重新发起" }), async () => {
    trackStageExtraction("pm-3", "job-c", { gapMs: 1 });
    await settle();
  });
  unsubscribe();
  assert.deepEqual(events.map((e) => e.type), ["started", "failed"]);
  assert.equal(pendingStageExtractions("pm-3"), 0);
});

test("退订后不再收到事件", async () => {
  const events: Event[] = [];
  const unsubscribe = subscribeStageExtraction((e) => events.push(e));
  unsubscribe();
  await withFetch(() => json(200, { status: "done", result: { extractedInfo: null } }), async () => {
    trackStageExtraction("pm-4", "job-d", { gapMs: 1 });
    await settle();
  });
  assert.deepEqual(events, []);
});
```

追加到 `pm-pending-wiring.test.ts`:

```ts
const list = readFileSync(resolve("src/components/upload/upload-progress-list.tsx"), "utf8");
const panel = readFileSync(resolve("src/components/projects/project-detail-panel.tsx"), "utf8");

test("上传行：识别中的条目显示文字识别中而不是已完成", () => {
  assert.match(list, /recognizingIds\?: ReadonlySet<string>/);
  assert.match(list, /文字识别中/);
});
test("上传封装：转后台的提取统一登记跟踪（不经过上传队列的调用方也覆盖）", () => {
  assert.match(decl(pm, "export async function uploadProjectStageAttachment"), /trackStageExtraction\(/);
});
test("详情面板：订阅提取任务事件，结束后合入提取信息；上传行标记识别中", () => {
  assert.match(panel, /subscribeStageExtraction\(/);
  assert.match(panel, /applyExtractedInfo\(/);
  assert.match(panel, /recognizingIds=\{recognizingIds\}/);
  assert.match(panel, /文字识别失败，可重新上传或使用 AI 提取/);
});
test("完成确认弹窗：识别未完成时给出提示", () => {
  assert.match(panel, /不会覆盖本弹窗确认的内容/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/tsx --test "src/lib/api/pmi-extraction-tracker.test.ts" "src/lib/api/pm-pending-wiring.test.ts"`
Expected: FAIL（跟踪器模块找不到；追加的 4 个用例失败）。

- [ ] **Step 3: 实现**

- `pmi-extraction-tracker.ts`：模块内一张表（已登记的单号 → 项目）和一个监听者集合。`trackStageExtraction`：单号已登记就直接返回；否则登记、发 `started`，然后调 `pollPendingJob<{ extractedInfo: ExtractedInfo | null }>(jobId, opts)`，成功发 `settled`（带 `extractedInfo`），失败发 `failed`；两种情况都注销该单号。`ExtractedInfo` 是 `lib/api/project-management.ts` 导出的类型，这里只做类型引用。
- `project-management.ts` 的 `uploadProjectStageAttachment`：拿到结果后，若 `result.extractedPending && result.pendingJobId`，调 `trackStageExtraction(projectId, result.pendingJobId, { signal: opts?.signal })`；结果原样返回。
- `project-detail-panel.tsx`：
  - 把 `onEachDone` 里「合入 `extractedInfo`」的那段（`:227`–`:239`）抽成局部函数 `applyExtractedInfo(info: ExtractedInfo)`。
  - 新增状态 `recognizingIds`（`useState<Set<string>>`）和一个 `useRef<Map<string, string>>`（单号 → 上传条目 id）。
  - `onEachDone` 收到的对象带上传条目的 `id`。若 `result.extractedPending && result.pendingJobId`：记下单号与条目 id 的对应，把 `id` 加进 `recognizingIds`。轮询不在这里做，封装层已经统一登记。
  - 用 `useEffect` 订阅 `subscribeStageExtraction`（依赖 `[item.id]`，清理函数里退订）：事件的项目不是当前项目就忽略；`settled` 时 `extractedInfo` 非空就 `applyExtractedInfo(e.extractedInfo)`，然后 `handleUpdated()`；`failed` 时 `toast.warning('文字识别失败，可重新上传或使用 AI 提取')`；除 `started` 外都按单号找出条目 id，从 `recognizingIds` 移除。依赖里要用到的 `handleUpdated` 等绑定，按面板现有写法放进依赖数组；面板有「react-compiler 前向引用」的注释，新钩子放在被引用的绑定之后。
  - `:2203` 的 `<UploadProgressList …>` 加 `recognizingIds={recognizingIds}`。
  - `openDirectConfirm`：组装完 `directFilesNote` 后，若 `recognizingIds.size > 0 || pendingStageExtractions(item.id) > 0`，在后面接一句「文件文字识别仍在后台进行，不会覆盖本弹窗确认的内容」。
- `upload-progress-list.tsx`：属性里加 `recognizingIds?: ReadonlySet<string>`。`it.status === 'done'` 且 `recognizingIds?.has(it.id)` 时，原来显示「已完成」的位置显示「文字识别中…」（颜色 `text-[var(--accent)]`，不加图标、不用 emoji）。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/tsx --test "src/lib/api/pmi-extraction-tracker.test.ts" "src/lib/api/pm-pending-wiring.test.ts"`
Expected: PASS。

- [ ] **Step 5: 逐个核对调用点对「晚到的成功」是否安全**

今天这些请求超过代理档会报错，改造后会晚一些成功返回。逐个看下列文件里对 12 个封装函数的每一次调用：`components/projects/abort-restart-dialog.tsx`、`create-project-dialog.tsx`、`notification-letter-dialog.tsx`、`supplier-select-modal.tsx`、`announcement-dialog.tsx`、`change-modal.tsx`、`projects/page.tsx`、`project-detail-panel.tsx`、`announcement-publish-wizard.tsx`、`tender-file-editor-modal.tsx`。

每一处回答两个问题：结果回来时页面是否还在等它（组件已卸载、弹窗已关、用户已切到别的项目或步骤）；不在等时把结果写进状态，会不会覆盖更新的内容或触发后续动作。有风险就加守卫：发请求时取一个序号（或记下当时的项目、步骤标识），回来时不一致就丢弃——`project-detail-panel.tsx` 的 `analysisSeqRef` 是现成例子；组件卸载时置失效标记也可。把结论写进提交说明，每个调用点一行（安全 / 已加守卫 / 为什么无风险）。

- [ ] **Step 6: 跑测试与检查**

Run: `./node_modules/.bin/tsx --test "src/**/*.test.ts"`
Expected: PASS。

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 无输出。

Run（在 `water-erp/` 下）: `bash scripts/copy-lint.sh apps/web/src/components/upload apps/web/src/components/projects/project-detail-panel.tsx apps/web/src/lib/api`
Expected: 退出码 0。

- [ ] **Step 7: 提交**

`git add` 列出本任务改动的全部文件（含 Step 5 加了守卫的文件）。

```bash
git commit -m "feat(web): 转后台的提取统一跟踪；上传行标记文字识别中，结果晚到自动更新；逐个核对晚到结果的调用点"
```

---


### Task 13: 代理注释与口径文档

**Files:**
- Modify: `water-erp/apps/web/src/proxy.ts`（仅注释，随分支提交）
- Modify: `CLAUDE.md`（主工作区单独提交，不进分支；用 Bash 改）

- [ ] **Step 1: 代理注释**

在 `proxy.ts` 的 `UPSTREAM_SLOW_PATH_SUFFIXES` 上方那段 2026-11-24 注释后面加一段：

```ts
// 2026-11-25：项目管理慢接口已转后台（spec 2026-11-25-pmi-heavy-endpoints-pending-design）——
// 请求限时等不到即回 202、前端凭单号重取。下列项目管理档位只在机制失效时兜底。
// 附件上传与「标记完成」仍走 15s 快速档，靠后端限时返回保证不超时。
```

Run（`water-erp/apps/web` 下）: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 无输出。

- [ ] **Step 2: 提交代理注释**

```bash
git add water-erp/apps/web/src/proxy.ts
git commit -m "docs(web): 代理注释——项目管理慢接口已转后台，长档仅作兜底"
```

- [ ] **Step 3: 合回 main 后改 CLAUDE.md**

在 `## 操作日志法定留存` 一节之前加一小节（用 Bash 写入，仓库守卫会拦 Edit 与 Write）：

```markdown
## 项目管理慢接口「处理中」契约（2026-11-25）

- 项目管理下同步跑 OCR / 大模型的路由用 `@PmiPending(label)`（`project-management/pmi-pending.interceptor.ts`）：请求最多等到「到达后第 13 秒」（上限 8 秒），等不到回 `202 { pending: true, jobId }`，处理函数转后台继续；前端封装层（`apps/web/src/lib/api/pm-pending.ts`）凭单号长轮询 `GET /api/project-management/pending-jobs/:jobId` 自动重取，调用方不改。**新增同类慢接口时照此接入**，不要靠放宽 `proxy.ts` 超时档。
- 附件上传（`PmiStageUploadService`）：落盘并建附件记录即返回；正文提取按项目串行转后台，未完成时响应带 `extractedPending: true` 与 `pendingJobId`。前端在封装层统一跟踪这些任务（`apps/web/src/lib/api/pmi-extraction-tracker.ts`），详情面板显示「文字识别中…」并在完成后自动更新。
- 转后台任务的字段写入走 `ExtractedFieldWriter`：只写自任务启动以来没人改过的字段；上传提取在附件被删后不再写入。操作日志记任务结束时的最终状态（`operation-log/deferred-oplog.ts`），上传照旧在响应时记。
- 任务登记表在进程内存里（单副本假设）；api 与 web 门户镜像须同批部署。spec：`docs/superpowers/specs/2026-11-25-pmi-heavy-endpoints-pending-design.md`
```

确认当时只有 `CLAUDE.md` 一个已跟踪文件有改动，再单独提交。

---

## 合回 main 之后的真实链路验证

隔离工作区里不能另起 API 实例，所以下列检查在 `git merge --ff-only feat/pmi-pending` 之后、dev 链重启完成后做。

1. **API 起得来**：`:4001` 监听、`/api/docs` 返回 200，日志里没有 `UnknownDependenciesException` 一类注入错误。
2. **上传扫描件**：用 staff 账号在浏览器里真实登录（记忆里「离线签发无 sid 令牌」的办法只用于只读探测，不要拿来做上传），向某测试项目的「专家抽取」步骤上传一份多页扫描件。预期：13 秒内返回 201，体里有 `extractedPending: true` 与 `pendingJobId`；随后 `GET /api/project-management/pending-jobs/<jobId>` 先回 `{ status: 'running' }`，识别完成后回 `{ status: 'done', result: { extractedInfo: … } }`。
3. **标记完成**：对同一项目点「标记完成」。预期：界面保持等待不报超时；操作日志里这一条的状态码是最终码，不是 202。
4. **操作日志**：查最近的操作日志，确认没有 `GET /api/project-management/pending-jobs/…` 的记录。
5. **浏览器走一遍**（:3005 项目详情面板）：上传数字版文件照旧立即带出提取信息；上传扫描件显示「文字识别中…」，完成后提取信息自动出现；识别未完成时打开直接采购「谈判文件」的完成确认弹窗，能看到提示句。
6. 测试项目与上传的附件用完即删，不留在实时库里。
