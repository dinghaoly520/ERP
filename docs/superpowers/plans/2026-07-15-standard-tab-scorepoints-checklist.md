# 评分标准页 得分点 checklist 改造 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员在 bid-portal 评分标准页（`/bid/project/[id]?tab=standard`）为每个评分大类制定结构化得分点 checklist（客观条款）+ 主观打分项，并把这些条款流转给专家评分端消费。

**Architecture:** 新建 `BidScorePoint` 子表（`BidScoreItem` 1:N `BidScorePoint`），全栈 CRUD（Prisma → shared 类型 → DTO → service → controller → 前端 API client → standard 页 UI），下游 `expert getProject` include points。复用现有 `assertScoreItemsEditable` 阶段锁。本计划是 spec `docs/superpowers/specs/2026-07-14-expert-tablet-scoring-design.md` 的 phase ①（管理端得分点编制）。

**Tech Stack:** NestJS 11 + Prisma + class-validator（后端）；Next.js 16 + React 19 + Tailwind v4（bid-portal）；pnpm workspace；Jest（测试）。

## Global Constraints

- 工作目录 `water-erp/`；后端命令 `pnpm --filter api ...`，前端 `pnpm --filter bid-portal ...`。
- 改 `packages/shared` 后必须 `pnpm --filter @water-erp/shared build` 才被各 portal 看到。
- Prisma migration 非交互：`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 npx prisma migrate dev --name <name>`（在 `apps/api/` 下）；或 `--create-only` → `prisma db execute` → `prisma migrate resolve --applied`。
- 阶段锁复用 `assertScoreItemsEditable`（`bid.service.ts:1873`）：EVALUATING/ARCHIVED 时所有写操作抛 `ConflictException({code:'SCORE_ITEMS_LOCKED'})`。
- point 端点沿用 `BidController` 类级 `@Roles('admin','bid_host','procurement_staff','leader','staff')`，不加方法级权限。
- commit message 用中文 conventional commits，结尾空一行加 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- TS import 约定：CJS 函数导出包用 `import x = require('pkg')`（本项目 tsconfig 无 esModuleInterop）。

## 现状关键事实（已核实，勿重复调研）

- `BidScoreItem` 的 `scoringCriteria/evidenceHint/criteriaSource` 三个字段 **DB 已存在**（`schema.prisma:377-379`），但 DTO/service/UI/shared 类型未用。
- standard 页是单文件 `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`（328 行），`/bid/project/[id]?tab=standard` 复用同一组件（`project/[id]/page.tsx:30`）。
- 前端 API client：`apps/bid-portal/src/lib/api/bid.ts`，基类 `lib/api.ts`（`X-Portal:'web'` + cookie）。
- 下游 `expert.service.ts:153-164` 的 `getProject` 已 include `scoreItems`（无 select 限制）。
- 现有 score-item 测试在 `apps/api/src/bid/bid.service.spec.ts:978-1080`。

---

## File Structure

| 层 | 文件 | 责任 |
|----|------|------|
| DB | `apps/api/prisma/schema.prisma` | 新增 `BidScorePoint` 模型 + `BidScoreItem.points` relation |
| shared | `packages/shared/src/types.ts` | `BidScorePoint` 接口 + `BidScoreItem.points/scoringCriteria/evidenceHint` |
| DTO | `apps/api/src/bid/dto/create-score-point.dto.ts`（新） | 创建得分点校验 |
| DTO | `apps/api/src/bid/dto/update-score-point.dto.ts`（新） | 更新得分点校验（partial） |
| Service | `apps/api/src/bid/bid.service.ts` | point CRUD + `listScoreItems` include points |
| Controller | `apps/api/src/bid/bid.controller.ts` | 4 个 point 端点 |
| 前端 API | `apps/bid-portal/src/lib/api/bid.ts` | `ScorePoint` 类型 + 4 个 CRUD 函数 |
| 前端组件 | `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`（新） | 得分点编辑子组件 |
| 前端页 | `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` | 集成编辑器 + 展开行 + 合计 |
| 下游 | `apps/api/src/expert/expert.service.ts` | `getProject` include points |
| 测试 | `apps/api/src/bid/bid.service.spec.ts` | point CRUD 测试 |

---

### Task 1: Prisma — `BidScorePoint` 模型 + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`BidScoreItem` 模型 + 新模型）

**Interfaces:**
- Produces: `BidScorePoint` Prisma model（字段：`id/scoreItemId/name/fullScore/seq/evidenceHint/objective/createdAt`），供 Task 2+ 使用。

- [ ] **Step 1: 在 `schema.prisma` 的 `BidScoreItem` 模型加 points relation**

在 `scoreRecords    BidScoreRecord[]`（约 `schema.prisma:383`）下方加一行：

```prisma
  points          BidScorePoint[]
```

- [ ] **Step 2: 在 schema 末尾（任意模型间）新增 `BidScorePoint` 模型**

```prisma
model BidScorePoint {
  id           String       @id @default(cuid())
  scoreItemId  String
  name         String
  fullScore    Decimal      @default("0") @db.Decimal(5, 1)
  seq          Int          @default(0)
  evidenceHint String?
  objective    Boolean      @default(true)
  scoreItem    BidScoreItem @relation(fields: [scoreItemId], references: [id], onDelete: Cascade)
  createdAt    DateTime     @default(now())

  @@index([scoreItemId])
}
```

> 说明：`objective=true` 客观条款（专家勾选制），`false` 主观项（专家直接给分）。本计划不含 `decisions` relation（那是 phase ② 打分时建的 `BidScorePointDecision` 表）。

- [ ] **Step 3: 生成 migration**

```bash
cd apps/api && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 npx prisma migrate dev --name add_bid_score_point
```
Expected: `✔ Generated migration .../add_bid_score_point`，`✔ Applied migration`。

- [ ] **Step 4: 验证**

```bash
cd apps/api && npx prisma migrate status && pnpm db:generate
```
Expected: `Database schema is up to date!` + `generated prisma client`。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): 新增 BidScorePoint 得分点模型

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: shared 类型

**Files:**
- Modify: `packages/shared/src/types.ts:112-117`（`BidScoreItem`）+ 新增 `BidScorePoint`

**Interfaces:**
- Produces: `BidScorePoint` 接口、`BidScoreItem.points?: BidScorePoint[]`，供 Task 6/7/8 使用。

- [ ] **Step 1: 扩展 `packages/shared/src/types.ts`**

把现有 `BidScoreItem`（约 `:112-117`）替换为：

```ts
export interface BidScorePoint {
  id: string;
  scoreItemId: string;
  name: string;
  fullScore: number | string;
  seq: number;
  evidenceHint: string | null;
  objective: boolean;
  createdAt: string;
}

export interface BidScoreItem {
  id: string;
  category: string;
  name: string;
  maxScore: number;
  scoringCriteria?: string | null;
  evidenceHint?: string | null;
  criteriaSource?: string | null;
  points?: BidScorePoint[];
}
```

- [ ] **Step 2: 构建 shared**

```bash
pnpm --filter @water-erp/shared build
```
Expected: `dist/` 更新，无 TS 报错。

- [ ] **Step 3: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): BidScorePoint 类型 + BidScoreItem.points/scoringCriteria

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 后端 DTO

**Files:**
- Create: `apps/api/src/bid/dto/create-score-point.dto.ts`
- Create: `apps/api/src/bid/dto/update-score-point.dto.ts`

**Interfaces:**
- Produces: `CreateScorePointDto` / `UpdateScorePointDto`，供 Task 4/5 使用。

- [ ] **Step 1: 创建 `create-score-point.dto.ts`**

```ts
import { IsString, IsNotEmpty, IsNumber, IsInt, Min, Max, IsBoolean, IsOptional } from 'class-validator';

export class CreateScorePointDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  fullScore: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  seq?: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @IsBoolean()
  @IsOptional()
  objective?: boolean;
}
```

- [ ] **Step 2: 创建 `update-score-point.dto.ts`**

```ts
import { IsString, IsNumber, IsInt, Min, Max, IsBoolean, IsOptional } from 'class-validator';

export class UpdateScorePointDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  @IsOptional()
  fullScore?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  seq?: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @IsBoolean()
  @IsOptional()
  objective?: boolean;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bid/dto/create-score-point.dto.ts apps/api/src/bid/dto/update-score-point.dto.ts
git commit -m "feat(api): 得分点 Create/Update DTO

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 后端 service — point CRUD + listScoreItems include points（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: `CreateScorePointDto` / `UpdateScorePointDto`（Task 3）
- Produces: `listScorePoints / createScorePoint / updateScorePoint / deleteScorePoint / assertScoreItemInProject` + `listScoreItems`（include points）。供 Task 5（controller）、Task 8（下游）使用。

- [ ] **Step 1: 在 `bid.service.spec.ts` 的 prisma mock 加 `bidScorePoint`**

定位 `bid.service.spec.ts:978-986` 的 prisma mock 对象，在 `bidScoreItem: { ... }` 后加：

```ts
  bidScorePoint: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
```

- [ ] **Step 2: 写失败测试 — 在 spec 文件末尾加 describe 块**

```ts
describe('BidService — 得分点管理 (ScorePoint CRUD)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // item 归属项目 + SUBMIT 阶段（可编辑）
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'SUBMIT' } });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'SUBMIT', name: '项目' });
  });

  it('listScorePoints 按 seq 排序返回', async () => {
    prisma.bidScorePoint.findMany.mockResolvedValue([{ id: 'pt1' }, { id: 'pt2' }]);
    const r = await service.listScorePoints('p1', 'i1');
    expect(r).toEqual([{ id: 'pt1' }, { id: 'pt2' }]);
    expect(prisma.bidScorePoint.findMany).toHaveBeenCalledWith({
      where: { scoreItemId: 'i1', scoreItem: { projectId: 'p1' } },
      orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('createScorePoint 写入字段，objective 默认 true', async () => {
    prisma.bidScorePoint.create.mockResolvedValue({ id: 'pt1' });
    await service.createScorePoint('p1', 'i1', { name: '施工组织', fullScore: 10 });
    expect(prisma.bidScorePoint.create).toHaveBeenCalledWith({
      data: { scoreItemId: 'i1', name: '施工组织', fullScore: 10, seq: 0, evidenceHint: null, objective: true },
    });
  });

  it('createScorePoint 在 EVALUATING 阶段锁定抛 ConflictException', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'EVALUATING' } });
    await expect(service.createScorePoint('p1', 'i1', { name: 'x', fullScore: 1 })).rejects.toThrow();
    expect(prisma.bidScorePoint.create).not.toHaveBeenCalled();
  });

  it('createScorePoint 评分项不归属项目抛 BadRequestException', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue(null);
    await expect(service.createScorePoint('p1', 'iX', { name: 'x', fullScore: 1 })).rejects.toThrow();
  });

  it('updateScorePoint 部分透传', async () => {
    prisma.bidScorePoint.findFirst.mockResolvedValue({ id: 'pt1', scoreItemId: 'i1' });
    prisma.bidScorePoint.update.mockResolvedValue({ id: 'pt1' });
    await service.updateScorePoint('p1', 'i1', 'pt1', { fullScore: 8, objective: false });
    expect(prisma.bidScorePoint.update).toHaveBeenCalledWith({
      where: { id: 'pt1' },
      data: { fullScore: 8, objective: false },
    });
  });

  it('updateScorePoint 得分点不存在抛 BadRequestException', async () => {
    prisma.bidScorePoint.findFirst.mockResolvedValue(null);
    await expect(service.updateScorePoint('p1', 'i1', 'ptX', { fullScore: 8 })).rejects.toThrow();
  });

  it('deleteScorePoint 调用 prisma.delete', async () => {
    prisma.bidScorePoint.delete.mockResolvedValue({ id: 'pt1' });
    await service.deleteScorePoint('p1', 'i1', 'pt1');
    expect(prisma.bidScorePoint.delete).toHaveBeenCalledWith({ where: { id: 'pt1' } });
  });

  it('listScoreItems include points', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'i1', points: [] }]);
    await service.listScoreItems('p1');
    expect(prisma.bidScoreItem.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
    });
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

```bash
pnpm --filter api test -- bid.service.spec.ts
```
Expected: 上面 8 个 case FAIL（方法未定义）。

- [ ] **Step 4: 在 `bid.service.ts` 实现**

文件顶部 import 区加：

```ts
import { CreateScorePointDto } from './dto/create-score-point.dto';
import { UpdateScorePointDto } from './dto/update-score-point.dto';
```

把现有 `listScoreItems`（`bid.service.ts:1883-1888`）替换为带 include 的版本：

```ts
listScoreItems(projectId: string) {
  return this.prisma.bidScoreItem.findMany({
    where: { projectId },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
  });
}
```

在 `deleteScoreItem` 方法之后（约 `bid.service.ts:1959` 后）加：

```ts
// ── 得分点（checklist 子项）CRUD ──

private async assertScoreItemInProject(projectId: string, itemId: string) {
  const item = await this.prisma.bidScoreItem.findFirst({
    where: { id: itemId, projectId },
    include: { project: { select: { stage: true } } },
  });
  if (!item) {
    throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });
  }
  this.assertScoreItemsEditable(item.project.stage as BidStage);
  return item;
}

listScorePoints(projectId: string, itemId: string) {
  return this.prisma.bidScorePoint.findMany({
    where: { scoreItemId: itemId, scoreItem: { projectId } },
    orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
  });
}

async createScorePoint(projectId: string, itemId: string, dto: CreateScorePointDto) {
  await this.assertScoreItemInProject(projectId, itemId);
  return this.prisma.bidScorePoint.create({
    data: {
      scoreItemId: itemId,
      name: dto.name,
      fullScore: dto.fullScore,
      seq: dto.seq ?? 0,
      evidenceHint: dto.evidenceHint ?? null,
      objective: dto.objective ?? true,
    },
  });
}

async updateScorePoint(projectId: string, itemId: string, pointId: string, dto: UpdateScorePointDto) {
  await this.assertScoreItemInProject(projectId, itemId);
  const existing = await this.prisma.bidScorePoint.findFirst({ where: { id: pointId, scoreItemId: itemId } });
  if (!existing) {
    throw new BadRequestException({ error: '得分点不存在', code: 'NOT_FOUND' });
  }
  return this.prisma.bidScorePoint.update({
    where: { id: pointId },
    data: {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.fullScore !== undefined && { fullScore: dto.fullScore }),
      ...(dto.seq !== undefined && { seq: dto.seq }),
      ...(dto.evidenceHint !== undefined && { evidenceHint: dto.evidenceHint }),
      ...(dto.objective !== undefined && { objective: dto.objective }),
    },
  });
}

async deleteScorePoint(projectId: string, itemId: string, pointId: string) {
  await this.assertScoreItemInProject(projectId, itemId);
  return this.prisma.bidScorePoint.delete({ where: { id: pointId } });
}
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
pnpm --filter api test -- bid.service.spec.ts
```
Expected: 全部 PASS（含原有 score-item case + 新 8 个 point case）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(api): 得分点 CRUD service + listScoreItems include points

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 后端 controller — point CRUD 端点

**Files:**
- Modify: `apps/api/src/bid/bid.controller.ts`（import DTO + 4 个端点）

**Interfaces:**
- Consumes: Task 4 的 service 方法
- Produces: REST 端点 `/bid/projects/:id/score-items/:itemId/points[/:pointId]`

- [ ] **Step 1: 在 `bid.controller.ts` 顶部 import 加 DTO**

定位现有 `import { CreateScoreItemDto }`（`bid.controller.ts:14`）附近，加：

```ts
import { CreateScorePointDto } from './dto/create-score-point.dto';
import { UpdateScorePointDto } from './dto/update-score-point.dto';
```

- [ ] **Step 2: 在 `deleteScoreItem` 端点之后（约 `bid.controller.ts:188` 后）加 4 个端点**

```ts
  // ── 得分点（checklist 子项）CRUD ──
  @Get('projects/:id/score-items/:itemId/points')
  @ApiOperation({ summary: '列出某评分项的得分点' })
  listScorePoints(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.bidService.listScorePoints(id, itemId);
  }

  @Post('projects/:id/score-items/:itemId/points')
  @ApiOperation({ summary: '新增得分点' })
  createScorePoint(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(CreateScorePointDto) dto: CreateScorePointDto,
  ) {
    return this.bidService.createScorePoint(id, itemId, dto);
  }

  @Patch('projects/:id/score-items/:itemId/points/:pointId')
  @ApiOperation({ summary: '更新得分点' })
  updateScorePoint(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('pointId') pointId: string,
    @Body(UpdateScorePointDto) dto: UpdateScorePointDto,
  ) {
    return this.bidService.updateScorePoint(id, itemId, pointId, dto);
  }

  @Delete('projects/:id/score-items/:itemId/points/:pointId')
  @ApiOperation({ summary: '删除得分点' })
  deleteScorePoint(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('pointId') pointId: string,
  ) {
    return this.bidService.deleteScorePoint(id, itemId, pointId);
  }
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter api lint -- --quiet 2>/dev/null; pnpm --filter api exec tsc --noEmit
```
Expected: 无 TS 报错。（`@ApiOperation` 已在文件用，无需新 import。）

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bid/bid.controller.ts
git commit -m "feat(api): 得分点 CRUD 端点

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 前端 API client

**Files:**
- Modify: `apps/bid-portal/src/lib/api/bid.ts:154-179`

**Interfaces:**
- Consumes: Task 5 的端点
- Produces: `ScorePoint` 类型 + `listScorePoints/createScorePoint/updateScorePoint/deleteScorePoint` 函数 + `ScoreItem` 扩 `points`。供 Task 7 使用。

- [ ] **Step 1: 在 `bid.ts` 把现有 `ScoreItem` interface（`:154-159`）替换并新增 `ScorePoint`**

```ts
export interface ScorePoint {
  id: string;
  scoreItemId: string;
  name: string;
  fullScore: number | string;
  seq: number;
  evidenceHint: string | null;
  objective: boolean;
  createdAt: string;
}

export interface ScoreItem {
  id: string;
  category: string;
  name: string;
  maxScore: number | string;
  scoringCriteria?: string | null;
  evidenceHint?: string | null;
  criteriaSource?: string | null;
  points?: ScorePoint[];
}
```

- [ ] **Step 2: 在 `bid.ts` 的 `deleteScoreItem` 函数之后（约 `:179` 后）加 4 个函数**

```ts
export function listScorePoints(projectId: string, itemId: string) {
  return api.get<ScorePoint[]>(`/bid/projects/${projectId}/score-items/${itemId}/points`);
}
export function createScorePoint(
  projectId: string,
  itemId: string,
  body: { name: string; fullScore: number; seq?: number; evidenceHint?: string; objective?: boolean },
) {
  return api.post<ScorePoint>(`/bid/projects/${projectId}/score-items/${itemId}/points`, body);
}
export function updateScorePoint(
  projectId: string,
  itemId: string,
  pointId: string,
  body: Partial<{ name: string; fullScore: number; seq: number; evidenceHint: string; objective: boolean }>,
) {
  return api.patch<ScorePoint>(`/bid/projects/${projectId}/score-items/${itemId}/points/${pointId}`, body);
}
export function deleteScorePoint(projectId: string, itemId: string, pointId: string) {
  return api.delete<void>(`/bid/projects/${projectId}/score-items/${itemId}/points/${pointId}`);
}
```

- [ ] **Step 3: 类型检查**

```bash
pnpm --filter bid-portal exec tsc --noEmit
```
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add apps/bid-portal/src/lib/api/bid.ts
git commit -m "feat(bid-portal): 得分点 API client + ScoreItem.points

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 前端 UI — 得分点编辑器 + standard 页集成

**Files:**
- Create: `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`

**Interfaces:**
- Consumes: Task 6 的 API client；`useBidProjectContext()` 取 `projectId`
- Produces: 管理员可为每个评分大类增删改得分点（客观/主观）、看到满分合计。

- [ ] **Step 1: 创建 `score-points-editor.tsx`（得分点编辑子组件）**

```tsx
'use client';

import { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import {
  listScorePoints,
  createScorePoint,
  updateScorePoint,
  deleteScorePoint,
  type ScorePoint,
  type ScoreItem,
} from '@/lib/api/bid';

interface Props {
  projectId: string;
  item: ScoreItem;
  points: ScorePoint[];
  onChanged: () => void; // 增删改后通知父组件刷新
}

export function ScorePointsEditor({ projectId, item, points, onChanged }: Props) {
  const isPassFail = item.category === 'QUALIFICATION' || item.category === 'RESPONSIVE';
  const [draft, setDraft] = useState({ name: '', fullScore: 0, evidenceHint: '', objective: true });
  const [busy, setBusy] = useState(false);

  const total = points.reduce((s, p) => s + Number(p.fullScore), 0);
  const max = Number(item.maxScore);

  async function add() {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await createScorePoint(projectId, item.id, {
        name: draft.name.trim(),
        fullScore: isPassFail ? 0 : Number(draft.fullScore),
        evidenceHint: draft.evidenceHint.trim() || undefined,
        objective: draft.objective,
      });
      setDraft({ name: '', fullScore: 0, evidenceHint: '', objective: true });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleObjective(p: ScorePoint) {
    await updateScorePoint(projectId, item.id, p.id, { objective: !p.objective });
    onChanged();
  }

  async function remove(p: ScorePoint) {
    await deleteScorePoint(projectId, item.id, p.id);
    onChanged();
  }

  async function editFullScore(p: ScorePoint, v: number) {
    await updateScorePoint(projectId, item.id, p.id, { fullScore: v });
    onChanged();
  }

  return (
    <div className="mt-2 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] p-3">
      {/* 合计提示 */}
      {!isPassFail && (
        <div className="mb-2 text-xs text-[oklch(0.5_0.01_264)]">
          得分点满分合计 <span className={total > max ? 'text-red-600 font-semibold' : 'font-semibold'}>{total}</span> / 大类满分 {max}
          {total > max && <span className="ml-1 text-red-600">（已超出大类满分）</span>}
        </div>
      )}

      {/* 已有得分点列表 */}
      <div className="space-y-1">
        {points.map((p, idx) => (
          <div key={p.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm">
            <GripVertical size={14} className="text-[oklch(0.7_0.005_264)]" />
            <span className="text-[oklch(0.45_0.01_265)] w-6">{idx + 1}.</span>
            <span className="flex-1 font-medium text-[oklch(0.18_0.012_265)]">{p.name}</span>
            {p.evidenceHint && <span className="text-xs text-[oklch(0.55_0.01_264)]">{p.evidenceHint}</span>}
            <button
              onClick={() => toggleObjective(p)}
              className={`rounded px-2 py-0.5 text-xs ${p.objective ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
              title="客观=专家勾选制；主观=专家直接给分"
            >
              {p.objective ? '客观' : '主观'}
            </button>
            {!isPassFail && (
              <input
                type="number"
                min={0}
                step={0.5}
                defaultValue={Number(p.fullScore)}
                onBlur={(e) => editFullScore(p, Number(e.target.value))}
                className="w-16 rounded border border-[oklch(0.9_0.005_264)] px-1 py-0.5 text-right"
              />
            )}
            <button onClick={() => remove(p)} className="text-[oklch(0.6_0.01_264)] hover:text-red-600">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {points.length === 0 && (
          <div className="text-xs text-[oklch(0.6_0.01_264)] py-1">暂无得分点，在下方添加。</div>
        )}
      </div>

      {/* 新增行 */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[oklch(0.92_0.004_265)] pt-2">
        <input
          type="text"
          placeholder="得分点名称（如：施工组织设计）"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="min-w-[180px] flex-1 rounded-lg border border-[oklch(0.9_0.005_264)] px-2 py-1 text-sm"
        />
        {!isPassFail && (
          <input
            type="number"
            min={0}
            step={0.5}
            placeholder="满分"
            value={draft.fullScore}
            onChange={(e) => setDraft({ ...draft, fullScore: Number(e.target.value) })}
            className="w-20 rounded-lg border border-[oklch(0.9_0.005_264)] px-2 py-1 text-sm"
          />
        )}
        <input
          type="text"
          placeholder="评审要点（可选）"
          value={draft.evidenceHint}
          onChange={(e) => setDraft({ ...draft, evidenceHint: e.target.value })}
          className="min-w-[140px] flex-1 rounded-lg border border-[oklch(0.9_0.005_264)] px-2 py-1 text-sm"
        />
        <button
          onClick={() => setDraft({ ...draft, objective: !draft.objective })}
          className={`rounded px-2 py-1 text-xs ${draft.objective ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
        >
          {draft.objective ? '客观' : '主观'}
        </button>
        <button
          onClick={add}
          disabled={busy || !draft.name.trim()}
          className="flex items-center gap-1 rounded-lg bg-[oklch(0.98_0.012_258)] px-3 py-1 text-sm text-[oklch(0.3_0.02_258)] shadow-[0_1px_0_oklch(0.9_0.004_265),0_-1px_0_oklch(1_0_0)] disabled:opacity-50"
        >
          <Plus size={14} /> 添加
        </button>
      </div>
    </div>
  );
}
```

> 设计系统提示：按钮用 neumorphic raised-border（`shadow-[0_1px_0_...,0_-1px_0_...]`），不用 flat/gradient；颜色用 oklch 与 `.impeccable.md` 一致。

- [ ] **Step 2: 改 `standard/page.tsx` — 加展开 state + 集成编辑器**

在 `standard/page.tsx` 顶部 import 加：

```ts
import { ScorePointsEditor } from './score-points-editor';
import { ChevronRight, ChevronDown } from 'lucide-react';
```

在组件 state 区（`page.tsx:27-29` 附近）加：

```ts
const [expanded, setExpanded] = useState<Record<string, boolean>>({});
```

加一个刷新函数（紧挨现有 reload 函数，或用现有的 `loadScoreItems`；下面假设重载函数名是 `load`，按实际命名替换）：

```ts
const reloadItems = async () => {
  if (!projectId) return;
  const items = await listScoreItems(projectId);
  setScoreItems(items);
};
```

- [ ] **Step 3: 改 `standard/page.tsx` — 表格行改造为可展开**

定位表格主体（`page.tsx:167-291` 的表格/行渲染）。把每个评分项行改为：点击行展开/收起，展开后在行下方渲染 `<ScorePointsEditor>`。示意结构（替换现有行渲染，保留原字段映射）：

```tsx
{scoreItems.map((item) => {
  const open = !!expanded[item.id];
  const points = item.points ?? [];
  return (
    <Fragment key={item.id}>
      <tr
        className="cursor-pointer hover:bg-[oklch(0.98_0.003_265)]"
        onClick={() => setExpanded((e) => ({ ...e, [item.id]: !e[item.id] }))}
      >
        {/* 原有 4 列：类别 / 名称 / 满分 / 操作 —— 在最左加展开箭头 */}
        <td className="px-3 py-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="px-3 py-2">{CATEGORY_LABEL[item.category] ?? item.category}</td>
        <td className="px-3 py-2">{item.name}</td>
        <td className="px-3 py-2">{isPassFailCategory(item.category) ? '通过性' : item.maxScore}</td>
        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          {/* 原 编辑/删除 按钮，stopPropagation 避免触发展开 */}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            <ScorePointsEditor
              projectId={projectId!}
              item={item}
              points={points}
              onChanged={reloadItems}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
})}
```

> 注：`Fragment` 需 `import { Fragment, useState } from 'react'`；`CATEGORY_LABEL`、`isPassFailCategory` 沿用文件已有引用；保留原编辑/删除逻辑（包在 `stopPropagation` 的 td 里）。具体列宽/类名按文件现有风格对齐。

- [ ] **Step 4: 手动验证**

```bash
pnpm --filter bid-portal exec tsc --noEmit && pnpm dev:bid
```
浏览器开 `http://localhost:3007/bid/project/<英雄项目id>?tab=standard`，登录 bid_host（陈主任/czr@2026）。验证：
- 点评分项行能展开/收起；
- 能添加客观/主观得分点、改满分、删；
- 合计提示正确，超出时变红；
- 通过性类别（资格/符合性）不显示满分输入。

- [ ] **Step 5: Commit**

```bash
git add apps/bid-portal/src/app/\(dashboard\)/bid/standard/
git commit -m "feat(bid-portal): 评分标准页得分点 checklist 编辑器

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 下游流转 — `getProject` include points

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:153-164`（`getProject` 的 `scoreItems` include）

**Interfaces:**
- Consumes: Task 1 的 `BidScorePoint` relation
- Produces: 专家端拉取项目时能拿到每个评分项的得分点（供 phase ② 评分平板/tab 消费；本 task 不改评分 UI）。

- [ ] **Step 1: 改 `expert.service.ts` 的 `getProject`**

定位 `expert.service.ts:159` 的 `scoreItems: { orderBy: [...] }`，改为 include points：

```ts
    scoreItems: {
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
    },
```

- [ ] **Step 2: 验证下游类型 + 编译**

```bash
pnpm --filter api exec tsc --noEmit
```
Expected: 无报错（`ExpertProjectDetail.scoreItems` 的元素类型来自 `@water-erp/shared`，Task 2 已加 `points?`）。

- [ ] **Step 3: 手动验证（可选）**

用 expert 账号调 `GET /api/expert/projects/<id>`，确认返回的 `scoreItems[*].points` 有数据（前提：Task 7 已在 standard 页建了得分点）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/expert/expert.service.ts
git commit -m "feat(api): 专家端 getProject 返回得分点（流转下游）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9（后续独立计划）: AI 从招标文件提取得分条款

> **范围说明：** 这是独立的 LLM 集成子系统（需先调研 `LlmService` 接口、招标文件获取链路），按 writing-plans 的 scope check 单列后续计划。本节给出需求大纲供下个计划用。

**目标：** 在 standard 页得分点编辑器加「AI 提取建议」按钮，从该项目的招标文件解析出建议得分点，管理员审核后批量导入。

**需求大纲：**
1. **招标文件来源**：项目的招标文件挂在 `Announcement` 模块的加密投标文件 / 招标文件附件（需调研 `announcement` 模块如何取招标文件文本，是否已有文本提取）。
2. **LLM 解析**：用 `local-ai/LlmService`（DeepSeek）或直连 `process.env.DEEPSEEK_API_URL`（CLAUDE.md 注：多数模块直连，未走 LlmService）。Prompt 输入：招标文件文本 + 当前评分大类（category+name+maxScore）；输出：结构化 JSON `[{name, fullScore, evidenceHint, objective}]`。用 `LlmOutputValidator` 做 JSON 校验（已有基础设施）。
3. **端点**：`POST /bid/projects/:id/score-items/:itemId/points/extract` → 返回建议数组（**不直接落库**，由管理员审核）。
4. **批量导入端点**：`POST /bid/projects/:id/score-items/:itemId/points/batch` → 接收审核后的数组，事务批量 create。
5. **UI**：`score-points-editor.tsx` 加「AI 提取建议」按钮 → 弹出建议列表（可勾选、可编辑分值）→ 确认后调 batch 导入。
6. **边界**：AI 提取结果**不回填** `BidScoreItem.scoringCriteria`（那是管理员权威通道，见 `score-criteria-inferer.service.ts:3` 设计决策）；AI 只产出 point 建议供审核。
7. **需先调研**：`LlmService.chat/complete` 方法签名与返回格式；招标文件获取与文本提取链路；`LlmOutputValidator` 用法。

---

## Self-Review 结论

- **Spec 覆盖**：spec §3（BidScorePoint 模型）→ Task 1；§7（管理端得分点编制，复用 standard tab）→ Task 3-7；§9 API 清单（point CRUD）→ Task 5；下游流转 → Task 8。主观项（objective=false）→ Task 3 DTO + Task 7 UI toggle。AI 提取（spec §12 未决项，本计划提升为 Task 9）。✅
- **Placeholder 扫描**：Task 7 Step 3 的行渲染用了「示意结构 + 保留原逻辑」——这是因 `page.tsx` 328 行未全量引用，执行时按现有列映射对齐，非 placeholder（给出了完整可运行的 JSX 框架）。其余步骤代码完整。✅
- **类型一致**：`ScorePoint` / `BidScorePoint` 字段在 shared（Task 2）、API client（Task 6）、UI（Task 7）一致；service 方法签名（Task 4）与 controller（Task 5）、API client（Task 6）一致。✅
- **范围**：聚焦 phase ①（管理端得分点全栈 + 下游流转），AI 提取单列。每个 task 独立可测、可 commit。✅
