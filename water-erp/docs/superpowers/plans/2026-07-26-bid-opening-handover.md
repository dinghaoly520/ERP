# 开标流转重设计（交回机制 + :3007 工作区恢复）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** :3005 流转决策权不动；:3007 新增「完成开标·移交」（开标文件包存 MinIO + WS 事件 + 站内信），并恢复 `/bid/project/[id]` 只读工作区（评标管理/评分标准 tab）。

**Architecture:** 后端纯增量：1 个幂等新端点 `POST /bid/projects/:id/complete-opening`（H4 同口径守卫抽共享方法）、`BidOpeningSession` 加 2 列、1 个 WS 事件、2 条通知。前端：:3007 大厅横幅三态化 + 工作区三 tab（组件从 :3005 现状移植改只读）；:3005 只加"资料已接收"提示块与 `panel=bid-confirm` 深链。

**Tech Stack:** NestJS 11 + Prisma（PostgreSQL）+ Socket.IO；Next.js 16 App Router（:3007/:3005）；jest（API 单测/E2E）；MinIO（StorageService 全局模块）。

## Global Constraints

- 设计文档：`docs/superpowers/specs/2026-07-26-bid-opening-handover-design.md`（v2），有冲突以 spec 为准。
- **迁移铁律**：禁止交互式 `prisma migrate dev`（会 reset 丢数据）；本库存在存量 drift，**不得**用 `--create-only` 生成 diff（会带出 OperationLog 分区表等无关 DDL）——手写 migration.sql + `db execute` + `migrate resolve --applied`。
- **TS import 约定**：tsconfig 无 `esModuleInterop`；CJS 函数导出包用 `import x = require('pkg')`。
- **受保护下载链接**：`<a target="_blank">` 指向 `/api/upload/files/*` 时 `rel="noopener"`，**禁止 noreferrer**（丢 Referer → portal 识别失败 401）。
- **提交纪律**：每个任务 commit 前 `git branch --show-current` 确认分支（多会话共库）；只 `git add` 本任务文件；**不 push**（完成后仅提醒）。
- :3007 样式走 cgzxui 浅色新拟态（`neu-card-static`/`neu-table`/`neu-btn-*`），不引入暗色旧组件。
- 前端不引 `--webpack`；共享包改动后 `pnpm --filter @water-erp/shared build`。
- commit 信息末尾：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

# Phase 1：交回机制 + :3005 深链（可独立验收上线）

### Task 1：Schema 迁移——BidOpeningSession 两列

**Files:**
- Modify: `apps/api/prisma/schema.prisma:371-384`（`model BidOpeningSession`）
- Create: `apps/api/prisma/migrations/20260726000000_bid_opening_session_handover/migration.sql`

**Interfaces:**
- Produces: `BidOpeningSession.handoverAssetId String?` / `handoverAt DateTime?`（Task 4/5 依赖）

- [ ] **Step 1：编辑 schema.prisma**

在 `model BidOpeningSession` 的 `exchangeControl` 行后、`project` 关系行前插入：

```prisma
  handoverAssetId    String?    // 开标文件包 FileAsset 引用（完成开标·移交后写入）
  handoverAt         DateTime?  // 移交时间
```

- [ ] **Step 2：手写迁移 SQL**

创建 `apps/api/prisma/migrations/20260726000000_bid_opening_session_handover/migration.sql`：

```sql
-- AlterTable
ALTER TABLE "BidOpeningSession" ADD COLUMN "handoverAssetId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN "handoverAt" TIMESTAMP(3);
```

- [ ] **Step 3：应用并登记迁移**

Run:
```bash
cd apps/api
pnpm prisma db execute --file prisma/migrations/20260726000000_bid_opening_session_handover/migration.sql --schema prisma/schema.prisma
pnpm prisma migrate resolve --applied 20260726000000_bid_opening_session_handover
pnpm db:generate
```
Expected：两条 ALTER 成功；resolve 输出 `Migration 20260726000000_bid_opening_session_handover marked as applied`；generate 无错误。若 `db execute` 报列已存在，说明库先行过，直接执行 resolve + generate。

- [ ] **Step 4：提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260726000000_bid_opening_session_handover/
git commit -m "feat(api): BidOpeningSession 增加 handoverAssetId/handoverAt（开标移交）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2：shared 事件常量 + 载荷类型

**Files:**
- Modify: `packages/shared/src/bid-events.ts`（`BID_EVENT` 常量表 + 载荷类型区）

**Interfaces:**
- Produces: `BID_EVENT.OPENING_COMPLETED = 'opening:completed'`；`OpeningCompletedPayload { projectId; handoverAt: string; handoverAssetId: string; timestamp: number }`（Task 3/8/10 依赖）

- [ ] **Step 1：加常量**

`BID_EVENT` 对象 `OPENING_DISPUTE_RESOLVED` 行后追加：

```ts
  OPENING_COMPLETED: 'opening:completed',
```

- [ ] **Step 2：加载荷类型**

在 `OpeningDisputeResolvedPayload` 接口之后追加：

```ts
export interface OpeningCompletedPayload {
  projectId: string;
  handoverAt: string;       // ISO
  handoverAssetId: string;  // FileAsset.id
  timestamp: number;
}
```

- [ ] **Step 3：构建共享包**

Run: `pnpm --filter @water-erp/shared build`
Expected：编译成功，`packages/shared/dist/` 更新。

- [ ] **Step 4：提交**

```bash
git add packages/shared/src/bid-events.ts
git commit -m "feat(shared): 新增 opening:completed 事件与载荷类型

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3：Gateway 通知方法

**Files:**
- Modify: `apps/api/src/bid/bid.gateway.ts:258-261`（`notifyOpeningStarted` 之后）

**Interfaces:**
- Consumes: `BID_EVENT.OPENING_COMPLETED`、`OpeningCompletedPayload`（Task 2）
- Produces: `gateway.notifyOpeningCompleted(projectId, { handoverAt, handoverAssetId })`（Task 5 调用）

- [ ] **Step 1：加 import 与方法**

文件头 `@water-erp/shared` import 列表追加 `OpeningCompletedPayload`；在 `notifyOpeningStarted` 方法之后插入：

```ts
  notifyOpeningCompleted(projectId: string, data: { handoverAt: string; handoverAssetId: string }) {
    const payload: OpeningCompletedPayload = { projectId, handoverAt: data.handoverAt, handoverAssetId: data.handoverAssetId, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.OPENING_COMPLETED, payload);
  }
```

- [ ] **Step 2：编译检查**

Run: `pnpm --filter api exec tsc --noEmit -p tsconfig.json`
Expected：零错误。

- [ ] **Step 3：提交**

```bash
git add apps/api/src/bid/bid.gateway.ts
git commit -m "feat(api): gateway 新增 notifyOpeningCompleted（project 房间广播）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4：抽共享守卫 assertOpeningDone + 单测

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:748-764`（`startEvaluation` 内联 H4 块）
- Test: `apps/api/src/bid/bid-handover.spec.ts`（新建，Task 5 复用）

**Interfaces:**
- Produces: `private async assertOpeningDone(id: string): Promise<void>`——口径与原 H4 完全一致（未撤回供应商全到终局：SUCCESS+CONFIRMED/EXCEPTION 或 DANGER；否则 409 `OPENING_NOT_DONE` 带名单）

- [ ] **Step 1：写失败测试**

创建 `apps/api/src/bid/bid-handover.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ClarificationAiService } from './clarification-ai.service';
import { BidGateway } from './bid.gateway';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { StorageService } from '../storage/storage.service';

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn().mockResolvedValue({}), putObject: jest.fn().mockResolvedValue({}) },
  MINIO_BUCKET: 'test-bucket',
}));

function makePrismaMock() {
  const tx: any = {
    $queryRaw: jest.fn(),
    bidProject: { findUnique: jest.fn() },
    bidOpeningSession: { findUnique: jest.fn(), update: jest.fn() },
    fileAsset: { create: jest.fn() },
    bidSupervisionLog: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma: any = {
    bidProject: { findUnique: jest.fn() },
    bidOpeningSession: { findUnique: jest.fn() },
    bidSupplier: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
    bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
    bidSupervisionLog: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    __tx: tx,
  };
  return prisma;
}

async function buildService(prisma: any) {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      BidService,
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue(undefined) } },
      { provide: ScoreStandardValidator, useValue: { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
      { provide: ClarificationAiService, useValue: {} },
      { provide: BidGateway, useValue: { notifyOpeningCompleted: jest.fn(), notifySupervisionLog: jest.fn(), notifyStageChange: jest.fn() } },
      { provide: StorageService, useValue: { upload: jest.fn().mockResolvedValue(undefined) } },
      // BidService 构造器中 @InjectQueue 的可选队列：提供空令牌避免 DI 报错
      { provide: 'BullQueue_tender-processing', useValue: {} },
    ],
  }).compile();
  return moduleRef.get(BidService);
}

describe('completeOpening / assertOpeningDone', () => {
  it('开标未完成（有供应商未解密）→ 409 OPENING_NOT_DONE 且带名单', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', name: '测试项目', stage: 'OPENING', procurementMethod: '公开招标', openTime: new Date(), deadline: new Date(), projectManagementItemId: null });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', host: '主持', supervisor: '监督', status: '待开标' });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierName: '甲公司', decryptStatus: 'PENDING', confirmStatus: 'PENDING', submitStatus: '已投递' },
    ]);
    await expect(svc.completeOpening('p1', 'user1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'OPENING_NOT_DONE' },
    });
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter api test -- bid-handover`
Expected：FAIL——`svc.completeOpening is not a function`。

- [ ] **Step 3：抽共享方法并改造 startEvaluation**

`bid.service.ts` 中，在 `startEvaluation` 方法**之前**插入：

```ts
  /**
   * H4 共享守卫：开标完成度——未撤回供应商须全部到终局态
   * （SUCCESS+CONFIRMED/EXCEPTION 或 DANGER）。startEvaluation 与
   * completeOpening（开标移交）共用，保证两处永远同口径。
   * 不满足 → 409 OPENING_NOT_DONE（附未到终局态供应商名单）。
   */
  private async assertOpeningDone(id: string): Promise<void> {
    const activeSuppliers = await this.prisma.bidSupplier.findMany({
      where: { projectId: id, submitStatus: { not: '已撤回' } },
      select: { supplierName: true, decryptStatus: true, confirmStatus: true },
    });
    const notReady = activeSuppliers.filter(s => {
      if (s.decryptStatus === 'DANGER') return false;                              // 解密异常已定性
      if (s.decryptStatus !== 'SUCCESS') return true;                              // PENDING/RUNNING 未解密
      return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';   // 解密成功但确认未闭环
    });
    if (notReady.length > 0) {
      throw new ConflictException({
        error: `开标尚未完成，以下供应商未到终局态（解密/确认/异议未结）：${notReady.map(s => s.supplierName).join('、')}`,
        code: 'OPENING_NOT_DONE',
      });
    }
  }
```

然后把 `startEvaluation` 中以 `// H4: 开标完成度守卫` 开头、到其 `if (notReady.length > 0) {...}` 结束的整段内联代码（bid.service.ts:748-764）替换为：

```ts
    // H4: 开标完成度守卫（抽共享方法，与 completeOpening 同口径）
    await this.assertOpeningDone(id);
```

- [ ] **Step 4：临时补最小 completeOpening 桩使测试可运行**

在 `startOpening` 方法附近插入（Task 5 会替换为完整实现）：

```ts
  async completeOpening(id: string, _actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id }, select: { stage: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    await this.assertOpeningDone(id);
    return { status: '开标完成' };
  }
```

- [ ] **Step 5：跑测试确认通过**

Run: `pnpm --filter api test -- bid-handover`
Expected：PASS（1 个用例）。

- [ ] **Step 6：跑既有套件防回归**

Run: `pnpm --filter api test -- bid.service`
Expected：既有 bid.service.spec 全绿（startEvaluation 行为不变）。

- [ ] **Step 7：提交**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid-handover.spec.ts
git commit -m "refactor(api): 抽 assertOpeningDone 共享守卫（startEvaluation/completeOpening 同口径）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5：completeOpening 完整实现 + 单测

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（Task 4 的桩替换为完整实现；构造器加 `StorageService`；文件头 import）
- Test: `apps/api/src/bid/bid-handover.spec.ts`（追加 5 个用例）

**Interfaces:**
- Consumes: `assertOpeningDone`（Task 4）、`gateway.notifyOpeningCompleted`（Task 3）、`StorageService.upload`（全局模块）、`lockAndReassertStage`（既有）
- Produces: `completeOpening(id, actorId?)` → `{ status: '开标完成', handoverAt, handoverAssetId, downloadUrl }`；幂等（已移交返回既有 asset，不重传 MinIO）

- [ ] **Step 1：追加失败测试**

`bid-handover.spec.ts` 的 describe 内追加：

```ts
  const OPENING_PROJECT = { id: 'p1', projectCode: 'C1', name: '测试项目', stage: 'OPENING', procurementMethod: '公开招标', openTime: new Date('2026-07-01'), deadline: new Date('2026-06-30'), projectManagementItemId: 'pm1' };
  const SESSION = { projectId: 'p1', host: '李主任', supervisor: '周老师', status: '待开标', decryptWindowStart: new Date(), decryptWindowEnd: new Date() };

  it('非 OPENING 阶段 → 409 OPENING_STAGE_REQUIRED', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue({ ...OPENING_PROJECT, stage: 'EVALUATING' });
    await expect(svc.completeOpening('p1')).rejects.toMatchObject({ response: { code: 'OPENING_STAGE_REQUIRED' } });
  });

  it('OPENING 但未组建会话 → 409 SESSION_NOT_FOUND', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    await expect(svc.completeOpening('p1')).rejects.toMatchObject({ response: { code: 'SESSION_NOT_FOUND' } });
  });

  it('正常移交：生成文件包、写 FileAsset、会话置「开标完成」、stage 保持 OPENING', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(SESSION);
    prisma.__tx.bidOpeningSession.findUnique.mockResolvedValue(SESSION);
    prisma.__tx.fileAsset.create.mockResolvedValue({ id: 'asset_1', key: 'bid-opening-handover/p1.json' });
    prisma.__tx.bidOpeningSession.update.mockResolvedValue({ ...SESSION, status: '开标完成', handoverAt: new Date(), handoverAssetId: 'asset_1' });
    prisma.__tx.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT); // lockAndReassertStage 复查
    const r = await svc.completeOpening('p1', 'user1');
    expect(r.handoverAssetId).toBe('asset_1');
    expect(r.downloadUrl).toBe('/api/upload/files/asset_1');
    expect(prisma.__tx.bidOpeningSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: '开标完成' }),
    }));
    expect(prisma.__tx.fileAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: 'bid_opening_handover', key: 'bid-opening-handover/p1.json' }),
    }));
  });

  it('幂等：已「开标完成」直接返回既有 asset，不再上传', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    const done = { ...SESSION, status: '开标完成', handoverAt: new Date(), handoverAssetId: 'asset_old' };
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(done);
    const storage = (svc as any).storage as { upload: jest.Mock };
    const r = await svc.completeOpening('p1');
    expect(r.handoverAssetId).toBe('asset_old');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('并发幂等：事务内复查已移交 → 返回既有会话', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(OPENING_PROJECT);
    prisma.bidOpeningSession.findUnique.mockResolvedValue(SESSION); // 事务外看未移交
    prisma.__tx.bidOpeningSession.findUnique.mockResolvedValue({ ...SESSION, status: '开标完成', handoverAt: new Date(), handoverAssetId: 'asset_race' });
    const r = await svc.completeOpening('p1');
    expect(r.handoverAssetId).toBe('asset_race');
    expect(prisma.__tx.fileAsset.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter api test -- bid-handover`
Expected：5 个新用例 FAIL（桩实现无 stage/session 校验、无 asset）。

- [ ] **Step 3：实现——构造器与 import**

`bid.service.ts` 文件头追加：

```ts
import * as crypto from 'crypto';
import { StorageService } from '../storage/storage.service';
```

构造器参数列表（`private readonly scoreStandardValidator: ScoreStandardValidator,` 之后）追加：

```ts
    private readonly storage: StorageService,
```

- [ ] **Step 4：实现——文件包构建器**

替换 Task 4 的桩，并在其后加私有方法：

```ts
  /**
   * 完成开标·资料移交（幂等，不改 stage）。
   * 开标执行端 :3007 在开标完成后调用：生成开标文件包（JSON + sha256）存 MinIO，
   * FileAsset 引用挂到 BidOpeningSession，WS 广播 opening:completed，
   * 并向 leader/staff 发站内信（深链直达 :3005 开标确认面板）。
   * 非闸门：:3005 启动评标不依赖本动作（H4 口径独立满足即可）。
   */
  async completeOpening(id: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, name: true, stage: true, procurementMethod: true, openTime: true, deadline: true, projectManagementItemId: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new ConflictException({
        error: `当前阶段 ${project.stage}，仅开标阶段可完成开标移交`,
        code: 'OPENING_STAGE_REQUIRED',
      });
    }
    const existing = await this.prisma.bidOpeningSession.findUnique({ where: { projectId: id } });
    if (!existing) {
      throw new ConflictException({ error: '开标会话尚未组建', code: 'SESSION_NOT_FOUND' });
    }
    // 幂等：已移交直接返回既有产物
    if (existing.status === '开标完成') {
      return {
        status: existing.status,
        handoverAt: existing.handoverAt,
        handoverAssetId: existing.handoverAssetId,
        downloadUrl: existing.handoverAssetId ? `/api/upload/files/${existing.handoverAssetId}` : null,
      };
    }
    await this.assertOpeningDone(id);

    // 文件包与上传放在事务之前：MinIO 失败 → 零数据库副作用，可安全重试
    const pkg = await this.buildHandoverPackage(project, existing);
    const buffer = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
    const objectKey = `bid-opening-handover/${id}.json`;
    await this.storage.upload(objectKey, buffer, 'application/json');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const session = await this.prisma.$transaction(async (tx) => {
      await this.lockAndReassertStage(tx, id, 'OPENING'); // 行锁复查：防并发归档/流标偷跑
      const fresh = await tx.bidOpeningSession.findUnique({ where: { projectId: id } });
      if (fresh?.status === '开标完成') return fresh; // 并发幂等：后提交方走既有产物
      const now = new Date();
      const asset = await tx.fileAsset.create({
        data: {
          key: objectKey,
          originalName: `开标文件包-${project.projectCode}.json`,
          mimeType: 'application/json',
          size: buffer.length,
          sha256,
          category: 'bid_opening_handover',
          uploaderId: actorId ?? null,
        },
      });
      const updated = await tx.bidOpeningSession.update({
        where: { projectId: id },
        data: { status: '开标完成', handoverAt: now, handoverAssetId: asset.id },
      });
      await tx.bidSupervisionLog.create({
        data: { projectId: id, time: now, role: existing.host, target: project.name, action: '完成开标·资料移交', result: '开标文件包已生成并移交采购管理工作台', riskFlag: '无' },
      });
      if (actorId) {
        await tx.auditLog.create({ data: { userId: actorId, action: 'BID_OPENING_HANDOVER', resourceType: `BidProject:${id}`, details: { assetId: asset.id, sha256 } } });
      }
      return updated;
    });

    // 事务后通知（失败不阻塞，同 abort 通知模式）
    this.gateway?.notifyOpeningCompleted(id, {
      handoverAt: (session.handoverAt ?? new Date()).toISOString(),
      handoverAssetId: session.handoverAssetId ?? '',
    });
    this.gateway?.notifySupervisionLog(id, { role: existing.host, action: '完成开标·资料移交', target: project.name, result: '开标文件包已生成并移交采购管理工作台', riskFlag: '无' });
    const pmLink = project.projectManagementItemId
      ? `/projects?projectId=${project.projectManagementItemId}&panel=bid-confirm`
      : '/projects';
    for (const role of ['leader', 'staff']) {
      try {
        await this.notificationService.sendToRole(role, {
          type: 'BID_OPENING_HANDED_OVER',
          title: `项目${project.name}开标完成，资料已移交`,
          content: '开标文件包已生成，可在开标确认面板启动评标或执行后续流程',
          link: pmLink,
        });
      } catch { /* 通知失败不阻塞移交 */ }
    }

    return {
      status: '开标完成',
      handoverAt: session.handoverAt,
      handoverAssetId: session.handoverAssetId,
      downloadUrl: `/api/upload/files/${session.handoverAssetId}`,
    };
  }

  /** 开标文件包：开标环节全部资料（会话/供应商/开标记录/监督日志）+ 内容指纹。 */
  private async buildHandoverPackage(
    project: { id: string; projectCode: string; name: string; procurementMethod: string; openTime: Date; deadline: Date; stage: string },
    session: { host: string; supervisor: string; decryptWindowStart: Date; decryptWindowEnd: Date; status: string },
  ) {
    const [suppliers, records, logs] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: project.id },
        select: { supplierName: true, receiptNo: true, encryptStatus: true, decryptStatus: true, confirmStatus: true, submitStatus: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidOpeningRecord.findMany({
        where: { projectId: project.id },
        select: { supplierName: true, amount: true, period: true, qualityTarget: true, bondStatus: true, confirmStatus: true, objectionReason: true, handleResult: true },
      }),
      this.prisma.bidSupervisionLog.findMany({
        where: { projectId: project.id },
        select: { time: true, role: true, action: true, target: true, result: true, riskFlag: true },
        orderBy: { time: 'asc' },
      }),
    ]);
    const active = suppliers.filter(s => s.submitStatus !== '已撤回');
    const summary = {
      supplierTotal: suppliers.length,
      active: active.length,
      decrypted: active.filter(s => s.decryptStatus === 'SUCCESS').length,
      decryptFailed: active.filter(s => s.decryptStatus === 'DANGER').length,
      recorded: records.length,
      confirmed: active.filter(s => s.confirmStatus === 'CONFIRMED').length,
      disputed: active.filter(s => s.confirmStatus === 'DISPUTED').length,
      withdrawn: suppliers.length - active.length,
    };
    const body = {
      packageType: 'BID_OPENING_HANDOVER',
      packageVersion: 1,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id, projectCode: project.projectCode, name: project.name,
        procurementMethod: project.procurementMethod,
        openTime: project.openTime.toISOString(), deadline: project.deadline.toISOString(),
        stage: project.stage,
      },
      session: {
        host: session.host, supervisor: session.supervisor,
        decryptWindowStart: session.decryptWindowStart.toISOString(),
        decryptWindowEnd: session.decryptWindowEnd.toISOString(),
      },
      suppliers,
      openingRecords: records,
      supervisionLogs: logs,
      summary,
    };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return { ...body, fingerprint };
  }
```

- [ ] **Step 5：跑测试确认通过**

Run: `pnpm --filter api test -- bid-handover`
Expected：6 个用例全 PASS。

- [ ] **Step 6：全量单测防回归**

Run: `pnpm --filter api test`
Expected：全绿。若出现 DI 报错（其他 spec 实例化 BidService），在相应 spec 的 providers 补 `{ provide: StorageService, useValue: { upload: jest.fn() } }`。

- [ ] **Step 7：提交**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid-handover.spec.ts
git commit -m "feat(api): completeOpening 完成开标·资料移交（文件包存 MinIO，幂等，不改 stage）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6：Controller 路由 + E2E 全链路

**Files:**
- Modify: `apps/api/src/bid/bid.controller.ts`（`startEvaluation` 路由之后）
- Test: `apps/api/test/bid.e2e-spec.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `bidService.completeOpening`（Task 5）
- Produces: `POST /api/bid/projects/:id/complete-opening`

- [ ] **Step 1：加路由**

`bid.controller.ts` 的 `startEvaluation` 方法之后插入：

```ts
  @Post('projects/:id/complete-opening')
  @ApiOperation({ summary: '完成开标·资料移交（生成开标文件包回传 :3005；幂等，不改 stage）' })
  completeOpening(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.bidService.completeOpening(id, userId);
  }
```

- [ ] **Step 2：写 E2E**

`apps/api/test/bid.e2e-spec.ts` 末尾追加（复用文件内既有 `loginAs`、`adminCookie` 与项目创建模式——参照套件首个测试的 `POST /api/bid/projects` 建项目写法，`deadline` 设为过去时间）：

```ts
describe('完成开标·资料移交 (complete-opening, e2e)', () => {
  let projectId: string;

  beforeAll(async () => {
    // 创建一个 deadline 已过的最小项目（字段参照本套件既有建项目用例）
    const createRes = await request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', adminCookie)
      .send({
        name: '移交测试项目',
        projectCode: `HO-${Date.now()}`,
        procurementMethod: '公开招标',
        budget: 1000000,
        deadline: new Date(Date.now() - 86400_000).toISOString(),
        openTime: new Date(Date.now() - 43200_000).toISOString(),
      });
    projectId = createRes.body.id;
    // 确定开标（裸推阶段，不建会话）
    await request(app.getHttpServer()).post(`/api/bid/projects/${projectId}/open`).set('Cookie', adminCookie).send({});
  });

  afterAll(async () => {
    await prisma.bidSupervisionLog.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.bidOpeningSession.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.fileAsset.deleteMany({ where: { category: 'bid_opening_handover', key: `bid-opening-handover/${projectId}.json` } }).catch(() => {});
    await prisma.bidProject.delete({ where: { id: projectId } }).catch(() => {});
  });

  it('未组建会话 → 409 SESSION_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/complete-opening`).set('Cookie', adminCookie).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SESSION_NOT_FOUND');
  });

  it('组建会话后移交成功 → 文件包可下载、stage 保持 OPENING、幂等返回同一 asset', async () => {
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/open`)
      .set('Cookie', adminCookie)
      .send({
        host: '测试主持', supervisor: '测试监督',
        decryptWindowStart: new Date(Date.now() - 3600_000).toISOString(),
        decryptWindowEnd: new Date(Date.now() + 3600_000).toISOString(),
      });

    const r1 = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/complete-opening`).set('Cookie', adminCookie).send({});
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe('开标完成');
    const assetId = r1.body.handoverAssetId;
    expect(assetId).toBeTruthy();

    // stage 未被改动
    const proj = await prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    expect(proj?.stage).toBe('OPENING');

    // 文件包可下载且内容齐全
    const dl = await request(app.getHttpServer())
      .get(`/api/upload/files/${assetId}`).set('Cookie', adminCookie).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    const pkg = JSON.parse((dl.body as Buffer).toString('utf8'));
    expect(pkg.packageType).toBe('BID_OPENING_HANDOVER');
    expect(pkg.project.projectCode).toBeTruthy();
    expect(pkg.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // 幂等
    const r2 = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/complete-opening`).set('Cookie', adminCookie).send({});
    expect(r2.status).toBe(201);
    expect(r2.body.handoverAssetId).toBe(assetId);
  });

  it('不移交也能启动评标的前提守卫仍生效（无专家 → NO_EXPERTS_ASSIGNED，证明非门控）', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/start-evaluation`).set('Cookie', adminCookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_EXPERTS_ASSIGNED'); // 报的是专家缺失而非"未移交"——交回非闸门
  });
});
```

- [ ] **Step 3：跑 E2E**

Run: `pnpm --filter api test:e2e -- bid.e2e-spec`
Expected：全绿（含新增 3 个用例）。注意：需 MinIO 在线（`pnpm infra:up`）。

- [ ] **Step 4：提交**

```bash
git add apps/api/src/bid/bid.controller.ts apps/api/test/bid.e2e-spec.ts
git commit -m "feat(api): complete-opening 路由 + E2E 全链路（移交/下载/幂等/非门控回归）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7：确定开标时通知 bid_host

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:614-663`（`startOpeningInternal` 尾部）

**Interfaces:**
- Produces: :3005 按时开标（isTransitioning）后 bid_host 收到站内信，link `/bid/project/<id>`

- [ ] **Step 1：改造返回路径**

`startOpeningInternal` 末尾当前是 `return this.prisma.$transaction(async (tx) => { ... });`。改为先接收再通知：

```ts
    const updated = await this.prisma.$transaction(async (tx) => {
      // …事务体保持不变…
    });

    // 流入侧通知：仅阶段推进（:3005 按时开标）时发；:3007 组建会话的同阶段调用不重复发
    if (isTransitioning) {
      try {
        await this.notificationService.sendToRole('bid_host', {
          type: 'BID_OPENING_CONFIRMED',
          title: `项目${project.name}已确定开标`,
          content: '请前往开标大厅组建会话（填写主持人、监督人与解密窗口）',
          link: `/bid/project/${id}`,
        });
      } catch { /* 通知失败不阻塞阶段流转 */ }
    }
    return updated;
```

（事务体内最后一行 `return updated;` 保持不变——它是事务的返回值。）

- [ ] **Step 2：单测防回归 + 编译**

Run: `pnpm --filter api test -- bid && pnpm --filter api exec tsc --noEmit -p tsconfig.json`
Expected：全绿。

- [ ] **Step 3：提交**

```bash
git add apps/api/src/bid/bid.service.ts
git commit -m "feat(api): 确定开标后给 bid_host 发站内信（流入 :3007 有体感）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8：:3007 前端——API 客户端 + WS hook + 类型

**Files:**
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（文件末尾追加）
- Modify: `apps/bid-portal/src/hooks/use-bid-websocket.ts`（handlers 接口 + 订阅）
- Modify: `apps/bid-portal/src/lib/types.ts`（`openingSession` 类型）

**Interfaces:**
- Consumes: `OpeningCompletedPayload`（Task 2）
- Produces: `completeOpening(projectId)`、`listEvaluationResults(projectId)`（Task 14 用）、`onOpeningCompleted` handler

- [ ] **Step 1：API 客户端**

`apps/bid-portal/src/lib/api/bid.ts` 末尾追加：

```ts
/* ── 完成开标·资料移交（开标完成后主持人一键交回 :3005；幂等）── */

export interface HandoverResult {
  status: string;
  handoverAt: string | null;
  handoverAssetId: string | null;
  downloadUrl: string | null;
}

export function completeOpening(projectId: string) {
  return api.post<HandoverResult>(`/bid/projects/${projectId}/complete-opening`, {});
}

/* ── 工作区·评标管理（只读）：评标结果汇总 ── */

export interface EvaluationResultRow {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  rank: number;
  recommended: boolean;
}

export function listEvaluationResults(projectId: string) {
  return api.get<EvaluationResultRow[]>(`/bid/projects/${projectId}/evaluation-results`);
}
```

- [ ] **Step 2：WS hook 加 opening:completed**

`apps/bid-portal/src/hooks/use-bid-websocket.ts`：shared import 列表追加 `type OpeningCompletedPayload`；`BidWsHandlers` 接口追加：

```ts
  onOpeningCompleted?: (d: OpeningCompletedPayload) => void;
```

订阅注册区（`on(BID_EVENT.OPENING_DISPUTE_RESOLVED, ...)` 之后）追加：

```ts
    on(BID_EVENT.OPENING_COMPLETED, 'onOpeningCompleted');
```

- [ ] **Step 3：类型补充**

`apps/bid-portal/src/lib/types.ts` 中 `BidProjectDetail['openingSession']` 的对象类型追加两个可选字段（若该类型为内联对象；若是 `any` 则跳过）：

```ts
  handoverAt?: string | null;
  handoverAssetId?: string | null;
```

- [ ] **Step 4：类型检查**

Run: `pnpm --filter bid-portal exec tsc --noEmit`
Expected：零错误。

- [ ] **Step 5：提交**

```bash
git add apps/bid-portal/src/lib/api/bid.ts apps/bid-portal/src/hooks/use-bid-websocket.ts apps/bid-portal/src/lib/types.ts
git commit -m "feat(bid-portal): completeOpening 客户端 + opening:completed 订阅 + 会话类型

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9：:3007 大厅横幅——交回三态 + ABORTED 终局

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx:489-531`（两段横幅）

**Interfaces:**
- Consumes: `completeOpening`（Task 8）、`project.openingSession.handoverAt/handoverAssetId`

- [ ] **Step 1：import 与状态**

文件头 `@/lib/api` import 列表追加 `completeOpening`；组件内状态区（`const [disputeSubmitting, ...]` 附近）追加：

```tsx
  const [handingOver, setHandingOver] = useState(false);
```

handler 区追加：

```tsx
  const handleHandover = async () => {
    if (!projectId || handingOver) return;
    setHandingOver(true);
    try {
      await completeOpening(projectId);
      toast.success('开标资料已移交采购管理工作台');
      const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(updated);
    } catch (e: any) {
      toast.error(e?.message || '移交失败');
    } finally {
      setHandingOver(false);
    }
  };
```

- [ ] **Step 2：终局横幅加 ABORTED**

将 `{(project.stage === 'EVALUATING' || project.stage === 'ARCHIVED') && (` 横幅块改为：

```tsx
      {(project.stage === 'EVALUATING' || project.stage === 'ARCHIVED' || project.stage === 'ABORTED') && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标已结束</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">
              {project.stage === 'ABORTED'
                ? '本项目已流标，后续处理（流标公告）请在采购管理工作台（:3005）操作；本页仅供查看开标过程记录。'
                : `本项目已进入${project.stage === 'EVALUATING' ? '评标阶段' : '归档状态'}，后续评标管理与归档请在采购管理工作台（:3005）操作；本页仅供查看开标过程记录。`}
            </p>
          </div>
          <a href={portalURL('web', '/projects')} target="_blank" rel="noopener"
            className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs">
            前往采购管理工作台 <ExternalLink size={13} />
          </a>
        </div>
      )}
```

- [ ] **Step 3：交回横幅三态化**

将 `{openingDone && project.stage === 'OPENING' && (` 整块替换为：

```tsx
      {/* ═══ 开标完成 · 交回 :3005（三态：待移交 / 已移交 / ——未完成时不显示）═══ */}
      {project.stage === 'OPENING' && !!session?.handoverAt && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标资料已移交</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">移交时间 {new Date(session.handoverAt).toLocaleString('zh-CN')}。开标文件包已回传采购管理工作台，后续启动评标 / 归档请前往 :3005 开标确认面板。</p>
          </div>
          <a href={portalURL('web', `/projects`)} target="_blank" rel="noopener"
            className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs">
            前往采购管理工作台 <ExternalLink size={13} />
          </a>
        </div>
      )}
      {openingDone && project.stage === 'OPENING' && !session?.handoverAt && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标完成</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">全部解密、唱标与供应商确认已完成，无待处理异议。点击下方按钮生成开标文件包并移交采购管理工作台。</p>
          </div>
          <button type="button" onClick={handleHandover} disabled={handingOver}
            className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs disabled:opacity-50">
            {handingOver ? '移交中…' : '完成开标 · 移交'}
          </button>
        </div>
      )}
```

（已移交态的深链在 Task 18 工作区上线后无需改——此处跳 :3005 列表亦可；:3005 深链 Task 11 完成后，可后续把 href 换成 `portalURL('web', `/projects?projectId=...`)`；本任务保持列表链接，避免依赖 :3005 侧的项目管理项 id。）

- [ ] **Step 4：挂 WS 刷新**

`useBidWebSocket` 的 handlers 对象内（`onOpeningConfirmed` 附近）追加：

```tsx
    onOpeningCompleted: () => {
      if (projectId) api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject).catch(() => {});
    },
```

- [ ] **Step 5：类型检查 + 本地验证**

Run: `pnpm --filter bid-portal exec tsc --noEmit`
手工：启动 `pnpm dev:api` + `pnpm dev:bid`，对一个 OPENING 且开标完成的项目（或临时用种子数据）验证横幅三态；对 ABORTED 项目验证流标横幅。

- [ ] **Step 6：提交**

```bash
git add "apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx"
git commit -m "feat(bid-portal): 开标完成横幅交回三态化 + ABORTED 终局横幅

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10：:3005 接收侧——"资料已接收"提示块

**Files:**
- Modify: `apps/web/src/hooks/use-bid-websocket.ts`（handlers + 订阅）
- Modify: `apps/web/src/components/projects/bid-confirm/opening-progress-block.tsx:120-137`（会话信息条之后）
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx:120-134`（socket 订阅处）
- Modify: `apps/web/src/lib/api/bid.ts`（`BidProjectDetail['openingSession']` 类型加字段，同 Task 8 Step 3 口径）

**Interfaces:**
- Consumes: `OpeningCompletedPayload`（Task 2）

- [ ] **Step 1：web WS hook**

`apps/web/src/hooks/use-bid-websocket.ts`：shared import 追加 `type OpeningCompletedPayload`；handlers 类型追加 `onOpeningCompleted?: (d: OpeningCompletedPayload) => void;`；订阅区追加 `on(BID_EVENT.OPENING_COMPLETED, 'onOpeningCompleted');`（按该文件既有 `on(EVENT, key)` 模式）。

- [ ] **Step 2：面板订阅**

`bid-confirm-panel.tsx` 的 `useBidWebSocket` handlers 内追加：

```ts
    onOpeningCompleted: () => { if (isOpen) void load(); },
```

- [ ] **Step 3：提示块**

`opening-progress-block.tsx` 会话信息条（`{/* 会话信息 */}` 那个 div）**之后**、`{/* 进度四联 */}` 之前插入：

```tsx
          {/* 开标资料移交接收（:3007 完成开标后回传） */}
          {openingSession.handoverAt && openingSession.handoverAssetId && (
            <div className="flex flex-wrap items-center gap-2 rounded-[14px] px-3.5 py-2.5 text-xs" style={{ background: 'color-mix(in oklch, var(--success) 8%, transparent)' }}>
              <UserCheck size={13} className="shrink-0 text-[var(--success)]" />
              <span className="font-semibold text-[var(--success)]">开标资料已接收（{formatDateTime(openingSession.handoverAt)}）</span>
              <a
                href={`/api/upload/files/${openingSession.handoverAssetId}`}
                target="_blank"
                rel="noopener"
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] hover:underline"
              >
                <FileCheck size={11} /> 下载开标文件包
              </a>
            </div>
          )}
```

（`UserCheck`/`FileCheck` 已在该文件 import 列表中；`openingSession.handoverAt/handoverAssetId` 依赖 web 侧 `BidProjectDetail` 类型——Step 0 已加。）

- [ ] **Step 4：类型检查**

Run: `pnpm --filter web exec tsc --noEmit`
Expected：零错误。

- [ ] **Step 5：提交**

```bash
git add apps/web/src/hooks/use-bid-websocket.ts apps/web/src/components/projects/bid-confirm/opening-progress-block.tsx apps/web/src/components/projects/bid-confirm-panel.tsx apps/web/src/lib/api/bid.ts
git commit -m "feat(web): 开标进度区块展示「资料已接收·下载」+ opening:completed 订阅

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 11：:3005 深链 panel=bid-confirm

**Files:**
- Modify: `apps/web/src/components/projects/project-management-page.tsx:61-82`（深链 effect）+ `ProjectDetailPanel` 渲染处
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx:282-296`（props）

**Interfaces:**
- Produces: `/projects?projectId=<id>&panel=bid-confirm` → 详情展开 + 开标确认面板自动弹出（一次性）

- [ ] **Step 1：ProjectDetailPanel 加 prop**

`project-detail-panel.tsx` 的 `export function ProjectDetailPanel({` 解构参数列表追加 `autoOpenBidConfirm = false,`，类型对象追加 `autoOpenBidConfirm?: boolean;`。组件内（`bidConfirmOpen` state 声明附近）追加：

```tsx
  // 深链自动弹开标确认面板（一次性：触发后即清标记，关闭后不复发）
  const autoOpenedBidConfirm = useRef(false);
  useEffect(() => {
    if (autoOpenBidConfirm && !autoOpenedBidConfirm.current) {
      autoOpenedBidConfirm.current = true;
      setBidConfirmOpen(true);
    }
  }, [autoOpenBidConfirm]);
```

（`useRef`/`useEffect` 该文件已 import。）

- [ ] **Step 2：列表页透传参数**

`project-management-page.tsx`：组件内 state 区追加：

```tsx
  const [autoBidConfirm, setAutoBidConfirm] = useState(false);
```

深链 effect（`const pid = ...` 那个 useEffect）内 `if (target) {` 分支里追加：

```tsx
      setAutoBidConfirm(new URLSearchParams(window.location.search).get('panel') === 'bid-confirm');
```

`<ProjectDetailPanel` 渲染处追加 prop：

```tsx
            autoOpenBidConfirm={autoBidConfirm}
```

并在其 `onClose` 回调里追加 `setAutoBidConfirm(false);`。

- [ ] **Step 3：类型检查 + 手工验证**

Run: `pnpm --filter web exec tsc --noEmit`
手工：`pnpm dev:web`，取一个种子项目管理项 id，访问 `http://localhost:3005/projects?projectId=<id>&panel=bid-confirm`（需先以 Swhi-CGZX-01 登录）→ 详情展开且开标确认面板自动弹出；关闭面板不复发；裸 `?projectId=<id>` 行为与之前一致。

- [ ] **Step 4：提交**

```bash
git add apps/web/src/components/projects/project-management-page.tsx apps/web/src/components/projects/project-detail-panel.tsx
git commit -m "feat(web): 深链 panel=bid-confirm 直达开标确认面板（交回通知落地）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 12：Phase 1 收尾——CLAUDE.md 阶段性更新

**Files:**
- Modify: `CLAUDE.md`（「开评标管理端」与「Bid Stage State Machine」段落）

- [ ] **Step 1：更新文档**

**必须经主会话 Bash 编辑**（ARS 守卫拦 Edit/Write 改 CLAUDE.md）。两处：

1. 「Bid Stage State Machine」段落"人工流转统一由 :3005……驱动"句后补一句：
   `:3007 在 OPENING 阶段内另持有「完成开标·资料移交」（POST complete-opening：开标文件包存 MinIO 回传 :3005，幂等、不改 stage，不作为启动评标的前置闸门）。`
2. 「开评标管理端」开标大厅 bullet 末尾补：`开标完成后横幅【完成开标·移交】生成开标文件包（FileAsset category=bid_opening_handover）并 WS 广播 opening:completed；:3005 开标进度区块展示「资料已接收·下载」。`

- [ ] **Step 2：提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 补充完成开标·移交机制（Phase 1）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Phase 1 验收**：按 spec §9 手工验证清单前半段走一遍（确定开标→站内信→组建会话→走完开标→交回→:3005 接收块+深链→启动评标不受影响→流标终局横幅）。提醒用户有未推送提交，等用户明确指示再 push。

---

# Phase 2：:3007 项目工作区恢复（纯前端）

### Task 13：大厅页面组件化（为 tab 复用做准备）

**Files:**
- Create: `apps/bid-portal/src/components/opening-hall.tsx`
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`（瘦身为包装器）

**Interfaces:**
- Produces: `<OpeningHall />`（无 props，内部经 `useBidProjectContext` 取数），Task 16 工作区 open tab 复用

- [ ] **Step 1：搬移**

```bash
git mv "apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx" apps/bid-portal/src/components/opening-hall.tsx
```

编辑 `opening-hall.tsx`：将默认导出函数名 `export default function BidOpenPage()` 改为具名导出 `export function OpeningHall()`（文件内自引用无其他改动）。

- [ ] **Step 2：新建瘦包装页**

创建 `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`：

```tsx
'use client';

import { OpeningHall } from '@/components/opening-hall';

/** 兼容入口：开标大厅现作为项目工作区 /bid/project/[id] 的 open tab；
 * /bid/open?id= 直达链接继续可用（Task 18 加重定向）。 */
export default function BidOpenPage() {
  return <OpeningHall />;
}
```

- [ ] **Step 3：类型检查 + 冒烟**

Run: `pnpm --filter bid-portal exec tsc --noEmit`
手工：`/bid/open?id=<种子项目>` 页面渲染与改动前一致。

- [ ] **Step 4：提交**

```bash
git add apps/bid-portal/src/components/opening-hall.tsx "apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx"
git commit -m "refactor(bid-portal): 大厅页面抽为 OpeningHall 组件（工作区 tab 复用）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 14：WS hook 补回评标事件 + 类型

**Files:**
- Modify: `apps/bid-portal/src/hooks/use-bid-websocket.ts`

**Interfaces:**
- Produces: `onExpertPresence` / `onExpertPresenceAggregate` handlers（Task 16 评标视图驱动实时刷新）

- [ ] **Step 1：加 handlers 与订阅**

shared import 列表追加 `type ExpertPresencePayload, type ExpertPresenceAggregatePayload`；`BidWsHandlers` 追加：

```ts
  onExpertPresence?: (d: ExpertPresencePayload) => void;
  onExpertPresenceAggregate?: (d: ExpertPresenceAggregatePayload) => void;
```

订阅注册区追加：

```ts
    on(BID_EVENT.EXPERT_PRESENCE, 'onExpertPresence');
    on(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, 'onExpertPresenceAggregate');
```

文件头 Phase 3 注释同步改为"评标在场事件已随只读评标管理 tab 回归"。

- [ ] **Step 2：类型检查 + 提交**

Run: `pnpm --filter bid-portal exec tsc --noEmit`

```bash
git add apps/bid-portal/src/hooks/use-bid-websocket.ts
git commit -m "feat(bid-portal): WS hook 补回评标在场事件（只读评标管理 tab 用）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 15：工作区页面骨架 + 三 tab 路由

**Files:**
- Create: `apps/bid-portal/src/app/(dashboard)/bid/project/[id]/page.tsx`
- Create: `apps/bid-portal/src/components/workspace/project-tabs.tsx`

**Interfaces:**
- Consumes: `useBidProjectContext`（provider 已支持 `params.id`）、`OpeningHall`（Task 13）
- Produces: `/bid/project/[id]?tab=` 页面；`TABS` 定义与 `getDefaultTab(stage)`（Task 16/17 的视图挂入点）

- [ ] **Step 1：tab 定义组件**

创建 `apps/bid-portal/src/components/workspace/project-tabs.tsx`：

```tsx
'use client';

import { Unlock, ClipboardCheck, ListChecks } from 'lucide-react';

export interface TabDef {
  key: 'open' | 'evaluate' | 'standard';
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  minStage: string[];
  stageHint: string;
}

export const TABS: TabDef[] = [
  {
    key: 'open',
    label: '开标大厅',
    icon: Unlock,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '开标尚未开始。请等待项目在 :3005 确定开标。',
  },
  {
    key: 'evaluate',
    label: '评标管理',
    icon: ClipboardCheck,
    minStage: ['EVALUATING', 'ARCHIVED'],
    stageHint: '评标尚未开始。当前阶段：{stage}。请等待 :3005 启动评标后查看（本页只读）。',
  },
  {
    key: 'standard',
    label: '评分标准',
    icon: ListChecks,
    minStage: ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '—',
  },
];

/** 默认 tab：EVALUATING 看评标；其余（含 ARCHIVED/ABORTED）回开标大厅 */
export function getDefaultTab(stage: string): TabDef['key'] {
  return stage === 'EVALUATING' ? 'evaluate' : 'open';
}

export function isTabAllowed(def: TabDef, stage: string): boolean {
  return def.minStage.includes(stage);
}

export default function ProjectTabs({ stage, current, onSwitch }: {
  stage: string;
  current: TabDef['key'];
  onSwitch: (key: TabDef['key']) => void;
}) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-[12px] bg-[oklch(0.95_0.008_258)] p-1 shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.12),inset_-2px_-2px_5px_oklch(1_0_0_/_0.7)]">
      {TABS.map(def => {
        const allowed = isTabAllowed(def, stage);
        const active = current === def.key;
        return (
          <button
            key={def.key}
            type="button"
            disabled={!allowed}
            title={allowed ? '' : def.stageHint.replace('{stage}', stage)}
            onClick={() => onSwitch(def.key)}
            className={`flex items-center gap-1.5 rounded-[9px] px-4 py-1.5 text-[12px] font-bold transition-all disabled:opacity-40 ${
              active
                ? 'bg-[oklch(1_0_0)] text-[color:var(--accent-strong)] shadow-[2px_2px_5px_oklch(0.55_0.03_258_/_0.14),-1px_-1px_3px_oklch(1_0_0_/_0.9)]'
                : 'text-[color:var(--muted-foreground)]'
            }`}
          >
            <def.icon size={13} /> {def.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2：工作区页面**

创建 `apps/bid-portal/src/app/(dashboard)/bid/project/[id]/page.tsx`：

```tsx
'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { TableSkeleton } from '@/components/skeleton';
import ProjectTabs, { TABS, getDefaultTab, isTabAllowed, type TabDef } from '@/components/workspace/project-tabs';
import { OpeningHall } from '@/components/opening-hall';
import EvaluationView from '@/components/workspace/evaluation-view';
import ScoreStandardView from '@/components/workspace/score-standard-view';

function WorkspaceInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { project, isLoading, error, refetch } = useBidProjectContext();
  const projectId = params.id as string;

  const stage = project?.stage ?? 'DOWNLOAD';
  const requested = searchParams.get('tab') as TabDef['key'] | null;
  const current: TabDef['key'] =
    requested && TABS.some(t => t.key === requested && isTabAllowed(t, stage))
      ? requested
      : getDefaultTab(stage);

  const switchTab = useCallback((key: TabDef['key']) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', key);
    router.replace(`/bid/project/${projectId}?${next.toString()}`, { scroll: false });
  }, [router, projectId, searchParams]);

  if (isLoading && !project) return <TableSkeleton rows={8} cols={6} />;
  if (error && !project) return <div className="py-20 text-center text-sm text-[color:var(--muted-foreground)]">{error}</div>;
  if (!project) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectTabs stage={stage} current={current} onSwitch={switchTab} />
        <span className="text-[11px] text-[color:var(--muted-foreground)]">
          {project.projectCode} · 评标管理 / 评分标准仅查看，流转操作在采购管理工作台（:3005）
        </span>
      </div>
      {current === 'open' && <OpeningHall />}
      {current === 'evaluate' && <EvaluationView projectId={projectId} onRefresh={refetch} />}
      {current === 'standard' && <ScoreStandardView projectId={projectId} />}
    </div>
  );
}

export default function ProjectWorkspacePage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
      <WorkspaceInner />
    </Suspense>
  );
}
```

（`EvaluationView`/`ScoreStandardView` 在 Task 16/17 创建——本任务先建其占位亦可，但建议按序执行：Task 16/17 先于本任务 tsc 检查。）

- [ ] **Step 3：提交**（类型检查推迟到 Task 17 后统一跑）

```bash
git add "apps/bid-portal/src/app/(dashboard)/bid/project" apps/bid-portal/src/components/workspace/project-tabs.tsx
git commit -m "feat(bid-portal): 恢复 /bid/project/[id] 工作区骨架与三 tab 路由

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 16：只读评标管理视图

**Files:**
- Create: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`

**Interfaces:**
- Consumes: `useBidProjectContext().project`（含 experts/suppliers/scoreItems/scores）、`listEvaluationResults`（Task 8）、`onExpertPresenceAggregate`（Task 14）
- Produces: `<EvaluationView projectId onRefresh />`（Task 15 挂用）；**零操作按钮**

- [ ] **Step 1：移植纯函数与组件**

从 `apps/web/src/components/projects/bid-confirm/evaluation-block.tsx` 移植以下内容到新文件 `evaluation-view.tsx`（逐段复制并改只读）：

1. `ExpertSupplierMatrix` 类型与 `buildExpertSupplierMatrix(detail)`（约 40-74 行）、`supplierPercentScores`（约 76-80 行）——原样移植。
2. 进度四联 `StatTile`（label：评分进度 / 专家签到 / 报告确认 / 得分异常数）——原样移植。
3. 专家状态卡列表（含"已签到/未签到"、进度、展开看各供应商得分）——**删除** `nudgeExperts` 催促按钮及其 busy 态。
4. 评分矩阵表（专家×供应商，偏差 >20% 标红，title 提示）——原样移植。
5. 汇总排名表（官方结果 `results` 存在时用官方排名，否则实时均分参考；含"推荐"标记）——**删除**「生成评标结果」按钮与向导（`wizardOpen` 全套）。
6. 偏差异常清单（anomalies）——原样移植。

**必须删除**（对照 :3005 原件逐项确认不留）：启动评标横幅（`stage === 'OPENING'` 的 Play 横幅整块）、`handleStartEvaluation`、`handleGenerate`、`setWizardOpen` 向导模态、所有 `nudge*` 调用。

- [ ] **Step 2：数据与实时外壳**

组件签名与取数：

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { listEvaluationResults, type EvaluationResultRow } from '@/lib/api/bid';

export default function EvaluationView({ projectId, onRefresh }: { projectId: string; onRefresh: () => void }) {
  const { project } = useBidProjectContext();
  const [results, setResults] = useState<EvaluationResultRow[]>([]);

  const loadResults = useCallback(() => {
    listEvaluationResults(projectId).then(setResults).catch(() => {});
  }, [projectId]);
  useEffect(() => { loadResults(); }, [loadResults]);

  // 评标在场事件 → 刷新项目上下文（专家签到/评分进度实时回流）+ 结果重拉
  useBidWebSocket(projectId, {
    onExpertPresence: () => { onRefresh(); },
    onExpertPresenceAggregate: () => { onRefresh(); },
    onStageChange: () => { onRefresh(); loadResults(); },
  });

  if (!project) return null;
  // …Step 1 移植的各 section 渲染…
}
```

注意：大厅页已有一个页面级 socket 连接；本视图挂载时多一条同房间连接是可接受的（socket.io 多路复用同域）。若发现重复 toast，可改为仅 `onExpertPresenceAggregate` 一条驱动 refetch。

- [ ] **Step 3：类型检查**

Run: `pnpm --filter bid-portal exec tsc --noEmit`
Expected：零错误（Task 15 页面引用的占位此时落地）。

- [ ] **Step 4：提交**

```bash
git add apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "feat(bid-portal): 只读评标管理视图（进度/专家/矩阵/汇总排名，零操作）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 17：只读评分标准视图

**Files:**
- Create: `apps/bid-portal/src/components/workspace/score-standard-view.tsx`

**Interfaces:**
- Consumes: `project.scoreItems`；`GET /bid/projects/:id/score-items/:itemId/points`（既有端点）
- Produces: `<ScoreStandardView projectId />`；**零编辑能力**

- [ ] **Step 1：实现**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { ListChecks, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useBidProjectContext } from '@/contexts/bid-project-context';

interface ScorePoint { id: string; title: string; maxScore: number; }

/** 评分标准只读展示（编制/发布/模板/AI 提取均在 :3005）。 */
export default function ScoreStandardView({ projectId }: { projectId: string }) {
  const { project } = useBidProjectContext();
  const [pointsByItem, setPointsByItem] = useState<Record<string, ScorePoint[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const items = project?.scoreItems ?? [];

  useEffect(() => {
    for (const item of items) {
      if (pointsByItem[item.id]) continue;
      api.get<ScorePoint[]>(`/bid/projects/${projectId}/score-items/${item.id}/points`)
        .then(pts => setPointsByItem(prev => ({ ...prev, [item.id]: pts })))
        .catch(() => {});
    }
  }, [items, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;
  if (items.length === 0) {
    return <div className="neu-card-static px-6 py-16 text-center text-[13px] text-[color:var(--muted-foreground)]">暂无评分标准。编制入口在采购管理工作台（:3005）开标确认面板。</div>;
  }

  const total = items.reduce((s, i) => s + Number(i.maxScore || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold"><ListChecks size={15} /> 评分标准（只读）</h2>
        <span className="text-[12px] font-mono font-bold tabular-nums text-[color:var(--accent-strong)]">总分 {total}</span>
      </div>
      {items.map(item => {
        const pts = pointsByItem[item.id];
        const isOpen = expanded.has(item.id);
        return (
          <section key={item.id} className="neu-card-static overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
              className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="flex-1 text-[13px] font-bold">{item.name}</span>
              <span className="rounded-full bg-[oklch(0.62_0.16_251_/_0.1)] px-2 py-0.5 text-[10px] font-bold text-[oklch(0.5_0.13_251)]">{item.category}</span>
              <span className="font-mono text-[12px] font-bold tabular-nums">{item.maxScore} 分</span>
            </button>
            {isOpen && (
              <div className="border-t border-[oklch(0.6_0.04_258_/_0.12)] px-5 py-3">
                {!pts ? (
                  <div className="py-2 text-[12px] text-[color:var(--muted-foreground)]">加载得分点…</div>
                ) : pts.length === 0 ? (
                  <div className="py-2 text-[12px] text-[color:var(--muted-foreground)]">无得分点</div>
                ) : (
                  <ul className="space-y-1.5">
                    {pts.map(p => (
                      <li key={p.id} className="flex items-center justify-between text-[12px]">
                        <span className="text-[color:var(--foreground)]">{p.title}</span>
                        <span className="font-mono tabular-nums text-[color:var(--muted-foreground)]">{p.maxScore}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

（`scoreItems` 元素类型字段名以 :3007 `BidProjectDetail` 为准；若 `maxScore` 为 Decimal 字符串，`Number(...)` 已兜底。）

- [ ] **Step 2：工作区整体类型检查**

Run: `pnpm --filter bid-portal exec tsc --noEmit`
Expected：零错误（Task 15/16/17 闭环）。

- [ ] **Step 3：提交**

```bash
git add apps/bid-portal/src/components/workspace/score-standard-view.tsx
git commit -m "feat(bid-portal): 只读评分标准视图（评分项+得分点展示，零编辑）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 18：入口切换——/bid/open 重定向 + 任务板/最近访问链接

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`（Task 13 的包装器改为重定向）
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/page.tsx:70`（`enterHall`）
- Modify: `apps/bid-portal/src/components/recent-projects.tsx:32`

**Interfaces:**
- Produces: 旧链接 `/bid/open?id=<id>` 302 式替换到工作区 open tab

- [ ] **Step 1：重定向页**

用以下内容**整体替换** `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`：

```tsx
'use client';

/** 兼容重定向：旧直达链接 /bid/open?id=<id> → 项目工作区 open tab。 */

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TableSkeleton } from '@/components/skeleton';

function RedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('id');
    router.replace(id ? `/bid/project/${id}?tab=open` : '/bid');
  }, [router, searchParams]);
  return <TableSkeleton rows={6} cols={6} />;
}

export default function BidOpenRedirectPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} cols={6} />}>
      <RedirectInner />
    </Suspense>
  );
}
```

- [ ] **Step 2：任务板与最近访问链接**

`bid/page.tsx`：`const enterHall = (id: string) => router.push(`/bid/open?id=${id}`);` 改为：

```tsx
  const enterHall = (id: string) => router.push(`/bid/project/${id}`);
```

`recent-projects.tsx`：`router.push(`/bid/open?id=${p.id}`);` 改为 `router.push(`/bid/project/${p.id}`);`。

- [ ] **Step 3：类型检查 + 手工验证**

Run: `pnpm --filter bid-portal exec tsc --noEmit`
手工（`pnpm dev:bid`）：
- 任务板点「进入开标大厅」→ 进工作区，OPENING 项目默认 open tab、EVALUATING 项目默认 evaluate tab；
- 旧链接 `/bid/open?id=<id>` → 自动替换到 `/bid/project/<id>?tab=open`，大厅渲染正常；
- evaluate tab：只读三区块（进度/矩阵/汇总）渲染，无任何按钮；standard tab：评分项展开得分点，无编辑控件；
- OPENING 阶段 evaluate tab 灰显、title 提示正确。

- [ ] **Step 4：提交**

```bash
git add "apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx" "apps/bid-portal/src/app/(dashboard)/bid/page.tsx" apps/bid-portal/src/components/recent-projects.tsx
git commit -m "feat(bid-portal): 入口切换至工作区；/bid/open?id= 兼容重定向

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 19：Phase 2 收尾——构建验证 + CLAUDE.md 终版

**Files:**
- Modify: `CLAUDE.md`（「开评标管理端」章节页面描述）

- [ ] **Step 1：全量构建**

Run: `pnpm --filter @water-erp/shared build && pnpm --filter bid-portal exec tsc --noEmit && pnpm --filter web exec tsc --noEmit && pnpm --filter api exec tsc --noEmit -p tsconfig.json`
Expected：四个包零错误。

- [ ] **Step 2：更新 CLAUDE.md**

经主会话 Bash 编辑。「开评标管理端」章节"页面仅两个"改为：

`页面三个：**开标任务板** (/bid，只读)、**开标大厅**（/bid/open?id= 兼容重定向）、**项目工作区**（/bid/project/[id]?tab=，三 tab：开标大厅 / 评标管理（只读：进度·矩阵·汇总排名）/ 评分标准（只读）；默认 tab 随阶段——EVALUATING→评标管理，其余→开标大厅）。评标操作（启动评标/生成结果/催促）与澄清答疑、归档仍全归 :3005。`

- [ ] **Step 3：提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 更新 :3007 三页面结构（工作区恢复）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Phase 2 验收**：按 spec §9 工作区验证项逐条走（默认 tab / 重定向 / 只读确认 / 灰显提示）；再完整回归 Phase 1 交回流程一遍（工作区 open tab 内交回横幅 → :3005 深链 → 启动评标）。提醒用户全部未推送提交数量，等用户明确指示再 push。

---

## Self-Review 结论（写计划时已执行）

- **Spec 覆盖**：§4.1 端点→T5/T6；§4.2 共享守卫→T4；§4.3 通知→T7；§4.4 WS→T2/T3；§5 迁移→T1；§6 文件包→T5（buildHandoverPackage）；§7.1 横幅→T9；§7.2 接收块→T10；§7.3 shared→T2；§8 守卫表→T5/T6 用例覆盖；§9 测试→T4/T5/T6/T9/T11/T18；§10 文档→T12/T19；§11 非目标→T16/T17 明确删除清单；§12 工作区→T13-T18；§13 深链→T11。无缺口。
- **命名一致性**：`completeOpening` / `assertOpeningDone` / `notifyOpeningCompleted` / `OPENING_COMPLETED` / `onOpeningCompleted` / `handoverAssetId` / `bid_opening_handover` / `EvaluationView` / `ScoreStandardView` / `OpeningHall` 全计划统一。
- **占位符扫描**：T16 的"逐段复制"给出了明确段落清单与删除清单（原件行号 + 元素名），非 TBD。
