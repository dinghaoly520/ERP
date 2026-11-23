# 忘记密码重置申请资格闸 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /auth/password-reset-requests` 增加申请对象资格闸——仅已入库供应商（`Supplier.status=APPROVED`）与内部账号可申请，其余（审核中/退回/驳回/停用/黑名单/不存在）统一 400 拒绝、不落库不通知。

**Architecture:** 后端 `PasswordRequestsService.submitReset` 单点收口（端点为 :3004/:3005 共用公共路径，前端预检可绕过故不做）；验证码核验保持在资格判定之前（维持探测成本）；两门户弹窗仅改两句失真文案，服务端统一文案经 `ApiError.message`（=body.error）原样透出，零新增 UI。

**Tech Stack:** NestJS 11 + Prisma + jest（后端单测 mock 直构 service，本 spec 既有范式）。

**Spec:** `docs/superpowers/specs/2026-11-23-supplier-pwd-reset-eligibility-design.md`

## Global Constraints

- 统一拒绝文案逐字：「未找到可受理密码重置申请的账号。请核对登录账号是否正确（供应商账号须已入库方可申请）；如有疑问请联系采购中心。」错误码 `RESET_NOT_ELIGIBLE`。
- 顺序铁律：`verifyRegistrationCode` 在资格判定**之前**。
- 既有 3 条重置用例（matchedUserId 不外泄/落库哈希/验证码错误）不改；`listPendingResets('internal')` 的 unmatched 存量口径与 `NO_MATCHED_USER` 闸保留。
- 仓库根 `/Users/qihao/ERP2/ERP`，工作目录 `/Users/qihao/ERP2/ERP/water-erp`；git 一律 `git -C /Users/qihao/ERP2/ERP`，只 add 明确文件（并行会话约定）。
- commit 中文、`fix(auth):` 前缀，尾部 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

### Task 1: 后端资格闸（TDD）

**Files:**
- Modify: `apps/api/src/auth/password-requests.service.ts`（`submitReset`，:93-119）
- Test: `apps/api/src/auth/password-requests.spec.ts`（文件末尾新增 describe）

**Interfaces:**
- Produces: `submitReset` 行为契约——不合格输入抛 `BadRequestException`，`response = { error: <统一文案>, code: 'RESET_NOT_ELIGIBLE' }`；合格输入照旧返回 `{ id, status, requestedAt }`
- 不改：`notifyResetReviewers`、`listPendingResets`、`approveReset`、controller

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/auth/password-requests.spec.ts` 文件末尾追加：

```ts
describe('submitReset 资格闸（2026-11-23 用户裁定：仅已入库供应商或内部账号可申请）', () => {
  const mkSvc = (findFirst: jest.Mock) => {
    const prisma = {
      user: { findFirst, findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findUnique: jest.fn().mockResolvedValue(null) },
      passwordResetRequest: { create: jest.fn().mockResolvedValue({ id: 'pr-1', status: 'PENDING', requestedAt: new Date() }) },
      notification: { create: jest.fn() },
    };
    const verifyRegistrationCode = jest.fn().mockResolvedValue({ ok: true });
    const service = new PasswordRequestsService(prisma as any, { verifyRegistrationCode } as any);
    return { prisma, verifyRegistrationCode, service };
  };
  const CALL = ['91510100MA6CPPPP00', '张三', '13800138000', '123456', 'Pass1234'] as const;

  it('已入库供应商（APPROVED）→ 照旧受理：落库且 matchedUserId 写入', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'sup-1', role: 'supplier', supplier: { status: 'APPROVED' } }));
    await service.submitReset(...CALL);
    expect(prisma.passwordResetRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matchedUserId: 'sup-1' }),
    }));
  });

  it('审核中/退回/驳回/停用/黑名单供应商 → 统一 400 RESET_NOT_ELIGIBLE，零落库零通知', async () => {
    for (const status of ['PENDING', 'RETURNED', 'REJECTED', 'DISABLED', 'BLACKLIST']) {
      const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'sup-x', role: 'supplier', supplier: { status } }));
      await expect(service.submitReset(...CALL)).rejects.toMatchObject({
        response: { code: 'RESET_NOT_ELIGIBLE', error: expect.stringContaining('已入库') },
      });
      expect(prisma.passwordResetRequest.create).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    }
  });

  it('供应商角色但无 Supplier 行（数据残缺）→ 从严拒绝', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'sup-bare', role: 'supplier', supplier: null }));
    await expect(service.submitReset(...CALL)).rejects.toMatchObject({ response: { code: 'RESET_NOT_ELIGIBLE' } });
    expect(prisma.passwordResetRequest.create).not.toHaveBeenCalled();
  });

  it('账号不存在/未激活（findFirst → null）→ 拒绝且不产生垃圾申请', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue(null));
    await expect(service.submitReset('不存在的账号', '张三', '13800138000', '123456', 'Pass1234')).rejects.toMatchObject({ response: { code: 'RESET_NOT_ELIGIBLE' } });
    expect(prisma.passwordResetRequest.create).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled(); // 未走到 admin 通知兜底
  });

  it('内部账号（非供应商角色）→ 照旧受理', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'staff-1', role: 'staff' }));
    await service.submitReset('Swhi-CGZX-05', '张三', '13800138000', '123456', 'Pass1234');
    expect(prisma.passwordResetRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matchedUserId: 'staff-1' }),
    }));
  });

  it('拒绝前验证码已核验（短信成本门槛在最前）', async () => {
    const { verifyRegistrationCode, service } = mkSvc(jest.fn().mockResolvedValue(null));
    await expect(service.submitReset(...CALL)).rejects.toMatchObject({ response: { code: 'RESET_NOT_ELIGIBLE' } });
    expect(verifyRegistrationCode).toHaveBeenCalledWith('13800138000', '123456');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/auth/password-requests.spec.ts -t "资格闸"
```

Expected: FAIL——新 describe 6 条中 5 条拒绝类用例不抛（当前 submitReset 无条件 create 落库），APPROVED/内部两条受理用例可能直接绿（现状本就受理）。

- [ ] **Step 3: 最小实现**

`apps/api/src/auth/password-requests.service.ts` 的 `submitReset` 整体替换为：

```ts
  /** 忘记密码重置申请（登录页，匿名；2026-11-23 资格闸修订）：仅已入库供应商
   *  （Supplier.status=APPROVED）与内部账号可申请。审核中/退回/驳回/停用/黑名单/
   *  账号不存在统一 400 拒绝——不区分具体状态（审核进度不外泄，与登录侧防枚举同精神），
   *  不落库不通知；验证码核验保持在资格判定之前（探测须消耗实名短信+限流）。
   *  原先「未匹配也受理」的假成功路径废止（垃圾申请+全量 admin 通知根因）；存量
   *  unmatched 行仍可在 :3005 审批面查看/驳回（listPendingResets internal 口径保留）。 */
  async submitReset(username: string, applicantName: string, applicantContact: string, verificationCode: string, newPassword: string) {
    await this.verificationService.verifyRegistrationCode(applicantContact, verificationCode); // 验证按原文（Redis 键，不落库）
    const matched = await this.prisma.user.findFirst({
      where: { username, isActive: true },
      select: { id: true, passwordHash: true, role: true, supplier: { select: { status: true } } },
    });
    if (!matched || (matched.role === 'supplier' && matched.supplier?.status !== 'APPROVED')) {
      throw new BadRequestException({
        error: '未找到可受理密码重置申请的账号。请核对登录账号是否正确（供应商账号须已入库方可申请）；如有疑问请联系采购中心。',
        code: 'RESET_NOT_ELIGIBLE',
      });
    }
    const sealedContact = sealPii(applicantContact) as string; // PII 国密密封落库（等保+密评）
    const normalized = hashSync(newPassword, 10);
    const created = await this.prisma.passwordResetRequest.create({
      data: {
        requestedUsername: username,
        applicantName,
        applicantContact: sealedContact,
        matchedUserId: matched.id,
        requestedPasswordHash: normalized,
        requestedPasswordVault: encryptPasswordVault(newPassword) ?? null,
      },
      // 匿名响应不返回 matchedUserId，避免用接口枚举真实账号。
      select: { id: true, status: true, requestedAt: true },
    });

    // 提交通知（2026-10-15 修复「提交后采购端未发现待审记录」）：此前提交侧零通知，
    // 审批入口又分裂（供应商账号→审批中心·密码重置；内部/未匹配→账号管理·安全审批），
    // 采购端无任何被动渠道知晓。通知失败不阻断提交（申请已落库）。
    try { await this.notifyResetReviewers(matched, username, applicantName); } catch { /* 不阻断 */ }
    return created;
  }
```

- [ ] **Step 4: 跑测试确认通过（含既有用例回归）**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/auth/password-requests.spec.ts
```

Expected: 全绿（既有 3 条重置用例：mock 无 role → 内部口径照旧受理，不受影响）。

- [ ] **Step 5: auth 域全量回归 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/auth/
```

Expected: 全绿。然后：

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/src/auth/password-requests.service.ts water-erp/apps/api/src/auth/password-requests.spec.ts
git -C /Users/qihao/ERP2/ERP commit -m "fix(auth): 忘记密码重置申请资格闸——仅已入库供应商（APPROVED）或内部账号可申请；审核中/退回/驳回/停用/黑名单/账号不存在统一 400 RESET_NOT_ELIGIBLE 不落库不通知（2026-11-23 用户裁定：明确拒绝+统一文案）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 两门户弹窗文案 + CLAUDE.md 说明

**Files:**
- Modify: `apps/supplier-portal-next/src/components/auth/password-reset-request-dialog.tsx`（:161 成功段、:226-229 黄色提示）
- Modify: `apps/web/src/components/login/forgot-password-dialog.tsx`（:133-135 成功提示）
- Modify: `CLAUDE.md`（password-reset-requests 端点说明一句）

**Interfaces:**
- Consumes: Task 1 的统一拒绝文案经 `ApiError.message` 自动透出（packages/client：message 取 body.error 优先）——无需接线
- 前端无测试断言这三处文案（已核：a11y/validator 测试不覆盖）

- [ ] **Step 1: :3004 成功段文案**

`password-reset-request-dialog.tsx` :161 原文：

```
无论账号是否存在，平台都会按统一流程受理。管理员审核通过后会按你填写的新密码更新账号，并提示申请人完成后续登录与密码确认。
```

替换为：

```
管理员审核通过后，将按你填写的新密码更新账号；届时请使用新密码登录并及时修改。
```

- [ ] **Step 2: :3004 黄色提示补资格说明**

:226-229 原文末句：

```
验证码将发送至该手机号，须为申请人本人号码；申请提交后经采购管理人员审核，通过后生效。
```

替换为：

```
验证码将发送至该手机号，须为申请人本人号码；申请提交后经采购管理人员审核，通过后生效。仅已入库的供应商账号可申请密码重置。
```

- [ ] **Step 3: :3005 成功提示文案**

`forgot-password-dialog.tsx` :133-135 原文：

```ts
      setSuccessMessage(
        "申请已提交。无论账号是否存在，平台都会按统一流程受理；审核通过后将按本次填写的新密码生效。",
      );
```

替换为：

```ts
      setSuccessMessage(
        "申请已提交。管理员审核通过后，将按本次填写的新密码生效。",
      );
```

- [ ] **Step 4: CLAUDE.md 端点说明**

原文（三合一账号管理段内）：

```
用户端 `POST /auth/password-reset-requests`（@Public 忘记密码，不泄露账号存在性）
```

替换为：

```
用户端 `POST /auth/password-reset-requests`（@Public 忘记密码；2026-11-23 用户裁定：仅已入库供应商 APPROVED 或内部账号可申请，其余含账号不存在统一 400 `RESET_NOT_ELIGIBLE` 不落库）
```

- [ ] **Step 5: 两门户前端测试回归 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && pnpm test
cd /Users/qihao/ERP2/ERP/water-erp/apps/supplier-portal-next && pnpm test
```

Expected: 全绿（无文案断言，纯回归）。然后：

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/supplier-portal-next/src/components/auth/password-reset-request-dialog.tsx water-erp/apps/web/src/components/login/forgot-password-dialog.tsx CLAUDE.md
git -C /Users/qihao/ERP2/ERP commit -m "fix(auth): 忘记密码两门户弹窗文案对齐资格闸（删「无论账号是否存在均受理」失真句+补「仅已入库可申请」提示）+ CLAUDE.md 端点口径更新

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 手动验收（可选，dev 环境核对）

- [ ] :3004 登录页「忘记密码」：输入审核中/不存在账号 + 万能码 123456（SMS_DEBUG_BYPASS）→ 提交被拒，显示统一文案；输入已入库供应商账号（如种子「重庆蜀通岩土工程有限公司」对应信用代码）→ 提交成功进待审批。
- [ ] :3005 供应商管理中心·密码重置审批面：确认垃圾申请不再新增；存量行可正常驳回。
