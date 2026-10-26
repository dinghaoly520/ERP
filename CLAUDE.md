# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**智慧水发·蜀水云采 ERP 系统** — a Chinese-language procurement and bidding ERP system for Sichuan Water Development Group（四川省水利发展集团有限公司）. It covers bid/project lifecycle, supplier lifecycle, expert evaluation/scoring, AI-assisted review, announcements/notifications, file uploads, and a public procurement mall.

The active codebase is the pnpm workspace in `water-erp/`.

> `AGENTS.md` is stale — it documents an old port layout and is missing `bid-portal`/`mall`. This `CLAUDE.md` is the source of truth. `water-erp/ACCOUNTS.md` lists seed accounts grouped by portal. `water-erp/.impeccable.md` defines the design system.

## Monorepo Structure

Run workspace commands from `water-erp/`.

### Portal Map

| App | Directory | Tech | Port | Description |
|-----|-----------|------|------|-------------|
| **API** | `apps/api` | NestJS 11 + Prisma | 4001 | REST API backend; Swagger at `/api/docs` |
| **信息门户** | `apps/public-portal` | Next.js 16 App Router | 3002 | Public landing page, announcements, policies, login entry for all roles |
| **采购商城** | `apps/mall` | Next.js 16 App Router | 3003 | E-commerce procurement mall — catalog browsing, procurement, favorites |
| **供应商门户** | `apps/supplier-portal-next` | Next.js 16 App Router | 3004 | Supplier self-service — registration 2.0（六部分向导）, bidding（dual-v2 双信封）, U盾管理, qualifications, profile |
| **采购管理工作台** | `apps/web` | Next.js 16 App Router | 3005 | Admin/internal staff — announcements, supplier management, expert admin, mall management |
| **专家门户** | `apps/expert-portal` | Next.js 16 App Router | 3006 | Bid expert workstation — project review, identity verification, scoring, reports |
| **开评标管理端** | `apps/bid-portal` | Next.js 16 App Router | 3007 | **开标+评标全过程执行终端（现场）**：开标任务板 + 开标大厅（组建会话/解密/唱标/异议/监督视图）+ 评标管理（启动评标/评分矩阵/生成结果/异议裁决/澄清答疑）+ 评标签字包（打印·手写签字·回传登记）+ 评标回流包。评标前准备与评标后归档归 :3005 |
| **水叮当助手** | `apps/assistant` | Next.js 16 App Router | 3008 | AI assistant chatbot — public, no login required |
| **大屏** | `apps/bigscreen` | Next.js 16 | 3010 | Data-viz big-screen dashboard. Started by `pnpm dev` (one of 9 apps); can also run standalone via `pnpm dev:bigscreen`. Port is hardcoded (not in `packages/config/ports.ts`). |
| **移动驾驶舱** | `apps/mobile-portal` | Next.js 16 App Router | 3011 | :3005 驾驶舱三页（数据库/台账/进展）的**手机端只读门户**（2026-10-13）。cgzxui 视觉体系、底部 Tab 导航、Modal 下钻改底部弹层；专用演示账号 `admin`/`admin123`（role=admin，全部公司视角）；会话复用 `token_web` 命名空间（`X-Portal: web` + `X-Web-Token`，后端零代码改动）；不在 `urls.ts` 角色路由表内，直接访问 `http://<host>:3011`。spec：`docs/superpowers/specs/2026-10-13-mobile-portal-3011-design.md` 2026-10-22 创新版：今日要报(AI)/指标环比箭头/Tab 角标/水叮当第四 Tab(复用 assistant 大脑·工具公司口径收口+cockpit 工具)/一键转发/未来14天关键节点/公司龙虎榜——spec docs/superpowers/specs/2026-10-22-mobile-3011-leader-cockpit-innovation-design.md |

### Shared Packages

| Package | Purpose |
|---------|---------|
| `packages/config` | Port definitions (`ports.ts`) and role→portal routing (`urls.ts`) — `@water-erp/config` |
| `packages/shared` | Domain types, status labels/maps, stage colors, brand constants — `@water-erp/shared`（纯类型/常量，勿放 DOM/浏览器代码） |
| `packages/ukey` | 供应商 CA U盾适配层（SM2/SM4/SM3 封装、`MockUKeyAdapter`、`DualEnvelope`/`SealedFields` 类型与 `canonicalEnvelopeHash`）——双信封投标加密与开标解密前后端共用，浏览器与 Node 同源可跑 — `@water-erp/ukey` |
| `packages/client` | 前端 API 客户端（`createApiClient`/`api`/`ApiError`——按 portal 的鉴权头与错误归一，五门户 `lib/api/*` 底座）——**dist 消费且 dist 不入库**：改 src 后必须 `--filter @water-erp/client build`（CI validate 构建链已含） — `@water-erp/client` |

> **无共享组件包**：旧文曾记载 `packages/ui`（`@water-erp/ui`），2026-10-16 核实不存在、全库零引用（`packages/` 下仅 client/config/shared/ukey 四包）——workbench 组件与门户工具在各门户 `src/components`/`src/lib` 本地维护。

Infrastructure in `water-erp/docker-compose.yml`: PostgreSQL 16 (`localhost:5432`), Redis 7 (`localhost:6380→6379`), MinIO (`localhost:9000`, console `localhost:9001`).

**Auxiliary service:** `water-erp/services/ocr/` is a standalone Python (FastAPI + uvicorn) OCR microservice on `localhost:8100`. Its `start.sh` auto-provisions a `.venv` from `requirements.txt` on first run. Start with `pnpm dev:ocr`. The API consumes it via the `local-ai` module's `OcrService`.

## Portal Descriptions

### 信息门户 (`public-portal`, :3002)

The public-facing landing page. Features a hero banner with water-themed imagery, announcement carousel (bid notices, winner announcements, policies, platform news), and login/register modals. After login, redirects users to their role-specific portal via `portalURL()`. Also provides entry cards for all other portals.

**Access:** Open to public. No login required for browsing.  
**Login:** Uses `X-Portal: public` header.  
**Target audience:** All users — login entry point for the entire system.

### 采购商城 (`mall`, :3003)

The e-commerce procurement platform for browsing and purchasing from the centralized procurement catalog. Supports catalog item search, favorites, application submission, and price management.

**Access:** Requires login as `mall` role.  
**Login cookie:** `token_mall`.  
**Target audience:** Mall procurement staff.

### 供应商门户 (`supplier-portal-next`, :3004)

**Migration note (2026-08-25):** fully rewritten from Vue 3 to Next.js 16 + React 19 + Tailwind v4 (same stack as all other portals); the old `apps/supplier-portal` Vue directory has been deleted.

Self-service portal for suppliers. Supports registration (with enterprise info + qualification uploads), browsing bid opportunities, submitting encrypted bids, viewing bid progress, managing company profile/contacts/qualifications, and requesting change approvals.

**Tech:** Next.js 16 App Router + React 19 + Tailwind v4（视图类名沿用迁移时的 sp-*/reg-* 体系，样式在 globals.css + `src/styles/pages/*.css` 分组）。**登录用户名 = 统一社会信用代码（机构代码）**——注册/临时注册/Excel 导入三处后端强制，`organizationCode` 仅作冗余同步存储。  
**Access:** Requires login as `supplier` role.  
**Login cookie:** `token_supplier`.  
**Target audience:** Registered suppliers and new suppliers registering.

### 采购管理工作台 (`web`, :3005)

The admin/internal staff management console for procurement users (login roles `staff`/`leader`; the legacy `procurement_staff` ghost account was removed 2026-08-20). **公司级数据隔离（2026-08-20）**：数据库/台账/进度/公告管理端按登录人公司隔离（真隔离=where 注入+:id 越权 403+统计在隔离集上算）；admin 四页有公司选择器（默认全部、?companyId= 切换、非 admin 传参忽略）；项目管理页读写分级（2026-10-10 用户裁定）：staff 管理本人项目；leader 见本公司全部项目、admin 见全部公司项目，但二者对他人项目**只读**（`PmiOwnershipGuard`：读=创建人+本公司 leader+admin、写=仅创建人 403 `PMI_READ_ONLY`，`/analyze` 等只读分析 POST 白名单放行；前端详情面板 `actionsDisabled` 同口径）；`/archive` 归档页仍为个人隔离（非 admin 仅本人，`archive.controller.ts`）。归属写时快照（companyId+companyName），Company 主数据表（`companies`，注册 normalizeCompany 对齐建档）。**专家库已隔离（2026-09-24）**：expert-admin 全端点（列表/详情/写操作/统计/排名/负荷/退库/违规/导出/抽取候选池）接入 CompanyScopeService，专家归属落 `User.companyId`（录入/CSV/种子导入自操作人快照；存量 29 名回填 co-swhi-sjy，seed 重建段同步兜底 `scripts/backfill-expert-company.ts` 同口径）；admin 专家库页有公司选择器（全部公司=CompanySectionHeader 分组+company-counts 全量计数）。供应商库/目录不隔离；公告 public 接口不受限。关键模块:

- **首页驾驶舱** (`/dashboard`) — operational dashboard with AI panel (水叮当 summary)
- **信息发布中心** (`/notice`) — manage announcements (CRUD + publish)
- **供应商管理中心** (`/supplier`) — supplier approval, repository, selection, evaluation
- **专家管理中心** (`/expert`) — expert entry, repository, extraction, performance evaluation
- **电子商城管理** (`/mall-management`) — price approval/entry, catalog management, sync & operation logs
- **AI 投标分析** — per-item LLM 投标分析：前端入口已随分工 v3 迁至 :3007 评标管理 tab（「AI 辅助评标进度」卡片：rerun-ai-analysis / retry-ai-bidders / ai-analysis-progress）；:3005 旧版 job 式页面（`/bid-analysis` 等）为死代码已删除（2026-08-14）。分析任务由 **separate worker process** 执行（见 Architecture → AI Bid Analysis Worker），不开 worker 不出队
- **招投标文档** (`/tender-write` · `/tender-review`) — tender-document authoring + AI review
- **项目 / 进度 / 工作安排** (`/procurements` · `/projects` · `/progress` · `/work-arrangements`) — procurement-project lifecycle, milestones, work assignments
- **开评标指挥**（项目详情「开标确认」面板）— 评标前准备与评标后收尾：供应商投标状态/专家确认/评分标准编制/监督时间线/开标进度/归档（完整归档闸门=签字闭环+回流已接收）；评标过程操作在 :3007（分工 v3，见 spec）

**Access:** Log in with a `staff`/`leader` account (e.g. `Swhi-CGZX-01` leader / `Swhi-CGZX-05` staff, password `<用户名>@2026`). 登录后落地页由 `UserSettings.defaultHomePage` 决定（种子用户多为 `/work-arrangements`；未设置时按 `urls.ts` 兜底 `/dashboard`）。 `陈源远` resolves to `bid_host` here per `PORTAL_ROLE_PRIORITY.web` — it is NOT the procurement login.  
**Login cookie:** `token_web`.  
**Target audience:** Procurement administrators.

### 专家门户 (`expert-portal`, :3006)

The bid expert evaluation workstation. Core workflow (5-step wizard):

1. **身份核验** — identity verification and avoidance confirmation
2. **标书获取** — encrypted bid document retrieval and decryption
3. **辅助评标** — AI-assisted review with risk scoring and compliance analysis
4. **专家打分** — independent scoring across 5 categories (qualification, responsive, business, technical, price)
5. **评审报告** — final report generation and confirmation

Also includes a dashboard (project list + statistics) and profile management (expert info editing, review records).

**平板形态·只认显式声明（2026-10-19，`e732eb56`）**：平板是独立路由组 `(tablet)`（`/tablet` 工作台 + `/tablet/evaluate/[id]` 触屏打分页——平板只存草稿、正式提交在桌面端）。形态判定只认两条显式信号：`device_mode` cookie（登录页署名下方「平板设备入口」链接、或 `?device=tablet|desktop` 手动切换，proxy 写 7 天 cookie）与 `X-Forwarded-Device` 反代头（生产按无线子网注入）。**UA/触摸自动检测已删**（旧 `lib/device.ts`：maxTouchPoints>1 误判触摸屏笔记本、UA 含 CrOS 误判 Chromebook，7 天 cookie 把台式机锁进平板模式且无法提交评分）——勿再引入 UA 猜测。发现平板的主动机制 = 桌面评审页扫码工位迁移（`/tablet/claim` 公开页：90s 单次票据 + 登录密码重证 + 留档照，会话轮换到平板、桌面会话失效）。坑：proxy 的 `?device=` 处理块必须在鉴权闸门**之前**（匿名平板点入口须先落 cookie 再弹回 `/login?redirect=/tablet`，放闸门后匿名请求丢 device 参数）；平板 15min 空闲自动登出后重登靠 `redirect=/tablet` 直达工作台；曾被误判的存量机器用 `/?device=desktop` 一次解除。

**Access:** Requires login as `bid_expert` role.  
**Login cookie:** `token_expert`.  
**Target audience:** Expert evaluators assigned to bid projects.

### 开评标管理端 (`bid-portal`, :3007)

**开标+评标全过程执行终端**（2026-08-13 分工 v3）。总则：**:3005 与 :3007 是不同的人在不同地方的工作**——:3005 是采购中心办公室（评标前准备 + 评标后收尾），:3007 是开评标现场（主持人/admin）。:3005 确认能开标（按时开标）后项目流转给 :3007；**开标与评标过程中的事全归 :3007 管理**，直到评标结束；评标结束后 :3007 线上把开评标数据流转回 :3005（开标文件包 + 评标回流包），线下打印签字（评标签字包）。阶段流转：按时开标 :3005、启动评标 :3007、完整归档 :3005；流标：开标前 :3005、评标中（异议裁决）:3007。（评标管理/异议裁决/澄清答疑已迁至 :3007 工作区「评标管理」tab；:3005 面板已移除对应三区块。）页面：

- **开标任务板** (`/bid`) — 只读，两分区：「开标中」（解密/唱标/确认/异议四计数）/「评标中」（专家签到·投标计数，进入工作区默认评标 tab）；30s 轮询 + 回前台即时刷新、API 故障显错误横幅并保留最近数据（O5/O6，2026-08-28）；行操作进入项目工作区。归档/流标项目在「归档端」(`/bid/archive`)；截标已过未确定开标的 DOWNLOAD/SUBMIT 项目不在本端展示（原「待确定开标」分区已于 2026-07-29 删）
- **开标大厅** (`/bid/open?id=`) — 实时开标执行：组建开标会话（主持人+解密窗口必填/监督人选填，同阶段幂等写 `BidOpeningSession`）、供应商解密（单条/批量）、唱标录入、开标异议处理、会场交流（ExchangeDrawer）、**监督视图**（原监督端折叠内嵌：时间线/异常事件/批注/日志表/大厅交流只读）、开标完成后横幅【完成开标·移交】生成开标文件包（FileAsset `category=bid_opening_handover`，JSON + SHA-256 指纹，存 MinIO）并 WS 广播 `opening:completed` 回传 :3005（幂等、不改 stage、非启动评标闸门），:3005「开标进度」区块展示「资料已接收·下载」
- **项目工作区** (`/bid/project/[id]?tab=`) — 四 tab「开标大厅（嵌入大厅组件）／评标管理（**全操作**，2026-08 从 :3005 迁回：启动评标·专家进度·AI 辅助评标进度卡片·评分矩阵·排名·3 步生成评标结果向导·专家异议裁决（含评标中流标）·澄清答疑）／评分标准（只读：评分项+得分点，编制归 :3005）／评标签字（新增）」；默认 tab 随阶段（EVALUATING→评标管理，其余→开标大厅）；旧链接 `/bid/open?id=` 兼容重定向至此
- **评标签字**（工作区 tab，2026-08 新增）— 评标结果生成后可用：生成签字包 PDF（《评标报告》十项法定内容 + 签字页含「评标专家声明」与在线操作留痕 + 个人评分确认表×N + 异议工单 + 澄清纪要 + 动议决议）→ 主持人打印 → 专家现场手写签字 → 扫描回传 → 逐专家登记「已签字 / 拒绝(附书面不同意见) / 视为同意(拒绝且未陈述理由)」→ 全员闭环 → 生成评标回流包流转回 :3005。完整归档闸门 = 签字闭环 + 回流已生成。详见 `docs/superpowers/specs/2026-08-13-expert-paper-signing-design.md`

:3005 保留（不迁）：「开标确认」面板的评标前准备（供应商投标状态·催促未投递、专家确认·正选候补替换（开标后、评标启动前、未签到可换；2026-09-23 口径修订）、评分标准编制、监督时间线、开标进度·开标前流标、主持人指派·延时开标·按时开标）与评标后收尾（评标回流接收、完整归档·签字闭环闸门、公示、中标通知书）。评标管理/异议裁决/澄清答疑已迁回 :3007（:3005 面板对应三区块已移除）。主持人指派口径（2026-10-15）：候选=项目公司内 bid_host/leader/staff（active 未冻结，admin 不入候选；GET /bid/hosts?projectId= 按项目公司过滤，存量无归属回退操作人公司）；:3007 现场执行权跟随指派而非角色——原 17+6 处 @Roles('bid_host','admin') 主持端点改四内部角色+`AssignedHostGuard`（admin 或被指派本人放行，未指派的同公司 bid_host 亦 403 NOT_ASSIGNED_HOST）；staff/leader 登 :3007 须走 :3006 分流（直登 bid 门户按 portalForRole 落地 token_web）。

**Authentication flow:** `admin`/`bid_host` users authenticate from the public portal's "在线开评标系统" card → redirected to expert portal (:3006) login → non-bid_expert roles get cookie `token_bid` written (auth port-roles 分流) → post-login redirect to bid portal (:3007). The bid portal sends `X-Portal: bid` for API calls.

**Access:** Requires login as `admin`, `bid_host`, `leader`, or `staff` role (port-roles 允许集).  
**Login cookie:** `token_bid`（独立命名空间；旧文「共用 token_web」已随 auth port-roles 体系重构过时）.  
**Target audience:** Bid opening hosts, administrators, supervisors.

### 水叮当智能助手 (`assistant`, :3008)

Standalone AI chat assistant powered by DeepSeek LLM. Provides procurement domain knowledge, bid analysis Q&A, and operational guidance. Features a full-screen chat interface with fluid cursor effects and video background.

**Access:** Public — no login required. Sends `X-Portal: assistant` header.  
**Target audience:** Any user seeking AI assistance.

## Role→Portal Routing

`packages/config/src/urls.ts` maps roles to post-login destination portals:

| Role | Portal | Landing Path |
|------|--------|-------------|
| `admin` | bid (:3007) | `/bid` |
| `bid_host` | bid (:3007) | `/bid` |
| `supplier` | supplier (:3004) | `/dashboard` |
| `bid_expert` | expert (:3006) | `/` |
| `mall` | mall (:3003) | `/` |
| unknown | public (:3002) | `/` |

## Development Commands

```bash
# Install dependencies
pnpm install

# Infrastructure
pnpm infra:up        # Start PostgreSQL, Redis, MinIO
pnpm infra:down      # Stop
pnpm infra:logs      # View logs
pnpm dev:kill         # 全链清理（2026-10-16 升级）：fuser 清 11 端口 + 按 /proc cwd+cmdline 清 apps/api 残树（watch 链/孤儿 dist/ai-worker；`--api` 只清 API 不动 portals、`--list` 干跑）；叠树/半死恢复一律 `pnpm dev:kill && pnpm dev`——main.ts 有 listen 预检（端口占用即 exit 1 秒退），勿再手工起并行救援 watch 树

# Build shared packages (required before first app start)
pnpm --filter @water-erp/shared build
pnpm --filter @water-erp/config build
pnpm --filter @water-erp/ukey build
pnpm --filter @water-erp/client build   # dist 消费且不入库，漏建则门户 tsc 全线隐式 any（2026-09-14 CI 12 连红实录）

# Database
pnpm db:generate     # Generate Prisma client
pnpm db:migrate      # Run migrations
pnpm db:seed         # Seed data (idempotent + destructive — see Seed Data)
pnpm db:studio       # Open Prisma Studio

# Start all (10 portals — includes bigscreen + mobile-portal + ai-bid worker)
pnpm dev

# Start individual apps
pnpm dev:api         # :4001
pnpm dev:public      # :3002 信息门户
pnpm dev:mall        # :3003 采购商城
pnpm dev:supplier    # :3004 供应商门户
pnpm dev:web         # :3005 采购管理工作台
pnpm dev:expert      # :3006 专家门户
pnpm dev:bid         # :3007 开评标管理端
pnpm dev:assistant   # :3008 水叮当助手
pnpm dev:bigscreen   # :3010 大屏（已在 pnpm dev 内，也可单独启动）
pnpm dev:mobile      # :3011 移动驾驶舱（数据库/台账/进展 手机端只读，已在 pnpm dev 内）

# AI 投标分析 worker（独立进程 — 必需，否则 per-item 分析任务不出队执行）
pnpm --filter api dev:worker:ai-bid-analysis   # = nest build && node dist/ai-bid-analysis-worker.js（dist 镜像 src，无 dist/src 层）

# Mock U盾中间件（已于 2026-10-19 退役——systemd 已 stop+disable）
# 供应商端 SCCA 适配时已删 mock 轨；专家端自动回落浏览器软证书（MockUKeyAdapter，零进程零端口）
# 命令保留但不应再启动：
# pnpm dev:ukey-mw          # :17999（已退役）
# pnpm dev:ukey-mw-guard    # :17999（已退役，guard 会因 systemd 不在而尝试拉起——生产不应启用）

# OCR 微服务（Python，:8100）
pnpm dev:ocr

# Build
pnpm build
pnpm build:api | build:mall | build:supplier | build:web | build:expert | build:public | build:bid

# Lint
pnpm lint
pnpm --filter api lint
pnpm --filter <app> lint
```

### Node 24 + Turbopack

Next.js 16 defaults to Turbopack, and all `dev` scripts use it (no `--webpack`). An earlier Node 24 incompatibility with `lightningcss` (the Turbopack CSS backend) once forced every `dev` script onto `--webpack`; this is resolved as of `lightningcss` 1.32.0 on Node 24.16, so `--webpack` has been removed and the webpack-only `webpackMemoryOptimizations` flag dropped from `web/next.config.ts`. Do not reintroduce `--webpack`. If a Turbopack CSS regression appears, verify the native binding before falling back: `node -e "require('lightningcss').transform({filename:'a.css',code:Buffer.from('.a{color:red}')})"`.

`packages/config` and `packages/shared` compile to `dist/` — re-run their build after editing either.

### Tests

```bash
pnpm --filter api test              # All unit tests
pnpm --filter api test:watch        # Watch mode
pnpm --filter api test:cov          # Coverage
pnpm --filter api test -- <pattern> # Single spec
pnpm --filter api test:e2e          # E2E tests (uses seed data + cookie auth)
```

E2E suites (`apps/api/test/`): `auth`, `bid`, `catalog`, `supplier`, `upload` — each logs in via seeded accounts, makes authenticated requests, and verifies response contracts. Unit tests live co-located with source (`*.spec.ts` in `src/`).

> **jest + ESM-only deps (pnpm):** `jest.config.js` 与 `test/jest-e2e.json` 用两条互补的 `transformIgnorePatterns`（pnpm 的 `.pnpm/<pkg>@<ver>/node_modules/<pkg>/` 含两段 `node_modules`，单正则会回溯误判）+ ts-jest `allowJs`，转译 ESM-only 依赖（`htmlparser2` / `@paralleldrive/cuid2` / `@noble/hashes`）。**新增 ESM-only 依赖导致测试报 `Cannot use import statement` → 加进两份 allowlist。** `test:e2e` 带 `--forceExit`（Nest 留有 Redis/BullMQ handle）。

## Seed Data

`pnpm db:seed` is **idempotent and destructive** — it `TRUNCATE ... RESTART IDENTITY CASCADE` on all business tables, then reloads from JSON snapshots at `apps/api/prisma/seed-data/*.json`. Edit the JSON snapshots to change seed data; `seed.ts` just orchestrates the load.

Passwords follow `<username>@2026` convention:

| Account | Password | Role | Portal |
|---------|----------|------|--------|
| `陈源远` | `陈源远@2026` | mall | 采购商城 (:3003) |
| `重庆蜀通岩土工程有限公司` | `supplier@2026` | supplier (approved) · 原 `supplier1` | 供应商门户 (:3004) |
| `四川水发建设有限公司` | `supplier@2026` | supplier (approved) · 英雄项目 3 家之一 | 供应商门户 (:3004) |
| `中科院成都信息技术股份有限公司` | `supplier@2026` | supplier (approved) · 英雄项目评标第 1 名 | 供应商门户 (:3004) |
| `四川省通信产业服务有限公司` | `supplier@2026` | supplier (approved) · 英雄项目解密异常 | 供应商门户 (:3004) |
| `成都华西物资供应有限公司` | `supplier@2026` | supplier (approved) · 原 `huaxi` · 参与旧种子项目 | 供应商门户 (:3004) |
| `Swhi-CGZX-01` | `Swhi-CGZX-01@2026` | leader · 采购中心领导 | 采购管理工作台 (:3005) |
| `Swhi-CGZX-05` | `Swhi-CGZX-05@2026` | staff · 采购中心员工 | 采购管理工作台 (:3005) |
| `Swhi-CGZX-00` | `Swhi-CGZX-00@2026` | leader · 董事长（工作台董事长变体+受限导航，见 `apps/web/src/lib/workbench-profiles.ts`） | 采购管理工作台 (:3005) |
| `SWDG-01` | `SWDG-01@2026` | staff · 水发集团（落地 /tender-write+受限导航，见 workbench-profiles.ts） | 采购管理工作台 (:3005) |
| `Swhi-CGZX-admin` | `Swhi-CGZX-admin@2026` | admin · 密码审批等管理功能 | 采购管理工作台 (:3005) |
| 专家姓名（如 `杨睿`） | `<其身份证号，见 ExpertLibrary.json>` | bid_expert | 专家门户 (:3006) |
| `陈源远` | `陈源远@2026` | bid_host | 开评标管理端 (:3007) |

> **「陈源远」同名账号**：username 不再全局唯一（改为 `[username, role]` 复合唯一），两个 role 不同的账号共用登录名「陈源远」/ `陈源远@2026`。登录时按来源门户（`X-Portal` 头）区分：电子商城→mall、开标端（专家门户 admin tab）→bid_host。注意 `PORTAL_ROLE_PRIORITY.web` = `[leader, staff, bid_host, admin]` （原 `procurement_staff` 幽灵账户已于 2026-08-20 删除），故「陈源远」从采购管理端 :3005 登录会解析为 `bid_host`、采购功能 403——**:3005 请用 `Swhi-CGZX-*` leader/staff 账号**（口令 `<用户名>@2026`，见上表与 `water-erp/ACCOUNTS.md`）。详见 `auth.service.ts`。
详见 `auth.service.ts`。另：专家门户 (:3006) 登录页原 dev 演示账号预填/填充按钮（`DEMO_ACCOUNTS`）已于 2026-09-18 删除——登录表单初始为空，请直接用种子账号（专家 `111111111111111111`、管理员 `Swhi-CGZX-admin@2026`）。

> `admin` role 已有种子账号 `Swhi-CGZX-admin`（密码审批等管理功能；登录口令 `<用户名>@2026`）。开评标管理端 (:3007) 演示请用 `陈源远` (bid_host)。

> **评审专家库（180 名，2026-10-19 换血）**：唯一来源 `apps/api/prisma/seed-data/ExpertLibrary.json`（集团拟入库名单，8 家公司：集团本部 30/设计院 47/建设 30/投资 18/能源 5/亭子口 10/向家坝 20/引大 20——后 4 家公司主数据由 seed `SEED_COMPANIES` 建档）。`seed.ts` 公司归属重建段 1.45 清空快照旧专家后按名单整体重建：**用户名=姓名、口令=身份证号**、`entryStatus=ACTIVE`、归属公司直挂 `companyId`（分公司/下属简写单位并入母公司，原表单位入 notes）。`POST /expert-admin/import-from-seed` 同读该名单（PENDING 待审核）。旧 187 名真实库导出快照（`User.json`/`ExpertProfile.json`）不再是专家来源（会被 1.45 清空，勿再从其恢复专家）。
>
> **供应商登录**：同理，`seed.ts` 会把所有供应商用户名重置为**公司名**、口令统一为 `supplier@2026`（与上表一致）。故供应商一律用「公司名 / supplier@2026」登录，不再有 `supplier1`/`huaxi` 等短用户名。

## Architecture

### Port Definitions

`packages/config/src/ports.ts` is the **single source of truth** for all port numbers:

```
api: 4001, public: 3002, mall: 3003, supplier: 3004,
web: 3005, expert: 3006, bid: 3007, assistant: 3008
```

**生产域名双轨（2026-10-26，《子域名申请单》已处理·新终版）**：`packages/config/src/domains.ts`（`PORTAL_DOMAINS` + `inDomainFamily`）——`*.scsfjt.com` 家族 7 业务（ssyc/api-/supplier-/expert-/procurement-/bid-/mobile-ssyc）。`portalURL()`/`landingURL()` 运行时自适应：当前页经域名家族访问 → 跳转目标门户子域（无端口、协议随当前页）；端口/IP 访问（localhost、LAN/公网 IP）→ 端口互跳不变。**申请单未列业务（mall :3003 / assistant :3008 / bigscreen :3010）无子域**，域名模式下回退端口口径。后端外发链接（RSVP 回执等）`apps/api/src/common/portal-link-origin.ts` 同口径：请求 Origin/X-Forwarded-Host 判家族 + X-Forwarded-Proto 定协议（缺省 https）。生产部署 API 侧另需 env：`API_ORIGIN=https://api-ssyc.scsfjt.com`、`CORS_ORIGINS` 列全部门户子域、`TRUST_PROXY=1`；各门户 `PORTAL_*_URL` env 覆盖仍最高优先。

### Auth & Cookie Isolation

Each portal uses an independent login session via named httpOnly cookies:

| Portal | Cookie Name | X-Portal Header | Notes |
|--------|-------------|-----------------|-------|
| 采购商城 | `token_mall` | `mall` | — |
| 供应商门户 | `token_supplier` | `supplier` | — |
| 采购管理工作台 | `token_web` | `web` | — |
| 专家门户 | `token_expert` | `expert` | — |
| 开评标管理端 | `token_bid` | `bid` | 独立命名空间（:3006 登录分流写入）— admin/bid_host/leader/staff |
| 信息门户 | `token_public` | `public` | — |
| 水叮当助手 | — | `assistant` | No auth required |

**Key insight:** bid_portal (:3007) uses its own `token_bid` cookie (auth port-roles 体系：:3006 登录分流时非 bid_expert 角色写 `token_bid` 后跳 :3007；旧文档「共用 token_web」已过时). The bid portal's login redirects through the expert portal (:3006) login page, which sets `token_bid`.

The auth chain is `AuthGuard (global) → RolesGuard (global)`, registered via `APP_GUARD` in `AppModule`. `AuthGuard` extracts + verifies the JWT; `RolesGuard` checks `@Roles(...)` metadata. `@Public()` skips auth; `@AnyRole()` = any authenticated user（认证边界语义，非授权）。**RolesGuard 默认拒绝（2026-08-26）**：路由无 `@Roles`/`@AnyRole`/`@Public` 任一 → 403 `NO_ROLE_CONFIGURED`；新路由必须显式标注其一。排障：`apps/api` 下 `npx tsx scripts/list-uncovered-routes.ts [--json out.json]` 列未覆盖路由；CI e2e 内置 supplier 403 抽查闸。curl 调试须带 `X-Portal` 头（否则 portal 识别回退旧 `token` cookie → 401 而非 403，勿误判守卫）。spec：`water-erp/docs/superpowers/specs/2026-08-26-roles-guard-default-deny-design.md`

**Cookie resolution** is handled by `apps/api/src/auth/portal-cookie.ts`: portal is detected from `X-Portal` header → `Origin`/`Referer` port → falls back to legacy `token` cookie. This allows the API to serve multiple portals with independent sessions on `localhost` (where cookies are shared across ports).

**:3005 单设备登录（2026-08-21）**：同一账号同一时间只允许一台设备在线（同账号才互踢，同浏览器不同账号可并存）。机制 = `User.webSessionId` + JWT `sid` + tab 级 `X-Web-Token` 头：凡最终写 `token_web` cookie 的登录都轮换 webSessionId 并重签带 sid 的 token（`AuthService.rotateWebSession`）。**token_web cookie 同浏览器全局一份**——多标签页登录不同账号会互相覆盖，故前端登录后把 access_token 存 sessionStorage（`session-store.ts`），请求经 `@water-erp/client` 的 `extraHeaders` 带 `X-Web-Token`（`tokenFromRequest` 头优先、cookie 回退），各标签页携带自己的 token 互不覆盖。`AuthGuard` 校验 JWT 内 `sid === User.webSessionId`（依据在 token 内、不可靠省略头绕过），不符返 401 `SESSION_REPLACED`；无 sid 的旧 web token（来自 token_web cookie）统一失效重登。前端 `SessionWatchdog`（15s 心跳 `GET /auth/heartbeat`，已入操作日志排除）让空闲页 15s 内被踢；`session-kick.ts` 弹「是否向管理员反馈」双按钮（`.neu-btn-group` 等高）——点是 `POST /auth/security-feedback`（带本 tab 旧 token 确认反馈人身份）通知所有 admin（link 指向 `/admin/accounts`），再回登录页并预填账号密码（prefill，手动登出即清）。`token_bid`/`token_mall` 等其他命名空间不受影响（supplier 2026-09-18、expert 2026-09-20 已先后纳入，见下）。

**:3004 供应商门户单设备登录（2026-09-18）**：同一机制扩展到 supplier 命名空间（`rotatePortalSession`，角色↔门户互斥故与 web 共用 `User.webSessionId` 一列、零迁移）。差异：**纯 cookie，无 `X-Supplier-Token`**——同浏览器第二账号登录直接覆盖前者（用户裁定不做多账号并存）；无 sid 存量 supplier 会话同样失效重登；被踢/冻结遮罩（`session-kick.ts`）与 15s 心跳 `SessionWatchdog` 从 :3005 同款移植（反馈走 cookie 旧 token；心跳门禁用认证上下文登录态，因 cookie httpOnly JS 读不到；无 prefill）。e2e：`test/auth.e2e-spec.ts`「单设备登录」describe（自建用户不依赖 seed）。spec：`docs/superpowers/specs/2026-09-18-supplier-portal-single-session-design.md`

**:3006 专家门户单设备登录（2026-09-20）**：同一机制扩展到 expert 命名空间——专家口令=身份证号后防冒名并发登录（评标中他处登录即踢真专家，旧会话 401 `SESSION_REPLACED`）。bid_expert 角色↔门户互斥（:3006 分流写 `token_bid` 的仅限非 bid_expert，不误伤 :3007）；无 sid 存量专家会话失效重登。前端：`session-kick.ts`/`session-watchdog.tsx` 从 :3004 移植（图标井/按钮行内联——本门户无 neu-icon-well/neu-btn-group）；心跳仅挂 `(app)`/`(tablet)` 已登录布局（本门户无认证 Context）；`api.ts` on401 按 SESSION_REPLACED/ACCOUNT_FROZEN 分流遮罩，登录页自身 401 不兜底。login 路由限流 env 可调（`THROTTLE_LOGIN_LIMIT`，默认 10/min；e2e setup `test/setup-throttle.ts` 放宽）。

**账号冻结（2026-08-21）**：`User.isFrozen`（区别于 isActive=false 的未激活）。冻结账号登录返 `ACCOUNT_FROZEN`「该账号已被冻结」，存量会话被 `AuthGuard` 即时 401（`ACCOUNT_FROZEN`）。**账号管理**（:3005 系统管理 → 账号管理，admin only，路由 `/admin/accounts`，后端 `auth/account-admin.controller.ts` `@Roles('admin')` 挂 `auth/admin/accounts`）：列表/新增/删除（有关联业务数据时 409 建议冻结）/修改密码（吊销 web 会话）/修改权限(角色，防自锁)/冻结/解冻。**三合一（2026-08-21）**：账号管理页内含三 tab「账号列表 / 注册审核 / 密码审批」——侧栏原「注册审核」「密码审批」两项已删除，旧路由 `/admin/registration-review`、`/admin/password-requests` 服务端 redirect 到 `/admin/accounts`；注册待审通知 link 同步改指该页。**密码审批后端为 2026-08-21 补齐**（此前前端页面存在但后端零实现，404）：`auth/password-requests.controller.ts` + `password-requests.service.ts`——用户端 `POST /auth/password-change-requests`（登录用户改密申请，校验当前密码）、`POST /auth/password-reset-requests`（@Public 忘记密码，不泄露账号存在性）；管理端 `GET/approve/reject /auth/admin/password-{change,reset}-requests`（批准即生效并吊销 web 会话；重置批准生成一次性临时密码 `Tmp-xxxxxxxx` 仅当次响应返回）。**资料变更审批（2026-08-24）**：个人中心所有资料修改一律走审批——`ProfileChangeRequest` 模型（payload 白名单字段 displayName/email/phone/officeLocation/company/departmentId/avatar，null=清除）；用户端 `POST /auth/profile-change-requests`（服务端只保留与当前值有差异的白名单字段，重复提交自动关闭旧申请）；管理端 `GET/approve/reject /auth/admin/profile-change-requests`（批准应用字段并站内通知申请人；审批界面以 User 当前值作旧值对照）。**`PATCH /auth/me` 已收紧为 `@Roles('admin')`**（普通用户直改资料通道封死，防绕过审批）；账号管理外层第三 tab 更名「安全审批」，内层三段：修改密码申请 / 忘记密码重置 / 资料变更。

### API

The NestJS API (`apps/api`, :4001):

- Global prefix `api`, env-driven CORS (`CORS_ORIGINS`，localhost 回退), `ValidationPipe({ whitelist: true, transform: true })`
- `helmet` 安全响应头（HSTS / X-Frame-Options / X-Content-Type-Options / CSP）在 `main.ts`；Swagger `/api/docs` **仅非生产**挂载
- `trust proxy` 由 `TRUST_PROXY` 驱动（默认 `loopback`）；登录/注册限流（`@Throttle`：login 10/min、register 5/min）
- All error responses normalized to `{ statusCode, code, error, timestamp, path }` via `HttpExceptionFilter`

**Key modules (~30 feature modules + infrastructure, all under `apps/api/src/`; only the architecturally significant ones are listed — the rest are discoverable in the directory):**

| Module | Purpose |
|--------|---------|
| `Auth` | JWT login/register/logout/me; Passport strategy; RBAC guards (`AuthGuard`, `RolesGuard`) |
| `Company` | 公司主数据 + `CompanyScopeService` 数据隔离引擎（resolveScope/filter/assertInScope/stampFor；dashboard/procurements/progress/announcements/project-management 接入） |
| `Bid` | Full bid lifecycle: projects, opening sessions, records, scoring, clarifications, supervision, archive, evaluation results |
| `Expert` | Expert sign-in, avoidance check, scoring, reports; sub-controllers: `expert.controller.ts` (expert-side), `expert-admin.controller.ts` (admin CRUD/extraction/portrait/retire) |
| `Supplier` | Supplier CRUD, review, evaluations, classifications, change records |
| `SupplierPortal` | Supplier-facing endpoints (bid submissions, downloads, profile changes) |
| `Ai` | AI-assisted bid analysis, anomaly detection, risk scoring (LLM-powered + hardcoded fallback) |
| `AiBidAnalysis` | Per-item LLM bid analysis via BullMQ queues (tender + bidder processors); jobs run in the **separate worker process** (see below), not the main API |
| `LocalAi` | **Global** foundation: `LlmService` (DeepSeek / vLLM), `OcrService`, `EmbeddingService` (RAG), `LlmOutputValidator`, `VllmMonitorService` |
| `Storage` | **Global** MinIO object-storage wrapper (`StorageService`) — shared by `Upload` and `AiBidAnalysis`; distinct from the HTTP-facing `Upload` module |
| `Announcement` | Announcements CRUD, publish/archive, bid documents (encrypted, access-controlled) |
| `Notification` | In-app notifications + `NotificationDeliveryLog` (Track A: multi-channel delivery) |
| `Upload` | File upload to MinIO (50 MB cap), download, delete |
| `Procurements` | Procurement project lifecycle (active module — exports `ProcurementsService`) |
| `Procurement` | Legacy procurement module (no Prisma; prefer `Procurements` for new work) |
| `ProjectManagement` | Project management endpoints |
| `TenderWrite` / `TenderReview` / `TenderSample` / `TenderHistory` | Tender-document authoring, AI review, sample library, historical-tender search. **`TenderReview` 硬依赖基础设施**（移植自 procurement，缺一即"无法使用"）：postgres 须为 `pgvector/pgvector:pg16` + `PGVECTOR_ENABLED=true`（语义/通用审查走 pgvector RAG）；`EMBEDDING_BASE_URL` 须指本机在跑的 vLLM bge-m3 `http://localhost:8003/v1` 且 `EMBEDDING_MODEL=/home/asus/models/bge-m3`（全路径，无 `--served-model-name`）；规则提取/CRUD 走 `@Roles('leader','admin','staff')`（与 upload/execute 对齐；原 `AdminGuard` 仅 admin 在 :3005 不可用——admin 登录后被 `portalURL` 弹去 :3007，故已放宽）。详见 memory `tender-review-infra-gotchas` |
| `Knowledge` | Knowledge base / RAG corpus backing AI features |
| `Catalog` | Mall catalog items, price history, favorites, supplier applications/catalog-suppliers |
| `Budget` | Budget lists with items linked to catalog; convert to procurement project |
| `Audit` | Operation audit logs (`AuditLog` model) |
| `Assistant` | AI chatbot conversations & messages (DeepSeek LLM); action logs |
| `Scheduler` | Cron-only scheduled tasks |
| `Verification` | 注册场景短信验证码（@Public：send/verify/check-registration-code，供应商注册/管理端注册/密码重置；Redis 限流/冷却/原子消费）。专家端短信验证已删（2026-09-18，expert_sign_in 链路前端从未接线；BidExpert.phoneVerified 列暂留 schema 待人脸核验一并处理） |
| `Alerts` | Alert/notification aggregation for dashboards |
| `Redis` | Infrastructure: Redis caching via ioredis |
| `Prisma` | Infrastructure: global `PrismaService` singleton |
| `Common` | Shared: `HttpExceptionFilter` (normalized errors), guards, decorators (`@CurrentUser`, `@Public`, `@Roles`) |

> **LLM 调用已收口（2026-07）：** 所有 DeepSeek/vLLM 调用统一走 `local-ai/LlmService`（`chat`/`chatJson`/`chatMessages`）。`LLM_MAX_CONCURRENCY`（默认 10，进程内信号量）、`LLM_MAX_RETRIES`（默认 2，429/5xx/网络/超时指数退避，遵守 Retry-After≤8s）。历史曾散落于 `announcement-ai`、`ai/supplier-selection-ai`、`ai/ai.service`、`expert/expert-extraction-ai`、`assistant/deepseek.provider` 的直连 `process.env.DEEPSEEK_API_URL + fetch` 均已迁移。残留：`apps/mall` 的 AI 路由（待整合）。

### Security Hardening (API)

- **Cookie**：`auth.controller.ts` 的 `COOKIE_OPTS` 含 `secure`（仅 `NODE_ENV=production`）、`path:'/'`；登出 `clearCookie` 镜像同 opts。
- **JWT 密钥**：`common/jwt-secret.helper.ts` 的 `getJwtSecret()` 在生产缺失/<32 字符时抛错拒绝启动；`auth`/`audit`/`user-settings` 三处 `JwtModule` 共用它（这三处的 `JwtModule.register` **非死代码**——全局 `AuthGuard` 在被守卫模块作用域内解析 `JwtService`，删了启动崩溃）。
- **存储型 XSS**：公告 `content` 写时消毒（`common/html-sanitize.util.ts`，`sanitize-html`），DTO `@Transform`。
- **TS import 约定**：tsconfig 无 `esModuleInterop`（仅 `allowSyntheticDefaultImports`）。对 CJS 函数导出包（`module.exports = fn`，如 `sanitize-html`）用 `import x = require('pkg')`——默认 import 编译成 `.default`→运行时 `undefined`。
- **投标文件密钥信封加密**：`common/crypto/envelope-crypto.ts` 的 `wrapKey`/`unwrapKey` 用 `KMS_SECRET` 主密钥加密供应商投标文件的解密密钥（per-asset data key）；`supplier-portal.service.ts` 在投递/解密时封口/拆封。`KMS_SECRET` 缺失→运行时抛 `KMS_SECRET is not configured`。投标保密性核心，勿当死代码删。

### AI Bid Analysis Worker (separate process)

`AiBidAnalysis` jobs (BullMQ, backed by Redis `:6380`) are **not** processed by the main API. They run in a standalone Nest process bootstrapped from `apps/api/src/ai-bid-analysis-worker.module.ts` (`AiBidAnalysisWorkerModule`), which registers `TenderProcessor` + `BidderProcessor`. It is deliberately **not** imported by `AppModule`.

```bash
pnpm --filter api dev:worker:ai-bid-analysis   # build + run the worker
pnpm --filter api start:worker:ai-bid-analysis # run the pre-built worker
```

**2026-09-10 起 `pnpm dev` 已自带 worker**：根 `dev` 脚本并发启动 `dev:ai-worker`（sleep 20 错峰后 `nest build && node`，避免与 API 首次编译同写 dist/）。单独启动命令仍可用。

> **Operational gotcha:** worker 不带 watch——改 `ai-bid-analysis` 源码后，`pnpm dev` 里 API `--watch` 重启**不会**带动 worker，需杀掉 worker（`pkill -f ai-bid-analysis-worker`）后单独重跑上述命令（concurrently 不会自动拉起退出的命令）。Re-running analysis creates new jobs — don't rely on a stable `jobId`.

### ENV Configuration

`apps/api/.env` (the only `.env` file in the project):

```
DATABASE_URL=postgresql://water_erp:water_erp_dev@localhost:5432/water_erp
JWT_SECRET=...                     # 生产 ≥32 字符，否则拒绝启动（common/jwt-secret.helper.ts）
SMS_DEBUG_BYPASS=true              # Skip real SMS; auto-verify with code "123456"
CORS_ORIGINS=https://erp.example.com,https://supplier.example.com  # 生产真实域名；未设→仅 localhost
TRUST_PROXY=1                      # 生产反代后信任一跳；默认 'loopback'

# ── 基础设施 ──
REDIS_URL=redis://localhost:6380   # BullMQ + ioredis；API 与 ai-bid worker 都读它（缺省回退 localhost:6380）
OCR_SERVICE_URL=http://localhost:8100  # OCR 微服务（services/ocr），local-ai/OcrService 消费
KMS_SECRET=...                     # 信封加密主密钥：见下方「投标文件密钥信封加密」；生产必填，空则抛错
FIELD_ENC_SECRET=...               # 敏感字段国密加密主密钥（PII sm1: SM4-CBC+HMAC-SM3，等保+密评 2026-10；生产缺失/<32 拒绝启动；dev 回退固定钥；FIELD_ENC_SECRET_OLD 轮转旧钥）
BID_DUAL_ENVELOPE=true            # 双信封新轨总开关（=false 全局退回旧轨 KMS 信封投递；默认开，灰度/应急双向可退）
UPLOAD_SERVER_SEAL=true            # 通用上传服务端密封（2026-10-12）：qualification/profile/general/contract_document/framework_document/performance_report 类目 AES-GCM 密文落 MinIO、DEK 经 KMS 包裹挂 FileAsset.sealedKey；false=应急明文回退；存量补封/密钥轮转见 scripts/seal-existing-uploads.ts 与 docs/crypto-key-rotation-runbook.md
TRUSTED_CA_DIR=...                 # X.509 链校验信任锚目录（PEM/DER；空=跳过链闸，mock 兼容期默认空；真 CA 根证书落此即启用，apps/api/src/common/crypto/x509/）
CERT_CHAIN_ENFORCE=true            # 链闸失败语义：默认拒绝；false=告警放行（灰度）
CERT_POP_REQUIRED=false            # mock 轨（无 rawCert）PoP 强制开关；rawCert 轨恒强制
ADMIN_KEYSTORE_DIR=...            # 管理方加密证书私钥落盘目录（默认 apps/api/.data/admin-keystore；轮转后旧 adminCertId 私钥仍按 id 定位）
VECTOR_DATABASE_URL=postgresql://... # 可选：向量检索独立库（金仓/国产化形态配 sidecar：docker compose --profile vector-sidecar up -d pgvector @:5434；缺省回退 DIRECT_URL→主库；迁移走 scripts/db-migrate-kingbase.sh）

# ── AI / LLM ──
DEEPSEEK_API_URL=https://api.deepseek.com   # 多数模块直接 process.env 读取，未走 LlmService（见模块表后注释）
DEEPSEEK_API_KEY=<key>             # Required for AI assistant + bid analysis
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=...              # 可选别名，仅 local-ai/LlmService 读取；其余模块认 DEEPSEEK_API_URL

# ── 操作日志（OperationLog 拦截器，apps/api/src/operation-log）──
OPERATION_LOG_ENABLED=true          # 总开关；设 false 停用记录
OPERATION_LOG_EXCLUDE=              # 不记录的路径（逗号分隔，支持 /regex/）；务必加入高频轮询端点，否则日志膨胀
OPERATION_LOG_BODY_MAX_KB=4         # 请求体脱敏后截断阈值（KB）
OPERATION_LOG_RETENTION_DAYS=180    # 保留天数；@Cron 0 4 * * * 清理
```

> **生产启动守卫：** `NODE_ENV=production` 时，`JWT_SECRET` 缺失或 <32 字符 → 应用拒绝启动。反代后还须设 `CORS_ORIGINS`（否则前端跨域全挂）与 `TRUST_PROXY`（否则限流/审计 IP 失真）。

### WebSocket / Real-Time

The API uses `@nestjs/websockets` + Socket.IO for real-time bid opening (开标大厅). The bid portal connects via `socket.io-client` to receive live decrypt status updates and countdown timer events.

### Bid Stage State Machine

```
DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED
```

**单向棘轮（2026-07 弱化，`bid/bid-state.ts`）**：只许前进、**允许跳步**（DOWNLOAD→OPENING、OPENING→ARCHIVED 合法），同阶段幂等；回退或离开 ARCHIVED 抛 `ConflictException` (409)。阶段是**单向进度标记而非逐级许可**——实质准入闸门下沉到端点业务前置（投递 = OPENING 前 + deadline 未到 + 已发布招标公告；解密 = OPENING + 解密窗口内）。人工流转按分工 v3（2026-08-13）：按时开标 :3005「开标确认」面板、启动评标与评标中流标 :3007、完整归档 :3005（闸门=签字闭环+评标回流已生成）。:3007 在 OPENING 阶段内写开标会话并持有「完成开标·资料移交」（`POST /bid/projects/:id/complete-opening`：开标文件包（JSON + SHA-256 指纹）存 MinIO、FileAsset 挂到会话并回传 :3005，幂等、不改 stage，**不作为启动评标的前置闸门**）。水叮当助理的归档动作经用户确认后复用同一 archiveAll 路径，是面板之外唯一的流转入口。例外：删除公告会解除公告↔项目关联——DOWNLOAD/ABORTED/ARCHIVED 三态仅解关联（不重置阶段、不级联销毁开标/评标产物）；SUBMIT+ 已被 409 `BID_IN_PROGRESS` 禁令拦截（见「公告删除规则」）（`announcement.service.ts`，终审裁定 2026-08-21）。
**PMI 归档闸（2026-10-19，TP-2026101901 谈判采购001 实例）**：PMI「完成项目」（`POST /project-management/:id/complete`）与投标侧完整归档是**两扇门**——PMI 归档只写 PMI.status=ARCHIVED，曾对关联 BidProject 零检查零联动，投标侧永卡活动态（专家门户「已完结待归档」、供应商端流程条僵尸滞留，且 BidArchiveItem 证据链永不生成）。现已在 `completeProject` 加闸：关联 BidProject 处 DOWNLOAD/SUBMIT/OPENING/EVALUATING 任一活动态 → 409 `BID_IN_PROGRESS`（终态 ABORTED/ARCHIVED 放行，流标后归档不受阻）；文案引导先走「开标确认」面板 `archive-all scope=full`。同源闸=公告删除 BID_IN_PROGRESS；终止路径的下游联动流标（terminateProject 下游联动①）不受影响。存量脏数据修复=对卡住项目补调正门 archive-all（闸门满足即成功，PMI 已 ARCHIVED 不受扰动）。同闸已下渗阶段推进（同日 09d8926c）：updateStage 对尾段阶段（开标评标/定标/合同/直接采购备案表，`BID_TAIL_STAGE_KEYS`）完成前校验同轮关联 BidProject 已终局——「归档解锁定标」的正门是 archiveAll→syncPmStage（自动置本阶段 COMPLETED 并推进指针），手工 PATCH/补录不得越过。专家门户报告确认后的分组改「已完成评审」（原「已完结待归档」），副文案注明等待归档文书无需专家操作。
**收尾窗口写路径冻结口径（2026-10-19 审计，五提交 09d8926c…14c72503）**：报告确认（专家个人评审）/评标结果生成（价格）/PMI 归档（项目本体）三个冻结点之后的写路径全部上闸：
- 专家侧个人评审写端点全锁——提交评分/评分草稿（空清豁免）/核对/条款标注 → 400 `SCORE_LOCKED`，`confirmReport` 重复确认 → 409 `REPORT_ALREADY_CONFIRMED`（重盖章+重复监督日志绝迹）；动议表决/异议工单/澄清应邀答复/回避申报/组长末签/电子签名/评标室口令为法定过程与签字链动作，**保持开放勿再加锁**。
- 多轮报价双闸——`submitQuote` 补项目阶段闸（OPENING/EVALUATING，镜像 createRound）与结果冻结闸：既有 `BidEvaluationResult` → 409 `RESULTS_FROZEN`（迟到报价永不同步 syncMultiRoundPrices、与中标通知书脱钩）；`createRound` 同闸（结果生成要求全部轮次 closed，事后新轮即错配）；数据修正流程清零结果后自然放行。
- PMI 写端点群 8 处前置 `assertPmiMutable`（status≠ACTIVE → 409 `PMI_NOT_ACTIVE`，文案分已归档/已终止/回收站）：`updateStage`/`reopenStage`（开标锁只护 BID_EVALUATION 之前，尾段曾裸奔）/`addStageAttachment`/`deleteAttachment`/`updateExtractedInfo`/`saveAttachmentParagraphs`/`saveAttachmentHtml`/`replaceAttachmentWithText`——归档数据不可扰动（DA/T103 更正走重新归档流程）；`aiPolish`（纯文本变换无落库）与 tender-draft 草稿（编写态工件、不入归档材料）不受限。
- 审计核过守卫齐全（勿重复排查）：供应商撤回与售疑（DOWNLOAD/SUBMIT）、澄清答复（EVALUATING+待回复+寻址本司）、开标确认（OPENING+记录状态机）、主持端唱标录入（OPENING+已确认记录禁覆盖 H11）、专家 esign（signStatus PENDING 状态机）、邀请婉拒（ALREADY_CONFIRMED）、结果重生成（SIGN_PACKET_CLOSED）。
截标↔开标 10 分钟规则（2026-08-21 定 24h；**2026-10-16 用户裁定正式改为 10 分钟**，与《招标投标法》第34条偏离留痕加巨）——常量 `BID_DEADLINE_BEFORE_OPENING_MS`（packages/shared）、校验 util `apps/api/src/bid/opening-deadline.util.ts`（align/frozen 分阶段）、存量迁移脚本 `apps/api/scripts/align-opening-deadline-24h.ts`（注意：现运行会把存量 deadline 对齐到 10 分钟口径）。

### File Uploads (MinIO)

`POST /api/upload?category=...` (50 MB cap), `GET /api/upload/files/:id`, `DELETE /api/upload/:key`. Files stored in MinIO, metadata in `FileAsset` model. 双信封新轨类目（2026-08）：`bid_inner_ciphertext`（解外层产物 C_inner，归属链=`SupplierBidSubmission.innerAssets`）与 `bid_decrypted`（供应商解密上传明文，归属链=`decryptedAssets`）——下载授权按 submission 四列+两 Json 列反查（C_outer 本人下载拒收、C_inner 成员放行、bid_decrypted 指派给 SUCCESS 家/staff/专家）；`bid_inner_ciphertext`/`bid_decrypted`/`bid_document` 三类目删除硬保护（永久不可删）。

### Frontend Conventions

- 门户无共享组件包（见 Shared Packages 表末注）——workbench 组件、`cn`、小工具在各门户 `src/components`/`src/lib` 本地维护；跨门户通用小工具（如剪贴板）按门户自包含各放一份，勿抽进 `@water-erp/shared`。
- 剪贴板复制一律用各门户 `src/lib/copy-to-clipboard.ts`（web/bid-portal/supplier-portal-next/mall）：`navigator.clipboard` 仅 https/localhost 可用，http 演示环境直用=点击无反应或谎报「已复制」；util 带 `execCommand` 降级返回布尔，调用方必须按真实结果反馈。
- All portals (incl. supplier) use Next.js 16 + React 19 + Tailwind CSS v4.
- **Design system** (see `.impeccable.md`): industrial precision aesthetic — 1px hairline dividers, monospace numerals, layered navy→ice blue palette, Lucide 1.5px-stroke icons, `rounded-2xl` cards, `rounded-xl` buttons. The signature component treatment is a **neumorphic raised-border system** (directional light/dark shadow pairs derived from the page BG `oklch(0.975 0.012 258)`; never flat omnidirectional `box-shadow`) — buttons raise on hover, inset on active. Anti-patterns: no gradient buttons, no emoji-as-icons, no Material-style elevation shadows, no generic admin-template look. (`docs/glass-morphism-design-system.md` is an earlier, superseded direction; `.impeccable.md` is current.)
- No mock data fallbacks — show real DB data, loading, or empty states.

### Prisma Migration Notes

In non-interactive environments, use `prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`, or set `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`.

**拉取后必跑 `migrate status`（schema drift 铁律，2026-10-16 六度应验）**：任何 pull/merge 之后、`pnpm dev` 之前，在 `apps/api` 下跑 `npx prisma migrate status` 判定——有 pending 即 `npx prisma migrate deploy && npx prisma generate`。**判定勿走「本次 diff 是否动 schema.prisma」**：存量 drift 会被脱离树代打的旧 :4001 进程掩盖（2026-10-16 实录：`83a1e057` 的 SupplierCompanyLink 早已在本地 main 但从未 deploy/generate；`dev:kill` 清掉旧进程后新 `pnpm dev` 首次编译新代码即红——症状=门户全活、唯 :4001 死。client 旧→TS 编译红，DB 旧→起来后 P2022，可叠加）。修完须整体 `pnpm dev:kill && pnpm dev`（watch 对 node_modules/.d.ts 变更不可靠），验证=10 端口全监听 + `/api/docs` 200。

## 运维环境变量（2026-07 production hardening）
- **DATABASE_URL**：现在走 pgbouncer `localhost:6432`（`?pgbouncer=true&connection_limit=10`）。直连用 `DIRECT_URL=localhost:5432`。
- **pgbouncer**：`docker-compose.yml` 新增服务 `water-erp-pgbouncer`（本地构建于 `docker/pgbouncer/`），transaction 池，scram-sha-256 认证，6432→容器6432。postgres `max_connections=200`。
- **prisma studio** 不读 `directUrl`，需 `DATABASE_URL="$DIRECT_URL" pnpm db:studio`。
- **OperationLog**：20260723000000 起为按月 RANGE 分区表，PK=`(id, createdAt)`。@Cron 04:00 预建未来 `OPERATION_LOG_PARTITION_MONTHS_AHEAD`（默认 2）个月分区 + DROP 整月过期分区（O(1)），保留期默认 180 天。**禁止 migrate diff 重生成该表 DDL**（diff 会试图改回单列 PK）。
- **pnpm db:backup / db:restore**：`scripts/db-backup.sh`（docker exec pg_dump → gzip），`BACKUP_KEEP_DAYS` 默认 14，输出 `backups/`（gitignored）。host cron 见 `docs/db-backup.md`。
- **LLM 收口**：全部 DeepSeek 调用统一走 `local-ai/LlmService`（chat/chatJson/chatMessages）。`LLM_MAX_CONCURRENCY`（默认 10，进程内信号量）、`LLM_MAX_RETRIES`（默认 2，429/5xx/网络/超时指数退避，遵守 Retry-After≤8s）。`tender-review/services/llm.service.ts` 已删除（死代码）。`apps/mall` 的 AI 路由待整合（残留）。
- **OCR 多副本**：`services/ocr/start.sh` 支持 `OCR_PORT`/`OCR_HOST` 参数化。副本间 `OCR_HYBRID_PORT` 段不可重叠。API 侧 `OCR_SERVICE_URL` 支持逗号列表 round-robin（`ocr.service.ts`）。
- **ai-bid worker 扩容**：`AI_BID_WORKER_CONCURRENCY`（默认 2）；水平扩容=多开 worker 进程，BullMQ 天然安全（job ID 去重）。见 `docs/ops-scaling.md`。
- **操作日志排除默认值**：`operation-log.filter.ts` 新增 8 个高频轮询端点（通知角标/驾驶舱统计/审查任务轮询等，带方法限定 GET-only；2026-08-28 增 :3007 任务板 GET /bid/projects/dashboard 30s 轮询；2026-09-16 增 GET /operation-log——:3005 操作日志查询页（`/admin/operation-log`，admin only）自查询浏览不入日志防审计噪音，前缀连带 /my /archive /archive/verify，均只读）。
- **公告直建项目（N16 A 方案，2026-08-17）**：信息发布中心独立发布 BID_NOTICE 且无既有项目时，联动创建 BidProject 的同时自动补建最小 PMI（前置阶段补记 COMPLETED、currentStage=BID_EVALUATION）并回填关联——:3005 开标确认面板对公告直建项目可用。
- **公告删除规则**：关联项目进入 SUBMIT 及以后（SUBMIT/OPENING/EVALUATING）→ 409 `BID_IN_PROGRESS`，须先流标/归档（P0-4，办法第49条不得损毁）；DOWNLOAD/ABORTED/ARCHIVED 可删且仅解关联（不级联）；SUBMIT+ 409 禁令不变。（2026-08-21 落地，终审裁定）
- **公告公司隔离 + 公示期满提示页（2026-10-20 用户裁定，推翻 2026-08-20「全量展示所有公司公告」契约）**：:3004 公告中心（`announcement.service.ts supplierList`）与项目机会（`supplier-portal.service.ts listBidProjects` 公开分支收口+受邀分支）只对归属公司（APPROVED `SupplierCompanyLink`）供应商开放——「全部可见」公告也不跨公司；平台级公告（companyId null）全员可见；RESTRICTED 定向白名单命中豁免公司闸（显式点名>归属）。:3002 公开门户仍全量（匿名无从判归属）。公示期满/手动下线详情不再 400 `OFFLINED`——`getPublic` 返回 200 标题壳（`titleOnly`+`offlinedReason: PUBLICITY_ENDED|OFFLINED`，附件/招标文件剥除、不计浏览），:3002/:3004 列表壳行可点进提示页（「公示期已过，不再显示公示内容」/「该公告已下线」）；项目机会侧不受公示期满影响（`resolveOwnAnnouncement` 只硬过滤 status，同日早前裁定）。邀请写闸：`inviteSuppliers`/谈判配置 `supplierIds` 禁止跨公司（400 `CROSS_COMPANY_INVITE` 列名）；AI 邀请函群发未设闸（:3005 选择器已公司隔离+读端闸门兜底）。边界闭环（同日）：供应商端 `getBidProject`/`getBidProjectOverview`（缓存路径前置过闸）/`getBidProjectDocument` 读闸 `assertProjectVisibleToSupplier`（归属∪受邀∪本人投递，403 `COMPANY_SCOPE_FORBIDDEN`）；招标文件 `checkEligibility` OPEN 收紧为「本公司库」（平台级 null 全员、存量受邀行放行，元信息/付费/下载三端点同口）；AI 邀请函群发按项目公司过滤 supplierIds（越界剔除+warn）。e2e 存量红同日修复（专家口令改从 ExpertLibrary.json 取、platform-push 赋码闸按自愈版语义、注册码改 JOIN_INSTEAD）——全量 e2e 20 套件 188 项恢复绿。

## 双信封新轨·生产启用前清单（2026-08 双信封落地）

- **ADMIN_KEYSTORE_DIR 必须纳入备份**：管理方外层私钥文件不在 DB/MinIO 备份内；丢失=对应历史信封外层永久不可解（全量 PLATFORM 归因）。生产对应加密机/HSM。
- **.data/supervision/ 必须纳入备份**：监督推送平台签名私钥（A-153），与 ADMIN_KEYSTORE_DIR 同级；缺省 `SUPERVISION_KEYSTORE_DIR`。
- **供应商门户须 https（或 localhost）**：`@water-erp/ukey`/WebCrypto（crypto.subtle）要求 secure context，局域网 http 直连会挂。
- **clean-legacy-plaintext --execute 前**：先 dry-run 审阅清单；旧轨服务端密封资产的回看下载已支持 sealedPath 流式解密（streamFile，2026-08-21），执行后供应商回看/staff/专家下载不受影响。
- **BID_DUAL_ENVELOPE=false 应急语义**：flag 关时新轨投递（envelope.version='dual-v2'）被显式 400 `DUAL_DISABLED` 拒收——供应商须按旧流程（clientDeks）重新投递；回退前应公告通知投标人。**（2026-09-29 口径修正）**门户旧轨表单已下线——「按旧流程投递」无从执行：回退仅指 API 侧放行旧轨 clientDeks，供应商实际投递需管理员线下引导（DUAL_DISABLED 文案已改应急指引）。
- **管理方密钥轮转**：`POST /api/bid/admin-cert/generate` 置旧证 inactive；历史信封按 `envelope.adminCertId` 定位旧私钥（keystore 目录每证一文件，保留至其覆盖提交全部归档）。
- **供应商证书有效期与验签口径（2026-09-17）**：`SupplierCert.notBefore/expiresAt`（null=长期——mock 存量介质/旧中间件实例证书）；mock 新证书发行即带 60 天有效期（D1v2 用户裁定）。时点闸门=绑定（`BIND_CERT_EXPIRED`）与投递/补传验签（`CERT_EXPIRED`，`findActiveUnexpiredCert`），**历史签名复验不因嗣后过期/撤销失效**——复验走签时快照（`receiptSignature`/`confirmSignature` 增 `certSn/certPublicKey`，存量无快照回退 `Supplier.sm2PublicKey` 旧列，旧列已 @deprecated 仅回填+回退读）。回执/开标确认验签公钥已统一 ACTIVE SupplierCert（`findActiveCertForSigning`，不再读旧列——revoke 不清旧列的抵赖窗口就此关闭）。A-13 到期提醒=Scheduler `scanSupplierCertExpiry`（每日 08:15，30/7 天两档+过期补发，`expiryNotifyStage` 0/1/2 幂等）。运行中的 :17999 mock 中间件实例须重启后才会对**新生成**证书带有效期（存量盾文件向后兼容=长期）。

## 唱标金额单位铁律（2026-09-14 定案）

**dual-v2（双信封新轨）投标/唱标金额以「万元」入库（裸数字，投标表单口径）；旧轨为元/带单位自由文本。** 单位隐式化是 2026-09-14 全线事故根因（供应商大厅「153.95 元」误标、价格公式与限价差一万倍、中标通知书 ¥153.95 等四波同根修复）。

- **`BidOpeningRecord.amountUnit` 落列**（迁移 `20260914120000_bid_opening_record_amount_unit`，存量已回填）：'万元'=dual-v2 裸数字口径；null=旧轨。**全部四处写入点必须落戳**（enterOpeningRecord / bid-decrypt 解密即唱标 / supplier-portal dual-v2 解密预填 / syncMultiRoundPrices）。
- **读端唯一入口** `apps/api/src/bid/opening-amount-unit.util.ts`：`resolveOpeningAmountUnitMap`（戳优先、envelopeVersion 回退推导）取单位；`parseAmountToYuan(raw,{unitHint})` 换算；`formatAmountWithUnit` 纸面证据渲染（签名/签字包/文件包/CSV 一律自含单位）；`assertNoCrossUnitEntry` 录入闸（主持人把万元换算成元录入 → 400 `PRICE_UNIT_SUSPECT`，不给确认绕行）。**禁止新代码裸读裸算 `amount`/`decryptedPrice`。**
- **新增金额字段禁止再造隐式单位列**（单位必须显式落库或字段名/后缀自带）；前端渲染走 `formatOpeningAmount/formatBidSubmissionPrice` 的 unitHint 形参（供应商端）与 `amountUnit` 分支（主持端）。
- 测试锁定：`opening-amount-unit.util.spec.ts`（单位戳优先/闸门方向）+ 两端 spec 的 dual-v2 回显/比对用例。
- **金额链单位口径地图（2026-09-15 全链审查定稿）**——新读端先对号入座再取数，禁止凭裸数字猜单位：

  ```
  dual-v2 投标表单(万元) ──密封解密──▶ BidOpeningRecord.amount(万元，amountUnit 戳)
                                        │
        syncMultiRoundPrices(元 ÷10000 回写万元) ◀── BidQuote(元) ◀── 供应商报价轮表单(label「报价(元)」，元)
                                        │
        generateEvaluationResults：parseAmountToYuan(unitHint) 换算
                                        ▼
        BidEvaluationResult.bidPrice(元) ──▶ 中标通知书/公示/评标结果(元)
  ```

  分界：**开标记录侧=万元**（读端必须 unitHint 渲染，直出「N 万元」）；**报价轮 BidQuote、评标结果、中标通知侧=元**（¥/元直显）。跨侧桥接仅两处：`syncMultiRoundPrices`（元→万元回写）与 `generateEvaluationResults`（万元→元换算），除此之外不得出现裸换算。审查结论（2026-09-15）：bid-portal evaluation-view（元侧，裸 formatBidPrice 恰好正确）与专家 quote-history 面板（元侧）均无恙；专家门户 report-step 曾漏网（¥153.9 误显万元值，0a4514cc 修复）——教训：09-14 修复波只覆盖供应商端/主持端，**新增读端一律先查本图**。


## 评标时限与澄清闸门口径（2026-09-15 合规定案）

**`evaluationDeadline` 是启动评标时设定的内部时限（now+hours），非法定投标有效期。** 超时闸门只拦结果链：`submitScores`/`confirmReport`/`generateEvaluationResults` → 409 `EVALUATION_OVERDUE`；**澄清/回避/异议/动议等过程性写操作不拦——这是法定要求而非疏漏**（招标投标法 39 条/实施条例 52 条：澄清限范围不限时刻；电子招标投标办法 33 条：澄清必须经平台交换数据电文；实施条例 51 条：不得接受投标人主动澄清——评标澄清答复通道只允许应邀回复，勿加"供应商主动发起澄清"入口）。延期走 `POST /bid/projects/:id/extend-evaluation`（监督+审计留痕）。**勿给澄清端点加 overdue 闸门。** 详查 `water-erp/docs/合规审查-评标超时澄清写操作放行-P3-10-2026-09-15.md`。Backlog（依法必招场景再启用）：extend-evaluation 未联动「通知所有投标人延长投标有效期」（评标委暂行规定 40 条/30 号令 29 条）。


## 并行会话协作约定（2026-08-26 起生效）

两个 Claude 会话并行实施不同规范计划，**分工与避让规则如下（双方必须遵守）**：

| 会话 | 负责范围 | 计划文档 |
|------|---------|---------|
| 会话 A（GB/T 43711） | GB/T 43711 规范全部工作项 | `docs/plans/GB-T-43711规范完善任务计划-2026-08-24.md` |
| 会话 B（CTS/DA-T103） | CTS-EBS01 + DA/T 103 收窄路线图剩余项（A/B/C/D 域） | `docs/superpowers/plans/2026-08-24-system-pm-process-archive-roadmap.md` |

规则：
1. **一方工作时另一方不动工作区**（不改代码、不跑会写盘的命令）。开工前先 `git status` 确认对方无未提交改动；对方有改动则等待其提交。
2. **禁用 `git add -A` / `git add .`**——只 add 自己明确改动的文件路径，防止卷入对方半成品。
3. **共享高危文件**（`apps/api/prisma/schema.prisma`、`app.module.ts`、`bid.controller.ts`、`bid-confirm-panel.tsx`、`packages/shared`）：仅在对方工作区干净时修改；schema 改动须在己方提交内附对应迁移。
4. **每完成一个小步骤即提交**，不留大跨度未提交状态；提交信息注明所属规范（如 `feat(43711):` / `feat(compliance):`）。
5. 冲突已发生时：外科手术只摘除自己的片段（按块精确匹配），不回滚对方改动，向用户报告。
6. **改 `schema.prisma` 后提交前必须 `cd apps/api && npx prisma validate`**——校验失败时 `prisma generate` 会静默失败、client 停在旧版，连锁一批"字段不存在"假报错（2026-08-26 实录：反向关系锚点空格不匹配的 no-op 导致）。脚本插入 schema 字段后必须 grep 验证插入成功。

会话 B 的 C3 暂存件：`docs/superpowers/plans/2026-08-26-c3-non-tender-deal-pending.md`（含设计+测试代码，恢复时按文档落地）。
## 操作日志法定留存（P1-12，2026-08-25）

- **OperationLog**：过期月分区 DROP 前先归档到 MinIO（`operation-log-archive/<yyyy_mm>.jsonl.gz`，gzip JSON-lines + SHA-256），清单表 `OperationLogArchive`（month 唯一/rowCount/objectKey/sha256/sizeBytes）；归档失败**不 DROP**（下轮重试，宁可超保留期不可损毁）。`OPERATION_LOG_ARCHIVE_ENABLED=false` 可回退旧行为（直接 DROP），但启动时 warn 不满足办法第42条≥15年留存。
- **AuditLog**：保留期参数化 `AUDIT_LOG_RETENTION_DAYS`，默认 5475（15 年）；低频业务动作表直接留 PG。
- **归档对象非 FileAsset、无删除端点**（天然不可删）；归档对象须随 MinIO 备份策略覆盖，备份保留期同步 ≥15 年。
- 验证端点：`GET /operation-log/archive`（admin 清单）、`GET /operation-log/archive/verify/:month`（admin，sha256 比对）。

## CI 流水线（2026-08-25）

`.github/workflows/ci.yml`（push main / PR，concurrency 取消旧跑）：

- **validate job**（~2.5 min，无基础设施）：install → 写 CI .env（schema env() 必需 DATABASE_URL/DIRECT_URL）→ build shared 三包 → prisma generate/validate → api tsc/lint → 全量单测（jest testTimeout 20s——PBKDF2+sm-crypto 用例在慢速 runner 超 5s 默认值）。
- **e2e job**（~4 min，pgvector:pg16 + redis:7 services + docker MinIO）：`migrate deploy` 全新库重放（迁移链健康）→ status 干净 → build → **boot smoke**（:4099 起 → docs 200 → 杀；单测绿≠能启动）→ 装 reportlab（seed 投标 PDF 依赖）→ seed（含供应商编号序列对齐）→ 起 :4001 → dual-selfcheck → 新轨 e2e 55 项 → 快照恢复（CI 重封模式）+ 旧轨 13 项 + 恢复。
- **快照重封**（`SNAPSHOT_RESEAL_CRYPTO=1`，仅 CI）：快照内 sealedKey/bidPrice 是 dev KMS 包裹、FileAsset 引用 dev 产物——异 KMS 环境解不开。恢复时缺失 FileAsset 补桩（dummy 对象+哈希）、sealedKey 置空（走 legacy 完整性校验）、bidPrice 本地重封占位价。dev 关闭保持原值（快照是证据件）。产物仅作冒烟，非证据。
- **教训闸**（memory `unit-tests-green-does-not-mean-boots` 的落地）：boot smoke 与 tsc 闸在 CI 首日各捕获一个真实 bug（ConflictException 导入漏 / Length 同类）。

## 谈判采购文件读端口径（2026-10-20 定案）

**谈判采购不发布采购公告（BID_NOTICE），采购邀请书替代公告位**——故 `BidDocument` 表对谈判项目**恒空**，采购文件经 Redis `negotiation-config:{projectId}` 交付（`refFileKeys`=PMI 阶段附件主轨·本地 uploads/ 磁盘，`attachFileIds`/`refFileKeys` 兜底=FileAsset·MinIO）。任何读 `BidDocument` 的消费端对谈判项目都会拿到空——新消费端先判采购方式：

- **供应商端**（:3004 详情页）：已适配（14f55c5f，2026-10-19）——Attachment 主轨 + FileAsset 兼容轨 + 专用流式下载端点。
- **专家端**（:3006 标书获取「招标/采购文件」卡）：已适配（2026-10-20，SWHI-TP-2026102003 实录）——`resolveTenderDocumentMeta` 公告轨 miss 回退谈判轨（meta 带 `source:'negotiation'` + `files[]`）；下载端点 `GET /expert/projects/:id/negotiation-files/:fileId/download`（闸=评标室口令+专家五项核验+引用集 `FILE_NOT_IN_CONFIG`；docx 统一转 PDF 预览；监督日志「访问谈判采购文件」）。**勿给专家端加供应商获取窗口闸**——窗口面向供应商获取期，评标阶段核对原文是法定需要。
- **AI 辅助评标 worker**（`plaintext-fetcher.fetchTenderPlaintext`）：已适配（2026-10-20 同日）——公告轨 miss 回退谈判轨，返回 `{buffer, fileName}` 供 processFile 按真实扩展名分派（docx=mammoth/pdf=pdftotext/扫描件=OCR）；FileAsset 兼容轨按 sealedPath/sealedKey 解封（general 类目受 UPLOAD_SERVER_SEAL 密封，裸读 key 吐密文——专家端下载端点同日加固）。
- 公开/邀请/询比/竞价走 04 公告向导「引用采购文件」→ `attachFromObject` 建 BidDocument，专家端天然可见；直接采购同理（但当前 ZJ 项目 0 专家 0 公告，无实际爆发点，若将来配专家且未发公告同样断链）。
