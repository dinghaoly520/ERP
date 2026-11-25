# 供应商「撤销申请」（撤回壳 + 数据回填 + 3 次上限）— 设计

**日期**：2026-11-25
**状态**：已批准（用户裁定：供应商侧撤销、撤后重新申请；撤回最多 3 次；撤回壳保留完整数据供信用代码回填；入口注册页为主）

## 1. 背景与裁定

思诺旺类卡死件：申请被退回补正后供应商一直未重提（叠加缺陷推进级），办公侧既不能通过也不能退回，生产不便执行 SQL。用户裁定：

- **不做办公侧撤销设计**；给**供应商**加「撤销申请」——撤销后本次申请作废，凭信用代码重新申请；
- **撤回最多允许 3 次**（跨轮累计）；
- **撤回后，注册页输入信用代码即可加载之前填写的完整数据**（→ 撤回壳保留完整业务数据，不复用驳回壳的数据清洗）；
- 入口以注册页为主，登录页指路文案引导。

## 2. 状态机

```
PENDING（审核中） ──撤回──▶ WITHDRAWN（已撤回壳） ──同信用代码重新注册──▶ PENDING（新申请，STAFF 起）
RETURNED（补正中） ──撤回──▶ WITHDRAWN                          （壳重开，子表按新申请重建）
```

- 可撤范围仅 PENDING/RETURNED；APPROVED 走停用流程，REJECTED 壳本就可重注册，均不涉撤回。
- `WITHDRAWN` 为新枚举值（「已撤回」），与「审核不通过」（REJECTED）区分——审批统计与驳回口径不受污染。
- 上限：`Supplier.withdrawCount Int @default(0)`，撤回成功 +1，**跨轮累计不清零**（壳重开保留）。提交时 ≥3 → 400
  `WITHDRAW_LIMIT_REACHED`「撤回次数已达上限，如有疑问请联系采购中心」。达上限后仍可正常重新申请，只是不能再撤。

## 3. 后端（公开端点，镜像补正流三段式）

- `POST /supplier/withdraw-request` `{name, creditCode}`：定位 status∈{PENDING,RETURNED} 的行 → 向主联系人手机发
  注册场景验证码；未命中返回同形响应（`maskedPhone: null`）防枚举；限流沿用 sendRegistrationCode。
- `POST /supplier/withdraw-verify` `{name, creditCode, code}`：核验 → `{ withdrawToken, expiresIn }`（assertRegistrationSession 会话）。
- `POST /supplier/withdraw-submit` `{token, name, creditCode}`：
  1. assertRegistrationSession → 按 creditCode 定位 → 验证手机与主联系人一致（补正同款 `WITHDRAW_PHONE_MISMATCH`）；
  2. 闸：status∈{PENDING,RETURNED} 否则 400 `INVALID_STATUS`；`withdrawCount >= 3` → 400 `WITHDRAW_LIMIT_REACHED`；
  3. 原子认领：`updateMany({ id, status: { in: ['PENDING','RETURNED'] } }, { status:'WITHDRAWN', returnReason:null, withdrawCount:{ increment:1 } })`，
     count=0 → `CONFLICT`（并发天然安全：第二方认领必失败）；
  4. 账号清理（轻量，非 purge）：`User.passwordHash=null`、`isActive=false`（登录天然拒绝）；
  5. `clearSupplierPendingTodos(id)`；`notifyStageApprovers(stage, companyId, 「供应商已撤回申请」)`；
  6. `audit(supplier.userId, 'SUPPLIER_WITHDRAWN', id, { name, withdrawCount })`；
     `recordApproval(id, 'WITHDRAWN', userId, '供应商自行撤回申请', stage)`（recordApproval action 联合扩展 'WITHDRAWN'）；
  7. `consumeRegistrationSession(token)`。
  - **业务数据与子表全部保留**（回填前提），不复用 purgeRejectedSupplier。
- `POST /supplier/withdraw-draft` `{token, name, creditCode}`：会话内核验（手机一致校验同上）→ 仅 WITHDRAWN 可取 →
  返回完整申请草稿（形状=buildCorrectionDraft 同构：主档+联系人+资质+银行+业绩+tags；PII 解封本人场景明文，与补正
  回填同口径）→ 注册向导逐段回填。
- 公开进度查询（getRegisterStatusByCreditCode / ByName 投影）加 `withdrawCount` 透出（前端显示「已撤回 N/3」）。

## 4. Schema 与迁移

- `SupplierStatus` 枚举加 `WITHDRAWN`；`Supplier` 加 `withdrawCount Int @default(0)`。
- 迁移 SQL：`ALTER TYPE "SupplierStatus" ADD VALUE 'WITHDRAWN';` + `ALTER TABLE "Supplier" ADD COLUMN "withdrawCount" INTEGER NOT NULL DEFAULT 0;`
- 提交前 `prisma validate`（仓库铁律）；本机走 diff → db execute → resolve --applied（memory 口径）。
- shared `SUPPLIER_STATUS_LABEL` 补 `WITHDRAWN: '已撤回'`。

## 5. register 壳重开扩展

- 壳重开谓词（:296）：`status !== 'REJECTED'` → `!['REJECTED','WITHDRAWN'].includes(status)`（WITHDRAWN 不再被
  `DUPLICATE_CREDIT_CODE` 拦）；
- 壳重开认领（:241）：`where status: 'REJECTED'` → `{ in: ['REJECTED', 'WITHDRAWN'] }`；重开 data 防御性清
  `returnReason: null`；`withdrawCount` 不动（累计）。

## 6. 前端（:3004）

- 注册页状态检测扩展为三态横幅：
  - PENDING/RETURNED：「撤销申请」按钮（显示已撤回 N/3，N≥3 隐藏按钮）→ 发码/输码/确认 → 成功后刷新为 WITHDRAWN 横幅；
  - WITHDRAWN：「重新申请」引导 +「加载之前填写的数据」按钮 → 短信核验 → 草稿回填向导（复用补正回填的赋值机制）→
    用户修改后正常提交（走 register 壳重开）。
- 登录页 RETURNED 指路文案补一句「如需放弃本次申请，可到注册页撤销后重新提交」（WITHDRAWN 壳密码已清空，登录页不可达）。
- 审批历史/时间线标签：WITHDRAWN → 「供应商撤回申请」。

## 7. 边界

- 撤回后审批中心列表/角标/待办自动消失（状态驱动，无残留）；供应商补正横幅随状态消失。
- 撤回壳不出现在审批任何 tab；供应商库「全部」列表与 REJECTED 壳同待遇。
- 回填与撤回是两次独立操作、各自短信会话（可能隔天）。
- 防枚举：三段式端点未命中同形响应；限流沿用注册场景。
- 旧缺陷 ✓ 与退回历史保留在壳的留痕里不删。

## 8. 测试（TDD）

- withdraw-submit：状态闸（APPROVED/REJECTED/WITHDRAWN → 400）、次数闸（3 次后 400）、乐观锁 CONFLICT、手机不匹配、
  User 清理（passwordHash null）、子表与业务字段保留、todos 清理、审批人通知、审计、recordApproval WITHDRAWN、计数 +1。
- register 壳重开：WITHDRAWN 壳 → PENDING/STAFF、returnReason 清、withdrawCount 保留；WITHDRAWN 不被
  DUPLICATE_CREDIT_CODE 拦。
- withdraw-draft：仅 WITHDRAWN 可取；PII 明文回填形态；手机不匹配拒绝。
- 公开进度投影含 withdrawCount。
- e2e 不加（单测覆盖）。

## 9. 不在本次范围

- 撤回上限的后台重置通道。
- 撤回壳过期自动清理。
- :3005 审批中心对撤回件的专门展示（撤回即从审批面消失，历史在审批历史弹窗可查）。
