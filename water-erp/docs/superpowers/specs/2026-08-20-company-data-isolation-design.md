# 公司级数据隔离体系设计方案

> 2026-08-20 · 范围：:3005 采购管理工作台 · 状态：**已实施（同日 P1-P4 全部落地）**
>
> 拍板结果：①项目管理=个人隔离+admin 全量（1C）；②无归属存量全清除（21 BidProject+17 公告已删，备份 backups/water_erp_20260820_112408.sql.gz）；③admin 默认全部公司；④供应商/专家/目录不隔离、**公告管理端隔离**（public 端点不受限）。

## 一、目标与"真隔离"原则

**需求**：数据库（/dashboard）、采购台账（/procurements）、采购进度（/progress）以公司为数据归属单位——登录账号属于哪个公司，就只能查询、统计本公司的数据；同公司数据划归一起；admin 可通过公司下拉框选择查看任一公司或全部公司。个人项目隔离（2026-08-20 已实施于项目管理）纳入统一体系。

**"真隔离"三层含义**（区别于"前端隐藏 / 全量查出再过滤"）：

1. **查询层隔离**：Prisma `where` 注入公司条件，数据不离开数据库——不是查出全量后丢弃；
2. **API 层隔离**：直接调 `:id` 端点（curl/直链）同样校验归属，无法越权读取单条他人公司数据；
3. **统计层隔离**：所有聚合（金额合计、轮次统计、图表）在隔离后的数据集上计算——不是全量算完再减掉。

## 二、现状盘点

| 页面 | 后端端点 | 数据模型 | 现有隔离 |
|------|---------|---------|---------|
| 数据库 /dashboard | `GET /dashboard`（dashboard.service） | ProcurementRound + 多表聚合（561/617/663/736 行四组统计） | 无 |
| 采购台账 /procurements | `GET /procurements` | ProcurementProject（`departmentId`→Department，无公司） | 无 |
| 采购进度 /progress | `GET /progress/stats` `/ai-insights` | ProjectManagementItem | 仅 `?userId=` 参数过滤 + `canViewGlobalBusinessData` 角色闸 |
| 项目管理 /projects | `GET /project-management` | ProjectManagementItem | **个人隔离已实施**（`where.createdById`，全员含 admin） |

**公司基础缺失**：
- `User.company` 是自由文本（注册时 `normalizeCompany` 归一化），无 `Company` 主数据表；
- `/auth/companies` 从 User 表 `distinct` 动态聚合——名称分叉风险（"四川水发建设有限公司" vs "四川水发建设"）；
- 四个业务模型（ProjectManagementItem / ProcurementProject / ProcurementRound / BidProject）**全部无公司字段**；
- 现有公司：四川水发勘测设计研究有限公司（本部）、四川水发建设有限公司（JS）、四川水发投资有限公司（TZ）。

## 三、设计方案

### 3.1 公司主数据（Company 表）

```prisma
model Company {
  id             String   @id @default(cuid())
  name           String   @unique        // 规范全称（主数据，唯一）
  shortName      String?                 // 如"建设/投资/设计院"
  createdAt      DateTime @default(now())
  users          User[]
  pmItems        ProjectManagementItem[]
  procurementProjects ProcurementProject[]
  procurementRounds   ProcurementRound[]
  bidProjects    BidProject[]
}
```

- `User` 增加 `companyId`（外键）+ 保留 `company` 文本作展示快照；注册 `normalizeCompany` 改为**先对齐 Company 表**（精确→去后缀模糊→命中即挂 id，未命中新建 Company 或标记待定，由 admin 在用户管理中归位）；
- `/auth/companies` 改查 Company 表（带用户数），下拉开窍点不变。

### 3.2 业务数据归属字段（数据标记层）

四张业务表统一加：

```
companyId    String?    // 外键 → Company（隔离与统计的依据）
companyName  String?    // 写时快照（公司改名不影响历史记录展示）
```

落表清单：

| 模型 | 加字段 | 写入时机 |
|------|--------|---------|
| ProjectManagementItem | companyId + companyName | createFromInitiation / 公告直建补 PMI，取当前登录人 User.companyId |
| ProcurementProject | 同上 | 台账新建/导入 |
| ProcurementRound | 同上 | 轮次创建（开标、竞价轮） |
| BidProject | 同上 | 项目创建（含公告联动创建） |

**原则**：归属是数据自身属性（写时快照），不依赖创建人——创建人日后调公司不改历史数据归属。

### 3.3 隔离引擎（CompanyScopeService）

新建全局模块 `apps/api/src/company/company-scope.module.ts` + `company-scope.service.ts`：

```ts
/** 解析当前请求的公司视野 */
resolveScope(user: AuthenticatedUser, requestedCompanyId?: string): CompanyScope
// CompanyScope = { all: true }                          // admin·全部公司
//               | { all: false, companyId: string }     // 限定单公司

resolveFilter(scope, field = 'companyId'): Record<string, unknown>
// all → {}; 否则 { companyId }（供各 service 的 where 直接展开）
```

**规则**：
- **非 admin**：强制 `User.companyId`；URL 传 `companyId` 参数**忽略**（防伪造）；`companyId` 为空的老用户 → 返回空数据集并提示 admin 归位（而不是放行全部）；
- **admin**：默认 `{ all: true }`；传 `?companyId=<id>` 切换单公司；`?companyId=all` 显式全部。

**单条越权校验**：`assertInScope(itemCompanyId, scope)` —— 用于 `:id` 详情/写操作端点，越权抛 403。四个模块的 `:id` 端点全部接入（项目管理沿用 8-20 已有个人隔离守卫，叠加公司维度）。

### 3.4 可见性矩阵（个人 × 公司双维度并存）

| 页面 | 维度 | 规则 |
|------|------|------|
| 项目管理 /projects | **个人** | 仅创建人可见（2026-08-20 已实施，维持）；admin 若需全局视野单独拍板 |
| 数据库 /dashboard | **公司** | 本公司全部数据（含同事建的），admin 可切公司/全部 |
| 采购台账 /procurements | **公司** | 同上 |
| 采购进度 /progress | **公司** | 同上；现有 `?userId=` 参数保留（公司内再按人筛选） |

**个人项目与公司体系的关系**（对"刚才的个人项目也一并考虑"的落点）：PMI 打上 companyId 后——项目管理页仍是"我的项目"（个人视图），但同一批数据在数据库/台账/进度中按公司划归（公司视图）：Swhi-JS-01 建的项目，JS-02 在项目管理里看不到（个人隔离），但在采购进度里能看到（同公司聚合）。两个视图互不冲突，各按各的 where 实现。

### 3.5 admin 公司选择器（交互层）

- /dashboard、/procurements、/progress 三页工具栏（page-hero__right）加 **公司下拉框**（仅 admin 渲染）：
  - 选项：`全部公司`（默认）+ Company 表各公司（带用户数徽标可选）；
  - 选择 state 挂 URL query（`?companyId=`），刷新/分享链接保持；存 localStorage 记忆上次选择；
  - 切换即重新拉数（三页各自的 fetch 透传参数）；
  - 非 admin 无此控件，后端也忽略其传参（双保险）。

### 3.6 统计口径

- `dashboard.service.getDashboard` 四组统计（轮次、金额、附件、进度）全部前置注入 `resolveFilter`；
- `progress.service.getProgressStats` 聚合注入；`ai-insights` 的 LLM 输入数据集同步隔离；
- 台账列表与合计行注入；
- **验收等式**：隔离前全量统计数 = ∑ 各公司统计数 + 无归属数（admin"全部公司"视图与改造前数字一致，保证不丢数据）。

## 四、存量数据迁移与回填

1. 建 `Company` 表 + `User.companyId`；
2. User 回填：按 `company` 文本归一化挂 id（三家公司精确命中）；
3. 四张业务表加列；
4. 业务数据回填规则（一次性脚本 `prisma/scripts/backfill-company.ts`）：
   - `createdById` 有值 → 创建人 `User.companyId`；
   - PMI `createdById` 为空 → 按 `requesterDepartment` 所属院落回设计院本部（或保持 NULL 归"未归属"，仅 admin 全部视图可见——**待拍板**）；
   - 回填后校验：`count(companyId IS NULL)` 输出清单供 admin 人工归位；
5. 迁移方式：沿用定点迁移模式（`prisma db execute --url DIRECT_URL` → `migrate resolve` → `generate`）。

## 五、分阶段实施

| 阶段 | 内容 | 涉及文件 |
|------|------|---------|
| **P1 数据层** | Company 表/迁移/回填；注册归一化对齐 Company；`/auth/companies` 改源 | schema.prisma、migrations、`prisma/scripts/backfill-company.ts`、auth.service/controller |
| **P2 隔离引擎** | CompanyScopeService；四模型创建端点写入归属；list/stats/`:id` 端点接入过滤与越权校验 | 新建 company 模块；dashboard/procurements/progress/project-management 四模块 service+controller |
| **P3 前端** | admin 公司选择器组件；三页透传 `companyId`；驾驶舱统计联动 | 新建 `web/src/components/company/company-select.tsx`；三页 page/组件、lib/api 对应函数 |
| **P4 验证** | 三公司账号 curl 矩阵（列表数/统计数/越权 403）；admin 切换截图；隔离等式核对；单元测试 | — |

每阶段独立可验证；P2 完成即达成隔离（P3 仅影响 admin 体验）。

## 六、不隔离范围（边界声明）

- **供应商库 / 专家库 / 公告**：跨公司共享的公共主数据与对外公示，不按公司隔离（公告直建的**项目**按发布人公司归属，但公告本身全公司可见）；
- **工作安排 / 通知 / 收藏**：个人数据，天然隔离；
- **:3004 供应商门户 / :3006 专家门户 / :3007 开评标端**：不在本次范围；
- **集中采购目录/商城**：集团统一目录，不隔离。

若后续要求公告等也按公司隔离，架构上只需在同一引擎上扩展，不需重构。

## 七、风险与对策

| 风险 | 对策 |
|------|------|
| 老用户 `companyId` 为空 → 突然看不到数据 | 空归属不放行全部：返回空集 + 明确提示"账号未归属公司，请联系管理员"；admin 用户管理面板提供归位入口 |
| 公司名分叉（历史自由文本） | normalizeCompany 归一化对齐 + Company.name 唯一约束 + 回填时模糊匹配报告 |
| 跨公司统计突变（用户习惯看全量） | admin 默认"全部公司"，行为与现状一致；普通账号变化即需求本身 |
| 公告直建/联动创建路径漏写归属 | P2 在四个创建入口统一收口（公告联动 createBidProject/补 PMI 走同一 helper） |
| 统计口径不一致（某处漏注入） | 隔离等式验收（全量 = 分公司之和）+ code review 清单对照四组统计块 |

## 八、待拍板决策点

1. **项目管理页（/projects）最终口径**：A. 维持个人隔离（推荐，符合 8-20 决策）；B. 升级为公司隔离（同公司互见）；C. 个人隔离 + admin 全量。
2. **无归属数据**（`createdById` 为空的存量）：A. 按部门回填设计院本部（推荐，现有 1 条）；B. 保持"未归属"，仅 admin 全部视图可见。
3. **admin 默认视图**：A. 全部公司（推荐）；B. 记住上次选择的公司。
4. **供应商/公告不隔离**的边界是否认可（第六节）。
