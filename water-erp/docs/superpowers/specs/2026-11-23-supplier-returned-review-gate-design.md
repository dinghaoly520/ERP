# 供应商注册审批：补正中（RETURNED）禁审 + 审批面按级显示 + 悬挂态数据修正 — 设计

**日期**：2026-11-23
**状态**：已批准（用户裁定：脏数据拨回初审；待审核「退回补正」保留显示+只读；「实施吧」）

## 1. 问题（两缺陷 + 一脏数据）

供应商注册三级审批（staff 初审 → leader 复审 → admin 终审，`Supplier.reviewStage`）：

**缺陷 A**：`approve()`/`reject()` 状态谓词为 `in: ['PENDING','RETURNED']`——供应商被
退回补正后（status=RETURNED，等供应商改资料重提），审批人**不等重提即可直接通过/拒绝**
（`supplier.service.ts` approve :2298/:2318/:2353、reject :2414/:2422）。对照 `return()`
:2537 只允许 PENDING，是正确范式。用户裁定：必须等供应商补正重提（回 PENDING）才能审。

**缺陷 B**：`approve()` STAFF/LEADER 通过分支（:2352-2354）只写 `{reviewStage: nextStage,
returnReason: null}` **不写 status**——对 RETURNED 点通过 = status 仍 RETURNED + 级已推进
的**悬挂态**。生产实录（成都思诺旺 SUP-000016）：15:53 退回（STAFF）→ 16:16 staff 通过 →
status=RETURNED + reviewStage=LEADER。

**UI 放大器**：详情页 `/supplier/[id]` 审批操作栏显示条件 `isPending = PENDING ||
RETURNED`（:334，且不判 reviewStage 是否轮到自己）——悬挂态下 staff 仍见「通过/退回/拒绝」
（后端 403 兜底）；总览「待审核→退回补正」按 status=RETURNED 过滤仍列出。审批中心列表
（review-center-modal）的 `canActOnStage = isMyStage` 同样不排除 RETURNED。

**语义闭环（修复后）**：退回 → 供应商补正重提（status 回 PENDING、reviewStage 保留被退回
级）→ 该级审批人继续审。

**另案挂起**：生产曾报「补正重提后通过/拒绝 404」——当前 main 全状态实测无法复现
（PENDING/STAFF 通过 ✓、悬挂态 403 JSON），生产亦为最新代码；判断为测试时浏览器旧包残留
形态。本修复消除其触发面（该状态下按钮不再出现）；若复发凭网络面板证据定案。

## 2. 用户裁定（2026-11-23）

1. **补正中禁审**：RETURNED 状态一律不可 approve/reject，须等供应商重提回 PENDING。
2. **脏数据修正 = 拨回初审**：悬挂态 `reviewStage` 拨回**最后一次 RETURNED 审批记录的
   stage**（成都思诺旺 → STAFF），status 保持 RETURNED（供应商补正链不断）；已产生的
   通过留痕保留，另写修正 AuditLog。
3. **「待审核→退回补正」保留显示 + 只读**：审批人需掌握补正进度；点进详情页只读
   （现有「退回补正·补正中」提示与退回原因保留），无审批按钮。

## 3. 方案

### 3.1 后端闸门（`supplier.service.ts`）

`approve()` / `reject()` 收紧（`return()` 不动）：

- 前置校验：`status === 'RETURNED'` → 400 `AWAITING_RESUBMISSION`「该申请已退回补正，
  待供应商重新提交后才能审核」；其余非 PENDING → 400 `INVALID_STATUS`（原文案）。
- 两处乐观锁 where（approve ADMIN 分支 :2318、STAFF/LEADER 分支 :2353、reject :2422）：
  `status: { in: ['PENDING','RETURNED'] }` → `status: 'PENDING'`——防「校验后瞬间供应商
  重提改变状态」的竞态窗口误审。

### 3.2 前端显示口径

- **详情页**（`/supplier/[id]/page.tsx`）：审批操作栏（:1281）显示条件改为
  `supplier.status === 'PENDING' && isMyReviewStage`，其中 `isMyReviewStage`：
  admin→`reviewStage==='ADMIN'`、leader→`'LEADER'`、staff→`'STAFF'`（leader 代初审的
  细分归审批中心，详情页不放大）；`isPending`（:378/:517 信息性区块与「等待审核」提示条）
  **不动**——RETURNED 保留只读展示（裁定 3）。底部 padding（:378）跟随新条件调整。
- **审批中心**（`review-center-modal.tsx`）：操作可用性在 `isMyStage` 上叠加
  `status === 'PENDING'`（RETURNED 行只读）。
- 通知待办弹窗不在本次范围（后端闸兜底，spec 记录）。

### 3.2.1 修订（2026-11-23 第二次裁定）：admin 审批中心加「退回补正」tab

生产实录暴露口径缺口：SUPPLIER_PENDING 待办（通知轨）与审批中心 tab 可见性（2026-09-30
裁定 admin 只留「在审」）不同步——admin 收到待办后可能在审批中心找不到对应件。

修订：admin 的状态 tab = **在审 + 退回补正**（已驳回 tab 仍隐藏，2026-09-30 裁定其余不变）：

- 退回补正 tab **只看终审级退回件**（`status=RETURNED && reviewStage=ADMIN`）——与在审
  「每级只看待自己审的」同构；初复审退回件与悬挂态不在 admin 视野（各归其级续审）
- 只读：行无操作钮（canActOnStage 已叠加 PENDING）；选中面板显示「补正中：等待供应商
  重新提交（退回原因：…）；重提后回到终审续审」
- 角标计数放开（admin RETURNED 计数不再置 0，带 reviewStage=ADMIN 过滤）
- `scopedStage` 扩展：RETURNED 对 admin 返回 'ADMIN'；leader/staff 维持不按级全见
- 零后端改动（既有 list 端点已支持 status+reviewStage 组合查询）

### 3.3 存量脏数据修正脚本

`apps/api/scripts/fix-returned-stage-drift.ts`（`npx tsx` 运行，dev 验证后生产执行）：

- 检测：`status='RETURNED'` 且存在**晚于最后一次 RETURNED 记录**的 APPROVED
  `SupplierApprovalRecord`（悬挂态特征）。
- 修正：`reviewStage` ← 最后一次 RETURNED 记录的 `stage`；`status` 不动；逐条写
  AuditLog（`action: 'SUPPLIER_STAGE_ROLLBACK_FIX'`，details 记 from/to/原因）。
- 幂等：目标级已一致则跳过；重复运行无新增修正。
- 干跑：`--dry-run` 输出将修正清单不写库（生产执行前先跑）。

## 4. 行为矩阵（修复后）

| 状态/级 | 详情页审批栏 | approve/reject | 退回 return |
|---|---|---|---|
| PENDING · 轮到我 | 显示 | ✓ | ✓ |
| PENDING · 未轮到我 | 不显示（信息区保留） | 403 REVIEW_STAGE_MISMATCH（既有） | 403 |
| RETURNED（补正中） | 不显示（只读「补正中」提示保留） | **400 AWAITING_RESUBMISSION（新）** | 400 INVALID_STATUS（既有） |
| 悬挂态存量（修正后=RETURNED·原级） | 同 RETURNED 行 | 400 | 400 |

## 5. 测试（TDD）

新增 `apps/api/src/supplier/supplier-review-status-gate.spec.ts`（直构
`new (SupplierService as any)(prisma, notification, null, null, null, null)`，同
supplier-link.spec 范式）：

1. approve on RETURNED → 400 `AWAITING_RESUBMISSION`，updateMany 零调用；
2. reject on RETURNED → 同上；
3. approve on PENDING/STAFF → updateMany where `status: 'PENDING'`（锁谓词断言，不含
   RETURNED）且推进 LEADER；
4. reject on PENDING → updateMany where `status: 'PENDING'` 且置 REJECTED；
5. approve on 其他终态（APPROVED）→ 400 INVALID_STATUS（回归）。

前端无既有测试框架覆盖该两页，验收走手动主径（§6）。

## 6. 手动验收（dev）

- RETURNED 供应商详情页：无审批操作栏，只读「补正中」提示可见；API 直调 approve → 400
  「待供应商重新提交」。
- PENDING/STAFF：staff 见审批栏可操作；leader 打开同一页不见（未轮到）。
- 脚本干跑 → 执行 → 复跑幂等；dev 合成悬挂态验证拨回。
