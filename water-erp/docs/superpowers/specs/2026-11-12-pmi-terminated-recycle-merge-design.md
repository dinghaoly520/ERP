# 项目管理「已终止 × 回收站」合并落地设计（已移出区 + 删除留痕）

- 日期：2026-11-12
- 状态：已定稿（用户裁定三项，见 §6）
- 范围：:3005 项目管理页（`apps/web`）+ PMI 三端点（`apps/api/src/project-management/project-management.service.ts`）+ 新增删除留痕表

## 1. 背景与问题

项目管理页现有两个「项目离开进行中视野」的落脚点，用户观感重复：

| | 已终止（TERMINATED） | 回收站（RECYCLED） |
|---|---|---|
| 语义 | 业务结局：采购不做了 | 数据清理：记录不要了 |
| 留痕 | 6 列快照（原因/时点/阶段/终止人/台账轮次/全阶段附件 JSON） | 仅 status + recycledAt |
| 联动 | 台账 CANCELLED 轮次、投标联动流标、公告下架、工作安排取消、供应商通知 | 零联动 |
| 落地 | 主列表「已终止」tab | 顶栏按钮 → 独立抽屉 |

两者正交但落地分裂：两个只读「死项目堆」、两套卡片形态、两个入口按钮。且后端 `moveToRecycleBin` 无状态闸无投标闸（审计报告《采购方式全流程梳理与逻辑问题报告-2026-11-02》§7 P2-2），`restoreFromRecycleBin` 恒回 ACTIVE——若终止项目被 API 回收后恢复，业务终态记录会被「复活」为进行中。

## 2. 目标形态

**一个落脚点，三个层次**：

- **已终止** = 业务结局留痕（只读，永久业务记录）
- **已移除** = 可反悔的暂存（恢复 / 彻底删除）
- **已彻底删除** = 数据已清、记录永存的墓碑（新增留痕表）

状态枚举四值（ACTIVE/ARCHIVED/TERMINATED/RECYCLED）**不变**——TERMINATED/RECYCLED 在台账、水叮当、合同、绩效等 10+ 处被消费，本次纯属 :3005 展示层收口 + 后端闸门补齐 + 新增留痕表，零下游波及。

## 3. UI 设计（:3005 项目管理页）

### 3.1 Tab 结构

`进行中 | 已完成 | 已移出`（原「已终止」tab 改名并吸收回收站）。顶栏「回收站」按钮+角标删除，`RecycleBinDrawer` 组件退役。

Tab 角标计数 = 已终止 + 已移除 总数。

### 3.2 「已移出」tab 内部——三个小节

共用本页搜索/排序/筛选（`displayItems` 管线不动，作用于各节）：

1. **已终止组**：沿用 `ProjectCard variant=terminated`（可点开只读详情，台账深链照旧）+ 卡片角部弱化「移除清理」按钮 → 二次确认弹窗（弹窗规范 A 版瓷面壳：图标井头部五件套，is-danger）→ 调 `POST /project-management/:id/recycle`。
2. **已移除组**：沿用现回收站抽屉的简化卡结构（采购方式/当前阶段/移除时间）。按钮区：
   - 「恢复项目」——按钮文案带恢复目标：`恢复 · 回到已终止` / `恢复 · 回到进行中` / `恢复 · 回到已完成`（按 §4.2 戳推断）
   - 「彻底删除」——现有确认弹窗不变
   - **不可点开详情**（现状口径不变：详情面板 selectedItem 三态查找不含 RECYCLED）
   - 组级「一键删除」保留，仅当全部条目可管理（创建人）时可用
3. **已彻底删除组**（新增）：紧凑只读行——项目名/项目编码/采购方式/移除回收站时间/彻底删除时间/操作人/终止信息摘要（若曾终止）。无任何操作按钮、不可展开。空态不渲染本节标题。

### 3.3 入口按钮（不变 + 一处文案）

详情面板保持两按钮：`项目终止`（仅创建人+ACTIVE）与 `移至回收站`（仅创建人+ACTIVE）。**已完成 tab 不加任何清理按钮**（裁定 #1：已完成是成果展示，保持纯净；ARCHIVED 后端拒收）。

已终止详情只读横幅文案：`终止不可恢复，仅供查阅；如需继续采购请重新建立项目` → `终止不可恢复，仅供查阅；如需清理记录，可在项目列表·已移出区操作`。

## 4. 状态机与后端改动

### 4.1 生命周期

```
ACTIVE ──终止(填原因,联动流标/台账/通知)──▶ TERMINATED ──清理──▶ RECYCLED ──彻底删除──▶ 物理删除 + 留痕
ACTIVE ──移除(建错,无联动)──────────────────────────────────▶ RECYCLED
RECYCLED ──恢复──▶ 按戳推断原状态
```

### 4.2 `moveToRecycleBin`（service:5983）

- **放行集 = ACTIVE + TERMINATED**；ARCHIVED → 400 `「已完成项目不可移除清理。」`（裁定 #1；封掉现状 API 可回收 ARCHIVED/任意态的漏洞）
- **新增 BID_IN_PROGRESS 闸**（收口 P2-2）：关联 BidProject 处 DOWNLOAD/SUBMIT/OPENING/EVALUATING → 409 `BID_IN_PROGRESS`，复用 `completeProject`/`terminateProject` 既有判定函数与文案口径（引导先终止）。终态项目因终止/归档时已联动流标，此闸对其自然放行
- 仍仅创建人（`assertCanManageProject`）；幂等（已 RECYCLED 直接返回）保留
- 前端调用点：①详情面板「移至回收站」（ACTIVE）②已终止卡片「移除清理」（TERMINATED）——同一端点

### 4.3 `restoreFromRecycleBin`（service:6006）

- 恢复目标由恒回 ACTIVE 改为**按戳三向推断**：`terminatedAt` 非空 → TERMINATED；否则 `archivedAt` 非空 → ARCHIVED（存量数据兜底：放行集收紧前曾被回收的 ARCHIVED 项目）；都空 → ACTIVE
- 清 `recycledAt` 不变；仅 RECYCLED 可恢复、仅创建人不变
- 推断无需迁移——两列均已存在且互斥（terminate/complete 均只从 ACTIVE 进入）

### 4.4 `deletePermanently`（service:6029）——卫生清理扩容 + 留痕

闸门不变：仅 RECYCLED、仅创建人、ASIP 已导出禁删（409）、`recycledAt` 起算 3 年保留期（DA/T 103-2024 §8.5）。在此之上，同一事务内按序：

1. **写留痕**：新增 `ProjectDeletionRecord`（见 §5）
2. **项目附件卫生**（现状缺口：只删 PMI 行，Attachment 行经 SetNull 存活、物理文件留盘）：取本项目全部 Attachment（PMI 直挂 + stage 挂），删磁盘文件（`uploads/<objectKey>`，容错）+ 删行。注意 Attachment 版本表（`AttachmentVersion`）随之清理
3. **连带删除台账轮次**（裁定 #2）：`terminatedProcurementRoundId` 非空则删该 `ProcurementRound`——其 RoundSupplier 关系 `onDelete: Cascade` 自动清理；轮次挂的 Attachment 行（SetNull 存活）同 ② 清理；轮次留痕信息已由 §5 墓碑承载（终止时间/原因/轮次号）
4. 删 PMI 行（stages/planItems/teamMembers 级联；BidProject `projectManagementItemId` SetNull 软摘挂——投标侧记录存活，仅断链，符合「投标数据是过程证据」口径）
5. `archivedProcurementRoundId` 场景不存在（ARCHIVED 拒收，无法进入 RECYCLED）

### 4.5 新端点：删除留痕列表

`GET /project-management/deletion-records`——继承控制器类级 `@Roles('leader','admin','staff')`（与列表同口径），可见性与 `list()` 完全同构：staff=本人留痕（createdById）、leader=本公司、admin=全量+`?companyId=` 筛选（`CompanyScopeService`）。返回按 `deletedAt` 倒序**最近 200 条**（规划期修订：撤分页——彻底删除有 3 年保留期前置，表常年近空，200 上限+前端本地搜索足够；量大再上分页）。实现注记：控制器无裸 `@Get(':id')`，静态路由不被吞；声明放在静态路由区（`project-attributions` 一带）以绝后患。仅此一个读端点，无任何写/删端点。

## 5. 删除留痕模型 `ProjectDeletionRecord`

```prisma
model ProjectDeletionRecord {
  id                String   @id @default(cuid())
  // 项目快照
  projectId         String   // 被删 PMI 的原 id（留痕定位用，非外键）
  title             String
  projectCode       String?  // 可空：未生成编码即删
  requesterName     String
  requesterDepartment String
  procurementMethod String
  budgetAmount      Decimal? @db.Decimal(14, 2)
  companyId         String?
  companyName       String?  // 写时快照
  createdById       String?  // 原创建人（staff 可见性=本人留痕，对齐 list() 口径——规划期补）
  // 终止信息快照（曾终止过的项目才有——即被连带删除的台账 CANCELLED 轮次的幸存痕迹）
  terminatedAt      DateTime?
  terminationReason String?
  terminatedStage   String?
  terminatedByName  String?  // displayName 落快照（操作人显示姓名裁定 2026-11-09）
  terminatedRoundNo Int?     // 被连带删除的台账轮次号
  // 清理轨迹
  recycledAt        DateTime? // 入回收站时间（存量无戳为 null）
  deletedAt         DateTime  @default(now())
  deletedByName     String    // 操作人 displayName 快照
  @@index([companyId, deletedAt])
}
```

- 写入仅在 `deletePermanently` 事务内，无独立写端点；无删除端点——**天然不可删**（对齐 OperationLog MinIO 归档「归档对象非 FileAsset、无删除端点」哲学）
- 一键删除 = 逐项目各写一条

## 6. 用户裁定记录（本设计内推翻/采纳）

1. **仅已终止可清理**（推翻「已完成也可清理」一致性方案）：已完成 tab 保持成果展示纯净，ARCHIVED 后端拒收
2. **彻底删除连带删除台账 CANCELLED 轮次**（推翻「保留轮次+深链降级」推荐案）：痕迹丢失顾虑由 §5 墓碑的终止信息快照承载，两条裁定自洽
3. **彻底删除必须留痕**：删除的是数据，留下的是记录——`ProjectDeletionRecord` 永不可删

## 7. 测试

- **单测**（`project-management.service.spec.ts` 或新 spec）：
  - `moveToRecycleBin`：ACTIVE/TERMINATED 放行、ARCHIVED 400、RECYCLED 幂等、非创建人 403、关联活动态 BidProject 409 BID_IN_PROGRESS
  - `restoreFromRecycleBin`：三向推断（terminatedAt→TERMINATED / archivedAt→ARCHIVED / 无戳→ACTIVE）、清 recycledAt
  - `deletePermanently`：留痕落库字段断言、附件行+文件清理调用、terminatedProcurementRoundId 轮次连带删除（含轮次附件）、ASIP 导出 409、3 年保留期 409
- **e2e**：终态清理→恢复回终态（保持只读）链路；已移出区三节渲染
- 前端：`project-management-page` 三节分组渲染、恢复按钮文案、删除留痕节空态隐藏

## 8. 边界与不做

- 枚举/下游消费面（台账、水叮当、合同、绩效、通知）零改动
- RECYCLED 不进详情面板（现状口径）
- 删除留痕不做导出/检索专门页——活在「已移出」tab 内，随本页搜索
- 不合并详情面板两个入口按钮（终止/移除语义差异大：终止须填原因+联动，合并对话框反增一步）
- 迁移注意：本地库漂移口径（memory `local-db-migration-drift`）——新表迁移走 `migrate dev --create-only` → `db execute` → `resolve --applied`；`schema.prisma` 为并行会话共享高危文件，改前核 `git status`、提交内附迁移
