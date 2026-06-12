# Plan 3: 开评标核心逻辑

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** startOpening 创建 BidOpeningSession；decryptSupplier 实现 4 阶段解密流程并创建 BidOpeningRecord。

**Architecture:** 添加 StartOpeningDto/DecryptSupplierDto，增强 BidService 的两个核心方法，更新 Controller 接收 body 参数。

**Tech Stack:** NestJS 11, Prisma, Jest

**Branch:** `fix/bid-opening-logic`

**前置依赖:** Plan 1 (阶段机校验)

---

## Step 1: 创建分支

```bash
cd D:/Claude projects/ERP-main/water-erp
git checkout main
git pull origin main
git checkout -b fix/bid-opening-logic
```

## Step 2: 创建 StartOpeningDto

`apps/api/src/bid/dto/start-opening.dto.ts`：

```ts
import { IsString, IsNotEmpty, IsISO8601 } from 'class-validator';

export class StartOpeningDto {
  @IsString() @IsNotEmpty()
  host: string;

  @IsString() @IsNotEmpty()
  supervisor: string;

  @IsISO8601()
  decryptWindowStart: string;

  @IsISO8601()
  decryptWindowEnd: string;
}
```

## Step 3: 创建 DecryptSupplierDto

`apps/api/src/bid/dto/decrypt-supplier.dto.ts`：

```ts
import { IsString, IsNotEmpty } from 'class-validator';

export class DecryptSupplierDto {
  @IsString() @IsNotEmpty()
  amount: string;

  @IsString() @IsNotEmpty()
  period: string;

  @IsString() @IsNotEmpty()
  qualityTarget: string;

  @IsString() @IsNotEmpty()
  bondStatus: string;
}
```

## Step 4: 增强 `startOpening`

将 `BidService.startOpening` 改为接收 body 并创建 BidOpeningSession：

```ts
async startOpening(id: string, dto: StartOpeningDto) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id },
    select: { stage: true },
  });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  this.assertStageTransition(project.stage, 'OPENING');

  // 创建开标会话
  await this.prisma.bidOpeningSession.create({
    data: {
      projectId: id,
      host: dto.host,
      supervisor: dto.supervisor,
      decryptWindowStart: new Date(dto.decryptWindowStart),
      decryptWindowEnd: new Date(dto.decryptWindowEnd),
      status: '待开标',
    },
  });

  return this.prisma.bidProject.update({
    where: { id },
    data: { stage: 'OPENING' },
  });
}
```

## Step 5: 增强 `decryptSupplier`

实现 4 阶段解密流程：

```ts
async decryptSupplier(projectId: string, supplierId: string, dto: DecryptSupplierDto) {
  const bidSupplier = await this.prisma.bidSupplier.findFirst({
    where: { projectId, id: supplierId },
  });
  if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });

  // 阶段 1: 解密中
  await this.prisma.bidSupplier.update({
    where: { id: supplierId },
    data: { decryptStatus: 'RUNNING' },
  });

  // 阶段 2: 解密成功
  await this.prisma.bidSupplier.update({
    where: { id: supplierId },
    data: { decryptStatus: 'SUCCESS' },
  });

  // 阶段 3: 创建开标记录
  await this.prisma.bidOpeningRecord.create({
    data: {
      projectId,
      supplierName: bidSupplier.supplierName,
      amount: dto.amount,
      period: dto.period,
      qualityTarget: dto.qualityTarget,
      bondStatus: dto.bondStatus,
      decryptResult: '解密成功',
      confirmStatus: '待确认',
    },
  });

  // 阶段 4: 确认
  return this.prisma.bidSupplier.update({
    where: { id: supplierId },
    data: { confirmStatus: 'CONFIRMED' },
  });
}
```

## Step 6: 更新 Controller

在 `apps/api/src/bid/bid.controller.ts` 中更新现有端点：

```ts
import { StartOpeningDto } from './dto/start-opening.dto';
import { DecryptSupplierDto } from './dto/decrypt-supplier.dto';

// 原来: @Post('projects/:id/open') 无参数 → 改为:
@Post('projects/:id/open')
async startOpening(@Param('id') id: string, @Body() dto: StartOpeningDto) {
  return this.bidService.startOpening(id, dto);
}

// 原来: @Post('projects/:id/decrypt/:supplierId') 无 body → 改为:
@Post('projects/:id/decrypt/:supplierId')
async decryptSupplier(
  @Param('id') projectId: string,
  @Param('supplierId') supplierId: string,
  @Body() dto: DecryptSupplierDto,
) {
  return this.bidService.decryptSupplier(projectId, supplierId, dto);
}
```

## Step 7: 构建 & 测试

```bash
pnpm --filter api build
pnpm --filter api test
```

## Step 8: 提交

```bash
git add apps/api/src/bid/
git commit -m "feat: implement bid opening session and record creation

- startOpening now creates BidOpeningSession (host, supervisor, decryptWindow)
- decryptSupplier implements 4-phase decrypt flow (RUNNING→SUCCESS→Record→CONFIRMED)
- BidOpeningRecord created with amount/period/quality/bond status
- Add StartOpeningDto and DecryptSupplierDto with validation

Co-Authored-By: Claude <noreply@anthropic.com>"
```
