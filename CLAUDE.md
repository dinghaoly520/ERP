# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**智慧水发·招采ERP系统** — a Chinese-language procurement and bidding ERP system for Sichuan Water Development Group. It covers bid/project management, supplier lifecycle management, expert evaluation/scoring, AI-assisted review, announcements, notifications, uploads, and a public procurement mall.

The active codebase is the pnpm workspace in `water-erp/`. The top-level `water_erp_web/` directory is a legacy/static prototype and is not the current development target.

## Monorepo Structure

Run workspace commands from `water-erp/`.

| Directory | Tech | Port | Role |
| --- | --- | --- | --- |
| `apps/api` | NestJS 11 + Prisma | 4001 | REST API; Swagger at `/api/docs` |
| `apps/mall` | Next.js 16 App Router | 3002 | Public procurement mall / e-commerce-facing portal |
| `apps/supplier-portal` | Vue 3 + Vite | 3003 | Supplier self-service portal |
| `apps/web` | Next.js 16 App Router | 3004 | Admin/internal staff portal |
| `apps/expert-portal` | Next.js 16 App Router | 3005 | Bid expert portal |
| `apps/public-portal` | Next.js 16 App Router | 3006 | Public-facing landing + announcements |
| `packages/config` | TypeScript | — | Shared ports and role-to-portal routing (`@water-erp/config`) |
| `packages/shared` | TypeScript | — | Shared domain types, labels, status maps, and brand constants (`@water-erp/shared`) |
| `packages/ui` | package scaffold | — | Currently unused scaffold |

Infrastructure is defined in `water-erp/docker-compose.yml`: PostgreSQL 16 (`localhost:5432`), Redis 7 (`localhost:6380` mapped to container `6379`), and MinIO (`localhost:9000`, console `localhost:9001`).

## Development Commands

```bash
# Install dependencies
pnpm install

# Start/stop infrastructure
pnpm infra:up
pnpm infra:down
pnpm infra:logs

# Build shared workspace packages used by app imports
pnpm --filter @water-erp/shared build
pnpm --filter @water-erp/config build

# Database / Prisma
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:studio

# Start all apps concurrently (mall, supplier, web, expert, public, api)
pnpm dev

# Start one app
pnpm dev:api
pnpm dev:mall
pnpm dev:supplier
pnpm dev:web
pnpm dev:expert
pnpm dev:public

# Build
pnpm build
pnpm build:api
pnpm build:mall
pnpm build:supplier
pnpm build:web
pnpm build:expert
pnpm build:public

# Lint
pnpm lint
pnpm --filter api lint
pnpm --filter web lint
pnpm --filter expert-portal lint
pnpm --filter public-portal lint
pnpm --filter mall lint
```

`packages/config` and `packages/shared` compile to `dist/`; their `package.json` `main`/`types` fields point at compiled output. Re-run their build scripts after editing either package, especially before starting/building apps that import them.

### Tests

Only the API currently defines test scripts (Jest; `apps/api/jest.config.js` sets `rootDir: src` and matches `*.spec.ts`).

```bash
# All API unit tests
pnpm --filter api test

# Watch API tests
pnpm --filter api test:watch

# Coverage
pnpm --filter api test:cov

# Single spec file or pattern
pnpm --filter api test -- bid.service.spec.ts
pnpm --filter api test -- expert

# E2E tests (uses seed data + cookie auth against real DB)
pnpm --filter api test:e2e
```

E2E tests in `apps/api/test/` use `supertest` against the full NestJS app with `AppModule`. They rely on seed data and the `loginAs()` helper for cookie-based authentication.

## Environment and Seed Data

The API reads environment from `apps/api/.env`. Local development expects at least:

```env
DATABASE_URL=postgresql://water_erp:water_erp_dev@localhost:5432/water_erp
JWT_SECRET=water-erp-jwt-secret
```

Seed data creates demo accounts:

- `admin / admin123` — 管理员
- `lizhuren / 123456` — 开标主持人
- `wangjg / 123456` — 专家·王建国
- `liuxm / 123456` — 专家·刘晓梅
- `chenzq / 123456` — 专家·陈志强
- `supplier1 / 123456` — 供应商（已入库）
- `supplier2 / 123456` — 供应商（待审核）

The seed also creates supplier classifications, demo suppliers, notifications, announcements, and several bid projects including `BID-2026-0518` with suppliers, experts, score items, opening records, supervision logs, and archive items.

## Architecture

### Portal Routing and Shared Configuration

`packages/config/src/ports.ts` is the single source for local ports:

- `api: 4001`
- `mall: 3002`
- `supplier: 3003`
- `web: 3004`
- `expert: 3005`
- `public: 3006`

`packages/config/src/urls.ts` maps roles to post-login portal destinations:

- `admin`, `bid_host`, `procurement_staff` → `web`
- `supplier` → `supplier`
- `bid_expert` → `expert`
- `mall` → `mall`
- unknown roles fall back to `public`

The portals do not share component implementations. Shared cross-portal concepts live in `@water-erp/shared`: role/status types, bid stages, announcement labels, supplier status maps, scoring category labels/colors, notification icons, and brand constants.

### API

The API is a NestJS app in `apps/api`.

- `src/main.ts` sets global prefix `api`, enables cookie parsing, enables CORS for all ports from `@water-erp/config`, installs a global `ValidationPipe({ whitelist: true, transform: true })`, installs `HttpExceptionFilter`, and serves Swagger at `/api/docs`.
- Auth uses a JWT stored in the httpOnly `token` cookie. The guard chain is **AuthGuard (global) → RolesGuard (global)**, registered via `APP_GUARD` in that order in `AppModule`. AuthGuard extracts the JWT, verifies it, and sets `req.user`. Routes that should skip auth use `@Public()` from `common/decorators/public.decorator`.
- `RolesGuard` only enforces role checks when a handler/class has `@Roles(...)`. Routes without `@Roles` remain accessible to any authenticated user.
- `PrismaModule` provides a singleton `PrismaService` extending `PrismaClient`.
- DTO validation uses `class-validator` decorators and benefits from the global validation pipe.
- All error responses go through `HttpExceptionFilter`, which normalizes output to `{ statusCode, code, error, timestamp, path }`.

Main API modules and route areas:

| Module | Purpose | Route area |
| --- | --- | --- |
| `AuthModule` | register/login/logout/me | `/api/auth/*` |
| `BidModule` | bid lifecycle, opening, scoring, clarifications, supervision, archive | `/api/bid/*` |
| `SupplierModule` | supplier CRUD/review/classification/evaluation/change management | `/api/supplier/*` |
| `SupplierPortalModule` | supplier-side profile, contacts, qualifications, bid submissions, password changes | `/api/supplier-portal/*` |
| `ExpertModule` | expert workstation, sign-in/avoidance/scoring/report data | `/api/expert/*` |
| `AiModule` | bid analysis, anomaly detection, supplier risk scoring | `/api/ai/*` |
| `AnnouncementModule` | notices, policies, publication status | `/api/announcements/*` |
| `NotificationModule` | in-app notifications | `/api/notifications/*` |
| `UploadModule` | upload endpoints | `/api/upload/*` |
| `ProcurementModule` | procurement project lifecycle, approval, bid initiation | `/api/procurement/*` |

### Auth and Role-Based Access Control

Login rejects inactive users (`!user.isActive`) and returns HTTP 401 on failure (not 200).

The guard chain is `AuthGuard → RolesGuard`:
- `AuthGuard` extracts the JWT from the httpOnly `token` cookie, verifies it, and sets `req.user`.
- `RolesGuard` checks `@Roles(...)` metadata on the handler/class. No `@Roles` means any authenticated user can access.
- `@CurrentUser('sub')` decorator extracts `req.user.sub` (the user ID) for use in controllers.

Role assignments on controllers:

| Controller | Scope | Roles |
| --- | --- | --- |
| `BidController` | class-level | `admin`, `bid_host`, `procurement_staff` |
| `ExpertController` | class-level | `bid_expert` |
| `AiController.analyzeBid` | method-level | `admin`, `bid_expert`, `bid_host` |
| `AiController.detectAnomalies` | method-level | `admin`, `bid_host`, `procurement_staff` |
| `AiController.getSupplierRiskScores` | method-level | `admin`, `bid_host`, `procurement_staff` |

Controllers without `@Roles` (Auth, Announcement, Notification, Supplier, SupplierPortal, Upload) are accessible to any authenticated user, subject to their own `AuthGuard` usage.

### Bid Stage State Machine

`apps/api/src/bid/bid-state.ts` is the single source of truth for valid bid stage transitions:

```
DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED
```

- Same-stage transitions are idempotent (no error).
- Invalid transitions throw `ConflictException` (HTTP 409), **not** `BadRequestException` (400).
- `assertBidStageTransition(from, to)` is a pure function used by `bid.service.ts` and testable in isolation.

### Expert Identity and Score Uniqueness

`BidExpert` has a `userId` FK to `User` with `@@unique([projectId, userId])`. The expert service uses `bidExpert.findFirst({ where: { userId, projectId } })` for all identity lookups — it does **not** match by `displayName`. This prevents same-name conflicts.

`BidScoreRecord` has `@@unique([expertId, scoreItemId, supplierId])` — same expert + score item + supplier is an upsert. The `supplierId` field is required (not nullable).

### Database Model

Prisma schema is at `apps/api/prisma/schema.prisma`; migrations live in `apps/api/prisma/migrations/`.

Core model areas:

- Users/departments and role strings (`admin`, `bid_host`, `bid_expert`, `supplier`, `procurement_staff`).
- Bid lifecycle: `BidProject`, `BidSupplier`, `BidOpeningSession`, `BidOpeningRecord`, `BidExpert`, `BidScoreItem`, `BidScoreRecord`, `BidClarification`, `BidSupervisionLog`, `BidArchiveItem`.
- Supplier lifecycle: `Supplier`, contacts, qualifications, classifications, evaluations, and field-level `SupplierChangeRecord` requests.
- Supplier bidding: `SupplierBidSubmission` with one submission per supplier/project.
- Announcements and notifications.

Important enums include `BidStage` (`DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED`), `SupplierStatus` (`PENDING`, `RETURNED`, `APPROVED`, `REJECTED`, `DISABLED`, `BLACKLIST`), scoring categories (`QUALIFICATION`, `RESPONSIVE`, `BUSINESS`, `TECHNICAL`, `PRICE`), and bid decrypt/confirm states.

### Frontend Conventions

- Next.js portals (`mall`, `web`, `expert-portal`, `public-portal`) rewrite `/api/:path*` to `http://localhost:4001/api/:path*` in `next.config.ts`.
- The Vue supplier portal proxies `/api` to `http://localhost:4001` in `vite.config.ts` and aliases `@` to `src`.
- Portal API clients use thin wrappers around `/api` and include credentials for cookie auth where applicable.
- Next.js portals use React 19 and Tailwind CSS v4; supplier portal uses Vue 3, Vite, Element Plus, Pinia, and Vue Router.
- Shared domain types/constants should be added to `packages/shared` when multiple portals need the same vocabulary; app-specific view models should remain local to the portal.

### Prisma Migration Notes

`prisma migrate dev` requires an interactive terminal. In non-interactive environments (CI, agents), use one of:
- `prisma migrate dev --create-only` to generate SQL without applying, then `prisma db execute` + `prisma migrate resolve --applied`.
- Or `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1` env var for commands like `migrate reset`.

When adding non-null columns to populated tables, create the column nullable first, fill data via `UPDATE`, then set `NOT NULL` in the same migration SQL file.
