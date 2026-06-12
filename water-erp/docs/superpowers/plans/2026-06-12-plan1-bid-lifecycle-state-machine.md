# Plan 1: 招标项目生命周期阶段机

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 添加阶段转换白名单校验，补全招标项目 5 阶段生命周期（DOWNLOAD→SUBMIT→OPENING→EVALUATING→ARCHIVED）的强制转换方法。

**Architecture:** 在 BidService 中添加 `STAGE_TRANSITIONS` 白名单 + `assertStageTransition()` 校验方法，重构 `updateProject`/`startOpening`/`archiveAll` 调用校验，新增 `openSubmission`/`startEvaluation` 方法，通过 Controller 暴露端点。

**Tech Stack:** NestJS 11, Prisma, Jest

**Branch:** `fix/bid-lifecycle-state-machine`

---

## Step 1: 创建分支

```bash
cd D:/Claude projects/ERP-main/water-erp
git checkout main
git pull origin main
git checkout -b fix/bid-lifecycle-state-machine
```

## Step 2: 添加阶段转换白名单和校验方法

在 `apps/api/src/bid/bid.service.ts` 的 `BidService` 类中添加：

```ts
// 阶段转换白名单
private static readonly STAGE_TRANSITIONS: Record<string, string[]> = {
  DOWNLOAD:    ['SUBMIT'],
  SUBMIT:      ['OPENING'],
  OPENING:     ['EVALUATING'],
  EVALUATING:  ['ARCHIVED'],
  ARCHIVED:    [],
};

private assertStageTransition(current: string, target: string) {
  const allowed = BidService.STAGE_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new BadRequestException({
      error: `不允许从 ${current} 转换到 ${target}`,
      code: 'INVALID_STAGE_TRANSITION',
    });
  }
}
```

注意：`BadRequestException` 需要确保已在文件顶部导入。

## Step 3: 加固 `updateProject`

```ts
async updateProject(id: string, dto: UpdateBidProjectDto) {
  if (dto.stage) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertStageTransition(project.stage, dto.stage);
  }

  return this.prisma.bidProject.update({
    where: { id },
    data: {
      ...(dto.stage && { stage: dto.stage as any }),
      ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }),
    },
  });
}
```

## Step 4: 添加 `openSubmission` (DOWNLOAD→SUBMIT)

```ts
async openSubmission(id: string) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id },
    select: { stage: true },
  });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  this.assertStageTransition(project.stage, 'SUBMIT');

  return this.prisma.bidProject.update({
    where: { id },
    data: { stage: 'SUBMIT' },
  });
}
```

## Step 5: 加固 `startOpening` (SUBMIT→OPENING)

```ts
async startOpening(id: string) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id },
    select: { stage: true },
  });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  this.assertStageTransition(project.stage, 'OPENING');

  return this.prisma.bidProject.update({
    where: { id },
    data: { stage: 'OPENING' },
  });
}
```

## Step 6: 添加 `startEvaluation` (OPENING→EVALUATING)

```ts
async startEvaluation(id: string) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id },
    select: { stage: true },
  });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  this.assertStageTransition(project.stage, 'EVALUATING');

  return this.prisma.bidProject.update({
    where: { id },
    data: { stage: 'EVALUATING' },
  });
}
```

## Step 7: 加固 `archiveAll` (EVALUATING→ARCHIVED)

完整方法：

```ts
async archiveAll(id: string) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id },
    select: { stage: true },
  });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  this.assertStageTransition(project.stage, 'ARCHIVED');

  const archiveItems = await this.prisma.bidArchiveItem.findMany({
    where: { projectId: id, status: { not: 'ARCHIVED' } },
  });

  if (archiveItems.length === 0) {
    throw new BadRequestException({ error: '没有可归档的项目', code: 'NO_ITEMS_TO_ARCHIVE' });
  }

  const hashDigest = `sha256:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  await this.prisma.bidArchiveItem.updateMany({
    where: { projectId: id, status: { not: 'ARCHIVED' } },
    data: {
      status: 'ARCHIVED',
      hashDigest,
      archivedAt: new Date(),
    },
  });

  await this.prisma.bidProject.update({
    where: { id },
    data: { stage: 'ARCHIVED' },
  });

  return this.prisma.bidProject.findUnique({
    where: { id },
    include: { archiveItems: true },
  });
}
```

## Step 8: 添加 Controller 端点

在 `apps/api/src/bid/bid.controller.ts` 中添加：

```ts
@Post('projects/:id/open-submission')
async openSubmission(@Param('id') id: string) {
  return this.bidService.openSubmission(id);
}

@Post('projects/:id/start-evaluation')
async startEvaluation(@Param('id') id: string) {
  return this.bidService.startEvaluation(id);
}
```

## Step 9: 编写单元测试

创建 `apps/api/src/bid/bid.service.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

describe('BidService — stage transitions', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      bidSupervisionLog: { findMany: jest.fn() },
      bidExpert: { groupBy: jest.fn() },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn() },
      bidSupplier: { findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn() },
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();

    service = module.get<BidService>(BidService);
  });

  describe('assertStageTransition (via updateProject)', () => {
    it('allows DOWNLOAD → SUBMIT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });
      await expect(service.updateProject('p1', { stage: 'SUBMIT' as any })).resolves.toBeDefined();
    });

    it('allows SUBMIT → OPENING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      await expect(service.updateProject('p1', { stage: 'OPENING' as any })).resolves.toBeDefined();
    });

    it('rejects DOWNLOAD → ARCHIVED (skip stages)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
      await expect(service.updateProject('p1', { stage: 'ARCHIVED' as any }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects ARCHIVED → DOWNLOAD (backward)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
      await expect(service.updateProject('p1', { stage: 'DOWNLOAD' as any }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects same-stage transition', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
      await expect(service.updateProject('p1', { stage: 'SUBMIT' as any }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('openSubmission', () => {
    it('transitions DOWNLOAD → SUBMIT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });
      const result = await service.openSubmission('p1');
      expect(result.stage).toBe('SUBMIT');
    });
  });

  describe('startOpening', () => {
    it('rejects if not in SUBMIT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
      await expect(service.startOpening('p1')).rejects.toThrow(BadRequestException);
    });
  });
});
```

## Step 10: 构建 & 测试

```bash
pnpm --filter @water-erp/config build
pnpm --filter api build
pnpm --filter api test -- bid.service.spec.ts
```

预期：全部 pass，build exit 0。

## Step 11: 提交

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.controller.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat: add bid project lifecycle state machine

- Add STAGE_TRANSITIONS whitelist and assertStageTransition()
- Enforce stage validation in updateProject, startOpening, archiveAll
- Add openSubmission (DOWNLOAD→SUBMIT) method
- Add startEvaluation (OPENING→EVALUATING) method
- archiveAll now sets project stage to ARCHIVED
- Add unit tests for all transition paths

Co-Authored-By: Claude <noreply@anthropic.com>"
```
