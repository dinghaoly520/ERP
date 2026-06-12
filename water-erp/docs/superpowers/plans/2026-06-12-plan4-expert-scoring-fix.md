# Plan 4: 专家评分修复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 给 BidScoreRecord 添加 supplierId 关联；submitScores 校验项目阶段和 maxScore；getReport 按供应商独立计算分数。

**Architecture:** Prisma schema 变更 + 迁移 → 更新 BatchScoreDto → 增强 submitScores 校验 → 修复 getReport 按 supplier 分组计算。

**Tech Stack:** NestJS 11, Prisma, Jest

**Branch:** `fix/expert-scoring`

**前置依赖:** Plan 3 (开评标→EVALUATING 阶段才能评分)

---

## Step 1: 创建分支

```bash
cd D:/Claude projects/ERP-main/water-erp
git checkout main
git pull origin main
git checkout -b fix/expert-scoring
```

## Step 2: 修改 Prisma Schema

在 `BidScoreRecord` 模型中添加 `supplierId` 字段：

```prisma
model BidScoreRecord {
  id          String      @id @default(cuid())
  expertId    String
  scoreItemId String
  supplierId  String?
  score       Decimal     @db.Decimal(5, 1)
  reason      String?
  expert      BidExpert   @relation(fields: [expertId], references: [id], onDelete: Cascade)
  scoreItem   BidScoreItem @relation(fields: [scoreItemId], references: [id], onDelete: Cascade)
  supplier    BidSupplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)
  createdAt   DateTime    @default(now())

  @@index([supplierId])
}
```

运行迁移：

```bash
pnpm --filter api exec prisma format
pnpm infra:up
pnpm --filter api exec prisma migrate dev --name add_supplier_to_score_record
pnpm db:generate
```

## Step 3: 修改 BatchScoreDto

`apps/api/src/expert/dto/batch-score.dto.ts`：

```ts
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class ScoreItemDto {
  @IsString() @IsNotEmpty()
  scoreItemId: string;

  @IsString() @IsNotEmpty()
  supplierId: string;

  @IsNumber() @Min(0) @Max(100)
  score: number;

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

## Step 4: 增强 `submitScores`

在 `expert.service.ts` 的 `submitScores` 中添加阶段+maxScore 校验，填入 supplierId：

关键改动片段：

```ts
// 入口加项目阶段校验
const project = await this.prisma.bidProject.findUnique({
  where: { id: projectId },
  select: { stage: true },
});
if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
if (project.stage !== 'EVALUATING') {
  throw new BadRequestException({ error: '项目不在评标阶段', code: 'PROJECT_NOT_EVALUATING' });
}

// maxScore 校验
const scoreItemIds = dto.scores.map(s => s.scoreItemId);
const scoreItems = await this.prisma.bidScoreItem.findMany({
  where: { id: { in: scoreItemIds } },
  select: { id: true, maxScore: true },
});
const maxScoreMap = new Map(scoreItems.map(si => [si.id, Number(si.maxScore)]));

for (const item of dto.scores) {
  const maxScore = maxScoreMap.get(item.scoreItemId);
  if (maxScore !== undefined && item.score > maxScore) {
    throw new BadRequestException({
      error: `评分项 ${item.scoreItemId} 分数 ${item.score} 超过满分 ${maxScore}`,
      code: 'SCORE_EXCEEDS_MAX',
    });
  }
}

// createMany 时含 supplierId
await this.prisma.bidScoreRecord.createMany({
  data: dto.scores.map(item => ({
    expertId: expert.id,
    scoreItemId: item.scoreItemId,
    supplierId: item.supplierId,
    score: item.score,
    reason: item.reason,
  })),
});
```

注意：需读取现有的 `submitScores` 完整代码，保留身份校验（signedIn/avoidanceConfirmed）、进度计算、supervision log 等逻辑，只在上述位置插入新校验。

## Step 5: 修复 `getReport`

按 supplierId 分组，每个供应商独立计算：

```ts
async getReport(userId: string, projectId: string) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id: projectId },
    include: { suppliers: true, scoreItems: true },
  });
  // ... 现有 expert 获取逻辑 ...

  const scoreRecords = await this.prisma.bidScoreRecord.findMany({
    where: { expertId: expert.id },
    include: { scoreItem: true },
  });

  // 按 supplierId 分组
  const supplierScores = new Map<string, typeof scoreRecords>();
  for (const record of scoreRecords) {
    const key = record.supplierId || '__unassigned';
    if (!supplierScores.has(key)) supplierScores.set(key, []);
    supplierScores.get(key)!.push(record);
  }

  const supplierSummaries = project.suppliers.map(s => {
    const records = supplierScores.get(s.id) || [];
    const totalScore = records.reduce((sum, r) => sum + Number(r.score), 0);
    const maxPossible = records.reduce((sum, r) => sum + Number(r.scoreItem.maxScore), 0);
    return {
      supplierId: s.id,
      supplierName: s.supplierName,
      scoreCount: records.length,
      totalScore: Math.round(totalScore * 10) / 10,
      maxPossible,
      completed: records.length >= project.scoreItems.length,
    };
  });

  return {
    projectName: project.name,
    projectCode: project.projectCode,
    expertName: expert.expertName,
    progress: expert.progress,
    supplierSummaries,
    canConfirm: expert.progress >= 100,
  };
}
```

## Step 6: 构建 & 测试

```bash
pnpm --filter api build
pnpm --filter api test
```

## Step 7: 提交

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/expert/
git commit -m "feat: fix expert scoring — supplier linkage and validation

- Add supplierId + BidSupplier relation to BidScoreRecord
- Migration: add_supplier_to_score_record
- submitScores: validate project stage=EVALUATING, score ≤ maxScore
- getReport: compute per-supplier scores independently
- BatchScoreDto: add supplierId to each score item

Co-Authored-By: Claude <noreply@anthropic.com>"
```
