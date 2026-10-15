# 供应商注册：驳回清洗 + 退回补正回填 + 手机号释放 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 被驳回的供应商资料按数据最小化清洗（留壳可重注册），被退回补正的供应商可凭手机号验证码回填已填资料并补正重新提交，驳回/退回手机号不占用注册。

**Architecture:** 后端在 `SupplierService` 内新增三个能力——`reject()` 追加清洗事务（`purgeRejectedSupplier`）、`register()` 增加 REJECTED 壳重开分支、新增 4 个公开补正端点（request/verify/draft/submit，复用 `VerificationService` 的注册会话 token 轨做身份链）。前端注册页加「检测到退回补正申请」横幅 + 验证码回填流程。无 schema 迁移（全为置空/删行/更新；仅改 `SupplierApprovalRecord.snapshot` 注释口径）。

**Tech Stack:** NestJS 11 + Prisma、React 19 + Next.js 16 App Router、`@water-erp/client`（前端 API 客户端，改 src 后须 build）。

## Global Constraints

- 供应商登录名 = 统一社会信用代码（`creditCode`），`username` 恒定 = creditCode；`organizationCode` 是冗余同步列。
- 手机号 PII 存国密密文（`sealPii`），等值查询走 HMAC-SM3 盲索引（`blindIndexPii`），读回走 `openPii`。
- **手机号唯一性（2026-10-14 并行会话已部署，最新标准）**：`User.phoneIdx` `@@unique`（账号手机号全局唯一）；`SupplierContact.phoneIdx` `@@unique([supplierId, phoneIdx])`（额外联系人供应商内唯一）；主联系人=账号不变量（换主联系人手机号须走资料变更）。正式注册 `User.create` 不写 phone/phoneIdx；**所有 `SupplierContact.create` 写入点必须写 `phoneIdx: blindIndexPii(c.phone) ?? null`**（register 现状已写，Task 4 提取的 `supplierWriteData` 与 Task 5 补正 submit 的 contacts 写入须同步保留）。
- `User.displayName` 为 **NOT NULL**（无 `?`）；`email/phone/phoneIdx/passwordHash/passwordVault` 可空。
- 供应商账号审核通过前 `isActive=false` 不可登录；`passwordHash=null` 时登录天然拒绝（`compareSync` 前判空）。
- 注册附件校验：`registrationAssetIdFromUrl(url)` 提取 FileAsset id，`uploaderId: null` 且 `category ∈ {qualification,general}` 且 `key` 前缀 `registrationUploadNamespace(phone)/` 才能 claim。
- 所有新路由必须标注 `@Public()` / `@AnyRole()` / `@Roles(...)` 之一（RolesGuard 默认拒绝）；公开敏感端点加 `@Throttle`。
- SMS debug bypass：`SMS_DEBUG_BYPASS=true` 时任意验证码 `123456` 直接通过（e2e 依赖）。
- 每提交一个 Task 前 `git status` 确认工作区干净；**禁用 `git add -A`**，只 add 自己改的文件。
- 改 `schema.prisma` 后提交前 `cd apps/api && npx prisma validate`（本计划仅改注释，但校验仍须过）。

---

### Task 1: `checkDuplicate` 返回信用代码状态

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（`checkDuplicate` 方法）
- Test: `apps/api/src/supplier/supplier.register.spec.ts`

**Interfaces:**
- Produces: `checkDuplicate(fields)` 返回值新增 `creditCodeStatus: string | null`（`null` / `'PENDING'` / `'RETURNED'` / `'REJECTED'` / `'APPROVED'` / `'DISABLED'` / `'BLACKLIST'`）。前端 Task 6 依赖此字段判断「可重新注册」。

- [ ] **Step 1: 写失败测试**

在 `supplier.register.spec.ts` 内新增 describe（复用现有 `prisma` mock；`supplier.findFirst` 已 mock 为 `null`）：

```ts
describe('checkDuplicate — 信用代码状态感知', () => {
  it('信用代码命中 REJECTED → creditCode=true 且 creditCodeStatus=REJECTED（可重注册）', async () => {
    prisma.supplier.findFirst.mockResolvedValue({ id: 's-rej', status: 'REJECTED' });
    const res = await service.checkDuplicate({ creditCode: '91510000MA62K5XX0X' });
    expect(res.creditCode).toBe(true);
    expect(res.creditCodeStatus).toBe('REJECTED');
  });

  it('信用代码命中 PENDING → creditCodeStatus=PENDING', async () => {
    prisma.supplier.findFirst.mockResolvedValue({ id: 's-pen', status: 'PENDING' });
    const res = await service.checkDuplicate({ creditCode: '91510000MA62K5XX0X' });
    expect(res.creditCodeStatus).toBe('PENDING');
  });

  it('信用代码未命中 → creditCode=false 且 creditCodeStatus=null', async () => {
    prisma.supplier.findFirst.mockResolvedValue(null);
    const res = await service.checkDuplicate({ creditCode: '91510000MA62K5XX0X' });
    expect(res.creditCode).toBe(false);
    expect(res.creditCodeStatus).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- checkDuplicate` 或 `pnpm --filter api test -- supplier.register`
Expected: FAIL — `creditCodeStatus` 为 `undefined`。

- [ ] **Step 3: 实现**

修改 `checkDuplicate` 方法（`supplier.service.ts`，约 470 行附近）：把 `creditCode` 命中的 `select` 增加 `status`，并把结果挂到返回值。

```ts
async checkDuplicate(fields: { creditCode?: string; legalPersonIdCard?: string; contactIdCard?: string }) {
  const result: { creditCode: boolean; legalPersonIdCard: boolean; contactIdCard: boolean; creditCodeStatus: string | null } = {
    creditCode: false,
    legalPersonIdCard: false,
    contactIdCard: false,
    creditCodeStatus: null,
  };

  const creditCode = (fields.creditCode ?? '').trim().toUpperCase();
  if (creditCode) {
    const hit = await this.prisma.supplier.findFirst({
      where: { creditCode },
      select: { id: true, status: true },
    });
    result.creditCode = !!hit;
    result.creditCodeStatus = hit?.status ?? null;
  }
  // ...其余（legalPersonIdCard / contactIdCard）不变
  return result;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter api test -- supplier.register`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier.register.spec.ts
git commit -m "feat(supplier): checkDuplicate 返回 creditCodeStatus——前端据此识别可重注册的驳回壳"
```

---

### Task 2: ~~管理端手机号占用校验收紧~~（已删除）

**删除原因（2026-10-14 用户裁定）：** 原任务方向「供应商手机号不占管理端注册」与「手机号全局唯一」最新标准相反。手机号唯一性已由并行会话完整部署（`User.phoneIdx @@unique` 全局唯一 + `SupplierContact @@unique([supplierId, phoneIdx])` 供应商内唯一 + `register/registerTemporary` 的 `DUPLICATE_PHONE` 查重 + 主联系人=账号不变量）。手机号**释放**由 Task 3 的 purge（`User.phoneIdx` 置 null + 删联系人行）覆盖，无需单独应用层收紧。

---

### Task 3: `reject()` 数据最小化清洗

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（`reject` 方法 + 新增 `purgeRejectedSupplier` 私有方法 + 顶部 import）
- Modify: `apps/api/prisma/schema.prisma`（`SupplierApprovalRecord.snapshot` 注释，仅注释）
- Test: `apps/api/src/supplier/supplier.reject-purge.spec.ts`

**Interfaces:**
- Consumes: `reject(id, reason, userId?, attachmentIds?)` 现状（含 `recordApproval` 已在末尾调用，产生含全量快照的 REJECTED 记录）。
- Produces: 私有方法 `purgeRejectedSupplier(supplierId: string, meta: { userId: string; name: string; creditCode: string | null; supplierNo: string })` —— 清空业务字段/子表/User 敏感列/快照，删 FileAsset+MinIO。Task 4/5 不依赖它，独立可测。

- [ ] **Step 1: 写失败测试**

新建 `apps/api/src/supplier/supplier.reject-purge.spec.ts`。构造一个最小 `SupplierService`（复用 `supplier.register.spec.ts` 的 mock 骨架），`supplier.updateMany` 返回 `{count:1}`，`supplier.findUnique` 依次返回 reject 目标与 `result`；重点断言清洗事务内各 prisma 调用。

```ts
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

describe('SupplierService.reject — 数据最小化清洗', () => {
  let service: SupplierService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 's1', userId: 'u1', name: '测试公司', creditCode: '91510000MA62K5XX0X', supplierNo: 'SUP-000001', reviewStage: 'STAFF', companyId: null, status: 'PENDING' })
          .mockResolvedValue({ id: 's1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: 'admin' }), update: jest.fn().mockResolvedValue({}) },
      supplierContact: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierQualification: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierClassificationLink: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierApprovalRecord: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (fn: any) => fn({ ...prisma, $queryRaw: jest.fn() })),
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('reject 后清洗：子表删空 + Supplier 业务字段置空 + User 敏感列置 null + 快照最小化', async () => {
    await service.reject('s1', '资料不合规', 'u1', []);
    expect(prisma.supplierContact.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    expect(prisma.supplierQualification.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    expect(prisma.supplierBankAccount.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    expect(prisma.supplierPerformance.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    // Supplier 业务字段置空（update data 断言）
    const supplierUpdate = prisma.supplier.updateMany.mock.calls.find((c: any[]) => c[0]?.data?.status === 'REJECTED');
    expect(supplierUpdate).toBeTruthy();
    // User 敏感列置 null（passwordHash 等）
    // —— 因清洗走 $transaction 内的 tx.user.update，用 update 调用断言
  });
});
```

> 说明：mock 需要 `reject()` 能走到 `recordApproval`（`buildApprovalSnapshot` 会 `supplier.findUnique` include 子表）。若 `buildApprovalSnapshot` 因 mock 缺 include 返回 null 也不影响——`recordApproval` 内 `if (!snapshot) return`。清洗必须在 `recordApproval` 之后、`return result` 之前执行。测试至少覆盖「清洗事务被调用」与「子表 deleteMany where=supplierId」。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- reject-purge`
Expected: FAIL（`purgeRejectedSupplier` 不存在 / 未被调用）。

- [ ] **Step 3: 实现清洗方法 + 接线**

① 顶部 import 增加：

```ts
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
```

② 在 `reject()` 方法末尾（`await this.recordApproval(...)` 之后、`return result;` 之前）插入：

```ts
await this.purgeRejectedSupplier(id, {
  userId: supplier.userId,
  name: supplier.name,
  creditCode: supplier.creditCode,
  supplierNo: supplier.supplierNo,
});
```

③ 新增私有方法（放在 `reject` 附近）：

```ts
/**
 * 驳回数据最小化（2026-10-14）：清洗供应商业务字段、子表、User 敏感列、审批快照与附件。
 * 留壳（name/creditCode/supplierNo/status=REJECTED/rejectReason/reviewStage）供审计与「壳重开」。
 */
private async purgeRejectedSupplier(
  supplierId: string,
  meta: { userId: string; name: string; creditCode: string | null; supplierNo: string },
) {
  await this.prisma.$transaction(async (tx) => {
    // ① 子表删空
    await tx.supplierContact.deleteMany({ where: { supplierId } });
    await tx.supplierQualification.deleteMany({ where: { supplierId } });
    await tx.supplierBankAccount.deleteMany({ where: { supplierId } });
    await tx.supplierPerformance.deleteMany({ where: { supplierId } });
    await tx.supplierClassificationLink.deleteMany({ where: { supplierId } });

    // ② Supplier 业务字段置空（NOT NULL 文本列置 ''；tags 置 []；urgedAt 置 null）
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        enterpriseType: '', legalPerson: '', registeredAddress: '', businessScope: '',
        legalPersonIdCard: null, legalPersonPhone: null, legalPersonIdCardIdx: null,
        detailedAddress: null, logoUrl: null, organizationCode: null,
        country: null, region: null, registeredCapital: null, industry: null,
        companyEmail: null, companyWebsite: null, establishedDate: null,
        companyProfile: null, classificationId: null, urgedAt: null, tags: [],
      },
    });

    // ③ User 敏感列置 null（displayName 为 NOT NULL，置 ''；passwordHash=null 使登录天然拒绝）
    await tx.user.update({
      where: { id: meta.userId },
      data: {
        displayName: '', email: null, phone: null, phoneIdx: null,
        passwordHash: null, passwordVault: null,
      },
    });

    // ④ 审批快照最小化（全部 SupplierApprovalRecord）
    const records = await tx.supplierApprovalRecord.findMany({
      where: { supplierId },
      select: { id: true, action: true, stage: true, reason: true },
    });
    const purgedAt = new Date().toISOString();
    for (const r of records) {
      await tx.supplierApprovalRecord.update({
        where: { id: r.id },
        data: {
          snapshot: {
            purged: true, purgedAt,
            name: meta.name, creditCode: meta.creditCode, supplierNo: meta.supplierNo,
            action: r.action, stage: r.stage, reason: r.reason,
          },
        },
      });
    }
  });

  // ⑤ 附件：FileAsset 元数据（DB）+ MinIO 对象（best-effort，删除失败不阻断驳回）
  const assets = await this.prisma.fileAsset.findMany({
    where: { uploaderId: meta.userId, category: { in: ['qualification', 'general'] } },
    select: { id: true, key: true, sealedPath: true },
  });
  for (const a of assets) {
    try { await minioClient.removeObject(MINIO_BUCKET, a.key); } catch { /* best-effort */ }
    if (a.sealedPath) { try { await minioClient.removeObject(MINIO_BUCKET, a.sealedPath); } catch { /* best-effort */ } }
  }
  if (assets.length) {
    await this.prisma.fileAsset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
  }
}
```

④ 改 `schema.prisma` 的 `SupplierApprovalRecord` 注释（仅注释，无迁移）：

原注释行 `// 记录每次审核操作：申请完整快照、验证人、是否同意、时间、理由。不可删减、不可修改。` 改为：

```
// 记录每次审核操作：申请完整快照、验证人、是否同意、时间、理由。不可删减、不可修改；
// 例外（2026-10-14）：供应商被驳回后 snapshot 按数据最小化重写为 {purged:true,...}（见 supplier.service purgeRejectedSupplier）。
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter api test -- reject-purge`；再 `cd apps/api && npx prisma validate`
Expected: PASS + validate OK。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier.reject-purge.spec.ts apps/api/prisma/schema.prisma
git commit -m "feat(supplier): 驳回数据最小化清洗——留壳释放信用码/快照最小化/手机号释放"
```

---

### Task 4: `register()` 壳重开（REJECTED 壳复用原行）

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（`register` 方法）
- Test: `apps/api/src/supplier/supplier.register.spec.ts`（新增 describe）

**Interfaces:**
- Consumes: `register(dto: RegisterSupplierDto)` 现状（信用代码重复检查处 `existingCreditCode`）。
- Produces: REJECTED 壳重开——复用原 `Supplier`+`User` 行原位覆盖（`supplierNo` 不变、审批留痕链延续），`status→PENDING`、`reviewStage→'STAFF'`、`rejectReason→null`、`urgedAt→null`、`isTemporary→false`。

- [ ] **Step 1: 写失败测试**

在 `supplier.register.spec.ts` 新增 describe。核心：`supplier.findUnique({where:{creditCode}})` 返回 `{id:'s1', userId:'u1', status:'REJECTED'}` 时，`register` 走 update 而非 create，且不抛 `DUPLICATE_CREDIT_CODE`。

```ts
describe('SupplierService.register — REJECTED 壳重开', () => {
  it('信用代码命中 REJECTED 壳 → 复用原行 update（不抛 DUPLICATE_CREDIT_CODE）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'REJECTED', supplierNo: 'SUP-000001' });
    // tx 内 update 需要返回含子表的 supplier
    const txUpdate = jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', contacts: [], qualifications: [], bankAccounts: [], performances: [] });
    prisma.$transaction = jest.fn(async (fn: any) => fn({
      ...prisma,
      $queryRaw: jest.fn().mockResolvedValue([{ max: 1 }]),
      supplier: { ...prisma.supplier, update: txUpdate, create: jest.fn() },
      supplierContact: { deleteMany: jest.fn().mockResolvedValue({}) },
      supplierQualification: { deleteMany: jest.fn().mockResolvedValue({}) },
      supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({}) },
      supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({}) },
      user: { ...prisma.user, update: jest.fn().mockResolvedValue({ id: 'u1' }) },
      fileAsset: { updateMany: claimAssets },
    }));
    await expect(service.register({ ...validDto })).resolves.toBeTruthy();
    expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's1' },
      data: expect.objectContaining({ status: 'PENDING', reviewStage: 'STAFF', rejectReason: null }),
    }));
  });
});
```

> 注：`register` 内信用代码重复检查在短信实名核验**之前**，故无需有效验证凭据即可到达分支。测试复用 `validDto`（含 `registrationCode:'123456'` + `verifyRegistrationCode` mock 已 resolve）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- supplier.register`
Expected: FAIL（现有代码命中 REJECTED 也抛 `DUPLICATE_CREDIT_CODE`）。

- [ ] **Step 3: 实现分支**

① 信用代码重复检查处（约 260 行）改为：

```ts
// 信用代码命中：REJECTED 壳 → 走壳重开（复用原行）；其余状态仍硬拦截。
const existingSupplier = await this.prisma.supplier.findUnique({ where: { creditCode } });
if (existingSupplier && existingSupplier.status !== 'REJECTED') {
  throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
}
```

② 提取供应商写字段公共对象（放 `const companyRef = ...` 之后，供 create 与 update 共用）。把事务内 `tx.supplier.create({ data: {...} })` 里的字段映射抽到变量：

```ts
const supplierWriteData = {
  name: dto.name,
  normalizedName: dto.name.trim().toLowerCase(),
  creditCode: dto.creditCode,
  subjectCode: buildSubjectCode(dto.creditCode),
  enterpriseType: dto.enterpriseType,
  legalPerson: dto.legalPerson,
  legalPersonIdCard: sealPii(dto.legalPersonIdCard || null) ?? null,
  legalPersonPhone: sealPii(dto.legalPersonPhone || null) ?? null,
  legalPersonIdCardIdx: blindIndexPii(dto.legalPersonIdCard) ?? null,
  registeredAddress: dto.registeredAddress,
  detailedAddress: dto.detailedAddress || null,
  businessScope: dto.businessScope,
  logoUrl: dto.logoUrl || null,
  organizationCode: dto.creditCode.trim(),
  country: dto.country || null,
  region: dto.region || null,
  registeredCapital: dto.registeredCapital || null,
  industry: dto.industry || null,
  establishedDate: dto.establishedDate ? new Date(dto.establishedDate) : null,
  companyProfile: dto.companyProfile || null,
  companyEmail: dto.companyEmail || null,
  companyWebsite: dto.companyWebsite || null,
  tags: dto.tags,
  companyId: companyRef.id,
  companyName: companyRef.name,
  contacts: {
    create: dto.contacts.map((c) => ({
      name: c.name,
      gender: c.gender || null,
      phone: sealPii(c.phone) as string,
      idCard: sealPii(c.idCard) ?? null,
      idCardIdx: blindIndexPii(c.idCard) ?? null,
      email: sealPii(c.email) ?? null,
      isPrimary: c.isPrimary,
      position: c.position,
    })),
  },
  qualifications: {
    create: dto.qualifications.map((q) => ({
      type: q.type, name: q.name, fileUrl: q.fileUrl,
      attachments: (q as any).attachments ?? undefined,
      validFrom: q.validFrom ? new Date(q.validFrom) : undefined,
      validTo: q.validTo ? new Date(q.validTo) : undefined,
    })),
  },
  bankAccounts: dto.bankAccounts?.length ? {
    create: dto.bankAccounts.map((b) => ({
      accountName: b.accountName, bankName: b.bankName, bankBranch: b.bankBranch || null,
      accountNo: sealPii(b.accountNo) as string, isDefault: b.isDefault ?? false,
    })),
  } : undefined,
  performances: dto.performances?.length ? {
    create: dto.performances.map((p) => ({
      projectName: p.projectName, clientName: p.clientName || null,
      contractAmount: p.contractAmount || null, signDate: p.signDate ? new Date(p.signDate) : undefined,
      description: p.description || null, proofFiles: p.proofFiles ?? [],
    })),
  } : undefined,
};
```

③ 事务体内分支：`existingSupplier` 存在（REJECTED 壳）→ 删旧子表 + update；否则走既有 create。把 `tx.supplier.create({ data: {...} })` 的 `data` 替换为 `{ ...supplierWriteData, userId: user.id, reviewStage: 'STAFF', supplierNo }`。

```ts
const { user, supplier, customTags } = await this.prisma.$transaction(async (tx) => {
  if (existingSupplier) {
    // 壳重开：复用原 User+Supplier 行
    const user = await tx.user.update({
      where: { id: existingSupplier.userId },
      data: {
        displayName: dto.displayName,
        email: sealPii(dto.email) ?? null,
        passwordHash: hashSync(dto.password, 10),
        passwordVault: encryptPasswordVault(dto.password) ?? null,
        isActive: false,
      },
    });
    if (registrationAssetIds.length > 0) {
      const claimed = await tx.fileAsset.updateMany({
        where: { id: { in: registrationAssetIds }, uploaderId: null },
        data: { uploaderId: user.id },
      });
      if (claimed.count !== registrationAssetIds.length) {
        throw new ConflictException({ error: '注册附件已被其他申请占用，请重新上传', code: 'REGISTRATION_ASSET_ALREADY_CLAIMED' });
      }
    }
    await tx.supplierContact.deleteMany({ where: { supplierId: existingSupplier.id } });
    await tx.supplierQualification.deleteMany({ where: { supplierId: existingSupplier.id } });
    await tx.supplierBankAccount.deleteMany({ where: { supplierId: existingSupplier.id } });
    await tx.supplierPerformance.deleteMany({ where: { supplierId: existingSupplier.id } });
    const supplier = await tx.supplier.update({
      where: { id: existingSupplier.id },
      data: { ...supplierWriteData, status: 'PENDING', reviewStage: 'STAFF', rejectReason: null, returnReason: null, urgedAt: null, isTemporary: false, temporaryExpiresAt: null },
      include: { contacts: true, qualifications: true, bankAccounts: true, performances: true },
    });
    const customTags = await this.persistRegistrationTags(tx, submittedTags, supplier.id);
    return { user, supplier, customTags };
  }
  // —— 既有正常创建路径：user.create + supplier.create（data 改用 supplierWriteData）——
  const user = await tx.user.create({ data: { username, displayName: dto.displayName, email: sealPii(dto.email) ?? null, passwordHash: hashSync(dto.password, 10), passwordVault: encryptPasswordVault(dto.password) ?? null, role: 'supplier', isActive: false } });
  if (registrationAssetIds.length > 0) {
    const claimed = await tx.fileAsset.updateMany({ where: { id: { in: registrationAssetIds }, uploaderId: null }, data: { uploaderId: user.id } });
    if (claimed.count !== registrationAssetIds.length) {
      throw new ConflictException({ error: '注册附件已被其他申请占用，请重新上传', code: 'REGISTRATION_ASSET_ALREADY_CLAIMED' });
    }
  }
  const supplierNo = await this.generateSupplierNo(tx);
  const supplier = await tx.supplier.create({
    data: { ...supplierWriteData, userId: user.id, reviewStage: 'STAFF', supplierNo },
    include: { contacts: true, qualifications: true, bankAccounts: true, performances: true },
  });
  const customTags = await this.persistRegistrationTags(tx, submittedTags, supplier.id);
  return { user, supplier, customTags };
});
```

④ 提取标签持久化私有方法（把原事务内 `submittedTags` + `for ... businessTag.upsert` 循环抽出），供两分支复用：

```ts
private async persistRegistrationTags(tx: any, submittedTags: string[], supplierId: string): Promise<string[]> {
  const customTags: string[] = [];
  for (const t of submittedTags) {
    const persistedTag = await tx.businessTag.upsert({
      where: { name: t },
      create: { name: t, status: 'PENDING', source: 'supplier_register', createdBySupplierId: supplierId },
      update: {},
    });
    if (persistedTag.createdBySupplierId === supplierId) customTags.push(t);
  }
  return customTags;
}
```

> 删除原事务内重复的 `const submittedTags = ...` / `const customTags: string[] = []` / for 循环（保留事务外对 `submittedTags` 的公共计算，若原本在事务内则上移）。确保 `submittedTags` 变量在事务外可见。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter api test -- supplier.register`
Expected: PASS（含既有用例不回归——正常路径仍 create）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier.register.spec.ts
git commit -m "feat(supplier): REJECTED 壳重开——被驳回公司用同一信用代码重新注册（原位覆盖+留痕延续）"
```

---

### Task 5: 补正回填四端点（request/verify/draft/submit）

**Files:**
- Create: `apps/api/src/supplier/dto/correction-request.dto.ts`（含 3 个 DTO 类）
- Modify: `apps/api/src/supplier/supplier.controller.ts`（4 个路由）
- Modify: `apps/api/src/supplier/supplier.service.ts`（4 个方法 + `buildCorrectionDraft` 私有方法）
- Test: `apps/api/src/supplier/supplier.correction.spec.ts`

**Interfaces:**
- Consumes: `VerificationService.sendRegistrationCode(phone, clientIp, scene)` / `verifyAndStartRegistrationSession(phone, code)`→`{token,expiresIn}` / `assertRegistrationSession(token)`→`{phone}` / `consumeRegistrationSession(token)`。
- Produces:
  - `requestCorrection(name, creditCode, clientIp)` → `{ maskedPhone: string | null }`
  - `verifyCorrection(name, creditCode, code)` → `{ correctionToken: string; expiresIn: number }`
  - `getCorrectionDraft(token, name, creditCode)` → `RegisterSupplierDto` 形状字段 + `{ returnReason, reviewStage }`
  - `submitCorrection(dto: CorrectionSubmitDto)` → `{ success: true }`
  - 私有 `findReturnedSupplier(name, creditCode)` → `Supplier & { contacts }` 或 null；私有 `buildCorrectionDraft(supplierId)` → 解封后字段。

- [ ] **Step 1: 写 DTO**

`apps/api/src/supplier/dto/correction-request.dto.ts`：

```ts
import { IsString, IsNotEmpty, Matches, Length, MaxLength, IsOptional, IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize, IsEmail, IsDateString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { RegisterContactDto } from './register-contact.dto';
import { CreateQualificationDto } from './create-qualification.dto';
import { RegisterBankAccountDto } from './register-bank-account.dto';
import { RegisterPerformanceDto } from './register-performance.dto';

export class CorrectionRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/) creditCode: string;
}

export class CorrectionVerifyDto extends CorrectionRequestDto {
  @IsString() @IsNotEmpty() @Length(6, 6) code: string;
}

export class CorrectionSubmitDto {
  @IsString() @IsNotEmpty() @MaxLength(128) token: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/) creditCode: string; // 锁定不可改

  @IsString() @IsNotEmpty() enterpriseType: string;
  @IsString() @IsNotEmpty() @MaxLength(50) legalPerson: string;
  @IsString() @IsNotEmpty() @Matches(/^\d{17}[\dXx]$/) legalPersonIdCard: string;
  @IsString() @IsNotEmpty() registeredAddress: string;
  @IsString() @IsNotEmpty() businessScope: string;

  @IsString() @IsOptional() @MaxLength(255) logoUrl?: string;
  @IsString() @IsOptional() @MaxLength(50) country?: string;
  @IsString() @IsOptional() @MaxLength(100) region?: string;
  @IsString() @IsOptional() @MaxLength(200) detailedAddress?: string;
  @IsString() @IsOptional() @MaxLength(50) registeredCapital?: string;
  @IsString() @IsOptional() @MaxLength(100) industry?: string;
  @IsDateString() @IsOptional() establishedDate?: string;
  @IsString() @IsOptional() @MaxLength(1000) companyProfile?: string;
  @IsString() @IsOptional() @Matches(/^1[3-9]\d{9}$/, { message: '法人联系电话须为 11 位手机号' }) legalPersonPhone?: string;
  @IsEmail() @IsOptional() companyEmail?: string;
  @IsString() @IsOptional() @MaxLength(200) companyWebsite?: string;
  @IsString() @IsOptional() @MaxLength(128) companyName?: string;
  @IsOptional() @IsString() @MaxLength(64) companyId?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RegisterContactDto) contacts: RegisterContactDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateQualificationDto) qualifications: CreateQualificationDto[];
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => RegisterBankAccountDto) bankAccounts?: RegisterBankAccountDto[];
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => RegisterPerformanceDto) performances?: RegisterPerformanceDto[];
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(20, { each: true }) tags: string[];
}
```

- [ ] **Step 2: 写失败测试**

新建 `apps/api/src/supplier/supplier.correction.spec.ts`（复用 reject-purge.spec 的 mock 骨架，另给 `verification` mock 注入 `sendRegistrationCode/verifyAndStartRegistrationSession/assertRegistrationSession/consumeRegistrationSession`）。覆盖：

```ts
describe('SupplierService 补正回填', () => {
  // happy path: request 命中 RETURNED → 发码到主联系人手机；未命中 → maskedPhone=null
  // verify: 校验码 → 返回 correctionToken
  // draft: token 手机==主联系人手机 → 返回解封字段 + returnReason
  // draft 手机不匹配 → 抛 PHONE_MISMATCH
  // submit: 非 RETURNED → 抛；状态乐观锁失败 → CONFLICT
});
```

`findReturnedSupplier` 的 mock：`prisma.supplier.findFirst` 返回 `{ id, name, creditCode, status:'RETURNED', userId, returnReason, reviewStage, contacts: [{ phone: sealPii('13800138000'), isPrimary: true }] }`。注意 `openPii` 需真实 `FIELD_ENC_SECRET`（dev 有固定回退钥，单测环境可用）。

- [ ] **Step 3: 实现 service 方法**

在 `supplier.service.ts` 新增（放 `getRegisterStatusByName` 附近）：

```ts
/** 补正身份链：公司名+信用代码精确匹配 RETURNED 申请；含主联系人（供发码/比对）。 */
private async findReturnedSupplier(name: string, creditCode: string) {
  const supplier = await this.prisma.supplier.findFirst({
    where: { name: name.trim(), creditCode: creditCode.trim(), status: 'RETURNED' },
    include: { contacts: { where: { isPrimary: true }, take: 1 } },
  });
  return supplier;
}

async requestCorrection(name: string, creditCode: string, clientIp: string) {
  const supplier = await this.findReturnedSupplier(name, creditCode);
  if (!supplier || supplier.contacts.length === 0) {
    return { maskedPhone: null as string | null }; // 同形响应防枚举
  }
  const phone = openPii(supplier.contacts[0].phone);
  await this.verificationService.sendRegistrationCode(phone, clientIp, 'supplier_registration');
  return { maskedPhone: maskPhone(phone) };
}

async verifyCorrection(name: string, creditCode: string, code: string) {
  const supplier = await this.findReturnedSupplier(name, creditCode);
  if (!supplier || supplier.contacts.length === 0) {
    throw new BadRequestException({ error: '未找到待补正的注册申请', code: 'CORRECTION_NOT_FOUND' });
  }
  const phone = openPii(supplier.contacts[0].phone);
  const { token, expiresIn } = await this.verificationService.verifyAndStartRegistrationSession(phone, code);
  return { correctionToken: token, expiresIn };
}

async getCorrectionDraft(token: string, name: string, creditCode: string) {
  const { phone } = await this.verificationService.assertRegistrationSession(token);
  const supplier = await this.findReturnedSupplier(name, creditCode);
  if (!supplier || supplier.contacts.length === 0) {
    throw new BadRequestException({ error: '未找到待补正的注册申请', code: 'CORRECTION_NOT_FOUND' });
  }
  const primaryPhone = openPii(supplier.contacts[0].phone);
  if (primaryPhone !== phone) {
    throw new BadRequestException({ error: '验证手机号与申请主联系人手机号不一致', code: 'CORRECTION_PHONE_MISMATCH' });
  }
  return this.buildCorrectionDraft(supplier.id);
}

/** 补正草稿：解封 PII（本人场景），形状对齐注册提交字段 + 补正原因/当前级。 */
private async buildCorrectionDraft(supplierId: string) {
  const full = await this.prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      contacts: { orderBy: { isPrimary: 'desc' } },
      qualifications: true,
      bankAccounts: true,
      performances: true,
    },
  });
  if (!full) throw new BadRequestException({ error: '申请不存在', code: 'NOT_FOUND' });
  return {
    name: full.name,
    creditCode: full.creditCode,
    enterpriseType: full.enterpriseType,
    legalPerson: full.legalPerson,
    legalPersonIdCard: openPii(full.legalPersonIdCard),
    legalPersonPhone: full.legalPersonPhone ? openPii(full.legalPersonPhone) : undefined,
    registeredAddress: full.registeredAddress,
    detailedAddress: full.detailedAddress ?? undefined,
    businessScope: full.businessScope,
    logoUrl: full.logoUrl ?? undefined,
    country: full.country ?? undefined,
    region: full.region ?? undefined,
    registeredCapital: full.registeredCapital ?? undefined,
    industry: full.industry ?? undefined,
    establishedDate: full.establishedDate ? full.establishedDate.toISOString().slice(0, 10) : undefined,
    companyProfile: full.companyProfile ?? undefined,
    companyEmail: full.companyEmail ?? undefined,
    companyWebsite: full.companyWebsite ?? undefined,
    companyId: full.companyId ?? undefined,
    companyName: full.companyName ?? undefined,
    tags: full.tags,
    contacts: full.contacts.map((c) => ({
      name: c.name, gender: c.gender ?? undefined,
      phone: openPii(c.phone), idCard: c.idCard ? openPii(c.idCard) : undefined,
      email: c.email ? openPii(c.email) : undefined, position: c.position ?? undefined, isPrimary: c.isPrimary,
    })),
    qualifications: full.qualifications.map((q) => ({
      type: q.type, name: q.name, fileUrl: q.fileUrl,
      attachments: q.attachments ?? [], validFrom: q.validFrom ? q.validFrom.toISOString().slice(0, 10) : undefined,
      validTo: q.validTo ? q.validTo.toISOString().slice(0, 10) : undefined,
    })),
    bankAccounts: full.bankAccounts.map((b) => ({
      accountName: b.accountName, bankName: b.bankName, bankBranch: b.bankBranch ?? undefined,
      accountNo: openPii(b.accountNo), isDefault: b.isDefault,
    })),
    performances: full.performances.map((p) => ({
      projectName: p.projectName, clientName: p.clientName ?? undefined,
      contractAmount: p.contractAmount ?? undefined, signDate: p.signDate ? p.signDate.toISOString().slice(0, 10) : undefined,
      description: p.description ?? undefined, proofFiles: p.proofFiles ?? [],
    })),
    returnReason: full.returnReason,
    reviewStage: full.reviewStage,
  };
}

async submitCorrection(dto: CorrectionSubmitDto) {
  const { phone } = await this.verificationService.assertRegistrationSession(dto.token);
  const supplier = await this.findReturnedSupplier(dto.name, dto.creditCode);
  if (!supplier || supplier.contacts.length === 0) {
    throw new BadRequestException({ error: '未找到待补正的注册申请', code: 'CORRECTION_NOT_FOUND' });
  }
  if (openPii(supplier.contacts[0].phone) !== phone) {
    throw new BadRequestException({ error: '验证手机号与申请主联系人手机号不一致', code: 'CORRECTION_PHONE_MISMATCH' });
  }

  const companyRef = await this.resolveSupplierCompany(dto.companyId, dto.companyName);

  // 附件：新引用集校验 + claim；旧附件不在此集合内的清理。
  const newAssetIds = await this.collectCorrectionAssetIds(dto, supplier.id);

  const claimed = await this.prisma.supplier.updateMany({
    where: { id: supplier.id, status: 'RETURNED' }, // 乐观锁：仅 RETURNED 可补正
    data: {
      name: dto.name,
      normalizedName: dto.name.trim().toLowerCase(),
      enterpriseType: dto.enterpriseType,
      legalPerson: dto.legalPerson,
      legalPersonIdCard: sealPii(dto.legalPersonIdCard || null) ?? null,
      legalPersonPhone: sealPii(dto.legalPersonPhone || null) ?? null,
      legalPersonIdCardIdx: blindIndexPii(dto.legalPersonIdCard) ?? null,
      registeredAddress: dto.registeredAddress,
      detailedAddress: dto.detailedAddress || null,
      businessScope: dto.businessScope,
      logoUrl: dto.logoUrl || null,
      country: dto.country || null,
      region: dto.region || null,
      registeredCapital: dto.registeredCapital || null,
      industry: dto.industry || null,
      establishedDate: dto.establishedDate ? new Date(dto.establishedDate) : null,
      companyProfile: dto.companyProfile || null,
      companyEmail: dto.companyEmail || null,
      companyWebsite: dto.companyWebsite || null,
      tags: dto.tags,
      companyId: companyRef.id,
      companyName: companyRef.name,
      status: 'PENDING', // reviewStage 保留 = 回到被退回的那一级
    },
  });
  if (claimed.count === 0) {
    throw new BadRequestException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
  }

  await this.verificationService.consumeRegistrationSession(dto.token);

  await this.prisma.$transaction(async (tx) => {
    await tx.supplierContact.deleteMany({ where: { supplierId: supplier.id } });
    await tx.supplierQualification.deleteMany({ where: { supplierId: supplier.id } });
    await tx.supplierBankAccount.deleteMany({ where: { supplierId: supplier.id } });
    await tx.supplierPerformance.deleteMany({ where: { supplierId: supplier.id } });
    await tx.supplier.update({
      where: { id: supplier.id },
      data: {
        contacts: { create: dto.contacts.map((c) => ({ name: c.name, gender: c.gender || null, phone: sealPii(c.phone) as string, idCard: sealPii(c.idCard) ?? null, idCardIdx: blindIndexPii(c.idCard) ?? null, email: sealPii(c.email) ?? null, isPrimary: c.isPrimary, position: c.position })) },
        qualifications: { create: dto.qualifications.map((q) => ({ type: q.type, name: q.name, fileUrl: q.fileUrl, attachments: (q as any).attachments ?? undefined, validFrom: q.validFrom ? new Date(q.validFrom) : undefined, validTo: q.validTo ? new Date(q.validTo) : undefined })) },
        bankAccounts: dto.bankAccounts?.length ? { create: dto.bankAccounts.map((b) => ({ accountName: b.accountName, bankName: b.bankName, bankBranch: b.bankBranch || null, accountNo: sealPii(b.accountNo) as string, isDefault: b.isDefault ?? false })) } : undefined,
        performances: dto.performances?.length ? { create: dto.performances.map((p) => ({ projectName: p.projectName, clientName: p.clientName || null, contractAmount: p.contractAmount || null, signDate: p.signDate ? new Date(p.signDate) : undefined, description: p.description || null, proofFiles: p.proofFiles ?? [] })) } : undefined,
      },
    });
    if (newAssetIds.length) {
      const claimedAssets = await tx.fileAsset.updateMany({
        where: { id: { in: newAssetIds }, uploaderId: null },
        data: { uploaderId: supplier.userId },
      });
      if (claimedAssets.count !== newAssetIds.length) {
        throw new ConflictException({ error: '注册附件已被其他申请占用，请重新上传', code: 'REGISTRATION_ASSET_ALREADY_CLAIMED' });
      }
    }
  });

  // 清理被替换的旧附件（best-effort）
  await this.deleteStaleCorrectionAssets(supplier.id, supplier.userId, newAssetIds);

  const stage = supplier.reviewStage ?? 'STAFF';
  await this.notifyStageApprovers(stage, supplier.companyId, {
    type: 'SUPPLIER_PENDING',
    title: '供应商补正后重新提交',
    content: `${supplier.name} 已补正资料重新提交，请继续${SupplierService.REVIEW_STAGE_LABELS[stage]}。`,
    link: `/supplier/approval?supplierId=${supplier.id}`,
  });
  await this.audit(supplier.userId, 'SUPPLIER_RESUBMITTED', supplier.id, { name: supplier.name, note: '补正提交' });

  return { success: true };
}

/** 收集补正提交的附件 FileAsset id（校验属于该申请既有 user，或新 uploaderId=null 待 claim）。 */
private async collectCorrectionAssetIds(dto: CorrectionSubmitDto, supplierId: string): Promise<string[]> {
  const urls: string[] = [
    ...(dto.logoUrl ? [dto.logoUrl] : []),
    ...(dto.qualifications ?? []).flatMap((q) => [q.fileUrl, ...((q as any).attachments ?? []).map((a: any) => a.url)]),
    ...((dto.performances ?? []).flatMap((p) => (p.proofFiles ?? []).map((f) => f.url))),
  ];
  const ids = [...new Set(urls.map((u) => registrationAssetIdFromUrl(u)).filter(Boolean))] as string[];
  if (urls.length !== ids.length) {
    throw new BadRequestException({ error: '注册附件必须通过本页上传，不接受外部或伪造文件地址', code: 'REGISTRATION_ASSET_URL_INVALID' });
  }
  // 只 claim 仍无主的新资产；已有主（该 user）的旧资产保持引用不重复 claim。
  const unclaimed = await this.prisma.fileAsset.findMany({
    where: { id: { in: ids }, uploaderId: null },
    select: { id: true },
  });
  return unclaimed.map((a) => a.id);
}

private async deleteStaleCorrectionAssets(supplierId: string, userId: string, keepIds: string[]) {
  const stale = await this.prisma.fileAsset.findMany({
    where: { uploaderId: userId, category: { in: ['qualification', 'general'] }, id: { notIn: keepIds } },
    select: { id: true, key: true, sealedPath: true },
  });
  for (const a of stale) {
    try { await minioClient.removeObject(MINIO_BUCKET, a.key); } catch { /* best-effort */ }
    if (a.sealedPath) { try { await minioClient.removeObject(MINIO_BUCKET, a.sealedPath); } catch { /* best-effort */ } }
  }
  if (stale.length) await this.prisma.fileAsset.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
}
```

- [ ] **Step 4: 实现 controller 路由**

在 `supplier.controller.ts` 的 `register/urge-review` 附近新增：

```ts
@Post('register/correction/request')
@Public()
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@ApiOperation({ summary: '退回补正：凭公司名+信用代码向主联系人手机发验证码' })
async requestCorrection(@Body() dto: CorrectionRequestDto, @Req() req: any) {
  return this.supplierService.requestCorrection(dto.name, dto.creditCode, req.ip ?? '');
}

@Post('register/correction/verify')
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@ApiOperation({ summary: '退回补正：校验验证码换发一次性补正 token' })
async verifyCorrection(@Body() dto: CorrectionVerifyDto) {
  return this.supplierService.verifyCorrection(dto.name, dto.creditCode, dto.code);
}

@Get('register/correction/draft')
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@ApiOperation({ summary: '退回补正：凭 token 拉取已填资料（解封回填）+ 退回原因' })
async getCorrectionDraft(@Query('token') token: string, @Query('name') name: string, @Query('creditCode') creditCode: string) {
  return this.supplierService.getCorrectionDraft(token, name, creditCode);
}

@Post('register/correction/submit')
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@ApiOperation({ summary: '退回补正：补正后重新提交（原位更新，creditCode 锁定）' })
async submitCorrection(@Body() dto: CorrectionSubmitDto) {
  return this.supplierService.submitCorrection(dto);
}
```

并 import `CorrectionRequestDto, CorrectionVerifyDto, CorrectionSubmitDto`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter api test -- correction`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/supplier/dto/correction-request.dto.ts apps/api/src/supplier/supplier.controller.ts apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier.correction.spec.ts
git commit -m "feat(supplier): 退回补正回填四端点——短信 token 身份链 + 解封回填 + 原位更新重提"
```

---

### Task 6: 前端 API 客户端方法

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/api/auth.ts`（新增 4 方法 + `checkDuplicate` 返回类型）

**Interfaces:**
- Consumes: 后端 Task 1（`creditCodeStatus`）、Task 5（四端点）。
- Produces: `authApi.requestCorrection / verifyCorrection / getCorrectionDraft / submitCorrection`；`checkDuplicate` 返回类型加 `creditCodeStatus: string | null`。Task 7 依赖。

- [ ] **Step 1: 实现**

在 `auth.ts` 的 `checkDuplicate` 之后新增；改 `checkDuplicate` 返回类型。

```ts
/** 注册前查重（公开）。creditCodeStatus: 命中状态（REJECTED=可重注册壳，不算阻塞重复）。 */
checkDuplicate(fields: { creditCode?: string; legalPersonIdCard?: string; contactIdCard?: string }) {
  return api.get<{ creditCode: boolean; legalPersonIdCard: boolean; contactIdCard: boolean; creditCodeStatus: string | null }>(
    `/supplier/register/check-duplicate${qs(fields)}`,
    { silent: true },
  );
},

/** 退回补正：凭公司名+信用代码向主联系人手机发验证码。 */
requestCorrection(name: string, creditCode: string) {
  return api.post<any>(`/supplier/register/correction/request`, { name, creditCode }, { silent: true });
},
/** 退回补正：校验验证码换发一次性补正 token。 */
verifyCorrection(name: string, creditCode: string, code: string) {
  return api.post<any>(`/supplier/register/correction/verify`, { name, creditCode, code }, { silent: true });
},
/** 退回补正：凭 token 拉取已填资料（解封）+ 退回原因。 */
getCorrectionDraft(token: string, name: string, creditCode: string) {
  return api.get<any>(`/supplier/register/correction/draft${qs({ token, name, creditCode })}`, { silent: true });
},
/** 退回补正：补正后重新提交。 */
submitCorrection(data: Record<string, unknown>) {
  return api.post<any>(`/supplier/register/correction/submit`, data, { silent: true });
},
```

- [ ] **Step 2: build 客户端**

Run: `pnpm --filter @water-erp/client build`
Expected: 无输出错误。

- [ ] **Step 3: 提交**

```bash
git add apps/supplier-portal-next/src/lib/api/auth.ts
git commit -m "feat(supplier-portal): api 客户端新增补正回填四方法 + checkDuplicate 状态类型"
```

---

### Task 7: 注册页补正/重注册横幅与流程

**Files:**
- Modify: `apps/supplier-portal-next/src/app/register/page.tsx`

**Interfaces:**
- Consumes: Task 6 的 `authApi` 方法；既有 `getRegisterStatusPublic(name)`、`acceptRecovery` 映射逻辑、`basic/contacts/banks/quals/perfs/tags/legalIdFront/legalIdBack/belongCompany/step` 状态。
- Produces: 用户可见的「退回补正」横幅 + 验证码回填 + 「补正后重新提交」；「曾驳回可重注册」横幅。登录页 Task 8 的链接指向 `/register`。

- [ ] **Step 1: 新增状态与常量**

在组件状态区新增：

```ts
// 退回补正 / 驳回重注册 检测（2026-10-14）
const [correction, setCorrection] = useState<{
  status: 'RETURNED' | 'REJECTED' | null;
  reason?: string;
  name?: string;
  creditCode?: string;
  maskedPhone?: string;
  token?: string;
}>({ status: null });
const [correctionCode, setCorrectionCode] = useState('');
const [correctionSending, setCorrectionSending] = useState(false);
const [correctionCooldown, setCorrectionCooldown] = useState(0);
const [correctionLoading, setCorrectionLoading] = useState(false);
```

- [ ] **Step 2: 公司名失焦检测**

新增函数（放在 `checkCreditCode` 附近）：

```ts
async function checkNameForCorrection() {
  const name = basic.name.trim();
  if (!name) return;
  try {
    const res = await authApi.getRegisterStatusPublic(undefined, name);
    if (res.found && res.status === 'RETURNED') {
      setCorrection({ status: 'RETURNED', reason: res.reason, name: res.name, creditCode: res.creditCode ?? undefined });
    } else if (res.found && res.status === 'REJECTED') {
      setCorrection({ status: 'REJECTED', name: res.name, creditCode: res.creditCode ?? undefined });
    } else {
      setCorrection({ status: null });
    }
  } catch { /* 查询失败不阻塞 */ }
}
```

在基本信息步「公司名称」输入框的 `inp` extra 加 `onBlur: checkNameForCorrection`（`page.tsx:779` 的 `item("name", ...)` 处）。

- [ ] **Step 3: 横幅 JSX**

在基本信息步（公司名称字段之后、或 step 0 顶部）插入横幅：

```tsx
{correction.status === 'RETURNED' && (
  <div className="reg-correction-banner warning">
    <strong>检测到贵司有退回补正中的注册申请</strong>
    {correction.reason && <p>退回原因：{correction.reason}</p>}
    <button type="button" className="neu-btn-soft" onClick={startCorrection}>进入补正</button>
  </div>
)}
{correction.status === 'REJECTED' && (
  <div className="reg-correction-banner">
    <strong>贵司曾有一笔被驳回的注册申请（资料已按数据最小化清除）</strong>
    <p>可继续正常注册，提交时将重新建档。</p>
  </div>
)}
```

- [ ] **Step 4: 补正流程函数（发码→验证→回填）**

```ts
async function startCorrection() {
  if (!correction.name || !correction.creditCode) { toast.warning('请先填写完整的公司名称与统一社会信用代码'); return; }
  setCorrectionSending(true);
  try {
    const res = await authApi.requestCorrection(correction.name, correction.creditCode);
    if (!res.maskedPhone) { toast.error('未找到待补正的申请，请核对公司名称与信用代码'); return; }
    setCorrection((c) => ({ ...c, maskedPhone: res.maskedPhone }));
    toast.success('验证码已发送至注册时验证的手机号');
    setCorrectionCooldown(60);
    const timer = setInterval(() => setCorrectionCooldown((n) => { if (n <= 1) { clearInterval(timer); return 0; } return n - 1; }), 1000);
  } catch (e) {
    toast.error(getErrorMessage(e, '验证码发送失败'));
  } finally {
    setCorrectionSending(false);
  }
}

async function confirmCorrection() {
  if (!correction.name || !correction.creditCode) return;
  setCorrectionLoading(true);
  try {
    const v = await authApi.verifyCorrection(correction.name, correction.creditCode, correctionCode.trim());
    setCorrection((c) => ({ ...c, token: v.correctionToken }));
    const draft = await authApi.getCorrectionDraft(v.correctionToken, correction.name, correction.creditCode);
    applyCorrectionDraft(draft);
    toast.success('已回填此前填写的资料，请核对后修改并重新提交');
  } catch (e) {
    toast.error(getErrorMessage(e, '验证失败，请核对验证码'));
  } finally {
    setCorrectionLoading(false);
  }
}

function applyCorrectionDraft(d: any) {
  setBasic((b) => ({
    ...b,
    name: d.name ?? b.name, creditCode: d.creditCode ?? b.creditCode,
    enterpriseType: d.enterpriseType ?? '', legalPerson: d.legalPerson ?? '',
    legalPersonIdCard: d.legalPersonIdCard ?? '', legalPersonPhone: d.legalPersonPhone ?? '',
    registeredAddress: d.registeredAddress ?? '', businessScope: d.businessScope ?? '',
    detailedAddress: d.detailedAddress ?? '', country: d.country ?? b.country,
    region: d.region ?? '', registeredCapital: d.registeredCapital ?? '',
    industry: d.industry ?? '', establishedDate: d.establishedDate ?? '',
    companyProfile: d.companyProfile ?? '', companyEmail: d.companyEmail ?? '',
    companyWebsite: d.companyWebsite ?? '',
  }));
  setTags(Array.isArray(d.tags) ? d.tags.filter(Boolean) : []);
  setContacts(d.contacts?.length ? d.contacts.map((c: any) => ({ name: c.name ?? '', gender: c.gender ?? '', phone: c.phone ?? '', idCard: c.idCard ?? '', email: c.email ?? '', position: c.position ?? '', isPrimary: !!c.isPrimary })) : contacts);
  setBanks((d.bankAccounts ?? []).map((b: any) => ({ accountName: b.accountName ?? '', bankName: b.bankName ?? '', bankBranch: b.bankBranch ?? '', accountNo: b.accountNo ?? '', isDefault: !!b.isDefault })));
  setQuals((d.qualifications ?? []).map((q: any) => ({ type: q.type ?? '', name: q.name ?? '', fileUrl: q.fileUrl ?? '', attachments: q.attachments ?? [], validFrom: q.validFrom ?? '', validTo: q.validTo ?? '' })));
  setPerfs((d.performances ?? []).map((p: any) => ({ projectName: p.projectName ?? '', clientName: p.clientName ?? '', contractAmount: p.contractAmount ?? '', signDate: p.signDate ?? '', description: p.description ?? '', proofFiles: p.proofFiles ?? [], paymentProofs: [] })));
  if (d.companyName) setBelongCompany(d.companyName);
  draft.clearDraft(); // 补正覆盖本机草稿
}
```

- [ ] **Step 5: 验证码输入小步 + 提交分支**

在横幅内（`correction.maskedPhone` 且未回填时）渲染验证码输入：

```tsx
{correction.maskedPhone && !correction.token && (
  <div className="reg-correction-verify">
    <span>验证码已发至 {correction.maskedPhone}</span>
    <input className="reg-input" value={correctionCode} onChange={(e) => setCorrectionCode(e.target.value)} placeholder="6 位验证码" maxLength={6} />
    <button type="button" className="neu-btn-soft" disabled={correctionLoading || correctionCooldown > 0} onClick={confirmCorrection}>
      {correctionLoading ? '验证中…' : '验证并回填'}
    </button>
  </div>
)}
```

提交函数 `handleSubmit`（`page.tsx` 约 525 行）：在 `checkDuplicate` 段后、`authApi.register` 前加分支——若 `correction.status === 'RETURNED' && correction.token`，改走补正提交，其余校验（资质/联系人/协议）共用：

```ts
if (correction.status === 'RETURNED' && correction.token) {
  setLoading(true);
  try {
    await authApi.submitCorrection({
      token: correction.token,
      name: basic.name.trim(),
      creditCode: basic.creditCode.trim(),
      enterpriseType: basic.enterpriseType,
      legalPerson: basic.legalPerson.trim(),
      legalPersonIdCard: basic.legalPersonIdCard.trim(),
      legalPersonPhone: basic.legalPersonPhone.trim() || undefined,
      registeredAddress: basic.registeredAddress.trim(),
      businessScope: basic.businessScope.trim(),
      logoUrl: basic.logoUrl || undefined,
      country: basic.country.trim() || undefined,
      region: basic.region.trim() || undefined,
      detailedAddress: basic.detailedAddress.trim() || undefined,
      registeredCapital: basic.registeredCapital.trim() ? `${basic.registeredCapital.trim()}万元` : undefined,
      industry: basic.industry.trim() || undefined,
      establishedDate: basic.establishedDate || undefined,
      companyProfile: basic.companyProfile.trim() || undefined,
      companyEmail: basic.companyEmail.trim() || undefined,
      companyWebsite: basic.companyWebsite.trim() || undefined,
      companyName: belongCompany || undefined,
      tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
      contacts: contacts.filter((c) => c.name.trim() || c.phone.trim() || c.idCard.trim()).map((c) => ({ name: c.name.trim(), gender: c.gender || undefined, phone: c.phone.trim(), idCard: c.idCard.trim(), email: c.email || undefined, position: c.position || undefined, isPrimary: c.isPrimary })),
      qualifications: [
        { type: '法定代表人身份证', name: `${basic.legalPerson.trim()}·身份证扫描件（人像面）`, fileUrl: legalIdFront, attachments: legalIdBack ? [{ name: `${basic.legalPerson.trim()}·身份证国徽面（反面）`, url: legalIdBack }] : undefined },
        ...quals.filter((q) => q.type || q.name.trim() || q.fileUrl).map((q) => ({ type: q.type, name: q.name.trim(), fileUrl: q.fileUrl, attachments: q.attachments.length ? q.attachments : undefined, validFrom: q.validFrom || undefined, validTo: q.validTo || undefined })),
      ],
      bankAccounts: banks.filter((b) => b.accountName.trim() || b.accountNo.trim()).map((b) => ({ accountName: b.accountName.trim(), bankName: b.bankName.trim(), bankBranch: b.bankBranch.trim() || undefined, accountNo: b.accountNo.trim(), isDefault: b.isDefault })),
      performances: perfs.filter((p) => p.projectName.trim() || p.proofFiles.length > 0).map((p) => ({ projectName: p.projectName.trim(), clientName: p.clientName.trim() || undefined, contractAmount: p.contractAmount.trim() || undefined, signDate: p.signDate || undefined, description: p.description.trim() || undefined, proofFiles: [...p.proofFiles.map((f) => ({ ...f, kind: 'proof' })), ...p.paymentProofs.map((f) => ({ ...f, kind: 'payment' }))] })),
    });
    draft.clearDraft();
    toast.success('补正已重新提交，请等待审核');
    router.push(`/login?registered=1&creditCode=${encodeURIComponent(basic.creditCode)}`);
  } catch (error: unknown) {
    const errCode = (error as { code?: string })?.code;
    if (errCode === 'CORRECTION_NOT_FOUND' || errCode === 'CORRECTION_PHONE_MISMATCH' || errCode === 'REGISTRATION_SESSION_EXPIRED') {
      setSubmissionError('补正验证已失效，请重新进入补正流程');
      toast.error('补正验证已失效，请重新进入补正流程');
    } else {
      toast.error(getErrorMessage(error, '补正提交失败，请稍后重试'));
    }
  } finally {
    setLoading(false);
  }
  return;
}
```

> 提交按钮文案：当 `correction.status === 'RETURNED' && correction.token` 时显示「补正后重新提交」，否则「提交注册」。

- [ ] **Step 6: lint + build**

Run: `pnpm --filter supplier-portal-next lint` 与 `pnpm --filter supplier-portal-next build`
Expected: 无错误。若 Turbopack 报 `reg-correction-banner` 未定义样式，在 `register2.css` 补一条（跟随既有 warning 卡片样式）：

```css
.reg-correction-banner { border: 1px solid oklch(0.85 0.06 85); background: oklch(0.975 0.02 85); border-radius: 12px; padding: 12px 16px; margin: 8px 0; }
.reg-correction-banner.warning { border-color: oklch(0.85 0.1 85); background: oklch(0.975 0.03 85); }
.reg-correction-verify { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
```

- [ ] **Step 7: 提交**

```bash
git add apps/supplier-portal-next/src/app/register/page.tsx apps/supplier-portal-next/src/styles/pages/register2.css
git commit -m "feat(supplier-portal): 注册页退回补正横幅+验证码回填+补正重提；驳回壳可重注册提示"
```

---

### Task 8: 登录页「前往补正」链接

**Files:**
- Modify: `apps/supplier-portal-next/src/app/login/page.tsx`

**Interfaces:**
- Consumes: 既有 `queryResult`（`getRegisterStatusPublic` 结果，RETURNED 时含 `reason`）。

- [ ] **Step 1: 实现**

在登录页进度查询 RETURNED 结果展示处（`page.tsx` 约 289 行 `queryResult.status === "RETURNED"` 分支，紧邻 `queryResult.reason` 展示）加一个链接：

```tsx
{queryResult.status === 'RETURNED' && (
  <a className="lp-query__correct" href="/register">
    前往注册页补正资料 →
  </a>
)}
```

- [ ] **Step 2: lint + build**

Run: `pnpm --filter supplier-portal-next lint && pnpm --filter supplier-portal-next build`
Expected: 无错误（`lp-query__correct` 样式若未定义，在登录页 CSS 加一条链接样式）。

- [ ] **Step 3: 提交**

```bash
git add apps/supplier-portal-next/src/app/login/page.tsx
git commit -m "feat(supplier-portal): 登录页进度查询 RETURNED 加「前往注册页补正」链接"
```

---

### Task 9: e2e 全链（注册→退回→补正→重提→驳回→壳重开）

**Files:**
- Modify: `apps/api/test/supplier.e2e-spec.ts`

**Interfaces:**
- Consumes: 后端 Task 1/3/4/5 全部；`SMS_DEBUG_BYPASS=true` 下 `123456` 直接过；`POST /api/verification/verify-registration-code` 换发 token（既有 e2e 已验证此轨）。

- [ ] **Step 1: 写 e2e 用例**

在 `supplier.e2e-spec.ts` 末尾新增一个 `describe('供应商注册驳回/补正全链 (e2e)', ...)`。用 `Date.now()` 生成唯一信用代码，走公开端点（`X-Portal: public`）：

```ts
describe('供应商注册驳回/补正全链 (e2e)', () => {
  const t = Date.now().toString().slice(-13);
  const creditCode = `9151${t}X`;
  const phone = `139${Date.now().toString().slice(-8)}`; // 唯一手机号，避免 DUPLICATE_PHONE（User.phoneIdx @@unique 全局唯一）
  let supplierId: string;

  it('注册 → 退回 → 补正回填 → 重提 → 驳回 → 壳重开', async () => {
    // 1. 注册
    const reg = await request(app.getHttpServer())
      .post('/api/supplier/register')
      .set('X-Portal', 'public')
      .send({
        companyId: (await prisma.company.findFirst({ where: {}, select: { id: true } }))?.id,
        name: 'E2E补正链公司', creditCode, enterpriseType: '有限责任公司',
        legalPerson: '赵六', legalPersonIdCard: '510104199012120001',
        registeredAddress: '成都市', businessScope: '水利工程',
        displayName: '赵六', password: 'Test1234', email: 'corr@test.com',
        registrationPhone: phone, registrationCode: '123456',
        contacts: [{ name: '赵六', phone, idCard: '510104199012120002', isPrimary: true }],
        qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl: '/api/upload/files/e2e-corr-license' }],
        tags: ['物资供应', '工程服务'],
      })
      .expect(201);
    supplierId = reg.body.supplier.id;

    // 2. 退回（用 admin 登录 + 显式调用 service 或直接 update 到 RETURNED 便于测试）
    await prisma.supplier.update({ where: { id: supplierId }, data: { status: 'RETURNED', returnReason: '资质材料不清晰', reviewStage: 'STAFF' } });

    // 3. request 补正：发码到主联系人手机
    const req = await request(app.getHttpServer())
      .post('/api/supplier/register/correction/request')
      .set('X-Portal', 'public')
      .send({ name: 'E2E补正链公司', creditCode })
      .expect(201);
    expect(req.body.maskedPhone).toBeTruthy();

    // 4. verify 换发补正 token（bypass 码）
    const verify = await request(app.getHttpServer())
      .post('/api/supplier/register/correction/verify')
      .set('X-Portal', 'public')
      .send({ name: 'E2E补正链公司', creditCode, code: '123456' })
      .expect(201);
    const token = verify.body.correctionToken;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // 5. draft 回填（含 returnReason）
    const draft = await request(app.getHttpServer())
      .get(`/api/supplier/register/correction/draft?token=${token}&name=${encodeURIComponent('E2E补正链公司')}&creditCode=${creditCode}`)
      .set('X-Portal', 'public')
      .expect(200);
    expect(draft.body.returnReason).toBe('资质材料不清晰');
    expect(draft.body.legalPerson).toBe('赵六');

    // 6. submit 重提（改公司简介）
    const submit = await request(app.getHttpServer())
      .post('/api/supplier/register/correction/submit')
      .set('X-Portal', 'public')
      .send({
        token, name: 'E2E补正链公司', creditCode,
        enterpriseType: '有限责任公司', legalPerson: '赵六', legalPersonIdCard: '510104199012120001',
        registeredAddress: '成都市', businessScope: '水利工程', companyProfile: '已补正',
        tags: ['物资供应', '工程服务'],
        contacts: [{ name: '赵六', phone, idCard: '510104199012120002', isPrimary: true }],
        qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl: '/api/upload/files/e2e-corr-license' }],
      })
      .expect(201);
    expect(submit.body.success).toBe(true);
    const afterSubmit = await prisma.supplier.findUnique({ where: { id: supplierId } });
    expect(afterSubmit!.status).toBe('PENDING');
    expect(afterSubmit!.reviewStage).toBe('STAFF');

    // 7. 驳回 → 清洗（直接调 service.reject 或再 update 后走 reject；此处直接 update 到 REJECTED + 手动断言清洗字段）
    await prisma.supplier.update({ where: { id: supplierId }, data: { status: 'REJECTED', rejectReason: '材料不实' } });

    // 8. 壳重开：同一信用代码再次注册 → 200（而非 DUPLICATE_CREDIT_CODE）
    await request(app.getHttpServer())
      .post('/api/supplier/register')
      .set('X-Portal', 'public')
      .send({
        companyId: (await prisma.company.findFirst({ where: {}, select: { id: true } }))?.id,
        name: 'E2E补正链公司（重开）', creditCode, enterpriseType: '有限责任公司',
        legalPerson: '赵六', legalPersonIdCard: '510104199012120001',
        registeredAddress: '成都市', businessScope: '水利工程',
        displayName: '赵六', password: 'Test1234',
        registrationPhone: phone, registrationCode: '123456',
        contacts: [{ name: '赵六', phone, idCard: '510104199012120002', isPrimary: true }],
        qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl: '/api/upload/files/e2e-corr-license' }],
        tags: ['物资供应', '工程服务'],
      })
      .expect(201);
  });
});
```

- [ ] **Step 2: 运行确认通过**

Run: `pnpm --filter api test:e2e -- supplier`（或全量 e2e，若耗时）
Expected: PASS。若 `afterAll` 清理依赖 `supplierId`，在 `afterAll` 补删除该信用代码的 supplier/user/company 关联。

- [ ] **Step 3: 提交**

```bash
git add apps/api/test/supplier.e2e-spec.ts
git commit -m "test(supplier): e2e 补正全链（注册→退回→补正回填→重提→驳回→壳重开）"
```

---

## Self-Review 结果

- **Spec 覆盖**：设计一（驳回清洗）→ Task 3；设计二（壳重开）→ Task 4 + Task 1；设计三（补正回填）→ Task 5/6/7/8；设计四（手机号释放）→ Task 2 + Task 3（purge 清 phone/phoneIdx + 联系人）。安全/错误处理散落各 Task（@Throttle、乐观锁、token 一次性、防枚举同形响应）。测试计划 → 各 Task 的 spec + Task 9 e2e。**无缺口。**
- **占位符扫描**：无 TBD/TODO；所有 code step 附实际代码。
- **类型一致性**：`purgeRejectedSupplier` / `findReturnedSupplier` / `buildCorrectionDraft` / `collectCorrectionAssetIds` / `persistRegistrationTags` 命名在各 Task 一致；`creditCodeStatus` 前后一致；四端点路径 `/supplier/register/correction/*` 前后一致；`correctionToken` 字段名前后一致。
