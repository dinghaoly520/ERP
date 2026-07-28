# 开评标流程 Wave A 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 每个任务遵循 TDD：先写复现缺陷的失败测试 → 确认失败 → 最小实现 → 确认通过 → 回归 → 提交。**修复一个、验证一个、提交一个**，不要批量改完再测。

**Goal:** 修复 `docs/superpowers/audit/2026-07-25-bid-flow-audit-fixlist.md` 中 Wave A 的 8 项 Critical/High（数据正确性 + 不可逆终局把关），每项以回归测试锁定。

**Architecture:** 后端 NestJS + Prisma 逻辑修复（jest 单测验证）；:3005 前端 React 把关增强（tsc + build 验证）。全部为逻辑修复，**不改 Prisma schema、不引入新依赖**（规避 migration drift 与 schema 重置风险）。

**Tech Stack:** NestJS 11 · Prisma · Jest · React 19 / Next.js 16 · @water-erp/shared

## Global Constraints

- 状态机语义不变：同阶段幂等、允许跳步、回退或离开 ARCHIVED 抛 409（`apps/api/src/bid/bid-state.ts`）。
- 阶段流转仍 100% 收口 :3005；:3007 不得新增任何阶段流转调用。
- 测试命令统一从 `water-erp/` 根执行：`pnpm --filter api test -- <pattern>`。
- 不删除既有刻意设计（删公告重置 stage、解密主持人手动触发等），本计划仅修缺陷。
- **commit 前必须 `git branch --show-current` 确认在 `feat/bid-opening-hall-impl`**（多会话共库，防错位提交）；只 commit，**不 push**（用户未要求）。
- 提交信息中文，沿用仓库风格：`fix(api): …` / `fix(web): …`。

## Verification Protocols

**后端任务（jest）——每个任务都按此四步：**
1. 写失败测试 → `pnpm --filter api test -- <spec文件> -t '<测试名>'` → 期望 **FAIL**（且失败原因是缺陷本身，非 mock/语法错误）
2. 实现修复 → 同命令 → 期望 **PASS**
3. 回归：`pnpm --filter api test -- <spec文件>` 全绿（不破坏既有用例）
4. `git add … && git commit -m "…"`

**前端任务（web :3005）——每个任务都按此：**
1. `pnpm --filter web exec tsc --noEmit` → 无新增类型错误
2. `pnpm --filter web build` → 构建通过（`/login` 预渲染失败系 HEAD 既有，与本改动无关，忽略）
3. 对照任务内「人工核对清单」逐项确认
4. `git commit`

**bid.service.spec.ts mock 约定：** 现有 spec 用逐 model `jest.fn()` 构造 `prisma`。凡走 `$transaction(async tx => …)` 的方法，须有 `prisma.$transaction = jest.fn(async (cb) => cb(prisma))`，使回调内 `tx.*` 解析到同一组 mock。**新增测试前先 Read `apps/api/src/bid/bid.service.spec.ts`，复用/扩展其既有 mock 结构**（下文测试代码给出关键 mock 与断言，scaffolding 按现有 spec 适配）。

## File Structure

**修改：**
- `apps/api/src/bid/bid.service.ts` — Task1 C1 辅助方法+4 端点事务内复查；Task2 H1 解密判定；Task3 H2 废标重算排除 revoked；Task4 H11 唱标覆盖守卫；Task5 H6 异议状态前置+留痕；Task6 H4 startEvaluation 守卫
- `apps/api/src/bid/bid.controller.ts` — Task5 注入 `@CurrentUser` + 新 DTO
- `apps/api/src/upload/upload.service.ts` — Task7 引用检查
- `apps/api/src/announcement/announcement.service.ts` — Task8 级联清理
- `apps/web/src/components/projects/bid-confirm/evaluation-block.tsx` — Task9 H4 前端把关
- `apps/web/src/components/projects/bid-confirm/archive-block.tsx` — Task10 H5 前端摩擦

**新增：**
- `apps/api/src/bid/dto/resolve-opening-dispute.dto.ts` — Task5 DTO

**测试：**
- `apps/api/src/bid/bid.service.spec.ts` — Task1/2/3/4/5/6
- `apps/api/src/upload/upload.service.spec.ts` — Task7
- `apps/api/src/announcement/announcement.service.spec.ts` — Task8（不存在则新建，参照 bid.service.spec 的 mock 结构）

---

## Task 1: C1 — 状态机事务内复查（杜绝 ARCHIVED 复活 / 回退）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（新增私有方法 `lockAndReassertStage`；改 `openSubmission` ~503、`startOpeningInternal` ~566、`startEvaluation` ~686、`archiveAll` ~1790）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: `private async lockAndReassertStage(tx: Prisma.TransactionClient, id: string, target: BidStage): Promise<{ stage: BidStage; name: string }>` — 事务内 `FOR UPDATE` 锁行 → 重读 stage → 重跑 `assertBidStageTransition(fresh.stage, target)`，返回新鲜 `{stage,name}`。四个流转端点在事务内写 stage 前调用它。

- [ ] **Step 1: 写失败测试（startEvaluation 复活场景）**

在 bid.service.spec.ts 新增 describe。关键：pre-tx `findUnique` 返回 OPENING，in-tx（锁后）`findUnique` 返回 ARCHIVED，模拟「事务外读到 OPENING、事务内对手已归档」的竞态。

```ts
describe('C1 — startEvaluation 事务内复查阶段', () => {
  // ...沿用现有 beforeEach 的 prisma mock，并补：
  // prisma.$transaction = jest.fn(async (cb) => cb(prisma));
  // prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }]);
  // scoreStandardValidator.assertScoreStandardComplete = jest.fn().mockResolvedValue(undefined);

  it('事务内复查发现已 ARCHIVED 时抛 409（不再复活为 EVALUATING）', async () => {
    prisma.bidProject.findUnique
      .mockResolvedValueOnce({ stage: 'OPENING', name: 'P' })   // pre-tx (line ~658)
      .mockResolvedValueOnce({ stage: 'ARCHIVED', name: 'P' }); // in-tx 锁后复查
    prisma.bidProject.count = jest.fn();
    prisma.bidExpert.count = jest.fn().mockResolvedValue(1);
    prisma.bidSupplier.count = jest.fn().mockResolvedValue(1);
    prisma.bidProject.update = jest.fn().mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });

    await expect(service.startEvaluation('p1', 'u1')).rejects.toThrow(ConflictException);
    expect(prisma.bidProject.update).not.toHaveBeenCalled(); // 绝不能在 ARCHIVED 上写 EVALUATING
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- bid.service.spec -t 'C1'`
Expected: FAIL —— 当前 `startEvaluation` 事务内不复查 stage，`update` 会被调用（或断言 `not.toHaveBeenCalled` 失败）。

- [ ] **Step 3: 实现辅助方法**

在 `bid.service.ts` 顶部 import 处确保有 `import { Prisma } from '@prisma/client';` 与 `import { assertBidStageTransition, stageAtLeast, BidStage } from './bid-state';`（缺哪个补哪个）。在类内（如 `syncPmStage` 之后）新增：

```ts
/**
 * C1 修复：事务内行锁后复查阶段，杜绝「事务外 assert + 事务内无条件写」的 TOCTOU。
 * 拿行锁后重读 stage 并重跑状态机断言；并发下后提交的一方在此抛 409，
 * 而非裸覆写已被其他事务推进/归档的阶段（防止 ARCHIVED 复活、防止回退）。
 */
private async lockAndReassertStage(
  tx: Prisma.TransactionClient,
  id: string,
  target: BidStage,
): Promise<{ stage: BidStage; name: string }> {
  await tx.$queryRaw`SELECT id FROM "BidProject" WHERE id = ${id} FOR UPDATE`;
  const fresh = await tx.bidProject.findUnique({ where: { id }, select: { stage: true, name: true } });
  if (!fresh) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  assertBidStageTransition(fresh.stage, target);
  return fresh;
}
```

- [ ] **Step 4: 在四个流转端点事务内接入**

`openSubmission`（~503，`$transaction(async (tx) => {` 之后、`tx.bidProject.update` 之前）插入：
```ts
await this.lockAndReassertStage(tx, id, 'SUBMIT');
```

`startOpeningInternal`（~566，事务回调最开头、session upsert 之前）插入（同阶段 OPENING→OPENING 幂等，assert 放行）：
```ts
await this.lockAndReassertStage(tx, id, 'OPENING');
```

`startEvaluation`：**删除** ~686 的裸 `await tx.$queryRaw`...FOR UPDATE` 行，替换为：
```ts
await this.lockAndReassertStage(tx, id, 'EVALUATING');
```

`archiveAll`（~1790，事务回调最开头）插入（同阶段 ARCHIVED→ARCHIVED 幂等放行；并发双归档的败者会在后续 `archiveItems.length===0` 处抛 NO_ITEMS_TO_ARCHIVE，属可接受边缘，不再复活/回退）：
```ts
await this.lockAndReassertStage(tx, id, 'ARCHIVED');
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter api test -- bid.service.spec -t 'C1'`
Expected: PASS

- [ ] **Step 6: 回归**

Run: `pnpm --filter api test -- bid.service.spec`
Expected: 全绿（若既有 stage-transition 用例因新增 in-tx `findUnique`/`$queryRaw` 调用而缺 mock，按其报错补 `prisma.$queryRaw` 与第二个 `findUnique` 的 mock——这是预期内的 mock 适配，非逻辑回归）。

- [ ] **Step 7: Commit**
```bash
git branch --show-current  # 确认 feat/bid-opening-hall-impl
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(api): C1 状态机事务内行锁复查阶段，杜绝并发复活 ARCHIVED/回退"
```

---

## Task 2: H1 — 解密"失败掩盖"（部分文件缺失仍判 SUCCESS）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`decryptSupplier` 文件循环 ~948-987）
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 写失败测试（首文件通过 + 次文件缺失 → 应 DANGER 却判 SUCCESS）**

```ts
describe('H1 — decryptSupplier 部分文件缺失', () => {
  it('首份文件解密+完整性通过、次份文件资产缺失时判 DANGER（不再误判 SUCCESS）', async () => {
    // 项目 OPENING + 会话 + 解密窗口内（按现有 decrypt 用例 mock）
    prisma.bidProject.findUnique = jest.fn().mockResolvedValue({ id:'p1', stage:'OPENING', name:'P' });
    prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
      decryptWindowStart: new Date(Date.now()-1000), decryptWindowEnd: new Date(Date.now()+60000),
    });
    const submission = { technicalSealedKey: 'k', businessSealedKey: 'k', coverLetterSealedKey: null };
    prisma.supplierBidSubmission.findFirst = jest.fn().mockResolvedValue(submission);
    prisma.bidSupplier.findUnique = jest.fn().mockResolvedValue({ id:'s1', supplierId:'sp1', supplierName:'S', decryptStatus:'PENDING', submitStatus:'已提交' });
    // fileRefs 由 submission 推导：technical(asset a1) + business(asset a2)
    prisma.fileAsset.findUnique = jest.fn()
      .mockResolvedValueOnce({ id:'a1', key:'tech', sealedPath:'sealed/tech', sha256:'x' }) // 首份存在
      .mockResolvedValueOnce(null);                                                          // 次份缺失
    prisma.bidSupplier.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn(async (cb) => cb(prisma));

    await service.decryptSupplier('p1', 's1', undefined, 'u1');
    // 断言落库为 DANGER 而非 SUCCESS
    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'DANGER' }) }),
    );
  });
});
```
（`verifyIntegrity` 已在 spec 顶部 `jest.mock('./bid-submission.crypto')` 中 mock 为返回 true；`minioClient.getObject` 已 mock。fileRefs 的实际推导请按 decryptSupplier 真实代码适配 mock 的返回字段。）

- [ ] **Step 2: 跑测试确认失败**
Run: `pnpm --filter api test -- bid.service.spec -t 'H1'`
Expected: FAIL —— 当前残留 `integrityOk===true` 使 outcome 落入 classifyDecryptOutcome 判 SUCCESS。

- [ ] **Step 3: 实现修复**

Read `bid.service.ts` ~915-990 确认 `decryptOk/integrityOk/errorMsg` 的声明位置。在文件循环**之前**新增 `let allFilesOk = true;`，在三处失败分支置 false，并改写 outcome 判定：

```ts
let allFilesOk = true;
for (const ref of fileRefs) {
  if (!ref.assetId) continue;
  const asset = await tx.fileAsset.findUnique({ where: { id: ref.assetId } });
  if (!asset) { allFilesOk = false; errorMsg = `投标文件记录缺失: ${ref.assetId}`; break; }
  try {
    // ……（原解密/完整性逻辑不变）
    if (integrity === false) { allFilesOk = false; integrityOk = false; errorMsg = '标书文件完整性校验失败：SHA-256 不匹配（疑似篡改或损坏）'; break; }
    if (integrity === true) integrityOk = true;
  } catch (e) {
    allFilesOk = false;
    decryptOk = ref.sealedKey ? false : null;
    errorMsg = `标书文件解密失败：${(e as Error).message}`;
    break;
  }
}
```
把 outcome 判定（~983-987）改为：
```ts
const outcome = simulateOk
  ? 'DANGER' as const
  : (!allFilesOk
      ? 'DANGER' as const
      : classifyDecryptOutcome({ hasSealedKey, decryptOk, integrityOk }));
```

- [ ] **Step 4: 跑测试确认通过**
Run: `pnpm --filter api test -- bid.service.spec -t 'H1'`
Expected: PASS

- [ ] **Step 5: 回归**
Run: `pnpm --filter api test -- bid.service.spec`
Expected: 全绿（既有 decrypt SUCCESS/DANGER 用例不受影响——全部文件成功时 allFilesOk 仍为 true，走 classifyDecryptOutcome）。

- [ ] **Step 6: Commit**
```bash
git branch --show-current
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(api): H1 解密任一文件失败即整体 DANGER，堵住部分文件缺失误判 SUCCESS"
```

---

## Task 3: H2 — 废标撤销被评标结果重算静默推翻

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`generateEvaluationResults` 废标判定 ~1257-1294）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- 读 `BidInvalidBid`（`status='revoked'`）构造 `revokedKeys: Set<"supplierId:scoreItemId">`；失败票统计跳过已撤销的 (supplier,item)。

- [ ] **Step 1: 写失败测试（撤销后仍被重算判废）**

```ts
describe('H2 — generateEvaluationResults 尊重废标撤销', () => {
  it('已被 revokeInvalidBid 撤销的 (supplier,scoreItem) 不计入失败票，供应商不被判废', async () => {
    // mock 项目 + experts + suppliers(s1) + scoreItems(通过性项 i1) + scoreRecords(s1 在 i1 全 passed=false，本应过半判废)
    // 关键：bidInvalidBid.findMany（status=revoked）返回 [{ supplierId:'s1', scoreItemId:'i1' }]
    prisma.bidInvalidBid.findMany = jest.fn().mockResolvedValue([{ supplierId:'s1', scoreItemId:'i1' }]);
    // …（按 generateEvaluationResults 真实读取路径补齐 project/experts/suppliers/scoreItem/scoreRecord mock）
    const results = await service.generateEvaluationResults('p1', 'u1');
    const s1 = results.find(r => r.supplierId === 's1');
    expect(s1.disqualified).toBe(false); // 撤销生效：不再判废
  });
});
```
（generateEvaluationResults 读取较重，请 Read ~1203-1360 后按其 findUnique/findMany 路径精确 mock；断言核心是 disqualified===false。）

- [ ] **Step 2: 跑测试确认失败**
Run: `pnpm --filter api test -- bid.service.spec -t 'H2'`
Expected: FAIL —— 当前从原始 passed 投票重算，无视 revoked，s1 被判废（disqualified true）。

- [ ] **Step 3: 实现修复**

在废标判定块**开始前**（~1257，`const passFailVerdicts = …` 之前）加载撤销集合：
```ts
const revokedInvalidBids = await this.prisma.bidInvalidBid.findMany({
  where: { projectId, status: 'revoked' },
  select: { supplierId: true, scoreItemId: true },
});
const revokedKeys = new Set(revokedInvalidBids.map(r => `${r.supplierId}:${r.scoreItemId}`));
```
在内层失败票统计循环（~1276-1281）跳过已撤销项：
```ts
for (const r of records) {
  if (!passFailItemIds.has(r.scoreItemId) || r.passed === null || r.passed === undefined) continue;
  if (revokedKeys.has(`${supplier.id}:${r.scoreItemId}`)) continue; // H2: 已撤销废标不计入失败票
  const agg = byItem.get(r.scoreItemId) ?? { fail: 0, total: 0 };
  agg.total += 1;
  if (r.passed === false) agg.fail += 1;
  byItem.set(r.scoreItemId, agg);
}
```
（`BidInvalidBid.supplierId` FK 指向 `BidSupplier.id`，与 `supplier.id` 一致；`r.scoreItemId` 同维度。）

- [ ] **Step 4: 跑测试确认通过**
Run: `pnpm --filter api test -- bid.service.spec -t 'H2'`
Expected: PASS

- [ ] **Step 5: 回归**
Run: `pnpm --filter api test -- bid.service.spec`
Expected: 全绿（无 revoked 记录时 revokedKeys 为空，行为与原先一致）。

- [ ] **Step 6: Commit**
```bash
git branch --show-current
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(api): H2 评标结果重算排除已撤销废标，使 revokeInvalidBid 产生持久效力"
```

---

## Task 4: H11 — 唱标录入覆盖已确认记录（主持人单方改报价默认生效）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`enterOpeningRecord` ~1094-1144）
- Test: `apps/api/src/bid/bid.service.spec.ts`

- [ ] **Step 1: 写失败测试（已 CONFIRMED 仍可覆盖）**

```ts
describe('H11 — enterOpeningRecord 覆盖已确认记录', () => {
  it('供应商已确认（bidSupplier.confirmStatus=CONFIRMED）时禁止覆盖唱标信息', async () => {
    prisma.bidProject.findUnique = jest.fn().mockResolvedValue({ stage:'OPENING', name:'P' });
    prisma.bidSupplier.findFirst = jest.fn().mockResolvedValue({
      id:'s1', supplierName:'S', decryptStatus:'SUCCESS', confirmStatus:'CONFIRMED',
    });
    await expect(
      service.enterOpeningRecord('p1', { bidSupplierId:'s1', amount:'1', period:'2', qualityTarget:'3', bondStatus:'4' } as any),
    ).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
Run: `pnpm --filter api test -- bid.service.spec -t 'H11'`
Expected: FAIL —— 当前不检查 confirmStatus，会进入事务覆盖。

- [ ] **Step 3: 实现修复**

在 `enterOpeningRecord` 的 `bidSupplier` findFirst（~1104-1107）`select` 中补 `confirmStatus: true`：
```ts
const bidSupplier = await this.prisma.bidSupplier.findFirst({
  where: { id: dto.bidSupplierId, projectId },
  select: { id: true, supplierName: true, decryptStatus: true, confirmStatus: true },
});
```
在 `decryptStatus !== 'SUCCESS'` 校验（~1109-1111）**之后**新增：
```ts
// H11: 供应商已确认的记录禁止覆盖——否则记录回「待供应商确认」而供应商侧仍 CONFIRMED，
// generateEvaluationResults 只看 bidSupplier.confirmStatus，主持人单方改报价会默认生效。
if (bidSupplier.confirmStatus === 'CONFIRMED') {
  throw new ConflictException({ error: '该供应商已确认开标记录，禁止覆盖唱标信息', code: 'RECORD_ALREADY_CONFIRMED' });
}
```

- [ ] **Step 4: 跑测试确认通过**
Run: `pnpm --filter api test -- bid.service.spec -t 'H11'`
Expected: PASS

- [ ] **Step 5: 补一条负向用例并回归**
新增负向：`confirmStatus:'PENDING'` 时允许录入（走 create/update，不抛错）。
Run: `pnpm --filter api test -- bid.service.spec`
Expected: 全绿

- [ ] **Step 6: Commit**
```bash
git branch --show-current
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(api): H11 禁止覆盖已确认的开标记录，防主持人单方改报价默认生效"
```

---

## Task 5: H6 — 异议处理无状态前置 + 无操作者留痕 + body 无校验

**Files:**
- Create: `apps/api/src/bid/dto/resolve-opening-dispute.dto.ts`
- Modify: `apps/api/src/bid/bid.controller.ts`（resolve-dispute 端点 ~175-181）
- Modify: `apps/api/src/bid/bid.service.ts`（`resolveOpeningDispute` ~1146-1193）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- `ResolveOpeningDisputeDto { result: string; confirm: boolean }`（class-validator）
- `resolveOpeningDispute(projectId, recordId, dto, actorId?)` 新增 actorId 参数

- [ ] **Step 1: 写失败测试**

```ts
describe('H6 — resolveOpeningDispute 状态前置 + 留痕', () => {
  it('记录非「供应商提出异议」状态时拒绝处理', async () => {
    prisma.bidOpeningRecord.findFirst = jest.fn().mockResolvedValue({ id:'r1', projectId:'p1', bidSupplierId:'s1', supplierName:'S', confirmStatus:'供应商已确认' });
    prisma.bidProject.findUnique = jest.fn().mockResolvedValue({ id:'p1', stage:'OPENING' });
    await expect(service.resolveOpeningDispute('p1','r1',{ result:'x', confirm:true },'u1')).rejects.toThrow(ConflictException);
  });

  it('处理异议态记录时写入 handledBy 与 AuditLog', async () => {
    prisma.bidOpeningRecord.findFirst = jest.fn().mockResolvedValue({ id:'r1', projectId:'p1', bidSupplierId:'s1', supplierName:'S', confirmStatus:'供应商提出异议' });
    prisma.bidProject.findUnique = jest.fn().mockResolvedValue({ id:'p1', stage:'OPENING' });
    prisma.bidOpeningRecord.update = jest.fn().mockResolvedValue({});
    prisma.bidSupplier.update = jest.fn().mockResolvedValue({});
    prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
    prisma.$transaction = jest.fn(async (cb) => cb(prisma));
    prisma.bidSupplier.findUnique = jest.fn().mockResolvedValue({ supplierId:'sp1' });
    prisma.bidOpeningRecord.findUnique = jest.fn().mockResolvedValue({ id:'r1' });

    await service.resolveOpeningDispute('p1','r1',{ result:'受理', confirm:true },'u1');
    expect(prisma.bidOpeningRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ handledBy: 'u1' }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
Run: `pnpm --filter api test -- bid.service.spec -t 'H6'`
Expected: FAIL —— 当前无状态前置（第一条不抛错）、update 无 handledBy、无 auditLog（第二条断言失败）。

- [ ] **Step 3: 新建 DTO**

`apps/api/src/bid/dto/resolve-opening-dispute.dto.ts`：
```ts
import { IsString, IsNotEmpty, IsBoolean } from 'class-validator';

/** 主持人处理开标异议：confirm=true 确认受理（供应商 CONFIRMED），false 退回异议（EXCEPTION）。 */
export class ResolveOpeningDisputeDto {
  @IsString()
  @IsNotEmpty()
  result: string;

  @IsBoolean()
  confirm: boolean;
}
```

- [ ] **Step 4: 改 controller**

Read `bid.controller.ts` 顶部 import 与 `@CurrentUser` 用法（参照其他注入 actor 的端点；装饰器在 `apps/api/src/common/decorators/current-user.decorator.ts`）。import `ResolveOpeningDisputeDto`，把 resolve-dispute 端点（~175-181）改为：
```ts
@Post('projects/:id/opening-records/:recordId/resolve-dispute')
@ApiOperation({ summary: '处理开标异议' })
resolveOpeningDispute(
  @Param('id') id: string,
  @Param('recordId') recordId: string,
  @Body() dto: ResolveOpeningDisputeDto,
  @CurrentUser() user: { sub: string },
) { return this.bidService.resolveOpeningDispute(id, recordId, dto, user?.sub); }
```
（`@CurrentUser()` 的实际 payload 字段名以仓库现有端点为准，Read 确认后适配。）

- [ ] **Step 5: 改 service**

`resolveOpeningDispute` 签名加 `actorId?: string`。在取到 record（~1147-1148）后加状态前置：
```ts
if (record.confirmStatus !== '供应商提出异议') {
  throw new ConflictException({ error: '仅可处理处于「供应商提出异议」状态的开标记录', code: 'NOT_IN_DISPUTE' });
}
```
事务内 record update（~1161-1164）补 `handledBy`：
```ts
data: { confirmStatus, handleResult: dto.result, handledAt: now, handledBy: actorId ?? null },
```
事务内（监督日志 create 之后）补 AuditLog：
```ts
if (actorId) {
  await tx.auditLog.create({
    data: { userId: actorId, action: 'BID_DISPUTE_RESOLVE', resourceType: `BidOpeningRecord:${recordId}`, details: { projectId, confirm: dto.confirm, result: dto.result } },
  });
}
```

- [ ] **Step 6: 跑测试确认通过**
Run: `pnpm --filter api test -- bid.service.spec -t 'H6'`
Expected: PASS

- [ ] **Step 7: 回归**
Run: `pnpm --filter api test -- bid.service.spec`
Expected: 全绿

- [ ] **Step 8: Commit**
```bash
git branch --show-current
git add apps/api/src/bid/dto/resolve-opening-dispute.dto.ts apps/api/src/bid/bid.controller.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(api): H6 异议处理加状态前置+handledBy/AuditLog 留痕+DTO 校验"
```

---

## Task 6: H4（后端）— startEvaluation 加开标完成度守卫

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`startEvaluation` 前置 ~680-683 之间）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- 终局态定义（与 :3007/:3005 `openingDone` 口径一致）：未撤回供应商满足 `decryptStatus==='DANGER'`（异常已定性）或 `decryptStatus==='SUCCESS' && confirmStatus∈{CONFIRMED,EXCEPTION}`（解密成功且确认闭环）。否则视为"未到终局态"，阻断启动评标（409，列明名单）。

- [ ] **Step 1: 写失败测试（仍有未解密供应商却能启动评标）**

```ts
describe('H4 — startEvaluation 开标完成度守卫', () => {
  it('存在未解密（PENDING）供应商时抛 409，不再永久切断该供应商', async () => {
    prisma.bidProject.findUnique = jest.fn().mockResolvedValue({ stage:'OPENING', name:'P' });
    prisma.bidExpert.count = jest.fn().mockResolvedValue(1);
    prisma.bidSupplier.count = jest.fn().mockResolvedValue(1); // ≥1 家 SUCCESS（满足旧前置）
    prisma.bidSupplier.findMany = jest.fn().mockResolvedValue([
      { supplierName:'A', decryptStatus:'SUCCESS', confirmStatus:'CONFIRMED' },
      { supplierName:'B', decryptStatus:'PENDING', confirmStatus:'PENDING' }, // 未解密
    ]);
    // scoreStandardValidator.assertScoreStandardComplete mock resolve
    await expect(service.startEvaluation('p1','u1')).rejects.toThrow(ConflictException);
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
Run: `pnpm --filter api test -- bid.service.spec -t 'H4'`
Expected: FAIL —— 当前仅要求 ≥1 家 SUCCESS，未阻断未解密供应商。

- [ ] **Step 3: 实现守卫**

在 `startEvaluation` 的 `evaluableSupplierCount` 校验（~675-680）之后、`assertScoreStandardComplete`（~683）之前插入：
```ts
// H4: 开标完成度守卫——未撤回供应商须全部到终局态，否则启动评标（不可逆，EVALUATING→OPENING 回退 409）
// 会永久切断仍未解密/未确认的供应商（OPENING-only 的解密/唱标/确认通道随阶段离开而关闭）。
const activeSuppliers = await this.prisma.bidSupplier.findMany({
  where: { projectId: id, submitStatus: { not: '已撤回' } },
  select: { supplierName: true, decryptStatus: true, confirmStatus: true },
});
const notReady = activeSuppliers.filter(s => {
  if (s.decryptStatus === 'DANGER') return false;                                  // 解密异常已定性
  if (s.decryptStatus !== 'SUCCESS') return true;                                  // PENDING/RUNNING 未解密
  return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';       // 解密成功但确认未闭环（PENDING/DISPUTED）
});
if (notReady.length > 0) {
  throw new ConflictException({
    error: `开标尚未完成，以下供应商未到终局态（解密/确认/异议未结）：${notReady.map(s => s.supplierName).join('、')}`,
    code: 'OPENING_NOT_DONE',
  });
}
```

- [ ] **Step 4: 跑测试确认通过**
Run: `pnpm --filter api test -- bid.service.spec -t 'H4'`
Expected: PASS

- [ ] **Step 5: 补负向用例并回归**
负向：所有供应商均终局态（SUCCESS+CONFIRMED / DANGER）→ 不抛 OPENING_NOT_DONE（继续后续流程，mock 到 update）。
Run: `pnpm --filter api test -- bid.service.spec`
Expected: 全绿（注意：既有 startEvaluation 用例需补 `bidSupplier.findMany` mock，返回全终局态以放行）。

- [ ] **Step 6: Commit**
```bash
git branch --show-current
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(api): H4 启动评标加开标完成度守卫，防永久切断未解密/未确认供应商"
```

---

## Task 7: H7 — 供应商可删已被投标文件引用的 FileAsset

**Files:**
- Modify: `apps/api/src/upload/upload.service.ts`（`delete` ~239-258）
- Test: `apps/api/src/upload/upload.service.spec.ts`

- [ ] **Step 1: 写失败测试（引用件仍可删）**

```ts
describe('H7 — upload.delete 引用检查', () => {
  it('文件已被 SupplierBidSubmission 引用时拒绝删除', async () => {
    prisma.fileAsset.findUnique = jest.fn().mockResolvedValue({ id:'a1', key:'k', uploaderId:'u1' });
    prisma.supplierBidSubmission.findFirst = jest.fn().mockResolvedValue({ id:'sub1' }); // 被引用
    await expect(service.delete('k', { sub:'u1', role:'supplier' })).rejects.toThrow(ConflictException);
    expect(minioClient.removeObject).not.toHaveBeenCalled();
  });
  it('未被引用时正常删除', async () => {
    prisma.fileAsset.findUnique = jest.fn().mockResolvedValue({ id:'a2', key:'k2', uploaderId:'u1' });
    prisma.supplierBidSubmission.findFirst = jest.fn().mockResolvedValue(null);
    prisma.fileAsset.delete = jest.fn().mockResolvedValue({});
    await expect(service.delete('k2', { sub:'u1', role:'supplier' })).resolves.toMatchObject({ deleted: true });
    expect(minioClient.removeObject).toHaveBeenCalled();
  });
});
```
（按 upload.service.spec.ts 现有 mock 适配 `prisma`/`minioClient` 的注入名；`ConflictException` 从 `@nestjs/common` import。）

- [ ] **Step 2: 跑测试确认失败**
Run: `pnpm --filter api test -- upload.service.spec -t 'H7'`
Expected: FAIL —— 当前无引用检查，第一条会调用 removeObject。

- [ ] **Step 3: 实现引用检查**

在 `delete` 的越权防护（~251）**之后**、`minioClient.removeObject`（~254）**之前**插入：
```ts
// H7: 已被投标文件引用的资产不可删除——防供应商截标后删件伪装技术故障 / 触发解密误判（H1 组合）
const submission = await this.prisma.supplierBidSubmission.findFirst({
  where: {
    OR: [
      { technicalFileAssetId: asset.id },
      { businessFileAssetId: asset.id },
      { coverLetterAssetId: asset.id },
      { bidBondAssetId: asset.id },
    ],
  },
  select: { id: true },
});
if (submission) {
  throw new ConflictException({ error: '该文件已被投标文件引用，不可删除', code: 'FILE_REFERENCED' });
}
```
（确认 `ConflictException` 已 import；`this.prisma.supplierBidSubmission` 可用——若 upload.service 的 PrismaService 未含该 model 访问，PrismaService 是全局单例，直接可用。）

- [ ] **Step 4: 跑测试确认通过**
Run: `pnpm --filter api test -- upload.service.spec -t 'H7'`
Expected: PASS

- [ ] **Step 5: 回归**
Run: `pnpm --filter api test -- upload.service.spec`
Expected: 全绿（既有删除用例补 `supplierBidSubmission.findFirst → null` mock）。

- [ ] **Step 6: Commit**
```bash
git branch --show-current
git add apps/api/src/upload/upload.service.ts apps/api/src/upload/upload.service.spec.ts
git commit -m "fix(api): H7 投标文件引用的 FileAsset 禁止删除，堵截标后删件伪装故障"
```

---

## Task 8: H3 — 删除公告裸重置 stage 不清理下游产物

**Files:**
- Modify: `apps/api/src/announcement/announcement.service.ts`（删除事务 `stageReset` 分支 ~255-267）
- Test: `apps/api/src/announcement/announcement.service.spec.ts`（不存在则新建）

**Interfaces:**
- `stageReset` 为真时，在同一事务内级联失效下游开标/评标产物：删 `BidOpeningSession`/`BidOpeningRecord`/`BidScoreRecord`/`BidEvaluationResult`/`BidInvalidBid`，复位 `BidSupplier`（decryptStatus→PENDING、confirmStatus→PENDING、bidValidity→null）与 `BidExpert`（reportConfirmed→false、reportConfirmedAt→null）。

- [ ] **Step 1: 确认模型名**
Run: `grep -nE "model (BidScoreRecord|BidOpeningRecord|BidOpeningSession|BidEvaluationResult|BidInvalidBid|BidSupplier|BidExpert) " apps/api/prisma/schema.prisma`
Expected: 列出各 model，确认 Prisma 客户端访问名（驼峰：`bidScoreRecord` 等）。下文按确认结果适配。

- [ ] **Step 2: 写失败测试**

```ts
describe('H3 — 删除公告级联清理下游产物', () => {
  it('项目原处 EVALUATING 时重置 stage 并清理 session/记录/评分/结果，复位供应商与专家', async () => {
    prisma.bidProject.findFirst = jest.fn().mockResolvedValue({ id:'p1', projectCode:'C1', stage:'EVALUATING', riskNote:'' });
    prisma.bidDocument = { updateMany: jest.fn().mockResolvedValue({}) };
    prisma.bidOpeningSession = { deleteMany: jest.fn().mockResolvedValue({}) };
    prisma.bidOpeningRecord = { deleteMany: jest.fn().mockResolvedValue({}) };
    prisma.bidScoreRecord = { deleteMany: jest.fn().mockResolvedValue({}) };
    prisma.bidEvaluationResult = { deleteMany: jest.fn().mockResolvedValue({}) };
    prisma.bidInvalidBid = { deleteMany: jest.fn().mockResolvedValue({}) };
    prisma.bidSupplier = { updateMany: jest.fn().mockResolvedValue({}) };
    prisma.bidExpert = { updateMany: jest.fn().mockResolvedValue({}) };
    prisma.bidSupervisionLog = { create: jest.fn().mockResolvedValue({}) };
    prisma.announcement = { delete: jest.fn().mockResolvedValue({}) };
    prisma.$transaction = jest.fn(async (cb) => cb(prisma));

    await service.remove('ann1'); // 方法名以实际为准（Read 确认）
    expect(prisma.bidOpeningSession.deleteMany).toHaveBeenCalledWith({ where: { projectId:'p1' } });
    expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId:'p1' }, data: expect.objectContaining({ decryptStatus:'PENDING', confirmStatus:'PENDING' }) }),
    );
    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reportConfirmed:false }) }),
    );
  });
  it('项目原处 DOWNLOAD（无需重置）时不做级联清理', async () => {
    prisma.bidProject.findFirst = jest.fn().mockResolvedValue({ id:'p1', projectCode:'C1', stage:'DOWNLOAD', riskNote:'' });
    // …同上 mock
    await service.remove('ann1');
    expect(prisma.bidOpeningSession.deleteMany).not.toHaveBeenCalled();
  });
});
```
（删除方法名/参数、`bidProject.findFirst` 的 where 字段按 announcement.service.ts 实际代码适配——Read ~230-280 确认。）

- [ ] **Step 3: 跑测试确认失败**
Run: `pnpm --filter api test -- announcement.service.spec -t 'H3'`
Expected: FAIL —— 当前无级联清理，deleteMany/updateMany 未被调用。

- [ ] **Step 4: 实现级联清理**

在 `stageReset` 分支的监督日志 create（~256-266）**之后**、`bidDocument.updateMany`（~268）之前插入（同事务 `tx`）：
```ts
// H3: 级联失效下游开标/评标产物——否则陈旧数据被棘轮跳步当作合法准入凭证
// （可直接用上一轮的专家/解密成功供应商/已发布评分标准/已确认报告"启动评标/生成结果"）。
await tx.bidOpeningSession.deleteMany({ where: { projectId: project.id } });
await tx.bidOpeningRecord.deleteMany({ where: { projectId: project.id } });
await tx.bidScoreRecord.deleteMany({ where: { projectId: project.id } });
await tx.bidEvaluationResult.deleteMany({ where: { projectId: project.id } });
await tx.bidInvalidBid.deleteMany({ where: { projectId: project.id } });
await tx.bidSupplier.updateMany({
  where: { projectId: project.id },
  data: { decryptStatus: 'PENDING', confirmStatus: 'PENDING', bidValidity: null },
});
await tx.bidExpert.updateMany({
  where: { projectId: project.id },
  data: { reportConfirmed: false, reportConfirmedAt: null },
});
```
（model 访问名按 Step1 确认结果；`decryptStatus/confirmStatus` 为枚举，Prisma updateMany data 接受字符串字面量。若 schema 中评分记录 model 名非 `BidScoreRecord`，按实际改。）

- [ ] **Step 5: 跑测试确认通过**
Run: `pnpm --filter api test -- announcement.service.spec -t 'H3'`
Expected: PASS

- [ ] **Step 6: 回归**
Run: `pnpm --filter api test -- announcement.service.spec`（及 `pnpm --filter api test -- bid.service.spec` 确保不波及）
Expected: 全绿

- [ ] **Step 7: Commit**
```bash
git branch --show-current
git add apps/api/src/announcement/announcement.service.ts apps/api/src/announcement/announcement.service.spec.ts
git commit -m "fix(api): H3 删除公告重置 stage 时级联清理开标/评标下游产物"
```

---

## Task 9: H4（前端 :3005）— 启动评标按钮按开标完成度把关

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm/evaluation-block.tsx`（启动评标横幅 ~284-296，handler ~211-222）

**Interfaces:**
- 复用 `opening-progress-block.tsx:65-77` 的 `openingDone` 计算口径（未撤回供应商：解密全 SUCCESS/DANGER + 解密成功者确认闭环 CONFIRMED/EXCEPTION + 无 DISPUTED）。从 `detail.suppliers` 计算。

- [ ] **Step 1: Read 现状确认 props**
Read `apps/web/src/components/projects/bid-confirm/evaluation-block.tsx` 1-60（Props/解构）与 `opening-progress-block.tsx:55-80`（openingDone 口径）。确认 evaluation-block 是否能拿到 `detail.suppliers`；若 Props 无 detail，从父级 `bid-confirm-panel.tsx` 传入（父级已有 detail）。

- [ ] **Step 2: 实现把关**

在组件内计算：
```tsx
const activeSuppliers = (detail?.suppliers ?? []).filter(s => s.submitStatus !== '已撤回');
const notReady = activeSuppliers.filter(s =>
  s.decryptStatus !== 'DANGER' &&
  (s.decryptStatus !== 'SUCCESS' || (s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION'))
);
const openingDone = activeSuppliers.length > 0 && notReady.length === 0;
```
启动评标按钮（~292）改为：
```tsx
<button
  type="button"
  onClick={() => void handleStartEvaluation()}
  disabled={busy || !openingDone}
  title={openingDone ? '' : `开标未完成：${notReady.map(s => s.supplierName).join('、')} 未到终局态`}
  className="neu-btn-primary !h-[32px] !text-xs shrink-0 disabled:opacity-40"
>
  <Play size={13} /> {busy ? '启动中…' : '启动评标'}
</button>
```
横幅文案（~290）在 `!openingDone` 时追加提示：
```tsx
{!openingDone && (
  <span className="text-[var(--warning)]">（开标未完成：{notReady.map(s => s.supplierName).join('、')} 待解密/确认，暂不能启动评标）</span>
)}
```
（后端 Task6 已加 OPENING_NOT_DONE 守卫；前端此为对齐 UX 的防御层，二者口径一致。）

- [ ] **Step 3: 类型检查**
Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无新增类型错误

- [ ] **Step 4: 构建**
Run: `pnpm --filter web build`
Expected: 构建通过（忽略 /login 预渲染既有失败）

- [ ] **Step 5: 人工核对清单**
- [ ] OPENING 阶段、存在未解密供应商时，「启动评标」按钮置灰且 hover 显示名单
- [ ] 全部供应商终局态时按钮可点
- [ ] 文案与后端口径一致（解密/确认/异议三态）

- [ ] **Step 6: Commit**
```bash
git branch --show-current
git add apps/web/src/components/projects/bid-confirm/evaluation-block.tsx
git commit -m "fix(web): H4 启动评标按开标完成度把关，未终局供应商置灰提示"
```

---

## Task 10: H5（前端 :3005）— 开标归档确认加"已知晓终止"摩擦

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm/archive-block.tsx`（确认对话框 ~216-258，进度块 ~234-251）

**Interfaces:**
- 开标未完成（`confirmed < total || danger > 0`）时，确认对话框内显示复选框「我已知晓开标尚未完成，确认终止流程」，未勾选则禁用「确认归档」按钮。开标已完成则无需勾选（不增加无谓摩擦）。流标/废标场景仍可归档（增强摩擦而非硬拦截）。

- [ ] **Step 1: Read 现状**
Read `apps/web/src/components/projects/bid-confirm/archive-block.tsx` 1-60（state 声明区）与 215-260（确认对话框）。确认现有 state 命名风格与 `setConfirmScope`/`doArchive`。

- [ ] **Step 2: 实现复选框摩擦**

在 state 区新增：
```tsx
const [ackTerminate, setAckTerminate] = useState(false);
```
在 `setConfirmScope(...)` 触发的两个按钮 onClick（~109、~114）里同时 `setAckTerminate(false)`（每次开框重置）。
进度块（~235-251）已计算 `total/decrypted/danger/confirmed`；把它提升为对话框作用域内可复用的常量（或在复选框处重算同样口径）：
```tsx
const incomplete = total > 0 && (confirmed < total || danger > 0);
```
在确认对话框「确认归档」按钮（~252-257）之前、进度块之后插入（仅 `confirmScope==='opening' && incomplete` 时）：
```tsx
{confirmScope === 'opening' && incomplete && (
  <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-[12px] px-3.5 py-2.5 text-xs leading-5" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)' }}>
    <input type="checkbox" checked={ackTerminate} onChange={e => setAckTerminate(e.target.checked)} className="mt-0.5" />
    <span className="text-[var(--foreground)]">我已知晓开标尚未完成（解密 {decrypted}/{total}{danger>0 && `，含 ${danger} 家异常`}、确认 {confirmed}/{total}），确认终止本项目流程。</span>
  </label>
)}
```
「确认归档」按钮加禁用条件：
```tsx
<button
  type="button"
  onClick={() => void doArchive(confirmScope)}
  disabled={confirmScope === 'opening' && incomplete && !ackTerminate}
  className="neu-btn-primary !h-[36px] !text-xs disabled:opacity-40"
>
  <Archive size={13} /> 确认归档
</button>
```

- [ ] **Step 3: 类型检查**
Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无新增类型错误

- [ ] **Step 4: 构建**
Run: `pnpm --filter web build`
Expected: 构建通过（忽略 /login 既有失败）

- [ ] **Step 5: 人工核对清单**
- [ ] 开标未完成时，「开标归档」确认框出现复选框，未勾选「确认归档」置灰
- [ ] 勾选后「确认归档」可点（流标/废标仍可归档）
- [ ] 开标已完成（confirmed===total 且 danger===0）时不出现复选框，直接可归档
- [ ] 每次重新打开确认框复选框重置为未勾选

- [ ] **Step 6: Commit**
```bash
git branch --show-current
git add apps/web/src/components/projects/bid-confirm/archive-block.tsx
git commit -m "fix(web): H5 开标归档确认加已知晓终止复选框，防开标进行中误终局"
```

---

## 完成校验（全部任务后）

- [ ] `pnpm --filter api test` 全绿（整个 api 单测套件）
- [ ] `pnpm --filter web exec tsc --noEmit` 无错误
- [ ] `git log --oneline -12` 确认 10 个 fix commit 依序在 `feat/bid-opening-hall-impl`
- [ ] 在 `docs/superpowers/audit/2026-07-25-bid-flow-audit-fixlist.md` 的 Wave A 各项标注「已修复 + commit sha」（沿用既有 fixlist 的进度标注惯例）
- [ ] **不 push**，仅提醒用户有未推送提交（遵 MEMORY「不要主动 push」）

## 后续波次（本计划不含，另行起计划）

- **Wave B**（安全/权限）：H10 明文对象永久留存、M8 跨项目读 PUBLIC 消息、M9 WS CORS 反射、M10 敏感端点最小权限（需先决策 leader/staff 语义）、M11/M12 自报身份留痕。
- **Wave C**（一致性/实时健壮性）：H8/H9 解密静默+断连不可见、M1/M2/M3 并发重复记录/幂等/事务内 I/O、M18-M27 前后端三态/数据源/刷新。
- **Wave D**（评标完整性/体验）：M13-M17 及其余 Low 项。
