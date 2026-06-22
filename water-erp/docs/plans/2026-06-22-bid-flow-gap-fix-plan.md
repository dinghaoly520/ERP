# 招投标流程缺失与阻塞修复（G1–G9）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐 Task 执行。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 修复 2026-06-22 端到端招投标流程审计发现的 G1–G5、G7–G9 共 8 项后端缺失/阻塞，重点打通"评标 → 中标公示"断裂闭环。

**Architecture:** 改动全部集中在 NestJS API（`apps/api/src/`），不动 Prisma schema（零迁移风险）。顺序：先加固阶段前置校验（G4/G9/G5）→ 修正汇总算法（G2）→ 澄清进度口径（G7）→ 参数化建项（G8）→ 强制公告关联（G3）→ 自动生成中标公示（G1）。每项 TDD + 独立可 revert 的提交。

**Tech Stack:** NestJS 11 + Prisma + Jest（co-located `*.spec.ts`）。

## Global Constraints

- **Node 24 + Next.js `--webpack`**：勿把 `--webpack` 合并 main（lightningcss 不支持 Node 24）。
- **测试**：`pnpm --filter api test`；spec 与源码同目录；mock 模式 = `Test.createTestingModule({ providers: [Svc, { provide: PrismaService, useValue: prismaMock }] })`，`prisma` 为对象，各模型方法 `jest.fn()`。
- **eslint 本机不在 PATH** → 以 `pnpm --filter api exec tsc --noEmit` 为准。
- **错误契约**：抛 `BadRequestException/ConflictException({ error: '<中文消息>', code: '<UPPER_CODE>' })`，由全局 `HttpExceptionFilter` 归一化。
- **分支**：本地 `main` 长期领先 `origin/main` → 新建隔离分支 `fix/bid-flow-gaps`，**勿直接 push main**，走 PR。
- **既有失败勿追**：`expert-admin.portrait-retire.spec.ts` 4 个用例（缺 `prisma.user.update` mock），与本次无关。
- **专家抽取⑥保持现状**：不迁移到 bid-portal（用户决定，见 [[bid-flow-remediation]]）。G10 仅记录。
- **WebSocket**：所有阶段变更/日志写库后经 `this.gateway?.notifyXxx(...)` 广播；`gateway` 是 `@Optional()`，测试中可不提供。

## 设计决策（默认方案，执行前可调）

| 项 | 默认方案 | 理由 / 备选 |
|----|---------|------------|
| **G1 中标公示** | `archiveAll` 成功后自动生成 `WIN_NOTICE` **草稿**（`status=DRAFT`），`relatedProjectCode` 关联项目，`metadata` 含中标人+候选人名单+得分；管理员在公告管理端审核后发布。新增 `GET /bid/projects/:id/winner-notice` 查询。 | 自动留痕满足合规；发布前留人工窗口。备选：归档时直接 PUBLISHED（风险高，无异议期）。 |
| **G2 汇总算法** | ①每供应商先按专家聚合"每专家总评分"，**专家组≥5 时去 1 高 1 低**后求平均作为 `averageScore`；`totalScore` 仍存原始全量总分。②`recommended = rank <= winnerCount`，`winnerCount` 默认 3（不足时按实际数）。 | 保留"实际评分专家数"分母（在 `progress=100` 强制全评下对回避供应商是正当的）。备选：统一固定除数（会惩罚被回避方，不采）。 |
| **G3 建项入口** | `openSubmission`（DOWNLOAD→SUBMIT）增加前置：必须存在关联的 `PUBLISHED` + `BID_NOTICE` 公告，否则 409 阻断并提示"请先发布招标公示"。`createProject`/`createBid` **不自动建公告**（避免空公告）。 | 硬约束引导走"公告发布"正确路径，供应商才能经 `relatedProjectCode` 拿到招标文件。 |
| **G7 进度口径** | `getReport` 返回中 `completed` 重命名为 `perSupplierComplete`（单供应商维度），新增 `overallComplete = expert.progress >= 100`。同步改 `expert-portal` 前端引用。 | 语义清晰；`canConfirm` 已是 `progress>=100`，新增字段仅用于报告页展示。 |
| **G8 createBid 时间** | `createBid(id, dto?)` 接受可选 `openTime/deadline`；默认值保留（截标<开标，逻辑正确），加注释。 | `ProcurementProject` 无时间字段可带，参数化即可。 |

## 文件结构

| 文件 | 责任 | 改动类型 |
|------|------|---------|
| `apps/api/src/bid/bid.service.ts` | startEvaluation/archiveAll/generateEvaluationResults/openSubmission 前置与算法 | 修改 |
| `apps/api/src/bid/bid.service.spec.ts` | 新增前置校验、去极值、候选人、公告关联、中标公示用例 | 修改 |
| `apps/api/src/bid/bid.controller.ts` | 新增 `GET /bid/projects/:id/winner-notice` | 修改 |
| `apps/api/src/expert/expert.service.ts` | `getReport` 口径字段 | 修改 |
| `apps/api/src/expert/expert.service.spec.ts` | `perSupplierComplete/overallComplete` 用例 | 修改 |
| `apps/api/src/procurement/procurement.service.ts` | `createBid` 参数化 | 修改 |
| `apps/api/src/procurement/dto/create-bid.dto.ts` | 新建（openTime/deadline 可选） | 新建 |
| `apps/api/src/procurement/procurement.controller.ts` | `createBid` 端点接收 dto | 修改 |
| `apps/api/src/announcement/announcement.service.ts` | 新增 `createWinnerNotice(projectId)` 方法 | 修改 |

---

## Task 1: 加固 `startEvaluation` 前置校验（G4 + G9）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:515-549`（`startEvaluation`）
- Test: `apps/api/src/bid/bid.service.spec.ts`（新增 describe 块）

**Interfaces:**
- Produces: `startEvaluation` 在无 SUCCESS 供应商时抛 `{ code: 'NO_EVALUABLE_SUPPLIERS' }`；无评分项时抛 `{ code: 'NO_SCORE_ITEMS' }`。

- [ ] **Step 1: 在 spec 顶部 prisma mock 补全 `bidSupplier.count` 与 `bidScoreItem.count`**

打开 `apps/api/src/bid/bid.service.spec.ts`，定位 `beforeEach` 内 `prisma = { ... }`（约第 77 行起）。在 `bidScoreItem` 与 `bidSupplier` 对象里各补 `count: jest.fn()`（`bidSupplier` 已可能有，确认存在；`bidScoreItem` 当前是 `{ findFirst, create, delete }`，追加 `count`）。

修改后这两行形如：
```ts
bidScoreItem: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn() },
// ...
bidSupplier: { findMany: jest.fn(), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
```

- [ ] **Step 2: 写失败测试**

在 `bid.service.spec.ts` 末尾（或 `describe('BidService')` 内合适位置）新增：
```ts
describe('BidService.startEvaluation — 前置校验 (G4/G9)', () => {
  beforeEach(() => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
    prisma.bidExpert.count.mockResolvedValue(3);
  });

  it('G4: 无解密成功的有效供应商时拒绝', async () => {
    prisma.bidSupplier.count.mockResolvedValue(0);
    prisma.bidScoreItem.count.mockResolvedValue(5);
    await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'NO_EVALUABLE_SUPPLIERS' },
    });
  });

  it('G9: 未编制评分标准时拒绝', async () => {
    prisma.bidSupplier.count.mockResolvedValue(2);
    prisma.bidScoreItem.count.mockResolvedValue(0);
    await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'NO_SCORE_ITEMS' },
    });
  });

  it('专家/供应商/评分项齐备时不抛前置异常', async () => {
    prisma.bidSupplier.count.mockResolvedValue(2);
    prisma.bidScoreItem.count.mockResolvedValue(5);
    prisma.bidProject.update.mockResolvedValue({ stage: 'EVALUATING' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.auditLog = prisma.auditLog || { create: jest.fn() };
    prisma.auditLog.create.mockResolvedValue({});
    await expect(service.startEvaluation('p1', 'u1')).resolves.toBeDefined();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter api test -- bid.service.spec
```
Expected: 两个 `rejects.toMatchObject` 用例 FAIL（当前实现未抛这些 code）。

- [ ] **Step 4: 实现——在 `startEvaluation` 的专家数校验后插入两段**

定位 `apps/api/src/bid/bid.service.ts` 第 524-527 行（`expertCount === 0` 抛错块）之后，插入：
```ts
    // G4: 至少一个解密成功且未撤回的供应商，否则评标阶段无供应商可评（死局）
    const evaluableSupplierCount = await this.prisma.bidSupplier.count({
      where: { projectId: id, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
    });
    if (evaluableSupplierCount === 0) {
      throw new BadRequestException({
        error: '没有解密成功的有效供应商，无法启动评标',
        code: 'NO_EVALUABLE_SUPPLIERS',
      });
    }

    // G9: 至少一个评分项，否则专家无法打分、progress 恒 0、无法确认报告/生成结果
    const scoreItemCount = await this.prisma.bidScoreItem.count({ where: { projectId: id } });
    if (scoreItemCount === 0) {
      throw new BadRequestException({
        error: '项目尚未编制评分标准，请先在评标办法页添加评分项或应用标准模板',
        code: 'NO_SCORE_ITEMS',
      });
    }
```

- [ ] **Step 5: 跑测试确认通过 + tsc**

```bash
pnpm --filter api test -- bid.service.spec
pnpm --filter api exec tsc --noEmit
```
Expected: 全部 PASS；tsc exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): startEvaluation 前置校验有效供应商与评分项 (G4/G9)"
```

---

## Task 2: `archiveAll` 前置校验开标记录已补录（G5）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1135-1148`（`archiveAll` 事务内校验块）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: `archiveAll` 在"存在 SUCCESS+CONFIRMED 供应商但缺 `BidOpeningRecord`"时抛 `{ code: 'OPENING_RECORDS_MISSING' }`。

- [ ] **Step 1: spec prisma mock 确认 `bidOpeningRecord.findMany` 与 `bidSupplier.findMany` 存在**

`bid.service.spec.ts` 的 prisma mock 中 `bidOpeningRecord` 已有 `{ create, findFirst, update, findUnique }`，追加 `findMany: jest.fn()`；`bidSupplier` 追加 `findMany: jest.fn()`（如已有则跳过）。

- [ ] **Step 2: 写失败测试**

```ts
describe('BidService.archiveAll — 开标记录补录校验 (G5)', () => {
  beforeEach(() => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-1', stage: 'EVALUATING', name: '项目' });
    prisma.bidEvaluationResult.count.mockResolvedValue(1); // 已有结果，绕过既有 EVALUATION_RESULTS_REQUIRED
    prisma.bidSupplier.count.mockResolvedValue(1); // confirmableCount=1
  });

  it('SUCCESS+CONFIRMED 供应商缺开标记录时拒绝', async () => {
    prisma.bidSupplier.findMany.mockResolvedValue([
      { id: 'bs1', supplierName: '甲', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', submitStatus: '已提交' },
    ]);
    prisma.bidOpeningRecord.findMany.mockResolvedValue([]); // 无开标记录
    await expect(service.archiveAll('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'OPENING_RECORDS_MISSING' },
    });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter api test -- bid.service.spec
```
Expected: FAIL（当前未抛 `OPENING_RECORDS_MISSING`）。

- [ ] **Step 4: 实现——在 `archiveAll` 事务内、`confirmableCount` 校验块之后插入**

定位 `bid.service.ts` 第 1143-1148 行（`EVALUATION_RESULTS_REQUIRED` 抛错块）之后，事务函数体内，插入：
```ts
      // G5: 已确认可评供应商必须有对应开标记录（主持人已补录唱标信息），保证归档材料完整
      const confirmableSuppliers = await tx.bidSupplier.findMany({
        where: { projectId: id, decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', submitStatus: { not: '已撤回' } },
        select: { id: true, supplierName: true },
      });
      if (confirmableSuppliers.length > 0) {
        const confirmedSupplierIds = confirmableSuppliers.map(s => s.id);
        const records = await tx.bidOpeningRecord.findMany({
          where: { projectId: id, bidSupplierId: { in: confirmedSupplierIds } },
          select: { bidSupplierId: true },
        });
        const recordedIds = new Set(records.map(r => r.bidSupplierId));
        const missingNames = confirmableSuppliers.filter(s => !recordedIds.has(s.id)).map(s => s.supplierName);
        if (missingNames.length > 0) {
          throw new ConflictException({
            error: `以下供应商缺少开标记录（请补录唱标信息）：${missingNames.join('、')}`,
            code: 'OPENING_RECORDS_MISSING',
          });
        }
      }
```

- [ ] **Step 5: 跑测试 + tsc**

```bash
pnpm --filter api test -- bid.service.spec
pnpm --filter api exec tsc --noEmit
```
Expected: PASS；tsc exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): archiveAll 前置校验开标记录已补录 (G5)"
```

---

## Task 3: 评标汇总去极值 + 候选人名单（G2）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:828-906`（`generateEvaluationResults`）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: `averageScore` = 每专家总评分去极值（专家组≥5 去 1 高 1 低）后的平均；`recommended = rank <= 3`（不足 3 按实际排名数）。

- [ ] **Step 1: 写失败测试**

```ts
describe('BidService.generateEvaluationResults — 去极值与候选人 (G2)', () => {
  const buildProject = (overrides = {}) => ({
    id: 'p1', stage: 'EVALUATING', name: '项目',
    experts: [
      { id: 'e1', reportConfirmed: true },
      { id: 'e2', reportConfirmed: true },
      { id: 'e3', reportConfirmed: true },
      { id: 'e4', reportConfirmed: true },
      { id: 'e5', reportConfirmed: true },
    ],
    suppliers: [
      { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
    ],
    ...overrides,
  });

  beforeEach(() => {
    prisma.bidProject.findUnique.mockResolvedValue(buildProject());
    prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
    prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 1 });
    prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.auditLog = prisma.auditLog || { create: jest.fn() };
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('专家组=5 时去掉一个最高一个最低后求平均', async () => {
    // 5 位专家对 s1 的总评分：10,20,30,40,100 → 去掉 100 与 10 → 20+30+40=90 / 3 = 30
    const scores = [
      { expertId: 'e1', supplierId: 's1', score: 10 },
      { expertId: 'e2', supplierId: 's1', score: 20 },
      { expertId: 'e3', supplierId: 's1', score: 30 },
      { expertId: 'e4', supplierId: 's1', score: 40 },
      { expertId: 'e5', supplierId: 's1', score: 100 },
    ];
    prisma.bidScoreRecord.findMany.mockResolvedValue(scores);

    const result = await service.generateEvaluationResults('p1', 'u1');

    expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ averageScore: 30 }),
        ]),
      }),
    );
    expect(result).toBeDefined();
  });

  it('专家组<5 时不去极值，直接求平均', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(buildProject({
      experts: [
        { id: 'e1', reportConfirmed: true },
        { id: 'e2', reportConfirmed: true },
        { id: 'e3', reportConfirmed: true },
      ],
    }));
    const scores = [
      { expertId: 'e1', supplierId: 's1', score: 10 },
      { expertId: 'e2', supplierId: 's1', score: 20 },
      { expertId: 'e3', supplierId: 's1', score: 30 },
    ];
    prisma.bidScoreRecord.findMany.mockResolvedValue(scores);

    await service.generateEvaluationResults('p1', 'u1');

    // (10+20+30)/3 = 20
    expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ averageScore: 20 }),
        ]),
      }),
    );
  });

  it('前 3 名均标记 recommended（候选人）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(buildProject({
      suppliers: [
        { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        { id: 's4', supplierName: '丁', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
      ],
    }));
    prisma.bidScoreRecord.findMany.mockResolvedValue([
      { expertId: 'e1', supplierId: 's1', score: 90 },
      { expertId: 'e2', supplierId: 's2', score: 80 },
      { expertId: 'e3', supplierId: 's3', score: 70 },
      { expertId: 'e4', supplierId: 's4', score: 60 },
    ]);

    await service.generateEvaluationResults('p1', 'u1');

    const call = prisma.bidEvaluationResult.createMany.mock.calls[0][0];
    const data = call.data as any[];
    const recommendedRanks = data.filter((d: any) => d.recommended).map((d: any) => d.rank).sort();
    expect(recommendedRanks).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter api test -- bid.service.spec
```
Expected: FAIL（当前 `averageScore = 总分/专家数`，不去极值；`recommended = index === 0` 只标第 1 名）。

- [ ] **Step 3: 实现——重写 `generateEvaluationResults` 的打分聚合与 recommended 段**

定位 `bid.service.ts` 第 863-893 行（`const ranked: ...` 起到 `createMany` 结束）。用以下替换原"按 supplier 聚合 + 排序 + createMany"段（保留前后 `allScoreRecords` 查询与事务包裹不变）：

```ts
    // G2: 按供应商聚合 → 每专家对该供应商的总评分 → 专家组≥5 去 1 高 1 低 → 求平均
    const DEFAULT_WINNER_COUNT = 3;
    const panelSize = project.experts.length;

    const ranked: { supplierId: string; supplierName: string; totalScore: number; averageScore: number }[] = [];
    for (const supplier of activeSuppliers) {
      const records = recordsBySupplier.get(supplier.id) ?? [];
      // 每位专家对该供应商的总评分
      const perExpert = new Map<string, number>();
      for (const r of records) {
        perExpert.set(r.expertId, (perExpert.get(r.expertId) ?? 0) + Number(r.score));
      }
      const expertTotals = [...perExpert.values()].sort((a, b) => a - b);
      const totalScore = expertTotals.reduce((s, v) => s + v, 0);

      // 专家组≥5 时去 1 高 1 低（标准评标实务）
      let trimmed = expertTotals;
      if (expertTotals.length >= 5) {
        trimmed = expertTotals.slice(1, -1);
      }
      const averageScore = trimmed.length > 0
        ? Math.round((trimmed.reduce((s, v) => s + v, 0) / trimmed.length) * 100) / 100
        : 0;

      ranked.push({ supplierId: supplier.id, supplierName: supplier.supplierName, totalScore, averageScore });
    }
    ranked.sort((a, b) => b.averageScore - a.averageScore);

    const winnerCount = Math.min(DEFAULT_WINNER_COUNT, ranked.length);

    await this.prisma.$transaction(async (tx) => {
      await tx.bidEvaluationResult.deleteMany({ where: { projectId } });
      if (ranked.length > 0) {
        await tx.bidEvaluationResult.createMany({
          data: ranked.map((r, index) => ({
            projectId,
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            totalScore: r.totalScore,
            averageScore: r.averageScore,
            rank: index + 1,
            recommended: index < winnerCount,
          })),
        });
      }
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: project.name,
          action: '生成评标结果', result: `生成${ranked.length}家供应商排名（候选人 ${winnerCount} 名，专家组 ${panelSize} 人${panelSize >= 5 ? '，去极值' : ''}）`, riskFlag: '无',
        },
      });
    });
```

> 注意：原代码第 891 行 `recommended: index === 0` 被替换为 `index < winnerCount`；原 `result: 生成${ranked.length}家供应商排名` 被扩展。事务外的 `auditLog.create` 与 `return this.listEvaluationResults(projectId)` 保持不变。

- [ ] **Step 4: 跑测试 + tsc**

```bash
pnpm --filter api test -- bid.service.spec
pnpm --filter api exec tsc --noEmit
```
Expected: 3 个新用例 PASS；既有 `generateEvaluationResults` 用例若因 averageScore 计算变化失败，按新算法更新断言（去极值后值）。

- [ ] **Step 5: 修正既有用例（如有）**

若 `pnpm --filter api test -- bid.service.spec` 报既有用例 FAIL（旧用例假设 `averageScore = 总分/专家数`），打开失败用例，按"去极值后平均"重算期望值并更新断言。每个改动用例旁加注释 `// G2: 去极值后`。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 评标汇总去极值+候选人名单 (G2)"
```

---

## Task 4: `getReport` 进度口径澄清（G7）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:599-617`（`getReport` 返回结构）
- Test: `apps/api/src/expert/expert.service.spec.ts`
- Sync: `apps/expert-portal`（前端引用，grep `.completed`）

**Interfaces:**
- Produces: `getReport` 返回的 `supplierScores[].completed` 重命名为 `perSupplierComplete`；顶层新增 `overallComplete: boolean`（= `expert.progress >= 100`）。

- [ ] **Step 1: 写失败测试**

在 `expert.service.spec.ts` 新增：
```ts
describe('ExpertService.getReport — 进度口径 (G7)', () => {
  beforeEach(() => {
    prisma.bidExpert.findFirst.mockResolvedValue({
      id: 'exp-1', expertName: '王建国', progress: 100, signedIn: true, avoidanceConfirmed: true,
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: '项目', projectCode: 'BID-1',
      suppliers: [{ id: 's1', supplierName: '甲' }],
      scoreItems: [{ id: 'si1', category: 'TECHNICAL', name: '技术', maxScore: 10 }],
    });
    prisma.bidScoreRecord.findMany.mockResolvedValue([
      { supplierId: 's1', score: 8, scoreItem: { id: 'si1', category: 'TECHNICAL', name: '技术', maxScore: 10 } },
    ]);
  });

  it('返回 perSupplierComplete（单供应商维度）与 overallComplete（整体）', async () => {
    const report = await service.getReport('u1', 'p1');
    expect(report.overallComplete).toBe(true); // progress=100
    expect(report.supplierScores[0].perSupplierComplete).toBe(true); // 该供应商 1 项已评 1 项
    // 旧字段 completed 不应再出现
    expect((report.supplierScores[0] as any).completed).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter api test -- expert.service.spec
```
Expected: FAIL（当前字段仍叫 `completed`，无 `overallComplete`/`perSupplierComplete`）。

- [ ] **Step 3: 实现——改 `getReport` 返回字段**

定位 `expert.service.ts`：
- 第 603 行 `completed: project.scoreItems.length > 0 && records.length === project.scoreItems.length,` → 改为：
```ts
        perSupplierComplete: project.scoreItems.length > 0 && records.length === project.scoreItems.length,
```
- 第 607-617 行的 `return { ... }` 顶层，在 `canConfirm: expert.progress >= 100,` 之后新增一行：
```ts
      overallComplete: expert.progress >= 100,
```

- [ ] **Step 4: 同步前端 expert-portal（grep `.completed`）**

```bash
grep -rn "\.completed" apps/expert-portal/src | grep -i score
```
对命中的报告页组件（预计 `apps/expert-portal/src/app/**/report*` 或评分步骤组件），把读取 `supplier.completed` 改为 `supplier.perSupplierComplete`；若该处用于判断"全部完成"，改用顶层 `report.overallComplete`。

- [ ] **Step 5: 跑测试 + tsc（api 与 expert-portal）**

```bash
pnpm --filter api test -- expert.service.spec
pnpm --filter api exec tsc --noEmit
pnpm --filter @water-erp/expert-portal exec tsc --noEmit
```
Expected: 测试 PASS；两端 tsc exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts apps/expert-portal
git commit -m "fix(expert): getReport 区分单供应商完成与整体进度 (G7)"
```

---

## Task 5: `createBid` 时间参数化（G8）

**Files:**
- Create: `apps/api/src/procurement/dto/create-bid.dto.ts`
- Modify: `apps/api/src/procurement/procurement.service.ts:133-155`（`createBid`）
- Modify: `apps/api/src/procurement/procurement.controller.ts`（`createBid` 端点）
- Test: 新增 `apps/api/src/procurement/procurement.service.spec.ts`（若不存在则建）

**Interfaces:**
- Produces: `ProcurementService.createBid(id, dto?: { openTime?: string; deadline?: string })`；校验 `deadline < openTime`（截标早于开标）。

- [ ] **Step 1: 新建 DTO**

`apps/api/src/procurement/dto/create-bid.dto.ts`：
```ts
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreateBidDto {
  @IsISO8601()
  @IsOptional()
  openTime?: string; // 开标时间

  @IsISO8601()
  @IsOptional()
  deadline?: string; // 投标截止时间（须早于 openTime）
}
```

- [ ] **Step 2: 写失败测试（新建/追加 spec）**

若 `procurement.service.spec.ts` 不存在，新建文件，最小搭建：
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProcurementService } from './procurement.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProcurementService.createBid (G8)', () => {
  let service: ProcurementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      procurementProject: { findUnique: jest.fn(), update: jest.fn() },
      bidProject: { create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProcurementService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProcurementService);
  });

  it('未传时间时用默认值（截标 5 天，开标 7 天）', async () => {
    prisma.procurementProject.findUnique.mockResolvedValue({
      id: 'pp1', title: '采购', procurementMethod: '公开招标', status: 'APPROVED',
    });
    prisma.bidProject.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'bp1', ...data }));
    prisma.procurementProject.update.mockResolvedValue({});

    const { bidProject } = await service.createBid('pp1');

    expect(bidProject.deadline.getTime()).toBeLessThan(bidProject.openTime.getTime());
  });

  it('传入 deadline >= openTime 时拒绝', async () => {
    prisma.procurementProject.findUnique.mockResolvedValue({
      id: 'pp1', title: '采购', procurementMethod: '公开招标', status: 'APPROVED',
    });
    const openTime = new Date(Date.now() + 7 * 86400000).toISOString();
    const deadline = new Date(Date.now() + 9 * 86400000).toISOString(); // 晚于开标
    await expect(service.createBid('pp1', { openTime, deadline })).rejects.toMatchObject({
      response: { code: 'INVALID_BID_TIME' },
    });
  });

  it('传入合法时间时透传', async () => {
    prisma.procurementProject.findUnique.mockResolvedValue({
      id: 'pp1', title: '采购', procurementMethod: '公开招标', status: 'APPROVED',
    });
    prisma.bidProject.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'bp1', ...data }));
    prisma.procurementProject.update.mockResolvedValue({});
    const openTime = new Date(Date.now() + 10 * 86400000).toISOString();
    const deadline = new Date(Date.now() + 8 * 86400000).toISOString();

    const { bidProject } = await service.createBid('pp1', { openTime, deadline });

    expect(bidProject.openTime.toISOString()).toBe(openTime);
    expect(bidProject.deadline.toISOString()).toBe(deadline);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter api test -- procurement.service.spec
```
Expected: FAIL（`createBid` 当前不接受 dto）。

- [ ] **Step 4: 实现——改 `createBid` 签名与逻辑**

定位 `procurement.service.ts:133`，替换整个 `createBid` 方法：
```ts
  async createBid(id: string, dto?: { openTime?: string; deadline?: string }) {
    const project = await this.prisma.procurementProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('采购项目不存在');
    this.assertStatusTransition(project.status as ProcurementStatus, 'BIDDING');

    // G8: 参数化时间；默认 截标 5 天后 / 开标 7 天后（截标必须早于开标）
    const openTime = dto?.openTime ? new Date(dto.openTime) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const deadline = dto?.deadline ? new Date(dto.deadline) : new Date(Date.now() + 5 * 24 * 3600 * 1000);
    if (!(deadline.getTime() < openTime.getTime())) {
      throw new BadRequestException({
        error: '投标截止时间必须早于开标时间',
        code: 'INVALID_BID_TIME',
      });
    }

    const bidProject = await this.prisma.bidProject.create({
      data: {
        name: project.title,
        projectCode: `BID-${Date.now()}`,
        procurementMethod: project.procurementMethod,
        openTime,
        deadline,
      },
    });

    await this.prisma.procurementProject.update({
      where: { id },
      data: { status: 'BIDDING', bidProjectId: bidProject.id },
    });

    return { procurement: await this.get(id), bidProject };
  }
```
> 文件顶部 `import` 行确认含 `BadRequestException`（当前已 import `BadRequestException, NotFoundException, ConflictException`，无需改）。

- [ ] **Step 5: controller 透传 dto**

打开 `apps/api/src/procurement/procurement.controller.ts`，找到 `createBid` 端点（`@Post(':id/create-bid')` 或类似），改为接收 body：
```ts
  @Post(':id/create-bid')
  @ApiOperation({ summary: '采购项目转招标（可指定开标/截标时间）' })
  createBid(@Param('id') id: string, @Body() dto: CreateBidDto) {
    return this.procurementService.createBid(id, dto);
  }
```
顶部追加 `import { CreateBidDto } from './dto/create-bid.dto';`。

- [ ] **Step 6: 跑测试 + tsc**

```bash
pnpm --filter api test -- procurement.service.spec
pnpm --filter api exec tsc --noEmit
```
Expected: PASS；tsc exit 0。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/procurement
git commit -m "fix(procurement): createBid 参数化开标/截标时间 (G8)"
```

---

## Task 6: `openSubmission` 强制关联已发布招标公示（G3）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:411-439`（`openSubmission`）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: `openSubmission` 在项目无关联 `PUBLISHED + BID_NOTICE` 公告时抛 `{ code: 'BID_NOTICE_REQUIRED' }`。

- [ ] **Step 1: spec prisma mock 确认 `announcement.findFirst`**

在 `bid.service.spec.ts` 的 prisma mock 中，`announcement` 当前是 `{ count: jest.fn() }`，追加 `findFirst: jest.fn()`。

- [ ] **Step 2: 写失败测试**

```ts
describe('BidService.openSubmission — 公告前置 (G3)', () => {
  beforeEach(() => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'DOWNLOAD', name: '项目', projectCode: 'BID-1' });
  });

  it('无关联已发布招标公示时拒绝', async () => {
    prisma.announcement.findFirst.mockResolvedValue(null);
    await expect(service.openSubmission('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'BID_NOTICE_REQUIRED' },
    });
  });

  it('存在已发布招标公示时放行', async () => {
    prisma.announcement.findFirst.mockResolvedValue({ id: 'a1' });
    prisma.bidProject.update.mockResolvedValue({ stage: 'SUBMIT' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.auditLog = prisma.auditLog || { create: jest.fn() };
    prisma.auditLog.create.mockResolvedValue({});
    await expect(service.openSubmission('p1', 'u1')).resolves.toBeDefined();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter api test -- bid.service.spec
```
Expected: FAIL（当前 `openSubmission` 不校验公告）。

- [ ] **Step 4: 实现——在 `openSubmission` 的 `assertBidStageTransition` 之后、事务之前插入**

定位 `bid.service.ts:417`（`assertBidStageTransition(project.stage, 'SUBMIT');` 之后），插入：
```ts
    // G3: 开放投递前必须已发布招标公示（供应商经 relatedProjectCode 获取招标文件）
    const notice = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'BID_NOTICE', status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!notice) {
      throw new ConflictException({
        error: '尚未发布招标公示，供应商无法获取招标文件，请先在信息发布中心发布招标公告',
        code: 'BID_NOTICE_REQUIRED',
      });
    }
```
> `project` 的 `select` 当前是 `{ stage, name }`（第 414 行），需追加 `projectCode: true`，改为 `select: { stage: true, name: true, projectCode: true }`。

- [ ] **Step 5: 跑测试 + tsc**

```bash
pnpm --filter api test -- bid.service.spec
pnpm --filter api exec tsc --noEmit
```
Expected: PASS；tsc exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): openSubmission 前置校验已发布招标公示 (G3)"
```

---

## Task 7: 中标公示自动生成（G1）

**Files:**
- Modify: `apps/api/src/announcement/announcement.service.ts`（新增 `createWinnerNotice`）
- Modify: `apps/api/src/bid/bid.service.ts:1116-1197`（`archiveAll` 末尾调用）
- Modify: `apps/api/src/bid/bid.controller.ts`（新增 `GET /bid/projects/:id/winner-notice`）
- Modify: `apps/api/src/bid/bid.module.ts`（若需在 BidService 注入 AnnouncementService）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 `recommended`（候选人）+ `rank`。
- Produces: `archiveAll` 成功后自动创建 `Announcement(type=WIN_NOTICE, status=DRAFT)`；`AnnouncementService.createWinnerNotice(projectId)` 公开方法；`GET /bid/projects/:id/winner-notice` 返回关联的 WIN_NOTICE（草稿或已发布）。

- [ ] **Step 1: 在 `AnnouncementService` 新增 `createWinnerNotice`**

打开 `apps/api/src/announcement/announcement.service.ts`。该服务已注入 `bidService`（见 `syncBidProject` 用法）。在类内新增方法（放在 `syncBidProject` 之后）：
```ts
  /**
   * 项目归档后自动生成中标公示草稿（G1）。
   * 幂等：已存在同 relatedProjectCode 的 WIN_NOTICE 则返回既有，不重复创建。
   * 草稿需管理员在公告管理端审核后发布（设 status=PUBLISHED）。
   */
  async createWinnerNotice(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        evaluationResults: { orderBy: { rank: 'asc' }, select: { rank: true, supplierName: true, totalScore: true, averageScore: true, recommended: true } },
      },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.evaluationResults.length === 0) {
      throw new BadRequestException({ error: '项目尚无评标结果，无法生成中标公示', code: 'NO_RESULTS' });
    }

    // 幂等：同 relatedProjectCode 已有 WIN_NOTICE 则跳过
    const existing = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'WIN_NOTICE' },
      select: { id: true },
    });
    if (existing) return this.prisma.announcement.findUnique({ where: { id: existing.id } });

    const winner = project.evaluationResults.find(r => r.rank === 1);
    const candidates = project.evaluationResults.filter(r => r.recommended);

    return this.prisma.announcement.create({
      data: {
        title: `中标公示：${project.name}`,
        content: `项目编号 ${project.projectCode}（${project.name}）已完成评标并归档。中标人：${winner?.supplierName ?? '—'}。候选人名单详见结构化字段。`,
        type: 'WIN_NOTICE',
        status: 'DRAFT',
        relatedProjectCode: project.projectCode,
        metadata: {
          projectCode: project.projectCode,
          winner: winner ? { supplierName: winner.supplierName, totalScore: Number(winner.totalScore), averageScore: Number(winner.averageScore) } : null,
          candidates: candidates.map(c => ({ rank: c.rank, supplierName: c.supplierName, totalScore: Number(c.totalScore), averageScore: Number(c.averageScore) })),
        },
      },
    });
  }

  /** 查询项目关联的中标公示（草稿或已发布），无则返回 null */
  async getWinnerNotice(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { projectCode: true } });
    if (!project) return null;
    return this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'WIN_NOTICE' },
    });
  }
```

- [ ] **Step 2: 让 `BidService` 能调用 `AnnouncementService`**

检查 `apps/api/src/bid/bid.module.ts`：BidModule 与 AnnouncementModule 是否互相 import。由于 `AnnouncementService` 已注入 `BidService`（反向），为避免循环依赖，**在 `BidService` 中改用 `PrismaService` 直接建公告**，而不注入 `AnnouncementService`。

替代实现——在 `BidService`（`bid.service.ts`）`archiveAll` 的 `return result;`（第 1196 行）之前，事务之外，插入对 `announcement` 的直接写入（幂等）：
```ts
    // G1: 归档成功后自动生成中标公示草稿（幂等；不阻塞归档主流程）
    try {
      await this.ensureWinnerNotice(id);
    } catch (e) {
      this.logger.error(`中标公示自动生成失败（不阻塞归档）: ${(e as Error).message}`);
    }

    return result;
```
并在 `BidService` 类内（`archiveAll` 之后）新增私有方法：
```ts
  /**
   * 归档后自动生成中标公示草稿（G1）。幂等。
   * 直接写 announcement 表（避免与 AnnouncementService 循环依赖）。
   */
  private async ensureWinnerNotice(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        evaluationResults: { orderBy: { rank: 'asc' }, select: { rank: true, supplierName: true, totalScore: true, averageScore: true, recommended: true } },
      },
    });
    if (!project) return;

    const existing = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'WIN_NOTICE' },
      select: { id: true },
    });
    if (existing) return;

    if (project.evaluationResults.length === 0) {
      this.logger.warn(`项目 ${project.projectCode} 无评标结果，跳过中标公示生成`);
      return;
    }

    const winner = project.evaluationResults.find(r => r.rank === 1);
    const candidates = project.evaluationResults.filter(r => r.recommended);

    await this.prisma.announcement.create({
      data: {
        title: `中标公示：${project.name}`,
        content: `项目编号 ${project.projectCode}（${project.name}）已完成评标并归档。中标人：${winner?.supplierName ?? '—'}。`,
        type: 'WIN_NOTICE',
        status: 'DRAFT',
        relatedProjectCode: project.projectCode,
        metadata: {
          projectCode: project.projectCode,
          winner: winner ? { supplierName: winner.supplierName, totalScore: Number(winner.totalScore), averageScore: Number(winner.averageScore) } : null,
          candidates: candidates.map(c => ({ rank: c.rank, supplierName: c.supplierName, totalScore: Number(c.totalScore), averageScore: Number(c.averageScore) })),
        },
      },
    });
    this.logger.log(`已自动生成中标公示草稿：${project.projectCode}`);
  }
```

> 说明：`createWinnerNotice`（Step 1）仍保留在 AnnouncementService 作为"管理员手动重生成"入口（若需要）；自动路径走 `ensureWinnerNotice` 避免循环依赖。若你倾向只保留一处实现，可删 Step 1，仅用 `ensureWinnerNotice`。默认两处都留（自动 + 手动）。

- [ ] **Step 3: 新增 controller 端点**

`apps/api/src/bid/bid.controller.ts`，在 `archiveAll` 端点（第 194-196 行）之后新增：
```ts
  @Get('projects/:id/winner-notice')
  @ApiOperation({ summary: '查询项目关联的中标公示（G1，草稿或已发布）' })
  getWinnerNotice(@Param('id') id: string) { return this.bidService.getWinnerNotice(id); }
```
在 `BidService`（`ensureWinnerNotice` 旁）新增公开方法：
```ts
  /** 查询项目关联的中标公示（G1） */
  getWinnerNotice(projectId: string) {
    return this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true },
    }).then(project => {
      if (!project) return null;
      return this.prisma.announcement.findFirst({
        where: { relatedProjectCode: project.projectCode, type: 'WIN_NOTICE' },
      });
    });
  }
```

- [ ] **Step 4: 写失败测试**

`bid.service.spec.ts` 的 prisma mock 确认 `announcement` 含 `{ findFirst, create, count }`。新增：
```ts
describe('BidService.archiveAll — 中标公示自动生成 (G1)', () => {
  beforeEach(() => {
    prisma.bidProject.findUnique.mockImplementation(({ where }: any) => {
      // archiveAll 入口查询
      if (where?.id === 'p1') return Promise.resolve({ id: 'p1', projectCode: 'BID-1', stage: 'EVALUATING', name: '项目' });
      return Promise.resolve(null);
    });
    prisma.bidEvaluationResult.count.mockResolvedValue(1);
    prisma.bidSupplier.count.mockResolvedValue(0); // 无 confirmable，绕过 EVALUATION_RESULTS_REQUIRED
    prisma.bidSupplier.findMany.mockResolvedValue([]);
    prisma.bidArchiveItem.findMany.mockResolvedValue([{ id: 'ai1', name: 'x' }]);
    prisma.bidArchiveItem.update.mockResolvedValue({});
    prisma.bidProject.update.mockResolvedValue({ stage: 'ARCHIVED' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.auditLog = prisma.auditLog || { create: jest.fn() };
    prisma.auditLog.create.mockResolvedValue({});
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-1', name: '项目', evaluationResults: [
      { rank: 1, supplierName: '甲', totalScore: 90, averageScore: 30, recommended: true },
    ] });
    prisma.announcement.findFirst.mockResolvedValue(null); // 不存在
    prisma.announcement.create.mockResolvedValue({ id: 'wn1' });
  });

  it('归档后自动创建 WIN_NOTICE 草稿', async () => {
    await service.archiveAll('p1', 'u1');
    expect(prisma.announcement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'WIN_NOTICE',
          status: 'DRAFT',
          relatedProjectCode: 'BID-1',
        }),
      }),
    );
  });

  it('已存在 WIN_NOTICE 时不重复创建（幂等）', async () => {
    prisma.announcement.findFirst.mockResolvedValue({ id: 'wn1' });
    await service.archiveAll('p1', 'u1');
    expect(prisma.announcement.create).not.toHaveBeenCalled();
  });

  it('中标公示创建失败时不阻塞归档', async () => {
    prisma.announcement.create.mockRejectedValue(new Error('DB down'));
    await expect(service.archiveAll('p1', 'u1')).resolves.toBeDefined(); // 归档本身成功
  });
});
```

- [ ] **Step 5: 跑测试 + tsc**

```bash
pnpm --filter api test -- bid.service.spec
pnpm --filter api exec tsc --noEmit
```
Expected: PASS；tsc exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/announcement apps/api/src/bid
git commit -m "feat(bid): 归档后自动生成中标公示草稿 (G1)"
```

---

## 不修复项（记录在案）

- **G6 手机验证依赖 SMS 网关**：`verification.service.ts:156` 的 `SMS_DEBUG_BYPASS=true` 是演示模式。属部署依赖，真实上线前需对接短信网关或加管理员手动核验兜底。非代码缺陷，不在本计划。
- **G10 专家抽取跨门户**：抽取在 web 门户 `/expert/extract`，按 [[bid-flow-remediation]] 用户决定保持现状，不迁移 bid-portal。

## 验收

- [ ] `pnpm --filter api test`：除既有 `expert-admin.portrait-retire.spec.ts` 4 个（与本计划无关）外全绿。
- [ ] `pnpm --filter api exec tsc --noEmit`：exit 0。
- [ ] `pnpm --filter @water-erp/expert-portal exec tsc --noEmit`：exit 0（Task 4 前端同步）。
- [ ] 7 个提交可独立 revert；不直接 push `main`，走 `fix/bid-flow-gaps` → PR。
- [ ] 端到端走查（`lizhuren` 账号）：公告发布 → 投标 → 解密+补录唱标 → 启动评标（无评分项/无 SUCCESS 供应商时被拦）→ 专家签到评分确认 → 生成结果（去极值、候选人前 3）→ 一键归档（缺开标记录时被拦；归档后中标公示草稿出现）→ 公告管理端发布中标公示。

## Self-Review

**1. Spec 覆盖**：G1→Task 7；G2→Task 3；G3→Task 6；G4+G9→Task 1；G5→Task 2；G7→Task 4；G8→Task 5；G6/G10→不修复项。8 项全覆盖。

**2. Placeholder 扫描**：无 TBD/TODO；每个 Step 含可执行代码或确切命令；测试断言含具体期望值（去极值 30、平均 20、候选人 [1,2,3] 等）。

**3. 类型一致性**：
- `startEvaluation` 抛 `NO_EVALUABLE_SUPPLIERS`/`NO_SCORE_ITEMS`（Task 1 测试与实现一致）。
- `archiveAll` 抛 `OPENING_RECORDS_MISSING`（Task 2）；Task 7 测试中 `bidSupplier.count.mockResolvedValue(0)` 绕过该前置，确认两 Task 不冲突。
- `generateEvaluationResults` 的 `recommended: index < winnerCount`（Task 3）被 Task 7 的 `evaluationResults` 读取（`r.recommended`）——一致。
- `getReport` 字段 `perSupplierComplete`/`overallComplete`（Task 4 测试与实现一致）。
- `createBid(id, dto?)` 签名（Task 5 spec/service/controller 一致）。
- `openSubmission` 抛 `BID_NOTICE_REQUIRED`（Task 6 测试与实现一致）。
- `ensureWinnerNotice`/`getWinnerNotice`（Task 7 service/controller 一致）。
