# 开标主持人指派与硬分流 — Design Spec

**Date:** 2026-08-06
**Owner:** asus
**Portal(s) impacted:** :3005 采购管理工作台 · :3007 开评标管理端 · API :4001
**Status:** Approved (brainstorm) → ready for implementation plan

## 1. Goal

在 :3005 采购管理工作台「开标确认」面板底部决策栏增加「开标主持人」按钮，让 leader/staff/admin 在开标前把项目**指派给一个特定的 `bid_host` 账号**，实现 :3007 开评标管理端的**硬分流**：被指派的主持人在 :3007 只看到派给自己的项目，其它主持人完全看不到，:3005 管理端保留改派能力作为补位通道。

### Non-goals (V2)

- :3007 任务板的 "全部 / 指派给我" 切换 toggle
- 多轮采购时主持人自动继承到下一轮
- :3007 上的"接手/补位"按钮（本期补位统一走 :3005 改派）
- 主持人指派审计日志（除非显式要求；现有 `AuditLog`/`OperationLog` 已可覆盖）

## 2. Requirements (confirmed)

| # | Rule |
|---|------|
| R1 | **硬分流**：:3007 仅显示 `assignedHostUserId = 当前 bid_host.id` 的项目；未指派的项目在 :3007 上**不可见** |
| R2 | **指派前置**：「按时开标」(`startOpening`) 必须先指派主持人，否则按钮禁用 + 后端 400 |
| R3 | **改派窗口**：`BidOpeningSession` 不存在时 leader/staff/admin 可任意改派；一旦 :3007 组建开标会话/解密，PATCH 端点返回 409 锁定 |
| R4 | **Admin 逃生口**：`leader` / `staff` / `admin` 在 :3005 看得到所有项目（含未指派），是改派/补位的唯一通道 |
| R5 | **新种子账号**：新增 `bid_host` 用户「开标主持人」（密码 `开标主持人@2026`） |
| R6 | **种子回填**：现有 `BidProject` 种子数据回填 `assignedHostUserId = 陈源远.id`，避免本次变更后所有种子项目在 :3007 蒸发 |

## 3. Data Model

### Schema diff (`apps/api/prisma/schema.prisma`)

```prisma
model BidProject {
  // … existing fields …
  assignedHostUserId  String?    // null = 未指派（:3007 不可见，:3005 可见）
  assignedAt          DateTime?
  assignedByUserId    String?    // 操作留痕：指派人 userId
  // 反向关系命名避免与未来其它 User→BidProject 关系冲突
  assignedHostUser    User?      @relation("BidProjectAssignedHost", fields: [assignedHostUserId], references: [id])
}

model User {
  // … existing fields …
  assignedBidProjects BidProject[] @relation("BidProjectAssignedHost")
}
```

**Migration:** 一次性新增 3 个 nullable 列 + 命名关系；不需要 backfill default（R6 通过 `seed.ts` 处理）。

**Migration workflow（遵守 memory `main-db-migration-drift`）：**
非交互环境使用 `prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`（或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`）。绝不跑交互式 `migrate dev`。

## 4. Backend API (`apps/api`)

### 4.1 新增端点

#### `GET /api/users?role=bid_host`

返回 `[{ id, username, displayName }]`，仅 active 用户。
- Guards: `@Roles('leader','staff','admin')`
- 若已有等价端点（如 `/chat/users` 已支持 role 过滤），优先复用；否则新增最小端点。
- 用于 :3005 主持人选择器。

#### `PATCH /api/bid/projects/:id/assigned-host`

请求体：`{ userId: string | null }`（null = 清除指派，项目回到 :3005 公开池但 :3007 不可见）

- Guards: `@Roles('leader','staff','admin')`
- **锁定规则（R3）**：若该项目 `BidOpeningSession` 已存在 → `409 { code: 'OPENING_SESSION_LOCKED' }`
- **校验**：`userId` 必须是 active `bid_host` 用户（或 null）；否则 `400 { code: 'INVALID_HOST' }`
- **写入**：`assignedHostUserId` / `assignedAt = now()` / `assignedByUserId = currentUser.sub`
- **返回**：更新后的 project，含 `assignedHostUser: { id, username, displayName } | null`

### 4.2 修改端点

#### `BidService.listProjects(stages?, actor?: { id, role })`

```ts
// 现签名: listProjects(stages?: string[])
// 新签名: listProjects(stages?: string[], actor?: { id: string; role: AuthRole })
```

在 `where` 中追加：
- `role === 'bid_host'` → `assignedHostUserId: actor.id`
- 其它 role（leader/staff/admin）→ 不追加（看到全部）

> 注意：`bid_host` 当前不在 `PORTAL_ROLE_PRIORITY.web`，所以 :3005 管理端不会用 bid_host 身份调这个端点；过滤只会作用于 :3007 来源的请求。`陈源远` 从 :3005 登录会解析为 `bid_host` 但采购功能 403，理论上不会触发此列表接口。

#### `BidService.getProjectsDashboard(actor?: { id, role })`

同上过滤；:3007 dashboard 仅返回派给当前主持人的项目。

#### `BidController` — 给 `listProjects` / `getProjectsDashboard` 注入 actor

```ts
@Get('projects')
listProjects(@Query('stage') stage?: string | string[], @CurrentUser('sub') userId?: string, @Request() req) {
  return this.bidService.listProjects(normalizeStages(stage), { id: userId!, role: req.user?.role });
}
```

#### `BidService.startOpeningInternal` — 指派前置闸门（R2）

在 `isTransitioning` 块的 checklist 校验之前/并列追加：
```ts
if (isTransitioning) {
  const { assignedHostUserId } = await this.prisma.bidProject.findUnique({
    where: { id }, select: { assignedHostUserId: true },
  });
  if (!assignedHostUserId) {
    throw new BadRequestException({
      error: '请先指派开标主持人',
      code: 'HOST_NOT_ASSIGNED',
    });
  }
}
```
**注意**：阶段推进（:3005 按时开标）才检查；同阶段调用（:3007 组建会话）不检查。这与现有 `DEADLINE_NOT_PASSED` / `OPENING_CHECKLIST_FAILED` 的语义一致。

## 5. Frontend :3005 — `bid-confirm-panel.tsx`

### 5.1 按钮行布局（当前 line 799-806）

```
[开标主持人 ▾ 张三]   [延时开标]   [按时开标]   ← 顺序：新按钮在最左
```

新按钮在 `延时开标` 之前，使用 Lucide `UserCheck` 图标。

### 5.2 状态显示

按钮体内显示当前指派状态：
- 已指派：`开标主持人 ▾ {displayName}`
- 未指派：`开标主持人 ▾ 未指派`（soft warning 色）

### 5.3 点击行为 — 主持人选择 Modal

- 标题「指派开标主持人」
- 内容：单选 radio list，列出 `GET /users?role=bid_host` 返回的账号（`陈源远` / `开标主持人`）；含「清除指派」选项
- 底部：[取消] [确认]
- 确认 → 调 `PATCH /bid/projects/:id/assigned-host` → 成功 toast `已指派：{name}` → 刷新 detail
- 若后端返回 409 `OPENING_SESSION_LOCKED` → toast `开标会话已组建，无法改派` 并把按钮转为只读

### 5.4 闸门行为

**「按时开标」按钮：** `!assignedHostUserId` 时 `disabled`，tooltip 「请先指派开标主持人」。后端 `startOpening` 也会兜底 400。

**「开标主持人」按钮：**
- `stage ∈ {DOWNLOAD, SUBMIT}` 且 `bidProject` 已加载 → 可点
- 一旦 `detail.openingSession` 存在（:3007 已组建会话）→ 只读、tooltip「已锁定（开标会话已组建）」
- `stage === 'ARCHIVED'` → 不显示（已被外层 `stage !== 'ARCHIVED'` 排除）

### 5.5 数据来源

`BidProjectDetail` 类型新增可选字段：
```ts
assignedHostUserId?: string | null
assignedHostUser?: { id: string; username: string; displayName: string } | null
```

`getBidProjectDetail` 已 include 项目全量字段，新增列自动随查询返回；类型补声明即可。

## 6. Frontend :3007

**零功能性改动。** 后端 `listProjects` / `getProjectsDashboard` 已经过滤，未指派项目天然不会到达前端。

:3007 的产品定位是**纯开标执行终端**（与 CLAUDE.md 一致："只执行在线开标并把数据流转回 :3005"）。因此：

- **不提供 "全部 / 指派给我" 切换 toggle** — 任务板**只**显示派给当前主持人的项目，未指派的不可见、不可访问
- **不做主持人选择/改派 UI** — 指派权专属 :3005（leader/staff/admin）；补位也只能通过 :3005 改派
- **不显示「指派给我」徽章** — 全部可见项目本身就是派给我的，徽章冗余

## 7. Seed Data

### 7.1 新增用户 — `apps/api/prisma/seed-data/User.json`

```json
{
  "id": "<生成新 cuid>",
  "username": "开标主持人",
  "displayName": "开标主持人",
  "passwordHash": "<bcrypt(开标主持人@2026)>",
  "role": "bid_host",
  "isActive": true
}
```

口令遵循 `<username>@2026` 约定（与 `陈源远` 一致）。password hash 在 `seed.ts` 里按现有 bcrypt 流程生成（参考其它 bid_host 用户写法）。

### 7.2 回填现有 BidProject 指派 — `apps/api/prisma/seed.ts`

在所有 `BidProject` 加载完毕后，追加一段：
```ts
// R6: 把现有 BidProject 全部指派给「陈源远」bid_host，避免 :3007 硬分流后种子项目蒸发
const chenYuanYuanBidHost = await prisma.user.findFirst({
  where: { username: '陈源远', role: 'bid_host' },
});
if (chenYuanYuanBidHost) {
  await prisma.bidProject.updateMany({
    where: { assignedHostUserId: null },
    data: { assignedHostUserId: chenYuanYuanBidHost.id, assignedAt: new Date() },
  });
}
```

> 注：新演示场景可手动从 :3005 把某个项目改派给「开标主持人」来验证分流。

## 8. Edge Cases & Invariants

| Case | Behavior |
|------|----------|
| 未指派 (`null`) | :3007 不可见；:3005 全部可见；按时开标禁用 |
| 指派给 X | :3007 仅 X 可见；:3005 全部可见 |
| `OpeningSession` 已存在 | PATCH 改派返回 409；按钮只读 |
| 已归档 (`ARCHIVED`) | 决策栏整体不渲染（沿用现状） |
| 删除公告触发 stage 回退 DOWNLOAD | 指派保留（只影响可见性，不影响 stage） |
| 多轮项目 (`round > 1`) | 每轮独立 BidProject 独立指派，V1 不自动继承 |
| `admin` 角色 | listProjects 不过滤，看到全部（逃生口） |
| `陈源远` 从 :3005 登录解析为 `bid_host` | 理论上不会调 listProjects（采购功能 403）；若调了，按 bid_host 规则只看派给自己的 |

## 9. Test Plan

### 后端单元/集成 (`*.spec.ts`)
- `PATCH /bid/projects/:id/assigned-host`：
  - leader/staff/admin 200 成功写入
  - 已有 `OpeningSession` → 409
  - 非bid_host userId → 400
  - null 清除指派成功
- `listProjects` 过滤：
  - bid_host actor → 只返回 `assignedHostUserId = actor.id`
  - leader actor → 返回全部
  - 未指派项目对 bid_host 不可见
- `startOpening`：
  - 未指派 + isTransitioning → 400 `HOST_NOT_ASSIGNED`
  - 已指派 → 正常推进

### E2E (`test/bid.e2e-spec.ts` 补充)
- 用 `陈源远` (bid_host) 登录 :3007 cookie → GET `/bid/projects` 仅返回派给自己的项目
- 用 `Swhi-CGZX-01` (leader) 登录 :3005 cookie → PATCH 指派成功 + 列表看到全部

### 手动验证
1. `pnpm db:seed` → 确认「开标主持人」用户存在；确认种子 BidProject 都已指派给 陈源远
2. :3007 登录 陈源远 → 任务板仍能看到英雄项目（回填生效）
3. :3005 登录 Swhi-CGZX-01 → 进入英雄项目「开标确认」→ 看到「开标主持人」按钮显示「陈源远」→ 改派给「开标主持人」→ :3007 用 陈源远 登录看不到该项目；用「开标主持人」登录能看到
4. :3005 把项目改派回 陈源远 → 「按时开标」启用（已指派）→ 创建新演示项目不指派 → 「按时开标」禁用

## 10. Implementation Order

1. Prisma schema + migration（含命名关系）
2. Seed: 新增「开标主持人」用户 + BidProject 回填
3. `BidService.listProjects` / `getProjectsDashboard` 加 actor 过滤
4. `BidController` 注入 `@CurrentUser` + `req.user.role`
5. 新 `PATCH /bid/projects/:id/assigned-host` + guards
6. `startOpeningInternal` 指派前置闸门
7. `BidProjectDetail` 类型补 `assignedHostUser` 字段
8. :3005 `bid-confirm-panel.tsx` UI：按钮 + Modal + 闸门
9. 测试：单元 + E2E
10. 手动验证 → commit（不主动 push，按 memory `no-auto-push-reminder-only`）
