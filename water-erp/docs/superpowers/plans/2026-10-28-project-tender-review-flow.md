# 项目管理场景采购文件审查流重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目管理「采购文件编写」进入审查时：用户选知识库（自动记忆默认值）+ 选模式；未审出配置卡、已审直接看结果（指纹判过期）；报告可下载 PDF；导出确认框简化。

**Architecture:** 新建 `ProjectReviewFlow` 三态组件（配置卡/进度/结果）复用 `TenderReviewProvider` + `ReportViewCombined`；后端 `ReviewTask` 加 `projectId`/`draftFingerprint`、`UserSettings` 加 `defaultReviewKbId`（一次迁移）；新增 `project-status` 与 `report.pdf` 两端点；PDF 走 HTML → `htmlToDocxChildren` → `docx` → `convertOfficeToPdf`（LibreOffice）链路。

**Tech Stack:** NestJS 11 + Prisma（api）；Next.js 16 + React 19（web）；`docx@9`、LibreOffice headless。

**Spec:** `docs/superpowers/specs/2026-10-28-project-tender-review-flow-design.md`

## Global Constraints

- 文案全中文、禁英文黑话/AI 感（2026-10-28 裁定；格式名、键名、标准编号除外）
- RolesGuard 默认拒绝：每个新路由必须标 `@Roles`/`@AnyRole`/`@Public` 之一
- **并行会话高危文件 `apps/api/prisma/schema.prisma`**：改前 `git status` 确认无对方未提交改动；迁移必须与 schema 改动同提交；提交前 `cd apps/api && npx prisma validate`；**禁用 `git add -A`/`git add .`**，只 add 自己的文件
- 本机库有迁移漂移史：新迁移走 `--create-only` → `db execute` → `migrate resolve --applied`（勿直接 `migrate dev`）
- 单测 jest 默认超时（CI 用 20s）；e2e 口令 `<用户名>@2026`，:3005 用 `Swhi-CGZX-05`（staff）
- 前端 UI 遵循 cgzxui：neu-btn-* / 发丝线 / rounded-2xl，无渐变按钮无 emoji 图标
- 提交信息前缀 `feat(tender-review):`，尾部加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 运行单测在 `water-erp/` 下：`pnpm --filter api test -- <pattern>`

---

### Task 1: 草稿指纹 util（API）

**Files:**
- Create: `apps/api/src/tender-review/services/draft-fingerprint.util.ts`
- Test: `apps/api/src/tender-review/services/draft-fingerprint.util.spec.ts`

**Interfaces:**
- Produces: `computeDraftFingerprint(documentType: string, answers: unknown): string`（64 位 hex）；`canonicalJson(value: unknown): string`。Task 5/11 消费。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/tender-review/services/draft-fingerprint.util.spec.ts
import { canonicalJson, computeDraftFingerprint } from './draft-fingerprint.util';

describe('draft-fingerprint util', () => {
  it('键顺序不影响指纹（canonical 序列化）', () => {
    const a = computeDraftFingerprint('OPEN', { x: '1', y: { b: 2, a: 3 } });
    const b = computeDraftFingerprint('OPEN', { y: { a: 3, b: 2 }, x: '1' });
    expect(a).toBe(b);
  });

  it('数组保序（顺序不同 → 指纹不同）', () => {
    const a = computeDraftFingerprint('OPEN', { list: ['1', '2'] });
    expect(computeDraftFingerprint('OPEN', { list: ['2', '1'] })).not.toBe(a);
  });

  it('任意值或类型变更 → 指纹变化', () => {
    const base = computeDraftFingerprint('OPEN', { x: '1' });
    expect(computeDraftFingerprint('OPEN', { x: '2' })).not.toBe(base);
    expect(computeDraftFingerprint('INQUIRY', { x: '1' })).not.toBe(base);
  });

  it('输出 64 位 hex', () => {
    expect(computeDraftFingerprint('OPEN', {})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalJson 处理 null/数字/布尔', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(3)).toBe('3');
    expect(canonicalJson(true)).toBe('true');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- draft-fingerprint`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// apps/api/src/tender-review/services/draft-fingerprint.util.ts
import { createHash } from 'crypto';

/** 键排序的规范 JSON 序列化（对象键递归排序，数组保序）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/**
 * 草稿指纹：sha256(canonicalJSON({ documentType, answers }))，hex。
 * 仅用于「审查结果是否过期」判定，不作安全凭据（spec §5）。
 */
export function computeDraftFingerprint(documentType: string, answers: unknown): string {
  return createHash('sha256').update(canonicalJson({ documentType, answers })).digest('hex');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- draft-fingerprint`
Expected: PASS 5 项

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/tender-review/services/draft-fingerprint.util.ts apps/api/src/tender-review/services/draft-fingerprint.util.spec.ts
git commit -m "feat(tender-review): 草稿指纹 util（canonicalJson+sha256）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Prisma 迁移（ReviewTask 项目关联+指纹；UserSettings 默认知识库）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（ReviewTask 模型约 3729 行起、UserSettings 模型约 2959 行起）
- Create: `apps/api/prisma/migrations/20261028140000_review_task_project_fingerprint/migration.sql`

**Interfaces:**
- Produces: `ReviewTask.projectId String?`、`ReviewTask.draftFingerprint String?`、`UserSettings.defaultReviewKbId String?`（Prisma client 字段，Task 3-6/11 消费）

- [ ] **Step 1: 确认并行会话工作区干净**

Run: `git status --short`
Expected: 除本计划已提交内容外无未提交改动（若有他人改动，等待其提交后再动 schema）

- [ ] **Step 2: 改 schema.prisma**

ReviewTask 模型（`status String @default("pending")` 一行之后、`results Json?` 之前的位置均可）加：

```prisma
  projectId          String?
  draftFingerprint   String?
```

并在模型尾部 `@@index([userId])` 之后加一行：

```prisma
  @@index([projectId])
```

UserSettings 模型 `notificationPrefs Json?` 之后加：

```prisma
  defaultReviewKbId  String?
```

- [ ] **Step 3: 校验 schema**

Run: `cd apps/api && npx prisma validate`
Expected: "The schema ... is valid"

- [ ] **Step 4: 生成迁移（create-only，勿直接 migrate dev）**

Run: `cd apps/api && npx prisma migrate dev --create-only --name review_task_project_fingerprint`
Expected: 生成 `prisma/migrations/20261028*_review_task_project_fingerprint/migration.sql`。打开核对，应恰为四条语句：

```sql
-- AlterTable
ALTER TABLE "ReviewTask" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "draftFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "ReviewTask_projectId_idx" ON "ReviewTask"("projectId");

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "defaultReviewKbId" TEXT;
```

（若生成的迁移名时间戳前缀不同，以实际生成为准，后续命令同步替换。）

- [ ] **Step 5: 应用到本机库（db execute → resolve，勿 migrate deploy）**

```bash
cd apps/api
npx prisma db execute --file prisma/migrations/20261028140000_review_task_project_fingerprint/migration.sql
npx prisma migrate resolve --applied 20261028140000_review_task_project_fingerprint
npx prisma migrate status   # 应显示全部 applied、无 pending
npx prisma generate
```

- [ ] **Step 6: 提交（schema 与迁移同提交）**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261028140000_review_task_project_fingerprint/
git commit -m "feat(tender-review): ReviewTask 关联项目+草稿指纹、UserSettings 默认知识库列

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: UserSettings defaultReviewKbId 透传

**Files:**
- Modify: `apps/api/src/user-settings/dto/update-user-settings.dto.ts`
- Modify: `apps/api/src/user-settings/user-settings.service.ts:31-40`（updateSettings 的 data 展开）
- Test: `apps/api/src/user-settings/user-settings.service.spec.ts`（已存在则追加用例；不存在则新建）

**Interfaces:**
- Produces: `PATCH /api/user-settings` 接受 `defaultReviewKbId?: string`；`GET /api/user-settings` 返回该字段（service 透传，无需另改 GET）

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/user-settings/user-settings.service.spec.ts
import { UserSettingsService } from './user-settings.service';

describe('UserSettingsService', () => {
  it('updateSettings 透传 defaultReviewKbId', async () => {
    const update = jest.fn().mockResolvedValue({ id: 's1', defaultReviewKbId: 'kb-1' });
    const prisma: any = {
      userSettings: {
        upsert: jest.fn().mockResolvedValue({ id: 's1' }), // getOrCreateSettings
        update,
      },
    };
    const svc = new UserSettingsService(prisma);
    await svc.updateSettings('u1', { defaultReviewKbId: 'kb-1' } as any);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ defaultReviewKbId: 'kb-1' }),
      }),
    );
  });
});
```

（若文件已存在：在顶层 describe 内追加同名 it；其余保留。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- user-settings.service`
Expected: FAIL（update data 不含 defaultReviewKbId）

- [ ] **Step 3: 实现**

`update-user-settings.dto.ts` 末尾（`notificationPrefs` 字段后）加：

```ts
  @EmptyAsUndefined()
  @IsOptional()
  @IsString()
  defaultReviewKbId?: string;
```

`user-settings.service.ts` 的 `updateSettings` data 展开中，`notificationPrefs` 行之后加：

```ts
        ...(dto.defaultReviewKbId !== undefined && {
          defaultReviewKbId: dto.defaultReviewKbId,
        }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- user-settings.service`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/user-settings/dto/update-user-settings.dto.ts apps/api/src/user-settings/user-settings.service.ts apps/api/src/user-settings/user-settings.service.spec.ts
git commit -m "feat(user-settings): 默认审查知识库字段透传

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: executeReview 扩展（projectId/指纹落库 + 默认库记忆）

**Files:**
- Modify: `apps/api/src/tender-review/dto/review.dto.ts`（ExecuteReviewDto）
- Modify: `apps/api/src/tender-review/tender-review.controller.ts:395-440`（executeReview）
- Test: Create `apps/api/src/tender-review/tender-review.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 `computeDraftFingerprint` 不直接用（指纹由前端传）；Task 2 Prisma 字段
- Produces: `POST /api/tender-review/review/execute` 接受可选 `projectId`/`fingerprint`；项目不存在 404「项目不存在」；成功时 ReviewTask 落 `projectId`/`draftFingerprint`，且 upsert `UserSettings.defaultReviewKbId`（仅当带 projectId 时）

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/tender-review/tender-review.controller.spec.ts
import { NotFoundException } from '@nestjs/common';
import { TenderReviewController } from './tender-review.controller';

function buildController(prisma: any) {
  const controller = new TenderReviewController(
    prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any,
  );
  jest.spyOn(controller as any, 'runReview').mockResolvedValue(undefined);
  return controller;
}

const USER = { sub: 'u1', role: 'staff' } as any;
const KB = { id: 'kb-1', ownerId: 'u1', isShared: true };

describe('TenderReviewController.executeReview（项目扩展）', () => {
  it('带 projectId 时校验项目存在，不存在抛 404', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const controller = buildController(prisma);
    await expect(
      controller.executeReview(
        { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', objectKey: 'k', projectId: 'p-nope', fingerprint: 'f' } as any,
        'c', 'n.docx', 'k', USER,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('带 projectId 时落库关联+指纹并记忆默认知识库', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ id: 'p-1' }) },
      reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-1' }) },
      userSettings: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const controller = buildController(prisma);
    const res = await controller.executeReview(
      { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', objectKey: 'k', projectId: 'p-1', fingerprint: 'fp-1' } as any,
      'c', 'n.docx', 'k', USER,
    );
    expect(res).toEqual({ taskId: 't-1', status: 'running' });
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p-1', draftFingerprint: 'fp-1' }),
    });
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { defaultReviewKbId: 'kb-1' } }),
    );
  });

  it('不带 projectId 时不查项目、不写默认库记忆', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn() },
      reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-2' }) },
      userSettings: { upsert: jest.fn() },
    };
    const controller = buildController(prisma);
    await controller.executeReview(
      { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', objectKey: 'k' } as any,
      'c', 'n.docx', 'k', USER,
    );
    expect(prisma.projectManagementItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: null, draftFingerprint: null }),
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- tender-review.controller`
Expected: FAIL（DTO 无 projectId → undefined 透传；断言落库字段不符）

- [ ] **Step 3: 实现**

`review.dto.ts` 的 ExecuteReviewDto 末尾（`objectKey` 字段后）加：

```ts
  @ApiPropertyOptional({ description: '项目 ID（项目管理场景发起时必带）' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: '草稿指纹（project-status 响应回传）' })
  @IsOptional()
  @IsString()
  fingerprint?: string;
```

`tender-review.controller.ts` executeReview 内：KB 可见性校验块**之后**、`reviewTask.create` 之前加：

```ts
    // 项目关联（spec §6.2）：软关联不建外键，仅校验存在
    if (dto.projectId) {
      const project = await this.prisma.projectManagementItem.findUnique({
        where: { id: dto.projectId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('项目不存在');
    }
```

`reviewTask.create` 的 `data` 内 `userId: user?.sub,` 之后加两行：

```ts
        projectId: dto.projectId ?? null,
        draftFingerprint: dto.fingerprint ?? null,
```

create 之后、`return` 之前加（记忆默认知识库，失败不阻塞）：

```ts
    // 自动记忆默认知识库（spec §2 裁定 3）——仅项目场景
    if (dto.projectId && user?.sub) {
      await this.prisma.userSettings
        .upsert({
          where: { userId: user.sub },
          create: { userId: user.sub, theme: 'light', defaultReviewKbId: dto.knowledgeBaseId },
          update: { defaultReviewKbId: dto.knowledgeBaseId },
        })
        .catch(() => undefined);
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- tender-review.controller`
Expected: PASS 3 项

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/tender-review/dto/review.dto.ts apps/api/src/tender-review/tender-review.controller.ts apps/api/src/tender-review/tender-review.controller.spec.ts
git commit -m "feat(tender-review): execute 支持项目关联+草稿指纹落库+默认库记忆

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: project-status 端点（四态判定）

**Files:**
- Modify: `apps/api/src/tender-review/dto/review.dto.ts`（新增 ProjectStatusDto）
- Modify: `apps/api/src/tender-review/tender-review.controller.ts`（executeReview 端点之后加新端点）
- Test: `apps/api/src/tender-review/tender-review.controller.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 `computeDraftFingerprint`；Task 2 Prisma 字段
- Produces: `POST /api/tender-review/review/project-status`，body `{ projectId: string; documentType: string; answers: object }` → `{ fingerprint: string; state: 'none'|'running'|'matching'|'stale'; task?: ReviewTask }`（task 为完整 Prisma 实体，含 results）。Task 8 前端消费。

- [ ] **Step 1: 写失败测试**

在 `tender-review.controller.spec.ts` 追加：

```ts
describe('TenderReviewController.projectStatus（四态）', () => {
  const ANSWERS = { a: '1' };
  // 指纹与后端 computeDraftFingerprint('OPEN', ANSWERS) 一致性由 Task 1 单测保证；
  // 这里用真实 util 算期望值，防止硬编码漂移
  import { computeDraftFingerprint } from './services/draft-fingerprint.util';
  const FP = computeDraftFingerprint('OPEN', ANSWERS);

  it('无任务 → none', async () => {
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(null) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('none');
    expect(res.fingerprint).toBe(FP);
    expect(res.task).toBeUndefined();
  });

  it('最新任务 running → running', async () => {
    const task = { id: 't-1', status: 'running' };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(task) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('running');
    expect(res.task).toBe(task);
  });

  it('completed 且指纹一致 → matching', async () => {
    const task = { id: 't-1', status: 'completed', draftFingerprint: FP };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(task) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('matching');
  });

  it('completed 但指纹不符 / 最新为 failed → stale（前端按 task.status 细分）', async () => {
    const mismatch = { id: 't-1', status: 'completed', draftFingerprint: 'other' };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(mismatch) } };
    const controller = buildController(prisma);
    expect((await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any)).state).toBe('stale');

    const failed = { id: 't-2', status: 'failed', draftFingerprint: FP };
    const prisma2: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(failed) } };
    const controller2 = buildController(prisma2);
    expect((await controller2.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any)).state).toBe('stale');
  });
});
```

（注：`import` 语句须移到文件顶部，上面为展示位置。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- tender-review.controller`
Expected: FAIL（projectStatus 不存在）

- [ ] **Step 3: 实现**

`review.dto.ts` 追加：

```ts
export class ProjectStatusDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty()
  @IsString()
  documentType: string;

  @ApiProperty({ type: Object })
  @IsObject()
  answers: Record<string, unknown>;
}
```

（文件顶部 import 已有 `IsObject`？检查：现有 import 是 `IsString, IsOptional, IsIn`——补 `IsObject`。）

`tender-review.controller.ts`：executeReview 端点方法之后加：

```ts
  @Post('review/project-status')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: '项目管理场景：判定该项目草稿的审查状态' })
  async projectStatus(@Body() dto: ProjectStatusDto) {
    const fingerprint = computeDraftFingerprint(dto.documentType, dto.answers);
    const latest = await this.prisma.reviewTask.findFirst({
      where: { projectId: dto.projectId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) return { fingerprint, state: 'none' as const };
    if (latest.status === 'pending' || latest.status === 'running') {
      return { fingerprint, state: 'running' as const, task: latest };
    }
    if (latest.status === 'completed' && latest.draftFingerprint === fingerprint) {
      return { fingerprint, state: 'matching' as const, task: latest };
    }
    // completed 但指纹不符，或最新为 failed——task 照常携带，前端按 task.status 细分（spec §6.1）
    return { fingerprint, state: 'stale' as const, task: latest };
  }
```

并在 controller 顶部 import 区加：

```ts
import { ProjectStatusDto } from './dto/review.dto';
import { computeDraftFingerprint } from './services/draft-fingerprint.util';
```

（`ProjectStatusDto` 并入现有 `./dto/review.dto` import 行。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- tender-review.controller`
Expected: PASS（3+4 项）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/tender-review/dto/review.dto.ts apps/api/src/tender-review/tender-review.controller.ts apps/api/src/tender-review/tender-review.controller.spec.ts
git commit -m "feat(tender-review): project-status 端点（指纹四态判定）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 审查报告 PDF 服务 + 下载端点

**Files:**
- Create: `apps/api/src/tender-review/services/review-report-pdf.service.ts`
- Test: `apps/api/src/tender-review/services/review-report-pdf.service.spec.ts`
- Modify: `apps/api/src/tender-review/tender-review.module.ts`（providers 注册）
- Modify: `apps/api/src/tender-review/tender-review.controller.ts`（constructor 注入 + 新端点；controller spec 追加用例）

**Interfaces:**
- Consumes: `htmlToDocxChildren`（`project-management/docx/html-to-docx.converter`，支持 h1-h6/p/strong/b/em/i/u/br/table/li）；`convertOfficeToPdf`（`common/office-to-pdf.util`，sync、失败返回 null）
- Produces:
  - `ReviewReportPdfService.generate(task, meta): Promise<{ buffer: Buffer; fileName: string }>`，meta=`{ kbName: string | null; projectTitle: string | null }`
  - `flattenIssuesForPdf(report: unknown): PdfIssueRow[]`，`PdfIssueRow = { sectionName: string; severity: string; title: string; description: string; evidence: string; suggestion: string; status: string; resolvedAt: string | null }`
  - `GET /api/tender-review/review/tasks/:id/report.pdf`：completed 且属主（本人/admin）→ PDF 流；否则 400/403/404

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/tender-review/services/review-report-pdf.service.spec.ts
import { ReviewReportPdfService, flattenIssuesForPdf } from './review-report-pdf.service';

jest.mock('../../common/office-to-pdf.util', () => ({
  convertOfficeToPdf: jest.fn(() => ({ buffer: Buffer.from('%PDF-mock'), fileName: 'x.pdf' })),
}));
import { convertOfficeToPdf } from '../../common/office-to-pdf.util';

const REPORT = {
  summary: { totalChecks: 3, passed: 1, failed: 1, warnings: 1 },
  criticalIssues: [
    { ruleId: 'r1', ruleName: '资质要求', severity: 'critical', details: '缺少资质条款', suggestion: '补充条款', status: 'accepted', resolvedAt: '2026-10-28T10:00:00Z' },
  ],
  warnings: [
    { ruleId: 'r2', ruleName: '时限', severity: 'warning', details: '时限表述不清', suggestion: '明确天数', status: 'rejected', resolvedAt: '2026-10-28T10:01:00Z' },
  ],
  passedChecks: [{ ruleId: 'r3', ruleName: '签章', severity: 'info', details: '已含签章要求', passed: true }],
  llmFreeIssues: [
    { severity: 'info', description: '建议补充违约责任章节。', evidence: '', suggestion: '增加', status: 'pending', source: 'llm-free', sectionName: '合同条款' },
  ],
};

const TASK: any = {
  id: 't-1',
  documentName: '采购文件-测试.docx',
  reviewMode: 'general',
  status: 'completed',
  results: REPORT,
  createdAt: new Date('2026-10-28T09:00:00Z'),
  completedAt: new Date('2026-10-28T09:05:00Z'),
  knowledgeBaseId: 'kb-1',
  projectId: 'p-1',
};

describe('flattenIssuesForPdf', () => {
  it('三类来源全展开并统一字段', () => {
    const rows = flattenIssuesForPdf(REPORT);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ title: '资质要求', status: 'accepted' });
    expect(rows[3]).toMatchObject({ sectionName: '合同条款', status: 'pending' });
  });
});

describe('ReviewReportPdfService', () => {
  const svc = new ReviewReportPdfService();

  it('generate 产出 PDF buffer 与文件名', async () => {
    const { buffer, fileName } = await svc.generate(TASK, { kbName: '水利制度库', projectTitle: '测试项目' });
    expect(buffer.toString()).toBe('%PDF-mock');
    expect(fileName).toBe('采购文件-测试-审查报告.pdf');
    expect(convertOfficeToPdf).toHaveBeenCalled();
  });

  it('报告 HTML 含项目名/模式/统计/处置留痕', async () => {
    const html = svc.buildReportHtml(TASK, { kbName: '水利制度库', projectTitle: '测试项目' });
    expect(html).toContain('测试项目');
    expect(html).toContain('智能审查');
    expect(html).toContain('通过 1');
    expect(html).toContain('已接受');
    expect(html).toContain('已拒绝');
    expect(html).toContain('未处置');
  });

  it('转换失败（LibreOffice 缺失）抛明确错误', async () => {
    (convertOfficeToPdf as jest.Mock).mockReturnValueOnce(null);
    await expect(svc.generate(TASK, { kbName: null, projectTitle: null })).rejects.toThrow('PDF');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- review-report-pdf`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 service**

```ts
// apps/api/src/tender-review/services/review-report-pdf.service.ts
import { Injectable } from '@nestjs/common';
import { Document, Packer } from 'docx';
import { htmlToDocxChildren } from '../../project-management/docx/html-to-docx.converter';
import { convertOfficeToPdf } from '../../common/office-to-pdf.util';

export interface PdfIssueRow {
  sectionName: string;
  severity: string;
  title: string;
  description: string;
  evidence: string;
  suggestion: string;
  status: string;
  resolvedAt: string | null;
}

const SEVERITY_LABEL: Record<string, string> = { critical: '严重', warning: '警告', info: '提示' };
const STATUS_LABEL: Record<string, string> = { accepted: '已接受', rejected: '已拒绝', pending: '未处置' };

/** 三类来源（规则/智能章节/基础检查）统一展开——与前端 flattenReport 同口径（spec §8 处置留痕） */
export function flattenIssuesForPdf(report: any): PdfIssueRow[] {
  const rows: PdfIssueRow[] = [];
  const push = (
    r: any,
    defaults: { sectionName?: string; title?: string; passed?: boolean },
  ) => {
    const suggestion =
      typeof r.suggestion === 'string'
        ? r.suggestion
        : r.suggestion?.description ?? '';
    rows.push({
      sectionName: r.sectionName || defaults.sectionName || '',
      severity: SEVERITY_LABEL[r.severity] || r.severity || '',
      title: defaults.title || String(r.description || '').split(/[。，；]/)[0] || '',
      description: r.details || r.description || '',
      evidence: r.evidence || '',
      suggestion,
      status: STATUS_LABEL[r.status || 'pending'] || '未处置',
      resolvedAt: r.resolvedAt || null,
    });
  };
  if (report?.generalResults) {
    report.generalResults.forEach((section: any) =>
      section.issues.forEach((issue: any) => push(issue, { sectionName: section.sectionName })),
    );
  } else {
    [...(report?.criticalIssues || []), ...(report?.warnings || []), ...(report?.passedChecks || [])].forEach(
      (r: any) => push(r, { title: r.ruleName }),
    );
  }
  (report?.llmFreeIssues || []).forEach((issue: any) => push(issue, {}));
  return rows;
}

@Injectable()
export class ReviewReportPdfService {
  /** 组装报告 HTML（h1-h3/p/strong/table——htmlToDocxChildren 支持的标签集） */
  buildReportHtml(
    task: {
      documentName: string;
      reviewMode: string;
      results: unknown;
      createdAt: Date;
      completedAt: Date | null;
      projectId: string | null;
    },
    meta: { kbName: string | null; projectTitle: string | null },
  ): string {
    const report: any = task.results || { summary: { totalChecks: 0, passed: 0, failed: 0, warnings: 0 } };
    const rows = flattenIssuesForPdf(report);
    const modeLabel = task.reviewMode === 'strict' ? '规则审查' : '智能审查';
    const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString('zh-CN', { hour12: false }) : '—');
    const esc = (s: string) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
<h1>采购文件审查报告</h1>
<p><strong>所属项目：</strong>${esc(meta.projectTitle || '—')}</p>
<p><strong>审查文件：</strong>${esc(task.documentName)}</p>
<p><strong>审查模式：</strong>${modeLabel}　<strong>知识库：</strong>${esc(meta.kbName || '—')}</p>
<p><strong>开始时间：</strong>${fmt(task.createdAt)}　<strong>完成时间：</strong>${fmt(task.completedAt)}　<strong>报告生成：</strong>${fmt(new Date())}</p>
<h2>一、审查概览</h2>
<table>
  <tr><td>总检查项</td><td>通过</td><td>警告</td><td>不通过</td></tr>
  <tr><td>${report.summary.totalChecks}</td><td>通过 ${report.summary.passed}</td><td>警告 ${report.summary.warnings}</td><td>不通过 ${report.summary.failed}</td></tr>
</table>
<h2>二、问题明细（含处置留痕）</h2>
<table>
  <tr><td>序号</td><td>章节/规则</td><td>严重度</td><td>问题描述</td><td>修改建议</td><td>处置结果</td></tr>
  ${rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(r.sectionName || r.title)}</td><td>${r.severity}</td><td>${esc(r.description)}</td><td>${esc(r.suggestion)}</td><td>${r.status}${r.resolvedAt ? '（' + fmt(new Date(r.resolvedAt)) + '）' : ''}</td></tr>`,
    )
    .join('\n')}
</table>
<p>本报告由智慧水发·蜀水云采采购管理系统自动生成，处置留痕与在线审查结果一致。</p>`;
  }

  async generate(
    task: {
      documentName: string;
      reviewMode: string;
      results: unknown;
      createdAt: Date;
      completedAt: Date | null;
      projectId: string | null;
    },
    meta: { kbName: string | null; projectTitle: string | null },
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const html = this.buildReportHtml(task, meta);
    const doc = new Document({ sections: [{ properties: {}, children: htmlToDocxChildren(html) }] });
    const docxBuffer = Buffer.from(await Packer.toBuffer(doc));
    const docxName = task.documentName.replace(/\.docx?$/i, '') + '-审查报告.docx';
    const pdf = convertOfficeToPdf(
      docxBuffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docxName,
    );
    if (!pdf) {
      throw new Error('PDF 转换失败（LibreOffice 不可用），请稍后重试或联系管理员');
    }
    return { buffer: pdf.buffer, fileName: docxName.replace(/\.docx$/, '.pdf') };
  }
}
```

- [ ] **Step 4: 注册 + 端点**

`tender-review.module.ts`：providers 数组加 `ReviewReportPdfService`，并 import；controller 的 constructor 依赖列表末尾加 `private reviewReportPdf: ReviewReportPdfService,`。

controller `downloadModifiedDocument` 端点之后加：

```ts
  @Get('review/tasks/:id/report.pdf')
  @Roles('leader', 'admin', 'staff')
  @ApiOperation({ summary: '下载审查报告 PDF（含处置留痕）' })
  async downloadReportPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res() res: Response,
  ) {
    const task = await this.prisma.reviewTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在或已被删除');
    if (task.userId && task.userId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException('无权下载该审查报告');
    }
    if (task.status !== 'completed') {
      throw new BadRequestException('任务未完成，暂无报告');
    }
    const [kb, project] = await Promise.all([
      task.knowledgeBaseId
        ? this.prisma.knowledgeBase.findUnique({ where: { id: task.knowledgeBaseId }, select: { name: true } })
        : Promise.resolve(null),
      task.projectId
        ? this.prisma.projectManagementItem.findUnique({ where: { id: task.projectId }, select: { title: true } })
        : Promise.resolve(null),
    ]);
    const { buffer, fileName } = await this.reviewReportPdf.generate(task, {
      kbName: kb?.name ?? null,
      projectTitle: project?.title ?? null,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  }
```

controller spec 追加（构造时多传一个 service mock——修改 `buildController` 增加 `pdfSvc = {} as any` 参数默认值，或在新建 describe 里单独构造）：

```ts
describe('TenderReviewController.downloadReportPdf', () => {
  it('未完成任务 → 400；非属主 → 403；成功 → PDF 响应头', async () => {
    const task = { id: 't-1', userId: 'u1', status: 'running', knowledgeBaseId: null, projectId: null };
    const prisma: any = {
      reviewTask: { findUnique: jest.fn().mockResolvedValue(task) },
    };
    const pdfSvc = { generate: jest.fn().mockResolvedValue({ buffer: Buffer.from('pdf'), fileName: 'a.pdf' }) };
    const controller = new TenderReviewController(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, pdfSvc as any,
    );
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;
    const BadRequest = (await import('@nestjs/common')).BadRequestException;
    await expect(controller.downloadReportPdf('t-1', USER, res)).rejects.toBeInstanceOf(BadRequest);

    task.status = 'completed';
    task.userId = 'someone-else';
    const Forbidden = (await import('@nestjs/common')).ForbiddenException;
    await expect(controller.downloadReportPdf('t-1', USER, res)).rejects.toBeInstanceOf(Forbidden);

    task.userId = 'u1';
    await controller.downloadReportPdf('t-1', USER, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('pdf'));
  });
});
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter api test -- review-report-pdf tender-review.controller`
Expected: PASS 全部

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/tender-review/services/review-report-pdf.service.ts apps/api/src/tender-review/services/review-report-pdf.service.spec.ts apps/api/src/tender-review/tender-review.module.ts apps/api/src/tender-review/tender-review.controller.ts apps/api/src/tender-review/tender-review.controller.spec.ts
git commit -m "feat(tender-review): 审查报告 PDF 生成与下载端点（docx+LibreOffice）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: web API 层与类型

**Files:**
- Modify: `apps/web/src/lib/api/review.ts`
- Modify: `apps/web/src/lib/api/user-settings.ts`
- Modify: `apps/web/src/lib/types/tender-review.ts`

**Interfaces:**
- Consumes: Task 4/5/6 端点契约
- Produces（Task 8/9/10 消费）:
  - `checkProjectStatus(params: { projectId: string; documentType: string; answers: Record<string, unknown> }): Promise<ProjectReviewStatus>`，`ProjectReviewStatus = { fingerprint: string; state: 'none'|'running'|'matching'|'stale'; task?: ReviewTask }`
  - `executeReview` params 增加可选 `projectId?: string; fingerprint?: string`
  - `getReportPdfUrl(taskId: string): string`
  - `ReviewTask` 类型加 `projectId?: string | null; draftFingerprint?: string | null`
  - `UserSettings` 类型加 `defaultReviewKbId?: string | null`

- [ ] **Step 1: review.ts 追加**

`executeReview` 的 params 类型内 `objectKey: string;` 之后加：

```ts
  projectId?: string;
  fingerprint?: string;
```

文件末尾追加：

```ts
export interface ProjectReviewStatus {
  fingerprint: string;
  state: 'none' | 'running' | 'matching' | 'stale';
  task?: ReviewTask;
}

export async function checkProjectStatus(params: {
  projectId: string;
  documentType: string;
  answers: Record<string, unknown>;
}): Promise<ProjectReviewStatus> {
  const res = await apiFetch(`${API_BASE}/review/project-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  return handleResponse(res);
}

export function getReportPdfUrl(taskId: string): string {
  return `${API_BASE}/review/tasks/${taskId}/report.pdf`;
}
```

- [ ] **Step 2: types/tender-review.ts**

`ReviewTask` 接口 `objectKey: string;` 之后加：

```ts
  projectId?: string | null;
  draftFingerprint?: string | null;
```

- [ ] **Step 3: user-settings.ts**

`UserSettings` 类型 `notificationPrefs` 行后加：

```ts
  defaultReviewKbId?: string | null;
```

- [ ] **Step 4: 类型检查**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/api/review.ts apps/web/src/lib/types/tender-review.ts apps/web/src/lib/api/user-settings.ts
git commit -m "feat(tender-review): web 端 project-status/报告 PDF API 与类型

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: ProjectReviewFlow 组件（三态流）

**Files:**
- Create: `apps/web/src/components/tender-review/project-review-flow.tsx`

**Interfaces:**
- Consumes: Task 7 全部；`useTenderReview()`（context：`knowledgeBases`、`onReviewComplete`）；`ReportViewCombined({ task, onBack })`；`exportTenderDocument({ documentType, answers, projectCode })`；`fetchUserSettings()`
- Produces: `ProjectReviewFlow({ projectId, documentType, answers, projectCode })`（Task 9 消费）

- [ ] **Step 1: 写组件**

```tsx
// apps/web/src/components/tender-review/project-review-flow.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw, ShieldAlert, StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { ReadyTenderDocumentType, ReadyTenderDraft } from '@/lib/types/tender-write';
import type { ReviewTask } from '@/lib/types/tender-review';
import { useTenderReview } from './tender-review-context';
import ReportViewCombined from './report-view-combined';
import {
  checkProjectStatus,
  executeReview,
  fetchReviewTask,
  stopReviewTask,
  uploadReviewDocument,
} from '@/lib/api/review';
import { exportTenderDocument } from '@/lib/api/tender-write';
import { fetchUserSettings } from '@/lib/api/user-settings';

type Phase = 'checking' | 'config' | 'starting' | 'running' | 'result' | 'failed';
type ReviewMode = 'strict' | 'general';

interface ProjectReviewFlowProps {
  projectId: string;
  documentType: ReadyTenderDocumentType;
  answers: ReadyTenderDraft;
  projectCode?: string;
}

const MODE_OPTIONS: Array<{ value: ReviewMode; label: string; desc: string }> = [
  { value: 'general', label: '智能审查', desc: 'AI 逐章节语义分析，覆盖面广，耗时较长' },
  { value: 'strict', label: '规则审查', desc: '按知识库规则逐条比对，速度快、结论可解释' },
];

/** 项目管理场景的审查三态流：配置卡 → 进度 → 结果（spec §7） */
export default function ProjectReviewFlow({ projectId, documentType, answers, projectCode }: ProjectReviewFlowProps) {
  const { knowledgeBases, onReviewComplete } = useTenderReview();
  const [phase, setPhase] = useState<Phase>('checking');
  const [fingerprint, setFingerprint] = useState('');
  const [staleSource, setStaleSource] = useState(false); // 结果来自过期草稿
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [kbId, setKbId] = useState('');
  const [kbResolved, setKbResolved] = useState(false);
  const [mode, setMode] = useState<ReviewMode>('general');
  // 挂载时快照草稿——避免编辑过程中的对象引用变化触发重复检查
  const draftSnapshot = useRef(answers);

  // ---------- 挂载时判定状态（一次性） ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await checkProjectStatus({
          projectId,
          documentType,
          answers: draftSnapshot.current as unknown as Record<string, unknown>,
        });
        if (!alive) return;
        setFingerprint(st.fingerprint);
        if (st.state === 'running' && st.task) {
          setTask(st.task);
          setPhase('running');
        } else if (st.state === 'matching' && st.task) {
          setTask(st.task);
          setPhase('result');
        } else if (st.state === 'stale' && st.task?.status === 'completed') {
          setTask(st.task);
          setStaleSource(true);
          setPhase('result');
        } else if (st.state === 'stale' && st.task?.status === 'failed') {
          setTask(st.task);
          setPhase('failed');
        } else {
          setPhase('config');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '审查状态查询失败');
        setPhase('config');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 默认知识库解析（设置值 → 第一个启用库 → 置空） ----------
  useEffect(() => {
    if (kbResolved || knowledgeBases.length === 0) return;
    let cancelled = false;
    (async () => {
      let def = '';
      try {
        const settings = await fetchUserSettings();
        const remembered = settings.defaultReviewKbId;
        if (remembered && knowledgeBases.some((kb) => kb.id === remembered)) def = remembered;
      } catch { /* 设置读取失败回退 */ }
      if (!def) {
        const firstActive = knowledgeBases.find((kb) => kb.isActive);
        def = firstActive?.id ?? '';
      }
      if (!cancelled) { setKbId(def); setKbResolved(true); }
    })();
    return () => { cancelled = true; };
  }, [knowledgeBases, kbResolved]);

  // ---------- 运行中轮询 ----------
  useEffect(() => {
    if (phase !== 'running' || !task?.id) return;
    const timer = setInterval(async () => {
      try {
        const fresh = await fetchReviewTask(task.id);
        if (fresh.status === 'completed') { setTask(fresh); setPhase('result'); }
        else if (fresh.status === 'failed') { setTask(fresh); setPhase('failed'); }
        else setTask(fresh);
      } catch { /* 单次轮询失败忽略，下轮重试 */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [phase, task?.id]);

  // ---------- 开始审查（导出 → 上传 → execute） ----------
  const handleStart = useCallback(async () => {
    if (!kbId) { toast.error('请选择知识库'); return; }
    setPhase('starting');
    try {
      const exported = await exportTenderDocument({ documentType, answers, projectCode });
      const file = new File([exported.blob], exported.fileName, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const uploaded = await uploadReviewDocument(file);
      const exec = await executeReview({
        knowledgeBaseId: kbId,
        reviewMode: mode,
        documentContent: uploaded.content,
        documentName: uploaded.documentName,
        objectKey: uploaded.objectKey,
        projectId,
        fingerprint,
      });
      setTask({ id: exec.taskId, status: 'running', documentName: uploaded.documentName, reviewMode: mode } as ReviewTask);
      setPhase('running');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动审查失败');
      setPhase('config');
    }
  }, [kbId, mode, documentType, answers, projectCode, projectId, fingerprint]);

  const handleStop = useCallback(async () => {
    if (!task?.id) return;
    try {
      await stopReviewTask(task.id);
      setPhase('failed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '停止失败');
    }
  }, [task?.id]);

  const backToConfig = useCallback((prefill?: ReviewTask) => {
    if (prefill?.knowledgeBaseId) setKbId(prefill.knowledgeBaseId);
    if (prefill?.reviewMode) setMode(prefill.reviewMode);
    setStaleSource(false);
    setPhase('config');
  }, []);

  // ---------- 渲染 ----------
  if (phase === 'checking' || phase === 'starting') {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[300px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">
            {phase === 'checking' ? '正在核对审查状态…' : '正在导出并启动审查…'}
          </span>
        </div>
      </div>
    );
  }

  if (phase === 'config') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[420px] rounded-2xl border border-[oklch(0.6_0.04_258/0.14)] bg-white/70 p-6"
          style={{ boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.85), 3px 4px 14px oklch(0.45 0.07 258 / 0.12)' }}>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">开始审查</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
            选择用于比对的制度知识库与审查方式，启动后本次选择将自动记住。
          </p>

          <label className="mt-5 block text-xs font-semibold text-[color:var(--foreground)]">知识库</label>
          <select
            value={kbId}
            onChange={(e) => setKbId(e.target.value)}
            className="mt-1.5 w-full h-10 rounded-xl border border-[oklch(0.6_0.04_258/0.18)] bg-white/80 px-3 text-sm"
          >
            {knowledgeBases.length === 0 && <option value="">暂无可用知识库，请先在独立审查页创建</option>}
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name}{kb.isActive ? '' : '（未启用）'}</option>
            ))}
          </select>

          <label className="mt-4 block text-xs font-semibold text-[color:var(--foreground)]">审查方式</label>
          <div className="mt-1.5 space-y-2">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                  mode === opt.value
                    ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]/30'
                    : 'border-[oklch(0.6_0.04_258/0.14)] bg-white/60 hover:border-[oklch(0.6_0.04_258/0.28)]'
                }`}
              >
                <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                  mode === opt.value ? 'border-[color:var(--accent)] bg-[color:var(--accent)]' : 'border-[oklch(0.6_0.04_258/0.4)]'
                }`} />
                <span>
                  <span className="block text-sm font-medium text-[color:var(--foreground)]">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">{opt.desc}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={knowledgeBases.length === 0}
            className="neu-btn-primary mt-6 w-full gap-2 !h-10 text-sm"
          >
            <Play size={14} />开始审查
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-[380px] flex-col items-center gap-4 rounded-2xl border border-[oklch(0.6_0.04_258/0.14)] bg-white/70 p-8">
          <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
          <div className="text-center">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">审查进行中</div>
            <div className="mt-1 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
              正在分析采购文件，完成后自动展示结果。<br />{task?.documentName}
            </div>
          </div>
          <button type="button" onClick={() => void handleStop()} className="neu-btn-soft gap-2 !h-9 text-xs">
            <StopCircle size={14} />停止审查
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    const reason = (task?.results as { error?: string } | null)?.error || '审查未能完成';
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-[380px] flex-col items-center gap-4 rounded-2xl border border-[oklch(0.6_0.04_258/0.14)] bg-white/70 p-8">
          <ShieldAlert size={28} className="text-[color:var(--danger)]" />
          <div className="text-center">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">审查未完成</div>
            <div className="mt-1 break-all text-xs leading-relaxed text-[color:var(--muted-foreground)]">{reason}</div>
          </div>
          <button type="button" onClick={() => backToConfig(task ?? undefined)} className="neu-btn-primary gap-2 !h-10 text-sm">
            <RefreshCw size={14} />重新审查
          </button>
        </div>
      </div>
    );
  }

  // phase === 'result'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {staleSource && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-[oklch(0.75_0.14_75/0.35)] bg-[oklch(0.97_0.03_75/0.4)] px-3 py-2 text-xs text-[color:var(--foreground)]">
          <ShieldAlert size={14} className="shrink-0 text-[color:var(--warning)]" />
          <span className="flex-1">文档在本次审查后有修改，以下结果可能已过期</span>
          <button type="button" onClick={() => backToConfig()} className="neu-btn-xs gap-1">
            <RefreshCw size={12} />重新审查
          </button>
        </div>
      )}
      {task && <ReportViewCombined task={task} onBack={() => backToConfig(task)} />}
    </div>
  );
}
```

注意：`onReviewComplete` 由上层 `TenderReviewProvider` 注入 context，`ReportViewCombined` 内部自取，本组件不直接使用（保留 import 移除——若 lint 报未使用变量，从解构中去掉 `onReviewComplete`）。

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 无错误（如报 `onReviewComplete` 未使用，按上注删掉解构）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/tender-review/project-review-flow.tsx
git commit -m "feat(tender-review): 项目审查三态流组件（配置/进度/结果）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: 编写弹窗接线 + 导出确认框简化

**Files:**
- Modify: `apps/web/src/components/projects/tender-write-modal.tsx`

**Interfaces:**
- Consumes: Task 8 `ProjectReviewFlow`
- Produces: 右上角「采购文件审查」= 打开审查浮层（内部自判三态）；「导出采购文件」= 直接导出（无确认框）

- [ ] **Step 1: 状态与处理函数改动**

1. 删除 state：`showExportDialog`、`reviewLoading`（两行 `useState`）
2. 删除函数：`handleExport`（导出闸门+开对话框那个，约 507-513 行）、`handleExportAndReview`（约 569-605 行）
3. 删除 import：`TenderReviewWorkspace`、`uploadReviewDocument`、`executeReview`、`fetchKnowledgeBases`（确认 modal 内无其他引用后删；`exportTenderDocument`、`getDownloadUrl` 仍在用，保留）
4. 新增 import：

```tsx
import ProjectReviewFlow from '@/components/tender-review/project-review-flow';
```

- [ ] **Step 2: 右上角按钮改写**

原「采购文件审查」按钮（约 838-850 行）改为：

```tsx
            <button
              type="button"
              onClick={() => {
                if (!isDraftComplete) {
                  toast.error('请先完成所有章节的填写，再进行审查。');
                  return;
                }
                setShowReview(true);
              }}
              className="neu-btn-soft gap-2 h-9 text-xs"
            >
              <Search size={14} />
              采购文件审查
            </button>
```

原「导出采购文件」按钮（约 851-858 行）`onClick={handleExport}` 改为 `onClick={() => void handleDirectExport()}`。

- [ ] **Step 3: 删除导出确认框 JSX**

删除整个 `{/* 导出前确认对话框 */}` 块（约 921-975 行：`{showExportDialog && (...)}` 到对应闭合）。

- [ ] **Step 4: 审查浮层替换工作区**

浮层内（约 1030 行附近）：

```tsx
              <TenderReviewProvider onReviewComplete={handleReviewComplete}>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden h-full">
                  <TenderReviewWorkspace />
                </div>
              </TenderReviewProvider>
```

改为：

```tsx
              <TenderReviewProvider onReviewComplete={handleReviewComplete}>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden h-full">
                  {selectedType && (
                    <ProjectReviewFlow
                      projectId={project.id}
                      documentType={selectedType}
                      answers={currentDraft}
                      projectCode={project?.projectCode || undefined}
                    />
                  )}
                </div>
              </TenderReviewProvider>
```

（若 `project` 可能为 null：浮层外层已由 `project` 场景保证——检查该 modal 仅在项目上下文渲染审查入口；若 TS 报 project 可空，加 `project && selectedType &&` 条件。）

- [ ] **Step 5: 类型检查 + lint**

Run: `cd apps/web && npx tsc --noEmit && cd .. && pnpm --filter web lint`
Expected: 无错误、无未使用变量告警

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/projects/tender-write-modal.tsx
git commit -m "feat(tender-write): 审查入口接三态流、导出确认框简化为直接导出

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: 报告视图 PDF 下载按钮（两入口共用）

**Files:**
- Modify: `apps/web/src/components/tender-review/report-view-combined.tsx`（header 操作区，现有「导出」按钮旁，约 280-300 行）

**Interfaces:**
- Consumes: Task 7 `getReportPdfUrl`；`apiFetch`

- [ ] **Step 1: 加处理函数**

组件内（`getDownloadUrl, resolveIssue` import 行并入 `getReportPdfUrl`）加：

```tsx
  const handleDownloadPdf = useCallback(async () => {
    try {
      const res = await apiFetch(getReportPdfUrl(task.id), { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || '报告生成失败，请稍后重试');
      }
      const blob = await res.blob();
      const disp = res.headers.get('content-disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
      const fileName = m
        ? decodeURIComponent(m[1])
        : `${task.documentName.replace(/\.docx?$/i, '')}-审查报告.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '报告生成失败');
    }
  }, [task.id, task.documentName]);
```

（`apiFetch` 已在该文件 import？检查——若无需补 `import { apiFetch } from '@/lib/api/api-fetch';`）

- [ ] **Step 2: 加按钮**

现有「导出」按钮（`<Download .../> 导出`）之后并排加：

```tsx
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium transition-colors bg-[color:mix(in_oklch,var(--accent-soft)_45%,transparent)] text-[color:var(--accent)] hover:bg-[color:mix(in_oklch,var(--accent-soft)_65%,transparent)]"
          >
            <FileDown className="h-3 w-3" />
            审查报告 PDF
          </button>
```

（`FileDown` 并入 lucide import。）

- [ ] **Step 3: 类型检查**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/tender-review/report-view-combined.tsx
git commit -m "feat(tender-review): 报告视图提供 PDF 下载（两入口共用）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: e2e（项目审查流）

**Files:**
- Create: `apps/api/test/tender-review-project.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 util、Task 4/5/6 端点；种子：`Swhi-CGZX-05`/`Swhi-CGZX-05@2026`（staff，web 门户）、`ProjectManagementItem.json` 种子、`KnowledgeBase.json` 种子

- [ ] **Step 1: 写 spec**

```ts
// apps/api/test/tender-review-project.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { computeDraftFingerprint } from '../src/tender-review/services/draft-fingerprint.util';

async function loginAs(app: INestApplication, username: string, password: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', 'web')
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('项目管理采购文件审查流 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string[];
  let projectId: string;
  let kbId: string;
  const answers = { chapter1: '正文内容甲', budget: '100' };
  const fingerprint = computeDraftFingerprint('OPEN', answers);
  let originalKbPref: string | null | undefined;
  let staffUserId: string;
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    cookie = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026');
    // username 为 [username, role] 复合唯一（不再单列唯一），须 findFirst
    staffUserId = (await prisma.user.findFirst({ where: { username: 'Swhi-CGZX-05' } }))!.id;

    const project = await prisma.projectManagementItem.findFirst();
    expect(project).toBeTruthy();
    projectId = project!.id;
    // 清理该项目历史任务，保证 none 态可测（dev 库可能有残留）
    await prisma.reviewTask.deleteMany({ where: { projectId } });

    const kb = await prisma.knowledgeBase.findFirst();
    expect(kb).toBeTruthy();
    kbId = kb!.id;

    const settings = await prisma.userSettings.findUnique({ where: { userId: staffUserId } });
    originalKbPref = settings?.defaultReviewKbId ?? null;
  });

  afterAll(async () => {
    await prisma.reviewTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    if (staffUserId) {
      await prisma.userSettings.upsert({
        where: { userId: staffUserId },
        create: { userId: staffUserId, theme: 'light', defaultReviewKbId: originalKbPref ?? null },
        update: { defaultReviewKbId: originalKbPref ?? null },
      });
    }
    await app.close();
  });

  it('未审查 → none', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('none');
    expect(res.body.fingerprint).toBe(fingerprint);
  });

  it('execute 带项目关联 → running + 默认库记忆', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({
        knowledgeBaseId: kbId,
        reviewMode: 'general',
        documentContent: '测试正文',
        documentName: 'e2e-采购文件.docx',
        objectKey: 'review/e2e-test',
        projectId,
        fingerprint,
      });
    expect(res.status).toBe(201);
    createdTaskIds.push(res.body.taskId);

    const task = await prisma.reviewTask.findUnique({ where: { id: res.body.taskId } });
    expect(task?.projectId).toBe(projectId);
    expect(task?.draftFingerprint).toBe(fingerprint);

    const settings = await prisma.userSettings.findUnique({ where: { userId: staffUserId } });
    expect(settings?.defaultReviewKbId).toBe(kbId);
  });

  it('运行中 → running（防重复）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('running');
  });

  it('完成且指纹一致 → matching；报告 PDF 可下载或明确失败', async () => {
    const taskId = createdTaskIds[0];
    await prisma.reviewTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        results: { summary: { totalChecks: 1, passed: 1, failed: 0, warnings: 0 }, criticalIssues: [], warnings: [], passedChecks: [{ ruleId: 'r1', ruleName: '签章', severity: 'info', details: 'ok', passed: true }] },
      },
    });
    const st = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers });
    expect(st.body.state).toBe('matching');

    const pdf = await request(app.getHttpServer())
      .get(`/api/tender-review/review/tasks/${taskId}/report.pdf`)
      .set('Cookie', cookie)
      .set('X-Portal', 'web');
    // 本机装了 LibreOffice → 200 + pdf；CI 无 LibreOffice → 500 + 明确 message（spec §10）
    if (pdf.status === 200) {
      expect(pdf.headers['content-type']).toBe('application/pdf');
    } else {
      expect(pdf.status).toBe(500);
    }
  });

  it('草稿变更 → stale', async () => {
    const changed = { ...answers, budget: '200' };
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/project-status')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ projectId, documentType: 'OPEN', answers: changed });
    expect(res.body.state).toBe('stale');
    expect(res.body.task.status).toBe('completed');
  });

  it('未完成任务请求报告 → 400；不存在项目 execute → 404', async () => {
    const pending = await prisma.reviewTask.create({
      data: {
        documentName: 'x.docx', objectKey: 'review/x', documentContent: 'c',
        knowledgeBaseId: kbId, userId: staffUserId, reviewMode: 'general', status: 'running',
      },
    });
    createdTaskIds.push(pending.id);
    const bad = await request(app.getHttpServer())
      .get(`/api/tender-review/review/tasks/${pending.id}/report.pdf`)
      .set('Cookie', cookie)
      .set('X-Portal', 'web');
    expect(bad.status).toBe(400);

    const noProj = await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({
        knowledgeBaseId: kbId, reviewMode: 'general', documentContent: 'c',
        documentName: 'n.docx', objectKey: 'k', projectId: 'pmi-not-exist', fingerprint: 'f',
      });
    expect(noProj.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑 e2e**

Run: `pnpm --filter api test:e2e -- tender-review-project`
Expected: 6 项全 PASS

- [ ] **Step 3: 提交**

```bash
git add apps/api/test/tender-review-project.e2e-spec.ts
git commit -m "test(tender-review): 项目审查流 e2e（四态/记忆/PDF/边界）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: 全链路验证

**Files:** 无新改动（验证 + 修补）

- [ ] **Step 1: 全量相关单测**

Run: `pnpm --filter api test -- tender-review user-settings`
Expected: PASS（含存量 spec 无回归）

- [ ] **Step 2: 前端类型 + lint**

Run: `cd apps/web && npx tsc --noEmit && cd ../.. && pnpm --filter web lint`
Expected: 均通过

- [ ] **Step 3: 重启全链验证迁移生效**

Run: `pnpm dev:kill && pnpm dev`（等待编译完成）
验证：10 端口全监听（`lsof -i :4001 -i :3005` 等）；`curl -s localhost:4001/api/docs -o /dev/null -w '%{http_code}'` → 200

- [ ] **Step 4: 浏览器手动冒烟**

用 `Swhi-CGZX-05`/`Swhi-CGZX-05@2026` 登 :3005 → 项目管理 → 打开一个项目 → 采购文件编写 → 完成草稿 →：
1. 右上角「采购文件审查」→ 出现配置卡（知识库下拉+审查方式单选，默认智能审查）
2. 开始审查 → 进度态 → 完成后结果视图（或失败视图带重试）
3. 结果视图逐条处置一项 →「审查结束，提交采购文件」→ 上传确认弹窗（现有闭环）
4. 关闭浮层再点「采购文件审查」→ **直接展示结果**（matching，无配置卡）
5. 改草稿任一字段 → 再点审查 → 结果 + 过期提示条 + 重新审查按钮
6. 报告视图「审查报告 PDF」→ 下载 PDF，打开核对：项目名/统计/明细/处置留痕
7. 「导出采购文件」→ 直接下载+上传项目阶段（无三按钮确认框）
8. 独立页 /tender-review → 工作台原样（上传/最近记录/统计在），报告也有 PDF 按钮

- [ ] **Step 5: 提交（若有修补）并汇报**

```bash
git status --short   # 核对仅自己文件
git add <修补文件>
git commit -m "fix(tender-review): 全链路验证修补

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 自审记录

- **Spec 覆盖**：§4 迁移→Task 2；§5 指纹→Task 1；§6.1→Task 5；§6.2→Task 4；§6.3→Task 6；§6.4→Task 3；§7 三态→Task 8/9；§7.1→Task 9；§7.2→Task 10；§8 内容→Task 6 buildReportHtml；§9 边界→Task 4/5/6/11；§10 测试→各 Task + 11；§11 并行会话/迁移→Global Constraints + Task 2。无缺口。
- **占位符扫描**：无 TBD/TODO；所有代码块完整。
- **类型一致性**：`computeDraftFingerprint(documentType, answers)` 各处一致；`ProjectReviewStatus.state` 四值前后端一致；`ReviewReportPdfService.generate(task, meta)` 签名 Task 6 内一致；`ProjectReviewFlow` props 与 Task 9 调用一致；controller spec 构造参数顺序 = controller constructor 声明顺序（prisma, storage, parser, ruleExtractor, fieldExtractor, ruleExecutor, semanticReviewer, generalReviewer, llmFreeReviewer, reportGenerator，Task 6 后追加 reviewReportPdf 为第 11 参）。
