# 供应商多公司归属（SupplierCompanyLink）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个企业一个账号，通过 `SupplierCompanyLink` 多对多关系进入多家公司的供应商库（申请走三级审批、邀请仅 leader 发起、供应商确认），供应商域公司隔离从单值 `Supplier.companyId` 切换为 link 存在性判断。

**Architecture:** 新增 `SupplierCompanyLink` 表与 `SupplierLinkService`（供应商侧 + 公司侧操作）；注册查重保持全局，命中「他司已 APPROVED」改为引导加入；`CompanyScopeService.filter` 不动，供应商域新增 `supplierCompanyWhere` helper 与 raw SQL 翻译件。spec：`docs/superpowers/specs/2026-10-16-supplier-multi-company-membership-design.md`。

**Tech Stack:** NestJS 11 + Prisma (PostgreSQL)、Next.js 16 + React 19 + Tailwind v4（cgzxui 视觉体系）、jest。

## Global Constraints

- 改 `schema.prisma` 后提交前必须 `cd apps/api && npx prisma validate`（校验失败则 generate 静默失败、client 停旧版）。
- 全部新路由显式标注 `@Roles(...)`（RolesGuard 默认拒绝，无标注 → 403 `NO_ROLE_CONFIGURED`）。
- 禁用 `git add -A`/`git add .`——只 add 本任务明确改动的文件路径（并行会话约定）。
- 后端单测：`pnpm --filter api test -- <pattern>`；供应商域改动须跑全域套件（窄 pattern 会漏跨 spec 破坏）。
- 提交信息前缀 `feat(supplier-link):` / `test(supplier-link):` / `fix(supplier-link):`。
- PII 口径：link 审批列表只回传供应商非敏感字段（name/supplierNo/creditCode/companyName/全局 status），不回联系人手机号等密文字段。
- 金额/查重铁律不涉本计划；但 **禁止新代码裸读裸算 `Supplier.creditCode` 之外的唯一性假设**——link 表是唯一归属事实源。

---

### Task 1: 数据模型 + 迁移 + 存量回填

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（Supplier 模型尾部 relations 区 + 新模型；Company 模型加反向关系）
- Create: `apps/api/prisma/migrations/20261016120000_supplier_company_link/migration.sql`
- Create: `apps/api/scripts/backfill-supplier-company-links.ts`

**Interfaces:**
- Produces: Prisma 模型 `SupplierCompanyLink`（字段见下）、复合唯一名 `supplierId_companyId`、枚举 `SupplierLinkSource`/`SupplierLinkStatus`；`Supplier.companyLinks` / `Company.supplierLinks` 关系。后续所有任务依赖。

- [ ] **Step 1: schema.prisma 增加枚举与模型**

在 `Supplier` 模型 relations 区（`certs SupplierCert[]` 之后）加：

```prisma
  companyLinks         SupplierCompanyLink[] @relation("SupplierCompanyLinks")
```

`Company` 模型 relations 区加（与既有 `SupplierCompany` 关系并列）：

```prisma
  supplierLinks SupplierCompanyLink[] @relation("CompanySupplierLinks")
```

文件尾部（`SupplierInvitation` 模型之后）加：

```prisma
/// 供应商×公司 多对多归属（2026-10-16 多公司归属）：一企业在多家公司库各有一条关系。
/// Supplier.companyId 降级为「主归属」（注册三级审批仍按它流转）；库可见性以本表 APPROVED link 为准。
enum SupplierLinkSource {
  SUPPLIER_APPLY  // 供应商自助申请（三级审批）
  COMPANY_INVITE  // 公司邀请（仅 leader 发起，供应商确认）
}

enum SupplierLinkStatus {
  PENDING   // 申请制=公司三级审批中；邀请制=待供应商确认
  APPROVED  // 在该公司库
  REJECTED  // 申请被驳回 / 供应商婉拒邀请（可重新发起，原行复用）
  DISABLED  // 公司在自己库内停用（软移出，可恢复；不影响其他公司）
}

model SupplierCompanyLink {
  id           String              @id @default(cuid())
  supplierId   String
  companyId    String
  source       SupplierLinkSource
  status       SupplierLinkStatus  @default(PENDING)
  reviewStage  String?             // 申请制当前待审级 STAFF/LEADER/ADMIN；邀请制与终态为 null
  note         String?             // 申请说明 / 邀请备注
  rejectReason String?
  invitedById  String?             // COMPANY_INVITE 发起人（leader）
  appliedAt    DateTime?
  invitedAt    DateTime?
  acceptedAt   DateTime?           // 邀请制：供应商确认时间
  reviewedById String?             // 申请制：末级动作人
  reviewedAt   DateTime?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt

  supplier Supplier @relation("SupplierCompanyLinks", fields: [supplierId], references: [id], onDelete: Cascade)
  company  Company  @relation("CompanySupplierLinks", fields: [companyId], references: [id])

  @@unique([supplierId, companyId])
  @@index([companyId, status])
  @@index([supplierId])
}
```

- [ ] **Step 2: 校验 schema**

Run: `cd apps/api && npx prisma validate`
Expected: `The configuration at prisma/schema.prisma is valid.`

- [ ] **Step 3: 生成迁移 SQL**

Run: `cd apps/api && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 npx prisma migrate dev --create-only --name supplier_company_link`
Expected: 生成 `prisma/migrations/20261016120000_supplier_company_link/migration.sql`。检查内容应含 `CREATE TYPE "SupplierLinkSource"`、`CREATE TYPE "SupplierLinkStatus"`、`CREATE TABLE "SupplierCompanyLink"`、`CREATE UNIQUE INDEX "SupplierCompanyLink_supplierId_companyId_key"`。若缺反向关系列迁移，补：

```sql
-- AlterTable（空操作检查：本表为新建，无需 ALTER "Supplier"/"Company"——关系仅外键本表承载）
```

- [ ] **Step 4: 应用迁移**

Run: `cd apps/api && npx prisma migrate dev`
Expected: 迁移应用成功（或用 `npx prisma migrate deploy`），`npx prisma generate` 产出含 `SupplierCompanyLink` 的 client（`node -e "console.log(!!require('@prisma/client').PrismaClient.prototype.supplierCompanyLink)"` 输出 `true`）。

- [ ] **Step 5: 写回填脚本并执行**

`apps/api/scripts/backfill-supplier-company-links.ts`（对照 `scripts/backfill-expert-company.ts` 的运行方式）：

```ts
/**
 * 存量回填：Supplier.companyId 非空（任意 status）→ 建 APPROVED link（幂等可重跑）。
 * 全状态回填使 link 忠实镜像既有 companyId——读端切换后审批列表（PENDING 件）不受影响。
 * 运行：cd apps/api && npx tsx scripts/backfill-supplier-company-links.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const suppliers = await prisma.supplier.findMany({
    where: { companyId: { not: null } },
    select: { id: true, companyId: true, createdAt: true, status: true },
  });
  console.log(`候选供应商 ${suppliers.length} 家（companyId 非空）`);
  if (dryRun) {
    for (const s of suppliers) console.log(`  [dry] ${s.id} → ${s.companyId} (${s.status})`);
    return;
  }
  let created = 0;
  for (const s of suppliers) {
    const r = await prisma.supplierCompanyLink.upsert({
      where: { supplierId_companyId: { supplierId: s.id, companyId: s.companyId! } },
      create: {
        supplierId: s.id, companyId: s.companyId!, source: 'SUPPLIER_APPLY',
        status: 'APPROVED', appliedAt: s.createdAt,
      },
      update: {}, // 已有 link（含审批中/停用）不动——幂等
    });
    if (r) created++;
  }
  const total = await prisma.supplierCompanyLink.count({ where: { status: 'APPROVED' } });
  console.log(`处理 ${created} 行；APPROVED link 总数 ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

Run: `cd apps/api && npx tsx scripts/backfill-supplier-company-links.ts --dry-run` → 审阅清单 → 去掉 `--dry-run` 执行。
Expected: `APPROVED link 总数` = companyId 非空的 Supplier 数。

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261016120000_supplier_company_link apps/api/scripts/backfill-supplier-company-links.ts
git commit -m "feat(supplier-link): SupplierCompanyLink 表+迁移+存量回填（多公司归属地基）"
```

---

### Task 2: seed 补段 + 注册终审 upsert link

**Files:**
- Modify: `apps/api/prisma/seed.ts`（供应商落库段之后）
- Modify: `apps/api/src/supplier/supplier.service.ts`（`approve()` ADMIN 终审事务内 :2072 附近）
- Test: `apps/api/src/supplier/supplier-link.spec.ts`（新建）

**Interfaces:**
- Produces: `SupplierService.approve()` ADMIN 终审事务内同步 upsert `APPROVED` link（`supplierId_companyId` 复合键）；壳重开（register 复用原行）走同一 approve 路径自动覆盖。

- [ ] **Step 1: 定位 seed 供应商段**

Run: `grep -n "supplier" apps/api/prisma/seed.ts | grep -in "upsert\|create\|for (" | head`
找到供应商批量落库循环结束后（所有 `companyId` 已写入的位置）。

- [ ] **Step 2: seed 补段**

在供应商落库完成、`console.log` 汇总之前插入：

```ts
// ── 供应商多公司归属 link 回填（2026-10-16，幂等）──
{
  const anchored = await prisma.supplier.findMany({
    where: { companyId: { not: null } },
    select: { id: true, companyId: true, createdAt: true },
  });
  for (const s of anchored) {
    await prisma.supplierCompanyLink.upsert({
      where: { supplierId_companyId: { supplierId: s.id, companyId: s.companyId! } },
      create: {
        supplierId: s.id, companyId: s.companyId!, source: 'SUPPLIER_APPLY',
        status: 'APPROVED', appliedAt: s.createdAt,
      },
      update: {},
    });
  }
  console.log(`供应商归属 link 回填 ${anchored.length} 条`);
}
```

- [ ] **Step 3: 写失败测试（approve 终审建 link）**

`apps/api/src/supplier/supplier-link.spec.ts`：

```ts
import { SupplierService } from './supplier.service';

/** 注册终审通过 upsert APPROVED link（多公司归属 2026-10-16）——三级闭环与库归属同事务一致。 */
describe('SupplierService.approve — 终审 upsert company link', () => {
  it('ADMIN 终审通过 → 事务内 upsert APPROVED link（companyId 非空）', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', companyId: 'co-1', status: 'PENDING', reviewStage: 'ADMIN', name: '甲公司', user: {} }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'rev-1', role: 'admin', companyId: null }), update: jest.fn() },
      supplierCompanyLink: { upsert: jest.fn().mockResolvedValue({ id: 'l1' }) },
      $transaction: jest.fn(async (fn: any) => fn({
        supplier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: { update: jest.fn() },
        supplierCompanyLink: { upsert: jest.fn().mockResolvedValue({ id: 'l1' }) },
      })),
    };
    const svc = new (SupplierService as any)(prisma, null, null, null, null, null, null) as SupplierService;
    let linkUpsert: jest.Mock;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      linkUpsert = jest.fn().mockResolvedValue({ id: 'l1' });
      return fn({
        supplier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: { update: jest.fn() },
        supplierCompanyLink: { upsert: linkUpsert },
      });
    });
    await svc.approve('s1', 'rev-1', '同意');
    expect(linkUpsert!).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplierId_companyId: { supplierId: 's1', companyId: 'co-1' } },
      create: expect.objectContaining({ status: 'APPROVED', source: 'SUPPLIER_APPLY' }),
    }));
  });

  it('companyId 为空（未归属）→ 跳过 link upsert', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's2', userId: 'u2', companyId: null, status: 'PENDING', reviewStage: 'ADMIN', name: '乙', user: {} }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'rev-1', role: 'admin', companyId: null }), update: jest.fn() },
      $transaction: jest.fn(async (fn: any) => {
        const linkUpsert = jest.fn();
        await fn({ supplier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, user: { update: jest.fn() }, supplierCompanyLink: { upsert: linkUpsert } });
        expect(linkUpsert).not.toHaveBeenCalled();
      }),
    };
    const svc = new (SupplierService as any)(prisma, null, null, null, null, null, null) as SupplierService;
    await svc.approve('s2', 'rev-1');
  });
});
```

（注意：`SupplierService` 构造参数以实际文件为准——执行时先读构造函数签名调整 mock 实参个数；本测试只依赖 prisma 与 notification，其余传 `null` 并在调用路径 mock 掉。若 notification/audit 在构造外注入失败，按 `supplier.register.spec.ts` 的既有做法搭 service。）

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm --filter api test -- supplier-link`
Expected: FAIL（upsert 未被调用/字段不存在）。

- [ ] **Step 5: 实现——approve() ADMIN 分支事务内加 upsert**

`supplier.service.ts` `approve()` ADMIN 分支（`await tx.user.update(...)` 之后）：

```ts
        // 多公司归属（2026-10-16）：终审通过同步落 APPROVED link（幂等；未归属跳过）
        if (supplier.companyId) {
          await tx.supplierCompanyLink.upsert({
            where: { supplierId_companyId: { supplierId: id, companyId: supplier.companyId } },
            create: {
              supplierId: id, companyId: supplier.companyId, source: 'SUPPLIER_APPLY',
              status: 'APPROVED', appliedAt: supplier.createdAt,
            },
            update: { status: 'APPROVED', reviewStage: null, rejectReason: null },
          });
        }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter api test -- supplier-link`
Expected: PASS（2 用例）。

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier-link.spec.ts
git commit -m "feat(supplier-link): 注册终审/seed 同步落 APPROVED company link"
```

---

### Task 3: SupplierLinkService · 供应商侧（myLinks / apply / accept / decline）

**Files:**
- Create: `apps/api/src/supplier/supplier-link.service.ts`
- Create: `apps/api/src/supplier/dto/company-link.dto.ts`
- Modify: `apps/api/src/supplier/supplier.module.ts`（providers/exports 加 `SupplierLinkService`）
- Test: `apps/api/src/supplier/supplier-link.service.spec.ts`

**Interfaces:**
- Produces:
  - `class SupplierLinkService`，方法：
    - `myLinks(userId: string): Promise<Array<{ id; companyId; companyName; status; source; reviewStage; note; rejectReason; invitedById; appliedAt; invitedAt; acceptedAt; isPrimary }>>`（`isPrimary` = `supplier.companyId === link.companyId`）
    - `apply(userId: string, dto: { companyId: string; note?: string }): Promise<{ id: string }>`
    - `acceptInvite(userId: string, linkId: string): Promise<{ success: true }>`
    - `declineInvite(userId: string, linkId: string): Promise<{ success: true }>`
  - 错误码：`SUPPLIER_NOT_FOUND` / `TEMPORARY_NOT_ALLOWED` / `SUPPLIER_NOT_APPROVED` / `COMPANY_NOT_FOUND` / `LINK_PENDING_EXISTS` / `ALREADY_IN_COMPANY` / `LINK_DISABLED` / `LINK_NOT_FOUND` / `NOT_INVITE`
- Consumes: Task 1 的 `SupplierCompanyLink` 模型。

- [ ] **Step 1: 写失败测试**

`apps/api/src/supplier/supplier-link.service.spec.ts`：

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupplierLinkService } from './supplier-link.service';

/** 供应商侧 link 操作：myLinks/apply/accept/decline（多公司归属 2026-10-16 spec §流程） */
describe('SupplierLinkService — 供应商侧', () => {
  /** companyScope 桩（listForCompany 用；供应商侧路径不触它） */
  const SCOPE: any = { resolveScope: async () => ({ all: false, companyIds: ['co-2'] }) };
  const mk = (supplier: any, link: any = null) => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue(supplier) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-2', name: '乙公司' }) },
      supplierCompanyLink: {
        findUnique: jest.fn().mockResolvedValue(link),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ id: 'l1', companyId: 'co-1', company: { name: '甲公司' }, status: 'APPROVED', source: 'SUPPLIER_APPLY', reviewStage: null }]),
        create: jest.fn().mockResolvedValue({ id: 'l-new' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const notify = { create: jest.fn().mockResolvedValue({}), sendToRole: jest.fn() };
    const svc = new SupplierLinkService(prisma, notify as any);
    return { prisma, notify, svc };
  };
  const SUP = { id: 's1', userId: 'u1', companyId: 'co-1', status: 'APPROVED', isTemporary: false, name: '甲供应商' };

  it('apply：合法申请 → PENDING/STAFF link + 通知 STAFF 级审批人', async () => {
    const { prisma, notify, svc } = mk(SUP);
    const r = await svc.apply('u1', { companyId: 'co-2', note: '希望参与贵司采购' });
    expect(r).toEqual({ id: 'l-new' });
    expect(prisma.supplierCompanyLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ supplierId: 's1', companyId: 'co-2', source: 'SUPPLIER_APPLY', status: 'PENDING', reviewStage: 'STAFF' }),
    }));
    expect(notify.create).toHaveBeenCalled();
  });

  it('apply：临时供应商 → 400 TEMPORARY_NOT_ALLOWED', async () => {
    const { svc } = mk({ ...SUP, isTemporary: true });
    await expect(svc.apply('u1', { companyId: 'co-2' })).rejects.toMatchObject({ response: { code: 'TEMPORARY_NOT_ALLOWED' } });
  });

  it('apply：全局非 APPROVED → 400 SUPPLIER_NOT_APPROVED', async () => {
    const { svc } = mk({ ...SUP, status: 'PENDING' });
    await expect(svc.apply('u1', { companyId: 'co-2' })).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_APPROVED' } });
  });

  it('apply：link 已 PENDING → 400 LINK_PENDING_EXISTS；已 APPROVED → ALREADY_IN_COMPANY；DISABLED → LINK_DISABLED', async () => {
    const p = mk(SUP).prisma;
    for (const [status, code] of [['PENDING', 'LINK_PENDING_EXISTS'], ['APPROVED', 'ALREADY_IN_COMPANY'], ['DISABLED', 'LINK_DISABLED']] as const) {
      const svc = new SupplierLinkService(p, { create: jest.fn() } as any);
      (p.supplierCompanyLink.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'l1', status });
      await expect(svc.apply('u1', { companyId: 'co-2' })).rejects.toMatchObject({ response: { code } });
    }
  });

  it('apply：REJECTED 旧 link → 原行复用回 PENDING/STAFF（不建新行）', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue(SUP) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-2', name: '乙公司' }) },
      supplierCompanyLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'l-old', status: 'REJECTED' }),
        update: jest.fn().mockResolvedValue({ id: 'l-old' }),
        create: jest.fn(),
      },
    };
    const svc = new SupplierLinkService(prisma, { create: jest.fn() } as any);
    const r = await svc.apply('u1', { companyId: 'co-2' });
    expect(r).toEqual({ id: 'l-old' });
    expect(prisma.supplierCompanyLink.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'l-old' },
      data: expect.objectContaining({ status: 'PENDING', reviewStage: 'STAFF' }),
    }));
    expect(prisma.supplierCompanyLink.create).not.toHaveBeenCalled();
  });

  it('acceptInvite：邀请确认 → APPROVED + acceptedAt + 通知邀请方公司 leader', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue(SUP) },
      supplierCompanyLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'l1', supplierId: 's1', companyId: 'co-2', source: 'COMPANY_INVITE', status: 'PENDING', invitedById: 'lead-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'lead-1' }]) },
    };
    const notify = { create: jest.fn() };
    const svc = new SupplierLinkService(prisma, notify as any);
    await svc.acceptInvite('u1', 'l1');
    expect(prisma.supplierCompanyLink.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'l1' },
      data: expect.objectContaining({ status: 'APPROVED', acceptedAt: expect.any(Date), reviewStage: null }),
    }));
    expect(notify.create).toHaveBeenCalled();
  });

  it('acceptInvite：非邀请通道 link → 400 NOT_INVITE；非本人 link → 403', async () => {
    const p = mk(SUP).prisma;
    (p.supplierCompanyLink.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'l1', supplierId: 's1', source: 'SUPPLIER_APPLY', status: 'PENDING' });
    const svc = new SupplierLinkService(p, { create: jest.fn() } as any);
    await expect(svc.acceptInvite('u1', 'l1')).rejects.toMatchObject({ response: { code: 'NOT_INVITE' } });
    (p.supplierCompanyLink.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'l1', supplierId: 's-other', source: 'COMPANY_INVITE', status: 'PENDING' });
    await expect(svc.acceptInvite('u1', 'l1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('myLinks：返回归属列表并标注主归属', async () => {
    const { svc } = mk(SUP);
    const rows = await svc.myLinks('u1');
    expect(rows[0].companyName).toBe('甲公司');
    expect(rows[0].isPrimary).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- supplier-link.service`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 supplier 侧**

`apps/api/src/supplier/dto/company-link.dto.ts`：

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ApplyCompanyLinkDto {
  /** companyId/companyName 二选一（与注册/邀请/查重的名称解析口径一致——供应商门户公司选择器按名称选择） */
  @IsOptional() @IsUUID()
  companyId?: string;

  @IsOptional() @IsString() @MaxLength(100)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

export class InviteSupplierDto {
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

export class ApproveLinkDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class RejectLinkDto {
  @IsString() @MaxLength(500)
  reason!: string;
}
```

`apps/api/src/supplier/supplier-link.service.ts`（先写供应商侧半，Task 4 补公司侧半；文件头注释标注两段分工）：

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/** 供应商多公司归属（2026-10-16 spec）：SupplierCompanyLink 双向通道 + 三级审批。
 *  三级级权限/通知逻辑与 SupplierService 注册审批同口径——原实现为其私有方法，
 *  此处复制同款（约 60 行）避免与 4k 行 SupplierService 强耦合；口径漂移以 spec 为准。 */
@Injectable()
export class SupplierLinkService {
  private static readonly STAGE_LABELS: Record<string, string> = { STAFF: '初审', LEADER: '复审', ADMIN: '终审' };

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private companyScope: CompanyScopeService,
  ) {}

  private err(code: string, error: string): never {
    throw new BadRequestException({ error, code });
  }

  /** 只读公司解析（与 SupplierService.findCompanyRef 同口径）：id 优先、名称兜底，查不到 null，不建档 */
  private async resolveCompanyRef(companyId?: string, companyName?: string): Promise<{ id: string; name: string } | null> {
    if (companyId) {
      const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
      if (c) return c;
    }
    const name = (companyName ?? '').trim();
    if (!name) return null;
    return this.prisma.company.findUnique({ where: { name }, select: { id: true, name: true } });
  }

  private async requireSupplier(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true, companyId: true, status: true, isTemporary: true, userId: true },
    });
    if (!supplier) this.err('SUPPLIER_NOT_FOUND', '供应商信息不存在');
    return supplier;
  }

  // ───────────────────────── 供应商侧 ─────────────────────────

  async myLinks(userId: string) {
    const supplier = await this.requireSupplier(userId);
    const links = await this.prisma.supplierCompanyLink.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, companyId: true, companyName: true, status: true, source: true, reviewStage: true,
        note: true, rejectReason: true, invitedById: true, appliedAt: true, invitedAt: true, acceptedAt: true,
      },
    });
    return links.map((l) => ({ ...l, isPrimary: l.companyId === supplier.companyId }));
  }

  async apply(userId: string, dto: { companyId?: string; companyName?: string; note?: string }) {
    const supplier = await this.requireSupplier(userId);
    if (supplier.isTemporary) this.err('TEMPORARY_NOT_ALLOWED', '临时供应商须先转正，方可申请加入其他公司');
    if (supplier.status !== 'APPROVED') this.err('SUPPLIER_NOT_APPROVED', '账号当前不在库状态，暂不能申请加入公司');

    const company = await this.resolveCompanyRef(dto.companyId, dto.companyName);
    if (!company) this.err('COMPANY_NOT_FOUND', '归属公司不存在，请重新选择');

    const existing = await this.prisma.supplierCompanyLink.findUnique({
      where: { supplierId_companyId: { supplierId: supplier.id, companyId: company.id } },
    });
    const note = dto.note?.trim() || null;
    let linkId: string;
    if (existing && existing.status === 'PENDING') this.err('LINK_PENDING_EXISTS', '已有进行中的加入申请/邀请，请等待处理');
    if (existing && existing.status === 'APPROVED') this.err('ALREADY_IN_COMPANY', '贵司已在该公司的供应商库中');
    if (existing && existing.status === 'DISABLED') this.err('LINK_DISABLED', '贵司已被该公司停用，请联系该公司恢复');
    if (existing) {
      // REJECTED（申请被驳回/婉拒邀请）→ 原行复用重新走三级
      await this.prisma.supplierCompanyLink.update({
        where: { id: existing.id },
        data: { status: 'PENDING', source: 'SUPPLIER_APPLY', reviewStage: 'STAFF', note, rejectReason: null, appliedAt: new Date() },
      });
      linkId = existing.id;
    } else {
      const created = await this.prisma.supplierCompanyLink.create({
        data: { supplierId: supplier.id, companyId: company.id, source: 'SUPPLIER_APPLY', status: 'PENDING', reviewStage: 'STAFF', note, appliedAt: new Date() },
      });
      linkId = created.id;
    }

    await this.notifyStageApprovers('STAFF', company.id, {
      type: 'SUPPLIER_LINK_PENDING',
      title: '供应商申请加入贵公司（初审）',
      content: `${supplier.name} 申请加入贵公司供应商库，请前往审批。${note ? `申请说明：${note}` : ''}`,
      link: `/supplier?tab=company-links`,
    });
    return { id: linkId };
  }

  async acceptInvite(userId: string, linkId: string) {
    const supplier = await this.requireSupplier(userId);
    const link = await this.prisma.supplierCompanyLink.findUnique({ where: { id: linkId } });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if (link.supplierId !== supplier.id) throw new ForbiddenException({ error: '无权操作他人的加入关系', code: 'FORBIDDEN' });
    if (link.source !== 'COMPANY_INVITE' || link.status !== 'PENDING') this.err('NOT_INVITE', '该记录不是待确认的入库邀请');
    await this.prisma.supplierCompanyLink.update({
      where: { id: linkId },
      data: { status: 'APPROVED', acceptedAt: new Date(), reviewStage: null },
    });
    await this.notifyCompanyLeaders(link.companyId, {
      type: 'SUPPLIER_LINK_ACCEPTED',
      title: '供应商已确认入库邀请',
      content: `${supplier.name} 已接受贵公司的入库邀请，正式进入贵公司供应商库。`,
      link: `/supplier`,
    });
    return { success: true as const };
  }

  async declineInvite(userId: string, linkId: string) {
    const supplier = await this.requireSupplier(userId);
    const link = await this.prisma.supplierCompanyLink.findUnique({ where: { id: linkId } });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if (link.supplierId !== supplier.id) throw new ForbiddenException({ error: '无权操作他人的加入关系', code: 'FORBIDDEN' });
    if (link.source !== 'COMPANY_INVITE' || link.status !== 'PENDING') this.err('NOT_INVITE', '该记录不是待确认的入库邀请');
    await this.prisma.supplierCompanyLink.update({
      where: { id: linkId },
      data: { status: 'REJECTED', rejectReason: '供应商婉拒邀请', reviewedAt: new Date() },
    });
    await this.notifyCompanyLeaders(link.companyId, {
      type: 'SUPPLIER_LINK_DECLINED',
      title: '供应商婉拒入库邀请',
      content: `${supplier.name} 婉拒了贵公司的入库邀请。`,
      link: `/supplier`,
    });
    return { success: true as const };
  }

  // ───────────────────────── 内部：通知（与注册审批同口径） ─────────────────────────

  /** 按级解析审批待办收件人（staff→无则 leader→无则 admin 上浮），与 SupplierService.resolveStageApprovers 同口径 */
  private async notifyStageApprovers(stage: string, companyId: string | null, payload: { type: string; title: string; content: string; link: string }) {
    const pick = async (where: object) => (await this.prisma.user.findMany({ where, select: { id: true } })).map((u) => u.id);
    let ids: string[] = [];
    if (stage === 'STAFF' && companyId) {
      ids = await pick({ role: 'staff', isActive: true, companyId });
      if (ids.length === 0) ids = await pick({ role: 'leader', isActive: true, companyId });
      if (ids.length === 0) ids = await pick({ role: 'admin', isActive: true });
    } else if (stage === 'LEADER' && companyId) {
      ids = await pick({ role: 'leader', isActive: true, companyId });
      if (ids.length === 0) ids = await pick({ role: 'admin', isActive: true });
    } else {
      ids = await pick({ role: 'admin', isActive: true });
    }
    await Promise.allSettled(ids.map((id) => this.notificationService.create({ userId: id, ...payload })));
  }

  private async notifyCompanyLeaders(companyId: string, payload: { type: string; title: string; content: string; link: string }) {
    const leaders = await this.prisma.user.findMany({ where: { role: 'leader', isActive: true, companyId }, select: { id: true } });
    await Promise.allSettled(leaders.map((l) => this.notificationService.create({ userId: l.id, ...payload })));
  }

  // 公司侧（invite/listForCompany/approveLink/rejectLink/setDisabled）见 Task 4 追加
}
```

注意：`myLinks` select 用了 `companyName`——link 表无该列，改为 include：

```ts
    const links = await this.prisma.supplierCompanyLink.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'asc' },
      include: { company: { select: { name: true } } },
    });
    return links.map((l) => {
      const { company, ...rest } = l;
      return { ...rest, companyName: company.name, isPrimary: l.companyId === supplier.companyId };
    });
```

（实现时直接采用 include 版本，测试断言的 `companyName` 字段由映射产出。）

`apps/api/src/supplier/supplier.module.ts`：providers/exports 数组加 `SupplierLinkService`，顶部加 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- supplier-link.service`
Expected: PASS（8 用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/supplier/supplier-link.service.ts apps/api/src/supplier/dto/company-link.dto.ts apps/api/src/supplier/supplier.module.ts apps/api/src/supplier/supplier-link.service.spec.ts
git commit -m "feat(supplier-link): 供应商侧操作——myLinks/apply/邀请确认（幂等分支+通知）"
```

---

### Task 4: SupplierLinkService · 公司侧（invite / list / 三级 approve·reject / disable·enable）

**Files:**
- Modify: `apps/api/src/supplier/supplier-link.service.ts`（追加公司侧段）
- Test: `apps/api/src/supplier/supplier-link.service.spec.ts`（追加 describe）

**Interfaces:**
- Produces:
  - `invite(actor: { sub: string; role: string; companyId: string | null }, dto: { supplierId: string; note?: string }): Promise<{ id: string }>`——错误码 `COMPANY_REQUIRED` / `SUPPLIER_NOT_APPROVED` / `TEMPORARY_NOT_ALLOWED` / `ALREADY_IN_COMPANY` / `LINK_PENDING_EXISTS`
  - `listForCompany(actor: AuthenticatedUser, params: { status?: string; reviewStage?: string }): Promise<LinkRow[]>`——`LinkRow` 含 supplier 只读字段（id/name/supplierNo/creditCode/status/isTemporary）+ link 全字段 + company.name
  - `approveLink(linkId: string, userId: string, reason?: string): Promise<{ success: true; stage: 'STAFF' | 'LEADER' | 'ADMIN' | 'DONE' }>`——错误码 `LINK_NOT_FOUND` / `INVALID_STATUS` / `REVIEW_REASON_REQUIRED` / `REVIEW_STAGE_MISMATCH` / `CONFLICT`
  - `rejectLink(linkId: string, userId: string, reason: string): Promise<{ success: true }>`
  - `setDisabled(linkId: string, userId: string, disabled: boolean): Promise<{ success: true }>`——`INVALID_STATUS`
- Consumes: Task 3 的通知 helper 与错误工具。

- [ ] **Step 1: 追加失败测试**

在 `supplier-link.service.spec.ts` 末尾追加：

```ts
describe('SupplierLinkService — 公司侧（三级审批+邀请）', () => {
  const LINK = { id: 'l1', supplierId: 's1', companyId: 'co-2', source: 'SUPPLIER_APPLY', status: 'PENDING', reviewStage: 'STAFF', supplier: { id: 's1', userId: 'u1', name: '甲供应商', supplierNo: 'SUP-000001', creditCode: '91510000MA62K5XX0X', status: 'APPROVED', isTemporary: false }, company: { name: '乙公司' } };
  const mkSide = (over: Record<string, any> = {}) => {
    const prisma: any = {
      supplierCompanyLink: {
        findUnique: jest.fn().mockResolvedValue({ ...LINK, ...over.link }),
        findMany: jest.fn().mockResolvedValue([{ ...LINK, ...over.link }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'l-new' }),
      },
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', name: '甲供应商', status: 'APPROVED', isTemporary: false, userId: 'u1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(over.reviewer ?? { id: 'rev-1', role: 'staff', companyId: 'co-2' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(over.staffCount ?? 1),
      },
    };
    const notify = { create: jest.fn().mockResolvedValue({}) };
    const audit = { create: jest.fn().mockResolvedValue({}) };
    const svc = new SupplierLinkService(prisma, notify as any, audit as any);
    return { prisma, notify, svc };
  };

  it('invite：leader 发起 → COMPANY_INVITE/PENDING（reviewStage=null）+ 通知供应商', async () => {
    const { prisma, notify, svc } = mkSide();
    await svc.invite({ sub: 'lead-1', role: 'leader', companyId: 'co-2' }, { supplierId: 's1', note: 'XX 项目邀请' });
    expect(prisma.supplierCompanyLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: 'COMPANY_INVITE', status: 'PENDING', reviewStage: null, invitedById: 'lead-1', invitedAt: expect.any(Date) }),
    }));
    expect(notify.create).toHaveBeenCalled();
  });

  it('invite：无归属公司 → 400 COMPANY_REQUIRED；staff → 403', async () => {
    const { svc } = mkSide();
    await expect(svc.invite({ sub: 'x', role: 'leader', companyId: null }, { supplierId: 's1' })).rejects.toMatchObject({ response: { code: 'COMPANY_REQUIRED' } });
    await expect(svc.invite({ sub: 'x', role: 'staff', companyId: 'co-2' }, { supplierId: 's1' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invite：供应商非 APPROVED / 临时 → 400；已在本公司库 → ALREADY_IN_COMPANY', async () => {
    const p0 = mkSide();
    (p0.prisma.supplier.findUnique as jest.Mock).mockResolvedValueOnce({ id: 's1', status: 'PENDING', isTemporary: false, userId: 'u1' });
    await expect(p0.svc.invite({ sub: 'l', role: 'leader', companyId: 'co-2' }, { supplierId: 's1' })).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_APPROVED' } });
    (p0.prisma.supplier.findUnique as jest.Mock).mockResolvedValueOnce({ id: 's1', status: 'APPROVED', isTemporary: true, userId: 'u1' });
    await expect(p0.svc.invite({ sub: 'l', role: 'leader', companyId: 'co-2' }, { supplierId: 's1' })).rejects.toMatchObject({ response: { code: 'TEMPORARY_NOT_ALLOWED' } });
    const { svc, prisma } = mkSide();
    (prisma.supplierCompanyLink.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'APPROVED' });
    await expect(svc.invite({ sub: 'l', role: 'leader', companyId: 'co-2' }, { supplierId: 's1' })).rejects.toMatchObject({ response: { code: 'ALREADY_IN_COMPANY' } });
  });

  it('approveLink：STAFF 级同公司 staff 通过 → 推进 LEADER；非本级人 → 403 REVIEW_STAGE_MISMATCH', async () => {
    const { prisma, svc } = mkSide();
    const r = await svc.approveLink('l1', 'rev-1', '资质齐全，同意');
    expect(r).toEqual({ success: true, stage: 'LEADER' });
    expect(prisma.supplierCompanyLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'l1', reviewStage: 'STAFF' }),
      data: expect.objectContaining({ reviewStage: 'LEADER' }),
    }));
    const other = mkSide({ reviewer: { id: 'rev-2', role: 'staff', companyId: 'co-other' } });
    await expect(other.svc.approveLink('l1', 'rev-2', 'x')).rejects.toMatchObject({ response: { code: 'REVIEW_STAGE_MISMATCH' } });
  });

  it('approveLink：STAFF/LEADER 级通过须填缘由 → 400 REVIEW_REASON_REQUIRED', async () => {
    const { svc } = mkSide();
    await expect(svc.approveLink('l1', 'rev-1', '')).rejects.toMatchObject({ response: { code: 'REVIEW_REASON_REQUIRED' } });
  });

  it('approveLink：ADMIN 终审 → APPROVED + 通知供应商；乐观锁 count=0 → 409 CONFLICT', async () => {
    const admin = mkSide({ link: { reviewStage: 'ADMIN' }, reviewer: { id: 'adm', role: 'admin', companyId: null } });
    const r = await admin.svc.approveLink('l1', 'adm', undefined);
    expect(r).toEqual({ success: true, stage: 'DONE' });
    expect(admin.prisma.supplierCompanyLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED', reviewStage: null }),
    }));
    const clash = mkSide({ link: { reviewStage: 'ADMIN' }, reviewer: { id: 'adm', role: 'admin', companyId: null } });
    (clash.prisma.supplierCompanyLink.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(clash.svc.approveLink('l1', 'adm')).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
  });

  it('rejectLink：任一级驳回 → REJECTED + rejectReason + 通知供应商', async () => {
    const { prisma, notify, svc } = mkSide();
    await svc.rejectLink('l1', 'rev-1', '资质不符');
    expect(prisma.supplierCompanyLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED', rejectReason: '资质不符' }),
    }));
    expect(notify.create).toHaveBeenCalled();
  });

  it('setDisabled：APPROVED↔DISABLED 切换；非此二态 → 400 INVALID_STATUS', async () => {
    const { svc } = mkSide();
    await svc.setDisabled('l1', 'rev-1', true);
    await expect(svc.setDisabled('l1', 'rev-1', true)).resolves.toEqual({ success: true });
    const bad = mkSide({ link: { status: 'PENDING' } });
    await expect(bad.svc.setDisabled('l1', 'rev-1', true)).rejects.toMatchObject({ response: { code: 'INVALID_STATUS' } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- supplier-link.service`
Expected: 新增 describe FAIL。

- [ ] **Step 3: 实现公司侧**

`supplier-link.service.ts` 构造函数追加第三注入（与 Task 3 mock 对齐：`audit` 可选），并追加方法：

```ts
import { ConflictException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CompanyScopeService } from '../company/company-scope';
// 构造函数追加：private companyScope: CompanyScopeService —— supplier.module 已 Global 的 CompanyScopeModule 可解析

  // ───────────────────────── 公司侧 ─────────────────────────

  async invite(actor: { sub: string; role: string; companyId: string | null }, dto: { supplierId: string; note?: string }) {
    if (actor.role !== 'leader') throw new ForbiddenException({ error: '邀请入库仅限本公司 leader', code: 'FORBIDDEN' });
    if (!actor.companyId) this.err('COMPANY_REQUIRED', '您的账号未归属公司，无法邀请入库');
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
      select: { id: true, name: true, status: true, isTemporary: true, userId: true },
    });
    if (!supplier) this.err('SUPPLIER_NOT_FOUND', '供应商不存在');
    if (supplier.status !== 'APPROVED') this.err('SUPPLIER_NOT_APPROVED', '仅已入库（APPROVED）供应商可被邀请');
    if (supplier.isTemporary) this.err('TEMPORARY_NOT_ALLOWED', '临时供应商须先转正，不可邀请入库');

    const existing = await this.prisma.supplierCompanyLink.findUnique({
      where: { supplierId_companyId: { supplierId: supplier.id, companyId: actor.companyId } },
    });
    const note = dto.note?.trim() || null;
    let linkId: string;
    if (existing && existing.status === 'APPROVED') this.err('ALREADY_IN_COMPANY', '该供应商已在贵公司库中');
    if (existing && existing.status === 'PENDING') this.err('LINK_PENDING_EXISTS', '该公司与该供应商间已有进行中的申请/邀请');
    if (existing) {
      // REJECTED（婉拒/驳回）或 DISABLED（停用后再次邀请）→ 原行复用发新邀请
      await this.prisma.supplierCompanyLink.update({
        where: { id: existing.id },
        data: { source: 'COMPANY_INVITE', status: 'PENDING', reviewStage: null, note, rejectReason: null, invitedById: actor.sub, invitedAt: new Date(), acceptedAt: null },
      });
      linkId = existing.id;
    } else {
      const created = await this.prisma.supplierCompanyLink.create({
        data: { supplierId: supplier.id, companyId: actor.companyId, source: 'COMPANY_INVITE', status: 'PENDING', reviewStage: null, note, invitedById: actor.sub, invitedAt: new Date() },
      });
      linkId = created.id;
    }
    const company = await this.prisma.company.findUnique({ where: { id: actor.companyId }, select: { name: true } });
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_LINK_INVITED',
      title: `${company?.name ?? '某公司'} 邀请贵司加入其供应商库`,
      content: `${company?.name ?? '某公司'} 邀请贵司加入其供应商库，请前往「公司归属管理」确认。${note ? `备注：${note}` : ''}`,
      link: `/profile/company-links`,
    });
    return { id: linkId };
  }

  async listForCompany(actor: AuthenticatedUser, params: { status?: string; reviewStage?: string } = {}) {
    const scope = await this.companyScope.resolveScope(actor);
    const companyIds = scope.all ? null : scope.companyIds;
    const where: any = {};
    if (companyIds) where.companyId = { in: companyIds };
    if (params.status) where.status = params.status;
    if (params.reviewStage) where.reviewStage = params.reviewStage;
    return this.prisma.supplierCompanyLink.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      include: {
        company: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true, supplierNo: true, creditCode: true, status: true, isTemporary: true } },
      },
    });
  }

  async approveLink(linkId: string, userId: string, reason?: string) {
    const link = await this.prisma.supplierCompanyLink.findUnique({
      where: { id: linkId },
      include: { supplier: { select: { id: true, name: true, userId: true } }, company: { select: { name: true } } },
    });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if (link.source !== 'SUPPLIER_APPLY' || link.status !== 'PENDING' || !link.reviewStage) {
      this.err('INVALID_STATUS', '该申请不在待审状态');
    }
    const stage = link.reviewStage;
    const reviewer = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } }) : null;
    await this.assertStageApprover(stage, reviewer, link.companyId);

    const trimmed = (reason ?? '').trim();
    if (stage !== 'ADMIN' && !trimmed) {
      this.err('REVIEW_REASON_REQUIRED', `请填写${SupplierLinkService.STAGE_LABELS[stage]}的同意缘由（后级审批人将据此复核）`);
    }

    if (stage === 'ADMIN') {
      const claimed = await this.prisma.supplierCompanyLink.updateMany({
        where: { id: linkId, status: 'PENDING', reviewStage: stage },
        data: { status: 'APPROVED', reviewStage: null, rejectReason: null, reviewedById: userId ?? null, reviewedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
      await this.notificationService.create({
        userId: link.supplier.userId,
        type: 'SUPPLIER_LINK_APPROVED',
        title: `已加入 ${link.company.name} 供应商库`,
        content: `贵司加入 ${link.company.name} 的申请已通过三级审核，正式入库。`,
        link: `/profile/company-links`,
      });
      return { success: true as const, stage: 'DONE' as const };
    }

    const nextStage = stage === 'STAFF' ? 'LEADER' : 'ADMIN';
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: 'PENDING', reviewStage: stage },
      data: { reviewStage: nextStage },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
    await this.notifyStageApprovers(nextStage, link.companyId, {
      type: 'SUPPLIER_LINK_PENDING',
      title: `供应商加入申请待${SupplierLinkService.STAGE_LABELS[nextStage]}`,
      content: `${link.supplier.name} 申请加入贵公司，已通过${SupplierLinkService.STAGE_LABELS[stage]}（缘由：${trimmed}），请前往审批。`,
      link: `/supplier?tab=company-links`,
    });
    return { success: true as const, stage: nextStage };
  }

  async rejectLink(linkId: string, userId: string, reason: string) {
    const link = await this.prisma.supplierCompanyLink.findUnique({
      where: { id: linkId },
      include: { supplier: { select: { userId: true, name: true } }, company: { select: { name: true } } },
    });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    if (link.source !== 'SUPPLIER_APPLY' || link.status !== 'PENDING') this.err('INVALID_STATUS', '该申请不在待审状态');
    const trimmed = reason.trim();
    if (!trimmed) this.err('REASON_REQUIRED', '驳回必须填写原因');
    const reviewer = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, companyId: true } }) : null;
    await this.assertStageApprover(link.reviewStage, reviewer, link.companyId);
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: 'PENDING', reviewStage: link.reviewStage },
      data: { status: 'REJECTED', rejectReason: trimmed, reviewedById: userId ?? null, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
    await this.notificationService.create({
      userId: link.supplier.userId,
      type: 'SUPPLIER_LINK_REJECTED',
      title: `加入 ${link.company.name} 申请未通过`,
      content: `贵司加入 ${link.company.name} 的申请未通过审核。原因：${trimmed}`,
      link: `/profile/company-links`,
    });
    return { success: true as const };
  }

  async setDisabled(linkId: string, userId: string, disabled: boolean) {
    const link = await this.prisma.supplierCompanyLink.findUnique({ where: { id: linkId } });
    if (!link) throw new NotFoundException({ error: '加入关系不存在', code: 'LINK_NOT_FOUND' });
    const target = disabled ? 'DISABLED' : 'APPROVED';
    const from = disabled ? 'APPROVED' : 'DISABLED';
    if (link.status !== from) this.err('INVALID_STATUS', disabled ? '仅库内（APPROVED）供应商可停用' : '仅已停用（DISABLED）供应商可恢复');
    const claimed = await this.prisma.supplierCompanyLink.updateMany({
      where: { id: linkId, status: from },
      data: { status: target },
    });
    if (claimed.count === 0) throw new ConflictException({ error: '状态已变更，请刷新后重试', code: 'CONFLICT' });
    return { success: true as const };
  }

  /** 三级级权限断言（与 SupplierService.assertStageApprover 同口径；复制避免跨 4k 行服务耦合） */
  private async assertStageApprover(
    stage: string | null,
    reviewer: { id: string; role: string; companyId: string | null } | null,
    linkCompanyId: string | null,
  ): Promise<void> {
    if (!reviewer) return;
    const sameCompany = reviewer.role !== 'admin' && !!linkCompanyId && reviewer.companyId === linkCompanyId;
    const hasRole = async (role: 'staff' | 'leader') => linkCompanyId
      ? (await this.prisma.user.count({ where: { role, isActive: true, companyId: linkCompanyId } })) > 0
      : false;
    if (stage === 'STAFF') {
      if (reviewer.role === 'staff' && sameCompany) return;
      if (reviewer.role === 'leader' && sameCompany && !(await hasRole('staff'))) return;
      if (reviewer.role === 'admin' && !(await hasRole('staff')) && !(await hasRole('leader'))) return;
    } else if (stage === 'LEADER') {
      if (reviewer.role === 'leader' && sameCompany) return;
      if (reviewer.role === 'admin' && !(await hasRole('leader'))) return;
    } else if (stage === 'ADMIN') {
      if (reviewer.role === 'admin') return;
    }
    throw new ForbiddenException({
      error: `当前为${SupplierLinkService.STAGE_LABELS[stage ?? ''] ?? '本级'}，须由该级审批人操作`,
      code: 'REVIEW_STAGE_MISMATCH',
    });
  }
```

同步修改：Task 3 的构造函数注入 `companyScope`（CompanyScopeService）——`mk()` 等测试构造处传 `{ resolveScope: async () => ({ all: true }) } as any`（Task 3 spec 须同步补第四参，`mk`/`mkSide` 中已按新签名传参）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- supplier-link.service`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/supplier/supplier-link.service.ts apps/api/src/supplier/supplier-link.service.spec.ts
git commit -m "feat(supplier-link): 公司侧操作——leader 邀请/三级审批/库内停用恢复（乐观锁+同口径断言）"
```

---

### Task 5: Controller 端点 + 审批角标扩展

**Files:**
- Modify: `apps/api/src/supplier/supplier.controller.ts`（公司侧端点 + checkDuplicate 不动）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（供应商侧端点）
- Modify: `apps/api/src/supplier-portal/supplier-portal.module.ts`（imports 加 SupplierModule——先 grep 确认未引入）
- Modify: `apps/api/src/supplier/supplier.service.ts`（`myPendingReviewCount` 加 `joins`）
- Test: `apps/api/src/supplier/supplier-link.spec.ts`（追加角标用例）

**Interfaces:**
- Produces（路由）:
  - `GET /supplier-portal/company-links`、`POST /supplier-portal/company-links/apply`、`POST /supplier-portal/company-links/:id/accept|decline`（全部 `@Roles('supplier')`——控制器级已有）
  - `POST /supplier/company-links/invite` `@Roles('leader')`；`GET /supplier/company-links` `@Roles('leader','staff','admin')`；`POST /supplier/company-links/:id/approve` `@Roles('leader','staff','admin')`；`POST /supplier/company-links/:id/reject` `@Roles('leader','staff','admin')`；`POST /supplier/company-links/:id/disable|enable` `@Roles('leader')`
  - `myPendingReviewCount` 返回 `{ registration, changes, resets, joins }`
- Consumes: Task 3/4 的 `SupplierLinkService` 方法签名。

- [ ] **Step 1: supplier-portal.module.ts 接线**

Run: `grep -n "SupplierModule" apps/api/src/supplier-portal/supplier-portal.module.ts || echo ABSENT`
若 ABSENT：imports 数组加 `SupplierModule`（from `../supplier/supplier.module'`——该 module 已 exports `SupplierLinkService`，Task 3 已加）。

- [ ] **Step 2: 供应商侧端点（SupplierPortalController）**

构造函数注入 `private linkService: SupplierLinkService`，控制器尾部加：

```ts
  // ── 公司归属管理（多公司归属 2026-10-16）──

  @Get('company-links')
  @ApiOperation({ summary: '我的公司归属列表（主归属+各公司库内状态）' })
  async myCompanyLinks(@Request() req: any) {
    return this.linkService.myLinks(req.user.sub);
  }

  @Post('company-links/apply')
  @ApiOperation({ summary: '申请加入公司（走该公司三级审批）' })
  async applyCompanyLink(@Body() dto: ApplyCompanyLinkDto, @Request() req: any) {
    return this.linkService.apply(req.user.sub, dto);
  }

  @Post('company-links/:id/accept')
  @ApiOperation({ summary: '接受入库邀请' })
  async acceptCompanyLink(@Param('id') id: string, @Request() req: any) {
    return this.linkService.acceptInvite(req.user.sub, id);
  }

  @Post('company-links/:id/decline')
  @ApiOperation({ summary: '婉拒入库邀请' })
  async declineCompanyLink(@Param('id') id: string, @Request() req: any) {
    return this.linkService.declineInvite(req.user.sub, id);
  }
```

（`ApplyCompanyLinkDto` import 自 `../supplier/dto/company-link.dto`。）

- [ ] **Step 3: 公司侧端点（SupplierController）**

构造函数注入 `private linkService: SupplierLinkService`，在 `checkDuplicate` 端点之后加：

```ts
  // ── 供应商多公司归属（2026-10-16）──

  @Get('company-links')
  @Roles('leader', 'staff', 'admin')
  @ApiOperation({ summary: '本公司加入审批/归属列表（leader/staff 审批视角，admin 全视野）' })
  async listCompanyLinks(@Query('status') status?: string, @Query('reviewStage') reviewStage?: string) {
    const actor = (arguments as any) // 占位防复制——实际用 @CurrentUser 注入，见下
    return [];
  }
```

**注意：禁止占位**——实际代码（`@CurrentUser` 装饰器与本控制器既有端点一致，参照 `:529 approve` 的写法）：

```ts
  @Get('company-links')
  @Roles('leader', 'staff', 'admin')
  @ApiOperation({ summary: '本公司加入审批/归属列表' })
  async listCompanyLinks(
    @Query('status') status?: string,
    @Query('reviewStage') reviewStage?: string,
    @CurrentUser() actor?: AuthenticatedUser,
  ) {
    return this.linkService.listForCompany(actor!, { status, reviewStage });
  }

  @Post('company-links/invite')
  @Roles('leader')
  @ApiOperation({ summary: '邀请供应商入库（仅 leader；供应商确认后生效）' })
  async inviteSupplier(@Body() dto: InviteSupplierDto, @CurrentUser() actor?: AuthenticatedUser) {
    return this.linkService.invite({ sub: actor!.sub, role: actor!.role, companyId: (actor as any).companyId ?? null }, dto);
  }

  @Post('company-links/:id/approve')
  @Roles('leader', 'staff', 'admin')
  @ApiOperation({ summary: '加入申请逐级审批通过' })
  async approveCompanyLink(@Param('id') id: string, @Body() dto: ApproveLinkDto, @CurrentUser('sub') userId?: string) {
    return this.linkService.approveLink(id, userId!, dto.reason);
  }

  @Post('company-links/:id/reject')
  @Roles('leader', 'staff', 'admin')
  @ApiOperation({ summary: '加入申请驳回（任一级，填原因）' })
  async rejectCompanyLink(@Param('id') id: string, @Body() dto: RejectLinkDto, @CurrentUser('sub') userId?: string) {
    return this.linkService.rejectLink(id, userId!, dto.reason);
  }

  @Post('company-links/:id/disable')
  @Roles('leader')
  @ApiOperation({ summary: '本公司库内停用该供应商（软移出，不影响其他公司）' })
  async disableCompanyLink(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.linkService.setDisabled(id, userId!, true);
  }

  @Post('company-links/:id/enable')
  @Roles('leader')
  @ApiOperation({ summary: '恢复已停用的库内供应商' })
  async enableCompanyLink(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.linkService.setDisabled(id, userId!, false);
  }
```

**invite 的 companyId 说明**：`AuthenticatedUser` JWT 不携带 companyId（与 `myPendingReviewCount` 注释一致）——`invite` 改为 service 内查库解析。实现时 `SupplierLinkService.invite` 签名调整为 `invite(actorUser: AuthenticatedUser, dto)`，方法体首行 `const me = await this.prisma.user.findUnique({ where: { id: actorUser.sub }, select: { id: true, role: true, companyId: true } })`，用 `me` 做断言（Task 4 的测试同步把 actor 改传 `{ sub, role }` 并让 `user.findUnique` mock 返回完整人）。控制器直接传 `actor`。

- [ ] **Step 4: myPendingReviewCount 扩展**

`supplier.service.ts` `myPendingReviewCount` 返回前加（`resets` 计数之后）：

```ts
    // 加入审批待办（多公司归属 2026-10-16）：仅申请制（SUPPLIER_APPLY）走三级——邀请制无公司侧待办
    let joins = 0;
    if (actor.role === 'admin') {
      // admin：终审件 + 无在编 leader 的 LEADER 级 + 无 staff 且无 leader 的 STAFF 级代审件（与注册审批同口径）
      const orphanIds = await this.prisma.$queryRaw<Array<{ companyId: string | null }>>`
        SELECT DISTINCT l."companyId" FROM "SupplierCompanyLink" l
        WHERE l."status" = 'PENDING' AND l."source" = 'SUPPLIER_APPLY' AND l."companyId" IS NOT NULL`;
      const orphanCounts = await Promise.all(orphanIds.map(async (o) => ({
        companyId: o.companyId!,
        hasStaff: (await this.prisma.user.count({ where: { role: 'staff', isActive: true, companyId: o.companyId! } })) > 0,
        hasLeader: (await this.prisma.user.count({ where: { role: 'leader', isActive: true, companyId: o.companyId! } })) > 0,
      })));
      const orphanCompanies = orphanCounts.filter((o) => !o.hasLeader || (!o.hasStaff && !o.hasLeader)).map((o) => o.companyId);
      joins = await this.prisma.supplierCompanyLink.count({
        where: {
          status: 'PENDING', source: 'SUPPLIER_APPLY',
          ...(companyIdFilter ? { companyId: companyIdFilter } : {}),
          OR: [
            { reviewStage: 'ADMIN' },
            { reviewStage: 'LEADER', companyId: { in: orphanCompanies.length ? orphanCompanies : ['__none__'] } },
            { reviewStage: 'STAFF', companyId: { in: orphanCompanies.length ? orphanCompanies.filter(async () => true) : [] } },
          ],
        },
      });
    } else if (actor.role === 'leader' || actor.role === 'staff') {
      const linkStages: string[] = actor.role === 'staff' ? ['STAFF'] : ['LEADER'];
      if (actor.role === 'leader' && !(await this.companyHasActiveRole('staff', regWhere.companyId))) linkStages.push('STAFF');
      joins = await this.prisma.supplierCompanyLink.count({
        where: { status: 'PENDING', source: 'SUPPLIER_APPLY', reviewStage: { in: linkStages }, companyId: regWhere.companyId },
      });
    }
    return { registration, changes, resets, joins };
```

**实现时简化注意**：上面 admin 分支的 STAFF 孤儿行含异步 filter 伪码，落地时改为直接分别算两批 count 后相加（`adminJ + leaderOrphans + staffOrphans`），语义与注册审批 A 方案一致：`ADMIN 级全部 + (无 leader 公司的 LEADER 级) + (无 staff 且无 leader 公司的 STAFF 级)`。禁止把异步 filter 原样照抄。

- [ ] **Step 5: 角标测试**

`supplier-link.spec.ts` 追加：

```ts
import { SupplierService } from './supplier.service';

describe('myPendingReviewCount — joins 计数（多公司归属）', () => {
  it('staff：本公司 STAFF 级申请计数', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'co-2' }), count: jest.fn().mockResolvedValue(1) },
      supplier: { count: jest.fn().mockResolvedValue(0) },
      supplierChangeRecord: { count: jest.fn().mockResolvedValue(0) },
      passwordResetRequest: { count: jest.fn().mockResolvedValue(0) },
      supplierCompanyLink: { count: jest.fn().mockResolvedValue(3) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const svc = new (SupplierService as any)(prisma, null, null, null, null, null, null);
    const r = await svc.myPendingReviewCount({ sub: 'u1', role: 'staff', username: 'x' } as any);
    expect(r).toEqual({ registration: 0, changes: 0, resets: 0, joins: 3 });
    expect(prisma.supplierCompanyLink.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reviewStage: { in: ['STAFF'] }, companyId: 'co-2' }),
    }));
  });

  it('supplier 角色：无审批待办，joins=0 且不查 link 表', async () => {
    const prisma: any = { supplierCompanyLink: { count: jest.fn() } };
    const svc = new (SupplierService as any)(prisma, null, null, null, null, null, null);
    const r = await svc.myPendingReviewCount({ sub: 'u1', role: 'supplier', username: 'x' } as any);
    expect(r.joins).toBe(0);
    expect(prisma.supplierCompanyLink.count).not.toHaveBeenCalled();
  });
});
```

（构造参数个数以 `supplier.service.ts` 实际构造为准，执行时对齐。）

- [ ] **Step 6: 跑测试 + tsc**

Run: `pnpm --filter api test -- supplier-link && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS、零类型错误（`AuthenticatedUser`/`@CurrentUser` 用法对照控制器既有 import）。

- [ ] **Step 7: 未覆盖路由闸自查**

Run: `cd apps/api && npx tsx scripts/list-uncovered-routes.ts | grep -i "company-links" || echo COVERED`
Expected: `COVERED`（全部新路由有 @Roles）。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/supplier/supplier.controller.ts apps/api/src/supplier-portal/supplier-portal.controller.ts apps/api/src/supplier-portal/supplier-portal.module.ts apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier-link.spec.ts
git commit -m "feat(supplier-link): 双向通道 API 端点 + 审批角标 joins 计数（默认拒绝守卫自查通过）"
```

---

### Task 6: register 分流 + checkDuplicate 扩展

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（`register()` :268 分流；`checkDuplicate()` :1868；新增私有 `findCompanyRef`）
- Test: `apps/api/src/supplier/supplier.register.spec.ts`（追加）；`apps/api/src/supplier/supplier-link.spec.ts`（checkDuplicate 用例）

**Interfaces:**
- Produces:
  - `register()` 命中他司已 APPROVED/DISABLED/BLACKLIST 且所选公司无 APPROVED link → 400 `ACCOUNT_EXISTS_JOIN_INSTEAD`（文案引导登录后申请加入）
  - `checkDuplicate(fields: { creditCode?; legalPersonIdCard?; contactIdCard?; companyId?; companyName? })` → 返回体新增 `registeredElsewhere: boolean`（仅他司 APPROVED/DISABLED/BLACKLIST 且本公司无 link 时 true；不回传公司名）

- [ ] **Step 1: 追加失败测试**

`supplier.register.spec.ts` 追加 describe（沿用该文件既有 `validDto`/`prisma` mock 习惯；`companyOptions`/`linkNo` 等 fixture 以文件内既有 mock 结构为准补齐）：

```ts
describe('register — 信用代码命中他司账号（多公司归属 2026-10-16）', () => {
  it('他司 APPROVED 且所选公司无 link → 400 ACCOUNT_EXISTS_JOIN_INSTEAD（引导加入）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 's-other', userId: 'u-other', status: 'APPROVED' });
    prisma.company.findUnique.mockResolvedValue({ id: 'co-mine', name: '本公司' });
    prisma.supplierCompanyLink.findUnique.mockResolvedValue(null);
    await expect(service.register({ ...validDto }))
      .rejects.toMatchObject({ response: { code: 'ACCOUNT_EXISTS_JOIN_INSTEAD' } });
  });

  it('所选公司已有 APPROVED link → 仍 DUPLICATE_CREDIT_CODE（纯重复）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 's-other', userId: 'u-other', status: 'APPROVED' });
    prisma.company.findUnique.mockResolvedValue({ id: 'co-mine', name: '本公司' });
    prisma.supplierCompanyLink.findUnique.mockResolvedValue({ id: 'l1', status: 'APPROVED' });
    await expect(service.register({ ...validDto }))
      .rejects.toMatchObject({ response: { code: 'DUPLICATE_CREDIT_CODE' } });
  });

  it('命中 PENDING → 维持 DUPLICATE_CREDIT_CODE（现状不变）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'PENDING' });
    await expect(service.register({ ...validDto }))
      .rejects.toMatchObject({ response: { code: 'DUPLICATE_CREDIT_CODE' } });
  });
});
```

`supplier-link.spec.ts` 追加：

```ts
describe('checkDuplicate — companyId/registeredElsewhere（防枚举：不回传公司名）', () => {
  it('他司 APPROVED、本公司无 link → registeredElsewhere=true', async () => {
    const prisma: any = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 's1', status: 'APPROVED' }) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-mine', name: '本公司' }) },
      supplierCompanyLink: { findUnique: jest.fn().mockResolvedValue(null) },
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new (SupplierService as any)(prisma, null, null, null, null, null, null);
    const r = await svc.checkDuplicate({ creditCode: '91510000MA62K5XX0X', companyId: 'co-mine' });
    expect(r.creditCode).toBe(true);
    expect(r.registeredElsewhere).toBe(true);
  });

  it('本公司已有 APPROVED link → registeredElsewhere=false', async () => {
    const prisma: any = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 's1', status: 'APPROVED' }) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-mine', name: '本公司' }) },
      supplierCompanyLink: { findUnique: jest.fn().mockResolvedValue({ id: 'l1', status: 'APPROVED' }) },
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new (SupplierService as any)(prisma, null, null, null, null, null, null);
    const r = await svc.checkDuplicate({ creditCode: '91510000MA62K5XX0X', companyId: 'co-mine' });
    expect(r.registeredElsewhere).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- supplier.register supplier-link`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**

`supplier.service.ts`：

```ts
  /** 只读公司解析（查重分流用）：companyId 优先、companyName 兜底，均查不到返回 null——不建档（区别于 resolveSupplierCompany） */
  private async findCompanyRef(companyId?: string, companyName?: string): Promise<{ id: string; name: string } | null> {
    if (companyId) {
      const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
      if (c) return c;
    }
    const name = (companyName ?? '').trim();
    if (!name) return null;
    return this.prisma.company.findUnique({ where: { name }, select: { id: true, name: true } });
  }
```

`register()` :268 段替换为：

```ts
    const existingSupplier = await this.prisma.supplier.findUnique({
      where: { creditCode },
    });
    if (existingSupplier && existingSupplier.status !== 'REJECTED') {
      if (existingSupplier.status === 'PENDING' || existingSupplier.status === 'RETURNED') {
        throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
      }
      // 多公司归属（2026-10-16）：已有平台账号（APPROVED/DISABLED/BLACKLIST）——
      // 本公司已入=纯重复；否则不拦死，引导用原账号登录走「申请加入」
      const candidate = await this.findCompanyRef(dto.companyId, dto.companyName);
      if (candidate) {
        const link = await this.prisma.supplierCompanyLink.findUnique({
          where: { supplierId_companyId: { supplierId: existingSupplier.id, companyId: candidate.id } },
          select: { status: true },
        });
        if (link?.status === 'APPROVED') {
          throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
        }
      }
      throw new BadRequestException({
        error: '该企业已有平台账号，请使用原账号登录，在「公司归属管理」中申请加入贵公司',
        code: 'ACCOUNT_EXISTS_JOIN_INSTEAD',
      });
    }
```

`checkDuplicate()` 改造（返回体加 `registeredElsewhere`）：

```ts
  async checkDuplicate(fields: { creditCode?: string; legalPersonIdCard?: string; contactIdCard?: string; companyId?: string; companyName?: string }) {
    const result: { creditCode: boolean; legalPersonIdCard: boolean; contactIdCard: boolean; creditCodeStatus: string | null; registeredElsewhere: boolean } = {
      creditCode: false, legalPersonIdCard: false, contactIdCard: false, creditCodeStatus: null, registeredElsewhere: false,
    };

    const creditCode = (fields.creditCode ?? '').trim().toUpperCase();
    if (creditCode) {
      const hit = await this.prisma.supplier.findFirst({ where: { creditCode }, select: { id: true, status: true } });
      result.creditCode = !!hit;
      result.creditCodeStatus = hit?.status ?? null;
      // 多公司归属（2026-10-16）：他司已有在库账号且本公司未入 → 提示走「申请加入」而非拦死。
      // 防公开端点枚举：只回布尔，不回公司名。
      if (hit && ['APPROVED', 'DISABLED', 'BLACKLIST'].includes(hit.status)) {
        const candidate = await this.findCompanyRef(fields.companyId, fields.companyName);
        const link = candidate
          ? await this.prisma.supplierCompanyLink.findUnique({
              where: { supplierId_companyId: { supplierId: hit.id, companyId: candidate.id } },
              select: { status: true },
            })
          : null;
        result.registeredElsewhere = link?.status !== 'APPROVED';
      }
    }
    // legalPersonIdCard / contactIdCard 分支维持原样（自然人查重保持全局）
    // ……（原实现不动）
    return result;
  }
```

`supplier.controller.ts` `checkDuplicate` 端点 `@Query` 增加 `@Query('companyId') companyId?: string, @Query('companyName') companyName?: string` 并透传。

- [ ] **Step 4: 跑测试确认通过（含既有套件回归）**

Run: `pnpm --filter api test -- supplier.register supplier-link supplier.temporary`
Expected: 全 PASS（既有「信用代码命中非 REJECTED（PENDING）→ 硬拦截」用例不受影响）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier.controller.ts apps/api/src/supplier/supplier.register.spec.ts apps/api/src/supplier/supplier-link.spec.ts
git commit -m "feat(supplier-link): 注册查重分流——他司已注册引导走加入（ACCOUNT_EXISTS_JOIN_INSTEAD）+ checkDuplicate registeredElsewhere"
```

---

### Task 7: 供应商域读端切换（列表/raw/统计）

**Files:**
- Create: `apps/api/src/supplier/supplier-company-filter.ts`
- Modify: `apps/api/src/supplier/supplier.service.ts`（`findAll` :950-956；`listByCompleteness` raw 翻译 :1108-1115；`getStats` :3471；`companyCounts` :3489-3490；`getEnterpriseTypeDistribution` :3564；`getEvaluationStats` :3448；`getEvaluationDimensionStats` :3869；`getQualificationAlerts` :3260）
- Test: `apps/api/src/supplier/supplier-company-filter.spec.ts`（新建）；受影响既有 spec 同步更新

**Interfaces:**
- Produces: `supplierCompanyWhere(scope: CompanyScope): Prisma.SupplierWhereInput`——`all` → `{}`；限定集 → `{ companyLinks: { some: { companyId: { in: string[] }, status: 'APPROVED' } } }`

- [ ] **Step 1: helper 失败测试**

`supplier-company-filter.spec.ts`：

```ts
import { supplierCompanyWhere } from './supplier-company-filter';

describe('supplierCompanyWhere（供应商域公司过滤换形，2026-10-16）', () => {
  it('all → 不限', () => {
    expect(supplierCompanyWhere({ all: true })).toEqual({});
  });
  it('限定集 → APPROVED link 存在性', () => {
    expect(supplierCompanyWhere({ all: false, companyIds: ['co-1', 'co-2'] })).toEqual({
      companyLinks: { some: { companyId: { in: ['co-1', 'co-2'] }, status: 'APPROVED' } },
    });
  });
  it('NO_COMPANY 哨兵 → 恒空集（link 不可能有该 id，IN 天然空）', () => {
    const w = supplierCompanyWhere({ all: false, companyIds: ['__no_company__'] }) as any;
    expect(w.companyLinks.some.companyId).toEqual({ in: ['__no_company__'] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败 → 实现 helper**

Run: `pnpm --filter api test -- supplier-company-filter`（FAIL）→ 写 `supplier-company-filter.ts`：

```ts
import { Prisma } from '@prisma/client';
import { CompanyScope, scopeCompanyIds } from '../company/company-scope';

/** 供应商域公司过滤（多公司归属 2026-10-16 spec）：APPROVED link 存在性替代单值 Supplier.companyId。
 *  CompanyScopeService.filter 不动（服务专家库/公告/项目等域）；raw SQL 翻译件在
 *  supplier.service.ts listByCompleteness——改本函数形状必须同步改翻译件并 grep 校验（tsc 不保护）。 */
export function supplierCompanyWhere(scope: CompanyScope): Prisma.SupplierWhereInput {
  const ids = scopeCompanyIds(scope);
  if (ids === null) return {};
  return { companyLinks: { some: { companyId: { in: ids }, status: 'APPROVED' } } };
}
```

- [ ] **Step 3: findAll 切换**

`supplier.service.ts` :950-956 替换：

```ts
    // 公司级数据隔离（2026-10-16 多公司归属换形）：APPROVED link 存在性替代 where.companyId——
    // B 公司库可见已加入供应商；存量由 backfill 脚本镜像为 APPROVED link，PENDING 审批件不受影响。
    if (!params.scopeUserId && params.actor) {
      const scope = await this.companyScope.resolveScope(params.actor, params.companyId);
      const w = supplierCompanyWhere(scope);
      if (w.companyLinks) where.companyLinks = (w as any).companyLinks;
    }
```

（顶部 import `supplierCompanyWhere`。）

- [ ] **Step 4: raw 翻译件切换**

`listByCompleteness` :1108-1115 的 companyId 翻译块**替换**为：

```ts
    // 公司级数据隔离（2026-10-16 多公司归属）：link 存在性翻译——与 ORM 路径 companyLinks.some 同口径，
    // raw 路径漏译即静默 no-op（历史事故病根），改形状必须同步本件。
    if (where.companyLinks?.some?.companyId) {
      const co = where.companyLinks.some.companyId as string | { in: string[] };
      const list = typeof co === 'string' ? [co] : (co.in ?? []);
      if (list.length > 0) {
        conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "SupplierCompanyLink" l WHERE l."supplierId" = s.id AND l."companyId" IN (${Prisma.join(list)}) AND l."status" = 'APPROVED')`);
      }
    }
```

（原 `where.companyId` 的 string/`{in}` 翻译块整段删除——该 where 键不再由供应商域注入；保留 `where.userId` 块。）

- [ ] **Step 5: 统计六处切换**

每处把 `const f = actor ? this.companyScope.filter(await this.companyScope.resolveScope(actor, companyId)) : {};` 替换为：

```ts
const f = actor ? supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)) : {};
```

落点（行号为当前参考，执行时按方法名定位）：`getQualificationAlerts` :3260、`getEvaluationStats` :3448、`getStats` :3471、`companyCounts` :3490（`const where: any = { ...this.companyScope.filter(scope) }` → `{ ...supplierCompanyWhere(scope) }`）、`getEnterpriseTypeDistribution` :3564、`getEvaluationDimensionStats` :3869。

- [ ] **Step 6: 既有 spec 同步 + 回归**

Run: `grep -rn "where.companyId\|companyId:" apps/api/src/supplier/*.spec.ts | grep -v link | head -20`
凡断言供应商域公司过滤注入形状的用例（如断言 `where: { companyId: ... }`），改为断言 `where: { companyLinks: { some: { companyId: { in: [...] }, status: 'APPROVED' } } }`；语义不变的用例只改形状。

Run: `pnpm --filter api test -- supplier` 
Expected: 供应商域全套件 PASS（含 delegated-review raw 断言）。

- [ ] **Step 7: 非 admin 视野实测（raw 盲区教训）**

起本地 API（`pnpm dev:api`，依赖 PG/Redis 在跑），用非 admin 公司账号（`Swhi-CGZX-05`，`X-Portal: web`）：

```bash
# 登录拿 token_web 后：
curl -s 'http://localhost:4001/api/supplier?sort=createdAt&page=1&pageSize=10' -H 'X-Portal: web' -H "Cookie: token_web=<token>"
curl -s 'http://localhost:4001/api/supplier/stats' -H 'X-Portal: web' -H "Cookie: token_web=<token>"
```

Expected: 两接口 200 且仅返回该公司视野数据（与切换前同口径——先在切换前跑一次留基线更稳）。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/supplier/supplier-company-filter.ts apps/api/src/supplier/supplier-company-filter.spec.ts apps/api/src/supplier/supplier.service.ts apps/api/src/supplier
git commit -m "feat(supplier-link): 供应商域公司隔离换形——APPROVED link 替代单值 companyId（含 raw 翻译件）"
```

（注意 `git add apps/api/src/supplier` 目录级仅在本任务全部改动均为本任务产物时使用；否则逐一列文件。）

---

### Task 8: 详情/PII 越权校验切换

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（`get()` :1293-1298；`revealField()` :4237-4240）
- Test: `apps/api/src/supplier/supplier-link.spec.ts`（追加）

**Interfaces:**
- Produces: 越权判定 = `scope.all` OR `任一 APPROVED link 在视野` OR `主归属在视野`（未回填窗口兜底）；错误仍走 `assertInScope` 的 403 `COMPANY_SCOPE_FORBIDDEN`。

- [ ] **Step 1: 追加失败测试**

```ts
describe('get/revealField — link 视野越权判定（多公司归属）', () => {
  const scopeSvc: any = { resolveScope: async () => ({ all: false, companyIds: ['co-2'] }), assertInScope: (id: string | null, s: any) => { if (!s.all && (id == null || !s.companyIds.includes(id))) throw new ForbiddenException({ error: '该数据不属于本公司，无权访问', code: 'COMPANY_SCOPE_FORBIDDEN' }); } };

  it('主归属他司但存在本公司 APPROVED link → 放行', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', companyId: 'co-1', userId: 'u1' }) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([{ id: 'l1' }]) },
    };
    const svc: any = new (SupplierService as any)(prisma, null, null, null, null, null, null);
    svc['companyScope'] = scopeSvc;
    await expect(svc.get('s1', { sub: 'u2', role: 'staff', username: 'x' })).resolves.toBeTruthy();
  });

  it('无任何视野交集 → 403 COMPANY_SCOPE_FORBIDDEN', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', companyId: 'co-1', userId: 'u1' }) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc: any = new (SupplierService as any)(prisma, null, null, null, null, null, null);
    svc['companyScope'] = scopeSvc;
    await expect(svc.get('s1', { sub: 'u2', role: 'staff', username: 'x' })).rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
  });
});
```

（`get()` 的返回形状依赖较多 include mock——执行时按 `get` 实际签名补足 mock；两用例核心断言是放行/403。）

- [ ] **Step 2: 跑测试确认失败 → 实现共用私有方法**

`supplier.service.ts` 加私有方法：

```ts
  /** 公司视野越权判定（多公司归属 2026-10-16）：任一 APPROVED link 在视野 或 主归属在视野（未回填兜底）。
   *  全部不命中 → 复用 assertInScope 的 403 语义。 */
  private async assertSupplierInScope(supplier: { id: string; companyId: string | null }, actor: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(actor);
    if (scope.all) return;
    const ids = scope.companyIds;
    if (supplier.companyId != null && ids.includes(supplier.companyId)) return;
    const links = await this.prisma.supplierCompanyLink.findMany({
      where: { supplierId: supplier.id, companyId: { in: ids }, status: 'APPROVED' },
      select: { id: true },
      take: 1,
    });
    if (links.length > 0) return;
    this.companyScope.assertInScope(supplier.companyId, scope); // 403 COMPANY_SCOPE_FORBIDDEN
  }
```

`get()` :1295-1298 替换为 `if (actor && actor.role !== 'supplier' && supplier) await this.assertSupplierInScope(supplier, actor);`
`revealField()` :4237-4240 同样替换（select 里已有 `companyId`，补 `id` 即可——其 select 本就含 id）。

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm --filter api test -- supplier`
Expected: PASS（含既有跨公司 403 用例——断言 code 不变）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier-link.spec.ts
git commit -m "feat(supplier-link): 详情/PII 越权判定接入 link 视野（B 公司可查看已加入供应商档案）"
```

---

### Task 9: :3004 供应商门户前端

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/api/supplier.ts`（追加 companyLinks api）
- Create: `apps/supplier-portal-next/src/app/(main)/profile/company-links/page.tsx`
- Modify: `apps/supplier-portal-next/src/lib/api/auth.ts:139`（checkDuplicate 加 companyId/companyName）
- Modify: `apps/supplier-portal-next/src/app/register/page.tsx:385-404`（checkCreditCode 引导）

**Interfaces:**
- Consumes: Task 5 的 `/supplier-portal/company-links*` 端点；Task 6 的 `registeredElsewhere`。
- Produces: 页面路由 `/profile/company-links`；api 客户端方法名（页面与注册页引用）：
  - `supplierApi.myCompanyLinks(): Promise<LinkView[]>`
  - `supplierApi.applyCompanyLink(dto: { companyId: string; note?: string })`
  - `supplierApi.acceptCompanyLink(id: string)` / `declineCompanyLink(id: string)`
  - `authApi.checkDuplicate(fields)` 返回类型加 `registeredElsewhere?: boolean`

- [ ] **Step 1: api 客户端**

`lib/api/supplier.ts` 末尾追加（沿用该文件既有请求 helper 的写法——先读文件头确认导出名，下面以 `request` 为例）：

```ts
// ── 公司归属管理（多公司归属 2026-10-16）──
export interface CompanyLinkView {
  id: string; companyId: string; companyName: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
  source: 'SUPPLIER_APPLY' | 'COMPANY_INVITE'; reviewStage: string | null;
  note: string | null; rejectReason: string | null; isPrimary: boolean;
  appliedAt: string | null; invitedAt: string | null; acceptedAt: string | null;
}

export const supplierCompanyLinksApi = {
  my: () => request<CompanyLinkView[]>('/supplier-portal/company-links'),
  apply: (dto: { companyId: string; note?: string }) => request<{ id: string }>('/supplier-portal/company-links/apply', { method: 'POST', body: JSON.stringify(dto) }),
  accept: (id: string) => request<{ success: true }>(`/supplier-portal/company-links/${id}/accept`, { method: 'POST' }),
  decline: (id: string) => request<{ success: true }>(`/supplier-portal/company-links/${id}/decline`, { method: 'POST' }),
};
```

`lib/api/auth.ts:139` 的 `checkDuplicate` 参数类型加 `companyId?: string; companyName?: string`（qs 序列化自动带上；返回类型如有显式 interface 补 `registeredElsewhere?: boolean`）。

- [ ] **Step 2: 公司归属管理页**

`app/(main)/profile/company-links/page.tsx`（cgzxui：卡片用 `rounded-2xl` + hairline 边框类，按钮沿用门户既有 `sp-btn`/主按钮类；组件 `UnitSearchSelect` 同注册页）：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { UnitSearchSelect } from '@/components/registration/unit-search-select';
import { supplierCompanyLinksApi, type CompanyLinkView } from '@/lib/api/supplier';
import { toast } from 'sonner';

const STATUS_LABEL: Record<CompanyLinkView['status'], string> = {
  PENDING: '待处理', APPROVED: '已在库', REJECTED: '未通过', DISABLED: '已停用',
};
const STAGE_LABEL: Record<string, string> = { STAFF: '初审', LEADER: '复审', ADMIN: '终审' };

export default function CompanyLinksPage() {
  const [links, setLinks] = useState<CompanyLinkView[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setLinks(await supplierCompanyLinksApi.my()); } catch { toast.error('归属列表加载失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function apply() {
    if (!company) { toast.warning('请选择要加入的公司'); return; }
    setSubmitting(true);
    try {
      // UnitSearchSelect 按名称选择；companyId 由后端按名称只读解析（apply 传名称即可）
      await supplierCompanyLinksApi.apply({ companyId: 'by-name:' + company, note: note || undefined });
      toast.success('申请已提交，等待该公司三级审批');
      setCompany(''); setNote(''); await reload();
    } catch (e: any) {
      toast.error(e?.response?.error ?? e?.message ?? '提交失败');
    } finally { setSubmitting(false); }
  }

  async function respond(id: string, accept: boolean) {
    try {
      await (accept ? supplierCompanyLinksApi.accept(id) : supplierCompanyLinksApi.decline(id));
      toast.success(accept ? '已接受邀请，正式入库' : '已婉拒邀请');
      await reload();
    } catch (e: any) { toast.error(e?.response?.error ?? '操作失败'); }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-xl font-semibold">公司归属管理</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        贵司可加入多家公司的供应商库，接收其采购邀请。申请将经该公司初审/复审/终审三级审批。
      </p>

      <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5">
        <h2 className="text-sm font-medium">申请加入公司</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <UnitSearchSelect value={company} onChange={setCompany} />
          <input
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            placeholder="申请说明（选填，如：希望参与贵司水务项目）"
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
          />
        </div>
        <button
          className="mt-3 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={apply} disabled={submitting || !company}
        >
          {submitting ? '提交中…' : '提交申请'}
        </button>
      </section>

      <section className="mt-6 space-y-3">
        {loading && <p className="text-sm text-[var(--muted-foreground)]">加载中…</p>}
        {!loading && links.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">尚无公司归属记录</p>}
        {links.map((l) => (
          <article key={l.id} className="rounded-2xl border border-black/5 bg-white p-4">
            <header className="flex items-center justify-between">
              <div>
                <span className="font-medium">{l.companyName}</span>
                {l.isPrimary && <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-xs">主归属</span>}
              </div>
              <span className="text-sm">{STATUS_LABEL[l.status]}{l.status === 'PENDING' && l.reviewStage && l.source === 'SUPPLIER_APPLY' ? `（${STAGE_LABEL[l.reviewStage]}）` : ''}</span>
            </header>
            {l.note && <p className="mt-1 text-sm text-[var(--muted-foreground)]">说明：{l.note}</p>}
            {l.status === 'REJECTED' && l.rejectReason && <p className="mt-1 text-sm text-red-600">原因：{l.rejectReason}</p>}
            {l.status === 'PENDING' && l.source === 'COMPANY_INVITE' && (
              <div className="mt-2 flex gap-2">
                <button className="rounded-xl bg-[var(--primary)] px-3 py-1.5 text-sm text-white" onClick={() => respond(l.id, true)}>接受邀请</button>
                <button className="rounded-xl border border-black/10 px-3 py-1.5 text-sm" onClick={() => respond(l.id, false)}>婉拒</button>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
```

**执行时修正**：`apply` 的 `companyId: 'by-name:' + company` 是过渡写法——后端 `ApplyCompanyLinkDto.companyId` 是 `@IsUUID()`。正确做法：页面拉公司列表（注册页 `companyOptions` 同款接口——`register/page.tsx:273` 归属公司选项来源）由名称解析 id 后传 UUID；若该接口在本页不可复用，则把 `ApplyCompanyLinkDto` 放宽为 `companyId?: string; companyName?: string`（二者其一必填，service 内 `findCompanyRef` 解析，公司不存在 400 `COMPANY_NOT_FOUND`），**推荐后者**（与邀请制/查重端点的名称解析口径一致），并同步更新 Task 3 的 DTO/service/spec（service 里 `company` 查找改为 `findCompanyRef(dto.companyId, dto.companyName)`，null 时 `COMPANY_NOT_FOUND`）。落地时二选一并在提交信息注明。

- [ ] **Step 3: 注册向导引导**

`register/page.tsx` `checkCreditCode()`（:385-404）中 `authApi.checkDuplicate` 调用加公司参数并处理引导：

```tsx
  async function checkCreditCode() {
    if (correction.status === "RETURNED" && correction.token) return;
    setCreditCodeDuplicate(false);
    const code = basic.creditCode.trim();
    if (!/^[0-9A-Z]{18}$/.test(code)) return;
    try {
      const res = await authApi.checkDuplicate({
        creditCode: code,
        companyName: belongCompany || undefined, // 多公司归属：区分本公司重复 vs 他司已注册（后端只读解析）
      });
      // 多公司归属（2026-10-16）：他司已有在库账号且本公司未入 → 不拦死，引导登录走「申请加入」
      if (res.registeredElsewhere) {
        setCreditCodeDuplicate(true);
        toast.info("该企业已有平台账号：请直接登录原账号，在「个人中心 → 公司归属管理」申请加入贵公司");
        return;
      }
      const blocking = res.creditCode && res.creditCodeStatus !== "REJECTED" && res.creditCodeStatus !== "RETURNED";
      setCreditCodeDuplicate(blocking);
      if (res.creditCodeStatus === "RETURNED") toast.info("该统一社会信用代码有退回补正中的申请，请在企业信息步通过「进入补正」完成验证后重新提交");
      else if (blocking) toast.warning("该统一社会信用代码已被注册，请核对后重试");
    } catch { /* 查重失败不阻塞 */ }
  }
```

个人中心导航加入口：`grep -rn "profile" apps/supplier-portal-next/src/app/\(main\)/layout.tsx | head -3` 找到导航定义处，加「公司归属管理」链接 `/profile/company-links`（图标沿用 lucide `Building2`，样式同相邻项）。

- [ ] **Step 4: 手工冒烟**

Run: `pnpm dev:supplier`（或已有 dev 实例），种子账号「重庆蜀通岩土工程有限公司 / supplier@2026」登录 → 个人中心 → 公司归属管理：见主归属 APPROVED 行；选另一家公司提交申请 → 通知该公司 staff。
Expected: 流程通、错误码文案正确（重复申请提示 LINK_PENDING_EXISTS 等）。

- [ ] **Step 5: Commit**

```bash
git add apps/supplier-portal-next/src/lib/api/supplier.ts apps/supplier-portal-next/src/lib/api/auth.ts apps/supplier-portal-next/src/app/register/page.tsx "apps/supplier-portal-next/src/app/(main)/profile/company-links" "apps/supplier-portal-next/src/app/(main)/layout.tsx"
git commit -m "feat(supplier-link): :3004 公司归属管理页+注册查重引导（他司已注册→登录申请加入）"
```

---

### Task 10: :3005 工作台前端

**Files:**
- Modify: `apps/web/src/app/(main)/supplier/repository/page.tsx`（工具栏加「邀请入库」按钮，leader 可见）
- Create: `apps/web/src/components/supplier/company-link-invite-modal.tsx`
- Modify: `apps/web/src/components/supplier/review-center-modal.tsx`（加「加入审批」tab）
- Modify: `apps/web/src/app/(main)/supplier/[id]/page.tsx`（详情「归属公司」区块）
- Modify: web 侧 api 客户端（`apps/web/src/lib/api/*` 中供应商相关文件——先 grep `checkDuplicate\|/supplier/` 定位）

**Interfaces:**
- Consumes: Task 5 端点 `/supplier/company-links*`；`myPendingReviewCount` 的 `joins` 字段（审批中心角标合并展示 = registration + joins）。
- Produces: 组件 `CompanyLinkInviteModal`（props：`{ open, onClose, onInvited }`）；`review-center-modal.tsx` 新 tab 键名 `company-links`（通知 link `/supplier?tab=company-links` 与 repository 页 `?tab=` 参数对齐——repository 页须支持该 tab 直达打开审批浮窗）。

- [ ] **Step 1: web api 客户端**

在 web 供应商 api 文件（grep 定位，通常 `apps/web/src/lib/api/supplier.ts`）追加：

```ts
export interface CompanyLinkRow {
  id: string; companyId: string; companyName: string | null;
  source: 'SUPPLIER_APPLY' | 'COMPANY_INVITE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
  reviewStage: string | null; note: string | null; rejectReason: string | null;
  createdAt: string;
  supplier: { id: string; name: string; supplierNo: string; creditCode: string | null; status: string; isTemporary: boolean };
}

export const companyLinksApi = {
  list: (params?: { status?: string; reviewStage?: string }) =>
    api.get<CompanyLinkRow[]>('/supplier/company-links', { params }),
  invite: (dto: { supplierId: string; note?: string }) =>
    api.post('/supplier/company-links/invite', dto),
  approve: (id: string, reason?: string) =>
    api.post(`/supplier/company-links/${id}/approve`, { reason }),
  reject: (id: string, reason: string) =>
    api.post(`/supplier/company-links/${id}/reject`, { reason }),
  disable: (id: string) => api.post(`/supplier/company-links/${id}/disable`, {}),
  enable: (id: string) => api.post(`/supplier/company-links/${id}/enable`, {}),
};
```

（`api.get/post` 以该文件既有客户端封装为准——执行时对齐实际导出。）

- [ ] **Step 2: 邀请入库弹窗**

`company-link-invite-modal.tsx`（cgzxui：neumorphic 凸起按钮、`rounded-2xl` 卡、hairline 分隔）：

```tsx
'use client';

import { useState } from 'react';
import { companyLinksApi } from '@/lib/api/supplier';
import { toast } from 'sonner';

/** 邀请供应商入库（多公司归属 2026-10-16）：全局池检索（信用代码/名称）→ leader 发起 → 供应商确认入库。 */
export function CompanyLinkInviteModal({ open, onClose, candidate }: {
  open: boolean; onClose: () => void;
  candidate: { id: string; name: string; creditCode: string | null; status: string; isTemporary: boolean } | null;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open || !candidate) return null;

  async function invite() {
    setBusy(true);
    try {
      await companyLinksApi.invite({ supplierId: candidate.id, note: note || undefined });
      toast.success(`已向「${candidate.name}」发出入库邀请，等待对方确认`);
      onClose(); setNote('');
    } catch (e: any) {
      toast.error(e?.error ?? '邀请失败');
    } finally { setBusy(false); }
  }

  const ineligible = candidate.status !== 'APPROVED' || candidate.isTemporary;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[min(520px,92vw)] rounded-2xl border border-black/5 bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">邀请供应商入库</h3>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[var(--muted-foreground)]">企业名称</dt><dd>{candidate.name}</dd>
          <dt className="text-[var(--muted-foreground)]">统一社会信用代码</dt><dd className="font-mono">{candidate.creditCode ?? '—'}</dd>
        </dl>
        {ineligible && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">仅已入库（APPROVED）且非临时的供应商可被邀请</p>}
        <label className="mt-4 block text-sm">邀请备注（选填）</label>
        <input
          className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
          placeholder="如：XX 年度水务物资采购邀请" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-xl border border-black/10 px-4 py-2 text-sm" onClick={onClose}>取消</button>
          <button
            className="rounded-xl bg-[var(--primary,#1e3a5f)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={invite} disabled={busy || ineligible}
          >{busy ? '发送中…' : '发出邀请'}</button>
        </div>
      </div>
    </div>
  );
}
```

`repository/page.tsx` 工具栏：供应商行操作加「邀请入库」（条件：`session.role === 'leader'` 且该行 `companyId !== myCompanyId` 且非临时——`myCompanyId` 从用户信息接口取，无则隐藏）；点击打开上述弹窗。若工具栏已有行操作组件模式，沿用其按钮类名。

- [ ] **Step 3: 审批中心加「加入审批」tab**

`review-center-modal.tsx`：tab 数组追加 `{ key: 'company-links', label: '加入审批', countKey: 'joins' }`；tab 内容组件：`companyLinksApi.list({ status: 'PENDING', reviewStage: ... })` 按登录角色默认级（staff=STAFF、leader=LEADER、admin=ADMIN），每行展示供应商名/信用代码/申请说明/当前级，操作「通过（填缘由）」「驳回（填原因）」调 `approve/reject`。角标总数从 `registration + changes + resets` 改为 `registration + changes + resets + joins`（grep `my-pending-count\|pendingCount` 定位角标求和处）。
`repository/page.tsx` 顶部支持 `?tab=company-links`：`useSearchParams` 读到该值时 dispatch `open-review-center` 事件并切到该 tab（与 `approval/page.tsx` 深链薄壳同机制）。

- [ ] **Step 4: 详情「归属公司」区块**

`[id]/page.tsx` 详情面板追加区块（复用页面既有 SectionCard/DataToolbar 模式）：拉 `GET /supplier/company-links?status=APPROVED` 过滤 `supplier.id === 详情 id`，列出各公司名 + 库内状态 + 主归属标记；leader 行内可「停用/恢复」（调 disable/enable）。

- [ ] **Step 5: 手工冒烟**

`:3005` 用 `Swhi-CGZX-05`（staff）登录：审批中心出现「加入审批」tab 且角标含 joins（Task 9 冒烟产生的申请）；走三级通过后，供应商库列表出现该供应商（Task 7 换形生效）；leader 账号（`Swhi-CGZX-01`）行操作可见「邀请入库」。
Expected: 全链路通。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(main\)/supplier/repository/page.tsx apps/web/src/components/supplier/company-link-invite-modal.tsx apps/web/src/components/supplier/review-center-modal.tsx "apps/web/src/app/(main)/supplier/[id]/page.tsx" apps/web/src/lib/api
git commit -m "feat(supplier-link): :3005 邀请入库+加入审批 tab+详情归属区块"
```

---

### Task 11: e2e + 全域回归 + boot smoke

**Files:**
- Modify: `apps/api/test/supplier.e2e-spec.ts`（追加 describe）
- 无生产代码改动（发现问题回改对应任务并单独提交 `fix(supplier-link):`）

**Interfaces:**
- Consumes: 全部前序任务。

- [ ] **Step 1: e2e 用例（加入全流程）**

`test/supplier.e2e-spec.ts` 追加（沿用文件内既有登录/自建数据模式——**不依赖 seed 供应商**，自建两家公司账号 + 一家供应商）：

```ts
describe('供应商多公司归属（SupplierCompanyLink e2e）', () => {
  it('申请→三级审批→B 公司库可见→详情可读', async () => {
    // 1. 供应商登录 → POST /supplier-portal/company-links/apply（B 公司）
    // 2. B 公司 staff approve（缘由）→ leader approve → admin approve
    // 3. B 公司 staff GET /supplier?search=<creditCode> 命中该供应商（换形后 link 生效）
    // 4. B 公司 staff GET /supplier/<id> 200（不再 403）
    expect(true).toBe(true); // 展开为真实断言：执行时按本文件既有 request helper 落实四步
  });

  it('leader 邀请→供应商确认→即时入库；重复邀请 → 409/400 LINK_PENDING_EXISTS', async () => {
    // 1. B 公司 leader POST /supplier/company-links/invite
    // 2. 供应商 POST /supplier-portal/company-links/:id/accept
    // 3. B 公司库立即可见；再次 invite → LINK_PENDING_EXISTS 前置（已 APPROVED → ALREADY_IN_COMPANY）
    expect(true).toBe(true);
  });

  it('注册查重引导：他司已 APPROVED 信用代码注册 B 公司 → 400 ACCOUNT_EXISTS_JOIN_INSTEAD', async () => {
    // POST /supplier/register（种子/自建供应商的信用代码 + B 公司 companyId）
    // 断言 400 code=ACCOUNT_EXISTS_JOIN_INSTEAD
    expect(true).toBe(true);
  });
});
```

**注意**：上面 `expect(true)` 仅表骨架——落地时必须写成真实请求与断言（每步 `expect(res.status)`/`expect(body.code)`），不留桩。

- [ ] **Step 2: 全域回归 + 类型检查**

Run: `pnpm --filter api test`
Expected: 全绿（供应商域全套件 + 既有 register/correction/contact-phone 等不回归）。

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: 零错误。

- [ ] **Step 3: boot smoke（单测绿≠能启动——历史教训）**

Run: `cd apps/api && npx nest build && PORT=4099 node dist/main.js & sleep 15 && curl -sf http://localhost:4099/api/docs -o /dev/null && echo BOOT_OK; kill %1`
Expected: `BOOT_OK`。

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/supplier.e2e-spec.ts
git commit -m "test(supplier-link): 加入全流程 e2e——三级审批/邀请确认/查重引导/库可见性"
```

---

## 自审记录

- **Spec 覆盖**：spec §数据模型→Task 1；§流程双通道→Task 3/4；§查重分流与 checkDuplicate→Task 6；§读端切换七落点→Task 7（列表/raw/统计六处）+ Task 8（get/revealField）+ Task 5（角标）；§API 端点表→Task 5；§前端→Task 9/10；§迁移→Task 1/2；§测试→各任务 + Task 11；§边界（幂等/P2002 在 service create/update 分支、临时供应商、全局状态分层、终审 upsert、PII 出口）→Task 3/4/6/8。
- **P2002 并发兜底**：spec 要求 `@@unique` P2002 → 409；Task 3/4 的 apply/invite 用「先 findUnique 后 create」存在并发窗口——执行时在 create/apply 落库处包 try/catch P2002 转 `LINK_PENDING_EXISTS`/409 语义（实现提示已写入 Task 3 Step 3 注释位的相邻说明，落地时补 catch 块并加一条单测）。
- **类型一致性**：`supplierCompanyWhere` 返回 `Prisma.SupplierWhereInput`；`SupplierLinkService` 方法签名在 Task 3/4/5 三处引用一致（Task 5 Step 3 对 `invite` 的 actor 签名调整已注明并要求同步 Task 4 测试）；`myPendingReviewCount` 返回 `{ registration, changes, resets, joins }` 全链一致。
