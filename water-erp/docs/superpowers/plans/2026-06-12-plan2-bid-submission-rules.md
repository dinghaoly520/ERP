# Plan 2: 投标提交规则补完

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 给供应商投标提交添加项目阶段校验、截止时间校验，并将 B 新增的 supplierId 填入 BidSupplier 记录。

**Architecture:** 在 SupplierPortalService 中添加 `assertCanSubmitBid` 私有方法，统一校验 supplier 状态 + project 阶段 + deadline。重构 `submitBid` 调用此方法。BidSupplier 创建/更新时填入 `supplierId`。

**Tech Stack:** NestJS 11, Prisma, Jest

**Branch:** `fix/bid-submission-rules`

**前置依赖:** Plan 1 (阶段机)

---

## Step 1: 创建分支

```bash
cd D:/Claude projects/ERP-main/water-erp
git checkout main
git pull origin main
git checkout -b fix/bid-submission-rules
```

## Step 2: 添加 `assertCanSubmitBid`

在 `apps/api/src/supplier-portal/supplier-portal.service.ts` 的 `SupplierPortalService` 类中添加：

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

## Step 3: 修改 `submitBid`

将方法中原来的单独 supplier 查询替换为 `assertCanSubmitBid`，并在 BidSupplier 操作中填入 `supplierId`：

```ts
async submitBid(supplierId: string, projectId: string, data: {
  bidPrice?: string;
  deliveryPeriod?: string;
  technicalFile?: string;
  businessFile?: string;
  coverLetter?: string;
}) {
  const { supplier } = await this.assertCanSubmitBid(supplierId, projectId);

  const existing = await this.prisma.supplierBidSubmission.findUnique({
    where: { supplierId_projectId: { supplierId, projectId } },
  });
  if (existing && existing.status === 'submitted') {
    throw new BadRequestException({ error: '已提交过标书，不可重复提交', code: 'ALREADY_SUBMITTED' });
  }

  const now = new Date();

  if (existing) {
    return this.prisma.supplierBidSubmission.update({
      where: { id: existing.id },
      data: { ...data, status: 'submitted', submittedAt: now },
    });
  }

  const submission = await this.prisma.supplierBidSubmission.create({
    data: { supplierId, projectId, ...data, status: 'submitted', submittedAt: now },
  });

  // 同步 BidSupplier — 填入 supplierId
  const existingBidSupplier = await this.prisma.bidSupplier.findFirst({
    where: { projectId, supplierName: supplier.name },
  });
  if (existingBidSupplier) {
    await this.prisma.bidSupplier.update({
      where: { id: existingBidSupplier.id },
      data: { submitStatus: '已提交', encryptStatus: '密文已校验', supplierId },
    });
  } else {
    const receiptNo = `TB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
    await this.prisma.bidSupplier.create({
      data: {
        projectId, supplierId,
        supplierName: supplier.name,
        downloadStatus: '已下载',
        submitStatus: '已提交',
        encryptStatus: '密文已校验',
        receiptNo,
      },
    });
  }

  return submission;
}
```

## Step 4: 编写单元测试

追加到 `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`：

```ts
it('rejects submission when project is not in SUBMIT stage', async () => {
  prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
  prisma.bidProject.findUnique.mockResolvedValue({
    id: 'project-1', stage: 'OPENING',
    deadline: new Date(Date.now() + 3600_000),
  });
  await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
    .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_SUBMITTING' } });
});

it('rejects submission after deadline', async () => {
  prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
  prisma.bidProject.findUnique.mockResolvedValue({
    id: 'project-1', stage: 'SUBMIT',
    deadline: new Date(Date.now() - 3600_000),
  });
  await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
    .rejects.toMatchObject({ response: { code: 'DEADLINE_PASSED' } });
});

it('rejects non-APPROVED supplier', async () => {
  prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-2', name: '待审供应商', status: 'PENDING' });
  prisma.bidProject.findUnique.mockResolvedValue({
    id: 'project-1', stage: 'SUBMIT',
    deadline: new Date(Date.now() + 3600_000),
  });
  await expect(service.submitBid('supplier-2', 'project-1', { bidPrice: '100' }))
    .rejects.toMatchObject({ response: { code: 'NOT_APPROVED' } });
});

it('allows valid submission', async () => {
  prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
  prisma.bidProject.findUnique.mockResolvedValue({
    id: 'project-1', stage: 'SUBMIT',
    deadline: new Date(Date.now() + 3600_000),
  });
  prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
  prisma.supplierBidSubmission.create.mockResolvedValue({
    id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
  });
  prisma.bidSupplier.findFirst.mockResolvedValue(null);
  prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-1', supplierId: 'supplier-1' });

  const result = await service.submitBid('supplier-1', 'project-1', { bidPrice: '100' });
  expect(result.status).toBe('submitted');
});
```

注意：需要在 describe 块的 `beforeEach` 中为 prisma mock 添加 `bidProject.findUnique` 和 `bidSupplier.findFirst`、`bidSupplier.create` 方法。

## Step 5: 构建 & 测试

```bash
pnpm --filter api build
pnpm --filter api test -- supplier-portal.service.spec.ts
```

## Step 6: 提交

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat: enforce supplier bid submission rules

- Add assertCanSubmitBid with stage + deadline + status checks
- Throw PROJECT_NOT_SUBMITTING if project not in SUBMIT
- Throw DEADLINE_PASSED if past deadline
- Populate supplierId on BidSupplier records
- Add unit tests for all validation paths

Co-Authored-By: Claude <noreply@anthropic.com>"
```
