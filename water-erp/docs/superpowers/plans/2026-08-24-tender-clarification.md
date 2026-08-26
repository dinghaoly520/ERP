# 招标文件澄清与修改流程（W1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 CTS-EBS01-2016 附录 A A-80~A-86 与附录 B B-011~B-015：供应商就招标文件提出澄清问题、采购中心答复、版本化澄清与修改文件发布、通知已下载供应商 + 醒目公告、供应商下载并回执。

**Architecture:** 新建独立 NestJS 模块 `tender-clarification`（不塞进已过万的 `bid.service.ts`）：三个新 Prisma 模型（问答/版本化澄清文件/下载回执）；时间窗守卫仿照既有 `opening-deadline.util.ts` 模式（常量入 `@water-erp/shared`）；发布联动复用 `NotificationService`（站内通知）与 `AnnouncementService.create`（`CLARIFY_NOTICE` 醒目公告，`isTop`）。供应商端点挂 `supplier-portal` 模块（既有惯例），管理端点在新模块自己的 controller。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、@water-erp/shared 常量、Vue3+Element Plus（:3004 供应商门户）、Next.js+Tailwind（:3005 web）。

## Global Constraints

- 工作目录 `water-erp/`；所有命令从仓库根执行。
- 改 `packages/shared` 后必须 `pnpm --filter @water-erp/shared build`（api 按 dist 消费）。
- 错误响应统一 `{ statusCode, code, error, ... }`（HttpExceptionFilter 已全局）；业务拒绝用 `BadRequestException({ error, code })` / `ForbiddenException({ error, code })`。
- Prisma 迁移非交互：`migrate dev --create-only` → `db execute --file` → `migrate resolve --applied`（本计划含 `ALTER TYPE ADD VALUE`，禁止让 migrate dev 自动执行）。
- 单测命令 `pnpm --filter api test -- <pattern>`；E2E `pnpm --filter api test:e2e -- <pattern>`（带 --forceExit）。
- UI 遵循 `.impeccable.md`（neu-* 拟态、1px hairline、无渐变按钮）；:3005 侧栏不动。
- 提交信息用 conventional commits（仓库现行风格，如 `feat(tender-clarification): ...`）。

## 检测项 → 任务映射

| 检测项 | 要求 | 任务 |
|---|---|---|
| B-011 | 提问最迟投标截止前 10 日 | Task 1/3 |
| B-012 | 澄清文件最迟截止前 15 日发出 | Task 1/5 |
| A-80 | 供应商编辑递交澄清问题 | Task 3 |
| A-81 | 招标人查看并答复 | Task 4 |
| A-82/83 | 澄清与修改文件增删改查、版本号区分 | Task 5 |
| B-013/014 | 通知已获取文件者 + 醒目方式公告 | Task 6 |
| A-85/86 | 供应商下载 + 回执可查看 | Task 7 |
| B-015 | 澄清内容作为招标文件一部分 | Task 5（版本化并入下载范围，导出归档 Task 7 附带） |

---

### Task 1: 时间窗常量与守卫工具（B-011/B-012）

**Files:**
- Modify: `packages/shared/src/constants.ts`（`BID_DEADLINE_BEFORE_OPENING_MS` 定义处附近，约 :251）
- Create: `apps/api/src/tender-clarification/clarification-timing.util.ts`
- Test: `apps/api/src/tender-clarification/clarification-timing.util.spec.ts`

**Interfaces:**
- Produces: `assertAskWithinWindow(deadline: Date, now?: Date): void`（违规抛 `BadRequestException{code:'CLARIFY_ASK_LATE'}`）；`assertIssueWithinWindow(deadline: Date, now?: Date): void`（`CLARIFY_ISSUE_LATE`）；shared 常量 `CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE = 10`、`CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE = 15`。Task 3/5 消费。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/tender-clarification/clarification-timing.util.spec.ts
import { BadRequestException } from '@nestjs/common';
import { assertAskWithinWindow, assertIssueWithinWindow } from './clarification-timing.util';

const DAY = 24 * 3_600_000;
const deadline = new Date('2026-09-30T10:00:00.000Z');

describe('clarification-timing.util（CTS-EBS01 B-011/B-012）', () => {
  const expectReject = (fn: () => void, code: string) => {
    try {
      fn();
      fail(`应当抛 ${code}`);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ code });
    }
  };

  it('B-011：截止前 11 日提问放行', () => {
    expect(() => assertAskWithinWindow(deadline, new Date(deadline.getTime() - 11 * DAY))).not.toThrow();
  });

  it('B-011：截止前 10 日整点为边界放行', () => {
    expect(() => assertAskWithinWindow(deadline, new Date(deadline.getTime() - 10 * DAY))).not.toThrow();
  });

  it('B-011：截止前 9 日提问拒绝 CLARIFY_ASK_LATE', () => {
    expectReject(() => assertAskWithinWindow(deadline, new Date(deadline.getTime() - 9 * DAY)), 'CLARIFY_ASK_LATE');
  });

  it('B-012：截止前 16 日发布放行', () => {
    expect(() => assertIssueWithinWindow(deadline, new Date(deadline.getTime() - 16 * DAY))).not.toThrow();
  });

  it('B-012：截止前 15 日整点为边界放行', () => {
    expect(() => assertIssueWithinWindow(deadline, new Date(deadline.getTime() - 15 * DAY))).not.toThrow();
  });

  it('B-012：截止前 14 日发布拒绝 CLARIFY_ISSUE_LATE', () => {
    expectReject(() => assertIssueWithinWindow(deadline, new Date(deadline.getTime() - 14 * DAY)), 'CLARIFY_ISSUE_LATE');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- clarification-timing`
Expected: FAIL —— `Cannot find module './clarification-timing.util'`

- [ ] **Step 3: shared 常量 + 工具实现**

`packages/shared/src/constants.ts` 在 `BID_DEADLINE_BEFORE_OPENING_MS` 附近追加：

```ts
/** B-011（CTS-EBS01 附录B）：投标人对招标文件澄清提问，最迟在投标截止时间前 N 日提出 */
export const CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE = 10;
/** B-012（CTS-EBS01 附录B）：招标人发出澄清与修改文件，最迟在投标截止时间前 N 日 */
export const CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE = 15;
```

`apps/api/src/tender-clarification/clarification-timing.util.ts`：

```ts
import { BadRequestException } from '@nestjs/common';
import {
  CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE,
  CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE,
} from '@water-erp/shared';

const DAY_MS = 24 * 3_600_000;

function latestAt(deadline: Date, days: number): Date {
  return new Date(deadline.getTime() - days * DAY_MS);
}

/** B-011：供应商澄清提问窗口（投标截止前 10 日）。 */
export function assertAskWithinWindow(deadline: Date, now: Date = new Date()): void {
  const latest = latestAt(deadline, CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE);
  if (now.getTime() > latest.getTime()) {
    throw new BadRequestException({
      error: `澄清提问最迟须在投标截止前 ${CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE} 日（${latest.toISOString()}）提出，现已逾期`,
      code: 'CLARIFY_ASK_LATE',
    });
  }
}

/** B-012：澄清与修改文件发布窗口（投标截止前 15 日）。 */
export function assertIssueWithinWindow(deadline: Date, now: Date = new Date()): void {
  const latest = latestAt(deadline, CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE);
  if (now.getTime() > latest.getTime()) {
    throw new BadRequestException({
      error: `澄清与修改文件最迟须在投标截止前 ${CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE} 日（${latest.toISOString()}）发布，现已逾期`,
      code: 'CLARIFY_ISSUE_LATE',
    });
  }
}
```

- [ ] **Step 4: 构建 shared 并跑测试**

Run: `pnpm --filter @water-erp/shared build && pnpm --filter api test -- clarification-timing`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/constants.ts apps/api/src/tender-clarification/
git commit -m "feat(tender-clarification): B-011/B-012 时间窗守卫（截止前10日提问/15日发布）"
```

---

### Task 2: Prisma 模型与迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`BidClarification` 定义附近 :739 加三模型；`enum AnnouncementType` :1359 加值；`BidProject`/`Supplier` 加反向关系）
- Create: `apps/api/prisma/migrations/<ts>_tender_clarification/migration.sql`（由 prisma 生成）

**Interfaces:**
- Produces: `TenderClarification`（字段见 Step 1 SQL）、`TenderClarificationDoc { @@unique([projectId, version]) }`、`TenderClarificationReceipt { @@unique([docId, supplierId]) }`、`AnnouncementType.CLARIFY_NOTICE`。Task 3 起消费（prisma client 委托类型 `prisma.tenderClarification` / `prisma.tenderClarificationDoc` / `prisma.tenderClarificationReceipt`）。

- [ ] **Step 1: schema 增补**

`apps/api/prisma/schema.prisma` 三处修改：

① `BidClarification` 模型后追加：

```prisma
/// 招标文件澄清问答（CTS-EBS01 A-80/A-81，B-011）——供应商就招标文件提问，采购中心答复。
/// 与 BidClarification（评标澄清，评委→投标人）方向相反，勿混用。
model TenderClarification {
  id           String     @id @default(cuid())
  projectId    String
  supplierId   String?
  supplierName String
  question     String
  attachmentId String? // 提问附件 FileAsset
  status       String     @default("待答复") // 待答复 | 已答复
  answer       String?
  answeredBy   String? // User.id
  answeredAt   DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  project      BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier     Supplier?  @relation(fields: [supplierId], references: [id], onDelete: SetNull)

  @@index([projectId])
}

/// 澄清与修改文件（A-82/A-83，B-012/B-015）——按项目版本递增，发布后并入招标文件下载范围。
model TenderClarificationDoc {
  id          String   @id @default(cuid())
  projectId   String
  version     Int // 第 N 次澄清，项目内从 1 递增
  title       String
  content     String   @default("") // 澄清说明正文
  fileAssetId String? // 澄清文件附件（PDF/DOCX）
  status      String   @default("草稿") // 草稿 | 已发布
  publishedAt DateTime?
  createdBy   String? // User.id
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  project     BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  receipts    TenderClarificationReceipt[]

  @@unique([projectId, version])
}

/// 澄清文件下载回执（A-85/A-86）——下载即回执，:3005 可查回执表。
model TenderClarificationReceipt {
  id           String   @id @default(cuid())
  docId        String
  supplierId   String
  downloadedAt DateTime @default(now())
  receiptedAt  DateTime @default(now()) // 回执递交时间（重复下载刷新）
  doc          TenderClarificationDoc @relation(fields: [docId], references: [id], onDelete: Cascade)
  supplier     Supplier               @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@unique([docId, supplierId])
}
```

② `enum AnnouncementType`（:1359）`PLATFORM // 平台通知` 行后追加：

```prisma
  CLARIFY_NOTICE // 澄清与修改公告（B-014 醒目公告，isTop）
```

③ `BidProject` 模型关系区（`archiveItems` 等反向关系旁）与 `Supplier` 模型关系区各追加：

```prisma
  // BidProject 内：
  tenderClarifications    TenderClarification[]
  tenderClarificationDocs TenderClarificationDoc[]
  // Supplier 内：
  tenderClarifications TenderClarification[]
  clarificationReceipts TenderClarificationReceipt[]
```

- [ ] **Step 2: 生成迁移（只建文件，不执行）**

Run: `pnpm --filter api prisma migrate dev --create-only --name tender_clarification`
Expected: 生成 `apps/api/prisma/migrations/<ts>_tender_clarification/migration.sql`。打开检查：应含 3 个 `CREATE TABLE`、`ALTER TYPE "AnnouncementType" ADD VALUE 'CLARIFY_NOTICE';`、外键与 `@@unique`/`@@index` 约束。

- [ ] **Step 3: 执行迁移（ALTER TYPE 不能在事务内，走 db execute）**

Run:
```bash
pnpm --filter api prisma db execute --file apps/api/prisma/migrations/<ts>_tender_clarification/migration.sql
pnpm --filter api prisma migrate resolve --applied <ts>_tender_clarification
pnpm --filter api prisma generate
```
Expected: 无报错；`migrate status` 显示 applied。

- [ ] **Step 4: 构建验证（client 类型可用）**

Run: `pnpm --filter api build`
Expected: 编译通过（新委托类型进 client）。若失败先查 schema 语法。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(tender-clarification): 问答/版本化澄清文件/回执三模型 + CLARIFY_NOTICE 公告类型"
```

---

### Task 3: 模块骨架 + 供应商提问（A-80）

**Files:**
- Create: `apps/api/src/tender-clarification/tender-clarification.module.ts`
- Create: `apps/api/src/tender-clarification/tender-clarification.service.ts`
- Create: `apps/api/src/tender-clarification/dto/ask-clarification.dto.ts`
- Modify: `apps/api/src/app.module.ts`（imports 加 `TenderClarificationModule`）
- Modify: `apps/api/src/supplier-portal/supplier-portal.module.ts`（imports 加 `TenderClarificationModule`）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（构造器注入 + 2 个端点）
- Test: `apps/api/src/tender-clarification/tender-clarification.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `assertAskWithinWindow`；Task 2 prisma 委托。
- Produces: `TenderClarificationService.askQuestion(projectId, supplier: {id, name}, dto): Promise<TenderClarification>`；`listForSupplier(projectId, supplierId)`（Task 7 实现，本任务先占位返回空集以免编译错）；DTO `AskClarificationDto { question: string; attachmentId?: string }`。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/tender-clarification/tender-clarification.service.spec.ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenderClarificationService } from './tender-clarification.service';

const DAY = 24 * 3_600_000;

function makeService(prisma: any) {
  return new TenderClarificationService(prisma, {} as any, {} as any);
}

describe('TenderClarificationService.askQuestion（A-80/B-011）', () => {
  const supplier = { id: 'sup-1', name: '重庆蜀通岩土工程有限公司' };
  const dto = { question: '招标文件第 3.2 条资质要求是否含安全生产许可证？' };

  it('已下载供应商在窗口内提问成功', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 30 * DAY) }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '已下载' }) },
      tenderClarification: { create: jest.fn().mockResolvedValue({ id: 'q1', status: '待答复' }) },
    };
    const created = await makeService(prisma).askQuestion('p1', supplier, dto);
    expect(created.id).toBe('q1');
    expect(prisma.tenderClarification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p1', supplierId: 'sup-1', question: dto.question }),
    });
  });

  it('未下载招标文件的供应商被拒 NOT_DOWNLOADED', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 30 * DAY) }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '待下载' }) },
      tenderClarification: { create: jest.fn() },
    };
    await expect(makeService(prisma).askQuestion('p1', supplier, dto)).rejects.toMatchObject({
      response: { code: 'NOT_DOWNLOADED' },
    });
  });

  it('截止前 9 日被拒 CLARIFY_ASK_LATE（B-011）', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 9 * DAY) }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '已下载' }) },
      tenderClarification: { create: jest.fn() },
    };
    await expect(makeService(prisma).askQuestion('p1', supplier, dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('评标阶段提问被拒 STAGE_INVALID', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'EVALUATING', deadline: new Date(Date.now() + 30 * DAY) }) },
      bidSupplier: { findFirst: jest.fn() },
      tenderClarification: { create: jest.fn() },
    };
    await expect(makeService(prisma).askQuestion('p1', supplier, dto)).rejects.toMatchObject({
      response: { code: 'STAGE_INVALID' },
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- tender-clarification.service`
Expected: FAIL —— `Cannot find module './tender-clarification.service'`

- [ ] **Step 3: 实现 DTO + Service + Module**

```ts
// apps/api/src/tender-clarification/dto/ask-clarification.dto.ts
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AskClarificationDto {
  @IsString() @MinLength(5) @MaxLength(2000)
  question!: string;

  @IsOptional() @IsString()
  attachmentId?: string;
}
```

```ts
// apps/api/src/tender-clarification/tender-clarification.service.ts
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AnnouncementService } from '../announcement/announcement.service';
import { assertAskWithinWindow } from './clarification-timing.util';
import { AskClarificationDto } from './dto/ask-clarification.dto';

@Injectable()
export class TenderClarificationService {
  private readonly logger = new Logger(TenderClarificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly announcements: AnnouncementService,
  ) {}

  /** A-80：供应商就招标文件提出澄清问题（须已下载、窗口内）。 */
  async askQuestion(projectId: string, supplier: { id: string; name: string }, dto: AskClarificationDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, stage: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '仅招标文件获取/投标阶段可提出澄清', code: 'STAGE_INVALID' });
    }
    const bid = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId: supplier.id },
      select: { downloadStatus: true },
    });
    if (!bid || bid.downloadStatus !== '已下载') {
      throw new ForbiddenException({ error: '仅已获取招标文件的供应商可提问', code: 'NOT_DOWNLOADED' });
    }
    assertAskWithinWindow(project.deadline);
    return this.prisma.tenderClarification.create({
      data: {
        projectId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        question: dto.question,
        attachmentId: dto.attachmentId ?? null,
      },
    });
  }

  /** 供应商视角列表（Task 7 完整实现）。 */
  async listForSupplier(_projectId: string, _supplierId: string) {
    return { questions: [], docs: [] };
  }
}
```

```ts
// apps/api/src/tender-clarification/tender-clarification.module.ts
import { Module } from '@nestjs/common';
import { AnnouncementModule } from '../announcement/announcement.module';
import { NotificationModule } from '../notification/notification.module';
import { TenderClarificationController } from './tender-clarification.controller';
import { TenderClarificationService } from './tender-clarification.service';

@Module({
  imports: [AnnouncementModule, NotificationModule],
  controllers: [TenderClarificationController],
  providers: [TenderClarificationService],
  exports: [TenderClarificationService],
})
export class TenderClarificationModule {}
```

注意：`tender-clarification.controller.ts` 在 Task 4 才创建——本步先建一个空壳使模块可编译：

```ts
// apps/api/src/tender-clarification/tender-clarification.controller.ts
import { Controller } from '@nestjs/common';

@Controller('tender-clarification')
export class TenderClarificationController {}
```

前置检查（一次性，失败则补）：`grep -n "exports" apps/api/src/announcement/announcement.module.ts apps/api/src/notification/notification.module.ts`——两个模块都必须导出各自 Service；缺则在 `@Module` 里补 `exports: [AnnouncementService]` / `exports: [NotificationService]`。

`apps/api/src/app.module.ts`：import 区加 `import { TenderClarificationModule } from './tender-clarification/tender-clarification.module';`，`imports: [...]` 数组加 `TenderClarificationModule`。

- [ ] **Step 4: supplier-portal 端点**

`apps/api/src/supplier-portal/supplier-portal.module.ts`：imports 加 `TenderClarificationModule`。

`apps/api/src/supplier-portal/supplier-portal.controller.ts`：
① 头部 import：`import { TenderClarificationService } from '../tender-clarification/tender-clarification.service';` 与 `import { AskClarificationDto } from '../tender-clarification/dto/ask-clarification.dto';`
② 构造器加 `private clarifications: TenderClarificationService,`
③ 先看本文件既有端点取当前用户的写法（`grep -n "CurrentUser\|@Req" apps/api/src/supplier-portal/supplier-portal.controller.ts | head`）：若已用 `@CurrentUser('sub')` 装饰器则照抄；若用 `@Req() req` + `req.user.sub` 则用该写法。以下按 `@CurrentUser('sub')` 书写：

```ts
  /** A-80：供应商就招标文件提出澄清问题 */
  @Post('projects/:id/clarifications')
  async askClarification(
    @Param('id') id: string,
    @Body() dto: AskClarificationDto,
    @CurrentUser('sub') userId: string,
  ) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new ForbiddenException('非供应商账号');
    return this.clarifications.askQuestion(id, supplier, dto);
  }

  /** 供应商视角澄清问答+澄清文件列表（Task 7 完整实现） */
  @Get('projects/:id/clarifications')
  async listClarifications(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    const supplierId = await this.getSupplierId(userId);
    return this.clarifications.listForSupplier(id, supplierId);
  }
```

- [ ] **Step 5: 跑测试**

Run: `pnpm --filter api test -- tender-clarification`
Expected: PASS（本任务 4 用例 + Task 1 的 6 用例全绿）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tender-clarification/ apps/api/src/supplier-portal/ apps/api/src/app.module.ts
git commit -m "feat(tender-clarification): 供应商澄清提问（A-80，已下载+10日窗守卫）"
```

---

### Task 4: 管理端问答列表与答复（A-81）

**Files:**
- Create: `apps/api/src/tender-clarification/dto/answer-clarification.dto.ts`
- Modify: `apps/api/src/tender-clarification/tender-clarification.controller.ts`（替换空壳）
- Modify: `apps/api/src/tender-clarification/tender-clarification.service.ts`（增 `listForStaff`/`answer`）
- Test: `apps/api/src/tender-clarification/tender-clarification.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: `@CurrentUser` 装饰器（`../common/decorators/current-user.decorator`，仓库已有，路径以 `grep -rn "current-user" apps/api/src --include="*.ts" -l | head -1` 为准）。
- Produces: `listForStaff(projectId): Promise<{ questions: TenderClarification[]; docs: any[] }>`（docs Task 5 填充，本任务返回 `[]`）；`answer(projectId, questionId, answerText, answeredBy): Promise<TenderClarification>`；REST：`GET /api/tender-clarification/projects/:id`、`POST /api/tender-clarification/projects/:id/questions/:qid/answer`（Roles: staff/leader/admin）。

- [ ] **Step 1: 写失败测试（追加到 spec）**

```ts
describe('TenderClarificationService.answer（A-81）', () => {
  it('待答复问题答复成功并留痕', async () => {
    const prisma = {
      tenderClarification: {
        findUnique: jest.fn().mockResolvedValue({ id: 'q1', projectId: 'p1', status: '待答复' }),
        update: jest.fn().mockResolvedValue({ id: 'q1', status: '已答复', answer: '含安全生产许可证' }),
      },
    };
    const r = await makeService(prisma).answer('p1', 'q1', '含安全生产许可证', 'user-9');
    expect(r.status).toBe('已答复');
    expect(prisma.tenderClarification.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: expect.objectContaining({ answeredBy: 'user-9', answer: '含安全生产许可证' }),
    });
  });

  it('非本项目或已答复的问题被拒 NOT_FOUND', async () => {
    const prisma = {
      tenderClarification: {
        findUnique: jest.fn().mockResolvedValue({ id: 'q2', projectId: 'other', status: '待答复' }),
        update: jest.fn(),
      },
    };
    await expect(makeService(prisma).answer('p1', 'q2', 'x', 'u')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- tender-clarification.service`
Expected: 新增 2 用例 FAIL（`svc.answer is not a function`），原有用例仍绿。

- [ ] **Step 3: 实现**

DTO：

```ts
// apps/api/src/tender-clarification/dto/answer-clarification.dto.ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AnswerClarificationDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  answer!: string;
}
```

Service 追加方法：

```ts
  /** A-81：采购中心答复澄清问题。 */
  async answer(projectId: string, questionId: string, answerText: string, answeredBy: string) {
    const q = await this.prisma.tenderClarification.findUnique({ where: { id: questionId } });
    if (!q || q.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清问题不存在', code: 'NOT_FOUND' });
    }
    if (q.status !== '待答复') return q; // 幂等：已答复不重复写
    return this.prisma.tenderClarification.update({
      where: { id: questionId },
      data: { answer: answerText, status: '已答复', answeredBy, answeredAt: new Date() },
    });
  }

  /** 管理端：问答 + 澄清文件 + 回执（docs 由 Task 5 填充）。 */
  async listForStaff(projectId: string) {
    const questions = await this.prisma.tenderClarification.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return { questions, docs: [] };
  }
```

Controller 替换空壳：

```ts
// apps/api/src/tender-clarification/tender-clarification.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenderClarificationService } from './tender-clarification.service';
import { AnswerClarificationDto } from './dto/answer-clarification.dto';

@Controller('tender-clarification')
@Roles('staff', 'leader', 'admin')
export class TenderClarificationController {
  constructor(private readonly svc: TenderClarificationService) {}

  /** A-81：管理端澄清工作台数据 */
  @Get('projects/:id')
  list(@Param('id') id: string) {
    return this.svc.listForStaff(id);
  }

  /** A-81：答复澄清问题 */
  @Post('projects/:id/questions/:qid/answer')
  answer(
    @Param('id') id: string,
    @Param('qid') qid: string,
    @Body() dto: AnswerClarificationDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.svc.answer(id, qid, dto.answer, userId);
  }
}
```

（若 `current-user.decorator` 路径不同——以 grep 结果为准修正 import。）

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter api test -- tender-clarification`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tender-clarification/
git commit -m "feat(tender-clarification): 管理端问答列表与答复端点（A-81）"
```

---

### Task 5: 版本化澄清文件（A-82/A-83 + B-012）

**Files:**
- Create: `apps/api/src/tender-clarification/dto/create-clarification-doc.dto.ts`
- Modify: `apps/api/src/tender-clarification/tender-clarification.service.ts`（增 `createDoc`/`publishDoc` 骨架——通知与公告在 Task 6）
- Modify: `apps/api/src/tender-clarification/tender-clarification.controller.ts`（增 2 端点）
- Test: service spec 追加 describe

**Interfaces:**
- Consumes: Task 1 `assertIssueWithinWindow`。
- Produces: `createDoc(projectId, dto, createdBy)`（版本号事务内自增）；`publishDoc(projectId, docId, actorId?, companyStamp?)`——Task 6 在其中追加通知/公告副作用，**本任务先留两个 TODO 钩子方法 `notifyDownloaders`/`publishClarifyNotice`（返回空实现）**，签名固定：
  - `private notifyDownloaders(project: {id,name}, doc: {id,version,title}): Promise<number>`
  - `private publishClarifyNotice(project: {id,name,projectCode}, doc: {id,version,title,content}, authorId?: string, companyStamp?: {companyId?: string; companyName?: string}): Promise<void>`
  - REST：`POST /api/tender-clarification/projects/:id/docs`、`POST /api/tender-clarification/projects/:id/docs/:docId/publish`。

- [ ] **Step 1: 写失败测试（追加）**

```ts
describe('TenderClarificationService 版本化澄清文件（A-82/A-83/B-012）', () => {
  const dto = { title: '关于第 3.2 条资质要求的澄清', content: '资质要求含安全生产许可证。' };

  it('createDoc 版本号从上一版递增', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'd2', version: 2 });
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }) },
      $transaction: jest.fn((fn: any) => fn({
        tenderClarificationDoc: { findFirst: jest.fn().mockResolvedValue({ version: 1 }), create },
      })),
    };
    const r = await makeService(prisma).createDoc('p1', dto, 'u1');
    expect(r.version).toBe(2);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 2, title: dto.title }) });
  });

  it('publishDoc：截止前 14 日被拒 CLARIFY_ISSUE_LATE', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'PC-1', name: 'n', deadline: new Date(Date.now() + 14 * DAY) }) },
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '草稿', version: 1, title: 't', content: 'c' }) },
    };
    await expect(makeService(prisma).publishDoc('p1', 'd1')).rejects.toMatchObject({
      response: { code: 'CLARIFY_ISSUE_LATE' },
    });
  });

  it('publishDoc：窗口内发布置为已发布且幂等', async () => {
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'PC-1', name: 'n', deadline: new Date(Date.now() + 20 * DAY) }) },
      tenderClarificationDoc: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '草稿', version: 1, title: 't', content: 'c' })
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '已发布', version: 1, title: 't', content: 'c' }),
        update: jest.fn().mockResolvedValue({ id: 'd1', status: '已发布', publishedAt: new Date() }),
      },
    };
    const svc = makeService(prisma);
    const first = await svc.publishDoc('p1', 'd1');
    expect(first.status).toBe('已发布');
    const again = await svc.publishDoc('p1', 'd1'); // 幂等不再 update
    expect(prisma.tenderClarificationDoc.update).toHaveBeenCalledTimes(1);
    expect(again.id).toBe('d1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- tender-clarification.service`
Expected: 新增 3 用例 FAIL（`createDoc is not a function`）

- [ ] **Step 3: 实现**

DTO：

```ts
// apps/api/src/tender-clarification/dto/create-clarification-doc.dto.ts
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClarificationDocDto {
  @IsString() @MinLength(2) @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(20000)
  content?: string;

  @IsOptional() @IsString()
  fileAssetId?: string; // 上传附件后传 FileAsset.id
}
```

Service 追加：

```ts
  /** A-82/A-83：新建澄清与修改文件（草稿，版本号项目内自增）。 */
  async createDoc(projectId: string, dto: CreateClarificationDocDto, createdBy: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.tenderClarificationDoc.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.tenderClarificationDoc.create({
        data: {
          projectId,
          version: (last?.version ?? 0) + 1,
          title: dto.title,
          content: dto.content ?? '',
          fileAssetId: dto.fileAssetId ?? null,
          createdBy,
        },
      });
    });
  }

  /** A-82：发布澄清与修改文件（B-012 十五日窗）。Task 6 追加通知/公告副作用。 */
  async publishDoc(
    projectId: string,
    docId: string,
    actorId?: string,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, name: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清文件不存在', code: 'NOT_FOUND' });
    }
    if (doc.status === '已发布') return doc; // 幂等

    assertIssueWithinWindow(project.deadline);

    const updated = await this.prisma.tenderClarificationDoc.update({
      where: { id: docId },
      data: { status: '已发布', publishedAt: new Date() },
    });

    const notified = await this.notifyDownloaders(project, updated); // Task 6 实现（本任务空实现）
    await this.publishClarifyNotice(project, updated, actorId, companyStamp); // Task 6 实现
    return { ...updated, notifiedCount: notified };
  }

  /** B-013：通知已获取招标文件的供应商（Task 6 实装）。 */
  private async notifyDownloaders(_project: { id: string; name: string }, _doc: { id: string; version: number; title: string }): Promise<number> {
    return 0;
  }

  /** B-014：发布醒目澄清公告（Task 6 实装）。 */
  private async publishClarifyNotice(
    _project: { id: string; name: string; projectCode: string },
    _doc: { id: string; version: number; title: string; content: string },
    _authorId?: string,
    _companyStamp: { companyId?: string; companyName?: string } = {},
  ): Promise<void> {}

  async listForStaff(projectId: string) {
    const [questions, docs] = await Promise.all([
      this.prisma.tenderClarification.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.tenderClarificationDoc.findMany({
        where: { projectId },
        orderBy: { version: 'asc' },
        include: { receipts: { include: { supplier: { select: { name: true } } } } },
      }),
    ]);
    return { questions, docs };
  }
```

（`listForStaff` 用上面版本替换 Task 4 的占位版。）

Service 追加（A-82 的"改/删"——仅草稿态允许，已发布锁定防篡改）：

```ts
  /** A-82：修改澄清文件（仅草稿）。 */
  async updateDoc(projectId: string, docId: string, dto: Partial<CreateClarificationDocDto>) {
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清文件不存在', code: 'NOT_FOUND' });
    }
    if (doc.status !== '草稿') {
      throw new BadRequestException({ error: '已发布的澄清文件不可修改（防篡改），请新建下一版', code: 'DOC_LOCKED' });
    }
    return this.prisma.tenderClarificationDoc.update({
      where: { id: docId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.fileAssetId !== undefined && { fileAssetId: dto.fileAssetId }),
      },
    });
  }

  /** A-82：删除澄清文件（仅草稿）。 */
  async deleteDoc(projectId: string, docId: string) {
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清文件不存在', code: 'NOT_FOUND' });
    }
    if (doc.status !== '草稿') {
      throw new BadRequestException({ error: '已发布的澄清文件不可删除', code: 'DOC_LOCKED' });
    }
    await this.prisma.tenderClarificationDoc.delete({ where: { id: docId } });
    return { ok: true };
  }
```

测试用例（追加到 Step 1 的 describe 内）：

```ts
  it('updateDoc：草稿可改、已发布 DOC_LOCKED', async () => {
    const prisma = {
      tenderClarificationDoc: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '草稿' })
          .mockResolvedValueOnce({ id: 'd1', projectId: 'p1', status: '已发布' }),
        update: jest.fn().mockResolvedValue({ id: 'd1', title: '新标题' }),
      },
    };
    const svc = makeService(prisma);
    await expect(svc.updateDoc('p1', 'd1', { title: '新标题' })).resolves.toMatchObject({ title: '新标题' });
    await expect(svc.updateDoc('p1', 'd1', { title: 'x' })).rejects.toMatchObject({ response: { code: 'DOC_LOCKED' } });
  });

  it('deleteDoc：已发布不可删 DOC_LOCKED', async () => {
    const prisma = {
      tenderClarificationDoc: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '已发布' }),
        delete: jest.fn(),
      },
    };
    await expect(makeService(prisma).deleteDoc('p1', 'd1')).rejects.toMatchObject({ response: { code: 'DOC_LOCKED' } });
  });
```

Controller 追加（同时把 Task 4 的 import 行改为 `import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';`）：

```ts
  /** A-82/A-83：新建澄清文件（草稿） */
  @Post('projects/:id/docs')
  createDoc(@Param('id') id: string, @Body() dto: CreateClarificationDocDto, @CurrentUser('sub') userId: string) {
    return this.svc.createDoc(id, dto, userId);
  }

  /** A-82：修改草稿（已发布锁定） */
  @Patch('projects/:id/docs/:docId')
  updateDoc(@Param('id') id: string, @Param('docId') docId: string, @Body() dto: CreateClarificationDocDto) {
    return this.svc.updateDoc(id, docId, dto);
  }

  /** A-82：删除草稿（已发布锁定） */
  @Delete('projects/:id/docs/:docId')
  deleteDoc(@Param('id') id: string, @Param('docId') docId: string) {
    return this.svc.deleteDoc(id, docId);
  }
```

  /** A-82：发布澄清文件（B-012 窗口 + Task 6 通知/公告联动） */
  @Post('projects/:id/docs/:docId/publish')
  async publishDoc(@Param('id') id: string, @Param('docId') docId: string, @CurrentUser('sub') userId: string) {
    const user = await this.svc.userCompany(userId);
    return this.svc.publishDoc(id, docId, userId, user);
  }
```

Service 增辅助（供 controller 取公司归属戳，公告管理端按公司隔离须带）：

```ts
  /** 当前用户公司归属（公告写时快照用；无归属返回空对象）。 */
  async userCompany(userId: string): Promise<{ companyId?: string; companyName?: string }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, company: { select: { name: true } } },
    });
    if (!u?.companyId) return {};
    return { companyId: u.companyId, companyName: u.company?.name };
  }
```

（若 `User` 无 `company` 关系——`grep -n "company" apps/api/prisma/schema.prisma | grep -A2 "model User"` 确认——则改为查 `CompanyScopeService`；以现网 schema 为准。）

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter api test -- tender-clarification`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tender-clarification/
git commit -m "feat(tender-clarification): 版本化澄清文件草稿/发布（A-82/83，15日窗）"
```

---

### Task 6: 发布联动——通知已下载供应商 + 醒目公告（B-013/B-014）

**Files:**
- Modify: `apps/api/src/tender-clarification/tender-clarification.service.ts`（实装两个 private 钩子）
- Test: service spec 追加 describe

**Interfaces:**
- Consumes: `NotificationService.create(dto: { userId, type, title, content })`（`notification/dto/create-notification.dto.ts` 已有）；`AnnouncementService.create(dto, authorId?, companyStamp?)`（`announcement.service.ts:26`，`status:'PUBLISHED'` 走直发联动）。
- Produces: `notifyDownloaders` 返回通知人数；`publishClarifyNotice` 产出 `Announcement { type:'CLARIFY_NOTICE', isTop:true, relatedProjectCode, metadata:{clarificationVersion, docId} }`。

- [ ] **Step 1: 写失败测试（追加）**

```ts
describe('publishDoc 副作用（B-013/B-014）', () => {
  it('通知所有已下载供应商并发布 CLARIFY_NOTICE 置顶公告', async () => {
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const announcements = { create: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'PC-1', name: '水厂设备', deadline: new Date(Date.now() + 20 * DAY) }) },
      tenderClarificationDoc: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '草稿', version: 1, title: '澄清一', content: '正文' }),
        update: jest.fn().mockResolvedValue({ id: 'd1', projectId: 'p1', status: '已发布', version: 1, title: '澄清一', content: '正文', publishedAt: new Date() }),
      },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([
        { supplier: { userId: 'u1', name: '供应商A' } },
        { supplier: { userId: 'u2', name: '供应商B' } },
      ]) },
    };
    const svc = new TenderClarificationService(prisma, notifications as any, announcements as any);
    const r = await svc.publishDoc('p1', 'd1', 'staff-1', { companyId: 'c1', companyName: '采购中心' });
    expect(r.notifiedCount).toBe(2);
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'CLARIFICATION' }));
    expect(announcements.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLARIFY_NOTICE', status: 'PUBLISHED', isTop: true, relatedProjectCode: 'PC-1' }),
      'staff-1',
      { companyId: 'c1', companyName: '采购中心' },
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- tender-clarification.service`
Expected: 新用例 FAIL（`notifiedCount` 为 0 / 通知未调用）

- [ ] **Step 3: 实装两个钩子**

替换 Task 5 的空实现：

```ts
  /** B-013：向所有已获取招标文件的供应商发站内通知。 */
  private async notifyDownloaders(project: { id: string; name: string }, doc: { id: string; version: number; title: string }): Promise<number> {
    const rows = await this.prisma.bidSupplier.findMany({
      where: { projectId: project.id, downloadStatus: '已下载', supplier: { is: { userId: { not: null } } } },
      select: { supplier: { select: { userId: true } } },
    });
    for (const r of rows) {
      await this.notifications.create({
        userId: r.supplier.userId!,
        type: 'CLARIFICATION',
        title: `【第${doc.version}次澄清】${project.name}`,
        content: `${doc.title}——请登录供应商门户「澄清与修改」及时查看下载。`,
      });
    }
    return rows.length;
  }

  /** B-014：发布置顶澄清公告（同步进入公共门户公告流）。 */
  private async publishClarifyNotice(
    project: { id: string; name: string; projectCode: string },
    doc: { id: string; version: number; title: string; content: string },
    authorId?: string,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ): Promise<void> {
    await this.announcements.create(
      {
        title: `【澄清与修改】${project.name}（第${doc.version}次）`,
        content: doc.content || doc.title,
        type: 'CLARIFY_NOTICE' as any,
        status: 'PUBLISHED' as any,
        isTop: true,
        relatedProjectCode: project.projectCode,
        metadata: { clarificationVersion: doc.version, docId: doc.id },
      } as any,
      authorId,
      companyStamp,
    );
  }
```

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter api test -- tender-clarification`
Expected: PASS（全部）

- [ ] **Step 5: 公共门户类型适配检查**

Run: `grep -rn "BID_NOTICE\|WIN_NOTICE\|POLICY\|PLATFORM" apps/public-portal/src --include="*.tsx" --include="*.ts" -l | head -5`
对命中的公告类型映射文件（如类型→中文标签/筛选 tab），补 `CLARIFY_NOTICE: '澄清与修改'` 一行——保持公共端能正常展示新类型（不筛选则无需改动，确认即可）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tender-clarification/ apps/public-portal/src/
git commit -m "feat(tender-clarification): 发布联动通知已下载供应商+置顶澄清公告（B-013/014）"
```

---

### Task 7: 供应商下载与回执（A-85/A-86）+ 供应商列表实装

**Files:**
- Modify: `apps/api/src/tender-clarification/tender-clarification.service.ts`（实装 `listForSupplier` + `downloadDoc`）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（增下载端点）
- Test: service spec 追加 describe

**Interfaces:**
- Produces: `listForSupplier(projectId, supplierId): Promise<{ questions: TenderClarification[]; docs: Array<TenderClarificationDoc & { receipt: { downloadedAt: Date; receiptedAt: Date } | null }> }>`（仅返回已发布 docs）；`downloadDoc(projectId, docId, supplier): Promise<{ id, version, title, content, fileUrl }>`（下载即 upsert 回执）；REST：`POST /api/supplier-portal/projects/:id/clarification-docs/:docId/download`。

- [ ] **Step 1: 写失败测试（追加）**

```ts
describe('TenderClarificationService 供应商侧（A-85/A-86）', () => {
  const supplier = { id: 'sup-1', name: '供应商A' };
  const published = { id: 'd1', projectId: 'p1', status: '已发布', version: 1, title: '澄清一', content: 'c', fileAssetId: 'fa-1' };

  it('listForSupplier 只见已发布文件并带本人回执', async () => {
    const prisma = {
      tenderClarification: { findMany: jest.fn().mockResolvedValue([{ id: 'q1' }]) },
      tenderClarificationDoc: { findMany: jest.fn().mockResolvedValue([published]) },
      tenderClarificationReceipt: { findMany: jest.fn().mockResolvedValue([{ docId: 'd1', downloadedAt: new Date(), receiptedAt: new Date() }]) },
    };
    const r = await makeService(prisma).listForSupplier('p1', 'sup-1');
    expect(r.questions).toHaveLength(1);
    expect(r.docs[0].receipt).not.toBeNull();
    expect(prisma.tenderClarificationDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', status: '已发布' } }),
    );
  });

  it('downloadDoc：已下载供应商下载成功并 upsert 回执', async () => {
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue(published) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '已下载' }) },
      tenderClarificationReceipt: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const r = await makeService(prisma).downloadDoc('p1', 'd1', supplier);
    expect(r.fileUrl).toBe('/api/upload/files/fa-1');
    expect(prisma.tenderClarificationReceipt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { docId_supplierId: { docId: 'd1', supplierId: 'sup-1' } } }),
    );
  });

  it('downloadDoc：未下载招标文件者被拒 NOT_DOWNLOADED', async () => {
    const prisma = {
      tenderClarificationDoc: { findUnique: jest.fn().mockResolvedValue(published) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ downloadStatus: '待下载' }) },
      tenderClarificationReceipt: { upsert: jest.fn() },
    };
    await expect(makeService(prisma).downloadDoc('p1', 'd1', supplier)).rejects.toMatchObject({
      response: { code: 'NOT_DOWNLOADED' },
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- tender-clarification.service`
Expected: 新增 3 用例 FAIL（`listForSupplier` 返回空集 / `downloadDoc` 不存在）

- [ ] **Step 3: 实现（替换 `listForSupplier` 占位 + 新增 `downloadDoc`）**

```ts
  /** 供应商视角：问答（澄清不涉密，全体可见）+ 已发布澄清文件 + 本人回执。 */
  async listForSupplier(projectId: string, supplierId: string) {
    const [questions, docs, mine] = await Promise.all([
      this.prisma.tenderClarification.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.tenderClarificationDoc.findMany({
        where: { projectId, status: '已发布' },
        orderBy: { version: 'asc' },
      }),
      this.prisma.tenderClarificationReceipt.findMany({
        where: { supplierId, doc: { projectId } },
        select: { docId: true, downloadedAt: true, receiptedAt: true },
      }),
    ]);
    const receiptMap = new Map(mine.map((r) => [r.docId, r]));
    return { questions, docs: docs.map((d) => ({ ...d, receipt: receiptMap.get(d.id) ?? null })) };
  }

  /** A-85/A-86：下载已发布澄清文件（仅已获取招标文件者），下载即回执。 */
  async downloadDoc(projectId: string, docId: string, supplier: { id: string; name: string }) {
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId || doc.status !== '已发布') {
      throw new BadRequestException({ error: '澄清文件不存在或未发布', code: 'NOT_FOUND' });
    }
    const bid = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId: supplier.id },
      select: { downloadStatus: true },
    });
    if (!bid || bid.downloadStatus !== '已下载') {
      throw new ForbiddenException({ error: '仅已获取招标文件的供应商可下载澄清文件', code: 'NOT_DOWNLOADED' });
    }
    await this.prisma.tenderClarificationReceipt.upsert({
      where: { docId_supplierId: { docId, supplierId: supplier.id } },
      create: { docId, supplierId: supplier.id },
      update: { receiptedAt: new Date() },
    });
    return {
      id: doc.id,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      fileUrl: doc.fileAssetId ? `/api/upload/files/${doc.fileAssetId}` : null,
    };
  }
```

supplier-portal.controller 追加：

```ts
  /** A-85/A-86：下载澄清文件（下载即回执） */
  @Post('projects/:id/clarification-docs/:docId/download')
  async downloadClarificationDoc(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @CurrentUser('sub') userId: string,
  ) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new ForbiddenException('非供应商账号');
    return this.clarifications.downloadDoc(id, docId, supplier);
  }
```

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter api test -- tender-clarification`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tender-clarification/ apps/api/src/supplier-portal/
git commit -m "feat(tender-clarification): 供应商下载澄清文件+下载即回执（A-85/86）"
```

---

### Task 8: 前端——:3005 面板 + :3004 供应商 tab

**Files:**
- Create: `apps/web/src/lib/api/tender-clarification.ts`
- Create: `apps/web/src/components/projects/tender-clarification-panel.tsx`
- Modify: :3005 项目详情页（挂载点见 Step 3 grep）
- Create: `apps/supplier-portal/src/api/clarification.ts`
- Create: `apps/supplier-portal/src/views/bid/ClarificationPanel.vue`
- Modify: 供应商项目详情视图（挂载点见 Step 6 grep）

**Interfaces:**
- Consumes: Task 3/4/5/7 的 REST 端点；:3005 请求封装复用 `bid-confirm-panel.tsx` 顶部 import 的同一 helper（含 X-Web-Token）；:3004 用 `apps/supplier-portal/src/api/index.ts` 默认导出的 axios 实例 `api`。

- [ ] **Step 1: :3005 API helper**

```ts
// apps/web/src/lib/api/tender-clarification.ts
// 请求封装与鉴权头与 @/lib/api/supplier 同源——复制该文件顶部的 fetch 封装引入方式。
export interface ClarificationQuestion {
  id: string; supplierName: string; question: string; answer: string | null;
  status: string; createdAt: string;
}
export interface ClarificationDocReceipt { supplierName: string; receiptedAt: string }
export interface ClarificationDoc {
  id: string; version: number; title: string; content: string; status: string;
  publishedAt: string | null; receipts: ClarificationDocReceipt[];
}

export async function getClarifications(projectId: string): Promise<{ questions: ClarificationQuestion[]; docs: ClarificationDoc[] }> {
  const res = await fetch(`/api/tender-clarification/projects/${projectId}`, { credentials: 'include' });
  if (!res.ok) throw new Error('加载澄清数据失败');
  return res.json();
}

export async function answerClarification(projectId: string, qid: string, answer: string) {
  const res = await fetch(`/api/tender-clarification/projects/${projectId}/questions/${qid}/answer`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? '答复失败');
}

export async function createClarificationDoc(projectId: string, body: { title: string; content?: string; fileAssetId?: string }) {
  const res = await fetch(`/api/tender-clarification/projects/${projectId}/docs`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? '创建失败');
  return res.json();
}

export async function publishClarificationDoc(projectId: string, docId: string) {
  const res = await fetch(`/api/tender-clarification/projects/${projectId}/docs/${docId}/publish`, {
    method: 'POST', credentials: 'include',
  });
  if (!res.ok) throw new Error((await res.json()).error ?? '发布失败');
}
```

注意：:3005 会话用 `X-Web-Token` 头（多标签页并存机制，见 `apps/web/src/lib/session-store.ts`）。**执行时打开 `apps/web/src/components/projects/bid-confirm-panel.tsx` 顶部 import 区，把其中既有的请求 helper（若 `@/lib/api/*` 内部已统一注入头）直接复用**——若各 api 文件是裸 fetch，则照 `@/lib/api/supplier.ts` 的写法对齐（它已处理会话头），本文件保持与其一致。

- [ ] **Step 2: :3005 面板组件**

```tsx
// apps/web/src/components/projects/tender-clarification-panel.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getClarifications, answerClarification, createClarificationDoc, publishClarificationDoc,
  type ClarificationQuestion, type ClarificationDoc,
} from '@/lib/api/tender-clarification';

export function TenderClarificationPanel({ projectId }: { projectId: string }) {
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [docs, setDocs] = useState<ClarificationDoc[]>([]);
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getClarifications(projectId);
      setQuestions(r.questions); setDocs(r.docs);
    } catch (e) { setMsg((e as Error).message); } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const doAnswer = async (qid: string) => {
    const answer = (answerDraft[qid] ?? '').trim();
    if (!answer) return;
    try { await answerClarification(projectId, qid, answer); setAnswerDraft({ ...answerDraft, [qid]: '' }); void reload(); }
    catch (e) { setMsg((e as Error).message); }
  };

  const doCreate = async () => {
    if (title.trim().length < 2) return;
    try {
      await createClarificationDoc(projectId, { title: title.trim(), content: content.trim() || undefined });
      setTitle(''); setContent(''); void reload();
    } catch (e) { setMsg((e as Error).message); }
  };

  const doPublish = async (docId: string) => {
    try { await publishClarificationDoc(projectId, docId); void reload(); }
    catch (e) { setMsg((e as Error).message); }
  };

  return (
    <section className="neu-card p-5 space-y-4">
      <header className="flex items-center justify-between border-b border-black/5 pb-3">
        <h3 className="text-sm font-semibold tracking-wide">澄清与修改（CTS A-80~86）</h3>
        <span className="text-xs text-black/45">提问 {questions.length} · 澄清文件 {docs.length}</span>
      </header>

      {loading ? <p className="text-xs text-black/40">加载中…</p> : (
        <>
          <div className="space-y-3">
            {questions.map((q) => (
              <div key={q.id} className="neu-inset rounded-xl p-3 space-y-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium">{q.supplierName}</span>
                  <span className="text-black/40">{new Date(q.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <p className="text-sm">{q.question}</p>
                {q.answer ? (
                  <p className="text-sm text-black/70 border-l-2 border-black/10 pl-2">答复：{q.answer}</p>
                ) : (
                  <div className="flex gap-2">
                    <input
                      className="neu-input flex-1 text-sm" placeholder="答复内容…"
                      value={answerDraft[q.id] ?? ''}
                      onChange={(e) => setAnswerDraft({ ...answerDraft, [q.id]: e.target.value })}
                    />
                    <button className="neu-btn text-xs" onClick={() => void doAnswer(q.id)}>答复</button>
                  </div>
                )}
              </div>
            ))}
            {questions.length === 0 && <p className="text-xs text-black/40">暂无澄清提问</p>}
          </div>

          <div className="border-t border-black/5 pt-3 space-y-3">
            <div className="flex gap-2">
              <input className="neu-input flex-1 text-sm" placeholder="澄清文件标题（如：关于第3.2条资质要求的澄清）"
                value={title} onChange={(e) => setTitle(e.target.value)} />
              <button className="neu-btn text-xs" onClick={() => void doCreate()}>新建草稿</button>
            </div>
            {docs.map((d) => (
              <div key={d.id} className="neu-inset rounded-xl p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">第 {d.version} 次 · {d.title}</span>
                  {d.status === '已发布' ? (
                    <span className="text-xs text-emerald-700">已发布 · 回执 {d.receipts.length}</span>
                  ) : (
                    <button className="neu-btn text-xs" onClick={() => void doPublish(d.id)}>发布</button>
                  )}
                </div>
                {d.status === '已发布' && d.receipts.length > 0 && (
                  <p className="text-xs text-black/45">
                    已回执：{d.receipts.map((r) => `${r.supplierName}（${new Date(r.receiptedAt).toLocaleDateString('zh-CN')}）`).join('、')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </section>
  );
}
```

（`neu-card/neu-inset/neu-input/neu-btn` 为 :3005 既拟态类名——见 `apps/web/src/app/globals.css`；若面板挂载页已有局部样式类，以该页为准对齐。）

- [ ] **Step 3: 挂载到项目详情页**

Run: `grep -rn "BidConfirmPanel" apps/web/src --include="*.tsx" -l | grep -v components`
在命中的页面文件中，`<BidConfirmPanel … />` 之后追加一行：

```tsx
<TenderClarificationPanel projectId={/* 与 BidConfirmPanel 同源的 projectId 变量 */} />
```

并在顶部补 `import { TenderClarificationPanel } from '@/components/projects/tender-clarification-panel';`。

- [ ] **Step 4: 供应商门户 API + 组件**

```ts
// apps/supplier-portal/src/api/clarification.ts
import api from './index';

export interface SupplierClarification {
  questions: Array<{ id: string; supplierName: string; question: string; answer: string | null; status: string; createdAt: string }>;
  docs: Array<{ id: string; version: number; title: string; content: string; fileUrl?: string | null; receipt: { receiptedAt: string } | null }>;
}

export const listClarifications = (projectId: string) =>
  api.get<SupplierClarification>(`/supplier-portal/projects/${projectId}/clarifications`);

export const askClarification = (projectId: string, question: string) =>
  api.post(`/supplier-portal/projects/${projectId}/clarifications`, { question });

export const downloadClarificationDoc = (projectId: string, docId: string) =>
  api.post(`/supplier-portal/projects/${projectId}/clarification-docs/${docId}/download`);
```

```vue
<!-- apps/supplier-portal/src/views/bid/ClarificationPanel.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { listClarifications, askClarification, downloadClarificationDoc, type SupplierClarification } from '@/api/clarification';

const props = defineProps<{ projectId: string }>();
const data = ref<SupplierClarification>({ questions: [], docs: [] });
const question = ref('');
const loading = ref(true);

const reload = async () => {
  loading.value = true;
  try { data.value = (await listClarifications(props.projectId)).data; }
  catch (e: any) { ElMessage.error(e?.response?.data?.error ?? '加载失败'); }
  finally { loading.value = false; }
};

const ask = async () => {
  if (question.value.trim().length < 5) return;
  try {
    await askClarification(props.projectId, question.value.trim());
    question.value = '';
    ElMessage.success('已提交澄清提问');
    await reload();
  } catch (e: any) { ElMessage.error(e?.response?.data?.error ?? '提交失败'); }
};

const download = async (docId: string) => {
  try {
    const r = (await downloadClarificationDoc(props.projectId, docId)).data;
    if (r.fileUrl) window.open(r.fileUrl, '_blank');
    ElMessage.success('下载成功，已递交回执');
    await reload();
  } catch (e: any) { ElMessage.error(e?.response?.data?.error ?? '下载失败'); }
};

onMounted(reload);
</script>

<template>
  <el-card shadow="never" class="clarification-panel">
    <template #header><span>澄清与修改</span></template>
    <el-input v-model="question" type="textarea" :rows="3" maxlength="2000" show-word-limit
      placeholder="就招标文件提出澄清问题（最迟投标截止前 10 日）" />
    <div class="mt-2 text-right">
      <el-button type="primary" :disabled="question.trim().length < 5" @click="ask">提交提问</el-button>
    </div>
    <el-divider />
    <div v-if="!loading">
      <el-timeline>
        <el-timeline-item v-for="q in data.questions" :key="q.id" :timestamp="new Date(q.createdAt).toLocaleString('zh-CN')">
          <p class="q">{{ q.question }}</p>
          <p v-if="q.answer" class="a">答复：{{ q.answer }}</p>
          <el-tag v-else size="small" type="info">待答复</el-tag>
        </el-timeline-item>
      </el-timeline>
      <el-divider content-position="left">澄清与修改文件</el-divider>
      <div v-for="d in data.docs" :key="d.id" class="doc-row">
        <span>第 {{ d.version }} 次 · {{ d.title }}</span>
        <el-button size="small" @click="download(d.id)">
          {{ d.receipt ? '重新下载' : '下载并回执' }}
        </el-button>
        <el-tag v-if="d.receipt" size="small" type="success">已回执</el-tag>
      </div>
      <el-empty v-if="data.docs.length === 0" description="暂无澄清文件" :image-size="60" />
    </div>
  </el-card>
</template>

<style scoped>
.q { margin: 0 0 4px; font-weight: 500; }
.a { margin: 0; color: var(--el-text-color-secondary); }
.doc-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; justify-content: space-between; }
</style>
```

- [ ] **Step 5: 挂载到供应商项目详情**

Run: `grep -rn "el-tab-pane\|<el-tabs" apps/supplier-portal/src/views/bid/*.vue | head -10`
在项目详情视图（含投标操作/进度展示的那个文件）的 tabs 中追加一个 pane：

```vue
<el-tab-pane label="澄清与修改">
  <ClarificationPanel :project-id="projectId" />
</el-tab-pane>
```

顶部补 `import ClarificationPanel from './ClarificationPanel.vue';`（`projectId` 取该视图既有的项目 id ref/props）。

- [ ] **Step 6: 手工冒烟（两门户）**

Run: `pnpm dev:web` + `pnpm dev:supplier` + `pnpm dev:api`（已在跑则跳过）
用 `Swhi-CGZX-05`（:3005）与「重庆蜀通岩土工程有限公司 / supplier@2026」（:3004）走一遍：提问 → 答复 → 新建澄清文件 → 发布 → 供应商收通知 → 下载回执 → :3005 见回执名单。截图留档（`docs/superpowers/verification/`）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/supplier-portal/src
git commit -m "feat(tender-clarification): :3005 澄清工作台面板 + :3004 供应商澄清 tab"
```

---

### Task 9: E2E 流程测试

**Files:**
- Create: `apps/api/test/tender-clarification.e2e-spec.ts`

**Interfaces:**
- Consumes: 种子账号（staff `Swhi-CGZX-05`/`Swhi-CGZX-05@2026`；供应商「重庆蜀通岩土工程有限公司」/`supplier@2026`）——**前置：当前 dev 库须有种子数据，缺失则先 `pnpm db:seed`（破坏性！先确认）**；登录模式与 `apps/api/test/bid.e2e-spec.ts` 相同（先打开该文件抄登录 helper 与 app 引导）。

- [ ] **Step 1: 写 E2E**

```ts
// apps/api/test/tender-clarification.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
// 若 bid.e2e-spec.ts 抽了公共 login helper（test/helpers/*），改为 import 复用——先打开确认。

const DAY = 24 * 3_600_000;

describe('TenderClarification E2E（CTS A-80~86 / B-011~014）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let webCookie: string;
  let supplierCookie: string;
  let projectId: string;
  let supplierId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);

    // staff 登录（X-Portal: web → token_web）
    const staff = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'web')
      .send({ username: 'Swhi-CGZX-05', password: 'Swhi-CGZX-05@2026' });
    webCookie = staff.headers['set-cookie']!.map((c: string) => c.split(';')[0]).join('; ');

    // 供应商登录（X-Portal: supplier → token_supplier）
    const sup = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'supplier')
      .send({ username: '重庆蜀通岩土工程有限公司', password: 'supplier@2026' });
    supplierCookie = sup.headers['set-cookie']!.map((c: string) => c.split(';')[0]).join('; ');

    const supplierUser = await prisma.user.findFirst({
      where: { role: 'supplier', supplier: { is: { name: '重庆蜀通岩土工程有限公司' } } },
      select: { supplier: { select: { id: true } } },
    });
    supplierId = supplierUser!.supplier!.id;

    // 造数：窗口充足的 DOWNLOAD 项目 + 该供应商已下载
    const announcement = await prisma.announcement.create({
      data: { title: '澄清E2E招标公告', content: '测试', type: 'BID_NOTICE', status: 'PUBLISHED' },
    });
    const project = await prisma.bidProject.create({
      data: {
        projectCode: `E2E-CLARIFY-${Date.now()}`,
        name: '澄清E2E项目',
        procurementMethod: '公开招标',
        openTime: new Date(Date.now() + 40 * DAY),
        deadline: new Date(Date.now() + 39 * DAY),
        relatedProjectCode: announcement.id, // 项目↔公告关联字段以现网 schema 为准（grep BidProject.announcement 相关注释）
        suppliers: { create: { supplierId, supplierName: '重庆蜀通岩土工程有限公司', downloadStatus: '已下载' } },
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.bidProject.deleteMany({ where: { id: projectId } }).catch(() => {});
    await prisma.announcement.deleteMany({ where: { title: '澄清E2E招标公告' } }).catch(() => {});
    await app.close();
  });

  it('A-80 供应商提问 → A-81 staff 答复', async () => {
    const ask = await request(app.getHttpServer())
      .post(`/api/supplier-portal/projects/${projectId}/clarifications`)
      .set('Cookie', supplierCookie)
      .send({ question: 'E2E：付款条件是否含预付款？' });
    expect(ask.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get(`/api/tender-clarification/projects/${projectId}`)
      .set('Cookie', webCookie);
    expect(list.body.questions).toHaveLength(1);

    const qid = list.body.questions[0].id;
    const ans = await request(app.getHttpServer())
      .post(`/api/tender-clarification/projects/${projectId}/questions/${qid}/answer`)
      .set('Cookie', webCookie)
      .send({ answer: 'E2E 答复：含 10% 预付款。' });
    expect(ans.body.status).toBe('已答复');
  });

  it('A-82/83 + B-012/013/014 发布澄清文件 → 通知 + 置顶公告', async () => {
    const doc = await request(app.getHttpServer())
      .post(`/api/tender-clarification/projects/${projectId}/docs`)
      .set('Cookie', webCookie)
      .send({ title: 'E2E 澄清文件一', content: '付款含预付款。' });
    expect(doc.body.version).toBe(1);

    const pub = await request(app.getHttpServer())
      .post(`/api/tender-clarification/projects/${projectId}/docs/${doc.body.id}/publish`)
      .set('Cookie', webCookie);
    expect(pub.body.status).toBe('已发布');
    expect(pub.body.notifiedCount).toBeGreaterThanOrEqual(1);

    const notice = await prisma.announcement.findFirst({
      where: { type: 'CLARIFY_NOTICE', metadata: { path: ['docId'], equals: doc.body.id } },
    });
    expect(notice).not.toBeNull();
    expect(notice!.isTop).toBe(true);
  });

  it('A-85/86 供应商下载即回执', async () => {
    const docs = await request(app.getHttpServer())
      .get(`/api/supplier-portal/projects/${projectId}/clarifications`)
      .set('Cookie', supplierCookie);
    const docId = docs.body.docs[0].id;

    const dl = await request(app.getHttpServer())
      .post(`/api/supplier-portal/projects/${projectId}/clarification-docs/${docId}/download`)
      .set('Cookie', supplierCookie);
    expect(dl.body.version).toBe(1);

    const receipt = await prisma.tenderClarificationReceipt.findFirst({ where: { docId } });
    expect(receipt).not.toBeNull();
  });

  it('B-011 截止前 9 日提问被拒', async () => {
    await prisma.bidProject.update({ where: { id: projectId }, data: { deadline: new Date(Date.now() + 9 * DAY) } });
    const ask = await request(app.getHttpServer())
      .post(`/api/supplier-portal/projects/${projectId}/clarifications`)
      .set('Cookie', supplierCookie)
      .send({ question: 'E2E 逾期提问应当被拒' });
    expect(ask.status).toBe(400);
    expect(ask.body.code).toBe('CLARIFY_ASK_LATE');
  });
});
```

（登录响应 cookie 取法、`relatedProjectCode` 等以 `bid.e2e-spec.ts` 现网写法为准——执行时先读该文件再对齐差异；`BidProject` 必填字段以 schema 为准补全 create data。）

- [ ] **Step 2: 跑 E2E**

Run: `pnpm --filter api test:e2e -- tender-clarification`
Expected: 4 用例全 PASS

- [ ] **Step 3: 全量回归**

Run: `pnpm --filter api test`
Expected: 无回归（既有套件全绿）

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/tender-clarification.e2e-spec.ts
git commit -m "test(tender-clarification): E2E 全流程（A-80~86/B-011~014）"
```

---

## 完成记录（2026-08-26）

9 任务全部落地（Task 1-8 提交 dbbd0f9f→bc8dae78 链；Task 9 以真实服务 curl 全链矩阵替代 e2e-spec——dev 库账号漂移无法跑种子 e2e，夹具用后即删）。实测：提问→答复→草稿→发布（通知1+CLARIFY_NOTIFY 置顶公告）→下载即回执→staff 回执名单→逾期双负例（CLARIFY_ASK_LATE/CLARIFY_ISSUE_LATE）全过；:3005 工作台与 :3004 澄清卡截图入 verification/。附加修复：BidProject 反向关系锚点事故、User.companyRef 关系名、回执平铺形态。

## 验收自查（对照检测项）

| 检测项 | 验收口径 | 验证方式 |
|---|---|---|
| A-80 | 已下载供应商窗口内可提问；未下载/逾期/阶段不符均拒 | Task 3 单测 + Task 9 e2e |
| A-81 | staff 可见全部问答并可答复（留痕 answeredBy/At） | Task 4 单测 + e2e |
| A-82/83 | 澄清文件增删改查（草稿可改删、已发布锁定）、版本号项目内递增不重复 | Task 5 单测（@@unique 兜底） |
| B-011 | 截止前 <10 日提问 422 `CLARIFY_ASK_LATE`（边界含 10 日整） | Task 1/9 |
| B-012 | 截止前 <15 日发布 422 `CLARIFY_ISSUE_LATE`（边界含 15 日整） | Task 1/5 |
| B-013 | 发布后所有已下载供应商收到站内通知 | Task 6 单测 |
| B-014 | 发布即置顶 CLARIFY_NOTICE 公告（公共门户可见） | Task 6 + Task 8 冒烟截图 |
| A-85 | 已下载供应商可下载已发布澄清文件 | Task 7 单测 |
| A-86 | 下载即回执，:3005 可查回执名单 | Task 7/8 |
| B-015 | 版本化澄清文件随项目归档包导出 | 后续接 W13 ASIP（本期版本化+发布链路已具备） |

> 完成后回 `2026-08-24-cts-ebs01-compliance-roadmap.md` 勾选 W1。
