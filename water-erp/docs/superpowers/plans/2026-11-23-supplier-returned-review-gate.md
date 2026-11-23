# 供应商注册审批：补正中禁审 + 按级显示 + 悬挂态修正 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `approve()`/`reject()` 收紧到仅 PENDING（补正中禁审）；详情页/审批中心审批面按「PENDING 且轮到我的级」显示；存量悬挂态拨回最后一次退回记录的级。

**Architecture:** 后端单点收紧（含两处乐观锁谓词）+ 前端两处显示条件 + 一次性幂等修正脚本（PrismaClient 直连，--dry-run 支持）。语义闭环：退回 → 补正重提（回 PENDING、级保留）→ 该级续审。

**Tech Stack:** NestJS 11 + Prisma + jest（直构 service，同 supplier-link.spec 范式）；Next.js 前端；脚本 `npx tsx` 运行。

**Spec:** `docs/superpowers/specs/2026-11-23-supplier-returned-review-gate-design.md`

## Global Constraints

- 新错误码 `AWAITING_RESUBMISSION`，文案逐字：「该申请已退回补正，待供应商重新提交后才能审核」；其余非 PENDING 维持 `INVALID_STATUS`「供应商状态不允许审核」（reject 侧「供应商状态不允许审核」同码）。
- 乐观锁 where 一律 `status: 'PENDING'`（禁 `in: ['PENDING','RETURNED']`）。
- `return()` 与信息性区块（详情页「等待审核」提示条/「审批进度」时间线/总览待审核构成）不动——RETURNED 保留只读展示（用户裁定）。
- 仓库根 `/Users/qihao/ERP2/ERP`；git 一律 `git -C /Users/qihao/ERP2/ERP`，只 add 明确文件。
- commit 中文、`fix(supplier):` 前缀，尾部 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

### Task 1: 后端闸门收紧（TDD）

**Files:**
- Test: `apps/api/src/supplier/supplier-review-status-gate.spec.ts`（新建）
- Modify: `apps/api/src/supplier/supplier.service.ts`（approve :2293-2369、reject :2402-2427）

**Interfaces:**
- Produces: approve/reject 对 `status='RETURNED'` 抛 `BadRequestException`，`response={error:'该申请已退回补正，待供应商重新提交后才能审核', code:'AWAITING_RESUBMISSION'}`；乐观锁 where `status:'PENDING'`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/supplier/supplier-review-status-gate.spec.ts`：

```ts
import { SupplierService } from './supplier.service';

/** 补正中禁审（2026-11-23 用户裁定，spec §3.1）：RETURNED 状态不可 approve/reject，
 *  须等供应商补正重提回 PENDING；乐观锁谓词同步收紧（防校验后瞬间重提的竞态误审）。 */

const mkNotification = () => ({
  create: jest.fn().mockResolvedValue({}),
  resolveActionable: jest.fn().mockResolvedValue({}),
});

const mkPrisma = (over: Record<string, jest.Mock> = {}) => ({
  supplier: {
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
  supplierContact: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierQualification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierClassificationLink: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierApprovalRecord: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
  fileAsset: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  notification: { create: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    supplier: { update: jest.fn().mockResolvedValue({}) },
    supplierContact: { deleteMany: jest.fn() },
    supplierQualification: { deleteMany: jest.fn() },
    supplierBankAccount: { deleteMany: jest.fn() },
    supplierPerformance: { deleteMany: jest.fn() },
    supplierClassificationLink: { deleteMany: jest.fn() },
    user: { update: jest.fn() },
    supplierApprovalRecord: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    supplierCompanyLink: { upsert: jest.fn() },
  })),
  ...over,
});

const mkSvc = (prisma: ReturnType<typeof mkPrisma>, notification = mkNotification()) =>
  new (SupplierService as any)(prisma, notification, null, null, null, null) as SupplierService;

const SUPPLIER_RETURNED = {
  id: 'sup-1', userId: 'u1', companyId: 'co1', name: '测试供应商',
  status: 'RETURNED', reviewStage: 'STAFF', user: { id: 'u1' },
};
const REVIEWER_STAFF = { id: 'rev-1', role: 'staff', companyId: 'co1' };

describe('补正中（RETURNED）禁审闸', () => {
  it('approve on RETURNED → 400 AWAITING_RESUBMISSION，零写库', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue(SUPPLIER_RETURNED);
    const svc = mkSvc(prisma);
    await expect(svc.approve('sup-1', 'rev-1', '理由')).rejects.toMatchObject({
      response: { code: 'AWAITING_RESUBMISSION', error: expect.stringContaining('重新提交') },
    });
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('reject on RETURNED → 400 AWAITING_RESUBMISSION（断言按级先过、状态闸后置仍拦）', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue(SUPPLIER_RETURNED);
    prisma.user.findUnique.mockResolvedValue(REVIEWER_STAFF); // reject 的按级断言在状态闸之前
    const svc = mkSvc(prisma);
    await expect(svc.reject('sup-1', '理由', 'rev-1')).rejects.toMatchObject({
      response: { code: 'AWAITING_RESUBMISSION' },
    });
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('approve on PENDING/STAFF → 乐观锁 where.status 单值 PENDING 且推进 LEADER', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue({ ...SUPPLIER_RETURNED, status: 'PENDING' });
    prisma.user.findUnique.mockResolvedValue(REVIEWER_STAFF);
    const svc = mkSvc(prisma);
    const r = await svc.approve('sup-1', 'rev-1', '同意');
    expect(r).toEqual({ success: true, stage: 'LEADER' });
    const where = prisma.supplier.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'sup-1', status: 'PENDING', reviewStage: 'STAFF' });
    expect(JSON.stringify(where)).not.toContain('RETURNED');
  });

  it('reject on PENDING → 乐观锁 where.status 单值 PENDING 且置 REJECTED', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique
      .mockResolvedValueOnce({ ...SUPPLIER_RETURNED, status: 'PENDING' }) // 入口读
      .mockResolvedValueOnce({ ...SUPPLIER_RETURNED, status: 'REJECTED' }); // 落库后回读
    prisma.user.findUnique.mockResolvedValue(REVIEWER_STAFF);
    const svc = mkSvc(prisma);
    await svc.reject('sup-1', '资料不符', 'rev-1');
    const where = prisma.supplier.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'sup-1', status: 'PENDING' });
    expect(JSON.stringify(where)).not.toContain('RETURNED');
  });

  it('approve on 终态（APPROVED）→ 400 INVALID_STATUS（回归）', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue({ ...SUPPLIER_RETURNED, status: 'APPROVED', reviewStage: null });
    const svc = mkSvc(prisma);
    await expect(svc.approve('sup-1', 'rev-1', '理由')).rejects.toMatchObject({
      response: { code: 'INVALID_STATUS' },
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/supplier/supplier-review-status-gate.spec.ts
```

Expected: 前 2 条 FAIL（RETURNED 未被拦、直接走 updateMany 成功）；第 3/4 条 FAIL（锁谓词含 RETURNED 的 JSON 断言）；第 5 条可能已绿。

- [ ] **Step 3: 最小实现**

`supplier.service.ts` `approve()` 前置校验（:2298-2300）替换为：

```ts
    // 补正中禁审（2026-11-23 用户裁定）：退回补正后须等供应商重提（status 回 PENDING）
    // 才能继续审——此前 RETURNED 可直接审（不等重提）且通过只推进级不改 status，
    // 产生 status=RETURNED+级已推进的悬挂态（生产实录 SUP-000016）。
    if (supplier.status === 'RETURNED') {
      throw new BadRequestException({ error: '该申请已退回补正，待供应商重新提交后才能审核', code: 'AWAITING_RESUBMISSION' });
    }
    if (supplier.status !== 'PENDING') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }
```

approve ADMIN 分支乐观锁（:2318）`status: { in: ['PENDING', 'RETURNED'] }` → `status: 'PENDING'`；
approve STAFF/LEADER 分支乐观锁（:2353）同样替换。

`reject()` 前置校验（:2414-2416）替换为：

```ts
    if (supplier.status === 'RETURNED') {
      throw new BadRequestException({ error: '该申请已退回补正，待供应商重新提交后才能审核', code: 'AWAITING_RESUBMISSION' });
    }
    if (supplier.status !== 'PENDING') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }
```

reject 乐观锁（:2422）`status: { in: ['PENDING', 'RETURNED'] }` → `status: 'PENDING'`。

- [ ] **Step 4: 跑测试确认通过 + supplier 域回归**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/supplier/supplier-review-status-gate.spec.ts && npx jest src/supplier/
```

Expected: 新 spec 5/5 绿；supplier 域全量绿。

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/src/supplier/supplier-review-status-gate.spec.ts water-erp/apps/api/src/supplier/supplier.service.ts
git -C /Users/qihao/ERP2/ERP commit -m "fix(supplier): 注册审批补正中禁审——approve/reject 收紧到仅 PENDING（RETURNED 一律 400 AWAITING_RESUBMISSION），乐观锁同步收紧；杜绝悬挂态再造（2026-11-23 用户裁定）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 前端显示口径（详情页 + 审批中心）

**Files:**
- Modify: `apps/web/src/app/(main)/supplier/[id]/page.tsx`（:334 后新增 canReview；:378 padding；:1281 审批操作栏条件）
- Modify: `apps/web/src/components/supplier/review-center-modal.tsx`（:571 canActOnStage）

**Interfaces:**
- Consumes: Task 1 的后端闸（前端为提示性收口，服务端权威）
- 页面既有：`currentUser`（AuthUser，:117）、`supplier.reviewStage`、`isPending`（:334，信息性用途不动）

- [ ] **Step 1: 详情页 canReview**

:334 `const isPending = ...` 之后新增：

```ts
  // 审批操作栏口径（2026-11-23 裁定）：PENDING 且轮到我的级才显示——补正中（RETURNED）
  // 只读（信息区保留）；已流转他级不显示（后端 403/400 兜底）。leader 代初审细分归审批中心。
  const myStage = (supplier.reviewStage ?? 'STAFF') as string;
  const canReview = supplier.status === 'PENDING' && (
    (currentUser?.role === 'admin' && myStage === 'ADMIN') ||
    (currentUser?.role === 'leader' && myStage === 'LEADER') ||
    (currentUser?.role === 'staff' && myStage === 'STAFF')
  );
```

- [ ] **Step 2: 两处消费点替换**

:378 `${isPending && isAdmin ? 'pb-24' : ''}` → `${canReview ? 'pb-24' : ''}`；
:1281 `{isPending && isAdmin && (` → `{canReview && (`。

- [ ] **Step 3: 审批中心操作可用性**

`review-center-modal.tsx` :571 `const canActOnStage = isMyStage;` 替换为：

```ts
  // 补正中（RETURNED）只读（2026-11-23 裁定）：操作区叠加 PENDING 条件——重提后回被退回级可续审
  const canActOnStage = (s: Supplier) => isMyStage(s) && s.status === 'PENDING';
```

- [ ] **Step 4: 验证 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && npx tsc --noEmit && pnpm test && pnpm lint 2>&1 | tail -1
```

Expected: tsc 0；测试全绿；lint 0 errors（基线 947 警告量级不变或更少）。然后：

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/web/src/app/\(main\)/supplier/\[id\]/page.tsx water-erp/apps/web/src/components/supplier/review-center-modal.tsx
git -C /Users/qihao/ERP2/ERP commit -m "fix(supplier): 审批面按级显示——详情页审批操作栏/审批中心操作区仅 PENDING 且轮到本人级；补正中只读（总览待审核保留展示，用户裁定 2026-11-23）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 悬挂态修正脚本 + dev 验证 + 数据复位

**Files:**
- Create: `apps/api/scripts/fix-returned-stage-drift.ts`

**Interfaces:**
- Produces: 独立脚本（`npx tsx scripts/fix-returned-stage-drift.ts [--dry-run]`），无代码消费方

- [ ] **Step 1: 写脚本**

```ts
/**
 * 一次性修正（2026-11-23，spec §3.3）：RETURNED 状态被 approve 推进级产生的悬挂态
 * （status=RETURNED + reviewStage 已越过最后一次退回记录的级；生产实录 SUP-000016）。
 * 修正 = reviewStage 拨回最后一次 RETURNED 记录的 stage（供应商补正链不断，重提后从该级续审）；
 * 通过留痕保留，另写 AuditLog 修正留痕。幂等：目标级已一致跳过。--dry-run 只列清单不写库。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const returned = await prisma.supplier.findMany({
    where: { status: 'RETURNED' },
    select: { id: true, name: true, supplierNo: true, reviewStage: true, userId: true },
  });
  let fixed = 0;
  for (const s of returned) {
    const records = await prisma.supplierApprovalRecord.findMany({
      where: { supplierId: s.id, action: { in: ['RETURNED', 'APPROVED'] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, stage: true, createdAt: true },
    });
    const lastReturned = [...records].reverse().find((r) => r.action === 'RETURNED');
    if (!lastReturned) continue;
    const approvedAfter = records.some((r) => r.action === 'APPROVED' && r.createdAt > lastReturned.createdAt);
    if (!approvedAfter) continue;
    const target = lastReturned.stage ?? 'STAFF';
    if ((s.reviewStage ?? 'STAFF') === target) continue; // 幂等
    console.log(`${dryRun ? '[dry-run] ' : ''}${s.supplierNo} ${s.name}: reviewStage ${s.reviewStage ?? 'STAFF'} → ${target}`);
    if (dryRun) { fixed++; continue; }
    await prisma.$transaction([
      prisma.supplier.update({ where: { id: s.id }, data: { reviewStage: target } }),
      prisma.auditLog.create({
        data: {
          userId: s.userId,
          action: 'SUPPLIER_STAGE_ROLLBACK_FIX',
          resourceType: '供应商注册审批',
          resourceId: s.supplierNo ?? s.id,
          details: {
            reason: '悬挂态修正（RETURNED 被 approve 推进级，2026-11-23 修复前存量）',
            from: s.reviewStage, to: target,
          },
        },
      }),
    ]);
    fixed++;
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}完成：检出并${dryRun ? '列出' : '修正'} ${fixed} 条悬挂态`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: dev 验证（合成悬挂态 → 干跑 → 执行 → 复跑幂等）**

dev 库当前有合成悬挂态（蜀工：RETURNED/LEADER）：

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api
npx tsx scripts/fix-returned-stage-drift.ts --dry-run   # 期望列出蜀工 LEADER→STAFF
npx tsx scripts/fix-returned-stage-drift.ts             # 执行修正
npx tsx scripts/fix-returned-stage-drift.ts             # 复跑：0 条（幂等）
```

DB 复核：`SELECT "reviewStage" FROM "Supplier" WHERE id='ca7634a7eb2f8aed8d5f464';` 期望 STAFF。

- [ ] **Step 3: dev 种子数据复位（清除本会话调试痕迹）**

```bash
docker exec water-erp-postgres psql -U water_erp -d water_erp -c "
UPDATE \"Supplier\" SET status='PENDING', \"reviewStage\"='STAFF', \"returnReason\"=NULL WHERE id IN ('ca7634a7eb2f8aed8d5f464','c7562bf161b1d39b7075dd2');
DELETE FROM \"AuditLog\" WHERE action='SUPPLIER_STAGE_ROLLBACK_FIX';
DELETE FROM \"FileAsset\" WHERE id='repro-license-01';"
```

（c7562bfi 川能行经本会话补正流已重写子表——属可接受 dev 数据，状态复位即可。）

- [ ] **Step 4: API 冒烟（闸生效验证）**

```bash
TOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login -H "Content-Type: application/json" -H "X-Portal: web" -d '{"username":"Swhi-CGZX-05","password":"Swhi-CGZX-05@2026"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
curl -s -w "\nHTTP %{http_code}\n" -X POST "http://localhost:4001/api/supplier/ca7634a7eb2f8aed8d5f464/approve" -H "Content-Type: application/json" -H "X-Portal: web" -H "X-Web-Token: $TOKEN" -d '{"reason":"冒烟"}'
# dev API watch 已热载，预期：先复位为 RETURNED 测 400 AWAITING_RESUBMISSION，再复位 PENDING 测正常流转
```

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/scripts/fix-returned-stage-drift.ts
git -C /Users/qihao/ERP2/ERP commit -m "fix(supplier): 悬挂态一次性修正脚本——RETURNED 被 approve 推进级者拨回最后一次退回记录的级（幂等+--dry-run+AuditLog 留痕）；生产执行前先干跑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 生产执行清单（人工，部署后）

- [ ] 部署最新 main 到生产（本修复 + 消除 404 触发面）。
- [ ] `npx tsx scripts/fix-returned-stage-drift.ts --dry-run` 核对清单（应含 SUP-000016 成都思诺旺：LEADER→STAFF）→ 去掉 --dry-run 执行。
- [ ] 生产复核：思诺旺在总览待审核「退回补正」仍可见（只读）、详情页无审批操作栏；补正重提后 staff 可续审。
- [ ] 若「通过/拒绝 404」复发：取浏览器 Network 面板失败请求的 URL+响应体定案（当前最新代码全状态实测不可复现）。
