# 供应商投标意向确认与履约管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地公开项目「拟参与」意向确认（投递前置闸）+ 三处 :3005 视图意向维度 + 供应商参与情况全史 + 三次确认未投递自动拉黑。

**Architecture:** 新增 `SupplierBidIntent`（意向）与 `SupplierBidNoShow`（履约事故）两表；确认端点与投递闸在 supplier-portal 模块；履约扫描/自动拉黑/参与情况聚合在 supplier 模块新 `BidIntentOversightService`（Cron 兜底 + 阶段推进即时钩子）；读端在 getParticipants 族与 bid workspace 合并意向集。设计文档：`docs/superpowers/specs/2026-11-12-supplier-bid-intent-design.md`（ee7fc6fa4，口径裁定的唯一权威——实现与本文冲突时以 spec 为准并上报）。

**Tech Stack:** NestJS 11 + Prisma（PostgreSQL）、Next.js 16 App Router + React 19 + Tailwind v4（cgzxui）、jest。

## Global Constraints

- 所有用户可见文案为中文；界面禁英文/黑话（格式名、标准编号除外）。
- **RolesGuard 默认拒绝**：任何新路由必须显式 `@Roles(...)`（supplier-portal 控制器类级 `@Roles('supplier')` 已覆盖类内新端点；supplier 控制器无类级标注，须逐端点标）。
- **迁移铁律（本机 drift）**：`prisma migrate dev --create-only` → `prisma db execute --file` → `prisma migrate resolve --applied` → `prisma generate`；禁止 `migrate dev` 直跑（会要求 reset）。改 schema 后必须 `npx prisma validate` 再 generate。
- 每任务结束即提交，提交信息中文、格式 `feat(bid-intent): …` / `test(bid-intent): …`，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；只 add 本任务列出的文件。
- 前端遵循 cgzxui（无裸色、无平阴影、警示红用体系 token）；:3004 弹窗用 `SpDialog`。
- 后端测试命令（在 `apps/api` 下）：`pnpm test -- supplier-portal.service.spec.ts`（单文件）；`npx tsc --noEmit -p tsconfig.json` 不在 CI 外强求，但任务内 lint 必须过：`pnpm --filter api lint`（可 `--fix`）。
- 金额单位铁律不涉及本功能（无金额读写）；操作日志无需额外配置（POST 端点自动入 OperationLog）。
- 行号为 2026-11-12 快照，实施时以锚点 grep 复核为准。

---

### Task 1: Prisma 模型与迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（BidProject 关系块 :470-487、Supplier 关系块 :1582-1600、BidSupplier 模型后 :541）
- Create: `apps/api/prisma/migrations/<ts>_supplier_bid_intent/migration.sql`（由 create-only 生成）

**Interfaces:**
- Produces: `prisma.supplierBidIntent` / `prisma.supplierBidNoShow` 委托（后续全部任务依赖）；两模型字段见下。

- [ ] **Step 1: 编辑 schema.prisma**

在 `model BidSupplier` 结束（`@@index([supplierId])` 与 `}` 之后，约 :541）插入两个模型：

```prisma
/// 供应商参与意向（2026-11-12 履约闭环）：公开项目（BidDocument.accessScope=OPEN）供应商「拟参与」确认。
/// 邀请制（INVITED/DESIGNATED/谈判无文档）不适用——其承诺=InvitationRsvp 回执。单向确认不可撤回。
model SupplierBidIntent {
  id          String     @id @default(cuid())
  projectId   String
  supplierId  String
  confirmedAt DateTime   @default(now())
  createdAt   DateTime   @default(now())
  project     BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier    Supplier   @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@unique([projectId, supplierId])
  @@index([projectId])
}

/// 确认参与未投递事故（2026-11-12 履约闭环）：项目开标后（stage∈OPENING/EVALUATING/ARCHIVED）
/// 承诺方未投递。track: INTENT=公开意向 | RSVP=回执确认参加。legacy=承诺时间早于功能部署
/// （迁移完成时刻）——展示计入、不触发自动拉黑（2026-11-12 用户裁定：存量不追溯）。
/// 每项目每家一条（两轨去重、INTENT 优先）。
model SupplierBidNoShow {
  id         String     @id @default(cuid())
  projectId  String
  supplierId String
  track      String
  detectedAt DateTime   @default(now())
  legacy     Boolean    @default(false)
  project    BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier    Supplier   @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@unique([projectId, supplierId])
  @@index([supplierId])
}
```

BidProject 关系块（`bidSignPacket BidSignPacket?` 之前或之后均可）加：

```prisma
  bidIntents    SupplierBidIntent[]
  noShowRecords SupplierBidNoShow[]
```

Supplier 关系块（`companyLinks SupplierCompanyLink[] @relation("SupplierCompanyLinks")` 之后）加：

```prisma
  bidIntents    SupplierBidIntent[]
  noShowRecords SupplierBidNoShow[]
```

- [ ] **Step 2: 校验并生成迁移**

```bash
cd apps/api
npx prisma validate          # 必须 OK，否则 generate 会静默失败
npx prisma migrate dev --create-only --name supplier_bid_intent
```

生成的 SQL 应只含两张新表 `CREATE TABLE` + 索引/唯一约束 + 外键。若含其他表 DDL（diff 漂移）→ 停下上报，勿应用。

```bash
npx prisma db execute --file prisma/migrations/<ts>_supplier_bid_intent/migration.sql
npx prisma migrate resolve --applied <ts>_supplier_bid_intent
npx prisma generate
npx prisma migrate status   # 期望：clean，无 pending
```

- [ ] **Step 3: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(bid-intent): SupplierBidIntent/SupplierBidNoShow 两表与迁移

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 确认端点 confirmBidIntent（闸门+幂等）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（`assertProjectVisibleToSupplier` 附近，约 :1970 前后插入新方法）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（`GET bid-projects/:id` 路由组后，约 :440）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`

**Interfaces:**
- Produces:
  - `isIntentApplicable(projectId: string): Promise<boolean>`（Task 3/4/9 复用）
  - `confirmBidIntent(supplierId: string, projectId: string): Promise<{ confirmed: true; confirmedAt: Date }>`
  - `computeIntentConfirmable(project: { stage: string; deadline: Date | null }, intentExists: boolean): boolean`（private，Task 3 复用）
  - 错误码：`INTENT_NOT_APPLICABLE`(400) / `COMPANY_SCOPE_FORBIDDEN`(403，既有) / `SUPPLIER_BLACKLISTED`(403，既有语义) / `INTENT_STAGE_CLOSED`(409) / `INTENT_DEADLINE_PASSED`(409)

- [ ] **Step 1: 写失败测试**

在 `supplier-portal.service.spec.ts` 既有装配（`{ provide: PrismaService, useValue: prisma }`，测试内用 `prisma.xxx` mock 与 `service`）下追加 describe：

```ts
describe('confirmBidIntent（2026-11-12 意向确认）', () => {
  const baseProject = { id: 'p1', companyId: 'c1', stage: 'SUBMIT', deadline: new Date(Date.now() + 86400_000), isExtractionOnly: false };

  function mockVisible() {
    prisma.supplierCompanyLink.findMany.mockResolvedValue([{ companyId: 'c1' }]);
    prisma.bidSupplier.findFirst.mockResolvedValue(null);
    prisma.supplierBidSubmission.findFirst.mockResolvedValue(null);
  }

  it('公开项目+可见+窗口内：upsert 落库并返回确认时间', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(baseProject);
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    mockVisible();
    prisma.supplier.findUnique.mockResolvedValue({ status: 'APPROVED' });
    prisma.supplierBidIntent.upsert.mockResolvedValue({ confirmedAt: new Date('2026-11-12T02:00:00Z') });
    const r = await service.confirmBidIntent('s1', 'p1');
    expect(r.confirmed).toBe(true);
    expect(prisma.supplierBidIntent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_supplierId: { projectId: 'p1', supplierId: 's1' } },
      update: {},
    }));
  });

  it('幂等：重复确认 update:{} 不刷新首次时间', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(baseProject);
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    mockVisible();
    prisma.supplier.findUnique.mockResolvedValue({ status: 'APPROVED' });
    const first = new Date('2026-11-11T01:00:00Z');
    prisma.supplierBidIntent.upsert.mockResolvedValue({ confirmedAt: first });
    const r = await service.confirmBidIntent('s1', 'p1');
    expect(r.confirmedAt).toBe(first);
  });

  it('邀请制项目（INVITED）拒绝 INTENT_NOT_APPLICABLE', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(baseProject);
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'INVITED' });
    await expect(service.confirmBidIntent('s1', 'p1')).rejects.toMatchObject({
      response: { code: 'INTENT_NOT_APPLICABLE' },
    });
  });

  it('谈判项目（无 BidDocument）拒绝 INTENT_NOT_APPLICABLE', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(baseProject);
    prisma.bidDocument.findFirst.mockResolvedValue(null);
    await expect(service.confirmBidIntent('s1', 'p1')).rejects.toMatchObject({
      response: { code: 'INTENT_NOT_APPLICABLE' },
    });
  });

  it('黑名单供应商 403 SUPPLIER_BLACKLISTED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(baseProject);
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    mockVisible();
    prisma.supplier.findUnique.mockResolvedValue({ status: 'BLACKLIST' });
    await expect(service.confirmBidIntent('s1', 'p1')).rejects.toMatchObject({
      response: { code: 'SUPPLIER_BLACKLISTED' },
    });
  });

  it('阶段已过 SUBMIT 拒绝 INTENT_STAGE_CLOSED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ ...baseProject, stage: 'OPENING' });
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    mockVisible();
    prisma.supplier.findUnique.mockResolvedValue({ status: 'APPROVED' });
    await expect(service.confirmBidIntent('s1', 'p1')).rejects.toMatchObject({
      response: { code: 'INTENT_STAGE_CLOSED' },
    });
  });

  it('截标已过拒绝 INTENT_DEADLINE_PASSED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ ...baseProject, deadline: new Date(Date.now() - 1000) });
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    mockVisible();
    prisma.supplier.findUnique.mockResolvedValue({ status: 'APPROVED' });
    await expect(service.confirmBidIntent('s1', 'p1')).rejects.toMatchObject({
      response: { code: 'INTENT_DEADLINE_PASSED' },
    });
  });

  it('非可见供应商 403 COMPANY_SCOPE_FORBIDDEN', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(baseProject);
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    prisma.supplierCompanyLink.findMany.mockResolvedValue([]);
    prisma.bidSupplier.findFirst.mockResolvedValue(null);
    prisma.supplierBidSubmission.findFirst.mockResolvedValue(null);
    await expect(service.confirmBidIntent('s1', 'p1')).rejects.toMatchObject({
      response: { code: 'COMPANY_SCOPE_FORBIDDEN' },
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && pnpm test -- supplier-portal.service.spec.ts -t "confirmBidIntent"
```

期望：FAIL（`service.confirmBidIntent is not a function`）。若 spec 文件顶部未导入 `ConflictException`，补进 `@nestjs/common` 导入。

- [ ] **Step 3: 实现 service 方法**

`supplier-portal.service.ts`，放在 `assertProjectVisibleToSupplier`（:1971 注释块）之前：

```ts
  /** 项目是否适用「确认参与意向」（2026-11-12 履约闭环）：公开公告项目（BidDocument.accessScope=OPEN）。
   *  邀请制（INVITED/DESIGNATED）与无 BidDocument 的谈判项目不适用——其承诺=邀请回执。
   *  判定与 listBidProjects 富化 scopeMap 同源同口径（都查 BidDocument.accessScope），防两处漂移。 */
  async isIntentApplicable(projectId: string): Promise<boolean> {
    const doc = await this.prisma.bidDocument.findFirst({
      where: { bidProjectId: projectId },
      select: { accessScope: true },
    });
    return !!doc && doc.accessScope === 'OPEN';
  }

  /** 意向可确认窗口派生（列表/详情 intentConfirmable 与确认端点闸门同源） */
  private computeIntentConfirmable(project: { stage: string; deadline: Date | null }, intentExists: boolean): boolean {
    if (intentExists) return false;
    if (!['DOWNLOAD', 'SUBMIT'].includes(project.stage)) return false;
    if (project.deadline && project.deadline.getTime() < Date.now()) return false;
    return true;
  }

  /** 确认参与意向（2026-11-12）：公开项目、单向不可撤回、幂等（重复确认保留首次时间）。 */
  async confirmBidIntent(supplierId: string, projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, companyId: true, stage: true, deadline: true, isExtractionOnly: true },
    });
    if (!project || project.isExtractionOnly) {
      throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    }
    if (!(await this.isIntentApplicable(projectId))) {
      throw new BadRequestException({ error: '该项目为邀请制采购，确认参加请回复采购邀请回执', code: 'INTENT_NOT_APPLICABLE' });
    }
    await this.assertProjectVisibleToSupplier(project, supplierId);
    const self = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { status: true } });
    if (self?.status === 'BLACKLIST') {
      throw new ForbiddenException({ error: '贵单位已被列入黑名单，无法确认参与意向', code: 'SUPPLIER_BLACKLISTED' });
    }
    if (!['DOWNLOAD', 'SUBMIT'].includes(project.stage)) {
      throw new ConflictException({ error: '项目已进入开标或后续阶段，无法确认参与意向', code: 'INTENT_STAGE_CLOSED' });
    }
    if (project.deadline && project.deadline.getTime() < Date.now()) {
      throw new ConflictException({ error: '投标截止时间已过，无法确认参与意向', code: 'INTENT_DEADLINE_PASSED' });
    }
    const intent = await this.prisma.supplierBidIntent.upsert({
      where: { projectId_supplierId: { projectId, supplierId } },
      update: {}, // 幂等：重复确认不刷新 confirmedAt（单向承诺以首次为准）
      create: { projectId, supplierId },
      select: { confirmedAt: true },
    });
    return { confirmed: true, confirmedAt: intent.confirmedAt };
  }
```

- [ ] **Step 4: 加 controller 路由**

`supplier-portal.controller.ts`，`GET bid-projects/:id`（:438-441）之后：

```ts
  // 确认参与意向（2026-11-12 履约闭环）：仅公开项目；单向不可撤回；幂等
  @Post('bid-projects/:id/confirm-intent')
  async confirmBidIntent(@Request() req: any, @Param('id') id: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.confirmBidIntent(supplierId, id);
  }
```

- [ ] **Step 5: 跑测试通过 + lint**

```bash
pnpm test -- supplier-portal.service.spec.ts -t "confirmBidIntent"   # 全绿
pnpm --filter api lint
```

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.controller.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(bid-intent): 确认参与意向端点——六重闸门+幂等，仅公开项目

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 列表/详情读端富化

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（listBidProjects 富化块 :1665-1700；getBidProject :2040 前后）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `isIntentApplicable` / `computeIntentConfirmable`。
- Produces: 列表项 `intentApplicable: boolean`、`myIntent: boolean`、`intentConfirmable: boolean`；详情 `intentApplicable`、`myIntentConfirmedAt: string | null`、`intentConfirmable`。**不返家数**（口径裁定）。

- [ ] **Step 1: 写失败测试**

```ts
describe('listBidProjects 意向富化（2026-11-12）', () => {
  it('公开文档项目 intentApplicable=true 并带 myIntent/intentConfirmable；谈判项目（无文档）false', async () => {
    // 既有 listBidProjects 用例的 prisma mock 基础上（参看文件内既有 describe 的 findMany/count mock 形状），
    // 关键新增三笔 mock：
    prisma.bidDocument.findMany.mockResolvedValue([
      { bidProjectId: 'p-open', accessScope: 'OPEN' },
      { bidProjectId: 'p-invited', accessScope: 'INVITED' },
    ]);
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ projectId: 'p-open', confirmedAt: new Date() }]);
    const r = await service.listBidProjects(1, 20, {}, 's1');
    const open = r.items.find((i: any) => i.id === 'p-open');
    const invited = r.items.find((i: any) => i.id === 'p-invited');
    expect(open.intentApplicable).toBe(true);
    expect(open.myIntent).toBe(true);
    expect(open.intentConfirmable).toBe(false); // 已确认→不可再确认
    expect(invited.intentApplicable).toBe(false);
    expect(invited.myIntent).toBe(false);
  });
});
```

（若既有 spec 中 listBidProjects 无现成用例可借，mock 底座按 `bidProject.findMany` 返回 `{ id, stage:'SUBMIT', deadline: 未来, isExtractionOnly:false, companyId:'c1' }` 两行 + `bidProject.count` 返回 0 + `supplierCompanyLink.findMany` 返回归属，凑齐最小跑通路径。）

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test -- supplier-portal.service.spec.ts -t "意向富化"
```

- [ ] **Step 3: 实现**

listBidProjects 富化块：`Promise.all` 数组（现有 bidDocs、mySubmissions 两项，:1670-1681）加第三项：

```ts
          supplierId
            ? this.prisma.supplierBidIntent.findMany({
                where: { supplierId, projectId: { in: projectIds } },
                select: { projectId: true, confirmedAt: true },
              })
            : Promise.resolve([]),
```

解构改名：`const [bidDocs, mySubmissions, myIntents] = ...`。在 `submissionStatusMap` 之后加：

```ts
    const intentMap = new Map(myIntents.map((i) => [i.projectId, i.confirmedAt] as const));
```

`enrichedItems` map（:1686-1690）每项追加三字段（注意 `intentApplicable` 用**严格等于**判 scopeMap——谈判项目无键须为 false，不能沿用 `|| 'OPEN'` 的显示默认）：

```ts
      intentApplicable: scopeMap[i.id] === 'OPEN',
      myIntent: intentMap.has(i.id),
      intentConfirmable: this.computeIntentConfirmable(i, intentMap.has(i.id)),
```

getBidProject：在公司隔离读闸（`await this.assertProjectVisibleToSupplier(project, supplierId)`，:2018-2020）之后插入：

```ts
      // 意向状态富化（2026-11-12）：供应商端按钮三态单一事实源
      if (supplierId) {
        const [applicable, intent] = await Promise.all([
          this.isIntentApplicable(id),
          this.prisma.supplierBidIntent.findUnique({
            where: { projectId_supplierId: { projectId: id, supplierId } },
            select: { confirmedAt: true },
          }),
        ]);
        (project as any).intentApplicable = applicable;
        (project as any).myIntentConfirmedAt = intent?.confirmedAt ?? null;
        (project as any).intentConfirmable = this.computeIntentConfirmable(project, !!intent);
      }
```

- [ ] **Step 4: 跑测试通过 + 全量回归该文件**

```bash
pnpm test -- supplier-portal.service.spec.ts    # 既有用例不得回归
pnpm --filter api lint
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(bid-intent): 项目机会列表/详情下发意向三态（不返家数）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 投递前置闸（draft + submit）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（submitBid :2290 前后、saveBidDraft :2635-2636）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`

**Interfaces:**
- Consumes: `isIntentApplicable`（Task 2）。
- Produces: `assertBidIntentConfirmed(supplierId, projectId): Promise<void>`（private）；错误 400 `INTENT_REQUIRED`「请先确认参与意向，再投递标书」。

- [ ] **Step 1: 写失败测试**

```ts
describe('投递前置意向闸（2026-11-12）', () => {
  it('公开项目且无意向：保存草稿 400 INTENT_REQUIRED', async () => {
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    prisma.supplierBidIntent.findUnique.mockResolvedValue(null);
    await expect(service.saveBidDraft('s1', 'p1', {} as any)).rejects.toMatchObject({
      response: { code: 'INTENT_REQUIRED' },
    });
  });

  it('邀请制项目豁免（不抛 INTENT_REQUIRED——由后续既有闸门接管）', async () => {
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'INVITED' });
    // assertCanSaveBidDraft 既有链路的最小 mock（照既有 saveBidDraft 用例借形状）：
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 3600_000), companyId: 'c1', isExtractionOnly: false });
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', status: 'APPROVED', isTemporary: false, temporaryExpiresAt: null, userId: 'u1', name: '测试供应商' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
    prisma.supplierBidSubmission.upsert.mockResolvedValue({ id: 'sub1' });
    await expect(service.saveBidDraft('s1', 'p1', {} as any)).resolves.toBeTruthy();
    expect(prisma.supplierBidIntent.findUnique).not.toHaveBeenCalled();
  });

  it('公开项目且已有意向：放行（后续链路接管）', async () => {
    prisma.bidDocument.findFirst.mockResolvedValue({ accessScope: 'OPEN' });
    prisma.supplierBidIntent.findUnique.mockResolvedValue({ id: 'i1' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'SUBMIT', deadline: new Date(Date.now() + 3600_000), companyId: 'c1', isExtractionOnly: false });
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', status: 'APPROVED', isTemporary: false, temporaryExpiresAt: null, userId: 'u1', name: '测试供应商' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
    prisma.supplierBidSubmission.upsert.mockResolvedValue({ id: 'sub1' });
    await expect(service.saveBidDraft('s1', 'p1', {} as any)).resolves.toBeTruthy();
  });
});
```

（`saveBidDraft` 真实签名/内部断言以文件既有 `saveBidDraft` describe 用例为准调整 mock 面；本闸测试核心是 `bidDocument.findFirst` × `supplierBidIntent.findUnique` 两笔的分支行为。）

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test -- supplier-portal.service.spec.ts -t "投递前置意向闸"
```

- [ ] **Step 3: 实现**

在 `computeIntentConfirmable` 旁新增：

```ts
  /** 履约闸（2026-11-12 用户裁定：确认意向后方可投递）：公开项目投递/存草稿前置校验。
   *  邀请制（定向/谈判）豁免——回执即承诺。意向窗口与投递窗口重合，无死锁。 */
  private async assertBidIntentConfirmed(supplierId: string, projectId: string) {
    if (!(await this.isIntentApplicable(projectId))) return;
    const intent = await this.prisma.supplierBidIntent.findUnique({
      where: { projectId_supplierId: { projectId, supplierId } },
      select: { id: true },
    });
    if (!intent) {
      throw new BadRequestException({ error: '请先确认参与意向，再投递标书', code: 'INTENT_REQUIRED' });
    }
  }
```

两处调用：
- `submitBid`（:2261 起）：在临时过期闸（`TEMPORARY_EXPIRED` throw 之后、`normalizeBidFileAssets(data)` 之前）插 `await this.assertBidIntentConfirmed(supplierId, projectId);`
- `saveBidDraft`（:2635）：方法第一行（`assertCanSaveBidDraft` 之前）插同一句。

- [ ] **Step 4: 跑测试 + 既有 submitBid describe 全量回归**

```bash
pnpm test -- supplier-portal.service.spec.ts
pnpm --filter api lint
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(bid-intent): 公开项目投递/草稿前置意向闸（邀请制豁免）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 谈判下载留痕

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（downloadNegotiationFile :1884-1935）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`

**Interfaces:** 无新接口（行为补缺：谈判轨下载回写名册）。

- [ ] **Step 1: 写失败测试**

```ts
describe('谈判下载留痕（2026-11-12）', () => {
  it('下载成功后回写名册 downloadStatus/lastDownloadAt', async () => {
    const res = { headers: {} as any, setHeader: jest.fn(), end: jest.fn() };
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '蜀通' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs1' }); // assertNegotiationAccess 名册命中
    prisma.bidSupplier.updateMany.mockResolvedValue({ count: 1 });
    redis.get.mockResolvedValue(JSON.stringify({ refFileKeys: ['k1'], acquireStartTime: null, acquireEndTime: null, downloadMode: 'free' }));
    prisma.attachment.findUnique.mockResolvedValue({ fileName: 'f.pdf', objectKey: 'k1', mimeType: 'application/pdf' });
    // readFile 走真实 fs——objectKey 'k1' 不存在会抛：改用 FileAsset 轨更省事：
    prisma.attachment.findUnique.mockResolvedValue(null);
    prisma.fileAsset.findUnique.mockResolvedValue({ key: 'k1', sealedPath: null, sealedKey: null, clientEncrypted: false, originalName: 'f.pdf', mimeType: 'application/pdf' });
    (minioClient.getObject as jest.Mock).mockResolvedValue({ /* 供 streamToBuffer 的流桩 */ });
    await service.downloadNegotiationFile('p1', 'k1' as any, 's1', res as any);
    expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'p1', supplierName: '蜀通' },
      data: expect.objectContaining({ downloadStatus: '已下载' }),
    }));
  });
});
```

（`streamToBuffer` 已在文件顶部 jest.mock——按既有 downloadNegotiationFile 用例的桩形状对齐；核心断言只有 `bidSupplier.updateMany` 的调用形状。）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

`downloadNegotiationFile` 内 `const cfg = await this.assertNegotiationAccess(projectId, supplierId);` 之后插：

```ts
    // 下载留痕（2026-11-12）：谈判轨此前零记录——回写名册下载状态/时间，
    // 公告「投标情况」/开标确认面板的下载列对谈判项目不再失真
    // （名册行已被 assertNegotiationAccess 校验存在；updateMany 0 行也不阻断下载）
    const dlSupplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
    if (dlSupplier) {
      await this.prisma.bidSupplier.updateMany({
        where: { projectId, supplierName: dlSupplier.name },
        data: { downloadStatus: '已下载', lastDownloadAt: new Date() },
      }).catch(() => undefined);
    }
```

- [ ] **Step 4: 跑测试 + lint**

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(bid-intent): 谈判采购文件下载回写名册下载状态与时间

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 履约服务 BidIntentOversightService（事故判定+自动拉黑）

**Files:**
- Create: `apps/api/src/supplier/bid-intent-oversight.service.ts`
- Modify: `apps/api/src/supplier/supplier.module.ts`（providers/exports 注册）
- Test: `apps/api/src/supplier/bid-intent-oversight.service.spec.ts`（新建）

**Interfaces:**
- Produces:
  - `sweepProject(projectId: string): Promise<{ created: number }>`（Task 7 钩子调用）
  - `sweepAll(): Promise<{ projects: number; created: number }>`（Cron 入口）
  - `getParticipation(supplierId: string): Promise<ParticipationView>`（Task 10 端点消费，形状见 Step 3 代码返回体）
  - `resolveDeployRef(): Promise<Date | null>`（legacy 判定基准=本功能迁移 finished_at；内部缓存）
- Consumes: `PrismaService`、`NotificationService`（既有 `sendToUser`）；复用既有通知类型 `SUPPLIER_BLACKLISTED` 与拉黑不变式（状态占用更新+账号停用）。

- [ ] **Step 1: 写失败测试（核心行为）**

`bid-intent-oversight.service.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { BidIntentOversightService } from './bid-intent-oversight.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

describe('BidIntentOversightService（2026-11-12 履约闭环）', () => {
  let service: BidIntentOversightService;
  let prisma: any;
  let notify: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      bidProject: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      supplierBidIntent: { findMany: jest.fn().mockResolvedValue([]) },
      invitationRsvp: { findMany: jest.fn().mockResolvedValue([]) },
      supplierBidSubmission: { findMany: jest.fn().mockResolvedValue([]) },
      supplierBidNoShow: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
      supplier: { findUnique: jest.fn(), updateMany: jest.fn() },
      user: { update: jest.fn() },
      supplierPenalty: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    };
    notify = { sendToUser: jest.fn().mockResolvedValue({}) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BidIntentOversightService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notify },
      ],
    }).compile();
    service = moduleRef.get(BidIntentOversightService);
    jest.spyOn(service, 'resolveDeployRef').mockResolvedValue(new Date('2026-11-12T00:00:00Z'));
  });

  const proj = (over: any = {}) => ({ id: 'p1', projectManagementItemId: null, stage: 'OPENING', ...over });

  it('INTENT 轨：OPENING 后意向未投递→写事故 legacy 按承诺时间判定', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.invitationRsvp.findMany.mockResolvedValue([]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n1' });
    prisma.supplierBidNoShow.count.mockResolvedValue(1); // 不足 3，不触发拉黑
    const r = await service.sweepProject('p1');
    expect(r.created).toBe(1);
    expect(prisma.supplierBidNoShow.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: 'p1', supplierId: 's1', track: 'INTENT', legacy: false }),
    }));
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('已投递不写事故；withdrawn 视同未投递写事故', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ supplierId: 's1', status: 'submitted' }]);
    expect((await service.sweepProject('p1')).created).toBe(0);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ supplierId: 's1', status: 'withdrawn' }]);
    prisma.supplierBidNoShow.count.mockResolvedValue(0);
    expect((await service.sweepProject('p1')).created).toBe(1);
  });

  it('RSVP 轨：多批次取 respondedAt 最新一条，ACCEPTED 计、代变更 DECLINED 不计；双 id 命中', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj({ projectManagementItemId: 'pmi1' }));
    prisma.supplierBidIntent.findMany.mockResolvedValue([]);
    prisma.invitationRsvp.findMany.mockResolvedValue([
      { supplierId: 's1', projectId: 'p1', status: 'ACCEPTED', respondedAt: new Date('2026-11-01T00:00:00Z') },
      { supplierId: 's1', projectId: 'pmi1', status: 'DECLINED', respondedAt: new Date('2026-11-03T00:00:00Z') }, // 最新=婉拒→不计
    ]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    expect((await service.sweepProject('p1')).created).toBe(0);
    prisma.invitationRsvp.findMany.mockResolvedValue([
      { supplierId: 's1', projectId: 'pmi1', status: 'ACCEPTED', respondedAt: new Date('2026-11-03T00:00:00Z') },
    ]);
    prisma.supplierBidNoShow.count.mockResolvedValue(0);
    expect((await service.sweepProject('p1')).created).toBe(1);
    expect(prisma.invitationRsvp.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: ['p1', 'pmi1'] } }),
    }));
  });

  it('ABORTED 不计数；已存在事故行幂等跳过', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj({ stage: 'ABORTED' }));
    expect((await service.sweepProject('p1')).created).toBe(0);
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date() }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue({ id: 'exist' });
    expect((await service.sweepProject('p1')).created).toBe(0);
    expect(prisma.supplierBidNoShow.create).not.toHaveBeenCalled();
  });

  it('非 legacy 满 3 次触发自动拉黑：状态占用+账号停用+处罚留痕+通知（复用 SUPPLIER_BLACKLISTED）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue(null);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n3' });
    prisma.supplierBidNoShow.count.mockResolvedValue(3);
    prisma.supplierBidNoShow.findMany.mockResolvedValue([
      { supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'A 项目', projectCode: 'BID-1' } },
      { supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'B 项目', projectCode: 'BID-2' } },
      { supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'C 项目', projectCode: 'BID-3' } },
    ]);
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '蜀通', status: 'APPROVED', userId: 'u1' });
    prisma.supplier.updateMany.mockResolvedValue({ count: 1 });
    await service.sweepProject('p1');
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'BLACKLIST' }),
    }));
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    expect(prisma.supplierPenalty.create).toHaveBeenCalled();
    expect(notify.sendToUser).toHaveBeenCalledWith('u1', ['in_app'], expect.objectContaining({ type: 'SUPPLIER_BLACKLISTED' }));
  });

  it('legacy 事故不计触发（2 legacy+1 新=1 非 legacy，不拉黑）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-01T00:00:00Z') }]); // 早于 deployRef→legacy
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue(null);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n1' });
    prisma.supplierBidNoShow.count.mockResolvedValue(3); // 总 3（含 legacy）
    await service.sweepProject('p1');
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('已在黑名单/待审核态跳过拉黑不抛错（cron 不得死）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue(null);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n3' });
    prisma.supplierBidNoShow.count.mockResolvedValue(3);
    prisma.supplierBidNoShow.findMany.mockResolvedValue([{ supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'A', projectCode: 'BID-1' } }]);
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '蜀通', status: 'BLACKLIST', userId: 'u1' });
    await expect(service.sweepProject('p1')).resolves.toBeTruthy();
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test -- bid-intent-oversight
```

期望：模块不存在编译失败。

- [ ] **Step 3: 实现服务**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/** 确认参与未投递事故候选（内存态，未落库） */
interface NoShowCandidate { supplierId: string; track: 'INTENT' | 'RSVP'; commitmentAt: Date }

const POST_SUBMIT_STAGES = ['OPENING', 'EVALUATING', 'ARCHIVED'] as const;

/**
 * 投标意向履约监督（2026-11-12 设计 §8）：
 * - 事故判定：项目开标后（stage∈POST_SUBMIT_STAGES）承诺方（公开意向|回执确认参加）未投递；
 * - legacy：承诺时间早于本功能迁移完成时刻（_prisma_migrations.finished_at）——展示不计触发；
 * - 满 3 次非 legacy 事故自动拉黑（复用人工拉黑不变式：状态占用更新+disableReason+账号停用
 *   +SUPPLIER_BLACKLISTED 通知），另写 SupplierPenalty 自动留痕；
 * - 触发面：每日 Cron 兜底（真正保证）+ 阶段推进即时钩子（Task 7 接线）。
 */
@Injectable()
export class BidIntentOversightService {
  private readonly logger = new Logger(BidIntentOversightService.name);
  private deployRef: Date | null | undefined; // undefined=未解析

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
  ) {}

  /** 功能部署时刻=本功能迁移完成时刻；解析失败返回 null（全部按 legacy 处理——宁可不罚不可误罚） */
  async resolveDeployRef(): Promise<Date | null> {
    if (this.deployRef !== undefined) return this.deployRef;
    try {
      const rows = await this.prisma.$queryRaw<{ finished_at: Date | null }[]>`
        SELECT finished_at FROM _prisma_migrations
        WHERE migration_name LIKE '%supplier_bid_intent%' AND finished_at IS NOT NULL
        ORDER BY finished_at ASC LIMIT 1`;
      this.deployRef = rows[0]?.finished_at ? new Date(rows[0].finished_at) : null;
    } catch {
      this.deployRef = null;
    }
    return this.deployRef;
  }

  /** 单项目扫描：写缺失的事故行；新建非 legacy 行时评估自动拉黑。幂等（唯一键兜底）。 */
  async sweepProject(projectId: string): Promise<{ created: number }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, stage: true, projectManagementItemId: true },
    });
    if (!project || !(POST_SUBMIT_STAGES as readonly string[]).includes(project.stage)) return { created: 0 };

    const candidates = await this.determineCandidates(project);
    if (candidates.length === 0) return { created: 0 };

    const deployRef = await this.resolveDeployRef();
    let created = 0;
    for (const c of candidates) {
      const existing = await this.prisma.supplierBidNoShow.findUnique({
        where: { projectId_supplierId: { projectId, supplierId: c.supplierId } },
        select: { id: true },
      });
      if (existing) continue; // 每项目每家一条，幂等
      const legacy = deployRef ? c.commitmentAt.getTime() < deployRef.getTime() : true;
      await this.prisma.supplierBidNoShow.create({
        data: { projectId, supplierId: c.supplierId, track: c.track, legacy },
      });
      created++;
      if (!legacy) {
        await this.evaluateAutoBlacklist(c.supplierId).catch((e) =>
          this.logger.error(`自动拉黑评估失败 supplier=${c.supplierId}: ${e instanceof Error ? e.message : e}`),
        );
      }
    }
    return { created };
  }

  /** 每日兜底扫描（04:20 低峰，避开既有 03:00/03:30/04:00/04:45 作业） */
  @Cron('20 4 * * *')
  async sweepAll(): Promise<{ projects: number; created: number }> {
    const projects = await this.prisma.bidProject.findMany({
      where: { stage: { in: [...POST_SUBMIT_STAGES] } },
      select: { id: true },
      take: 500,
    });
    let created = 0;
    for (const p of projects) {
      try {
        const r = await this.sweepProject(p.id);
        created += r.created;
      } catch (e) {
        this.logger.warn(`履约扫描失败 project=${p.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (created > 0) this.logger.log(`履约扫描：${projects.length} 项目新增 ${created} 条事故`);
    return { projects: projects.length, created };
  }

  /** 事故候选：承诺（INTENT 优先，其次 RSVP 最新回应 ACCEPTED）且未 submitted */
  private async determineCandidates(project: { id: string; projectManagementItemId: string | null }): Promise<NoShowCandidate[]> {
    const rsvpIds = [project.id, project.projectManagementItemId].filter(Boolean) as string[]; // RSVP 双 id 空间（2026-10-16 规范化前为 PMI id）
    const [intents, rsvps, submissions] = await Promise.all([
      this.prisma.supplierBidIntent.findMany({ where: { projectId: project.id }, select: { supplierId: true, confirmedAt: true } }),
      this.prisma.invitationRsvp.findMany({
        where: { projectId: { in: rsvpIds } },
        select: { supplierId: true, status: true, respondedAt: true },
      }),
      this.prisma.supplierBidSubmission.findMany({ where: { projectId: project.id }, select: { supplierId: true, status: true } }),
    ]);

    const submitted = new Set(submissions.filter((s) => s.status === 'submitted').map((s) => s.supplierId));
    const intentBySupplier = new Map(intents.map((i) => [i.supplierId, i]));
    // 同项目多批次回执：每家取 respondedAt 最新一条的当前生效状态（尊重代变更）
    const latestRsvp = new Map<string, { status: string; respondedAt: Date | null }>();
    for (const r of rsvps) {
      if (!r.respondedAt) continue;
      const prev = latestRsvp.get(r.supplierId);
      if (!prev || r.respondedAt.getTime() > prev.respondedAt!.getTime()) {
        latestRsvp.set(r.supplierId, { status: r.status, respondedAt: r.respondedAt });
      }
    }

    const candidates: NoShowCandidate[] = [];
    const seen = new Set<string>();
    for (const [supplierId, intent] of intentBySupplier) {
      seen.add(supplierId);
      if (!submitted.has(supplierId)) candidates.push({ supplierId, track: 'INTENT', commitmentAt: intent.confirmedAt });
    }
    for (const [supplierId, rsvp] of latestRsvp) {
      if (seen.has(supplierId) || submitted.has(supplierId)) continue;
      if (rsvp.status === 'ACCEPTED') candidates.push({ supplierId, track: 'RSVP', commitmentAt: rsvp.respondedAt! });
    }
    return candidates;
  }

  /** 非 legacy 事故 ≥3 → 自动拉黑（幂等：已在黑名单/待审核态/并发占用失败均静默跳过） */
  private async evaluateAutoBlacklist(supplierId: string) {
    const activeCount = await this.prisma.supplierBidNoShow.count({ where: { supplierId, legacy: false } });
    if (activeCount < 3) return;

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true },
    });
    if (!supplier || supplier.status === 'BLACKLIST') return;
    if (supplier.status === 'PENDING' || supplier.status === 'RETURNED') {
      this.logger.warn(`供应商 ${supplier.name} 事故满 3 次但审核未完结（${supplier.status}），跳过自动拉黑`);
      return;
    }

    const incidents = await this.prisma.supplierBidNoShow.findMany({
      where: { supplierId, legacy: false },
      include: { project: { select: { name: true, projectCode: true } } },
      orderBy: { detectedAt: 'desc' },
      take: 3,
    });
    const projectList = incidents.map((i) => `${i.project.name}（${i.project.projectCode}）`).join('、');
    const reason = `累计 ${activeCount} 次确认参与采购项目但未投递投标/响应文件（${projectList}），依据平台供应商履约规则自动列入黑名单`;

    // 与人工 blacklistSupplier（supplier.service.ts:3401）同一不变式：状态占用更新防并发 + 账号联动停用
    //（2026-10-15 平台裁定：黑名单必须立刻丧失登录能力）+ SUPPLIER_BLACKLISTED 通知（解黑后可见）
    const claimed = await this.prisma.supplier.updateMany({
      where: { id: supplierId, status: supplier.status },
      data: { status: 'BLACKLIST', disableReason: reason },
    });
    if (claimed.count === 0) return; // 并发状态变化，放弃本次
    if (supplier.userId) {
      await this.prisma.user.update({ where: { id: supplier.userId }, data: { isActive: false } }).catch(() => undefined);
    }

    // 自动留痕（cron 路径无 OperationLog，处罚表为留痕权威）
    for (let attempt = 0; attempt < 3; attempt++) {
      const docNo = `AUTO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
      const clash = await this.prisma.supplierPenalty.findFirst({ where: { penaltyDocNo: docNo }, select: { id: true } });
      if (clash) continue;
      await this.prisma.supplierPenalty.create({
        data: {
          supplierId,
          penaltyDocNo: docNo,
          authority: '采购中心',
          decisionDate: new Date(),
          penaltyContent: `${reason}（系统自动）`,
        },
      });
      break;
    }

    if (supplier.userId) {
      void this.notification
        .sendToUser(supplier.userId, ['in_app'], {
          type: 'SUPPLIER_BLACKLISTED',
          title: '单位已被自动列入黑名单',
          content: `${reason}。如有异议请联系采购中心。`,
          link: '/notifications',
        })
        .catch(() => undefined);
    }
    this.logger.warn(`自动拉黑生效：${supplier.name}（${reason}）`);
  }

  /** 供应商参与情况视图（:3005 供应商管理「参与情况」卡片数据源） */
  async getParticipation(supplierId: string) {
    const [intentRows, rsvpRows, submissionRows, incidentRows, supplier] = await Promise.all([
      this.prisma.supplierBidIntent.findMany({
        where: { supplierId },
        include: { project: { select: { id: true, name: true, projectCode: true, stage: true } } },
        orderBy: { confirmedAt: 'desc' },
      }),
      this.prisma.invitationRsvp.findMany({
        where: { supplierId, projectId: { not: null }, status: 'ACCEPTED' },
        select: { projectId: true, respondedAt: true },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { supplierId, status: 'submitted' },
        select: { projectId: true, submittedAt: true },
      }),
      this.prisma.supplierBidNoShow.findMany({
        where: { supplierId },
        include: { project: { select: { name: true, projectCode: true, stage: true } } },
        orderBy: { detectedAt: 'desc' },
      }),
      this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { status: true, disableReason: true } }),
    ]);
    const submittedProjectIds = new Set(submissionRows.map((s) => s.projectId));
    const activeCount = incidentRows.filter((i) => !i.legacy).length;
    const penalties = supplier?.status === 'BLACKLIST'
      ? await this.prisma.supplierPenalty.findMany({
          where: { supplierId },
          orderBy: { decisionDate: 'desc' },
          select: { penaltyDocNo: true, authority: true, decisionDate: true, penaltyContent: true },
        })
      : [];
    return {
      kpi: {
        intentTotal: intentRows.length,
        rsvpAcceptedTotal: rsvpRows.length,
        submittedTotal: submissionRows.length,
        noShowTotal: incidentRows.length,
        noShowActiveCount: activeCount,
        blacklistThreshold: 3,
      },
      incidents: incidentRows.map((i) => ({
        projectName: i.project.name,
        projectCode: i.project.projectCode,
        stage: i.project.stage,
        track: i.track,
        detectedAt: i.detectedAt,
        legacy: i.legacy,
      })),
      intents: intentRows.map((i) => ({
        projectName: i.project.name,
        projectCode: i.project.projectCode,
        stage: i.project.stage,
        confirmedAt: i.confirmedAt,
        submitted: submittedProjectIds.has(i.project.id),
      })),
      blacklist: supplier?.status === 'BLACKLIST' ? { reason: supplier.disableReason, penalties } : null,
    };
  }
}
```

`supplier.module.ts`：providers 加 `BidIntentOversightService`、exports 加同名（Task 7 供 BidModule 消费）：

```ts
  providers: [SupplierService, SupplierLinkService, RsvpService, OwnerGuard, BidIntentOversightService],
  exports: [SupplierService, SupplierLinkService, RsvpService, BidIntentOversightService],
```

顶部补 `import { BidIntentOversightService } from './bid-intent-oversight.service';`。

- [ ] **Step 4: 跑测试通过 + lint**

```bash
pnpm test -- bid-intent-oversight
pnpm --filter api lint
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/supplier/bid-intent-oversight.service.ts apps/api/src/supplier/bid-intent-oversight.service.spec.ts apps/api/src/supplier/supplier.module.ts
git commit -m "feat(bid-intent): 履约监督服务——两轨事故判定/legacy 豁免/满3自动拉黑/参与情况聚合

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 阶段推进即时钩子

**Files:**
- Modify: `apps/api/src/bid/bid.module.ts`（imports 加 SupplierModule）
- Modify: `apps/api/src/bid/bid.service.ts`（构造器注入 + 三处事务后钩子）
- Test: `apps/api/src/bid/bid.service.spec.ts`（新增用例）

**Interfaces:**
- Consumes: Task 6 `BidIntentOversightService.sweepProject(projectId)`。
- Produces: 阶段推进至 OPENING/EVALUATING/ARCHIVED 后 fire-and-forget 扫描。

- [ ] **Step 1: 接线**

`bid.module.ts` imports 数组加 `SupplierModule`（`import { SupplierModule } from '../supplier/supplier.module';`）。SupplierModule 不引 BidModule，无环。**若启动报循环依赖**：改用 `ModuleRef` 或退化为仅 Cron（在提交信息与任务报告注明）。

`bid.service.ts` 构造器追加注入（照既有注入风格）：

```ts
    private readonly intentOversight: BidIntentOversightService,
```

三处钩子（均在 `$transaction` **提交返回之后**插，勿插事务体内；行号为锚点，实施时 grep `data: { stage:` 复核）：

1. `startOpeningInternal`（:1743 方法，事务 `const txResult = await this.prisma.$transaction(...)` :1873 之后、方法 return 前）：
2. `startEvaluation`（:2215，同款事务后）；
3. `archiveAll`（:4131，同款）。

每处插一行：

```ts
    void this.intentOversight.sweepProject(id).catch(() => undefined); // 履约扫描（fire-and-forget，失败不影响流转；漏挂由每日 04:20 Cron 兜底）
```

（`archiveAll` 内变量名若非 `id` 以实际为准；`startOpeningInternal` 的 `isTransitioning=false` 分支同样无害——sweep 幂等。）

- [ ] **Step 2: 测试**

`bid.service.spec.ts` 既有装配上追加（构造器新增注入需在该 spec 的 providers/mock 里补 `{ provide: BidIntentOversightService, useValue: { sweepProject: jest.fn().mockResolvedValue({ created: 0 }), sweepAll: jest.fn() } }`——照既有 spec 对新依赖的处理先例）：

```ts
it('按时开标推进 OPENING 后触发履约扫描钩子（2026-11-12）', async () => {
  // 借既有 startOpening/confirmOpening 用例的最小 mock 触发一次成功推进，
  // 断言 intentOversight.sweepProject 被以项目 id 调用（await flush microtasks）：
  await new Promise((r) => setImmediate(r));
  expect(intentOversight.sweepProject).toHaveBeenCalledWith('p1');
});
```

（以该 spec 内既有开标推进用例为准挂接；核心断言只有钩子调用。若该用例 mock 面过大，允许以「构造成功 + 手动调 startOpeningInternal 且事务 mock 返回」最小路径实现。）

- [ ] **Step 3: 跑测试 + 全量 bid.service.spec 回归 + lint**

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/bid/bid.module.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid-intent): 开标/评标/归档推进后挂履约扫描即时钩子

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: getParticipants 族合并意向集

**Files:**
- Modify: `apps/api/src/announcement/announcement.service.ts`（getParticipants :1683-1835；getProjectParticipants 无需改——复用 getParticipants）
- Test: `apps/api/src/announcement/`（若无合适既有 spec，新建 `announcement-participants.spec.ts`）

**Interfaces:**
- Produces: `getParticipants` 返回的 `suppliers[]` 每行新增 `intentConfirmedAt: Date | null`；`stats` 新增 `intentConfirmed: number`（Task 13 前端消费）。

- [ ] **Step 1: 写失败测试**

新建/追加 spec（mock prisma 四笔：announcement.findUnique、bidDocument.findUnique、bidSupplier/supplierBidSubmission/supplierBidIntent.findMany）。核心用例：

```ts
it('意向-only 供应商补行且 stats.intentConfirmed 正确（2026-11-12）', async () => {
  // announcement 带 relatedProjectCode→bidProject 命中；downloaders=[]、bidSuppliers=[]、
  // supplierBidSubmission=[]、supplierBidIntent=[{supplierId:'s9', confirmedAt, supplier:{name:'意向供应商', tags:[]}}]
  const r = await service.getParticipants('ann1');
  expect(r.suppliers).toHaveLength(1);
  expect(r.suppliers[0]).toMatchObject({ supplierName: '意向供应商', intentConfirmedAt: expect.any(Date), submitted: false });
  expect(r.stats.intentConfirmed).toBe(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

getParticipants 内三处小改：

1. `SupplierRow` 类型加字段：

```ts
      intentConfirmedAt: Date | null;
```

2. `if (projectId)` 的 Promise.all（:1781-1793）加第三查询：

```ts
        this.prisma.supplierBidIntent.findMany({
          where: { projectId },
          include: { supplier: { select: { name: true, tags: true } } },
        }),
```

（解构相应加 `intents`；若 projectId 为 null 则置 `[]`。）

3. 两个既有合并循环写入行时补 `intentConfirmedAt: null`；循环后追加第三个循环：

```ts
    for (const it of intents) {
      const row = rowMap.get(it.supplierId);
      if (row) {
        row.intentConfirmedAt = it.confirmedAt;
        continue;
      }
      const sub = subMap.get(it.supplierId);
      rowMap.set(it.supplierId, {
        supplierName: it.supplier.name,
        tags: it.supplier.tags ?? [],
        lastDownloadAt: null,
        downloadCount: 0,
        submitted: sub?.status === 'submitted' || false,
        withdrawn: sub?.status === 'withdrawn' || false,
        submittedAt: sub?.submittedAt ?? null,
        intentConfirmedAt: it.confirmedAt,
      });
    }
```

4. stats 行补：

```ts
      stats: { total: rows.length, submitted: rows.filter(r => r.submitted).length, intentConfirmed: rows.filter(r => r.intentConfirmedAt).length },
```

- [ ] **Step 4: 跑测试 + lint**

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/announcement/announcement.service.ts apps/api/src/announcement/*.spec.ts
git commit -m "feat(bid-intent): 公告投标情况/供应商参与合并意向集并计 stats.intentConfirmed

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: workspace 合并意向（开标确认面板数据源）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（getWorkspace :662-745）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: workspace `suppliers[]` 每行 `intentConfirmedAt: Date | null`；意向-only 供应商补行（业务标签由前端渲染「自主确认」）；`stats.intentConfirmed: number`（Task 14 前端消费）。

- [ ] **Step 1: 写失败测试**

在既有 `bid.service.spec.ts` 的 getWorkspace describe 内（grep `getWorkspace` 定位既有用例与 `ws` 结果变量）追加：

```ts
  it('workspace 并入意向维度：意向-only 补行 + stats.intentConfirmed（2026-11-12）', async () => {
    // 在既有 getWorkspace 用例的 prisma mock 基础上仅补一笔（名册 supplierId 不含 's1'）：
    prisma.supplierBidIntent.findMany.mockResolvedValue([
      {
        id: 'in1',
        supplierId: 's1',
        confirmedAt: new Date('2026-11-12T01:00:00Z'),
        supplier: { id: 's1', name: '意向供应商', tags: [], industry: null },
      },
    ]);
    const ws = await service.getWorkspace('p1');
    const intentOnly = ws.suppliers.find((s: any) => s.supplierId === 's1');
    expect(intentOnly).toBeTruthy();
    expect(intentOnly.intentConfirmedAt).toEqual(new Date('2026-11-12T01:00:00Z'));
    expect(intentOnly.downloadStatus).toBe('待下载');
    expect(intentOnly.submitted).toBe(false);
    expect(String(intentOnly.id)).toMatch(/^intent-/);
    expect(ws.stats.intentConfirmed).toBe(1);
  });
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

getWorkspace 的 Promise.all（:671-691）加第五项：

```ts
      this.prisma.supplierBidIntent.findMany({
        where: { projectId: id },
        include: { supplier: { select: { id: true, name: true, tags: true, industry: true } } },
      }),
```

解构加 `bidIntents`，其后：

```ts
    const intentMap = new Map(bidIntents.map((i) => [i.supplierId, i.confirmedAt] as const));
```

`supplierRows.map` 返回对象加：

```ts
        intentConfirmedAt: (s.supplierId ? intentMap.get(s.supplierId) : undefined) ?? null,
```

`sortSupplierRowsBySubmission(supplierRows)` **之前**追加意向-only 补行：

```ts
    // 意向-only 供应商（公开项目确认参与但未受邀/未下载）补行——开标确认面板「自主确认」
    const knownSupplierIds = new Set(supplierRows.map((r) => r.supplierId).filter(Boolean) as string[]);
    for (const it of bidIntents) {
      if (knownSupplierIds.has(it.supplierId)) continue;
      supplierRows.push({
        id: `intent-${it.id}`,
        supplierId: it.supplierId,
        supplierName: it.supplier.name,
        industry: it.supplier.industry ?? null,
        tags: it.supplier.tags ?? [],
        downloadStatus: '待下载',
        submitStatus: '待提交',
        decryptStatus: 'PENDING',
        confirmStatus: 'PENDING',
        submission: null,
        submitted: false,
        withdrawn: false,
        intentConfirmedAt: it.confirmedAt,
      });
    }
```

stats 对象补：

```ts
        intentConfirmed: supplierRows.filter((s) => s.intentConfirmedAt).length,
```

- [ ] **Step 4: 跑测试 + 全量 bid.service.spec 回归 + lint**

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid-intent): 开标确认 workspace 并入意向维度与意向-only 补行

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: 参与情况端点

**Files:**
- Modify: `apps/api/src/supplier/supplier.controller.ts`（`@Get(':id/approval-history')` :147 路由附近）
- Test: `apps/api/src/supplier/bid-intent-oversight.service.spec.ts`（getParticipation 已在 Task 6 覆盖，此处补路由装饰校验即可）

**Interfaces:**
- Consumes: Task 6 `getParticipation(supplierId)`。
- Produces: `GET /api/supplier/:id/participation` → ParticipationView（Task 15 前端消费）。

- [ ] **Step 1: 加路由**

```ts
  @Get(':id/participation')
  @Roles('admin', 'leader', 'staff') // 参与情况（履约）：供应商库读口径，同 :id/approval-history
  @ApiOperation({ summary: '供应商参与情况（履约闭环）：意向/回执/投递/未投递事故聚合（2026-11-12）' })
  async getParticipation(@Param('id') id: string) {
    return this.intentOversight.getParticipation(id);
  }
```

构造器注入 `private intentOversight: BidIntentOversightService` + import。注意放在 `@Get(':id/...')` 形态路由组内（Nest 路由序无冲突）。

- [ ] **Step 2: 补一条 service 层 getParticipation 聚合断言（Task 6 spec 内）**

```ts
it('getParticipation KPI 聚合与 blacklist 视图', async () => {
  prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date(), project: { id: 'p1', name: 'A', projectCode: 'BID-1', stage: 'ARCHIVED' } }]);
  prisma.invitationRsvp.findMany.mockResolvedValue([{ projectId: 'p2', respondedAt: new Date() }]);
  prisma.supplierBidSubmission.findMany.mockResolvedValue([{ projectId: 'p1', submittedAt: new Date() }]);
  prisma.supplierBidNoShow.findMany.mockResolvedValue([{ legacy: true, detectedAt: new Date(), track: 'RSVP', project: { name: 'B', projectCode: 'BID-2', stage: 'ARCHIVED' } }]);
  prisma.supplier.findUnique.mockResolvedValue({ status: 'BLACKLIST', disableReason: '测试' });
  prisma.supplierPenalty.findMany.mockResolvedValue([{ penaltyDocNo: 'AUTO-1', authority: '采购中心', decisionDate: new Date(), penaltyContent: 'x' }]);
  const r = await service.getParticipation('s1');
  expect(r.kpi).toMatchObject({ intentTotal: 1, rsvpAcceptedTotal: 1, submittedTotal: 1, noShowTotal: 1, noShowActiveCount: 0 });
  expect(r.intents[0].submitted).toBe(true);
  expect(r.blacklist.reason).toBe('测试');
});
```

- [ ] **Step 3: 跑测试 + lint + 提交**

```bash
git add apps/api/src/supplier/supplier.controller.ts apps/api/src/supplier/bid-intent-oversight.service.spec.ts
git commit -m "feat(bid-intent): 供应商参与情况端点 GET /supplier/:id/participation

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: 种子数据

**Files:**
- Create: `apps/api/prisma/seed-data/SupplierBidIntent.json`
- Modify: `apps/api/prisma/seed.ts`（TRUNCATE 表清单 :70-78；装载映射 :150-160；英雄项目意向段）

**Interfaces:** 无（数据件）。

- [ ] **Step 1: TRUNCATE 清单纳入两表**

`seed.ts` 表清单（`'Supplier', 'SupplierBidSubmission',` 一行附近）加：

```ts
  'SupplierBidIntent', 'SupplierBidNoShow',
```

- [ ] **Step 2: 意向种子**

先 `pnpm db:seed` 前置依赖已就绪（本任务最后统一跑）。新增 `seed-data/SupplierBidIntent.json`（英雄项目三条——供应商 id 以 seed 内 Supplier 快照实际 id 为准，装载代码内按公司名匹配写入更稳，见下）：

装载实现（seed.ts 内、SupplierBidSubmission 装载段之后）：

```ts
// ── 参与意向（2026-11-12 履约闭环）：英雄项目三家已投递供应商补意向，三视图演示有数据 ──
{
  const heroProject = await prisma.bidProject.findFirst({
    where: { name: { contains: '英雄' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (heroProject) {
    const intentSuppliers = await prisma.supplier.findMany({
      where: { name: { in: ['四川水发建设有限公司', '中科院成都信息技术股份有限公司', '四川省通信产业服务有限公司'] } },
      select: { id: true },
    });
    for (const s of intentSuppliers) {
      await prisma.supplierBidIntent.upsert({
        where: { projectId_supplierId: { projectId: heroProject.id, supplierId: s.id } },
        update: {},
        create: { projectId: heroProject.id, supplierId: s.id },
      });
    }
  }
  // 演示「参与情况」全史：给重庆蜀通种 2 条 legacy 事故（不触发拉黑——口径 #8）
  const demoSupplier = await prisma.supplier.findFirst({ where: { name: '重庆蜀通岩土工程有限公司' }, select: { id: true } });
  if (demoSupplier) {
    const archivedProjects = await prisma.bidProject.findMany({
      where: { stage: 'ARCHIVED' },
      select: { id: true },
      take: 2,
    });
    for (const p of archivedProjects) {
      await prisma.supplierBidNoShow.upsert({
        where: { projectId_supplierId: { projectId: p.id, supplierId: demoSupplier.id } },
        update: {},
        create: { projectId: p.id, supplierId: demoSupplier.id, track: 'INTENT', legacy: true },
      });
    }
  }
}
```

（英雄项目名/公司名与实际快照不符时以 `apps/api/prisma/seed-data/` 内 BidProject/Supplier 快照为准调整；`SupplierBidIntent.json` 若按上述代码内联装载则文件可不建——二选一，选代码内联则删掉 Create 文件项。）

- [ ] **Step 3: 跑 seed 验证幂等**

```bash
cd apps/api && npx tsx prisma/seed.ts && npx tsx prisma/seed.ts   # 连跑两遍均成功
```

- [ ] **Step 4: 提交**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(bid-intent): 种子纳入意向/事故两表——英雄项目意向+蜀通 legacy 事故演示

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: :3004 拟参与按钮 + 确认弹窗 + 投递引导

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/api/bid.ts`（api 对象加一方法）
- Create: `apps/supplier-portal-next/src/components/bid-intent-dialog.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/page.tsx`（行操作区 :309-343；`load` :118-138）
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx`（`bid-act-card` :493-529、`goToSubmit` :385-392、弹窗区 :1000-1041）
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx`（入口加载 :301-350、doSubmit catch :590-596）
- Modify: 门户样式文件（`src/styles/pages/` 下 bids 相关或 `globals.css`——先 grep 既有 danger token）

**Interfaces:**
- Consumes: Task 3 下发的 `intentApplicable` / `myIntent` / `intentConfirmable`（列表）与 `intentApplicable` / `myIntentConfirmedAt` / `intentConfirmable`（详情）；Task 2 端点。
- Produces: `bidApi.confirmIntent(projectId): Promise<{ confirmed: true; confirmedAt: string }>`；`<BidIntentDialog open projectId projectName onClose onConfirmed(confirmedAt) />`（本门户三页共用）。

- [ ] **Step 1: API 客户端**

`src/lib/api/bid.ts` 的 bidApi 对象内（照 `getMyOutcome` 相邻风格）加：

```ts
  /** 确认参与意向（2026-11-12）：公开项目投递前置；幂等、不可撤回 */
  confirmIntent: (projectId: string) =>
    api.post<{ confirmed: true; confirmedAt: string }>(`/supplier-portal/bid-projects/${projectId}/confirm-intent`),
```

- [ ] **Step 2: 共享确认弹窗组件**

新建 `src/components/bid-intent-dialog.tsx`（弹窗规范 A 版走 `SpDialog` icon 参数；红色警示用门户 danger token——Step 5 定）：

```tsx
"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { SpDialog, SpButton } from "./ui";
import { bidApi } from "@/lib/api/bid";

/** 确认参与意向弹窗（2026-11-12 履约闭环）：红色警示+不可撤回说明。
 *  确认成功 toast + onConfirmed 回调（调用方自行刷新本地状态），失败由 API 层全局 toast。 */
export function BidIntentDialog({
  open, projectId, projectName, onClose, onConfirmed,
}: {
  open: boolean;
  projectId: string;
  projectName?: string | null;
  onClose: () => void;
  onConfirmed: (confirmedAt: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function doConfirm() {
    setBusy(true);
    try {
      const r = await bidApi.confirmIntent(projectId);
      toast.success("已确认参与意向");
      onConfirmed(r?.confirmedAt ?? new Date().toISOString());
      onClose();
    } catch {
      /* API 层已全局错误 toast（INTENT_NOT_APPLICABLE / INTENT_STAGE_CLOSED 等按码提示） */
    } finally {
      setBusy(false);
    }
  }

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      title="确认参与意向"
      subtitle={projectName ?? undefined}
      icon={FileCheck2}
      width={440}
      footer={
        <>
          <SpButton variant="soft" onClick={onClose}>取消</SpButton>
          <SpButton variant="primary" loading={busy} onClick={doConfirm}>确认参与</SpButton>
        </>
      }
    >
      <p className="sp-intent-warn">若多次确认投标意向却未参与，则可能会被移入黑名单。</p>
      <p className="sp-intent-note">确认后不可撤回；确认参与意向后方可投递标书。</p>
    </SpDialog>
  );
}
```

- [ ] **Step 3: 列表页行按钮**

`bids/page.tsx`：
1. import：`import { BidIntentDialog } from "@/components/bid-intent-dialog";`
2. state（`projects` useState 附近）：`const [intentTarget, setIntentTarget] = useState<any | null>(null);`
3. 行操作区：`.row-deadline` 那个 `</div>` 之后、`详情 Link` 之前插（条件渲染三态：可确认→按钮；已确认→禁用；其余不显示）：

```tsx
                    {p.intentApplicable && (p.myIntent ? (
                      <button type="button" className="neu-btn-xs row-action" disabled>已确认参与</button>
                    ) : p.intentConfirmable ? (
                      <button type="button" className="neu-btn-xs row-action" onClick={() => setIntentTarget(p)}>拟参与</button>
                    ) : null)}
```

4. 页面 JSX 末尾（return 根 div 内）挂弹窗（确认成功就地改行状态，不整页 reload）：

```tsx
      {intentTarget && (
        <BidIntentDialog
          open
          projectId={intentTarget.id}
          projectName={intentTarget.name}
          onClose={() => setIntentTarget(null)}
          onConfirmed={() =>
            setProjects((prev) =>
              prev.map((x) => (x.id === intentTarget.id ? { ...x, myIntent: true, intentConfirmable: false } : x)),
            )
          }
        />
      )}
```

- [ ] **Step 4: 详情页按钮 + 提交拦截 + 弹窗**

`bids/[id]/page.tsx`：
1. import `BidIntentDialog` + `useRef`（若未引）。
2. state/派生（`canSubmit` 定义附近）：

```tsx
  const [intentOpen, setIntentOpen] = useState(false);
  const [intentOverride, setIntentOverride] = useState<string | null>(null); // 确认后即时态（loadAll 会带 myIntentConfirmedAt，重载后自然对齐）
  const intentThenSubmitRef = useRef(false);
  const myIntentConfirmedAt = intentOverride ?? project?.myIntentConfirmedAt ?? null;
  // 采购口径（2026-11-03）：招标不得泛指——仅方式名含「招标」用「招标」措辞（邀请招标本就无此按钮，实际命中=公开招标）
  const intentLabel = `拟参与本次${(project?.procurementMethod || "").includes("招标") ? "招标" : "采购"}`;
```

3. `bid-act-card` 的 `.neu-btn-group` 内、「提交标书」主按钮**之前**插（不可确认且未确认→不显示；已确认→禁用「已确认参与」）：

```tsx
                  {project.intentApplicable && (project.intentConfirmable || myIntentConfirmedAt) && (
                    <button
                      type="button"
                      className="neu-btn-soft"
                      disabled={!!myIntentConfirmedAt}
                      onClick={() => { intentThenSubmitRef.current = false; setIntentOpen(true); }}
                    >
                      {myIntentConfirmedAt ? "已确认参与" : intentLabel}
                    </button>
                  )}
```

4. `goToSubmit`（:385-392）首行资格判断之后、`router.push` 之前插未确认拦截：

```tsx
    // 履约闸引导（2026-11-12）：未确认意向先弹确认，确认后直跳投递页（后端 INTENT_REQUIRED 兜底）
    if (project?.intentApplicable && !myIntentConfirmedAt) {
      intentThenSubmitRef.current = true;
      setIntentOpen(true);
      return;
    }
```

5. 弹窗挂 JSX 末尾（payDialog 旁）：

```tsx
      <BidIntentDialog
        open={intentOpen}
        projectId={projectId}
        projectName={project?.name}
        onClose={() => { setIntentOpen(false); intentThenSubmitRef.current = false; }}
        onConfirmed={(confirmedAt) => {
          setIntentOverride(confirmedAt);
          if (intentThenSubmitRef.current) {
            intentThenSubmitRef.current = false;
            router.push(`/bids/${projectId}/submit`);
          }
        }}
      />
```

- [ ] **Step 5: 投递页双兜底**

`bids/[id]/submit/page.tsx`：
1. 入口加载段（:310-314 阶段闸之后）加意向闸（省得白输 PIN）：

```tsx
        if (p && p.intentApplicable && !p.myIntentConfirmedAt) {
          toast.warning("请先确认参与意向，再投递标书");
          router.push(`/bids/${projectId}`);
          return;
        }
```

2. `doSubmit` catch（:590-596）最前面加业务码分流（业务码判别先例 `e?.code ?? e?.data?.code`）：

```tsx
      const errCode = (err as any)?.code ?? ((err as any)?.data as Record<string, unknown> | undefined)?.code;
      if (errCode === "INTENT_REQUIRED") {
        toast.warning("请先确认参与意向，再投递标书");
        router.push(`/bids/${projectId}`);
        return;
      }
```

- [ ] **Step 6: 样式**

先 `grep -rn "danger" apps/supplier-portal-next/src/app/globals.css apps/supplier-portal-next/src/styles` 找既有警示色 token（如 `--sp-danger`）；有则引用，无则在 `:root` 新增 token 后引用（在 bids 页样式文件或 globals.css 末尾加）：

```css
.sp-intent-warn {
  color: var(--sp-danger, #b3261e);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.7;
  margin: 0 0 6px;
}
.sp-intent-note {
  color: var(--sp-muted, #6b7280);
  font-size: 12px;
  line-height: 1.7;
  margin: 0;
}
```

（token 名以 grep 实际命中为准替换；禁止最终 CSS 里保留裸色 `#b3261e`——若新增 token，把它定义进 `:root` 并在类里只引 token。）

- [ ] **Step 7: 验证 + 提交**

```bash
pnpm --filter supplier-portal-next lint
pnpm --filter supplier-portal-next build   # tsc 闸
# 有运行环境时手点：列表「拟参与」→弹窗红字→确认→按钮变「已确认参与」；未确认点「提交标书」→弹确认→确认后直跳投递页
git add apps/supplier-portal-next/src/lib/api/bid.ts apps/supplier-portal-next/src/components/bid-intent-dialog.tsx \
        apps/supplier-portal-next/src/app/\(main\)/bids/page.tsx apps/supplier-portal-next/src/app/\(main\)/bids/\[id\]/page.tsx \
        apps/supplier-portal-next/src/app/\(main\)/bids/\[id\]/submit/page.tsx <样式文件>
git commit -m "feat(bid-intent): :3004 项目机会拟参与按钮+确认弹窗+投递前置引导

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 13: :3005 公告「投标情况」两处加意向维度

**Files:**
- Modify: `apps/web/src/lib/api/announcement.ts`（Participant :206-216 / ParticipantsResult :217-224）
- Modify: `apps/web/src/app/(main)/notice/page.tsx`（ParticipantsModal KPI 行 :654-660 + 供应商表 :662-727 + 空态 colSpan + KpiTile/BidStatusBadge :738-753）
- Modify: `apps/web/src/app/(main)/notice/[id]/page.tsx`（投标情况卡 :428-468）

**Interfaces:**
- Consumes: Task 8 后端返回的 `suppliers[].intentConfirmedAt` 与 `stats.intentConfirmed`。
- Produces: 前端类型 `Participant.intentConfirmedAt?: string | null`、`stats.intentConfirmed: number`。

- [ ] **Step 1: 类型扩展**

`src/lib/api/announcement.ts` 的 `Participant` 接口加：

```ts
  /** 参与意向确认时间（2026-11-12；null=未确认） */
  intentConfirmedAt?: string | null;
```

`ParticipantsResult.stats` 改为：

```ts
  stats: { total: number; submitted: number; intentConfirmed: number };
```

- [ ] **Step 2: 列表页弹窗——KPI 行加瓷片**

`notice/page.tsx` ParticipantsModal KPI 行（`grid grid-cols-3` → `grid-cols-4`，新增「已确认意向」，原「已下载文件」瓷片的 `accent="accent"` 移除避免双强调色）：

```tsx
              <div className="mt-1 grid grid-cols-4 gap-2">
                <KpiTile label="参与供应商" value={result.stats.total} />
                <KpiTile label="已确认意向" value={result.stats.intentConfirmed} accent="accent" />
                <KpiTile label="已提交标书" value={result.stats.submitted} accent="success" />
                <KpiTile label="已下载文件" value={downloadCount} />
              </div>
```

- [ ] **Step 3: 列表页弹窗——表格加「意向」列**

表头「业务标签」与「下载」之间加 `<th className="text-center">意向</th>`；空态 `colSpan={5}` 改 `colSpan={6}`；行内同位插单元格（时间格式照「下载」列的双行样式）：

```tsx
                    <td className="text-center">
                      {s.intentConfirmedAt ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[0.8rem] font-semibold text-[var(--accent)]">已确认</span>
                          <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                            {new Date(s.intentConfirmedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}{' '}
                            {new Date(s.intentConfirmedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[var(--muted-foreground)]/60">未确认</span>
                      )}
                    </td>
```

- [ ] **Step 4: 详情页投标情况卡**

`notice/[id]/page.tsx`：
1. 头部计数（:434 `neu-tab-count`）追加意向数：

```tsx
                <span className="neu-tab-count ml-auto">{participants.stats.total} 家参与 · {participants.stats.intentConfirmed} 家已确认意向 · {participants.stats.submitted} 家已递交</span>
```

2. 行内 meta 行（`{s.downloadCount > 0 && ...}` 之前）插意向信息：

```tsx
                        {s.intentConfirmedAt && ` · 意向确认于 ${new Date(s.intentConfirmedAt).toLocaleString('zh-CN')}`}
```

3. 未确认意向但已确认者无变化；意向-only 供应商（未下载未递交）行自然出现（后端补行），其递交徽章保持「未递交」——无需特判。

- [ ] **Step 5: 验证 + 提交**

```bash
pnpm --filter web lint && pnpm --filter web build
git add apps/web/src/lib/api/announcement.ts apps/web/src/app/\(main\)/notice/page.tsx apps/web/src/app/\(main\)/notice/\[id\]/page.tsx
git commit -m "feat(bid-intent): 公告投标情况弹窗/详情卡并入意向维度（KPI+列+标记）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 14: :3005 开标确认面板意向列与统计

**Files:**
- Modify: `apps/web/src/lib/api/bid.ts`（BidWorkspaceSupplier :44-66 / BidWorkspace.stats :101-113）
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx`（行模型 :541-580、表格 :649-724、统计条 :1356-1366）

**Interfaces:**
- Consumes: Task 9 后端 `suppliers[].intentConfirmedAt`（意向-only 行 id 形如 `intent-*`）与 `stats.intentConfirmed`。
- Produces: 类型 `BidWorkspaceSupplier.intentConfirmedAt: string | null`、`BidWorkspace.stats.intentConfirmed: number`。

- [ ] **Step 1: 类型扩展**

`BidWorkspaceSupplier` 加：

```ts
  /** 参与意向确认时间（2026-11-12）；意向-only 补行（id=intent-*）恒有值 */
  intentConfirmedAt: string | null;
```

`BidWorkspace.stats` 加 `intentConfirmed: number;`。

- [ ] **Step 2: 行模型并入意向**

`bid-confirm-panel.tsx` 行模型 type `SupplierRow` 加 `intentConfirmedAt: string | null;`。非谈判分支 map 改为：

```tsx
    : wsSuppliers.map((s) => ({
        key: s.id,
        supplierName: s.supplierName,
        tags: s.tags?.length ? s.tags : (String(s.id).startsWith('intent-') ? ['自主确认'] : []),
        rsvpStatus: s.supplierId ? rsvpMap.get(s.supplierId) : undefined,
        submitted: s.submitted,
        withdrawn: s.withdrawn,
        submittedAt: s.submission?.submittedAt ?? null,
        bidPrice: s.submission?.bidPrice ?? null,
        intentConfirmedAt: s.intentConfirmedAt ?? null,
      }));
```

谈判分支行模型补 `intentConfirmedAt: sub?.intentConfirmedAt ?? null`（谈判无公开意向，恒 null——列也在谈判下隐藏，见 Step 3）。

- [ ] **Step 3: 表格加「意向」列（非谈判显示）**

表头（`showRsvpColumn` 判断旁）加：

```tsx
                          {!isNegotiation && <th style={{ width: 110 }}>意向</th>}
```

行内「业务标签」之后同位插：

```tsx
                          {!isNegotiation && (
                            <td>
                              {r.intentConfirmedAt ? (
                                <div className="flex flex-col">
                                  <StatusPill tone="success">已确认</StatusPill>
                                  <span className="mt-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                                    {formatDateTime(r.intentConfirmedAt)}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[11px] text-[var(--muted-foreground)]/60">未确认</span>
                              )}
                            </td>
                          )}
```

（`formatDateTime`/`StatusPill` 均为本文件既有工具，直接复用。）

- [ ] **Step 4: 统计条——「受邀」更名「供应商」并加已确认意向**

统计条（流标确认 Modal 内 :1356-1366）：`workspace.suppliers.length` 现含意向-only 补行，「受邀」措辞失真——第一项改为「供应商」，并加意向计数：

```tsx
              <span>供应商 <strong className="text-[color:var(--foreground)]">{workspace.suppliers.length}</strong> 家</span>
              <span>已确认意向 <strong className="text-[color:var(--accent)]">{workspace.stats.intentConfirmed}</strong></span>
              <span>已投递 <strong className="text-[color:var(--success)]">{workspace.suppliers.filter(s => s.submitted).length}</strong></span>
```

（未投递/已撤回两项保持原样——未投递含「确认意向未投递」供应商，与表格口径一致，属预期。）

- [ ] **Step 5: 验证 + 提交**

```bash
pnpm --filter web lint && pnpm --filter web build
git add apps/web/src/lib/api/bid.ts apps/web/src/components/projects/bid-confirm-panel.tsx
git commit -m "feat(bid-intent): 开标确认面板意向列+自主确认标签+统计（受邀口径更名供应商）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 15: :3005 供应商详情「参与情况」tab

**Files:**
- Modify: `apps/web/src/lib/api/supplier.ts`（加 getSupplierParticipation + 类型）
- Create: `apps/web/src/components/supplier/participation-tab.tsx`（照 portrait-tab.tsx 先例）
- Modify: `apps/web/src/app/(main)/supplier/[id]/page.tsx`（TabKey :24-29、tabs 数组 :337-344、tab 渲染分支 :799 附近）

**Interfaces:**
- Consumes: Task 10 `GET /supplier/:id/participation`。
- Produces: `ParticipationTab({ supplierId }: { supplierId: string })`；`getSupplierParticipation(supplierId): Promise<ParticipationView>`。

- [ ] **Step 1: API 客户端**

`src/lib/api/supplier.ts`（getRsvpHistory 相邻）：

```ts
/** 供应商参与情况（2026-11-12 履约闭环）：意向/回执/投递/未投递事故聚合 */
export interface ParticipationView {
  kpi: {
    intentTotal: number;
    rsvpAcceptedTotal: number;
    submittedTotal: number;
    noShowTotal: number;
    noShowActiveCount: number;
    blacklistThreshold: number;
  };
  incidents: { projectName: string; projectCode: string; stage: string; track: string; detectedAt: string; legacy: boolean }[];
  intents: { projectName: string; projectCode: string; stage: string; confirmedAt: string; submitted: boolean }[];
  blacklist: { reason: string | null; penalties: { penaltyDocNo: string; authority: string; decisionDate: string; penaltyContent: string }[] } | null;
}
export function getSupplierParticipation(supplierId: string) {
  return api.get<ParticipationView>(`/supplier/${encodeURIComponent(supplierId)}/participation`);
}
```

- [ ] **Step 2: ParticipationTab 组件**

`src/components/supplier/participation-tab.tsx`（自拉 API + loading/error，统计瓷片照 rsvp tab 形态、逐条卡照 `neu-card-static !rounded-2xl p-4`）：

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { History, FileCheck2, Send, AlertTriangle, ShieldAlert } from "lucide-react";
import { getSupplierParticipation, type ParticipationView } from "@/lib/api/supplier";

const TRACK_LABEL: Record<string, string> = { INTENT: '公开意向', RSVP: '邀请回执' };

export function ParticipationTab({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<ParticipationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!supplierId) return;
    setLoading(true);
    getSupplierParticipation(supplierId)
      .then((r) => { setData(r); setFailed(false); })
      .catch(() => { setFailed(true); })
      .finally(() => setLoading(false));
  }, [supplierId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>;
  if (failed || !data) return (
    <div className="py-8 text-center">
      <p className="text-sm text-[var(--muted-foreground)]">参与情况加载失败</p>
      <button type="button" className="neu-btn-soft mt-3 !h-[32px] !text-xs" onClick={load}>重试</button>
    </div>
  );

  const { kpi } = data;
  return (
    <div>
      {/* 拉黑状态条 */}
      {data.blacklist && (
        <div className="mb-4 rounded-2xl border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 text-[var(--danger)]" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--danger)]">已列入黑名单</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--foreground)]">{data.blacklist.reason}</p>
              {data.blacklist.penalties.map((p) => (
                <p key={p.penaltyDocNo} className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  处罚留痕 {p.penaltyDocNo} · {p.authority} · {new Date(p.decisionDate).toLocaleDateString('zh-CN')}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 统计瓷片（照邀请回执 tab 形态） */}
      <div className="grid grid-cols-2 gap-4 mb-4 lg:grid-cols-4">
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">确认参与（意向）</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none text-[var(--accent)]">{kpi.intentTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">次公开项目确认</p>
        </div>
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">回执确认参加</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none">{kpi.rsvpAcceptedTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">次邀请确认</p>
        </div>
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">实际投递</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none" style={{ color: 'var(--success)' }}>{kpi.submittedTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">次标书投递</p>
        </div>
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">确认未投递</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none" style={{ color: 'var(--danger)' }}>{kpi.noShowTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
            {kpi.noShowActiveCount > 0
              ? `履约进度 ${kpi.noShowActiveCount}/${kpi.blacklistThreshold}——再次确认未投递将自动列入黑名单`
              : `含历史 ${kpi.noShowTotal - kpi.noShowActiveCount} 条`}
          </p>
        </div>
      </div>

      {/* 事故明细 */}
      <div className="neu-card-static !rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-[var(--danger)]" />
          <h4 className="text-sm font-semibold text-[var(--foreground)]">确认参与未投递记录</h4>
          <span className="neu-tab-count ml-auto">{data.incidents.length} 条</span>
        </div>
        {data.incidents.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无确认未投递记录</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.incidents.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-[8px] bg-[var(--surface)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]" title={it.projectName}>{it.projectName}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {it.projectCode} · {TRACK_LABEL[it.track] ?? it.track}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {it.legacy && <span className="rounded-[6px] bg-[var(--muted)]/60 px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">历史</span>}
                  <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{new Date(it.detectedAt).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 意向明细 */}
      <div className="mt-4 neu-card-static !rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <FileCheck2 size={14} className="text-[var(--accent)]" />
          <h4 className="text-sm font-semibold text-[var(--foreground)]">参与意向记录</h4>
          <span className="neu-tab-count ml-auto">{data.intents.length} 条</span>
        </div>
        {data.intents.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无公开项目参与意向</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.intents.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-[8px] bg-[var(--surface)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]" title={it.projectName}>{it.projectName}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">{it.projectCode} · 确认于 {new Date(it.confirmedAt).toLocaleString('zh-CN')}</p>
                </div>
                {it.submitted ? (
                  <span className="shrink-0 rounded-[6px] bg-[rgba(92,181,150,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[rgba(78,150,124,1)]">已投递</span>
                ) : (
                  <span className="shrink-0 rounded-[6px] bg-[var(--muted)]/60 px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">未投递</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

（`History`/`Send` 图标如未用请从 import 移除，保持 lint 干净。）

- [ ] **Step 3: 详情页挂 tab**

`supplier/[id]/page.tsx`：
1. `type TabKey` 加 `'participation'`（MERGED_TAB 不动——新键无旧深链）；
2. `tabs` 数组「履约评价」前插 `{ key: 'participation', label: '参与情况' }`；
3. tab 渲染分支（`{activeTab === 'portrait' && ...}` 旁）加：

```tsx
          {activeTab === 'participation' && <ParticipationTab supplierId={supplier.id} />}
```

4. 顶部 import `ParticipationTab`。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm --filter web lint && pnpm --filter web build
git add apps/web/src/lib/api/supplier.ts apps/web/src/components/supplier/participation-tab.tsx apps/web/src/app/\(main\)/supplier/\[id\]/page.tsx
git commit -m "feat(bid-intent): 供应商详情新增参与情况tab——履约KPI/事故明细/拉黑状态

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 16: e2e 更新与新增链路用例

**Files:**
- Modify: `apps/api/test/bid.e2e-spec.ts`（:207 提交点前）
- Modify: `apps/api/test/bid-v3.e2e-spec.ts`（:189/:340/:536 三处提交点前）
- Modify: `apps/api/test/clarification-reply.e2e-spec.ts`（:238 提交点前）
- Modify: `apps/api/test/supplier.e2e-spec.ts`（:230 草稿/提交点前）
- Modify: `apps/api/test/opening-hall.e2e-spec.ts`（提交点，grep 定位）

**Interfaces:**
- Consumes: Task 2 `POST /api/supplier-portal/bid-projects/:id/confirm-intent`。

- [ ] **Step 1: 既有提交点补确认调用**

各 spec 中对**公开项目**（有公告/BidDocument OPEN 的项目）在首次 draft/submit 前，以同一供应商登录态插：

```ts
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-projects/${projectId}/confirm-intent`)
      .set('Cookie', supplierCookie)
      .expect(201);
```

（cookie 变量名/登录助手以各 spec 既有为准；谈判/受邀项目用例**不加**——豁免路径。若某用例的项目无 BidDocument（谈判轨），加了反而 400——逐处按项目性质判断。）

- [ ] **Step 2: 新增链路用例（放 supplier.e2e-spec.ts）**

```ts
describe('投标意向确认链路（2026-11-12）', () => {
  it('未确认→提交 400 INTENT_REQUIRED→确认→提交成功', async () => {
    // 借既有「A-94 草稿投递格式闸」用例的项目准备路径（公告直建 OPEN 项目 + 供应商登录），
    // 1) 直接 submit → 400 { code: 'INTENT_REQUIRED' }
    // 2) confirm-intent → 201
    // 3) 重复 confirm-intent → 201（幂等，confirmedAt 不变）
    // 4) submit → 走到既有格式/信封闸（非 INTENT_REQUIRED 即通过本用例断言）
  });

  it('邀请回执确认×3 未投递→开标→自动拉黑+处罚留痕+通知', async () => {
    // 1) 自建 3 个 SUBMIT 阶段项目 + 每项目给供应商写 InvitationRsvp(ACCEPTED, projectId, respondedAt=now)
    //    （prisma 直写 service 侧；登录态供应商）
    // 2) 逐项目走 :3005 按时开标端点（借既有 e2e 的开标推进 helper/直写 stage='OPENING' 后调
    //    oversight.sweepProject —— e2e 内拿不到 service 实例时，用 app.get(BidIntentOversightService)）
    // 3) 第 3 个项目开标后断言：Supplier.status='BLACKLIST'、SupplierPenalty 存在 AUTO- 文号、
    //    User.isActive=false、Notification 表有 SUPPLIER_BLACKLISTED 站内通知
  });
});
```

（两条用例的脚手架大量借既有 spec——项目自建/登录 helper 名称以文件内既有 describe 为准；断言核心如注释所列，端到端跑通。）

- [ ] **Step 3: 跑 e2e**

```bash
cd apps/api && pnpm test:e2e -- bid.e2e-spec   # 先单套
pnpm test:e2e                                   # 全量（--forceExit 已带）
```

全量红时先判归因：新用例自身 vs 既有被闸误伤（若谈判轨用例误加确认调用会 400——按项目性质修正）。

- [ ] **Step 4: 提交**

```bash
git add apps/api/test
git commit -m "test(bid-intent): e2e 提交点补确认调用+意向链路/自动拉黑两条新用例

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 17: 全链验证与收尾

**Files:** 无新文件（验证任务）。

- [ ] **Step 1: 后端全量**

```bash
cd apps/api
pnpm test            # 全量单测
pnpm lint
npx tsc --noEmit     # 类型闸
```

- [ ] **Step 2: 数据库链**

```bash
npx prisma validate && npx prisma migrate status   # clean
```

- [ ] **Step 3: 冒烟（可选但推荐）**

```bash
pnpm dev:kill && pnpm dev   # 十端口全监听；/api/docs 200
# 手动冒烟（有浏览器时）：:3004 项目机会列表出现「拟参与」→ 弹窗红字 → 确认后按钮「已确认参与」；
# 未确认先点「提交标书」→ 弹意向确认；:3005 公告「投标情况」KPI 含「已确认意向」。
```

- [ ] **Step 4: 汇报**

无代码改动则无提交；发现回归按所属任务返修后重跑本任务。
