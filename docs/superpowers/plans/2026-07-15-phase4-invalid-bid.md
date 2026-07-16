# Phase ④ 无效投标实时流转 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 资格/符合性审查不通过票过半 → 实时标记供应商"无效投标"（废标），停止后续打分、排除排名、WS 广播置灰；锁定前可复核撤销。

**Architecture:** 新建 `BidInvalidBid`（决议记录）+ `BidSupplier.bidValidity`（冗余状态）。抽 `evaluateInvalidBid(projectId, supplierId, scoreItemId)` 从现有 `generateEvaluationResults` 内联废标逻辑（过半制）。`submitScores` **事务提交后**对涉及的通过性 items 实时触发 → 写 `BidInvalidBid` + 置 `bidValidity=invalid` + WS `bid:validity:change`。revoke 端点（reportConfirmed 前）。`generateEvaluationResults` 的 activeSuppliers 过滤加 `bidValidity!=='invalid'`。

**Tech Stack:** NestJS 11 + Prisma；Socket.IO（bid.gateway）；Next.js 16；Jest。

## Global Constraints

- 工作目录 `water-erp/`。
- **分数不进 WS**（bid-events.ts:7 铁律）。`bid:validity:change` payload 只含 `supplierId + failCount + totalCount + status + timestamp`，**无 score/passed/supplierName**。
- **决策 B（实时，接受跳变）**：状态随每票变化（spec §5.1）；UI 显示"废标判定中 X/Y 票"区分暂定；`reportConfirmed` 后凝固。
- **决策 D（可逆）**：reportConfirmed 前 bid_host/admin 可 revoke；之后不可逆。
- active-supplier 定义复用现有（`decryptStatus=SUCCESS && submitStatus!=已撤回 && confirmStatus=CONFIRMED`，bid.service.ts:1103）。
- 实时触发在**事务外**（submitScores 已提交后），避免长事务/放大锁。
- commit：中文 conventional + 空行 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- DB drift（OperationLog）：migration 用 surgical `migrate diff + db execute + migrate resolve`（见 memory）。

## 现状锚点（已核实）

- `generateEvaluationResults`（bid.service.ts:1090）：activeSuppliers :1103；废标判定内联 :1144-1181（过半 `agg.fail > agg.total - agg.fail` :1171）；排序 :1207；BidEvaluationResult 写入 :1214-1229（disqualified 字段）。手动端点 bid.controller.ts:162。
- `BidSupplier`（schema.prisma:288）：**无 bidValidity**。加在 confirmStatus 后。
- `submitScores`（expert.service.ts:741）：事务结束 :1001；WS 区 :1003-1010；itemMeta（含 category）:795；supplierIds 去重 :797。
- `bid-events.ts`：BID_EVENT :12-25；铁律 :7；ExpertPresencePayload :59。
- `bid.gateway.ts`：notifyExpertPresence（host room）:140；broadcastAggregatePresence（project room）:146；notifySupervisionLog :165；room 路由 :82。
- 专家端：use-expert-websocket.ts Handlers :14、bind :35；evaluate page onDecryptStatus :84、canScoreActiveSupplier :485、SupplierSidebar 调用 :804；supplier-sidebar.tsx 回避徽章 :107。
- `BidInvalidBid` 确认不存在。

## File Structure

| 文件 | 责任 |
|------|------|
| `apps/api/prisma/schema.prisma` | `BidInvalidBid` 模型 + `BidSupplier.bidValidity` + relations |
| `apps/api/src/bid/bid.service.ts` | 抽 `evaluateInvalidBid`；`generateEvaluationResults` 复用+过滤；revoke |
| `apps/api/src/bid/bid.controller.ts` | revoke 端点 |
| `apps/api/src/expert/expert.service.ts` | submitScores 事务后实时触发 |
| `apps/api/src/bid/bid.gateway.ts` | `notifyBidValidity`（project room）|
| `packages/shared/src/bid-events.ts` | `BID_VALIDITY_CHANGE` + `BidValidityChangePayload` |
| `apps/api/src/bid/bid.service.spec.ts` | evaluateInvalidBid / revoke 测试 |
| `apps/expert-portal/src/hooks/use-expert-websocket.ts` | onBidValidityChange |
| `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` | invalidSupplierIds 置灰 |
| `apps/expert-portal/src/components/evaluate/supplier-sidebar.tsx` | 废标徽章 |

---

### Task 1: `BidInvalidBid` 模型 + `BidSupplier.bidValidity` + migration

**Files:** `schema.prisma`

- [ ] **Step 1: BidSupplier 加** `bidValidity String @default("valid")`（confirmStatus 后，~:298）。加 `invalidBids BidInvalidBid[]` relation。
- [ ] **Step 2: BidProject / BidScoreItem 加** `invalidBids BidInvalidBid[]`。
- [ ] **Step 3: 新模型**（BidEvaluationResult 后，~:571）：
```prisma
model BidInvalidBid {
  id          String    @id @default(cuid())
  projectId   String
  supplierId  String
  scoreItemId String
  failCount   Int
  totalCount  Int
  status      String    @default("invalid")   // "invalid" | "revoked"
  decidedAt   DateTime  @default(now())
  revokedAt   DateTime?
  revokedBy   String?
  project     BidProject  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier    BidSupplier  @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  scoreItem   BidScoreItem @relation(fields: [scoreItemId], references: [id], onDelete: Cascade)
  @@unique([projectId, supplierId, scoreItemId])
  @@index([projectId, supplierId])
}
```
- [ ] **Step 4: migration**（surgical 若 DB drift）。
- [ ] **Step 5: 验证 + Commit** `feat(db): 新增 BidInvalidBid + BidSupplier.bidValidity` + trailer。

---

### Task 2: 抽 `evaluateInvalidBid` 函数（TDD）

**Files:** 新建 `apps/api/src/bid/evaluate-invalid-bid.helper.ts` + `.spec.ts`

**Interfaces:** Produces `evaluateInvalidBid(prisma, projectId, supplierId, scoreItemId): Promise<{disqualified, failCount, totalCount}>`。

- [ ] **Step 1: 写失败测试**：
```ts
import { evaluateInvalidBid } from './evaluate-invalid-bid.helper';
describe('evaluateInvalidBid', () => {
  it('不通过票严格过半 → disqualified', async () => {
    const prisma: any = { bidScoreRecord: { findMany: jest.fn().mockResolvedValue([
      { passed: false }, { passed: false }, { passed: true },  // 2/3 不通过 → 过半
    ]) }};
    const r = await evaluateInvalidBid(prisma, 'p1', 'sup1', 'si1');
    expect(r).toEqual({ disqualified: true, failCount: 2, totalCount: 3 });
  });
  it('不过半 → 不废标', async () => {
    const prisma: any = { bidScoreRecord: { findMany: jest.fn().mockResolvedValue([
      { passed: false }, { passed: true }, { passed: true },  // 1/3 → 不过半
    ]) }};
    expect((await evaluateInvalidBid(prisma, 'p1', 'sup1', 'si1')).disqualified).toBe(false);
  });
  it('无 passed 的记录忽略', async () => {
    const prisma: any = { bidScoreRecord: { findMany: jest.fn().mockResolvedValue([
      { passed: null }, { passed: false }, { passed: true },  // 1/2 有效 → 不过半
    ]) }};
    const r = await evaluateInvalidBid(prisma, 'p1', 'sup1', 'si1');
    expect(r.totalCount).toBe(2);
  });
});
```
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**：
```ts
export async function evaluateInvalidBid(
  prisma: { bidScoreRecord: { findMany: (a: any) => Promise<any[]> } },
  projectId: string, supplierId: string, scoreItemId: string,
): Promise<{ disqualified: boolean; failCount: number; totalCount: number }> {
  const records = await prisma.bidScoreRecord.findMany({
    where: { scoreItemId, supplierId, scoreItem: { projectId } },
    select: { passed: true },
  });
  let fail = 0, total = 0;
  for (const r of records) {
    if (r.passed === null || r.passed === undefined) continue;
    total += 1;
    if (r.passed === false) fail += 1;
  }
  return { disqualified: total > 0 && fail > total - fail, failCount: fail, totalCount: total };
}
```
- [ ] **Step 4: 运行确认通过** + tsc clean。
- [ ] **Step 5: Commit** `feat(api): 抽 evaluateInvalidBid 过半判定函数` + trailer。

---

### Task 3: submitScores 事务后实时触发（TDD）

**Files:** `expert.service.ts`（事务后 :1002）；`expert.service.spec.ts`

**Interfaces:** Consumes Task 1 + 2。在 submitScores 事务提交后，对涉及的通过性 items 调 evaluateInvalidBid，过半则写 BidInvalidBid + bidValidity=invalid + WS。

- [ ] **Step 1: spec mock 加** `bidInvalidBid: { upsert: jest.fn().mockResolvedValue({}) }`，bidSupplier.update mock（已有）。
- [ ] **Step 2: 写失败测试**：
```ts
it('submitScores：通过性项过半不通过 → 写 BidInvalidBid + bidValidity=invalid', async () => {
  // 已有 2 专家判 sup1 的 si1(QUALIFICATION) 不通过，本专家(第3)也判不通过 → 3/3 过半
  prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp3', expertName: '王' });
  prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 0, category: 'QUALIFICATION' }]);
  prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted', confirmStatus: 'CONFIRMED' }]);
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
  prisma.bidScoreRecord.upsert.mockResolvedValue({});
  prisma.bidScoreRecord.findMany.mockImplementation((a: any) =>
    a.where?.scoreItemId === 'si1' ? Promise.resolve([{ passed: false }, { passed: false }, { passed: false }]) : Promise.resolve([{ score: 0 }]));
  prisma.bidScoreRecord.count.mockResolvedValue(1);
  prisma.bidInvalidBid.upsert.mockResolvedValue({});
  const gateway = { notifyExpertPresence: jest.fn(), broadcastAggregatePresence: jest.fn(), notifyBidValidity: jest.fn() };
  // 注入 gateway（看 service 构造）

  await service.submitScores('user3', 'p1', { supplierName: '甲', scores: [{ scoreItemId: 'si1', supplierId: 'sup1', passed: false, reason: '不符' }] } as any);

  expect(prisma.bidInvalidBid.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ projectId: 'p1', supplierId: 'sup1', scoreItemId: 'si1', status: 'invalid' }),
  }));
  expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sup1' }, data: { bidValidity: 'invalid' } }));
});
```
- [ ] **Step 3: 运行确认失败**。
- [ ] **Step 4: 实现**（expert.service.ts，事务后 `:1002`、WS 前）。import `evaluateInvalidBid`。：
```ts
    // phase ④：实时废标判定（事务已提交，数据可读；放事务外避免长事务）
    try {
      const passFailTouched = dto.scores.filter(s => {
        const m = itemMeta.get(s.scoreItemId);
        return m && (m.category === 'QUALIFICATION' || m.category === 'RESPONSIVE');
      });
      for (const s of Array.from(new Set(passFailTouched.map(x => x.supplierId)))) {
        const items = passFailTouched.filter(x => x.supplierId === s).map(x => x.scoreItemId);
        for (const itemId of Array.from(new Set(items))) {
          const verdict = await evaluateInvalidBid(this.prisma, projectId, s, itemId);
          if (verdict.disqualified) {
            await this.prisma.bidInvalidBid.upsert({
              where: { projectId_supplierId_scoreItemId: { projectId, supplierId: s, scoreItemId: itemId } },
              update: { failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'invalid', revokedAt: null, revokedBy: null },
              create: { projectId, supplierId: s, scoreItemId: itemId, failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'invalid' },
            });
            await this.prisma.bidSupplier.update({ where: { id: s }, data: { bidValidity: 'invalid' } });
            this.gateway?.notifyBidValidity?.(projectId, { supplierId: s, failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'invalid' });
          } else {
            // 不过半：若之前 invalid 现恢复（票数变化，决策 B 接受跳变）
            const existing = await this.prisma.bidInvalidBid.findUnique({ where: { projectId_supplierId_scoreItemId: { projectId, supplierId: s, scoreItemId: itemId } } });
            if (existing?.status === 'invalid') {
              await this.prisma.bidInvalidBid.update({ where: { id: existing.id }, data: { status: 'revoked', revokedAt: new Date() } });
              await this.prisma.bidSupplier.update({ where: { id: s }, data: { bidValidity: 'valid' } });
              this.gateway?.notifyBidValidity?.(projectId, { supplierId: s, failCount: verdict.failCount, totalCount: verdict.totalCount, status: 'revoked' });
            }
          }
        }
      }
    } catch (e) { /* 实时废标不阻塞评分主流程 */ }
```
- [ ] **Step 5: 运行确认通过** + tsc clean。
- [ ] **Step 6: Commit** `feat(api): submitScores 后实时废标判定 + WS 广播` + trailer。

---

### Task 4: WS `bid:validity:change`

**Files:** `packages/shared/src/bid-events.ts`；`apps/api/src/bid/bid.gateway.ts`

- [ ] **Step 1: bid-events.ts** 加 `BID_VALIDITY_CHANGE: 'bid:validity:change'`（:24 后）+ payload：
```ts
export interface BidValidityChangePayload {
  supplierId: string;
  failCount: number;
  totalCount: number;
  status: 'invalid' | 'revoked';
  timestamp: number;
}
```
（**无 score/passed/supplierName**，守 :7 铁律）
- [ ] **Step 2: bid.gateway.ts** import payload + 加 `notifyBidValidity`（:161 后）：
```ts
notifyBidValidity(projectId: string, data: Omit<BidValidityChangePayload, 'timestamp'>) {
  this.server.to(`project:${projectId}`).emit(BID_EVENT.BID_VALIDITY_CHANGE, { ...data, timestamp: Date.now() });
}
```
（**project room**，专家端要收）
- [ ] **Step 3: build shared + tsc** `pnpm --filter @water-erp/shared build && pnpm --filter api exec tsc --noEmit`。
- [ ] **Step 4: Commit** `feat(ws): bid:validity:change 事件（不含分数）` + trailer。

---

### Task 5: revoke 端点（TDD）

**Files:** `bid.service.ts`（revokeInvalidBid）；`bid.controller.ts`；`bid.service.spec.ts`

- [ ] **Step 1: 写失败测试**：
```ts
describe('revokeInvalidBid', () => {
  it('invalid→revoked + bidValidity=valid + WS', async () => {
    prisma.bidInvalidBid.findUnique.mockResolvedValue({ id: 'ib1', projectId: 'p1', supplierId: 'sup1', status: 'invalid' });
    prisma.bidInvalidBid.update.mockResolvedValue({ id: 'ib1', status: 'revoked' });
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp1', reportConfirmed: false }); // 未锁定
    await service.revokeInvalidBid('p1', 'sup1', 'si1', 'admin1');
    expect(prisma.bidInvalidBid.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'revoked', revokedAt: expect.any(Date), revokedBy: 'admin1' } }));
    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({ data: { bidValidity: 'valid' } }));
  });
  it('reportConfirmed 后 → 不可撤销', async () => {
    // 任一专家 reportConfirmed=true → 拒绝
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp1', reportConfirmed: true });
    await expect(service.revokeInvalidBid('p1', 'sup1', 'si1', 'admin1')).rejects.toMatchObject({ response: { code: 'LOCKED' } });
  });
});
```
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**：
```ts
async revokeInvalidBid(projectId: string, supplierId: string, scoreItemId: string, actorId: string) {
  // 锁定检查：任一专家 reportConfirmed 即不可撤销（决策 D）
  const anyConfirmed = await this.prisma.bidExpert.findFirst({ where: { projectId, reportConfirmed: true } });
  if (anyConfirmed) throw new BadRequestException({ error: '已有专家确认评审报告，废标不可撤销', code: 'LOCKED' });
  const rec = await this.prisma.bidInvalidBid.findUnique({ where: { projectId_supplierId_scoreItemId: { projectId, supplierId, scoreItemId } } });
  if (!rec || rec.status === 'revoked') throw new BadRequestException({ error: '无有效废标记录', code: 'NOT_FOUND' });
  await this.prisma.bidInvalidBid.update({ where: { id: rec.id }, data: { status: 'revoked', revokedAt: new Date(), revokedBy: actorId } });
  await this.prisma.bidSupplier.update({ where: { id: supplierId }, data: { bidValidity: 'valid' } });
  this.gateway?.notifyBidValidity?.(projectId, { supplierId, failCount: rec.failCount, totalCount: rec.totalCount, status: 'revoked' });
  await this.prisma.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '管理员', target: supplierId, action: '复核撤销废标', result: '恢复有效', riskFlag: '中' } });
  return { revoked: true };
}
```
- [ ] **Step 4: controller 端点** `POST projects/:id/suppliers/:supplierId/invalid-bid/revoke`（bid.controller.ts，@CurrentUser('sub')）。
- [ ] **Step 5: 运行确认通过** + tsc clean。
- [ ] **Step 6: Commit** `feat(api): 废标复核撤销端点（锁定前可逆）` + trailer。

---

### Task 6: `generateEvaluationResults` 过滤 + 复用

**Files:** `bid.service.ts`（:1103 activeSuppliers + :1144-1181 内联废标）

- [ ] **Step 1: activeSuppliers 过滤加 bidValidity**（:1103）：
```ts
const activeSuppliers = project.suppliers.filter(
  s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.confirmStatus === 'CONFIRMED' && s.bidValidity !== 'invalid',
);
```
- [ ] **Step 2: 内联废标判定（:1144-1181）替换为 evaluateInvalidBid 调用**（双保险：即使实时未触发，最终生成结果时再判一次）。或保留内联作 fallback（简化：保留内联，加 bidValidity 过滤即可，因为实时已处理大部分）。
> 决策：**最小改动**——只加 `bidValidity !== 'invalid'` 过滤（:1103），内联废标判定保留（兜底，且 generateEvaluationResults 是终态生成）。spec §5.2 说"排除排名"，过滤即达成。
- [ ] **Step 3: 测试**——现有 generateEvaluationResults 废标测试（bid.service.spec.ts:584）确认 bidValidity=invalid 的供应商被排除。若现有测试 mock 的 supplier 无 bidValidity（默认 valid），回归通过。
- [ ] **Step 4: tsc clean。Step 5: Commit** `feat(api): generateEvaluationResults 排除已废标供应商` + trailer。

---

### Task 7: 专家端 UI（置灰 + 废标徽章）

**Files:** `use-expert-websocket.ts`；`evaluate/[id]/page.tsx`；`supplier-sidebar.tsx`

- [ ] **Step 1: use-expert-websocket.ts** —— Handlers 加 `onBidValidityChange?`；bind 加 `on(BID_EVENT.BID_VALIDITY_CHANGE, ...)`；import BidValidityChangePayload。
- [ ] **Step 2: evaluate page** —— state `invalidSupplierIds: Set<string>`；onBidValidityChange handler（invalid→add，revoked→remove，pushLiveEvent）；传给 SupplierSidebar；`canScoreActiveSupplier` 加 `&& !invalidSupplierIds.has(activeSupplier)`（:485）。
- [ ] **Step 3: supplier-sidebar.tsx** —— Props 加 `invalidSupplierIds?`；废标供应商显示「废标」灰底徽章（参考 :107 回避徽章）+ `opacity-50`；onSelect 允许查看（不禁选中，但 scoring step 禁打分）。
- [ ] **Step 4: tsc clean**（expert-portal）。手动验证（controller/human）。
- [ ] **Step 5: Commit** `feat(expert-portal): 废标供应商实时置灰 + 徽章` + trailer。

---

## Self-Review 结论

- **Spec 覆盖**：§5.1 实时过半制 → Task 2/3；§5.2 流转（排除/置灰/审计/WS）→ Task 3/6/7；§5.3 可逆（revoke，锁定前）→ Task 5；§5.4 复用 evaluateInvalidBid → Task 2/6。✅
- **决策**：B 实时跳变（Task 3 else 分支恢复 valid + WS revoked）；D 锁定前可逆（Task 5 anyConfirmed gate）；铁律守（Task 4 payload 无分）。
- **跳变处理**：Task 3 的 else 分支处理"之前 invalid，新票不过半→恢复"，符合决策 B（接受跳变，每票重判）。
- **generateEvaluationResults 最小改动**（Task 6 只加过滤，保留内联兜底）——避免大重构，实时判定（Task 3）已处理主要场景，终态生成时过滤排除。
- **行号锚点**基于 phase ②③ 后调研；SDD implementer 按实际确认。
