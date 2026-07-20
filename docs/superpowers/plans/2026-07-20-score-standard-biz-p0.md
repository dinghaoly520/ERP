# 评分标准编制业务线 P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 bid 模块「评分标准编制」实现 B1 完整性闸门、B2 发布动作+锁定时机、B3 审计归因,使评分标准合规、完整、可追溯。

**Architecture:** 新增 `ScoreStandardValidator` 集中所有评分标准校验,供 `BidService` 写操作与 `startEvaluation` 复用;`BidProject.scoreStandardPublishedAt` 实现「发布即锁定」;`BidSupervisionLog.operatorId/operatorRole` 实现操作者归因。提取线 E1/E2 与 P1/P2 不在本计划。

**Tech Stack:** NestJS 11 + Prisma 16 + Jest + supertest(后端);Next.js 16 App Router + Tailwind v4(前端);pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-07-20-score-standard-optimization-design.md`

## Global Constraints

- pnpm workspace,工作目录 `water-erp/`;API 包名 `api`,命令前缀 `pnpm --filter api ...`。
- TS **无** `esModuleInterop`;CJS 函数导出包用 `import x = require('pkg')`(本计划不涉及新 CJS 依赖)。
- Prisma migration 非交互:`migrate dev --create-only` → `prisma db execute --file <sql> --schema apps/api/prisma/schema.prisma` → `migrate resolve --applied <name>` → `prisma generate`。
- 全局 `ValidationPipe({ whitelist: true, transform: true })`;错误响应形如 `{ statusCode, code, error, timestamp, path }`。
- 单元 spec 必须放 `apps/api/src/bid/` 下(jest `rootDir: src`);e2e 在 `apps/api/test/`(`jest-e2e.json`)。
- e2e 用 seed 账号 `陈主任` / `czr@2026` / `X-Portal: web`(bid_host 角色,对评分标准有写权限)。
- commit 消息中文 conventional;**不要主动 `git push`**(用户偏好)。
- 不要在 dev 脚本里加回 `--webpack`。

---

## File Structure

| 文件 | 职责 | 动作 |
|------|------|------|
| `apps/api/prisma/schema.prisma` | `BidProject` + `scoreStandardPublishedAt`;`BidSupervisionLog` + `operatorId` + `operatorRole` | Modify |
| `apps/api/prisma/migrations/<ts>_score_standard_publish_audit/migration.sql` | DDL | Create(由 prisma 生成) |
| `apps/api/src/bid/score-standard-validator.service.ts` | 集中校验:`assertPassFailMaxScore` / `assertPointsSumWithinMax` / `assertScoreStandardComplete` | Create |
| `apps/api/src/bid/score-standard-validator.service.spec.ts` | 单元测试 | Create |
| `apps/api/src/bid/bid.module.ts` | 注册 `ScoreStandardValidator` | Modify |
| `apps/api/src/bid/bid.service.ts` | 注入 validator;接入校验;`publishScoreStandard`;`assertScoreItemsEditable` 升级;`logScoreStdOp` helper;`updateScoreItem` 补审计 | Modify |
| `apps/api/src/bid/bid.controller.ts` | 5 端点加 `@CurrentUser`;新增 `publish` 端点 | Modify |
| `apps/api/test/bid.e2e-spec.ts` | 回归修正 + 新增 B1/B2/B3 用例 | Modify |
| `apps/api/prisma/seed-data/BidScorePoint.json` | 英雄项目得分点种子 | Create |
| `apps/api/prisma/seed.ts` | `SEED_ORDER` + `ALL_TABLES` 加 `BidScorePoint` | Modify |
| `apps/bid-portal/src/lib/api/bid.ts` | `publishScoreStandard` helper | Modify |
| `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` | 发布按钮、锁定横幅、`locked` 判定 | Modify |

---

## Task 1: Prisma Migration — 三字段

**Files:**
- Modify: `apps/api/prisma/schema.prisma`(`BidProject` 约 L250-288;`BidSupervisionLog` 约 L599-612)
- Create: `apps/api/prisma/migrations/<auto>_score_standard_publish_audit/migration.sql`

**Interfaces:**
- Produces: `BidProject.scoreStandardPublishedAt: DateTime | null`;`BidSupervisionLog.operatorId: string | null`;`BidSupervisionLog.operatorRole: string | null`(后续 Task 依赖这些字段存在于 Prisma client)。

- [ ] **Step 1: 改 schema —— `BidProject` 加字段**

在 `apps/api/prisma/schema.prisma` 的 `model BidProject` 内,`stage BidStage @default(DOWNLOAD)` 那一行下方加:

```prisma
  scoreStandardPublishedAt DateTime?
```

- [ ] **Step 2: 改 schema —— `BidSupervisionLog` 加字段**

在 `model BidSupervisionLog` 的 `riskFlag String @default("无")` 下方加两行:

```prisma
  operatorId   String?
  operatorRole String?
```

- [ ] **Step 3: 生成 migration(create-only,不应用)**

Run:
```bash
pnpm --filter api exec prisma migrate dev --create-only --name score_standard_publish_audit
```
Expected: 输出含 `--alteration` 的 SQL,生成 `apps/api/prisma/migrations/<timestamp>_score_standard_publish_audit/migration.sql`。**确认 SQL 含 3 个 `ADD COLUMN`**(两处表:`"BidProject"` 加 `"scoreStandardPublishedAt"`;`"BidSupervisionLog"` 加 `"operatorId"`、`"operatorRole"`)。

- [ ] **Step 4: 应用 migration(非交互三步)**

Run(注意 `<timestamp>` 用 Step 3 生成的实际目录名替换):
```bash
pnpm --filter api exec prisma db execute --file prisma/migrations/<timestamp>_score_standard_publish_audit/migration.sql --schema prisma/schema.prisma
pnpm --filter api exec prisma migrate resolve --applied score_standard_publish_audit
pnpm --filter api exec prisma generate
```
Expected: `db execute` 无报错;`migrate resolve` 输出 `migration ... applied`;`generate` 重新生成 client。

- [ ] **Step 5: 验证字段可查询**

Run:
```bash
cd /home/asus/桌面/ERP/water-erp/apps/api && node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.bidProject.findFirst({select:{scoreStandardPublishedAt:true}}).then(r=>console.log('BidProject OK',r)).then(()=>p.bidSupervisionLog.findFirst({select:{operatorId:true,operatorRole:true}})).then(r=>console.log('BidSupervisionLog OK',r)).finally(()=>p.\$disconnect())"
```
Expected: 两行 `OK`,无 `Unknown column` / `does not exist` 错误。

- [ ] **Step 6: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git -C /home/asus/桌面/ERP commit -m "feat(bid): schema 加 scoreStandardPublishedAt 与审计 operatorId/operatorRole" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: ScoreStandardValidator + 单元测试

**Files:**
- Create: `apps/api/src/bid/score-standard-validator.service.ts`
- Create: `apps/api/src/bid/score-standard-validator.service.spec.ts`
- Modify: `apps/api/src/bid/bid.module.ts`

**Interfaces:**
- Consumes: `PrismaService`(注入);`ScoreCategory`、`Prisma` from `@prisma/client`
- Produces:
  - `ScoreStandardValidator.assertPassFailMaxScore(category: ScoreCategory, maxScore: number): void`
  - `ScoreStandardValidator.assertPointsSumWithinMax(tx: Prisma.TransactionClient, itemId: string, itemMaxScore: number, delta: number): Promise<void>`
  - `ScoreStandardValidator.assertScoreStandardComplete(projectId: string): Promise<void>`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/bid/score-standard-validator.service.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ScoreCategory } from '@prisma/client';
import { ScoreStandardValidator } from './score-standard-validator.service';

describe('ScoreStandardValidator', () => {
  let validator: ScoreStandardValidator;
  const prisma: any = {
    bidScoreItem: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    validator = new ScoreStandardValidator(prisma);
  });

  describe('assertPassFailMaxScore', () => {
    it('QUALIFICATION + 0 通过', () => {
      expect(() => validator.assertPassFailMaxScore(ScoreCategory.QUALIFICATION, 0)).not.toThrow();
    });
    it('QUALIFICATION + 5 → 400 PASS_FAIL_MUST_BE_ZERO', () => {
      try {
        validator.assertPassFailMaxScore(ScoreCategory.QUALIFICATION, 5);
        fail('应抛 BadRequestException');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'PASS_FAIL_MUST_BE_ZERO' });
      }
    });
    it('TECHNICAL + 50 通过', () => {
      expect(() => validator.assertPassFailMaxScore(ScoreCategory.TECHNICAL, 50)).not.toThrow();
    });
  });

  describe('assertPointsSumWithinMax', () => {
    const tx: any = { bidScorePoint: { aggregate: jest.fn() } };
    beforeEach(() => jest.clearAllMocks());

    it('现有 30 + delta 15 ≤ 50 通过', async () => {
      tx.bidScorePoint.aggregate.mockResolvedValue({ _sum: { fullScore: 30 } });
      await expect(validator.assertPointsSumWithinMax(tx, 'item1', 50, 15)).resolves.toBeUndefined();
    });
    it('现有 30 + delta 25 > 50 → 409', async () => {
      tx.bidScorePoint.aggregate.mockResolvedValue({ _sum: { fullScore: 30 } });
      await expect(validator.assertPointsSumWithinMax(tx, 'item1', 50, 25)).rejects.toBeInstanceOf(ConflictException);
    });
    it('delta 为负(删点)通过', async () => {
      tx.bidScorePoint.aggregate.mockResolvedValue({ _sum: { fullScore: 40 } });
      await expect(validator.assertPointsSumWithinMax(tx, 'item1', 50, -10)).resolves.toBeUndefined();
    });
  });

  describe('assertScoreStandardComplete', () => {
    it('打分类 Σ=100 + 全打分类项有点 + 通过性项无点 → 通过', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'QUALIFICATION', maxScore: 0, name: '资格', _count: { points: 0 } },
        { category: 'RESPONSIVE', maxScore: 0, name: '响应', _count: { points: 0 } },
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
    });
    it('Σ=55 → 409 MAX_SCORE_SUM_NOT_100', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { category: 'TECHNICAL', maxScore: 5, name: '技术', _count: { points: 1 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'MAX_SCORE_SUM_NOT_100' },
      });
    });
    it('打分类项无点 → 409 SCORE_ITEM_HAS_NO_POINTS', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 0 } },
        { category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'SCORE_ITEM_HAS_NO_POINTS' },
      });
    });
    it('通过性项无点(走 passed 裁定)→ 通过', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'QUALIFICATION', maxScore: 0, name: '资格', _count: { points: 0 } },
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --filter api test -- src/bid/score-standard-validator.service.spec.ts
```
Expected: FAIL,`Cannot find module './score-standard-validator.service'`。

- [ ] **Step 3: 实现 Validator**

创建 `apps/api/src/bid/score-standard-validator.service.ts`:

```ts
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ScoreCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PASS_FAIL_CATEGORIES = new Set<ScoreCategory>([ScoreCategory.QUALIFICATION, ScoreCategory.RESPONSIVE]);
const SCORING_CATEGORIES = new Set<ScoreCategory>([ScoreCategory.BUSINESS, ScoreCategory.TECHNICAL, ScoreCategory.PRICE]);

@Injectable()
export class ScoreStandardValidator {
  constructor(private readonly prisma: PrismaService) {}

  /** 通过性审查类别(QUALIFICATION/RESPONSIVE)满分必须为 0。 */
  assertPassFailMaxScore(category: ScoreCategory, maxScore: number): void {
    if (PASS_FAIL_CATEGORIES.has(category) && Number(maxScore) !== 0) {
      throw new BadRequestException({
        error: '通过性审查类别满分必须为 0',
        code: 'PASS_FAIL_MUST_BE_ZERO',
      });
    }
  }

  /** 某评分项的得分点 ΣfullScore + 增量 ≤ item.maxScore。事务内调用,复用 tx。 */
  async assertPointsSumWithinMax(
    tx: Prisma.TransactionClient,
    itemId: string,
    itemMaxScore: number,
    delta: number,
  ): Promise<void> {
    const agg = await tx.bidScorePoint.aggregate({
      where: { scoreItemId: itemId },
      _sum: { fullScore: true },
    });
    const sum = Number(agg._sum.fullScore ?? 0) + Number(delta);
    if (sum > Number(itemMaxScore)) {
      throw new ConflictException({
        error: `得分点满分合计 ${sum} 超过大类满分 ${itemMaxScore}`,
        code: 'POINTS_SUM_EXCEEDS_MAX',
      });
    }
  }

  /** 评分标准整体完整:打分类 ΣmaxScore === 100;每个打分类项 ≥1 得分点(通过性项豁免)。 */
  async assertScoreStandardComplete(projectId: string): Promise<void> {
    const items = await this.prisma.bidScoreItem.findMany({
      where: { projectId },
      include: { _count: { select: { points: true } } },
    });
    const sumMax = items
      .filter((i) => SCORING_CATEGORIES.has(i.category))
      .reduce((s, i) => s + Number(i.maxScore), 0);
    if (sumMax !== 100) {
      throw new ConflictException({
        error: `打分类满分合计须为 100,当前为 ${sumMax}`,
        code: 'MAX_SCORE_SUM_NOT_100',
      });
    }
    const noPoints = items.find((i) => SCORING_CATEGORIES.has(i.category) && i._count.points === 0);
    if (noPoints) {
      throw new ConflictException({
        error: `评分项「${noPoints.name}」未设置得分点`,
        code: 'SCORE_ITEM_HAS_NO_POINTS',
      });
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm --filter api test -- src/bid/score-standard-validator.service.spec.ts
```
Expected: PASS,全部用例绿。

- [ ] **Step 5: 注册到 BidModule**

修改 `apps/api/src/bid/bid.module.ts`:

import 区加(在 `ScorePointExtractorService` import 下方):
```ts
import { ScoreStandardValidator } from './score-standard-validator.service';
```

`providers` 数组改为:
```ts
  providers: [BidService, BidGateway, ClarificationAiService, ScorePointExtractorService, ScoreStandardValidator],
```

- [ ] **Step 6: 确认 API 仍能编译启动**

Run:
```bash
pnpm --filter api exec tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/bid/score-standard-validator.service.ts apps/api/src/bid/score-standard-validator.service.spec.ts apps/api/src/bid/bid.module.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): 新增 ScoreStandardValidator 集中校验评分标准完整性" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: B1 接入 — 评分项/得分点/startEvaluation 校验

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`(constructor;`createScoreItem`;`updateScoreItem`;`createScorePoint`;`updateScorePoint`;`batchCreateScorePoints`;`startEvaluation`)
- Modify: `apps/api/test/bid.e2e-spec.ts`(回归 L169-187 + 新增用例)

**Interfaces:**
- Consumes: `ScoreStandardValidator`(Task 2 产出)
- Produces: `createScoreItem`/`updateScoreItem` 强制通过性 maxScore=0;得分点 CRUD 校验 Σ≤maxScore;`startEvaluation` 校验完整标准。

- [ ] **Step 1: BidService 注入 validator**

在 `apps/api/src/bid/bid.service.ts` 顶部 import 区加:
```ts
import { ScoreStandardValidator } from './score-standard-validator.service';
```
在 `BidService` 构造函数参数末尾加(参照其它注入的写法):
```ts
private readonly scoreStandardValidator: ScoreStandardValidator,
```

- [ ] **Step 2: `createScoreItem` 加通过性校验**

定位 `createScoreItem`(约 L1936)。当前 `this.assertScoreItemsEditable(project.stage);` 下一行插入:
```ts
    this.scoreStandardValidator.assertPassFailMaxScore(dto.category, dto.maxScore);
```

- [ ] **Step 3: `updateScoreItem` 加通过性校验**

定位 `updateScoreItem`(约 L1961)。当前 `this.assertScoreItemsEditable(project.stage);` 与 `const existing = ...` 之间插入:
```ts
    if (dto.category !== undefined || dto.maxScore !== undefined) {
      const nextCategory = dto.category ?? existing?.category ?? 'TECHNICAL';
      const nextMaxScore = dto.maxScore ?? Number(existing?.maxScore ?? 0);
      this.scoreStandardValidator.assertPassFailMaxScore(nextCategory as any, nextMaxScore);
    }
```
> 注:`existing` 在原代码里是下一行才声明;为避免引用顺序问题,把上面这段移到 `const existing = ...` 之后,并把 `existing?.category` 改为 `existing.category`、`existing?.maxScore` 改为 `existing.maxScore`。最终 `updateScoreItem` 顶部顺序为:`findUnique(project)` → `assertScoreItemsEditable` → `findFirst(existing)` → `if (!existing) throw` → 通过性校验块 → `prisma.bidScoreItem.update`。

- [ ] **Step 4: `createScorePoint` 改事务 + Σ校验**

定位 `createScorePoint`(约 L2028)。整段替换为:
```ts
  async createScorePoint(projectId: string, itemId: string, dto: CreateScorePointDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    return this.prisma.$transaction(async (tx) => {
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), Number(dto.fullScore));
      return tx.bidScorePoint.create({
        data: {
          scoreItemId: itemId,
          name: dto.name,
          fullScore: dto.fullScore,
          seq: dto.seq ?? 0,
          evidenceHint: dto.evidenceHint ?? null,
          objective: dto.objective ?? true,
        },
      });
    });
  }
```

- [ ] **Step 5: `updateScorePoint` 改事务 + Σ校验**

定位 `updateScorePoint`(约 L2042)。整段替换为:
```ts
  async updateScorePoint(projectId: string, itemId: string, pointId: string, dto: UpdateScorePointDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    const existing = await this.prisma.bidScorePoint.findFirst({ where: { id: pointId, scoreItemId: itemId } });
    if (!existing) {
      throw new BadRequestException({ error: '得分点不存在', code: 'NOT_FOUND' });
    }
    const delta = dto.fullScore !== undefined ? Number(dto.fullScore) - Number(existing.fullScore) : 0;
    return this.prisma.$transaction(async (tx) => {
      if (delta !== 0) {
        await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), delta);
      }
      return tx.bidScorePoint.update({
        where: { id: pointId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.fullScore !== undefined && { fullScore: dto.fullScore }),
          ...(dto.seq !== undefined && { seq: dto.seq }),
          ...(dto.evidenceHint !== undefined && { evidenceHint: dto.evidenceHint }),
          ...(dto.objective !== undefined && { objective: dto.objective }),
        },
      });
    });
  }
```

- [ ] **Step 6: `batchCreateScorePoints` 改事务 + Σ校验**

定位 `batchCreateScorePoints`(约 L2070)。整段替换为:
```ts
  async batchCreateScorePoints(projectId: string, itemId: string, dto: BatchCreateScorePointsDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    const delta = dto.points.reduce((s, p) => s + Number(p.fullScore), 0);
    return this.prisma.$transaction(async (tx) => {
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), delta);
      return tx.bidScorePoint.createMany({
        data: dto.points.map((p) => ({
          scoreItemId: itemId,
          name: p.name,
          fullScore: p.fullScore,
          evidenceHint: p.evidenceHint ?? null,
          objective: p.objective ?? true,
        })),
      });
    });
  }
```

- [ ] **Step 7: `startEvaluation` 用 validator 替换 G9**

定位 `startEvaluation` 的 G9 块(约 L576-583):
```ts
    // G9: 至少一个评分项，否则专家无法打分、progress 恒 0、无法确认报告/生成结果
    const scoreItemCount = await this.prisma.bidScoreItem.count({ where: { projectId: id } });
    if (scoreItemCount === 0) {
      throw new BadRequestException({
        error: '项目尚未编制评分标准，请先在评标办法页添加评分项或应用标准模板',
        code: 'NO_SCORE_ITEMS',
      });
    }
```
替换为:
```ts
    // G9: 评分标准完整(打分类 Σ=100 + 每个打分类项 ≥1 得分点),否则专家无法打分
    await this.scoreStandardValidator.assertScoreStandardComplete(id);
```

- [ ] **Step 8: 修正现有 e2e 回归 —— start-evaluation 用例的评分项 setup**

在 `apps/api/test/bid.e2e-spec.ts` 找到 `it('管理员可启动评标 OPENING → EVALUATING', ...)`(约 L169)。该用例当前 setup 仅有:
```ts
  await prisma.bidScoreItem.create({
    data: { projectId: createdProjectId, category: 'TECHNICAL', name: '技术方案', maxScore: 10 },
  });
```
把这一句替换为完整 setup(满足新闸门:打分类 Σ=100 + 每打分类项 ≥1 点):
```ts
  // 完整评分标准(满足 startEvaluation 新闸门)
  await prisma.bidScoreItem.createMany({
    data: [
      { projectId: createdProjectId, category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
      { projectId: createdProjectId, category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
      { projectId: createdProjectId, category: 'BUSINESS', name: '商务评分', maxScore: 20 },
      { projectId: createdProjectId, category: 'TECHNICAL', name: '技术评分', maxScore: 50 },
      { projectId: createdProjectId, category: 'PRICE', name: '价格评分', maxScore: 30 },
    ],
  });
  const scoringItems = await prisma.bidScoreItem.findMany({
    where: { projectId: createdProjectId, category: { in: ['BUSINESS', 'TECHNICAL', 'PRICE'] } },
  });
  await prisma.bidScorePoint.createMany({
    data: scoringItems.map((it) => ({ scoreItemId: it.id, name: `${it.name}-要点1`, fullScore: Number(it.maxScore), seq: 1 })),
  });
```

- [ ] **Step 9: 新增 e2e —— 通过性 maxScore 拒绝 + startEvaluation 残缺拒绝**

在 `bid.e2e-spec.ts` 的 `describe` 内(`afterAll` 之前)追加两个用例。需复用 `adminCookie`、`prisma`、`createdProjectId`(若该值在 `createdProjectId` 作用域外,改为用例内自建项目;以下按自建项目写,避免作用域耦合):

```ts
  it('通过性类别 maxScore≠0 → 400 PASS_FAIL_MUST_BE_ZERO', async () => {
    const proj = await prisma.bidProject.create({
      data: { projectCode: `BID-T3-${Date.now()}`, name: 'B1校验项目', stage: 'DOWNLOAD' },
    });
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${proj.id}/score-items`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ category: 'QUALIFICATION', name: '资格', maxScore: 5 })
      .expect(400)
      .expect((res) => expect(res.body).toMatchObject({ code: 'PASS_FAIL_MUST_BE_ZERO' }));
    await prisma.bidProject.delete({ where: { id: proj.id } }).catch(() => {});
  });

  it('startEvaluation 残缺标准(无得分点)→ 409 SCORE_ITEM_HAS_NO_POINTS', async () => {
    const proj = await prisma.bidProject.create({
      data: { projectCode: `BID-T3B-${Date.now()}`, name: 'B1残缺项目', stage: 'OPENING' },
    });
    await prisma.bidScoreItem.createMany({
      data: [
        { projectId: proj.id, category: 'BUSINESS', name: '商务', maxScore: 20 },
        { projectId: proj.id, category: 'TECHNICAL', name: '技术', maxScore: 50 },
        { projectId: proj.id, category: 'PRICE', name: '价格', maxScore: 30 },
      ],
    });
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${proj.id}/start-evaluation`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(409)
      .expect((res) => expect(res.body).toMatchObject({ code: 'SCORE_ITEM_HAS_NO_POINTS' }));
    await prisma.bidScoreItem.deleteMany({ where: { projectId: proj.id } });
    await prisma.bidProject.delete({ where: { id: proj.id } }).catch(() => {});
  });
```

- [ ] **Step 10: 跑 e2e 确认通过**

Run:
```bash
pnpm --filter api test:e2e -- bid.e2e-spec
```
Expected: 全部用例 PASS(含原有 start-evaluation 用例与两个新用例)。若 start-evaluation 原用例仍红,复核 Step 8 setup 是否满足 Σ=100 + 每打分类项有点。

- [ ] **Step 11: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/bid/bid.service.ts apps/api/test/bid.e2e-spec.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): B1 接入评分标准完整性闸门(评分项/得分点/startEvaluation)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Seed 补齐 BidScorePoint

**Files:**
- Create: `apps/api/prisma/seed-data/BidScorePoint.json`
- Modify: `apps/api/prisma/seed.ts`(`ALL_TABLES` + `SEED_ORDER`)

**Interfaces:**
- Produces: 英雄项目(`cmqhero-bid-proj01`)每个打分类评分项 ≥1 得分点,使重新 seed 后英雄项目能通过 `assertScoreStandardComplete`。

- [ ] **Step 1: 查询英雄项目评分项的真实 id**

Run:
```bash
cd /home/asus/桌面/ERP/water-erp/apps/api && node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.bidScoreItem.findMany({where:{projectId:'cmqhero-bid-proj01'},select:{id:true,category:true,name:true,maxScore:true}}).then(r=>console.log(JSON.stringify(r,null,2))).finally(()=>p.\$disconnect())"
```
Expected: 5 条评分项,记下 BUSINESS/TECHNICAL/PRICE 三条的 `id` 与 `maxScore`(后续 JSON 的 `scoreItemId`、`fullScore` 要用到)。

- [ ] **Step 2: 创建 BidScorePoint.json**

创建 `apps/api/prisma/seed-data/BidScorePoint.json`,用 Step 1 得到的真实 `id` 填 `scoreItemId`,`fullScore` 合计 = 该项 `maxScore`(为演示,每项放 1-2 个得分点)。结构(以 id 替换占位):
```json
[
  { "id": "seed-sp-biz-1", "scoreItemId": "<BUSINESS item id>", "name": "商务报价合理性", "fullScore": 20, "seq": 1, "evidenceHint": "商务条款响应", "objective": true },
  { "id": "seed-sp-tech-1", "scoreItemId": "<TECHNICAL item id>", "name": "技术方案完整性", "fullScore": 30, "seq": 1, "evidenceHint": "施工组织设计", "objective": false },
  { "id": "seed-sp-tech-2", "scoreItemId": "<TECHNICAL item id>", "name": "同类业绩", "fullScore": 20, "seq": 2, "evidenceHint": "近三年业绩清单", "objective": true },
  { "id": "seed-sp-price-1", "scoreItemId": "<PRICE item id>", "name": "报价得分", "fullScore": 30, "seq": 1, "evidenceHint": "按报价公式", "objective": true }
]
```

- [ ] **Step 3: seed.ts 注册 BidScorePoint**

在 `apps/api/prisma/seed.ts` 的 `ALL_TABLES` 数组里(约 L45),找到 `'BidScoreItem'` 那一行,在其下方加:
```ts
  'BidScorePoint',
```
在 `SEED_ORDER` 数组里(约 L94)`['BidScoreItem', 'bidScoreItem'],` 下方加:
```ts
  ['BidScorePoint', 'bidScorePoint'],
```

- [ ] **Step 4: 重新 seed 并验证**

Run:
```bash
pnpm --filter api db:seed
```
Expected: 无错误退出。然后验证:
```bash
cd /home/asus/桌面/ERP/water-erp/apps/api && node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.bidScorePoint.count({where:{scoreItem:{projectId:'cmqhero-bid-proj01'}}}).then(c=>console.log('hero 得分点数:',c)).finally(()=>p.\$disconnect())"
```
Expected: `hero 得分点数: 4`(或 ≥3)。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/prisma/seed-data/BidScorePoint.json apps/api/prisma/seed.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): 补 BidScorePoint 种子,英雄项目满足评分标准完整性闸门" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: B2 — publish 端点 + 锁定判定升级

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`(`assertScoreItemsEditable` 签名 + 5 调用点 select;新增 `publishScoreStandard`)
- Modify: `apps/api/src/bid/bid.controller.ts`(新增 `publish` 端点)
- Modify: `apps/api/test/bid.e2e-spec.ts`(publish e2e 用例)

**Interfaces:**
- Consumes: `ScoreStandardValidator.assertScoreStandardComplete`(Task 2);`BidProject.scoreStandardPublishedAt`(Task 1)
- Produces: `POST /api/bid/projects/:id/score-items/publish`;所有写操作在 `publishedAt != null` 时返回 409 `SCORE_ITEMS_LOCKED`。

- [ ] **Step 1: 升级 `assertScoreItemsEditable` 签名**

定位 `assertScoreItemsEditable`(约 L1919)。整段替换为:
```ts
  private assertScoreItemsEditable(stage: BidStage, publishedAt: Date | null) {
    if (publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED') {
      throw new ConflictException({
        error: '评分标准已发布或项目已进入评标/归档阶段,已锁定',
        code: 'SCORE_ITEMS_LOCKED',
      });
    }
  }
```

- [ ] **Step 2: 5 个调用点加 `scoreStandardPublishedAt` 并传入**

定位并修改下列方法中 `findUnique` 的 `select` 与 `assertScoreItemsEditable` 调用:

(a) `createScoreItem`(约 L1937):`select: { stage: true, name: true }` → `select: { stage: true, name: true, scoreStandardPublishedAt: true }`;`this.assertScoreItemsEditable(project.stage)` → `this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt)`。

(b) `updateScoreItem`(约 L1962):`select: { stage: true }` → `select: { stage: true, scoreStandardPublishedAt: true }`;同样改 `assertScoreItemsEditable` 调用。

(c) `deleteScoreItem`(约 L1983):`select: { stage: true, name: true }` → 加 `scoreStandardPublishedAt: true`;改调用。

(d) `applyScoreItemTemplate`(约 L2085):`select: { stage: true, name: true }` → 加 `scoreStandardPublishedAt: true`;改调用。

(e) `assertScoreItemInProject`(约 L2009):`include: { project: { select: { stage: true } } }` → `include: { project: { select: { stage: true, scoreStandardPublishedAt: true } } }`;`this.assertScoreItemsEditable(item.project.stage as BidStage)` → `this.assertScoreItemsEditable(item.project.stage as BidStage, item.project.scoreStandardPublishedAt)`。

- [ ] **Step 3: 新增 `publishScoreStandard` 方法**

在 `applyScoreItemTemplate` 方法之后插入:
```ts
  /** 发布评分标准:校验完整性 → 置 publishedAt → 此后写操作锁定。 */
  async publishScoreStandard(projectId: string, actor: { userId: string; role: string; username: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, scoreStandardPublishedAt: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.scoreStandardPublishedAt) {
      throw new ConflictException({ error: '评分标准已发布,不可重复发布', code: 'SCORE_STANDARD_ALREADY_PUBLISHED' });
    }
    await this.scoreStandardValidator.assertScoreStandardComplete(projectId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bidProject.update({
        where: { id: projectId },
        data: { scoreStandardPublishedAt: new Date() },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人',
          operatorId: actor.userId, operatorRole: actor.role,
          target: project.name, action: '编制评分标准', result: '发布评分标准', riskFlag: '无',
        },
      });
      return result;
    });
    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: '发布评分标准', riskFlag: '无' });
    return updated;
  }
```

- [ ] **Step 4: Controller 加 publish 端点**

在 `apps/api/src/bid/bid.controller.ts` 的 `applyScoreItemTemplate` 端点(约 L191-193)之后插入:
```ts
  @Post('projects/:id/score-items/publish')
  @ApiOperation({ summary: '发布评分标准(发布后只读)' })
  publishScoreStandard(@Param('id') id: string, @CurrentUser('sub') userId: string, @CurrentUser('role') role: string, @CurrentUser('username') username: string) {
    return this.bidService.publishScoreStandard(id, { userId, role, username });
  }
```

- [ ] **Step 5: 写 e2e —— publish 闭环**

在 `bid.e2e-spec.ts` 追加用例:
```ts
  it('评分标准 publish 闭环:残缺→409;完整→成功;此后写→409;重复→409', async () => {
    const proj = await prisma.bidProject.create({
      data: { projectCode: `BID-T5-${Date.now()}`, name: 'B2发布项目', stage: 'DOWNLOAD' },
    });
    // 残缺(只有 1 项,Σ≠100)→ 409
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${proj.id}/score-items/publish`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .expect(409)
      .expect((res) => expect(res.body).toMatchObject({ code: 'MAX_SCORE_SUM_NOT_100' }));

    // 补齐完整标准
    const items = await Promise.all([
      prisma.bidScoreItem.create({ data: { projectId: proj.id, category: 'BUSINESS', name: '商务', maxScore: 20 } }),
      prisma.bidScoreItem.create({ data: { projectId: proj.id, category: 'TECHNICAL', name: '技术', maxScore: 50 } }),
      prisma.bidScoreItem.create({ data: { projectId: proj.id, category: 'PRICE', name: '价格', maxScore: 30 } }),
    ]);
    await prisma.bidScorePoint.createMany({
      data: items.map((it) => ({ scoreItemId: it.id, name: `${it.name}-要点`, fullScore: Number(it.maxScore), seq: 1 })),
    });

    // 完整 → 发布成功
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${proj.id}/score-items/publish`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .expect(201);

    // 此后写 → 409 SCORE_ITEMS_LOCKED
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${proj.id}/score-items`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .send({ category: 'TECHNICAL', name: '新项', maxScore: 5 })
      .expect(409)
      .expect((res) => expect(res.body).toMatchObject({ code: 'SCORE_ITEMS_LOCKED' }));

    // 重复 publish → 409
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${proj.id}/score-items/publish`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .expect(409)
      .expect((res) => expect(res.body).toMatchObject({ code: 'SCORE_STANDARD_ALREADY_PUBLISHED' }));

    await prisma.bidScorePoint.deleteMany({ where: { scoreItem: { projectId: proj.id } } });
    await prisma.bidScoreItem.deleteMany({ where: { projectId: proj.id } });
    await prisma.bidSupervisionLog.deleteMany({ where: { projectId: proj.id } });
    await prisma.bidProject.delete({ where: { id: proj.id } }).catch(() => {});
  });
```

- [ ] **Step 6: 跑 e2e**

Run:
```bash
pnpm --filter api test:e2e -- bid.e2e-spec
```
Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.controller.ts apps/api/test/bid.e2e-spec.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): B2 评分标准发布动作 + 锁定判定(publishedAt)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: B3 — 审计归因(operatorId/operatorRole + updateScoreItem 补审计)

**Files:**
- Modify: `apps/api/src/bid/bid.controller.ts`(create/update/delete/applyTemplate 端点加 `@CurrentUser`)
- Modify: `apps/api/src/bid/bid.service.ts`(方法签名加 `actor`;`logScoreStdOp` helper;`updateScoreItem` 补审计)
- Modify: `apps/api/test/bid.e2e-spec.ts`(审计断言用例)

**Interfaces:**
- Consumes: `request.user = { sub, username, role }`;`BidSupervisionLog.operatorId/operatorRole`(Task 1)
- Produces: 每条评分标准审计日志带 `operatorId` + `operatorRole`;`updateScoreItem` 写审计。

- [ ] **Step 1: 新增 `logScoreStdOp` helper 与 `Actor` 类型**

在 `bid.service.ts` 顶部(类内,`assertScoreItemsEditable` 上方)加类型别名与方法:
```ts
  private async logScoreStdOp(
    tx: Prisma.TransactionClient,
    projectId: string,
    projectName: string,
    actor: { userId: string; role: string },
    action: string,
    result: string,
  ) {
    await tx.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '开标主持人',
        operatorId: actor.userId, operatorRole: actor.role,
        target: projectName, action, result, riskFlag: '无',
      },
    });
  }
```
顶部 import 区加(若尚无):
```ts
import { Prisma } from '@prisma/client';
```

- [ ] **Step 2: Controller 4 个端点加 `@CurrentUser`**

修改 `apps/api/src/bid/bid.controller.ts`:

`createScoreItem`(约 L187):
```ts
  createScoreItem(
    @Param('id') id: string,
    @Body() dto: CreateScoreItemDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.createScoreItem(id, dto, { userId, role });
  }
```

`updateScoreItem`(约 L195):
```ts
  updateScoreItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateScoreItemDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.updateScoreItem(id, itemId, dto, { userId, role });
  }
```

`deleteScoreItem`(约 L201):
```ts
  deleteScoreItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.deleteScoreItem(id, itemId, { userId, role });
  }
```

`applyScoreItemTemplate`(约 L191):
```ts
  applyScoreItemTemplate(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.bidService.applyScoreItemTemplate(id, { userId, role });
  }
```

- [ ] **Step 3: Service 方法签名加 actor + 改审计写入**

(a) `createScoreItem` 签名加 `actor: { userId: string; role: string }` 参数;事务内 `tx.bidSupervisionLog.create({...})` 替换为 `this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', \`新增评分项「${dto.name}」(满分 ${dto.maxScore})\`)`。

(b) `deleteScoreItem` 同理加 `actor`,事务内审计改 `this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', \`删除评分项「${existing.name}」\`)`。

(c) `applyScoreItemTemplate` 加 `actor`;`if (toCreate.length > 0)` 块内的 `bidSupervisionLog.create` 改为事务化 + `logScoreStdOp`(注意当前 applyScoreItemTemplate 的审计在 createMany 之后但不在事务内,需把 createMany + logScoreStdOp 包进一个 `$transaction`)。

(d) `publishScoreStandard`(Task 5 已用 `logScoreStdOp` 写法则无需再改;若 Task 5 中是直接 `tx.bidSupervisionLog.create`,改为 `this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', '发布评分标准')`)。

- [ ] **Step 4: `updateScoreItem` 补审计 + 改事务**

定位 `updateScoreItem`(Task 3 已改过顶部校验)。把方法的写库部分从直接 `this.prisma.bidScoreItem.update` 改为事务 + 审计。最终方法体(校验之后的尾部):
```ts
    const diffs: string[] = [];
    if (dto.category !== undefined && dto.category !== existing.category) diffs.push(`category ${existing.category}→${dto.category}`);
    if (dto.name !== undefined && dto.name !== existing.name) diffs.push(`name ${existing.name}→${dto.name}`);
    if (dto.maxScore !== undefined && Number(dto.maxScore) !== Number(existing.maxScore)) diffs.push(`maxScore ${existing.maxScore}→${dto.maxScore}`);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bidScoreItem.update({
        where: { id: itemId },
        data: {
          ...(dto.category && { category: dto.category }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.maxScore !== undefined && { maxScore: dto.maxScore }),
        },
      });
      if (diffs.length > 0) {
        await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', `修改评分项「${existing.name}」:${diffs.join(', ')}`);
      }
      return updated;
    });
```
> 注:`project.name` 需要 `updateScoreItem` 的 `findUnique` `select` 含 `name`(当前只 select stage + publishedAt);Step (b) 已要求加字段,这里同步把 `name: true` 加到 select。

- [ ] **Step 5: 写 e2e —— updateScoreItem 产生带 operatorId 的审计**

在 `bid.e2e-spec.ts` 追加:
```ts
  it('updateScoreItem 修改 maxScore → BidSupervisionLog 含 operatorId 与 diff', async () => {
    const proj = await prisma.bidProject.create({ data: { projectCode: `BID-T6-${Date.now()}`, name: 'B3审计项目', stage: 'DOWNLOAD' } });
    const item = await prisma.bidScoreItem.create({ data: { projectId: proj.id, category: 'TECHNICAL', name: '技术', maxScore: 50 } });
    await request(app.getHttpServer())
      .patch(`/api/bid/projects/${proj.id}/score-items/${item.id}`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .send({ maxScore: 45 })
      .expect(200);
    const log = await prisma.bidSupervisionLog.findFirst({
      where: { projectId: proj.id, action: '编制评分标准' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toBeTruthy();
    expect(log!.operatorId).toBeTruthy();
    expect(log!.result).toContain('50→45');
    await prisma.bidSupervisionLog.deleteMany({ where: { projectId: proj.id } });
    await prisma.bidScoreItem.deleteMany({ where: { projectId: proj.id } });
    await prisma.bidProject.delete({ where: { id: proj.id } }).catch(() => {});
  });
```

- [ ] **Step 6: 跑 e2e + tsc**

Run:
```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test:e2e -- bid.e2e-spec
```
Expected: 编译无错;e2e 全 PASS。

- [ ] **Step 7: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.controller.ts apps/api/test/bid.e2e-spec.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): B3 评分标准审计归因(operatorId/operatorRole + updateScoreItem 补审计)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 前端 —— 发布动作与锁定横幅

**Files:**
- Modify: `apps/bid-portal/src/lib/api/bid.ts`(新增 `publishScoreStandard`;project 查询类型)
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`(发布按钮、`locked`、横幅)

**Interfaces:**
- Consumes: `POST /api/bid/projects/:id/score-items/publish`(Task 5)
- Produces: 未发布时显示「发布评分标准」按钮;发布后整页只读 + 横幅显示发布时间。

- [ ] **Step 1: `lib/api/bid.ts` 加 `publishScoreStandard`**

在 `applyScoreItemTemplate` 下方加:
```ts
export function publishScoreStandard(projectId: string) {
  return api.post<{ scoreStandardPublishedAt: string }>(`/bid/projects/${projectId}/score-items/publish`, {});
}
```

- [ ] **Step 2: `page.tsx` 多取 `scoreStandardPublishedAt`**

定位 `page.tsx` 的 `useEffect`(约 L34-43)。把 `api.get<{ stage: string }>` 改为:
```ts
      api.get<{ stage: string; scoreStandardPublishedAt: string | null }>(`/bid/projects/${projectId}`)
        .then(p => { setStage(p.stage); setPublishedAt(p.scoreStandardPublishedAt); })
        .catch(() => {}),
```
顶部 `useState` 区(约 L24-32)加:
```ts
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
```
`locked` 改为(约 L45):
```ts
  const locked = !!publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED';
```

- [ ] **Step 3: `page.tsx` 加发布按钮 handler**

在 `handleApplyTemplate` 上方加:
```ts
  const handlePublish = async () => {
    if (!projectId) return;
    const scoredSum = items.filter(i => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0);
    const incomplete = items.filter(i => Number(i.maxScore) > 0 && (!i.points || i.points.length === 0));
    if (scoredSum !== 100 || incomplete.length > 0) {
      toast.error(`发布前请确保:打分项满分合计=100(当前 ${scoredSum}),且每个打分项至少 1 个得分点`);
      return;
    }
    if (!window.confirm('发布后评分标准将锁定,不可再修改。确认发布?')) return;
    try {
      const res = await publishScoreStandard(projectId);
      setPublishedAt(res.scoreStandardPublishedAt);
      toast.success('评分标准已发布');
    } catch (e: any) { toast.error(e.body?.error || e.message || '发布失败'); }
  };
```
顶部 import 加 `publishScoreStandard`:
```ts
import {
  listScoreItems, createScoreItem, updateScoreItem, deleteScoreItem, applyScoreItemTemplate,
  publishScoreStandard,
  type ScoreItem,
} from '@/lib/api/bid';
```

- [ ] **Step 4: `page.tsx` 加发布按钮 UI**

在顶部 `action={!locked && (...)}` 块内(约 L143-160),「应用标准模板」按钮之前加:
```tsx
              <button
                onClick={handlePublish}
                className="flex items-center gap-1.5 rounded-xl bg-[#11a874] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#0e8f61]"
              >
                <Check size={14} strokeWidth={1.8} />
                发布评分标准
              </button>
```

- [ ] **Step 5: `page.tsx` 锁定横幅区分文案**

定位锁定横幅(约 L129-137),替换为:
```tsx
      {locked && (
        <div className="flex items-center gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
          <Lock size={14} strokeWidth={1.8} />
          <span>
            {publishedAt
              ? `评分标准已发布(${new Date(publishedAt).toLocaleString('zh-CN')}),不可修改。`
              : `项目处于「${STAGE_LABEL[stage] || stage}」阶段,评分标准已锁定,不可修改。${stage === 'EVALUATING' ? ' 专家已开始打分。' : ''}`}
          </span>
        </div>
      )}
```

- [ ] **Step 6: 手动验证**

Run(另开终端):`pnpm --filter bid-portal dev`(端口 3007)。用 `陈主任/czr@2026` 登录,进入某 DOWNLOAD 阶段项目 `/bid/standard`:
- 未发布时显示「发布评分标准」按钮;
- 残缺标准点发布 → toast 报错;
- 完整标准点发布 → 成功,横幅变为「已发布(...)」,所有编辑/删除按钮消失。

- [ ] **Step 7: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/bid-portal/src/lib/api/bid.ts "apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx"
git -C /home/asus/桌面/ERP commit -m "feat(bid-portal): 评分标准发布按钮 + 发布后只读横幅" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- B1 `assertPassFailMaxScore` → Task 2 实现 + Task 3 接入 create/update ✓
- B1 `assertPointsSumWithinMax` → Task 2 实现 + Task 3 接入得分点 CRUD ✓
- B1 `assertScoreStandardComplete` → Task 2 实现 + Task 3 接入 startEvaluation + Task 5 接入 publish ✓
- B2 `scoreStandardPublishedAt` + publish 端点 + 锁定判定 → Task 1 + Task 5 ✓
- B3 `operatorId`/`operatorRole` + `logScoreStdOp` + `updateScoreItem` 审计 → Task 1 + Task 6 ✓
- 通过性项豁免得分点 → Task 2 单测覆盖 ✓
- 种子数据风险 → Task 4 ✓
- 前端发布动作 → Task 7 ✓

**Placeholder scan:** Task 4 Step 2 的 `scoreItemId` 用 `<BUSINESS item id>` 占位 —— 这是**故意**的,因为真实 id 必须 Step 1 查库得到,计划里无法预填;Step 1 给了精确查询命令。其余无 TBD/TODO。

**Type consistency:** `assertScoreItemsEditable(stage, publishedAt)` 签名在 Task 5 定义,Task 5 各调用点统一改为两参;`logScoreStdOp(tx, projectId, projectName, actor, action, result)` 在 Task 6 定义,Task 5 的 `publishScoreStandard` 已用同签名(Task 6 Step 3 (d) 兜底说明);`Actor` 形态 `{ userId, role }`(publish 用 `{userId, role, username}` 但 publish 内部只读 userId/role)—— 一致。

**回归风险:** 现有 `bid.e2e-spec.ts:169` start-evaluation 用例被 Task 3 Step 8 显式修正;`startEvaluation` G9 替换(Task 3 Step 7)是全局行为变更,英雄项目已过 startEvaluation 不受影响,但 Task 4 保证重新 seed 后仍可通过。
