# 密码重置审批办结联动（待办内容已完成即不再是待办）— 设计

**日期**：2026-11-23
**状态**：已批准（用户裁定「应当修复，当待办的内容实际上已完成了的话，就不应该还是待办了」）

## 1. 问题

`PASSWORD_RESET_PENDING` 待办只有创建（notifyResetReviewers），`approveReset`/`rejectReset`
全程无 resolveActionable——申请被批准/拒绝后，所有审批人的待办**永久残留**（生产实录：
冒烟申请被驳回后待办仍挂，审批中心却无对应件）。与 2026-11-20 资料变更审批「办结联动」
缺陷同类。另：`rejectReset` 无 AuditLog 留痕（批准侧亦无，本修复先补拒绝侧）。

## 2. 方案（沿用资料变更办结联动的成熟范式）

1. **创建侧 link 携带 requestId**：供应商件 `/supplier/approval?requestId={id}`；
   内部件 `/admin/accounts?tab=password&requestId={id}`（消解精确化的前提）。
2. **消解侧**（approveReset/rejectReset 落库成功后）：按两条精确 link 消解
   `resolveActionable('PASSWORD_RESET_PENDING', link)`；**存量兜底**：已无其他 PENDING
   申请时（count PENDING && id≠本条 === 0）再消通用 link `/supplier/approval` 与
   `/admin/accounts`（防批量误消，2026-09-29 教训）。Promise.allSettled 包裹、失败不阻断。
3. **rejectReset 补 AuditLog**：`PASSWORD_RESET_REJECTED`（resourceType 密码重置审批，
   resourceId=requestedUsername，details 携 requestId/note）。

## 3. 测试（TDD）

`password-requests.spec.ts` 新增用例：approve 消四条（两条精确+存量兜底两条通用）；
reject 消两条精确、有其他 PENDING 时通用不消；reject 落 AuditLog；提交侧通知 link 含
requestId。
