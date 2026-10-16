# 临时供应商注册查重提示与状态感知引导设计（2026-10-16）

## 背景与问题

验收问题：「供应商注册：临时供应商重复注册时，未进行重复提示，同时，其他查重项也应该进行提示。」（:3004 供应商门户）

用户澄清后锁定的两个核心场景：

1. **新邀请码 + 供应商已重复**：信用代码失焦有 toast 但贫瘠（不区分状态、无出路指引）；法人身份证号 / 注册手机号完全无失焦提示，仅提交时后端 400 暴露。
2. **临时供应商到期后再注册**：被「统一社会信用代码已被注册，请核对后重试」误导性拦死——到期不改 `status`（仍 APPROVED），正确出路是**登录页续期面板**（`TEMPORARY_EXPIRED` → `POST /supplier-portal/reactivate` 凭新邀请码续期），但注册页完全不告知。

## 现状查重矩阵（改造前）

| 查重项 | 临时注册页失焦预检 | 正式注册页失焦预检 | 后端提交拦截 |
|--------|------------------|------------------|------------|
| 统一社会信用代码 | ✅（无状态感知） | ✅（REJECTED 放行/RETURNED 引导补正） | `DUPLICATE_CREDIT_CODE`（临时页对 REJECTED 也硬拦） |
| 法定代表人身份证号 | ❌ | ✅ | `DUPLICATE_LEGAL_ID_CARD` |
| 注册手机号 | ❌ | ❌ | `DUPLICATE_PHONE`（`checkDuplicate` 端点不支持 phone） |
| 联系人身份证号 | N/A（临时表单无联系人证号） | 仅提交时 | `DUPLICATE_CONTACT_ID_CARD` |

另：复用原（已 USED）邀请码重复注册 → 第一步即被「邀请码已被使用」拦住，文案不指向「你可能已注册过」。

## 用户裁定（2026-10-16）

1. 场景覆盖：新码+供应商重复、临时到期再注册（两者都做）。
2. 引导形式：**文案 + 跳转链接**（不做页面内嵌续期表单）。
3. 手机号失焦预检：**临时 + 正式两页都补**，`checkDuplicate` 加 `phone` 参数。
4. REJECTED 命中：**保持硬拦 + 引导**——「改走正式注册重新建档」（正式注册的驳回壳重开已完整实现，2026-10-14），不把壳重开复制进 `registerTemporary`。
5. 邀请码 USED 文案：轻量增强，指向登录/续期。
6. 方案：**扩展现有 `checkDuplicate` 端点**（不新增端点、不加限流面、`registerTemporary` 后端逻辑零改动）。

## 设计

### 后端（apps/api）

**`supplier.service.ts` · `checkDuplicate()`（:1871）**

- 入参加 `phone`；creditCode 命中的同一次查询顺手 select `{ id, status, isTemporary, temporaryExpiresAt }`，响应新增四个字段：

```
{ creditCode, creditCodeStatus, creditCodeIsTemporary, creditCodeTemporaryExpired,
  legalPersonIdCard, contactIdCard, phone }
```

- `creditCodeTemporaryExpired = isTemporary && temporaryExpiresAt < now`。
- `phone` 查 `User.phoneIdx` 盲索引（`blindIndexPii`），与提交口径（`registerTemporary` :764、`register` :306）同路数。
- 公开端点信息暴露增量：两个事实字段 + phone 布尔——与既有 `creditCodeStatus`/法人证查重同类，20/min 限流兜底，接受。

**`verifyInvitationCode()` :724 与 `registerTemporary()` :746 的 USED 文案**（纯字符串）：

> 该邀请码已被使用（每个邀请码仅可注册一次）；若贵司已注册请直接登录，临时资格过期请到登录页凭新邀请码续期

**`registerTemporary` 查重顺序、硬拦语义均不动**（与多公司归属 spec「临时注册逻辑不动」裁定兼容；该 spec 后续给 `checkDuplicate` 加 `companyId`/`registeredElsewhere` 与本次字段正交）。

### 前端（apps/supplier-portal-next）

**共享映射工具 `src/lib/registration/dedup-guidance.ts`（新增）**：`creditCodeGuidance(res)` 把 `(creditCodeStatus, creditCodeIsTemporary, creditCodeTemporaryExpired)` 映射为一等公民引导对象 `{ kind, message, link? }`，两页共用一份文案矩阵：

| 命中状态 | 临时注册页文案（均阻断提交） | 链接 |
|---------|---------------------------|------|
| PENDING | 注册申请正在审核中，请等待审核结果后登录 | 去查询审核进度 → `/login?registered=1`（自动展开进度面板） |
| RETURNED | 有退回补正中的申请，请到正式注册页「进入补正」 | 改走正式注册 → `/register` |
| REJECTED | 此前注册申请已被驳回，请改走正式注册重新建档 | 改走正式注册 → `/register` |
| APPROVED + 临时 + 已过期 | 临时供应商资格已过期，请到登录页凭新邀请码续期（需账号密码） | 去登录续期 → `/login?reactivate=1` |
| APPROVED + 临时 + 未过期 | 临时供应商资格有效期内，请直接登录 | 去登录 → `/login` |
| APPROVED 正式 | 已是平台注册供应商，请直接登录；忘记密码请联系管理员 | 去登录 → `/login` |
| DISABLED/BLACKLIST | 账号状态异常，请联系采购中心 | — |

正式注册页对 REJECTED/RETURNED 沿用自身壳重开/补正流程，不走本矩阵。

**临时注册页 `/register-temporary`**：

- 信用代码失焦：`creditCodeDuplicate` 布尔升级为 `creditCodeGuidance` 状态，字段下方渲染**持久内联引导条**（含链接，沿用 `reg-invite-note` 视觉模式），替换原裸 toast。
- 法人身份证号失焦：新增预检（对齐正式页），toast + 阻断标志。
- 手机号失焦：新增预检，toast + 阻断标志；`sendRegCode` 发码前先查（避免白烧短信）。
- 提交前：三字段一次性复检（防漏 blur，对齐正式页提交时预检模式）。

**正式注册页 `/register`**：

- `registrationPhone` 失焦预检 + 发码前检查 + 提交闸。
- 信用代码命中的既有 blocking 分支中，新增「临时已过期」→ 续期引导 toast（sonner `action` 按钮跳 `/login?reactivate=1`）；REJECTED/RETURNED 逻辑不动。

**登录页 `/login`**：`showReactivate` 支持从 `?reactivate=1` 初始化展开（承接注册页引导链接）。

## 测试

- `supplier.register.spec.ts` `checkDuplicate` describe 扩展：phone 命中/未命中；`creditCodeIsTemporary/TemporaryExpired` 三态（正式 / 临时未过期 / 临时已过期）。
- `supplier.temporary-register.spec.ts` 不动（`registerTemporary` 行为零变化；无测试断言旧 USED 文案）。
- 前端两页无单测基建，靠 tsc + lint。
- 改共享服务后跑全域：`pnpm --filter api test -- supplier`。

## 明确不做

- `registerTemporary` 支持驳回壳重开（引导去正式注册即可）。
- 注册页内嵌续期表单（跳登录页续期面板）。
- 自然人查重（法人证/手机号）放宽为按公司维度（多公司 spec 另议）。
- 新增独立「注册引导」端点。
