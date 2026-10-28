# 采购商城（mall）整线下线设计

日期：2026-10-28
状态：待审阅（builder check 通过后转执行计划）
裁定：用户 2026-10-28 口头裁定「全删」，仅保留信息门户现有的微信小程序（有赞）网页跳转。

## 1. 背景与意图

信息门户（:3002）首页「电子商城」入口卡已改为外链有赞商城（`home-client.tsx:236` → `https://j.youzan.com/-khlqe?shopAutoEnter=1&kdt_id=157422811`，微信内打开即小程序商城）。自建采购商城整条业务线（前端门户 + 管理端 + 后端 + 数据库）不再使用，全部退役，避免双轨并存与维护负担。

**为什么现在**：外部小程序商城已接管入口，自建线成为死代码；「mall 的 AI 路由直连 DeepSeek 未收口」等残留悬而未决，整线删除一揽子解决。

## 2. 目标

- 自建采购商城**零残留**：应用、管理页、后端模块、数据库模型/数据、角色、种子、脚本、文档引用全部移除。
- :3002 首页有赞跳转卡**原样保留**（不动一个字符）。
- 删除后全链可构建、可启动、可 seed、e2e 全绿（catalog 套件除外——它本身在删除范围内）。

## 3. 非目标 / 反目标

- **不动**其余门户的任何业务功能（专家/供应商/开评标/大屏/移动端均与商城线无关，已核实 bigscreen/mobile 零引用）。
- **不动** :3002 公告文案里的「电子商城采购」字样（平台业务描述，有赞商城仍成立，属保留口径）。
- **不动** 陈源远的 bid_host 账号（只删其 mall 同名账号）。
- mobile-portal 唯一残留是 `src/lib/api/auth.ts:9` AuthRole union 里的 `'mall'`（builder check 更正本文档初稿「mobile 零引用」的说法）——随删，微改不算动业务。
- 反目标：留下任何「半死」状态——如 Role enum 还有 mall 但无登录路径、端口表还有 3003 但无应用、Prisma client 还有 catalog 模型但无模块。要么删干净，要么不删。

## 4. 删除清单（分层，含路径）

### 4.1 前端应用

- `apps/mall/` 整目录删除。
- 根 `package.json`：`dev` concurrently 链去掉 mall 项（10 门户→9）、`dev:mall`、`build:mall`（及 lint/start 若有）。
- `packages/config/src/ports.ts`：`mall: 3003` 行删除。
- `packages/config/src/urls.ts`：role→portal 表 mall 项、`mall: 'mall'` 映射、注释更新；mall 角色消失后 unknown 分支自然兜底 public。
- `packages/config/src/domains.ts`：仅注释提及 mall 无子域，改注释。
- `packages/client/src/index.ts`：doc 注释里 mall/CatalogItem 示例改掉；**改后必须 `pnpm --filter @water-erp/client build`**（dist 消费，漏建全线 tsc 红——2026-09-14 实录）。

### 4.2 管理端（:3005 web）

- `apps/web/src/app/(main)/mall-management/` 整目录（approval/catalog/category-tree/central-catalog/logs/price-alerts/price-entry/price-trends/supplier-view/versions 十区块）。
- `apps/web/src/lib/api/catalog-admin.ts`、`lib/hooks/use-category-tree.ts`、`lib/attribute-template-utils.ts`（若仅 mall-management 消费；执行时核引用）。
- 侧栏导航「电子商城管理」入口（执行时定位 nav 配置）。
- `lib/login/login-routing.ts` 中 mall 相关分支（若有）。
- **预算参考 UI**（裁定 1 整删）：`components/projects/create-project-dialog.tsx` 的预算参考结果/依据面板 + `lib/api/project-management.ts` 中 analyze-budget-reference 封装。

### 4.3 供应商门户（:3004）——商城入驻/供货目录区块

- `src/app/(main)/catalog-applications/`、`src/app/(main)/catalog/`、`supply/page.tsx` 中商城相关区块。
- `src/lib/api/catalog.ts`、`src/components/catalog/application-dialog.tsx`、`src/styles/pages/catalog.css`。
- `src/components/shell/supplier-menu.ts` 菜单项 + `lib/__tests__/supplier-navigation.test.ts` 对应用例。

> 这是「全删」口径的自然延伸（后端 SupplierCatalogApplication/CatalogSupplier 删了，前端区块没有数据源）。设计上按删除处理，用户审阅本文档时可否决。

### 4.4 后端（apps/api）

- 模块目录：`src/catalog/`（含 catalog-import 及 spec）、`src/budget/`。
- `app.module.ts`：两处 import + providers 数组注册。
- `auth/port-routes.ts`：mall 门户与 catalog/budget 路由映射（执行时定位，已确认无字面 'mall' 但有 catalog 引用）。
- `auth/portal-cookie.ts` / `auth.service.ts`：`token_mall`、Role 解析、PORTAL_ROLE_PRIORITY 中 mall 项。
- `supplier-portal/`：`dto/catalog-application.dto.ts` + controller/service 中商城入驻端点。
- 水叮当：`assistant/tools/mall.tool.ts` 整删 + `assistant.service.ts` 工具注册 + `assistant.service.spec.ts` 对应用例（mall.tool 是 catalog/budget 统计工具，无数据源即死）。
- `framework/framework.service.ts`：`catalogCategoryId` 参数与落库列（执行时核该列挂在哪个模型，属 catalog 家族 FK）。
- procurement 侧：`ProcurementProject.budgetList` 关系字段及引用代码（BudgetList→采购项目转化通道，随线删除；procurement.service 中 "budget" 字样多为「预算金额」prose，勿误删——逐个核对）。
- **预算参考整删**（裁定 1）：`project-management/budget-reference-estimator.ts`、`dto/analyze-budget-reference.dto.ts`、`POST /project-management/analyze-budget-reference`（controller:133）——三级估价（目录单价/BudgetItem/历史项目类比）随 catalog/budget 整线退役，不做 Tier-3 降级。
- e2e：`test/catalog.e2e-spec.ts` 删除；其余 e2e 中 catalog/budget 引用清零。

### 4.5 数据库（Prisma + 迁移）

模型家族（`schema.prisma`，13 个具名 + 3 个关系附属）：

CatalogCategory、CatalogItemAttribute、CatalogVersion、CatalogInquiry、CatalogItemRelation、CatalogItem、CatalogItemAttachment、CatalogSearchLog、CatalogSubscription、BudgetList、BudgetItem、SupplierCatalogApplication、CatalogSupplier、**PriceHistory、PriceAlert、ContractPrice**（builder check 补——均 FK 强制连带 drop，ContractPrice 有外部消费面见 §4.8）；附属：`CategoryAttributeTemplate`、`PriceAlertRule`（Company 关系）、`UserFavorite`（执行时核是否商城收藏专属）。

外部关系列同步清理：`User.budgetLists`、`Supplier.catalogSupplies`、`ProcurementProject.budgetList`、`Company.attributeTemplates/catalogItems/alertRules`、framework 模型的 catalogCategoryId。**注意**：`Prequalification.catalogCategoryId`（schema:1247，集中预审同品类自动通过，GB/T 43711 §7.2.3.2）与 framework 协议品类列均为**无 FK 的裸 Int?**，FK 图谱删除法不会自动捕获——**裁定 2：两列均删**，同步清 `prequal.service.ts:105` 同品类自动通过逻辑与 framework 落库引用。

Notification 同步清理：catalog 域通知（`CATALOG_APPLICATION` / `PRICE_REVIEW`，接收人是 staff 审批人而非 mall 用户）须在迁移中一并清行——「删 mall 用户的通知」覆盖不到这批。

Role enum：删除 `mall` 值——迁移内先删 role='mall' 用户行及其依赖（通知/操作日志引用），再 drop enum value。

**迁移方法**（repo 铁律）：
1. 先 `pnpm db:backup`（毁数据前的快照）。
2. `prisma migrate dev --create-only` 生成迁移，**手工审阅 SQL**（drop tables、drop FK columns、delete mall users、alter enum）。
3. `prisma db execute` + `migrate resolve --applied`；`prisma validate` + `generate` 必跑。
4. **金仓重放**：主栈已切金仓（:54321），迁移须在金仓同步执行并通过 `scripts/db-migrate-kingbase.sh` 链路验证。
5. 禁止让 migrate diff 触碰 OperationLog 分区表 DDL（既有铁律）。

### 4.6 种子与账号

- `prisma/seed-data/` 中 catalog/budget 家族 JSON 快照 + `seed.ts` 对应加载段。
- User.json：陈源远（mall）行删除；同名双账号机制保留（bid_host 不受影响）。
- `water-erp/ACCOUNTS.md`、根 CLAUDE.md（门户表、角色路由表、cookie 表、dev 命令、e2e 清单、种子表、LLM 收口残留注记）同步更新。
- `.impeccable.md` 若提及 mall 门户则同步。

### 4.7 明确保留

- :3002 `home-client.tsx:236` 有赞卡**逐字不动**。
- :3002 `lib/announcements.ts` 公告文案（「电子商城采购/入驻」为平台业务描述）。
- 水叮当其余工具（procurement.tool / global-overview.tool 中 "budget" 为预算金额统计，非 Budget 模块——执行时逐个核实，只删真引用）。

### 4.8 builder check 并入清单（2026-10-28 审阅后补充，无需裁定）

- **根仓库 CI**（water-erp 之外，易漏）：`/home/asus/桌面/ERP/.github/workflows/ci.yml` 有 `pnpm --filter mall exec tsc` 闸（:72）与 supplier-403-vs-`/catalog/admin/items` e2e 抽查（:277）——同步删除。
- **e2e 换账号**：`test/auth.e2e-spec.ts` 单设备测试与开标大厅 e2e（WS 拒绝路径用陈源远 mall 登录）需换测试主体。
- **连带修剪消费面**（表删除后运行时必炸，修剪是唯一技术解，属「全删」口径；对用户可见的界面变化已在 §7 报告用户）：
  - `assistant.service.ts:711` quick-stats 的 catalogItem 计数 → :3008 水叮当首页商城统计卡（`assistant-home.tsx`）；
  - `ai/ai.service.ts`（:3005 AI 工作台报告的商城目录/供货审批节，~1541–1791）；
  - `supplier/supplier.service.ts:3611+` 与 `ai/supplier-portrait-analysis.service.ts`（供应商画像/时间线的供货申请+合同报价事件，源自 SupplierCatalogApplication/ContractPrice）；
  - `workflow/workflow.service.ts`（待办中心 catalog_application lane）;
  - `packages/shared/src/notification-registry.ts`（catalog 域通知类型）。

## 5. 风险与执行闸门

| 风险 | 缓解 |
|---|---|
| 并行会话（金仓部署）工作区有未提交改动 | **执行前 `git status` 确认干净**；不干净则等对方提交（协作约定）；本文档阶段只新增独立文件 |
| Role enum / portal-cookie 残留导致启动崩或登录解析错 | 删后 `npx prisma validate` + boot 冒烟（:4001 /api/docs 200）+ auth e2e |
| client dist 漏 rebuild | 删改 packages/client 后必 build，CI validate 链亦含 |
| 误删 prose 里的 "budget/预算" | 只删 BudgetList/BudgetItem/Catalog* 真引用，逐个核对 import 链而非字符串匹配 |
| 金仓/PG 双栈漂移 | 迁移在主栈金仓验证；PG 侧陈旧可不管（2026-10-21 后已不维护） |
| seed 重灌踩 FK | seed 本身 TRUNCATE CASCADE 重载，模型删干净后快照同步即可 |

## 6. 验收标准

1. `pnpm --filter api exec tsc --noEmit`（或既有 lint 通道）全绿；`npx prisma validate` 通过。
2. `pnpm dev:kill && pnpm dev`：9 门户 + API + worker 全部监听，`/api/docs` 200。
3. :3002 首页电子商城卡仍指有赞链接（浏览器目检）。
4. 全库 grep：`apps/mall`、`mall-management`、`CatalogItem|BudgetList|CatalogSupplier`、`token_mall`、`dev:mall` 零业务残留（历史 docs/specs 归档文件除外）。
5. e2e：除已删除的 catalog 套件外，其余套件全绿。
6. `pnpm db:seed` 在金仓重灌成功（catalog 家族表已不存在于快照清单）。

## 7. 遗留决策记录（我的裁量，用户可否决）

- 供应商门户商城区块随线全删（4.3）——理由：数据源消失，留壳即反目标。
- 水叮当 mall.tool 整删——理由：工具语义就是「电子商城统计」，无数据即死。
- 数据库表直接 drop、不做归档导出——理由：`pnpm db:backup` 先行已留快照；如需 JSON 归档可加一步（成本极低，执行时问一句）。

## 8. 用户裁定记录（2026-10-28，builder check 五问已全部裁定）

1. **预算参考功能**：整删（endpoint + estimator + 向导 UI），不做 Tier-3 降级。
2. **品类孤儿列**：删（Prequalification + framework 两列及引用逻辑）。
3. **连带修剪**：确认——水叮当首页商城卡、AI 报告商城节、供应商画像供货申请/合同报价事件、待办中心 catalog lane 的消失均在预期内。
4. **部署会话 Dockerfile**：待金仓部署会话提交后，由本工作顺手改掉两处 `COPY apps/mall`。
5. **JSON 归档**：不需要，drop 前仅 `pnpm db:backup`。
