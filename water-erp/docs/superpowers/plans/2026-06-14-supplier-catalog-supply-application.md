# 供应商门户·集中采购目录浏览与供货申请

> 创建：2026-06-14
> 目标：在供应商门户(:3003)增加「浏览集中采购目录品类 + 申请新增品类/加入供货/改报价 + 管理员审核(含议价)」全闭环。

## 一、需求

1. 供应商可**浏览**集中采购目录，但**只能看品类（名称/规格/单位/区域/分类），不能看价格**。
2. 供应商可**新增采购品类申请**（目录里没有的物资）。
3. 供应商可**申请加入已有品类的供货并报价**。
4. 已准入供应商可**申请改报价**（改价也走审核）。
5. 采购管理员(`procurement_staff`)审核，支持**通过/拒绝/退回/议价**。
6. 全程发通知 + 审计留痕。

## 二、关键决策（已确认）

| # | 决策 |
|---|------|
| 1 | 浏览时**显示"已有 N 家供应商"数量，不显示名称和价格** |
| 2 | `NEW_ITEM` 通过时，**管理员同步填写初始参考价**写入 `CatalogItem.referencePrice`；供应商报价单独进 `CatalogSupplier` |
| 3 | 供应商**改报价必须走审核**，不能直接生效 |
| 4 | 审核需要**「议价改价后通过」**流程 |
| 5 | **禁止重复申请**：同一供应商对同一品类已有 ACTIVE 关系或进行中申请时，不允许重复提交 |

## 三、数据模型（新增 2 张表）

### `SupplierCatalogApplication`（申请单）

```prisma
model SupplierCatalogApplication {
  id          String   @id @default(cuid())
  supplierId  String
  type        String   // 'NEW_ITEM' | 'JOIN_EXISTING' | 'UPDATE_QUOTE'

  // JOIN_EXISTING / UPDATE_QUOTE 指向已有目录条目
  catalogItemId   String?

  // NEW_ITEM 拟增物资信息
  proposedName     String?
  proposedSpec     String?
  proposedCategory String?
  proposedGroup    String?
  proposedUnit     String?

  // 报价与供货条件
  quotedPrice     Decimal? @db.Decimal(12, 2)
  deliveryPeriod  String?
  region          String?
  minOrder        String?
  taxIncluded     Boolean  @default(true)
  freightIncluded Boolean  @default(false)

  // 议价：管理员反报价（decision #4）
  counterPrice    Decimal? @db.Decimal(12, 2)
  counterNote     String?

  // 资质说明 + 证明附件
  qualificationNote     String?
  attachmentFileAssetId String?

  // 状态机
  status        String    @default('PENDING')
  // PENDING | COUNTERED | RETURNED | APPROVED | REJECTED | WITHDRAWN
  reviewedBy    String?
  reviewedAt    DateTime?
  rejectReason  String?
  reviewerNote  String?

  // NEW_ITEM 通过时管理员填写的官方参考价（写入新建 CatalogItem）
  approvedReferencePrice Decimal? @db.Decimal(12, 2)
  approvedPriceMin       Decimal? @db.Decimal(12, 2)
  approvedPriceMax       Decimal? @db.Decimal(12, 2)
  approvedValidUntil     DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  supplier    Supplier     @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  catalogItem CatalogItem? @relation(fields: [catalogItemId], references: [id], onDelete: SetNull)

  @@index([supplierId, status])
  @@index([status, type])
  @@index([catalogItemId])
  @@index([supplierId, catalogItemId, status])
}
```

### `CatalogSupplier`（品类↔供应商准入关系，审核通过的产物）

```prisma
model CatalogSupplier {
  id           String   @id @default(cuid())
  catalogItemId String
  supplierId   String
  quotedPrice  Decimal  @db.Decimal(12, 2)   // 当前报价
  deliveryPeriod String?
  region        String?
  minOrder      String?
  taxIncluded   Boolean  @default(true)
  freightIncluded Boolean @default(false)
  status        String   @default('ACTIVE')  // ACTIVE | SUSPENDED | DISABLED
  sourceApplicationId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  catalogItem CatalogItem @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  supplier    Supplier    @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@unique([catalogItemId, supplierId])
  @@index([catalogItemId, status])
}
```

> 关系挂在 `Supplier.applications` / `Supplier.catalogSupplies`、`CatalogItem.applications` / `CatalogItem.catalogSuppliers`。

## 四、敏感信息脱敏

供应商端目录接口**只返回**：
`{ id, code, name, specification, category, group, unit, region, status, supplierCount }`

**绝不返回**：`referencePrice / priceMin / priceMax / lastDealPrice / averagePrice / changeRate / priceSource / validUntil / supplier(名称)`。

→ 不复用 `/api/catalog`（会泄价），在 `supplier-portal` 模块新建脱敏读接口。

## 五、状态机（含议价回环）

```
                      supplier 提交
                           │
                           ▼
                        PENDING ◄────────── supplier 改价重提 ──┐
                           │                                      │
       ┌───────────────────┼──────────────────┐                  │
       │                   │                  │                  │
   APPROVE            RETURN/REJECT       COUNTER(议价)           │
   (NEW_ITEM必填        (填理由)         (填counterPrice          │
    参考价)                              +counterNote)            │
       │                   │                  │                  │
       ▼                   ▼                  ▼                  │
    APPROVED          RETURNED/REJECTED    COUNTERED ────────────┘
    ✅建关系/建品        ❌                  │
                                          │
                          ┌───────────────┼────────────────┐
                    supplier          supplier           supplier
                    ACCEPT 反报价     再报价(改价)        撤回
                      │                │                  │
                      ▼                ▼                  ▼
                   APPROVED         PENDING           WITHDRAWN
                   (按反报价)

   任意非终态，supplier 可 WITHDRAW
   终态：APPROVED / REJECTED / WITHDRAWN
```

### 通过(approve)的副作用

| type | 副作用 |
|------|--------|
| `NEW_ITEM` | 用 `approvedReferencePrice` 等建 `CatalogItem`(status='有效')；用最终报价建 `CatalogSupplier` |
| `JOIN_EXISTING` | 建 `CatalogSupplier`(catalogItemId + supplierId) |
| `UPDATE_QUOTE` | 更新对应 `CatalogSupplier.quotedPrice` 及供货条件 |

最终报价取值：`COUNTERED → supplier ACCEPT` 时用 `counterPrice`；否则用 `quotedPrice`。

## 六、防重复申请（decision #5）

提交时后端校验（前端同步置灰）：

- `JOIN_EXISTING`：同 `supplierId + catalogItemId` 已有 `ACTIVE CatalogSupplier`，或已有 `PENDING/COUNTERED/RETURNED` 申请 → 409。
- `UPDATE_QUOTE`：仅当存在 `ACTIVE CatalogSupplier` 时可提交；同 `supplierId + catalogItemId` 已有进行中 `UPDATE_QUOTE` → 409。
- `NEW_ITEM`：同 `supplierId` 已有进行中申请且 `proposedName` 归一化相同 → 409。

## 七、API

### 供应商端 `/api/supplier-portal/*`

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/catalog/categories` | 品类树(group→category) |
| GET | `/catalog/items?category=&group=&search=` | 目录条目(脱敏) + supplierCount |
| GET | `/catalog/items/:id` | 单条详情(脱敏) |
| GET | `/catalog/items/:id/supply-status` | 我对该品类的供货/申请状态(按钮置灰用) |
| GET | `/catalog-applications` | 我的申请列表 |
| POST | `/catalog-applications` | 提交申请(NEW_ITEM/JOIN_EXISTING/UPDATE_QUOTE) |
| POST | `/catalog-applications/:id/withdraw` | 撤回 |
| POST | `/catalog-applications/:id/accept-counter` | 接受议价反报价 |
| GET | `/catalog-supply` | 我的已准入供货关系 |

### 管理员端 `/api/catalog/*`（`@Roles('procurement_staff','admin')`）

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/applications?status=&type=` | 申请审核列表 |
| GET | `/applications/:id` | 申请详情(含供应商名、报价) |
| POST | `/applications/:id/review` | 审核：`approve`/`reject`/`return`/`counter`<br/>approve 时 NEW_ITEM 必填 `referencePrice`；counter 必填 `counterPrice` |
| GET | `/items/:id/suppliers` | 某品类准入供应商 + 报价(管理员可见价) |

每次 review/counter/withdraw 写 `AuditLog` + 发 `Notification`。

## 八、前端

### 供应商门户(:3003, Vue) 新增菜单分区「供货合作」

- `/catalog` 目录浏览页：左侧品类树 + 右侧条目卡片/表格，**无价格列**，每条显示"已有 N 家供应商"，按钮「申请供货」「新增品类」「改报价」按状态置灰。
- `/catalog-applications` 我的申请：状态徽标(待审/议价中/退回/通过/拒绝/撤回)；待审/退回可撤回；议价中可「接受反报价」或「再报价」。
- 申请弹窗表单：按 type 动态字段；复用 `api/upload.ts` 上传资质附件。
- `/supply` 我的供货关系(已准入，含当前报价)；点"改报价"→ 跳 UPDATE_QUOTE 申请。

### Web 管理端(:3004, Next.js) 新增「目录供货审核」

- `/supplier/catalog-review` 审核列表：待审/议价中/已处理 Tab。
- 审核操作面板：通过(NEW_ITEM 需填参考价)/拒绝/退回/议价(填反报价+备注)。
- 可选：目录条目详情加"准入供应商"视图(可见报价)。

## 九、实施阶段

1. **DB 迁移**：新增 `SupplierCatalogApplication` + `CatalogSupplier` + 关系。
2. **Seed**：补示例（1 JOIN_EXISTING 待审、1 NEW_ITEM 议价中、1 已通过的 CatalogSupplier）。
3. **API-供应商侧**：脱敏浏览 + 申请 CRUD + 议价交互。
4. **API-管理员侧**：审核 4 动作 + 准入供应商列表 + 防重复校验。
5. **供应商门户 UI**：目录浏览页 + 我的申请页 + 申请弹窗 + 议价交互。
6. **Web 端 UI**：审核列表页 + 审核操作面板。
7. **通知 + 审计**：审核/议价/撤回推 `Notification`，操作写 `AuditLog`。
8. **E2E**：覆盖 提交→议价→接受→通过→建关系 / 改报价→审核 全链路。

## 十、风险与注意

- `CatalogItem.supplier` 仍是字符串（历史数据），本次**不迁移**，新增关系走 `CatalogSupplier`；两者并存，不冲突。
- 脱敏接口与原 `/api/catalog` 并存，注意别在供应商端误调原接口。
- 议价回环无次数硬上限，靠 AuditLog 留痕；如需限制可在 service 层加计数。
- `procurement_staff` 在 web 端已有 supplier 审核权限，复用现有守卫。
