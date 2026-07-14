# 集中目录管理全链路增强 — 设计规格

> 日期：2026-07-14 | 方案：C（全链路型） | 状态：待实现

---

## 1. 背景与目标

### 现状

water-erp :3005 的"集中目录管理"模块当前包含 5 个子页面：

| 页面 | 状态 |
|------|------|
| 目录管理（CRUD 列表 + 统计看板） | ✅ 完整 |
| 价格录入（手动 + Excel 批量导入） | ✅ 完整 |
| 价格审批（供应商申请审批工作流） | ✅ 完整 |
| 操作日志（审计日志查看器） | ✅ 完整 |
| 集中采购目录（空壳，仅跳转 :3003） | ❌ 需重建 |

### 核心缺陷

1. **分类体系扁平**：`CatalogItem.category` 和 `CatalogItem.group` 是自由文本字符串，非结构化引用。没有真正的品类树，没有层级关系，没有节点管理能力。
2. **无品类属性差异化**：所有目录项共用同一套字段，无法做到"钢材有直径/材质，水泥有标号/强度"的品类专属属性。
3. **集中采购目录页空壳**：仅放了一个跳转 :3003 外链的按钮，没有任何目录浏览功能。
4. **缺少价格分析**：虽有 `PriceHistory` 表，但没有趋势图、价格对比、预警机制。
5. **与采购链路脱节**：目录项无法关联采购计划、批量询价、合同价格。

### 目标

将"集中目录管理"从扁平化的目录列表升级为**全链路平台**：结构化品类树 → 差异化属性模板 → 价格趋势分析 → 采购链路闭环。

---

## 2. 数据模型

### 2.1 新增模型

```prisma
// ── 品类树节点 ──
model CatalogCategory {
  id        Int       @id @default(autoincrement())
  name      String                            // 节点名称，如 "钢材"
  code      String?   @unique                 // 可选编码，如 "STEEL"
  parentId  Int?                              // 父节点，null=根节点
  parent    CatalogCategory?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children  CatalogCategory[] @relation("CategoryHierarchy")
  sortOrder Int       @default(0)             // 同级排序
  status    String    @default("ACTIVE")      // ACTIVE | INACTIVE
  isLeaf    Boolean   @default(false)         // 是否为叶子品类（可挂载目录项）
  icon      String?                           // 可选图标
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  // 叶子品类可定义属性模板
  attributeTemplates CategoryAttributeTemplate[]
  // 叶子品类下的目录项
  catalogItems       CatalogItem[]

  @@index([parentId])
  @@index([code])
}

// ── 品类属性模板 ──
model CategoryAttributeTemplate {
  id          Int              @id @default(autoincrement())
  categoryId  Int
  category    CatalogCategory  @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  name        String                            // 属性名，如 "直径"
  fieldKey    String                            // 字段键名，如 "diameter"
  fieldType   String                            // TEXT | NUMBER | SELECT | DATE | BOOLEAN
  required    Boolean          @default(false)
  options     Json?                             // SELECT 类型的选项列表 ["8mm","10mm","12mm"]
  unit        String?                           // 单位，如 "mm"
  sortOrder   Int              @default(0)
  createdAt   DateTime         @default(now())

  @@unique([categoryId, fieldKey])
  @@index([categoryId])
}

// ── 目录项属性值 (EAV) ──
model CatalogItemAttribute {
  id            Int          @id @default(autoincrement())
  catalogItemId Int
  catalogItem   CatalogItem  @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  templateId    Int
  template      CategoryAttributeTemplate @relation(fields: [templateId], references: [id])
  value         String                            // 属性值，统一存字符串

  @@unique([catalogItemId, templateId])
  @@index([catalogItemId])
}

// ── 目录项关联关系 ──
model CatalogItemRelation {
  id              Int          @id @default(autoincrement())
  catalogItemId   Int
  catalogItem     CatalogItem  @relation("ItemRelations", fields: [catalogItemId], references: [id], onDelete: Cascade)
  relatedItemId   Int
  relatedItem     CatalogItem  @relation("RelatedItems", fields: [relatedItemId], references: [id], onDelete: Cascade)
  relationType    String                            // SUBSTITUTE | COMPLEMENT | SIMILAR
  createdAt       DateTime     @default(now())

  @@unique([catalogItemId, relatedItemId, relationType])
}

// ── 价格预警规则 ──
model PriceAlertRule {
  id              Int              @id @default(autoincrement())
  name            String                            // 规则名称
  categoryId      Int?                              // 可选：限定品类
  category        CatalogCategory?  @relation(fields: [categoryId], references: [id])
  alertType       String                            // PRICE_SURGE | PRICE_DROP | EXPIRING | DEVIATION
  threshold       Float                             // 阈值（涨幅% / 提前天数 / 偏离倍数）
  enabled         Boolean          @default(true)
  notifyRoles     String[]                          // 通知角色 ["ADMIN","STAFF"]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([categoryId])
}

// ── 价格预警记录 ──
model PriceAlert {
  id            Int            @id @default(autoincrement())
  ruleId        Int
  rule          PriceAlertRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  catalogItemId Int
  catalogItem   CatalogItem    @relation(fields: [catalogItemId], references: [id])
  alertType     String
  message       String                           // 预警描述
  triggerValue  Float                            // 触发时的实际值
  isRead        Boolean        @default(false)
  isResolved    Boolean        @default(false)
  createdAt     DateTime       @default(now())

  @@index([catalogItemId])
  @@index([isRead, isResolved])
}

// ── 目录版本快照 ──
model CatalogVersion {
  id          Int       @id @default(autoincrement())
  name        String                            // 如 "2026年度采购目录"
  version     String                            // 如 "v2026.1"
  effectiveAt DateTime                           // 生效日期
  status      String    @default("DRAFT")       // DRAFT | ACTIVE | ARCHIVED
  description String?
  snapshot    Json                               // 快照数据（完整 JSON）
  createdAt   DateTime  @default(now())
  createdBy   Int
  user        User      @relation(fields: [createdBy], references: [id])

  @@index([status])
}

// ── 批量询价单 ──
model CatalogInquiry {
  id          Int              @id @default(autoincrement())
  title       String
  status      String           @default("DRAFT")    // DRAFT | SENT | CLOSED
  items       Json                                   // [{ catalogItemId, spec, qty }]
  supplierIds Int[]                                 // 目标供应商 ID 数组
  deadlineAt  DateTime?
  notes       String?
  createdAt   DateTime         @default(now())
  createdBy   Int
  user        User             @relation(fields: [createdBy], references: [id])

  @@index([status])
}

// ── 框架合同价格 ──
model ContractPrice {
  id            Int          @id @default(autoincrement())
  catalogItemId Int
  catalogItem   CatalogItem  @relation(fields: [catalogItemId], references: [id])
  supplierId    Int
  supplier      Supplier     @relation(fields: [supplierId], references: [id])
  contractNo    String
  agreedPrice   Float
  validFrom     DateTime
  validUntil    DateTime
  status        String       @default("ACTIVE")     // ACTIVE | EXPIRED | TERMINATED
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([catalogItemId])
  @@index([supplierId])
  @@index([validUntil])
}
```

### 2.2 现有模型改动

```diff
model CatalogItem {
- category     String?       // "钢材" → 移除
- group        String?       // "工程材料" → 移除
+ categoryId   Int?                          // FK → CatalogCategory
+ category     CatalogCategory? @relation(fields: [categoryId], references: [id])
+ attributes   CatalogItemAttribute[]
+ relations    CatalogItemRelation[]  @relation("ItemRelations")
+ relatedTo    CatalogItemRelation[]  @relation("RelatedItems")
+ priceAlerts  PriceAlert[]
+ contractPrices ContractPrice[]
}
```

---

## 3. 页面结构

增强后共 **10 个页面**，分 4 个导航组：

```
集中目录管理
├── 📁 目录体系
│   ├── 品类树管理      /mall-management/category-tree     【新建】
│   ├── 集中采购目录     /mall-management/central-catalog    【重做】
│   └── 目录版本         /mall-management/versions           【新建】
│
├── 📋 目录运营
│   ├── 目录管理         /mall-management/catalog            【增强】
│   ├── 价格录入         /mall-management/price-entry        【增强】
│   └── 价格审批         /mall-management/approval           【保持】
│
├── 📊 价格分析
│   ├── 价格趋势         /mall-management/price-trends       【新建】
│   └── 价格预警         /mall-management/price-alerts       【新建】
│
└── ⚙️ 其他
    ├── 操作日志         /mall-management/logs               【保持】
    └── 供应商维度       /mall-management/supplier-view      【新建】
```

### 3.1 页面功能详述

#### 品类树管理（新建）

- **树形结构可视化**：递归渲染无限层级树，支持展开/折叠全部
- **节点 CRUD**：新增子节点 / 编辑节点 / 删除节点（有子节点或关联目录项时确认提示）
- **拖拽排序**：同级节点拖拽调整 `sortOrder`，跨级拖拽改变 `parentId`
- **启用/停用**：停用节点后级联隐藏其所有子节点下的目录项
- **属性模板配置**（仅叶子节点）：添加/编辑/删除/排序属性字段，指定字段类型（文本/数字/下拉/日期/布尔）、是否必填、单位、选项列表

#### 集中采购目录（重做）

- **左侧品类树导航**：展示完整品类树，点击节点折叠/展开，选中叶子节点筛选右侧数据
- **右侧目录项表格**：联动显示当前选中品类下的目录项，支持价格排序、规格筛选
- **面包屑导航**：品类路径显示，方便快速跳转层级
- **目录项详情面板**：侧滑或展开显示规格参数（属性模板渲染）、当前价格、历史价格 mini 图、供应商列表
- **快速操作**：收藏、导出当前筛选结果、发起询价（勾选多项）

#### 目录版本（新建）

- **版本列表**：卡片式展示历年版本（名称、版本号、生效日期、状态）
- **创建新版本**：输入版本名称和生效日期 → 后台对当前全量目录数据拍 JSON 快照存入 `snapshot`
- **版本对比**：选择两个版本，对比新增项 / 下架项 / 价格变化项（差异高亮）
- **版本导出**：导出某个版本为 Excel
- **版本状态管理**：草稿 → 生效 → 归档

#### 目录管理（增强）

- 现有功能保持
- **分类筛选改为品类树选择器**：替换当前字符串搜索为 TreeSelect 组件，支持按品类路径筛选
- **表格增加"品类路径"列**：显示完整路径如 `工程材料 > 钢材 > 钢筋`
- **新增/编辑表单**：分类字段从自由文本改为品类树选择器
- **详情查看**：新增"查看详情"按钮，展示该目录项的属性模板渲染结果 + 供应商关联 + 价格历史

#### 价格录入（增强）

- 现有批量导入功能保持
- **手动创建表单增强**：选择品类后，根据该叶子品类的 `CategoryAttributeTemplate` 动态渲染属性输入字段（文本输入、数字输入+单位、下拉选择、日期选择、布尔开关）
- **批量导入增强**：导入模板的列头根据所选品类动态调整

#### 价格审批（保持）

- 现有审批工作流完全保留（PENDING → COUNTERED/RETURNED/APPROVED/REJECTED/WITHDRAWN）
- 审批卡片增强：显示目录项的品类路径和属性规格参数

#### 价格趋势（新建）

- **单品趋势图**：选中目录项，以折线图展示 `PriceHistory` 价格曲线
- **多品对比**：叠加多条价格曲线，不同颜色区分，图例可点击显隐
- **筛选控件**：时间段范围选择、地区下拉、供应商多选
- **关键节点标注**：在曲线上标注价格审批通过节点（从 AuditLog 获取）

#### 价格预警（新建）

- **规则配置页**：列表展示已配置的预警规则，支持新增/编辑/启用禁用
  - 涨幅预警：30天内涨幅超过 X%
  - 跌幅预警：30天内跌幅超过 X%
  - 即将过期：目录项有效期剩余不足 N 天
  - 偏离均值：价格偏离该品类均价 N 倍标准差
- **预警列表页**：触发的预警记录，按状态筛选（未读/已读/已解决），支持批量标记已读/已解决
- **通知集成**：预警触发时向通知中心推送消息

#### 操作日志（保持）

- 现有功能保持，日志类型扩展覆盖品类树操作（CATEGORY_CREATE / CATEGORY_UPDATE / CATEGORY_DELETE 等）

#### 供应商维度（新建）

- **供应商列表**：展示所有已关联目录项的供应商
- **品类覆盖矩阵**：每个供应商的供货品类覆盖情况（树形热力图）
- **价格对比表**：同品类下不同供应商报价横向对比
- **供应商详情**：报价历史、合同价格、审批通过率

---

## 4. API 设计

### 4.1 品类树接口

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/catalog/categories/tree` | 获取完整品类树（嵌套 children） |
| `GET` | `/api/catalog/categories/:id` | 获取单个品类节点详情 |
| `POST` | `/api/catalog/admin/categories` | 创建品类节点 |
| `PATCH` | `/api/catalog/admin/categories/:id` | 更新品类节点 |
| `DELETE` | `/api/catalog/admin/categories/:id` | 删除品类节点（级联校验） |
| `PATCH` | `/api/catalog/admin/categories/:id/sort` | 调整排序位置 |
| `PATCH` | `/api/catalog/admin/categories/:id/status` | 启用/停用节点 |
| `GET` | `/api/catalog/categories/:id/attribute-templates` | 获取品类的属性模板 |
| `POST` | `/api/catalog/admin/categories/:id/attribute-templates` | 新增属性模板 |
| `PATCH` | `/api/catalog/admin/attribute-templates/:id` | 更新属性模板 |
| `DELETE` | `/api/catalog/admin/attribute-templates/:id` | 删除属性模板 |

### 4.2 目录版本接口

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/catalog/admin/versions` | 版本列表 |
| `GET` | `/api/catalog/admin/versions/:id` | 版本详情 + 快照数据 |
| `POST` | `/api/catalog/admin/versions` | 创建新版本快照 |
| `PATCH` | `/api/catalog/admin/versions/:id/status` | 状态变更 |
| `GET` | `/api/catalog/admin/versions/compare` | 对比两个版本 |

### 4.3 价格趋势接口

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/catalog/items/:id/price-trend` | 单品价格历史 |
| `GET` | `/api/catalog/price-trend/compare` | 多品价格对比数据 |

### 4.4 价格预警接口

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/catalog/admin/alert-rules` | 预警规则列表 |
| `POST` | `/api/catalog/admin/alert-rules` | 创建预警规则 |
| `PATCH` | `/api/catalog/admin/alert-rules/:id` | 更新规则 |
| `DELETE` | `/api/catalog/admin/alert-rules/:id` | 删除规则 |
| `PATCH` | `/api/catalog/admin/alert-rules/:id/toggle` | 启用/禁用 |
| `GET` | `/api/catalog/admin/alerts` | 已触发预警列表 |
| `PATCH` | `/api/catalog/admin/alerts/:id/read` | 标记已读 |
| `PATCH` | `/api/catalog/admin/alerts/:id/resolve` | 标记已解决 |

### 4.5 询价与合同接口

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/catalog/admin/inquiries` | 询价单列表 |
| `POST` | `/api/catalog/admin/inquiries` | 创建询价单 |
| `PATCH` | `/api/catalog/admin/inquiries/:id` | 更新询价单 |
| `PATCH` | `/api/catalog/admin/inquiries/:id/send` | 发送询价单 |
| `GET` | `/api/catalog/admin/contract-prices` | 合同价格列表 |
| `POST` | `/api/catalog/admin/contract-prices` | 录入合同价格 |
| `PATCH` | `/api/catalog/admin/contract-prices/:id` | 更新合同价格 |

### 4.6 目录项关联接口

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/catalog/items/:id/relations` | 获取关联的目录项 |
| `POST` | `/api/catalog/admin/items/:id/relations` | 新增关联 |
| `DELETE` | `/api/catalog/admin/items/:id/relations/:relationId` | 删除关联 |

### 4.7 供应商维度接口

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/catalog/admin/supplier-coverage` | 供应商品类覆盖矩阵 |
| `GET` | `/api/catalog/admin/supplier-price-comparison` | 供应商价格横向对比 |

---

## 5. 前端组件拆分

### 5.1 新组件清单

```
components/catalog/
├── CategoryTree.tsx               # 品类树可视化组件（递归渲染）
├── CategoryTreeNode.tsx           # 树节点（展开/折叠/拖拽手柄/右键菜单）
├── CategoryTreeSelect.tsx         # 品类树选择器（表单控件）
├── CategoryFormDialog.tsx         # 品类节点编辑弹窗
├── AttributeTemplateEditor.tsx    # 属性模板编辑器（动态添加/删除字段）
├── AttributeValueRenderer.tsx     # 属性值渲染（只读模式，字段类型适配）
├── AttributeValueEditor.tsx       # 属性值编辑器（动态表单）
├── CatalogVersionCard.tsx         # 版本卡片
├── CatalogVersionDiff.tsx         # 版本对比组件（差异高亮）
├── PriceTrendChart.tsx            # 价格趋势折线图
├── PriceCompareChart.tsx          # 多品价格对比图
├── PriceAlertRuleForm.tsx         # 预警规则表单
├── PriceAlertList.tsx             # 预警记录列表
├── InquiryForm.tsx                # 询价单表单
├── ContractPriceTable.tsx         # 合同价格表格
├── SupplierCoverageMatrix.tsx     # 供应商品类覆盖矩阵
├── SupplierPriceComparison.tsx    # 供应商价格对比表
└── CatalogItemRelations.tsx       # 目录项关联管理
```

### 5.2 共享工具

```
lib/
├── category-tree-utils.ts         # 树形数据扁平化/嵌套转换/路径查找
├── attribute-template-utils.ts    # 属性模板 → 表单 schema 转换
└── price-alert-engine.ts          # 前端预警规则校验逻辑（预览用）
```

---

## 6. 实施分阶段策略

### 第一阶段：数据底座（~5 天）

| # | 工作项 | 产出 |
|---|--------|------|
| 1 | Prisma 迁移：新增 `CatalogCategory`, `CategoryAttributeTemplate` 模型 | migration.sql |
| 2 | 修改 `CatalogItem`：`category`/`group` → `categoryId` FK，数据迁移脚本 | seed 数据更新 |
| 3 | 品类树 CRUD API | `/api/catalog/admin/categories/*` |
| 4 | 品类树管理页（TreeView + CRUD + 拖拽排序 + 属性模板配置） | `/mall-management/category-tree` |
| 5 | 目录管理页增强：品类树选择器替换字符串分类 | `/mall-management/catalog` 增强 |

**交付物**：管理员可维护无限层级品类树，为叶子节点配置属性模板，目录项关联到品类树节点。

### 第二阶段：目录浏览 + 属性模板 + 价格分析（~4 天）

| # | 工作项 | 产出 |
|---|--------|------|
| 6 | 集中采购目录页（左侧品类树 + 右侧表格联动 + 面包屑 + 详情面板） | `/mall-management/central-catalog` 重做 |
| 7 | `CatalogItemAttribute` EAV 存储实现 + API | 后端 + DTO |
| 8 | 价格录入动态属性表单（根据品类渲染） | `/mall-management/price-entry` 增强 |
| 9 | 价格趋势页（折线图 + 多品对比 + 筛选） | `/mall-management/price-trends` |
| 10 | 价格预警（规则 CRUD + 预警列表 + 通知集成） | `/mall-management/price-alerts` |

**交付物**：3005 内完整的目录浏览体验 + 价格趋势分析 + 预警机制。

### 第三阶段：采购链路闭环（~3 天）

| # | 工作项 | 产出 |
|---|--------|------|
| 11 | 目录版本管理（版本 CRUD + 快照生成 + 版本对比） | `/mall-management/versions` |
| 12 | 批量询价功能（询价单 CRUD + 发送） | 弹窗组件 |
| 13 | 框架合同价格管理（CRUD + 到期提醒） | 后端 + 页面卡片 |
| 14 | 供应商维度视图（品类覆盖矩阵 + 价格对比） | `/mall-management/supplier-view` |
| 15 | 目录项关联管理（替代品/配套品） | 详情面板 Tab |

**交付物**：全链路闭环——目录→计划→询价→合同→供应商分析。

---

## 7. 非功能需求

### 7.1 性能
- 品类树全量加载后前端缓存（`useCategoryTree` hook），避免重复请求
- 目录项表格分页保持 20 条/页，大类品类下支持服务端搜索和排序
- 价格趋势图数据量 > 100 点时启用降采样

### 7.2 设计系统
- 品类树组件遵循 neumorphic 设计规范（cgzxui neu-* 类）
- 树节点展开/折叠使用 motion 动画
- 价格对比图使用 dataviz skill 规范的颜色方案
- 页面整体使用 AppShell 布局 + glassmorphism 风格

### 7.3 权限
- 品类树管理、版本管理、预警配置：仅 ADMIN 角色
- 目录管理、价格分析：ADMIN + STAFF
- 集中采购目录浏览：所有已登录用户

### 7.4 测试
- 品类树 CRUD 集成测试：创建/嵌套/移动/删除校验
- 属性模板动态表单渲染测试：多种字段类型覆盖
- 价格预警规则触发逻辑单元测试
- 目录版本快照生成和对比测试

---

## 8. 风险与依赖

| 风险 | 缓解措施 |
|------|---------|
| 现有 68 条数据的分类迁移可能丢失信息 | 迁移前备份，脚本先 dry-run 输出映射表供人工确认 |
| 品类树 + EAV 属性模板导致查询复杂度上升 | 品类树前端全量缓存，属性值批量加载（单次 JOIN 查询） |
| 价格预警规则过多导致通知泛滥 | 同一规则同一目录项 N 天内去重 |
| 版本快照数据量大 | JSON 压缩存储，超过 10 个版本后提示清理 |
