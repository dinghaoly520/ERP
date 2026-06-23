# 合规唱标闭环：项目级质量目标 + 保证金人工核对 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让唱标 4 要素中的「质量目标」从项目级配置自动带出、「保证金状态」由供应商上传凭证 → 主持人开标核对 → 评标环节软标记，闭合当前"主持人无数据来源、凭空手填"的缺口。

**Architecture:** 沿用现有「解密只校验密文、唱标要素由主持人录入」的解耦设计，补齐上游数据源：BidProject 增项目级质量要求与保证金配置；SupplierBidSubmission 增保证金凭证引用；新增 opening-draft 端点在 OPENING 阶段聚合预填数据；generateEvaluationResults 对保证金异常做软标记（写监督日志，不排除供应商）。

**Tech Stack:** NestJS 11 + Prisma（后端，Jest 单测）、Next.js 16 App Router（bid-portal 开标大厅 + 项目创建）、Vue 3 + Element Plus（supplier-portal 投标提交）。

## Global Constraints

- **Prisma 迁移（非交互）**：`prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`，或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`。所有新字段必须可空，保证存量数据零影响。
- **运行于 `water-erp/` 目录**：所有 `pnpm` 命令在 workspace 根执行。
- **Node 24**：Next.js dev 脚本带 `--webpack`（勿删）；改 `packages/config`、`packages/shared` 后需重新 build。
- **设计系统**（`.impeccable.md`）：1px hairline、monospace 数字、navy→ice blue、`rounded-xl` 按钮、Lucide 1.5px 图标；禁止渐变按钮、emoji 当图标。
- **无 mock 兜底**：前端只展示真实 DB 数据 / loading / empty。
- **错误响应**：统一 `{ statusCode, code, error, ... }`，业务校验抛 `BadRequestException({ error, code })`。
- **保证金凭证不加密**：属程序性文件（非竞争性内容），不进入 AES 加密封存，仅靠阶段门控限制可见时机（OPENING 后）。
- **bondStatus 固定枚举**：`已缴纳` / `保函有效` / `未缴纳` / `异常`，前端下拉选择，禁止自由文本。

---

## File Structure

**新建：**
- `apps/api/src/bid/bid-bond-status.ts` — 保证金状态枚举 + `isBondQualified()` 纯函数（单一职责，供 service 与测试复用）
- `apps/api/src/bid/bid-bond-status.spec.ts` — 上述纯函数单测
- `apps/api/prisma/migrations/<timestamp>_add_quality_and_bond_fields/migration.sql` — 由 prisma 生成

**修改（后端）：**
- `apps/api/prisma/schema.prisma` — BidProject +3 字段，SupplierBidSubmission +1 字段
- `apps/api/src/bid/dto/create-bid-project.dto.ts` / `update-bid-project.dto.ts` — +3 字段
- `apps/api/src/bid/bid.service.ts` — `createProject`/`updateProject` 写入新字段；新增 `getOpeningRecordDraft`；`generateEvaluationResults` 软标记
- `apps/api/src/bid/bid.controller.ts` — 新增 `GET projects/:id/suppliers/:supplierId/opening-draft` 端点
- `apps/api/src/bid/bid.service.spec.ts` — 新增 `createProject` 字段写入测试 + 软标记测试
- `apps/api/src/supplier-portal/supplier-portal.service.ts` — `BidSubmissionData` + `bondReceiptAssetId`；`assertBidFileAssetsOwnedByUser` 调用补该字段
- `apps/api/src/supplier-portal/supplier-portal.controller.ts` — submit/draft 端点 body 类型 + `bondReceiptAssetId`

**修改（前端）：**
- `apps/bid-portal/src/components/create-project-dialog.tsx` — 质量目标输入 + 保证金开关/金额
- `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx` — 唱标弹窗预填 + bondStatus 下拉 + 凭证查看 + 记录表着色
- `apps/bid-portal/src/lib/api/bid.ts` — 新增 `getOpeningDraft` 封装
- `apps/supplier-portal/src/views/bid/BidSubmit.vue` — 保证金凭证上传项 + checks + form 字段
- `apps/supplier-portal/src/api/supplier.ts` — submit/draft 类型 + `bondReceiptAssetId`（若存在类型定义）

**可选（seed）：**
- `apps/api/prisma/seed-data/BidProject.json` — 给英雄项目补 `qualityRequirement` / `bondRequired`

---

## Task 1: Prisma schema 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`BidProject` 模型、`SupplierBidSubmission` 模型）

**Interfaces:**
- Produces: `BidProject.qualityRequirement: string | null`、`BidProject.bondRequired: boolean`、`BidProject.bondAmount: Decimal | null`、`SupplierBidSubmission.bondReceiptAssetId: string | null`（Prisma client 类型，供后续 task 使用）

- [ ] **Step 1: 在 `BidProject` 模型 `contact` 字段后追加 3 个字段**

定位 `qualification String?` 与 `contact String?` 所在行，在其后插入：

```prisma
  qualityRequirement String?                   // 质量目标/标准（项目级统一，唱标带出）
  bondRequired        Boolean  @default(false)  // 是否要求投标保证金
  bondAmount          Decimal? @db.Decimal(14, 2) // 保证金金额（仅记录，不严格校验）
```

- [ ] **Step 2: 在 `SupplierBidSubmission` 模型 `coverLetterAssetId` 后追加保证金凭证字段**

定位 `coverLetterAssetId  String?` 行，在其后（`technicalSealedKey` 之前）插入：

```prisma
  bidBondAssetId       String?   // 投标保证金缴纳凭证 → FileAsset.id（程序性文件，不加密）
```

并在模型末尾的索引区（`@@index([coverLetterAssetId])` 之后）加：

```prisma
  @@index([bidBondAssetId])
```

> 命名说明：用 `bidBondAssetId`（非 `bondReceiptAssetId`），与技术/商务 `technicalFileAssetId`、`businessFileAssetId` 风格一致。

- [ ] **Step 3: 生成迁移 SQL（create-only，不落库）**

Run（在 `water-erp/` 下）:
```bash
pnpm --filter api exec prisma migrate dev --create-only --name add_quality_and_bond_fields
```
Expected: 生成 `apps/api/prisma/migrations/<ts>_add_quality_and_bond_fields/migration.sql`，控制台输出 "Migration created". `--create-only` 仅创建不应用、不触发交互/危险确认。打开 SQL 确认含 4 个 `ALTER TABLE ... ADD COLUMN`（3 个 bid_project + 1 个 supplier_bid_submission，全部可空）。

- [ ] **Step 4: 应用迁移到 DB（prisma db execute）**

遵循 CLAUDE.md 非交互迁移规范（create-only → db execute → migrate resolve，规避 `migrate dev` 的交互/reset 风险）。

Run:
```bash
MIGNAME=$(ls -1 apps/api/prisma/migrations/ | grep add_quality_and_bond_fields | head -1)
pnpm --filter api exec prisma db execute --file "prisma/migrations/${MIGNAME}/migration.sql" --schema prisma/schema.prisma
```
Expected: 执行 4 条 ALTER TABLE，无报错。

- [ ] **Step 5: 标记迁移已应用（migrate resolve）**

Run:
```bash
pnpm --filter api exec prisma migrate resolve --applied "${MIGNAME}"
```
Expected: `Migration ${MIGNAME} marked as applied.`

- [ ] **Step 6: 重新生成 Prisma Client**

Run:
```bash
pnpm db:generate
```
Expected: `✔ Generated Prisma Client`，无类型错误。新字段 `qualityRequirement / bondRequired / bondAmount / bidBondAssetId` 类型可用。

> 所有新字段均可空，存量数据零影响；本步不跑 `db:seed`。

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(bid): schema 加质量目标/保证金配置字段 + 保证金凭证引用"
```

---

## Task 2: 保证金状态枚举纯函数 + 测试（TDD）

**Files:**
- Create: `apps/api/src/bid/bid-bond-status.ts`
- Create: `apps/api/src/bid/bid-bond-status.spec.ts`

**Interfaces:**
- Produces: `BOND_STATUS`（常量对象）、`BondStatusValue`（类型）、`BOND_STATUS_OPTIONS`（下拉选项数组）、`isBondQualified(status): boolean`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/bid/bid-bond-status.spec.ts`：

```ts
import { BOND_STATUS, BOND_STATUS_OPTIONS, isBondQualified } from './bid-bond-status';

describe('bid-bond-status', () => {
  it('已缴纳 视为合格', () => {
    expect(isBondQualified(BOND_STATUS.PAID)).toBe(true);
  });

  it('保函有效 视为合格', () => {
    expect(isBondQualified(BOND_STATUS.GUARANTEE)).toBe(true);
  });

  it('未缴纳 视为不合格', () => {
    expect(isBondQualified(BOND_STATUS.UNPAID)).toBe(false);
  });

  it('异常 视为不合格', () => {
    expect(isBondQualified(BOND_STATUS.ABNORMAL)).toBe(false);
  });

  it('空值视为不合格（未核对）', () => {
    expect(isBondQualified(null)).toBe(false);
    expect(isBondQualified(undefined)).toBe(false);
    expect(isBondQualified('')).toBe(false);
  });

  it('未知字符串视为不合格', () => {
    expect(isBondQualified('随便填的')).toBe(false);
  });

  it('BOND_STATUS_OPTIONS 含 4 个固定值', () => {
    expect(BOND_STATUS_OPTIONS).toEqual(['已缴纳', '保函有效', '未缴纳', '异常']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --filter api test -- bid-bond-status
```
Expected: FAIL，`Cannot find module './bid-bond-status'`。

- [ ] **Step 3: 写实现**

创建 `apps/api/src/bid/bid-bond-status.ts`：

```ts
/** 投标保证金核对状态（主持人开标时人工核对录入，固定枚举，禁止自由文本）。 */
export const BOND_STATUS = {
  PAID: '已缴纳',
  GUARANTEE: '保函有效',
  UNPAID: '未缴纳',
  ABNORMAL: '异常',
} as const;

export type BondStatusValue = (typeof BOND_STATUS)[keyof typeof BOND_STATUS];

/** 前端下拉选项（顺序即展示顺序）。 */
export const BOND_STATUS_OPTIONS: BondStatusValue[] = [
  BOND_STATUS.PAID,
  BOND_STATUS.GUARANTEE,
  BOND_STATUS.UNPAID,
  BOND_STATUS.ABNORMAL,
];

const QUALIFIED_STATUSES: ReadonlySet<string> = new Set([BOND_STATUS.PAID, BOND_STATUS.GUARANTEE]);

/** 保证金是否达标（已缴纳或保函有效）。空值/未核对/异常 → false。 */
export function isBondQualified(status: string | null | undefined): boolean {
  return !!status && QUALIFIED_STATUSES.has(status);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm --filter api test -- bid-bond-status
```
Expected: PASS，7 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid-bond-status.ts apps/api/src/bid/bid-bond-status.spec.ts
git commit -m "feat(bid): 新增保证金状态枚举与 isBondQualified 纯函数"
```

---

## Task 3: 项目级字段写入 DTO 与 service（TDD）

**Files:**
- Modify: `apps/api/src/bid/dto/create-bid-project.dto.ts`
- Modify: `apps/api/src/bid/dto/update-bid-project.dto.ts`
- Modify: `apps/api/src/bid/bid.service.ts`（`createProject` 约 `:282`、`updateProject` 约 `:388`）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 Prisma client 新字段类型
- Produces: `CreateBidProjectDto.qualityRequirement / bondRequired / bondAmount`，`createProject` / `updateProject` 持久化这 3 个字段

- [ ] **Step 1: 扩展 CreateBidProjectDto**

在 `apps/api/src/bid/dto/create-bid-project.dto.ts` 的 `contact` 字段后追加：

```ts
  @IsString() @IsOptional() qualityRequirement?: string;
  @IsBoolean() @IsOptional() bondRequired?: boolean;
  @IsNumber() @IsOptional() bondAmount?: number;
```

并在顶部 import 补 `IsBoolean`：
```ts
import { IsString, IsNotEmpty, IsDateString, IsOptional, IsNumber, IsBoolean } from 'class-validator';
```

- [ ] **Step 2: 扩展 UpdateBidProjectDto**

在 `apps/api/src/bid/dto/update-bid-project.dto.ts` 的 `contact` 字段后追加同样 3 个字段（全部 `@IsOptional()`），并补 `IsBoolean` import。

- [ ] **Step 3: 写失败测试 — createProject 持久化新字段**

在 `apps/api/src/bid/bid.service.spec.ts` 文件末尾新增 describe 块（参考既有 `BidService — stage transitions` 的 prisma mock 模式；若 mock 对象的 `bidProject.create` 已被 mock 为 `jest.fn()`，直接断言调用参数）：

```ts
describe('BidService — createProject 字段写入', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        create: jest.fn().mockResolvedValue({ id: 'p1', name: 'X', projectCode: 'BID-1' }),
      },
      notificationService: { sendToRole: jest.fn().mockResolvedValue(undefined) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('createProject 写入 qualityRequirement / bondRequired / bondAmount', async () => {
    await service.createProject({
      name: '测试项目', procurementMethod: '公开招标',
      openTime: '2026-07-01T00:00:00.000Z', deadline: '2026-07-10T00:00:00.000Z',
      qualityRequirement: '合格', bondRequired: true, bondAmount: 200000,
    } as any);

    expect(prisma.bidProject.create).toHaveBeenCalledTimes(1);
    const arg = prisma.bidProject.create.mock.calls[0][0].data;
    expect(arg.qualityRequirement).toBe('合格');
    expect(arg.bondRequired).toBe(true);
    expect(Number(arg.bondAmount)).toBe(200000);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run:
```bash
pnpm --filter api test -- "createProject 字段写入"
```
Expected: FAIL，`arg.qualityRequirement` 为 `undefined`（当前 createProject 未写入）。

- [ ] **Step 5: 改 createProject 写入新字段**

在 `apps/api/src/bid/bid.service.ts` `createProject`（约 `:282`）的 `this.prisma.bidProject.create({ data: { ... } })` 内，`riskNote: dto.riskNote,` 行后追加：

```ts
        qualityRequirement: dto.qualityRequirement,
        bondRequired: dto.bondRequired ?? false,
        bondAmount: dto.bondAmount,
```

- [ ] **Step 6: 改 updateProject 写入新字段**

在 `updateProject`（约 `:388`）的 `data: { ... }` 内，`...(dto.contact !== undefined && { contact: dto.contact }),` 行后追加：

```ts
        ...(dto.qualityRequirement !== undefined && { qualityRequirement: dto.qualityRequirement }),
        ...(dto.bondRequired !== undefined && { bondRequired: dto.bondRequired }),
        ...(dto.bondAmount !== undefined && { bondAmount: dto.bondAmount }),
```

- [ ] **Step 7: 跑测试确认通过**

Run:
```bash
pnpm --filter api test -- "createProject 字段写入"
```
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bid/dto/*.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): 项目创建/更新支持质量目标与保证金配置字段"
```

---

## Task 4: 供应商上传保证金凭证（submission 字段打通）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（`BidSubmissionData` 约 `:17`、`assertBidFileAssetsOwnedByUser` 调用处 `:405` / `:533`）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（submit `:177`、draft `:165` 的 body 类型）

**Interfaces:**
- Consumes: Task 1 的 `SupplierBidSubmission.bidBondAssetId`
- Produces: `BidSubmissionData.bidBondAssetId?: string`；submit/draft 端点接受并持久化该字段（`...data` 展开会自动写入，无需额外 create/update 改动）

- [ ] **Step 1: BidSubmissionData 加字段**

在 `apps/api/src/supplier-portal/supplier-portal.service.ts` 顶部 `BidSubmissionData` 接口（约 `:17-24`）的 `coverLetterAssetId?: string;` 后追加：

```ts
  bidBondAssetId?: string;
```

- [ ] **Step 2: submitBid 的资产归属校验补 bidBondAssetId**

在 `submitBid`（约 `:405`）将：
```ts
    await this.assertBidFileAssetsOwnedByUser(supplier.userId, [
      data.technicalFileAssetId,
      data.businessFileAssetId,
      data.coverLetterAssetId,
    ]);
```
改为追加一行：
```ts
    await this.assertBidFileAssetsOwnedByUser(supplier.userId, [
      data.technicalFileAssetId,
      data.businessFileAssetId,
      data.coverLetterAssetId,
      data.bidBondAssetId,
    ]);
```

- [ ] **Step 3: saveBidDraft 同样补校验**

在 `saveBidDraft`（约 `:533`）的 `assertBidFileAssetsOwnedByUser` 调用数组末尾同样追加 `data.bidBondAssetId,`。

- [ ] **Step 4: controller submit/draft body 类型补字段**

在 `apps/api/src/supplier-portal/supplier-portal.controller.ts` 的 `saveBidDraft`（约 `:165`）与 `submitBid`（约 `:177`）两个方法的 `@Body() body: { ... }` 类型中，`coverLetterAssetId?: string;` 后追加：

```ts
      bidBondAssetId?: string;
```

- [ ] **Step 5: 验证编译**

Run:
```bash
pnpm --filter api exec tsc --noEmit
```
Expected: 无错误。（`...data` 展开会自动把 `bidBondAssetId` 写入 create/update，无需改 prisma 调用。）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.controller.ts
git commit -m "feat(supplier-portal): 投标提交支持保证金凭证上传"
```

---

## Task 5: opening-draft 预填端点（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（新增 `getOpeningRecordDraft` 方法）
- Modify: `apps/api/src/bid/bid.controller.ts`（新增 `GET` 端点）
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（前端封装）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 字段、Task 3 的 project 字段、现有 `submission.bidPrice/deliveryPeriod`、`openingRecord.bondStatus`
- Produces: `GET /api/bid/projects/:id/suppliers/:supplierId/opening-draft` → `{ amount, period, qualityTarget, bondStatus, bidBondAssetId }`；门控：`stage=OPENING` 且该供应商 `decryptStatus=SUCCESS` 才返回数据，否则 `canView=false` 且字段为 null

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 末尾新增：

```ts
describe('BidService — getOpeningRecordDraft', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('OPENING 阶段且解密成功 → 返回预填数据', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '980000', deliveryPeriod: '180天', bidBondAssetId: 'fa-1' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳' });

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft).toEqual({
      canView: true,
      amount: '980000',
      period: '180天',
      qualityTarget: '合格',
      bondStatus: '已缴纳',
      bidBondAssetId: 'fa-1',
    });
  });

  it('非 OPENING 阶段 → canView=false 且不抛异常', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'SUBMIT', qualityRequirement: null, bondRequired: false });
    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(false);
    expect(draft.amount).toBeNull();
  });

  it('未解密成功 → canView=false', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: null, bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', decryptStatus: 'PENDING', supplierName: '甲' });
    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --filter api test -- "getOpeningRecordDraft"
```
Expected: FAIL，`service.getOpeningRecordDraft is not a function`。

- [ ] **Step 3: 实现 service 方法**

在 `bid.service.ts` 的 `listOpeningRecords` 方法（约 `:756`）后新增：

```ts
  /**
   * 唱标预填草稿：聚合项目级质量目标 + 投标提交的报价/工期 + 已有开标记录的保证金状态。
   * 仅 OPENING 阶段且该供应商解密成功才返回真实数据（canView=true），
   * 保证金凭证（bidBondAssetId）同样仅此时可见，供主持人核对。
   */
  async getOpeningRecordDraft(projectId: string, bidSupplierId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, qualityRequirement: true, bondRequired: true },
    });
    const empty = { canView: false, amount: null, period: null, qualityTarget: null, bondStatus: null, bidBondAssetId: null };
    if (!project || project.stage !== 'OPENING') return { ...empty, qualityTarget: project?.qualityRequirement ?? null };

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: bidSupplierId, projectId },
      select: { id: true, decryptStatus: true, supplierId: true, supplierName: true },
    });
    if (!bidSupplier || bidSupplier.decryptStatus !== 'SUCCESS') return empty;

    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
          select: { bidPrice: true, deliveryPeriod: true, bidBondAssetId: true },
        })
      : null;

    const existingRecord = await this.prisma.bidOpeningRecord.findFirst({
      where: { projectId, bidSupplierId },
      select: { bondStatus: true },
    });

    return {
      canView: true,
      amount: submission?.bidPrice ?? null,
      period: submission?.deliveryPeriod ?? null,
      qualityTarget: project.qualityRequirement,
      bondStatus: existingRecord?.bondStatus ?? null,
      bidBondAssetId: submission?.bidBondAssetId ?? null,
    };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm --filter api test -- "getOpeningRecordDraft"
```
Expected: PASS，3 个用例全绿。

- [ ] **Step 5: 加 controller 端点**

在 `bid.controller.ts` 的 `enterOpeningRecord`（`@Post('projects/:id/opening-records')`，约 `:115`）前插入：

```ts
  @Get('projects/:id/suppliers/:supplierId/opening-draft')
  @ApiOperation({ summary: '唱标预填草稿（OPENING 阶段聚合报价/工期/质量目标/保证金凭证）' })
  getOpeningRecordDraft(@Param('id') id: string, @Param('supplierId') supplierId: string) {
    return this.bidService.getOpeningRecordDraft(id, supplierId);
  }
```

- [ ] **Step 6: 前端 api 封装**

在 `apps/bid-portal/src/lib/api/bid.ts` 导出（参考同文件既有 `enterOpeningRecord` 的写法）：

```ts
export const getOpeningDraft = (projectId: string, supplierId: string) =>
  api.get(`/bid/projects/${projectId}/suppliers/${supplierId}/opening-draft`).then(r => r.data);
```

- [ ] **Step 7: 编译 + 全量单测回归**

Run:
```bash
pnpm --filter api exec tsc --noEmit && pnpm --filter api test
```
Expected: 编译无错，全部测试通过。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/bid/bid.controller.ts apps/bid-portal/src/lib/api/bid.ts
git commit -m "feat(bid): 新增唱标预填草稿端点（聚合报价/工期/质量目标/保证金凭证）"
```

---

## Task 6: 评标结果生成 — 保证金异常软标记（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`generateEvaluationResults` 约 `:862`）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `isBondQualified`、`BidOpeningRecord.bondStatus`、`BidProject.bondRequired`

**设计要点（软标记，不排除）：** `activeSuppliers` 过滤条件**不变**（不因保证金排除任何供应商）；当 `project.bondRequired=true` 且某供应商 `bondStatus` 未达标时，在生成结果的同一事务内写一条**监督日志**（riskFlag='高风险'），提醒评标委员会审查，但不影响其排名与候选人资格。

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 末尾新增（覆盖：软标记写监督日志、但不把供应商从结果剔除）：

```ts
describe('BidService — generateEvaluationResults 保证金软标记', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb({
        bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
        bidSupervisionLog: { create: jest.fn() },
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('bondRequired 且某供应商保证金未达标 → 写高风险监督日志，但仍纳入排名', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: true,
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    prisma.bidOpeningRecord.findMany.mockResolvedValue([{ bidSupplierId: 's1', bondStatus: '未缴纳' }]);
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find(
      (c: any[]) => c[0].data.riskFlag === '高风险' && String(c[0].data.action).includes('保证金'),
    );
    expect(flagged).toBeTruthy();
  });

  it('bondRequired=false → 不写保证金监督日志', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: false,
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find((c: any[]) => String(c[0].data.action).includes('保证金'));
    expect(flagged).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --filter api test -- "保证金软标记"
```
Expected: FAIL（当前无软标记逻辑，找不到 riskFlag='高风险' 且 action 含「保证金」的日志）。

- [ ] **Step 3: 实现软标记**

在 `bid.service.ts` 顶部 import 区加：
```ts
import { isBondQualified } from './bid-bond-status';
```

在 `generateEvaluationResults` 内，`const activeSupplierIds = activeSuppliers.map(s => s.id);`（约 `:876`）**之前**插入批量查询：

```ts
    // 保证金软标记：bondRequired 时查各供应商 bondStatus，异常者写监督日志（不排除，由评标委员会定）
    const bondFlagged: { supplierName: string; bondStatus: string }[] = [];
    if (project.bondRequired) {
      const openingRecords = await this.prisma.bidOpeningRecord.findMany({
        where: { projectId },
        select: { bidSupplierId: true, bondStatus: true, supplierName: true },
      });
      const bondBySupplier = new Map(openingRecords.map(r => [r.bidSupplierId, r.bondStatus]));
      for (const s of activeSuppliers) {
        const status = bondBySupplier.get(s.id);
        if (!isBondQualified(status)) {
          bondFlagged.push({ supplierName: s.supplierName, bondStatus: status || '未核对' });
        }
      }
    }
```

然后在 `$transaction` 内（在 `bidSupervisionLog.create` 的「生成评标结果」日志**之后**）追加：

```ts
      for (const f of bondFlagged) {
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: f.supplierName,
            action: '保证金异常标记', result: `保证金状态：${f.bondStatus}（未达标，供评标委员会审查）`, riskFlag: '高风险',
          },
        });
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm --filter api test -- "保证金软标记"
```
Expected: PASS，2 个用例全绿。

- [ ] **Step 5: 全量回归**

Run:
```bash
pnpm --filter api test
```
Expected: 全部通过（含既有 stage transition、createProject 等用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): 评标结果生成对保证金未达标供应商做软标记（写监督日志，不排除）"
```

---

## Task 7: bid-portal 项目创建对话框 — 质量目标 + 保证金配置

**Files:**
- Modify: `apps/bid-portal/src/components/create-project-dialog.tsx`

**Interfaces:**
- Consumes: Task 3 的 `CreateBidProjectDto` 新字段
- Produces: 创建项目时携带 `qualityRequirement / bondRequired / bondAmount`

- [ ] **Step 1: 加 state**

在 `create-project-dialog.tsx` 的 `const [riskNote, setRiskNote] = useState('');`（约 `:19`）后追加：

```tsx
  const [qualityRequirement, setQualityRequirement] = useState('');
  const [bondRequired, setBondRequired] = useState(false);
  const [bondAmount, setBondAmount] = useState('');
```

- [ ] **Step 2: 提交体带新字段**

在 `handleCreate`（约 `:36`，`api.post(... bid/projects ..., { name, procurementMethod, openTime, deadline, ... })`）的 payload 对象内，`riskNote,` 后追加：

```tsx
        qualityRequirement: qualityRequirement.trim() || undefined,
        bondRequired,
        bondAmount: bondAmount ? Number(bondAmount) : undefined,
```

- [ ] **Step 3: 加表单 UI**

在 `riskNote` 对应的 textarea 表单项之后（截标时间字段之后、提交按钮之前），插入：

```tsx
            <label className="text-xs font-bold text-[#18243a]">质量目标 / 标准</label>
            <input value={qualityRequirement} onChange={e => setQualityRequirement(e.target.value)}
              className="workbench-input mt-1 w-full" placeholder="如 合格，符合 GB50300 验收标准（项目级统一，唱标带出）" />

            <label className="mt-3 flex items-center gap-2 text-xs font-bold text-[#18243a]">
              <input type="checkbox" checked={bondRequired} onChange={e => setBondRequired(e.target.checked)}
                className="h-4 w-4 rounded border-[#dce6f3]" />
              要求投标保证金
            </label>
            {bondRequired && (
              <div className="mt-2">
                <label className="text-xs font-semibold text-[#5a6d8a]">保证金金额（元，仅记录，不严格校验）</label>
                <input value={bondAmount} onChange={e => setBondAmount(e.target.value)}
                  className="workbench-input mt-1 w-full font-mono" placeholder="如 200000" />
              </div>
            )}
```

- [ ] **Step 4: 手动验证**

Run（在 `water-erp/`）:
```bash
pnpm dev:bid
```
手动：登录开评标端 → 新建项目 → 填质量目标 + 勾选保证金 + 填金额 → 提交 → 在 Prisma Studio（`pnpm db:studio`）确认 `BidProject` 行含 `qualityRequirement / bondRequired=true / bondAmount`。

- [ ] **Step 5: Commit**

```bash
git add apps/bid-portal/src/components/create-project-dialog.tsx
git commit -m "feat(bid-portal): 项目创建表单增加质量目标与保证金配置"
```

---

## Task 8: supplier-portal 投标提交 — 保证金凭证上传

**Files:**
- Modify: `apps/supplier-portal/src/views/bid/BidSubmit.vue`
- Modify: `apps/supplier-portal/src/api/supplier.ts`（若 submitBid/saveBidDraft 有显式参数类型）

**Interfaces:**
- Consumes: Task 4 的 `bidBondAssetId` 字段、`project.bondRequired`（来自 bidStore.fetchProject）

- [ ] **Step 1: form 加字段 + 上传 state**

在 `BidSubmit.vue` 的 `const form = ref({ bidPrice: '', deliveryPeriod: '', technicalFileAssetId: '', businessFileAssetId: '', coverLetter: '' })`（约 `:15`）改为：

```js
const form = ref({ bidPrice: '', deliveryPeriod: '', technicalFileAssetId: '', businessFileAssetId: '', coverLetter: '', bidBondAssetId: '' })
```

在 `techFileMeta`/`bizFileMeta` 旁（约 `:16` 附近）追加：
```js
const bondFileMeta = ref<FileAssetResponse | null>(null)
const bondUploadProgress = ref<number | null>(null)
```

- [ ] **Step 2: 加上传处理函数**

在 `const uploadBiz = (o: any) => handleFileUpload(o, 'businessFileAssetId');`（约 `:33`）后追加：

```js
const uploadBond = (o: any) => handleFileUpload(o, 'bidBondAssetId')
```

> `handleFileUpload`（`:26`）的 `field` 联合类型需扩展为 `'technicalFileAssetId' | 'businessFileAssetId' | 'bidBondAssetId'`，并把内部 `field==='technicalFileAssetId' ? techFileMeta : bizFileMeta` 改为三分支（bond → bondFileMeta）。完整改法：将该函数末尾 `if (field==='technicalFileAssetId') techFileMeta.value = res; else bizFileMeta.value = res;` 改为：
```js
if (field === 'technicalFileAssetId') techFileMeta.value = res
else if (field === 'businessFileAssetId') bizFileMeta.value = res
else bondFileMeta.value = res
```

- [ ] **Step 3: 草稿恢复 / 回显补字段**

在 `:37` 与 `:39` 两处 `form.value = { bidPrice: ..., deliveryPeriod: ..., technicalFileAssetId: ..., businessFileAssetId: ..., coverLetter: ... }` 对象末尾补 `, bidBondAssetId: sub.bidBondAssetId || ''`。

- [ ] **Step 4: checks 清单加保证金项**

在 checks 数组（约 `:48-51`）末尾追加（仅当项目要求保证金时显示为必填）：

```js
    { label:'投标保证金凭证', detail: form.value.bidBondAssetId ? '已上传' : '未上传', ok: !!form.value.bidBondAssetId, required: !!bidStore.project?.bondRequired },
```

并确保 `canConfirm`（约 `:52-53`）的计算逻辑对 `required && !ok` 的项判失败（既有逻辑应已支持；若 canConfirm 是 `checks.value.filter(c=>c.required).every(c=>c.ok)` 则无需改）。

- [ ] **Step 5: 表单 UI 加上传项**

在商务文件 `el-form-item`（约 `:89`）之后、投标函之前插入（用 `v-if="bidStore.project?.bondRequired"` 控制显隐）：

```html
          <el-form-item v-if="bidStore.project?.bondRequired" label="保证金凭证" required>
            <div class="file-area">
              <el-upload :http-request="uploadBond" :show-file-list="false" :disabled="!canSubmit">
                <el-button type="primary" plain :disabled="!canSubmit"><el-icon><Upload /></el-icon>上传保证金缴纳凭证</el-button>
              </el-upload>
              <span class="file-hint">银行回单/保函，PDF≤50MB</span>
              <span v-if="bondFileMeta" class="file-name">{{ bondFileMeta.originalName }}（{{ formatSize(bondFileMeta.size) }}）</span>
              <span v-else-if="form.bidBondAssetId" class="file-name">已上传</span>
              <el-progress v-if="bondUploadProgress!==null" :percentage="bondUploadProgress" :stroke-width="6" style="width:200px" />
            </div>
          </el-form-item>
```

- [ ] **Step 6: 手动验证**

Run:
```bash
pnpm dev:supplier
```
手动：用一个要求保证金的项目 → 投标页应出现「保证金凭证」必传项 → 上传 → 提交 → Prisma Studio 确认 `SupplierBidSubmission.bidBondAssetId` 已写入。

- [ ] **Step 7: Commit**

```bash
git add apps/supplier-portal/src/views/bid/BidSubmit.vue apps/supplier-portal/src/api/supplier.ts
git commit -m "feat(supplier-portal): 投标提交支持保证金凭证上传（项目要求时必填）"
```

---

## Task 9: 开标大厅 — 唱标预填 + bondStatus 下拉 + 凭证查看

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`

**Interfaces:**
- Consumes: Task 5 的 `getOpeningDraft`、Task 2 的 `BOND_STATUS_OPTIONS`（前端需镜像一份常量）

- [ ] **Step 1: 前端镜像 bondStatus 选项常量**

在 `bid/open/page.tsx` 顶部（其他 const 之后）加：

```tsx
const BOND_STATUS_OPTIONS = ['已缴纳', '保函有效', '未缴纳', '异常'] as const;
```

并 import：
```tsx
import { getOpeningDraft } from '@/lib/api';
```

- [ ] **Step 2: 打开唱标弹窗时拉取预填草稿**

将「唱标」按钮的点击处理（当前约 `:264`，原为 `setRecordEntry({...}); setRecordDraft({ amount:'', ... })`）改为异步拉取：

```tsx
const openRecordEntry = async (s: any) => {
  if (!projectId) return;
  setRecordEntry({ bidSupplierId: s.id, supplierName: s.supplierName });
  setRecordDraft({ amount: '', period: '', qualityTarget: '', bondStatus: '' });
  setBidBondAssetId(null);
  try {
    const draft = await getOpeningDraft(projectId, s.id);
    if (draft.canView) {
      setRecordDraft({
        amount: draft.amount ?? '',
        period: draft.period ?? '',
        qualityTarget: draft.qualityTarget ?? '',
        bondStatus: draft.bondStatus ?? '',
      });
      setBidBondAssetId(draft.bidBondAssetId ?? null);
    }
  } catch { /* 预填失败不阻断手填 */ }
};
```

并在组件 state 区（约 `:142-143`）追加：
```tsx
const [bidBondAssetId, setBidBondAssetId] = useState<string | null>(null);
```
把原「唱标」按钮 `onClick` 指向 `() => openRecordEntry(s)`。

- [ ] **Step 3: bondStatus 输入改下拉 + 凭证查看按钮**

在唱标录入弹窗（约 `:686` 的「保证金」`<label>`）替换为：

```tsx
              <label className="text-xs font-semibold text-[#5a6d8a]">
                保证金
                <select value={recordDraft.bondStatus}
                  onChange={e => setRecordDraft(d => ({ ...d, bondStatus: e.target.value }))}
                  className="workbench-input mt-1 w-full">
                  <option value="">— 请核对凭证后选择 —</option>
                  {BOND_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {bidBondAssetId && (
                  <a href={`/api/upload/files/${bidBondAssetId}`} target="_blank" rel="noreferrer"
                     className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-[#064ea2] hover:underline">
                    <FileText size={12} strokeWidth={1.5} /> 查看保证金凭证
                  </a>
                )}
              </label>
```

（`FileText` 图标若未 import，从 `lucide-react` 补 import。）

- [ ] **Step 4: 开标记录表格保证金列着色**

将保证金单元格（约 `:583`，原 `<td className="px-5 py-3 ...">{r.bondStatus}</td>`）改为按状态着色：

```tsx
                  <td className={`px-5 py-3 text-[13px] font-bold ${r.bondStatus === '已缴纳' || r.bondStatus === '保函有效' ? 'text-emerald-600' : r.bondStatus === '未缴纳' || r.bondStatus === '异常' ? 'text-red-600' : 'text-[oklch(0.55_0.01_264)]'}`}>
                    {r.bondStatus || '—'}
                  </td>
```

- [ ] **Step 5: 手动验证（端到端闭环）**

Run:
```bash
pnpm dev:bid
```
手动流程：
1. 选一个 `bondRequired=true` 且已有供应商解密成功的 OPENING 项目；
2. 点某供应商「唱标」→ 报价/工期/质量目标应**自动带出**，保证金为空下拉 + 「查看凭证」链接可点开凭证；
3. 核对凭证后选「已缴纳」→ 提交唱标 → 开标记录表保证金列显示绿色「已缴纳」；
4. 另选一家未交的 → 选「未缴纳」→ 记录列红色；
5. 推进到评标 → 生成评标结果 → 监督端应见「保证金异常标记」高风险日志，但该供应商仍在排名内。

- [ ] **Step 6: Commit**

```bash
git add apps/bid-portal/src/app/\(dashboard\)/bid/open/page.tsx
git commit -m "feat(bid-portal): 唱标弹窗自动预填 + bondStatus 下拉 + 凭证查看 + 记录着色"
```

---

## Task 10: seed 数据补充（可选，便于演示）

**Files:**
- Modify: `apps/api/prisma/seed-data/BidProject.json`

- [ ] **Step 1: 给英雄项目补字段**

在 `BidProject.json` 的英雄项目对象（seed 的主角项目）内追加：

```json
  "qualityRequirement": "合格，符合国家现行施工质量验收规范",
  "bondRequired": true,
  "bondAmount": 200000
```

- [ ] **Step 2: 重灌 seed 验证**

Run:
```bash
pnpm db:seed
```
Expected: 无错误，Prisma Studio 确认英雄项目含新字段。

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/seed-data/BidProject.json
git commit -m "chore(seed): 英雄项目补质量目标与保证金配置"
```

---

## 完成判据（Definition of Done）

- [ ] 4 个新 schema 字段已迁移且 Prisma client 已重新生成
- [ ] 后端单测全绿（含 bid-bond-status、createProject 字段、opening-draft、保证金软标记）
- [ ] 主持人点「唱标」时报价/工期/质量目标自动带出，bondStatus 下拉选择
- [ ] 主持人可查看保证金凭证（OPENING 阶段）
- [ ] 供应商在要求保证金的项目里必须上传凭证才能提交
- [ ] 保证金未达标的供应商仍进入评标排名，但监督端有「保证金异常标记」高风险日志
- [ ] 存量数据零影响（所有新字段可空）
