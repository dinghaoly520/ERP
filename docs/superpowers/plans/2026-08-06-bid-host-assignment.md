# 开标主持人指派与硬分流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 :3005「开标确认」面板新增「开标主持人」按钮，让 leader/staff/admin 在开标前把项目指派给特定 `bid_host`，实现 :3007 的硬分流（仅显示派给我的项目）。

**Architecture:** 新增 `BidProject.assignedHostUserId` 列 + 命名关系；`BidService.listProjects/getProjectsDashboard` 按 `bid_host` 角色过滤；新增 `PATCH /bid/projects/:id/assigned-host` 端点（leader/staff/admin，`OpeningSession` 存在前可改）；`startOpening` 加指派前置闸门；:3005 加按钮+Modal；种子新增「开标主持人」账号 + 回填现有项目。

**Tech Stack:** NestJS 11 + Prisma 4 + PostgreSQL 16 · Next.js 16 (App Router) + React 19 + Tailwind v4 · Jest (unit) + supertest (e2e)

## Global Constraints

- **迁移非交互**：绝不跑 `prisma migrate dev`（会 reset 数据）。用 `--create-only` → `db execute` → `migrate resolve --applied`，或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`。详见 memory `main-db-migration-drift`。
- **不要主动 push**：commit 后只提醒"有 N 个未推送"，等用户明确说 push 才推（memory `no-auto-push-reminder-only`）。
- **commit 前查分支**：多会话共库，commit 前先 `git log --oneline -1` 确认 HEAD 未被其它会话推进（memory `check-branch-before-commit`）。错位 commit 用 `git reset --soft` 或 `update-ref` 恢复，**禁用 `checkout` / `reset --hard`**。
- **TS import 约定**：tsconfig 无 `esModuleInterop`。CJS 函数导出包用 `import x = require('pkg')`（如 `sanitize-html`、`bcrypt`）。
- **共享包改动**：改 `packages/config` 或 `packages/shared` 后必须重跑 `pnpm --filter @water-erp/shared build` / `pnpm --filter @water-erp/config build`。本计划不涉及。
- **设计系统**（`.impeccable.md`）：1px 发丝分隔、等宽数字、navy→ice blue 调色板、Lucide 1.5px 图标、`rounded-2xl` 卡片、neumorphic raised-border 系统（定向阴影对，禁止 Material 风格 omnidirectional shadow）。新组件沿用既有 modal/dropdown 类（`neu-btn-soft` / `neu-btn-primary` / `workbench-input`）。
- **错误响应规范**：所有 throw 用 `{ error: <中文消息>, code: <SCREAMING_SNAKE> }` 格式（见 `bid.service.ts` 现有 `OPENING_CHECKLIST_FAILED` 等）。
- **角色守卫**：`@Roles('leader','staff','admin')` 限制管理端操作；`bid_host` 角色只在 :3007 调列表端点。

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `water-erp/apps/api/prisma/schema.prisma` — `BidProject` model (~line 273) + `User` model relations (~line 25)
- Create: `water-erp/apps/api/prisma/migrations/20260806000000_bid_host_assignment/migration.sql`

**Interfaces:**
- Produces: 新增列 `BidProject.assignedHostUserId` / `assignedAt` / `assignedByUserId` + 关系 `assignedHostUser`；Prisma client 类型更新（后续 task 依赖）

- [ ] **Step 1: 修改 `schema.prisma` — BidProject 模型**

在 `BidProject` 模型的 `isExtractionOnly` 行之后（约 line 290）追加 3 列 + 关系：

```prisma
  isExtractionOnly         Boolean                    @default(false) // 自定义抽取影子项目：仅承载专家抽取/通知/确认，不出现在项目管理列表
  // ── 开标主持人指派（硬分流 R1）── null = 未指派（:3007 不可见，:3005 公开池）
  assignedHostUserId        String?
  assignedAt                DateTime?
  assignedByUserId          String?    // 操作留痕：指派人 userId
  assignedHostUser          User?      @relation("BidProjectAssignedHost", fields: [assignedHostUserId], references: [id], onDelete: SetNull)
  suppliers                 BidSupplier[]
```

- [ ] **Step 2: 修改 `schema.prisma` — User 模型反向关系**

在 `User` 模型的关系区块（`@@unique([username, role])` 之前）追加一行：

```prisma
  chatSent     ChatMessage[] @relation("ChatMessageSender")
  chatReceived ChatMessage[] @relation("ChatMessageReceiver")

  // ── 开标主持人指派：被派到的项目（硬分流）──
  assignedBidProjects  BidProject[] @relation("BidProjectAssignedHost")

  @@unique([username, role])
```

- [ ] **Step 3: 生成 migration SQL（非交互）**

```bash
cd water-erp
mkdir -p apps/api/prisma/migrations/20260806000000_bid_host_assignment
```

创建 `apps/api/prisma/migrations/20260806000000_bid_host_assignment/migration.sql`：

```sql
-- AddForeignKey supplied by prisma generate; 手写避免 migrate diff 改动 OperationLog
ALTER TABLE "BidProject" ADD COLUMN "assignedHostUserId" TEXT;
ALTER TABLE "BidProject" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "BidProject" ADD COLUMN "assignedByUserId" TEXT;

ALTER TABLE "BidProject" ADD CONSTRAINT "BidProject_assignedHostUserId_fkey"
  FOREIGN KEY ("assignedHostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 索引：:3007 listProjects 按 assignedHostUserId 过滤，建索引避免全表扫描
CREATE INDEX "BidProject_assignedHostUserId_idx" ON "BidProject"("assignedHostUserId");
```

- [ ] **Step 4: 应用 migration（非交互三步法）**

```bash
cd water-erp
pnpm --filter api prisma db execute --file apps/api/prisma/migrations/20260806000000_bid_host_assignment/migration.sql --schema apps/api/prisma/schema.prisma
pnpm --filter api prisma migrate resolve --applied 20260806000000_bid_host_assignment
pnpm --filter api prisma generate
```

- [ ] **Step 5: 验证 schema 编译通过**

```bash
pnpm --filter api exec tsc --noEmit -p apps/api/tsconfig.json 2>&1 | tail -20
```

Expected: 不应有新增 TS 错误（既有错误若有先忽略，只看是否引入新错）。重点确认 `bidProject.assignedHostUserId` 在 client 类型中出现。

- [ ] **Step 6: Commit**

```bash
cd /home/asus/桌面/ERP
git log --oneline -1   # 确认 HEAD 未变（多会话共库）
git add water-erp/apps/api/prisma/schema.prisma water-erp/apps/api/prisma/migrations/20260806000000_bid_host_assignment/
git commit -m "feat(bid): BidProject 开标主持人指派字段 + migration

assignedHostUserId/assignedAt/assignedByUserId 三列 + 命名关系
BidProjectAssignedHost（onDelete: SetNull）。:3007 硬分流基础。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: BidService — assignHost 方法 + listProjects/dashboard 角色过滤

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts` — `listProjects` (~line 105) + `getProjectsDashboard` (~line 158) + 新增 `assignHost` / `listHosts` 方法
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts` — 追加两个 describe 块

**Interfaces:**
- Consumes: Task 1 的 Prisma client 类型（`assignedHostUserId` / `BidOpeningSession`）
- Produces:
  - `BidService.listProjects(stages?: string[], actor?: { id: string; role: string }): Promise<...>`
  - `BidService.getProjectsDashboard(actor?: { id: string; role: string }): Promise<...>`
  - `BidService.assignHost(projectId: string, userId: string | null, actorId: string): Promise<BidProject & { assignedHostUser: {...} | null }>`
  - `BidService.listHosts(): Promise<Array<{ id, username, displayName }>>`

- [ ] **Step 1: 写失败测试 — `bid.service.spec.ts` 追加**

在文件末尾追加（保留文件既有内容；这里展示新增块）：

```typescript
// ──────────────────────────────────────────────────────────
// 开标主持人指派（assignHost）+ listProjects 角色过滤
// ──────────────────────────────────────────────────────────

// 这些测试用 mock PrismaService，不依赖真实 DB。
// 沿用 bid.service.spec.ts 顶部已有的 mock 模式。

describe('assignHost (BidService)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      bidOpeningSession: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('OpeningSession 已存在 → 抛 ConflictException OPENING_SESSION_LOCKED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ id: 's1', projectId: 'p1' });
    await expect(service.assignHost('p1', 'u1', 'actor1'))
      .rejects.toMatchObject({ message: expect.any(String), response: { code: 'OPENING_SESSION_LOCKED' } });
  });

  it('userId 非 bid_host → 抛 BadRequestException INVALID_HOST', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'supplier', isActive: true });
    await expect(service.assignHost('p1', 'u1', 'actor1'))
      .rejects.toMatchObject({ response: { code: 'INVALID_HOST' } });
  });

  it('userId = null → 清除指派（assignedHostUserId/assignedAt/assignedByUserId 置空）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    prisma.bidProject.update.mockResolvedValue({ id: 'p1', assignedHostUser: null });
    const result = await service.assignHost('p1', null, 'actor1');
    expect(prisma.bidProject.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({ assignedHostUserId: null, assignedAt: null, assignedByUserId: null }),
    }));
    expect(result.assignedHostUser).toBeNull();
  });

  it('合法 bid_host → 写入 assignedHostUserId + assignedAt + assignedByUserId', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_host', isActive: true });
    prisma.bidProject.update.mockResolvedValue({
      id: 'p1',
      assignedHostUser: { id: 'u1', username: '陈源远', displayName: '陈源远' },
    });
    const result = await service.assignHost('p1', 'u1', 'actor1');
    expect(prisma.bidProject.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignedHostUserId: 'u1',
        assignedAt: expect.any(Date),
        assignedByUserId: 'actor1',
      }),
    }));
    expect(result.assignedHostUser?.username).toBe('陈源远');
  });
});

describe('listProjects actor 过滤（硬分流 R1）', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findMany: jest.fn().mockResolvedValue([]) },
      projectManagementItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('role=bid_host → where 含 assignedHostUserId = actor.id', async () => {
    await service.listProjects(undefined, { id: 'host1', role: 'bid_host' });
    expect(prisma.bidProject.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignedHostUserId: 'host1', isExtractionOnly: false }),
    }));
  });

  it('role=leader → 不追加 assignedHostUserId 过滤（看到全部）', async () => {
    await service.listProjects(undefined, { id: 'leader1', role: 'leader' });
    const callArg = prisma.bidProject.findMany.mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty('assignedHostUserId');
    expect(callArg.where.isExtractionOnly).toBe(false);
  });

  it('actor 未提供（undefined）→ 不追加过滤（向后兼容）', async () => {
    await service.listProjects(undefined);
    const callArg = prisma.bidProject.findMany.mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty('assignedHostUserId');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd water-erp
pnpm --filter api test -- bid.service.spec.ts 2>&1 | tail -30
```

Expected: 新增 7 个测试 FAIL（`service.assignHost is not a function` / `where.assignedHostUserId` 不存在）。

- [ ] **Step 3: 实现 `listHosts` 方法**

在 `BidService`（`bid.service.ts`）合适位置（建议紧邻 `listProjects` 之前，作为公开 API 一组）追加：

```typescript
  /** 列出可指派的开标主持人账号（:3005 选择器用） */
  async listHosts() {
    return this.prisma.user.findMany({
      where: { role: 'bid_host', isActive: true },
      select: { id: true, username: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
  }
```

- [ ] **Step 4: 实现 `assignHost` 方法**

在 `BidService` 追加（紧邻 `listHosts`）：

```typescript
  /**
   * 指派/改派开标主持人（R1 硬分流 / R3 改派窗口）。
   * - leader/staff/admin 调用（角色守卫在 Controller 层）
   * - OpeningSession 已存在 → 409 锁定
   * - userId=null 清除指派（项目回到公开池但 :3007 不可见）
   */
  async assignHost(projectId: string, userId: string | null, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // R3: OpeningSession 存在则锁定改派
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (session) {
      throw new ConflictException({ error: '开标会话已组建，无法改派', code: 'OPENING_SESSION_LOCKED' });
    }

    // 校验目标用户必须是 active bid_host
    if (userId !== null) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
      });
      if (!user || user.role !== 'bid_host' || !user.isActive) {
        throw new BadRequestException({ error: '目标用户不是有效的开标主持人', code: 'INVALID_HOST' });
      }
    }

    return this.prisma.bidProject.update({
      where: { id: projectId },
      data: {
        assignedHostUserId: userId,
        assignedAt: userId ? new Date() : null,
        assignedByUserId: userId ? actorId : null,
      },
      include: {
        assignedHostUser: { select: { id: true, username: true, displayName: true } },
      },
    });
  }
```

- [ ] **Step 5: 修改 `listProjects` 加 actor 参数**

将现有 `async listProjects(stages?: string[])` 改为：

```typescript
  async listProjects(stages?: string[], actor?: { id: string; role: string }) {
    const stageFilter = stages && stages.length > 0 ? { stage: { in: stages as BidStage[] } } : {};
    // R1: bid_host 角色硬过滤——仅看到派给自己的项目；其它角色看全部
    const actorFilter = actor?.role === 'bid_host' ? { assignedHostUserId: actor.id } : {};
    const where = { ...stageFilter, ...actorFilter, isExtractionOnly: false };

    // 当按阶段筛选时返回精简字段（用于搜索选择器）
    // 无筛选时返回完整字段（用于归档/仪表盘等向后兼容）
    if (stages && stages.length > 0) {
      const projects = await this.prisma.bidProject.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          projectCode: true,
          name: true,
          stage: true,
          projectManagementItemId: true,
        },
      });
      return this.resolveDisplayCodes(projects);
    }

    const projects = await this.prisma.bidProject.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { suppliers: true } } },
    });
    return this.resolveDisplayCodes(projects);
  }
```

> 把原来的 `where` 内联字面量替换为上面合并后的 `where` 变量。**两处** `findMany`（精简分支 + 完整分支）都要用同一个 `where` 变量。

- [ ] **Step 6: 修改 `getProjectsDashboard` 加 actor 参数**

将 `async getProjectsDashboard()` 改为：

```typescript
  async getProjectsDashboard(actor?: { id: string; role: string }) {
    const actorFilter = actor?.role === 'bid_host' ? { assignedHostUserId: actor.id } : {};
    const projects = await this.prisma.bidProject.findMany({
      where: { ...actorFilter, isExtractionOnly: false },
```

> 仅在第一个 `findMany` 的 `where` 注入 `actorFilter`，其余 dashboard 聚合逻辑（stageDistribution 等）保持不变。

- [ ] **Step 7: 运行测试，确认通过**

```bash
cd water-erp
pnpm --filter api test -- bid.service.spec.ts 2>&1 | tail -20
```

Expected: 新增 7 个测试全部 PASS，既有测试不退化。

- [ ] **Step 8: Commit**

```bash
cd /home/asus/桌面/ERP
git log --oneline -1   # 确认 HEAD
git add water-erp/apps/api/src/bid/bid.service.ts water-erp/apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): assignHost + listProjects/dashboard 角色过滤

- BidService.assignHost(projectId, userId|null, actorId)：OpeningSession
  存在则 409 OPENING_SESSION_LOCKED；userId 非 bid_host 则 400
  INVALID_HOST；null 清除指派
- listProjects/getProjectsDashboard 加 actor 参数：bid_host 仅看派给自己
  的项目（R1 硬分流），其它角色看全部

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: BidController — PATCH 端点 + GET /bid/hosts + getProject include + 前端 BidProjectDetail 类型

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.controller.ts` — 新增 PATCH + GET hosts + 给 list/dashboard 注入 actor
- Modify: `water-erp/apps/api/src/bid/dto/assign-host.dto.ts` (Create)
- Modify: `water-erp/apps/api/src/bid/bid.service.ts` — `getProject` (~line 296) include
- Modify: `water-erp/apps/web/src/lib/api/bid.ts` — `BidProjectDetail` (~line 458) + 新增 API client
- Test: `water-erp/apps/api/test/bid.e2e-spec.ts` — 追加 describe

**Interfaces:**
- Consumes: Task 2 的 `assignHost` / `listHosts` / `listProjects(actor)` / `getProjectsDashboard(actor)`
- Produces:
  - `PATCH /api/bid/projects/:id/assigned-host { userId: string | null }` → `{ ..., assignedHostUser: { id, username, displayName } | null }`
  - `GET /api/bid/hosts` → `Array<{ id, username, displayName }>`
  - `BidProjectDetail.assignedHostUser` 前端可见
  - `listBidHosts()` / `assignBidHost(projectId, userId)` 前端 API client

- [ ] **Step 1: 创建 `AssignHostDto`**

创建 `water-erp/apps/api/src/bid/dto/assign-host.dto.ts`：

```typescript
import { IsOptional, IsString } from 'class-validator';

/** 指派/改派开标主持人；userId=null 清除指派 */
export class AssignHostDto {
  /** 目标 bid_host 用户 id；传 null/省略 = 清除指派 */
  @IsOptional()
  @IsString()
  userId?: string | null;
}
```

- [ ] **Step 2: 写失败 e2e 测试**

在 `water-erp/apps/api/test/bid.e2e-spec.ts` 末尾追加（参考既有 `loginAs` helper）：

```typescript
describe('Bid host assignment (e2e)', () => {
  it('GET /bid/hosts 返回 bid_host 用户列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/bid/hosts')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((u: any) => u.username === '陈源远')).toBe(true);
  });

  it('PATCH /bid/projects/:id/assigned-host — leader 可指派', async () => {
    // 取一个 DOWNLOAD/SUBMIT 阶段、未组建会话的项目
    const project = await prisma.bidProject.findFirst({
      where: { stage: { in: ['DOWNLOAD', 'SUBMIT'] } },
    });
    if (!project) return; // 种子若无合适项目则跳过

    const host = await prisma.user.findFirst({
      where: { role: 'bid_host', isActive: true },
    });
    if (!host) return;

    const res = await request(app.getHttpServer())
      .patch(`/api/bid/projects/${project.id}/assigned-host`)
      .set('Cookie', adminCookie)
      .send({ userId: host.id })
      .expect(200);
    expect(res.body.assignedHostUser).toBeTruthy();
    expect(res.body.assignedHostUser.id).toBe(host.id);

    // 清理：清除指派（避免影响其它测试）
    await request(app.getHttpServer())
      .patch(`/api/bid/projects/${project.id}/assigned-host`)
      .set('Cookie', adminCookie)
      .send({ userId: null })
      .expect(200);
  });

  it('PATCH 非法 userId → 400 INVALID_HOST', async () => {
    const project = await prisma.bidProject.findFirst();
    if (!project) return;
    // 用一个 supplier 的 id（不可能是 bid_host）
    const supplier = await prisma.user.findFirst({ where: { role: 'supplier' } });
    if (!supplier) return;
    await request(app.getHttpServer())
      .patch(`/api/bid/projects/${project.id}/assigned-host`)
      .set('Cookie', adminCookie)
      .send({ userId: supplier.id })
      .expect(400);
  });

  it('listProjects 对 bid_host 仅返回派给自己的项目', async () => {
    // 用 陈源远 bid_host 登录（web portal cookie）
    const hostCookie = await loginAs(app, '陈源远', '陈源远@2026', 'web');
    const res = await request(app.getHttpServer())
      .get('/api/bid/projects')
      .set('Cookie', hostCookie)
      .expect(200);
    // 结果数组里每个项目的 assignedHostUserId 都应是 陈源远.id 或被回填（seed 后非空）
    const cyy = await prisma.user.findFirst({ where: { username: '陈源远', role: 'bid_host' } });
    if (cyy) {
      // 注：seed 回填后所有项目都派给陈源远，所以全部应可见
      for (const p of res.body) {
        // 不能直接断言 assignedHostUserId（精简分支不返回它），改为间接：
        // bid_host 能看到 = 这些项目被派给他。这里只断言请求成功。
      }
    }
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

> 注：seed 回填后所有种子项目派给陈源远，所以陈源远能看到全部；新演示项目不指派则看不到。这个测试主要验证端点不报错 + 200。完整硬分流的断言放 Task 6 手动验证。

- [ ] **Step 3: 运行测试，确认失败**

```bash
cd water-erp
pnpm --filter api test:e2e -- bid.e2e-spec.ts 2>&1 | tail -30
```

Expected: 新增测试 FAIL（404 — 端点不存在）。

- [ ] **Step 4: Controller 加新端点 + 注入 actor**

在 `water-erp/apps/api/src/bid/bid.controller.ts` 顶部 import 块追加 DTO import：

```typescript
import { AssignHostDto } from './dto/assign-host.dto';
```

把 `listProjects` 端点改为注入 actor（修改现有 `@Get('projects')`）：

```typescript
  @Get('projects')
  @ApiOperation({ summary: '项目列表（可选阶段过滤；bid_host 仅看派给自己的）' })
  listProjects(
    @Query('stage') stage?: string | string[],
    @CurrentUser('sub') userId?: string,
    @Req() req?: any,
  ) {
    const stages = stage ? (Array.isArray(stage) ? stage : [stage]) : undefined;
    const actor = userId && req?.user?.role ? { id: userId, role: req.user.role } : undefined;
    return this.bidService.listProjects(stages, actor);
  }
```

同样修改 `@Get('projects/dashboard')`：

```typescript
  @Get('projects/dashboard')
  @ApiOperation({ summary: 'Dashboard 聚合（bid_host 仅看派给自己的）' })
  getProjectsDashboard(
    @CurrentUser('sub') userId?: string,
    @Req() req?: any,
  ) {
    const actor = userId && req?.user?.role ? { id: userId, role: req.user.role } : undefined;
    return this.bidService.getProjectsDashboard(actor);
  }
```

在 controller 类内（建议紧邻 `listProjects` 之后）追加两个新端点：

```typescript
  @Get('hosts')
  @Roles('leader', 'staff', 'admin')
  @ApiOperation({ summary: '列出可指派的开标主持人（:3005 选择器）' })
  listHosts() { return this.bidService.listHosts(); }

  @Patch('projects/:id/assigned-host')
  @Roles('leader', 'staff', 'admin')
  @ApiOperation({ summary: '指派/改派开标主持人（OpeningSession 存在前可改）' })
  assignHost(
    @Param('id') id: string,
    @Body() body: AssignHostDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.bidService.assignHost(id, body.userId ?? null, actorId);
  }
```

- [ ] **Step 5: `getProject` include 加 assignedHostUser**

在 `bid.service.ts` 的 `getProject` 方法（~line 296）的 `include` 块追加：

```typescript
  async getProject(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: true } },
        scoreItems: true,
        clarifications: true,
        supervisionLogs: { orderBy: { time: 'desc' } },
        expertDisputes: { orderBy: { createdAt: 'desc' } },
        archiveItems: true,
        bidRounds: { orderBy: { roundNo: 'asc' } },
        assignedHostUser: { select: { id: true, username: true, displayName: true } }, // 开标主持人指派
      },
    });
    // ... 既有逻辑保持不变
  }
```

- [ ] **Step 6: 运行 e2e 测试，确认通过**

```bash
cd water-erp
pnpm --filter api test:e2e -- bid.e2e-spec.ts 2>&1 | tail -30
```

Expected: 新增测试 PASS。

- [ ] **Step 7: 前端 `BidProjectDetail` 加字段 + API client**

在 `water-erp/apps/web/src/lib/api/bid.ts` 的 `BidProjectDetail` interface（~line 458）末尾追加字段：

```typescript
export interface BidProjectDetail {
  // ... 既有字段 ...
  archiveItems: BidArchiveItemInfo[];
  // ── 开标主持人指派（R1 硬分流）──
  assignedHostUserId?: string | null;
  assignedHostUser?: { id: string; username: string; displayName: string } | null;
}
```

在同一文件合适位置（紧邻 `getBidProjectDetail` 函数之后）追加 API client：

```typescript
/** 列出可指派的开标主持人账号 */
export function listBidHosts() {
  return api.get<Array<{ id: string; username: string; displayName: string }>>('/bid/hosts');
}

/** 指派/改派/清除开标主持人。userId=null 清除指派 */
export function assignBidHost(projectId: string, userId: string | null) {
  return api.patch<{ id: string; assignedHostUser: { id: string; username: string; displayName: string } | null }>(
    `/bid/projects/${projectId}/assigned-host`,
    { userId },
  );
}
```

- [ ] **Step 8: 类型检查 + lint**

```bash
cd water-erp
pnpm --filter api exec tsc --noEmit -p apps/api/tsconfig.json 2>&1 | tail -10
pnpm --filter @water-erp-web lint 2>&1 | tail -10 || true   # 若 lint script 存在
```

Expected: 无新增 TS 错误。

- [ ] **Step 9: Commit**

```bash
cd /home/asus/桌面/ERP
git log --oneline -1
git add water-erp/apps/api/src/bid/bid.controller.ts \
        water-erp/apps/api/src/bid/dto/assign-host.dto.ts \
        water-erp/apps/api/src/bid/bid.service.ts \
        water-erp/apps/web/src/lib/api/bid.ts \
        water-erp/apps/api/test/bid.e2e-spec.ts
git commit -m "feat(bid): PATCH /bid/projects/:id/assigned-host + GET /bid/hosts

- 新端点 PATCH 指派/改派主持人（leader/staff/admin），DTO AssignHostDto
- 新端点 GET /bid/hosts 列出 bid_host 账号（:3005 选择器）
- listProjects/getProjectsDashboard 注入 actor，bid_host 仅看派给自己的
- getProject include assignedHostUser，前端 BidProjectDetail 类型同步
- 新增 e2e：指派/非法用户/listHosts/listProjects 过滤

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: startOpening 加指派前置闸门

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts` — `startOpeningInternal` (~line 886)
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `assignedHostUserId` 列
- Produces: `startOpening` 阶段推进（isTransitioning）时若 `assignedHostUserId IS NULL` → 抛 `BadRequestException({ code: 'HOST_NOT_ASSIGNED' })`

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 末尾追加（独立 describe，因为 startOpeningInternal 是 private，需通过 startOpening 公开方法 + mock 上下文）：

```typescript
describe('startOpening 指派前置闸门 (R2)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn(), // 第一次返回 project，第二次返回 assignedHostUserId
      },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      bidExpert: { count: jest.fn().mockResolvedValue(3) },
      bidSupplier: { count: jest.fn().mockResolvedValue(3) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('未指派主持人 + 阶段推进 → 抛 HOST_NOT_ASSIGNED', async () => {
    // 第一次 findUnique（startOpeningInternal 顶部）：项目存在，stage=SUBMIT，deadline 已过
    prisma.bidProject.findUnique
      .mockResolvedValueOnce({
        id: 'p1', stage: 'SUBMIT', name: 't', deadline: '2020-01-01',
        projectManagementItemId: null, round: 1,
      })
      // 第二次 findUnique（指派闸门）：assignedHostUserId 为 null
      .mockResolvedValueOnce({ assignedHostUserId: null });

    await expect(service.startOpening('p1', undefined, 'actor1'))
      .rejects.toMatchObject({ response: { code: 'HOST_NOT_ASSIGNED' } });
  });

  it('已指派主持人 → 不抛 HOST_NOT_ASSIGNED（继续走后续 deadline/checklist）', async () => {
    prisma.bidProject.findUnique
      .mockResolvedValueOnce({
        id: 'p1', stage: 'SUBMIT', name: 't', deadline: '2020-01-01',
        projectManagementItemId: null, round: 1,
      })
      .mockResolvedValueOnce({ assignedHostUserId: 'host1' });
    // 后续会走到 checklist，这里 expert/supplier count 都 OK，再走到会话字段校验
    // 因为 dto 不提供 session 字段，会落到「仅推进阶段」分支，最终 updateMany/transaction
    prisma.bidProject.update = jest.fn().mockResolvedValue({});
    prisma.bidProject.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.bidSupplier.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.bidExpert.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.bidOpeningSession.create = jest.fn().mockResolvedValue({});
    prisma.notification = { createMany: jest.fn() };
    prisma.bidOpeningRecord = { createMany: jest.fn() };

    // 不 reject 即代表通过指派闸门（后续即便因别的原因失败也无所谓）
    try {
      await service.startOpening('p1', undefined, 'actor1');
    } catch (e: any) {
      // 若抛错，code 不应是 HOST_NOT_ASSIGNED
      expect(e?.response?.code).not.toBe('HOST_NOT_ASSIGNED');
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd water-erp
pnpm --filter api test -- bid.service.spec.ts 2>&1 | tail -20
```

Expected: 第一个测试 FAIL（未指派却没抛 HOST_NOT_ASSIGNED）。

- [ ] **Step 3: 在 `startOpeningInternal` 加闸门**

在 `bid.service.ts` 的 `startOpeningInternal` 方法（~line 886），在 `// P1: 截标时间校验` 注释**之前**（即 `if (isTransitioning && new Date() < ...)` 之前）插入：

```typescript
    // R2: 指派前置闸门——阶段推进（确定开标）时必须已指派主持人
    if (isTransitioning) {
      const hostAssign = await this.prisma.bidProject.findUnique({
        where: { id },
        select: { assignedHostUserId: true },
      });
      if (!hostAssign?.assignedHostUserId) {
        throw new BadRequestException({
          error: '请先指派开标主持人',
          code: 'HOST_NOT_ASSIGNED',
        });
      }
    }

    // P1: 截标时间校验——仅阶段推进（确定开标）时要求投标截止已过；
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd water-erp
pnpm --filter api test -- bid.service.spec.ts 2>&1 | tail -15
```

Expected: 两个新测试 PASS，既有测试不退化。

- [ ] **Step 5: Commit**

```bash
cd /home/asus/桌面/ERP
git log --oneline -1
git add water-erp/apps/api/src/bid/bid.service.ts water-erp/apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): startOpening 指派前置闸门 (R2)

阶段推进（isTransitioning）时若 assignedHostUserId 为空
抛 400 HOST_NOT_ASSIGNED。同阶段调用（:3007 组建会话）不受影响。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Seed 数据 — 新增「开标主持人」账号 + 回填现有项目

**Files:**
- Modify: `water-erp/apps/api/prisma/seed.ts` — 在「陈源远」规整块之后（~line 350）

**Interfaces:**
- Consumes: Task 1 的 `assignedHostUserId` 列 + Task 2 的 schema
- Produces: seed 后存在 2 个 bid_host 账号（陈源远 + 开标主持人）；所有种子 BidProject 派给陈源远

- [ ] **Step 1: 在 `seed.ts` 追加新账号 + 回填**

在「陈源远」规整块（约 line 344-350，以 `console.log(\`    陈源远 ${staffUsers.length} 个账号口令已重置\`);` 结尾）之后插入：

```typescript
  // ═══ 新增「开标主持人」bid_host 账号（演示 :3007 硬分流，与陈源远形成两个可指派对象）═══
  console.log('▶ 创建「开标主持人」bid_host 账号（口令 开标主持人@2026）');
  const hostAssgnHash = hashSync('开标主持人@2026', 10);
  await prisma.user.upsert({
    where: { username_role: { username: '开标主持人', role: 'bid_host' } },
    update: { passwordHash: hostAssgnHash, isActive: true, displayName: '开标主持人' },
    create: {
      username: '开标主持人',
      displayName: '开标主持人',
      role: 'bid_host',
      isActive: true,
      passwordHash: hostAssgnHash,
    },
  });

  // ═══ R6: 回填现有 BidProject 指派给「陈源远」bid_host ═══
  // 避免本次硬分流变更后所有种子项目在 :3007 蒸发（未指派 = :3007 不可见）
  console.log('▶ 回填 BidProject 主持人指派（→ 陈源远 bid_host）');
  const chenBidHost = await prisma.user.findFirst({
    where: { username: '陈源远', role: 'bid_host' },
  });
  if (chenBidHost) {
    const result = await prisma.bidProject.updateMany({
      where: { assignedHostUserId: null },
      data: { assignedHostUserId: chenBidHost.id, assignedAt: new Date() },
    });
    console.log(`    回填 ${result.count} 个项目 → 陈源远`);
  } else {
    console.warn('    ⚠ 未找到 陈源远 bid_host，跳过回填');
  }
```

然后在文件末尾的登录提示区块（约 line 391 `console.log('    [开评标管理端 :3007]  陈源远 / 陈源远@2026');`）后面追加一行：

```typescript
  console.log('    [开评标管理端 :3007]  开标主持人 / 开标主持人@2026（演示硬分流）');
```

- [ ] **Step 2: 运行 seed 验证**

```bash
cd water-erp
pnpm db:seed 2>&1 | tail -30
```

Expected: 输出含「创建『开标主持人』bid_host 账号」「回填 N 个项目 → 陈源远」「[开评标管理端 :3007] 开标主持人 / 开标主持人@2026」。

- [ ] **Step 3: DB 直接验证**

```bash
docker exec water-erp-postgres psql -U water_erp -d water_erp -c \
  "SELECT username, role FROM \"User\" WHERE role='bid_host';"
docker exec water-erp-postgres psql -U water_erp -d water_erp -c \
  "SELECT COUNT(*) FILTER (WHERE \"assignedHostUserId\" IS NULL) AS unassigned, COUNT(*) AS total FROM \"BidProject\";"
```

Expected: 2 个 bid_host 用户（陈源远 + 开标主持人）；BidProject unassigned = 0（全回填）。

- [ ] **Step 4: Commit**

```bash
cd /home/asus/桌面/ERP
git log --oneline -1
git add water-erp/apps/api/prisma/seed.ts
git commit -m "feat(seed): 新增「开标主持人」bid_host + 回填现有项目指派

- 新增账号 开标主持人 / 开标主持人@2026（演示硬分流）
- 现有 BidProject 全部回填 assignedHostUserId = 陈源远.id
  避免 :3007 硬分流后种子项目不可见

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: :3005 前端 — 「开标主持人」按钮 + 选择 Modal + 按时开标闸门

**Files:**
- Modify: `water-erp/apps/web/src/components/projects/bid-confirm-panel.tsx` — import + state + 按钮行 (~line 799-806) + 闸门
- Create: `water-erp/apps/web/src/components/projects/bid-confirm/host-picker-modal.tsx`

**Interfaces:**
- Consumes: Task 3 的 `listBidHosts()` / `assignBidHost()` API client + `BidProjectDetail.assignedHostUser`
- Produces: 「开标主持人」按钮（显示当前指派）+ Modal（单选 + 清除）+ 按时开标未指派时禁用

- [ ] **Step 1: 创建 `HostPickerModal` 组件**

创建 `water-erp/apps/web/src/components/projects/bid-confirm/host-picker-modal.tsx`：

```tsx
'use client';

import { useEffect, useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import { assignBidHost, listBidHosts } from '@/lib/api/bid';

type Host = { id: string; username: string; displayName: string };

type Props = {
  projectId: string;
  currentHostId: string | null;
  onClose: () => void;
  onChanged: (host: Host | null) => void;
};

export function HostPickerModal({ projectId, currentHostId, onClose, onChanged }: Props) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selected, setSelected] = useState<string | null>(currentHostId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBidHosts()
      .then(setHosts)
      .catch(() => setError('加载主持人列表失败'));
  }, []);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await assignBidHost(projectId, selected);
      onChanged(res.assignedHostUser ?? null);
      onClose();
    } catch (e: any) {
      const code = e?.response?.data?.code;
      if (code === 'OPENING_SESSION_LOCKED') setError('开标会话已组建，无法改派');
      else if (code === 'INVALID_HOST') setError('目标用户不是有效的主持人');
      else setError('指派失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center px-6"
      style={{ background: 'oklch(0.975 0.012 258 / 0.5)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="w-full max-w-[380px] rounded-[20px] px-6 py-5"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-[10px]"
            style={{
              background: 'var(--stage-evaluation-soft)',
              boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)',
            }}
          >
            <UserCheck size={15} style={{ color: 'var(--stage-evaluation)' }} />
          </div>
          <span className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">指派开标主持人</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--foreground)_8%,transparent)]"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <p className="mb-3 text-xs leading-5 text-[var(--muted-foreground)]">
          指派后，该项目仅在 :3007 开评标管理端对<span className="font-semibold">被指派的主持人</span>可见；其它主持人看不到。
        </p>

        <div className="mb-4 max-h-[260px] space-y-1.5 overflow-y-auto">
          <label
            className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
            style={{ border: '1px solid oklch(0.6 0.04 258 / 0.08)' }}
          >
            <input
              type="radio"
              name="bid-host"
              className="accent-[var(--accent)]"
              checked={selected === null}
              onChange={() => setSelected(null)}
            />
            <span className="text-sm text-[var(--muted-foreground)]">清除指派（公开池，:3007 不可见）</span>
          </label>
          {hosts.map((h) => (
            <label
              key={h.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
              style={{ border: '1px solid oklch(0.6 0.04 258 / 0.08)' }}
            >
              <input
                type="radio"
                name="bid-host"
                className="accent-[var(--accent)]"
                checked={selected === h.id}
                onChange={() => setSelected(h.id)}
              />
              <span className="text-sm text-[var(--foreground)]">{h.displayName}</span>
              <span className="ml-auto text-xs text-[var(--muted-foreground)]">@{h.username}</span>
            </label>
          ))}
        </div>

        {error && (
          <div className="mb-3 rounded-lg px-3 py-2 text-xs font-medium text-[var(--danger)]"
            style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="neu-btn-soft !h-[36px] !text-xs">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="neu-btn-primary !h-[36px] !text-xs"
          >
            <UserCheck size={13} /> 确认指派
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 `bid-confirm-panel.tsx` — import + state**

在文件顶部 import 块的 lucide-react 导入里加 `UserCheck`：

```typescript
import {
  AlertTriangle,
  Bell,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Gavel,
  RefreshCw,
  Shield,
  UserCheck,   // ← 新增
  Users,
  X,
} from 'lucide-react';
```

在组件内 import 区块加：

```typescript
import { HostPickerModal } from './bid-confirm/host-picker-modal';
```

在组件 state 区块（`const [toast, setToast] = ...` 附近）追加：

```typescript
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
```

- [ ] **Step 3: 派生当前指派 + 锁定状态**

在 `detail` state 之后、`refreshDetail` 之前追加派生值：

```typescript
  /** 当前指派的开标主持人（来自 detail）；null = 未指派 */
  const assignedHost = detail?.assignedHostUser ?? null;
  /** :3007 是否已组建开标会话（= 改派锁定）*/
  const openingSessionExists = !!detail?.openingSession;
```

- [ ] **Step 4: 在按钮行插入「开标主持人」按钮 + 渲染 Modal**

找到 `{(stage === 'DOWNLOAD' || stage === 'SUBMIT') && (` 区块（约 line 798-807），改为：

```tsx
                <div className="ml-auto flex items-center gap-2">
                  {(stage === 'DOWNLOAD' || stage === 'SUBMIT') && (
                    <>
                      <button
                        type="button"
                        onClick={() => setHostPickerOpen(true)}
                        disabled={busy || openingSessionExists}
                        className="neu-btn-soft !h-[36px]"
                        title={
                          openingSessionExists
                            ? '已锁定（开标会话已组建）'
                            : assignedHost
                              ? `主持人：${assignedHost.displayName}`
                              : '未指派'
                        }
                      >
                        <UserCheck size={14} />
                        开标主持人
                        <span className={assignedHost ? '' : 'text-[var(--warning)]'}>
                          ▾ {assignedHost ? assignedHost.displayName : '未指派'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDelayOpen(true)}
                        disabled={busy}
                        className="neu-btn-soft !h-[36px]"
                      >
                        <CalendarClock size={14} /> 延时开标
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStartOpening()}
                        disabled={busy || !assignedHost}
                        className="neu-btn-primary !h-[36px]"
                        title={!assignedHost ? '请先指派开标主持人' : undefined}
                      >
                        <CheckCircle2 size={14} /> 按时开标
                      </button>
                    </>
                  )}
                  {stage === 'OPENING' && (
```

> 三处改动：
> 1. 新按钮「开标主持人」在最左，禁用条件 `busy || openingSessionExists`
> 2. 「按时开标」`disabled` 条件从 `busy` 改为 `busy || !assignedHost`
> 3. 既有「延时开标」按钮位置不变（在新按钮和按时开标之间）

然后在 toast 渲染区块**之前**（约 line 838，紧跟决策栏 `</div>` 之后、`{/* ── toast ── */}` 之前）追加 Modal 渲染：

```tsx
        {/* ── 开标主持人选择 Modal ── */}
        {hostPickerOpen && bidProject && (
          <HostPickerModal
            projectId={bidProject.id}
            currentHostId={assignedHost?.id ?? null}
            onClose={() => setHostPickerOpen(false)}
            onChanged={() => {
              setHostPickerOpen(false);
              refreshDetail();
            }}
          />
        )}
```

- [ ] **Step 5: 类型检查**

```bash
cd water-erp
pnpm --filter @water-erp-web exec tsc --noEmit 2>&1 | tail -15
```

Expected: 无新增 TS 错误（`UserCheck` import 已加；`assignedHost` / `openingSessionExists` 派生自既有 detail 类型）。

> 若 `@water-erp/web` 的 tsc 命令名不同，用 `pnpm --filter web exec tsc --noEmit` 或 `pnpm --filter web typecheck`。

- [ ] **Step 6: 手动验证**

```bash
cd water-erp
pnpm dev:web    # :3005
pnpm dev:bid    # :3007
```

手动测试：
1. :3005 登录 `Swhi-CGZX-01` / `Swhi-CGZX-01@2026`
2. 进任意项目 → 「开标确认」面板
3. 看到底部新按钮「开标主持人 ▾ 陈源远」（seed 回填后默认陈源远）
4. 「按时开标」按钮可点（已指派）
5. 点「开标主持人」→ Modal 列出 陈源远 + 开标主持人 + 「清除指派」→ 选「开标主持人」→ 确认指派
6. 按钮变「开标主持人 ▾ 开标主持人」
7. :3007 登录 陈源远 / 陈源远@2026 → 任务板**看不到**该项目（已改派给开标主持人）
8. :3007 登录 开标主持人 / 开标主持人@2026 → 任务板**能看到**该项目
9. 回 :3005 把指派清除（选「清除指派」）→ :3007 两位主持人都看不到该项目

- [ ] **Step 7: Commit**

```bash
cd /home/asus/桌面/ERP
git log --oneline -1
git add water-erp/apps/web/src/components/projects/bid-confirm-panel.tsx \
        water-erp/apps/web/src/components/projects/bid-confirm/host-picker-modal.tsx
git commit -m "feat(web): :3005 开标确认面板新增「开标主持人」按钮 + 选择 Modal

- 新按钮在「延时开标」之前，显示当前指派主持人（或「未指派」）
- HostPickerModal：单选 bid_host 列表 + 清除指派，调 PATCH 端点
- 「按时开标」未指派时禁用（title 提示请先指派）—— R2 前端闸门
- 开标会话组建后按钮转只读（disabled + title 已锁定）—— R3

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | 实现任务 |
|---|---|
| R1 硬分流（:3007 仅显示派给我） | Task 2 listProjects 过滤 + Task 3 controller 注入 actor |
| R2 指派前置（按时开标闸门） | Task 4 startOpeningInternal 闸门 + Task 6 前端按钮 disabled |
| R3 改派窗口（OpeningSession 锁定） | Task 2 assignHost 409 + Task 6 按钮 disabled + Modal 错误提示 |
| R4 leader/staff/admin 看全部 + 补位通道 | Task 2/3 listProjects 不追加过滤 for 非 bid_host + Task 3 PATCH 角色守卫 |
| R5 新增「开标主持人」bid_host | Task 5 seed.ts upsert |
| R6 回填现有项目 | Task 5 seed.ts updateMany |
| 数据模型（assignedHostUserId 等） | Task 1 schema + migration |
| PATCH /bid/projects/:id/assigned-host | Task 3 controller + DTO |
| GET /bid/hosts | Task 3 controller + Task 2 service listHosts |
| BidProjectDetail.assignedHostUser | Task 3 getProject include + 前端类型 |
| :3005 按钮 + Modal | Task 6 |
| :3007 零改动（纯后端过滤） | 无需任务（已在 Task 2/3 后端实现） |
| 边缘 case：删除公告 stage 回退保留指派 | 自动满足（只改 stage 字段，不动 assignedHostUserId） |
| 多轮项目独立指派（V1 不继承） | 自动满足（每轮 BidProject 独立 row） |

### 2. Placeholder scan

- 无 "TBD" / "TODO" / "implement later"
- 所有代码块含完整实现
- 测试代码完整（含 mock setup）
- `pnpm --filter @water-erp-web lint` / `pnpm --filter @water-erp-web exec tsc` 命令名若不准确，执行时按实际 workspace 名（`web` 或 `@water-erp/web`）调整 —— 这是执行细节，非设计 placeholder

### 3. Type consistency

- `assignedHostUser: { id, username, displayName }` — 后端 select、前端 type、Modal props、onChanged 回调签名全部一致 ✓
- `listBidHosts()` / `assignBidHost(projectId, userId)` — API client (Task 3) 与 Modal (Task 6) 调用一致 ✓
- `assignHost(projectId, userId, actorId)` — service 方法签名 (Task 2) 与 controller 调用 (Task 3) 一致 ✓
- `listProjects(stages, actor)` / `getProjectsDashboard(actor)` — service 签名 (Task 2) 与 controller 调用 (Task 3) 一致 ✓
- 错误 code 全用 SCREAMING_SNAKE：`OPENING_SESSION_LOCKED` / `INVALID_HOST` / `HOST_NOT_ASSIGNED` / `NOT_FOUND` — 后端 throw、前端 catch、e2e 断言一致 ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-06-bid-host-assignment.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan since tasks have clear boundaries (schema → service → controller → gate → seed → UI) and each is independently testable.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for your review.

**Which approach?**

> Local branch is **15 commits** ahead of `origin/main` (spec + plan + other session's L1+L6 + your earlier work). Not pushing until you say so.
