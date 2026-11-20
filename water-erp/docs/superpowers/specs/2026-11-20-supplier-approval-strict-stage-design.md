# 供应商审批·严格三级（取消代审）设计 — 2026-11-20

## 裁定（2026-11-20 用户）

1. **全部取消代审**（推翻 2026-10-08 A 方案与 2026-10-09 扩展）：供应商审批中心注册审批 + 加入/退库审批，必须是 staff 账号初审、leader 账号复审、admin 账号终审，逐级严格本级。
2. **leader 可见全部待初审**：leader 的「在审」列表显示本公司 STAFF 级待审件（只读，操作区禁用、后端 403 兜底）——发现渠道，兼防「无 staff 公司件卡死无感知」。
3. **全级审批必填理由**：通过、驳回在每一级都必填（含 admin 终审通过，原「终审意见可选」废除）；退回补正本就必填不变。

## 现状（被推翻的代审机制）

- 写闸 `assertStageApprover`（`supplier.service.ts` + `supplier-link.service.ts` 两份同构复制）：公司无 staff → leader 代初审；无 leader → admin 代复审；无 staff 且无 leader → admin 代初审。
- 可见性/角标 `myPendingReviewCount` + `list()`（`__delegatedExpand`/`__leaderExpand` 内部标记，ORM 展开与 raw completeness SQL 翻译两路径，`markDelegatedReview` 打标）。
- 通知路由 `resolveStageApprovers`：本级无人向上浮（staff→leader→admin）。

## 变更设计

### 1. 写闸（严格本级）

`assertStageApprover`（两份同构同步改）：

- STAFF 级 = 同公司 staff；LEADER 级 = 同公司 leader；ADMIN 级 = admin。
- 唯一保留例外：`supplierCompanyId == null` 未归属孤儿件 → admin 可审任意级（平台兜底，非公司内代审；与业务标签/注册「未归属归 admin」口径一致）。link 侧 `companyId` 为必填外键，无此分支。
- 403 `REVIEW_STAGE_MISMATCH` 文案不变。

### 2. 理由必填（全级）

- `supplier.service.approve`：`stage !== 'ADMIN' && !trimmed` → `!trimmed`（终审通过也必填，错误文案去级差）。
- `supplier-link.service.approveLink`：同款收口。
- 驳回（`reject`/`rejectLink`）与退回补正（`returnSupplier`）本就必填，不动。
- 前端（review-center-modal）：approve 分支去掉 `st !== 'ADMIN'` 条件；「终审意见（可选）」标签/占位改必填；CompanyLinksPanel 同款。

### 3. 列表与角标

- `list()`：删 `delegatedExpand`（admin）全链（标记、ORM 展开、raw SQL 翻译、`markDelegatedReview`）；`leaderExpand` 改为**无条件**复审+初审可见展开（删 `companyHasActiveRole('staff')` 探测），不再打 `delegatedReview` 标。admin 查 ADMIN 级时保留孤儿分支（`reviewStage='ADMIN' OR companyId IS NULL`）。
- raw completeness 路径同步：`reviewStage` 支持 `in` 形状（`= ANY(...)`）；admin 孤儿展开 SQL。
- `myPendingReviewCount`：admin = ADMIN 级 + 孤儿件；leader = 仅 LEADER（**待我审**语义——可见≠待办）；staff = 仅 STAFF；`joins`（link 表）同构收口（leader 仅 LEADER、admin 仅 ADMIN、无孤儿分支）。
- link 列表 `listForCompany` 本就无级过滤（leader 已可见待初审申请），不动。

### 4. 通知路由

`resolveStageApprovers`（两份同构）：严格按级（STAFF→本公司 staff；LEADER→本公司 leader；ADMIN→admin），**不再向上浮**；本级无人 → 不发待办通知（发了也不能办；发现渠道 = leader 列表可见）；`companyId=null` → admin。

### 5. 前端（apps/web review-center-modal）

- `isMyStage`/`canAct` 严格本级（删 delegatedReview 分支）。
- 删列表行「初审·代审 / 复审·代审」chip 与 `SupplierWithParts.delegatedReview` 消费面；`SupplierWithParts` 注释更新。
- leader 在审列表由后端展开返回 STAFF 行：stage chip 显「初审」、无「待我审」、详情操作区走既有「非本级审批人」样式。
- 三级进度条上的历史「代初审/代复审」徽章**保留**（历史 ApprovalRecord 留痕，描述已发生事实）。

## 边界与运营后果

- **公司无在编 staff → 注册件卡初审**：leader 可见不可审，须 admin 在账号管理建 staff 账号。裁定既定，不做绕行。
- 范围外（维持现状）：信息更新审批三 tab（资料变更/业务标签/密码重置）无三级结构，理由必填不扩面。
- 存量数据：当前库 5 条 PENDING 全部 STAFF 级且有归属，无孤儿件受影响。

## 测试

- 重写 `supplier.delegated-review.spec.ts` → 严格语义：leader 列表含 STAFF（可见）、角标仅 LEADER；admin 仅 ADMIN+孤儿；写闸各级严格（leader×STAFF 403、admin×LEADER 403、staff×STAFF 放行、admin×孤儿放行）；approve 全级理由必填（终审空理由 400）。
- `supplier-link.service.spec.ts` / `supplier-link.spec.ts`：代审放行用例改严格断言。
- 供应商全域回归 + tsc/lint。
