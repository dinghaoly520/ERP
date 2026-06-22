# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**智慧水发·蜀水云采 ERP 系统** — a Chinese-language procurement and bidding ERP system for Sichuan Water Development Group（四川水发集团）. It covers bid/project lifecycle, supplier lifecycle, expert evaluation/scoring, AI-assisted review, announcements/notifications, file uploads, and a public procurement mall.

The active codebase is the pnpm workspace in `water-erp/`. The top-level `water_erp_web/` directory is a legacy/static prototype and is **not** the current development target.

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
| **开评标管理端** | `apps/bid-portal` | Next.js 16 App Router | 3007 | Bid opening/evaluation admin — 开标大厅, 监督端, 评标管理, 归档, 澄清答疑 |
| **水叮当助手** | `apps/assistant` | Next.js 16 App Router | 3008 | AI assistant chatbot — public, no login required |

### Shared Packages

| Package | Purpose |
|---------|---------|
| `packages/config` | Port definitions (`ports.ts`) and role→portal routing (`urls.ts`) — `@water-erp/config` |
| `packages/shared` | Domain types, status labels/maps, stage colors, brand constants — `@water-erp/shared` |
| `packages/ui` | Shared React workbench components (`MetricCard`, `PageHero`, `SectionCard`, `StatusBadge`, `DataToolbar`) + `cn` helper — `@water-erp/ui` |

Infrastructure in `water-erp/docker-compose.yml`: PostgreSQL 16 (`localhost:5432`), Redis 7 (`localhost:6380→6379`), MinIO (`localhost:9000`, console `localhost:9001`).

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

The admin/internal staff management console for `procurement_staff` users. Key modules:

- **首页驾驶舱** (`/dashboard`) — operational dashboard with AI panel (水叮当 summary)
- **信息发布中心** (`/notice`) — manage announcements (CRUD + publish)
- **供应商管理中心** (`/supplier`) — supplier approval, repository, selection, evaluation
- **专家管理中心** (`/expert`) — expert entry, repository, extraction, performance evaluation
- **电子商城管理** (`/mall-management`) — price approval/entry, catalog management, sync & operation logs

**Access:** Requires login as `procurement_staff` role.  
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

The bid lifecycle management backend for `admin` and `bid_host` roles. Modules:

- **开评标总览** (`/bid`) — dashboard with project stats, stage distribution, workspace inspection
- **开标大厅** (`/bid/open`) — real-time bid opening: supplier decryption, opening records, dispute resolution, countdown timer
- **监督端** (`/bid/supervise`) — supervision panel: timeline, anomaly events, CS audit log (read-only, non-intervention)
- **评标管理端** (`/bid/evaluate`) — expert status overview, scoring progress monitoring, start evaluation workflow
- **归档端** (`/bid/archive`) — archive items checklist, one-click archiving, export archive package with hash chain
- **澄清答疑** (`/bid/clarifications`) — clarification/QA workflow between bid committee and suppliers

**Authentication flow:** `admin`/`bid_host` users authenticate from the public portal's "在线开评标系统" card → redirected to expert portal (:3006) login → cookie `token_web` is set → post-login redirect to bid portal (:3007). The bid portal shares the `token_web` cookie namespace (no separate `token_bid`), sending `X-Portal: web` for API calls.

**Access:** Requires login as `admin` or `bid_host` role.  
**Login cookie:** `token_web` (shared with web portal).  
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
| `procurement_staff` | web (:3005) | `/dashboard` |
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

# Database
pnpm db:generate     # Generate Prisma client
pnpm db:migrate      # Run migrations
pnpm db:seed         # Seed data (idempotent + destructive — see Seed Data)
pnpm db:studio       # Open Prisma Studio

# Start all apps
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

# Build
pnpm build
pnpm build:api | build:mall | build:supplier | build:web | build:expert | build:public | build:bid

# Lint
pnpm lint
pnpm --filter api lint
pnpm --filter <app> lint
```

### Node 24 + Turbopack

Next.js 16 defaults to Turbopack which depends on `lightningcss` (unsupported on Node 24). **Workaround:** all Next.js `dev` scripts use `--webpack`. Do NOT merge `--webpack` to `main`; remove once lightningcss adds Node 24 support.

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

## Seed Data

`pnpm db:seed` is **idempotent and destructive** — it `TRUNCATE ... RESTART IDENTITY CASCADE` on all business tables, then reloads from JSON snapshots at `apps/api/prisma/seed-data/*.json`. Edit the JSON snapshots to change seed data; `seed.ts` just orchestrates the load.

Passwords follow `<username>@2026` convention:

| Account | Password | Role | Portal |
|---------|----------|------|--------|
| `mall` | `mall@2026` | mall | 采购商城 (:3003) |
| `supplier1` | `supplier1@2026` | supplier (approved) | 供应商门户 (:3004) |
| `supplier2` | `supplier2@2026` | supplier (approved) · 中科院成都信息技术 · 参与英雄项目 `BID-2026-HERO1` | 供应商门户 (:3004) |
| `huaxi` | `huaxi@2026` | supplier (approved) · 成都华西物资供应 · 参与旧种子项目 | 供应商门户 (:3004) |
| `caigou` | `caigou@2026` | procurement_staff | 采购管理工作台 (:3005) |
| 专家姓名（如 `刘苡池`） | `expert@2026` | bid_expert | 专家门户 (:3006) |
| `lizhuren` | `lizhuren@2026` | bid_host | 开评标管理端 (:3007) |

> `admin` role exists in schema/RBAC but has no seeded user. Use `lizhuren` (bid_host) for bid portal access.

> **评审专家库（186 名）**：来自真实专家库（`apps/api/prisma/seed-data/ExpertProfile.json`）。`seed.ts` 末尾会把真实库导出的编号用户名重置为专家姓名、口令统一为 `expert@2026`，便于演示登录。

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
| 开评标管理端 | `token_web` | `web` | Shares web cookie — admin/bid_host roles |
| 信息门户 | `token_public` | `public` | — |
| 水叮当助手 | — | `assistant` | No auth required |

**Key insight:** bid_portal (:3007) has no `token_bid` — it shares `token_web` because `admin`/`bid_host` roles map to the `web` portal namespace in the backend. The bid portal's login redirects through the expert portal (:3006) login page, which sets `token_web`.

The auth chain is `AuthGuard (global) → RolesGuard (global)`, registered via `APP_GUARD` in `AppModule`. `AuthGuard` extracts + verifies the JWT; `RolesGuard` checks `@Roles(...)` metadata. `@Public()` skips auth; no `@Roles` means any authenticated user can access.

### API

The NestJS API (`apps/api`, :4001):

- Global prefix `api`, CORS for all ports from `@water-erp/config`, `ValidationPipe({ whitelist: true, transform: true })`
- Swagger docs at `/api/docs`
- All error responses normalized to `{ statusCode, code, error, timestamp, path }` via `HttpExceptionFilter`

**Key modules (22 total, all under `apps/api/src/`):**

| Module | Purpose |
|--------|---------|
| `Auth` | JWT login/register/logout/me; Passport strategy; RBAC guards (`AuthGuard`, `RolesGuard`) |
| `Bid` | Full bid lifecycle: projects, opening sessions, records, scoring, clarifications, supervision, archive, evaluation results |
| `Expert` | Expert sign-in, avoidance check, scoring, reports; sub-controllers: `expert.controller.ts` (expert-side), `expert-admin.controller.ts` (admin CRUD/extraction/portrait/retire) |
| `Supplier` | Supplier CRUD, review, evaluations, classifications, change records |
| `SupplierPortal` | Supplier-facing endpoints (bid submissions, downloads, profile changes) |
| `Ai` | AI-assisted bid analysis, anomaly detection, risk scoring (LLM-powered + hardcoded fallback) |
| `Announcement` | Announcements CRUD, publish/archive, bid documents (encrypted, access-controlled) |
| `Notification` | In-app notifications + `NotificationDeliveryLog` (Track A: multi-channel delivery) |
| `Upload` | File upload to MinIO (50 MB cap), download, delete |
| `Procurement` | Procurement projects: draft → review → approve → bidding → contract → close |
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

### ENV Configuration

`apps/api/.env` (the only `.env` file in the project):

```
DATABASE_URL=postgresql://water_erp:water_erp_dev@localhost:5432/water_erp
JWT_SECRET=water-erp-jwt-secret
SMS_DEBUG_BYPASS=true              # Skip real SMS; auto-verify with code "000000"
```

### WebSocket / Real-Time

The API uses `@nestjs/websockets` + Socket.IO for real-time bid opening (开标大厅). The bid portal connects via `socket.io-client` to receive live decrypt status updates and countdown timer events.

### Bid Stage State Machine

```
DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED
```

Same-stage transitions are idempotent; invalid transitions throw `ConflictException` (409).

### File Uploads (MinIO)

`POST /api/upload?category=...` (50 MB cap), `GET /api/upload/files/:id`, `DELETE /api/upload/:key`. Files stored in MinIO, metadata in `FileAsset` model.

### Frontend Conventions

- Shared workbench components live in `packages/ui` (`@water-erp/ui`). Consuming apps must add `@source "../../node_modules/@water-erp/ui"` to their `globals.css` (Tailwind v4 requirement).
- Next.js portals use React 19 + Tailwind CSS v4; supplier portal uses Vue 3 + Element Plus + Pinia.
- **Design system** (see `.impeccable.md`): industrial precision aesthetic — 1px hairline dividers, monospace numerals, layered navy→ice blue palette, Lucide 1.5px-stroke icons, frosted glass surfaces, `rounded-2xl` cards, `rounded-xl` buttons. Anti-patterns: no gradient buttons, no emoji-as-icons, no generic admin-template look.
- No mock data fallbacks — show real DB data, loading, or empty states.

### Prisma Migration Notes

In non-interactive environments, use `prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`, or set `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`.
