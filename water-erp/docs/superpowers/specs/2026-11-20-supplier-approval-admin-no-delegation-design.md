# 供应商审批·admin 禁代审 + 代审探测稳健化设计 — 2026-11-20

> 取代同日早前《严格三级（取消代审）》设计——用户裁定保留代审机制。

## 裁定（2026-11-20 用户）

1. **保留代审设计**：leader 待初审可见性维持探测式（本公司无在编 staff 才可见/可办，staff 账号出现即收回——此翻转为既定机制，非缺陷）。
2. **admin 禁止代初审、禁止代复审**：admin 只审终审级。唯一例外=未归属公司（companyId=null）孤儿件归平台 admin 兜底（注册链路现恒落 companyId，现库 0 条，纯防死锁）。
3. **稳健性增强**：在编账号探测（companyHasActiveRole / hasRole / resolveStageApprovers pick）一律排除**冻结账号**（isFrozen）——防「公司唯一 staff 被冻结→探测仍认为有在编→初审死锁、leader 可见性误判」。
4. 全级理由必填：**放弃，维持现状**（非终审级通过必填缘由、终审通过可选、驳回必填）。

## 变更面

### 后端（supplier.service.ts）

- `assertStageApprover`：删 STAFF/LEADER 级的 admin 分支；新增末尾孤儿兜底（admin 且 supplierCompanyId=null 放行）。
- `list()`：`__delegatedExpand`（admin 代审展开）→ `__orphanExpand`（`reviewStage='ADMIN' OR companyId IS NULL`），ORM 与 raw completeness SQL 两路径同步；结果中 LEADER/STAFF 级项（即孤儿）仍标 `delegatedReview`（前端「待我审」依据）。
- `myPendingReviewCount`：admin 注册待办 = ADMIN 级 OR 孤儿件；`joins`（link 表）= 仅 ADMIN 级（link.companyId 必填外键，无孤儿）。
- `resolveStageApprovers`：STAFF→staff→leader 止；LEADER→leader 止；**不再上浮 admin**；companyId=null→admin；pick 一律 `isFrozen: false`。
- `companyHasActiveRole`：`isFrozen: false`。

### 后端（supplier-link.service.ts，同构）

- `assertStageApprover`：删 admin 分支（无孤儿情形——companyId 必填）。
- `notifyStageApprovers`：删 admin 上浮；pick 加 `isFrozen: false`。

### 前端（apps/web review-center-modal.tsx）

- CompanyLinksPanel `canAct`：admin 收窄为仅 ADMIN 级（原 LEADER/STAFF 代审预亮删除）。
- RegistrationPanel：零逻辑改动（`delegatedReview` 分支本就按标记渲染，标记语义变为孤儿件）；相关注释/tooltip 文案随语义更新（「代审」→「未归属孤儿件·平台兜底」）。

## 运营后果

- 公司无 leader → 复审件无人可审（admin 不再兜底），须建 leader 账号；公司既无 staff 又无 leader → 初审/复审均卡，同因。
- 存量历史「代初审/代复审」留痕徽章保留（描述已发生事实）。

## 测试

- 重写 `supplier.delegated-review.spec.ts` 前两段（admin 代审→孤儿兜底语义）；leader 探测式展开段保留不动。
- `supplier-link.spec.ts` admin joins 口径用例重写；`supplier-link.service.spec.ts` 通知上浮用例改为「止于 leader」。
- 供应商全域回归 + tsc/lint。
