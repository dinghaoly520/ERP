# P1 波3（开标闸门 + 保证金台账批）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地审计报告《附录A功能检测对照报告-投标开标评标-2026-08-28》§P1 剩余项中「开标端收口 + 保证金接收核」4 件：A-109（签到不足 3 家禁止进入解密 + force 旁路收紧）、A-111（解密成功时间列）、A-102（保证金到账台账）、A-104（保证金自动符合性校验）。（A-105 逐家退还经 2026-09-01 评审挪波4，见范围外。）

**Architecture:** 一次 schema 迁移（BidSupplier 增 `decryptedAt` 列 + 新 `BidBondLedger` 台账模型）承载全部数据面；A-109 签到 quorum 以共享 util 落在四个解密入口；保证金链 = 台账登记（:3007 大厅）→ 唱标预填自动比对 → 评标软标记。改动全部落在开标现场阶段（OPENING）：:3007 + API，不涉 :3005/web。

**Tech Stack:** NestJS 11 + Prisma（手写迁移三步）/ packages/shared 纯函数（比对引擎，:3007 复用）/ Next.js 16（:3007 bid-portal cgzxui）。

**Spec:** 无独立 spec——设计即审计报告 §P1 表对应行（`docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md` §五）+ 本计划内嵌决策。冲突时以审计报告补齐思路列为准。

**范围外（波4 候选，本计划一概不碰）：** **A-105 逐家退还+定标联动（2026-09-01 评审挪波4「评标后收尾批」——退还发生在中标后（实施条例第 57 条：合同签订后 5 日内向中标人和未中标人退还），属 :3005 收尾/合同域，与本波开标现场主题错配，砍出零星级代价（★★ 项不卡一星）；波4 迁移搭车加 `BidSupplier.bondReturnedAt/bondReturnReason` 两列；现状维持项目级 bond-return 端点+日历提醒的 🟡 部分符合）**、A-129 行政区域/等级、A-130 外部专家库接口（拟并入公共服务平台对接专项）、A-132 评委职责分工、A-151 报告正文编辑、A-152 评委 CA 签署、A-87 招标文件要求解析、A-89 新轨版式转换；P2 项 A-106 签到校验已提交、A-107/A-110 解密窗口与 openTime 强绑定。

## Global Constraints

- **schema.prisma 高危共享**（并行会话约定）：开工前 `git status` 确认工作区干净；全部 schema 改动集中在 Task 1 一次提交，改后提交前必须 `cd apps/api && npx prisma validate`；迁移走非交互三步（`migrate dev --create-only` → 若因存量 4 处刻意偏离触发 reset 提示则**手写同构 SQL** → `prisma db execute --file` → `migrate resolve --applied`）→ `prisma generate` → `migrate status` 确认 applied。共享 dev DB **永不** `migrate reset`。先例：`migrations/20260831111301_opening_confirm_signature/migration.sql`（波2 即手写路线）。
- **packages/shared 改动后必须重建**：`pnpm --filter @water-erp/shared build`（消费方走 dist；忘记 build → 前端拿旧类型假报错）。
- **whitelist 剥落**：全局 `ValidationPipe({ whitelist: true })` 会静默剥落无装饰器字段——新 DTO 每字段必有装饰器。
- **监督日志 riskFlag 取值统一 `'高风险'` / `'无'`**（库内存在历史 `'高'` 变体，新代码勿再引入）。
- **API 构建从 workspace 根**：`pnpm --filter api build`；每任务验证 `pnpm --filter api test -- <spec>` + `pnpm --filter api lint`；前端 `pnpm --filter <app> exec tsc --noEmit`。
- **提交纪律**：每任务一提交、只 add 明确文件路径（禁 `git add -A`）、不 push；提交信息前缀 `feat(p1-wave3):` / `fix(p1-wave3):` / `test(p1-wave3):`。
- **curl/浏览器调试 API 必带 `X-Portal` 头**（:3007=`bid`、:3005=`web`），否则 portal 识别回退旧 `token` cookie → 401 假象。

---

### Task 1: Schema 迁移——decryptedAt + BidBondLedger 台账模型

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`BidSupplier` 模型 :410-443；`BidProject` 模型 :313 起的反向关系数组区；文件末尾新模型）
- Create: `apps/api/prisma/migrations/<timestamp>_wave3_decrypt_time_bond_ledger/migration.sql`

**Interfaces:**
- Produces: `BidSupplier.decryptedAt DateTime?`（Task 2/3 消费）、`BidBondLedger` 模型（Task 6/7 消费，唯一键 `projectId+supplierName`）。

- [ ] **Step 1: schema 编辑**——`BidSupplier` 的 `dangerAttribution String?`（:439）之后插入：

```prisma
  decryptedAt DateTime?     // A-111：解密成功时间（终局事务写入；重置解密时清空）
```

`BidProject` 既有反向关系数组区（与 `bidSuppliers BidSupplier[]` 同区）追加一行：

```prisma
  bondLedgers BidBondLedger[]
```

schema 末尾（`PriceHistory` 模型附近，风格参照 `PriceHistory` schema:2293-2303）新增：

```prisma
/// A-102：保证金到账台账（资金级登记——缴纳人/金额/到账时间/收款账户/支付形式；一家一条幂等）
model BidBondLedger {
  id           String    @id @default(cuid())
  projectId    String
  project      BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplierName String    // 与 BidSupplier.supplierName 同口径（名册自然键）
  amount       Decimal   @db.Decimal(14, 2)
  arrivedAt    DateTime  // 银行到账时间
  account      String    // 收款账户（户名/尾号）
  payMethod    String    // 支付形式：转账/保函/支票/其他
  note         String?
  createdBy    String?
  createdAt    DateTime  @default(now())

  @@unique([projectId, supplierName])
  @@index([projectId, arrivedAt])
}
```

- [ ] **Step 2: 校验 + 迁移**：

```bash
cd apps/api && npx prisma validate
npx prisma migrate dev --create-only --name wave3_decrypt_time_bond_ledger
# 审阅生成 SQL：应为 BidSupplier 一列 ALTER + BidBondLedger 建表/索引/外键。
# 若因存量刻意偏离触发 reset 提示而中止（波2 同款场景）→ 手写同构 SQL：
```

手写 SQL（若需手写，内容如下）：

```sql
-- P1 波3 Task1：A-111 解密时间列 + A-102 保证金到账台账
ALTER TABLE "BidSupplier" ADD COLUMN "decryptedAt" TIMESTAMP(3);
CREATE TABLE "BidBondLedger" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "account" TEXT NOT NULL,
    "payMethod" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidBondLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BidBondLedger_projectId_supplierName_key" ON "BidBondLedger"("projectId", "supplierName");
CREATE INDEX "BidBondLedger_projectId_arrivedAt_idx" ON "BidBondLedger"("projectId", "arrivedAt");
ALTER TABLE "BidBondLedger" ADD CONSTRAINT "BidBondLedger_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

```bash
npx prisma db execute --file prisma/migrations/<目录>/migration.sql
npx prisma migrate resolve --applied <目录名>
npx prisma generate
npx prisma migrate status   # 确认本次 applied、无新增 drift
```

- [ ] **Step 3: 提交**：

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/<目录>/
git commit -m "feat(p1-wave3): schema——BidSupplier 增 decryptedAt + BidBondLedger 保证金到账台账模型（A-111/A-102）"
```

---

### Task 2: A-111 后端——解密终局写 decryptedAt + 重置清理 + 文件包携带

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（:2926-2934 旧轨终局事务；:1102-1108 文件包 select；:3093-3097/:3341-3344/:3450 三处重置）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（:2033 新轨终局；:1685-1689 补传重置）
- Modify: `packages/shared/src/types.ts`（:101-102 附近）
- Test: `apps/api/src/bid/bid.service.spec.ts`、`apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（扩既有用例）

**Interfaces:**
- Produces: `BidSupplier.decryptedAt`（SUCCESS 终局事务写入；一切重置 PENDING 的路径清空）；`getProject` 载荷 suppliers 行自动含 `decryptedAt`（include 全量，无需改 select）；开标文件包供应商行含 `decryptedAt`。

**背景事实**：全库仅 2 处把 `decryptStatus` 写 `SUCCESS`——旧轨主持端 `bid.service.ts decryptSupplier` :2926-2934、新轨供应商自解 `supplier-portal.service.ts decryptUpload` :2033。外层解密（`decryptOuterOne`）**不算** SUCCESS，不写本列。重置 PENDING 的路径共 4 处。

- [ ] **Step 1: 终局写入**——

`bid.service.ts` :2933（`decryptSupplier` SUCCESS 分支）：

```ts
await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'SUCCESS', decryptedAt: new Date() } });
```

`supplier-portal.service.ts` :2033（`decryptUpload` 终局事务，复用事务内已有的时间变量或 `new Date()`）：

```ts
await tx.bidSupplier.update({ where: { id: bidSupplier.id }, data: { decryptStatus: 'SUCCESS', decryptedAt: new Date() } });
```

- [ ] **Step 2: 四处重置清理**（凡把 `decryptStatus` 置回 `'PENDING'` 的 data 对象，追加 `decryptedAt: null`）：
  - `bid.service.ts` `adjudicateDecryptFault` RESET_PENDING 分支（:3093-3097）
  - `bid.service.ts` `reuploadBidFile` 管理员补传重置（:3341-3344）
  - `bid.service.ts` `resealBidFiles` 重新封标重置（:3450）
  - `supplier-portal.service.ts` `reuploadDualEnvelope` 供应商补传重置（:1685-1689，data 内已有 `decryptStatus: 'PENDING', decryptError: null`）

- [ ] **Step 3: 文件包携带**——`buildHandoverPackage` 供应商行 select（:1102-1108）加 `decryptedAt: true`（`rest` 解构入包，无需改组装；指纹随之覆盖新字段，历史包不受影响）。

- [ ] **Step 4: shared 类型**——`packages/shared/src/types.ts` `BidSupplier` 的 `outerDecryptedAt`（:101-102）旁追加：

```ts
  decryptedAt?: string | null; // A-111：解密成功时间（BidSupplier 列，SUCCESS 终局事务写入）
```

然后 `pnpm --filter @water-erp/shared build`。

- [ ] **Step 5: 测试**——扩既有用例（勿新开 describe）：
  - `bid.service.spec.ts`：`decryptSupplier` SUCCESS 路径既有用例的 update 断言追加 `decryptedAt: expect.any(Date)`；`reuploadBidFile`/`resealBidFiles`/`adjudicateDecryptFault` RESET 用例（如无则挑最近的一个重置用例）断言 data 含 `decryptedAt: null`。
  - `supplier-portal.service.spec.ts`：`decryptUpload` 成功用例断言 `decryptedAt: expect.any(Date)`；`reuploadDualEnvelope` 重置用例（:1981-2223 区域）断言 `decryptedAt: null`。

- [ ] **Step 6: 验证 + 提交**：`pnpm --filter api test -- bid.service supplier-portal.service` 绿 + lint 绿。

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/supplier-portal/supplier-portal.service.ts packages/shared/src/types.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(p1-wave3): A-111 解密成功时间——两处 SUCCESS 终局事务写 decryptedAt + 四处重置清理 + 开标文件包携带 + shared 类型"
```

---

### Task 3: A-111 前端——:3007 解密表「解密时间」列

**Files:**
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（表头 :785-793；行单元格 :850-860 之后）

**Interfaces:**
- Consumes: `s.decryptedAt`（`getProject` suppliers 行，Task 2 后自动下发）。

- [ ] **Step 1: 表头**——:790「解密状态」`<th>` 之后插入：

```tsx
<th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">解密时间</th>
```

- [ ] **Step 2: 单元格**——解密状态 `</td>`（:860）之后、确认列 `<td>`（:861）之前插入：

```tsx
<td className="px-5 py-3 font-mono text-[11px] tracking-tight text-[color:var(--muted-foreground)]">
  {s.decryptedAt
    ? new Date(s.decryptedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '—'}
</td>
```

（插入前 grep 该表内有无 `colSpan` 行需同步 +1；:781-910 区间未见。）

- [ ] **Step 3: 验证 + 提交**：`pnpm --filter bid-portal exec tsc --noEmit` exit 0。

```bash
git add apps/bid-portal/src/components/opening-hall.tsx
git commit -m "feat(p1-wave3): A-111 :3007 解密表增「解密时间」列（SUCCESS 行显示 mm-dd hh:mm:ss，其余 —）"
```

---

### Task 4: A-109a——签到 quorum 解密闸门（四入口）

**Files:**
- Create: `apps/api/src/bid/decrypt-quorum.util.ts` + 同名 `.spec.ts`
- Modify: `apps/api/src/bid/bid.service.ts`（`getMinBidders` :1462-1467 改委托；`decryptSupplier` :2796 后；`decryptOuterOne` 快路径跳过之后）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（`getOpeningPackage` :1735 后；`decryptUpload` :1830 后）
- Test: 上述两个 service spec 各加 1 用例

**Interfaces:**
- Produces: `getMinBiddersForMethod(procurementMethod: string | null): number`；`assertDecryptCheckInQuorum(prisma, projectId): Promise<void>`（不足抛 400 `INSUFFICIENT_CHECKIN`）。
- 语义：**已签到（`checkInAt` 非空）且已递交（`submitStatus='已提交'`）** 的家数 < 法定最少家数 → 禁止进入解密（四个解密入口全拦）。解密卡死时的业务出口 = 等待其余投标人签到 / 主持端流标（`POST /bid/projects/:id/abort`）/ 延长解密窗口——本闸门不提供绕过。

- [ ] **Step 1: TDD 写 util spec**（先红）：

```ts
import { BadRequestException } from '@nestjs/common';
import { assertDecryptCheckInQuorum, getMinBiddersForMethod } from './decrypt-quorum.util';

describe('decrypt-quorum（A-109a）', () => {
  const prisma = (project: unknown, signedIn: number) => ({
    bidProject: { findUnique: jest.fn().mockResolvedValue(project) },
    bidSupplier: { count: jest.fn().mockResolvedValue(signedIn) },
  });
  const proj = { name: 'P', procurementMethod: '公开招标' };

  it('getMinBiddersForMethod：直接采购 1、其余 3', () => {
    expect(getMinBiddersForMethod('直接采购')).toBe(1);
    expect(getMinBiddersForMethod('公开招标')).toBe(3);
    expect(getMinBiddersForMethod(null)).toBe(3);
  });
  it('已签到 2 < 3 → 400 INSUFFICIENT_CHECKIN', async () => {
    await expect(assertDecryptCheckInQuorum(prisma(proj, 2) as any, 'p1'))
      .rejects.toMatchObject({ response: { code: 'INSUFFICIENT_CHECKIN' } });
  });
  it('已签到 3 → 放行', async () => {
    await expect(assertDecryptCheckInQuorum(prisma(proj, 3) as any, 'p1')).resolves.toBeUndefined();
  });
  it('直接采购 1 家已签到 → 放行', async () => {
    await expect(assertDecryptCheckInQuorum(prisma({ name: 'P', procurementMethod: '直接采购' }, 1) as any, 'p1')).resolves.toBeUndefined();
  });
  it('项目不存在 → NotFound', async () => {
    await expect(assertDecryptCheckInQuorum(prisma(null, 0) as any, 'p1')).rejects.toThrow();
  });
  it('计数条件含 submitStatus=已提交 + checkInAt 非空', async () => {
    const p: any = prisma(proj, 3);
    await assertDecryptCheckInQuorum(p, 'p1');
    expect(p.bidSupplier.count).toHaveBeenCalledWith({ where: { projectId: 'p1', submitStatus: '已提交', checkInAt: { not: null } } });
  });
});
```

- [ ] **Step 2: 跑 spec 确认红**：`pnpm --filter api test -- decrypt-quorum` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 util**：

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // 与 bid.service.ts 头部 import 同路径

/** A-109：法定最少投标人家数（单一来源；bid.service.getMinBidders 委托此处） */
export function getMinBiddersForMethod(procurementMethod: string | null): number {
  if (procurementMethod === '直接采购') return 1;
  return 3;
}

/**
 * A-109a：解密 quorum 闸门——「已签到且已递交」家数不足法定最少家数时禁止进入解密。
 * 挂四个解密入口：旧轨主持端代解密 decryptSupplier、外层解密 decryptOuterOne、
 * 供应商取包 getOpeningPackage、供应商自解 decryptUpload。
 * 出口=等待签到/流标/延长窗口，不提供 force 绕过。
 */
export async function assertDecryptCheckInQuorum(prisma: PrismaService, projectId: string): Promise<void> {
  const project = await prisma.bidProject.findUnique({
    where: { id: projectId },
    select: { name: true, procurementMethod: true },
  });
  if (!project) throw new NotFoundException('项目不存在');
  const min = getMinBiddersForMethod(project.procurementMethod);
  const signedIn = await prisma.bidSupplier.count({
    where: { projectId, submitStatus: '已提交', checkInAt: { not: null } },
  });
  if (signedIn < min) {
    throw new BadRequestException({
      error: `已签到且已递交的投标人仅 ${signedIn} 家，不足法定最少 ${min} 家（${project.procurementMethod ?? '未知采购方式'}），暂不得进入解密；请等待其余投标人签到，确实不足的请按流标处理`,
      code: 'INSUFFICIENT_CHECKIN',
    });
  }
}
```

跑 spec 转绿。

- [ ] **Step 4: `getMinBidders` 委托**——`bid.service.ts` :1462-1467 方法体替换为 `return getMinBiddersForMethod(procurementMethod);`（保留中文注释，头部加 import；既有 `getMinBidders procurement-method-aware` spec :5084 无需改动）。

- [ ] **Step 5: 四入口接线**（每处一行 `await assertDecryptCheckInQuorum(this.prisma, projectId);`）：
  1. `bid.service.ts` `decryptSupplier`：`DECRYPT_WINDOW_CLOSED` 检查块（:2793-2796）之后、dual-v2 只读门控（:2798 起）之前。
  2. `bid.service.ts` `decryptOuterOne`：快路径 `skipped: true` 返回（:2569 附近）**之后**、信封解析之前（幂等 skip 不应被 quorum 拦）。
  3. `supplier-portal.service.ts` `getOpeningPackage`：窗口校验四连（:1722-1735）之后。
  4. `supplier-portal.service.ts` `decryptUpload`：窗口校验（:1827-1830）之后。

- [ ] **Step 6: service spec 各加 1 用例**：
  - `bid.service.spec.ts` `decryptSupplier` describe 内：mock `bidSupplier.count` 返回 2、`bidProject.findUnique` 返回 `{ name, procurementMethod: '公开招标' }` → `rejects.toMatchObject({ response: { code: 'INSUFFICIENT_CHECKIN' } })`（沿用该 describe 既有 prisma mock 对象，补 `count`/`findUnique` 字段；`BadRequestException` 断言风格参照 spec:416 N4 用例）。
  - `supplier-portal.service.spec.ts` `getOpeningPackage` 相关 describe 同款一例。

- [ ] **Step 7: 验证 + 提交**：`pnpm --filter api test -- decrypt-quorum bid.service supplier-portal.service` 绿 + lint。

```bash
git add apps/api/src/bid/decrypt-quorum.util.ts apps/api/src/bid/decrypt-quorum.util.spec.ts apps/api/src/bid/bid.service.ts apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(p1-wave3): A-109a 签到 quorum 解密闸门——已签到且已递交不足法定家数 400 INSUFFICIENT_CHECKIN（四解密入口统一，getMinBidders 收敛单一来源）"
```

---

### Task 5: A-109b——force 旁路收紧（法定家数=硬闸）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（E4 checklist :1524-1546）
- Modify: `apps/api/src/bid/dto/start-opening.dto.ts`（:23-25 force 注释）
- Test: `apps/api/src/bid/bid.service.spec.ts`（`describe('startOpening')` :290 起，扩 2 用例）

**Interfaces:**
- 语义：E4 阻断分区——**硬闸**（有效投标家数不足，法定）force 不可绕过（尝试绕过记「强制开标被拒（法定家数不足）」高风险日志后仍 400）；**软闸**（专家未分配，管理性）保留 force 绕过（原「强制开标(忽略checklist)」日志原样）。错误码仍 `OPENING_CHECKLIST_FAILED`（前端零改动——:3007 本就不暴露 force）。

- [ ] **Step 1: 写失败测试**（`describe('startOpening')` 内，mock 风格照 spec:416-428）：

```ts
it('A-109b：force 也不可绕过法定家数不足——仍 OPENING_CHECKLIST_FAILED + 记「强制开标被拒」', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ ...baseProject, stage: 'SUBMIT', procurementMethod: '公开招标' });
  prisma.bidExpert.count.mockResolvedValue(3);
  prisma.bidSupplier.count.mockImplementation(({ where }: any) => (where.submitStatus === '已提交' ? 1 : 3));
  await expect(service.startOpeningInternal('p1', { force: true } as any, 'u1'))
    .rejects.toMatchObject({ response: { code: 'OPENING_CHECKLIST_FAILED' } });
  expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: '强制开标被拒（法定家数不足）', riskFlag: '高风险' }),
  }));
});

it('A-109b：force 跳过软闸（专家 0 + 已提交 3 家）——放行且保留原「强制开标(忽略checklist)」日志', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ ...baseProject, stage: 'SUBMIT', procurementMethod: '公开招标' });
  prisma.bidExpert.count.mockResolvedValue(0);
  prisma.bidSupplier.count.mockImplementation(({ where }: any) => (where.submitStatus === '已提交' ? 3 : 3));
  await expect(service.startOpeningInternal('p1', { force: true, host: '甲', decryptWindowStart: iso, decryptWindowEnd: iso2 } as any, 'u1'))
    .resolves.toBeDefined();
  expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: '强制开标(忽略checklist)' }),
  }));
});
```

（`baseProject`/`iso` 以该 describe 既有 fixture 为准补齐必需字段——参照 :416 用例的 setup。）

跑测试确认第一例红（当前 force 会放行）。

- [ ] **Step 2: 实现**——E4 块（:1524-1546）整体替换为：

```ts
// E4: 开标准备 checklist(仅阶段推进时检查,同阶段调用不检查)
if (isTransitioning) {
  const expertCount = await this.prisma.bidExpert.count({ where: { projectId: id } });
  // N4d：家数口径 = 已提交——候选池行数（受邀未投递）不再计入，与 startEvaluation 有效投标口径对齐
  const supplierCount = await this.prisma.bidSupplier.count({ where: { projectId: id, submitStatus: '已提交' } });
  // A-109b：法定硬闸（家数不足 force 不可绕过）与管理性软闸（force 可绕过+高风险留痕）分区
  const hardBlocking: string[] = [];
  const softBlocking: string[] = [];
  if (supplierCount < this.getMinBidders(project.procurementMethod)) {
    hardBlocking.push(`有效投标（已提交）仅 ${supplierCount} 家(法定最少 ${this.getMinBidders(project.procurementMethod)} 家，${project.procurementMethod ?? '未知方式'})`);
  }
  if (expertCount === 0) softBlocking.push('尚有专家未分配');
  if (dto?.force && hardBlocking.length > 0) {
    await this.prisma.bidSupervisionLog.create({
      data: { projectId: id, time: new Date(), role: '系统', target: project.name,
        action: '强制开标被拒（法定家数不足）', result: hardBlocking.join('; '), riskFlag: '高风险' },
    }).catch(() => {});
  }
  if (hardBlocking.length > 0 || (softBlocking.length > 0 && !dto?.force)) {
    throw new BadRequestException({
      error: `开标准备未完成：${[...hardBlocking, ...softBlocking].join('；')}${hardBlocking.length > 0 ? '（有效投标家数不足为法定硬性条件，不可强制开标——请流标或调整采购方式后重新组织）' : ''}`,
      code: 'OPENING_CHECKLIST_FAILED',
      items: [...hardBlocking, ...softBlocking],
    });
  }
  if (softBlocking.length > 0 && dto?.force) {
    await this.prisma.bidSupervisionLog.create({
      data: { projectId: id, time: new Date(), role: '系统', target: project.name,
        action: '强制开标(忽略checklist)', result: softBlocking.join('; '), riskFlag: '高风险' },
    }).catch(() => {});
  }
}
```

- [ ] **Step 3: DTO 注释更新**——`start-opening.dto.ts` :23-25 force 注释改为：

```ts
  /** E4: 强制开标——仅可跳过管理性阻断（如专家未分配，高风险留痕）；有效投标家数不足为法定硬闸不可强制（记「强制开标被拒」日志并拒绝） */
```

- [ ] **Step 4: 跑测试**：两新用例 + 既有 `startOpening` 全组（spec:290 起，含 :416/:431 两用例不得回归——items 文案前缀未变）转绿 + lint。

- [ ] **Step 5: 提交**：

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/dto/start-opening.dto.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(p1-wave3): A-109b force 旁路收紧——E4 分法定硬闸/管理软闸，家数不足 force 亦拒（记「强制开标被拒（法定家数不足）」高风险日志），软闸绕过语义原样保留"
```

---

### Task 6: A-102 后端——BondLedgerService 到账台账（登记/列表/删除）

**Files:**
- Create: `apps/api/src/bid/bond-ledger.service.ts` + 同名 `.spec.ts`
- Create: `apps/api/src/bid/dto/bond-ledger.dto.ts`
- Modify: `apps/api/src/bid/bid.controller.ts`（:133 bond-return 路由后追加 3 路由）
- Modify: `apps/api/src/bid/bid.module.ts`（providers + 控制器注入）
- Test: `apps/api/test/bid.e2e-spec.ts`（追加 1 用例）

**Interfaces:**
- Produces: `PUT /api/bid/projects/:id/bond-ledger`（body=UpsertBondLedgerDto，一家一条幂等）；`GET /api/bid/projects/:id/bond-ledger`（行数组，arrivedAt 升序）；`DELETE /api/bid/projects/:id/bond-ledger/:ledgerId`。角色均 `@Roles('admin','bid_host','leader','staff')`。错误码：`NO_BOND`/`SUPPLIER_NOT_IN_ROSTER`/`NOT_FOUND`。

- [ ] **Step 1: DTO**：

```ts
import { IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/** A-102：保证金到账台账登记（一家一条，projectId+supplierName 幂等 upsert） */
export class UpsertBondLedgerDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  supplierName!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsISO8601()
  arrivedAt!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  account!: string;

  @IsIn(['转账', '保函', '支票', '其他'])
  payMethod!: string;

  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}
```

- [ ] **Step 2: service（TDD：先写 spec 再实现，spec 覆盖 upsert 建/更/NO_BOND/名册外 400 + remove 404）**：

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertBondLedgerDto } from './dto/bond-ledger.dto';

@Injectable()
export class BondLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** A-102：登记/更正保证金到账（缴纳人/金额/到账时间/账户/支付形式） */
  async upsert(projectId: string, dto: UpsertBondLedgerDto, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { name: true, bondRequired: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (!project.bondRequired) throw new BadRequestException({ error: '该项目未要求投标保证金', code: 'NO_BOND' });
    const roster = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierName: dto.supplierName }, select: { id: true } });
    if (!roster) throw new BadRequestException({ error: `投标名册中不存在供应商「${dto.supplierName}」`, code: 'SUPPLIER_NOT_IN_ROSTER' });
    const row = await this.prisma.bidBondLedger.upsert({
      where: { projectId_supplierName: { projectId, supplierName: dto.supplierName } },
      create: { projectId, supplierName: dto.supplierName, amount: dto.amount, arrivedAt: new Date(dto.arrivedAt), account: dto.account, payMethod: dto.payMethod, note: dto.note ?? null, createdBy: actorId ?? null },
      update: { amount: dto.amount, arrivedAt: new Date(dto.arrivedAt), account: dto.account, payMethod: dto.payMethod, note: dto.note ?? null },
    });
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: dto.supplierName,
        action: '保证金到账登记', result: `缴纳人 ${dto.supplierName}；金额 ${dto.amount} 元；到账 ${dto.arrivedAt}；收款账户 ${dto.account}；支付形式 ${dto.payMethod}${dto.note ? `；备注 ${dto.note}` : ''}`, riskFlag: '无' },
    }).catch(() => {});
    return row;
  }

  list(projectId: string) {
    return this.prisma.bidBondLedger.findMany({ where: { projectId }, orderBy: { arrivedAt: 'asc' } });
  }

  /** 错登纠正（高风险留痕）；正常核对无误的记录不得删 */
  async remove(projectId: string, ledgerId: string) {
    const row = await this.prisma.bidBondLedger.findUnique({ where: { id: ledgerId } });
    if (!row || row.projectId !== projectId) throw new BadRequestException({ error: '台账记录不存在', code: 'NOT_FOUND' });
    await this.prisma.bidBondLedger.delete({ where: { id: ledgerId } });
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: row.supplierName,
        action: '保证金到账台账删除', result: `删除记录：金额 ${row.amount} 元、到账 ${row.arrivedAt.toISOString()}`, riskFlag: '高风险' },
    }).catch(() => {});
    return { success: true };
  }
}
```

spec（`bond-ledger.service.spec.ts`，mock prisma 对象字面量风格参照 `bid.service.spec.ts` :115-146）：

```ts
describe('BondLedgerService（A-102）', () => {
  it('upsert 成功——建行 + 到账登记监督日志', /* prisma.bidBondLedger.upsert resolve {}、bidSupervisionLog.create jest.fn；断言 action '保证金到账登记'、riskFlag '无' */);
  it('upsert——项目未要求保证金 400 NO_BOND', /* bondRequired:false */);
  it('upsert——名册外供应商 400 SUPPLIER_NOT_IN_ROSTER', /* findFirst null */);
  it('remove——他项目台账 400 NOT_FOUND', /* row.projectId 不匹配 */);
});
```

（用例体按上表注释写实断言，风格 `rejects.toMatchObject({ response: { code: '...' } })`。）

- [ ] **Step 3: module + controller**——`bid.module.ts` providers 数组（:45-46）加 `BondLedgerService`；`bid.controller.ts` 构造器注入。:133 之后追加（actor 提取方式 grep 邻近路由的 `@CurrentUser` 用法对齐）：

```ts
@Get('projects/:id/bond-ledger')
@Roles('admin', 'bid_host', 'leader', 'staff')
@ApiOperation({ summary: 'A-102: 保证金到账台账列表' })
listBondLedger(@Param('id') id: string) { return this.bondLedger.list(id); }

@Put('projects/:id/bond-ledger')
@Roles('admin', 'bid_host', 'leader', 'staff')
@ApiOperation({ summary: 'A-102: 登记保证金到账（缴纳人/金额/到账时间/账户/支付形式；一家一条幂等，记监督日志）' })
upsertBondLedger(@Param('id') id: string, @Body() dto: UpsertBondLedgerDto, @CurrentUser('sub') actorId: string) {
  return this.bondLedger.upsert(id, dto, actorId);
}

@Delete('projects/:id/bond-ledger/:ledgerId')
@Roles('admin', 'bid_host', 'leader', 'staff')
@ApiOperation({ summary: 'A-102: 删除错登的到账记录（高风险留痕）' })
removeBondLedger(@Param('id') id: string, @Param('ledgerId') ledgerId: string) { return this.bondLedger.remove(id, ledgerId); }
```

- [ ] **Step 4: e2e 1 用例**——`test/bid.e2e-spec.ts` 追加（沿用文件既有登录 cookie fixture；选一个 `bondRequired=true` 的 OPENING 种子项目，若 fixture 无则按文件内既有项目 setup 方式自建）：

```ts
it('A-102 保证金到账台账——PUT 幂等登记 + GET 列表 + 名册外 400（bid-portal cookie）', async () => {
  const body = { supplierName: '<该项目已提交供应商名>', amount: 500000, arrivedAt: new Date().toISOString(), account: '蜀水采专户(6228)', payMethod: '转账' };
  await request(app.getHttpServer()).put(`/api/bid/projects/${projectId}/bond-ledger`)
    .set('Cookie', bidCookie).set('X-Portal', 'bid').send(body).expect(200);
  await request(app.getHttpServer()).put(`/api/bid/projects/${projectId}/bond-ledger`)
    .set('Cookie', bidCookie).set('X-Portal', 'bid').send(body).expect(200); // 幂等
  const list = await request(app.getHttpServer()).get(`/api/bid/projects/${projectId}/bond-ledger`)
    .set('Cookie', bidCookie).set('X-Portal', 'bid').expect(200);
  expect(list.body.some((r: any) => r.supplierName === body.supplierName)).toBe(true);
  await request(app.getHttpServer()).put(`/api/bid/projects/${projectId}/bond-ledger`)
    .set('Cookie', bidCookie).set('X-Portal', 'bid').send({ ...body, supplierName: '不存在公司' }).expect(400);
});
```

（Nest `@Put` 默认成功码 200（仅 POST 默认 201）；若该路由实际挂了 @HttpCode 以现场为准。）

- [ ] **Step 5: 验证 + 提交**：`pnpm --filter api test -- bond-ledger` + lint 绿；e2e `pnpm --filter api test:e2e -- bid`（环境红先核是否 pre-existing）。

```bash
git add apps/api/src/bid/bond-ledger.service.ts apps/api/src/bid/bond-ledger.service.spec.ts apps/api/src/bid/dto/bond-ledger.dto.ts apps/api/src/bid/bid.controller.ts apps/api/src/bid/bid.module.ts apps/api/test/bid.e2e-spec.ts
git commit -m "feat(p1-wave3): A-102 保证金到账台账——BondLedgerService 登记幂等/列表/错登删除（缴纳人/金额/到账时间/账户/支付形式，监督日志留痕）+ e2e"
```

---

### Task 7: A-104——符合性比对引擎 + 唱标预填/评标软标记接线

**Files:**
- Create: `packages/shared/src/bond-compliance.ts`
- Modify: `packages/shared/src/index.ts`（+export）
- Create: `apps/api/src/bid/bond-compliance.spec.ts`（import 自 `@water-erp/shared`——先例 `bid-bond-status.spec.ts`）
- Modify: `apps/api/src/bid/bid.service.ts`（`getOpeningRecordDraft` :3758-3806；`generateEvaluationResults` 采集块 :4287-4301 + 日志 :4558-4565）

**Interfaces:**
- Produces: `evaluateBondCompliance(input: BondLedgerComplianceInput): BondComplianceIssue[]`（前端 Task 8 同函数复用）；唱标预填响应新增 `bondCompliance: { issues: BondComplianceIssue[] }`；评标软标记监督日志 result 追加台账比对结论。
- 比对口径（A-104 检测项四维全覆盖）：**金额**（台账 ≥ `bondAmount`，未设要求不比）｜**到账时间**（≤ 截标 `deadline`；保函行语义=保函递交时间，同一基准可比）｜**支付形式**（保函 ↔ 唱标「保函有效」、其余 ↔ 「已缴纳」互斥提示）｜**凭证**（`hasVoucher=false` → 未上传缴纳凭证；仅唱标预填处核——凭证数据在彼上下文；`null`=不在核验上下文、跳过，如大厅台账徽标）｜无台账=「未登记到账台账」。比对结果**只提示不裁决**——符合性认定是评标委员会职权，软标记供审查。

- [ ] **Step 1: TDD 写 spec**（先红）：

```ts
import { evaluateBondCompliance } from '@water-erp/shared';

describe('evaluateBondCompliance（A-104）', () => {
  const ok = { hasLedger: true, amount: 500000, arrivedAt: '2026-08-01T08:00:00+08:00', payMethod: '转账', requiredAmount: 500000, deadline: '2026-08-01T17:00:00+08:00', bondStatus: '已缴纳' };
  it('全符合作空 issues', () => expect(evaluateBondCompliance(ok)).toEqual([]));
  it('无台账 → LEDGER_MISSING', () => expect(evaluateBondCompliance({ ...ok, hasLedger: false, amount: null, arrivedAt: null, payMethod: null })).toEqual([expect.objectContaining({ field: 'LEDGER_MISSING' })]));
  it('金额不足 → AMOUNT', () => expect(evaluateBondCompliance({ ...ok, amount: 400000 })).toEqual([expect.objectContaining({ field: 'AMOUNT' })]));
  it('到账晚于截标 → ARRIVAL', () => expect(evaluateBondCompliance({ ...ok, arrivedAt: '2026-08-02T09:00:00+08:00' })).toEqual([expect.objectContaining({ field: 'ARRIVAL' })]));
  it('保函形式但唱标录「已缴纳」 → PAY_METHOD', () => expect(evaluateBondCompliance({ ...ok, payMethod: '保函' })).toEqual([expect.objectContaining({ field: 'PAY_METHOD' })]));
  it('requiredAmount 未设不比金额', () => expect(evaluateBondCompliance({ ...ok, requiredAmount: null, amount: 1 })).toEqual([]));
  it('缺凭证 → VOUCHER（有台账）', () => expect(evaluateBondCompliance({ ...ok, hasVoucher: false })).toEqual([expect.objectContaining({ field: 'VOUCHER' })]));
  it('无台账且缺凭证 → LEDGER_MISSING + VOUCHER', () => expect(evaluateBondCompliance({ ...ok, hasLedger: false, amount: null, arrivedAt: null, payMethod: null, hasVoucher: false }))
    .toEqual([expect.objectContaining({ field: 'LEDGER_MISSING' }), expect.objectContaining({ field: 'VOUCHER' })]));
  it('hasVoucher=null 跳过凭证维', () => expect(evaluateBondCompliance({ ...ok, hasVoucher: null })).toEqual([]));
});
```

（shared 无独立 test runner，spec 放 api 内由 api jest 执行——先例 `bid-bond-status.spec.ts`；先跑确认红，再实现。）注意：实现前需在 `packages/shared/src/index.ts` 加 `export * from './bond-compliance';` 并 `pnpm --filter @water-erp/shared build`，api 才能解析到。

- [ ] **Step 2: 实现**——`packages/shared/src/bond-compliance.ts`：

```ts
/* A-104：保证金符合性自动比对（到账台账 × 招标要求 × 唱标录入状态）——前后端共用 */
export interface BondLedgerComplianceInput {
  hasLedger: boolean;
  amount: number | null;         // 台账到账金额（元）
  arrivedAt: string | null;      // ISO 到账时间
  payMethod: string | null;      // 转账/保函/支票/其他
  requiredAmount: number | null; // BidProject.bondAmount（null=未设要求，不比对）
  deadline: string | null;       // 截标时间（ISO；到账截止按截标口径，保函行=递交时间同基准）
  bondStatus: string | null;     // 唱标录入状态（已缴纳/保函有效/…，null=未录入）
  hasVoucher?: boolean | null;   // 是否已上传缴纳凭证（false=缺凭证；null/undefined=不在核验上下文，跳过该维）
}
export interface BondComplianceIssue { field: 'LEDGER_MISSING' | 'AMOUNT' | 'ARRIVAL' | 'PAY_METHOD' | 'VOUCHER'; message: string }

export function evaluateBondCompliance(input: BondLedgerComplianceInput): BondComplianceIssue[] {
  if (!input.hasLedger) {
    const voucherMissing = input.hasVoucher === false ? [{ field: 'VOUCHER', message: '未上传保证金缴纳凭证' } as BondComplianceIssue] : [];
    return [{ field: 'LEDGER_MISSING', message: '未登记到账台账' }, ...voucherMissing];
  }
  const issues: BondComplianceIssue[] = [];
  if (input.hasVoucher === false) issues.push({ field: 'VOUCHER', message: '未上传保证金缴纳凭证' });
  if (input.requiredAmount != null && input.amount != null && input.amount < input.requiredAmount) {
    issues.push({ field: 'AMOUNT', message: `到账金额 ${input.amount} 元，不足要求 ${input.requiredAmount} 元` });
  }
  if (input.deadline && input.arrivedAt && new Date(input.arrivedAt).getTime() > new Date(input.deadline).getTime()) {
    issues.push({ field: 'ARRIVAL', message: `到账时间晚于截标时间（到账 ${input.arrivedAt}，截标 ${input.deadline}）` });
  }
  if (input.payMethod === '保函' && input.bondStatus === '已缴纳') {
    issues.push({ field: 'PAY_METHOD', message: '台账支付形式为保函，唱标应录「保函有效」而非「已缴纳」' });
  }
  if (input.payMethod && input.payMethod !== '保函' && input.bondStatus === '保函有效') {
    issues.push({ field: 'PAY_METHOD', message: `台账支付形式为${input.payMethod}，唱标录入为「保函有效」不一致` });
  }
  return issues;
}
```

build shared → spec 转绿。

- [ ] **Step 3: 唱标预填接线**——`getOpeningRecordDraft`：
  - project select（:3761）扩为 `{ stage: true, qualityRequirement: true, bondRequired: true, bondAmount: true, deadline: true }`
  - bidSupplier select（:3768）加 `supplierName: true`
  - 返回对象（:3789-3805）追加（放在 `bondNotApplicable` 后）：

```ts
// A-104：保证金符合性自动比对（台账 × bondAmount/截标 × 唱标录入状态）
bondCompliance: (() => {
  if (!project.bondRequired) return null;
  return { issues: evaluateBondCompliance({
    hasLedger: !!ledger,
    hasVoucher: !!bondAssetId, // A-104 凭证维：唱标预填上下文内核（bondAssetId 已在上方解析）
    amount: ledger ? Number(ledger.amount) : null,
    arrivedAt: ledger?.arrivedAt?.toISOString() ?? null,
    payMethod: ledger?.payMethod ?? null,
    requiredAmount: project.bondAmount != null ? Number(project.bondAmount) : null,
    deadline: project.deadline.toISOString(),
    bondStatus: existingRecord?.bondStatus ?? null,
  }) };
})(),
```

（`ledger` 在 :3789 return 前取：`const ledger = project.bondRequired ? await this.prisma.bidBondLedger.findUnique({ where: { projectId_supplierName: { projectId, supplierName: bidSupplier.supplierName } } }) : null;`；`canView=false` 的早退路径统一带 `bondCompliance: null`——`empty` 对象 :3763 加同名字段。）

- [ ] **Step 4: 评标软标记增强**——`generateEvaluationResults` 采集块（:4287-4301，`if (project.bondRequired)` 内）：在既有 `bondBySupplier` Map 基础上加台账维度（`bondFlagged` 项追加 `reasons: string[]` 字段）：

```ts
const ledgers = await this.prisma.bidBondLedger.findMany({ where: { projectId } });
const ledgerBySupplier = new Map(ledgers.map((l) => [l.supplierName, l]));
// 既有循环内，每家补算（status=唱标状态、s.supplierName=名册名，变量名以现场为准）：
const ledger = ledgerBySupplier.get(s.supplierName) ?? null;
const reasons = evaluateBondCompliance({
  hasLedger: !!ledger, amount: ledger ? Number(ledger.amount) : null,
  arrivedAt: ledger?.arrivedAt?.toISOString() ?? null, payMethod: ledger?.payMethod ?? null,
  requiredAmount: project.bondAmount != null ? Number(project.bondAmount) : null,
  deadline: project.deadline.toISOString(), bondStatus: status,
}).map((i) => i.message);
// 既有两条 push 分支保留，push 对象追加 reasons；另补第三分支：
if (isBondQualified(status) && reasons.length > 0) {
  bondFlagged.push({ supplierName: s.supplierName, bondStatus: status!, reasons });
}
```

日志写入（:4558-4565）result 模板追加：

```ts
result: `保证金状态：${f.bondStatus}（未达标，供评标委员会审查${f.reasons?.length ? `；台账比对：${f.reasons.join('；')}` : ''}）`
```

- [ ] **Step 5: 测试**——`bond-compliance.spec.ts` 转绿；`getOpeningRecordDraft` 既有 spec 若断言返回形状，补 `bondCompliance` 字段断言（无台账 + bondRequired → issues 含 LEDGER_MISSING）。

- [ ] **Step 6: 验证 + 提交**：`pnpm --filter api test -- bond-compliance bid.service` + lint；shared 已 build。

```bash
git add packages/shared/src/bond-compliance.ts packages/shared/src/index.ts apps/api/src/bid/bond-compliance.spec.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(p1-wave3): A-104 保证金自动符合性比对——shared evaluateBondCompliance（金额/到账/支付形式/台账缺）+ 唱标预填 bondCompliance + 评标软标记日志附台账比对结论"
```

---

### Task 8: A-102/104 前端——:3007 大厅保证金台账面板 + 唱标弹窗比对提示

**Files:**
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（+3 封装）
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（唱标总表区块前插面板；唱标录入弹窗 :1161-1171 区域插提示）

**Interfaces:**
- Consumes: Task 6 三端点；Task 7 `evaluateBondCompliance`（`@water-erp/shared`）+ 唱标预填 `bondCompliance`；大厅既有 `project.suppliers`（名册，含 submitStatus）与唱标 records（`r.bondStatus`/`r.supplierName`）。

- [ ] **Step 1: API 封装**——`lib/api/bid.ts` 按文件既有 fetch 封装风格加：

```ts
listBondLedger(projectId: string)                        // GET  bid/projects/:id/bond-ledger
upsertBondLedger(projectId: string, body: Record<string, unknown>)  // PUT  同上
removeBondLedger(projectId: string, ledgerId: string)    // DELETE bid/projects/:id/bond-ledger/:ledgerId
```

- [ ] **Step 2: 台账面板**——`opening-hall.tsx` 唱标总表区块（`overflow-x-auto` 容器 :1011、表头 :1013-1023 之前）插入主持人面板（`canHost && project.bondRequired && project.stage === 'OPENING'` 时渲染；沿用文件既有 section/card 类名与 `neu-btn-*` 按钮体系）：
  - 状态：`bondLedger: Row[]`（挂载 + 每次登记/删除后 `listBondLedger` 刷新）、登记表单 state（supplierName 下拉=`project.suppliers` 中 `submitStatus==='已提交'` 家、amount number、arrivedAt `datetime-local`、account、payMethod 下拉 转账/保函/支票/其他、note）。
  - 提交：`upsertBondLedger(project.id, { supplierName, amount: Number(amount), arrivedAt: new Date(arrivedAt).toISOString(), account, payMethod, note })` → toast + 刷新。
  - 行展示列：缴纳人｜金额（`font-mono`）｜到账时间｜收款账户｜支付形式｜备注｜**比对徽标**｜删除按钮（确认后 `removeBondLedger`）。
  - 比对徽标（客户端算，同 Task 7 函数）：

```tsx
const issues = evaluateBondCompliance({
  hasLedger: true, amount: Number(row.amount), arrivedAt: row.arrivedAt, payMethod: row.payMethod,
  requiredAmount: project.bondAmount != null ? Number(project.bondAmount) : null,
  deadline: project.deadline, bondStatus: records.find((r) => r.supplierName === row.supplierName)?.bondStatus ?? null,
});
// issues.length===0 → 绿「台账相符」；否则红「不符」+ title/悬浮列 issues.map(i=>i.message).join('；')
```

（`project.bondAmount`/`project.deadline` 若大厅载荷未含，在 `lib/api/bid.ts` 的 getProject 类型上确认；缺失则后端 `getProject` select 补两字段——以现场实际为准，属只读追加。）

- [ ] **Step 3: 唱标弹窗比对提示**——录入弹窗保证金 select（:1161-1166）与凭证链接（:1168-1171）之间插入：

```tsx
{recordDraft?.bondCompliance && (
  recordDraft.bondCompliance.issues.length > 0 ? (
    <div className="rounded-[8px] bg-[oklch(0.66_0.175_27_/_0.08)] px-3 py-2 text-[11px] text-[var(--danger)]">
      保证金台账比对不符：{recordDraft.bondCompliance.issues.map((i: { message: string }) => i.message).join('；')}
    </div>
  ) : (
    <div className="rounded-[8px] bg-[oklch(0.71_0.11_164_/_0.08)] px-3 py-2 text-[11px] text-[var(--success)]">保证金台账比对相符</div>
  )
)}
```

（`recordDraft` state 的内联类型补 `bondCompliance?: { issues: { field: string; message: string }[] } | null`。）

- [ ] **Step 4: 验证 + 提交**：`pnpm --filter bid-portal exec tsc --noEmit` exit 0。

```bash
git add apps/bid-portal/src/lib/api/bid.ts apps/bid-portal/src/components/opening-hall.tsx
git commit -m "feat(p1-wave3): A-102/104 :3007 大厅保证金到账台账面板（登记/比对徽标/删除）+ 唱标弹窗自动比对提示"
```

---

### Task 9: 审计报告注记 + 验收收尾

**Files:**
- Modify: `docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md`（§一 勘误头 + §P1 五行注记）

- [ ] **Step 1: 勘误头**——§一 追加波3 行（参照波2 注记格式）：

> **波3 注记（2026-09-XX）**：§P1 四项（A-109×2/A-111/A-102/A-104）当日整改落地（计划 `docs/superpowers/plans/2026-09-01-p1-wave3-opening-gates-bond-ledger.md`，提交 <起>..<止>），见 §P1 表注记；A-105（逐家退还+定标联动）经评审挪波4「评标后收尾批」（退还发生在中标后属 :3005 收尾域，与本波开标现场主题错配；现状维持项目级登记+日历提醒）；其余 P1 项（A-87/A-89/A-129/A-132/A-151/A-152，A-130 拟并入公共服务平台对接专项）留波4。

- [ ] **Step 2: 四行注记**（补齐思路列追加「✅ 已整改（日期 波3，提交号；落地摘要）」）：
  - A-109 签到行：quorum 闸门四入口 `INSUFFICIENT_CHECKIN`，出口=流标/延窗；
  - A-109 force 行：法定硬闸 force 亦拒（记「强制开标被拒」日志），软闸绕过保留；
  - A-111 行：`BidSupplier.decryptedAt` 终局写入+四重置清理，:3007 列+文件包；
  - A-102/A-104/A-105 合并行（报告原即一行）：A-102/A-104 ✅ 已整改（`BidBondLedger` 台账+四维比对引擎：唱标预填/评标软标记/:3007 徽标）；**A-105 挪波4**（注记注明排期与理由，勿标已整改）。
- [ ] **Step 3: 提交**：

```bash
git add "docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md"
git commit -m "docs(p1-wave3): 审计报告 A-109/A-111/A-102/A-104 注记整改落地（波3；A-105 注记挪波4）+ 勘误头补波3 行"
```

---

## 验收清单（全部任务完成后）

1. `pnpm --filter api test` 全量绿（新增 decrypt-quorum/bond-ledger/bond-compliance spec + 扩展用例）+ `pnpm --filter api lint` 0 error + `pnpm --filter api build` 成功（DTO 装饰器导入坑的启动级验证）；`bid` e2e 绿。
2. `packages/shared` build 过；bid-portal `exec tsc --noEmit` exit 0（本波不涉 :3005/web）。
3. `npx prisma validate` + `migrate status` 干净（本次迁移 applied、无新 drift）。
4. 浏览器验收（控制者执行）：OPENING 项目（≥3 家已递交）——①2 家签到时供应商取包/主持端解密均弹「不足法定家数」；第 3 家签到后放行；②`force` 传家数不足项目开标仍 400 且监督日志见「强制开标被拒」；③解密成功行 :3007 表现「解密时间」；④大厅登记台账（金额不足/到账超期/缺凭证各一）→ 唱标弹窗红条比对、评标生成监督日志带台账结论。
5. 审计报告五处注记 + 勘误头核对。

## 任务间依赖

T1（schema）→ T2/T6（消费列/模型）→ T3（T2 数据）、T7（T6 台账）、T8（T6+T7）；T4/T5 与 schema 无关（可与 T2 并行，但按串行执行避免 bid.service.ts 冲突）。执行顺序：1→2→3→4→5→6→7→8→9（严格串行——T2/T4/T5/T7 多点改 `bid.service.ts` 与其 spec，并行会互相踩）。

## 风险与既有回归点

- `bid.service.spec.ts` 6500+ 行共享 mock——T4/T5/T7 都要动它，严格按任务序提交，每步跑 `-- bid.service` 防回归。
- `getOpeningRecordDraft` 早退路径（`empty` :3763）必须同形补 `bondCompliance: null`，否则前端解构炸。
- 外层解密不算 SUCCESS：`decryptedAt` 语义=「解密终局时间」（旧轨代解密完成/新轨内层上传成功），与 `outerDecryptedAt`（外层抢占时刻）并存勿混——审计 A-111 诉求即「解密时间」按终局口径。
- e2e 若因种子项目 `bondRequired` 缺 fixture 红，按文件内既有项目 setup 方式自建，勿改共享种子。
