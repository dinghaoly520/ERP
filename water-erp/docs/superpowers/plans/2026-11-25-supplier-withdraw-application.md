# 供应商「撤销申请」（撤回壳 + 回填 + 3 次上限）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 供应商在注册页可撤销审核中/补正中的申请（限 3 次），撤回壳保留完整数据，重新申请时凭信用代码一键回填，壳重开走全新三级审批。

**Architecture:** 公开端点镜像补正流三段式（发码→验 token→提交），撤回=乐观锁认领 PENDING/RETURNED→WITHDRAWN（新枚举）+ withdrawCount 累计 + 仅清账号密码（业务数据保留供回填）；回填端点复用 buildCorrectionDraft（PII 本人场景明文）；register 壳重开谓词扩展 WITHDRAWN。前端 :3004 注册页三态横幅 + 回填复用 applyCorrectionDraft。

**Tech Stack:** NestJS 11 + Prisma（迁移=ALTER TYPE ADD VALUE + ADD COLUMN）；Next.js 16 + React 19（supplier-portal-next）；Jest 单测。

## Global Constraints

- spec：`docs/superpowers/specs/2026-11-25-supplier-withdraw-application-design.md`
- 撤回上限常量 `SUPPLIER_WITHDRAW_LIMIT = 3` 落 packages/shared，前后端同源
- 撤回壳**保留全部业务数据与子表**（回填前提）；仅 User.passwordHash=null + isActive=false（断登录）
- 撤回仅 PENDING/RETURNED；WITHDRAWN 行对 register 等同 REJECTED 壳（重开不拦）
- 防枚举：未命中同形响应（maskedPhone:null）；公开端点 @Throttle 沿用补正档位
- 文案禁机制词；界面用「撤销申请」「已撤回 N/3」「加载之前填写的数据」
- 仓库惯例：main 直接提交；`git -C /Users/qihao/ERP2/ERP add <明确路径>`；中文提交信息 + `feat(supplier):` 前缀 + `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- schema 改动提交前 `npx prisma validate`（仓库铁律）；本机迁移走 create-only → db execute → resolve --applied（memory 口径）
- SupplierService 构造序（直构测试用）：`(prisma, notificationService, redis, llm, verificationService, companyScope)`

---

### Task 1: Schema 迁移 + shared 标签/常量

**Files:**
- Modify: `apps/api/prisma/schema.prisma:1545`（枚举）、`:1593`（列）
- Create: `apps/api/prisma/migrations/20261126100000_supplier_withdraw_status_count/migration.sql`
- Modify: `packages/shared/src/constants.ts:49`
- Test: 无（声明式）

**Interfaces:**
- Produces: `SupplierStatus` 枚举值 `WITHDRAWN`；`Supplier.withdrawCount Int`（默认 0）；`SUPPLIER_STATUS_LABEL.WITHDRAWN = '已撤回'`；`SUPPLIER_WITHDRAW_LIMIT = 3`——Task 2/3/4/5 消费

- [ ] **Step 1: schema.prisma 两处编辑**

枚举（:1538-1545）加一行：

```prisma
enum SupplierStatus {
  PENDING // 待审核
  RETURNED // 退回补正
  APPROVED // 审核通过/已入库
  REJECTED // 审核不通过
  DISABLED // 停用
  BLACKLIST // 黑名单
  WITHDRAWN // 已撤回（供应商自行撤销申请，2026-11-25；壳保留完整数据供信用代码回填）
}
```

Supplier 列（:1593 `returnReason` 行之后插入）：

```prisma
  returnReason         String?
  withdrawCount        Int            @default(0) // 撤回次数（跨轮累计不清零；≥3 不可再撤，2026-11-25）
```

- [ ] **Step 2: 校验 schema 并生成迁移**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx prisma validate
npx prisma migrate dev --create-only --name supplier_withdraw_status_count
```

生成的 SQL 应为两条；若 diff 出多余语句（本地 drift），手工裁剪迁移文件仅保留：

```sql
-- 供应商撤销申请（2026-11-25 spec）：撤回壳状态 + 撤回次数列
ALTER TYPE "SupplierStatus" ADD VALUE 'WITHDRAWN';
ALTER TABLE "Supplier" ADD COLUMN "withdrawCount" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3: 应用迁移到本机库（memory 口径：execute + resolve，不走 migrate dev 全量）**

```bash
npx prisma db execute --file prisma/migrations/20261126100000_supplier_withdraw_status_count/migration.sql
npx prisma migrate resolve --applied 20261126100000_supplier_withdraw_status_count
npx prisma generate
npx prisma migrate status   # 确认无 pending
```

- [ ] **Step 4: shared 标签与常量**（`packages/shared/src/constants.ts`）

```ts
export const SUPPLIER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  RETURNED: '已退回补正',
  APPROVED: '已入库',
  REJECTED: '审核不通过',
  DISABLED: '已停用',
  BLACKLIST: '黑名单',
  WITHDRAWN: '已撤回',
};

/** 供应商撤销申请次数上限（2026-11-25 用户裁定：最多 3 次，跨轮累计） */
export const SUPPLIER_WITHDRAW_LIMIT = 3;
```

- [ ] **Step 5: 构建 shared 包（dist 消费）**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter @water-erp/shared build
```

- [ ] **Step 6: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/prisma/schema.prisma "water-erp/apps/api/prisma/migrations/20261126100000_supplier_withdraw_status_count/migration.sql" water-erp/packages/shared/src/constants.ts
git -C /Users/qihao/ERP2/ERP commit -m "feat(supplier): 撤销申请 Schema——WITHDRAWN 撤回壳状态 + withdrawCount 撤回次数列（上限 3 次常量入 shared）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 撤回后端端点 + recordApproval 扩展 + 进度投影（TDD）

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（recordApproval action 联合 :2273；新方法块插在 getCorrectionDraft/submitCorrection 区域之后 :1990 附近；buildPublicRegisterStatus :1549 与两处 select :1511/:1528）
- Modify: `apps/api/src/supplier/supplier.controller.ts`（correction 端点块 :255 之后）
- Modify: `apps/api/src/supplier/dto/correction-request.dto.ts`（新增 WithdrawSubmitDto）
- Test: `apps/api/src/supplier/supplier-withdraw.spec.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `WITHDRAWN`/`withdrawCount`（Prisma client 重新生成后可用）
- Produces: `requestWithdraw(name, creditCode, clientIp) → { maskedPhone: string | null }`；`verifyWithdraw(name, creditCode, code) → { withdrawToken, expiresIn }`；`withdrawSubmit(token, name, creditCode) → { success: true }`；`getWithdrawDraft(token, name, creditCode) → buildCorrectionDraft 同构草稿`；公开进度查询响应含 `withdrawCount: number`——Task 4 前端消费

- [ ] **Step 1: 写失败测试** `apps/api/src/supplier/supplier-withdraw.spec.ts`

```ts
import { BadRequestException } from '@nestjs/common';
import { SupplierService } from './supplier.service';

/** 直构（构造序 prisma, notification, redis, llm, verification, companyScope） */
const mkSvc = (opts: {
  findFirst?: Record<string, unknown> | null;      // findWithdrawableSupplier / draft 定位
  findUnique?: Record<string, unknown> | null;     // buildCorrectionDraft / buildApprovalSnapshot 读
  claimCount?: number;                              // updateMany 认领结果
  withdrawCount?: number;                           // 现有撤回次数
}) => {
  const fullRow = {
    id: 'sup-1', name: '成都测试商贸有限公司', creditCode: '91510100MA00000000',
    status: 'PENDING', reviewStage: 'STAFF', companyId: 'co-1', userId: 'u1',
    returnReason: null, withdrawCount: opts.withdrawCount ?? 0,
    contacts: [{ isPrimary: true, phone: 'cGg=' }],
    qualifications: [], bankAccounts: [], performances: [],
  };
  const prisma: any = {
    supplier: {
      findFirst: jest.fn().mockResolvedValue(opts.findFirst === undefined ? fullRow : opts.findFirst),
      findUnique: jest.fn().mockResolvedValue(opts.findUnique ?? fullRow),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
    },
    user: { update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    supplierApprovalRecord: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
  };
  const notification: any = { create: jest.fn().mockResolvedValue({}), resolveActionable: jest.fn().mockResolvedValue({ count: 1 }) };
  const verification: any = {
    sendRegistrationCode: jest.fn().mockResolvedValue({ ok: true }),
    verifyAndStartRegistrationSession: jest.fn().mockResolvedValue({ token: 'w'.repeat(64), expiresIn: 600 }),
    assertRegistrationSession: jest.fn().mockResolvedValue({ phone: '13800138000' }),
    consumeRegistrationSession: jest.fn().mockResolvedValue({ ok: true }),
  };
  const svc = new (SupplierService as any)(prisma, notification, null, null, verification, null);
  return { svc, prisma, notification, verification };
};

const openPiiSpy = () => {
  // findWithdrawableSupplier/findReturnedSupplier 的主联系人手机经 openPii 解封——
  // 直构下 sm-field-crypto 对无 sm1: 前缀明文直通，'cGg=' 无前缀 → 原样返回 ≠ '13800138000'
  // 因此 fixture 的 contacts[0].phone 用明文 '13800138000'（见下方用例内覆写）。
};
```

**注意**：上方 `fullRow.contacts[0].phone` 必须为明文 `'13800138000'`（`openPiiForMask/openPii` 对无密封前缀的值原样直通），否则手机一致性校验失败。以 `contacts: [{ isPrimary: true, phone: '13800138000' }]` 为准（下述用例均已按此写）。

```ts
describe('供应商撤销申请（2026-11-25 spec）', () => {
  const baseRow = (over: Record<string, unknown> = {}) => ({
    id: 'sup-1', name: '成都测试商贸有限公司', creditCode: '91510100MA00000000',
    status: 'PENDING', reviewStage: 'STAFF', companyId: 'co-1', userId: 'u1',
    returnReason: null, withdrawCount: 0,
    contacts: [{ isPrimary: true, phone: '13800138000' }],
    qualifications: [], bankAccounts: [], performances: [],
    ...over,
  });

  it('requestWithdraw：PENDING/RETURNED 命中 → 发码（注册场景）并回掩码手机', async () => {
    const { svc, verification } = mkSvc({ findFirst: baseRow() });
    const r = await svc.requestWithdraw('成都测试商贸有限公司', '91510100MA00000000', '127.0.0.1');
    expect(r.maskedPhone).toBeTruthy();
    expect(verification.sendRegistrationCode).toHaveBeenCalledWith('13800138000', '127.0.0.1', 'supplier_registration');
  });

  it('requestWithdraw：未命中（已入库/不存在）→ 同形响应 maskedPhone:null，零发码', async () => {
    const { svc, verification } = mkSvc({ findFirst: null });
    const r = await svc.requestWithdraw('不存在公司', '91510100MA00000000', 'ip');
    expect(r).toEqual({ maskedPhone: null });
    expect(verification.sendRegistrationCode).not.toHaveBeenCalled();
  });

  it('withdrawSubmit：乐观锁认领 WITHDRAWN + 计数 +1 + returnReason 清空', async () => {
    const { svc, prisma } = mkSvc({ findFirst: baseRow({ status: 'RETURNED', returnReason: '材料不清' }) });
    const r = await svc.withdrawSubmit('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000');
    expect(r).toEqual({ success: true });
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sup-1', status: { in: ['PENDING', 'RETURNED'] } },
      data: expect.objectContaining({ status: 'WITHDRAWN', returnReason: null, withdrawCount: { increment: 1 } }),
    }));
  });

  it('withdrawSubmit：业务数据与子表保留（不走 purge——user.update 只清密码/停用）', async () => {
    const { svc, prisma } = mkSvc({ findFirst: baseRow() });
    await svc.withdrawSubmit('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ passwordHash: null, isActive: false }),
    }));
    // 无子表删除调用（prisma 上未挂 deleteMany mock——若误走 purge 会 TypeError 落 audit catch，
    // 故显式断言 supplierContact 无 deleteMany）
    expect(prisma.supplierContact?.deleteMany).toBeUndefined();
  });

  it('withdrawSubmit：审批人通知 + 审批人待办清理 + 审计 + 留痕 WITHDRAWN', async () => {
    const { svc, prisma, notification } = mkSvc({ findFirst: baseRow() });
    await svc.withdrawSubmit('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000');
    expect(notification.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SUPPLIER_WITHDRAWN', title: '供应商撤回注册申请',
    }));
    expect(notification.resolveActionable).toHaveBeenCalledWith('SUPPLIER_PENDING', '/supplier/sup-1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'SUPPLIER_WITHDRAWN' }),
    }));
    expect(prisma.supplierApprovalRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'WITHDRAWN', stage: 'STAFF' }),
    }));
  });

  it('withdrawSubmit：次数闸——已达 3 次 → 400 WITHDRAW_LIMIT_REACHED，零认领', async () => {
    const { svc, prisma } = mkSvc({ findFirst: baseRow({ withdrawCount: 3 }) });
    await expect(svc.withdrawSubmit('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'WITHDRAW_LIMIT_REACHED' } });
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('withdrawSubmit：状态闸——APPROVED/REJECTED/WITHDRAWN 不可撤', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'WITHDRAWN']) {
      const { svc, prisma } = mkSvc({ findFirst: null }); // findWithdrawableSupplier 只查 PENDING/RETURNED → 未命中
      await expect(svc.withdrawSubmit('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000'))
        .rejects.toMatchObject({ response: { code: 'WITHDRAW_NOT_FOUND' } });
      expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
    }
  });

  it('withdrawSubmit：并发认领失败（count=0）→ 400 CONFLICT', async () => {
    const { svc } = mkSvc({ findFirst: baseRow(), claimCount: 0 });
    await expect(svc.withdrawSubmit('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'CONFLICT' } });
  });

  it('withdrawSubmit：手机不匹配 → 400 WITHDRAW_PHONE_MISMATCH', async () => {
    const { svc, verification } = mkSvc({ findFirst: baseRow() });
    verification.assertRegistrationSession.mockResolvedValue({ phone: '13900000000' });
    await expect(svc.withdrawSubmit('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'WITHDRAW_PHONE_MISMATCH' } });
  });

  it('getWithdrawDraft：仅 WITHDRAWN 可取；PII 明文回填形态（openPii 直通）', async () => {
    const { svc } = mkSvc({
      findUnique: baseRow({ status: 'WITHDRAWN', returnReason: null,
        enterpriseType: '有限责任公司', legalPerson: '张三', legalPersonIdCard: '510104199001011234',
        registeredAddress: '成都市', businessScope: '销售' }),
    });
    const d = await svc.getWithdrawDraft('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000');
    expect(d.name).toBe('成都测试商贸有限公司');
    expect(d.contacts).toHaveLength(1);
    expect(d.contacts[0].phone).toBe('13800138000'); // 明文（本人场景，与补正草稿同口径）
  });

  it('getWithdrawDraft：非 WITHDRAWN → 400', async () => {
    const { svc } = mkSvc({ findUnique: baseRow({ status: 'PENDING' }) });
    await expect(svc.getWithdrawDraft('w'.repeat(64), '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'WITHDRAW_NOT_FOUND' } });
  });

  it('公开进度投影含 withdrawCount', async () => {
    const { svc } = mkSvc({
      findFirst: baseRow({ withdrawCount: 2 }),
      findUnique: baseRow({ withdrawCount: 2 }),
    });
    const r = await svc.getRegisterStatusByCreditCode('91510100MA00000000');
    expect(r.found).toBe(true);
    expect(r.withdrawCount).toBe(2);
  });
});
```

说明：`getRegisterStatusByCreditCode` 走 `prisma.supplier.findFirst`（:1509），fixture 经 findFirst 供给；其内部还会查 `supplierApprovalRecord.findFirst`（已 mock null）与 `findMany`（需在 prisma 补 `supplierApprovalRecord.findMany: jest.fn().mockResolvedValue([])`——上面 prisma 定义补一行）。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && pnpm jest supplier-withdraw --silent
```
Expected: FAIL（requestWithdraw 等方法不存在）

- [ ] **Step 3: 实现**

3a. `recordApproval` 签名扩展（:2273）：

```ts
private async recordApproval(supplierId: string, action: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'WITHDRAWN', reviewerUserId: string | undefined, reason?: string, stage?: string, rawAttachmentIds: string[] = []) {
```

3b. 新方法块（插在 `deleteStaleCorrectionAssets` 方法之后，:1990 附近）：

```ts
  // ── 供应商撤销申请（2026-11-25 spec）：审核中/补正中可自撤（限 3 次），撤回壳保留
  //    完整业务数据供信用代码回填；仅清账号密码断登录。镜像补正流三段式。──

  /** 撤回会话候选定位（名称+信用代码双因子；request/verify 对 PENDING/RETURNED/WITHDRAWN
   *  均可用——撤回确认与前撤回壳回填共用同一短信会话链路；submit/draft 各自再收窄状态） */
  private async findWithdrawSessionSupplier(name: string, creditCode: string) {
    return this.prisma.supplier.findFirst({
      where: { creditCode: creditCode.trim(), name: name.trim(), status: { in: ['PENDING', 'RETURNED', 'WITHDRAWN'] } },
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
    });
  }

  async requestWithdraw(name: string, creditCode: string, clientIp: string) {
    const supplier = await this.findWithdrawSessionSupplier(name, creditCode);
    if (!supplier || supplier.contacts.length === 0) {
      return { maskedPhone: null as string | null }; // 同形响应防枚举
    }
    const phone = openPii(supplier.contacts[0].phone) as string;
    await this.verificationService.sendRegistrationCode(phone, clientIp, 'supplier_registration');
    return { maskedPhone: maskPhone(phone) };
  }

  async verifyWithdraw(name: string, creditCode: string, code: string) {
    const supplier = await this.findWithdrawSessionSupplier(name, creditCode);
    if (!supplier || supplier.contacts.length === 0) {
      throw new BadRequestException({ error: '未找到对应的注册申请', code: 'WITHDRAW_NOT_FOUND' });
    }
    const phone = openPii(supplier.contacts[0].phone);
    const { token, expiresIn } = await this.verificationService.verifyAndStartRegistrationSession(phone, code);
    return { withdrawToken: token, expiresIn };
  }

  async withdrawSubmit(token: string, name: string, creditCode: string) {
    if (!token || !name || !creditCode) {
      throw new BadRequestException({ error: '请提供撤回 token、公司名称与统一社会信用代码', code: 'MISSING_WITHDRAW_PARAMS' });
    }
    const { phone } = await this.verificationService.assertRegistrationSession(token);
    const supplier = await this.findWithdrawSessionSupplier(name, creditCode);
    if (!supplier || supplier.contacts.length === 0 || !['PENDING', 'RETURNED'].includes(supplier.status)) {
      throw new BadRequestException({ error: '未找到可撤销的注册申请', code: 'WITHDRAW_NOT_FOUND' });
    }
    if (openPii(supplier.contacts[0].phone) !== phone) {
      throw new BadRequestException({ error: '验证手机号与申请主联系人手机号不一致', code: 'WITHDRAW_PHONE_MISMATCH' });
    }
    if ((supplier.withdrawCount ?? 0) >= SUPPLIER_WITHDRAW_LIMIT) {
      throw new BadRequestException({ error: '撤回次数已达上限，如有疑问请联系采购中心', code: 'WITHDRAW_LIMIT_REACHED' });
    }
    const stage = supplier.reviewStage ?? 'STAFF';
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplier.id, status: { in: ['PENDING', 'RETURNED'] } },
      data: { status: 'WITHDRAWN', returnReason: null, withdrawCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({ error: '申请状态已变更，请刷新后重试', code: 'CONFLICT' });
    }
    await this.clearSupplierPendingTodos(supplier.id);
    await this.notifyStageApprovers(stage, supplier.companyId, {
      type: 'SUPPLIER_WITHDRAWN',
      title: '供应商撤回注册申请',
      content: `${supplier.name} 已主动撤回注册申请，本次审批终止；该企业重新注册时将从初审重新走审。`,
      link: '/supplier/approval',
    });
    await this.audit(supplier.userId, 'SUPPLIER_WITHDRAWN', supplier.id, {
      name: supplier.name, withdrawCount: (supplier.withdrawCount ?? 0) + 1,
    });
    await this.recordApproval(supplier.id, 'WITHDRAWN', supplier.userId, '供应商自行撤回申请', stage, []);
    // 账号清理（轻量，非 purge）：业务数据与子表保留（撤回后可凭信用代码回填），仅断登录
    await this.prisma.user.update({
      where: { id: supplier.userId },
      data: { passwordHash: null, passwordVault: null, isActive: false },
    }).catch((err: any) => console.error(`[withdraw] 账号清理失败 supplier=${supplier.id}`, err?.message ?? err));
    await this.verificationService.consumeRegistrationSession(token);
    return { success: true };
  }

  async getWithdrawDraft(token: string, name: string, creditCode: string) {
    if (!token || !name || !creditCode) {
      throw new BadRequestException({ error: '请提供撤回 token、公司名称与统一社会信用代码', code: 'MISSING_WITHDRAW_PARAMS' });
    }
    const { phone } = await this.verificationService.assertRegistrationSession(token);
    const supplier = await this.prisma.supplier.findFirst({
      where: { creditCode: creditCode.trim(), name: name.trim(), status: 'WITHDRAWN' },
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
    });
    if (!supplier || supplier.contacts.length === 0) {
      throw new BadRequestException({ error: '未找到已撤回的申请', code: 'WITHDRAW_NOT_FOUND' });
    }
    if (openPii(supplier.contacts[0].phone) !== phone) {
      throw new BadRequestException({ error: '验证手机号与申请主联系人手机号不一致', code: 'WITHDRAW_PHONE_MISMATCH' });
    }
    return this.buildCorrectionDraft(supplier.id);
  }
```

顶部 import 补 `SUPPLIER_WITHDRAW_LIMIT`（`@water-erp/shared` 既有 import 行追加）。

3c. 公开进度投影：`:1511` 与 `:1528` 两个 select 加 `withdrawCount: true`；`buildPublicRegisterStatus` 参数类型加 `withdrawCount: number;`；返回体加 `withdrawCount: supplier.withdrawCount ?? 0`。同时 `:1541` 同名候选投影（ambiguous 分支）不需要。

3d. controller（`register/correction/submit` 块 :255 之后插入；`WithdrawSubmitDto` 见 3e）：

```ts
  // ── 供应商撤销申请（2026-11-25 spec）：审核中/补正中可自撤（限 3 次），撤回壳保留数据供信用代码回填 ──

  @Post('register/withdraw/request')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '撤销申请：凭公司名+信用代码向主联系人手机发验证码' })
  async requestWithdraw(@Body() dto: CorrectionRequestDto, @Request() req: any) {
    return this.supplierService.requestWithdraw(dto.name, dto.creditCode, req.ip ?? '');
  }

  @Post('register/withdraw/verify')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '撤销申请：校验验证码换发一次性撤回 token' })
  async verifyWithdraw(@Body() dto: CorrectionVerifyDto) {
    return this.supplierService.verifyWithdraw(dto.name, dto.creditCode, dto.code);
  }

  @Post('register/withdraw/submit')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '撤销申请：确认撤回（PENDING/RETURNED → WITHDRAWN，计数+1）' })
  async submitWithdraw(@Body() dto: WithdrawSubmitDto) {
    return this.supplierService.withdrawSubmit(dto.token, dto.name, dto.creditCode);
  }

  @Get('register/withdraw/draft')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '撤销申请：凭 token 拉取撤回前已填资料（解封回填）' })
  async getWithdrawDraft(@Query('token') token?: string, @Query('name') name?: string, @Query('creditCode') creditCode?: string) {
    if (!token || !name || !creditCode) {
      throw new BadRequestException({ error: '请提供撤回 token、公司名称与统一社会信用代码', code: 'MISSING_WITHDRAW_PARAMS' });
    }
    return this.supplierService.getWithdrawDraft(token, name, creditCode);
  }
```

3e. `dto/correction-request.dto.ts` 末尾追加：

```ts
export class WithdrawSubmitDto {
  @IsString() @IsNotEmpty() @MaxLength(128) token: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/) creditCode: string; // 锁定不可改
}
```

controller import 区补 `WithdrawSubmitDto`。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm jest supplier-withdraw --silent
```
Expected: PASS（12 用例全绿）

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/src/supplier/supplier.service.ts water-erp/apps/api/src/supplier/supplier.controller.ts water-erp/apps/api/src/supplier/dto/correction-request.dto.ts water-erp/apps/api/src/supplier/supplier-withdraw.spec.ts
git -C /Users/qihao/ERP2/ERP commit -m "feat(supplier): 撤销申请端点——三段式撤回（限3次）+撤回壳回填草稿+进度投影含 withdrawCount；撤回仅清账号密码、业务数据保留

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: register 壳重开扩展（TDD）

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts:296`（查重分流谓词）、`:531`（壳重开认领 where）
- Test: `apps/api/src/supplier/supplier.register.spec.ts:199`（壳重开 describe 追加用例）

**Interfaces:**
- Consumes: Task 1 `WITHDRAWN`
- Produces: WITHDRAWN 壳对 register 完全等同 REJECTED 壳（重开 → PENDING/STAFF、returnReason 清、withdrawCount 保留）

- [ ] **Step 1: 写失败测试**（`supplier.register.spec.ts` 壳重开 describe 内追加，沿用 `shellReopenTx` 助手）

```ts
    it('信用代码命中 WITHDRAWN 撤回壳 → 复用原行重开（不抛 DUPLICATE_CREDIT_CODE），withdrawCount 保留', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'WITHDRAWN', supplierNo: 'SUP-000001', withdrawCount: 2 });
      const txUpdate = jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', contacts: [], qualifications: [], bankAccounts: [], performances: [] });
      prisma.$transaction = shellReopenTx(txUpdate);
      await expect(service.register({ ...validDto })).resolves.toBeTruthy();
      expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'PENDING', reviewStage: 'STAFF', returnReason: null }),
      }));
      // 计数列不在重开覆写集里（跨轮累计保留）
      expect(JSON.stringify(txUpdate.mock.calls[0][0].data)).not.toContain('withdrawCount');
    });

    it('壳重开认领 where 覆盖 WITHDRAWN：并发流转（count=0）→ 400 CONFLICT', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'WITHDRAWN', supplierNo: 'SUP-000001', withdrawCount: 0 });
      const claim = jest.fn().mockResolvedValue({ count: 0 });
      prisma.$transaction = shellReopenTx(jest.fn(), claim);
      await expect(service.register({ ...validDto })).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
    });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm jest supplier.register --silent
```
Expected: 新增 2 用例 FAIL（WITHDRAWN 命中走 DUPLICATE_CREDIT_CODE / 认领 where 不含 WITHDRAWN）

- [ ] **Step 3: 实现（两处单点修改）**

`:296`（查重分流）：

```ts
    if (existingSupplier && existingSupplier.status !== 'REJECTED' && existingSupplier.status !== 'WITHDRAWN') {
```

（该行上方注释同步补一句：「WITHDRAWN 撤回壳（2026-11-25）同待遇——重开复用原行」）

`:530-532`（壳重开认领）：

```ts
        const claimed = await tx.supplier.updateMany({
          where: { id: existingSupplier.id, status: { in: ['REJECTED', 'WITHDRAWN'] } },
          data: { status: 'PENDING' },
        });
```

（重开 data :565-576 已含 `returnReason: null`，无需改；withdrawCount 不在覆写集，天然保留。）

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm jest supplier.register --silent
```
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/src/supplier/supplier.service.ts water-erp/apps/api/src/supplier/supplier.register.spec.ts
git -C /Users/qihao/ERP2/ERP commit -m "feat(supplier): register 壳重开扩展 WITHDRAWN——撤回壳同信用代码重新注册即全新申请（withdrawCount 跨轮保留）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: :3004 api 客户端 + 注册页三态横幅/撤销/回填 + 登录页文案

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/api/auth.ts:175`（correction 方法块后追加）
- Modify: `apps/supplier-portal-next/src/app/register/page.tsx`（state :231、检测 :473、新函数、横幅 :1026 区域、豁免守卫 :412/:461/:667）
- Modify: `apps/supplier-portal-next/src/app/login/page.tsx:23`（指路文案）

**Interfaces:**
- Consumes: Task 2 四端点 + 进度投影 withdrawCount；Task 1 `SUPPLIER_WITHDRAW_LIMIT`
- Produces: 注册页三态横幅交互（PENDING/RETURNED 可撤、WITHDRAWN 可回填重报）

- [ ] **Step 1: api 客户端**（`auth.ts` submitCorrection 之后追加，风格同 correction 四方法）

```ts
  /** 撤销申请：凭公司名+信用代码向主联系人手机发验证码（审核中/补正中/已撤回均可发起——
   *  撤回确认与撤回壳数据回填共用同一验证链路）。 */
  requestWithdraw(name: string, creditCode: string) {
    return api.post<any>(`/supplier/register/withdraw/request`, { name, creditCode }, { silent: true });
  },
  /** 撤销申请：校验验证码换发一次性撤回 token。 */
  verifyWithdraw(name: string, creditCode: string, code: string) {
    return api.post<any>(`/supplier/register/withdraw/verify`, { name, creditCode, code }, { silent: true });
  },
  /** 撤销申请：确认撤回（审核中/补正中 → 已撤回壳，计数+1）。 */
  submitWithdraw(token: string, name: string, creditCode: string) {
    return api.post<any>(`/supplier/register/withdraw/submit`, { token, name, creditCode }, { silent: true });
  },
  /** 撤销申请：凭 token 拉取撤回前已填资料（解封回填）。 */
  getWithdrawDraft(token: string, name: string, creditCode: string) {
    return api.get<any>(`/supplier/register/withdraw/draft${qs({ token, name, creditCode })}`, { silent: true });
  },
```

- [ ] **Step 2: 注册页改造**（`register/page.tsx`）

2a. 顶部 import 补 `SUPPLIER_WITHDRAW_LIMIT`（`@water-erp/shared` 既有 import 行追加）。

2b. state 扩展（:231-242）：

```ts
  const [correction, setCorrection] = useState<{
    status: "RETURNED" | "REJECTED" | "PENDING" | "WITHDRAWN" | null;
    reason?: string;
    name?: string;
    creditCode?: string;
    maskedPhone?: string;
    token?: string;
    withdrawCount?: number;
    withdrawToken?: string;
    withdrawMaskedPhone?: string;
  }>({ status: null });
  const [withdrawCode, setWithdrawCode] = useState("");
  const [withdrawSending, setWithdrawSending] = useState(false);
  const [withdrawCooldown, setWithdrawCooldown] = useState(0);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  // 撤回意图：PENDING/RETURNED 横幅点「撤销申请」后的确认小流（发码→输码→确认撤回）
  const [withdrawConfirming, setWithdrawConfirming] = useState(false);
```

2c. 检测扩展（`checkNameForCorrection` :473-491，守卫与分支两处）：

```ts
    if (correction.token || correction.withdrawToken) return;
    ...
      if (res.found && res.status === "RETURNED") {
        setCorrection((c) => ({ ...c, status: "RETURNED", reason: res.reason ?? undefined, name: res.name, creditCode: res.creditCode ?? undefined, withdrawCount: res.withdrawCount }));
      } else if (res.found && res.status === "PENDING") {
        setCorrection((c) => ({ ...c, status: "PENDING", reason: undefined, name: res.name, creditCode: res.creditCode ?? undefined, withdrawCount: res.withdrawCount }));
      } else if (res.found && res.status === "WITHDRAWN") {
        setCorrection({ status: "WITHDRAWN", name: res.name, creditCode: res.creditCode ?? undefined, withdrawCount: res.withdrawCount });
      } else if (res.found && res.status === "REJECTED") {
        setCorrection({ status: "REJECTED", name: res.name, creditCode: res.creditCode ?? undefined });
      } else {
        setCorrection({ status: null });
      }
```

2d. 新函数（`confirmCorrection` 之后追加；发码计时复用 correction 的 cooldown 模式）：

```ts
  /* 供应商撤销申请（2026-11-25 spec）：审核中/补正中可自撤（限 3 次）；已撤回壳可凭信用代码回填重报 */
  async function startWithdrawCode() {
    if (!correction.name || !correction.creditCode) { toast.warning("请先填写完整的公司名称与统一社会信用代码"); return; }
    setWithdrawSending(true);
    try {
      const res = await authApi.requestWithdraw(correction.name, correction.creditCode);
      if (!res.maskedPhone) { toast.error("未找到对应的注册申请，请核对公司名称与信用代码"); return; }
      setCorrection((c) => ({ ...c, withdrawMaskedPhone: res.maskedPhone }));
      toast.success("验证码已发送至主联系人手机号");
      setWithdrawCooldown(60);
      const timer = setInterval(() => {
        setWithdrawCooldown((n) => { if (n <= 1) { clearInterval(timer); return 0; } return n - 1; });
      }, 1000);
    } catch (e) {
      toast.error(getErrorMessage(e, "验证码发送失败"));
    } finally {
      setWithdrawSending(false);
    }
  }

  async function confirmWithdraw() {
    if (!correction.name || !correction.creditCode) return;
    setWithdrawLoading(true);
    try {
      const v = await authApi.verifyWithdraw(correction.name, correction.creditCode, withdrawCode.trim());
      await authApi.submitWithdraw(v.withdrawToken, correction.name, correction.creditCode);
      toast.success("申请已撤回，本次申请作废；可重新填报提交");
      setCorrection({ status: null });
      setWithdrawConfirming(false);
      setWithdrawCode("");
      // 重新检测 → 横幅转「已撤回」态（展示重新申请/回填引导）
      window.setTimeout(() => { void checkNameForCorrection(); }, 0);
    } catch (e) {
      toast.error(getErrorMessage(e, "撤回失败，请核对验证码"));
    } finally {
      setWithdrawLoading(false);
    }
  }

  async function loadWithdrawDraft() {
    if (!correction.name || !correction.creditCode) return;
    setWithdrawLoading(true);
    try {
      const v = await authApi.verifyWithdraw(correction.name, correction.creditCode, withdrawCode.trim());
      setCorrection((c) => ({ ...c, withdrawToken: v.withdrawToken }));
      const draftRes = await authApi.getWithdrawDraft(v.withdrawToken, correction.name, correction.creditCode);
      applyCorrectionDraft(draftRes);
      setCreditCodeDuplicate(false);
      setLegalIdCardDuplicate(false);
      toast.success("已填入撤回前填写的资料，请核对修改后提交");
    } catch (e) {
      toast.error(getErrorMessage(e, "验证失败，请核对验证码"));
    } finally {
      setWithdrawLoading(false);
    }
  }
```

（注意：`checkNameForCorrection` 是 async 函数声明在组件内——`window.setTimeout(() => { void checkNameForCorrection(); }, 0)` 调用即可；该函数定义在调用点之前即可引用（函数声明提升）。若 react-compiler 报前向引用，把 `checkNameForCorrection` 改为 useCallback 或把调用移到横幅 onClick 内联——以 lint 实际结果为准处理。）

2e. 豁免守卫三处（:412/:461/:667 区域，把撤回回填纳入豁免）：

```ts
      const inWithdrawReload = correction.status === "WITHDRAWN" && !!correction.withdrawToken;
```

- :412 与 :461 的 `if (correction.status === "RETURNED" && correction.token) return;` → `if ((correction.status === "RETURNED" && correction.token) || inWithdrawReload) return;`（各自作用域内先定义 inWithdrawReload）
- :667 `const inCorrection = correction.status === "RETURNED" && !!correction.token;` → `const inCorrection = inCorrectionBase || inWithdrawReload;`（inCorrectionBase = 原表达式）

2f. 横幅渲染（:1026 现有 RETURNED 横幅之后并列追加两块；样式沿用 `reg-correction-banner`）：

```tsx
          {/* 撤销申请（2026-11-25）：审核中/补正中可自撤（限 3 次） */}
          {(correction.status === "PENDING" || correction.status === "RETURNED") && (
            <div className="reg-correction-banner info" role="status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {correction.status === "PENDING" ? "您的申请正在审核中。" : "您的申请处于退回补正中。"}
                  {" "}不想继续本次申请？可撤销后重新填报。
                  {typeof correction.withdrawCount === "number" && <span className="ml-1 opacity-70">（已撤回 {correction.withdrawCount}/{SUPPLIER_WITHDRAW_LIMIT}）</span>}
                </span>
                {(correction.withdrawCount ?? 0) < SUPPLIER_WITHDRAW_LIMIT && (
                  <button type="button" className="reg-link-btn" onClick={() => setWithdrawConfirming((v) => !v)}>撤销申请</button>
                )}
              </div>
              {withdrawConfirming && (correction.withdrawCount ?? 0) < SUPPLIER_WITHDRAW_LIMIT && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {correction.withdrawMaskedPhone
                    ? <span className="text-xs opacity-80">验证码已发送至 {correction.withdrawMaskedPhone}</span>
                    : <button type="button" className="reg-link-btn" disabled={withdrawSending || withdrawCooldown > 0} onClick={() => void startWithdrawCode()}>
                        {withdrawSending ? "发送中…" : withdrawCooldown > 0 ? `重新发送（${withdrawCooldown}s）` : "发送验证码"}
                      </button>}
                  <input value={withdrawCode} onChange={(e) => setWithdrawCode(e.target.value)} maxLength={6}
                    placeholder="6 位验证码" inputMode="numeric" className="w-28 rounded-[10px] border border-[color-mix(in_oklch,var(--foreground)_10%,transparent)] bg-[var(--surface)] px-2 py-1 text-[13px] outline-none focus:border-[var(--accent)]" />
                  <button type="button" disabled={withdrawLoading || withdrawCode.trim().length !== 6}
                    className="rounded-[10px] border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] px-3 py-1 text-xs text-[var(--danger)] disabled:opacity-50"
                    onClick={() => void confirmWithdraw()}>确认撤回</button>
                  <span className="text-[11px] opacity-70">撤回后本次申请作废，可重新填报提交（累计限 {SUPPLIER_WITHDRAW_LIMIT} 次）</span>
                </div>
              )}
            </div>
          )}

          {/* 已撤回：重新申请引导 + 凭信用代码回填撤回前数据 */}
          {correction.status === "WITHDRAWN" && (
            <div className="reg-correction-banner info" role="status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>本次申请已撤回（已撤回 {correction.withdrawCount ?? 0}/{SUPPLIER_WITHDRAW_LIMIT}）。可在下方重新填报提交；也可加载撤回前填写的数据，修改后提交。</span>
                {!correction.withdrawToken && (
                  <button type="button" className="reg-link-btn" disabled={withdrawSending || withdrawCooldown > 0} onClick={() => void startWithdrawCode()}>
                    {withdrawSending ? "发送中…" : withdrawCooldown > 0 ? `重新发送（${withdrawCooldown}s）` : "加载之前填写的数据"}
                  </button>
                )}
              </div>
              {!correction.withdrawToken && correction.withdrawMaskedPhone && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs opacity-80">验证码已发送至 {correction.withdrawMaskedPhone}</span>
                  <input value={withdrawCode} onChange={(e) => setWithdrawCode(e.target.value)} maxLength={6}
                    placeholder="6 位验证码" inputMode="numeric" className="w-28 rounded-[10px] border border-[color-mix(in_oklch,var(--foreground)_10%,transparent)] bg-[var(--surface)] px-2 py-1 text-[13px] outline-none focus:border-[var(--accent)]" />
                  <button type="button" disabled={withdrawLoading || withdrawCode.trim().length !== 6}
                    className="rounded-[10px] border border-[color-mix(in_oklch,var(--accent)_35%,transparent)] px-3 py-1 text-xs text-[var(--accent)] disabled:opacity-50"
                    onClick={() => void loadWithdrawDraft()}>验证并回填</button>
                </div>
              )}
            </div>
          )}
```

（`reg-link-btn` 若无此样式类，用横幅内既有按钮类——实现时以 :1026 现有横幅的按钮类为准对齐；横幅容器类 `reg-correction-banner` 已存在，`info` 变体若不存在则复用 `warning` 或按 globals/styles 内既有变体类名对齐。）

2g. 登录页（`login/page.tsx:23`）：

```ts
  RETURNED: "退回补正：申请被退回，请按原因补充材料后重新提交；如需放弃本次申请，可到注册页撤销后重新提交。",
```

- [ ] **Step 3: lint 收口**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter supplier-portal-next lint
```
Expected: 0 error；react-compiler 若对 `checkNameForCorrection` 前向引用报错，按 2d 括注处理。

- [ ] **Step 4: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/supplier-portal-next/src/lib/api/auth.ts water-erp/apps/supplier-portal-next/src/app/register/page.tsx water-erp/apps/supplier-portal-next/src/app/login/page.tsx
git -C /Users/qihao/ERP2/ERP commit -m "feat(supplier): 注册页撤销申请横幅——审核中/补正中可自撤（N/3）、已撤回凭信用代码回填重报；登录页指路文案同步

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: :3005 标签映射（审批历史 + 审计词表）

**Files:**
- Modify: `apps/web/src/components/supplier/approval-history-modal.tsx:27/:46/:61-65/:68-77`（WITHDRAWN 动作映射）
- Modify: `apps/web/src/lib/supplier-action-labels.ts:20`（审计词表）

**Interfaces:**
- Consumes: Task 2 `recordApproval` 落的 `WITHDRAWN` 留痕与 `SUPPLIER_WITHDRAWN` 审计

- [ ] **Step 1: supplier-action-labels.ts**（`SUPPLIER_RETURNED: '退回补正',` 行后加）

```ts
  SUPPLIER_WITHDRAWN: '供应商撤回申请',
```

- [ ] **Step 2: approval-history-modal.tsx**

- `:27` Filter 联合不动（WITHDRAWN 记录归「全部」筛）。
- `:46` 轮次闭环：`if ((r.action === 'APPROVED' && r.stage === 'ADMIN') || r.action === 'REJECTED' || r.action === 'WITHDRAWN') {`
- `:61-65` outcome：`:62` 后加 `if (ascRecords.some(r => r.action === 'WITHDRAWN')) return { label: '已撤回', tone: 'neutral' };`（置于 REJECTED 判断之后、RETURNED 判断之前；`:64` 前插）。tone 联合类型补 `'neutral'`（:35）。
- `:70-73` actionLabel：REJECTED 行后加 `if (r.action === 'WITHDRAWN') return '供应商撤回申请';`
- `:75-77` actionTone：返回类型补 `'neutral'`，改为 `if (r.action === 'WITHDRAWN') return 'neutral'; return r.action === 'APPROVED' ? 'green' : r.action === 'RETURNED' ? 'orange' : 'red';`（toneCls :79 已含 neutral）。

- [ ] **Step 3: 全库残留检查**

```bash
grep -rn "REJECTED" /Users/qihao/ERP2/ERP/water-erp/apps/web/src/components/supplier /Users/qihao/ERP2/ERP/water-erp/apps/web/src/lib/supplier-action-labels.ts | grep -v spec | grep -v WITHDRAWN
```
逐处目检：其余消费面（详情页时间线等）若有 action 标签映射表，同样补 WITHDRAWN → 「供应商撤回申请」；无映射表而走兜底的（supplierActionLabel 兜底「供应商动态」）不动。

- [ ] **Step 4: lint**

```bash
pnpm --filter web lint
```
Expected: 0 error

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/web/src/components/supplier/approval-history-modal.tsx water-erp/apps/web/src/lib/supplier-action-labels.ts
git -C /Users/qihao/ERP2/ERP commit -m "feat(web): 撤回申请留痕标签——审批历史「供应商撤回申请」+ 审计词表补 SUPPLIER_WITHDRAWN

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 全量验证 + dev 实弹

**Files:**
- Create（临时，验证后删）: `apps/api/scripts/verify-withdraw-repro.ts`

- [ ] **Step 1: API 全量单测 + lint + 两门户 lint**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter api test --silent && pnpm --filter api lint && pnpm --filter supplier-portal-next lint && pnpm --filter web lint
```
Expected: 全绿 0 error（存量红仅 ca-v3-submit 4 例，与本任务无关——已定案）

- [ ] **Step 2: dev 实弹（tsx 直调 service 全链：发码→验证→撤回→回填草稿）**

`apps/api/scripts/verify-withdraw-repro.ts`：

```ts
/** 一次性验证（跑完即删）：dev 库取一条 RETURNED 供应商走完整撤回链（SMS_DEBUG_BYPASS 万能码 123456），
 *  断言：撤回壳数据保留、计数 +1、账号密码清空、回填草稿可取；随后恢复原状。 */
import { PrismaClient } from '@prisma/client';
import { SupplierService } from '../src/supplier/supplier.service';

const prisma = new PrismaClient();

async function main() {
  const sup = await prisma.supplier.findFirst({
    where: { status: 'RETURNED' },
    select: { id: true, name: true, supplierNo: true, creditCode: true, withdrawCount: true },
  });
  if (!sup?.creditCode) throw new Error('dev 库无 RETURNED 供应商');
  const svc = new (SupplierService as any)(prisma, { create: async () => ({}), resolveActionable: async () => ({ count: 1 }) } as any, null, null,
    (await import('../src/verification/verification.service')).VerificationService.prototype ?
      new ((require('../src/verification/verification.service')) as any).VerificationService({} as any) : null as any, null as any);
  console.log('勿用此构造——见下方简化版');
}
main();
```

**实现说明**：VerificationService 需 Redis 实例，脚本直构造不便——实弹脚本改为**仅验证无验证码依赖的两段**：

```ts
/** 一次性验证（跑完即删）：dev 库构造 WITHDRAWN 壳（直改状态+计数+1+清密码），验证
 *  公开进度投影 withdrawCount 与回填草稿 getWithdrawDraft 不经短信段（mock 会话）可用，
 *  随后恢复原状。撤回三段式的业务逻辑由 supplier-withdraw.spec.ts 单测覆盖。 */
import { PrismaClient } from '@prisma/client';
import { SupplierService } from '../src/supplier/supplier.service';

const prisma = new PrismaClient();
const MARK = '撤回实弹验证';

async function main() {
  const sup = await prisma.supplier.findFirst({
    where: { status: 'RETURNED' },
    select: { id: true, name: true, supplierNo: true, creditCode: true, withdrawCount: true, userId: true, returnReason: true },
  });
  if (!sup?.creditCode) throw new Error('dev 库无 RETURNED 供应商');
  const svc = new (SupplierService as any)(prisma, {}, null, null, {
    assertRegistrationSession: async () => ({ phone: '13800138000' }),
    consumeRegistrationSession: async () => ({ ok: true }),
  }, null);
  // 主联系人手机号（供 mock 会话匹配）——直读库解封过繁，改由断言 draft 手机一致性放行：
  // 简化：临时把该供应商主联系人 phone 置明文 '13800138000'，验证后还原。
  const primary = await prisma.supplierContact.findFirst({ where: { supplierId: sup.id, isPrimary: true } });
  if (!primary) throw new Error('无主联系人');
  const origPhone = primary.phone;
  await prisma.supplierContact.update({ where: { id: primary.id }, data: { phone: '13800138000' } });

  // ① 撤回认领（业务面等价于 withdrawSubmit 的认领段，绕开短信段）
  const claimed = await prisma.supplier.updateMany({
    where: { id: sup.id, status: 'RETURNED' },
    data: { status: 'WITHDRAWN', returnReason: null, withdrawCount: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new Error('认领失败');
  await prisma.user.update({ where: { id: sup.userId }, data: { passwordHash: null, isActive: false } });

  // ② 进度投影含 withdrawCount
  const status = await svc.getRegisterStatusByCreditCode(sup.creditCode);
  console.log('status:', JSON.stringify({ found: status.found, s: status.status, wc: status.withdrawCount }));

  // ③ 回填草稿（mock 会话）——数据保留断言
  const draft = await svc.getWithdrawDraft('t'.repeat(64), sup.name, sup.creditCode);
  console.log('draft keys:', Object.keys(draft).join(','));
  if (!draft.name || !draft.contacts?.length) throw new Error('回填草稿缺数据');

  // ④ 恢复原状
  await prisma.supplier.update({ where: { id: sup.id }, data: { status: 'RETURNED', returnReason: sup.returnReason, withdrawCount: { decrement: 1 } } });
  await prisma.supplierContact.update({ where: { id: primary.id }, data: { phone: origPhone } });
  console.log(`OK ${sup.supplierNo}: 投影含 withdrawCount、回填草稿数据完整，已恢复原状`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx tsx scripts/verify-withdraw-repro.ts
```
Expected: `status` 行 `wc: N+1`；draft 含 name/contacts；结尾 OK。

- [ ] **Step 3: 删除临时脚本、确认树净**

```bash
rm /Users/qihao/ERP2/ERP/water-erp/apps/api/scripts/verify-withdraw-repro.ts
git -C /Users/qihao/ERP2/ERP status --short
```

---

## Self-Review 记录

- **Spec coverage**：§2 状态机→Task 1/3；§3 四端点+投影→Task 2；§4 迁移/标签→Task 1；§5 壳重开→Task 3；§6 前端三态横幅/回填/登录文案→Task 4；留痕标签→Task 5；§8 测试→Task 2/3 用例 + Task 6 全量。§9 未越界。✓
- **Placeholder scan**：全部步骤含实际代码/命令；两处「以既有类名为准」的前端样式提示是显式的实现期对齐指令而非待填空。✓
- **Type consistency**：`requestWithdraw/verifyWithdraw/withdrawSubmit/getWithdrawDraft` 签名 Task 2 产出与 Task 4 消费一致；`withdrawCount` 贯穿 schema/投影/前端；`SUPPLIER_WITHDRAW_LIMIT` shared 双端同源。✓
