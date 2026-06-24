# 资格/响应性审查 改「通过 / 不通过」制 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `QUALIFICATION`/`RESPONSIVE` 两个评分类别从数值打分改为「通过 / 不通过」裁定，且不通过（过半数）导致供应商废标。

**Architecture:** 通过性类型按类别硬编码（`QUALIFICATION`/`RESPONSIVE` = 通过性）。新增两列：`BidScoreRecord.passed`（裁定）与 `BidEvaluationResult.disqualified`（废标）。通过性项 `score` 固定写 0，使所有现有数值求和逻辑零改动；废标判定在 `generateEvaluationResults` 里按"不通过票严格过半"聚合。

**Tech Stack:** NestJS 11 + Prisma（API）、Next.js 16 + React 19（bid-portal / expert-portal）、pnpm workspace、`@water-erp/shared`。

**Spec:** `docs/superpowers/specs/2026-06-24-pass-fail-review-design.md`

## Global Constraints

- 工作目录：所有 workspace 命令在 `water-erp/` 下执行（`cd water-erp && ...`）。
- Prisma engine 在 Windows 下会被运行中的 `pnpm dev` 锁住（EPERM）——任何 `db:generate` / `migrate` / `seed` 之前**必须先停掉 `pnpm dev`**。
- 非交互环境跑 Prisma 迁移：用 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`（见 CLAUDE.md「Prisma Migration Notes」）。本变更只加 nullable/默认列，无数据丢失。
- 改完 `packages/shared` 必须重 build（`pnpm --filter @water-erp/shared build`），消费端才能拿到新导出。
- 通过性项的 `score` 恒为 0；**禁止改动任何数值求和点**（`expert.service.ts:460/590`、`bid.service.ts:974/1114`、performance 统计、`assistant/chart.mapper.ts`）。
- 类型判定函数名固定为 `isPassFailCategory`，放在 `packages/shared/src/constants.ts`。
- 提交粒度：每个 Task 一次 commit。提交信息用 conventional commits（`feat:` / `fix:` / `test:` / `refactor:` / `chore:`）。

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | 加 `BidScoreRecord.passed`、`BidEvaluationResult.disqualified` | Modify |
| `apps/api/prisma/migrations/<ts>_add_pass_fail_review/` | 迁移 SQL | Create |
| `packages/shared/src/constants.ts` | `isPassFailCategory` | Modify |
| `packages/shared/src/types.ts` | 给 record/report/result 类型加 `passed` / `disqualified` | Modify |
| `apps/api/src/expert/dto/batch-score.dto.ts` | `ScoreItemDto` 可选 `score` + `passed` | Modify |
| `apps/api/src/expert/expert.service.ts` | `submitScores` 通过性路由；`generateReport` 带 verdict | Modify |
| `apps/api/src/bid/bid.service.ts` | `generateEvaluationResults` 废标判定 | Modify |
| `apps/api/src/expert/expert.service.spec.ts` | submitScores / report 通过性用例 | Modify |
| `apps/api/src/bid/bid.service.spec.ts` | 废标用例 | Modify |
| `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` | 通过性隐藏满分输入 | Modify |
| `apps/bid-portal/src/app/(dashboard)/bid/evaluate/page.tsx` | 废标徽标 | Modify |
| `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` | 打分页通过性开关 + 报告页 verdict | Modify |
| `apps/api/prisma/seed-data/BidScoreRecord.json` | 通过性记录补 `passed` | Modify |
| `apps/api/prisma/seed-data/BidEvaluationResult.json` | 废标者补 `disqualified` | Modify |

---

### Task 1: Prisma schema — 加列 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`BidScoreRecord` 约 `:222-237`、`BidEvaluationResult` 约 `:304-318`）
- Create: `apps/api/prisma/migrations/<timestamp>_add_pass_fail_review/migration.sql`

**Interfaces:**
- Produces: `BidScoreRecord.passed Boolean?`、`BidEvaluationResult.disqualified Boolean @default(false)` 落库；Prisma Client 重新生成后这两个字段可用于后续 Task。

- [ ] **Step 1: 停掉 dev，改 schema**

先停 `pnpm dev`（Windows engine 锁）。在 `BidScoreRecord` model 的 `score` 行后加 `passed`，在 `BidEvaluationResult` 的 `recommended` 行后加 `disqualified`：

```prisma
model BidScoreRecord {
  id          String       @id @default(cuid())
  expertId    String
  scoreItemId String
  supplierId  String
  score       Decimal      @db.Decimal(5, 1)
  passed      Boolean?                        // 新增：通过性项裁定
  reason      String?
  expert      BidExpert    @relation(fields: [expertId], references: [id], onDelete: Cascade)
  scoreItem   BidScoreItem @relation(fields: [scoreItemId], references: [id], onDelete: Cascade)
  supplier    BidSupplier  @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  createdAt   DateTime     @default(now())

  @@unique([expertId, scoreItemId, supplierId])
  @@index([supplierId])
  @@index([scoreItemId, supplierId])
}
```

```prisma
model BidEvaluationResult {
  id           String     @id @default(cuid())
  projectId    String
  supplierId   String
  supplierName String
  totalScore   Decimal    @db.Decimal(6, 2)
  averageScore Decimal    @db.Decimal(6, 2)
  rank         Int
  recommended  Boolean    @default(false)
  disqualified Boolean    @default(false)   // 新增：废标
  generatedAt  DateTime   @default(now())
  project      BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, supplierId])
  @@index([projectId, rank])
}
```

- [ ] **Step 2: 生成并应用迁移**

```bash
cd water-erp && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm --filter api exec prisma migrate dev --name add_pass_fail_review
```
Expected: 生成 `migrations/<ts>_add_pass_fail_review/migration.sql`（含两条 `ALTER TABLE ... ADD COLUMN`），并应用成功、Prisma Client 重新生成。

> 若 `migrate dev` 仍卡交互：改为 `pnpm --filter api exec prisma migrate dev --create-only --name add_pass_fail_review` 生成 SQL 后，`pnpm --filter api exec prisma db execute --file <migration.sql>` 再 `pnpm --filter api exec prisma migrate resolve --applied <migration_name>`。

- [ ] **Step 3: 回归现有测试**

```bash
cd water-erp && pnpm --filter api test
```
Expected: 全绿（新列 nullable / 有默认值，不破坏既有用例）。

- [ ] **Step 4: Commit**

```bash
cd water-erp && git add apps/api/prisma/schema.prisma apps/api/prisma/migrations && git commit -m "feat(bid): add BidScoreRecord.passed & BidEvaluationResult.disqualified columns"
```

---

### Task 2: Shared — `isPassFailCategory` + 类型更新

**Files:**
- Modify: `packages/shared/src/constants.ts`（`CATEGORY_LABEL` 在 `:105`）
- Modify: `packages/shared/src/types.ts`（`ExpertProject.scoreRecords` `:167`、`ExpertProjectDetail.myScores` `:172`、`EvaluationReport` `:200-214`）

**Interfaces:**
- Produces: `isPassFailCategory(category: string): boolean`；类型字段 `passed?: boolean | null`（record 类）、`passed?: boolean`（report item）、`disqualified?: boolean`（result 类）。

- [ ] **Step 1: 加 `isPassFailCategory`**

在 `packages/shared/src/constants.ts` 文件末尾追加：

```ts
/** 通过性审查类别（通过/不通过），区别于数值打分类别。 */
export const PASS_FAIL_CATEGORIES = new Set(['QUALIFICATION', 'RESPONSIVE']);
export const isPassFailCategory = (category: string): boolean => PASS_FAIL_CATEGORIES.has(category);
```

- [ ] **Step 2: 类型加 `passed` / `disqualified`**

`types.ts`：
- `ExpertProject.scoreRecords`（`:167`）元素类型加 `passed?: boolean | null`：
```ts
  scoreRecords: { id: string; expertId: string; supplierId: string; scoreItemId: string; score: number; passed?: boolean | null; reason?: string; scoreItem: BidScoreItem }[];
```
- `ExpertProjectDetail.myScores`（`:172`）同样加 `passed?: boolean | null`。
- `EvaluationReport` 的 `categoryScores` item（`:211`）加 `passed?: boolean`：
```ts
    categoryScores: Record<string, { total: number; max: number; items: { name: string; score: number; maxScore: number; passed?: boolean; reason?: string }[] }>;
```
- 在 `EvaluationReport` 内（或紧邻 `BidScoreItem`）加 result 展示类型注记。在文件末尾追加：
```ts
export interface BidEvaluationResultView {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  averageScore: number;
  rank: number;
  recommended: boolean;
  disqualified?: boolean;
  generatedAt: string;
}
```

- [ ] **Step 3: build shared**

```bash
cd water-erp && pnpm --filter @water-erp/shared build
```
Expected: 编译成功，`dist/` 含新导出。

- [ ] **Step 4: Commit**

```bash
cd water-erp && git add packages/shared && git commit -m "feat(shared): add isPassFailCategory + passed/disqualified types"
```

---

### Task 3: 后端 submitScores — 通过性路由（TDD）

**Files:**
- Modify: `apps/api/src/expert/dto/batch-score.dto.ts`
- Modify: `apps/api/src/expert/expert.service.ts`（`submitScores` `:351-481`，校验 `:378-410`，upsert `:426-444`）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: `BidScoreRecord.passed`（Task 1）、`isPassFailCategory`（Task 2）。
- Produces: `POST /expert/projects/:id/scores` 接受 `{ scoreItemId, supplierId, passed?, score?, reason? }`；通过性项落库 `score=0` + `passed`。

- [ ] **Step 1: 写失败测试**

在 `expert.service.spec.ts` 的 submitScores 相关 describe 块内新增（mock 套路与现有用例一致：`prisma.bidExpert.findFirst` / `bidScoreItem.findMany` / `bidSupplier.findMany` / `bidProject.findUnique` / `bidScoreRecord.upsert` / `bidExpert.update` 等已 mock）：

```ts
  it('submitScores：通过性项接收 passed、跳过 maxScore、落库 score=0', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({
      id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
      signedIn: true, avoidanceConfirmed: true, conflictedSupplierIds: [], expertName: '刘',
    });
    // 通过性项 maxScore=0
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 'si1', maxScore: 0, category: 'QUALIFICATION' },
    ]);
    prisma.bidSupplier.findMany.mockResolvedValue([
      { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
    ]);
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
    prisma.bidScoreRecord.upsert.mockResolvedValue({});
    prisma.bidScoreItem.findMany // progress 回读
      .mockResolvedValueOnce([{ id: 'si1', maxScore: 0, category: 'QUALIFICATION' }])
      .mockResolvedValueOnce([{ id: 'si1' }]);
    prisma.bidScoreRecord.count.mockResolvedValue(1);
    prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 0 }]);
    prisma.bidExpert.update.mockResolvedValue({});

    await service.submitScores('u1', 'p1', {
      supplierName: '甲',
      scores: [{ scoreItemId: 'si1', supplierId: 'sup1', passed: false, reason: '资质不符' }],
    } as any);

    expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ score: 0, passed: false, reason: '资质不符' }),
      create: expect.objectContaining({ score: 0, passed: false }),
    }));
  });

  it('submitScores：通过性项缺 passed 报错', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({
      id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
      signedIn: true, avoidanceConfirmed: true, conflictedSupplierIds: [], expertName: '刘',
    });
    prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 0, category: 'RESPONSIVE' }]);
    prisma.bidSupplier.findMany.mockResolvedValue([
      { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
    ]);
    await expect(service.submitScores('u1', 'p1', {
      supplierName: '甲',
      scores: [{ scoreItemId: 'si1', supplierId: 'sup1', score: 0 }],
    } as any)).rejects.toThrow(BadRequestException);
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd water-erp && pnpm --filter api test -- expert.service.spec
```
Expected: 两个新用例 FAIL（现在校验把 score 当必填、无 category 路由）。

- [ ] **Step 3: 改 DTO**

`batch-score.dto.ts`：

```ts
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class ScoreItemDto {
  @IsString() @IsNotEmpty()
  scoreItemId: string;

  @IsString() @IsNotEmpty()
  supplierId: string;

  @IsNumber() @Min(0) @Max(100) @IsOptional()
  score?: number;

  @IsBoolean() @IsOptional()
  passed?: boolean;

  @IsString() @IsOptional()
  reason?: string;
}

export class BatchScoreDto {
  @IsString() @IsNotEmpty()
  supplierName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreItemDto)
  scores: ScoreItemDto[];
}
```

- [ ] **Step 4: 改 submitScores 校验 + upsert**

`expert.service.ts`：

(a) 查评分项 `select` 加 `category`（`:380-383`）：
```ts
    const scoreItems = await this.prisma.bidScoreItem.findMany({
      where: { id: { in: scoreItemIds }, projectId },
      select: { id: true, maxScore: true, category: true },
    });
```
建 map 改为含 category：
```ts
    const itemMeta = new Map(scoreItems.map(si => [si.id, { maxScore: Number(si.maxScore), category: si.category as string }]));
```

(b) 替换校验块（`:402-410`）为按类别路由：
```ts
    for (const item of dto.scores) {
      const meta = itemMeta.get(item.scoreItemId);
      if (!meta) continue;
      if (meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE') {
        // 通过性项：必须有 passed，忽略 score
        if (typeof item.passed !== 'boolean') {
          throw new BadRequestException({
            error: `通过性审查项 ${item.scoreItemId} 必须提供 passed（通过/不通过）`,
            code: 'PASS_FAIL_VERDICT_REQUIRED',
          });
        }
        item.score = 0; // 落库固定 0，不进总分
      } else {
        // 数值项：必须有 score 且 ≤ maxScore
        if (typeof item.score !== 'number') {
          throw new BadRequestException({
            error: `评分项 ${item.scoreItemId} 必须提供 score`,
            code: 'SCORE_REQUIRED',
          });
        }
        if (item.score > meta.maxScore) {
          throw new BadRequestException({
            error: `评分项 ${item.scoreItemId} 分数 ${item.score} 超过满分 ${meta.maxScore}`,
            code: 'SCORE_EXCEEDS_MAX',
          });
        }
        item.passed = null;
      }
    }
```

(c) upsert（`:426-444`）写入 `passed`：
```ts
      for (const item of dto.scores) {
        await tx.bidScoreRecord.upsert({
          where: {
            expertId_scoreItemId_supplierId: {
              expertId: expert.id,
              scoreItemId: item.scoreItemId,
              supplierId: item.supplierId,
            },
          },
          update: { score: item.score ?? 0, passed: item.passed ?? null, reason: item.reason },
          create: {
            expertId: expert.id,
            scoreItemId: item.scoreItemId,
            supplierId: item.supplierId,
            score: item.score ?? 0,
            passed: item.passed ?? null,
            reason: item.reason,
          },
        });
      }
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd water-erp && pnpm --filter api test -- expert.service.spec
```
Expected: 新用例 PASS，既有用例不回归。

- [ ] **Step 6: Commit**

```bash
cd water-erp && git add apps/api/src/expert && git commit -m "feat(expert): route pass/fail verdicts in submitScores"
```

---

### Task 4: 后端 generateReport — categoryScores 带 verdict

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`generateReport` 组装 `categoryScores` `:591-604`）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: 报告 `categoryScores[cat].items[i].passed` 对通过性类别有值，供前端 Task 8 渲染。

- [ ] **Step 1: 写失败测试**

```ts
  it('generateReport：通过性类别的 item 带 passed', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp1', userId: 'u1', projectId: 'p1', progress: 100, expertName: '刘', signedIn: true, avoidanceConfirmed: true });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: '项目', projectCode: 'P1', suppliers: [{ id: 'sup1', supplierName: '甲' }],
      scoreItems: [{ id: 'si1', category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 }],
    });
    prisma.bidScoreRecord.findMany.mockResolvedValue([
      { supplierId: 'sup1', score: 0, passed: false, reason: '不符', scoreItem: { id: 'si1', category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 } },
    ]);
    const report = await service.generateReport('u1', 'p1');
    const item = report.supplierScores[0].categoryScores['QUALIFICATION'].items[0];
    expect(item.passed).toBe(false);
  });
```
（若 `generateReport` 方法名不同，以 spec 内既有 report 用例的实际方法名为准。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd water-erp && pnpm --filter api test -- expert.service.spec
```
Expected: FAIL（item 无 `passed`）。

- [ ] **Step 3: 改 generateReport**

`expert.service.ts` `:598-603` 的 push 加 `passed`：
```ts
        categoryScores[cat].items.push({
          name: record.scoreItem.name,
          score: Number(record.score),
          maxScore: Number(record.scoreItem.maxScore),
          passed: (record as any).passed ?? undefined,
          reason: record.reason || undefined,
        });
```
（`include: { scoreItem: true }` 的 findMany（`:575-578`）默认会带 `passed` 列，无需改 include。）

- [ ] **Step 4: 跑测试确认通过**

```bash
cd water-erp && pnpm --filter api test -- expert.service.spec
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd water-erp && git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts && git commit -m "feat(expert): expose pass/fail verdict in evaluation report"
```

---

### Task 5: 后端 generateEvaluationResults — 废标判定（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`generateEvaluationResults` `:911-1025`，排名循环 `:962-989`、createMany `:994-1004`）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: `BidScoreRecord.passed`（Task 1）、`BidEvaluationResult.disqualified`（Task 1）。
- Produces: `generateEvaluationResults` 写入 `disqualified`；废标者排末位、`recommended=false`，并写监督日志。

**判定规则（写入实现）：** 对每个 active 供应商、每个通过性项：`failCount` = 该供应商该项 `passed === false` 的记录数，`verdictCount` = `passed` 非 null 的记录数；若 `failCount > verdictCount - failCount`（不通过票严格过半）→ 该项不合格。任一通过性项不合格 → 供应商 `disqualified = true`。

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 评标结果相关 describe 内新增（沿用既有 mock 套路；`prisma.bidProject.findUnique` / `bidScoreRecord.findMany` / `bidEvaluationResult.deleteMany`+`createMany` / `bidSupervisionLog.create` 等）：

```ts
  it('generateEvaluationResults：通过性过半不通过 → 废标，排末位且不推荐', async () => {
    // 3 专家，2 票不通过 1 票通过 → 过半废标
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false,
      experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }, { id: 'e3', reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
    });
    prisma.bidScoreRecord.findMany.mockResolvedValue([
      // 通过性项：2 不通过 + 1 通过
      { supplierId: 's1', expertId: 'e1', score: 0, passed: false },
      { supplierId: 's1', expertId: 'e2', score: 0, passed: false },
      { supplierId: 's1', expertId: 'e3', score: 0, passed: true },
      // 数值项每人 10 分
      { supplierId: 's1', expertId: 'e1', score: 10 },
      { supplierId: 's1', expertId: 'e2', score: 10 },
      { supplierId: 's1', expertId: 'e3', score: 10 },
    ]);
    prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
    prisma.bidEvaluationResult.createMany.mockResolvedValue({});
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.bidEvaluationResult.findMany.mockResolvedValue([
      { supplierId: 's1', supplierName: '甲', totalScore: 30, averageScore: 10, rank: 1, recommended: false, disqualified: true },
    ]);

    await service.generateEvaluationResults('p1');

    const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
    expect(created.disqualified).toBe(true);
    expect(created.recommended).toBe(false);
  });

  it('generateEvaluationResults：不通过不过半 → 不废标', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false,
      experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }, { id: 'e3', reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
    });
    // 1 不通过 2 通过 → 不过半
    prisma.bidScoreRecord.findMany.mockResolvedValue([
      { supplierId: 's1', expertId: 'e1', score: 0, passed: false },
      { supplierId: 's1', expertId: 'e2', score: 0, passed: true },
      { supplierId: 's1', expertId: 'e3', score: 0, passed: true },
      { supplierId: 's1', expertId: 'e1', score: 20 },
      { supplierId: 's1', expertId: 'e2', score: 20 },
      { supplierId: 's1', expertId: 'e3', score: 20 },
    ]);
    prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
    prisma.bidEvaluationResult.createMany.mockResolvedValue({});
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.bidEvaluationResult.findMany.mockResolvedValue([]);

    await service.generateEvaluationResults('p1');
    const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
    expect(created.disqualified).toBe(false);
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd water-erp && pnpm --filter api test -- bid.service.spec
```
Expected: FAIL（无 `disqualified` 字段、无废标逻辑）。

- [ ] **Step 3: 改 generateEvaluationResults**

`bid.service.ts`：

(a) 现有 `allScoreRecords` 查询（`:947-950`）已经拿到全部记录（含 `passed`）。在排名循环（`:966`）前，构造通过性裁定聚合。在 `const ranked: ... = []`（`:965`）**之前**插入：

```ts
    // ── 通过性审查废标判定：某项不通过票严格过半 → 该供应商废标 ──
    const passFailVerdicts = new Map<string, boolean>(); // supplierId -> disqualified
    const passFailFailures: { supplierId: string; supplierName: string; category: string; fail: number; total: number }[] = [];
    {
      // 收集所有通过性 scoreItemId（按项目）
      const passFailItemIds = new Set<string>();
      // 需要每个 record 的 scoreItem.category；上面 allScoreRecords 未 include scoreItem，单独查一次通过性项
      const passFailItems = await this.prisma.bidScoreItem.findMany({
        where: { projectId, category: { in: ['QUALIFICATION', 'RESPONSIVE'] } },
        select: { id: true, category: true },
      });
      for (const it of passFailItems) passFailItemIds.add(it.id);
      const categoryById = new Map(passFailItems.map(it => [it.id, it.category as string]));

      for (const supplier of activeSuppliers) {
        const records = recordsBySupplier.get(supplier.id) ?? [];
        let disqualified = false;
        // 逐项统计
        const byItem = new Map<string, { fail: number; total: number }>();
        for (const r of records) {
          if (!passFailItemIds.has(r.scoreItemId) || r.passed === null || r.passed === undefined) continue;
          const agg = byItem.get(r.scoreItemId) ?? { fail: 0, total: 0 };
          agg.total += 1;
          if (r.passed === false) agg.fail += 1;
          byItem.set(r.scoreItemId, agg);
        }
        for (const [itemId, agg] of byItem) {
          if (agg.fail > agg.total - agg.fail) { // 不通过票严格过半
            disqualified = true;
            passFailFailures.push({
              supplierId: supplier.id, supplierName: supplier.supplierName,
              category: categoryById.get(itemId) || '通过性', fail: agg.fail, total: agg.total,
            });
          }
        }
        passFailVerdicts.set(supplier.id, disqualified);
      }
    }
```

(b) 排名循环里给每个 `ranked.push(...)`（`:985`）加 `disqualified`：
```ts
    const ranked: { supplierId: string; supplierName: string; totalScore: number; averageScore: number; disqualified: boolean }[] = [];
    for (const supplier of activeSuppliers) {
      // ...既有 perExpert / expertTotals / averageScore 计算...
      ranked.push({ supplierId: supplier.id, supplierName: supplier.supplierName, totalScore, averageScore, disqualified: !!passFailVerdicts.get(supplier.id) });
    }
    // 合格者在前、废标者在后；同组内按 averageScore 降序
    ranked.sort((a, b) => {
      if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
      return b.averageScore - a.averageScore;
    });
```
（删掉原 `ranked.sort((a, b) => b.averageScore - a.averageScore);` 行 `:987`。）

(c) `winnerCount` 与 createMany（`:989-1004`）：候选人只从合格者中产生，废标者恒不推荐：
```ts
    const qualifiedRanked = ranked.filter(r => !r.disqualified);
    const winnerCount = Math.min(this.DEFAULT_WINNER_COUNT, qualifiedRanked.length);
    // ...deleteMany...
        await tx.bidEvaluationResult.createMany({
          data: ranked.map((r, index) => ({
            projectId,
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            totalScore: r.totalScore,
            averageScore: r.averageScore,
            rank: index + 1,
            recommended: !r.disqualified && index < winnerCount,
            disqualified: r.disqualified,
          })),
        });
```

(d) 监督日志（在现有 `bidSupervisionLog.create` 的事务块内 `:1006-1019` 附近追加）：
```ts
      for (const f of passFailFailures) {
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: f.supplierName,
            action: '资格审查', result: `因${f.category === 'QUALIFICATION' ? '资格' : '响应性'}性审查不通过废标（不通过 ${f.fail}/${f.total} 票）`, riskFlag: '高风险',
          },
        });
      }
```
> 注意：上面 result 字符串里的 `${f.fail}` 必须用模板字符串反引号，写入文件时确保是 `` `因...废标（不通过 ${f.fail}/${f.total} 票）` ``。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd water-erp && pnpm --filter api test -- bid.service.spec
```
Expected: 两个新用例 PASS，既有 ranking 用例不回归（若既有用例断言了 `recommended: index < winnerCount` 的旧全量语义，按需调整断言为合格者优先）。

- [ ] **Step 5: Commit**

```bash
cd water-erp && git add apps/api/src/bid && git commit -m "feat(bid): disqualify suppliers failing pass/fail review by majority"
```

---

### Task 6: 前端 评分标准页 — 通过性隐藏满分输入

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`

**Interfaces:**
- Consumes: `isPassFailCategory`（Task 2）。

- [ ] **Step 1: 引入 helper**

文件顶部 import 改为：
```ts
import { CATEGORY_LABEL, CATEGORY_COLOR, STAGE_LABEL, isPassFailCategory } from '@water-erp/shared';
```

- [ ] **Step 2: 表格"满分"列对通过性显示徽标**

把展示态（`:213-217`）改为：
```tsx
                        {isEdit ? (
                          isPassFailCategory(editDraft.category) ? (
                            <span className="text-xs font-bold text-[#5a6d8a]">通过性</span>
                          ) : (
                            <input type="number" min={0} step="0.1"
                              value={editDraft.maxScore}
                              onChange={e => setEditDraft(d => ({ ...d, maxScore: Number(e.target.value) }))}
                              className={`${inputCls} w-[100px] font-mono`} />
                          )
                        ) : (
                          <span className="font-mono text-sm font-bold text-[#064ea2]">
                            {isPassFailCategory(it.category) ? '通过性' : (Number(it.maxScore) > 0 ? `${Number(it.maxScore)}` : '—')}
                          </span>
                        )}
```

- [ ] **Step 3: 新增行同样处理（`:268-275`）**

```tsx
                      {isPassFailCategory(draft.category) ? (
                        <span className="text-xs font-bold text-[#5a6d8a]">通过性</span>
                      ) : (
                        <input type="number" min={0} step="0.1"
                          value={draft.maxScore}
                          onChange={e => setDraft(d => ({ ...d, maxScore: Number(e.target.value) }))}
                          className={`${inputCls} w-[100px] font-mono`} />
                      )}
```

- [ ] **Step 4: 创建/保存固定通过性 maxScore=0**

`handleCreate`（`:63`）与 `handleSaveEdit`（`:80-82`）里把 `maxScore: Number(...)` 改为：
```ts
maxScore: isPassFailCategory(draft.category) ? 0 : Number(draft.maxScore),
```
（编辑态用 `editDraft`。）

- [ ] **Step 5: 构建**

```bash
cd water-erp && pnpm --filter @water-erp/bid-portal build
```
Expected: 成功。

- [ ] **Step 6: Commit**

```bash
cd water-erp && git add apps/bid-portal/src/app/\(dashboard\)/bid/standard/page.tsx && git commit -m "feat(bid-portal): hide maxScore for pass/fail categories on standard page"
```

---

### Task 7: 前端 专家打分页 — 通过性开关

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`
  - `scores` state `:110`、`handleSubmitScores` `:355`、`scoresPayload` `:384`、打分项渲染 `:1124-1164`、汇总 `:1118-1122/1174-1178`

**Interfaces:**
- Consumes: `isPassFailCategory`（Task 2）；payload 形态见 Task 3 `Produces`。
- Produces: 通过性项 UI 为「通过 / 不通过」按钮；提交 payload 通过性项带 `passed`。

- [ ] **Step 1: state 形态加 `passed`**

`:110`：
```ts
  const [scores, setScores] = useState<Record<string, { score: number; reason: string; passed?: boolean }>>({});
```

- [ ] **Step 2: 引入 helper**

文件顶部从 `@water-erp/shared` import 增加 `isPassFailCategory`。

- [ ] **Step 3: 打分项渲染分支**

把 `:1124-1164` 的 `items.map(item => (...))` 整块替换为：通过性项渲染两按钮 + 不通过理由；数值项保持原滑块。完整替换块：

```tsx
                            {items.map(item => {
                              const k = scoreKey(activeSupplier, item.id);
                              const val = scores[k];
                              const reasonMissing = missingReasons.has(item.id);
                              const passFail = isPassFailCategory(item.category);
                              if (passFail) {
                                const verdict = val?.passed;
                                return (
                                  <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                    <h4 className="font-semibold text-[oklch(0.18_0.012_265)] mb-3">{item.name}</h4>
                                    <div className="flex items-center gap-3 mb-3">
                                      {[
                                        { v: true, label: '通过', cls: verdict === true ? 'bg-[#11a874] text-white border-[#11a874]' : 'bg-white text-[#11a874] border-[#11a874]/40 hover:bg-[#ecfdf5]' },
                                        { v: false, label: '不通过', cls: verdict === false ? 'bg-[#e74c3c] text-white border-[#e74c3c]' : 'bg-white text-[#e74c3c] border-[#e74c3c]/40 hover:bg-[#fef2f2]' },
                                      ].map(opt => (
                                        <button key={String(opt.v)} type="button"
                                          onClick={() => setScores(prev => ({ ...prev, [k]: { score: 0, reason: prev[k]?.reason || '', passed: opt.v } }))}
                                          className={`px-5 py-2 rounded-lg text-sm font-bold border transition ${opt.cls}`}>
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                    {verdict === false && (
                                      <textarea placeholder="不通过理由（必填）" value={val?.reason || ''}
                                        onChange={e => {
                                          const v = e.target.value;
                                          setScores(prev => ({ ...prev, [k]: { score: 0, reason: v, passed: false } }));
                                          if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                        }}
                                        className={`w-full rounded-lg px-3 py-2 text-sm text-[oklch(0.18_0.012_265)] resize-none h-16 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-blue-100 focus:ring-[#064ea2]'}`}
                                        aria-label={`${item.name} 不通过理由`} />
                                    )}
                                    {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold">⚠ 请选择「通过 / 不通过」，不通过需填理由</p>}
                                  </div>
                                );
                              }
                              // 数值项：保持原渲染
                              const currentScore = val?.score ?? 0;
                              const max = Number(item.maxScore);
                              const pct = max > 0 ? (currentScore / max) * 100 : 0;
                              return (
                                <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</h4>
                                    <span className="text-sm text-[oklch(0.55_0.01_264)]">满分 {max}</span>
                                  </div>
                                  <div className="flex items-center gap-4 mb-3">
                                    <input type="range" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: parseFloat(e.target.value), reason: prev[k]?.reason || '' } }))}
                                      className="flex-1 h-2 bg-[oklch(0.94_0.004_264)] rounded-full appearance-none cursor-pointer accent-[#064ea2]"
                                      style={{ background: `linear-gradient(to right, ${CATEGORY_COLOR[category] || '#064ea2'} ${pct}%, #f0f4f8 ${pct}%)` }}
                                      aria-label={`${item.name} 评分`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={currentScore} tabIndex={0} />
                                    <input type="number" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: Math.min(parseFloat(e.target.value) || 0, max), reason: prev[k]?.reason || '' } }))}
                                      className="w-20 text-center border border-blue-100 rounded-lg px-2 py-1.5 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2] outline-none"
                                      aria-label={`${item.name} 数值输入`} tabIndex={0} />
                                  </div>
                                  <textarea placeholder="评分理由（低于满分必填）" value={val?.reason || ''}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setScores(prev => ({ ...prev, [k]: { score: prev[k]?.score ?? 0, reason: v } }));
                                      if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                    }}
                                    className={`w-full rounded-lg px-3 py-2 text-sm resize-none h-16 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-blue-100 focus:ring-[#064ea2]'}`}
                                    aria-label={`${item.name} 评分理由`} tabIndex={0} />
                                  {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold">⚠ 该项得分低于满分，请填写评分理由</p>}
                                </div>
                              );
                            })}
```

- [ ] **Step 4: 分类汇总头对通过性显示"通过性审查"**

`:1118-1122` 改为：
```tsx
                            <div className="flex items-center gap-3">
                              {isPassFailCategory(category) ? (
                                <span className="text-sm font-bold text-[oklch(0.55_0.01_264)]">通过性审查</span>
                              ) : (
                                <>
                                  <span className="text-sm text-[oklch(0.55_0.01_264)]">得分</span>
                                  <span className="text-lg font-bold" style={{ color: CATEGORY_COLOR[category] || '#064ea2' }}>{catScored}</span>
                                  <span className="text-sm text-[oklch(0.55_0.01_264)]">/ {catTotal}</span>
                                </>
                              )}
                            </div>
```

- [ ] **Step 5: 提交校验 + payload**

`handleSubmitScores`（`:355-`）。把校验循环改为按类别：通过性项必须已选且不通过必填理由；数值项沿用低于满分必填。把 `scoresPayload`（`:384`）改为：
```ts
    const scoresPayload = project.scoreItems.map(si => {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      if (isPassFailCategory(si.category)) {
        return { scoreItemId: si.id, supplierId: activeSupplier, passed: entry?.passed, reason: entry?.reason ?? '' };
      }
      return { scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '' };
    });
```
校验段（替换原"低于满分必填"逻辑）：
```ts
    const missing: string[] = [];
    for (const si of project.scoreItems) {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      if (isPassFailCategory(si.category)) {
        if (typeof entry?.passed !== 'boolean' || (entry.passed === false && !(entry.reason || '').trim())) {
          missing.push(si.id);
        }
      } else {
        const score = entry?.score ?? 0;
        if (score < Number(si.maxScore) && !(entry?.reason || '').trim()) missing.push(si.id);
      }
    }
```
（toast 文案可微调为"有评分项未完成"。）

- [ ] **Step 6: 草稿结构兼容**

`saveDraftNow` / `restoreDraft` / 自动保存（`:85-120` 附近，scoring-step 风格的 localStorage）若引用了 `{ score, reason }`，无需改（结构已加 `passed` 为可选，序列化天然兼容）。无需改动代码，仅确认编译通过。

- [ ] **Step 7: 构建**

```bash
cd water-erp && pnpm --filter @water-erp/expert-portal build
```
Expected: 成功（注：dev 用 `--webpack`，build 用默认）。

- [ ] **Step 8: Commit**

```bash
cd water-erp && git add apps/expert-portal/src/app/\(app\)/evaluate/\[id\]/page.tsx && git commit -m "feat(expert-portal): pass/fail toggle for qualification/responsive scoring"
```

---

### Task 8: 前端 评审报告页 — verdict 渲染

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（报告 categoryScores 渲染 `:1252-1257`）

- [ ] **Step 1: 改报告分类卡片**

`:1252-1257` 替换为：
```tsx
                          {Object.entries(ss.categoryScores).map(([cat, data]) => {
                            const passFail = isPassFailCategory(cat);
                            const firstPassed = data.items[0]?.passed;
                            return (
                              <div key={cat} className="bg-blue-50 rounded-lg p-3" style={{ borderLeft: `2px solid ${CATEGORY_COLOR[cat] || '#064ea2'}` }}>
                                <div className="text-xs font-semibold mb-1" style={{ color: CATEGORY_COLOR[cat] || '#064ea2' }}>{CATEGORY_LABEL[cat] || cat}</div>
                                {passFail ? (
                                  <div className={`text-lg font-bold ${firstPassed === false ? 'text-[#e74c3c]' : 'text-[#11a874]'}`}>
                                    {firstPassed === false ? '不通过' : '通过'}
                                  </div>
                                ) : (
                                  <div className="text-lg font-bold text-[oklch(0.18_0.012_265)]">{data.total} <span className="text-xs text-[oklch(0.55_0.01_264)] font-normal">/ {data.max}</span></div>
                                )}
                              </div>
                            );
                          })}
```

- [ ] **Step 2: 构建**

```bash
cd water-erp && pnpm --filter @water-erp/expert-portal build
```
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
cd water-erp && git add apps/expert-portal/src/app/\(app\)/evaluate/\[id\]/page.tsx && git commit -m "feat(expert-portal): show pass/fail verdict on evaluation report"
```

---

### Task 9: 前端 评标端 — 废标徽标

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/evaluate/page.tsx`（结果展示约 `:801-853`，`evalResult` 读取处）

- [ ] **Step 1: 读取 disqualified 并显示徽标**

在该行（`evalResult?.recommended` 判断附近 `:850-853`）之前/同级，加废标标记。找到展示候选人徽标的 `<td>`，在其内补充：

```tsx
{evalResult?.disqualified ? (
  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 tracking-wide rounded-full text-[#e74c3c] border border-[#e74c3c]/40 bg-[#fef2f2]">
    废标（资格/响应性不通过）
  </span>
) : evalResult?.recommended ? (
  /* 既有"第一中标候选人"徽标保持不变 */
  null
) : null}
```
> 实现时保留既有 `recommended` 徽标 JSX，仅在 `disqualified` 为真时优先显示废标徽标；行 `className` 可对废标行追加 `opacity-60`。`evalResult` 类型若来自 local interface（`:34-37` 附近），给其加 `disqualified?: boolean`。

- [ ] **Step 2: 构建**

```bash
cd water-erp && pnpm --filter @water-erp/bid-portal build
```
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
cd water-erp && git add apps/bid-portal/src/app/\(dashboard\)/bid/evaluate/page.tsx && git commit -m "feat(bid-portal): show disqualified badge on evaluation results"
```

---

### Task 10: 种子数据 — 通过性裁定 + 演示废标

**Files:**
- Modify: `apps/api/prisma/seed-data/BidScoreRecord.json`
- Modify: `apps/api/prisma/seed-data/BidEvaluationResult.json`

**Interfaces:**
- Produces: 重 seed 后，hero 项目通过性记录带 `passed`；1 家 demo 供应商响应性 `passed=false` 且 result `disqualified=true`，端到端演示废标链路。

- [ ] **Step 1: 给所有 QUALIFICATION/RESPONSIVE 记录加 `passed`**

对 `BidScoreRecord.json` 中 `category`（需通过其 `scoreItemId` 对照 `BidScoreItem.json`）为 `QUALIFICATION`/`RESPONSIVE` 的每条记录，加字段：
```json
"passed": true
```
（多数通过；`score` 保持 0。）

- [ ] **Step 2: 选 1 家 hero 供应商演示响应性不通过 + 废标**

在 hero 项目 `cmqhero-bid-proj01` 里，挑一家**非第 1 名**的供应商（如解密异常的「四川省通信产业服务有限公司」，或一家陪标供应商），把对其的 `RESPONSIVE`（符合性审查，`cmqhero-si02`）记录设为：
```json
"passed": false,
"reason": "投标文件响应性条款缺失"
```
（若该供应商在 seed 里仅有一条 RESPONSIVE 记录代表"专家组结论"，则单条 false 即可演示；多专家记录则需过半为 false。）

- [ ] **Step 3: BidEvaluationResult.json 该家置废标**

`BidEvaluationResult.json` 中 hero 项目该家 result 加：
```json
"disqualified": true,
"recommended": false
```
并把其 `rank` 调到末位（其余合格家 rank 顺延，保持连续）。其他合格家加 `"disqualified": false`。

- [ ] **Step 4: 重 seed 验证**

先停 `pnpm dev`：
```bash
cd water-erp && pnpm db:seed
```
Expected: seed 成功（seed.ts 直接 load JSON，新字段透传）。用 Prisma Studio 或一条查询确认该家 `disqualified=true`、通过性记录 `passed` 已落库。

- [ ] **Step 5: Commit**

```bash
cd water-erp && git add apps/api/prisma/seed-data/BidScoreRecord.json apps/api/prisma/seed-data/BidEvaluationResult.json && git commit -m "chore(seed): pass/fail verdicts + demo disqualified supplier"
```

---

### Task 11: 全量回归 + 手动核验

**Files:** 无（验证任务）

- [ ] **Step 1: 后端全量测试**

```bash
cd water-erp && pnpm --filter api test
```
Expected: 全绿。

- [ ] **Step 2: 前端构建**

```bash
cd water-erp && pnpm --filter @water-erp/bid-portal build && pnpm --filter @water-erp/expert-portal build
```
Expected: 成功。

- [ ] **Step 3: 手动核验（起 dev）**

- `http://localhost:3007/bid/project/cmqhero-bid-proj01?tab=standard` → 资格性/符合性审查两行"满分"列显示"通过性"徽标，无数字输入。
- 专家门户（`bid_expert` 登录）进入该项目打分页 → 资格/响应性两项为「通过 / 不通过」按钮；其余为滑块。选"不通过"出理由框；提交成功。
- 评审报告页 → 资格/响应性卡片显示"通过/不通过"。
- 评标端 `:3007/bid/evaluate` → 演示废标家显示红色"废标"徽标、不进候选人；合格家按分排名。

- [ ] **Step 4: 无新 commit（验证任务）；如发现缺陷回到对应 Task 修复**

---

## Self-Review（计划完成后自检）

**1. Spec 覆盖：** 逐条对照 spec——数据模型两列(T1)、isPassFailCategory+类型(T2)、submitScores 路由(T3)、report verdict(T4)、废标过半判定+排名+监督日志(T5)、标准页(T6)、打分页(T7)、报告页(T8)、评标端徽标(T9)、种子(T10)、回归(T11)。✅ 全覆盖。

**2. 占位符扫描：** 无 TBD/TODO；每个改代码步骤都有完整代码块。✅

**3. 类型一致性：** `isPassFailCategory`、`passed`、`disqualified` 命名贯穿前后端一致；payload 通过性项用 `passed`、数值项用 `score`，与 DTO(T3) 和 service(T3) 一致。✅

**4. 边界注意：** Task 5 监督日志 result 字符串须用模板反引号（计划已标注）；既有 ranking spec 若断言旧 `recommended` 全量语义，Task 5 Step 4 已提示按需调整。
