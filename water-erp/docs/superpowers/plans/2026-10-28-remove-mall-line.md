# 采购商城整线下线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将自建采购商城整线（前端门户、管理端、后端模块、数据库、角色、种子、CI、文档）零残留删除，仅保留信息门户 :3002 首页的有赞（微信小程序）跳转卡。

**Architecture:** 纯删除工程，按「编译绿保持」排序：先删无依赖的前端线 → 修剪 API 活代码消费面 → 删 API 模块 → 删各门户 UI → 最后 Prisma schema+迁移（金仓主栈）+ 种子 → e2e/CI/文档收尾。每次提交后 `tsc --noEmit` 可过。

**Tech Stack:** pnpm monorepo（NestJS 11 + Prisma / Next.js 16 门户）；主数据库金仓（Kingbase，:54321，经 `scripts/db-migrate-kingbase.sh` 链路）。

**Spec:** `docs/superpowers/specs/2026-10-28-remove-mall-portal-design.md`（含五项用户裁定，路径清单以 spec §4 为准，本计划不重复罗列、只标注执行动作）

## Global Constraints

- **执行闸门**：动手前 `git status --short` 必须干净（金仓部署会话的 Dockerfile/backend/docker-compose.frontend.yml/db-migrate-kingbase.sh 已提交）；不干净则停并告知用户。
- **保留铁律**：`apps/public-portal/src/app/home-client.tsx:236` 有赞卡逐字不动；:3002 `lib/announcements.ts` 文案不动；陈源远 bid_host 账号不动；其余门户业务不动（§4.8 连带修剪清单除外，已裁定）。
- **误删防护**：只删 `Catalog*|BudgetList|BudgetItem|PriceHistory|PriceAlert|ContractPrice|SupplierCatalogApplication` 的真实 import/调用链；procurement/announcement 里 "budget/预算金额" 是 prose，禁止按字符串匹配删。
- **prisma 铁律**：改 schema 后先 `npx prisma validate` 再 `generate`；迁移走 `migrate dev --create-only` → 手工审 SQL → `db execute`/`deploy` → `migrate resolve --applied`；禁止 migrate diff 触碰 OperationLog 分区表 DDL；schema 改动与迁移必须同一提交。
- **包构建铁律**：改 `packages/config` 或 `packages/client` 的 src 后必须 `pnpm --filter @water-erp/config build` / `pnpm --filter @water-erp/client build`（均 dist 消费）。
- **git 规则**：只用 `git add <明确路径>`，禁 `-A`/`.`；提交前后各跑一次 `git status --short` 核对（并行会话竞态）；本仓习惯直接提交 main；**不 push**（用户明示才推）。
- 所有提交信息末尾加：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 验证通道：API 用 `pnpm --filter api exec tsc --noEmit` + `pnpm --filter api test`（main 上 lint 不可用）；门户 tsc 用各自 package name（`cat apps/<app>/package.json` 查 `name`）。

## Review Focus

1. **陈源远 bid_host 登录链**（:3006 分流→:3007）在 mall 角色删除后必须不受影响 → Task 8 auth e2e 换主体后全绿 + Task 9 手工冒烟。
2. **Role enum 值删除的 DDL 兼容**（PG 不支持直接 DROP VALUE，Prisma 走类型重建；金仓未验证过）→ Task 7 金仓重放验证，失败走在案回退（保留 enum 值）。
3. **prose「budget/预算」误删**会砍伤采购金额逻辑 → Task 4 白名单 grep 步骤 + tsc 双保险。
4. **零残留承诺**：`token_mall`/`dev:mall`/`apps/mall`/`CatalogItem` 全库 grep → Task 2、Task 9 的 grep 清单步骤。
5. **seed 破坏性重灌**在模型删除后必须成功（CI 供应商编号序列对齐不受 catalog 移除影响）→ Task 7 `pnpm db:seed` + Task 8 CI 段核查。

---

### Task 1: 预检、备份与基线

**Files:** 无代码改动；提交 spec 与本计划文档。

**Interfaces:** Produces: 干净基线 commit + 双库备份文件（后续任务的回退点）。

- [ ] **Step 1: 闸门检查** — Run: `git status --short`。预期：空，或仅 `docs/superpowers/` 下本工作两个文档。若见 Dockerfile/backend/docker-compose.frontend.yml/db-migrate-kingbase.sh 等部署会话文件 → **停止**，报告用户等待对方提交。
- [ ] **Step 2: 提交文档基线** — `git add docs/superpowers/specs/2026-10-28-remove-mall-portal-design.md docs/superpowers/plans/2026-10-28-remove-mall-line.md && git commit`，信息 `docs(mall-removal): 采购商城整线下线设计与执行计划（含五项裁定）`。
- [ ] **Step 3: 双库备份** — Run: `pnpm db:backup`（PG 容器惯例路径，输出 `backups/`）；金仓备份复用 `scripts/db-migrate-kingbase.sh` 内已验证的连接参数（127.0.0.1:54321）执行 sys_dump 到 `backups/kingbase-pre-mall-removal-$(date +%Y%m%d).dump`。验证：两文件存在且 size > 0。
- [ ] **Step 4: 记录基线** — `git rev-parse --short HEAD` 记入执行报告。

### Task 2: 前端线删除（apps/mall + 根脚本 + 共享配置 + client 注释）

**Files:**
- Delete: `apps/mall/`
- Modify: `package.json`（dev concurrently 链、`dev:mall`、`build:mall` 及 lint/start 若引用——**以磁盘当前内容为准**，ukey guard 已被部署会话移除）
- Modify: `packages/config/src/ports.ts`、`packages/config/src/urls.ts`、`packages/config/src/domains.ts`（仅注释）
- Modify: `packages/client/src/index.ts`（doc 注释中 mall/CatalogItem 示例）
- Modify: `apps/mobile-portal/src/lib/api/auth.ts:9`（AuthRole union 去 `'mall'`——spec §3 更正项，随本任务清）

**Interfaces:** Produces: 9 门户工作区；`PORTALS`/ports 类型不再含 mall 键。

- [ ] **Step 1: 删应用** — `git rm -r apps/mall`。
- [ ] **Step 2: 根 package.json** — dev 链去掉 mall 项（名称列与命令列同去）、删 `dev:mall`/`build:mall`；grep `mall` 确认本文件零残留。
- [ ] **Step 3: config 三件** — ports.ts 删 `mall: 3003` 行；urls.ts 删 mall 的 role→portal 映射与 `'mall'` portal 键、更新相关注释；domains.ts 改注释（mall 不再是「无子域回退」名单成员）。
- [ ] **Step 4: 重建 config 与 client** — client/src/index.ts 注释示例换成其他门户；然后 `pnpm --filter @water-erp/config build && pnpm --filter @water-erp/client build`。
- [ ] **Step 5: 引用核零** — Run: `grep -rn "portalURL('mall')\|filter mall\|dev:mall\|apps/mall" apps packages package.json scripts --include="*.ts" --include="*.tsx" --include="*.json" --include="*.sh" | grep -v node_modules`。预期：零输出。另 `pnpm --filter <mobile包名> exec tsc --noEmit` 验证 AuthRole 改动绿。
- [ ] **Step 6: Commit** — `git add package.json packages/config packages/client apps/mobile-portal`（含 build 后 dist 变更若有跟踪；dist 不入库则仅 src）→ `chore(mall-removal): 删除采购商城前端门户与共享配置引用（10→9 门户）`。

### Task 3: API 消费面修剪（模块暂留，保编译绿）

**Files:**（定位用 grep，删除/修改以实际行号为准）
- Delete: `apps/api/src/assistant/tools/mall.tool.ts`
- Modify: `assistant/assistant.service.ts`（工具注册 + `:711` quick-stats catalogItem 计数）、`assistant.service.spec.ts`（对应用例）
- Modify: `apps/assistant/src/components/assistant-home.tsx`（水叮当首页商城统计卡）
- Modify: `ai/ai.service.ts`（AI 工作台报告商城目录/供货审批节，~1541–1791）
- Modify: `supplier/supplier.service.ts`（`:3611+` 画像/时间线供货申请+合同报价事件）、`ai/supplier-portrait-analysis.service.ts`
- Modify: `workflow/workflow.service.ts`（待办中心 catalog_application lane）
- Modify: `packages/shared/src/notification-registry.ts`（catalog 域通知类型）+ `pnpm --filter @water-erp/shared build`
- Modify: `auth/port-routes.ts`（catalog/budget 路由映射）、`auth/portal-cookie.ts`（token_mall）、`auth/auth.service.ts`（mall 角色解析分支/优先级表）
- Modify: `framework/framework.service.ts`（catalogCategoryId 参数与落库）、`project-management`…见 prequal：`prequal.service.ts:105`（同品类自动通过逻辑）
- Modify: `supplier-portal/supplier-portal.controller.ts` / `supplier-portal.service.ts` / 删 `dto/catalog-application.dto.ts`（商城入驻端点）

**Interfaces:** Consumes: catalog/budget 模块仍存在但不再被活代码 import（Task 4 才物理删除）。Produces: 活代码零 catalog/budget import。

- [ ] **Step 1: 建 import 白名单基线** — Run: `grep -rln "from '.*catalog\|from '.*budget" apps/api/src --include="*.ts" | grep -v "src/catalog/\|src/budget/" > /tmp/mall-consumers.txt`。此清单即本任务改动范围。
- [ ] **Step 2: 逐文件修剪** — 按上方 Files 顺序执行；ai.service/supplier.service 中只删商城数据段，**budget 字样的「预算金额」逻辑保留**（删前看上下文确认是 BudgetList/BudgetItem/Catalog* 引用才动手）。
- [ ] **Step 3: 编译+单测** — Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter api test`。预期：绿（catalog 模块自身的 spec 随模块在 Task 4 删，此处若有引用其 fixture 的用例一并修剪）。
- [ ] **Step 4: :3008 编译** — Run: `pnpm --filter assistant exec tsc --noEmit`（门户名以 package.json 为准）。
- [ ] **Step 5: Commit** — 明确路径 add → `refactor(api+assistant): 修剪商城数据消费面——水叮当工具/统计卡、AI报告节、供应商画像、待办lane、通知域、auth路由（模块下任务物理删除）`。

### Task 4: API 模块与预算参考物理删除

**Files:**
- Delete: `apps/api/src/catalog/`、`apps/api/src/budget/`
- Delete: `apps/api/src/project-management/budget-reference-estimator.ts`、`dto/analyze-budget-reference.dto.ts`
- Modify: `app.module.ts`（CatalogModule/BudgetModule import+注册）、`project-management.controller.ts`（`:133` POST /analyze-budget-reference）
- Modify: procurement 侧 `ProcurementProject.budgetList` 引用代码（schema 列在 Task 7 删，此处只删代码）

**Interfaces:** Produces: API 编译绿且不含 catalog/budget 模块；`/api/catalog*`、`/api/budget*`、`analyze-budget-reference` 端点消失。

- [ ] **Step 1: 删模块与预算参考** — `git rm -r apps/api/src/catalog apps/api/src/budget` + 预算参考三处。
- [ ] **Step 2: 清注册与端点** — app.module.ts 两 import+两数组项；controller 端点及其 DTO import。
- [ ] **Step 3: procurement budgetList 引用** — Run: `grep -rn "budgetList" apps/api/src --include="*.ts"`，逐个核上下文：`ProcurementProject.budgetList` 关系引用删；预算金额 prose 留。清零后进入下一步。
- [ ] **Step 4: 编译+单测+boot 冒烟** — `pnpm --filter api exec tsc --noEmit && pnpm --filter api test`；快速启动验证（:4001 起，`curl -s localhost:4001/api/docs -o /dev/null -w "%{http_code}"` = 200，杀进程）。
- [ ] **Step 5: Commit** — `chore(api): 物理删除 catalog/budget 模块与预算参考功能（裁定1：整删不降级）`。

### Task 5: :3005 web 清理

**Files:**
- Delete: `apps/web/src/app/(main)/mall-management/`（十区块）、`lib/api/catalog-admin.ts`
- Delete（先核引用再删）: `lib/hooks/use-category-tree.ts`、`lib/attribute-template-utils.ts`
- Modify: 侧栏 nav 配置（grep「电子商城管理」定位）、`lib/login/login-routing.ts` mall 分支
- Modify: `components/projects/create-project-dialog.tsx`（预算参考面板）、`lib/api/project-management.ts`（analyze 封装）

**Interfaces:** Produces: web 编译绿、导航无商城项、创建项目向导无预算参考面板。

- [ ] **Step 1: 定位与删除** — grep「电子商城管理/mall-management/catalog-admin」在 web 内的全部引用点，删目录与文件；use-category-tree/attribute-template-utils 先 `grep -rn` 确认仅 mall-management 消费再删。
- [ ] **Step 2: 向导面板** — create-project-dialog.tsx 删预算参考结果/依据面板与相关 state；project-management.ts 删 analyze 调用。
- [ ] **Step 3: 编译** — Run: `pnpm --filter web exec tsc --noEmit`。预期：绿。
- [ ] **Step 4: Commit** — `chore(web): 删除电子商城管理十区块与预算参考面板`。

### Task 6: :3004 供应商门户商城区块

**Files:**
- Delete: `src/app/(main)/catalog-applications/`、`src/app/(main)/catalog/`、`lib/api/catalog.ts`、`components/catalog/`、`styles/pages/catalog.css`
- Modify: `src/app/(main)/supply/page.tsx`（商城相关区块）、`components/shell/supplier-menu.ts`、`lib/__tests__/supplier-navigation.test.ts`

**Interfaces:** Produces: 供应商门户导航无商城项、nav 测试绿。

- [ ] **Step 1: 删页面与库** — 按 Files 执行；`grep -rn "catalog" apps/supplier-portal-next/src` 核零（styles/shared.css 里若有 catalog 类定义一并清）。
- [ ] **Step 2: 菜单与测试** — supplier-menu.ts 删项；nav 测试删对应用例。
- [ ] **Step 3: 编译+测试** — Run: `pnpm --filter <supplier包名> exec tsc --noEmit && pnpm --filter <supplier包名> test`。预期：绿。
- [ ] **Step 4: Commit** — `chore(supplier): 删除商城入驻/供货目录区块（数据源已下线）`。

### Task 7: Prisma schema、迁移（金仓主栈）与种子

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（删模型家族+外部关系列+Prequalification/framework 品类列+Role enum `mall`）
- Create: 迁移 `apps/api/prisma/migrations/<ts>_remove_mall_line/migration.sql`
- Delete: `apps/api/prisma/seed-data/` 中 catalog/budget 家族 JSON
- Modify: `apps/api/prisma/seed.ts`（对应加载段）、`seed-data/User.json`（陈源远 mall 行）

**Interfaces:** Produces: 金仓库无商城表/列/enum 值/mall 用户；Prisma client 与 schema 一致；seed 可重灌。

- [ ] **Step 1: UserFavorite 归属核查** — `grep -rn "userFavorite\|UserFavorite" apps/api/src --include="*.ts"`：若仅商城收藏消费 → 并入删除家族；若公告/其他收藏也用 → 保留（在执行报告注明裁定依据）。
- [ ] **Step 2: schema 编辑** — 删 spec §4.5 全部模型与关系字段（User.budgetLists、Supplier.catalogSupplies、ProcurementProject.budgetList、Company.attributeTemplates/catalogItems/alertRules）、`Prequalification.catalogCategoryId`（:1247）与 framework 品类列（裁定2）、Role enum `mall` 值。Run: `cd apps/api && npx prisma validate`——不过则修到过。
- [ ] **Step 3: 生成迁移并手工审** — `npx prisma migrate dev --create-only --name remove_mall_line`。审 migration.sql：①drop 全部家族表 ②ProcurementProject/Prequalification/framework 的列 drop ③`DELETE FROM "User" WHERE role='mall'` 及其依赖行（先删该用户 Notification 等子行）④catalog 域 Notification 清行（`type IN ('CATALOG_APPLICATION','PRICE_REVIEW')`，发给 staff 的）⑤Role enum：Prisma 会生成类型重建 DDL——**金仓兼容未验证**，重放失败则回退：保留 enum 值（schema 与 DB 同步保留）+ CLAUDE.md 注记「enum 值遗留、零代码引用」。⑥确认未触碰 OperationLog 分区 DDL。
- [ ] **Step 4: 金仓执行** — 主栈执行迁移（`npx prisma migrate deploy` 走金仓 DATABASE_URL；或复用 `scripts/db-migrate-kingbase.sh` 链路）。**坑：Prisma CLI 读 `apps/api/.env` 会覆盖 shell 传参的 DATABASE_URL——执行前确认 .env 本体指向金仓（跑完按需还原）；`migrate status` 验证用负对照防假阳性**（2026-10-28 实录）。然后 `npx prisma migrate resolve --applied <name>` + `npx prisma generate`。验证：`migrate status` 干净。
- [ ] **Step 5: 种子同步** — 删家族 JSON 与 seed.ts 段、User.json 删 mall 行；Run: `pnpm db:seed`（金仓）。预期：成功完成，报告供应商编号序列对齐无异常。
- [ ] **Step 6: 编译+单测** — `pnpm --filter api exec tsc --noEmit && pnpm --filter api test`（Role 类型无 'mall' 后无字面量残留）。
- [ ] **Step 7: Commit** — schema+迁移+seed 同一提交：`feat(db): 删除商城模型家族与 mall 角色——金仓迁移 remove_mall_line（drop 前已双库备份）`。

### Task 8: e2e 与 CI

**Files:**
- Delete: `apps/api/test/catalog.e2e-spec.ts`
- Modify: `apps/api/test/auth.e2e-spec.ts`（单设备用例若以陈源远 mall 为主体 → 换 `Swhi-CGZX-05` 或自建用户）、开标大厅 e2e 的 WS 拒绝用例（陈源远 mall 登录 → 换 bid_host 主体如 `陈源远`（bid_host 本体）或 admin）
- Modify: `/home/asus/桌面/ERP/.github/workflows/ci.yml`（:72 `pnpm --filter mall exec tsc` 闸、:277 supplier-403-vs-`/catalog/admin/items` 抽查——**根仓库文件，water-erp 之外**）

**Interfaces:** Produces: e2e 全套（除已删 catalog）绿；CI 无 mall 段。

- [ ] **Step 1: 换主体与删除** — 按 Files 执行；e2e 内 `grep -rn "mall\|catalog" apps/api/test` 核零业务引用。
- [ ] **Step 2: 本地跑受影响套件** — Run: `pnpm --filter api test:e2e -- auth`（限定受影响 spec）。预期：绿。
- [ ] **Step 3: 根 CI** — 删两处；通读 ci.yml 确认无其他 mall/catalog 段（含 seed 步骤对 catalog 快照的隐式依赖）。
- [ ] **Step 4: Commit** — `test+ci: catalog e2e 套件删除、e2e 主体换账号、根 CI mall 段移除`。

### Task 9: 文档、Dockerfile 与全链验证

**Files:**
- Modify: `CLAUDE.md`（门户表、端口清单、角色路由表、cookie 表、「采购商城」节、dev 命令、e2e 清单、种子表、10→9 表述、LLM 收口残留注记中 mall 项删除）、`ACCOUNTS.md`、`.impeccable.md`（若有 mall 提及）
- Modify: `Dockerfile:56`、`backend/Dockerfile.api:38`（`COPY apps/mall` 行——**前置：这些文件已被部署会话提交**；若仍 untracked 则跳过并在报告注明）

**Interfaces:** Produces: 文档与实际一致；docker build 不因缺 apps/mall 断。

- [ ] **Step 1: 文档更新** — 按 Files 清单逐项改；`grep -n "mall\|商城\|3003" CLAUDE.md ACCOUNTS.md` 复核（有赞/公告文案类「电子商城」字样保留）。
- [ ] **Step 2: Dockerfile** — 前置满足则删两处 `COPY apps/mall` 行并核对 build 上下文无其他 mall 路径。
- [ ] **Step 3: 全链验证** — `pnpm dev:kill && pnpm dev`；验证端口 4001/3002/3004/3005/3006/3007/3008/3010/3011 全监听 + `curl -s localhost:4001/api/docs -o /dev/null -w "%{http_code}"`=200。
- [ ] **Step 4: 有赞卡比对** — 浏览器开 `localhost:3002`，确认「电子商城」卡 href 仍为 `https://j.youzan.com/-khlqe?shopAutoEnter=1&kdt_id=157422811`（逐字）。
- [ ] **Step 5: 零残留终检** — Run: `grep -rn "apps/mall\|token_mall\|dev:mall\|CatalogItem\|BudgetList\|mall-management" apps packages scripts package.json CLAUDE.md ACCOUNTS.md 2>/dev/null | grep -v node_modules | grep -v "docs/superpowers\|docs/plans"`。预期：零输出。
- [ ] **Step 6: e2e 全套** — Run: `pnpm --filter api test:e2e`。预期：除已删 catalog 外全绿。
- [ ] **Step 7: Commit + 收尾报告** — `docs(mall-removal): 文档同步+Dockerfile 修复+全链验证收官`；报告含：基线 commit、备份文件路径、金仓迁移名、grep 终检输出、未推送提醒（**不主动 push**）。
