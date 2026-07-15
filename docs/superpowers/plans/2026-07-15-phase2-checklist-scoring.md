# Phase ② 专家端 checklist 打分 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 专家端打分从"滑块凭感觉给分"改成"按得分点 checklist 勾选 + 档内微调"（B2），消费 phase ① 的 `BidScorePoint`；`BidScoreRecord.score` 变为汇总列；专家端与 bid_host 代评两通道口径一致；向后兼容无 points 的旧大类。

**Architecture:** 新建 `BidScorePointDecision`（专家 per-point 裁定）。抽两个纯函数消除双通道重复：`recomputeItemFromDecisions`（item 的 score/passed 由 decisions 算）+ `recomputeExpertProgress`（progress/totalScore 重算）。`submitScores` / 代评 `submitScore` 都调它们。打分 UI 抽共享 `point-checklist-scoring.tsx` 组件（客观勾选+档内微调、主观直填），无 points 的大类回退旧滑块。

**Tech Stack:** NestJS 11 + Prisma（后端）；Next.js 16 + React 19 + Tailwind v4（expert-portal）；Jest。

## Global Constraints

- 工作目录 `water-erp/`；后端 `pnpm --filter api ...`，前端 `pnpm --filter expert-portal ...`。
- **向后兼容**（spec §10）：无 points 的 `BidScoreItem` 仍走旧直输 `score`/`passed` 路径，老项目不破。
- **双通道一致**：`ExpertService.submitScores`（:734）与 `BidService.submitScore` 代评（:1258）都调同一组纯函数，不留旁路（R1 最高风险）。
- 分数不进 WS（`bid-events.ts:7` 铁律，本 phase 不新增 WS 事件）。
- 测试 `$transaction` mock 模式：`jest.fn(async (fn) => fn(prisma))` 重用外层 prisma mock（见 `expert.service.spec.ts:54`、`bid.service.spec.ts`）。
- commit：中文 conventional + 空行 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 项目根是 `water-erp/`（不是 repo 根）。

## 现状关键事实（已核实完整代码）

- `submitScores`（`expert.service.ts:734-945`）：事务内 upsert `BidScoreRecord`（:861-880）+ delta + progress 重算（:898-917）+ 监督日志。`BidScoreRecord.score` 现为专家直输。
- 代评 `submitScore`（`bid.service.ts:1258-1379`）：**非事务**，upsert + 异常检测 + progress 重算（:1354-1371，与 expert 复制粘贴）。
- `BidScoreRecord`（`schema.prisma:403-419`）：`@@unique[expertId,scoreItemId,supplierId]`，`score Decimal`、`passed Boolean?`、`reason String?`。无 point 关联。
- `BidScorePoint`（:389-401）：模板表（name/fullScore/seq/evidenceHint/objective），phase ① 建，无 decisions。
- DTO：`BatchScoreDto`（`expert/dto/batch-score.dto.ts`，ScoreItemDto: scoreItemId/supplierId/score?/passed?/reason?）；`CreateScoreDto`（`bid/dto/create-score.dto.ts`，expertId/scoreItemId/supplierId/score/reason?/passed?）。
- UI（`expert-portal/.../evaluate/[id]/page.tsx`）：scores state `Record<string,{score,reason,passed?}>`，key=`${supplierId}:${scoreItemId}`（:113）；滑块+数字+textarea（数值项 :1267-1304）/ 通过·不通过按钮（pass-fail :1232-1265）；payload 构造（:478-484）；草稿 localStorage（:213-264，**类型缺 passed**，bug）；hydrate（:180-185）。**UI 完全没用 points**。
- `getMyScores`（:947-984）：返回 records + disputes，不含 decisions。

## File Structure

| 文件 | 责任 |
|------|------|
| `apps/api/prisma/schema.prisma` | 新增 `BidScorePointDecision` + relations |
| `apps/api/src/bid/score-recalculate.helper.ts`（新） | `recomputeExpertProgress` + `recomputeItemFromDecisions` 纯函数 |
| `apps/api/src/bid/score-recalculate.helper.spec.ts`（新） | 纯函数测试 |
| `apps/api/src/expert/dto/batch-score.dto.ts` | ScoreItemDto 加 `pointDecisions?` |
| `apps/api/src/bid/dto/create-score.dto.ts` | 加 `pointDecisions?` |
| `apps/api/src/expert/expert.service.ts` | submitScores 改造 + getMyScores 返回 decisions |
| `apps/api/src/bid/bid.service.ts` | 代评 submitScore 同步 |
| `apps/api/src/expert/expert.service.spec.ts` | submitScores point-decision 测试 |
| `apps/api/src/bid/bid.service.spec.ts` | 代评 point-decision 测试 |
| `apps/expert-portal/src/lib/api.ts`（或 types） | myScores 类型加 pointDecisions |
| `apps/expert-portal/src/components/evaluate/point-checklist-scoring.tsx`（新） | 共享 checklist 打分组件 |
| `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` | 用组件替换滑块 + 草稿加 passed/decisions + payload |

---

### Task 1: `BidScorePointDecision` 模型 + migration

**Files:** Modify `apps/api/prisma/schema.prisma`

**Interfaces:** Produces `BidScorePointDecision` 模型（`@@unique[expertId,pointId,supplierId]`）供 Task 3/4/5 使用。

- [ ] **Step 1: 在 `schema.prisma` 加 relations**

`BidScorePoint`（:389-401）加 `decisions BidScorePointDecision[]`（`createdAt` 前）。
`BidExpert`（:345-370）加 `pointDecisions BidScorePointDecision[]`（`reviews` 后）。
`BidSupplier`（:283-305）加 `pointDecisions BidScorePointDecision[]`（`bidScoreRecords` 后）。

- [ ] **Step 2: 新增模型（`BidScoreRecord` 后）**

```prisma
model BidScorePointDecision {
  id           String   @id @default(cuid())
  expertId     String
  pointId      String
  supplierId   String
  checked      Boolean
  awardedScore Decimal  @db.Decimal(5, 1)
  note         String?
  expert       BidExpert     @relation(fields: [expertId], references: [id], onDelete: Cascade)
  point        BidScorePoint @relation(fields: [pointId], references: [id], onDelete: Cascade)
  supplier     BidSupplier   @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@unique([expertId, pointId, supplierId])
  @@index([supplierId])
  @@index([expertId, supplierId])
}
```

- [ ] **Step 3: migration**

```bash
cd apps/api && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 npx prisma migrate dev --name add_score_point_decision
```

- [ ] **Step 4: 验证** `npx prisma migrate status`（up to date）+ `pnpm db:generate`。

- [ ] **Step 5: Commit** `feat(db): 新增 BidScorePointDecision 得分点裁定模型` + trailer。

---

### Task 2: 抽 `recomputeExpertProgress` + `recomputeItemFromDecisions` 纯函数（先做，TDD）

**Files:**
- Create: `apps/api/src/bid/score-recalculate.helper.ts`
- Create: `apps/api/src/bid/score-recalculate.helper.spec.ts`

**Interfaces:**
- Produces:
  - `recomputeExpertProgress(tx, expertId, projectId): Promise<{progress, totalScore}>`（`tx` 是 prisma 或事务 client，只要有 `bidScoreItem`/`bidSupplier`/`bidScoreRecord`）
  - `recomputeItemFromDecisions(args): {score, passed}`（纯函数）

- [ ] **Step 1: 写失败测试 `score-recalculate.helper.spec.ts`**

```ts
import { recomputeExpertProgress, recomputeItemFromDecisions } from './score-recalculate.helper';

describe('recomputeItemFromDecisions', () => {
  it('score = Σ awardedScore；非通过性 passed=null', () => {
    const r = recomputeItemFromDecisions({
      category: 'TECHNICAL',
      points: [
        { id: 'p1', objective: true, fullScore: 10 },
        { id: 'p2', objective: false, fullScore: 8 },
      ],
      decisions: new Map([
        ['p1', { checked: true, awardedScore: 10 }],
        ['p2', { checked: true, awardedScore: 5 }],
      ]),
    });
    expect(r.score).toBe(15);
    expect(r.passed).toBeNull();
  });

  it('通过性 item：客观 point 全勾=passed=true，任一不勾=false', () => {
    const points = [
      { id: 'p1', objective: true, fullScore: 0 },
      { id: 'p2', objective: true, fullScore: 0 },
    ];
    expect(recomputeItemFromDecisions({ category: 'QUALIFICATION', points, decisions: new Map([['p1', { checked: true, awardedScore: 0 }], ['p2', { checked: true, awardedScore: 0 }]]) }).passed).toBe(true);
    expect(recomputeItemFromDecisions({ category: 'QUALIFICATION', points, decisions: new Map([['p1', { checked: true, awardedScore: 0 }], ['p2', { checked: false, awardedScore: 0 }]]) }).passed).toBe(false);
  });

  it('主观 point 不影响 passed（只客观算）', () => {
    const r = recomputeItemFromDecisions({
      category: 'QUALIFICATION',
      points: [{ id: 'p1', objective: true, fullScore: 0 }, { id: 'p2', objective: false, fullScore: 5 }],
      decisions: new Map([['p1', { checked: true, awardedScore: 0 }], ['p2', { checked: false, awardedScore: 0 }]]),
    });
    expect(r.passed).toBe(true); // 客观全勾
    expect(r.score).toBe(0);
  });

  it('缺 decision 的 point 视为 awardedScore 0 / checked false', () => {
    const r = recomputeItemFromDecisions({
      category: 'TECHNICAL',
      points: [{ id: 'p1', objective: true, fullScore: 10 }],
      decisions: new Map(), // p1 无 decision
    });
    expect(r.score).toBe(0);
  });
});

describe('recomputeExpertProgress', () => {
  it('progress = scoredItems/totalItems；totalScore = Σ record.score', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }, { id: 'si2' }]) },
      bidSupplier: { count: jest.fn().mockResolvedValue(3) }, // 2 items × 3 suppliers = 6 total
      bidScoreRecord: {
        count: jest.fn().mockResolvedValue(3), // 3 scored → 50%
        findMany: jest.fn().mockResolvedValue([{ score: 10 }, { score: 20 }]),
      },
    };
    const r = await recomputeExpertProgress(tx, 'exp1', 'p1');
    expect(r.progress).toBe(50);
    expect(r.totalScore).toBe(30);
  });

  it('totalItems=0 → progress=0', async () => {
    const tx: any = {
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { count: jest.fn().mockResolvedValue(0) },
      bidScoreRecord: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    expect((await recomputeExpertProgress(tx, 'exp1', 'p1')).progress).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败** `pnpm --filter api test -- score-recalculate` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `score-recalculate.helper.ts`**

```ts
export async function recomputeExpertProgress(
  tx: {
    bidScoreItem: { findMany: (args: any) => Promise<any[]> };
    bidSupplier: { count: (args: any) => Promise<number> };
    bidScoreRecord: { count: (args: any) => Promise<number>; findMany: (args: any) => Promise<any[]> };
  },
  expertId: string,
  projectId: string,
): Promise<{ progress: number; totalScore: number }> {
  const allScoreItems = await tx.bidScoreItem.findMany({ where: { projectId } });
  const activeSupplierCount = await tx.bidSupplier.count({
    where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
  });
  const totalItems = allScoreItems.length * activeSupplierCount;
  const scoredItems = await tx.bidScoreRecord.count({
    where: { expertId, scoreItem: { projectId } },
  });
  const progress = totalItems > 0 ? Math.round((scoredItems / totalItems) * 100) : 0;
  const allRecords = await tx.bidScoreRecord.findMany({
    where: { expertId, scoreItem: { projectId } },
  });
  const totalScore = allRecords.reduce((sum, r) => sum + Number(r.score), 0);
  return { progress, totalScore };
}

export function recomputeItemFromDecisions(args: {
  category: string;
  points: { id: string; objective: boolean; fullScore: number }[];
  decisions: Map<string, { checked: boolean; awardedScore: number }>;
}): { score: number; passed: boolean | null } {
  const score = args.points.reduce((sum, p) => {
    const d = args.decisions.get(p.id);
    return sum + (d ? Number(d.awardedScore) : 0);
  }, 0);
  const isPassFail = args.category === 'QUALIFICATION' || args.category === 'RESPONSIVE';
  const passed = isPassFail
    ? args.points.filter((p) => p.objective).every((p) => args.decisions.get(p.id)?.checked === true)
    : null;
  return { score, passed };
}
```

- [ ] **Step 4: 运行确认通过** `pnpm --filter api test -- score-recalculate` → 全 PASS。
- [ ] **Step 5: Commit** `feat(api): 抽 recomputeExpertProgress/recomputeItemFromDecisions 纯函数` + trailer。

---

### Task 3: DTO 加 `pointDecisions?`

**Files:** Modify `apps/api/src/expert/dto/batch-score.dto.ts` + `apps/api/src/bid/dto/create-score.dto.ts`

**Interfaces:** Produces `PointDecisionDto{pointId, checked, awardedScore, note?}`；`ScoreItemDto.pointDecisions?` / `CreateScoreDto.pointDecisions?`。

- [ ] **Step 1: `batch-score.dto.ts` 加 PointDecisionDto + ScoreItemDto.pointDecisions**

在文件顶部 import 加 `IsArray, ValidateNested`（已有），新增 `PointDecisionDto` class（ScoreItemDto 前）：

```ts
class PointDecisionDto {
  @IsString() @IsNotEmpty()
  pointId: string;

  @IsBoolean()
  checked: boolean;

  @IsNumber() @Min(0) @Max(9999.9)
  awardedScore: number;

  @IsString() @IsOptional()
  note?: string;
}
```

`ScoreItemDto` 末尾加：
```ts
  @IsArray() @ValidateNested({ each: true }) @Type(() => PointDecisionDto) @IsOptional()
  pointDecisions?: PointDecisionDto[];
```

- [ ] **Step 2: `create-score.dto.ts` 同样加 `pointDecisions?`**（import `IsArray, ValidateNested, Type, IsNotEmpty`，加同样的 `PointDecisionDto` + `pointDecisions?` 字段）。

- [ ] **Step 3: 验证** `pnpm --filter api exec tsc --noEmit` → 无报错。
- [ ] **Step 4: Commit** `feat(api): DTO 加 pointDecisions（向后兼容可选）` + trailer。

---

### Task 4: `submitScores` 改造（point decisions + 汇总 + passed，TDD）

**Files:** Modify `apps/api/src/expert/expert.service.ts:734-945`；Test `expert.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `BidScorePointDecision`、Task 2 `recomputeExpertProgress`/`recomputeItemFromDecisions`、Task 3 DTO
- Produces: 改造后的 `submitScores`（有 points 走 decisions 汇总；无 points 走旧路径）

- [ ] **Step 1: 在 `expert.service.spec.ts` 加 `bidScorePoint` / `bidScorePointDecision` mock**

外层 beforeEach 的 prisma mock 对象（:25-52）加：
```ts
      bidScorePoint: { findMany: jest.fn().mockResolvedValue([]) },
      bidScorePointDecision: { upsert: jest.fn().mockResolvedValue({}) },
```

- [ ] **Step 2: 写失败测试（加到 submitScores describe 块末尾）**

```ts
    it('submitScores：有 points 大类走 decision 汇总，BidScoreRecord.score=Σ', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, conflictedSupplierIds: [], expertName: '刘',
      });
      // item 有 points
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 30, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([
        { id: 'pt1', scoreItemId: 'si1', objective: true, fullScore: 15 },
        { id: 'pt2', scoreItemId: 'si1', objective: false, fullScore: 15 },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScorePointDecision.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 20 }]);

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{
          scoreItemId: 'si1', supplierId: 'sup1', reason: '',
          pointDecisions: [
            { pointId: 'pt1', checked: true, awardedScore: 15 },
            { pointId: 'pt2', checked: true, awardedScore: 5 },
          ],
        }],
      } as any);

      // decisions 落库
      expect(prisma.bidScorePointDecision.upsert).toHaveBeenCalledTimes(2);
      // BidScoreRecord.score = 15 + 5 = 20
      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ score: 20 }),
      }));
    });

    it('submitScores：客观 point awardedScore 超 fullScore 抛错', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, conflictedSupplierIds: [], expertName: '刘',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 30, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([{ id: 'pt1', scoreItemId: 'si1', objective: true, fullScore: 10 }]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);

      await expect(service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', reason: '', pointDecisions: [{ pointId: 'pt1', checked: true, awardedScore: 99 }] }],
      } as any)).rejects.toMatchObject({ response: { code: 'POINT_SCORE_EXCEEDS_MAX' } });
    });

    it('submitScores：无 points 大类走旧直输 score（向后兼容）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, conflictedSupplierIds: [], expertName: '刘',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 100, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([]); // 无 points
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 80 }]);

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', score: 80, reason: '' }],
      } as any);

      expect(prisma.bidScorePointDecision.upsert).not.toHaveBeenCalled();
      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ score: 80 }),
      }));
    });
```

- [ ] **Step 3: 运行确认失败** `pnpm --filter api test -- expert.service.spec` → 3 个新 case FAIL。

- [ ] **Step 4: 改造 `submitScores`（expert.service.ts:734）**

文件顶部 import 加：
```ts
import { recomputeExpertProgress, recomputeItemFromDecisions } from '../bid/score-recalculate.helper';
```

在入参校验（现有 `for (const item of dto.scores)` 分类处理循环**之前**），批量查 points 并校验 decisions。把现有 `for (const item of dto.scores)` 的分类处理替换为下面这段（插入在 `const itemMeta = ...` 之后、AI 查询之前）：

```ts
    // 批量查所有相关 item 的 points（判断 item 有无 points + decision 校验）
    const allPoints = await this.prisma.bidScorePoint.findMany({
      where: { scoreItemId: { in: scoreItemIds } },
      select: { id: true, scoreItemId: true, objective: true, fullScore: true },
    });
    const pointsByItem = new Map<string, typeof allPoints>();
    for (const p of allPoints) {
      const arr = pointsByItem.get(p.scoreItemId) ?? [];
      arr.push(p); pointsByItem.set(p.scoreItemId, arr);
    }
    const pointMeta = new Map(allPoints.map(p => [p.id, p]));

    for (const item of dto.scores) {
      const meta = itemMeta.get(item.scoreItemId);
      if (!meta) continue;
      const hasPoints = (pointsByItem.get(item.scoreItemId)?.length ?? 0) > 0;
      if (hasPoints) {
        // checklist 模式：必须有 pointDecisions
        const decisions = item.pointDecisions ?? [];
        for (const d of decisions) {
          const pm = pointMeta.get(d.pointId);
          if (!pm) {
            throw new BadRequestException({ error: `得分点 ${d.pointId} 不属于该评分项`, code: 'POINT_NOT_IN_ITEM' });
          }
          if (Number(d.awardedScore) > Number(pm.fullScore)) {
            throw new BadRequestException({ error: `得分点 ${d.pointId} 分数 ${d.awardedScore} 超过满分 ${pm.fullScore}`, code: 'POINT_SCORE_EXCEEDS_MAX' });
          }
        }
        // 由 decisions 算 score/passed
        const decisionMap = new Map(decisions.map(d => [d.pointId, { checked: d.checked, awardedScore: Number(d.awardedScore) }]));
        const { score, passed } = recomputeItemFromDecisions({
          category: meta.category,
          points: (pointsByItem.get(item.scoreItemId) ?? []).map(p => ({ id: p.id, objective: p.objective, fullScore: Number(p.fullScore) })),
          decisions: decisionMap,
        });
        item.score = score;
        item.passed = passed;
      } else {
        // 旧路径（无 points）：保留原直输校验
        if (meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE') {
          if (typeof item.passed !== 'boolean') {
            throw new BadRequestException({ error: `通过性审查项 ${item.scoreItemId} 必须提供 passed`, code: 'PASS_FAIL_VERDICT_REQUIRED' });
          }
          item.score = 0;
        } else {
          if (typeof item.score !== 'number') {
            throw new BadRequestException({ error: `评分项 ${item.scoreItemId} 必须提供 score`, code: 'SCORE_REQUIRED' });
          }
          if (item.score > meta.maxScore) {
            throw new BadRequestException({ error: `评分项 ${item.scoreItemId} 分数 ${item.score} 超过满分 ${meta.maxScore}`, code: 'SCORE_EXCEEDS_MAX' });
          }
          item.passed = null as unknown as undefined;
        }
      }
    }
```

事务内（`for (const item of dto.scores) { await tx.bidScoreRecord.upsert(...) }` 处），在 upsert BidScoreRecord **之前**加 decisions upsert（仅对有 points 的 item）：

```ts
      // checklist decisions upsert（有 points 的 item）
      for (const item of dto.scores) {
        if (!item.pointDecisions || item.pointDecisions.length === 0) continue;
        for (const d of item.pointDecisions) {
          await tx.bidScorePointDecision.upsert({
            where: { expertId_pointId_supplierId: { expertId: expert.id, pointId: d.pointId, supplierId: item.supplierId } },
            update: { checked: d.checked, awardedScore: d.awardedScore, note: d.note },
            create: { expertId: expert.id, pointId: d.pointId, supplierId: item.supplierId, checked: d.checked, awardedScore: d.awardedScore, note: d.note },
          });
        }
      }
```

事务内的 progress/totalScore 重算（现有 :898-917 那段 `const allScoreItems = ...` 到 `await tx.bidExpert.update`）**替换为**：

```ts
      const { progress, totalScore } = await recomputeExpertProgress(tx, expert.id, projectId);
      await tx.bidExpert.update({ where: { id: expert.id }, data: { progress, totalScore } });
```

`return { records: allRecords, progress, totalScore }` 改为 `return { progress, totalScore }`（allRecords 不再单独查；若外部用 records 再调一次 findMany 或移除该字段——本 phase 的 submitScores 返回值在 controller 直接透传，前端只用 progress，可安全移除 records）。

- [ ] **Step 5: 运行确认通过** `pnpm --filter api test -- expert.service.spec` → 全 PASS（含原 5 个 + 新 3 个）。
- [ ] **Step 6: `tsc --noEmit`** 无报错。
- [ ] **Step 7: Commit** `feat(api): submitScores 改造为 checklist 决策汇总（向后兼容）` + trailer。

---

### Task 5: 代评 `submitScore` 同步（复用纯函数，TDD）

**Files:** Modify `apps/api/src/bid/bid.service.ts:1258-1379`；Test `bid.service.spec.ts`

**Interfaces:** Consumes Task 2 纯函数 + Task 3 DTO。Produces 与专家端一致的 point-decision 汇总。

- [ ] **Step 1: 在 `bid.service.spec.ts` 的 `describe('submitScore')`（:796）块，prisma mock 加 `bidScorePoint` / `bidScorePointDecision`**

该 describe 所在的 `describe('BidService — stage transitions')` beforeEach mock（:73-126）加：
```ts
      bidScorePoint: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      bidScorePointDecision: { upsert: jest.fn().mockResolvedValue({}) },
```

- [ ] **Step 2: 写失败测试**

```ts
    it('代评：有 points 走 decision 汇总，与专家端口径一致', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', expertName: '刘' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1', maxScore: 30, category: 'TECHNICAL', name: '技术' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prisma.bidScorePoint.findMany.mockResolvedValue([{ id: 'pt1', scoreItemId: 'si-1', objective: true, fullScore: 15 }]);
      prisma.bidScorePointDecision.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.upsert.mockResolvedValue({ id: 'sr-1' });
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 15 }]);
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si-1' }]);
      prisma.bidSupplier.count.mockResolvedValue(1);

      await service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 0, reason: '',
        pointDecisions: [{ pointId: 'pt1', checked: true, awardedScore: 15 }],
      } as any);

      expect(prisma.bidScorePointDecision.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ score: 15 }),
      }));
    });
```

- [ ] **Step 3: 运行确认失败** `pnpm --filter api test -- bid.service.spec` → 新 case FAIL。

- [ ] **Step 4: 改造代评 `submitScore`（bid.service.ts:1258）**

顶部 import 加 `import { recomputeExpertProgress, recomputeItemFromDecisions } from './score-recalculate.helper';`

在现有 `if (Number(dto.score) > Number(scoreItem.maxScore))` 校验**之后**、upsert **之前**，插入 point-decision 处理：

```ts
    // checklist 模式：若该 item 有 points，走 decision 汇总
    const points = await this.prisma.bidScorePoint.findMany({
      where: { scoreItemId: dto.scoreItemId },
      select: { id: true, objective: true, fullScore: true, scoreItemId: true },
    });
    let finalScore = Number(dto.score);
    let finalPassed = dto.passed;
    if (points.length > 0 && dto.pointDecisions && dto.pointDecisions.length > 0) {
      for (const d of dto.pointDecisions) {
        const pm = points.find(p => p.id === d.pointId);
        if (!pm) throw new BadRequestException({ error: `得分点 ${d.pointId} 不属于该评分项`, code: 'POINT_NOT_IN_ITEM' });
        if (Number(d.awardedScore) > Number(pm.fullScore)) {
          throw new BadRequestException({ error: `得分点 ${d.pointId} 分数超过满分`, code: 'POINT_SCORE_EXCEEDS_MAX' });
        }
      }
      const decisionMap = new Map(dto.pointDecisions.map(d => [d.pointId, { checked: d.checked, awardedScore: Number(d.awardedScore) }]));
      const recomputed = recomputeItemFromDecisions({
        category: scoreItem.category,
        points: points.map(p => ({ id: p.id, objective: p.objective, fullScore: Number(p.fullScore) })),
        decisions: decisionMap,
      });
      finalScore = recomputed.score;
      finalPassed = recomputed.passed ?? dto.passed;

      for (const d of dto.pointDecisions) {
        await this.prisma.bidScorePointDecision.upsert({
          where: { expertId_pointId_supplierId: { expertId: dto.expertId, pointId: d.pointId, supplierId: dto.supplierId } },
          update: { checked: d.checked, awardedScore: d.awardedScore, note: d.note },
          create: { expertId: dto.expertId, pointId: d.pointId, supplierId: dto.supplierId, checked: d.checked, awardedScore: d.awardedScore, note: d.note },
        });
      }
    }
```

现有 upsert `BidScoreRecord`（:1296-1315）改为用 `finalScore`/`finalPassed`：
```ts
    const record = await this.prisma.bidScoreRecord.upsert({
      where: { expertId_scoreItemId_supplierId: { expertId: dto.expertId, scoreItemId: dto.scoreItemId, supplierId: dto.supplierId } },
      update: { score: finalScore, reason: dto.reason, ...(finalPassed !== undefined ? { passed: finalPassed } : {}) },
      create: { expertId: dto.expertId, scoreItemId: dto.scoreItemId, supplierId: dto.supplierId, score: finalScore, reason: dto.reason, ...(finalPassed !== undefined ? { passed: finalPassed } : {}) },
    });
```

现有 progress/totalScore 重算（:1354-1371 那段 `const allScoreItems = ...` 到 `await this.prisma.bidExpert.update`）**替换为**：
```ts
    const { progress, totalScore } = await recomputeExpertProgress(this.prisma, dto.expertId, projectId);
    await this.prisma.bidExpert.update({ where: { id: expert.id }, data: { progress, totalScore } });
```

- [ ] **Step 5: 运行确认通过** `pnpm --filter api test -- bid.service.spec` → 全 PASS。
- [ ] **Step 6: `tsc --noEmit`** 无报错。
- [ ] **Step 7: Commit** `feat(api): 代评 submitScore 同步 checklist 决策汇总` + trailer。

---

### Task 6: `getMyScores` 返回 `pointDecisions`

**Files:** Modify `apps/api/src/expert/expert.service.ts:947-984`

**Interfaces:** Produces `getMyScores` 返回多一个 `pointDecisions` 数组（hydrate UI）。

- [ ] **Step 1: 改 `getMyScores`**

现有 `const [records, reviews] = await Promise.all([...])` 改为三项：
```ts
    const [records, reviews, pointDecisions] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({ where: { expertId: expert.id }, include: { scoreItem: true } }),
      this.buildExpertReviews(projectId, expert.id, ['dispute', 'doubt']),
      this.prisma.bidScorePointDecision.findMany({
        where: { expertId: expert.id },
        select: { pointId: true, supplierId: true, checked: true, awardedScore: true, note: true },
      }),
    ]);
```
`return { records, disputeCategoriesBySupplier, disputesBySupplier }` 改为 `return { records, disputeCategoriesBySupplier, disputesBySupplier, pointDecisions }`。

- [ ] **Step 2: 验证** `pnpm --filter api exec tsc --noEmit`（`pointDecisions` 类型由 Prisma 推断）。
- [ ] **Step 3: Commit** `feat(api): getMyScores 返回得分点裁定（hydrate UI）` + trailer。

---

### Task 7: 打分 UI 重构（共享 checklist 组件 + page 集成）

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/point-checklist-scoring.tsx`
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（state :113、hydrate :180、payload :478、渲染 :1267-1304）

**Interfaces:**
- Consumes: `item.points[]`（getProject 已 include）、scores state
- Produces: 共享 `PointChecklistScoring` 组件（桌面+tablet 复用）；page 用它替换数值项滑块；无 points 回退旧滑块。

- [ ] **Step 1: 新建 `point-checklist-scoring.tsx`**

```tsx
'use client';
import { Check } from 'lucide-react';

export interface PointDecisionValue { checked: boolean; awardedScore: number; note?: string }
export interface PointDef { id: string; name: string; fullScore: number | string; objective: boolean; evidenceHint?: string | null; seq: number }

interface Props {
  points: PointDef[];
  value: Record<string, PointDecisionValue>; // pointId -> decision
  onChange: (pointId: string, v: PointDecisionValue) => void;
  readOnly?: boolean;
  compact?: boolean; // tablet 用更紧凑布局
}

export function PointChecklistScoring({ points, value, onChange, readOnly, compact }: Props) {
  const sorted = [...points].sort((a, b) => a.seq - b.seq);
  return (
    <div className="space-y-2">
      {sorted.map(p => {
        const v = value[p.id] ?? { checked: false, awardedScore: 0 };
        const max = Number(p.fullScore);
        return (
          <div key={p.id} className={`flex items-center gap-3 rounded-lg border border-blue-100 bg-white ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
            {p.objective ? (
              <button type="button" disabled={readOnly} onClick={() => onChange(p.id, { checked: !v.checked, awardedScore: !v.checked ? max : 0 })}
                className={`flex h-6 w-6 items-center justify-center rounded border ${v.checked ? 'bg-[#11a874] border-[#11a874] text-white' : 'border-[oklch(0.8_0.005_264)] text-transparent'} disabled:opacity-50`}>
                <Check size={14} strokeWidth={2.5} />
              </button>
            ) : (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">主观</span>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[oklch(0.18_0.012_265)] truncate">{p.name}</div>
              {p.evidenceHint && <div className="text-xs text-[oklch(0.55_0.01_264)] truncate">{p.evidenceHint}</div>}
            </div>
            <input type="number" min={0} max={max} step={0.5} value={v.awardedScore} disabled={readOnly}
              onChange={e => onChange(p.id, { ...v, awardedScore: Math.min(Number(e.target.value) || 0, max) })}
              className={`w-16 text-center border border-blue-100 rounded-lg px-1.5 py-1 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2] outline-none disabled:opacity-60`} />
            <span className="text-xs text-[oklch(0.55_0.01_264)]">/ {max}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 改 `page.tsx` state（:113）—— scores 条目加 `points`**

```tsx
const [scores, setScores] = useState<Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>>({});
```

- [ ] **Step 3: 改 hydrate（loadProject 内 :180）+ myScores hydrate —— 加载 pointDecisions**

在 `setScores(existing)` 前，把 myScores 的 `pointDecisions` 注入 existing（需在 my-scores 的 `.then((d) => ...)` 里，或合并到一次加载）。简化：在 my-scores `.then` 里：
```tsx
        .then((d) => {
          setDisputeCategoriesBySupplier(d.disputeCategoriesBySupplier ?? {});
          setDisputesBySupplier(d.disputesBySupplier ?? {});
          // hydrate point decisions
          setScores(prev => {
            const next = { ...prev };
            for (const pd of (d.pointDecisions ?? [])) {
              const k = scoreKey(pd.supplierId, project!.scoreItems.find(si => si.points?.some(pt => pt.id === pd.pointId))?.id ?? '');
              if (!k.endsWith(':')) {
                next[k] = { ...next[k], score: next[k]?.score ?? 0, reason: next[k]?.reason ?? '', points: { ...(next[k]?.points ?? {}), [pd.pointId]: { checked: pd.checked, awardedScore: Number(pd.awardedScore) } } };
              }
            }
            return next;
          });
        })
```
> 注：`pointId → scoreItemId` 映射需查 `project.scoreItems[].points`。上面用 find 查（性能可接受，加载时一次）。`project` 在闭包内需捕获（用 `p` 变量）。

- [ ] **Step 4: 改数值项渲染（:1267-1304）—— 有 points 用组件，无 points 用旧滑块**

在数值项分支（`const currentScore = val?.score ?? 0;` 处），分支：
```tsx
                              const itemPoints = (item.points ?? []).map(p => ({ id: p.id, name: p.name, fullScore: p.fullScore, objective: p.objective, evidenceHint: p.evidenceHint, seq: p.seq }));
                              if (itemPoints.length > 0) {
                                return (
                                  <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                    <div className="flex items-center justify-between mb-3">
                                      <h4 className="font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</h4>
                                      <span className="text-sm text-[oklch(0.55_0.01_264)]">满分 {Number(item.maxScore)}</span>
                                    </div>
                                    <PointChecklistScoring
                                      points={itemPoints}
                                      value={val?.points ?? {}}
                                      onChange={(pid, pv) => setScores(prev => {
                                        const cur = prev[k] ?? { score: 0, reason: '' };
                                        const points = { ...(cur.points ?? {}), [pid]: pv };
                                        const score = itemPoints.reduce((s, p) => s + (points[p.id]?.awardedScore ?? 0), 0);
                                        return { ...prev, [k]: { ...cur, points, score, reason: cur.reason } };
                                      })} />
                                    <textarea placeholder="评分理由（可选）" value={val?.reason || ''} onFocus={() => onReasonFocus(k)} onBlur={onReasonBlur}
                                      onChange={e => { const v = e.target.value; setScores(prev => ({ ...prev, [k]: { ...prev[k], reason: v } })); if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; }); }}
                                      className="w-full rounded-lg px-3 py-2 text-sm resize-none h-12 mt-3 border border-blue-100 focus:ring-2 focus:ring-[#064ea2] focus:outline-none" />
                                    {renderReviewPanel(k, category, item.id)}
                                  </div>
                                );
                              }
                              // 无 points → 旧滑块（保留现有 :1278-1304 完整代码不变）
```
顶部 import 加 `import { PointChecklistScoring } from '@/components/evaluate/point-checklist-scoring';`。

- [ ] **Step 5: 改 payload（:478-484）—— 有 points 附 pointDecisions**

```tsx
    const scoresPayload = project.scoreItems.map(si => {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      const hasPoints = (si.points ?? []).length > 0;
      if (isPassFailCategory(si.category)) {
        return { scoreItemId: si.id, supplierId: activeSupplier, passed: entry?.passed, reason: entry?.reason ?? '' };
      }
      if (hasPoints) {
        return {
          scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '',
          pointDecisions: Object.entries(entry?.points ?? {}).map(([pointId, d]) => ({ pointId, checked: d.checked, awardedScore: d.awardedScore })),
        };
      }
      return { scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '' };
    });
```

- [ ] **Step 6: 类型检查** `pnpm --filter expert-portal exec tsc --noEmit` → 无报错。（手动浏览器验证：专家端打分页 checklist 勾选 + 主观直填，由 controller/human 完成。）
- [ ] **Step 7: Commit** `feat(expert-portal): 打分 UI 改为 checklist 勾选（共享组件，向后兼容滑块）` + trailer。

---

### Task 8: 草稿 localStorage 修复（加 passed + points）

**Files:** Modify `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx:213-264`

- [ ] **Step 1: 修 draft 类型 + 序列化（3 处：检查 :216-225、自动保存 :228-239、恢复 :241-252、手动保存 :258-264）**

把所有 `as { scores: Record<string, { score: number; reason: string }>; ... }` 类型改为：
```ts
as { scores: Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>; savedAt: number }
```

`localStorage.setItem(draftStorageKey, JSON.stringify({ scores, savedAt: Date.now() }))` 的 `scores` 现在已含 `passed`/`points`（state 已扩展），序列化自动带上，无需额外改。

`restoreDraft` 的 `setScores(prev => ({ ...prev, ...draft.scores }))` 保持（draft.scores 现含完整字段）。

- [ ] **Step 2: 类型检查** `pnpm --filter expert-portal exec tsc --noEmit`。
- [ ] **Step 3: 手动验证**（controller/human）：pass-fail 选"不通过"+ 勾 point → 刷新 → 草稿恢复含 passed + points。
- [ ] **Step 4: Commit** `fix(expert-portal): 草稿补 passed + pointDecisions（修复恢复丢裁定）` + trailer。

---

## Self-Review 结论

- **Spec 覆盖**：spec §3② BidScorePointDecision → Task 1；§4.2 B2 得分计算（客观勾选+档内微调、主观直填、score=Σ）→ Task 2 纯函数 + Task 4/5；§4.3 双端对等（代评同步）→ Task 5；§10 向后兼容 → Task 4/5/7 的无-points 分支；草稿 passed bug → Task 8。✅
- **Placeholder 扫描**：Task 7 Step 4 的"无 points → 旧滑块（保留现有代码不变）"是明确的"保留"指令（现有代码已读，不是 placeholder）；Task 6/8 代码完整。无 TBD。✅
- **类型一致**：`PointDecisionDto`（Task 3）/ `recomputeItemFromDecisions` 的 decisionMap（Task 2）/ 前端 `PointDecisionValue`（Task 7）/ payload `pointDecisions`（Task 7 Step 5）字段一致（pointId/checked/awardedScore/note?）。`recomputeExpertProgress` 签名（Task 2）在 Task 4（tx）/ Task 5（this.prisma）调用一致。✅
- **范围**：phase ② 独立可交付（checklist 打分端到端 + 代评一致 + 向后兼容）。③④⑤ 各自后续 plan。✅
