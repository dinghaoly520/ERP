# 忘记密码重置申请资格闸（仅已入库供应商/内部账号可申请）— 设计

**日期**：2026-11-23
**状态**：已批准（用户裁定：明确拒绝 + 统一文案；直接实施）

## 1. 问题

`POST /auth/password-reset-requests`（@Public，:3004 供应商门户与 :3005 忘记密码弹窗共用）
对申请对象**零资格校验**（`PasswordRequestsService.submitReset`）：

- 按 username 匹配任意活跃账号（不看角色、不看供应商状态）；
- 未匹配（账号不存在/未激活——**审核中的供应商 `isActive=false` 即落此桶**）也照样落
  PENDING 申请并通知管理员（内部/未匹配 → admin 全体）。

即「任何人都可以对任何账号名提交忘记密码申请」：审核中供应商、不存在账号均产生
待审批垃圾件 + 全量 admin 通知。唯一前置闸是发到申请人自填手机的短信验证码。

根因：2026-08-21 实现时的契约是「不泄露账号是否存在，统一返回受理」，与新业务规则
（仅已入库供应商可申请）冲突。

## 2. 用户裁定（2026-11-23）

1. **仅已入库供应商账户可申请**：供应商账号须 `Supplier.status === 'APPROVED'`
   （枚举注释即「审核通过/已入库」）。审核中（PENDING）/退回补正（RETURNED）/
   被驳回（REJECTED）/停用（DISABLED）/黑名单（BLACKLIST）一律拒绝——后四者本就
   `isActive=false` 登录不进，重置密码无意义。
2. **明确拒绝 + 统一文案**：不符合条件一律提交失败；**不区分**「账号不存在/审核中/
   退回/驳回/停用/黑名单」——审核进度不外泄（登录侧同款防枚举精神：状态细分仅在
   证明知道密码后才给出）。账号不存在/输错同样拒绝（消除垃圾申请与 admin 通知骚扰）。
3. 内部账号（staff/leader/admin 等非供应商角色，:3005 入口）行为不变，照旧受理。

### 2.1 资格判定的时点门槛

短信验证码核验保持在资格判定**之前**（维持探测成本：每次试探须消耗一条发往实名
手机的验证码 + 端点限流 5/min）。

## 3. 方案（A：后端服务层权威闸）

`PasswordRequestsService.submitReset`（唯一后端改动点）：

```
verifyRegistrationCode(applicantContact, code)          // 既有，不变（成本门槛）
  ↓
findFirst({ username, isActive: true },
          select: { id, role, supplier: { status } })
  ↓
不满足资格 → 400 RESET_NOT_ELIGIBLE（统一文案，不落库、不通知）
满足       → 照旧 create（matchedUserId 必非空）+ notifyResetReviewers（不变）
```

- 资格 = 解析到活跃账号，且（非 supplier 角色 **或** `supplier.status === 'APPROVED'`）。
- 供应商角色但无 Supplier 行（数据残缺）→ 不满足资格（安全闸从严）。
- 「未匹配」分支不再产生新数据；存量 unmatched 行仍可在 :3005 审批面查看/驳回
  （`listPendingResets('internal')` 与 `NO_MATCHED_USER` 闸保留，兼容存量）。
- 统一文案（单一来源，经 ApiError.message 原样透出两门户弹窗；2026-11-23 文案打磨后定稿）：
  「未找到可申请密码重置的账号，请核对登录账号。供应商账号须已入库方可申请，
  如有疑问请联系采购中心。」

### 3.1 行为矩阵（修复后）

| 申请对象 | 现状 | 修复后 |
|---|---|---|
| 已入库供应商（APPROVED） | 受理 | 受理（不变） |
| 审核中/退回/驳回/停用/黑名单 | 受理（进 admin 队列） | 拒绝（统一文案） |
| 账号不存在/输错 | 受理（垃圾申请+通知全体 admin） | 拒绝（统一文案） |
| 内部账号 | 受理 | 受理（不变） |

## 4. 前端（两门户弹窗，仅改失真文案，零新增 UI）

- :3004 `password-reset-request-dialog.tsx`：
  - 成功段「无论账号是否存在，平台都会按统一流程受理。…」→「管理员审核通过后，将按
    你填写的新密码更新账号；届时请使用新密码登录。」
  - 黄色提示末尾补「仅已入库的供应商账号可申请密码重置。」
- :3005 `forgot-password-dialog.tsx` 成功提示「申请已提交。无论账号是否存在，平台都会
  按统一流程受理；…」→「申请已提交。管理员审核通过后，将按本次填写的新密码生效。」
- 服务端拒绝文案显示在两弹窗既有错误提示行（:3004 `role="alert"` 段 / :3005 错误区），
  无需接线改动。

## 5. 文档

CLAUDE.md 中「`POST /auth/password-reset-requests`（@Public 忘记密码，不泄露账号存在性）」
的说明更新为新口径。

## 6. 测试（TDD）

后端 `password-requests.spec.ts` 新增用例：

1. 供应商 APPROVED → 照旧落库（matchedUserId 写入）；
2. 供应商 PENDING/RETURNED/REJECTED/DISABLED/BLACKLIST → 400 `RESET_NOT_ELIGIBLE`
   （循环覆盖），且 `passwordResetRequest.create` 零调用、零通知；
3. 供应商角色无 Supplier 行 → 拒绝；
4. 账号不存在（findFirst → null）→ 拒绝，create 零调用；
5. 内部账号（staff）→ 照旧受理；
6. 拒绝时 `verifyRegistrationCode` 已被调用（验证码门槛在前）。

既有 3 条重置用例（matchedUserId 不外泄/落库哈希/验证码错误）不改——mock 无 role 即走
内部口径，语义仍成立。e2e 无该端点用例（已核）。前端 validator/a11y 测试不涉改动文案
（已核），两门户测试套件回归即可。

## 7. 不在本次范围

- **申请人手机与登记联系人绑定**：闸后仍存在「知晓某已入库供应商信用代码者用自己手机
  提交」的路径，依赖审批人人工核对（审批面已展示申请人姓名/联系方式）。建议独立事项
  后续评估。
- 拒绝尝试的审计/告警日志（探测检测）。
