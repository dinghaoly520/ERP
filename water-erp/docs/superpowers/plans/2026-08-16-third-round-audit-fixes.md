# 第三轮审查（边界专项）修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-08-16 晚第三轮复核报告（`water-erp/docs/投标至归档路线第三轮复核-边界专项-2026-08-16晚.md`）中的 N1–N15 代码级问题，使解密并发互斥真正生效、fileAsset 写入全部幂等、流标/家数口径前后端统一、存量项目与种子数据自洽。

**Architecture:** 全部为现有模块内的小步修改——`apps/api/src/bid/`（解密/结果/归档/校验器）、`apps/api/src/expert/`（递补/文案）、`bid-portal` 两个组件、seed-data JSON。无新模块、无跨包依赖变更（`minBidders` 走 getProject 响应字段而非 shared 包）。N16（公告直建项目开标宿主）需产品拍板，不在本计划实施。

**Tech Stack:** NestJS 11 + Prisma（PG16）、Next.js 16（bid-portal）、Jest（`apps/api` 单测）、seed JSON + `seed.ts`。

**Spec:** `water-erp/docs/投标至归档路线第三轮复核-边界专项-2026-08-16晚.md`（问题编号 N1–N16 均出自该报告）

## Global Constraints

- 工作目录一律 `water-erp/`；测试命令 `pnpm --filter api test -- <pattern>`；带 `--forceExit` 的只有 test:e2e，不跑 e2e。
- Prisma 迁移走非交互约定（memory `main-db-migration-drift`）：`migrate dev --create-only` → 手工 SQL `db execute` → `migrate resolve --applied`；**禁止** `migrate deploy` 验证、禁止 diff 重生成 `OperationLog` DDL。
- `FileAsset.key` 是 `@unique`——本项目所有「同 key 覆盖」语义一律 `upsert`，禁止裸 `create`。
- UI 文案中文；不得引入 mock 数据回退（CLAUDE.md）。
- 提交信息风格：`fix(bid):` / `fix(expert):` / `fix(web):` / `chore(seed):` 中文一行主题；**不主动 git push**。
- 已验证事实（执行者可直接信赖，勿重复排查）：`BidSupplier.updatedAt` 存在（`@updatedAt`）；生产库与 seed 的 `BidOpeningRecord` 均无 `(projectId,bidSupplierId)` 重复对；`reuploadBidFile` 已把 `decryptStatus` 重置为 `PENDING`（`bid.service.ts:2192-2194`）；`recomputeExpertProgress` 分母已排 PRICE 但分子未排；`getProject` 未返回 `evaluationResults`；`abort` 控制器已透传 `body.reason`（`bid.controller.ts:215`）。

---

### Task 1: N1a 解密抢占谓词——PENDING 专属 + RUNNING 超时接管

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1848-1864`
- Test: `apps/api/src/bid/bid.service.spec.ts:456-470`（改写 + 新增两条）

**Interfaces:**
- Consumes: `BidSupplier.updatedAt`（`@updatedAt`，Prisma updateMany 自动刷新）。
- Produces: 错误码不变（`DECRYPT_ALREADY_IN_FLIGHT`）；新增行为——RUNNING 停滞 >60s 可被接管。Task 2 复用同一方法的 phase③。

- [ ] **Step 1: 改写失败单测**

将 `bid.service.spec.ts:456` 起的用例替换为以下三条（保留原「未发生终局写入」断言风格）：

```ts
it('N1：并发抢占——PENDING claim count=0 且 RUNNING 未超时 → 409，不接管不终局写入', async () => {
  prisma.bidSupplier.updateMany = jest.fn()
    .mockResolvedValueOnce({ count: 0 })  // PENDING 抢占失败（首笔已抢）
    .mockResolvedValueOnce({ count: 0 }); // 接管条件更新也失败（updatedAt 新鲜）
  prisma.bidSupplier.findUnique.mockResolvedValue({
    id: 'bs-1', decryptStatus: 'RUNNING', updatedAt: new Date(), // 1 秒前，未超时
  });

  await expect(service.decryptSupplier('p1', 'bs-1')).rejects.toMatchObject({
    response: { code: 'DECRYPT_ALREADY_IN_FLIGHT' },
  });
  expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'SUCCESS' }) }),
  );
  expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
});

it('N1：RUNNING 停滞超过 60s（崩溃遗留）→ 接管成功进入解密', async () => {
  prisma.bidSupplier.updateMany = jest.fn()
    .mockResolvedValueOnce({ count: 0 })  // PENDING 抢占失败
    .mockResolvedValueOnce({ count: 1 }); // 接管成功
  prisma.bidSupplier.findUnique
    .mockResolvedValueOnce({ id: 'bs-1', decryptStatus: 'PENDING' })          // 方法首查（:1819）
    .mockResolvedValue({ id: 'bs-1', decryptStatus: 'RUNNING',
      updatedAt: new Date(Date.now() - 120_000), supplierId: 'sup-1' });      // claim 失败后的复查
  prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
  prisma.bidOpeningSession.findUnique.mockResolvedValue({ pausedAt: null, decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() + 3600_000) });
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

  const res = await service.decryptSupplier('p1', 'bs-1');
  expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'SUCCESS' }) }),
  );
  expect(res).toBeTruthy();
});

it('N1：DARRIER 态（已定性）→ 409 文案区分', async () => {
  prisma.bidSupplier.updateMany = jest.fn().mockResolvedValue({ count: 0 });
  prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'DANGER', updatedAt: new Date() });
  await expect(service.decryptSupplier('p1', 'bs-1')).rejects.toMatchObject({
    response: { code: 'DECRYPT_ALREADY_IN_FLIGHT' },
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter api test -- bid.service.spec.ts -t "N1"`
Expected: 新增用例 FAIL（现行实现 claim 含 RUNNING，第二笔直接通过，不会走接管分支）。

- [ ] **Step 3: 实现**

`bid.service.ts:1848-1864` 整段替换为：

```ts
    // Phase 1: 原子抢占（PENDING→RUNNING；并发第二笔 count=0）。
    // N1 修复：旧 where 含 RUNNING → RUNNING→RUNNING 的 no-op 更新同样 count=1，互斥失效、双击双跑。
    const claim = await this.prisma.bidSupplier.updateMany({
      where: { id: supplierId, decryptStatus: 'PENDING' },
      data: { decryptStatus: 'RUNNING' },
    });
    if (claim.count === 0) {
      const fresh = await this.prisma.bidSupplier.findUnique({
        where: { id: supplierId },
        select: { decryptStatus: true, updatedAt: true },
      });
      if (fresh?.decryptStatus === 'SUCCESS') {
        throw new BadRequestException({ error: '标书已解密成功，无需重复解密', code: 'ALREADY_DECRYPTED' });
      }
      if (fresh?.decryptStatus === 'RUNNING') {
        // 崩溃接管：RUNNING 停滞超 60s（进程崩溃/外部 IO 卡死遗留）方可重占。
        // 条件更新带 updatedAt 上限：接管成功的 @updatedAt 刷新使并发第二笔接管 count=0。
        const takeover = await this.prisma.bidSupplier.updateMany({
          where: { id: supplierId, decryptStatus: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 60_000) } },
          data: { decryptStatus: 'RUNNING' },
        });
        if (takeover.count === 0) {
          throw new ConflictException({ error: '该供应商标书正在解密中，请勿重复提交', code: 'DECRYPT_ALREADY_IN_FLIGHT' });
        }
      } else {
        throw new ConflictException({
          error: fresh?.decryptStatus === 'DANGER'
            ? '该供应商标书已定性为解密异常，无需重复操作'
            : '该供应商标书正在解密中，请勿重复提交',
          code: 'DECRYPT_ALREADY_IN_FLIGHT',
        });
      }
    }
```

- [ ] **Step 4: 跑测通过**

Run: `pnpm --filter api test -- bid.service.spec.ts`
Expected: 全绿（含既有解密用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 解密并发抢占互斥生效——PENDING 专属抢占+RUNNING 60s 超时接管（N1a）"
```

---

### Task 2: N1b BidOpeningRecord 唯一约束 + 写路径 upsert

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`model BidOpeningRecord` 尾部）
- Create: 迁移 `apps/api/prisma/migrations/<ts>_bid_opening_record_unique/`（手工）
- Modify: `apps/api/src/bid/bid.service.ts`（decryptSupplier phase③ `:1960-1974`、enterOpeningRecord 的 create 分支）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: 复合唯一 `projectId_bidSupplierId`（Prisma upsert where 用此名）。后续所有 BidOpeningRecord 写入必须 upsert。

- [ ] **Step 1: 失败单测（upsert 语义）**

在解密即唱标既有用例旁新增：

```ts
it('N1：开标记录写入走 upsert（projectId_bidSupplierId 复合唯一），不再 findFirst-then-create', async () => {
  prisma.bidSupplier.findUnique.mockResolvedValue({
    id: 'bs-1', decryptStatus: 'PENDING', supplierId: 'sup-1',
  });
  // …沿用既有「解密即唱标」用例的全部 mock 前置（窗口/阶段/事务），此处省略复制自 :430-455 的 setup
  expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { projectId_bidSupplierId: { projectId: 'p1', bidSupplierId: 'bs-1' } },
    }),
  );
  expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
});
```

（实现时把 `:430-455` 既有用例的 mock setup 复制进本用例——两用例除断言外前置相同。）

- [ ] **Step 2: 跑测失败**

Run: `pnpm --filter api test -- bid.service.spec.ts -t "开标记录写入走 upsert"`
Expected: FAIL（现实现是 findFirst→create/update）。

- [ ] **Step 3: schema + 迁移**

`schema.prisma` 的 `model BidOpeningRecord` 末尾（`@@index` 行旁）加：

```prisma
  @@unique([projectId, bidSupplierId])
```

（`bidSupplierId String?` 可空——PG 唯一索引多 NULL 不冲突，存量数据无重复对已验证。）

按仓库非交互迁移约定执行：

```bash
cd water-erp/apps/api
pnpm exec prisma migrate dev --create-only --name bid_opening_record_unique
# 编辑生成的 migration.sql，确保只有一行：
#   CREATE UNIQUE INDEX "BidOpeningRecord_projectId_bidSupplierId_key" ON "BidOpeningRecord"("projectId", "bidSupplierId");
docker exec -i water-erp-postgres psql -U water_erp -d water_erp < prisma/migrations/*_bid_opening_record_unique/migration.sql
pnpm exec prisma migrate resolve --applied bid_opening_record_unique
pnpm exec prisma generate
```

（目录名以 `--create-only` 实际生成的 `<timestamp>_bid_opening_record_unique` 为准，`resolve` 参数取时间戳后缀。）

- [ ] **Step 4: 两处写路径改 upsert**

decryptSupplier phase③（`:1960-1974`）的 findFirst/分支写 整段替换：

```ts
          await tx.bidOpeningRecord.upsert({
            where: { projectId_bidSupplierId: { projectId, bidSupplierId: supplierId } },
            create: { projectId, ...recordData, bidSupplierId: supplierId },
            update: recordData,
          });
```

enterOpeningRecord（`:2710` 方法体内，grep `bidOpeningRecord.create`）同样改 upsert（create 用现有 recordData + bidSupplierId，update 用 recordData）。

- [ ] **Step 5: 全量跑测**

Run: `pnpm --filter api test -- bid.service.spec.ts`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): BidOpeningRecord 复合唯一+upsert 双保险——解密/唱标并发不再双建记录（N1b）"
```

---

### Task 3: N2 签字扫描件 storeScan 改 upsert

**Files:**
- Modify: `apps/api/src/bid/bid-sign-packet.service.ts:253-264`
- Test: `apps/api/src/bid/bid-sign-packet.service.spec.ts`

**Interfaces:**
- Produces: `storeScan` 幂等（同 key 重传更新 size/sha256/mimeType/originalName/uploaderId，返回同一 asset id）。

- [ ] **Step 1: 失败单测**

```ts
it('N2：storeScan 同 key 重传走 upsert（create 撞 @unique 的 P2002→500 已除）', async () => {
  prisma.fileAsset.upsert = jest.fn().mockResolvedValue({ id: 'asset-1' });
  await service.uploadExpertScan('p1', 'e1', fakeScan('image/jpeg'), 'host-1');
  expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { key: 'bid-sign-packet/p1/expert-e1.jpg' } }),
  );
  expect(prisma.fileAsset.create).not.toHaveBeenCalled();
});
```

（`fakeScan` 沿用 spec 文件内已有的 UploadedSignScan 构造方式；若无则内联 `{ buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'a.jpg' }`。）

- [ ] **Step 2: 跑测失败**

Run: `pnpm --filter api test -- bid-sign-packet.service.spec.ts -t "N2"`
Expected: FAIL（现为 create）。

- [ ] **Step 3: 实现**

`:253-264` 的 `create` 替换（`:368` 主包 upsert 同款）：

```ts
    const asset = await this.prisma.fileAsset.upsert({
      where: { key: objectKey },
      create: {
        key: objectKey,
        originalName: file.originalname || `scan.${ext}`,
        mimeType: file.mimetype,
        size: file.buffer.length,
        sha256,
        category,
        uploaderId: actorId,
      },
      update: {
        originalName: file.originalname || `scan.${ext}`,
        mimeType: file.mimetype,
        size: file.buffer.length,
        sha256,
        uploaderId: actorId,
      },
    });
```

- [ ] **Step 4: 跑测 + 全 spec**

Run: `pnpm --filter api test -- bid-sign-packet`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid-sign-packet.service.ts apps/api/src/bid/bid-sign-packet.service.spec.ts
git commit -m "fix(bid): 签字扫描件重传 upsert——同 key 重传不再 500（N2，P1-17 同类漏网）"
```

---

### Task 4: N3+N14 评标快照与回流包 fileAsset upsert

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:3423-3433`
- Modify: `apps/api/src/bid/bid-sign-packet.service.ts:311-318`
- Test: `apps/api/src/bid/bid.service.spec.ts`、`apps/api/src/bid/bid-sign-packet.service.spec.ts`

**Interfaces:**
- Produces: 两处产物指纹与 MinIO 内容恒一致（重生成=同 key 更新 size/sha256）。

- [ ] **Step 1: 失败单测（bid.service）**

```ts
it('N3：结果重生成时评标快照 fileAsset 走 upsert（不再 create 撞 key 被 catch 吞）', async () => {
  // 复用既有 generateEvaluationResults 成功用例的 mock 前置，另加：
  prisma.fileAsset.upsert = jest.fn().mockResolvedValue({ id: 'fa-1' });
  await service.generateEvaluationResults('p1', 'u1');
  expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { key: 'bid-evaluation-handover/p1.json' },
      update: expect.objectContaining({ sha256: expect.any(String) }),
    }),
  );
  expect(prisma.fileAsset.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- bid.service.spec.ts -t "N3"`；Expected FAIL。

- [ ] **Step 3: 实现（快照）**

`:3423` 起替换（日志文案区分首建/更新）：

```ts
      const existingSnapshot = await this.prisma.fileAsset.findUnique({
        where: { key: objectKey }, select: { id: true },
      });
      await this.prisma.fileAsset.upsert({
        where: { key: objectKey },
        create: {
          key: objectKey,
          originalName: `评标包-${project.projectCode}.json`,
          mimeType: 'application/json',
          size: buffer.length,
          sha256,
          category: 'bid_evaluation_handover',
          uploaderId: actorId ?? null,
        },
        update: { size: buffer.length, sha256, uploaderId: actorId ?? null },
      });
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: project.name,
          action: '评标完整性快照',
          result: `${existingSnapshot ? '已更新（结果重生成，覆盖旧指纹）' : '指纹'} ${sha256.slice(0, 16)}…`,
          riskFlag: '无',
        },
      }).catch(() => {});
```

- [ ] **Step 4: 实现（回流包）+ 单测**

`bid-sign-packet.service.ts:311` 的 `create` 改为与上例同构的 upsert（create 段照抄现有字段；update 段 `{ size: buffer.length, sha256, uploaderId: actorId ?? null }`）。spec 新增断言 `generateHandover` 使用 upsert 且 `create` 未被调用（前置沿用该 spec 既有 generateHandover 用例的 mock）。

- [ ] **Step 5: 跑测**

Run: `pnpm --filter api test -- bid.service.spec.ts bid-sign-packet.service.spec.ts`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid-sign-packet.service.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/bid/bid-sign-packet.service.spec.ts
git commit -m "fix(bid): 评标快照/回流包 fileAsset upsert——重生成指纹与内容不再分叉（N3/N14）"
```

---

### Task 5: N4a+N4b 前端流标口径（minBidders 下发 + 结果已生成收口）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:409-418`（getProject 返回）
- Modify: `apps/bid-portal/src/lib/api/evaluation.ts:77`（类型）
- Modify: `apps/bid-portal/src/components/workspace/dispute-block.tsx:47-57,84,139-148`
- Test: `apps/api/src/bid/bid.service.spec.ts`（getProject 字段断言）

**Interfaces:**
- Produces: `BidProjectDetail.minBidders: number`（getProject 响应字段，直接采购=1 其余=3）。
- Consumes: `listEvaluationResults(bidProjectId)`（`apps/bid-portal/src/lib/api/evaluation.ts:19` 已存在）。

- [ ] **Step 1: 后端下发 minBidders**

getProject（`:409-418`）两个 return 前统一附字段：

```ts
    const enriched = { ...project, minBidders: this.getMinBidders(project.procurementMethod) };
    if (/* 保留原有 bid_host 判定 */) return sanitizeForBidHost(enriched);
    return enriched;
```

单测：既有 getProject 用例补断言 `res.minBidders === 3`（谈判采购 mock）/直接采购 mock 断言 1。

- [ ] **Step 2: 前端类型**

`evaluation.ts:77` 接口加：

```ts
  minBidders?: number; // N4：法定最少投标家数（直接采购=1，其余=3）——后端 getProject 下发
```

- [ ] **Step 3: dispute-block 改造**

组件内新增结果状态自取（`:47` `detail` 解构后）：

```tsx
  const [resultsGenerated, setResultsGenerated] = React.useState(false);
  React.useEffect(() => {
    if (!bidProjectId || stage === 'ARCHIVED') return;
    listEvaluationResults(bidProjectId).then((r) => setResultsGenerated(r.length > 0)).catch(() => setResultsGenerated(false));
  }, [bidProjectId, stage, detail]);
```

（import 补 `listEvaluationResults`；`detail` 入依赖以在 onChanged 刷新后重取。）

`:57` 与 `:84`、`:139-148` 替换：

```tsx
  const minBidders = detail.minBidders ?? 3;
  const suggestAbort = !archived && validSuppliers.length < minBidders && !resultsGenerated;
```

```tsx
  async function handleAbort() {
    const warn = resultsGenerated
      ? `当前有效供应商仅 ${validSuppliers.length} 家，且项目已生成官方评标结果——流标将作废该结果并高风险留痕。确认执行？此操作不可逆。`
      : `当前有效供应商仅 ${validSuppliers.length} 家（法定最少 ${minBidders} 家），确认执行流标？此操作不可逆。`;
    if (!window.confirm(warn)) return;
    // 以下保持原样（abortBidProject 调用）；结果已生成时后端将强制要求 reason（Task 7），
    // 此处同步带上：
    await abortBidProject(bidProjectId, resultsGenerated ? `有效供应商仅 ${validSuppliers.length} 家（< ${minBidders}），经异议裁决流标；已知结果作废` : '依专家异议裁决，有效供应商不足');
  }
```

横幅区（`:139-148`）在 `resultsGenerated` 时整块隐藏（含按钮），仅在存在 `open` 态异议工单时保留——即条件改为 `suggestAbort || hasOpenDispute` 控制横幅、`suggestAbort` 控制建议文案与按钮。

- [ ] **Step 4: 手工验证（dev 环境 :3007）**

打开英雄项目（若已 ARCHIVED 则任一 EVALUATING 种子项目）：直接采购项目 2 家有效不再显示「建议流标」；非直接采购已生成结果项目横幅消失。

- [ ] **Step 5: 跑测 + lint**

Run: `pnpm --filter api test -- bid.service.spec.ts && pnpm --filter bid-portal lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/bid-portal/src/lib/api/evaluation.ts apps/bid-portal/src/components/workspace/dispute-block.tsx
git commit -m "fix(bid): 流标建议按采购方式取法定家数+结果已生成收口——直接采购不再误报（N4a/b）"
```

---

### Task 6: N4d 开标准备 checklist 家数口径 = 已提交

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1150`
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N4：开标 checklist 按「已提交」计数——3 行候选仅 1 家已提交 → OPENING_CHECKLIST_FAILED', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: 'P', deadline: past, projectManagementItemId: null, round: 1, assignedHostUserId: 'u1', procurementMethod: '谈判采购' });
  prisma.bidExpert.count.mockResolvedValue(3);
  prisma.bidSupplier.count.mockResolvedValue(1); // 只有已提交的 1 家
  await expect(service.startOpening('p1', {}, 'u1')).rejects.toMatchObject({
    response: { code: 'OPENING_CHECKLIST_FAILED' },
  });
});
```

（`past` 为 `new Date(Date.now() - 3600_000)`；沿用既有 startOpening 用例 mock 风格。）

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- bid.service.spec.ts -t "N4"`。

- [ ] **Step 3: 实现**

`:1150` 改：

```ts
      const supplierCount = await this.prisma.bidSupplier.count({ where: { projectId: id, submitStatus: '已提交' } });
```

（`blocking.push` 文案改 `有效投标（已提交）仅 X 家(法定最少 N 家…)`。）

- [ ] **Step 4: 跑测** — Run: `pnpm --filter api test -- bid.service.spec.ts`；Expected 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 开标 checklist 家数口径改为已提交——受邀未投递不再计入（N4d）"
```

---

### Task 7: N4c abortBidProject 结果保护

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:966`（阶段校验后）
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N4：已存在官方评标结果时流标须书面理由（ABORT_REASON_REQUIRED）', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: 'P', procurementMethod: '谈判采购', _count: { suppliers: 2 } });
  prisma.bidEvaluationResult.count.mockResolvedValue(2);
  await expect(service.abortBidProject('p1', 'u1')).rejects.toMatchObject({
    response: { code: 'ABORT_REASON_REQUIRED' },
  });
  expect(prisma.bidEvaluationResult.count).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
});
```

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- bid.service.spec.ts -t "ABORT_REASON_REQUIRED"`。

- [ ] **Step 3: 实现**

`assertBidStageTransition(...)` 之后插入：

```ts
    // N4：已生成官方评标结果仍可流标（定标前发现重大问题的合法出口），但必须书面理由并高风险留痕
    const resultCount = await this.prisma.bidEvaluationResult.count({ where: { projectId: id } });
    if (resultCount > 0 && !reason?.trim()) {
      throw new BadRequestException({ error: '本项目已生成官方评标结果，流标须填写书面理由（结果将作废并留痕）', code: 'ABORT_REASON_REQUIRED' });
    }
```

事务内监督日志 result 拼接：`riskNote` 已含 reason；`riskFlag` 保持「高风险」，`result` 追加 `resultCount > 0 ? '；注意：已存在官方评标结果，随流标作废' : ''`。

- [ ] **Step 4: 跑测** — Run: `pnpm --filter api test -- bid.service.spec.ts`；Expected 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 有官方结果的流标强制书面理由+作废留痕——防一键误废已定结果（N4c）"
```

---

### Task 8: N5 reopenFromAborted 时间兜底

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1039-1048`
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N5：流标重启的新项目 deadline 在未来（不再继承原项目过期时间）', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ABORTED', name: 'P', projectCode: 'BID-1',
    procurementMethod: '谈判采购', openTime: new Date('2026-08-01'), deadline: new Date('2026-08-01'),
    downloadDeadline: new Date('2026-07-30'), round: 1 });
  prisma.bidProject.create.mockImplementation(({ data }) => data);
  const created = await service.reopenFromAborted('p1', 'u1');
  expect(new Date(created.deadline).getTime()).toBeGreaterThan(Date.now());
  expect(new Date(created.openTime).getTime()).toBeGreaterThan(new Date(created.deadline).getTime());
});
```

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- bid.service.spec.ts -t "N5"`。

- [ ] **Step 3: 实现**

`:1039` 起 `newCode` 之前插入，并把 create 的 `openTime/deadline/downloadDeadline` 三行改为新值：

```ts
    // N5：原时间已随流标过期——重启项目给「截标 +3 天、开标 +2h」兜底窗口，并在留痕中提示重新设定
    const fallbackDeadline = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const fallbackOpenTime = new Date(fallbackDeadline.getTime() + 2 * 3600 * 1000);
```

create 数据内：`openTime: fallbackOpenTime, deadline: fallbackDeadline, downloadDeadline: null`；
`riskNote` 模板追加 `；重启默认时间 截标 ${fallbackDeadline.toISOString()} / 开标 ${fallbackOpenTime.toISOString()}（请在项目编辑中重新设定）`。

- [ ] **Step 4: 跑测** — Expected 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 流标重启项目时间兜底 +3d/+2h——不再出生即过截标（N5）"
```

---

### Task 9: N7 婉拒/过期统一自动递补

**Files:**
- Modify: `apps/api/src/expert/expert-admin.service.ts:905-921`（getProjectInvitations 清扫）、`:1055-1065`（declineInvitation）
- Test: `apps/api/src/expert/expert-admin.service.spec.ts`（若无既有文件则新建同路径 spec）

**Interfaces:**
- Produces: `declineInvitation` 返回 `{ success, status: 'declined', promoted }`（`promoted` 类型与 `expert.controller.ts:173` RSVP 路径一致：`autoPromoteCandidate` 返回值或 null）。前端 `apps/web/src/lib/api/expert.ts:336` 已声明该类型，无需改。

- [ ] **Step 1: 失败单测**

```ts
describe('N7 婉拒/过期递补统一', () => {
  it('admin declineInvitation 触发 autoPromoteCandidate 并回传 promoted', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending' });
    prisma.bidExpert.update.mockResolvedValue({});
    (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue({ userId: 'u9', expertName: '候补A', major: '技术' });
    const res = await service.declineInvitation('p1', 'u1');
    expect((service as any).autoPromoteCandidate).toHaveBeenCalledWith('p1');
    expect(res.promoted).toMatchObject({ expertName: '候补A' });
  });

  it('getProjectInvitations 过期清扫含正选时触发一次递补', async () => {
    prisma.bidExpert.findMany
      .mockResolvedValueOnce([{ id: 'be-1', expertRole: '正选' }])   // 过期查询
      .mockResolvedValue([]);                                        // 列表查询
    prisma.bidExpert.updateMany.mockResolvedValue({ count: 1 });
    (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue(null);
    await service.getProjectInvitations('p1');
    expect((service as any).autoPromoteCandidate).toHaveBeenCalledWith('p1');
  });
});
```

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- expert-admin.service.spec.ts -t "N7"`。

- [ ] **Step 3: 实现**

`declineInvitation`（`:1063` update 之后、return 之前）：

```ts
    const promoted = await this.autoPromoteCandidate(projectId).catch(() => null);
    return { success: true, status: 'declined', promoted };
```

`getProjectInvitations`（`:909`）：过期查询 select 加 `expertRole: true`；`updateMany` 之后：

```ts
    if (expiredPending.some(e => e.expertRole === '正选')) {
      await this.autoPromoteCandidate(projectId).catch(() => null); // 与 RSVP 链接婉拒路径同款递补
    }
```

`:911` 注释同步改为「与 RSVP verify 行为一致（TTL 过期自动弃权并递补）」。

- [ ] **Step 4: 跑测** — Run: `pnpm --filter api test -- expert-admin.service.spec.ts`；Expected 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/expert/expert-admin.service.ts apps/api/src/expert/expert-admin.service.spec.ts
git commit -m "fix(expert): 婉拒/RSVP 过期统一自动递补候补——评委缺员不再靠人工发现（N7）"
```

---

### Task 10: N6 RSVP TTL 文案与实际一致

**Files:**
- Modify: `apps/api/src/expert/expert.controller.ts:103,160`
- Modify: `apps/api/src/expert/expert-extraction-ai.service.ts:224,233`
- Test: `apps/api/src/expert/expert.controller.spec.ts`（无则新建最小 spec）

- [ ] **Step 1: 失败单测**

```ts
it('N6：RSVP_EXPIRED 文案用环境变量小时数（默认 2 小时）', async () => {
  process.env.EXPERT_RSVP_TTL_HOURS = undefined;
  prisma.bidExpert.findUnique.mockResolvedValue({ rsvpToken: 't', rsvpExpiresAt: new Date(Date.now() - 1000), invitationStatus: 'pending' });
  await expect(controller.rsvpRespond('t', { status: 'confirmed' })).rejects.toMatchObject({
    response: { error: expect.stringContaining('2小时') },
  });
});
```

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- expert.controller.spec.ts -t "N6"`。

- [ ] **Step 3: 实现**

`expert.controller.ts` 顶部（import 后）加：

```ts
const rsvpTtlHours = () => {
  const h = parseFloat(process.env.EXPERT_RSVP_TTL_HOURS ?? '2');
  return Number.isFinite(h) && h > 0 ? h : 2;
};
```

`:160` 错误文案：`邀请链接已过期（${rsvpTtlHours()}小时），请联系采购方`；`:103` 注释同步。
`expert-extraction-ai.service.ts:224`：`收到通知后${rsvpTtlHours()}小时内确认`（该文件内复制同款小函数或从 controller 导出——**选导出**：controller `export const rsvpTtlHours`，ai service import 之，避免双份）；`:233` 模板占位说明同步。

- [ ] **Step 4: 跑测 + Commit**

```bash
pnpm --filter api test -- expert.controller.spec.ts
git add apps/api/src/expert/expert.controller.ts apps/api/src/expert/expert-extraction-ai.service.ts
git commit -m "fix(expert): RSVP 过期文案对齐实际 TTL（默认 2 小时）——通知模板同步（N6）"
```

---

### Task 11: N8 AI 分析——rerun 补建任务 + 存量降级文案

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1601-1602`
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`（grep 锚点「等待分析任务创建」）
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N8：存量项目无 AI 任务时 rerunAiAnalysis 自动补建（不再 TASK_NOT_FOUND）', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: 'P' });
  prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
  prisma.aiBidAnalysisTask.create.mockResolvedValue({ id: 'task-1' });
  prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bs-1' }]);
  prisma.aiBidderResult.createMany.mockResolvedValue({ count: 1 });
  await expect(service.rerunAiAnalysis('p1', 'u1')).resolves.toBeTruthy();
  expect(prisma.aiBidAnalysisTask.create).toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- bid.service.spec.ts -t "N8"`。

- [ ] **Step 3: 实现（后端）**

`:1601-1602` 的 `if (!task) throw ... TASK_NOT_FOUND` 替换：

```ts
    let task = await this.prisma.aiBidAnalysisTask.findUnique({ where: { projectId } });
    if (!task) {
      // N8：存量项目（先于该特性创建）无任务——与 startEvaluation 同构补建，rerun 即恢复入口
      task = await this.prisma.aiBidAnalysisTask.create({ data: { projectId, status: 'PENDING' } });
      const evaluable = await this.prisma.bidSupplier.findMany({
        where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
        select: { id: true },
      });
      if (evaluable.length > 0) {
        await this.prisma.aiBidderResult.createMany({
          data: evaluable.map((s) => ({ taskId: task!.id, bidSupplierId: s.id, status: 'PENDING' })),
          skipDuplicates: true,
        });
      }
    }
```

- [ ] **Step 4: 实现（前端文案）**

`evaluation-view.tsx` 内 grep「等待分析任务创建」处的条件渲染改为三态：任务不存在 →「未创建 AI 分析任务（存量项目）——点击重新分析可补建并启动」；存在 → 原进度展示。按钮沿用卡片既有 rerun-ai-analysis 入口。

- [ ] **Step 5: 跑测 + lint + Commit**

```bash
pnpm --filter api test -- bid.service.spec.ts && pnpm --filter bid-portal lint
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "fix(bid): AI 分析 rerun 自动补建任务+存量项目降级文案——卡片不再永久等待（N8）"
```

---

### Task 12: N8b 进度分子过滤对齐（排除 PRICE 记录）

**Files:**
- Modify: `apps/api/src/bid/score-recalculate.helper.ts:21-23`
- Test: `apps/api/src/bid/score-recalculate.helper.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N8b：手填价格分记录不计入进度分子（分母已排 PRICE，分子同步排除）', async () => {
  const tx = {
    bidScoreItem: { findMany: async () => [
      { id: 'i1', category: 'TECHNICAL' }, { id: 'i2', category: 'PRICE' },
    ] },
    bidSupplier: { findMany: async () => [{ id: 's1' }] },
    bidScoreRecord: {
      count: async () => 2, // 1 条技术 + 1 条手填价格
      findMany: async () => [{ score: 40 }, { score: 27 }],
    },
  };
  const { progress } = await recomputeExpertProgress(tx as any, 'e1', 'p1');
  // 分母 = 1 项技术 × 1 供应商 = 1；有效分子 = 1（价格记录不再虚增）→ 100%
  expect(progress).toBe(100);
});
```

- [ ] **Step 2: 跑测失败** — Run: `pnpm --filter api test -- score-recalculate.helper.spec.ts -t "N8b"`（现分子 2/1 会 100% 封顶碰巧过？——构造 2 技术项+1 价格记录场景使旧代码 <100%、新代码 =100%：items 两项 TECHNICAL、records count 3（2 技术+1 价格）→ 旧 3/2→100% 封顶…改为 count=1（1 技术+1 价格、另 1 技术未评）：旧 1/2=50%，新仍 50%——**用精确断言替代**：mock count 被调用的 where 参数）。

**修正 Step 1 断言**（直接验证查询条件而非推导数字）：

```ts
    const whereArg = (tx.bidScoreRecord.count as jest.Mock).mock.calls[0][0];
    expect(whereArg.scoreItem).toMatchObject({ category: { not: 'PRICE' } });
```

（count 用 `jest.fn(async () => 2)` 包装。）

- [ ] **Step 3: 实现**

```ts
  const scoredItems = await tx.bidScoreRecord.count({
    where: { expertId, scoreItem: { projectId, category: { not: 'PRICE' } }, supplierId: { in: activeIds } },
  });
```

- [ ] **Step 4: 跑测** — Run: `pnpm --filter api test -- score-recalculate.helper.spec.ts`；Expected 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/score-recalculate.helper.ts apps/api/src/bid/score-recalculate.helper.spec.ts
git commit -m "fix(bid): 专家进度分子排除 PRICE 记录——与分母口径对齐（N8b）"
```

---

### Task 13: N9 评标启动/流标通知对象过滤

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1568-1571`（startEvaluation）、`:1001-1004`（abort）
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N9：评标启动通知只发已确认正选专家', async () => {
  // 复用既有 startEvaluation 成功用例前置，另加：
  prisma.bidExpert.findMany.mockResolvedValue([
    { userId: 'u1', expertName: 'A' }, { userId: null, expertName: 'B' },
  ]);
  await service.startEvaluation('p1', 'host-1');
  expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ expertRole: '正选', invitationStatus: 'confirmed' }) }),
  );
});
```

- [ ] **Step 2: 跑测失败 → Step 3: 实现**

两处 `findMany({ where: { projectId: id }, select: ... })` 均改为：

```ts
      where: { projectId: id, expertRole: '正选', invitationStatus: 'confirmed' },
```

- [ ] **Step 4: 跑测 + Commit**

```bash
pnpm --filter api test -- bid.service.spec.ts
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 评标启动/流标通知只发已确认正选——候补与已婉拒不再收（N9）"
```

---

### Task 14: N10 评分标准 0 满分打分项校验

**Files:**
- Modify: `apps/api/src/bid/score-standard-validator.service.ts:46+`（assertScoreStandardComplete）
- Modify: `apps/web/src/components/projects/score-standard/score-standard-editor.tsx`（满分输入）
- Test: `apps/api/src/bid/score-standard-validator.service.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N10：打分类评分项满分为 0 → SCORE_ITEM_ZERO_MAX（「法」式空项拦截）', async () => {
  prisma.bidScoreItem.findMany.mockResolvedValue([
    { id: 'i1', name: '商务评分', category: 'BUSINESS', maxScore: 20 },
    { id: 'i2', name: '法', category: 'TECHNICAL', maxScore: 0 },
  ]);
  await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
    response: { code: 'SCORE_ITEM_ZERO_MAX' },
  });
});
```

- [ ] **Step 2: 跑测失败 → Step 3: 实现（后端）**

`assertScoreStandardComplete` 取得 `items` 后（打分类 Σ=100 检查之前）插入：

```ts
    // N10：打分类项满分须 >0——0 分「空项」曾随标准发布并永久锁定（英雄项目「法」）
    for (const item of items) {
      if (!PASS_FAIL_CATEGORIES.has(item.category) && Number(item.maxScore) <= 0) {
        throw new BadRequestException({ error: `评分项「${item.name}」为打分类但满分为 0，请删除或设置满分`, code: 'SCORE_ITEM_ZERO_MAX' });
      }
    }
```

- [ ] **Step 4: 实现（前端编辑器）**

`score-standard-editor.tsx` 内定位满分数字输入（grep `maxScore`/「满分」），打分类（非通过性）行加 `min={1}` 并在保存前校验，同文案 toast。

- [ ] **Step 5: 跑测 + lint + Commit**

```bash
pnpm --filter api test -- score-standard-validator.service.spec.ts && pnpm --filter web lint
git add apps/api/src/bid/score-standard-validator.service.ts apps/api/src/bid/score-standard-validator.service.spec.ts apps/web/src/components/projects/score-standard/score-standard-editor.tsx
git commit -m "fix(bid): 打分类评分项 0 满分拦截（发布/启动评标双闸）+编辑器 min=1（N10）"
```

---

### Task 15: N11 结果向导文案时点修正

**Files:**
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx:765`

- [ ] **Step 1: 实现**

`:765` 替换为：

```tsx
                    <li>第 1 名推荐为中标候选人；完整归档后自动生成中标公示草稿（在 :3005 信息发布中心发布）</li>
```

- [ ] **Step 2: 验证 + Commit**

```bash
pnpm --filter bid-portal lint
git add apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "fix(bid): 结果向导文案——公示草稿在归档时生成而非结果生成时（N11）"
```

---

### Task 16: N12+N8种子 英雄项目种子成对补齐

**Files:**
- Modify: `apps/api/prisma/seed-data/BidSupplier.json`（bs_seed_1/bs_seed_2 补 supplierId）
- Modify: `apps/api/prisma/seed-data/SupplierBidSubmission.json`（新增 2 行）
- Modify: `apps/api/prisma/seed-data/BidScoreRecord.json`（新增 12 行通过性记录）

**Interfaces:**
- Produces: 重灌后英雄项目 ①供应商门户可见（进展+报价回显）②专家进度 100% ③废标表决完整性警告不再出现。

- [ ] **Step 1: 提取真实 id（一次性脚本，不落库）**

```bash
cd water-erp
python3 - <<'EOF'
import json
bs = json.load(open('apps/api/prisma/seed-data/BidSupplier.json'))
rows = [b for b in bs if b['id'] in ('bs_seed_1','bs_seed_2')]
hero_project = rows[0]['projectId']
suppliers = json.load(open('apps/api/prisma/seed-data/Supplier.json'))
by_name = {s['name']: s['id'] for s in suppliers}
items = json.load(open('apps/api/prisma/seed-data/BidScoreItem.json'))
pf = [i for i in items if i['projectId'] == hero_project and i['category'] in ('QUALIFICATION','RESPONSIVE')]
print('hero_project:', hero_project)
for r in rows: print(r['id'], '->', by_name.get(r['supplierName']), r['supplierName'])
print('pass-fail item ids:', [(i['id'], i['category']) for i in pf])
EOF
```

- [ ] **Step 2: 写入三份 JSON**

- `BidSupplier.json`：bs_seed_1/bs_seed_2 两行加 `"supplierId": "<Step1 解析出的 id>"`。
- `SupplierBidSubmission.json`（现为空数组）写入 2 行：

```json
[
  { "id": "sbs_seed_1", "supplierId": "<蜀通 supplierId>", "projectId": "<hero_project>",
    "status": "submitted", "submittedAt": "2026-08-12T02:00:00.000Z",
    "bidPrice": "4800000", "deliveryPeriod": "按采购文件工期要求" },
  { "id": "sbs_seed_2", "supplierId": "<用友 supplierId>", "projectId": "<hero_project>",
    "status": "submitted", "submittedAt": "2026-08-12T02:00:00.000Z",
    "bidPrice": "4950000", "deliveryPeriod": "按采购文件工期要求" }
]
```

（`bidPrice` 留明文走 legacy 兼容：`openField` 返回 null → `?? 原值` 回显，见 `supplier-portal.service.ts:1024`。）

- `BidScoreRecord.json` 追加 12 行（编号续 br_seed_19..30）：3 专家（be_seed_1/2/3）× 2 供应商（bs_seed_1/2）× Step1 的 2 个通过性 item id，`"score": 0, "passed": true`（客观项全过），`createdAt` 同批。

- [ ] **Step 3: 重灌 + 验证**

```bash
pnpm db:seed
docker exec water-erp-postgres psql -U water_erp -d water_erp -tAc \
  'SELECT count(*) FROM "SupplierBidSubmission"; SELECT count(*) FROM "BidScoreRecord";'
```

Expected: `2` 与 `30`。再开 :3007 英雄项目工作区：评分进度卡 100%（分母 5 打分项×2 供应商，分子 6 手填非价格+12 通过性=18≥10 → 封顶 100%）；生成结果时无「废标表决完整性警告」。

**注意：`pnpm db:seed` 破坏性重灌——今天两次全链路走查项目（TP/JJ）与英雄归档态会被清掉（种子态回归 EVALUATING 演示位）。这是预期行为。**

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed-data/BidSupplier.json apps/api/prisma/seed-data/SupplierBidSubmission.json apps/api/prisma/seed-data/BidScoreRecord.json
git commit -m "chore(seed): 英雄项目供应商/评分种子成对补齐——供应商门户可见+进度 100%（N12）"
```

---

### Task 17: N15 decryptAllSuppliers 跳过已定性

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1789-1792`
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 失败单测**

```ts
it('N15：一键解密只取 PENDING（DANGER 不再必然计 failed）', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
  prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bs-1', supplierName: 'A' }]);
  prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', supplierId: 's1', decryptStatus: 'PENDING' });
  // …复用单供应商解密成功前置
  const res = await service.decryptAllSuppliers('p1', 'u1');
  expect(prisma.bidSupplier.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ decryptStatus: 'PENDING' }) }),
  );
});
```

- [ ] **Step 2: 跑测失败 → Step 3: 实现**

`:1790` where 改 `{ projectId, decryptStatus: 'PENDING', submitStatus: { not: '已撤回' } }`；`resultText` 补 `（已定性异常者请走补传→重解密通道）`。补传通道 `reuploadBidFile` 会把 DANGER 重置 PENDING（已验证），恢复路径不变。

- [ ] **Step 4: 跑测 + Commit**

```bash
pnpm --filter api test -- bid.service.spec.ts
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 一键解密只取 PENDING——已定性 DANGER 不再必然计 failed（N15）"
```

---

## 需产品拍板（不在本计划实施）

**N16 公告直建项目的开标宿主**：`BID-1786868686594` 类项目（公告向导创建、`projectManagementItemId` 为空、已有真实投递）在 :3005 无面板宿主、:3007 截标后仅提示，无任何 UI 入口推进开标。两个方案：
- **A（治本）**：公告向导「确认发布」时若未关联 PMI → 自动创建最小 PMI（经办人=公告 author，阶段直接置 BID_EVALUATION 待推进）并回填，:3005 面板即刻可用。工作量 ~1 天。
- **B（治标）**：:3007 任务板「待确定开标」分区对无 PMI 项目放开「指派主持人 → 按时开标」行操作（`assignHost` + `startOpening` API 均已存在）。工作量 ~半天，但打破「按时开标归 :3005」的分工 v3 原则。

建议 A；拍板后另立计划。

## 明确出范围（既有遗留，另列 backlog）

- N13 SM2 客户端签名（Phase 6 整体规划）
- 评标 72h 到期自动处置、动议/澄清超时、同分 tiebreaker、落标/中标通知、回避名称子串匹配、邀请双时间源合并、身份核验实体化

## Self-Review 记录

- **覆盖**：报告 §二 N1→Task 1/2，N2→Task 3，N3/N14→Task 4，N4→Task 5/6/7，N5→Task 8，N7→Task 9，N6→Task 10，N8→Task 11/12/16，N9→Task 13，N10→Task 14，N11→Task 15，N12→Task 16，N15→Task 17，N16→拍板节。无遗漏。
- **口径修正（对照代码后）**：①N8 重定义——真实链路 `verifyScoreReview` 与进度分母本就自洽（都排 PRICE、含通过性），英雄项目 50% 是种子绕过核对闸门所致；故 Task 12 只修分子过滤真 bug，Task 16 用种子补齐恢复一致，**未**把通过性项移出分母（那会破坏核对闸门口径）。②N4b 数据源修正——`getProject` 不返回 `evaluationResults`（`evaluation.ts:102` 注释自证），DisputeBlock 自取 `listEvaluationResults` 而非从 detail 读。③Task 5 后端字段方案取代 shared 包方案（避免 packages/shared 改动+重编译链）。
- **类型一致**：`projectId_bidSupplierId`（Task 2 迁移名与 upsert where 一致）；`promoted` 返回类型与 `expert.ts:336` 前端声明一致；`minBidders` 后端字段名=前端接口字段名。
