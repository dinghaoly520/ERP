# 招采 ERP 两人并行开发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 6 应用招采 ERP 项目整理成可两人并行开发、可联调、可验收的执行方案，并先修复阻塞并行协作的共享配置与跨域数据关系。

**Architecture:** 先收口全局端口、启动脚本、CORS、账号文档和管理端导航，再修正 `Supplier` / `BidSupplier` / `SupplierBidSubmission` 的显式关系。之后 A 负责供应商、公告、通知、商城商品侧，B 负责招投标、专家、AI、管理端壳，所有交叉点通过 DTO、shared type、Swagger 和联调清单验收。

**Tech Stack:** pnpm workspace, NestJS 11, Prisma, PostgreSQL, Next.js 16, Vue 3 + Vite, Tailwind CSS v4, TypeScript.

---

## File Structure

This plan touches these areas:

- `package.json`: root scripts for 6-app dev/build.
- `apps/api/src/main.ts`: API CORS origins.
- `ACCOUNTS.md`: local test account portal URLs.
- `packages/config/src/ports.ts`: single port source.
- `packages/config/src/urls.ts`: role to portal mapping.
- `apps/mall/next.config.ts`: mall API rewrite.
- `apps/api/prisma/schema.prisma`: cross-domain relations.
- `apps/api/prisma/migrations/*`: Prisma migration generated after schema change.
- `apps/api/src/supplier-portal/supplier-portal.service.ts`: bid submission business rule enforcement.
- `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`: supplier bid submission tests.
- `apps/api/src/notification/notification.service.ts`: notification facade for cross-module triggers.
- `apps/web/src/components/app-shell.tsx`: admin navigation.
- `apps/web/src/app/(dashboard)/mall/page.tsx`: admin mall semantics.
- `apps/web/src/app/(dashboard)/evaluation/page.tsx`: rename page copy to supplier evaluation semantics.
- `apps/expert-portal/src/proxy.ts`: confirm auth middleware naming/location works with Next 16.
- `packages/shared/src/types.ts`: cross-portal DTOs and relation-facing types.

## Execution Rules

- Run every command from `D:\Claude projects\ERP-main\water-erp`.
- Before each task, run `git status --short` and inspect files you will touch.
- Do not overwrite unrelated user changes.
- Commit after each task if the task is implemented in a clean, coherent state.
- Keep A/B work on separate branches if two people execute in parallel:
  - A branch: `codex/a-supplier-announcement-mall`
  - B branch: `codex/b-bid-expert-admin-shell`
  - shared setup branch: `codex/shared-config-contracts`

---

## Task 1: Shared Configuration Baseline

**Owner:** B primary, A review

**Files:**
- Modify: `package.json`
- Modify: `apps/api/src/main.ts`
- Modify: `ACCOUNTS.md`
- Modify: `apps/mall/next.config.ts`

- [ ] **Step 1: Inspect current shared config**

Run:

```powershell
git status --short
Get-Content -Encoding UTF8 -Raw package.json
Get-Content -Encoding UTF8 -Raw packages/config/src/ports.ts
Get-Content -Encoding UTF8 -Raw apps/api/src/main.ts
Get-Content -Encoding UTF8 -Raw apps/mall/next.config.ts
```

Expected:

- `packages/config/src/ports.ts` contains `mall: 3002`, `supplier: 3003`, `web: 3004`, `expert: 3005`, `public: 3006`.
- Root `package.json` does not yet include `dev:mall` / `build:mall`.
- `apps/api/src/main.ts` still has old `CLIENT_PORTS`.

- [ ] **Step 2: Update root scripts to include mall**

In `package.json`, replace the `scripts` block entries for dev/build app scripts with:

```json
{
  "dev": "concurrently -n mall,supplier,web,expert,public,api -c magenta,green,blue,purple,cyan,yellow \"pnpm dev:mall\" \"pnpm dev:supplier\" \"pnpm dev:web\" \"pnpm dev:expert\" \"pnpm dev:public\" \"pnpm dev:api\"",
  "dev:api": "pnpm --filter api start:dev",
  "dev:mall": "pnpm --filter mall dev",
  "dev:public": "pnpm --filter public-portal dev",
  "dev:web": "pnpm --filter web dev",
  "dev:expert": "pnpm --filter expert-portal dev",
  "dev:supplier": "pnpm --filter supplier-portal dev",
  "build": "pnpm -r build",
  "build:api": "pnpm --filter api build",
  "build:mall": "pnpm --filter mall build",
  "build:web": "pnpm --filter web build",
  "build:expert": "pnpm --filter expert-portal build",
  "build:supplier": "pnpm --filter supplier-portal build",
  "build:public": "pnpm --filter public-portal build",
  "lint": "pnpm -r lint",
  "db:generate": "pnpm --filter api exec prisma generate",
  "db:migrate": "pnpm --filter api exec prisma migrate dev",
  "db:studio": "pnpm --filter api exec prisma studio",
  "db:seed": "pnpm --filter api exec prisma db seed",
  "infra:up": "docker compose up -d",
  "infra:down": "docker compose down",
  "infra:logs": "docker compose logs -f"
}
```

- [ ] **Step 3: Replace API CORS port table**

In `apps/api/src/main.ts`, import shared ports and use them:

```ts
import { PORTS } from '@water-erp/config';
```

Replace:

```ts
const CLIENT_PORTS = { web: 3002, supplier: 3003, expert: 3004, public: 3005 };
```

with:

```ts
const CLIENT_PORTS = {
  mall: PORTS.mall,
  supplier: PORTS.supplier,
  web: PORTS.web,
  expert: PORTS.expert,
  public: PORTS.public,
};
```

- [ ] **Step 4: Add mall API rewrite**

Replace `apps/mall/next.config.ts` with:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  rewrites: async () => [
    { source: '/api/:path*', destination: 'http://localhost:4001/api/:path*' },
  ],
};

export default nextConfig;
```

- [ ] **Step 5: Update account URL documentation**

In `ACCOUNTS.md`, make portal URLs match current ports:

```md
## Mall 电子商城 — http://localhost:3002

公开访问，后续如接入登录按商城/采购权限控制。

## Supplier 供应商门户 — http://localhost:3003

...

## Admin 管理端 — http://localhost:3004

...

## 专家门户 — http://localhost:3005

...

## 公示门户 — http://localhost:3006

无需登录，公开访问。
```

- [ ] **Step 6: Verify configuration**

Run:

```powershell
pnpm --filter @water-erp/config exec tsc -p tsconfig.json
pnpm --filter api build
pnpm --filter mall build
```

Expected:

- All commands exit 0.
- If `api build` fails because compiled shared package is stale, run `pnpm --filter @water-erp/config exec tsc -p tsconfig.json` again and rerun API build.

- [ ] **Step 7: Commit**

```powershell
git add package.json apps/api/src/main.ts apps/mall/next.config.ts ACCOUNTS.md packages/config/dist
git commit -m "chore: align portal ports and mall scripts"
```

---

## Task 2: Prisma Cross-Domain Relations

**Owner:** B primary, A review

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Generated: `apps/api/prisma/migrations/<timestamp>_link_supplier_bid_submission/`
- Modify generated client through `pnpm db:generate`

- [ ] **Step 1: Write relation changes**

In `model Supplier`, add:

```prisma
  bidSuppliers       BidSupplier[]
  bidSubmissions     SupplierBidSubmission[]
```

In `model BidSupplier`, replace the current fields with this relation-aware shape:

```prisma
model BidSupplier {
  id             String        @id @default(cuid())
  projectId      String
  supplierId     String?
  supplierName   String
  downloadStatus String        @default("待下载")
  submitStatus   String        @default("待提交")
  encryptStatus  String        @default("待校验")
  receiptNo      String?
  decryptStatus  DecryptStatus @default(PENDING)
  confirmStatus  ConfirmStatus @default(PENDING)
  project        BidProject    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier       Supplier?     @relation(fields: [supplierId], references: [id], onDelete: SetNull)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@unique([projectId, supplierName])
  @@index([supplierId])
}
```

In `model SupplierBidSubmission`, add the `supplier` relation:

```prisma
  supplier       Supplier   @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  project        BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
```

The final `SupplierBidSubmission` should be:

```prisma
model SupplierBidSubmission {
  id              String    @id @default(cuid())
  supplierId      String
  projectId       String
  bidPrice        String?
  deliveryPeriod  String?
  technicalFile   String?
  businessFile    String?
  coverLetter     String?
  status          String    @default("draft")  // draft, submitted, withdrawn
  submittedAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  supplier        Supplier   @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  project         BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([supplierId, projectId])
  @@index([supplierId])
  @@index([projectId])
}
```

- [ ] **Step 2: Format Prisma schema**

Run:

```powershell
pnpm --filter api exec prisma format
```

Expected:

- Exit 0.
- `schema.prisma` formatting changes only.

- [ ] **Step 3: Create migration**

Run:

```powershell
pnpm --filter api exec prisma migrate dev --name link_supplier_bid_submission
```

Expected:

- Migration is created.
- Database applies successfully.

- [ ] **Step 4: Regenerate Prisma client**

Run:

```powershell
pnpm db:generate
```

Expected:

- Prisma Client generated successfully.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations package.json pnpm-lock.yaml
git commit -m "feat: link suppliers to bid submissions"
```

---

## Task 3: Supplier Bid Submission Rules and Tests

**Owner:** A implementation, B review

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`

- [ ] **Step 1: Add tests for project status and deadline rules**

In `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`, add tests covering:

```ts
it('rejects submission when project is not in SUBMIT stage', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({
    id: 'project-1',
    stage: 'OPENING',
    deadline: new Date(Date.now() + 3600_000),
  });
  prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });

  await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
    .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_SUBMITTING' } });
});

it('rejects submission after deadline', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({
    id: 'project-1',
    stage: 'SUBMIT',
    deadline: new Date(Date.now() - 3600_000),
  });
  prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });

  await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
    .rejects.toMatchObject({ response: { code: 'DEADLINE_PASSED' } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --filter api test -- supplier-portal.service.spec.ts
```

Expected:

- New tests fail because the service does not yet check project stage and deadline.

- [ ] **Step 3: Add validation helper**

In `SupplierPortalService`, add:

```ts
  private async assertCanSubmitBid(supplierId: string, projectId: string) {
    const [supplier, project] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: supplierId } }),
      this.prisma.bidProject.findUnique({
        where: { id: projectId },
        select: { id: true, stage: true, deadline: true },
      }),
    ]);

    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '供应商未通过审核，无法投标', code: 'NOT_APPROVED' });
    }
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });
    if (project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '当前项目不在投递阶段', code: 'PROJECT_NOT_SUBMITTING' });
    }
    if (project.deadline.getTime() < Date.now()) {
      throw new BadRequestException({ error: '投递截止时间已过', code: 'DEADLINE_PASSED' });
    }

    return { supplier, project };
  }
```

Update `submitBid` to call:

```ts
const { supplier } = await this.assertCanSubmitBid(supplierId, projectId);
```

Remove the duplicate supplier lookup inside `submitBid`.

- [ ] **Step 4: Ensure BidSupplier stores supplierId**

In the `bidSupplier.create` call inside `submitBid`, include:

```ts
supplierId,
```

In the `bidSupplier.update` call, include:

```ts
supplierId,
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
pnpm --filter api test -- supplier-portal.service.spec.ts
```

Expected:

- Supplier portal service tests pass.

- [ ] **Step 6: Run API tests**

Run:

```powershell
pnpm --filter api test
```

Expected:

- All API unit tests pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat: enforce supplier bid submission rules"
```

---

## Task 4: Shared API Contracts

**Owner:** A primary for supplier/mall/notification, B primary for bid/expert

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add bid submission status type**

In `packages/shared/src/types.ts`, add near status types:

```ts
export type BidSubmissionStatus = 'draft' | 'submitted' | 'withdrawn';
```

- [ ] **Step 2: Add supplier bid submission DTO**

Add:

```ts
export interface SupplierBidSubmission {
  id: string;
  supplierId: string;
  projectId: string;
  bidPrice?: string;
  deliveryPeriod?: string;
  technicalFile?: string;
  businessFile?: string;
  coverLetter?: string;
  status: BidSubmissionStatus;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
  project?: {
    id: string;
    projectCode: string;
    name: string;
    procurementMethod: string;
    stage: BidStage;
    deadline: string;
    openTime: string;
  };
}
```

- [ ] **Step 3: Add portal stats DTOs**

Add:

```ts
export interface SupplierPortalDashboardStats {
  supplierStatus: SupplierStatus;
  evaluationCount: number;
  submissionCount: number;
  qualificationCount: number;
  pendingChanges: number;
  unreadNotifications: number;
  expiringQualifications: number;
  profileCompleteness: { score: number; missing: string[] };
}

export interface MallProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  supplier: string;
  stock: string;
  tag?: string;
  image?: string;
  minOrder?: string;
}
```

- [ ] **Step 4: Add submission labels**

In `packages/shared/src/constants.ts`, add:

```ts
export const BID_SUBMISSION_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  withdrawn: '已撤回',
};

export const BID_SUBMISSION_STATUS_COLOR: Record<string, string> = {
  draft: '#8a9aaa',
  submitted: '#11a874',
  withdrawn: '#e74c3c',
};
```

- [ ] **Step 5: Build shared**

Run:

```powershell
pnpm --filter @water-erp/shared exec tsc -p tsconfig.json
```

Expected:

- Exit 0.
- `packages/shared/dist` updates.

- [ ] **Step 6: Commit**

```powershell
git add packages/shared/src packages/shared/dist
git commit -m "feat: add shared submission and mall contracts"
```

---

## Task 5: Admin Navigation and Page Semantics

**Owner:** B primary, A review

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/app/(dashboard)/evaluation/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/mall/page.tsx`

- [ ] **Step 1: Add expert management menu**

In `apps/web/src/components/app-shell.tsx`, import `UsersRound`:

```ts
import {
  LayoutDashboard, ClipboardList, Gavel, Building2,
  ShoppingCart, Megaphone, Star, Info, LogOut, PanelLeftClose, PanelLeft,
  UsersRound,
} from 'lucide-react';
```

Remove unused `ChevronLeft` and `ChevronRight` imports.

Add this nav item after bid management:

```ts
{
  label: '专家管理',
  path: '/expert',
  icon: UsersRound,
},
```

- [ ] **Step 2: Rename evaluation page copy**

In `apps/web/src/app/(dashboard)/evaluation/page.tsx`, change:

```tsx
<h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">评价管理</h1>
<p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">评价列表、发起评价、评价统计、异常记录</p>
```

to:

```tsx
<h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">供应商评价管理</h1>
<p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">供应商履约评价、发起评价、评价统计、异常记录</p>
```

- [ ] **Step 3: Clarify admin mall page copy**

In `apps/web/src/app/(dashboard)/mall/page.tsx`, change the page heading to:

```tsx
<h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">商城后台</h1>
<p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">商品目录、供应商商品、采购单后台管理；商城前台运行在 3002</p>
```

- [ ] **Step 4: Run web lint/build**

Run:

```powershell
pnpm --filter web build
```

Expected:

- Build exits 0.
- No import errors from lucide-react.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/app-shell.tsx apps/web/src/app/(dashboard)/evaluation/page.tsx apps/web/src/app/(dashboard)/mall/page.tsx
git commit -m "feat: clarify admin navigation ownership"
```

---

## Task 6: A Track - Supplier, Announcement, Notification, Mall

**Owner:** A

**Files:**
- Modify as needed: `apps/supplier-portal/src/api/bid.ts`
- Modify as needed: `apps/supplier-portal/src/views/bid/*.vue`
- Modify as needed: `apps/public-portal/src/app/**/*.tsx`
- Modify as needed: `apps/mall/src/app/page.tsx`
- Create if API-backed mall is implemented: `apps/mall/src/lib/api.ts`

- [ ] **Step 1: Align supplier portal bid types**

In `apps/supplier-portal/src/api/bid.ts`, import shared type if the app can resolve workspace shared types. If not currently wired, define a local mirror with the same fields:

```ts
export interface SupplierBidSubmission {
  id: string
  supplierId: string
  projectId: string
  bidPrice?: string
  deliveryPeriod?: string
  technicalFile?: string
  businessFile?: string
  coverLetter?: string
  status: 'draft' | 'submitted' | 'withdrawn'
  submittedAt?: string
  project?: {
    id: string
    projectCode: string
    name: string
    procurementMethod: string
    stage: string
    deadline: string
    openTime: string
  }
}
```

- [ ] **Step 2: Verify supplier bid API functions**

Ensure `apps/supplier-portal/src/api/bid.ts` has:

```ts
export const getMyBidSubmissions = () =>
  api.get<SupplierBidSubmission[]>('/supplier-portal/bid-submissions')

export const getBidSubmission = (projectId: string) =>
  api.get<SupplierBidSubmission | null>(`/supplier-portal/bid-submissions/${projectId}`)

export const saveBidDraft = (projectId: string, data: Partial<SupplierBidSubmission>) =>
  api.post<SupplierBidSubmission>(`/supplier-portal/bid-submissions/${projectId}/draft`, data)

export const submitBid = (projectId: string, data: Partial<SupplierBidSubmission>) =>
  api.post<SupplierBidSubmission>(`/supplier-portal/bid-submissions/${projectId}/submit`, data)

export const withdrawBidSubmission = (submissionId: string) =>
  api.post<SupplierBidSubmission>(`/supplier-portal/bid-submissions/${submissionId}/withdraw`, {})
```

- [ ] **Step 3: Add mall API client if mall becomes API-backed**

Create `apps/mall/src/lib/api.ts`:

```ts
const BASE = '/api';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
```

- [ ] **Step 4: Build A-owned frontends**

Run:

```powershell
pnpm --filter supplier-portal build
pnpm --filter public-portal build
pnpm --filter mall build
```

Expected:

- All builds exit 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/supplier-portal apps/public-portal apps/mall packages/shared
git commit -m "feat: align supplier portal and mall contracts"
```

---

## Task 7: B Track - Bid, Expert, AI, Admin Shell

**Owner:** B

**Files:**
- Modify as needed: `apps/api/src/bid/*`
- Modify as needed: `apps/api/src/expert/*`
- Modify as needed: `apps/api/src/ai/*`
- Modify as needed: `apps/expert-portal/src/**/*`
- Modify as needed: `apps/web/src/app/(dashboard)/bid/**/*`
- Modify as needed: `apps/web/src/app/(dashboard)/expert/page.tsx`

- [ ] **Step 1: Confirm expert portal auth middleware works**

Check whether Next 16 expects middleware at `src/proxy.ts` in this project setup. Run:

```powershell
pnpm --filter expert-portal build
```

Expected:

- Build exits 0.
- If auth protection is not active during manual testing, rename `apps/expert-portal/src/proxy.ts` to `apps/expert-portal/src/middleware.ts` and rerun build.

- [ ] **Step 2: Expand admin expert placeholder**

Replace `apps/web/src/app/(dashboard)/expert/page.tsx` placeholder features with explicit sections:

```tsx
import ModulePlaceholder from '@/components/module-placeholder';

export default function ExpertPage() {
  return (
    <ModulePlaceholder
      title="专家管理"
      desc="专家库管理、随机抽取、回避设置、专家评价与评审任务分配"
      features={['专家库', '专家抽取', '评审任务', '回避设置', '专家评价']}
    />
  );
}
```

- [ ] **Step 3: Ensure AI module exports service**

Verify `apps/api/src/ai/ai.module.ts` contains:

```ts
exports: [AiService],
```

This allows `ExpertService` or `BidService` to consume AI analysis without duplicating logic.

- [ ] **Step 4: Build B-owned apps**

Run:

```powershell
pnpm --filter api build
pnpm --filter expert-portal build
pnpm --filter web build
```

Expected:

- All builds exit 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/bid apps/api/src/expert apps/api/src/ai apps/expert-portal apps/web/src/app/(dashboard)/bid apps/web/src/app/(dashboard)/expert apps/web/src/components/app-shell.tsx
git commit -m "feat: align bid expert and admin shell"
```

---

## Task 8: Notification Event Facade

**Owner:** A implementation, B integration

**Files:**
- Modify: `apps/api/src/notification/notification.service.ts`
- Modify: `apps/api/src/notification/notification.module.ts`
- Modify as needed: `apps/api/src/bid/bid.module.ts`
- Modify as needed: `apps/api/src/bid/bid.service.ts`

- [ ] **Step 1: Export NotificationService**

In `apps/api/src/notification/notification.module.ts`, ensure:

```ts
exports: [NotificationService],
```

- [ ] **Step 2: Add facade methods**

In `NotificationService`, add:

```ts
async createForUser(userId: string, payload: { type: string; title: string; content: string; link?: string }) {
  return this.prisma.notification.create({
    data: {
      userId,
      type: payload.type,
      title: payload.title,
      content: payload.content,
      link: payload.link,
    },
  });
}

async createForRole(role: string, payload: { type: string; title: string; content: string; link?: string }) {
  const users = await this.prisma.user.findMany({
    where: { role, isActive: true },
    select: { id: true },
  });

  if (users.length === 0) return { count: 0 };

  return this.prisma.notification.createMany({
    data: users.map(user => ({
      userId: user.id,
      type: payload.type,
      title: payload.title,
      content: payload.content,
      link: payload.link,
    })),
  });
}
```

- [ ] **Step 3: Use facade from bid events**

In `BidModule`, import `NotificationModule`.

In `BidService`, inject `NotificationService` and call it when project stage changes to published/submission/opening events. For example after project creation:

```ts
await this.notificationService.createForRole('procurement_staff', {
  type: 'BID_PUBLISHED',
  title: '新招标项目已创建',
  content: `项目 ${project.name} 已创建，请关注后续流程。`,
  link: `/bid`,
});
```

- [ ] **Step 4: Run API tests/build**

Run:

```powershell
pnpm --filter api test
pnpm --filter api build
```

Expected:

- Tests and build exit 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/notification apps/api/src/bid
git commit -m "feat: add notification event facade"
```

---

## Task 9: End-to-End Integration Verification

**Owner:** both

**Files:**
- Read only unless failures require fixes.

- [ ] **Step 1: Start infrastructure**

Run:

```powershell
pnpm infra:up
```

Expected:

- PostgreSQL, Redis, MinIO containers are running.

- [ ] **Step 2: Prepare database**

Run:

```powershell
pnpm db:migrate
pnpm db:seed
```

Expected:

- Migrations apply.
- Seed data creates demo users and bid project.

- [ ] **Step 3: Build shared packages**

Run:

```powershell
pnpm --filter @water-erp/shared exec tsc -p tsconfig.json
pnpm --filter @water-erp/config exec tsc -p tsconfig.json
```

Expected:

- Both exit 0.

- [ ] **Step 4: Build all apps**

Run:

```powershell
pnpm build
```

Expected:

- All workspace packages with build scripts exit 0.

- [ ] **Step 5: Start dev stack**

Run:

```powershell
pnpm dev
```

Expected:

- Mall: `http://localhost:3002`
- Supplier portal: `http://localhost:3003`
- Web admin: `http://localhost:3004`
- Expert portal: `http://localhost:3005`
- Public portal: `http://localhost:3006`
- API: `http://localhost:4001/api/docs`

- [ ] **Step 6: Manual smoke test**

Perform:

1. Visit `http://localhost:3006`, open public announcements.
2. Login as `supplier1/123456` through supplier portal.
3. Open supplier bid list, save draft, submit bid, withdraw if allowed.
4. Login admin at `http://localhost:3004` as `admin/admin123`.
5. Verify supplier, notice, evaluation, mall, expert, bid menus.
6. Open bid project and confirm submitted supplier appears with `supplierId` relation-backed data.
7. Login expert at `http://localhost:3005` as `wangjg/123456`.
8. Confirm project list and evaluation workbench load.
9. Open mall at `http://localhost:3002` and verify product listing/search works.

Expected:

- No 401 loop on valid logins.
- No CORS errors in browser console.
- Bid submission status is visible on both supplier and admin sides.
- Expert portal protected pages redirect anonymous users to `/login`.

- [ ] **Step 7: Final commit**

```powershell
git status --short
git add .
git commit -m "test: verify six-app integration flow"
```

Only commit if the diff contains intentional verification docs or fixes. Do not commit generated `.next`, `dist`, or local runtime artifacts unless the repository already tracks them intentionally.

---

## Parallelization Plan

After Tasks 1-2 are complete, split work:

- A can execute Tasks 4, 6, and A-side parts of Task 8.
- B can execute Tasks 5, 7, and B-side parts of Task 8.
- Both join for Task 9.

Do not start Task 3 before Task 2 finishes because the service code should use the new relation fields.

## Self-Review

- Spec coverage: Covers port/script/CORS/doc mismatch, mall ownership, expert portal routing, admin expert navigation, supplier submission relation, notification triggers, A/B ownership, and integration verification.
- Placeholder scan: No unresolved placeholders or unspecified implementation steps remain.
- Type consistency: `BidSubmissionStatus`, `SupplierBidSubmission`, `SupplierPortalDashboardStats`, and `MallProduct` are defined before use.
- Scope check: This is a coordination and integration plan, not a full feature build for every ERP module. It focuses on enabling safe parallel execution and the first cross-domain fixes.
