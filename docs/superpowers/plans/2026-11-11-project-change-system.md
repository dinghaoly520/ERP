# 项目变更体系实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目基本信息的唯一人工编辑通道=变更弹窗：轮次留痕（含必填理由）、阶段闸门、开标时间变更强制发变更公告（弹窗内、推 SCM0003）。

**Architecture:** 新表 `ProjectChangeRecord` 存变更流水；后端新 `ProjectChangeService` 统一登记（字段白名单+阶段闸门+diff+轮次），PMI 既有手改端点加闸只许变更通道内部调用；前端标题行按钮双形态（发起/记录），变更/补遗/记录全部弹窗化；公告向导扩 `change_notice` 类目，sunshine 推送加 SCM0003 分支。

**Tech Stack:** NestJS 11 + Prisma（手写迁移：create sql → `prisma db execute` → `migrate resolve --applied` → `generate`）、Next.js 16 + React 19、jest。

**Spec:** `docs/superpowers/specs/2026-11-11-project-change-system-design.md`（实现中口径冲突以 spec 为准）

## Global Constraints

- 迁移一律手写 SQL 文件 + `npx prisma db execute` + `npx prisma migrate resolve --applied` + `npx prisma generate`（本仓既定流程，禁 `migrate dev`）— 在 `apps/api` 目录执行
- 「开标后」判定 = 关联 BidProject.stage ∈ {OPENING, EVALUATING, ARCHIVED}；按钮置灰提示文案固定：**「开标后不可修改标前数据」**
- 变更理由必填；操作人留痕用 `displayName`（禁裸 username）
- 开标时间写入 PMI `bidOpeningTime` 用中文格式且固定 +08 墙钟（`YYYY年M月D日 HH:mm`，禁用本地 `getFullYear/getHours` 直接格式化）
- 供应商名单、专家名单字段（`biddingUnits`/专家表）**不在变更白名单**——提示走既有流程卡维护
- 前端组件遵循 cgzxui/面板既有样式（参照 `project-detail-panel.tsx` 现有 Modal 与表单写法）；文案全中文
- 提交只 add 本计划涉及的文件路径（并行会话在库，禁 `git add -A`）；提交信息带 `feat(change):` 前缀
- 每个任务完成即提交；测试命令统一在 `apps/api`（jest）或 `apps/web`（tsc）下执行

---

### Task 1: 数据模型——ProjectChangeRecord 表 + AnnouncementType 加 CHANGE_NOTICE

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（ProjectManagementItem 模型后加新 model；`enum AnnouncementType` 加值）
- Create: `apps/api/prisma/migrations/20261111060000_project_change_record/migration.sql`
- Test: 无独立测试（结构任务，Task 3 的服务测试覆盖）

**Interfaces:**
- Produces: Prisma model `ProjectChangeRecord`（Task 3 服务消费）；enum 值 `'CHANGE_NOTICE'`（Task 7 消费）

- [ ] **Step 1: schema 加模型与枚举值**

在 `schema.prisma` 的 `model ProjectManagementItem` 定义之后追加：

```prisma
// 项目变更记录（2026-11-11 变更体系）：基本信息唯一人工编辑通道=变更弹窗——
// 每次变更/补遗登记一条（轮次项目内自增），字段级 diff + 必填理由留痕。
model ProjectChangeRecord {
  id                       String   @id @default(cuid())
  projectManagementItemId  String
  round                    Int      // 项目内轮次（变更与补遗共序，自增）
  type                     String   // 'CHANGE' | 'ADDENDUM'
  reason                   String   // 变更理由（必填）
  changeset                Json     // [{ field, label, from, to, stageKey }]
  needsAnnouncement        Boolean  @default(false) // 涉及开标时间→须发变更公告
  announcementId           String?  // 关联变更/补遗公告（发布后回填）
  operatorId               String
  operatorName             String   // displayName 快照
  createdAt                DateTime @default(now())

  @@index([projectManagementItemId, round])
}
```

`enum AnnouncementType` 末尾（`CLARIFY_NOTICE` 行后）加：

```prisma
  CHANGE_NOTICE // 变更公告（2026-11-11 变更体系：开标时间等信息变更的对外公告，推 SCM0003）
```

- [ ] **Step 2: 手写迁移并应用**

```bash
cd apps/api
MIG=20261111060000_project_change_record
mkdir -p prisma/migrations/$MIG
cat > prisma/migrations/$MIG/migration.sql <<'SQL'
CREATE TABLE "ProjectChangeRecord" (
    "id" TEXT NOT NULL,
    "projectManagementItemId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changeset" JSONB NOT NULL,
    "needsAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "announcementId" TEXT,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectChangeRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectChangeRecord_projectManagementItemId_round_idx" ON "ProjectChangeRecord"("projectManagementItemId", "round");
ALTER TYPE "AnnouncementType" ADD VALUE 'CHANGE_NOTICE';
SQL
npx prisma db execute --file prisma/migrations/$MIG/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied $MIG
npx prisma generate
npx prisma migrate status   # 期望：up to date
```

注意：`ADD VALUE` 与其他语句同文件在 PG 下可用（非事务块执行）；若 db execute 报 `ADD VALUE cannot run inside a transaction block`，把 ALTER TYPE 拆成第二个 sql 文件单独执行后再 resolve。

- [ ] **Step 3: 验证 schema 合法**

Run: `npx prisma validate`
Expected: `The schema ... is valid`

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261111060000_project_change_record
git commit -m "feat(change): ProjectChangeRecord 表与 CHANGE_NOTICE 公告类型（迁移+schema）"
```

---

### Task 2: 阶段闸门纯函数——字段分组与解锁判定

**Files:**
- Create: `apps/api/src/project-management/change-fields.ts`
- Test: `apps/api/src/project-management/change-fields.spec.ts`

**Interfaces:**
- Produces:
  - `CHANGE_FIELD_GROUPS: Array<{ key: 'basic'|'document'|'notice'; label: string; stageKey: string; fields: ChangeFieldDef[] }>`
  - `type ChangeFieldDef = { field: string; label: string; kind: 'text'|'number'|'datetime'; target: 'PMI'|'BID' }`
  - `stageReached(allStages: string[], currentStage: string | null, groupStageKey: string): boolean` —— 组的阶段序 ≤ 当前阶段序
  - `FORBIDDEN_FIELDS: string[]`（`biddingUnits` 等供应商/专家名单字段）

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/project-management/change-fields.spec.ts
import { CHANGE_FIELD_GROUPS, stageReached, FORBIDDEN_FIELDS, findFieldGroup } from './change-fields';

const STAGES = ['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT'];

describe('变更字段分组与阶段闸门', () => {
  it('三组均有阶段锚点，且开标时间在公告组', () => {
    expect(CHANGE_FIELD_GROUPS.map(g => g.key)).toEqual(['basic', 'document', 'notice']);
    const notice = findFieldGroup('bidOpeningTime');
    expect(notice?.key).toBe('notice');
  });
  it('供应商/专家名单字段禁入白名单', () => {
    const all = CHANGE_FIELD_GROUPS.flatMap(g => g.fields.map(f => f.field));
    for (const f of FORBIDDEN_FIELDS) expect(all).not.toContain(f);
    expect(FORBIDDEN_FIELDS).toContain('biddingUnits');
  });
  it('stageReached：当前阶段=立项 → basic 解锁、document/notice 锁', () => {
    expect(stageReached(STAGES, 'INITIATION', 'INITIATION')).toBe(true);
    expect(stageReached(STAGES, 'INITIATION', 'TENDER_DOCUMENT')).toBe(false);
    expect(stageReached(STAGES, 'PUBLIC_ANNOUNCEMENT', 'TENDER_DOCUMENT')).toBe(true);
  });
  it('currentStage 空（项目无阶段指针）→ 仅 basic 组可改', () => {
    expect(stageReached(STAGES, null, 'INITIATION')).toBe(true);
    expect(stageReached(STAGES, null, 'TENDER_DOCUMENT')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx jest change-fields --silent`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// apps/api/src/project-management/change-fields.ts
/** 变更体系字段白名单与阶段闸门（2026-11-11 spec §2）——供应商/专家名单例外，不在白名单 */
export type ChangeFieldDef = { field: string; label: string; kind: 'text' | 'number' | 'datetime'; target: 'PMI' | 'BID' };

export const FORBIDDEN_FIELDS = ['biddingUnits', 'experts'] as const;

export const CHANGE_FIELD_GROUPS = [
  {
    key: 'basic', label: '基本信息', stageKey: 'INITIATION',
    fields: [
      { field: 'title', label: '项目名称', kind: 'text', target: 'PMI' },
      { field: 'procurementCategory', label: '采购类别', kind: 'text', target: 'PMI' },
      { field: 'budget', label: '预算金额', kind: 'number', target: 'PMI' },
      { field: 'requesterName', label: '需求人', kind: 'text', target: 'PMI' },
      { field: 'requesterDepartment', label: '需求部门', kind: 'text', target: 'PMI' },
      { field: 'projectOverview', label: '项目概况', kind: 'text', target: 'PMI' },
    ],
  },
  {
    key: 'document', label: '采购文件', stageKey: 'TENDER_DOCUMENT',
    fields: [
      { field: 'qualification', label: '资格要求', kind: 'text', target: 'BID' },
      { field: 'scope', label: '供货范围', kind: 'text', target: 'BID' },
      { field: 'qualityRequirement', label: '质量要求', kind: 'text', target: 'BID' },
    ],
  },
  {
    key: 'notice', label: '公告与时间', stageKey: 'TENDER_DOCUMENT',
    fields: [
      { field: 'bidOpeningTime', label: '开标时间', kind: 'datetime', target: 'PMI' },
    ],
  },
] as const;

/** 全阶段序（与 web PROCUREMENT_METHOD_STAGES 共同子集——判定只用相对顺序） */
const STAGE_ORDER = ['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'SUPPLIER_INVITATION', 'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT', 'DIRECT_PURCHASE_FILING'];

export function stageReached(allStages: string[], currentStage: string | null, groupStageKey: string): boolean {
  const order = allStages.length ? allStages : STAGE_ORDER;
  const cur = currentStage ? order.indexOf(currentStage) : order.indexOf('INITIATION'); // 无指针视为刚立项
  const need = order.indexOf(groupStageKey);
  return cur >= 0 && need >= 0 && cur >= need;
}

export function findFieldGroup(field: string) {
  return CHANGE_FIELD_GROUPS.find(g => g.fields.some(f => f.field === field));
}
```

- [ ] **Step 4: 跑测试确认绿** — `npx jest change-fields --silent` → 4 passed

- [ ] **Step 5: Commit** — `git add apps/api/src/project-management/change-fields.ts apps/api/src/project-management/change-fields.spec.ts && git commit -m "feat(change): 字段白名单三组与阶段闸门纯函数（TDD）"`

---

### Task 3: ProjectChangeService——登记端点（理由必填/diff/轮次/闸门）

**Files:**
- Create: `apps/api/src/project-management/change.service.ts`
- Create: `apps/api/src/project-management/change.controller.ts`（或并入既有 controller——按仓库惯例并入 `project-management.controller.ts` 新路由段）
- Modify: `apps/api/src/project-management/project-management.module.ts`（注册 service）
- Test: `apps/api/src/project-management/change.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 model、Task 2 `CHANGE_FIELD_GROUPS/stageReached/findFieldGroup/FORBIDDEN_FIELDS`；PMI 既有 `syncBidProjectOpeningFromPmi`（改为可注入调用：把该方法从 private 改 public 或抽到 service 公共方法——**采用抽公共方法 `applyOpeningTimeToPmi(projectId, date)`**，内部仍走原 sync）
- Produces:
  - `POST /project-management/:id/changes` body `{ type: 'CHANGE'|'ADDENDUM', reason: string, fields: Record<string, string|number|null> }` → `{ record, needsAnnouncement }`
  - `GET /project-management/:id/changes` → `{ records: ProjectChangeRecord[] }`（round 倒序，take 100）
  - `PATCH /project-management/changes/:recordId/announcement` body `{ announcementId: string }`（公告发布后回填）

**核心行为（测试必须锁定）：**
1. 理由空/纯空格 → 400 `REASON_REQUIRED`
2. 字段不在白名单（含 `biddingUnits`）→ 400 `FIELD_NOT_ALLOWED`，错误文案指向对应流程卡
3. 字段所属组被阶段闸门锁住 → 400 `STAGE_LOCKED`「未进入 ×× 阶段，不可变更」
4. BidProject 已 OPENING+ → 400 `BID_LOCKED`「开标后不可修改标前数据」
5. 无变化值（from==to）→ 400 `NO_CHANGE`（防空轮次）
6. 成功：轮次=项目内 max+1；diff 记 from/to/label/stageKey；`bidOpeningTime` 变更 → `needsAnnouncement=true` 且 PMI 开标时间按中文格式+08 写入并触发既有 sync（BidProject openTime/deadline 对齐）
7. PMI 基本字段写入 PMI 表；BID 字段写入 BidProject（取当前轮 `round` 最大且未归档行）

**开标时间中文格式化（复用口径，新建 util）：**

```ts
// apps/api/src/project-management/change.service.ts 内
/** Date → PMI 中文开标时间（固定 +08 墙钟——beijing-wallclock 裁定，禁本地时区构造） */
function formatBeijingCn(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  const bj = new Date(d.getTime() + 8 * 3600_000);
  return `${bj.getUTCFullYear()}年${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日 ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`;
}
```

**测试骨架（mock prisma，参照 `supplier-link.service.spec.ts` 的 mkSide 模式）：**

```ts
// change.service.spec.ts 核心用例（写全 7 条行为）
const mk = (over: any = {}) => ({
  prisma: {
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(over.pmi ?? { id: 'p1', title: '原名', currentStage: 'INITIATION', stages: [{ stageKey: 'PROCUREMENT_DEMAND' }, { stageKey: 'INITIATION' }] }) },
    projectChangeRecord: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'cr1', round: 1 }), update: jest.fn() },
    bidProject: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    $transaction: jest.fn((fn: any) => fn({ projectManagementItem: { update: jest.fn() }, projectChangeRecord: { create: jest.fn().mockResolvedValue({ id: 'cr1' }) }, bidProject: { update: jest.fn() } })),
  },
});
it('理由必填 → 400 REASON_REQUIRED', async () => {
  await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: '  ', fields: { title: '新名' } }))
    .rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
});
// …其余 6 条同构（白名单/闸门/开标锁/空变更/轮次自增/needsAnnouncement+sync 触发）
```

**步骤：**
- [ ] Step 1: 写失败测试（上述 7 用例，含 sync 被调用的 spy 断言）
- [ ] Step 2: `npx jest change.service --silent` → 红
- [ ] Step 3: 实现 service（`register/list/bindAnnouncement` 三方法；事务内：读现值→校验→写目标表→`projectChangeRecord.create`；开标时间分支调 `applyOpeningTimeToPmi`）
- [ ] Step 4: 跑绿；controller 加三路由（`@Roles('staff','leader','admin')` + 既有 PmiOwnershipGuard 写闸沿用：写操作仅创建人——register 路由挂 guard，list 不挂只读）
- [ ] Step 5: `npx tsc --noEmit -p tsconfig.json` → 0
- [ ] Step 6: Commit — `feat(change): 变更登记服务与三端点（理由/diff/轮次/阶段闸门，TDD）`

---

### Task 4: 收紧 PMI 手改端点——人工编辑只走变更

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（`updateExtractedInfo` ~4388 行、`aiIdentifyField` 对应方法）
- Modify: `apps/api/src/project-management/dto/update-extracted-info.dto.ts`（加 `@IsOptional() internal?: boolean`）
- Test: `apps/api/src/project-management/change-gate.spec.ts`（新建，聚焦闸门）

**行为：**
- `updateExtractedInfo(id, dto, { internal })`：`dto.internal !== true` 且含白名单内字段 → 400 `CHANGE_ONLY`「项目基本信息修改请通过「变更 / 补遗」流程登记」
- `internal=true` 仅由 Task 3 的 change.service 服务端调用传参（同进程直调，非 HTTP 头）
- AI 批量提取路径（`extractTenderFields`/`extract-initiation`/`extract-demand`）**不加闸**（系统建档录入，spec §2 例外）
- `ai-identify-field`（人工确认识别值写回）**加同款闸**

- [ ] Step 1: 失败测试：非 internal 调 `updateExtractedInfo({ title: 'x' })` → 400 CHANGE_ONLY；internal=true 正常写
- [ ] Step 2: 红 → 实现（两方法开头加闸）→ 绿
- [ ] Step 3: `npx jest project-management --silent`（既有套件不破）+ tsc
- [ ] Step 4: Commit — `feat(change): PMI 手改端点收紧——人工编辑唯一入口=变更流程（CHANGE_ONLY 闸）`

---

### Task 5: 前端——标题行按钮（双形态）+ 变更记录弹窗

**Files:**
- Create: `apps/web/src/lib/api/project-changes.ts`（`registerChange/listChanges/bindChangeAnnouncement` 三函数，走既有 `apiFetch` 基座——参照 `lib/api/company-info.ts` 的 request 模式）
- Create: `apps/web/src/components/projects/change-button.tsx`（按钮+状态矩阵）
- Create: `apps/web/src/components/projects/change-records-modal.tsx`（记录列表+diff 详情）
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`（标题行 1681 行附近挂按钮）

**按钮状态矩阵（组件内 `variant` 计算）：**

| 条件 | 展现 | 行为 |
|---|---|---|
| `isOwner && !bidLocked` | 「⟳ 变更 / 补遗」主按钮 | 打开变更弹窗（Task 6） |
| `isOwner && bidLocked` | 「变更 / 补遗记录」软按钮 | 打开记录弹窗 |
| `!isOwner` | 「变更 / 补遗记录」软按钮 | 打开记录弹窗 |

- `isOwner` = 当前登录用户 id === 项目创建人（面板已有 `actionsDisabled` 同源判定，直接复用其变量链）
- `bidLocked` = 面板已有 `isBidLocked` 变量
- 若误点发起态（竞态开标后）：toast「开标后不可修改标前数据」（后端同文案兜底）

**记录弹窗**：Modal（z 层级/样式抄 `project-detail-panel.tsx` 既有 Modal）；列表行 = 轮次徽标 · 类型（变更/补遗）· 摘要（`changeset` 首条 label：from→to）· 理由 · 操作人 · 时间 · 「公告待发」红标（`needsAnnouncement && !announcementId`）；点行展开字段级 diff 表。

- [ ] Step 1: 实现 `lib/api/project-changes.ts`（三函数 + 类型 `ProjectChangeRecord`，字段与 Task 1 模型一致）
- [ ] Step 2: 实现两组件并在标题行挂载（`variant` 矩阵如上）
- [ ] Step 3: `npx tsc --noEmit`（web）→ 0；手工冒烟说明写入任务注释（dev 起后人工过）
- [ ] Step 4: Commit — `feat(change): 标题行双形态按钮与变更记录弹窗`

---

### Task 6: 变更/补遗弹窗（三步）+ 左栏只读化

**Files:**
- Create: `apps/web/src/components/projects/change-modal.tsx`
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`（`handleStartEdit` ~1203 行：删除编辑态分支，改为 toast「请通过标题栏「变更 / 补遗」发起变更」；移除字段的编辑图标渲染——保留展示）

**弹窗三步：**
1. 类型选择：⟳ 变更 ｜ 📄 补遗（补遗走既有补遗链路提示——v1 补遗按钮引导至既有补遗入口并登记 ADDENDUM 轮次：调用 register `type=ADDENDUM, fields={}` 不带字段只留痕，`reason` 复用理由框）
2. 变更表单：按 `CHANGE_FIELD_GROUPS`（前端复制一份同构常量到 `apps/web/src/lib/change-fields.ts`，含 `stageReached`——两端同源口径注释互指）分组渲染；锁定组禁用+灰提示「未进入 ×× 阶段，不可变更」；`bidOpeningTime` 用 datetime-local，保存前按 +08 转 ISO 提交
3. 理由必填 textarea + 保存 → `registerChange`；成功后：`needsAnnouncement=true` → 立即拉起公告向导（Task 7）并 toast「开标时间已变更，须发布变更公告」；否则刷新面板 + 打开记录弹窗高亮新轮次

**左栏只读化**：`handleStartEdit` 函数体替换为单一 toast；`editingField` 相关渲染分支保留但不可达（或一并清理编辑图标按钮——采用清理：字段旁「编辑」铅笔按钮删除）。

- [ ] Step 1: 建 `apps/web/src/lib/change-fields.ts`（常量镜像 + `stageReached`，与后端字段一致——注释注明「与 apps/api change-fields.ts 同源，改动须两端同步」）
- [ ] Step 2: 实现 `change-modal.tsx`（三步 + 校验：理由非空、至少一个字段有变）
- [ ] Step 3: 面板接入（按钮 onClick 打开；`onUpdated` 走既有 `handleUpdated` 刷新链）
- [ ] Step 4: 左栏只读化改造
- [ ] Step 5: `npx tsc --noEmit`（web）→ 0
- [ ] Step 6: Commit — `feat(change): 变更/补遗三步弹窗与左栏基本信息只读化`

---

### Task 7: 变更公告——向导类目 + SCM0003 推送

**Files:**
- Modify: `apps/web/src/lib/types/announcement.ts`（`AnnouncementCategory` 加 `'change_notice'`；类目元数据加标签「变更公告」橙色系）
- Modify: `apps/web/src/components/projects/announcement-publish-wizard.tsx`（类目模板：正文模板=变更摘要（轮次/理由/字段 diff 表）；`SUNSHINE_CATEGORY_INTERFACE` 加 `change_notice: { code: 'SCM0003', name: '变更公告信息' }`——该 Record 键全集必须同步，否则 tsc 红）
- Modify: `apps/api/src/announcement/sunshine-push.service.ts`（`SCM_PATHS` 加 `SCM0003: '/dataService/import/announcementChanges'`；`onPublish` 加 SCM0003 分支：**不推 SCM0001 前缀**，单发 changes 报文）
- Test: `apps/api/src/announcement/sunshine-change-push.spec.ts`（新建）

**SCM0003 报文构造（service 内）：**

```ts
if (snap.interfaceCode === 'SCM0003') {
  const c = snap.config;
  const payload = {
    identity,
    planUnique: snap.projectId || c.projectCode || c.planCode,
    changes: [{
      unique: `${snap.projectId}-change-${snap.round ?? 1}`,
      publishTime: apiTime(c.publishTime),
      round: snap.round ?? 1,
      content: announcement.content || c.content || '',
    }],
  };
  // 单接口直发（无 SCM0001 前缀——计划已由首发公告建立）
}
```

向导快照 `meta.sunshinePublish` 增量字段：`round`（变更轮次，Task 6 传入）。

**测试**：mock fetch——SCM0003 快照发布 → 恰好一次 POST `/dataService/import/announcementChanges`，报文含 `changes[0].round`；不请求 `/information`。

- [ ] Step 1: 后端失败测试（SCM0003 单发语义）→ 红
- [ ] Step 2: sunshine service 实现 + `SCM_PATHS` 扩展 → 绿
- [ ] Step 3: 前端类目扩展（union/元数据/模板/阳光映射），Task 6 弹窗在 `needsAnnouncement` 时以 `initialCategory='change_notice'` + `round` 拉起向导
- [ ] Step 4: 两端 tsc + `npx jest sunshine --silent` 全绿
- [ ] Step 5: Commit — `feat(change): 变更公告类目与 SCM0003 单发推送`

---

### Task 8: 收尾验证

- [ ] `cd apps/api && npx jest --silent`（全量；既有 4 个存量红除外——见会话记录，非本批引入）
- [ ] `npx tsc --noEmit`（api+web 双端 0）
- [ ] `npx prisma migrate status` 干净
- [ ] 手工冒烟清单写入本文件末尾（dev 环境：发起变更→记录→开标时间变更→公告待发→发布→SCM0003 结果检查）
- [ ] Commit — `feat(change): 变更体系收尾验证与冒烟清单`

## Self-Review 记录

- Spec 覆盖：§1 按钮/权限→Task 5；§2 白名单+闸门+例外→Task 2/4；§3 三步弹窗→Task 6；§4 记录模型→Task 1/3/5；§5 开标时间强公告+SCM0003→Task 7；§6 不做项未引入任务 ✓
- 类型一致：`ProjectChangeRecord` 字段名 Task 1=3=5 一致；`change_notice` 类目 Task 7 两侧一致；`applyOpeningTimeToPmi` 仅 Task 3 定义并消费 ✓
- 无占位符：补遗 v1 语义（登记不字段）已明确写入 Task 6 Step 1
