# 项目管理「已移出」区（已终止×回收站合并 + 删除留痕）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 :3005 项目管理的「已终止」tab 与「回收站」抽屉合并为一个「已移出」区（三节：已终止/已移除/已彻底删除），后端补状态闸+投标闸（收口审计 P2-2），恢复改三向按戳推断，彻底删除扩为「留痕+附件卫生+台账轮次连带删除」。

**Architecture:** 状态枚举四值（ACTIVE/ARCHIVED/TERMINATED/RECYCLED）不变，纯展示层收口；新增独立留痕表 `ProjectDeletionRecord`（无外键、纯快照列、无删除端点=天然不可删）；PMI 服务三端点改写 + 一个新读端点；前端退役 `RecycleBinDrawer`，其卡片形态移植为新组件并入 tab。

**Tech Stack:** NestJS 11 + Prisma（API）、Next.js 16 + React 19 + Tailwind v4 + cgzxui（web）、jest 单测（co-located spec）。

**Spec:** `docs/superpowers/specs/2026-11-12-pmi-terminated-recycle-merge-design.md`（含三项用户裁定，见 §6）

## Global Constraints

- 界面文案全中文，禁英文/黑话（2026-10-28 裁定）；改文案须同步测试断言
- cgzxui 体系：按钮 `neu-btn-soft`（危险=`is-danger`）、卡片 `neu-card-static`、弹窗 `wb-modal-shell` 瓷面壳（弹窗规范 A 版：图标井头部五件套）
- **状态枚举四值不得增删改**——TERMINATED/RECYCLED 在台账、水叮当、合同、绩效等 10+ 处被消费
- 留痕操作人一律 displayName 快照、username 兜底（2026-11-09 裁定）
- `schema.prisma` 是并行会话共享高危文件：Task 1 开工前先 `git status` 确认对方无未提交改动；本计划只 add 自己明确改动的文件路径，**禁 `git add -A`/`git add .`**
- 改 schema 后提交前必须 `npx prisma validate`（validate 失败会静默连坐 generate）
- 本地库有迁移漂移（memory `local-db-migration-drift`）：新迁移走 `--create-only` → `db execute` → `resolve --applied`，勿直接 `migrate dev`
- 工作目录：`/Users/qihao/ERP2/ERP/water-erp`（所有相对路径以此为根）
- 每个 Task 完成即提交；提交信息用 `feat(projects):` 前缀，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 后端单测命令：`pnpm --filter api test -- project-management`（co-located spec）；新增 ESM-only 依赖才需要动 jest allowlist（本计划零新依赖）

---

### Task 1: `ProjectDeletionRecord` 模型 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（在 `model ProjectManagementItem` 之前插入新 model）
- Create: `apps/api/prisma/migrations/<ts>_pmi_deletion_record/migration.sql`（由 prisma 生成）

**Interfaces:**
- Produces: Prisma 模型 `projectDeletionRecord`（delegate：`create`/`findMany`）——Task 4/5 依赖；列定义见下方 schema 块（后续任务按此引用字段名）

- [ ] **Step 1: 确认工作区可安全改 schema**

Run: `git status --short`
Expected: 仅本计划已提交内容之外无他人未提交改动（若 `apps/api/prisma/schema.prisma` 或 `apps/api/src/project-management/` 已被他人修改则停下等待，勿开工）。

- [ ] **Step 2: 在 schema.prisma 插入模型**

在 `model ProjectManagementItem {` 行之前插入（独立快照表，无任何外键 relation——纯快照列，防被关联删除）：

```prisma
// ── 删除留痕（spec 2026-11-12 §5）：彻底删除 PMI 时的墓碑记录。写入仅在 deletePermanently
// 事务内，无独立写端点、无删除端点=天然不可删（对齐 OperationLog 归档哲学）──
model ProjectDeletionRecord {
  id                  String    @id @default(cuid())
  projectId           String // 被删 PMI 原 id（留痕定位，非外键）
  title               String
  projectCode         String?
  requesterName       String
  requesterDepartment String
  procurementMethod   String
  budgetAmount        Decimal?  @db.Decimal(14, 2)
  companyId           String?
  companyName         String? // 写时快照
  createdById         String? // 原创建人（staff 可见性=本人留痕，对齐 list() 口径）
  terminatedAt        DateTime?
  terminationReason   String?
  terminatedStage     String?
  terminatedByName    String? // displayName 快照
  terminatedRoundNo   Int? // 被连带删除的台账轮次号
  recycledAt          DateTime?
  deletedAt           DateTime  @default(now())
  deletedByName       String // 操作人 displayName 快照

  @@index([companyId, deletedAt])
}
```

- [ ] **Step 3: 校验 schema**

```bash
cd apps/api && npx prisma validate
```
Expected: `The schema at prisma/schema.prisma is valid.`

- [ ] **Step 4: 生成迁移（create-only，不直接 apply）**

```bash
cd apps/api && npx prisma migrate dev --create-only --name pmi_deletion_record
```
Expected: 生成 `prisma/migrations/<ts>_pmi_deletion_record/migration.sql`。打开审阅：应只含 `CREATE TABLE "ProjectDeletionRecord"` + `CREATE INDEX`，无任何其他表 DDL。若命令因迁移漂移报 reset 要求，改为手写该 SQL 文件（上句两段 DDL）再继续。

- [ ] **Step 5: 手工 apply + resolve + generate**

```bash
cd apps/api && npx prisma db execute --file prisma/migrations/<ts>_pmi_deletion_record/migration.sql \
  && npx prisma migrate resolve --applied <ts>_pmi_deletion_record \
  && npx prisma generate
```
（`<ts>` 替换为 Step 4 实际目录名。）
Expected: 三步全部成功；`npx prisma migrate status` 无 pending。

- [ ] **Step 6: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(projects): ProjectDeletionRecord 删除留痕模型与迁移（已移出区 spec §5）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: `moveToRecycleBin` 状态闸 + 投标闸（TDD）

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts:5983-6004`（`moveToRecycleBin` 整体替换）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: 既有 `assertCanManageProject(user, project, msg)`（service:357，创建人放行）；`PROJECT_MANAGEMENT_STATUS` 常量（service:66 附近，含 ACTIVE/ARCHIVED/TERMINATED/RECYCLED 四键）；`STAGE_LABEL`（已 import）
- Produces: `moveToRecycleBin(projectId, user)` 新契约——放行集 ACTIVE+TERMINATED；ARCHIVED→400 `已完成项目不可移除清理。`；RECYCLED 幂等返回；关联活动态 BidProject→409 `{error, code:'BID_IN_PROGRESS'}`。签名不变，Task 8 前端复用同端点。

- [ ] **Step 1: 写失败测试**

在 `project-management.service.spec.ts` 的 `describe('ProjectManagementService', ...)` 内（`it('restores a recycled project back to active status', ...)` 之后）追加：

```ts
describe('moveToRecycleBin 状态与投标闸（spec 2026-11-12 §4.2）', () => {
  const USER = { sub: 'u-1', username: '张三', role: 'staff' } as any;

  it('TERMINATED 项目放行——终态清理通道（裁定 #2 前置）', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ id: 'pm-01', status: 'TERMINATED', createdById: 'u-1' });
    prisma.bidProject.findMany.mockResolvedValue([]);
    prisma.projectManagementItem.update.mockResolvedValue({ id: 'pm-01', status: 'RECYCLED' });

    await expect(service.moveToRecycleBin('pm-01', USER)).resolves.toMatchObject({ status: 'RECYCLED' });
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-01' },
      data: expect.objectContaining({ status: 'RECYCLED' }),
    });
  });

  it('ARCHIVED 项目拒收——已完成不可清理（裁定 #1）', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ id: 'pm-01', status: 'ARCHIVED', createdById: 'u-1' });

    await expect(service.moveToRecycleBin('pm-01', USER)).rejects.toThrow(BadRequestException);
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });

  it('关联投标项目活动态 → 409 BID_IN_PROGRESS（P2-2 收口）', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ id: 'pm-01', status: 'ACTIVE', createdById: 'u-1' });
    prisma.bidProject.findMany.mockResolvedValue([{ name: '测试投标项目', stage: 'OPENING' }]);

    await expect(service.moveToRecycleBin('pm-01', USER)).rejects.toMatchObject({
      response: { code: 'BID_IN_PROGRESS' },
    });
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });

  it('RECYCLED 幂等——直接返回不重写 recycledAt', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ id: 'pm-01', status: 'RECYCLED', createdById: 'u-1' });

    await expect(service.moveToRecycleBin('pm-01', USER)).resolves.toMatchObject({ status: 'RECYCLED' });
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter api test -- project-management.service.spec -- --testNamePattern="moveToRecycleBin"
```
Expected: TERMINATED 放行用例 FAIL（现状无状态闸不会拦，但 update 未带正确路径？——实际失败点：TERMINATED 用例可通过【现状也放行】；ARCHIVED 用例 FAIL（现状放行未抛 400）；BID_IN_PROGRESS 用例 FAIL（现状无闸）。以 ARCHIVED/BID 两个 FAIL 为准，若全 PASS 说明测试没生效，检查 describe 位置。

- [ ] **Step 3: 替换实现**

用下述代码整体替换 `moveToRecycleBin`（service:5983-6004）：

```ts
  async moveToRecycleBin(projectId: string, user?: AuthenticatedUser) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, createdById: true },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // Creator-only (2026-10-10 读写分级：leader/admin 对他人项目只读)
    this.assertCanManageProject(user, project, '仅项目创建人可将项目移至回收站。');

    if (project.status === PROJECT_MANAGEMENT_STATUS.RECYCLED) {
      return project;
    }

    // 状态闸（spec 2026-11-12 §4.2，裁定 #1）：仅进行中（建错移除）与已终止（终态清理）
    // 可入回收站；已完成是成果记录，保持已完成 tab 纯净、拒收清理。
    if (project.status === PROJECT_MANAGEMENT_STATUS.ARCHIVED) {
      throw new BadRequestException('已完成项目不可移除清理。');
    }

    // 投标活动闸（P2-2 收口，2026-11-12）：与 completeProject/公告删除同源——关联招标项目
    // 仍处活动阶段时禁移除，否则 PMI 消失而投标侧永卡活动态；终态项目终止时已联动流标，自然放行。
    const activeBidProjects = await this.prisma.bidProject.findMany({
      where: {
        projectManagementItemId: projectId,
        stage: { in: ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING'] },
      },
      select: { name: true, stage: true },
    });
    if (activeBidProjects.length > 0) {
      const names = activeBidProjects
        .map((bp) => `「${bp.name}」(${STAGE_LABEL[bp.stage] ?? bp.stage})`)
        .join('、');
      throw new ConflictException({
        error: `关联招标项目仍在开评标流程中：${names}。请先终止项目（联动流标）后再移除，或在「开标确认」面板完成完整归档`,
        code: 'BID_IN_PROGRESS',
      });
    }

    return this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: { status: PROJECT_MANAGEMENT_STATUS.RECYCLED, recycledAt: new Date() },
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter api test -- project-management.service.spec
```
Expected: 新 describe 4 项 PASS，存量全绿（`restores a recycled project back to active status` 不受影响）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "feat(projects): moveToRecycleBin 状态闸（仅 ACTIVE/TERMINATED 可移除）+ BID_IN_PROGRESS 投标闸——收口审计 P2-2

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: `restoreFromRecycleBin` 三向按戳推断（TDD）

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts:6006-6027`（`restoreFromRecycleBin` 整体替换）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: `assertCanManageProject`、`PROJECT_MANAGEMENT_STATUS`（同 Task 2）
- Produces: `restoreFromRecycleBin` 新契约——恢复目标 = `terminatedAt`→TERMINATED ｜ `archivedAt`→ARCHIVED（存量兜底）｜ 无戳→ACTIVE；仍清 `recycledAt`。前端 Task 7 的 `restoreTargetLabel()` 按同口径实现。

- [ ] **Step 1: 写失败测试**

```ts
describe('restoreFromRecycleBin 三向按戳推断（spec 2026-11-12 §4.3）', () => {
  const USER = { sub: 'u-1', username: '张三', role: 'staff' } as any;

  it.each([
    ['terminatedAt 戳 → 回到 TERMINATED（终止记录不复活为进行中）', { terminatedAt: new Date('2026-10-01') }, 'TERMINATED'],
    ['archivedAt 戳 → 回到 ARCHIVED（放行集收紧前的存量兜底）', { archivedAt: new Date('2026-09-01') }, 'ARCHIVED'],
    ['无戳 → 回到 ACTIVE（建错移除的撤回）', {}, 'ACTIVE'],
  ])('%s', async (_name, stamps, expected) => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01', status: 'RECYCLED', createdById: 'u-1', ...stamps,
    });
    prisma.projectManagementItem.update.mockResolvedValue({ id: 'pm-01', status: expected });

    await expect(service.restoreFromRecycleBin('pm-01', USER)).resolves.toMatchObject({ status: expected });
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-01' },
      data: { status: expected, recycledAt: null },
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter api test -- project-management.service.spec -- --testNamePattern="三向按戳推断"
```
Expected: terminatedAt/archivedAt 两用例 FAIL（现状恒回 ACTIVE）。

- [ ] **Step 3: 替换实现**

```ts
  async restoreFromRecycleBin(projectId: string, user?: AuthenticatedUser) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, createdById: true, terminatedAt: true, archivedAt: true },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // Creator-only (2026-10-10 读写分级：leader/admin 对他人项目只读)
    this.assertCanManageProject(user, project, '仅项目创建人可恢复该项目。');

    if (project.status !== PROJECT_MANAGEMENT_STATUS.RECYCLED) {
      throw new BadRequestException('只有回收站中的项目可以恢复。');
    }

    // 三向按戳推断（spec 2026-11-12 §4.3）：恢复回原状态而非恒回 ACTIVE——终止记录被
    // 「清理→反悔」后复活为进行中属业务终态破坏。两戳互斥（terminate/complete 均只从
    // ACTIVE 进入），推断无需 priorStatus 列、无迁移。
    const restoreStatus = project.terminatedAt
      ? PROJECT_MANAGEMENT_STATUS.TERMINATED
      : project.archivedAt
        ? PROJECT_MANAGEMENT_STATUS.ARCHIVED
        : PROJECT_MANAGEMENT_STATUS.ACTIVE;

    return this.prisma.projectManagementItem.update({
      where: { id: projectId },
      data: { status: restoreStatus, recycledAt: null },
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter api test -- project-management.service.spec
```
Expected: 全绿（存量 `restores ... back to active status` 的 mock 无两戳 → ACTIVE，仍通过）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "feat(projects): restoreFromRecycleBin 三向按戳推断恢复——终止/归档记录不再复活为进行中

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: `deletePermanently` 留痕 + 附件卫生 + 台账轮次连带（TDD）

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts:6029-6077`（`deletePermanently` 整体替换）
- Modify: `apps/api/src/project-management/project-management.service.spec.ts`（makeService 的 prisma 对象补键 + 追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `prisma.projectDeletionRecord.create`；既有 `unlink`/`resolve` import（service 顶部，deleteAttachment 在用）；makeService 既有 `$transaction` mock（spec:462，以 prisma 为 tx 直接执行回调）
- Produces: `deletePermanently` 副作用契约——①墓碑落库 ②附件行删除（PMI 直挂+stage 挂+轮次挂三条归属）③`terminatedProcurementRoundId` 轮次连带删除 ④PMI 删除；磁盘文件事务提交后 best-effort unlink。返回值不变 `{ success: true }`。

- [ ] **Step 1: makeService 补 prisma 键**

在 spec 的 makeService 内 `prisma` 对象中：

`procurementRound` 键由 `procurementRound: { create: jest.fn() }` 改为：

```ts
      procurementRound: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      },
```

`attachment` 键追加 `deleteMany: jest.fn(),`；并新增两键：

```ts
      projectDeletionRecord: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
```

同时检查 spec 顶部 `jest.mock('node:fs/promises', ...)` 工厂：若缺 `unlink: jest.fn(),` 键则补上（与 readFile/writeFile/mkdir 同款）。

- [ ] **Step 2: 写失败测试**

```ts
describe('deletePermanently 留痕+附件卫生+台账轮次连带（spec 2026-11-12 §4.4/§5）', () => {
  const USER = { sub: 'u-1', username: '张三', role: 'staff' } as any;
  const FOUR_YEARS_AGO = new Date(Date.now() - 4 * 365 * 86400000);

  const makeReady = (prisma: Record<string, any>) => {
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01', status: 'RECYCLED', createdById: 'u-1',
      archiveExportedAt: null, recycledAt: FOUR_YEARS_AGO,
      title: '已终止的测试项目', projectCode: 'TP-2026-01',
      requesterName: '李四', requesterDepartment: '采购中心',
      procurementMethod: '公开招标', budgetAmount: 100000,
      companyId: 'co-1', companyName: '四川水发',
      terminatedAt: new Date('2026-10-01'), terminationReason: '需求取消',
      terminatedStage: '采购文件', terminatedProcurementRoundId: 'round-1',
      terminatedById: 'u-2',
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-1', displayName: '张三', username: 'zhang' },
      { id: 'u-2', displayName: '王五', username: 'wang' },
    ]);
    prisma.procurementRound.findUnique.mockResolvedValue({ id: 'round-1', roundNo: 2 });
    prisma.projectManagementStage.findMany.mockResolvedValue([{ id: 'st-1' }]);
    prisma.attachment.findMany.mockResolvedValue([{ objectKey: 'a/b.pdf' }, { objectKey: 'c/d.docx' }]);
  };

  it('写墓碑留痕：项目快照 + 终止人/操作人 displayName + 轮次号', async () => {
    const { service, prisma } = makeService();
    makeReady(prisma);
    await service.deletePermanently('pm-01', USER);

    expect(prisma.projectDeletionRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'pm-01',
        title: '已终止的测试项目',
        projectCode: 'TP-2026-01',
        procurementMethod: '公开招标',
        companyId: 'co-1',
        createdById: 'u-1',
        terminatedAt: new Date('2026-10-01'),
        terminationReason: '需求取消',
        terminatedByName: '王五',
        terminatedRoundNo: 2,
        recycledAt: FOUR_YEARS_AGO,
        deletedByName: '张三',
      }),
    });
  });

  it('附件行清理覆盖 PMI 直挂 + stage 挂 + 轮次挂三条归属', async () => {
    const { service, prisma } = makeService();
    makeReady(prisma);
    await service.deletePermanently('pm-01', USER);

    expect(prisma.attachment.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { projectManagementItemId: 'pm-01' },
          { projectManagementStageId: { in: ['st-1'] } },
          { procurementRoundId: 'round-1' },
        ],
      },
    });
  });

  it('连带删除台账轮次 + 删除 PMI 本体（裁定 #2）', async () => {
    const { service, prisma } = makeService();
    makeReady(prisma);
    await service.deletePermanently('pm-01', USER);

    expect(prisma.procurementRound.delete).toHaveBeenCalledWith({ where: { id: 'round-1' } });
    expect(prisma.projectManagementItem.delete).toHaveBeenCalledWith({ where: { id: 'pm-01' } });
  });

  it('磁盘文件事务后 best-effort 清理（unlink 容错）', async () => {
    const { service, prisma } = makeService();
    makeReady(prisma);
    const unlinkMock = unlink as unknown as jest.Mock;
    unlinkMock.mockReset().mockResolvedValue(undefined);
    await service.deletePermanently('pm-01', USER);

    expect(unlinkMock).toHaveBeenCalledTimes(2);
  });

  it('无轮次项目（建错直删）不触碰 procurementRound', async () => {
    const { service, prisma } = makeService();
    makeReady(prisma);
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      ...prisma.projectManagementItem.findUnique.mock.results[0].value,
      terminatedProcurementRoundId: null, terminatedById: null,
    });
    await service.deletePermanently('pm-01', USER);

    expect(prisma.procurementRound.delete).not.toHaveBeenCalled();
    expect(prisma.projectDeletionRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ terminatedRoundNo: null, terminatedByName: null }),
    });
  });
});
```

注意 spec 顶部 import 已含 `unlink`（`import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';`），无需改 import。

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter api test -- project-management.service.spec -- --testNamePattern="deletePermanently"
```
Expected: 全部 5 项 FAIL（现状无留痕/卫生/轮次逻辑）。

- [ ] **Step 4: 替换实现**

用下述代码整体替换 `deletePermanently`（service:6029-6077；前两道闸 ASIP/3 年保留期原文保留，注释不动）：

```ts
  async deletePermanently(projectId: string, user?: AuthenticatedUser) {
    const project = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: {
        id: true, status: true, createdById: true, archiveExportedAt: true, recycledAt: true,
        title: true, projectCode: true, requesterName: true, requesterDepartment: true,
        procurementMethod: true, budgetAmount: true, companyId: true, companyName: true,
        terminatedAt: true, terminationReason: true, terminatedStage: true,
        terminatedProcurementRoundId: true, terminatedById: true,
      },
    });

    if (!project) {
      throw new NotFoundException('未找到对应项目。');
    }

    // Creator-only (2026-10-10 读写分级：leader/admin 对他人项目只读)
    this.assertCanManageProject(user, project, '仅项目创建人可彻底删除该项目。');

    if (project.status !== PROJECT_MANAGEMENT_STATUS.RECYCLED) {
      throw new BadRequestException('请先将项目移入回收站后再彻底删除。');
    }

    // DA/T 103-2024 §8.5 保留策略（S1）
    // ① 已导出归档信息包（ASIP）的卷 = 已移交档案，平台侧禁止物理删除；
    //    如确需重做，先由 leader/admin 在归档管理页取消归档标记并清除导出记录。
    if (project.archiveExportedAt) {
      throw new ConflictException(
        `该项目已于 ${project.archiveExportedAt.toLocaleDateString('zh-CN')} 导出归档信息包（DA/T 103-2024 档案保留），禁止彻底删除。`,
      );
    }
    // ② 回收站起算不足 3 年：电子文件在原平台至少保留 3 年（即使未归档）
    // M1：以 recycledAt（移入回收站时写入）为准；updatedAt 会被任何字段更新刷新，不能作起算点。
    // 存量项目（字段上线前已回收）无 recycledAt → 从严拒绝并提示先恢复再回收以记录时间。
    const recycledAt = project.recycledAt ?? null;
    const THREE_YEARS_MS = 3 * 365 * 86400000;
    if (!recycledAt) {
      throw new ConflictException(
        '该项目的回收时间未被记录（存量数据）。请先恢复项目后重新移入回收站，以正确起算 3 年保留期。',
      );
    }
    const recycledSince = Date.now() - recycledAt.getTime();
    if (recycledSince < THREE_YEARS_MS) {
      const daysLeft = Math.ceil((THREE_YEARS_MS - recycledSince) / 86400000);
      throw new ConflictException(
        `依据 DA/T 103-2024 §8.5，电子文件在平台至少保留 3 年；该项目自 ${recycledAt.toLocaleDateString('zh-CN')} 回收，尚余 ${Math.floor(daysLeft / 30)} 个月，暂不能彻底删除。`,
      );
    }

    // ── 留痕 + 卫生清理（spec 2026-11-12 §4.4/§5，2026-11-12）──
    // 终止人/操作人 displayName 快照（2026-11-09 裁定：username 兜底）
    const snapshotUsers = await this.prisma.user.findMany({
      where: {
        id: { in: [user?.sub, project.terminatedById].filter((x): x is string => Boolean(x)) },
      },
      select: { id: true, displayName: true, username: true },
    });
    const nameOf = (uid?: string | null) => {
      const u = snapshotUsers.find((x) => x.id === uid);
      return u?.displayName || u?.username || null;
    };

    // 连带删除的台账轮次（裁定 #2：CANCELLED 轮次随项目删除，痕迹由墓碑承载）
    const round = project.terminatedProcurementRoundId
      ? await this.prisma.procurementRound.findUnique({
          where: { id: project.terminatedProcurementRoundId },
          select: { id: true, roundNo: true },
        })
      : null;

    // 附件三条归属：PMI 直挂 + stage 挂（stage 删除时 Attachment 行 SetNull 存活，须显式收）+ 轮次挂
    const stageIds = await this.prisma.projectManagementStage.findMany({
      where: { projectManagementItemId: projectId },
      select: { id: true },
    });
    const attachmentWhere = {
      OR: [
        { projectManagementItemId: projectId },
        ...(stageIds.length > 0 ? [{ projectManagementStageId: { in: stageIds.map((s) => s.id) } }] : []),
        ...(round ? [{ procurementRoundId: round.id }] : []),
      ],
    };
    const attachments = await this.prisma.attachment.findMany({
      where: attachmentWhere,
      select: { objectKey: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // 1. 墓碑留痕（永不可删——无删除端点）
      await tx.projectDeletionRecord.create({
        data: {
          projectId: project.id,
          title: project.title,
          projectCode: project.projectCode,
          requesterName: project.requesterName,
          requesterDepartment: project.requesterDepartment,
          procurementMethod: project.procurementMethod,
          budgetAmount: project.budgetAmount,
          companyId: project.companyId,
          companyName: project.companyName,
          createdById: project.createdById,
          terminatedAt: project.terminatedAt,
          terminationReason: project.terminationReason,
          terminatedStage: project.terminatedStage,
          terminatedByName: nameOf(project.terminatedById),
          terminatedRoundNo: round?.roundNo ?? null,
          recycledAt: project.recycledAt,
          deletedByName: nameOf(user?.sub) ?? user?.username ?? '未知',
        },
      });
      // 2. 附件行清理（AttachmentVersion 随 Attachment onDelete: Cascade）
      await tx.attachment.deleteMany({ where: attachmentWhere });
      // 3. 台账轮次连带删除（RoundSupplier 随 onDelete: Cascade）
      if (round) {
        await tx.procurementRound.delete({ where: { id: round.id } });
      }
      // 4. PMI 本体（stages/planItems/teamMembers 级联；BidProject SetNull 软摘挂——投标侧记录存活仅断链）
      await tx.projectManagementItem.delete({ where: { id: projectId } });
    });

    // 磁盘文件 best-effort（事务已提交；失败仅留孤儿文件，与 deleteAttachment 容错口径一致）
    for (const att of attachments) {
      try {
        await unlink(resolve(process.cwd(), 'uploads', att.objectKey));
      } catch {
        // 文件可能已不存在，继续
      }
    }

    return { success: true };
  }
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --filter api test -- project-management.service.spec
```
Expected: 全绿（含 Task 2/3 用例）。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "feat(projects): deletePermanently 扩为留痕+附件卫生+台账轮次连带删除——删除的是数据、留下的是记录

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: `GET /project-management/deletion-records` 读端点（TDD）

**Files:**
- Modify: `apps/api/src/project-management/project-management.controller.ts`（静态路由区加端点，`@Get('project-attributions')` 之前）
- Modify: `apps/api/src/project-management/project-management.service.ts`（`listDeletionRecords` 方法，放 `moveToRecycleBin` 之前）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: `companyScope.resolveScope/filter`（service 构造器已注入；makeService stub：`resolveScope→{all:false, companyIds:['co-test']}`、`filter→{companyId:{in:['co-test']}}`）；控制器类级 `@Roles('leader','admin','staff')`
- Produces: `GET /api/project-management/deletion-records?companyId=` → `ProjectDeletionRecord[]`（deletedAt 倒序、take 200、budgetAmount 序列化为 number）——Task 6 前端消费

- [ ] **Step 1: 写失败测试**

```ts
describe('listDeletionRecords 可见性与形状（spec 2026-11-12 §4.5）', () => {
  it('staff 仅本人留痕（对齐 list() 口径）', async () => {
    const { service, prisma } = makeService();
    prisma.projectDeletionRecord.findMany.mockResolvedValue([]);

    await service.listDeletionRecords({}, { sub: 'u-1', username: 's', role: 'staff' } as any);

    expect(prisma.projectDeletionRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdById: 'u-1' },
    }));
  });

  it('leader/admin 走 companyScope 公司过滤', async () => {
    const { service, prisma } = makeService();
    prisma.projectDeletionRecord.findMany.mockResolvedValue([]);

    await service.listDeletionRecords({}, { sub: 'u-1', username: 'l', role: 'leader' } as any);

    expect(prisma.projectDeletionRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: { in: ['co-test'] } },
    }));
  });

  it('deletedAt 倒序 + take 200 + Decimal 序列化为 number', async () => {
    const { service, prisma } = makeService();
    prisma.projectDeletionRecord.findMany.mockResolvedValue([
      { id: 'r-1', budgetAmount: null },
      { id: 'r-2', budgetAmount: { toNumber: () => 100 } as any },
    ]);

    const result = await service.listDeletionRecords({}, { sub: 'u-1', username: 's', role: 'staff' } as any);

    expect(prisma.projectDeletionRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { deletedAt: 'desc' },
      take: 200,
    }));
    expect(result[1].budgetAmount).toBe(100);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter api test -- project-management.service.spec -- --testNamePattern="listDeletionRecords"
```
Expected: 3 项 FAIL（方法不存在，TypeError）。

- [ ] **Step 3: 实现 service 方法**

在 `moveToRecycleBin` 方法之前插入：

```ts
  /** 删除留痕列表（spec 2026-11-12 §4.5）：可见性与 list() 同构——staff=本人留痕、
   *  leader=本公司、admin=全量+companyId 筛选；deletedAt 倒序最近 200 条（彻底删除有
   *  3 年保留期前置，表常年近空，200 上限+前端本地搜索足够）。 */
  async listDeletionRecords(query: { companyId?: string }, user?: AuthenticatedUser) {
    const where: Record<string, unknown> = {};
    if (user?.role === 'leader') {
      Object.assign(where, this.companyScope.filter(await this.companyScope.resolveScope(user)));
    } else if (user?.role === 'admin') {
      Object.assign(where, this.companyScope.filter(await this.companyScope.resolveScope(user, query.companyId)));
    } else {
      where.createdById = user?.sub ?? '__no_user__';
    }

    const records = await this.prisma.projectDeletionRecord.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      take: 200,
    });
    return records.map((r) => ({ ...r, budgetAmount: r.budgetAmount === null ? null : Number(r.budgetAmount) }));
  }
```

- [ ] **Step 4: 实现 controller 端点**

在 `@Get('project-attributions')`（controller:87）之前插入：

```ts
  // 删除留痕（spec 2026-11-12 §4.5）：静态路由须在 :id 子路径路由之前声明（本控制器无裸
  // @Get(':id')，此处前置属双保险）。继承类级 @Roles，无写端点——记录天然不可删。
  @Get('deletion-records')
  listDeletionRecords(
    @Query('companyId') companyId?: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.listDeletionRecords({ companyId }, user);
  }
```

确认 `Query` 已在 controller import（`@nestjs/common`）——若无需补。

- [ ] **Step 5: 跑测试确认通过 + 未覆盖路由检查**

```bash
pnpm --filter api test -- project-management && cd apps/api && npx tsx scripts/list-uncovered-routes.ts | grep -i "deletion-records" || echo "无未覆盖告警"
```
Expected: 单测全绿；脚本输出不含 deletion-records 行（继承类级 @Roles 即覆盖）。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/project-management/project-management.controller.ts apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "feat(projects): 删除留痕只读端点 GET /project-management/deletion-records——可见性同 list() 口径

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 前端类型 + API client

**Files:**
- Modify: `apps/web/src/lib/types/project-management.ts`（追加 interface）
- Modify: `apps/web/src/lib/api/project-management.ts`（追加 fetch 函数）

**Interfaces:**
- Produces: `ProjectDeletionRecord`（前端类型，字段与后端序列化一致）；`fetchDeletionRecords(companyId?: string): Promise<ProjectDeletionRecord[]>`——Task 7/8 消费

- [ ] **Step 1: types 追加**

在 `apps/web/src/lib/types/project-management.ts` 的 `ProjectManagementItemStatus` 类型附近追加：

```ts
/** 彻底删除留痕（墓碑）——spec 2026-11-12 §5。后端 deletedAt 倒序最近 200 条。 */
export interface ProjectDeletionRecord {
  id: string;
  projectId: string;
  title: string;
  projectCode?: string | null;
  requesterName: string;
  requesterDepartment: string;
  procurementMethod: string;
  budgetAmount?: number | null;
  companyId?: string | null;
  companyName?: string | null;
  terminatedAt?: string | null;
  terminationReason?: string | null;
  terminatedStage?: string | null;
  terminatedByName?: string | null;
  terminatedRoundNo?: number | null;
  recycledAt?: string | null;
  deletedAt: string;
  deletedByName: string;
}
```

- [ ] **Step 2: api client 追加**

在 `apps/web/src/lib/api/project-management.ts` 的 `deleteProjectPermanently` 函数之后追加：

```ts
/** 删除留痕列表（spec 2026-11-12 §4.5）：deletedAt 倒序最近 200 条，前端本地搜索 */
export async function fetchDeletionRecords(companyId?: string) {
  const params = new URLSearchParams();
  if (companyId && companyId !== 'all') params.set('companyId', companyId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await apiFetch(`${API_BASE}/project-management/deletion-records${query}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<ProjectDeletionRecord[]>(response);
}
```

文件顶部 import 处补 `ProjectDeletionRecord` 类型（与既有 `ProjectManagementItem` 同一行 import 或新增一行 type import）。

- [ ] **Step 3: 类型检查**

```bash
pnpm --filter web exec tsc -- --noEmit
```
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/types/project-management.ts apps/web/src/lib/api/project-management.ts
git commit -m "feat(projects): 前端 ProjectDeletionRecord 类型与 fetchDeletionRecords 客户端

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 前端新组件 `RecycledProjectCard` + `DeletionRecordList`

**Files:**
- Create: `apps/web/src/components/projects/recycled-project-card.tsx`
- Create: `apps/web/src/components/projects/deletion-record-list.tsx`

**Interfaces:**
- Consumes: `ProjectManagementItem`、`ProjectDeletionRecord`（Task 6）、`PMI_STAGE_LABEL`（@water-erp/shared）
- Produces:
  - `RecycledProjectCard({ item, submitting, canModify, onRestore, onDelete })`——「已移除」节简化卡
  - `restoreTargetLabel(item: Pick<ProjectManagementItem, 'terminatedAt' | 'archivedAt'>): string`——返回「已终止/已完成/进行中」，Task 8 复用
  - `DeletionRecordList({ records })`——「已彻底删除」节只读行；records 为空时返回 null（空态不渲染节标题）

- [ ] **Step 1: 写 RecycledProjectCard**

卡片结构移植自 `recycle-bin-drawer.tsx:96-178`（该文件 Task 8 删除，此处为形态承接），恢复按钮文案带恢复目标：

```tsx
"use client";

import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { PMI_STAGE_LABEL } from '@water-erp/shared';

/** 恢复目标态——与后端 restoreFromRecycleBin 三向按戳推断同口径（spec 2026-11-12 §4.3） */
export function restoreTargetLabel(item: Pick<ProjectManagementItem, 'terminatedAt' | 'archivedAt'>) {
  if (item.terminatedAt) return '已终止';
  if (item.archivedAt) return '已完成';
  return '进行中';
}

export function RecycledProjectCard({
  item,
  submitting,
  canModify,
  onRestore,
  onDelete,
}: {
  item: ProjectManagementItem;
  submitting: boolean;
  canModify: boolean;
  onRestore: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}) {
  return (
    <article className="neu-card-static !rounded-[20px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[1.02rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
            {item.title}
          </div>
          <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            {item.requesterDepartment} · {item.requesterName}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-3 py-1 text-[11px] font-semibold text-[color:var(--warning)]">
          已移除
        </span>
      </div>

      <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
            采购方式
          </div>
          <div className="mt-1 text-sm text-[color:var(--foreground)]">
            {item.procurementMethod || '待补充'}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
            当前阶段
          </div>
          <div className="mt-1 text-sm text-[color:var(--foreground)]">
            {(item.currentRound ?? 1) > 1 ? `第 ${item.currentRound} 轮 · ` : ''}
            {PMI_STAGE_LABEL[item.currentStage] ?? item.currentStage}
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
            移除时间
          </div>
          <div className="mt-1 text-sm tabular-nums text-[color:var(--foreground)]">
            {item.recycledAt
              ? new Date(item.recycledAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
              : '未记录（存量数据，恢复后重新移除可记录）'}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {canModify ? (
          <>
            <button
              type="button"
              onClick={() => onRestore(item.id)}
              disabled={submitting}
              className="neu-btn-soft"
            >
              <RotateCcw size={16} />
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? '处理中...' : `恢复 · 回到${restoreTargetLabel(item)}`}
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              disabled={submitting}
              className="neu-btn-soft is-danger"
            >
              <Trash2 size={16} />
              {submitting ? '处理中...' : '彻底删除'}
            </button>
          </>
        ) : (
          <span className="inline-flex items-center text-xs text-[color:var(--muted-foreground)]">
            仅创建者可操作
          </span>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: 写 DeletionRecordList**

```tsx
"use client";

import { FileX2 } from 'lucide-react';
import type { ProjectDeletionRecord } from '@/lib/types/project-management';

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '—';
}

/** 「已彻底删除」节（spec 2026-11-12 §3.2-3）：紧凑只读行，无任何操作按钮；空列表不渲染（空态隐藏节标题） */
export function DeletionRecordList({ records }: { records: ProjectDeletionRecord[] }) {
  if (records.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <FileX2 size={14} className="text-[color:var(--muted-foreground)]" />
        <h3 className="text-[13px] font-bold tracking-[0.02em] text-[color:var(--foreground)]">
          已彻底删除
        </h3>
        <span className="neu-segment-count">{records.length}</span>
        <span className="text-xs text-[color:var(--muted-foreground)]">数据已清，记录永存</span>
      </div>
      <div className="wb-panel divide-y divide-[oklch(0.6_0.04_258/0.12)] overflow-hidden">
        {records.map((r) => (
          <div key={r.id} className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
                {r.title}
                {r.projectCode ? (
                  <span className="ml-2 font-mono text-[10px] font-bold text-[color:var(--accent-strong)]">{r.projectCode}</span>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                {r.requesterDepartment} · {r.requesterName} · {r.procurementMethod}
                {r.terminatedAt ? ` · 曾于 ${fmtDate(r.terminatedAt)} 终止` : ''}
                {r.terminatedRoundNo ? `（台账轮次 #${r.terminatedRoundNo} 已随删）` : ''}
              </div>
            </div>
            <div className="text-xs tabular-nums text-[color:var(--muted-foreground)]">
              <div>移入回收：{fmtDate(r.recycledAt)}</div>
              <div>彻底删除：{fmtDate(r.deletedAt)}</div>
            </div>
            <div className="text-xs text-[color:var(--muted-foreground)] sm:text-right">
              操作人：{r.deletedByName}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: 类型检查**

```bash
pnpm --filter web exec tsc -- --noEmit
```
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/projects/recycled-project-card.tsx apps/web/src/components/projects/deletion-record-list.tsx
git commit -m "feat(projects): 已移除区新组件——RecycledProjectCard（恢复带目标态文案）与 DeletionRecordList（删除留痕只读行）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 页面改造——「已移出」tab 三节 + 退役回收站抽屉

**Files:**
- Modify: `apps/web/src/components/projects/project-management-page.tsx`（本任务多处编辑，逐块替换）
- Delete: `apps/web/src/components/projects/recycle-bin-drawer.tsx`

**Interfaces:**
- Consumes: `RecycledProjectCard`/`restoreTargetLabel`/`DeletionRecordList`（Task 7）、`fetchDeletionRecords`/`ProjectDeletionRecord`（Task 6）、既有 `moveProjectToRecycleBin`（详情面板+清理按钮共用）、`LoginErrorDialog`（原抽屉内错误弹窗迁至页面）
- Produces: 页面新结构——tab `进行中|已完成|已移出`；「已移出」三节（已终止/已移除/已彻底删除）；顶栏回收站按钮移除

本任务无组件单测基建，验证 = tsc + lint + 手测要点清单（Step 10）。

- [ ] **Step 1: 改 imports**

文件头 import 区：

- lucide-react 改为：`import { AlertCircle, AlertTriangle, CheckCircle2, ClipboardCopy, FolderOpen, Loader2, Plus, Recycle, Search, Trash2, X } from 'lucide-react';`（删 `Ban`——已终止 tab 图标随 tab 改名废弃）
- 删 `import { RecycleBinDrawer } from './recycle-bin-drawer';`
- 加 `import { RecycledProjectCard, restoreTargetLabel } from './recycled-project-card';`
- 加 `import { DeletionRecordList } from './deletion-record-list';`
- 加 `import { LoginErrorDialog } from '@/components/login/login-error-dialog';`
- api import 块加 `fetchDeletionRecords`；types import 加 `ProjectDeletionRecord`

- [ ] **Step 2: 改 state**

```ts
  const [activeTab, setActiveTab] = useState<'active' | 'archived' | 'removed'>('active');
```

- 删 `const [showRecycleBin, setShowRecycleBin] = useState(false);`
- `drawerErrorMessage` 全文件改名 `removedErrorMessage`（含 setter 与三处 handler 中的引用）
- 新增：

```ts
  const [deletionRecords, setDeletionRecords] = useState<ProjectDeletionRecord[]>([]);
  // 「已终止」卡清理确认弹窗目标（弹窗规范 A 版瓷面壳）
  const [cleanupTarget, setCleanupTarget] = useState<ProjectManagementItem | null>(null);
  // 「已移除」节一键删除确认弹窗（自退役抽屉迁入）
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
```

- [ ] **Step 3: loadItems 并入留痕拉取**

`Promise.all` 五路（追加第 5 项后同步 setDeletionRecords）：

```ts
      const [activeItems, archived, terminated, recycled, records] = await Promise.all([
        fetchProjectManagementList('ACTIVE', companyId),
        fetchProjectManagementList('ARCHIVED', companyId),
        fetchProjectManagementList('TERMINATED', companyId),
        fetchProjectManagementList('RECYCLED', companyId),
        fetchDeletionRecords(companyId),
      ]);
      setItems(activeItems);
      setArchivedItems(archived);
      setTerminatedItems(terminated);
      setRecycledItems(recycled);
      setDeletionRecords(records);
```

- [ ] **Step 4: 筛选管线抽 applyFilters（三节各用）**

把现有 `filteredItems` useMemo 的函数体抽为组件内普通函数（紧邻 sourceItems 定义之后）：

```ts
  // 筛选管线抽参（2026-11-12 已移出区）：已终止/已移除两节各自过同一管线（spec §3.2 共用搜索/排序/筛选）
  const applyFilters = (source: ProjectManagementItem[]) => {
    let result = [...source];
    const normalized = keyword.trim().toLowerCase();
    if (normalized) {
      result = result.filter((item) =>
        [item.title, item.requesterName, item.requesterDepartment, item.projectCode ?? '', item.contractNumber ?? '']
          .join(' ')
          .toLowerCase()
          .includes(normalized),
      );
    }
    if (filterValue) {
      if (filterType === 'method') result = result.filter(i => i.procurementMethod === filterValue);
      else if (filterType === 'department') result = result.filter(i => i.requesterDepartment === filterValue);
      else if (filterType === 'operator') result = result.filter(i => i.createdByName === filterValue);
    }
    result.sort((a, b) => {
      switch (sortBy) {
        case 'budgetAmount':
          return (b.budgetAmount ?? 0) - (a.budgetAmount ?? 0);
        case 'title':
          return (a.title ?? '').localeCompare(b.title ?? '', 'zh-CN');
        case 'createdAt':
          return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
        case 'updatedAt':
        default:
          return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
      }
    });
    return result;
  };
```

`sourceItems` 行改为（removed 时合并两源供筛选下拉取值）：

```ts
  const sourceItems = activeTab === 'archived' ? archivedItems
    : activeTab === 'removed' ? [...terminatedItems, ...recycledItems]
    : items;
```

原 `filteredItems` useMemo 替换为三节派生：

```ts
  const filteredItems = useMemo(() => applyFilters(sourceItems), [sourceItems, keyword, sortBy, filterType, filterValue]);
  // 「已移出」两节（卡片管线）+ 留痕节（仅关键词，deletedAt 倒序由后端定）
  const filteredTerminated = useMemo(
    () => (activeTab === 'removed' ? applyFilters(terminatedItems) : []),
    [activeTab, terminatedItems, keyword, sortBy, filterType, filterValue],
  );
  const filteredRecycled = useMemo(
    () => (activeTab === 'removed' ? applyFilters(recycledItems) : []),
    [activeTab, recycledItems, keyword, sortBy, filterType, filterValue],
  );
  const filteredRecords = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return deletionRecords;
    return deletionRecords.filter((r) =>
      [r.title, r.requesterName, r.requesterDepartment, r.projectCode ?? ''].join(' ').toLowerCase().includes(normalized),
    );
  }, [deletionRecords, keyword]);
```

（`applyFilters` 未 memo 化但有 useMemo 包裹调用点，渲染语义不变；eslint exhaustive-deps 若报 applyFilters 缺依赖，在三个 useMemo 上方加一行 `// eslint-disable-next-line react-hooks/exhaustive-deps` 与文件内既有惯例一致。）

- [ ] **Step 5: 顶栏删回收站按钮**

删除 `page-hero__right` 内的整块回收站按钮 JSX（`onClick={() => setShowRecycleBin(true)}` 的 `neu-btn-soft is-danger` 按钮，含角标 span），保留 CompanySelect 与新建项目按钮。

- [ ] **Step 6: tab 段改「已移出」**

`neu-segment` 内第三个按钮整体替换：

```tsx
                  <button
                    type="button"
                    onClick={() => setActiveTab('removed')}
                    className="neu-segment-btn"
                    aria-pressed={activeTab === 'removed'}
                  >
                    <Recycle size={13} className="inline mr-1" />
                    已移出
                    {(terminatedItems.length + recycledItems.length) > 0 && (
                      <span className="neu-segment-count">{terminatedItems.length + recycledItems.length}</span>
                    )}
                  </button>
```

（`data-count="3"` 不变；`data-index` 三元分支 `activeTab === 'terminated'` 改为 `activeTab === 'removed'`。）

- [ ] **Step 7: 列表渲染改三节**

把现有 `{companyViewAll ? (...) : (...)}` 卡片渲染整体包进条件：`activeTab !== 'removed'` 时走原有两个分支（不变，但内部两处 `variant={activeTab === 'terminated' ? 'terminated' : ...}` 简化为 `variant={activeTab === 'archived' ? 'archived' : 'active'}`）；新增 `activeTab === 'removed'` 分支：

```tsx
          ) : activeTab === 'removed' ? (
            <div className="space-y-6">
              {/* 已终止节：ProjectCard 只读 + 创建人弱清理按钮（裁定 #2：终态可清理） */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-bold tracking-[0.02em] text-[color:var(--foreground)]">已终止</h3>
                  <span className="neu-segment-count">{filteredTerminated.length}</span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">业务结局留痕，只读</span>
                </div>
                {filteredTerminated.length === 0 ? (
                  <div className="wb-panel p-4 text-sm text-[color:var(--muted-foreground)]">暂无已终止项目</div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {filteredTerminated.map((item) => (
                      <div key={item.id} className="space-y-2">
                        <ProjectCard
                          item={item}
                          variant="terminated"
                          onOpen={() => {
                            setSelectedItemId(item.id);
                            setPageContext({
                              selectedItemId: item.id,
                              selectedItemType: 'project',
                              selectedItemData: {
                                title: item.title,
                                currentStage: item.currentStage,
                                status: item.status,
                                requesterDepartment: item.requesterDepartment,
                              },
                            });
                          }}
                        />
                        {canModifyProject(item) && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => setCleanupTarget(item)}
                              className="neu-btn-soft is-danger !h-8 !text-xs"
                            >
                              <Trash2 size={14} />移除清理
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 已移除节：简化卡 + 恢复/彻底删除（自退役抽屉迁入） */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-bold tracking-[0.02em] text-[color:var(--foreground)]">已移除</h3>
                    <span className="neu-segment-count">{filteredRecycled.length}</span>
                    <span className="text-xs text-[color:var(--muted-foreground)]">可恢复，彻底删除受 3 年保留期约束</span>
                  </div>
                  {filteredRecycled.length > 0 && filteredRecycled.every((i) => canModifyProject(i)) ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteAllConfirm(true)}
                      disabled={Boolean(recycleActionId)}
                      className="neu-btn-soft is-danger !h-8 !text-xs"
                    >
                      <Trash2 size={14} />
                      {recycleActionId === '__all__' ? '删除中...' : '一键删除'}
                    </button>
                  ) : null}
                </div>
                {filteredRecycled.length === 0 ? (
                  <div className="wb-panel p-4 text-sm text-[color:var(--muted-foreground)]">暂无已移除项目</div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filteredRecycled.map((item) => (
                      <RecycledProjectCard
                        key={item.id}
                        item={item}
                        submitting={recycleActionId === item.id}
                        canModify={canModifyProject(item)}
                        onRestore={(id) => void handleRestore(id)}
                        onDelete={(id) => void handleDeletePermanently(id)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* 已彻底删除节：留痕只读行（空态不渲染） */}
              <DeletionRecordList records={filteredRecords} />
            </div>
          ) : companyViewAll ? (
```

- [ ] **Step 8: 错误弹窗 + 两个确认弹窗（迁入/新建）**

文件尾部：删除整个 `<RecycleBinDrawer ... />` JSX 块（原 544-558），替换为：

```tsx
      {/* 已移除区操作错误弹窗（自退役抽屉迁入） */}
      <LoginErrorDialog
        title="操作失败"
        isOpen={Boolean(removedErrorMessage)}
        message={removedErrorMessage ?? ''}
        onClose={() => setRemovedErrorMessage(null)}
      />

      {/* 已终止卡「移除清理」确认（弹窗规范 A 版） */}
      {cleanupTarget ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md"
            onClick={() => {
              if (!recycleActionId) setCleanupTarget(null);
            }}
          />
          <div className="relative w-full max-w-[460px] overflow-hidden wb-modal-shell">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,rgba(209,88,88,0.95),rgba(234,191,106,0.72),rgba(121,162,239,0.35))]" />
            <div className="px-6 py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[18px] border border-[color-mix(in_oklch,var(--danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--danger)_11%,transparent)] text-[color:var(--danger)]">
                  <AlertTriangle size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--danger)]">
                    移除清理
                  </div>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-[1.28rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">
                    将「{cleanupTarget.title}」移入已移除？
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    项目进入已移除区，可恢复{cleanupTarget.terminatedAt ? `（回到已终止）` : ''}；彻底删除须满 3 年保留期，届时将留下不可删除的留痕记录。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCleanupTarget(null)}
                  disabled={Boolean(recycleActionId)}
                  className="neu-btn-xs"
                  aria-label="取消移除清理"
                >
                  <X size={17} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
              <button type="button" onClick={() => setCleanupTarget(null)} disabled={Boolean(recycleActionId)} className="neu-btn-soft">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = cleanupTarget;
                  setCleanupTarget(null);
                  if (target) void handleMoveToRecycleBin(target.id);
                }}
                disabled={Boolean(recycleActionId)}
                className="neu-btn-primary is-danger"
              >
                <Trash2 size={16} />
                确认移除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 已移除节「一键删除」确认（自退役抽屉迁入，items 源改 filteredRecycled） */}
      {showDeleteAllConfirm ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md"
            onClick={() => {
              if (!recycleActionId) setShowDeleteAllConfirm(false);
            }}
          />
          <div className="relative w-full max-w-[460px] overflow-hidden wb-modal-shell">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,rgba(209,88,88,0.95),rgba(234,191,106,0.72),rgba(121,162,239,0.35))]" />
            <div className="px-6 py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[18px] border border-[color-mix(in_oklch,var(--danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--danger)_11%,transparent)] text-[color:var(--danger)]">
                  <AlertTriangle size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--danger)]">
                    不可恢复操作
                  </div>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-[1.28rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">
                    清空已移除区？
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    将彻底删除已移除区中的 <span className="font-semibold text-[color:var(--danger)]">{filteredRecycled.length}</span> 个项目（须均满 3 年保留期）。删除后无法恢复，将留下留痕记录。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeleteAllConfirm(false)}
                  disabled={Boolean(recycleActionId)}
                  className="neu-btn-xs"
                  aria-label="取消一键删除"
                >
                  <X size={17} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
              <button type="button" onClick={() => setShowDeleteAllConfirm(false)} disabled={Boolean(recycleActionId)} className="neu-btn-soft">
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAllPermanently().then(() => setShowDeleteAllConfirm(false))}
                disabled={Boolean(recycleActionId)}
                className="neu-btn-primary is-danger"
              >
                {recycleActionId === '__all__' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {recycleActionId === '__all__' ? '正在删除' : '确认一键删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
```

同时：`handleDeleteAllPermanently` 内 `recycledItems` 改 `filteredRecycled.length === 0 ? recycledItems : filteredRecycled`？——**不改**，保持全量语义（一键删除针对回收站全部，与后端闸门一致）；仅其错误信息引用沿用改名后的 `removedErrorMessage`。

- [ ] **Step 9: 删除退役文件 + 清引用检查**

```bash
git rm apps/web/src/components/projects/recycle-bin-drawer.tsx
grep -rn "recycle-bin-drawer\|RecycleBinDrawer\|showRecycleBin\|drawerErrorMessage" apps/web/src --include="*.ts" --include="*.tsx"
```
Expected: grep 零命中（若命中，逐处清干净）。

- [ ] **Step 10: 类型检查 + lint**

```bash
pnpm --filter web exec tsc -- --noEmit && pnpm --filter web lint
```
Expected: 双绿。

- [ ] **Step 11: 手测要点（dev 环境 :3005 + :4001 已跑起时）**

用创建人账号（如 `Swhi-CGZX-05`）核对：①tab 三段与计数=已终止+已移除；②已终止卡片清理按钮→确认弹窗→入已移除节；③已移除卡片「恢复 · 回到已终止」→ 回已终止节且详情只读；④建错项目（ACTIVE）详情面板移至回收站 → 已移除节「恢复 · 回到进行中」；⑤已彻底删除节空态不渲染；⑥顶栏无回收站按钮、`/projects` 页无 500。无法起环境时改由用户验收确认。

- [ ] **Step 12: 提交**

```bash
git add apps/web/src/components/projects/project-management-page.tsx
git rm --cached apps/web/src/components/projects/recycle-bin-drawer.tsx 2>/dev/null; git add apps/web/src/components/projects/recycle-bin-drawer.tsx 2>/dev/null; true
git commit -m "feat(projects): 项目管理页「已移出」tab 三节落地——已终止/已移除/已彻底删除，回收站抽屉退役

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（Step 9 的 `git rm` 已暂存删除；此处 add 页面文件后直接 commit。）

---

### Task 9: 已终止详情横幅文案 + 全量验证收口

**Files:**
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx:1282`（只读横幅副文案）

**Interfaces:** 无新接口——纯文案 + 验证收口。

- [ ] **Step 1: 改横幅文案**

`project-detail-panel.tsx:1282` 的

```tsx
<span className="ml-auto text-[color:var(--muted-foreground)]">终止不可恢复，仅供查阅；如需继续采购请重新建立项目</span>
```

改为：

```tsx
<span className="ml-auto text-[color:var(--muted-foreground)]">终止不可恢复，仅供查阅；如需清理记录，可在项目列表·已移出区操作；如需继续采购请重新建立项目</span>
```

- [ ] **Step 2: 全量验证**

```bash
pnpm --filter api test -- project-management \
  && pnpm --filter web exec tsc -- --noEmit \
  && pnpm --filter web lint \
  && cd apps/api && npx tsc --noEmit
```
Expected: 四项全绿（api 单测、web 类型、web lint、api 类型）。

- [ ] **Step 3: 冒烟（可选但推荐）**

dev 链已跑时：`curl -s localhost:4001/api/project-management/deletion-records -H "X-Portal: web" -b <token_web cookie>` → 200 `[]`（须真实登录态；无登录态返 401 属正常——证明路由挂载且被守卫覆盖）。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/projects/project-detail-panel.tsx
git commit -m "feat(projects): 已终止详情只读横幅补「已移出区清理」指引文案——全计划收口

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 计划自审记录

- **Spec 覆盖**：§3.1（Task 8 Step 5/6）、§3.2-1 已终止组（8-S7）、§3.2-2 已移除组（7-S1+8-S7）、§3.2-3 已彻底删除组（7-S2）、§3.3 入口不变+横幅（9）、§4.2 闸（2）、§4.3 恢复（3）、§4.4 删除（4）、§4.5 端点（5）、§5 模型（1）、§7 测试（2/3/4/5 单测；e2e 项以模块 co-located 单测覆盖——PMI 模块无既有 e2e 文件，新建独立 e2e 套件不成比例，偏离已在执行时向用户说明）、§8 边界（枚举零改动贯穿）。规划期 spec 修订两处（createdById、撤分页改 take 200）已回写 spec 文件。
- **占位符扫描**：无 TBD/「稍后实现」；所有代码块完整可落地。
- **类型一致性**：`restoreTargetLabel` 前后端同口径（terminatedAt/archivedAt 双字段名一致）；`ProjectDeletionRecord` 字段与 schema/序列化一一对应；`filteredTerminated/filteredRecycled/filteredRecords` 定义（8-S4）与消费（8-S7/8-S8）一致；`removedErrorMessage` 改名覆盖全部引用（8-S2 定义 + S8 检查）。
