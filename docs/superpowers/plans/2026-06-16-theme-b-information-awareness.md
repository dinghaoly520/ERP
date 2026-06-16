# 主题 B · 信息感知层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让采购管理工作台（web :3005）从"被动展示"转向"主动推送待办"——头部铃铛下拉、首页待办聚合区、详情页内联告警三个感知面，共享前端 hook 层。

**Architecture:** 三个感知面（铃铛/首页待办/内联告警）→ 三个前端 hook（`useNotifications`/`useTrend`/`useAlerts`）→ 数据源（通知 API + stats API + 新增 alerts API）。后端改动极小：`Notification.resolvedAt` 字段、`SUPPLIER_PENDING` 通知补发+resolve、新增 `/api/alerts` 查询端点。

**Tech Stack:** NestJS 11 + Prisma（后端，Jest TDD）/ Next.js 16 + React 19 + Tailwind v4（前端，无测试框架，用 `tsc --noEmit` + build + 手动验证）。

**Spec:** `docs/superpowers/specs/2026-06-16-theme-b-information-awareness-design.md`

---

## 关键实现决策（Implementation Notes）

spec 列了三类 actionable 通知（`SUPPLIER_PENDING`/`PRICE_REVIEW`/`QUALIFICATION_EXPIRING`）。实现评审后发现三类**生命周期模型不同**，需区别对待：

| 待办类型 | 生命周期模型 | 实现 |
|---|---|---|
| `SUPPLIER_PENDING` | **事件驱动**（注册→审批，有明确 resolve） | 真通知：register 时 `sendToRole('procurement_staff')`，link=`/supplier/<id>`；approve/reject/return 时按 link 写 `resolvedAt` |
| `PRICE_REVIEW` | **状态派生**（list 式审批流，无 per-entity 详情页，resolve 语义模糊） | 不发通知；待办数 = `catalog/admin/stats.pendingApplications`（已存在），由 `useNotifications` 合并 stats 派生 |
| `QUALIFICATION_EXPIRING` | **状态派生**（资质续期由供应商触发，procurement 侧无 resolve 事件） | 不发通知；待办数 = 新 `/api/alerts/overview.expiringQualifications`，由 `useAlerts` 派生 |

理由：避免 per-entity 通知在 resolve-hook 遗漏时产生**陈旧待办**（spec §8 风险表已警示）。状态派生天然随轮询自纠。`resolvedAt` 字段仍新增（向前兼容真事件型 actionable），theme B 仅 `SUPPLIER_PENDING` 使用。

> **约定：** 所有 `pnpm` 命令在 `water-erp/` 工作区根执行。路径相对 `water-erp/`。后端测试：`pnpm --filter api test -- <pattern>`。

---

## 文件结构

### 后端新增/修改
- `apps/api/prisma/schema.prisma:469` — `Notification` 增 `resolvedAt DateTime?`
- `apps/api/prisma/migrations/<ts>_notification_resolved_at/migration.sql` — 新迁移
- `apps/api/src/notification/notification.service.ts` — `list` 支持 `resolved` 过滤；新增 `resolveActionable(type, link)`
- `apps/api/src/notification/notification.controller.ts` — `GET /notifications?tab=todo|all`
- `apps/api/src/supplier/supplier.service.ts:21,162,195,220` — register 补发 `SUPPLIER_PENDING`；approve/reject/return 调 `resolveActionable`
- `apps/api/src/alerts/` — **新模块**：`alerts.module.ts`/`alerts.controller.ts`/`alerts.service.ts` + spec
- `apps/api/src/app.module.ts` — 注册 `AlertsModule`

### 前端新增/修改
- `packages/shared/src/constants.ts:148` — `NOTIFICATION_ICON`(emoji) → `NOTIFICATION_META`(结构化)
- `apps/web/src/lib/hooks/use-notifications.ts` — **新**：轮询+待办/信息性分类+stats 合并
- `apps/web/src/lib/hooks/use-trend.ts` — **新**：localStorage 基线
- `apps/web/src/lib/hooks/use-alerts.ts` — **新**：alerts API 查询
- `apps/web/src/components/workbench/trend-chip.tsx` — **新**
- `apps/web/src/components/workbench/notification-center.tsx` — **新**：铃铛+下拉
- `apps/web/src/components/workbench/dashboard-todo-panel.tsx` — **新**
- `apps/web/src/components/workbench/alert-banner.tsx` — **新**
- `apps/web/src/components/workbench/index.ts` — 导出新组件
- `apps/web/src/components/workbench/metric-card.tsx` — 加 `trendDirection`/`trendValue` + TrendChip
- `apps/web/src/components/app-shell.tsx` — 头部加 NotificationCenter，badge 轮询收口到 hook
- `apps/web/src/app/(dashboard)/dashboard/page.tsx` — 插入 DashboardTodoPanel + MetricCard trend 声明
- `apps/web/src/app/(dashboard)/supplier/[id]/page.tsx` — 顶部 AlertBanner
- `apps/web/src/app/(dashboard)/expert/[id]/page.tsx` — 顶部 AlertBanner
- `apps/web/src/app/(dashboard)/notifications/page.tsx` — **新**：整页通知
- `apps/web/src/lib/api/notification.ts` — **新**：通知 API 客户端

---

## Task 1: Notification.resolvedAt 字段 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma:469-481`
- Create: `apps/api/prisma/migrations/<ts>_notification_resolved_at/migration.sql`

- [ ] **Step 1: 加字段到 schema**

`apps/api/prisma/schema.prisma` 的 `model Notification`，在 `isRead` 行后加 `resolvedAt`：

```prisma
model Notification {
  id         String    @id @default(cuid())
  userId     String
  type       String
  title      String
  content    String
  isRead     Boolean   @default(false)
  resolvedAt DateTime?
  link       String?
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
  @@index([userId, type, resolvedAt])
}
```

- [ ] **Step 2: 生成迁移 SQL（非交互）**

Run（在 `water-erp/`）:
```bash
pnpm --filter api exec prisma migrate dev --create-only --name notification_resolved_at
```
Expected: 生成 `apps/api/prisma/migrations/<ts>_notification_resolved_at/migration.sql`，含 `ALTER TABLE "Notification" ADD COLUMN "resolvedAt" TIMESTAMP(3);` + 新索引。

- [ ] **Step 3: 应用迁移（非交互）**

```bash
pnpm --filter api exec prisma db execute --file apps/api/prisma/migrations/<ts>_notification_resolved_at/migration.sql --schema apps/api/prisma/schema.prisma
pnpm --filter api exec prisma migrate resolve --applied <ts>_notification_resolved_at
pnpm db:generate
```
（把 `<ts>_...` 替换为实际生成的迁移目录名。）

Expected: 迁移标记 applied，Prisma client 重新生成含 `resolvedAt`。

- [ ] **Step 4: 验证字段可用**

Run:
```bash
pnpm --filter api exec tsc --noEmit -p apps/api/tsconfig.build.json
```
Expected: 0 errors（`resolvedAt` 已纳入类型）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api): Notification 增加 resolvedAt 字段（待办生命周期）"
```

---

## Task 2: NOTIFICATION_META 结构化映射（替换 emoji）

**Files:**
- Modify: `packages/shared/src/constants.ts:146-155`
- Build: `packages/shared` 重新编译

- [ ] **Step 1: 替换 NOTIFICATION_ICON 为 NOTIFICATION_META**

`packages/shared/src/constants.ts`，替换 `/* ── 通知类型 ── */` 段：

```ts
/* ── 通知类型元数据 ── */
// icon = Lucide 图标名（前端按名渲染）；tone = 语义色；actionable = 是否进「待办」分段
export interface NotificationMeta {
  icon: string;
  tone: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  actionable: boolean;
}

export const NOTIFICATION_META: Record<string, NotificationMeta> = {
  SUPPLIER_APPROVED:       { icon: 'CheckCircle2', tone: 'green',  actionable: false },
  SUPPLIER_REJECTED:       { icon: 'XCircle',       tone: 'red',    actionable: false },
  SUPPLIER_RETURNED:       { icon: 'RotateCcw',     tone: 'orange', actionable: false },
  SUPPLIER_PENDING:        { icon: 'UserCheck',     tone: 'blue',   actionable: true  },
  QUALIFICATION_EXPIRING:  { icon: 'AlertTriangle', tone: 'orange', actionable: true  },
  BID_PUBLISHED:           { icon: 'FileText',      tone: 'blue',   actionable: false },
  BID_REMINDER:            { icon: 'Clock',         tone: 'orange', actionable: true  },
  PRICE_REVIEW:            { icon: 'Tag',           tone: 'purple', actionable: true  },
  CATALOG_APPLICATION:     { icon: 'Package',       tone: 'gray',   actionable: false },
  SYSTEM:                  { icon: 'Info',          tone: 'gray',   actionable: false },
};

export const NOTIFICATION_META_DEFAULT: NotificationMeta = { icon: 'Bell', tone: 'gray', actionable: false };

export function getNotificationMeta(type: string): NotificationMeta {
  return NOTIFICATION_META[type] ?? NOTIFICATION_META_DEFAULT;
}

// 向后兼容：保留旧名（emoji 仍供其他门户过渡用）
export const NOTIFICATION_ICON: Record<string, string> = Object.fromEntries(
  Object.entries(NOTIFICATION_META).map(([k]) => [k, '🔔']),
);
```

- [ ] **Step 2: 编译 shared**

Run:
```bash
pnpm --filter @water-erp/shared build
```
Expected: dist 生成，0 errors。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/dist
git commit -m "feat(shared): NOTIFICATION_META 结构化映射（Lucide 图标名+tone+actionable）"
```

---

## Task 3: NotificationService.list 支持 tab 过滤 + resolveActionable

**Files:**
- Modify: `apps/api/src/notification/notification.service.ts:95-137`
- Modify: `apps/api/src/notification/notification.controller.ts:14-20`
- Test: `apps/api/src/notification/notification.service.spec.ts`（新）

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/notification/notification.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';

describe('NotificationService', () => {
  let service: NotificationService;
  const prisma = {
    notification: {
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    notificationDeliveryLog: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const emailChannel = { send: jest.fn() } as any;
  const smsChannel = { send: jest.fn() } as any;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: EmailChannel, useValue: emailChannel },
        { provide: SmsChannel, useValue: smsChannel },
        { provide: 'PrismaService', useValue: prisma },
      ],
    }).compile();
    service = mod.get(NotificationService);
    // 注入 prisma（依赖注入名匹配）
    (service as any).prisma = prisma;
  });

  it('list tab=todo 只返回未 resolve 的 actionable 通知', async () => {
    prisma.notification.count.mockResolvedValue(1);
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
    const res = await service.list('u1', 1, 20, 'todo');
    expect(prisma.notification.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1', resolvedAt: null }),
    }));
    expect(res.total).toBe(1);
  });

  it('resolveActionable 按 type+link 写 resolvedAt', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.resolveActionable('SUPPLIER_PENDING', '/supplier/s1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { type: 'SUPPLIER_PENDING', link: '/supplier/s1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter api test -- notification.service.spec`
Expected: FAIL（`list` 第 4 参数不存在 / `resolveActionable` 未定义）。

- [ ] **Step 3: 实现 service 方法**

`apps/api/src/notification/notification.service.ts`，修改 `list` 并新增 `resolveActionable`：

```ts
  async list(userId: string, page: number = 1, pageSize: number = 20, tab: 'all' | 'todo' = 'all') {
    const skip = (page - 1) * pageSize;
    const where: any = { userId };
    if (tab === 'todo') {
      where.resolvedAt = null;
      // actionable 由前端 META 判定；后端按 resolvedAt 过滤即可（todo = 未 resolve 的）
    }
    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
    ]);
    return { total, page, pageSize, items };
  }

  /** 将某 type+link 对应的未 resolve 通知标记为已处理（待办清零）。 */
  async resolveActionable(type: string, link: string) {
    return this.prisma.notification.updateMany({
      where: { type, link, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }
```

- [ ] **Step 4: controller 透传 tab**

`apps/api/src/notification/notification.controller.ts` 的 `list`：

```ts
  @Get()
  @ApiOperation({ summary: '通知列表' })
  async list(@Request() req: any, @Query('page') page?: number, @Query('pageSize') pageSize?: number, @Query('tab') tab?: 'all' | 'todo') {
    return this.notificationService.list(req.user.sub, page ?? 1, pageSize ?? 20, tab ?? 'all');
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter api test -- notification.service.spec`
Expected: PASS（2 tests）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notification/
git commit -m "feat(api): 通知列表支持 tab=todo 过滤 + resolveActionable 方法"
```

---

## Task 4: SUPPLIER_PENDING 通知补发 + resolve

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（register ~L95、approve ~L189、reject ~L213、return ~L238）
- Test: `apps/api/src/supplier/supplier.service.spec.ts`（已存在，增 case）

- [ ] **Step 1: 写失败测试（在现有 spec 增 case）**

打开 `apps/api/src/supplier/supplier.service.spec.ts`，在 describe 块内追加（若 spec 不存在则新建，参考既有 `expert-admin.service.spec.ts` 的 mock 模式）：

```ts
describe('SUPPLIER_PENDING 待办通知', () => {
  it('register 后向 procurement_staff 发 SUPPLIER_PENDING 通知', async () => {
    // arrange: 构造合法 register dto + mock prisma 事务返回 supplier
    prisma.supplier.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue({ user: { id: 'u2' }, supplier: { id: 's1', name: '成都XX' } });
    prisma.supplier.create.mockResolvedValue({ id: 's1', name: '成都XX' });
    prisma.user.create.mockResolvedValue({ id: 'u2' });
    notificationService.sendToRole = jest.fn();

    await service.register({ /* 合法 dto */ } as any);

    expect(notificationService.sendToRole).toHaveBeenCalledWith(
      'procurement_staff',
      expect.objectContaining({ type: 'SUPPLIER_PENDING', link: '/supplier/s1' }),
    );
  });

  it('approve 后 resolveActionable 清 SUPPLIER_PENDING', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u2', name: 'X', status: 'PENDING' });
    prisma.$transaction.mockResolvedValue([{}, {}]);
    notificationService.resolveActionable = jest.fn();

    await service.approve('s1');

    expect(notificationService.resolveActionable).toHaveBeenCalledWith('SUPPLIER_PENDING', '/supplier/s1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- supplier.service.spec`
Expected: FAIL（sendToRole/resolveActionable 未被调用）。

- [ ] **Step 3: register 补发通知**

`apps/api/src/supplier/supplier.service.ts`，`register` 方法 `return { user, supplier };`（~L97）**之前**插入：

```ts
    // 通知采购管理员：新供应商待审批（待办型，审批后自动 resolve）
    void this.notificationService.sendToRole('procurement_staff', {
      type: 'SUPPLIER_PENDING',
      title: '新供应商注册待审批',
      content: `${supplier.name} 提交了注册申请，信用代码 ${supplier.creditCode}，请前往审批。`,
      link: `/supplier/${supplier.id}`,
    });

    return { user, supplier };
```

（`supplier` 对象需含 `creditCode`——事务内 create 已包含。）

- [ ] **Step 4: approve/reject/return 调 resolveActionable**

`approve` 方法（~L162）：在发送 `SUPPLIER_APPROVED` 通知**之前**加：
```ts
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`);
```

`reject`（~L195）与 `return`（~L220）同样在各自 `notificationService.create(...)` **之前**各加一行：
```ts
    await this.notificationService.resolveActionable('SUPPLIER_PENDING', `/supplier/${id}`);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter api test -- supplier.service.spec`
Expected: PASS（含新 case）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/supplier/supplier.service.ts apps/api/src/supplier/supplier.service.spec.ts
git commit -m "feat(api): SUPPLIER_PENDING 待办通知（注册补发+审批 resolve）"
```

---

## Task 5: Alerts 模块（状态派生待办查询）

**Files:**
- Create: `apps/api/src/alerts/alerts.module.ts`
- Create: `apps/api/src/alerts/alerts.controller.ts`
- Create: `apps/api/src/alerts/alerts.service.ts`
- Create: `apps/api/src/alerts/alerts.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/alerts/alerts.service.spec.ts`:

```ts
import { AlertsService } from './alerts.service';

describe('AlertsService', () => {
  let service: AlertsService;
  const prisma = {
    supplierQualification: { findMany: jest.fn() },
    supplier: { findMany: jest.fn() },
    bidExpert: { findMany: jest.fn(), groupBy: jest.fn() },
    expertEvaluation: { findMany: jest.fn() },
  };

  beforeEach(() => {
    service = new AlertsService(prisma as any);
  });

  it('overview 统计 90 天内临期资质数', async () => {
    prisma.supplierQualification.findMany.mockResolvedValue([
      { id: 'q1', supplierId: 's1', validTo: new Date(Date.now() + 30 * 864e5) },
    ]);
    prisma.bidExpert.groupBy.mockResolvedValue([{ _count: { _all: 4 }, expertId: 'e1' }]);
    const res = await service.overview();
    expect(res.expiringQualifications).toBe(1);
    expect(res.overloadedExperts).toBeGreaterThanOrEqual(0);
  });

  it('supplierAlerts 返回某供应商临期资质列表', async () => {
    prisma.supplierQualification.findMany.mockResolvedValue([
      { id: 'q1', name: '营业执照', validTo: new Date(Date.now() + 10 * 864e5), type: 'BUSINESS_LICENSE' },
    ]);
    const res = await service.supplierAlerts('s1');
    expect(res.expiringQualifications).toHaveLength(1);
    expect(res.expiringQualifications[0].daysLeft).toBeLessThanOrEqual(90);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- alerts.service.spec`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 service**

Create `apps/api/src/alerts/alerts.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  /** 仪表盘总览：临期资质数 + 过载专家数。 */
  async overview() {
    const horizon = new Date(Date.now() + 90 * 86400000);
    const expiringQualifications = await this.prisma.supplierQualification.count({
      where: {
        validTo: { lte: horizon, gt: new Date() }, // 未过期但 90 天内
        supplier: { status: 'APPROVED' },
      },
    });

    // 过载专家：同时参与 > 3 个未归档项目
    const overloaded = await this.prisma.bidExpert.groupBy({
      by: ['expertId'],
      where: { project: { stage: { not: 'ARCHIVED' } } },
      _count: { _all: true },
      having: { _count: { _all: { gt: 3 } } },
    });

    return { expiringQualifications, overloadedExperts: overloaded.length };
  }

  /** 某供应商的告警：临期资质（分档）。 */
  async supplierAlerts(supplierId: string) {
    const quals = await this.prisma.supplierQualification.findMany({
      where: { supplierId, validTo: { not: null } },
    });
    const now = Date.now();
    const expiringQualifications = quals
      .map((q) => ({ ...q, daysLeft: Math.ceil(((q.validTo as Date).getTime() - now) / 86400000) }))
      .filter((q) => q.daysLeft < 90); // 含已过期（负值）

    return { expiringQualifications };
  }

  /** 某专家的告警：连续 D 级 + 过载。 */
  async expertAlerts(expertUserId: string) {
    const activeCount = await this.prisma.bidExpert.count({
      where: { userId: expertUserId, project: { stage: { not: 'ARCHIVED' } } },
    });
    // 近期评价（按时间倒序）
    const recentEvals = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    const consecutiveD = recentEvals.length === 2 && recentEvals.every((e) => e.level === 'D');
    return { activeProjectCount: activeCount, overloaded: activeCount > 3, consecutiveD };
  }
}
```

- [ ] **Step 4: 实现 controller + module**

Create `apps/api/src/alerts/alerts.controller.ts`:

```ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AlertsService } from './alerts.service';

@ApiTags('告警')
@ApiCookieAuth('token')
@UseGuards(AuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get('overview')
  @Roles('admin', 'procurement_staff', 'bid_host')
  @ApiOperation({ summary: '仪表盘告警总览' })
  overview() { return this.alerts.overview(); }

  @Get('supplier/:id')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '供应商告警' })
  supplierAlerts(@Param('id') id: string) { return this.alerts.supplierAlerts(id); }

  @Get('expert/:id')
  @Roles('admin', 'bid_host', 'procurement_staff')
  @ApiOperation({ summary: '专家告警' })
  expertAlerts(@Param('id') id: string) { return this.alerts.expertAlerts(id); }
}
```

Create `apps/api/src/alerts/alerts.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
```

- [ ] **Step 5: 注册到 AppModule**

`apps/api/src/app.module.ts` 的 `imports` 数组加 `AlertsModule`（import 语句同步加）。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter api test -- alerts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/alerts/ apps/api/src/app.module.ts
git commit -m "feat(api): Alerts 模块（临期资质/过载专家/连续D级 状态派生告警）"
```

---

## Task 6: 前端通知 API 客户端

**Files:**
- Create: `apps/web/src/lib/api/notification.ts`

- [ ] **Step 1: 创建客户端**

```ts
import { api } from '@/lib/api';

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  resolvedAt: string | null;
  link?: string | null;
  createdAt: string;
}

export function listNotifications(tab: 'all' | 'todo' = 'all', page = 1, pageSize = 20) {
  const q = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) });
  return api.get<{ total: number; page: number; pageSize: number; items: NotificationItem[] }>(`/notifications?${q}`);
}
export function getUnreadCount() {
  return api.get<{ count: number }>('/notifications/unread-count');
}
export function markNotificationRead(id: string) {
  return api.post<NotificationItem>(`/notifications/${id}/read`, {});
}
export function markAllNotificationsRead() {
  return api.post<{ count: number }>('/notifications/mark-all-read', {});
}
```

- [ ] **Step 2: 类型检查**

Run: `cd water-erp && pnpm --filter web exec tsc --noEmit`
Expected: 0 新 error（既有 Lucide 类型 error 不计）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/notification.ts
git commit -m "feat(web): 通知 API 客户端"
```

---

## Task 7: use-notifications hook

**Files:**
- Create: `apps/web/src/lib/hooks/use-notifications.ts`

- [ ] **Step 1: 创建 hook**

```ts
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead, type NotificationItem } from '@/lib/api/notification';
import { getNotificationMeta } from '@water-erp/shared';

const POLL_MS = 30_000;

export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [todoItems, setTodoItems] = useState<NotificationItem[]>([]);
  const [recent, setRecent] = useState<NotificationItem[]>([]);
  // 状态派生待办计数（来自 stats，避免遗漏 SUPPLIER_PENDING 之外的）
  const [derivedTodo, setDerivedTodo] = useState({ supplierPending: 0, priceReview: 0, expiringQualifications: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [cnt, todoRes, allRes] = await Promise.all([
        getUnreadCount(),
        listNotifications('todo', 1, 20),
        listNotifications('all', 1, 8),
      ]);
      setUnreadCount(cnt.count);
      // todo 分段：未 resolve 且 actionable
      setTodoItems(todoRes.items.filter((n) => getNotificationMeta(n.type).actionable));
      setRecent(allRes.items);

      // 双源：stats 派生（兜底，确保不漏）
      const [ss, cs, alerts] = await Promise.all([
        fetch('/api/supplier/stats', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/catalog/admin/stats', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/alerts/overview', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      setDerivedTodo({
        supplierPending: ss?.pending ?? 0,
        priceReview: cs?.pendingApplications ?? 0,
        expiringQualifications: alerts?.expiringQualifications ?? 0,
      });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    setUnreadCount((c) => Math.max(0, c - 1));
    setRecent((items) => items.map((n) => n.id === id ? { ...n, isRead: true } : n));
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    setUnreadCount(0);
    setRecent((items) => items.map((n) => ({ ...n, isRead: true })));
  }, []);

  return { unreadCount, todoItems, recent, derivedTodo, refresh, markRead, markAllRead };
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 新 error。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/hooks/use-notifications.ts
git commit -m "feat(web): useNotifications hook（轮询+待办/信息性分类+stats 双源）"
```

---

## Task 8: use-trend hook（localStorage 基线）

**Files:**
- Create: `apps/web/src/lib/hooks/use-trend.ts`

- [ ] **Step 1: 创建 hook**

```ts
'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/hooks/use-api-me'; // 见下方说明；若无则内联 fetch me

// 取当前用户 id（用于隔离基线）。若已有获取 user 的方式，替换此处。
function useUserId(): string | null {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((u) => setUid(u?.sub ?? u?.id ?? null))
      .catch(() => {});
  }, []);
  return uid;
}

export type TrendDirection = 'up-good' | 'up-bad' | 'neutral';

export interface TrendValue { delta: number; direction: TrendDirection; }

/**
 * 记录某指标当前值到 localStorage（按 user+key+date），返回与上次不同值的差值。
 * 首次访问（无基线）返回 null，调用方应不渲染 TrendChip。
 */
export function useTrend(metricKey: string, currentValue: number | null): TrendValue | null {
  const userId = useUserId();
  const [trend, setTrend] = useState<TrendValue | null>(null);

  useEffect(() => {
    if (userId == null || currentValue == null || typeof currentValue !== 'number' || isNaN(currentValue)) {
      setTrend(null);
      return;
    }
    const storageKey = `erp:trend:${userId}:${metricKey}`;
    try {
      const raw = localStorage.getItem(storageKey);
      const prev = raw ? Number(JSON.parse(raw).value) : null;
      // 仅在与上次"不同值"对比时计算 delta（同值不更新，避免每次访问都刷新）
      if (prev != null && !isNaN(prev) && prev !== currentValue) {
        setTrend({ delta: currentValue - prev, direction: 'neutral' }); // direction 由调用方按指标语义覆盖
      } else {
        setTrend(null);
      }
      localStorage.setItem(storageKey, JSON.stringify({ value: currentValue, at: Date.now() }));
    } catch { setTrend(null); }
  }, [userId, metricKey, currentValue]);

  return trend;
}
```

> 说明：`useUserId` 内联了 `/api/auth/me` 调用。若 app-shell 已在 context 中提供 user，可改为从 context 取（避免重复请求）。Theme B 先内联，后续主题 A 可抽全局 user context。

- [ ] **Step 2: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/lib/hooks/use-trend.ts
git commit -m "feat(web): useTrend hook（localStorage 访问基线，差值趋势）"
```

---

## Task 9: use-alerts hook

**Files:**
- Create: `apps/web/src/lib/hooks/use-alerts.ts`

- [ ] **Step 1: 创建 hook**

```ts
'use client';
import { useEffect, useState } from 'react';

export interface OverviewAlerts { expiringQualifications: number; overloadedExperts: number; }
export interface SupplierAlertQual { id: string; name: string; type: string; validTo: string; daysLeft: number; }
export interface SupplierAlerts { expiringQualifications: SupplierAlertQual[]; }
export interface ExpertAlerts { activeProjectCount: number; overloaded: boolean; consecutiveD: boolean; }

export function useAlertsOverview() {
  const [data, setData] = useState<OverviewAlerts>({ expiringQualifications: 0, overloadedExperts: 0 });
  useEffect(() => {
    let active = true;
    fetch('/api/alerts/overview', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (active && d) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return data;
}

export function useSupplierAlerts(supplierId: string | undefined) {
  const [data, setData] = useState<SupplierAlerts>({ expiringQualifications: [] });
  useEffect(() => {
    if (!supplierId) return;
    let active = true;
    fetch(`/api/alerts/supplier/${supplierId}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (active && d) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [supplierId]);
  return data;
}

export function useExpertAlerts(expertUserId: string | undefined) {
  const [data, setData] = useState<ExpertAlerts>({ activeProjectCount: 0, overloaded: false, consecutiveD: false });
  useEffect(() => {
    if (!expertUserId) return;
    let active = true;
    fetch(`/api/alerts/expert/${expertUserId}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (active && d) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [expertUserId]);
  return data;
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/lib/hooks/use-alerts.ts
git commit -m "feat(web): useAlerts hook（overview/supplier/expert 告警查询）"
```

---

## Task 10: TrendChip 组件

**Files:**
- Create: `apps/web/src/components/workbench/trend-chip.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TrendDirection } from '@/lib/hooks/use-trend';

export function TrendChip({ delta, direction }: { delta: number; direction: TrendDirection }) {
  if (delta === 0) return null;
  const up = delta > 0;
  // 语义着色：up-good→绿，up-bad→红，neutral→灰
  const colorCls =
    direction === 'up-good' ? (up ? 'text-[#11a874] bg-[#11a87418] border-[#11a87430]' : 'text-[#5a6d8a] bg-[#f8fafc] border-[#e5ecf4]')
    : direction === 'up-bad'  ? (up ? 'text-[#e74c3c] bg-[#e74c3c18] border-[#e74c3c30]' : 'text-[#11a874] bg-[#11a87418] border-[#11a87430]')
    : 'text-[#5a6d8a] bg-[#f8fafc] border-[#e5ecf4]';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums', colorCls)}>
      <Icon size={10} strokeWidth={3} />
      比上次 {up ? '+' : ''}{delta}
    </span>
  );
}

export { Minus };
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/components/workbench/trend-chip.tsx
git commit -m "feat(web): TrendChip 组件（语义着色趋势胶囊）"
```

---

## Task 11: NotificationCenter 组件（铃铛 + 下拉）

**Files:**
- Create: `apps/web/src/components/workbench/notification-center.tsx`

- [ ] **Step 1: 创建组件**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta } from '@water-erp/shared';
import { useNotifications } from '@/lib/hooks/use-notifications';
import { statusTone } from '@/lib/workbench';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

export function NotificationCenter() {
  const router = useRouter();
  const { unreadCount, todoItems, recent, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'todo' | 'all'>('todo');
  const ref = useRef<HTMLDivElement>(null);

  // 点外部关闭 + Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const items = tab === 'todo' ? todoItems : recent;

  const handleClick = async (id: string, link?: string | null) => {
    await markRead(id);
    if (link) { router.push(link); setOpen(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`通知${unreadCount > 0 ? `（${unreadCount} 条未读）` : ''}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5ecf4] bg-white text-[#064ea2] transition hover:border-[#bfdbfe] hover:bg-[#eff6ff]"
      >
        <Bell size={16} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e74c3c] px-1 text-[10px] font-extrabold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="modal-content absolute right-0 top-11 z-50 w-[380px] overflow-hidden rounded-2xl border border-[#e5ecf4] bg-white shadow-[0_18px_60px_rgba(15,47,87,0.16)]">
          {/* header */}
          <div className="flex items-center justify-between border-b border-[#eef3f8] px-4 py-3">
            <span className="text-sm font-extrabold text-[#18243a]">通知</span>
            <button onClick={markAllRead} className="text-xs font-bold text-[#064ea2] hover:underline">全部已读</button>
          </div>
          {/* tabs */}
          <div className="flex border-b border-[#e5ecf4]">
            {(['todo', 'all'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`relative flex-1 px-4 py-2.5 text-xs font-extrabold transition ${tab === t ? 'text-[#064ea2]' : 'text-[#5a6d8a] hover:text-[#18243a]'}`}>
                {t === 'todo' ? `待办 ${todoItems.length}` : '全部'}
                {tab === t && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[#064ea2]" />}
              </button>
            ))}
          </div>
          {/* list */}
          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#8a99ad]">
                {tab === 'todo' ? <><Check size={20} className="mx-auto mb-2 text-[#11a874]" />今日待办已清零</> : '暂无通知'}
              </div>
            ) : items.map((n) => {
              const meta = getNotificationMeta(n.type);
              const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
              const tone = statusTone[meta.tone];
              return (
                <button key={n.id} onClick={() => handleClick(n.id, n.link)}
                  className={`flex w-full items-start gap-2.5 border-b border-[#eef3f8] px-4 py-3 text-left transition hover:bg-[#f8fafc] ${!n.isRead ? 'bg-[#f0f7ff]' : ''} ${n.resolvedAt ? 'opacity-50' : ''}`}>
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ color: tone.color, backgroundColor: tone.bg }}><Icon size={13} strokeWidth={2} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-[#18243a]">{n.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[#5a6d8a]">{n.content}</span>
                    <span className="mt-1 block text-[10px] text-[#8a99ad]">{relTime(n.createdAt)}{meta.actionable && n.link && !n.resolvedAt && <span className="ml-2 font-bold text-[#064ea2]">去处理 →</span>}</span>
                  </span>
                  {!n.isRead && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#064ea2]" />}
                </button>
              );
            })}
          </div>
          {/* footer */}
          <button onClick={() => { router.push('/notifications'); setOpen(false); }}
            className="block w-full border-t border-[#eef3f8] py-2.5 text-center text-xs font-bold text-[#064ea2] hover:bg-[#f8fafc]">查看全部通知 →</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 导出 + 类型检查 + Commit**

`apps/web/src/components/workbench/index.ts` 加：`export { NotificationCenter } from './notification-center';`

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/components/workbench/notification-center.tsx apps/web/src/components/workbench/index.ts
git commit -m "feat(web): NotificationCenter 铃铛+下拉（待办/全部分段，Esc/点外关闭）"
```

---

## Task 12: DashboardTodoPanel 组件

**Files:**
- Create: `apps/web/src/components/workbench/dashboard-todo-panel.tsx`

- [ ] **Step 1: 创建组件**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { UserCheck, AlertTriangle, Tag, CheckCircle2 } from 'lucide-react';
import { useNotifications } from '@/lib/hooks/use-notifications';

interface TodoCardDef { key: string; label: string; hint: string; icon: any; toneBg: string; toneColor: string; link: string; }

export function DashboardTodoPanel() {
  const router = useRouter();
  const { derivedTodo, todoItems } = useNotifications();

  // 双源：notification todoItems（SUPPLIER_PENDING 等真通知）与 stats 派生取大值
  const supplierPendingCount = Math.max(
    todoItems.filter((n) => n.type === 'SUPPLIER_PENDING').length,
    derivedTodo.supplierPending,
  );
  const cards: TodoCardDef[] = [
    { key: 'supplier', label: '供应商审批', hint: '待审核', icon: UserCheck, toneBg: '#eff6ff', toneColor: '#064ea2', link: '/supplier/approval' },
    { key: 'qual', label: '资质到期', hint: '90 天内', icon: AlertTriangle, toneBg: '#fff7ed', toneColor: '#f5a623', link: '/supplier/repository' },
    { key: 'price', label: '价格复核', hint: '待审批', icon: Tag, toneBg: '#f5f3ff', toneColor: '#7c3aed', link: '/mall-management/approval' },
  ];
  const counts: Record<string, number> = { supplier: supplierPendingCount, qual: derivedTodo.expiringQualifications, price: derivedTodo.priceReview };
  const total = counts.supplier + counts.qual + counts.price;

  if (total === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] px-5 py-4">
        <CheckCircle2 size={18} className="text-[#11a874]" />
        <div>
          <div className="text-sm font-extrabold text-[#18243a]">今日待办已清零</div>
          <div className="text-xs text-[#5a6d8a]">没有需要处理的审批、资质或价格复核</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-enter overflow-hidden rounded-2xl border border-[#e5ecf4] bg-white">
      <div className="flex items-center justify-between border-b border-[#eef3f8] px-5 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[#064ea2]" />
          <span className="text-sm font-extrabold text-[#18243a]">今日待办</span>
          <span className="rounded-full bg-[#e74c3c] px-2 py-0.5 text-[10px] font-extrabold text-white">{total}</span>
        </div>
        <span className="text-xs text-[#8a99ad]">按模块分组</span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[#eef3f8]">
        {cards.map((c) => (
          <button key={c.key} onClick={() => router.push(c.link)} className="group px-5 py-4 text-left transition hover:bg-[#f8fafc]">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: c.toneBg }}><c.icon size={14} style={{ color: c.toneColor }} /></span>
              <span className="text-xs font-bold text-[#18243a]">{c.label}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums" style={{ color: c.toneColor }}>{counts[c.key]}</span>
              <span className="text-xs text-[#8a99ad]">{c.hint}</span>
            </div>
            <div className="mt-1 text-xs font-bold text-[#064ea2] opacity-0 transition group-hover:opacity-100">去处理 →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 导出 + 类型检查 + Commit**

`index.ts` 加 `export { DashboardTodoPanel } from './dashboard-todo-panel';`

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/components/workbench/dashboard-todo-panel.tsx apps/web/src/components/workbench/index.ts
git commit -m "feat(web): DashboardTodoPanel 首页待办聚合区"
```

---

## Task 13: AlertBanner 组件

**Files:**
- Create: `apps/web/src/components/workbench/alert-banner.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AlertSeverity = 'red' | 'orange' | 'orange-light' | 'gray';

const SEVERITY_STYLE: Record<AlertSeverity, { border: string; bg: string; color: string }> = {
  red:          { border: '#fecaca', bg: '#fef2f2', color: '#e74c3c' },
  orange:       { border: '#fed7aa', bg: '#fff7ed', color: '#d97706' },
  'orange-light': { border: '#fde68a', bg: '#fffbeb', color: '#b45309' },
  gray:         { border: '#e5ecf4', bg: '#f8fafc', color: '#5a6d8a' },
};

export function AlertBanner({ items }: { items: { severity: AlertSeverity; title: string; detail?: string }[] }) {
  if (!items.length) return null;
  // 按严重度排序：red > orange > orange-light > gray
  const order: AlertSeverity[] = ['red', 'orange', 'orange-light', 'gray'];
  const sorted = [...items].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <div className="space-y-2">
      {sorted.map((a, i) => {
        const s = SEVERITY_STYLE[a.severity];
        return (
          <div key={i} className={cn('flex items-start gap-2.5 rounded-xl border px-4 py-3')} style={{ borderColor: s.border, backgroundColor: s.bg }}>
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" style={{ color: s.color }} />
            <div className="min-w-0">
              <div className="text-sm font-bold" style={{ color: s.color }}>{a.title}</div>
              {a.detail && <div className="mt-0.5 text-xs text-[#5a6d8a]">{a.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 导出 + 类型检查 + Commit**

`index.ts` 加 `export { AlertBanner } from './alert-banner'; export type { AlertSeverity } from './alert-banner';`

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/components/workbench/alert-banner.tsx apps/web/src/components/workbench/index.ts
git commit -m "feat(web): AlertBanner 通用内联告警横幅"
```

---

## Task 14: MetricCard 接入 trend props + TrendChip

**Files:**
- Modify: `apps/web/src/components/workbench/metric-card.tsx`

- [ ] **Step 1: 加 props 与渲染**

`metric-card.tsx` 的 `MetricCardProps` 接口加：

```ts
  trendDirection?: 'up-good' | 'up-bad' | 'neutral';
  trendDelta?: number | null; // null/0/undefined → 不渲染
```

组件签名解构加 `trendDirection, trendDelta`。在 `{hint && ...}` 行**之后**、`{footer ...}` **之前**插入：

```tsx
      {trendDelta != null && trendDelta !== 0 && trendDirection && (
        <TrendChip delta={trendDelta} direction={trendDirection} />
      )}
```

文件顶部 import：
```ts
import { TrendChip } from './trend-chip';
```

> 注意：MetricCard 已是 `'use client'`（Task 之前改过）。`useCountUp` 不受影响。

- [ ] **Step 2: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/components/workbench/metric-card.tsx
git commit -m "feat(web): MetricCard 接入 trend props（语义趋势胶囊）"
```

---

## Task 15: app-shell 接入 NotificationCenter + 收口轮询

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`

- [ ] **Step 1: 头部插入铃铛**

在 `app-shell.tsx` import 区加：
```ts
import { NotificationCenter } from '@/components/workbench/notification-center';
```

在 header 的用户头像 `<div className="flex items-center gap-2 rounded-xl border ...">` **之前**插入：
```tsx
            <NotificationCenter />
```

- [ ] **Step 2: 侧边栏 badge 改读 useNotifications（收口轮询）**

删除 app-shell 内的 `badges` state + `fetchBadges` + `badgeTimer`（约 L61-81），改为：

```ts
import { useNotifications } from '@/lib/hooks/use-notifications';
// ...组件内：
const { derivedTodo } = useNotifications();
const badges = { supplierPending: derivedTodo.supplierPending, mallReview: derivedTodo.priceReview };
```

（侧边栏子项 badge 的渲染逻辑不变，仍读 `badges[child.badgeKey]`。）

- [ ] **Step 3: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/components/app-shell.tsx
git commit -m "feat(web): app-shell 接入 NotificationCenter，badge 轮询收口到 hook"
```

---

## Task 16: dashboard 接入 DashboardTodoPanel + trend 声明

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: 插入 TodoPanel**

import 加：
```ts
import { DashboardTodoPanel } from '@/components/workbench';
```

在 `<section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">...</section>`（MetricCard 行）**之后**、`<DashboardAiPanel />` **之前**插入：
```tsx
      <DashboardTodoPanel />
```

- [ ] **Step 2: MetricCard 声明 trendDirection**

为 5 张 MetricCard 加 `trendDirection` prop（trendDelta 暂不接 localStorage，留作本 Task Step 3 或后续；先声明方向）：
- 信息发布 `trendDirection="up-good"`
- 供应商资源 `trendDirection="up-good"`
- 专家资源 `trendDirection="neutral"`
- 商城目录 `trendDirection="up-good"`
- 供应商待审批 `trendDirection="up-bad"`

> trendDelta 接入需调用 `useTrend`——dashboard 是 server-leaning 的 client 组件。本期先不接 delta（TrendChip 不渲染），仅声明方向供后续。在 Task 19 验证时确认无 delta 时不渲染。

- [ ] **Step 3: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat(web): dashboard 接入 DashboardTodoPanel + MetricCard trendDirection 声明"
```

---

## Task 17: 详情页接入 AlertBanner

**Files:**
- Modify: `apps/web/src/app/(dashboard)/supplier/[id]/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/expert/[id]/page.tsx`

- [ ] **Step 1: supplier/[id] 接入**

import 加：
```ts
import { AlertBanner, type AlertSeverity } from '@/components/workbench';
import { useSupplierAlerts } from '@/lib/hooks/use-alerts';
```

`SupplierDetailPage` 组件内（`loadAll` 后）加：
```ts
const alerts = useSupplierAlerts(id as string);
const alertItems = alerts.expiringQualifications.map((q) => {
  const severity: AlertSeverity = q.daysLeft < 0 || q.daysLeft < 7 ? 'red' : q.daysLeft < 30 ? 'orange' : 'orange-light';
  const prefix = q.daysLeft < 0 ? '已过期' : q.daysLeft < 7 ? '即将过期' : q.daysLeft < 30 ? '即将到期' : '注意到期';
  return { severity, title: `${prefix}：${q.name}`, detail: `有效期至 ${new Date(q.validTo).toLocaleDateString('zh-CN')}（${q.daysLeft < 0 ? '已过期' : `剩 ${q.daysLeft} 天`}）` };
});
```

在品牌横幅 `<div className="bg-gradient-to-r ...">...</div>` **之后**（Tab 导航之前）插入：
```tsx
      <div className="mb-4"><AlertBanner items={alertItems} /></div>
```

- [ ] **Step 2: expert/[id] 接入**

import 加：
```ts
import { AlertBanner } from '@/components/workbench';
import { useExpertAlerts } from '@/lib/hooks/use-alerts';
```

`ExpertDetailPage` 内（数据加载后）加：
```ts
const alerts = useExpertAlerts(expertId);
const alertItems = [
  ...(alerts.consecutiveD ? [{ severity: 'red' as const, title: '连续 2 次 D 级评价', detail: '该专家近期履职评价连续不合格，建议关注' }] : []),
  ...(alerts.overloaded ? [{ severity: 'orange' as const, title: '评审负荷过载', detail: `同时参与 ${alerts.activeProjectCount} 个未归档项目，超过 3 个上限` }] : []),
];
```

在返回按钮 `<button ...>返回专家列表</button>` **之后**插入：
```tsx
{alertItems.length > 0 && <div className="mb-5"><AlertBanner items={alertItems} /></div>}
```

- [ ] **Step 3: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/app/(dashboard)/supplier/[id]/page.tsx apps/web/src/app/(dashboard)/expert/[id]/page.tsx
git commit -m "feat(web): 供应商/专家详情页接入 AlertBanner（临期资质/连续D级/过载）"
```

---

## Task 18: 整页通知 /notifications

**Files:**
- Create: `apps/web/src/app/(dashboard)/notifications/page.tsx`

- [ ] **Step 1: 创建页面**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta } from '@water-erp/shared';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '@/lib/api/notification';
import { PageHero, statusTone } from '@/components/workbench';

export default function NotificationsPage() {
  const [tab, setTab] = useState<'todo' | 'all'>('todo');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listNotifications(tab, page, 20).then((r) => { setItems(r.items); setTotal(r.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [tab, page]);

  const totalPages = Math.ceil(total / 20);
  const todoCount = items.length; // todo tab 下 items 即未 resolve

  const onRead = async (id: string) => { await markNotificationRead(id); setItems((xs) => xs.map((n) => n.id === id ? { ...n, isRead: true } : n)); };
  const onAllRead = async () => { await markAllNotificationsRead(); setItems((xs) => xs.map((n) => ({ ...n, isRead: true }))); };

  return (
    <div className="space-y-6">
      <PageHero title="通知中心" description="全部站内通知与待办。支持按「待办/全部」查看、标记已读。" tone="blue" icon={<Bell size={14} />} />
      <div className="flex items-center justify-between">
        <div className="flex gap-2 border-b border-[#e5ecf4]">
          {(['todo', 'all'] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setPage(1); }} className={`relative px-4 py-2 text-sm font-extrabold transition ${tab === t ? 'text-[#064ea2]' : 'text-[#5a6d8a] hover:text-[#18243a]'}`}>
              {t === 'todo' ? `待办` : '全部'}
              {tab === t && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[#064ea2]" />}
            </button>
          ))}
        </div>
        <button onClick={onAllRead} className="rounded-xl border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc]">全部已读</button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e5ecf4] bg-white">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#8a99ad]">加载中...</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center"><Check size={24} className="mx-auto mb-2 text-[#11a874]" /><p className="text-sm font-bold text-[#18243a]">{tab === 'todo' ? '待办已清零' : '暂无通知'}</p></div>
        ) : items.map((n) => {
          const meta = getNotificationMeta(n.type);
          const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
          const tone = statusTone[meta.tone];
          return (
            <button key={n.id} onClick={() => onRead(n.id)} className={`flex w-full items-start gap-3 border-b border-[#eef3f8] px-5 py-4 text-left transition hover:bg-[#f8fafc] ${!n.isRead ? 'bg-[#f0f7ff]' : ''} ${n.resolvedAt ? 'opacity-50' : ''}`}>
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ color: tone.color, backgroundColor: tone.bg }}><Icon size={15} strokeWidth={1.8} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-sm font-bold text-[#18243a]">{n.title}</span>{n.resolvedAt && <span className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] font-bold text-[#8a99ad]">已处理</span>}</div>
                <div className="mt-0.5 text-xs text-[#5a6d8a]">{n.content}</div>
                <div className="mt-1 text-[11px] text-[#8a99ad]">{new Date(n.createdAt).toLocaleString('zh-CN')}{n.link && <span className="ml-2 font-bold text-[#064ea2]">查看 →</span>}</div>
              </div>
              {!n.isRead && <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#064ea2]" />}
            </button>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#8a99ad]">共 {total} 条，第 {page}/{totalPages} 页</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-[#e5ecf4] px-3 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-40">上一页</button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-[#e5ecf4] px-3 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-40">下一页</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/app/(dashboard)/notifications/page.tsx
git commit -m "feat(web): /notifications 整页通知（待办/全部+分页+批量已读）"
```

---

## Task 19: 集成验证（类型 + 构建 + 手动）

**Files:** 无（验证 Task）

- [ ] **Step 1: 后端全量测试**

Run:
```bash
pnpm --filter api test 2>&1 | tail -20
```
Expected: 全绿（含新 notification/supplier/alerts spec）。如有红，修复后重跑。

- [ ] **Step 2: 前端类型检查（仅计新 error）**

Run:
```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep -vE "lucide|ReactNode|cannot be used as a JSX" | head
```
Expected: 无输出（既有 Lucide 类型 error 已过滤）。若有新 error，修复。

- [ ] **Step 3: shared 重新编译（确保门户拿到 NOTIFICATION_META）**

```bash
pnpm --filter @water-erp/shared build
```

- [ ] **Step 4: 启动 API + web 手动验证**

API（如未运行）：`pnpm dev:api`（后台）。web：用户自行 `pnpm dev:web`（:3005）。

以 `caigou/caigou@2026` 登录 :3005，逐项核对 spec §验收标准：

1. 头部右侧出现铃铛；若有未读显示红点数字。
2. 制造待办：用 supplier-portal（:3004）注册一个新供应商 → 30s 内 :3005 铃铛红点 +1，下拉「待办」出现「新供应商注册待审批」，点「去处理 →」跳 `/supplier/approval`。
3. 在 :3005 审批该供应商（通过）→ 下次轮询后「待办」清零（SUPPLIER_PENDING 已 resolve，半透明移到「全部」）。
4. 首页 MetricCard 行下方出现「今日待办」聚合区（供应商审批/资质到期/价格复核三块数字）；无待办时显示「今日待办已清零」绿条。
5. 侧边栏「供应商审批」「价格审批」子项 badge 数字与首页待办一致（同源 derivedTodo）。
6. 供应商详情页（任一 APPROVED 供应商）：若其资质 90 天内到期，顶部出现橙/红告警横幅。
7. 专家详情页：连续 D 级 / 过载专家出现横幅。
8. `/notifications` 整页可查看、分页、批量已读。
9. 下拉支持 Esc 关闭、点外部关闭。
10. 全站通知无 emoji（均为 Lucide 图标）。

- [ ] **Step 5: Commit 验证记录（可选）**

如有验证中发现的修复，提交：
```bash
git add -A && git commit -m "fix(web): 主题B 集成验证修复"
```

---

## Self-Review

**1. Spec 覆盖：**
- §1 通知中心 → Task 3(list/resolve) + 4(SUPPLIER_PENDING) + 11(组件) + 18(整页) ✓
- §2 数据与实时性 → Task 7(轮询 30s) + Implementation Notes(actionable 判定) ✓
- §3 MetricCard 趋势分阶段 → Task 10(Chip) + 14(props) + 16(声明)；第二阶段 sparkline 明确不在本期 ✓
- §4 首页待办队列 → Task 12 ✓
- §5 异常主动浮现 → Task 13(Banner) + 17(接入) + 5+9(alerts 端点/hook) ✓
- §6 可达性 → Task 11(Esc/点外/aria) ✓
- §7 组件清单 → Tasks 6-18 全覆盖 ✓
- §8 YAGNI → sparkline/WebSocket/偏好 均未实现 ✓
- **资质到期偏离**：spec 列为 actionable 通知，计划改为状态派生（Implementation Notes 已说明理由）——需用户知悉。

**2. 占位符扫描：** 无 TBD/TODO；每步含完整代码或确切命令。

**3. 类型一致性：** `useNotifications` 返回 `{ unreadCount, todoItems, recent, derivedTodo, refresh, markRead, markAllRead }` 在 Task 7/11/12/15 引用一致；`resolveActionable(type, link)` 在 Task 3 定义、Task 4 调用，签名一致；`NOTIFICATION_META` 字段 `{ icon, tone, actionable }` 在 Task 2 定义、Task 11/18 消费一致；`AlertSeverity` Task 13 定义、Task 17 消费一致。

---

## 已知偏离（需用户知悉）

**`QUALIFICATION_EXPIRING` 与 `PRICE_REVIEW` 改为状态派生**（spec 原列为 actionable 通知）。理由：无干净 per-entity resolve 事件，事件型通知易产生陈旧待办。改为 alerts 端点查询，随轮询自纠，更稳健。`resolvedAt` 字段仍新增（`SUPPLIER_PENDING` 使用 + 向前兼容）。spec §1.3 的 type 表相应调整：这两个 type 仍保留在 `NOTIFICATION_META`（actionable 标记供未来），但 theme B 不发此类通知。
