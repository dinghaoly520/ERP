# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**智慧水发·招采ERP系统** — A Chinese-language procurement and bidding ERP system covering the public information portal, procurement mall, supplier lifecycle, internal procurement workbench, bid opening/evaluation, expert scoring, AI assistance, and operational dashboards.

The active pnpm monorepo is `water-erp/`. `apps/web-erp-old/` is the legacy ERP frontend and is not started by the root `pnpm dev` command.

## Monorepo Structure

pnpm workspace monorepo (`water-erp/`):

| Directory | Tech | Port | Role |
|-----------|------|------|------|
| `apps/public-portal` | Next.js 16 (App Router) | 3002 | Public information portal and announcements |
| `apps/mall` | Next.js 16 (App Router) | 3003 | Procurement mall |
| `apps/supplier-portal-next` | Next.js 16 (App Router) | 3004 | Supplier self-service portal; `/login`, `/register`, `/register-temporary` |
| `apps/web` | Next.js 16 (App Router) | 3005 | Unified procurement management workbench |
| `apps/expert-portal` | Next.js 16 (App Router) | 3006 | Bid expert portal |
| `apps/bid-portal` | Next.js 16 (App Router) | 3007 | Bid opening and evaluation management |
| `apps/assistant` | Next.js 16 (App Router) | 3008 | 水叮当 intelligent assistant |
| `apps/bigscreen` | Next.js 16 (App Router) | 3010 | Operational big-screen display |
| `apps/api` | NestJS 11 + Prisma | 4001 | REST API + Swagger at `/api/docs` |
| `packages/config` | TypeScript | — | Shared config: PORTS, role→portal routing (`@water-erp/config`) |
| `packages/shared` | TypeScript | — | Shared types, constants, design tokens (`@water-erp/shared`) |
| `packages/ui` | — | — | Scaffold (unused) |

`apps/web-erp-old/` uses port 3009 when run manually. `PORTS.supplierNext = 3020` remains a migration-compatibility alias used by API websocket/origin checks; the active supplier portal runs on 3004.

Infrastructure via `docker-compose.yml`: PostgreSQL 16 (:5432), Redis 7 (:6380 mapped to avoid host conflict), MinIO (:9000/:9001).

## Development Commands

All run from `water-erp/`. **Build packages first** before starting the API:

```bash
# First-time setup
pnpm install
pnpm infra:up                          # start Docker services
pnpm --filter @water-erp/shared exec tsc -p tsconfig.json   # build shared package
pnpm --filter @water-erp/config exec tsc -p tsconfig.json   # build config package
pnpm db:migrate                        # apply Prisma migrations
pnpm db:seed                           # seed demo data

# Dev — starts the API plus all 8 active frontends concurrently
pnpm dev

# Individual apps
pnpm dev:public                        # public information portal :3002
pnpm dev:mall                          # procurement mall :3003
pnpm dev:supplier                      # supplier portal :3004
pnpm dev:web                           # procurement workbench :3005
pnpm dev:expert                        # expert portal :3006
pnpm dev:bid                           # bid opening/evaluation :3007
pnpm dev:assistant                     # intelligent assistant :3008
pnpm dev:bigscreen                     # operational big screen :3010
pnpm dev:api                           # API :4001

# Database
pnpm db:generate                       # prisma generate
pnpm db:migrate                        # prisma migrate dev
pnpm db:seed                           # seed demo data (7 test accounts)
pnpm db:studio                         # Prisma Studio GUI

# Build & lint
pnpm build                             # build all packages
pnpm lint                              # lint all packages
```

**Important**: `packages/config` and `packages/shared` have `tsconfig.json` with `outDir: ./dist`. Their `package.json` `main` points to compiled JS. After editing these packages, re-run their `tsc -p tsconfig.json` build.

The API uses `.env` at `apps/api/.env`:
```
DATABASE_URL=postgresql://water_erp:water_erp_dev@localhost:5432/water_erp
JWT_SECRET=water-erp-jwt-secret
```

## Architecture

### Multi-Portal Design

Each user role lands on a different portal after login, routed by `@water-erp/config` (`ROLE_PORTAL` and `ROLE_LANDING`):

- `admin` / `bid_host` → **bid-portal** (`:3007/bid`)
- `supplier` → **supplier-portal-next** (`:3004/dashboard`)
- `bid_expert` → **expert-portal** (`:3006/`)
- `mall` → **mall** (`:3003/`)
- Unmapped or unauthenticated traffic falls back to **public-portal** (`:3002/`)

Portals share zero code at the component level; they share types and constants via `@water-erp/shared`. Each portal has its own `src/lib/api.ts` client and proxied `/api/*` calls.

### API (NestJS)

- **Global prefix**: `/api/*`
- **Auth**: JWT in httpOnly cookie (`token`). `AuthGuard` reads cookie → `req.user` (`{sub, username, role}`). Extract user in controllers with `@CurrentUser('sub')`.
- **Guards**: `AuthGuard` (JWT), `AdminGuard`, `RolesGuard` (role-based via `@Roles()` decorator), `OwnerGuard`/`ProcurementGuard` (supplier domain)
- **Modules**: Auth, Bid, Supplier, Notification, Expert, Ai, Announcement, Upload, SupplierPortal
- **PrismaService**: global singleton via `PrismaModule`, injected into all services
- **Validation**: `ValidationPipe` with `whitelist: true, transform: true` — DTOs use `class-validator` decorators
- **Swagger**: auto-generated at `http://localhost:4001/api/docs`

### API Modules Detail

| Module | Purpose | Key Routes |
|--------|---------|------------|
| Auth | Register/login/logout/me | `/auth/*` |
| Bid | Full bid lifecycle management | `/bid/projects`, `/bid/projects/:id/*` |
| Expert | Expert scoring, sign-in, avoidance, reports | `/expert/*` |
| Ai | AI-assisted bid analysis, anomaly detection | `/ai/projects/:pid/analyze/:sid`, `/ai/.../anomalies`, `/ai/.../risk-scores` |
| Announcement | Bidding notices, win notices, policies | `/announcements/*` |
| Supplier | Supplier CRUD, review, changes, evaluations, classifications | `/supplier/*` |
| SupplierPortal | Supplier-side endpoints (bid submissions, change password) | `/supplier-portal/*` |
| Notification | In-app notifications | `/notifications/*` |
| Upload | File upload to MinIO | `/upload/*` |

### Frontend Conventions

- **Proxy**: active portals use Next.js rewrites/proxy logic to forward `/api/*` to the API origin from `@water-erp/config` (default `http://localhost:4001`)
- **API client pattern**: thin `fetch` wrapper with `credentials: 'include'`, e.g. `src/lib/api.ts`
- **Types**: re-exported from `@water-erp/shared` in portal-level `src/lib/types.ts`
- **UI**: Tailwind CSS v4 (no component library), brand colors `#042a58` / `#064ea2` (navy blue)
- **Auth middleware**: Next.js portals check `token` cookie; public paths (`/login`, `/api`) bypass

### Key Domain Concepts

- **User roles**: `admin`, `bid_host`, `bid_expert`, `supplier`, `procurement_staff`
- **BidProject stages**: DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED
- **Supplier lifecycle**: Register → PENDING → APPROVED/RETURNED/REJECTED → can be DISABLED or BLACKLISTED
- **SupplierChangeRecord**: field-level change requests (PENDING → APPROVED/REJECTED)
- **BidSubmission**: supplier-side draft/save/submit/withdraw flow, tied to BidProject
- **Expert scoring**: 5 categories (Qualification, Responsive, Business, Technical, Price), score records per expert per item
- **AI module**: provides bid analysis JSON, anomaly detection, supplier risk scoring (LLM-powered but with hardcoded fallback/demo data)

### Database

The Prisma schema is at `apps/api/prisma/schema.prisma`; dated migrations live in `apps/api/prisma/migrations/`. The seed workflow is actively maintained and contains many compatibility/data-repair steps, so inspect `apps/api/prisma/seed.ts` rather than relying on a static account list in this guide.
