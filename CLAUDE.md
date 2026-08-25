# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**智慧水发·蜀水云采 ERP 系统** — a Chinese-language procurement and bidding ERP system for Sichuan Water Development Group（四川水发集团）. It covers bid/project lifecycle, supplier lifecycle, expert evaluation/scoring, AI-assisted review, announcements/notifications, file uploads, and a public procurement mall.

The active codebase is the pnpm workspace in `water-erp/`. Legacy/non-target directories: the top-level `water_erp_web/` (static prototype) and `water-erp/apps/web-erp-old/` (superseded Next.js app) — do not develop against either.

> `AGENTS.md` is stale — it documents an old port layout and is missing `bid-portal`/`mall`. This `CLAUDE.md` is the source of truth. `water-erp/ACCOUNTS.md` lists seed accounts grouped by portal. `water-erp/.impeccable.md` defines the design system.

## Monorepo Structure

Run workspace commands from `water-erp/`.

### Portal Map

| App | Directory | Tech | Port | Description |
|-----|-----------|------|------|-------------|
| **API** | `apps/api` | NestJS 11 + Prisma | 4001 | REST API backend; Swagger at `/api/docs` |
| **信息门户** | `apps/public-portal` | Next.js 16 App Router | 3002 | Public landing page, announcements, policies, login entry for all roles |
| **采购商城** | `apps/mall` | Next.js 16 App Router | 3003 | E-commerce procurement mall — catalog browsing, procurement, favorites |
| **供应商门户** | `apps/supplier-portal` | Vue 3 + Vite | 3004 | Supplier self-service — registration, bidding, qualifications, profile |
| **采购管理工作台** | `apps/web` | Next.js 16 App Router | 3005 | Admin/internal staff — announcements, supplier management, expert admin, mall management |
| **专家门户** | `apps/expert-portal` | Next.js 16 App Router | 3006 | Bid expert workstation — project review, identity verification, scoring, reports |
| **开评标管理端** | `apps/bid-portal` | Next.js 16 App Router | 3007 | **开标+评标全过程执行终端（现场）**：开标任务板 + 开标大厅（组建会话/解密/唱标/异议/监督视图）+ 评标管理（启动评标/评分矩阵/生成结果/异议裁决/澄清答疑）+ 评标签字包（打印·手写签字·回传登记）+ 评标回流包。评标前准备与评标后归档归 :3005 |
| **水叮当助手** | `apps/assistant` | Next.js 16 App Router | 3008 | AI assistant chatbot — public, no login required |
| **大屏** | `apps/bigscreen` | Next.js 16 | 3010 | Data-viz big-screen dashboard. Started by `pnpm dev` (one of 9 apps); can also run standalone via `pnpm dev:bigscreen`. Port is hardcoded (not in `packages/config/ports.ts`). |

### Shared Packages

| Package | Purpose |
|---------|---------|
| `packages/config` | Port definitions (`ports.ts`) and role→portal routing (`urls.ts`) — `@water-erp/config` |
| `packages/shared` | Domain types, status labels/maps, stage colors, brand constants — `@water-erp/shared` |
| `packages/ui` | Shared React workbench components (`MetricCard`, `PageHero`, `SectionCard`, `StatusBadge`, `DataToolbar`) + `cn` helper — `@water-erp/ui` |
| `packages/ukey` | 供应商 CA U盾适配层（SM2/SM4/SM3 封装、`MockUKeyAdapter`、`DualEnvelope`/`SealedFields` 类型与 `canonicalEnvelopeHash`）——双信封投标加密与开标解密前后端共用，浏览器与 Node 同源可跑 — `@water-erp/ukey` |

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

### 供应商门户 (`supplier-portal`, :3004)

Self-service portal for suppliers. Supports registration (with enterprise info + qualification uploads), browsing bid opportunities, submitting encrypted bids, viewing bid progress, managing company profile/contacts/qualifications, and requesting change approvals.

**Tech:** The only Vue 3 portal — uses Element Plus UI, Pinia state management, and Vue Router.  
**Access:** Requires login as `supplier` role.  
**Login cookie:** `token_supplier`.  
**Target audience:** Registered suppliers and new suppliers registering.

### 采购管理工作台 (`web`, :3005)

The admin/internal staff management console for procurement users (login roles `staff`/`leader`; the legacy `procurement_staff` ghost account was removed 2026-08-20). **公司级数据隔离（2026-08-20）**：数据库/台账/进度/公告管理端按登录人公司隔离（真隔离=where 注入+:id 越权 403+统计在隔离集上算）；admin 四页有公司选择器（默认全部、?companyId= 切换、非 admin 传参忽略）；项目管理页为个人隔离（非 admin 仅本人项目，admin 全量）。归属写时快照（companyId+companyName），Company 主数据表（`companies`，注册 normalizeCompany 对齐建档）。供应商库/专家库/目录不隔离；公告 public 接口不受限。关键模块:

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

**Access:** Requires login as `bid_expert` role.  
**Login cookie:** `token_expert`.  
**Target audience:** Expert evaluators assigned to bid projects.

### 开评标管理端 (`bid-portal`, :3007)

**开标+评标全过程执行终端**（2026-08-13 分工 v3）。总则：**:3005 与 :3007 是不同的人在不同地方的工作**——:3005 是采购中心办公室（评标前准备 + 评标后收尾），:3007 是开评标现场（主持人/admin）。:3005 确认能开标（按时开标）后项目流转给 :3007；**开标与评标过程中的事全归 :3007 管理**，直到评标结束；评标结束后 :3007 线上把开评标数据流转回 :3005（开标文件包 + 评标回流包），线下打印签字（评标签字包）。阶段流转：按时开标 :3005、启动评标 :3007、完整归档 :3005；流标：开标前 :3005、评标中（异议裁决）:3007。（评标管理/异议裁决/澄清答疑已迁至 :3007 工作区「评标管理」tab；:3005 面板已移除对应三区块。）页面：

- **开标任务板** (`/bid`) — 只读，按阶段分区：「开标中」（解密/唱标/确认/异议四计数）/「评标中」（专家签到·投标计数，进入工作区默认评标 tab）/「待确定开标」（截标已过的 DOWNLOAD/SUBMIT，仅提示）/「已结束」（归档·流标只读回看）；行操作进入对应项目工作区
- **开标大厅** (`/bid/open?id=`) — 实时开标执行：组建开标会话（主持人+解密窗口必填/监督人选填，同阶段幂等写 `BidOpeningSession`）、供应商解密（单条/批量）、唱标录入、开标异议处理、会场交流（ExchangeDrawer）、**监督视图**（原监督端折叠内嵌：时间线/异常事件/批注/日志表/大厅交流只读）、开标完成后横幅【完成开标·移交】生成开标文件包（FileAsset `category=bid_opening_handover`，JSON + SHA-256 指纹，存 MinIO）并 WS 广播 `opening:completed` 回传 :3005（幂等、不改 stage、非启动评标闸门），:3005「开标进度」区块展示「资料已接收·下载」
- **项目工作区** (`/bid/project/[id]?tab=`) — 四 tab「开标大厅（嵌入大厅组件）／评标管理（**全操作**，2026-08 从 :3005 迁回：启动评标·专家进度·AI 辅助评标进度卡片·评分矩阵·排名·3 步生成评标结果向导·专家异议裁决（含评标中流标）·澄清答疑）／评分标准（只读：评分项+得分点，编制归 :3005）／评标签字（新增）」；默认 tab 随阶段（EVALUATING→评标管理，其余→开标大厅）；旧链接 `/bid/open?id=` 兼容重定向至此
- **评标签字**（工作区 tab，2026-08 新增）— 评标结果生成后可用：生成签字包 PDF（《评标报告》十项法定内容 + 签字页含「评标专家声明」与在线操作留痕 + 个人评分确认表×N + 异议工单 + 澄清纪要 + 动议决议）→ 主持人打印 → 专家现场手写签字 → 扫描回传 → 逐专家登记「已签字 / 拒绝(附书面不同意见) / 视为同意(拒绝且未陈述理由)」→ 全员闭环 → 生成评标回流包流转回 :3005。完整归档闸门 = 签字闭环 + 回流已生成。详见 `docs/superpowers/specs/2026-08-13-expert-paper-signing-design.md`

:3005 保留（不迁）：「开标确认」面板的评标前准备（供应商投标状态·催促未投递、专家确认·正选候补替换、评分标准编制、监督时间线、开标进度·开标前流标、主持人指派·延时开标·按时开标）与评标后收尾（评标回流接收、完整归档·签字闭环闸门、公示、中标通知书）。评标管理/异议裁决/澄清答疑已迁回 :3007（:3005 面板对应三区块已移除）。

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

# Build shared packages (required before first app start)
pnpm --filter @water-erp/shared build
pnpm --filter @water-erp/config build
pnpm --filter @water-erp/ukey build

# Database
pnpm db:generate     # Generate Prisma client
pnpm db:migrate      # Run migrations
pnpm db:seed         # Seed data (idempotent + destructive — see Seed Data)
pnpm db:studio       # Open Prisma Studio

# Start all (9 portals — includes bigscreen)
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

# AI 投标分析 worker（独立进程 — 必需，否则 per-item 分析任务不出队执行）
pnpm --filter api dev:worker:ai-bid-analysis   # = nest build && node dist/ai-bid-analysis-worker.js（dist 镜像 src，无 dist/src 层）

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
| 专家姓名（如 `刘苡池`） | `expert@2026` | bid_expert | 专家门户 (:3006) |
| `陈源远` | `陈源远@2026` | bid_host | 开评标管理端 (:3007) |

> **「陈源远」同名账号**：username 不再全局唯一（改为 `[username, role]` 复合唯一），两个 role 不同的账号共用登录名「陈源远」/ `陈源远@2026`。登录时按来源门户（`X-Portal` 头）区分：电子商城→mall、开标端（专家门户 admin tab）→bid_host。注意 `PORTAL_ROLE_PRIORITY.web` = `[leader, staff, bid_host, admin]` （原 `procurement_staff` 幽灵账户已于 2026-08-20 删除），故「陈源远」从采购管理端 :3005 登录会解析为 `bid_host`、采购功能 403——**:3005 请用 `Swhi-CGZX-*` leader/staff 账号**（口令 `<用户名>@2026`，见上表与 `water-erp/ACCOUNTS.md`）。详见 `auth.service.ts`。
详见 `auth.service.ts`。另：专家门户 (:3006) 登录页 dev 模式演示提示账号（周祥志 / Swhi-CGZX-admin，`DEMO_ACCOUNTS`）生产构建自动剥离。

> `admin` role 已有种子账号 `Swhi-CGZX-admin`（密码审批等管理功能；登录口令 `<用户名>@2026`）。开评标管理端 (:3007) 演示请用 `陈源远` (bid_host)。

> **评审专家库（186 名）**：来自真实专家库（`apps/api/prisma/seed-data/ExpertProfile.json`）。`seed.ts` 末尾会把真实库导出的编号用户名重置为专家姓名、口令统一为 `expert@2026`，便于演示登录。
>
> **供应商登录**：同理，`seed.ts` 会把所有供应商用户名重置为**公司名**、口令统一为 `supplier@2026`（与上表一致）。故供应商一律用「公司名 / supplier@2026」登录，不再有 `supplier1`/`huaxi` 等短用户名。

## Architecture

### Port Definitions

`packages/config/src/ports.ts` is the **single source of truth** for all port numbers:

```
api: 4001, public: 3002, mall: 3003, supplier: 3004,
web: 3005, expert: 3006, bid: 3007, assistant: 3008
```

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

The auth chain is `AuthGuard (global) → RolesGuard (global)`, registered via `APP_GUARD` in `AppModule`. `AuthGuard` extracts + verifies the JWT; `RolesGuard` checks `@Roles(...)` metadata. `@Public()` skips auth; no `@Roles` means any authenticated user can access.

**Cookie resolution** is handled by `apps/api/src/auth/portal-cookie.ts`: portal is detected from `X-Portal` header → `Origin`/`Referer` port → falls back to legacy `token` cookie. This allows the API to serve multiple portals with independent sessions on `localhost` (where cookies are shared across ports).

**:3005 单设备登录（2026-08-21）**：同一账号同一时间只允许一台设备在线（同账号才互踢，同浏览器不同账号可并存）。机制 = `User.webSessionId` + JWT `sid` + tab 级 `X-Web-Token` 头：凡最终写 `token_web` cookie 的登录都轮换 webSessionId 并重签带 sid 的 token（`AuthService.rotateWebSession`）。**token_web cookie 同浏览器全局一份**——多标签页登录不同账号会互相覆盖，故前端登录后把 access_token 存 sessionStorage（`session-store.ts`），请求经 `@water-erp/client` 的 `extraHeaders` 带 `X-Web-Token`（`tokenFromRequest` 头优先、cookie 回退），各标签页携带自己的 token 互不覆盖。`AuthGuard` 校验 JWT 内 `sid === User.webSessionId`（依据在 token 内、不可靠省略头绕过），不符返 401 `SESSION_REPLACED`；无 sid 的旧 web token（来自 token_web cookie）统一失效重登。前端 `SessionWatchdog`（15s 心跳 `GET /auth/heartbeat`，已入操作日志排除）让空闲页 15s 内被踢；`session-kick.ts` 弹「是否向管理员反馈」双按钮（`.neu-btn-group` 等高）——点是 `POST /auth/security-feedback`（带本 tab 旧 token 确认反馈人身份）通知所有 admin（link 指向 `/admin/accounts`），再回登录页并预填账号密码（prefill，手动登出即清）。`token_bid`/`token_expert`/`token_mall`/`token_supplier` 等其他命名空间不受影响。

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
| `Verification` | SMS/phone verification for expert identity check (step 1 of expert wizard) |
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

> **Operational gotcha:** editing `ai-bid-analysis` source and letting `pnpm dev` (API `--watch`) restart the API does **not** restart the worker. Kill and re-run the worker command. Re-running analysis creates new jobs — don't rely on a stable `jobId`.

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
BID_DUAL_ENVELOPE=true            # 双信封新轨总开关（=false 全局退回旧轨 KMS 信封投递；默认开，灰度/应急双向可退）
ADMIN_KEYSTORE_DIR=...            # 管理方加密证书私钥落盘目录（默认 apps/api/.data/admin-keystore；轮转后旧 adminCertId 私钥仍按 id 定位）

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
截标↔开标 24h 业务规则（2026-08-21 P0-2，集团内部惯例，与《招标投标法》第34条偏离留痕）——常量 `BID_DEADLINE_BEFORE_OPENING_MS`（packages/shared）、校验 util `apps/api/src/bid/opening-deadline.util.ts`（align/frozen 分阶段）、存量迁移脚本 `scripts/align-opening-deadline-24h.ts`。

### File Uploads (MinIO)

`POST /api/upload?category=...` (50 MB cap), `GET /api/upload/files/:id`, `DELETE /api/upload/:key`. Files stored in MinIO, metadata in `FileAsset` model. 双信封新轨类目（2026-08）：`bid_inner_ciphertext`（解外层产物 C_inner，归属链=`SupplierBidSubmission.innerAssets`）与 `bid_decrypted`（供应商解密上传明文，归属链=`decryptedAssets`）——下载授权按 submission 四列+两 Json 列反查（C_outer 本人下载拒收、C_inner 成员放行、bid_decrypted 指派给 SUCCESS 家/staff/专家）；`bid_inner_ciphertext`/`bid_decrypted`/`bid_document` 三类目删除硬保护（永久不可删）。

### Frontend Conventions

- Shared workbench components live in `packages/ui` (`@water-erp/ui`). Consuming apps must add `@source "../../node_modules/@water-erp/ui"` to their `globals.css` (Tailwind v4 requirement).
- Next.js portals use React 19 + Tailwind CSS v4; supplier portal uses Vue 3 + Element Plus + Pinia.
- **Design system** (see `.impeccable.md`): industrial precision aesthetic — 1px hairline dividers, monospace numerals, layered navy→ice blue palette, Lucide 1.5px-stroke icons, `rounded-2xl` cards, `rounded-xl` buttons. The signature component treatment is a **neumorphic raised-border system** (directional light/dark shadow pairs derived from the page BG `oklch(0.975 0.012 258)`; never flat omnidirectional `box-shadow`) — buttons raise on hover, inset on active. Anti-patterns: no gradient buttons, no emoji-as-icons, no Material-style elevation shadows, no generic admin-template look. (`docs/glass-morphism-design-system.md` is an earlier, superseded direction; `.impeccable.md` is current.)
- No mock data fallbacks — show real DB data, loading, or empty states.

### Prisma Migration Notes

In non-interactive environments, use `prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`, or set `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`.

## 运维环境变量（2026-07 production hardening）
- **DATABASE_URL**：现在走 pgbouncer `localhost:6432`（`?pgbouncer=true&connection_limit=10`）。直连用 `DIRECT_URL=localhost:5432`。
- **pgbouncer**：`docker-compose.yml` 新增服务 `water-erp-pgbouncer`（本地构建于 `docker/pgbouncer/`），transaction 池，scram-sha-256 认证，6432→容器6432。postgres `max_connections=200`。
- **prisma studio** 不读 `directUrl`，需 `DATABASE_URL="$DIRECT_URL" pnpm db:studio`。
- **OperationLog**：20260723000000 起为按月 RANGE 分区表，PK=`(id, createdAt)`。@Cron 04:00 预建未来 `OPERATION_LOG_PARTITION_MONTHS_AHEAD`（默认 2）个月分区 + DROP 整月过期分区（O(1)），保留期默认 180 天。**禁止 migrate diff 重生成该表 DDL**（diff 会试图改回单列 PK）。
- **pnpm db:backup / db:restore**：`scripts/db-backup.sh`（docker exec pg_dump → gzip），`BACKUP_KEEP_DAYS` 默认 14，输出 `backups/`（gitignored）。host cron 见 `docs/db-backup.md`。
- **LLM 收口**：全部 DeepSeek 调用统一走 `local-ai/LlmService`（chat/chatJson/chatMessages）。`LLM_MAX_CONCURRENCY`（默认 10，进程内信号量）、`LLM_MAX_RETRIES`（默认 2，429/5xx/网络/超时指数退避，遵守 Retry-After≤8s）。`tender-review/services/llm.service.ts` 已删除（死代码）。`apps/mall` 的 AI 路由待整合（残留）。
- **OCR 多副本**：`services/ocr/start.sh` 支持 `OCR_PORT`/`OCR_HOST` 参数化。副本间 `OCR_HYBRID_PORT` 段不可重叠。API 侧 `OCR_SERVICE_URL` 支持逗号列表 round-robin（`ocr.service.ts`）。
- **ai-bid worker 扩容**：`AI_BID_WORKER_CONCURRENCY`（默认 2）；水平扩容=多开 worker 进程，BullMQ 天然安全（job ID 去重）。见 `docs/ops-scaling.md`。
- **操作日志排除默认值**：`operation-log.filter.ts` 新增 8 个高频轮询端点（通知角标/驾驶舱统计/审查任务轮询等，带方法限定 GET-only）。
- **公告直建项目（N16 A 方案，2026-08-17）**：信息发布中心独立发布 BID_NOTICE 且无既有项目时，联动创建 BidProject 的同时自动补建最小 PMI（前置阶段补记 COMPLETED、currentStage=BID_EVALUATION）并回填关联——:3005 开标确认面板对公告直建项目可用。
- **公告删除规则**：关联项目进入 SUBMIT 及以后（SUBMIT/OPENING/EVALUATING）→ 409 `BID_IN_PROGRESS`，须先流标/归档（P0-4，办法第49条不得损毁）；DOWNLOAD/ABORTED/ARCHIVED 可删且仅解关联（不级联）；SUBMIT+ 409 禁令不变。（2026-08-21 落地，终审裁定）

## 双信封新轨·生产启用前清单（2026-08 双信封落地）

- **ADMIN_KEYSTORE_DIR 必须纳入备份**：管理方外层私钥文件不在 DB/MinIO 备份内；丢失=对应历史信封外层永久不可解（全量 PLATFORM 归因）。生产对应加密机/HSM。
- **供应商门户须 https（或 localhost）**：`@water-erp/ukey`/WebCrypto（crypto.subtle）要求 secure context，局域网 http 直连会挂。
- **clean-legacy-plaintext --execute 前**：先 dry-run 审阅清单；旧轨服务端密封资产的回看下载已支持 sealedPath 流式解密（streamFile，2026-08-21），执行后供应商回看/staff/专家下载不受影响。
- **BID_DUAL_ENVELOPE=false 应急语义**：flag 关时新轨投递（envelope.version='dual-v2'）被显式 400 `DUAL_DISABLED` 拒收——供应商须按旧流程（clientDeks）重新投递；回退前应公告通知投标人。
- **管理方密钥轮转**：`POST /api/bid/admin-cert/generate` 置旧证 inactive；历史信封按 `envelope.adminCertId` 定位旧私钥（keystore 目录每证一文件，保留至其覆盖提交全部归档）。

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
