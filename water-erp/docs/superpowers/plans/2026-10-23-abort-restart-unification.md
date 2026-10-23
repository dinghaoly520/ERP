# 流标收尾与重启采购统一流 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三类流标（开标前/开标后/评标中）统一收口 :3005——流标公告先行 → 决策向导（是否继续 → 基本信息与采购方式确认 → 重启起点三选）→ 重构轮次阶段（删旧轮尾部、按新方式插新轮、旧轮全锁）或终止。

**Architecture:** 后端原地改造 `POST /project-management/:id/reproc`（带起点/方式/基本信息入参，单事务删尾+插轮）；`bid-project-refs` 加流标公告闸字段；公告发布联动对终态项目跳过。前端新增三步决策向导 `AbortRestartDialog`，流标公告向导发布后不再自动 reproc 改为拉起决策向导，流标提示条加常驻入口，`stageLocked` 加轮次锁。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、Next.js 16 + React 19 + Tailwind v4（apps/web）、Jest 单测（仅 api 有单测框架；web 验证 = lint + tsc + 手动核对）。

**Spec:** `docs/superpowers/specs/2026-10-23-abort-restart-unification-design.md`

## Global Constraints

- 采购方式全集 = `PROCUREMENT_METHODS` 五种（谈判采购/竞价采购/直接采购/邀请招标/询比采购），与新建项目一致；「公开招标」仅投标侧旧清单，不属 PMI 可选集。
- 重启起点仅三个合法值：`PROCUREMENT_DEMAND` / `INITIATION` / `TENDER_DOCUMENT`。
- 第二轮 = （新）方式完整模板 `METHOD_STAGE_TEMPLATES`（api）/`PROCUREMENT_METHOD_STAGES`（web）从起点截取到模板末尾（含定标/合同/备案表）；第一轮尾部（AWARD_DECISION/CONTRACT/DIRECT_PURCHASE_FILING）物理删除。
- API 改动验证链：`pnpm --filter api lint` + `npx tsc --noEmit`（apps/api 下）+ `pnpm --filter api test` 全绿才可提交。
- 并行会话约定：**禁用 `git add -A`/`git add .`**，只 add 各任务 Files 清单内路径；每任务一提交。
- 前端遵循 cgzxui 设计体系（`neu-btn-soft`/`neu-btn-primary`/`workbench-input`/`Modal` from `@/components/workbench`），无 mock 数据回退。
- web 门户无单测框架——前端任务的验证 = `pnpm --filter web lint` + `npx tsc --noEmit`（apps/web 下）+ 任务内手动核对步骤。
- 所有用户可见文案为中文。

---

### Task 1: API — reproc 带参改造（DTO + 控制器 + 服务重写）+ 单测

**Files:**
- Create: `apps/api/src/project-management/dto/reproc.dto.ts`
- Modify: `apps/api/src/project-management/project-management.controller.ts:260-262`
- Modify: `apps/api/src/project-management/project-management.service.ts:633-740`（reproc 方法整体重写）+ `:204-235`（删 REPROC_STAGE_SEGMENTS）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（追加 describe；makeService 的 prisma mock 补 `projectManagementStage.deleteMany`）

**Interfaces:**
- Consumes: 服务内既有 `METHOD_STAGE_TEMPLATES`（:148）、`stageCodeFor`、`PROJECT_STAGE_STATUS`/`PROJECT_MANAGEMENT_STATUS`、`parseInitiationDateInput`。
- Produces: `POST /project-management/:id/reproc`，body `ReprocDto`，响应 `{ round: number; inserted: number; activated?: boolean }`。Task 4 的 `reprocProject(projectId, body)` 消费本接口。

- [ ] **Step 1: 写失败测试**

在 `project-management.service.spec.ts` 末尾追加（`makeService` 定义在同文件 ：405 上下，返回 `{ service, prisma, ... }`；先在 makeService 的 `projectManagementStage` mock 对象里补一行 `deleteMany: jest.fn(),`）：

```ts
describe('reproc 流标重启（2026-10-23 统一流 spec）', () => {
  const mkStage = (id: string, key: string, name: string, order: number, status: string) => ({
    id, stageKey: key, stageName: name, stageOrder: order, round: 1,
    status, completedAt: status === 'COMPLETED' ? new Date('2026-10-01') : null, note: null,
  });
  const STAGES_R1 = [
    mkStage('st-demand', 'PROCUREMENT_DEMAND', '采购需求', 1, 'COMPLETED'),
    mkStage('st-init', 'INITIATION', '采购立项', 2, 'COMPLETED'),
    mkStage('st-doc', 'TENDER_DOCUMENT', '采购文件', 3, 'COMPLETED'),
    mkStage('st-ann', 'PUBLIC_ANNOUNCEMENT', '采购公告公示', 4, 'COMPLETED'),
    mkStage('st-expert', 'EXPERT_SELECTION', '专家选取', 5, 'COMPLETED'),
    mkStage('st-bid', 'BID_EVALUATION', '开标评标', 6, 'IN_PROGRESS'),
    mkStage('st-award', 'AWARD_DECISION', '定标', 7, 'NOT_STARTED'),
    mkStage('st-contract', 'CONTRACT', '合同', 8, 'NOT_STARTED'),
  ];
  const ITEM_BASE = {
    id: 'pm-1', projectCode: 'SWHI-TP-2026102301', procurementMethod: '询比采购',
    currentRound: 1, status: 'ACTIVE',
    requesterName: '魏雪', requesterDepartment: '人力资源部', title: '2026年教育培训服务',
    procurementCategory: '其他', budgetAmount: 484000, projectReason: '续约',
    supplierRequirements: '有培训资质', initiationDate: new Date('2026-03-04T00:00:00'),
    procurementOrganizationForm: '自行招标', isAnnualBudget: true,
  };
  const BP_ABORTED = { stage: 'ABORTED', riskNote: '流标（询比采购，投标供应商 1 家）' };

  it('起点=采购文件、方式不变：删当前轮尾部、按模板截取插第 2 轮、指针指起点', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ ...ITEM_BASE, stages: STAGES_R1 });
    prisma.bidProject.findFirst.mockResolvedValue(BP_ABORTED);

    const res = await service.reproc('pm-1', { startStageKey: 'TENDER_DOCUMENT' });

    expect(res).toEqual({ round: 2, inserted: 6 }); // 询比模板 TENDER_DOCUMENT→CONTRACT 共 6 段
    expect(prisma.projectManagementStage.updateMany).toHaveBeenCalledWith({
      where: { projectManagementItemId: 'pm-1', round: 1, stageKey: 'BID_EVALUATION' },
      data: { status: 'COMPLETED', note: '已流标（重新采购）' },
    });
    expect(prisma.projectManagementStage.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['st-award', 'st-contract'] } },
    });
    const created = prisma.projectManagementStage.createMany.mock.calls[0][0].data;
    expect(created.map((s: any) => s.stageKey)).toEqual([
      'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT',
    ]);
    expect(created[0].status).toBe('IN_PROGRESS');
    expect(created.slice(1).every((s: any) => s.status === 'NOT_STARTED')).toBe(true);
    expect(created.every((s: any) => s.round === 2)).toBe(true);
    expect(created[0].stageOrder).toBe(7); // 删尾后接剩余末尾
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-1' },
      data: expect.objectContaining({ currentStage: 'TENDER_DOCUMENT', currentRound: 2 }),
    });
    expect(prisma.projectManagementItem.update.mock.calls[0][0].data.procurementMethod).toBeUndefined();
  });

  it('方式变更（询比→谈判）+ 起点=采购需求：新轮按谈判模板全段、PMI 方式更新', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ ...ITEM_BASE, stages: STAGES_R1 });
    prisma.bidProject.findFirst.mockResolvedValue(BP_ABORTED);

    await service.reproc('pm-1', { startStageKey: 'PROCUREMENT_DEMAND', procurementMethod: '谈判采购' });

    const created = prisma.projectManagementStage.createMany.mock.calls[0][0].data;
    expect(created.map((s: any) => s.stageKey)).toEqual([
      'PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'SUPPLIER_INVITATION', 'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT',
    ]);
    expect(prisma.projectManagementItem.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ procurementMethod: '谈判采购', currentStage: 'PROCUREMENT_DEMAND', currentRound: 2 }),
    );
  });

  it('basicInfo 仅落差异字段', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ ...ITEM_BASE, stages: STAGES_R1 });
    prisma.bidProject.findFirst.mockResolvedValue(BP_ABORTED);

    await service.reproc('pm-1', {
      startStageKey: 'TENDER_DOCUMENT',
      basicInfo: { supplierRequirements: '具备一级资质且近三年无失信记录', title: ITEM_BASE.title } as any,
    });

    const data = prisma.projectManagementItem.update.mock.calls[0][0].data;
    expect(data.supplierRequirements).toBe('具备一级资质且近三年无失信记录');
    expect(data).not.toHaveProperty('title');
    expect(data).not.toHaveProperty('requesterName');
  });

  it('当前轮尾部阶段挂有附件 → 409 TAIL_HAS_ATTACHMENTS 且零写入', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ ...ITEM_BASE, stages: STAGES_R1 });
    prisma.bidProject.findFirst.mockResolvedValue(BP_ABORTED);
    prisma.projectManagementStage.findMany.mockResolvedValue([
      { stageName: '定标', attachments: [{ id: 'a1' }] },
    ]);

    await expect(service.reproc('pm-1', { startStageKey: 'TENDER_DOCUMENT' }))
      .rejects.toMatchObject({ status: 409, response: { code: 'TAIL_HAS_ATTACHMENTS' } });
    expect(prisma.projectManagementStage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.projectManagementStage.createMany).not.toHaveBeenCalled();
  });

  it('当前轮 BidProject 未流标 → 409 BID_NOT_ABORTED', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ ...ITEM_BASE, stages: STAGES_R1 });
    prisma.bidProject.findFirst.mockResolvedValue({ stage: 'EVALUATING', riskNote: null });

    await expect(service.reproc('pm-1', { startStageKey: 'TENDER_DOCUMENT' }))
      .rejects.toMatchObject({ status: 409, response: { code: 'BID_NOT_ABORTED' } });
  });

  it('开标归档流标（ARCHIVED + riskNote 流标前缀）放行重启', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ ...ITEM_BASE, stages: STAGES_R1 });
    prisma.bidProject.findFirst.mockResolvedValue({ stage: 'ARCHIVED', riskNote: '流标（询比采购…' });

    const res = await service.reproc('pm-1', { startStageKey: 'TENDER_DOCUMENT' });
    expect(res.round).toBe(2);
  });

  it('最新轮未推进 → 400 REPROC_ALREADY_PENDING（幂等闸保留）', async () => {
    const { service, prisma } = makeService();
    const stages = [
      ...STAGES_R1.map((s) => ({ ...s, status: 'COMPLETED', completedAt: new Date('2026-10-01'), round: 1 })),
      { ...mkStage('r2-doc', 'TENDER_DOCUMENT', '采购文件', 9, 'IN_PROGRESS'), round: 2, completedAt: null },
      { ...mkStage('r2-ann', 'PUBLIC_ANNOUNCEMENT', '采购公告公示', 10, 'NOT_STARTED'), round: 2 },
    ];
    prisma.projectManagementItem.findUnique.mockResolvedValue({ ...ITEM_BASE, currentRound: 2, stages });
    prisma.bidProject.findFirst.mockResolvedValue(BP_ABORTED);

    await expect(service.reproc('pm-1', { startStageKey: 'TENDER_DOCUMENT' }))
      .rejects.toMatchObject({ status: 400, response: { code: 'REPROC_ALREADY_PENDING' } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/project-management/project-management.service.spec.ts -t "reproc 流标重启"
```

预期：FAIL（reproc 仍是旧签名 `reproc(id)`，`service.reproc('pm-1', {...})` 报参数错或断言不匹配）。

- [ ] **Step 3: 写 DTO**

`apps/api/src/project-management/dto/reproc.dto.ts`：

```ts
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** 流标后再次采购·基本信息差异更新（spec 2026-10-23-abort-restart-unification §4.1）——仅传有变化字段，键名对齐 PMI 列名 */
export class ReprocBasicInfoDto {
  @IsOptional() @IsString() @MaxLength(100) requesterName?: string;
  @IsOptional() @IsString() @MaxLength(100) requesterDepartment?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(50) procurementCategory?: string;
  @IsOptional() @IsNumber() budgetAmount?: number;
  @IsOptional() @IsString() @MaxLength(2000) projectReason?: string;
  @IsOptional() @IsString() @MaxLength(2000) supplierRequirements?: string;
  /** 'YYYY-MM-DD'，服务端按本地时区解析 */
  @IsOptional() @IsString() initiationDate?: string;
  @IsOptional() @IsString() @MaxLength(20) procurementOrganizationForm?: string;
  @IsOptional() @IsBoolean() isAnnualBudget?: boolean;
}

export class ReprocDto {
  @IsIn(['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT'])
  startStageKey!: 'PROCUREMENT_DEMAND' | 'INITIATION' | 'TENDER_DOCUMENT';

  /** 不传 = 沿用当前采购方式；传入须 ∈ 五种 PMI 方式（服务端校验模板存在） */
  @IsOptional() @IsString() procurementMethod?: string;

  @IsOptional() @Type(() => ReprocBasicInfoDto) @ValidateNested()
  basicInfo?: ReprocBasicInfoDto;
}
```

- [ ] **Step 4: 改控制器**

`project-management.controller.ts`——顶部 import 区加 `import { ReprocDto } from './dto/reproc.dto';`（跟随既有 dto import 排序），`:260-262` 改为：

```ts
  @Post(':id/reproc')
  reproc(@Param('id') id: string, @Body() dto: ReprocDto) {
    return this.projectManagementService.reproc(id, dto);
  }
```

- [ ] **Step 5: 重写服务方法**

`project-management.service.ts`——先删除 `:204-235` 的 `REPROC_STAGE_SEGMENTS` 常量整体（连同其上方注释两行），import 区加 `import { ReprocDto } from './dto/reproc.dto';`，然后把 `reproc`（:633 起）整体替换为：

```ts
  /**
   * 流标后再次采购（2026-10-23 统一流改造，spec 2026-10-23-abort-restart-unification）：
   * 入参起点（采购需求/采购立项/采购文件）+ 可选采购方式变更 + 可选基本信息差异更新。
   * 前置：当前轮 BidProject 已终局且系流标（ABORTED；或开标归档 ARCHIVED 且 riskNote 流标前缀）。
   * 单事务：旧轮开标评标置流标终态 → 删当前轮尾部（定标/合同/备案表）→ 按方式模板从起点
   * 截取到模板末尾插入新轮（起点激活）→ PMI 指针/方式/基本信息更新。
   */
  async reproc(itemId: string, dto: ReprocDto) {
    const START_STAGES = ['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT'];
    const TAIL_STAGE_KEYS = ['AWARD_DECISION', 'CONTRACT', 'DIRECT_PURCHASE_FILING'];

    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: itemId },
      select: {
        id: true, projectCode: true, procurementMethod: true, currentRound: true, status: true,
        requesterName: true, requesterDepartment: true, title: true, procurementCategory: true,
        budgetAmount: true, projectReason: true, supplierRequirements: true, initiationDate: true,
        procurementOrganizationForm: true, isAnnualBudget: true,
        stages: { orderBy: { stageOrder: 'asc' } },
      },
    });
    if (!item) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (item.status !== PROJECT_MANAGEMENT_STATUS.ACTIVE) {
      throw new BadRequestException('仅进行中的项目可以发起再次采购。');
    }

    const startStage = dto?.startStageKey;
    if (!START_STAGES.includes(startStage)) {
      throw new BadRequestException({ error: '重启起点须为 采购需求 / 采购立项 / 采购文件 三者之一', code: 'INVALID_START_STAGE' });
    }

    // 前置：当前轮 BidProject 已终局且系流标
    const currentRound = item.currentRound ?? 1;
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: itemId, round: currentRound },
      select: { stage: true, riskNote: true },
    });
    const bpAborted = !!bp && (bp.stage === 'ABORTED' || (bp.stage === 'ARCHIVED' && (bp.riskNote ?? '').startsWith('流标')));
    if (!bp || !bpAborted) {
      throw new ConflictException({
        error: '当前轮开评标流程尚未流标，请先发布流标公告完成流标，再发起再次采购',
        code: 'BID_NOT_ABORTED',
      });
    }

    // 采购方式：不传沿用；传入须有阶段模板（PMI 五种）
    const method = dto?.procurementMethod?.trim() || item.procurementMethod;
    const template = METHOD_STAGE_TEMPLATES[method];
    if (!template) {
      throw new BadRequestException({ error: `不支持的采购方式：${method}`, code: 'UNSUPPORTED' });
    }
    const segment = template.filter((s, i) => i >= template.findIndex((t) => t.key === startStage));

    // 幂等：最新一轮（maxRound > 1）仍处「刚开轮未推进」→ 拒绝重复开轮
    //（口径不变：首阶段 IN_PROGRESS 且整轮无 COMPLETED；首阶段按 stageOrder 取最小）
    const maxRound = item.stages.reduce((m, s) => Math.max(m, s.round ?? 1), 1);
    if (maxRound > 1) {
      const latestRound = item.stages.filter((s) => s.round === maxRound);
      const first = [...latestRound].sort((a, b) => a.stageOrder - b.stageOrder)[0];
      const untouched = !!first
        && first.status === PROJECT_STAGE_STATUS.IN_PROGRESS
        && first.completedAt === null
        && latestRound.every((s) => s.status !== PROJECT_STAGE_STATUS.COMPLETED);
      if (untouched) {
        throw new BadRequestException({ error: '已有新一轮采购等待开始，无需重复发起', code: 'REPROC_ALREADY_PENDING' });
      }
      // 存量自愈：历史 NOT_STARTED 死锁轮——激活既有轮次而非叠加新轮
      const legacyStuck = !!first
        && first.status === PROJECT_STAGE_STATUS.NOT_STARTED
        && latestRound.every((s) => s.status !== PROJECT_STAGE_STATUS.COMPLETED);
      if (legacyStuck) {
        await this.prisma.$transaction([
          this.prisma.projectManagementStage.update({
            where: { id: first.id },
            data: { status: PROJECT_STAGE_STATUS.IN_PROGRESS },
          }),
          this.prisma.projectManagementItem.update({
            where: { id: itemId },
            data: { currentStage: first.stageKey, currentRound: maxRound },
          }),
        ]);
        this.logger.log(`项目 ${itemId} 自愈激活第 ${maxRound} 轮首阶段 ${first.stageKey}（历史死锁数据）`);
        return { round: maxRound, inserted: 0, activated: true };
      }
    }

    // 删尾防御：当前轮尾部阶段挂有附件 → 拒绝（流标语义下不应有）
    const tailStages = item.stages.filter(
      (s) => (s.round ?? 1) === currentRound && TAIL_STAGE_KEYS.includes(s.stageKey),
    );
    if (tailStages.length) {
      const withAttachments = await this.prisma.projectManagementStage.findMany({
        where: { id: { in: tailStages.map((s) => s.id) } },
        select: { stageName: true, attachments: { select: { id: true } } },
      });
      const dirty = withAttachments.filter((s) => s.attachments.length > 0);
      if (dirty.length) {
        throw new ConflictException({
          error: `当前轮尾部阶段已挂材料（${dirty.map((s) => s.stageName).join('、')}），无法删除重排，请先人工处理`,
          code: 'TAIL_HAS_ATTACHMENTS',
        });
      }
    }

    // 基本信息差异更新（仅传入且有变化的字段落库）
    const infoData: Record<string, unknown> = {};
    const b = dto?.basicInfo ?? {};
    const strFields = ['requesterName', 'requesterDepartment', 'title', 'procurementCategory', 'projectReason', 'supplierRequirements', 'procurementOrganizationForm'];
    for (const f of strFields) {
      const v = (b as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.trim() && v !== (item as unknown as Record<string, unknown>)[f]) infoData[f] = v.trim();
    }
    if (typeof b.budgetAmount === 'number' && b.budgetAmount !== item.budgetAmount) infoData.budgetAmount = b.budgetAmount;
    if (typeof b.isAnnualBudget === 'boolean' && b.isAnnualBudget !== item.isAnnualBudget) infoData.isAnnualBudget = b.isAnnualBudget;
    if (typeof b.initiationDate === 'string' && b.initiationDate) {
      const d = parseInitiationDateInput(b.initiationDate);
      if (!item.initiationDate || d.getTime() !== item.initiationDate.getTime()) infoData.initiationDate = d;
    }
    if (method !== item.procurementMethod) infoData.procurementMethod = method;

    const newRound = maxRound + 1;
    // 追加式 stageOrder：删当前轮尾部后，新轮接在剩余阶段末尾
    const remainingMaxOrder = item.stages
      .filter((s) => !((s.round ?? 1) === currentRound && TAIL_STAGE_KEYS.includes(s.stageKey)))
      .reduce((m, s) => Math.max(m, s.stageOrder), 0);

    await this.prisma.$transaction(async (tx) => {
      // 旧轮流标终态标注（原 reproc 口径）：开标评标置 COMPLETED + 流标备注
      await tx.projectManagementStage.updateMany({
        where: { projectManagementItemId: itemId, round: currentRound, stageKey: 'BID_EVALUATION' },
        data: { status: PROJECT_STAGE_STATUS.COMPLETED, note: '已流标（重新采购）' },
      });
      if (tailStages.length) {
        await tx.projectManagementStage.deleteMany({ where: { id: { in: tailStages.map((s) => s.id) } } });
      }
      await tx.projectManagementStage.createMany({
        data: segment.map((s, i) => ({
          projectManagementItemId: itemId,
          stageKey: s.key,
          stageName: s.label,
          stageOrder: remainingMaxOrder + 1 + i,
          round: newRound,
          stageCode: item.projectCode ? stageCodeFor(item.projectCode, s.key, newRound) : null,
          status: i === 0 ? PROJECT_STAGE_STATUS.IN_PROGRESS : PROJECT_STAGE_STATUS.NOT_STARTED,
        })),
      });
      await tx.projectManagementItem.update({
        where: { id: itemId },
        data: { ...infoData, currentStage: segment[0].key, currentRound: newRound },
      });
    });

    this.logger.log(
      `项目 ${itemId} 再次采购：删当前轮尾部 ${tailStages.length} 个阶段，插入第 ${newRound} 轮（${segment.length} 个阶段，起点 ${segment[0].key}，方式 ${method}）`,
    );
    return { round: newRound, inserted: segment.length };
  }
```

- [ ] **Step 6: 跑测试确认通过**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/project-management/project-management.service.spec.ts -t "reproc 流标重启"
```

预期：7 个用例全 PASS。随后跑全套件确认无回归：`npx jest src/project-management/`——预期全绿（`REPROC_STAGE_SEGMENTS` 删除后无其他引用，前次全库 grep 已核实）。

- [ ] **Step 7: lint + tsc + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && pnpm lint && npx tsc --noEmit
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/api/src/project-management/dto/reproc.dto.ts apps/api/src/project-management/project-management.controller.ts apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "feat(pmi): reproc 带参改造——起点三选/采购方式变更/基本信息差异更新+删旧轮尾部插新轮（流标统一流 spec 2026-10-23 Task 1）"
```

---

### Task 2: API — bid-project-refs 加流标公告闸字段

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts:3771`（`listBidProjectRefs`）
- Modify: `apps/web/src/lib/api/project-management.ts:650-663`（`PmBidProjectRefItem` 加字段——类型先行，Task 6 消费）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`

**Interfaces:**
- Consumes: Prisma `announcement`（type/relatedProjectCode/publishDate）、`bidProject.createdAt`。
- Produces: refs 响应每项含 `failedBidNoticePublished: boolean`（判定：FAILED_BID_NOTICE + relatedProjectCode ∈ {PMI.projectCode, 该轮 bp.projectCode} + publishDate ≥ 该轮 bp.createdAt）。Task 6 的公告闸消费。

- [ ] **Step 1: 写失败测试**

追加到 spec（任意 describe 内或新 describe）：

```ts
describe('listBidProjectRefs 公告闸字段（2026-10-23 统一流）', () => {
  it('FAILED_BID_NOTICE 按轮归属：早于该轮 BidProject 创建的公告不算该轮', async () => {
    const { service, prisma } = makeService();
    prisma.projectManagementItem.findUnique.mockResolvedValue({ projectCode: 'SWHI-TP-2026102301' });
    prisma.bidProject.findMany.mockResolvedValue([
      { id: 'bp-1', round: 1, projectCode: 'BID-1', name: 'A', stage: 'ABORTED', procurementMethod: '询比采购', evaluationMethod: 'COMPREHENSIVE', openTime: null, deadline: null, createdAt: new Date('2026-10-01') },
      { id: 'bp-2', round: 2, projectCode: 'BID-2', name: 'A', stage: 'EVALUATING', procurementMethod: '询比采购', evaluationMethod: 'COMPREHENSIVE', openTime: null, deadline: null, createdAt: new Date('2026-10-15') },
    ]);
    prisma.announcement.findMany.mockResolvedValue([
      { relatedProjectCode: 'SWHI-TP-2026102301', publishDate: new Date('2026-10-05') },
    ]);

    const refs = await service.listBidProjectRefs('pm-1');

    expect(refs.find((r: any) => r.round === 1).failedBidNoticePublished).toBe(true);
    expect(refs.find((r: any) => r.round === 2).failedBidNoticePublished).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/project-management/project-management.service.spec.ts -t "公告闸字段"
```

预期：FAIL（`failedBidNoticePublished` 为 undefined）。

- [ ] **Step 3: 实现**

`listBidProjectRefs`（:3771）整体替换为：

```ts
  async listBidProjectRefs(pmiId: string) {
    const pmi = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { projectCode: true },
    });
    const bps = await this.prisma.bidProject.findMany({
      where: { projectManagementItemId: pmiId },
      // 列集对齐前端 BidProjectRef 类型（ScoreStandardEditor/评标办法子块入参）
      select: {
        id: true,
        round: true,
        projectCode: true,
        name: true,
        stage: true,
        procurementMethod: true,
        // none-eval（spec 2026-09-24）：:3005 评分标准卡 ref 兜底路径（detail 拉取失败时）也须能判 none
        evaluationMethod: true,
        openTime: true,
        deadline: true,
        // 公告闸判定（2026-10-23 统一流）：该轮流标公告须晚于该轮 BidProject 创建
        createdAt: true,
      },
      orderBy: { round: 'asc' },
    });
    // 流标公告闸：FAILED_BID_NOTICE 命中本项目编码空间（PMI 编码或该轮 BidProject 编码）且发布于该轮创建之后
    const codes = [pmi?.projectCode, ...bps.map((b) => b.projectCode)].filter((c): c is string => !!c);
    const notices = codes.length
      ? await this.prisma.announcement.findMany({
          where: { type: 'FAILED_BID_NOTICE', relatedProjectCode: { in: codes } },
          select: { relatedProjectCode: true, publishDate: true },
        })
      : [];
    return bps.map((b) => ({
      ...b,
      failedBidNoticePublished: notices.some((n) => {
        if (![pmi?.projectCode, b.projectCode].includes(n.relatedProjectCode)) return false;
        return !!n.publishDate && new Date(n.publishDate) >= b.createdAt;
      }),
    }));
  }
```

同步改前端类型：`apps/web/src/lib/api/project-management.ts` 的 `PmBidProjectRefItem` 接口加一行：

```ts
  /** 流标公告闸（2026-10-23 统一流）：该轮已发布流标公告——决策向导入口判定 */
  failedBidNoticePublished: boolean;
```

- [ ] **Step 4: 跑测试确认通过 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/project-management/project-management.service.spec.ts
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts apps/web/src/lib/api/project-management.ts
git commit -m "feat(pmi): bid-project-refs 附 failedBidNoticePublished 公告闸字段（流标统一流 Task 2）"
```

---

### Task 3: API — 流标公告发布联动对终态项目跳过

**Files:**
- Modify: `apps/api/src/announcement/announcement.service.ts:1206-1211`
- Test: `apps/api/src/announcement/announcement.service.spec.ts`（E2 describe 内追加，makeSvc 样板见 :335-350）

**Interfaces:**
- Consumes: `syncBidProject` 内既有 `existingProject`（:1164）。
- Produces: 行为变更——`meta.category === 'failed_bid'` 且 BidProject stage ∈ {ABORTED, ARCHIVED} 时跳过 `abortBidProject` 并记日志（来源②开标归档后补发公告不再 409）。既有用例「:650 分支经 meta.category 可达」（:352）不受影响（其 mock 无 stage 字段 → 未终态 → 照常联动）。

- [ ] **Step 1: 写失败测试**

在 `announcement.service.spec.ts` 的 `describe('AnnouncementService — E2 category 白名单…')` 内追加：

```ts
  it('流标公告发布：项目已 ARCHIVED（开标归档流标）→ 跳过联动流标不抛错（2026-10-23 统一流）', async () => {
    const abortBidProject = jest.fn().mockResolvedValue({});
    const { service } = await makeSvc(
      { syncFromAnnouncement: jest.fn().mockResolvedValue({}), abortBidProject, ensureTenderAnalysis: jest.fn() },
      {
        bidProject: {
          // 第一次：P1 编码空间匹配查询；第二次：联动前终态复查（select stage）
          findUnique: jest.fn()
            .mockResolvedValueOnce({ id: 'p-e2', projectCode: 'BID-E2' })
            .mockResolvedValueOnce({ stage: 'ARCHIVED' }),
          update: jest.fn(),
        },
      },
    );
    await expect(service.syncBidProject('ann1', {
      ...ann, metadata: { ...ann.metadata, category: 'failed_bid' },
    })).resolves.toBeUndefined();
    expect(abortBidProject).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/announcement/announcement.service.spec.ts -t "跳过联动流标"
```

预期：FAIL——现状无条件调用 `abortBidProject`，mock ARCHIVED 时该 mock 正常 resolve（未抛错），但 `abortBidProject` 被调用 → 断言 `not.toHaveBeenCalled()` 红。

- [ ] **Step 3: 实现**

`announcement.service.ts:1206-1211` 替换为：

```ts
        // 流标公告：发布后联动 BidProject 流标——终态（ABORTED/ARCHIVED）跳过不报错
        //（2026-10-23 统一流：开标归档流标后 :3005 补发流标公告，联动撞 ARCHIVED→ABORTED
        //  单向棘轮终态守卫 409；ABORTED 幂等但显式跳过更清晰）
        if (meta.category === 'failed_bid') {
          const fresh = await this.prisma.bidProject.findUnique({
            where: { id: existingProject.id },
            select: { stage: true },
          });
          if (fresh && (fresh.stage === 'ABORTED' || fresh.stage === 'ARCHIVED')) {
            this.logger.log(`流标公告已发布，项目 ${existingProject.projectCode} 已处终态（${fresh.stage}），跳过联动流标`);
          } else {
            await this.bidService.abortBidProject(existingProject.id);
            this.logger.log(`流标公告已发布，项目 ${existingProject.projectCode} 已标记为 ABORTED`);
          }
        }
```

- [ ] **Step 4: 跑测试确认通过（含既有 E2 用例）+ 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx jest src/announcement/announcement.service.spec.ts
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/api/src/announcement/announcement.service.ts apps/api/src/announcement/announcement.service.spec.ts
git commit -m "fix(announcement): 流标公告发布联动对终态项目跳过——开标归档后补发公告不再 409（流标统一流 Task 3）"
```

---

### Task 4: Web — reprocProject 带参 + AbortRestartDialog 决策向导组件

**Files:**
- Modify: `apps/web/src/lib/api/project-management.ts:97-105`（`reprocProject` 带参化）
- Create: `apps/web/src/components/projects/abort-restart-dialog.tsx`

**Interfaces:**
- Consumes: `reprocProject(projectId, body)`（本任务定义）；`getNonTenderDeal(bidProjectId)` from `@/lib/api/bid`；`PROCUREMENT_METHODS` / `PROCUREMENT_METHOD_STAGES` / `ProjectManagementItem` from `@/lib/types/project-management`；`Modal` from `@/components/workbench`。
- Produces: `<AbortRestartDialog isOpen onClose item currentRoundBidProjectId onRequestTerminate onRestarted />`——Task 5/6 挂载消费。`onRequestTerminate` 由 panel 接到既有终止对话框。

- [ ] **Step 1: reprocProject 带参化**

`lib/api/project-management.ts:97-105` 替换为：

```ts
/** 流标后再次采购入参（spec 2026-10-23-abort-restart-unification §4.1）——键名对齐 PMI 列名 */
export interface ReprocBody {
  startStageKey: 'PROCUREMENT_DEMAND' | 'INITIATION' | 'TENDER_DOCUMENT';
  /** 不传 = 沿用当前方式 */
  procurementMethod?: string;
  /** 仅传有差异字段 */
  basicInfo?: Partial<{
    requesterName: string; requesterDepartment: string; title: string; procurementCategory: string;
    budgetAmount: number; projectReason: string; supplierRequirements: string;
    initiationDate: string; procurementOrganizationForm: string; isAnnualBudget: boolean;
  }>;
}

/** 流标后再次采购：删当前轮尾部、按（新）方式模板从起点截取插入新一轮（后端单事务） */
export async function reprocProject(projectId: string, body: ReprocBody) {
  const response = await apiFetch(`${API_BASE}/project-management/${projectId}/reproc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  return parseJsonResponse<{ round: number; inserted: number }>(response);
}
```

- [ ] **Step 2: 写 AbortRestartDialog 组件**

新建 `apps/web/src/components/projects/abort-restart-dialog.tsx`：

```tsx
'use client';

/**
 * 流标决策向导（2026-10-23 统一流，spec 2026-10-23-abort-restart-unification）：
 * Step1 是否继续 → Step2 基本信息确认（采购方式重点区）→ Step3 重启起点三选 + 新轮阶段预览。
 * 入口：流标公告发布后自动弹（向导 onPublished 链）/ 流标提示条「收尾处理」（公告闸后）。
 * 终止分支不在本组件内做——onRequestTerminate 唤起面板既有终止对话框。
 */

import { useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import { getNonTenderDeal } from '@/lib/api/bid';
import { reprocProject, type ReprocBody } from '@/lib/api/project-management';
import {
  PROCUREMENT_METHODS,
  PROCUREMENT_METHOD_STAGES,
  type ProjectManagementItem,
} from '@/lib/types/project-management';

type Step = 'ask' | 'info' | 'start';

const START_OPTIONS: Array<{ key: ReprocBody['startStageKey']; label: string; hint: string }> = [
  { key: 'PROCUREMENT_DEMAND', label: '采购需求', hint: '从头梳理需求与预算' },
  { key: 'INITIATION', label: '采购立项', hint: '需求沿用，重新立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件', hint: '需求立项沿用，重编采购文件' },
];

const STR_FIELD_DEFS = [
  { key: 'requesterName', label: '申请人' },
  { key: 'requesterDepartment', label: '申请部门' },
  { key: 'title', label: '采购项目名称' },
  { key: 'procurementCategory', label: '采购品类' },
  { key: 'projectReason', label: '采购事由' },
  { key: 'supplierRequirements', label: '对供方的要求' },
  { key: 'procurementOrganizationForm', label: '采购组织形式' },
] as const;

export function AbortRestartDialog({
  isOpen,
  onClose,
  item,
  currentRoundBidProjectId,
  onRequestTerminate,
  onRestarted,
}: {
  isOpen: boolean;
  onClose: () => void;
  item: ProjectManagementItem;
  currentRoundBidProjectId: string | null;
  /** Step1 选「终止」→ 唤起面板既有终止对话框 */
  onRequestTerminate: () => void;
  /** 重启成功回调（面板刷新详情） */
  onRestarted: () => void;
}) {
  const [step, setStep] = useState<Step>('ask');
  const [dealBlocked, setDealBlocked] = useState(false); // C3 非招标成交登记 → 不宜重启
  const [busy, setBusy] = useState(false);

  // Step2 表单（预填 PMI 当前值）
  const [form, setForm] = useState<Record<string, string>>({});
  const [budgetInput, setBudgetInput] = useState('');
  const [annualBudget, setAnnualBudget] = useState(true);
  const [method, setMethod] = useState(item.procurementMethod);
  const [startStage, setStartStage] = useState<ReprocBody['startStageKey']>('TENDER_DOCUMENT');

  useEffect(() => {
    if (!isOpen) return;
    setStep('ask'); setBusy(false);
    setForm({
      requesterName: item.requesterName ?? '',
      requesterDepartment: item.requesterDepartment ?? '',
      title: item.title ?? '',
      procurementCategory: item.procurementCategory ?? '',
      projectReason: item.projectReason ?? '',
      supplierRequirements: item.supplierRequirements ?? '',
      procurementOrganizationForm: item.procurementOrganizationForm ?? '',
      initiationDate: item.initiationDate ? new Date(item.initiationDate).toISOString().slice(0, 10) : '',
    });
    setBudgetInput(item.budgetAmount != null ? String(item.budgetAmount) : '');
    setAnnualBudget(item.isAnnualBudget ?? true);
    setMethod(item.procurementMethod);
    setStartStage('TENDER_DOCUMENT');
    // C3：当前轮已转非招标方式成交 → 不宜重启采购
    if (currentRoundBidProjectId) {
      getNonTenderDeal(currentRoundBidProjectId)
        .then((deal) => setDealBlocked(!!deal))
        .catch(() => setDealBlocked(false));
    }
  }, [isOpen, item, currentRoundBidProjectId]);

  // Step3 新轮阶段预览：按方式模板从起点截取到末尾
  const previewStages = useMemo(() => {
    const tpl = PROCUREMENT_METHOD_STAGES[method as keyof typeof PROCUREMENT_METHOD_STAGES] ?? [];
    const idx = tpl.findIndex((s) => s.key === startStage);
    return idx >= 0 ? tpl.slice(idx) : [];
  }, [method, startStage]);

  const methodChanged = method !== item.procurementMethod;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      // 差异收集：字符串字段 + 预算 + 年度预算 + 立项日期
      const basicInfo: NonNullable<ReprocBody['basicInfo']> = {};
      const origin: Record<string, unknown> = {
        requesterName: item.requesterName, requesterDepartment: item.requesterDepartment,
        title: item.title, procurementCategory: item.procurementCategory,
        projectReason: item.projectReason, supplierRequirements: item.supplierRequirements,
        procurementOrganizationForm: item.procurementOrganizationForm,
      };
      for (const f of STR_FIELD_DEFS) {
        const v = (form[f.key] ?? '').trim();
        if (v && v !== (origin[f.key] ?? '')) basicInfo[f.key] = v;
      }
      const budget = Number(budgetInput);
      if (budgetInput.trim() && Number.isFinite(budget) && budget !== item.budgetAmount) basicInfo.budgetAmount = budget;
      if (annualBudget !== item.isAnnualBudget) basicInfo.isAnnualBudget = annualBudget;
      const dateStr = (form.initiationDate ?? '').trim();
      if (dateStr && (!item.initiationDate || dateStr !== new Date(item.initiationDate).toISOString().slice(0, 10))) {
        basicInfo.initiationDate = dateStr;
      }

      const res = await reprocProject(item.id, {
        startStageKey: startStage,
        ...(methodChanged ? { procurementMethod: method } : {}),
        ...(Object.keys(basicInfo).length ? { basicInfo } : {}),
      });
      toast.success(`已开启第 ${res.round} 轮采购（${res.inserted} 个阶段），当前步骤：${START_OPTIONS.find((o) => o.key === startStage)?.label ?? ''}`);
      onRestarted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重启失败');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={busy ? () => undefined : onClose}
      size="md"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
      footer={
        <div className="neu-btn-group">
          {step === 'ask' ? (
            <>
              <button type="button" onClick={() => onRequestTerminate()} className="neu-btn-soft is-danger">
                <Ban size={14} /> 终止该项采购
              </button>
              <button type="button" onClick={() => setStep('info')} disabled={dealBlocked} className="neu-btn-primary is-water">
                继续采购 <RefreshCw size={14} />
              </button>
            </>
          ) : step === 'info' ? (
            <>
              <button type="button" onClick={() => setStep('ask')} disabled={busy} className="neu-btn-soft">上一步</button>
              <button type="button" onClick={() => setStep('start')} className="neu-btn-primary is-water">下一步：选择重启步骤</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep('info')} disabled={busy} className="neu-btn-soft">上一步</button>
              <button type="button" onClick={() => void handleConfirm()} disabled={busy} className="neu-btn-primary is-water">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} 确认重启
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <div className="wb-icon-well" style={{ '--well-fg': 'var(--accent)' } as React.CSSProperties}>
          <RefreshCw size={18} strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-base font-bold text-[color:var(--foreground)]">流标收尾 · 该项采购是否继续？</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{item.title}（第 {item.currentRound ?? 1} 轮已流标）</p>
        </div>
      </div>

      {dealBlocked && step === 'ask' && (
        <div className="wb-alert wb-alert--warning mt-4 text-sm">
          当前轮已登记「转非招标方式成交」，不宜重启采购——可选择终止收尾。
        </div>
      )}

      {step === 'ask' && (
        <div className="mt-4 wb-alert wb-alert--info !p-3 text-xs text-[var(--muted-foreground)]">
          「终止」进入项目终止流程（写入已终止清单，公告下架，不可恢复）；「继续采购」将确认项目信息并选择重启步骤，生成新一轮采购阶段。
        </div>
      )}

      {step === 'info' && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {STR_FIELD_DEFS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">{f.label}</span>
                <input
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="workbench-input mt-1 text-sm"
                />
              </label>
            ))}
            <label className="block">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">采购预算（元）</span>
              <input value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} inputMode="decimal" className="workbench-input mt-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">立项日期</span>
              <input
                type="date"
                value={form.initiationDate ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, initiationDate: e.target.value }))}
                className="workbench-input mt-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input type="checkbox" checked={annualBudget} onChange={(e) => setAnnualBudget(e.target.checked)} />
              年度预算内
            </label>
          </div>

          {/* 采购方式独立强调区 */}
          <div className="rounded-[14px] border p-3" style={{ borderColor: methodChanged ? 'var(--warning)' : 'color-mix(in oklch, var(--foreground) 12%, transparent)' }}>
            <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">采购方式（重点确认）</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="workbench-input mt-2 text-sm">
              {PROCUREMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {methodChanged && (
              <p className="mt-2 text-xs font-semibold text-[color:var(--warning)]">
                采购方式将由「{item.procurementMethod}」变更为「{method}」——第 {(item.currentRound ?? 1) + 1} 轮将按新方式生成阶段。
              </p>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">有修改的字段将更新到项目基本信息；未修改的保持原值。</p>
        </div>
      )}

      {step === 'start' && (
        <div className="mt-4 space-y-3">
          <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">从哪一步开始重启？</span>
          <div className="grid grid-cols-3 gap-2">
            {START_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setStartStage(o.key)}
                className="rounded-[14px] p-3 text-left transition"
                style={{
                  border: `1px solid ${startStage === o.key ? 'var(--accent)' : 'color-mix(in oklch, var(--foreground) 12%, transparent)'}`,
                  background: startStage === o.key ? 'color-mix(in oklch, var(--accent) 8%, transparent)' : undefined,
                }}
              >
                <span className="block text-sm font-bold text-[color:var(--foreground)]">{o.label}</span>
                <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">{o.hint}</span>
              </button>
            ))}
          </div>
          <div>
            <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">
              第 {(item.currentRound ?? 1) + 1} 轮阶段预览（{method}{methodChanged ? ` · 原 ${item.procurementMethod}` : ''}）
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {previewStages.map((s, i) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{ borderColor: 'color-mix(in oklch, var(--foreground) 12%, transparent)' }}>
                  {i + 1}. {s.label}
                </span>
              ))}
            </div>
          </div>
          <div className="wb-alert wb-alert--info !p-3 text-xs text-[var(--muted-foreground)]">
            确认后：第 {item.currentRound ?? 1} 轮全部锁定（只读）；删除其开标评标之后的定标/合同等阶段；第 {(item.currentRound ?? 1) + 1} 轮按上列阶段生成，起点步骤立即可操作。
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: 验证 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && pnpm lint && npx tsc --noEmit
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/lib/api/project-management.ts apps/web/src/components/projects/abort-restart-dialog.tsx
git commit -m "feat(projects): AbortRestartDialog 流标决策向导——是否继续/基本信息与采购方式确认/重启起点三选（流标统一流 Task 4）"
```

---

### Task 5: Web — 向导移除自动 reproc + AbortDialog 删简版公告、加公告 CTA

**Files:**
- Modify: `apps/web/src/components/projects/announcement-publish-wizard.tsx:1249-1261`
- Modify: `apps/web/src/components/projects/bid-confirm/abort-dialog.tsx`（删 createAnnouncement 步、加 onPublishNotice CTA）
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx`（透传 onPublishNotice）

**Interfaces:**
- Consumes: Task 4 组件（由 panel 挂载，本任务只做向导→panel 回调衔接与 AbortDialog 链改造）。
- Produces: 向导 failed_bid 发布成功后不再自动 `reprocProject`；`AbortDialog` 新可选 prop `onPublishNotice?: () => void`；`BidConfirmPanel` 新可选 prop `onPublishNotice?: () => void`（透传给 AbortDialog）。

- [ ] **Step 1: 向导移除自动 reproc**

`announcement-publish-wizard.tsx:1249-1261`——删除整个 failed_bid 自动 reproc 块：

```ts
      // （删除）流标公告发布后：自动触发再次采购（按采购方式新增新一轮「立项后→开标评标」阶段）
      if (category === 'failed_bid' && project?.id) {
        try {
          await reprocProject(project.id);
          toast.success('已开启新一轮采购');
        } catch (e) {
          toast.error('再次采购失败：' + (e instanceof Error ? e.message : '未知错误'));
        }
      }
```

同时清理 import：`:21` 行移除 `reprocProject`（`uploadProjectStageAttachment`/`getPmBidProject`/`UploadStageAttachmentResult` 保留）。发布成功提示前加一行 toast 引导（放在原 `toast.success(...)` 之后）：

```ts
      if (category === 'failed_bid') toast.info('流标公告已发布，即将进入收尾决策');
```

- [ ] **Step 2: AbortDialog 删简版公告、加公告 CTA**

`bid-confirm/abort-dialog.tsx`：
1. 删 `import { createAnnouncement } from '@/lib/api/announcement';`（:11）。
2. Props 加 `onPublishNotice?: () => void;`（Props type 内）。
3. `handleConfirm`（:69-97）中删除 Step2 公告块：

```ts
      // （删除）Step 2: 创建流标公告（failed_bid）
      try {
        await createAnnouncement({ ... });
      } catch { /* 公告创建失败不阻塞流标+归档 */ }
```

步骤状态文案同步：`'正在执行流标+发布公告…'` → `'正在执行流标…'`；info 提示 `① 项目置为流标 → ② 发布流标公告 → ③ 开标归档（终局封存，不可逆）` → `① 项目置为流标 → ② 开标归档（终局封存，不可逆）——流标公告在完成后发布`；done 态成功文案 `流标完成——已发公告并归档` → `流标完成——已归档`。
4. done 态（原 C3 登记按钮区域上方）加公告 CTA 按钮：

```tsx
          <button type="button" onClick={() => onPublishNotice?.()} className="neu-btn-primary is-water w-full">
            <Megaphone size={14} /> 发布流标公告并继续收尾
          </button>
```

（lucide import 行补 `Megaphone`。）

- [ ] **Step 3: BidConfirmPanel 透传**

`bid-confirm-panel.tsx`：
1. Props（:80-93 区域）加 `/** AbortDialog 完成后发布流标公告入口（打开 failed_bid 向导，父级接线） */ onPublishNotice?: () => void;`
2. AbortDialog 挂载处（:1265-1271）加 `onPublishNotice={onPublishNotice}`。

- [ ] **Step 4: 验证 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && pnpm lint && npx tsc --noEmit
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/projects/announcement-publish-wizard.tsx apps/web/src/components/projects/bid-confirm/abort-dialog.tsx apps/web/src/components/projects/bid-confirm-panel.tsx
git commit -m "feat(projects): 流标公告向导移除自动 reproc；AbortDialog 删简版公告、done 态加发布公告 CTA（流标统一流 Task 5）"
```

---

### Task 6: Web — 流标提示条入口 + 公告闸 + 轮次锁 + isLockedByBid 修复 + 面板总装

**Files:**
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`（多处，见步骤）

**Interfaces:**
- Consumes: Task 2 `failedBidNoticePublished`（refs 字段）、Task 4 `AbortRestartDialog`、Task 5 `BidConfirmPanel.onPublishNotice`、既有终止对话框（terminateOpen，:1015）。
- Produces: 完整决策流链路——公告发布（任何来源）→ 决策向导；旧轮全锁。

- [ ] **Step 1: 清理死 import + 引入决策向导**

`:15` 的 import 列表中删 `reprocProject,`（死引用）；import 区加：

```ts
import { AbortRestartDialog } from './abort-restart-dialog';
```

- [ ] **Step 2: 决策向导状态与公告闸入口**

组件状态区（:607 附近）加：

```ts
  const [abortRestartOpen, setAbortRestartOpen] = useState(false);
```

流标提示条（:1281-1313）中「打开开标确认面板」按钮旁（按钮行 `<div className="flex items-center gap-3">` 内、该按钮之后）加收尾入口（仅创建人可点——`canModify` 是面板既有写权限布尔）：

```tsx
              {canModify && (
                <button
                  type="button"
                  onClick={() => {
                    // 公告闸：当前轮无流标公告 → 先拉起 failed_bid 向导（发布后由 onPublished 链自动进决策向导）
                    if (currentRoundBp?.failedBidNoticePublished) setAbortRestartOpen(true);
                    else { setAnnouncementCategory('failed_bid'); setAnnouncementPublishOpen(true); }
                  }}
                  disabled={!currentRoundBp}
                  className="neu-btn-soft !h-[32px] !text-xs shrink-0"
                >
                  收尾处理
                </button>
              )}
```

「收尾路径」说明行（:1313）文字更新为：`发布流标公告 → 继续采购（新轮重启）或终止项目`。

- [ ] **Step 3: 向导 onPublished 链 + AbortRestartDialog 挂载 + BidConfirmPanel 透传**

`<AnnouncementPublishWizard>`（:2457-2464）`onPublished` 改为：

```tsx
        onPublished={() => {
          handleUpdated();
          // 流标统一流（2026-10-23）：failed_bid 发布成功 → 自动进入决策向导（是否继续/信息确认/重启）
          if (announcementCategory === 'failed_bid') setAbortRestartOpen(true);
        }}
```

`<BidConfirmPanel>`（:2567 附近 onAbort 同级）加透传：

```tsx
        onPublishNotice={() => {
          setBidConfirmOpen(false);
          setAnnouncementCategory('failed_bid');
          setAnnouncementPublishOpen(true);
        }}
```

面板 JSX 末尾（`<AnnouncementPublishWizard>` 之后）挂载决策向导：

```tsx
      {/* 流标决策向导（2026-10-23 统一流）：公告闸后进入；终止分支唤起既有终止对话框 */}
      <AbortRestartDialog
        isOpen={abortRestartOpen}
        onClose={() => setAbortRestartOpen(false)}
        item={item}
        currentRoundBidProjectId={currentRoundBp?.id ?? null}
        onRequestTerminate={() => { setAbortRestartOpen(false); setTerminateOpen(true); }}
        onRestarted={() => { handleUpdated(); }}
      />
```

- [ ] **Step 4: 轮次锁 + isLockedByBid round 修复**

`:480-488` 替换为（bidEvalStage/isLockedByBid/stageLocked 三段整体改写）：

```ts
  // 轮次对齐（2026-10-23 流标统一流）：开标评标按当前选中轮取行——多轮后不带 round 会命中第一轮
  const bidEvalStage = localItem.stages.find(
    (s) => s.stageKey === 'BID_EVALUATION' && (s.round ?? 1) === selectedRound,
  );
  const isBidLocked = bidEvalStage?.status === 'IN_PROGRESS' || bidEvalStage?.status === 'COMPLETED';

  const isLockedByBid = (stageKey: string) => {
    if (!isBidLocked) return false;
    const stageOrder = localItem.stages.find(
      (s) => s.stageKey === stageKey && (s.round ?? 1) === selectedRound,
    )?.stageOrder ?? Infinity;
    return stageOrder < (bidEvalStage?.stageOrder ?? Infinity);
  };

  // 轮次锁（2026-10-23 流标统一流）：旧轮全部只读（含已完成阶段——补传/编辑/AI 提取全关，查看与附件下载保留）
  const isPastRound = (selectedStage.round ?? 1) < (localItem.currentRound ?? 1);
  const stageLocked =
    selectedStage.status === 'NOT_STARTED' || isLockedByBid(selectedStage.stageKey) || isPastRound;
```

锁提示（:879 `if (stageLocked)` toast 与 :2069/:2145 的禁用提示分支）补轮次口径——`:879` 处改为：

```ts
    if (isPastRound) { toast.warning('该步骤属已完成的历史轮次，仅供查看'); return; }
    if (isLockedByBid(stage.stageKey)) { toast.warning('开标已确认，前置步骤已锁定'); return; }
```

- [ ] **Step 5: 验证 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && pnpm lint && npx tsc --noEmit
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/projects/project-detail-panel.tsx
git commit -m "feat(projects): 流标提示条收尾入口+公告闸；stageLocked 轮次锁旧轮只读；isLockedByBid 按轮取行（流标统一流 Task 6）"
```

---

### Task 7: Web — 时间线新轮方式变更徽标

**Files:**
- Modify: `apps/web/src/components/projects/project-stage-timeline.tsx`
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`（传 prop）

**Interfaces:**
- Consumes: 时间线既有轮次分组（:193-267）。
- Produces: 时间线新可选 prop `roundMethods?: Record<number, string>`（轮次 → 采购方式）；round ≥ 2 且方式与第 1 轮不同时，分组头显示徽标「方式：X（原 Y）」。

- [ ] **Step 1: 时间线加 prop 与徽标**

`project-stage-timeline.tsx` Props type 加：

```ts
  /** 轮次 → 采购方式（2026-10-23 流标统一流）：round ≥ 2 与首轮不同时分组头显示方式变更徽标 */
  roundMethods?: Record<number, string>;
```

分组头渲染处（:243-260 分组 header，`流标重采` 徽标 `{round > 1 && (...)}` 之后）追加：

```tsx
                    {roundMethods && round > 1 && roundMethods[round] && roundMethods[1] && roundMethods[round] !== roundMethods[1] && (
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
                        方式：{roundMethods[round]}（原 {roundMethods[1]}）
                      </span>
                    )}
```

- [ ] **Step 2: panel 传 prop**

`project-detail-panel.tsx` 中 `<ProjectStageTimeline .../>` 挂载处加：

```tsx
        roundMethods={(() => {
          const m: Record<number, string> = { 1: item.procurementMethod };
          bpRefs.forEach((r) => { m[r.round] = r.procurementMethod; });
          m[item.currentRound ?? 1] = item.procurementMethod; // 新轮无 BidProject 时以 PMI 现方式为准
          return m;
        })()}
```

- [ ] **Step 3: 验证 + 提交**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && pnpm lint && npx tsc --noEmit
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/projects/project-stage-timeline.tsx apps/web/src/components/projects/project-detail-panel.tsx
git commit -m "feat(projects): 时间线新轮采购方式变更徽标「方式：X（原 Y）」（流标统一流 Task 7）"
```

---

### Task 8: 全量验证与手动核对

**Files:** 无新改动（仅验证；发现问题时按任务归属修复后重跑）

- [ ] **Step 1: API 全量**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/api && pnpm lint && npx tsc --noEmit && npx jest --silent
```

预期：lint 0 error、tsc 0 error、全量单测绿（重点回看 project-management / announcement 两套件）。

- [ ] **Step 2: Web 全量**

```bash
cd /Users/qihao/ERP2/ERP/water-erp/apps/web && pnpm lint && npx tsc --noEmit
```

预期：双双 0 error。

- [ ] **Step 3: 手动核对（dev 环境起 :4001 + :3005，用 Swhi-CGZX-01 创建人账号）**

核对清单（每项通不过按任务归属修复）：

1. **来源①全链**：项目推进到开标前（DOWNLOAD/SUBMIT）→ 开标确认面板点「流标」→ 确认 → 流标公告向导编写发布 → 发布成功后自动弹决策向导；确认 `BidProject` 已 ABORTED（公告联动）。
2. **决策向导·继续+改方式**：Step2 把方式从询比改为谈判、改供应商需求 → Step3 选起点「采购需求」→ 预览显示谈判模板 8 阶段 → 确认 → 时间线出现「第 2 轮」分组（含方式徽标）、第 1 轮全部只读（点旧轮步骤补传/编辑被拦、toast「历史轮次仅供查看」）、新轮首阶段=采购需求进行中可操作、PMI 卡片方式显示「谈判采购」。
3. **决策向导·终止**：另一流标项目 → 决策向导选「终止该项采购」→ 唤起既有终止对话框 → 填原因确认 → 项目进「已终止」清单、只读横幅正常。
4. **来源②衔接**：开标完成项目走 AbortDialog → abort+开标归档（无简版公告）→ done 态「发布流标公告并继续收尾」→ 向导发布不 409（终态跳过日志）→ 自动进决策向导。
5. **来源③衔接**：:3007 评标中流标（或直接把库内 BidProject 置 ABORTED 模拟）→ :3005 流标提示条出现 → 点「收尾处理」→ 因无流标公告先拉起向导 → 发布后自动进决策向导。
6. **回归**：正常项目（未流标）阶段推进/上传/完成不受轮次锁影响；中标公告（winning_bid）发布路径无 reproc 行为；流标提示条「打开开标确认面板」按钮仍在。

- [ ] **Step 4: 收尾提交（如有修复）+ 汇报**

按修复文件逐一路径 add 提交；无修复则无提交。向用户汇报完成情况与核对结果。

---

## Self-Review 记录

- **Spec 覆盖**：§3 三来源衔接（Task 5/6）、§4.1 reproc（Task 1）、§4.2 公告闸字段（Task 2）、§4.3 联动加固（Task 3）、§5.1 决策向导（Task 4）、§5.2 衔接（Task 5/6）、§6 锁定与展示（Task 6/7）、§7 边界（BID_NOT_ABORTED/TAIL_HAS_ATTACHMENTS/C3 dealBlocked 在 Task 1/4 内）、§8 测试（各任务 Step 内 + Task 8）——全覆盖。
- **占位符**：无 TBD/TODO；所有代码步骤均含完整代码。
- **类型一致性**：`ReprocDto`（api）/`ReprocBody`（web）字段键名一致对齐 PMI 列名（title 非 procurementTitle）；`failedBidNoticePublished` Task 2 定义、Task 6 消费；`onPublishNotice` Task 5 定义、Task 6 接线。
