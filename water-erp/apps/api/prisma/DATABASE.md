# 数据库说明（DATABASE.md）

> 智慧水发·蜀水云采 ERP 的 PostgreSQL 数据库结构与种子数据说明。
> 本文档与 `schema.prisma` 对应，便于人工查阅与程序解析。字段以 schema 为准。

- **数据库**：PostgreSQL 16（Docker 容器 `water-erp-postgres`，端口 `5432`）
- **库名 / 账号**：`water_erp` / `water_erp_dev`
- **连接串（本地开发）**：`postgresql://water_erp:water_erp_dev@localhost:5432/water_erp`（见 `apps/api/.env` 的 `DATABASE_URL`）
- **Schema 文件**：`apps/api/prisma/schema.prisma`
- **迁移目录**：`apps/api/prisma/migrations/`（15 个迁移）
- **种子快照**：`apps/api/prisma/seed-data/*.json`（31 张表）+ `seed.ts`（装载器）

> ⚠️ **`OperationLog` 是按月 RANGE 分区表**（迁移 `20260723000000_partition_operation_log`）：
> - 分区键 `createdAt`，PK 为复合主键 `("id", "createdAt")`（分区表强制要求分区键进 PK）。
> - **禁止用 `prisma migrate diff` / `migrate dev` 生成 `OperationLog` 相关 DDL**——diff 会把复合 PK 判为 drift 并试图改回单列 PK，直接破坏分区结构。涉及该表的手写迁移必须人工核对。
> - 分区由 API 的每日 04:00 cron 自动维护（预建未来 `OPERATION_LOG_PARTITION_MONTHS_AHEAD` 个月 + DROP 整月过期分区，见 `operation-log/operation-log.service.ts`）。`OperationLog_default` 为兜底分区，正常应为空。
> - Prisma Client 读写不受影响（模型未改，全 src 无 `findUnique/update by id`）。

---

## 一、模型总览（共 31 张业务表）

按业务域分组。每张表对应 `schema.prisma` 中的一个 `model`，主键统一为 `id String @id @default(cuid())`，多数含 `createdAt` / `updatedAt`。

### 1. 组织与账号

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `Department` | 部门 / 单位 | `name`、`code` |
| `User` | 系统账号（所有门户统一） | `username`(唯一)、`passwordHash`(bcrypt)、`role`、`isActive`、`departmentId→Department` |

`User.role` 取值：`admin`、`bid_host`、`bid_expert`、`supplier`、`procurement_staff`、`mall`。
> `admin` 角色在 RBAC 中仍存在，但 seed 不再创建 `admin` 账号；各门户使用独立业务账号。

### 2. 招标全生命周期（Bid）

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `BidProject` | 招标项目主表 | `projectCode`(唯一)、`name`、`procurementMethod`、`stage: BidStage`、`openTime`、`deadline` |
| `BidSupplier` | 项目下的投标供应商 | `projectId→BidProject`、`supplierId→Supplier`、`decryptStatus`、`confirmStatus` |
| `BidOpeningSession` | 开标场次 | `projectId→BidProject`、`sessionTime`、`location` |
| `BidOpeningRecord` | 开标记录（供应商级） | `sessionId→BidOpeningSession`、`supplierId→BidSupplier`、`decryptedAt` |
| `BidExpert` | 评标专家分配 | `userId→User`、`projectId→BidProject`、`specialty`、`major`；`@@unique([projectId, userId])` |
| `BidScoreItem` | 评分项 | `projectId→BidProject`、`name`、`category: ScoreCategory`、`maxScore`、`weight` |
| `BidScoreRecord` | 专家评分记录 | `expertId→BidExpert`、`scoreItemId→BidScoreItem`、`supplierId→BidSupplier`、`score`；`@@unique([expertId, scoreItemId, supplierId])` |
| `BidClarification` | 澄清 / 答疑 | `projectId→BidProject`、`supplierId→BidSupplier`、`question`、`answer` |
| `BidSupervisionLog` | 监督日志 | `projectId→BidProject`、`action`、`operator` |
| `BidArchiveItem` | 归档资料 | `projectId→BidProject`、`name`、`fileUrl`、`status: ArchiveStatus` |

招标阶段状态机（`apps/api/src/bid/bid-state.ts` 为唯一来源）：
```
DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED
```
非法跃迁返回 **409 Conflict**（非 400）。同态跃迁幂等。

### 3. 供应商域（Supplier）

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `Supplier` | 供应商主表 | `userId→User`、`name`、`normalizedName`、`creditCode`、`status: SupplierStatus`、`classificationId→SupplierClassification` |
| `SupplierContact` | 联系人 | `supplierId→Supplier`、`name`、`phone`、`email`、`isPrimary` |
| `SupplierQualification` | 资质证书 | `supplierId→Supplier`、`type`、`name`、`validFrom`、`validTo`、`status` |
| `SupplierClassification` | 供应商分类（树形） | `name`、`parentId→SupplierClassification`(自引用，可空) |
| `SupplierEvaluation` | 供应商履约评价 | `supplierId→Supplier`、`evaluatorId→User`、`score`、`level` |
| `SupplierChangeRecord` | 字段级变更申请 | `supplierId→Supplier`、`fieldName`、`oldValue`、`newValue`、`status: ChangeStatus` |
| `SupplierBidSubmission` | 供应商投标提交 | `supplierId→Supplier`、`projectId→BidProject`；每供应商每项目仅一条 |

### 4. 专家域（Expert）

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `ExpertProfile` | 专家档案（独立于 BidExpert） | `userId→User`(唯一)、`specialty`、`title`、`employer`、`availability` |
| `ExpertEvaluation` | 专家考评 | `expertUserId→User`、`evaluatorId→User`、`projectId→BidProject`(可空)、`overallScore`、`level: ExpertLevel` |

> 专家身份以 `BidExpert.userId` 为准（不按 `displayName` 匹配），避免同名冲突。

### 5. 采购立项（Procurement）

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `ProcurementProject` | 采购项目立项 | `projectCode`(唯一)、`title`、`procurementType`、`procurementMethod`、`status: ProcurementStatus`、`departmentId→Department`、`creatorId→User`、`bidProjectId→BidProject`(可空，立项转招标) |

### 6. 公告与文档（Announcement）

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `Announcement` | 公告 / 通知主表 | `title`、`content`(HTML)、`type: AnnouncementType`、`status: AnnouncementStatus`、`summary`(AI 摘要)、`publishDate`、`isTop`、`viewCount`、`relatedProjectCode` |
| `AnnouncementAttachment` | 公告附件 | `announcementId→Announcement`、`fileAssetId→FileAsset`、`name` |
| `BidDocument` | 招标文件 | `announcementId→Announcement`、`fileAssetId→FileAsset`、`name`、`decryptDeadline` |
| `BidDocumentAccess` | 供应商文件访问授权 | `documentId→BidDocument`、`supplierId→Supplier`、`grantedAt` |

### 7. 电子商城（Mall）

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `CatalogItem` | 采购目录 / 商品 | `code`(唯一)、`name`、`specification`、`category`、`group`、`referencePrice`、`priceMin/priceMax`、`supplier`、`status`、`validUntil` |
| `BudgetList` | 采购预算清单（购物车） | `userId→User`、`procurementProjectId→ProcurementProject`(可空)、`totalAmount`、`itemCount`、`status`(ACTIVE/CONVERTED/ARCHIVED) |
| `BudgetItem` | 预算清单明细 | `budgetListId→BudgetList`、`catalogItemId→CatalogItem`(可空)、`qty`、`referencePrice`、`sortOrder` |

### 8. 通用

| 表（model） | 用途 | 关键字段 / 关系 |
| --- | --- | --- |
| `Notification` | 站内通知 | `userId→User`、`type`、`title`、`content`、`link`、`read` |
| `FileAsset` | 上传文件元数据 | `key`(唯一)、`originalName`、`mimeType`、`size`、`sha256`、`category`、`uploaderId→User` |

---

## 二、枚举（Enums）

| 枚举 | 取值 |
| --- | --- |
| `BidStage` | `DOWNLOAD` → `SUBMIT` → `OPENING` → `EVALUATING` → `ARCHIVED` |
| `DecryptStatus` | `PENDING` / `RUNNING` / `SUCCESS` / `DANGER` |
| `ConfirmStatus` | `CONFIRMED` / `PENDING` / `EXCEPTION` |
| `ScoreCategory` | `QUALIFICATION` / `RESPONSIVE` / `BUSINESS` / `TECHNICAL` / `PRICE` |
| `ArchiveStatus` | `ARCHIVED` / `PENDING_CONFIRM` / `NOT_STARTED` |
| `ExpertLevel` | `A`(优秀) / `B`(良好) / `C`(合格) / `D`(不合格) |
| `SupplierStatus` | `PENDING` / `RETURNED` / `APPROVED` / `REJECTED` / `DISABLED` / `BLACKLIST` |
| `ChangeStatus` | `PENDING` / `APPROVED` / `REJECTED` |
| `AnnouncementType` | `BID_NOTICE`(招标公告) / `WIN_NOTICE`(中标公示) / `POLICY`(政策法规) / `PLATFORM`(平台通知) |
| `AnnouncementStatus` | `DRAFT` / `PUBLISHED` / `ARCHIVED` |
| `ProcurementStatus` | `DRAFT` / `PENDING_REVIEW` / `APPROVED` / `REJECTED` / `BIDDING` / `CONTRACTED` / `CLOSED` |

---

## 三、种子数据快照（seed-data）

`pnpm db:seed` 执行 `tsx prisma/seed.ts`：先 `TRUNCATE … RESTART IDENTITY CASCADE` 清空全部 31 张业务表，再按外键依赖顺序 `createMany` 写回 `seed-data/*.json`。**幂等**——多次运行结果一致。

当前快照行数（共约 1755 行）：

| 表 | 行数 | | 表 | 行数 |
| --- | --- | --- | --- | --- |
| `User` | 500 | | `BidProject` | 5 |
| `Supplier` | 494 | | `BidSupplier` | 5 |
| `SupplierQualification` | 338 | | `BidExpert` | 3 |
| `SupplierContact` | 228 | | `BidScoreItem` | 5 |
| `CatalogItem` | 80 | | `BidOpeningSession` | 1 |
| `Announcement` | 48 | | `BidOpeningRecord` | 3 |
| `SupplierClassification` | 13 | | `BidClarification` | 1 |
| `Notification` | 8 | | `BidSupervisionLog` | 4 |
| `BidArchiveItem` | 7 | | `BudgetList` | 2 |
| `ExpertProfile` | 3 | | `BudgetItem` | 3 |
| `Department` | 1 | | `SupplierEvaluation` | 3 |
| 其余 13 张 | 0 | | | |

演示账号（口令约定 `<用户名>@2026`，各门户独立会话需分别登录）：

| 账号 | 角色 | 门户 |
| --- | --- | --- |
| `mall` | mall | 电子商城 :3003 |
| `supplier1` | supplier | 供应商端 :3004 |
| `caigou` | procurement_staff | 采购管理端 :3005 |
| `wangjg` / `liuxm` / `chenzq` | bid_expert | 专家评标 :3006 |
| `lizhuren` | bid_host | 开评标管理端 :3007 |

---

## 四、更新快照 / 迁移工作流

```bash
# 1) 修改 schema.prisma 后，生成并应用迁移（交互式终端）
pnpm --filter api exec prisma migrate dev --name <变更名>

# 1') 非交互环境（CI / Agent）
pnpm --filter api exec prisma migrate dev --create-only --name <变更名>   # 仅生成 SQL
pnpm --filter api exec prisma migrate deploy                              # 应用并记录
pnpm --filter api exec prisma generate                                    # 重建 Client

# 2) 重新生成 Prisma Client
pnpm db:generate

# 3) 从真实库导出新的种子快照（覆盖 seed-data/*.json）
pnpm --filter api exec tsx prisma/scripts/dump-seed.ts

# 4) 用快照重置库到固定状态
pnpm db:seed
```

> **导出注意**：`dump-seed.ts` 会导出全部 31 张表（空表写 `[]`）。切勿依据 `pg_stat_user_tables.n_live_tup`（估算值，小批量插入后可能为 0）挑选"非空"表导出——这会漏表。
