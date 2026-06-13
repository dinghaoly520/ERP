# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**智慧水发·招采ERP系统** — A procurement and bidding ERP system for Sichuan Water Development Group. Chinese-language application covering bid management, supplier lifecycle management, expert evaluation, AI-assisted scoring, announcements, and e-commerce.

The active codebase is in `water-erp/`. The `water_erp_web/` directory is a legacy prototype (static HTML + Vue.js) — not the current development target.

## Monorepo Structure

pnpm workspace monorepo (`water-erp/`):

| Directory | Tech | Port | Role |
|-----------|------|------|------|
| `apps/api` | NestJS 11 + Prisma | 4001 | REST API + Swagger at `/api/docs` |
| `apps/web` | Next.js 16 (App Router) | 3002 | Admin/internal staff portal |
| `apps/supplier-portal` | Vue 3 + Vite | 3003 | Supplier self-service portal |
| `apps/expert-portal` | Next.js 16 (App Router) | 3004 | Bid expert portal |
| `apps/public-portal` | Next.js 16 (App Router) | 3005 | Public-facing landing + announcements |
| `packages/config` | TypeScript | — | Shared config: PORTS, role→portal routing (`@water-erp/config`) |
| `packages/shared` | TypeScript | — | Shared types, constants, design tokens (`@water-erp/shared`) |
| `packages/ui` | — | — | Scaffold (unused) |

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

# Dev — starts all 5 apps (api + 4 portals) concurrently
pnpm dev

# Individual apps
pnpm --filter web dev                  # admin portal :3002
pnpm --filter supplier-portal dev      # supplier portal :3003
pnpm --filter expert-portal dev        # expert portal :3004
pnpm --filter public-portal dev        # public portal :3005
pnpm --filter api start:dev            # API :4001

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

Each user role lands on a different portal after login, routed by `@water-erp/config` (`ROLE_PORTAL` map):

- `admin` / `bid_host` / `procurement_staff` → **web** (`:3002`)
- `supplier` → **supplier-portal** (`:3003`)
- `bid_expert` → **expert-portal** (`:3004`)
- Unauthenticated → **public-portal** (`:3005`)

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

- **Proxy**: each portal's Next.js/Vite config rewrites `/api/*` → `http://localhost:4001/api/*`
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

Prisma schema at `apps/api/prisma/schema.prisma`. Three migrations: `init`, `add_announcement_and_bid_submission`, `add_submission_project_relation`.

Seed data creates:
- Department: 采购中心
- Users: `caigou/caigou@2026` (采购管理员), `lizhuren/lizhuren@2026` (开标主持), `wangjg/wangjg@2026` (专家·王建国), `liuxm/liuxm@2026` (专家·刘晓梅), `chenzq/chenzq@2026` (专家·陈志强), `supplier1/supplier1@2026` (供应商·已入库), `supplier2/supplier2@2026` (供应商·待审核), `mall/mall@2026` (商城采购员)
- 1 demo bid project `BID-2026-0518` with 5 suppliers, 3 experts, scores, supervision logs, archive items
- 5 demo announcements
