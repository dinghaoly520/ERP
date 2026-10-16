# 供应商多公司归属（SupplierCompanyLink）设计

日期：2026-10-16
状态：已批准（方案一：账号全局唯一 + 多公司加入关系；双向通道；申请制三级审批；邀请制仅 leader 发起）

## 背景与问题

`Supplier.companyId` 为单值归属列（2026-09-14 引入），叠加注册查重全为全库全局（无公司过滤），导致**同一企业全平台只能进入一家公司的供应商库**：

- 供应商库列表/统计/资质预警/评价统计按 `companyScope.filter` 注入 `where.companyId`（2026-09-26 公司隔离）——B 公司 staff/leader 看不到归属 A 的供应商；
- 供应商详情与 PII 揭示 `assertInScope(supplier.companyId)` 跨公司 403；
- **投标邀请候选池来自供应商库列表**（`bid.service.ts inviteSuppliers` 本身只校验全局 `status: 'APPROVED'`，但选人页面被库列表隔离卡死）——B 公司邀不到归属 A 的供应商；
- 公告对供应商公开（public 接口不受限），邀请型项目（直接采购/谈判采购）按 `BidSupplier` 名册可见——卡点同样落在「进不了 B 公司的库 → 进不了 B 公司的名册」。

### 现状查重清单（全部全局，`apps/api/src/supplier/supplier.service.ts`）

| # | 查重项 | 落点 | DB 约束 | 性质 |
|---|--------|------|---------|------|
| 1 | 统一社会信用代码 | `register()` :268 `findUnique({creditCode})` | `Supplier.creditCode @unique` | 硬拦 |
| 2 | 登录用户名（=信用代码） | :280 `findFirst({username, role:'supplier'})` | `User @@unique([username, role])` | 硬拦 |
| 3 | 法定代表人身份证号 | :291 盲索引 | 无（应用层） | 拦 400 |
| 4 | 主联系人手机号 | :306 `User.phoneIdx` 盲索引 | `User @@unique([phoneIdx])` | 硬拦 |
| 5 | 联系人身份证号 | :325 盲索引 | 无（应用层） | 拦 400 |
| 6 | 注册前公开预检 | `checkDuplicate()` :1870（`GET /supplier/register/check-duplicate`） | — | 同全局 |

临时注册（邀请码）与 Excel 导入（`__INTERNAL_IMPORT__` 哨兵）走同一套全局查重。

### 否决方案

- **方案二（每公司独立 Supplier 记录，字面实现「按公司查重」）**：登录用户名被强制 = 统一社会信用代码（2026-08 裁定），同信用代码多账号撞 `@@unique([username, role])` 且登录无法区分门户归属；同主体多账号导致密码/资质/CA 证书/履约数据分裂；全链路几十处 `findUnique({creditCode})` 需改造。否决。
- **方案三（admin 手动共享）**：无审批流、供应商无自助入口、库状态无法按公司独立管控，后期必返工为方案一。否决。

## 用户裁决记录

1. 采用**方案一**：账号全局唯一 + `SupplierCompanyLink` 多对多加入关系。
2. 通道**双向**：供应商自助申请加入 + B 公司管理端邀请入库。
3. **申请制走三级审批**（STAFF→LEADER→ADMIN，按目标公司自己的审批链流转）——理由：公司不同，审核人员不同。
4. **邀请制仅 leader 可发起**；供应商确认接受后即时生效（不再过三级——发起即公司管理层意志）。
5. **查重保持全局**（一个企业一个账号）；信用代码命中「他司已注册」从拦死改为引导走加入。
6. 自然人查重（法人证/手机号/联系人证）维持全局（账号安全约束，非公司库约束）。
7. 临时供应商（`isTemporary`）不开放加入通道，须先转正。

## 数据模型

```prisma
enum SupplierLinkSource { SUPPLIER_APPLY  COMPANY_INVITE }
enum SupplierLinkStatus { PENDING  APPROVED  REJECTED  DISABLED }

model SupplierCompanyLink {
  id           String              @id @default(cuid())
  supplierId   String
  companyId    String
  source       SupplierLinkSource  // 加入通道
  status       SupplierLinkStatus  @default(PENDING)
  reviewStage  String?             // 三级审批当前级（STAFF/LEADER/ADMIN）；null=非审批流转态（邀请待确认/已终态）
  note         String?             // 申请说明 / 邀请备注
  rejectReason String?
  invitedById  String?             // COMPANY_INVITE 发起人（leader）
  appliedAt    DateTime?
  invitedAt    DateTime?
  acceptedAt   DateTime?           // 邀请制：供应商确认时间
  reviewedById String?             // 申请制：末级审批人（逐级动作写审计）
  reviewedAt   DateTime?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  supplier     Supplier @relation("SupplierCompanyLinks")
  company      Company  @relation("CompanySupplierLinks")

  @@unique([supplierId, companyId]) // 一家公司至多一条关系（幂等）
  @@index([companyId, status])
  @@index([supplierId])
}
```

关键语义：

- **`Supplier` 与全局唯一性全部不动**：一个企业一个账号、一条 Supplier、一套资质/CA 证书/联系人档案；信用代码/用户名=信用代码/密码/查重全部不变。
- **`Supplier.companyId` 降级为「主归属」**：保留列与注册三级审批流程（注册审批仍按它流转，`companyName` 写时快照口径不变），但不再作为库可见性的唯一依据。
- **状态双层**：`Supplier.status`（APPROVED/DISABLED/BLACKLIST）是**全局闸**；`LinkStatus` 是**公司内状态**——B 公司在自己库 `DISABLED`（软移出，可恢复）不影响 A 公司；`REJECTED` 后供应商可重新申请（原 link 回 PENDING，不建新行）。

## 流程

### 通道一 · 供应商自助申请（三级审批）

```
供应商在 :3004「公司归属管理」选公司（注册同款公司选择器）→ 提交申请（可附说明）
→ Link(source=SUPPLIER_APPLY, status=PENDING, reviewStage=STAFF) + 通知 B 公司 STAFF 级审批人
→ 三级逐级审批（机制复用注册三级：同公司域断言 assertStageApprover 口径、逐级通知、公司无人时上浮/代审）
   ├─ 各级通过 → 下一级；ADMIN 终审通过 → APPROVED，通知供应商「已入 B 公司库」
   └─ 任一级驳回（填原因）→ REJECTED，通知供应商；可修改后重新申请（原行回 PENDING/STAFF）
```

### 通道二 · B 公司管理端邀请（仅 leader）

```
B 公司 leader 在 :3005「邀请入库」检索全局供应商池（按信用代码/名称；仅全局 APPROVED、非临时、不在本公司库）
→ 发出邀请（可附备注）→ Link(source=COMPANY_INVITE, status=PENDING, reviewStage=null) + 通知供应商
→ 供应商在「公司归属管理」页确认
   ├─ 接受 → APPROVED（acceptedAt 落戳，即时入 B 公司库）
   └─ 拒绝 → 终态通知 B 公司；B 公司可再次发起（复用原行）
```

## 注册流与查重改造

原则：**查重保持全局，改的是「命中他司」之后的处置——从拦死变为引导加入。**

`register()` 信用代码命中分流（现状 `supplier.service.ts:268`）：

| 命中情形 | 现状 | 改为 |
|---|---|---|
| 本公司（注册所选公司）已有 APPROVED link | `DUPLICATE_CREDIT_CODE` 硬拦 | **不变**（纯重复） |
| 他公司已 APPROVED、本公司无 | 同样硬拦 | 拦注册但换引导语义：`ACCOUNT_EXISTS_JOIN_INSTEAD`「该企业已有平台账号，请登录后在『公司归属管理』申请加入贵公司」 |
| PENDING（在审） | 硬拦 | 不变（等审核） |
| REJECTED 壳 | 壳重开复用原行 | 不变（按原归属重开） |

`checkDuplicate` 公开端点：加 `companyId` 参数；命中他司 APPROVED 时返回 `registeredElsewhere: true`（**不回传公司名**，防公开端点枚举供应商库）。注册向导前端据此显示引导文案并跳登录。

自然人查重（法人证/手机号/联系人证）维持全局；临时注册（邀请码 `boundCreditCode`）逻辑不动。

## 公司隔离读端切换（供应商域）

供应商域公司过滤统一换形 helper（**`CompanyScopeService.filter` 不动**——它还服务专家库/公告/项目等域）：

```ts
supplierCompanyFilter(companyId) → { companyLinks: { some: { companyId, status: 'APPROVED' } } }
```

切换落点（供应商域全部）：

1. **供应商库列表** `findAll` :954 —— `where.companyId` → link 过滤（全局 `status` 仍作前置闸，全局拉黑照常展示状态标签）。
2. **详情 / PII 揭示** `get()` / `revealField()` —— `assertInScope(supplier.companyId)` → 「任一 APPROVED link 在视野内或主归属在视野内」。
3. **统计六处**：`getStats` / `companyCounts` / 企业类型分布 / 评价统计 / 评价五维度 / 资质预警（`where: { supplier: {...f} }` 形状同步换）。
4. **审批角标** `myPendingReviewCount`：注册审批计数不变（按 `Supplier.companyId`）；**新增**加入审批计数（按 `link.reviewStage + link.companyId`，三级口径同注册）。
5. **邀标候选池**：即库列表（落点 1）；`inviteSuppliers` 不动（已按全局 APPROVED 校验）。
6. **raw SQL 盲区防护**（历史教训 memory `company-scope-raw-sql-blindspot`）：`findAll` 的 `__delegatedExpand`/`__leaderExpand` 走 raw 翻译器——换形必须 grep 全部 `Prisma.sql` 翻译点同步改 + 非 admin 视野实测，tsc 不兜底。

## API 端点（全部显式 `@Roles`，遵守默认拒绝守卫）

| 端点 | 角色 | 说明 |
|---|---|---|
| `GET /supplier/company-links/my` | supplier | 我的归属列表（主归属 + 各公司状态/当前审批级） |
| `POST /supplier/company-links/apply` | supplier | 申请加入 `{ companyId, note }` |
| `POST /supplier/company-links/:id/accept` · `/decline` | supplier | 邀请确认/拒绝 |
| `POST /supplier/company-links/invite` | leader | 邀请入库（按信用代码检索全局池） |
| `GET /supplier/company-links` | leader/staff | 本公司加入审批列表（含三级级联过滤） |
| `POST /supplier/company-links/:id/approve` · `/reject` | leader/staff/admin | 三级逐级审批（同公司域断言，复用注册审批机制） |
| `POST /supplier/company-links/:id/disable` · `/enable` | leader | 本公司库内停用/恢复 |
| `GET /supplier/register/check-duplicate` | public | 加 `companyId` 参数 + `registeredElsewhere` 返回 |

## 前端

**:3004 供应商门户**：个人中心新增「公司归属管理」页（归属列表卡、申请入口=注册同款公司选择器、邀请确认按钮、驳回原因与重新申请）；注册向导命中 `registeredElsewhere` 时显示「已有账号，请登录后申请加入」并跳登录。

**:3005 工作台**：供应商管理中心加「邀请入库」（leader 可见：全局检索 + 邀请弹窗）；审批中心加「加入审批」类型（三级流转交互同注册审批，角标并入）；供应商详情页加「归属公司」区块（主归属 + 各公司库内状态）。

## 边界与错误处理

- **幂等**：重复申请（PENDING 已存在）→ 400 `LINK_PENDING_EXISTS`；已在库 → 400 `ALREADY_IN_COMPANY`；link 处于 `DISABLED` 时再申请 → 400 `LINK_DISABLED`（提示联系该公司恢复，不走重新申请）；`@@unique([supplierId, companyId])` P2002 并发兜底转 409 语义。
- **邀请校验**：仅全局 `APPROVED`、非临时（`isTemporary` 须先转正）、不在本公司库的供应商可被邀请；发起人限本公司 leader。
- **状态分层**：全局拉黑/停用 = 全平台闸（库内照常显示状态标签，邀标端点已有校验）；公司内 `DISABLED` 只影响本公司（候选池排除，**在途 BidSupplier 名册/投标不追溯清理**——留痕）。
- **注册终审通过时同步 upsert APPROVED link**（幂等）；REJECTED 壳重开成功同口径。
- **PII**：B 公司审批加入申请时可查看供应商全档案，脱敏口径同 `get()`；明文仍走 reveal 端点审计。

## 迁移

1. Prisma migration：`SupplierCompanyLink` 表 + 两枚举 + `Supplier.companyLinks` / `Company.supplierLinks` 关系。
2. `scripts/backfill-supplier-company-links.ts`：存量 `companyId` 非空的 Supplier 建 APPROVED link（幂等可重跑）。
3. `seed.ts` 补段：种子供应商同步建 link。

## 测试

- **单测**：link service（三级流转逐级断言/任一级驳回/邀请 leader-only/接受·拒绝/停用恢复/权限矩阵）、`register` 引导分支（他司 APPROVED → `ACCOUNT_EXISTS_JOIN_INSTEAD`）、`checkDuplicate` companyId 分支。
- **供应商域全套件回归**（memory `supplier-domain-test-scope`：改共享服务后跑全域，窄 pattern 漏跨 spec 破坏）。
- **raw SQL 翻译点** grep + 非 admin 视野实测（库列表 delegated/leaderExpand 路径）。
- **e2e**：supplier 套件增加加入流程用例（申请→三级→入库→B 公司库可见→邀标可选）；CI supplier 403 抽查闸口径同步。

## 非目标（用户已裁定/范围外）

- 自然人查重放宽（同一法人代表多家企业注册——另一议题）。
- 每公司独立资质档案（档案全局一份，公司级仅准入状态）。
- 公告按公司定向派发（公告本就公开，邀请型按名册）。
- 加入审批的催促审核功能（注册 `urgeReview` 不扩展）。
