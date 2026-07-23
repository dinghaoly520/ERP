# 在线开标大厅（迭代一：实时文字地基）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让供应商端接入 `/bid` 实时通道，实现开标大厅签到、公聊+私聊文字互动、确认/异议实时双向触达，全部交流落库存证并随归档包导出。

**Architecture:** 扩展 `BidGateway` 软鉴权认 `token_supplier`，以"角色门 + 成员门"双层门控保证供应商只见公开事件；新建 `opening-hall` NestJS 模块（`OpeningHallMessage` + `OpeningHallReadCursor` 两张表）承载聊天 REST 与推送（REST 优先：先落库再 emit）；supplier-portal 移植主持端 socket 工程为 Vue composable + 新大厅页；bid-portal 开标大厅页增会场交流抽屉；迭代二直播不实施，仅预留解耦原则。

**Tech Stack:** NestJS 11 + Prisma + Socket.IO（API :4001）、Vue 3 + Element Plus + socket.io-client（supplier-portal :3004）、Next.js 16 React（bid-portal :3007）、`@water-erp/shared` 事件契约、jest + supertest + socket.io-client（E2E）。

## Global Constraints

- 所有工作区命令在 `water-erp/` 根目录执行；当前分支 `feat/online-bid-opening-hall`。
- **迁移铁律**（CLAUDE.md + 项目记忆）：禁用交互式 `prisma migrate dev`（会 reset 丢数据）。一律 `migrate dev --create-only` → `prisma db execute --file <sql>` → `migrate resolve --applied <name>` → `prisma generate`。
- **TS 导入约定**：tsconfig 无 `esModuleInterop`。本工程消毒直接调用既有 `sanitizeHtmlContent()`（`apps/api/src/common/html-sanitize.util.ts:39`），无需自引 sanitize-html。
- **jest + ESM-only 依赖**：新增 ESM-only 依赖若报 `Cannot use import statement`，需同时加入 `apps/api/jest.config.js` 与 `apps/api/test/jest-e2e.json` 的 `transformIgnorePatterns` allowlist。
- **事件契约铁律**：分数永不出现在事件载荷；emit 一律在事务**提交后**调用（gateway `@Optional()` 注入，emit 失败不影响 REST 主流程）。
- **共享包改动后必须重新构建**：`pnpm --filter @water-erp/shared build`（改了 config 同理）。
- **前端无 mock 兜底**：真实数据 / loading / 空状态三态。
- supplier-portal 用 Vue 3 + Element Plus + Pinia；bid-portal 用 Next.js 16 + Tailwind v4（cgzxui 化迁移进行中——新增组件不得破坏现有页面样式；bid-portal 无 eslint，用 `pnpm --filter bid-portal exec tsc --noEmit` 校验）。
- 每个 commit 只 commit 不 push（用户惯例：仅提醒未推送数量，等用户明示才 push）。
- 供应商端设计体系维持 Element Plus 现状（`.impeccable.md` 是 React 侧规范，不强套 Vue 门户）。
- 设计文档：`docs/superpowers/specs/2026-07-23-online-bid-opening-hall-design.md`（所有需求的权威来源）。

---

## File Structure

**API（apps/api）**
- `packages/shared/src/bid-events.ts`（改）— 新增 7 个事件常量 + 7 个载荷接口
- `packages/shared/src/constants.ts`（改）— NOTIFICATION_META 增 `HALL_MESSAGE`
- `apps/api/prisma/schema.prisma`（改）— 2 枚举 + 2 新模型 + 3 模型加字段
- `apps/api/prisma/seed-data/OpeningHallMessage.json`、`OpeningHallReadCursor.json`（新）— 演示种子
- `apps/api/prisma/seed.ts`（改）— ALL_TABLES / SEED_ORDER 注册新表
- `apps/api/src/bid/bid.gateway.ts`（改）— 认 token_supplier、双层门控、在场表、9 个新 notify 方法
- `apps/api/src/bid/bid.gateway.spec.ts`（新）— 门控纯函数单测
- `apps/api/src/opening-hall/`（新模块）— module / controller / service / 3 DTO / service.spec.ts
- `apps/api/src/supplier-portal/supplier-portal.service.ts`（改 :825-882）— confirmOpening/disputeOpening 补 emit
- `apps/api/src/supplier-portal/supplier-portal.module.ts`（改）— imports 增 BidModule
- `apps/api/src/supplier-portal/supplier-portal.controller.ts`（改 :153-161）— 提问 DTO 支持附件
- `apps/api/src/bid/bid.service.ts`（改 :1042-1077）— resolveOpeningDispute 补 emit；:1796+ exportArchivePackage 增 hallMessages 段
- `apps/api/test/opening-hall.e2e-spec.ts`（新）— 门控四件套 + 全流程 E2E

**supplier-portal（apps/supplier-portal）**
- `package.json`（改）— 加 socket.io-client、@water-erp/config、@water-erp/shared
- `src/composables/useBidWebSocket.ts`（新）— Vue 版 socket 工程
- `src/api/openingHall.ts`（新）— 大厅 REST 客户端
- `src/components/bid/ChatPanel.vue`（新）— 公聊/私聊面板
- `src/views/bid/OpeningHall.vue`（新）— 在线开标大厅页
- `src/views/bid/OpeningConfirm.vue`（改）— 重定向到大厅页（兼容旧入口）
- `src/views/bid/MyBids.vue`（改 :243 附近）— OPENING 项目增"进入开标大厅"入口
- `src/views/bid/BidDetail.vue`（改）— 标前答疑 UI 更名"书面交流" + 附件
- `src/api/bid.ts`、`src/api/supplier.ts`（改）— createQuestion 带附件
- `src/router/index.ts`（改 :85 附近）— 注册 opening-hall 路由

**bid-portal（apps/bid-portal）**
- `src/hooks/use-bid-websocket.ts`（改）— handlers 增 7 个大厅事件
- `src/lib/opening-hall.ts`（新）— REST 客户端
- `src/components/bid/exchange-drawer.tsx`（新）— 会场交流抽屉（花名册+聊天+控制）
- `src/app/(dashboard)/bid/open/page.tsx`（改）— 集成抽屉 + 确认/异议 toast
- `src/app/(dashboard)/bid/supervise/page.tsx`（改）— 只读"大厅交流"页签

---

## M1 实时链路（API）

### Task 1: shared 事件契约扩展

**Files:**
- Modify: `packages/shared/src/bid-events.ts`
- Modify: `packages/shared/src/constants.ts`（NOTIFICATION_META 块，约 :154-170）

**Interfaces:**
- Produces: `BID_EVENT.HALL_MESSAGE_NEW='hall:message:new'`、`HALL_PRESENCE_UPDATE='hall:presence:update'`、`HALL_CHECKIN='hall:checkin'`、`HALL_EXCHANGE_CONTROL='hall:exchange:control'`、`OPENING_CONFIRMED='opening:confirmed'`、`OPENING_DISPUTED='opening:disputed'`、`OPENING_DISPUTE_RESOLVED='opening:dispute:resolved'`；类型 `OpeningHallRoomType='PUBLIC'|'PRIVATE'`、`OpeningHallSenderRole='HOST'|'SUPPLIER'|'SYSTEM'`；载荷接口 `HallMessagePayload`、`HallPresenceUpdatePayload`、`HallCheckinPayload`、`HallExchangeControlPayload`、`OpeningConfirmedPayload`、`OpeningDisputedPayload`、`OpeningDisputeResolvedPayload`；NOTIFICATION_META 增 `HALL_MESSAGE`

- [ ] **Step 1: 在 `bid-events.ts` 的 `BID_EVENT` 常量对象末尾追加事件名**

```ts
  HALL_MESSAGE_NEW: 'hall:message:new',
  HALL_PRESENCE_UPDATE: 'hall:presence:update',
  HALL_CHECKIN: 'hall:checkin',
  HALL_EXCHANGE_CONTROL: 'hall:exchange:control',
  OPENING_CONFIRMED: 'opening:confirmed',
  OPENING_DISPUTED: 'opening:disputed',
  OPENING_DISPUTE_RESOLVED: 'opening:dispute:resolved',
```

- [ ] **Step 2: 在 `bid-events.ts` 文件末尾（`ConnectionState` 定义之后）追加类型与载荷接口**

```ts
// ── 开标大厅（迭代一：实时文字地基）──

export type OpeningHallRoomType = 'PUBLIC' | 'PRIVATE';
export type OpeningHallSenderRole = 'HOST' | 'SUPPLIER' | 'SYSTEM';

export interface HallMessagePayload {
  id: string;
  projectId: string;
  roomType: OpeningHallRoomType;
  supplierId: string | null;   // PRIVATE 时为 Supplier.id；PUBLIC 为 null
  supplierName: string | null;
  senderId: string;
  senderRole: OpeningHallSenderRole;
  senderName: string;
  content: string;
  createdAt: string;           // ISO
  timestamp: number;
}

export interface HallPresenceUpdatePayload {
  projectId: string;
  onlineSuppliers: Array<{ supplierId: string; supplierName: string; checkInAt: string | null }>;
  onlineCount: number;
  timestamp: number;
}

export interface HallCheckinPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  checkInAt: string;
  timestamp: number;
}

export interface HallExchangeControlPayload {
  projectId: string;
  control: 'OPEN' | 'MUTED' | 'CLOSED';
  by: string;
  timestamp: number;
}

export interface OpeningConfirmedPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  timestamp: number;
}

export interface OpeningDisputedPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  reason: string;
  timestamp: number;
}

export interface OpeningDisputeResolvedPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  recordId: string;
  confirm: boolean;
  result: string;
  timestamp: number;
}
```

- [ ] **Step 3: 在 `constants.ts` 的 NOTIFICATION_META 中 `CLARIFICATION_REPLIED` 行后追加**

```ts
  HALL_MESSAGE:            { icon: 'MessagesSquare',   tone: 'blue',   actionable: true  },
```

- [ ] **Step 4: 构建共享包并验证编译**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter @water-erp/shared build`
Expected: tsc 成功，`packages/shared/dist/` 更新，无错误。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/bid-events.ts packages/shared/src/constants.ts
git commit -m "feat(shared): 开标大厅 hall:*/opening:* 事件契约 + HALL_MESSAGE 通知类型"
```

---

### Task 2: Prisma schema 与迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（枚举区 :83-119、BidSupplier :300-327、BidOpeningSession :350-362、BidClarification :560-577）

**Interfaces:**
- Produces: 枚举 `OpeningHallRoomType{PUBLIC,PRIVATE}`、`OpeningHallSenderRole{HOST,SUPPLIER,SYSTEM}`、`OpeningHallMessageType{TEXT}`；模型 `OpeningHallMessage`、`OpeningHallReadCursor`；`BidSupplier.checkInAt/checkInMeta/lastSeenAt`；`BidOpeningSession.exchangeControl`；`BidClarification.fileAssetId`

- [ ] **Step 1: 在 `ArchiveStatus` 枚举（:115-119）之后追加三个枚举**

```prisma
enum OpeningHallRoomType {
  PUBLIC
  PRIVATE
}

enum OpeningHallSenderRole {
  HOST
  SUPPLIER
  SYSTEM
}

enum OpeningHallMessageType {
  TEXT
}
```

- [ ] **Step 2: 在 `ChatMessage` 模型（:1123）之前追加两个新模型**

```prisma
// ── 开标大厅（迭代一：实时文字地基）──

model OpeningHallMessage {
  id          String                 @id @default(cuid())
  projectId   String
  roomType    OpeningHallRoomType
  supplierId  String? // PRIVATE 时为 Supplier.id；PUBLIC 为 null
  senderId    String
  senderRole  OpeningHallSenderRole
  senderName  String // 发送时姓名快照（存证不依赖日后改名）
  type        OpeningHallMessageType @default(TEXT)
  content     String
  fileAssetId String? // 预留：迭代二短语音
  createdAt   DateTime               @default(now())

  @@index([projectId, roomType, supplierId, createdAt])
  @@index([projectId, createdAt])
}

model OpeningHallReadCursor {
  id         String   @id @default(cuid())
  projectId  String
  userId     String
  roomKey    String // "public"（公聊）| "supplier:<supplierId>"（私聊）
  lastReadAt DateTime @default(now()) @updatedAt

  @@unique([projectId, userId, roomKey])
}
```

- [ ] **Step 3: `BidSupplier` 模型 `bidValidity` 字段（:323）后追加三字段**

```prisma
  checkInAt            DateTime? // 开标大厅签到时间
  checkInMeta          String?   // 签到环境 JSON 快照：IP / User-Agent（存证）
  lastSeenAt           DateTime? // 大厅在场心跳（节流写入）
```

- [ ] **Step 4: `BidOpeningSession` 模型 `remainingSeconds` 字段（:358）后追加**

```prisma
  exchangeControl  String     @default("OPEN") // OPEN 允许群聊 | MUTED 仅主持人可发言 | CLOSED 关闭互动
```

- [ ] **Step 5: `BidClarification` 模型 `reply` 字段（:569）后追加**

```prisma
  fileAssetId  String? // 书面交流来函附件（迭代一：书面渠道改造）
```

- [ ] **Step 6: 生成迁移 SQL（不执行）**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx prisma migrate dev --create-only --name opening_hall`
Expected: 生成 `prisma/migrations/<timestamp>_opening_hall/migration.sql`，未应用。

- [ ] **Step 7: 审查生成的 SQL**

Run: `cat prisma/migrations/*_opening_hall/migration.sql`
Expected: 含 `CREATE TYPE "OpeningHallRoomType"` 等三枚举、两张新表、`ALTER TABLE "BidSupplier" ADD COLUMN "checkInAt" TIMESTAMP(3)` 等五处加字段（默认值正确：`exchangeControl` 默认 `'OPEN'`）。无删表/改主键语句。

- [ ] **Step 8: 手动执行 SQL 并标记已应用（项目迁移约定）**

```bash
npx prisma db execute --file prisma/migrations/*_opening_hall/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied $(ls prisma/migrations | grep opening_hall)
npx prisma generate
```

Expected: 三条命令均成功；Prisma Client 重新生成含新模型。

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): OpeningHallMessage/ReadCursor 模型 + 签到/交流控制/来函附件字段"
```

---

### Task 3: BidGateway 供应商接入、双层门控与在场表

**Files:**
- Modify: `apps/api/src/bid/bid.gateway.ts`
- Create: `apps/api/src/bid/bid.gateway.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `BID_EVENT.HALL_*`/`OPENING_*` 常量与全部载荷接口；`PrismaService`
- Produces: 导出纯函数 `tokenFromHandshake(socket)`、`canJoinHostRoom(role)`、`SUPPLIER_BLOCKED_EVENTS`；实例方法 `notifyHallMessage(projectId, payload)`（按 roomType 路由）、`notifyHallCheckin(projectId, payload)`、`broadcastHallPresence(projectId)`、`notifyExchangeControl(projectId, payload)`、`notifyOpeningConfirmed/Disputed/DisputeResolved(projectId, supplierId, payload)`、`getOnlineSupplierIds(projectId): Set<string>`

- [ ] **Step 1: 写门控纯函数的失败单测**

Create `apps/api/src/bid/bid.gateway.spec.ts`:

```ts
import { BID_EVENT } from '@water-erp/shared';
import { canJoinHostRoom, SUPPLIER_BLOCKED_EVENTS } from './bid.gateway';

describe('BidGateway 门控纯函数', () => {
  it('host 房仅限 admin/bid_host/leader/staff', () => {
    expect(canJoinHostRoom('admin')).toBe(true);
    expect(canJoinHostRoom('bid_host')).toBe(true);
    expect(canJoinHostRoom('leader')).toBe(true);
    expect(canJoinHostRoom('staff')).toBe(true);
    expect(canJoinHostRoom('supplier')).toBe(false);
    expect(canJoinHostRoom('bid_expert')).toBe(false);
    expect(canJoinHostRoom(undefined)).toBe(false);
  });

  it('供应商屏蔽事件集：监督日志/异常/专家个体在场', () => {
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.SUPERVISION_LOG)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.ANOMALY_DETECTED)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.EXPERT_PRESENCE)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.STAGE_CHANGE)).toBe(false);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.DECRYPT_STATUS)).toBe(false);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.HALL_MESSAGE_NEW)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行单测确认失败**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test -- bid.gateway.spec`
Expected: FAIL — `canJoinHostRoom` 未导出。

- [ ] **Step 3: 改造 `bid.gateway.ts` 顶部：导入、常量、token 解析**

替换导入块与 `HOST_ROLES`/`tokenFromHandshake`（:12-41）为：

```ts
import {
  BID_EVENT,
  type DecryptStatusPayload,
  type SubmissionOpenedPayload,
  type OpeningStartedPayload,
  type StageChangePayload,
  type EvaluationStartedPayload,
  type ExpertPresencePayload,
  type ExpertPresenceAggregatePayload,
  type ClarificationCreatedPayload,
  type ClarificationRepliedPayload,
  type SupervisionLogPayload,
  type AnomalyDetectedPayload,
  type BidValidityChangePayload,
  type HallMessagePayload,
  type HallPresenceUpdatePayload,
  type HallCheckinPayload,
  type HallExchangeControlPayload,
  type OpeningConfirmedPayload,
  type OpeningDisputedPayload,
  type OpeningDisputeResolvedPayload,
} from '@water-erp/shared';

/** Roles that may see individual presence / supervision / anomalies (command center). */
const HOST_ROLES = new Set(['admin', 'bid_host', 'leader', 'staff']);

export function canJoinHostRoom(role: string | undefined): boolean {
  return !!role && HOST_ROLES.has(role);
}

/** 供应商绝不可见的事件（评分过程/监督/异常——设计文档 §4.3）。 */
export const SUPPLIER_BLOCKED_EVENTS = new Set<string>([
  BID_EVENT.SUPERVISION_LOG,
  BID_EVENT.ANOMALY_DETECTED,
  BID_EVENT.EXPERT_PRESENCE,
]);

/** Parse the auth token from the raw handshake cookie header. */
export function tokenFromHandshake(socket: Socket): string | undefined {
  const raw = socket.handshake.headers.cookie;
  if (!raw) return undefined;
  const map = new Map<string, string>();
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return (
    map.get('token_web') ||
    map.get('token_expert') ||
    map.get('token_supplier') ||
    map.get('token')
  );
}
```

- [ ] **Step 4: 类内新增在场表字段，整体替换 handleConnection**

在 `private readonly logger = ...` 后追加：

```ts
  /** supplierId(Supplier.id) → socket id 集合（私聊定向投递 + 在场感知）。 */
  private readonly supplierSockets = new Map<string, Set<string>>();
  /** socket.id → 所属项目（断连时回收在场表）。 */
  private readonly socketProjects = new Map<string, string>();
```

整体替换 `handleConnection` 方法（:61-75）为：

```ts
  async handleConnection(socket: Socket) {
    const token = tokenFromHandshake(socket);
    let role: string | undefined;
    let userId: string | undefined;
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync(token);
        role = payload?.role;
        userId = payload?.sub;
      } catch {
        role = undefined;
      }
    }
    (socket.data as any).userId = userId;
    (socket.data as any).role = role;
    (socket.data as any).isHost = canJoinHostRoom(role);
    this.logger.debug(`WS connected role=${role || 'unknown'} host=${(socket.data as any).isHost}`);
  }
```

- [ ] **Step 5: 改造 `join:project` 为双层门控（异步成员校验）**

替换 `handleJoinProject`（:83-87）：

```ts
  @SubscribeMessage('join:project')
  async handleJoinProject(client: Socket, projectId: string) {
    const role: string | undefined = (client.data as any).role;
    const userId: string | undefined = (client.data as any).userId;

    if (role === 'supplier') {
      // 双层门控（设计 §4.2）：角色门（supplier 永不进 host 房）+ 成员门（须参投本项目）
      if (!userId) return { error: 'UNAUTHORIZED' };
      const supplier = await this.prisma.supplier.findFirst({ where: { userId } });
      if (!supplier) return { error: 'SUPPLIER_PROFILE_NOT_FOUND' };
      const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: supplier.id } });
      if (!member) return { error: 'NOT_PROJECT_MEMBER' };

      (client.data as any).supplierId = supplier.id;
      (client.data as any).supplierName = member.supplierName;
      (client.data as any).projectId = projectId;

      let set = this.supplierSockets.get(supplier.id);
      if (!set) { set = new Set(); this.supplierSockets.set(supplier.id, set); }
      set.add(client.id);
      this.socketProjects.set(client.id, projectId);

      await this.prisma.bidSupplier.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      client.join(`project:${projectId}`);
      this.broadcastHallPresence(projectId).catch(() => {});
      return { ok: true, supplierId: supplier.id, supplierName: member.supplierName };
    }

    client.join(`project:${projectId}`);
    if (canJoinHostRoom(role)) client.join(`host:${projectId}`);
    return { ok: true };
  }
```

- [ ] **Step 6: handleDisconnect 回收在场表**

替换 `handleDisconnect`（:77-79）：

```ts
  handleDisconnect(socket: Socket) {
    const supplierId: string | undefined = (socket.data as any).supplierId;
    const projectId = this.socketProjects.get(socket.id);
    if (supplierId) {
      const set = this.supplierSockets.get(supplierId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) this.supplierSockets.delete(supplierId);
      }
    }
    this.socketProjects.delete(socket.id);
    if (projectId) this.broadcastHallPresence(projectId).catch(() => {});
  }
```

- [ ] **Step 7: `broadcastAggregatePresence` 目标改为 host 房（:161）**

把

```ts
    this.server.to(`project:${projectId}`).emit(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, payload);
```

改为

```ts
    // 设计 §4.3：评标进度聚合仅主持内部可见，供应商不可见
    this.server.to(`host:${projectId}`).emit(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, payload);
```

- [ ] **Step 8: 类末尾追加 9 个大厅 notify 方法**

在 `notifyAnomaly` 方法（:181-184）后追加：

```ts
  // ── 开标大厅（迭代一）：供应商可见事件走 project 房；私聊/定向事件按连接表投递 ──

  /** 大厅消息：PUBLIC → project 房全员；PRIVATE → host 房 + 该供应商自己的连接。 */
  notifyHallMessage(projectId: string, payload: HallMessagePayload) {
    if (payload.roomType === 'PUBLIC') {
      this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
      return;
    }
    this.server.to(`host:${projectId}`).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
    if (payload.supplierId) {
      const ids = this.supplierSockets.get(payload.supplierId);
      if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
    }
  }

  notifyHallCheckin(projectId: string, payload: HallCheckinPayload) {
    this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_CHECKIN, payload);
  }

  notifyExchangeControl(projectId: string, payload: HallExchangeControlPayload) {
    this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_EXCHANGE_CONTROL, payload);
  }

  /** 在场名单：合并内存连接表与 DB 签到状态，广播 project 房。 */
  async broadcastHallPresence(projectId: string) {
    const rows = await this.prisma.bidSupplier.findMany({
      where: { projectId },
      select: { supplierId: true, supplierName: true, checkInAt: true },
    });
    const onlineSuppliers = rows
      .filter(r => r.supplierId && (this.supplierSockets.get(r.supplierId)?.size ?? 0) > 0)
      .map(r => ({ supplierId: r.supplierId as string, supplierName: r.supplierName, checkInAt: r.checkInAt?.toISOString() ?? null }));
    const payload: HallPresenceUpdatePayload = {
      projectId, onlineSuppliers, onlineCount: onlineSuppliers.length, timestamp: Date.now(),
    };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_PRESENCE_UPDATE, payload);
  }

  getOnlineSupplierIds(projectId: string): Set<string> {
    const out = new Set<string>();
    for (const [supplierId, ids] of this.supplierSockets) {
      for (const sid of ids) if (this.socketProjects.get(sid) === projectId) { out.add(supplierId); break; }
    }
    return out;
  }

  // ── 确认/异议：host 房 + 当事供应商连接（设计 §6.3，不广播全 project 房）──

  notifyOpeningConfirmed(projectId: string, supplierId: string, payload: OpeningConfirmedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_CONFIRMED, payload);
    const ids = this.supplierSockets.get(supplierId);
    if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.OPENING_CONFIRMED, payload);
  }

  notifyOpeningDisputed(projectId: string, supplierId: string, payload: OpeningDisputedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_DISPUTED, payload);
    const ids = this.supplierSockets.get(supplierId);
    if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.OPENING_DISPUTED, payload);
  }

  notifyOpeningDisputeResolved(projectId: string, supplierId: string, payload: OpeningDisputeResolvedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_DISPUTE_RESOLVED, payload);
    const ids = this.supplierSockets.get(supplierId);
    if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.OPENING_DISPUTE_RESOLVED, payload);
  }
```

- [ ] **Step 9: 运行单测确认通过**

Run: `pnpm --filter api test -- bid.gateway.spec`
Expected: PASS（2 个用例）。

- [ ] **Step 10: API 编译验证**

Run: `pnpm --filter api exec tsc --noEmit -p tsconfig.json || pnpm --filter api build`
Expected: 无类型错误。

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/bid/bid.gateway.ts apps/api/src/bid/bid.gateway.spec.ts
git commit -m "feat(api): BidGateway 供应商接入 + 双层门控 + 在场表 + 大厅事件推送"
```

---

### Task 4: opening-hall service 核心逻辑（TDD）

**Files:**
- Create: `apps/api/src/opening-hall/opening-hall.service.ts`
- Create: `apps/api/src/opening-hall/opening-hall.service.spec.ts`
- Create: `apps/api/src/opening-hall/dto/send-message.dto.ts`、`dto/mark-read.dto.ts`、`dto/exchange-control.dto.ts`

**Interfaces:**
- Consumes: Task 2 的 Prisma 模型；Task 3 的 `BidGateway.notifyHallMessage/notifyHallCheckin/notifyExchangeControl/broadcastHallPresence/getOnlineSupplierIds`；`sanitizeHtmlContent()`；`NotificationService.create(dto)`（dto: `{userId,type,title,content,link?}`）
- Produces: `OpeningHallService` 方法 `sendMessage(actor, projectId, dto)` → `OpeningHallMessage` 行；`listMessages(actor, projectId, q)` → `{items, nextCursor}`；`unreadCounts(actor, projectId)`；`markRead(projectId, userId, roomKey)`；`checkIn(actor, projectId, meta)` → `{checkInAt}`；`presence(projectId, actor)`；`setExchangeControl(projectId, control, byName)`；actor 形如 `{ userId: string; role: string; supplierId?: string; supplierName?: string }`

- [ ] **Step 1: 写三个 DTO**

`dto/send-message.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, MaxLength, IsNotEmpty } from 'class-validator';

export class SendMessageDto {
  @IsIn(['PUBLIC', 'PRIVATE'])
  roomType!: 'PUBLIC' | 'PRIVATE';

  @IsOptional() @IsString()
  supplierId?: string; // PRIVATE 必填（哪家供应商的私聊）

  @IsString() @IsNotEmpty() @MaxLength(2000)
  content!: string;
}
```

`dto/mark-read.dto.ts`:

```ts
import { IsString, Matches } from 'class-validator';

export class MarkReadDto {
  @IsString() @Matches(/^(public|supplier:.+)$/)
  roomKey!: string;
}
```

`dto/exchange-control.dto.ts`:

```ts
import { IsIn } from 'class-validator';

export class ExchangeControlDto {
  @IsIn(['OPEN', 'MUTED', 'CLOSED'])
  control!: 'OPEN' | 'MUTED' | 'CLOSED';
}
```

- [ ] **Step 2: 写 service 失败单测（核心规则表驱动）**

Create `opening-hall.service.spec.ts`（prisma/gateway/notification 全 mock）：

```ts
import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { OpeningHallService, HOST_ROLES_SET } from './opening-hall.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';
import { NotificationService } from '../notification/notification.service';

const prismaMock = {
  bidProject: { findUnique: jest.fn() },
  bidOpeningSession: { findUnique: jest.fn(), update: jest.fn() },
  bidSupplier: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  openingHallMessage: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  openingHallReadCursor: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  bidSupervisionLog: { create: jest.fn() },
  supplier: { findFirst: jest.fn() },
} as any;
const gatewayMock = {
  notifyHallMessage: jest.fn(), notifyHallCheckin: jest.fn(),
  notifyExchangeControl: jest.fn(), broadcastHallPresence: jest.fn(),
  getOnlineSupplierIds: jest.fn().mockReturnValue(new Set()),
} as any;
const notificationMock = { create: jest.fn() } as any;

const host = { userId: 'u-host', role: 'bid_host', supplierId: undefined, supplierName: undefined };
const sup = { userId: 'u-sup', role: 'supplier', supplierId: 'sup-1', supplierName: '测试供应商' };

function setup() {
  prismaMock.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
  prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'OPEN' });
  prismaMock.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 'sup-1', supplierName: '测试供应商', checkInAt: null });
  prismaMock.openingHallMessage.create.mockImplementation(async ({ data }: any) => ({ ...data, id: 'm1', createdAt: new Date('2026-07-23T00:00:00Z') }));
}

describe('OpeningHallService', () => {
  let svc: OpeningHallService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        OpeningHallService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BidGateway, useValue: gatewayMock },
        { provide: NotificationService, useValue: notificationMock },
      ],
    }).compile();
    svc = mod.get(OpeningHallService);
    setup();
  });

  it('OPENING 阶段公聊发送成功并广播', async () => {
    const msg = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '请各家准备解密' });
    expect(msg.content).toBe('请各家准备解密');
    expect(gatewayMock.notifyHallMessage).toHaveBeenCalledWith('p1', expect.objectContaining({ roomType: 'PUBLIC' }));
  });

  it('非 OPENING 阶段发消息 → 403 HALL_CLOSED', async () => {
    prismaMock.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MUTED 时供应商发言 → 403；主持人仍可发', async () => {
    prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'MUTED' });
    await expect(svc.sendMessage(sup, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).resolves.toBeDefined();
  });

  it('CLOSED 时全员禁言', async () => {
    prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'CLOSED' });
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('供应商私聊只能发自己的会话', async () => {
    await expect(svc.sendMessage(sup, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-2', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('私聊 supplierId 必须参投本项目', async () => {
    prismaMock.bidSupplier.findFirst.mockResolvedValue(null);
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-9', content: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('内容写时消毒（HTML 标签剥离）', async () => {
    const msg = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '<script>alert(1)</script>你好' });
    expect(msg.content).not.toContain('<script>');
    expect(msg.content).toContain('你好');
  });

  it('签到幂等：已签到直接返回原时间', async () => {
    const t = new Date('2026-07-23T01:00:00Z');
    prismaMock.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 'sup-1', supplierName: '测试供应商', checkInAt: t });
    const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
    expect(res.checkInAt.toISOString()).toBe(t.toISOString());
    expect(prismaMock.bidSupplier.update).not.toHaveBeenCalled();
  });

  it('签到成功写监督日志并广播', async () => {
    const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
    expect(res.checkInAt).toBeInstanceOf(Date);
    expect(prismaMock.bidSupervisionLog.create).toHaveBeenCalled();
    expect(gatewayMock.notifyHallCheckin).toHaveBeenCalled();
  });

  it('交流控制切换写库+监督日志+广播', async () => {
    await svc.setExchangeControl('p1', 'MUTED', '陈源远');
    expect(prismaMock.bidOpeningSession.update).toHaveBeenCalledWith({ where: { projectId: 'p1' }, data: { exchangeControl: 'MUTED' } });
    expect(gatewayMock.notifyExchangeControl).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 运行单测确认失败**

Run: `pnpm --filter api test -- opening-hall.service.spec`
Expected: FAIL — 模块不存在。

- [ ] **Step 4: 实现 `opening-hall.service.ts`**

```ts
import { Injectable, Optional, ForbiddenException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';
import { NotificationService } from '../notification/notification.service';
import { sanitizeHtmlContent } from '../common/html-sanitize.util';
import type { OpeningHallRoomType, OpeningHallSenderRole, HallMessagePayload } from '@water-erp/shared';

export const HOST_ROLES_SET = new Set(['admin', 'bid_host', 'leader', 'staff']);

export interface HallActor {
  userId: string;
  role: string;
  supplierId?: string;   // Supplier.id（supplier 角色必有）
  supplierName?: string;
}

@Injectable()
export class OpeningHallService {
  constructor(
    @Inject('PrismaService') private readonly prisma: PrismaService,
    @Optional() @Inject('BidGateway') private readonly gateway: BidGateway | undefined,
    @Inject('NotificationService') private readonly notification: NotificationService,
  ) {}
```

等等——Nest 依赖注入按类 token，不用字符串。把构造器改为按类注入（spec 里相应地用 `useValue` 覆盖类 token：`{ provide: PrismaService, useValue: prismaMock }` 等；**实现与测试的 provide 必须一致**——把 Step 2 spec 中的字符串 token 改为类引用：`provide: PrismaService`/`provide: BidGateway`/`provide: NotificationService`，并 import 这三个类）：

```ts
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly gateway: BidGateway | undefined,
    private readonly notification: NotificationService,
  ) {}

  private assertHost(actor: HallActor) {
    if (!HOST_ROLES_SET.has(actor.role)) throw new ForbiddenException({ error: '仅主持人可执行此操作', code: 'HOST_ONLY' });
  }

  private async loadGate(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    return { project, session };
  }

  async sendMessage(actor: HallActor, projectId: string, dto: { roomType: OpeningHallRoomType; supplierId?: string; content: string }) {
    const { project, session } = await this.loadGate(projectId);
    if (project.stage !== 'OPENING') throw new ForbiddenException({ error: '大厅仅在开标阶段开放', code: 'HALL_CLOSED' });
    const control = session?.exchangeControl ?? 'OPEN';
    if (control === 'CLOSED') throw new ForbiddenException({ error: '主持人已关闭互动', code: 'EXCHANGE_CLOSED' });
    const isSupplier = actor.role === 'supplier';
    if (control === 'MUTED' && isSupplier) throw new ForbiddenException({ error: '主持人已开启全员禁言', code: 'EXCHANGE_MUTED' });

    let supplierId: string | null = null;
    let supplierName: string | null = null;
    if (dto.roomType === 'PRIVATE') {
      if (!dto.supplierId) throw new BadRequestException({ error: '私聊须指定 supplierId', code: 'MISSING_SUPPLIER' });
      if (isSupplier && dto.supplierId !== actor.supplierId) {
        throw new ForbiddenException({ error: '只能在自己的私聊会话发言', code: 'PRIVATE_ROOM_MISMATCH' });
      }
      const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: dto.supplierId } });
      if (!member) throw new BadRequestException({ error: '对方未参与本项目', code: 'NOT_PROJECT_MEMBER' });
      supplierId = dto.supplierId;
      supplierName = member.supplierName;
    }

    const senderRole: OpeningHallSenderRole = isSupplier ? 'SUPPLIER' : 'HOST';
    const senderName = isSupplier ? (actor.supplierName ?? '供应商') : (actor.supplierName ?? actor.userId);
    const msg = await this.prisma.openingHallMessage.create({
      data: {
        projectId, roomType: dto.roomType, supplierId, supplierName,
        senderId: actor.userId, senderRole, senderName,
        content: sanitizeHtmlContent(dto.content).slice(0, 2000),
      },
    });

    const payload: HallMessagePayload = {
      id: msg.id, projectId, roomType: msg.roomType,
      supplierId: msg.supplierId, supplierName: msg.supplierName,
      senderId: msg.senderId, senderRole: msg.senderRole, senderName: msg.senderName,
      content: msg.content, createdAt: msg.createdAt.toISOString(), timestamp: Date.now(),
    };
    this.gateway?.notifyHallMessage(projectId, payload);

    // 主持人私聊回复且供应商离线 → 站内信兜底
    if (dto.roomType === 'PRIVATE' && !isSupplier && supplierId) {
      const online = this.gateway?.getOnlineSupplierIds(projectId) ?? new Set<string>();
      if (!online.has(supplierId)) {
        const supplierUser = await this.prisma.supplier.findFirst({ where: { id: supplierId }, select: { userId: true, name: true } });
        if (supplierUser?.userId) {
          await this.notification.create({
            userId: supplierUser.userId, type: 'HALL_MESSAGE',
            title: '开标大厅：主持人回复', content: msg.content.slice(0, 100),
            link: `/my-bids/${projectId}/opening-hall`,
          }).catch(() => {});
        }
      }
    }
    return msg;
  }

  async listMessages(actor: HallActor, projectId: string, q: { roomType: OpeningHallRoomType; supplierId?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
    if (q.roomType === 'PRIVATE') {
      if (actor.role === 'supplier' && q.supplierId !== actor.supplierId) {
        throw new ForbiddenException({ error: '只能查看自己的私聊', code: 'PRIVATE_ROOM_MISMATCH' });
      }
      if (!q.supplierId) throw new BadRequestException({ error: '私聊查询须指定 supplierId', code: 'MISSING_SUPPLIER' });
    }
    const items = await this.prisma.openingHallMessage.findMany({
      where: {
        projectId, roomType: q.roomType,
        ...(q.roomType === 'PRIVATE' ? { supplierId: q.supplierId } : {}),
        ...(q.cursor ? { createdAt: { lt: new Date(q.cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page.reverse(), nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null };
  }

  private roomKeyFor(roomType: OpeningHallRoomType, supplierId?: string) {
    return roomType === 'PUBLIC' ? 'public' : `supplier:${supplierId}`;
  }

  async unreadCounts(actor: HallActor, projectId: string) {
    const countSince = async (roomKey: string, where: any) => {
      const cursor = await this.prisma.openingHallReadCursor.findUnique({
        where: { projectId_userId_roomKey: { projectId, userId: actor.userId, roomKey } },
      });
      return this.prisma.openingHallMessage.count({
        where: { ...where, ...(cursor ? { createdAt: { gt: cursor.lastReadAt } } : {}) },
      });
    };
    const publicUnread = await countSince('public', { projectId, roomType: 'PUBLIC' });
    if (actor.role === 'supplier') {
      const privateUnread = await countSince(`supplier:${actor.supplierId}`, { projectId, roomType: 'PRIVATE', supplierId: actor.supplierId });
      return { public: publicUnread, private: privateUnread, sessions: [] as any[] };
    }
    // 主持端：按供应商分组统计私聊未读
    const members = await this.prisma.bidSupplier.findMany({
      where: { projectId, supplierId: { not: null } },
      select: { supplierId: true, supplierName: true, checkInAt: true },
    });
    const sessions = [];
    for (const m of members) {
      if (!m.supplierId) continue;
      const n = await countSince(`supplier:${m.supplierId}`, { projectId, roomType: 'PRIVATE', supplierId: m.supplierId });
      sessions.push({ supplierId: m.supplierId, supplierName: m.supplierName, checkInAt: m.checkInAt, unread: n });
    }
    return { public: publicUnread, private: sessions.reduce((s, x) => s + x.unread, 0), sessions };
  }

  async markRead(projectId: string, userId: string, roomKey: string) {
    return this.prisma.openingHallReadCursor.upsert({
      where: { projectId_userId_roomKey: { projectId, userId, roomKey } },
      create: { projectId, userId, roomKey, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
  }

  async checkIn(actor: HallActor, projectId: string, meta: { ip?: string; ua?: string }) {
    if (actor.role !== 'supplier' || !actor.supplierId) throw new ForbiddenException({ error: '仅供应商可签到', code: 'SUPPLIER_ONLY' });
    const { project } = await this.loadGate(projectId);
    if (project.stage !== 'OPENING') throw new ForbiddenException({ error: '大厅仅在开标阶段开放', code: 'HALL_CLOSED' });
    const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: actor.supplierId } });
    if (!member) throw new BadRequestException({ error: '您未参与该项目投标', code: 'NOT_PROJECT_MEMBER' });
    if (member.checkInAt) return { checkInAt: member.checkInAt, already: true };

    const now = new Date();
    await this.prisma.bidSupplier.update({
      where: { id: member.id },
      data: { checkInAt: now, checkInMeta: JSON.stringify(meta) },
    });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: now, role: '供应商', target: member.supplierName,
        action: '在线签到', result: '供应商进入开标大厅并签到', riskFlag: '无',
      },
    });
    this.gateway?.notifyHallCheckin(projectId, {
      projectId, supplierId: actor.supplierId, supplierName: member.supplierName,
      checkInAt: now.toISOString(), timestamp: Date.now(),
    });
    this.gateway?.broadcastHallPresence(projectId).catch(() => {});
    return { checkInAt: now, already: false };
  }

  async presence(projectId: string, actor: HallActor) {
    const online = this.gateway?.getOnlineSupplierIds(projectId) ?? new Set<string>();
    const rows = await this.prisma.bidSupplier.findMany({
      where: { projectId, supplierId: { not: null } },
      select: { supplierId: true, supplierName: true, checkInAt: true, lastSeenAt: true },
    });
    const list = rows.map(r => ({
      supplierId: r.supplierId as string, supplierName: r.supplierName,
      checkInAt: r.checkInAt, online: online.has(r.supplierId as string),
    }));
    if (actor.role === 'supplier') {
      return { onlineCount: list.filter(x => x.online).length };
    }
    return { suppliers: list, onlineCount: list.filter(x => x.online).length };
  }

  async setExchangeControl(projectId: string, control: 'OPEN' | 'MUTED' | 'CLOSED', byName: string) {
    await this.prisma.bidOpeningSession.update({ where: { projectId }, data: { exchangeControl: control } });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '开标主持人', target: '开标大厅',
        action: '切换交流控制', result: control, riskFlag: '无',
      },
    });
    this.gateway?.notifyExchangeControl(projectId, { projectId, control, by: byName, timestamp: Date.now() });
    return { exchangeControl: control };
  }
}
```

- [ ] **Step 5: 运行单测确认全部通过**

Run: `pnpm --filter api test -- opening-hall.service.spec`
Expected: PASS（9 个用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/opening-hall
git commit -m "feat(api): opening-hall service 核心逻辑（发消息/历史/未读/签到/交流控制）+ 单测"
```

---

### Task 5: opening-hall controller、module 与注册

**Files:**
- Create: `apps/api/src/opening-hall/opening-hall.controller.ts`
- Create: `apps/api/src/opening-hall/opening-hall.module.ts`
- Modify: `apps/api/src/app.module.ts`（imports 数组）

**Interfaces:**
- Consumes: Task 4 的 `OpeningHallService` 全部方法；`BidGateway`（经 BidModule 导出）；`NotificationService`（经 NotificationModule 导出）
- Produces: REST 端点 `POST/GET /opening-hall/:projectId/{check-in,presence,messages,unread,read}`、`PATCH /opening-hall/:projectId/exchange-control`

- [ ] **Step 1: 写 controller**

```ts
import { Controller, Get, Post, Patch, Param, Body, Query, Request, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { OpeningHallService, HallActor } from './opening-hall.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { ExchangeControlDto } from './dto/exchange-control.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('opening-hall')
export class OpeningHallController {
  constructor(
    private readonly svc: OpeningHallService,
    private readonly prisma: PrismaService,
  ) {}

  /** 由 JWT 用户构造大厅 actor；supplier 角色解析 Supplier.id/名称（与 supplier-portal.controller.getSupplierId 同源）。 */
  private async actor(req: any): Promise<HallActor> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) throw new BadRequestException({ error: '未登录', code: 'UNAUTHORIZED' });
    const base: HallActor = { userId, role, supplierName: req.user?.username };
    if (role === 'supplier') {
      const supplier = await this.prisma.supplier.findFirst({ where: { userId } });
      if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
      base.supplierId = supplier.id;
      base.supplierName = supplier.name;
    }
    return base;
  }

  @Post(':projectId/check-in')
  @Roles('supplier')
  async checkIn(@Request() req: any, @Param('projectId') projectId: string) {
    const ip = req.ip ?? req.connection?.remoteAddress;
    const ua = req.headers?.['user-agent'];
    return this.svc.checkIn(await this.actor(req), projectId, { ip, ua });
  }

  @Get(':projectId/presence')
  async presence(@Request() req: any, @Param('projectId') projectId: string) {
    return this.svc.presence(projectId, await this.actor(req));
  }

  @Post(':projectId/messages')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async send(@Request() req: any, @Param('projectId') projectId: string, @Body() dto: SendMessageDto) {
    return this.svc.sendMessage(await this.actor(req), projectId, dto);
  }

  @Get(':projectId/messages')
  async list(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Query('roomType') roomType: 'PUBLIC' | 'PRIVATE',
    @Query('supplierId') supplierId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    if (roomType !== 'PUBLIC' && roomType !== 'PRIVATE') {
      throw new BadRequestException({ error: 'roomType 须为 PUBLIC 或 PRIVATE', code: 'BAD_ROOM_TYPE' });
    }
    return this.svc.listMessages(await this.actor(req), projectId, {
      roomType, supplierId, cursor, limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':projectId/unread')
  async unread(@Request() req: any, @Param('projectId') projectId: string) {
    return this.svc.unreadCounts(await this.actor(req), projectId);
  }

  @Post(':projectId/read')
  async read(@Request() req: any, @Param('projectId') projectId: string, @Body() dto: MarkReadDto) {
    return this.svc.markRead(projectId, req.user.sub, dto.roomKey);
  }

  @Patch(':projectId/exchange-control')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async control(@Request() req: any, @Param('projectId') projectId: string, @Body() dto: ExchangeControlDto) {
    return this.svc.setExchangeControl(projectId, dto.control, req.user?.username ?? req.user?.sub);
  }
}
```

（`@Roles` 导入路径以 `bid.controller.ts` 现有写法为准；若项目用 `@Roles('admin','bid_host')` 之外的签名，照抄既有控制器。）

- [ ] **Step 2: 写 module**

```ts
import { Module } from '@nestjs/common';
import { OpeningHallController } from './opening-hall.controller';
import { OpeningHallService } from './opening-hall.service';
import { NotificationModule } from '../notification/notification.module';
import { BidModule } from '../bid/bid.module';

@Module({
  imports: [NotificationModule, BidModule],
  controllers: [OpeningHallController],
  providers: [OpeningHallService],
  exports: [OpeningHallService],
})
export class OpeningHallModule {}
```

- [ ] **Step 3: 在 `app.module.ts` 的 imports 数组注册 `OpeningHallModule`**

在既有 feature module 导入列表末尾加一行 `OpeningHallModule`，并补 import 语句 `import { OpeningHallModule } from './opening-hall/opening-hall.module';`。

- [ ] **Step 4: 复跑 service 单测确认模块接线无影响**

Run: `pnpm --filter api test -- opening-hall.service.spec`
Expected: PASS。

- [ ] **Step 5: 启动 API 手工冒烟（两个终端）**

```bash
cd /home/asus/桌面/ERP/water-erp && pnpm dev:api   # 终端 1
```

终端 2（用种子账号登录取 cookie，projectId 用种子英雄项目 cmqhero-bid-proj01）：

```bash
COOKIE=$(curl -si -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' -H 'X-Portal: web' -d '{"username":"陈源远","password":"陈源远@2026"}' | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
curl -s -X PATCH http://localhost:4001/api/opening-hall/cmqhero-bid-proj01/exchange-control -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -d '{"control":"MUTED"}'
curl -s http://localhost:4001/api/opening-hall/cmqhero-bid-proj01/presence -H "Cookie: $COOKIE"
```

Expected: 第一条返回 `{"exchangeControl":"MUTED"}`（若英雄项目无 BidOpeningSession 会报错——说明端点通了，数据库无会话属预期，可先 `curl POST /api/bid/projects/<id>/open` 建会话再试，或接受 500 日志中的 P2025 并记录）；presence 返回 JSON。完成后把 control 改回 OPEN。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/opening-hall apps/api/src/app.module.ts
git commit -m "feat(api): opening-hall REST 端点 + 模块注册（聊天/签到/未读/交流控制）"
```

---

### Task 6: 供应商动作实时事件补全

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.module.ts:11`
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（构造器 + :850 后 + :880 后）
- Modify: `apps/api/src/bid/bid.service.ts:1075` 后

**Interfaces:**
- Consumes: Task 3 的 `BidGateway.notifyOpeningConfirmed/notifyOpeningDisputed/notifyOpeningDisputeResolved`
- Produces: 供应商确认/异议 → 主持端实时弹窗事件；异议处理结果 → 供应商实时回推

- [ ] **Step 1: `SupplierPortalModule` imports 增加 `BidModule`**

`supplier-portal.module.ts:11`：

```ts
  imports: [AuthModule, PrismaModule, AnnouncementModule, BidBackupModule, BidModule],
```

补 import：`import { BidModule } from '../bid/bid.module';`。若启动报循环依赖（Nest `circular dependency` 错误），改为 `forwardRef(() => BidModule)` 并在 service 注入处用 `@Inject(forwardRef(() => BidGateway))`。

- [ ] **Step 2: `SupplierPortalService` 注入 gateway**

在构造器参数末尾追加（保留既有参数）：

```ts
    @Optional() private readonly gateway?: BidGateway,
```

import：`import { Optional } from '@nestjs/common';`（若已导入则跳过）与 `import { BidGateway } from '../bid/bid.gateway';`。

- [ ] **Step 3: `confirmOpening`（:825-852）事务提交后补 emit**

在 :850 的 `});`（事务结束）之后、`return { success: true };` 之前插入：

```ts
    this.gateway?.notifyOpeningConfirmed(projectId, supplierId, {
      projectId, supplierId, supplierName: bidSupplier.supplierName, timestamp: Date.now(),
    });
```

- [ ] **Step 4: `disputeOpening`（:854-882）同样补 emit**

在事务 `});`（:880）之后、`return { success: true };` 之前插入：

```ts
    this.gateway?.notifyOpeningDisputed(projectId, supplierId, {
      projectId, supplierId, supplierName: bidSupplier.supplierName, reason, timestamp: Date.now(),
    });
```

- [ ] **Step 5: `bid.service.ts` `resolveOpeningDispute`（:1042-1077）补回推**

在 :1075 的 `this.gateway?.notifySupervisionLog(...)` 之后、`return this.prisma.bidOpeningRecord.findUnique(...)` 之前插入：

```ts
    if (record.bidSupplierId) {
      const bs = await this.prisma.bidSupplier.findUnique({
        where: { id: record.bidSupplierId },
        select: { supplierId: true },
      });
      if (bs?.supplierId) {
        this.gateway?.notifyOpeningDisputeResolved(projectId, bs.supplierId, {
          projectId, supplierId: bs.supplierId, supplierName: record.supplierName,
          recordId, confirm: dto.confirm, result: dto.result, timestamp: Date.now(),
        });
      }
    }
```

- [ ] **Step 6: 单测全绿 + 编译**

Run: `pnpm --filter api test` 与 `pnpm --filter api build`
Expected: 既有套件无回归；构建成功。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/supplier-portal apps/api/src/bid/bid.service.ts
git commit -m "feat(api): 确认/异议/异议处理实时事件补全（opening:confirmed/disputed/dispute:resolved）"
```

---

### Task 7: M1 E2E 门控与全流程套件

**Files:**
- Create: `apps/api/test/opening-hall.e2e-spec.ts`
- Modify: `apps/api/package.json`（devDependencies 加 socket.io-client，若无）

**Interfaces:**
- Consumes: Task 5 REST 端点；Task 3/6 全部 socket 事件；种子账号 `supplier1/supplier1@2026`、`huaxi/huaxi@2026`、`陈源远/陈源远@2026`
- Produces: 门控四件套（成员门/host 房/私聊隔离/阶段门）+ 聊天全流程的回归护栏

- [ ] **Step 1: 确认/添加 socket.io-client 测试依赖**

Run: `cd /home/asus/桌面/ERP/water-erp && grep -q 'socket.io-client' apps/api/package.json || pnpm --filter api add -D socket.io-client`

- [ ] **Step 2: 写 E2E 套件**

Create `apps/api/test/opening-hall.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login').set('X-Portal', portal).send({ username, password });
  const cookie = res.headers['set-cookie'];
  const first = Array.isArray(cookie) ? cookie[0] : cookie;
  return first ? String(first).split(';')[0] : '';
}

function connectBid(base: string, cookie: string): Socket {
  return io(`${base}/bid`, { withCredentials: true, extraHeaders: { Cookie: cookie }, reconnection: false, timeout: 8000 });
}

function joinAck(socket: Socket, projectId: string): Promise<any> {
  return new Promise(resolve => {
    socket.emit('join:project', projectId, (ack: any) => resolve(ack));
    setTimeout(() => resolve({ error: 'TIMEOUT' }), 5000);
  });
}

function onceEvent(socket: Socket, event: string, ms = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${event}`)), ms);
    socket.once(event, (d: any) => { clearTimeout(t); resolve(d); });
  });
}

describe('Opening Hall (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let hostCookie: string, sup1Cookie: string, sup2Cookie: string;
  let projectId: string, sup1Id: string, sup2Id: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    prisma = app.get(PrismaService);

    hostCookie = await loginAs(app, '陈源远', '陈源远@2026', 'web');
    sup1Cookie = await loginAs(app, 'supplier1', 'supplier1@2026', 'supplier');
    sup2Cookie = await loginAs(app, 'huaxi', 'huaxi@2026', 'supplier');

    const u1 = await prisma.user.findFirst({ where: { username: 'supplier1' } });
    const u2 = await prisma.user.findFirst({ where: { username: 'huaxi' } });
    const s1 = await prisma.supplier.findFirst({ where: { userId: u1!.id } });
    const s2 = await prisma.supplier.findFirst({ where: { userId: u2!.id } });
    sup1Id = s1!.id; sup2Id = s2!.id;

    const proj = await prisma.bidProject.create({
      data: { name: `开标大厅E2E-${Date.now()}`, procurementMethod: '公开招标', stage: 'OPENING', openTime: new Date(), deadline: new Date() },
    });
    projectId = proj.id;
    await prisma.bidOpeningSession.create({
      data: { projectId, host: '陈源远', supervisor: '监督', decryptWindowStart: new Date(), decryptWindowEnd: new Date(Date.now() + 3600_000) },
    });
    await prisma.bidSupplier.createMany({ data: [
      { projectId, supplierId: sup1Id, supplierName: s1!.name, decryptStatus: 'SUCCESS' },
      { projectId, supplierId: sup2Id, supplierName: s2!.name, decryptStatus: 'SUCCESS' },
    ]});
    await prisma.bidOpeningRecord.createMany({ data: [
      { projectId, supplierName: s1!.name, amount: '100', period: '90', qualityTarget: '合格', bondStatus: '已缴', decryptResult: '成功', confirmStatus: '待确认', bidSupplierId: (await prisma.bidSupplier.findFirst({ where: { projectId, supplierId: sup1Id } }))!.id },
      { projectId, supplierName: s2!.name, amount: '200', period: '90', qualityTarget: '合格', bondStatus: '已缴', decryptResult: '成功', confirmStatus: '待确认', bidSupplierId: (await prisma.bidSupplier.findFirst({ where: { projectId, supplierId: sup2Id } }))!.id },
    ]});
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await prisma.openingHallReadCursor.deleteMany({ where: { projectId } });
    await prisma.openingHallMessage.deleteMany({ where: { projectId } });
    await prisma.bidSupervisionLog.deleteMany({ where: { projectId } });
    await prisma.bidOpeningRecord.deleteMany({ where: { projectId } });
    await prisma.bidSupplier.deleteMany({ where: { projectId } });
    await prisma.bidOpeningSession.deleteMany({ where: { projectId } });
    await prisma.bidProject.deleteMany({ where: { projectId } });
    await app.close();
  });

  function track(s: Socket) { sockets.push(s); return s; }
  async function connected(s: Socket) { return new Promise<void>((res, rej) => { s.on('connect', () => res()); s.on('connect_error', rej); }); }

  it('成员门：供应商可进自己项目，进他人项目被拒', async () => {
    const s = track(connectBid(base, sup1Cookie)); await connected(s);
    const ack = await joinAck(s, projectId);
    expect(ack).toEqual(expect.objectContaining({ ok: true, supplierId: sup1Id }));

    const other = await prisma.bidProject.create({ data: { name: `非参与项目-${Date.now()}`, procurementMethod: '公开招标', stage: 'OPENING', openTime: new Date(), deadline: new Date() } });
    const ack2 = await joinAck(s, other.id);
    expect(ack2).toEqual(expect.objectContaining({ error: 'NOT_PROJECT_MEMBER' }));
    await prisma.bidProject.delete({ where: { id: other.id } });
  });

  it('签到 → 主持端与供应商端都收到 hall:checkin', async () => {
    const host = track(connectBid(base, hostCookie)); await connected(host); await joinAck(host, projectId);
    const sup = track(connectBid(base, sup1Cookie)); await connected(sup); await joinAck(sup, projectId);
    const pHost = onceEvent(host, 'hall:checkin');
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/check-in`).set('Cookie', sup1Cookie).expect(201);
    const d = await pHost;
    expect(d.supplierId).toBe(sup1Id);
    expect(d.checkInAt).toBeTruthy();
  });

  it('公聊：主持发 → 两家供应商都收到', async () => {
    const s1 = track(connectBid(base, sup1Cookie)); await connected(s1); await joinAck(s1, projectId);
    const s2 = track(connectBid(base, sup2Cookie)); await connected(s2); await joinAck(s2, projectId);
    const p1 = onceEvent(s1, 'hall:message:new');
    const p2 = onceEvent(s2, 'hall:message:new');
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).send({ roomType: 'PUBLIC', content: '请各家准备解密' }).expect(201);
    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1.content).toBe('请各家准备解密');
    expect(d1.senderRole).toBe('HOST');
    expect(d2.content).toBe('请各家准备解密');
  });

  it('私聊隔离：主持→供应商1 的私聊，供应商2 收不到', async () => {
    const s1 = track(connectBid(base, sup1Cookie)); await connected(s1); await joinAck(s1, projectId);
    const s2 = track(connectBid(base, sup2Cookie)); await connected(s2); await joinAck(s2, projectId);
    const got1 = onceEvent(s1, 'hall:message:new');
    let leaked = false;
    s2.on('hall:message:new', (d: any) => { if (d.roomType === 'PRIVATE' && d.supplierId === sup1Id) leaked = true; });
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).send({ roomType: 'PRIVATE', supplierId: sup1Id, content: '仅供你方查看' }).expect(201);
    const d = await got1;
    expect(d.roomType).toBe('PRIVATE');
    expect(d.content).toBe('仅供你方查看');
    await new Promise(r => setTimeout(r, 500));
    expect(leaked).toBe(false);
  });

  it('供应商只能在自己私聊会话发言', async () => {
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', sup1Cookie).send({ roomType: 'PRIVATE', supplierId: sup2Id, content: 'x' }).expect(403);
  });

  it('MUTED：供应商禁言、主持仍可发；CLOSED：全员禁言', async () => {
    await request(app.getHttpServer()).patch(`/api/opening-hall/${projectId}/exchange-control`)
      .set('Cookie', hostCookie).send({ control: 'MUTED' }).expect(200);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', sup1Cookie).send({ roomType: 'PUBLIC', content: 'x' }).expect(403);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).send({ roomType: 'PUBLIC', content: '主持发言' }).expect(201);
    await request(app.getHttpServer()).patch(`/api/opening-hall/${projectId}/exchange-control`)
      .set('Cookie', hostCookie).send({ control: 'CLOSED' }).expect(200);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).send({ roomType: 'PUBLIC', content: 'x' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/opening-hall/${projectId}/exchange-control`)
      .set('Cookie', hostCookie).send({ control: 'OPEN' }).expect(200);
  });

  it('未读 + 读游标', async () => {
    const r1 = await request(app.getHttpServer()).get(`/api/opening-hall/${projectId}/unread`).set('Cookie', sup2Cookie).expect(200);
    expect(r1.body.public).toBeGreaterThan(0);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/read`)
      .set('Cookie', sup2Cookie).send({ roomKey: 'public' }).expect(201);
    const r2 = await request(app.getHttpServer()).get(`/api/opening-hall/${projectId}/unread`).set('Cookie', sup2Cookie).expect(200);
    expect(r2.body.public).toBe(0);
  });

  it('历史分页：items 升序、nextCursor 可翻页', async () => {
    const r = await request(app.getHttpServer())
      .get(`/api/opening-hall/${projectId}/messages?roomType=PUBLIC&limit=2`).set('Cookie', hostCookie).expect(200);
    expect(r.body.items.length).toBeLessThanOrEqual(2);
    const times = r.body.items.map((m: any) => new Date(m.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('供应商确认开标记录 → 主持端收到 opening:confirmed', async () => {
    const host = track(connectBid(base, hostCookie)); await connected(host); await joinAck(host, projectId);
    const p = onceEvent(host, 'opening:confirmed');
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${projectId}/opening-confirm`)
      .set('Cookie', sup1Cookie).expect(201);
    const d = await p;
    expect(d.supplierId).toBe(sup1Id);
  });

  it('供应商提异议 → 主持端收到 opening:disputed；主持处理 → 供应商收到 dispute:resolved', async () => {
    const host = track(connectBid(base, hostCookie)); await connected(host); await joinAck(host, projectId);
    const sup = track(connectBid(base, sup1Cookie)); await connected(sup); await joinAck(sup, projectId);
    const pDisputed = onceEvent(host, 'opening:disputed');
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${projectId}/opening-dispute`)
      .set('Cookie', sup1Cookie).send({ reason: '唱标金额有误' }).expect(201);
    const dd = await pDisputed;
    expect(dd.reason).toBe('唱标金额有误');

    const record = await prisma.bidOpeningRecord.findFirst({ where: { projectId, supplierName: dd.supplierName } });
    const pResolved = onceEvent(sup, 'opening:dispute:resolved');
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/opening-records/${record!.id}/resolve-dispute`)
      .set('Cookie', hostCookie).send({ result: '复核无误', confirm: true }).expect(201);
    const rd = await pResolved;
    expect(rd.confirm).toBe(true);
  });

  it('阶段门：EVALUATING 阶段发消息 403', async () => {
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'EVALUATING' } });
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).send({ roomType: 'PUBLIC', content: 'x' }).expect(403);
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'OPENING' } });
  });
});
```

- [ ] **Step 3: 运行 E2E**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test:e2e -- opening-hall`
Expected: 11 个用例全绿。若报 `Cannot use import statement`（socket.io-client 的 ESM 子依赖），把 `socket.io-client`、`engine.io-client`、`@socket.io/component-emitter` 加入 `apps/api/jest.config.js` 与 `apps/api/test/jest-e2e.json` 的 `transformIgnorePatterns` allowlist（CLAUDE.md 约定），重跑。

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/opening-hall.e2e-spec.ts apps/api/package.json apps/api/jest.config.js apps/api/test/jest-e2e.json pnpm-lock.yaml
git commit -m "test(api): 开标大厅 E2E（门控四件套 + 聊天全流程 + 阶段门）"
```

---

## M2 供应商端

### Task 8: supplier-portal 依赖接入

**Files:**
- Modify: `apps/supplier-portal/package.json`

**Interfaces:**
- Produces: `socket.io-client`、`@water-erp/config`（portalURL）、`@water-erp/shared`（BID_EVENT 与载荷类型）可用于供应商端

- [ ] **Step 1: 加依赖**

在 `apps/supplier-portal/package.json` 的 `dependencies` 加三行（与 expert-portal 的 workspace 版本写法一致）：

```json
    "@water-erp/config": "workspace:*",
    "@water-erp/shared": "workspace:*",
    "socket.io-client": "^4.8.3",
```

- [ ] **Step 2: 安装并构建共享包**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm install && pnpm --filter @water-erp/shared build && pnpm --filter @water-erp/config build`
Expected: 成功；`node_modules/socket.io-client` 存在。

- [ ] **Step 3: 验证可导入**

Run: `pnpm --filter supplier-portal exec node -e "console.log(require.resolve('socket.io-client'))"`
Expected: 打印解析路径，无报错。

- [ ] **Step 4: Commit**

```bash
git add apps/supplier-portal/package.json pnpm-lock.yaml
git commit -m "chore(supplier-portal): 接入 socket.io-client 与 @water-erp/{config,shared}"
```

---

### Task 9: useBidWebSocket Vue composable

**Files:**
- Create: `apps/supplier-portal/src/composables/useBidWebSocket.ts`

**Interfaces:**
- Consumes: Task 1 事件契约；`portalURL('api','/bid')`
- Produces: `useBidWebSocket(projectId, handlers)` → `{ connection, lastEventAt, reconnectNow }`；重连退避 [1s,2s,5s,10s]、20s ping/10s pong、页面隐藏断开（移植自 bid-portal `use-bid-websocket.ts`）

- [ ] **Step 1: 写 composable**

```ts
import { ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { portalURL } from '@water-erp/config'
import {
  BID_EVENT,
  type ConnectionState,
  type DecryptStatusPayload,
  type StageChangePayload,
  type HallMessagePayload,
  type HallPresenceUpdatePayload,
  type HallCheckinPayload,
  type HallExchangeControlPayload,
  type OpeningDisputeResolvedPayload,
} from '@water-erp/shared'

export interface BidWsHandlers {
  onDecryptStatus?: (d: DecryptStatusPayload) => void
  onStageChange?: (d: StageChangePayload) => void
  onHallMessage?: (d: HallMessagePayload) => void
  onHallPresence?: (d: HallPresenceUpdatePayload) => void
  onHallCheckin?: (d: HallCheckinPayload) => void
  onHallExchangeControl?: (d: HallExchangeControlPayload) => void
  onOpeningDisputeResolved?: (d: OpeningDisputeResolvedPayload) => void
}

function wsUrl(): string {
  const env = (import.meta as any).env?.VITE_WS_URL as string | undefined
  return env || portalURL('api', '/bid')
}

/**
 * /bid 命名空间的供应商端 socket 工程。
 * 移植自 bid-portal use-bid-websocket.ts：重连退避 [1s,2s,5s,10s]、
 * 20s ping/10s pong 心跳、页面不可见时断开省电。
 */
export function useBidWebSocket(
  projectId: Ref<string | undefined> | string | undefined,
  handlers: BidWsHandlers,
) {
  const connection = ref<ConnectionState>('disconnected')
  const lastEventAt = ref<number | null>(null)

  let socket: Socket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let manualClose = false
  let handlersRef = handlers

  const pid = () => (typeof projectId === 'string' ? projectId : projectId?.value)

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null }
  }

  function connect() {
    const id = pid()
    if (!id || socket?.connected) return
    manualClose = false
    connection.value = connection.value === 'connected' ? connection.value : 'reconnecting'

    const s = io(wsUrl(), { withCredentials: true, reconnection: false, timeout: 10000 })
    socket = s

    s.on('connect', () => {
      attempt = 0
      connection.value = 'connected'
      s.emit('join:project', id)
      heartbeatTimer = setInterval(() => {
        s.emit('ping', Date.now())
        if (pongTimer) clearTimeout(pongTimer)
        pongTimer = setTimeout(() => s.disconnect(), 10000)
      }, 20000)
    })

    s.on('pong', () => { if (pongTimer) clearTimeout(pongTimer) })

    const scheduleReconnect = () => {
      if (manualClose || !pid()) return
      const delays = [1000, 2000, 5000, 10000]
      attempt = Math.min(attempt + 1, 10)
      const delay = delays[Math.min(attempt - 1, delays.length - 1)]
      connection.value = 'reconnecting'
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        if (socket) { socket.disconnect(); socket = null }
        connect()
      }, delay)
    }

    s.on('disconnect', () => {
      clearTimers()
      connection.value = 'disconnected'
      socket = null
      if (!manualClose) scheduleReconnect()
    })
    s.on('connect_error', () => { connection.value = 'disconnected'; scheduleReconnect() })

    const on = <T,>(ev: string, fn?: (d: T) => void) => {
      s.on(ev, (d: T) => { if (fn) { lastEventAt.value = Date.now(); fn(d) } })
    }
    on(BID_EVENT.DECRYPT_STATUS, handlersRef.onDecryptStatus)
    on(BID_EVENT.STAGE_CHANGE, handlersRef.onStageChange)
    on(BID_EVENT.HALL_MESSAGE_NEW, handlersRef.onHallMessage)
    on(BID_EVENT.HALL_PRESENCE_UPDATE, handlersRef.onHallPresence)
    on(BID_EVENT.HALL_CHECKIN, handlersRef.onHallCheckin)
    on(BID_EVENT.HALL_EXCHANGE_CONTROL, handlersRef.onHallExchangeControl)
    on(BID_EVENT.OPENING_DISPUTE_RESOLVED, handlersRef.onOpeningDisputeResolved)
  }

  function reconnectNow() {
    if (socket) { socket.disconnect(); socket = null }
    clearTimers()
    attempt = 0
    connect()
  }

  function teardown() {
    manualClose = true
    clearTimers()
    if (socket) {
      const id = pid()
      if (id) socket.emit('leave:project', id)
      socket.disconnect()
      socket = null
    }
    connection.value = 'disconnected'
  }

  const onVisibility = () => {
    if (!pid()) return
    if (document.hidden) teardown()
    else connect()
  }

  connect()
  document.addEventListener('visibilitychange', onVisibility)
  if (typeof projectId !== 'string') {
    watch(projectId, () => { teardown(); manualClose = false; connect() })
  }
  onBeforeUnmount(() => {
    teardown()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { connection, lastEventAt, reconnectNow }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter supplier-portal build`
Expected: vite build 成功（vue-tsc 不在脚本中则以 build 通过为准）。

- [ ] **Step 3: Commit**

```bash
git add apps/supplier-portal/src/composables/useBidWebSocket.ts
git commit -m "feat(supplier-portal): useBidWebSocket composable（移植主持端 socket 工程）"
```

---

### Task 10: 大厅 REST 客户端

**Files:**
- Create: `apps/supplier-portal/src/api/openingHall.ts`

**Interfaces:**
- Produces: `openingHallApi.{checkIn,presence,send,messages,unread,markRead}`

- [ ] **Step 1: 写 API 客户端**

```ts
import api from './index'

export const openingHallApi = {
  checkIn(projectId: string) {
    return api.post(`/opening-hall/${projectId}/check-in`)
  },
  presence(projectId: string) {
    return api.get(`/opening-hall/${projectId}/presence`)
  },
  send(projectId: string, body: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; content: string }) {
    return api.post(`/opening-hall/${projectId}/messages`, body)
  },
  messages(projectId: string, params: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; cursor?: string; limit?: number }) {
    return api.get(`/opening-hall/${projectId}/messages`, { params })
  },
  unread(projectId: string) {
    return api.get(`/opening-hall/${projectId}/unread`)
  },
  markRead(projectId: string, roomKey: string) {
    return api.post(`/opening-hall/${projectId}/read`, { roomKey })
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/supplier-portal/src/api/openingHall.ts
git commit -m "feat(supplier-portal): 开标大厅 REST 客户端"
```

---

### Task 11: ChatPanel.vue 聊天面板组件

**Files:**
- Create: `apps/supplier-portal/src/components/bid/ChatPanel.vue`

**Interfaces:**
- Consumes: Task 10 `openingHallApi`；Task 1 `HallMessagePayload`
- Produces: 组件 `ChatPanel`，props `{ projectId: string; supplierId: string; supplierName: string }`；公聊/私聊 tab + 未读角标 + socket 增量（经 `inject` 或直接内置 socket——本组件内置自己的 socket 订阅，靠 `useBidWebSocket`）

- [ ] **Step 1: 写组件**

```vue
<script setup lang="ts">
import { ref, reactive, nextTick, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { openingHallApi } from '@/api/openingHall'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import type { HallMessagePayload } from '@water-erp/shared'

const props = defineProps<{ projectId: string; supplierId: string; supplierName: string }>()

type Msg = { id: string; senderRole: string; senderName: string; content: string; createdAt: string; roomType: string }
const tab = ref<'PUBLIC' | 'PRIVATE'>('PUBLIC')
const publicMsgs = ref<Msg[]>([])
const privateMsgs = ref<Msg[]>([])
const publicUnread = ref(0)
const privateUnread = ref(0)
const input = ref('')
const sending = ref(false)
const exchangeControl = ref<'OPEN' | 'MUTED' | 'CLOSED'>('OPEN')
const listEl = ref<HTMLElement | null>(null)

const current = computed(() => (tab.value === 'PUBLIC' ? publicMsgs : privateMsgs))
const canSend = computed(() => exchangeControl.value === 'OPEN')
const controlHint = computed(() =>
  exchangeControl.value === 'MUTED' ? '主持人已开启全员禁言' :
  exchangeControl.value === 'CLOSED' ? '主持人已关闭互动' : '')

function pushMsg(d: HallMessagePayload) {
  const m: Msg = { id: d.id, senderRole: d.senderRole, senderName: d.senderName, content: d.content, createdAt: d.createdAt, roomType: d.roomType }
  if (d.roomType === 'PUBLIC') {
    publicMsgs.value.push(m)
    if (tab.value !== 'PUBLIC') publicUnread.value++
  } else if (d.supplierId === props.supplierId) {
    privateMsgs.value.push(m)
    if (tab.value !== 'PRIVATE') privateUnread.value++
  }
  void nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

useBidWebSocket(props.projectId, {
  onHallMessage: pushMsg,
  onHallExchangeControl: d => { exchangeControl.value = d.control },
})

async function loadHistory(room: 'PUBLIC' | 'PRIVATE') {
  const res = await openingHallApi.messages(props.projectId, { roomType: room, supplierId: room === 'PRIVATE' ? props.supplierId : undefined, limit: 100 })
  const items: Msg[] = (res.data.items || []).map((m: any) => ({ id: m.id, senderRole: m.senderRole, senderName: m.senderName, content: m.content, createdAt: m.createdAt, roomType: m.roomType }))
  if (room === 'PUBLIC') publicMsgs.value = items
  else privateMsgs.value = items
  void nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

async function loadUnread() {
  const res = await openingHallApi.unread(props.projectId)
  publicUnread.value = res.data.public ?? 0
  privateUnread.value = res.data.private ?? 0
}

async function switchTab(t: 'PUBLIC' | 'PRIVATE') {
  tab.value = t
  if (t === 'PUBLIC') { publicUnread.value = 0; await openingHallApi.markRead(props.projectId, 'public').catch(() => {}) }
  else { privateUnread.value = 0; await openingHallApi.markRead(props.projectId, `supplier:${props.supplierId}`).catch(() => {}) }
}

async function send() {
  const content = input.value.trim()
  if (!content || sending.value) return
  sending.value = true
  try {
    await openingHallApi.send(props.projectId, {
      roomType: tab.value,
      supplierId: tab.value === 'PRIVATE' ? props.supplierId : undefined,
      content,
    })
    input.value = ''
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '发送失败，请重试')
  } finally {
    sending.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadHistory('PUBLIC'), loadHistory('PRIVATE'), loadUnread()])
})
</script>

<template>
  <el-card shadow="never" class="chat-panel">
    <template #header>
      <div class="tabs">
        <el-badge :value="publicUnread" :hidden="publicUnread === 0" :max="99">
          <el-button :type="tab === 'PUBLIC' ? 'primary' : 'default'" size="small" @click="switchTab('PUBLIC')">大厅公聊</el-button>
        </el-badge>
        <el-badge :value="privateUnread" :hidden="privateUnread === 0" :max="99">
          <el-button :type="tab === 'PRIVATE' ? 'primary' : 'default'" size="small" @click="switchTab('PRIVATE')">与主持人私聊</el-button>
        </el-badge>
      </div>
    </template>

    <div ref="listEl" class="msg-list">
      <div v-if="current.length === 0" class="empty">暂无消息</div>
      <div v-for="m in current" :key="m.id" class="msg" :class="{ mine: m.senderRole === 'SUPPLIER', system: m.senderRole === 'SYSTEM' }">
        <div class="meta">{{ m.senderName }} · {{ new Date(m.createdAt).toLocaleTimeString('zh-CN') }}</div>
        <div class="body">{{ m.content }}</div>
      </div>
    </div>

    <div v-if="!canSend" class="muted-hint">{{ controlHint }}</div>
    <div class="input-row">
      <el-input v-model="input" :disabled="!canSend" maxlength="2000" placeholder="输入消息（Enter 发送）" @keyup.enter="send" />
      <el-button type="primary" :disabled="!canSend || !input.trim()" :loading="sending" @click="send">发送</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.tabs { display: flex; gap: 12px; }
.msg-list { flex: 1; overflow-y: auto; min-height: 320px; max-height: 480px; padding: 4px 0; }
.empty { color: #999; text-align: center; padding: 40px 0; }
.msg { margin: 8px 0; padding: 8px 12px; border-radius: 8px; background: #f5f7fa; }
.msg.mine { background: #ecf5ff; }
.msg.system { background: transparent; text-align: center; color: #909399; font-size: 12px; }
.meta { font-size: 12px; color: #909399; margin-bottom: 2px; }
.body { white-space: pre-wrap; word-break: break-all; }
.muted-hint { color: #e6a23c; font-size: 12px; padding: 4px 0; }
.input-row { display: flex; gap: 8px; margin-top: 8px; }
</style>
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter supplier-portal build`
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
git add apps/supplier-portal/src/components/bid/ChatPanel.vue
git commit -m "feat(supplier-portal): ChatPanel 公聊/私聊面板（未读角标 + 禁言态）"
```

---

### Task 12: 在线开标大厅页 + 路由与入口

**Files:**
- Create: `apps/supplier-portal/src/views/bid/OpeningHall.vue`
- Modify: `apps/supplier-portal/src/router/index.ts`（:85 附近，opening-confirm 路由后）
- Modify: `apps/supplier-portal/src/views/bid/MyBids.vue`（:243 附近）
- Modify: `apps/supplier-portal/src/views/bid/OpeningConfirm.vue`（整体替换为重定向兼容）

**Interfaces:**
- Consumes: Task 9 composable、Task 10 API、Task 11 ChatPanel、既有 `supplierApi`（`src/api/supplier.ts:75-81` 的 getOpeningRecord/confirmOpening/disputeOpening）
- Produces: 路由 `/my-bids/:projectId/opening-hall`

- [ ] **Step 1: 写大厅页**

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { bidApi } from '@/api/bid'
import { openingHallApi } from '@/api/openingHall'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import ChatPanel from '@/components/bid/ChatPanel.vue'

const route = useRoute()
const projectId = route.params.projectId as string

const project = ref<any>(null)
const record = ref<any>(null)
const checkedInAt = ref<string | null>(null)
const onlineCount = ref(0)
const decryptStatus = ref<string>('')
const stage = computed<string>(() => project.value?.stage ?? '')
const isOpening = computed(() => stage.value === 'OPENING')
const supplierId = ref('')
const supplierName = ref('')

async function refresh() {
  const [p, r] = await Promise.all([
    bidApi.getProject(projectId),
    supplierApi.getOpeningRecord(projectId).catch(() => ({ data: null })),
  ])
  project.value = p.data
  record.value = r.data
}

async function loadPresence() {
  const res = await openingHallApi.presence(projectId).catch(() => null)
  if (res?.data) onlineCount.value = res.data.onlineCount ?? 0
}

async function checkIn() {
  try {
    const res = await openingHallApi.checkIn(projectId)
    checkedInAt.value = res.data.checkInAt
    ElMessage.success('签到成功')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '签到失败')
  }
}

async function confirmRecord() {
  try {
    await ElMessageBox.confirm('确认开标记录（唱标信息）无误？', '确认开标记录', { type: 'info' })
    await supplierApi.confirmOpening(projectId)
    ElMessage.success('已确认开标记录')
    await refresh()
  } catch (e: any) {
    if (e === 'cancel' || e?.toString?.().includes('cancel')) return
    ElMessage.error(e?.response?.data?.error || '确认失败')
  }
}

async function disputeRecord() {
  try {
    const { value } = await ElMessageBox.prompt('请输入异议原因', '提出开标异议', {
      inputType: 'textarea',
      inputValidator: (v: string) => (v?.trim() ? true : '请填写异议原因'),
    })
    await supplierApi.disputeOpening(projectId, value)
    ElMessage.success('异议已提交，请等待主持人处理')
    await refresh()
  } catch (e: any) {
    if (e === 'cancel' || e?.toString?.().includes('cancel')) return
    ElMessage.error(e?.response?.data?.error || '提交失败')
  }
}

useBidWebSocket(projectId, {
  onStageChange: () => refresh(),
  onDecryptStatus: d => { decryptStatus.value = d.decryptStatus },
  onHallPresence: d => { onlineCount.value = d.onlineCount },
  onOpeningDisputeResolved: d => {
    ElMessage.info(d.confirm ? `异议已处理（确认）：${d.result}` : `异议已处理（退回）：${d.result}`)
    refresh()
  },
})

onMounted(async () => {
  const profile = await supplierApi.getProfile().catch(() => null)
  supplierId.value = profile?.data?.id ?? ''
  supplierName.value = profile?.data?.name ?? ''
  await refresh()
  await loadPresence()
})
</script>

<template>
  <div class="hall">
    <div class="left">
      <el-card shadow="never">
        <template #header>
          <div class="head">
            <span>{{ project?.name || '加载中…' }}</span>
            <el-tag v-if="isOpening" type="success">开标进行中</el-tag>
            <el-tag v-else-if="stage">阶段：{{ stage }}</el-tag>
            <span class="online">在线 {{ onlineCount }} 家</span>
          </div>
        </template>

        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="本司解密状态">{{ decryptStatus || record?.decryptResult || '—' }}</el-descriptions-item>
          <el-descriptions-item label="唱标金额">{{ record?.amount || '—' }}</el-descriptions-item>
          <el-descriptions-item label="工期">{{ record?.period || '—' }}</el-descriptions-item>
          <el-descriptions-item label="开标记录状态">{{ record?.confirmStatus || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="record?.handleResult" label="异议处理结果">{{ record.handleResult }}</el-descriptions-item>
        </el-descriptions>

        <div class="actions">
          <el-button v-if="isOpening && !checkedInAt" type="primary" @click="checkIn">签到</el-button>
          <el-tag v-else-if="checkedInAt" type="info">已签到 {{ new Date(checkedInAt).toLocaleTimeString('zh-CN') }}</el-tag>
          <template v-if="isOpening && record && record.confirmStatus === '待确认'">
            <el-button type="success" @click="confirmRecord">确认开标记录</el-button>
            <el-button type="warning" @click="disputeRecord">提出异议</el-button>
          </template>
        </div>
        <div v-if="!isOpening && stage" class="stage-hint">大厅互动仅在开标阶段开放。</div>
      </el-card>
    </div>

    <div class="right">
      <ChatPanel v-if="supplierId" :project-id="projectId" :supplier-id="supplierId" :supplier-name="supplierName" />
      <el-card v-else shadow="never"><div class="empty">加载供应商信息中…</div></el-card>
    </div>
  </div>
</template>

<style scoped>
.hall { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(380px, 1.2fr); gap: 16px; }
.head { display: flex; align-items: center; gap: 12px; }
.online { margin-left: auto; color: #909399; font-size: 12px; }
.actions { margin-top: 16px; display: flex; gap: 8px; align-items: center; }
.stage-hint { margin-top: 8px; color: #909399; font-size: 12px; }
.empty { padding: 40px; text-align: center; color: #999; }
@media (max-width: 960px) { .hall { grid-template-columns: 1fr; } }
</style>
```

**注意**：`supplierId`/`supplierName` 在挂载时经 `supplierApi.getProfile()`（`GET /supplier-portal/profile`，既有端点）取 supplier.id/name。`ChatPanel` 需 supplierId 才能拉私聊，务必保证拿到再渲染（`v-if="supplierId"`）。

- [ ] **Step 2: 注册路由**

在 `router/index.ts` 的 `opening-confirm` 路由（:85 附近）同层追加：

```ts
        {
          path: 'my-bids/:projectId/opening-hall',
          name: 'OpeningHall',
          component: () => import('@/views/bid/OpeningHall.vue'),
          meta: { title: '在线开标大厅' },
        },
```

（照抄相邻路由的 meta 风格。）

- [ ] **Step 3: MyBids.vue 增入口**

在 `MyBids.vue:243` 附近的"确认开标记录"按钮（`@click="router.push(`/my-bids/${row.projectId}/opening-confirm`)"`）之前插入：

```vue
            <el-button
              v-if="row.project?.stage === 'OPENING'"
              link
              type="primary"
              @click="router.push(`/my-bids/${row.projectId}/opening-hall`)"
            >进入开标大厅</el-button>
```

（MyBids 行数据嵌套 project 对象，阶段在 `row.project.stage`，与相邻 canConfirm 判断（:62-67）同源。）

- [ ] **Step 4: OpeningConfirm.vue 整体替换为重定向兼容**

```vue
<script setup lang="ts">
// 旧入口兼容：开标确认已并入「在线开标大厅」页
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute()
const router = useRouter()
onMounted(() => {
  router.replace(`/my-bids/${route.params.projectId}/opening-hall`)
})
</script>

<template>
  <div style="padding: 40px; text-align: center; color: #909399">正在进入在线开标大厅…</div>
</template>
```

- [ ] **Step 5: 手工端到端验证（M2 验收）**

启动 `pnpm dev:api` 与 `pnpm dev:supplier`；用 `supplier1/supplier1@2026` 登录 :3004，进入一个 OPENING 阶段项目（可用种子英雄项目；若其不在 OPENING，临时 `UPDATE "BidProject" SET stage='OPENING'` 测试后改回，或走主持端流程建开标会话）：
Expected: 大厅页显示项目信息；签到成功；公聊发消息后主持端（Task 14 前可用 REST `GET /opening-hall/:id/messages` 或 socket 调试工具）可见；确认/异议按钮可用。

- [ ] **Step 6: Commit**

```bash
git add apps/supplier-portal/src/views/bid/OpeningHall.vue apps/supplier-portal/src/views/bid/OpeningConfirm.vue apps/supplier-portal/src/views/bid/MyBids.vue apps/supplier-portal/src/router/index.ts
git commit -m "feat(supplier-portal): 在线开标大厅页（签到+聊天+确认/异议）+ 路由与入口"
```

---

## M3 主持端 + 存证

### Task 13: bid-portal 事件接入与 REST 客户端

**Files:**
- Modify: `apps/bid-portal/src/hooks/use-bid-websocket.ts`
- Create: `apps/bid-portal/src/lib/opening-hall.ts`

**Interfaces:**
- Consumes: Task 1 载荷类型
- Produces: `BidWsHandlers` 新增 `onHallMessage/onHallPresence/onHallCheckin/onHallExchangeControl/onOpeningConfirmed/onOpeningDisputed/onOpeningDisputeResolved`；`openingHallApi`（fetch 版，携带 `credentials:'include'` 与 `X-Portal: web`）

- [ ] **Step 1: hook 补导入与 handler 声明**

`use-bid-websocket.ts` 的 `@water-erp/shared` 导入块（:6-18）追加类型：

```ts
  type HallMessagePayload,
  type HallPresenceUpdatePayload,
  type HallCheckinPayload,
  type HallExchangeControlPayload,
  type OpeningConfirmedPayload,
  type OpeningDisputedPayload,
  type OpeningDisputeResolvedPayload,
```

`BidWsHandlers` 接口（:25-35）追加：

```ts
  onHallMessage?: (d: HallMessagePayload) => void;
  onHallPresence?: (d: HallPresenceUpdatePayload) => void;
  onHallCheckin?: (d: HallCheckinPayload) => void;
  onHallExchangeControl?: (d: HallExchangeControlPayload) => void;
  onOpeningConfirmed?: (d: OpeningConfirmedPayload) => void;
  onOpeningDisputed?: (d: OpeningDisputedPayload) => void;
  onOpeningDisputeResolved?: (d: OpeningDisputeResolvedPayload) => void;
```

事件绑定块（:124-132 的 `on(BID_EVENT....)` 序列）末尾追加：

```ts
    on(BID_EVENT.HALL_MESSAGE_NEW, h.current.onHallMessage);
    on(BID_EVENT.HALL_PRESENCE_UPDATE, h.current.onHallPresence);
    on(BID_EVENT.HALL_CHECKIN, h.current.onHallCheckin);
    on(BID_EVENT.HALL_EXCHANGE_CONTROL, h.current.onHallExchangeControl);
    on(BID_EVENT.OPENING_CONFIRMED, h.current.onOpeningConfirmed);
    on(BID_EVENT.OPENING_DISPUTED, h.current.onOpeningDisputed);
    on(BID_EVENT.OPENING_DISPUTE_RESOLVED, h.current.onOpeningDisputeResolved);
```

- [ ] **Step 2: 写 REST 客户端**

Create `apps/bid-portal/src/lib/opening-hall.ts`（沿用项目既有 fetch 封装；若 `src/lib/` 已有 apiFetch 之类的 helper 则直接复用，删掉本文件内的 apiFetch）：

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001/api';

async function apiFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Portal': 'web',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const openingHallApi = {
  presence: (projectId: string) => apiFetch(`/opening-hall/${projectId}/presence`),
  send: (projectId: string, body: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; content: string }) =>
    apiFetch(`/opening-hall/${projectId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  messages: (projectId: string, params: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    qs.set('roomType', params.roomType);
    if (params.supplierId) qs.set('supplierId', params.supplierId);
    if (params.limit) qs.set('limit', String(params.limit));
    return apiFetch(`/opening-hall/${projectId}/messages?${qs}`);
  },
  unread: (projectId: string) => apiFetch(`/opening-hall/${projectId}/unread`),
  markRead: (projectId: string, roomKey: string) =>
    apiFetch(`/opening-hall/${projectId}/read`, { method: 'POST', body: JSON.stringify({ roomKey }) }),
  setControl: (projectId: string, control: 'OPEN' | 'MUTED' | 'CLOSED') =>
    apiFetch(`/opening-hall/${projectId}/exchange-control`, { method: 'PATCH', body: JSON.stringify({ control }) }),
};
```

- [ ] **Step 3: 类型检查**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter bid-portal exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add apps/bid-portal/src/hooks/use-bid-websocket.ts apps/bid-portal/src/lib/opening-hall.ts
git commit -m "feat(bid-portal): 大厅事件 handlers + opening-hall REST 客户端"
```

---

### Task 14: 会场交流抽屉 + 确认/异议实时弹窗

**Files:**
- Create: `apps/bid-portal/src/components/bid/exchange-drawer.tsx`
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`（:326 附近的 useBidWebSocket handlers + 页面布局）

**Interfaces:**
- Consumes: Task 13 hook 扩展与 `openingHallApi`
- Produces: `<ExchangeDrawer projectId>` 抽屉（花名册 + 公聊/私聊 + 交流控制）；开标大厅页对 `opening:confirmed/disputed` 弹 toast

- [ ] **Step 1: 写抽屉组件**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { openingHallApi } from '@/lib/opening-hall';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import type {
  HallMessagePayload,
  HallPresenceUpdatePayload,
  HallCheckinPayload,
  HallExchangeControlPayload,
} from '@water-erp/shared';

type Msg = { id: string; senderRole: string; senderName: string; content: string; createdAt: string };
type Session = { supplierId: string; supplierName: string; checkInAt: string | null; unread: number };

export function ExchangeDrawer({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [activeSupplier, setActiveSupplier] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [publicMsgs, setPublicMsgs] = useState<Msg[]>([]);
  const [privateMsgs, setPrivateMsgs] = useState<Msg[]>([]);
  const [publicUnread, setPublicUnread] = useState(0);
  const [roster, setRoster] = useState<HallPresenceUpdatePayload['onlineSuppliers']>([]);
  const [control, setControl] = useState<'OPEN' | 'MUTED' | 'CLOSED'>('OPEN');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [checkins, setCheckins] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const toMsg = (d: HallMessagePayload): Msg => ({
    id: d.id, senderRole: d.senderRole, senderName: d.senderName, content: d.content, createdAt: d.createdAt,
  });
  const activeSupplierRef = useRef<string | null>(null);
  activeSupplierRef.current = activeSupplier?.supplierId ?? null;

  useBidWebSocket(projectId, {
    onHallMessage: useCallback((d: HallMessagePayload) => {
      if (d.roomType === 'PUBLIC') {
        setPublicMsgs(prev => [...prev, toMsg(d)]);
        setTab(cur => { if (cur !== 'PUBLIC') setPublicUnread(n => n + 1); return cur; });
      } else {
        setPrivateMsgs(prev => (d.supplierId === activeSupplierRef.current ? [...prev, toMsg(d)] : prev));
        setSessions(prev => prev.map(s =>
          s.supplierId === d.supplierId && d.supplierId !== activeSupplierRef.current
            ? { ...s, unread: s.unread + 1 } : s));
      }
    }, []),
    onHallPresence: useCallback((d: HallPresenceUpdatePayload) => setRoster(d.onlineSuppliers), []),
    onHallCheckin: useCallback((d: HallCheckinPayload) => setCheckins(prev => ({ ...prev, [d.supplierId]: d.checkInAt })), []),
    onHallExchangeControl: useCallback((d: HallExchangeControlPayload) => setControl(d.control), []),
  });

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [publicMsgs, privateMsgs, tab]);

  useEffect(() => {
    if (!open) return;
    openingHallApi.messages(projectId, { roomType: 'PUBLIC', limit: 100 })
      .then(r => setPublicMsgs(r.items.map(toMsg))).catch(() => {});
    openingHallApi.unread(projectId).then(r => {
      setPublicUnread(r.public ?? 0);
      setSessions(r.sessions ?? []);
    }).catch(() => {});
    openingHallApi.presence(projectId).then(r => {
      setRoster((r.suppliers ?? []).filter((s: any) => s.online).map((s: any) => ({
        supplierId: s.supplierId, supplierName: s.supplierName, checkInAt: s.checkInAt ? String(s.checkInAt) : null,
      })));
    }).catch(() => {});
  }, [open, projectId]);

  async function openPrivate(s: Session) {
    setActiveSupplier(s); setTab('PRIVATE');
    setSessions(prev => prev.map(x => (x.supplierId === s.supplierId ? { ...x, unread: 0 } : x)));
    const r = await openingHallApi.messages(projectId, { roomType: 'PRIVATE', supplierId: s.supplierId, limit: 100 }).catch(() => null);
    setPrivateMsgs(r ? r.items.map(toMsg) : []);
    await openingHallApi.markRead(projectId, `supplier:${s.supplierId}`).catch(() => {});
  }

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    if (tab === 'PRIVATE' && !activeSupplier) return;
    setSending(true);
    try {
      await openingHallApi.send(projectId, {
        roomType: tab,
        supplierId: tab === 'PRIVATE' ? activeSupplier!.supplierId : undefined,
        content,
      });
      setInput('');
    } catch (e: any) {
      alert(e?.message || '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function changeControl(next: 'OPEN' | 'MUTED' | 'CLOSED') {
    try {
      await openingHallApi.setControl(projectId, next);
      setControl(next);
    } catch (e: any) {
      alert(e?.message || '切换失败');
    }
  }

  const msgs = tab === 'PUBLIC' ? publicMsgs : privateMsgs;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative rounded-xl border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
      >
        会场交流
        {(publicUnread > 0 || sessions.some(s => s.unread > 0)) && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white">
            {publicUnread + sessions.reduce((a, s) => a + s.unread, 0)}
          </span>
        )}
      </button>

      {open && (
        <aside className="fixed right-0 top-0 z-40 flex h-full w-[420px] flex-col border-l border-slate-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold">会场交流</h3>
            <div className="flex items-center gap-1 text-xs">
              {(['OPEN', 'MUTED', 'CLOSED'] as const).map(c => (
                <button key={c} onClick={() => changeControl(c)}
                  className={`rounded-lg px-2 py-1 ${control === c ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {c === 'OPEN' ? '开放' : c === 'MUTED' ? '禁言' : '关闭'}
                </button>
              ))}
              <button onClick={() => setOpen(false)} className="ml-2 text-slate-400 hover:text-slate-700">✕</button>
            </div>
          </header>

          <div className="border-b border-slate-200 px-4 py-2">
            <div className="mb-1 text-xs font-medium text-slate-500">在场名单（{roster.length}）</div>
            <div className="flex flex-wrap gap-1.5">
              {roster.map(s => (
                <span key={s.supplierId} className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                  {s.supplierName}{s.checkInAt || checkins[s.supplierId] ? ' ✓签到' : ''}
                </span>
              ))}
              {roster.length === 0 && <span className="text-xs text-slate-400">暂无供应商在线</span>}
            </div>
          </div>

          <div className="flex gap-2 border-b border-slate-200 px-4 py-2 text-sm">
            <button onClick={() => { setTab('PUBLIC'); setPublicUnread(0); openingHallApi.markRead(projectId, 'public').catch(() => {}); }}
              className={tab === 'PUBLIC' ? 'font-semibold text-slate-900' : 'text-slate-500'}>
              公聊{publicUnread > 0 ? ` (${publicUnread})` : ''}
            </button>
            <button onClick={() => setTab('PRIVATE')}
              className={tab === 'PRIVATE' ? 'font-semibold text-slate-900' : 'text-slate-500'}>
              私聊
            </button>
          </div>

          {tab === 'PRIVATE' && (
            <div className="flex gap-1.5 overflow-x-auto border-b border-slate-200 px-4 py-2">
              {sessions.map(s => (
                <button key={s.supplierId} onClick={() => openPrivate(s)}
                  className={`whitespace-nowrap rounded-lg px-2 py-1 text-xs ${activeSupplier?.supplierId === s.supplierId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {s.supplierName}{s.unread > 0 ? ` ●${s.unread}` : ''}
                </button>
              ))}
              {sessions.length === 0 && <span className="text-xs text-slate-400">暂无供应商参与</span>}
            </div>
          )}

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {tab === 'PRIVATE' && !activeSupplier && <div className="pt-10 text-center text-xs text-slate-400">选择一家供应商开始私聊</div>}
            {msgs.map(m => (
              <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.senderRole === 'HOST' ? 'bg-slate-100' : m.senderRole === 'SYSTEM' ? 'bg-transparent text-center text-xs text-slate-400' : 'bg-blue-50'}`}>
                <div className="mb-0.5 text-[11px] text-slate-400">{m.senderName} · {new Date(m.createdAt).toLocaleTimeString('zh-CN')}</div>
                <div className="whitespace-pre-wrap break-all">{m.content}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t border-slate-200 p-3">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder={tab === 'PRIVATE' && !activeSupplier ? '请先选择供应商' : '输入消息（Enter 发送）'}
              disabled={tab === 'PRIVATE' && !activeSupplier}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
            />
            <button onClick={send} disabled={sending || !input.trim()}
              className="rounded-xl bg-slate-900 px-4 text-sm text-white disabled:opacity-40">发送</button>
          </div>
        </aside>
      )}
    </>
  );
}
```

- [ ] **Step 2: 开标大厅页集成抽屉与确认/异议 toast**

`open/page.tsx` 顶部导入：

```tsx
import { ExchangeDrawer } from '@/components/bid/exchange-drawer';
```

在 :326 附近的 `useBidWebSocket(projectId ?? undefined, { ... })` handlers 对象内追加（该页 :19 已 `import { toast } from 'sonner'`，直接用）：

```tsx
    onOpeningConfirmed: (d) => {
      toast.success(`${d.supplierName} 已确认开标记录`);
    },
    onOpeningDisputed: (d) => {
      toast.warning(`${d.supplierName} 提出开标异议：${d.reason}`);
    },
```

在页面头部操作区（与倒计时/连接灯同一行的合适位置，参照既有按钮排布）插入：

```tsx
{projectId && <ExchangeDrawer projectId={projectId} />}
```

- [ ] **Step 3: 类型检查 + 手工验证**

Run: `pnpm --filter bid-portal exec tsc --noEmit`
手工：`pnpm dev:api` + `pnpm dev:bid` + `pnpm dev:supplier`，陈源远（bid_host）登录 :3007 进开标大厅；supplier1 登录 :3004 进大厅页发公聊、签到、确认开标记录 → 主持端抽屉实时出现消息、花名册勾选签到、toast 提示确认。

- [ ] **Step 4: Commit**

```bash
git add apps/bid-portal/src/components/bid/exchange-drawer.tsx "apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx"
git commit -m "feat(bid-portal): 会场交流抽屉（花名册/公聊/私聊/交流控制）+ 确认异议实时弹窗"
```

---

### Task 15: 监督端只读大厅交流页签

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/supervise/page.tsx`

**Interfaces:**
- Consumes: `openingHallApi.messages/presence`
- Produces: 监督端"大厅交流"只读页签（公聊 + 各家私聊记录），符合监督端"只读不干预"定位

- [ ] **Step 1: 在监督端页签定义处追加页签**

找到该页的 tab 数组（搜索既有 tab 列表常量，如 `tabs` / `TABS`），追加一项 `{ key: 'hall', label: '大厅交流' }`（照抄相邻项字段名）。

- [ ] **Step 2: 追加只读渲染块**

在页签内容渲染 switch/条件分支中追加 `hall` 分支：

```tsx
{tab === 'hall' && projectId && <HallExchangeReadonly projectId={projectId} />}
```

同文件内（组件定义区附近）新增只读组件：

```tsx
function HallExchangeReadonly({ projectId }: { projectId: string }) {
  const [publicMsgs, setPublicMsgs] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [privateMsgs, setPrivateMsgs] = useState<any[]>([]);

  useEffect(() => {
    openingHallApi.messages(projectId, { roomType: 'PUBLIC', limit: 100 })
      .then(r => setPublicMsgs(r.items)).catch(() => {});
    openingHallApi.unread(projectId).then(r => setSessions(r.sessions ?? [])).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!active) return;
    openingHallApi.messages(projectId, { roomType: 'PRIVATE', supplierId: active, limit: 100 })
      .then(r => setPrivateMsgs(r.items)).catch(() => {});
  }, [active, projectId]);

  const MsgList = ({ items }: { items: any[] }) => (
    <div className="max-h-[480px] space-y-2 overflow-y-auto">
      {items.length === 0 && <div className="py-8 text-center text-xs text-slate-400">暂无记录</div>}
      {items.map((m: any) => (
        <div key={m.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <div className="mb-0.5 text-[11px] text-slate-400">
            {m.senderRole === 'HOST' ? '主持人' : m.senderRole === 'SYSTEM' ? '系统' : m.senderName} · {new Date(m.createdAt).toLocaleString('zh-CN')}
          </div>
          <div className="whitespace-pre-wrap break-all">{m.content}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="mb-2 text-sm font-semibold">公聊记录</h4>
        <MsgList items={publicMsgs} />
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="mb-2 text-sm font-semibold">私聊记录（按供应商）</h4>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {sessions.map((s: any) => (
            <button key={s.supplierId} onClick={() => setActive(s.supplierId)}
              className={`rounded-lg px-2 py-1 text-xs ${active === s.supplierId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {s.supplierName}
            </button>
          ))}
        </div>
        {active ? <MsgList items={privateMsgs} /> : <div className="text-xs text-slate-400">选择供应商查看私聊留痕</div>}
      </div>
    </div>
  );
}
```

顶部补导入 `openingHallApi`（from `@/lib/opening-hall`）与 `useState/useEffect`（若该文件尚未导入）。

- [ ] **Step 3: 类型检查 + Commit**

Run: `pnpm --filter bid-portal exec tsc --noEmit`

```bash
git add "apps/bid-portal/src/app/(dashboard)/bid/supervise/page.tsx"
git commit -m "feat(bid-portal): 监督端只读大厅交流记录页签"
```

---

### Task 16: 归档包含大厅聊天记录

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`exportArchivePackage` :1796 起）

**Interfaces:**
- Consumes: `OpeningHallMessage` 表
- Produces: 归档包 JSON 的 `sections.hallMessages`

- [ ] **Step 1: 在 `exportArchivePackage` 中查询大厅消息**

在 :1811（`if (!project) throw ...` 之后、`const chain = computeArchiveChain(` 之前）插入：

```ts
    const hallMessages = await this.prisma.openingHallMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
```

- [ ] **Step 2: sections 对象增加 hallMessages**

在 sections 对象的 `clarifications: project.clarifications,` 行（:1916 附近）之后插入：

```ts
        hallMessages: hallMessages.map(m => ({
          id: m.id, roomType: m.roomType, supplierName: m.supplierName,
          senderRole: m.senderRole, senderName: m.senderName, content: m.content, createdAt: m.createdAt,
        })),
```

- [ ] **Step 3: 验证**

Run: `pnpm --filter api build && pnpm --filter api test:e2e -- bid.e2e`
手工：主持端归档端导出一个含聊天记录的 OPENING→ARCHIVED 项目归档包 JSON，确认 `sections.hallMessages` 存在且按时间升序。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bid/bid.service.ts
git commit -m "feat(api): 归档包包含大厅聊天记录（sections.hallMessages）"
```

---

### Task 17: 书面渠道改造（存量提问入口）

**Files:**
- Modify: `apps/api/src/supplier-portal/dto/create-question.dto.ts`（按实际文件名；`CreateQuestionDto` 所在文件）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（`createQuestion` 的 `prisma.bidClarification.create` data 块，:434 附近）
- Modify: `apps/supplier-portal/src/api/bid.ts`
- Modify: `apps/supplier-portal/src/views/bid/BidDetail.vue`（答疑区块）
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/clarifications/page.tsx`

**Interfaces:**
- Produces: 供应商"书面交流"提交（正文 + 附件 fileAssetId）；主持端"书面来函"列表含附件下载链接；澄清模块其余行为零变化（无实时推送——异步语义）

- [ ] **Step 1: DTO 加附件字段**

`CreateQuestionDto` 追加：

```ts
  @IsOptional()
  @IsString()
  fileAssetId?: string;
```

- [ ] **Step 2: service 透传**

`supplier-portal.service.ts` 的 `createQuestion` 中 `prisma.bidClarification.create({ data: { ... } })` 的 data 块（:435-444 附近）追加一行：

```ts
        fileAssetId: dto.fileAssetId ?? null,
```

- [ ] **Step 3: 供应商端 API 客户端**

`src/api/bid.ts` 的 `createQuestion` 改为：

```ts
  createQuestion(projectId: string, question: string, fileAssetId?: string) {
    return api.post(`/supplier-portal/bid-projects/${projectId}/questions`, { question, fileAssetId })
  },
```

- [ ] **Step 4: `BidDetail.vue` 答疑区块改造**

找到标前答疑区块（搜索 `createQuestion` 调用处），做三处修改：
1. 标题文案"标前答疑/提问"改为"书面交流"，说明文字改为"如需获取信息，可提交书面函件（支持附件），或致电项目联系人"；
2. 表单增加附件上传（复用 `src/api/upload.ts` 的 `uploadFile(file, category, onProgress?)`，返回 `Promise<FileAssetResponse>`，用法同 `Register.vue:126`）：

```vue
        <el-upload
          :auto-upload="true"
          :limit="1"
          :http-request="async (opt: any) => {
            const asset = await uploadFile(opt.file as File, 'clarification')
            attachAssetId.value = asset.id
          }"
          :on-remove="() => (attachAssetId.value = '')"
        >
          <el-button size="small">添加附件</el-button>
        </el-upload>
```

`<script setup>` 顶部加 `import { uploadFile } from '@/api/upload'` 与 `const attachAssetId = ref('')`。

3. 提交调用改为 `bidApi.createQuestion(projectId, text, attachAssetId.value || undefined)`。

- [ ] **Step 5: 主持端澄清页增"书面来函"分区**

`clarifications/page.tsx`：在现有列表上方/页签中增加一个按 `type === 'question'` 过滤的"书面来函"区块（数据复用该页既有的 clarifications 列表接口响应，前端过滤即可），每行展示：供应商名、提问时间、正文、附件链接：

```tsx
{c.fileAssetId && (
  // 受保护下载：不要用 rel="noreferrer"（会丢 Referer 导致 401 —— 项目既有坑）
  <a href={`http://localhost:4001/api/upload/files/${c.fileAssetId}`} target="_blank" className="text-xs text-blue-600 underline">
    附件下载
  </a>
)}
```

（API base 用该文件既有的 API base 常量，不要硬编码 localhost。）

- [ ] **Step 6: 验证 + Commit**

手工：供应商端项目详情页提交一条带附件的书面交流；主持端澄清页"书面来函"可见且附件可下载。

```bash
git add apps/api/src/supplier-portal apps/supplier-portal/src apps/bid-portal/src
git commit -m "feat: 书面交流渠道（供应商来函+附件，主持端查看；澄清模块保持单向无推送）"
```

---

### Task 18: 种子数据、全量回归与验收

**Files:**
- Create: `apps/api/prisma/seed-data/OpeningHallMessage.json`、`OpeningHallReadCursor.json`
- Modify: `apps/api/prisma/seed.ts`（ALL_TABLES :40 起、SEED_ORDER :77 起）

**Interfaces:**
- Produces: `pnpm db:seed` 后英雄项目自带演示聊天；全量 E2E 绿；双门户手工验收通过

- [ ] **Step 1: 生成种子 JSON（从既有种子提取真实 ID，不手写 cuid）**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api/prisma
node -e "
const fs = require('fs');
const bs = JSON.parse(fs.readFileSync('seed-data/BidSupplier.json', 'utf8'));
const users = JSON.parse(fs.readFileSync('seed-data/User.json', 'utf8'));
const hero = bs.filter(r => r.projectId === 'cmqhero-bid-proj01' && r.supplierId);
if (hero.length < 1) { console.error('英雄项目无参投供应商，检查 BidSupplier.json'); process.exit(1); }
const host = users.find(u => u.username === '陈源远' && u.role === 'bid_host') || users.find(u => u.username === '陈源远');
const s = hero[0];
const msgs = [
  { id: 'cmqhero-hall-m01', projectId: 'cmqhero-bid-proj01', roomType: 'PUBLIC', supplierId: null, supplierName: null,
    senderId: host.id, senderRole: 'HOST', senderName: host.username, type: 'TEXT',
    content: '各位投标人，本项目开标会现在开始，请各家确认在线并签到。', createdAt: '2026-07-22T09:00:00.000Z' },
  { id: 'cmqhero-hall-m02', projectId: 'cmqhero-bid-proj01', roomType: 'PUBLIC', supplierId: null, supplierName: null,
    senderId: s.supplierId, senderRole: 'SUPPLIER', senderName: s.supplierName, type: 'TEXT',
    content: '收到，我方已在线。', createdAt: '2026-07-22T09:01:00.000Z' },
  { id: 'cmqhero-hall-m03', projectId: 'cmqhero-bid-proj01', roomType: 'PRIVATE', supplierId: s.supplierId, supplierName: s.supplierName,
    senderId: host.id, senderRole: 'HOST', senderName: host.username, type: 'TEXT',
    content: '你方解密已完成，请核对唱标记录后确认。', createdAt: '2026-07-22T09:05:00.000Z' },
];
fs.writeFileSync('seed-data/OpeningHallMessage.json', JSON.stringify(msgs, null, 2));
fs.writeFileSync('seed-data/OpeningHallReadCursor.json', '[]');
console.log('written', msgs.length, 'messages');
"
```

- [ ] **Step 2: seed.ts 注册新表**

`ALL_TABLES` 数组（:40 起）末尾追加：

```ts
  'OpeningHallMessage',
  'OpeningHallReadCursor',
```

`SEED_ORDER`（:77 起）的 `['BidOpeningRecord', 'bidOpeningRecord'],`（:44 区域）之后追加：

```ts
  ['OpeningHallMessage', 'openingHallMessage'],
  ['OpeningHallReadCursor', 'openingHallReadCursor'],
```

- [ ] **Step 3: 重跑种子**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm db:seed`
Expected: 末尾计数含 `OpeningHallMessage: 3`、`OpeningHallReadCursor: 0`，无报错。

- [ ] **Step 4: 全量回归**

Run: `pnpm --filter api test && pnpm --filter api test:e2e`
Expected: 单测与全部 E2E 套件（auth/bid/catalog/supplier/upload/ai-bid/expert-admin/operation-log/sealed-bid-backup/opening-hall）绿。`--forceExit` 属既有行为。

- [ ] **Step 5: 双端构建**

Run: `pnpm --filter supplier-portal build && pnpm --filter bid-portal exec tsc --noEmit && pnpm --filter api build`
Expected: 全部成功。

- [ ] **Step 6: 手工验收清单（逐项过）**

启动 `pnpm dev:api`、`pnpm dev:supplier`、`pnpm dev:bid`：
1. supplier1 登录 :3004 → 我的投标 → OPENING 项目"进入开标大厅" → 页面正常、历史消息（若有）加载
2. 签到 → 成功提示；主持端（陈源远 bid_host 登录 :3007 → 开标大厅）抽屉花名册实时出现该供应商并带"✓签到"
3. 供应商发公聊 → 主持端抽屉实时出现；主持端回复公聊 → 供应商端实时出现
4. 主持端私聊供应商 → 供应商端"与主持人私聊"tab 未读角标 +1，切换后消息可见
5. 主持端切"禁言" → 供应商端输入框禁用并显示提示；切"关闭" → 全员不可发；切回"开放"
6. 供应商"确认开标记录" → 主持端 toast；供应商"提出异议" → 主持端 toast + 主持端处理（开标记录区的异议处理入口，既有功能）→ 供应商端收到处理结果提示
7. 监督端（:3007 /bid/supervise）"大厅交流"页签可见公聊与私聊留痕
8. 断网恢复：供应商端切后台标签 30 秒再切回 → 连接灯恢复、消息无丢失（重连后 REST 历史仍完整）

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/seed-data/OpeningHallMessage.json apps/api/prisma/seed-data/OpeningHallReadCursor.json apps/api/prisma/seed.ts
git commit -m "chore(seed): 开标大厅演示消息种子 + seed.ts 注册"
```

- [ ] **Step 8: 收尾提醒**

向用户汇报：本分支共 N 个未推送 commit（不主动 push，等用户明示）；迭代二（SRS 直播 + 录制存证）按设计文档 §14 另行立项，开工前先做内网 WebRTC 连通性验证 demo。

---

## Verification（整体验证）

- **自动化**：`pnpm --filter api test`（含 bid.gateway.spec、opening-hall.service.spec 门控与规则单测）+ `pnpm --filter api test:e2e -- opening-hall`（门控四件套 + 全流程）。
- **手工**：Task 18 Step 6 的 8 项验收清单。
- **存证抽查**：`psql` 查 `"OpeningHallMessage"`、`"BidSupervisionLog"`（签到/交流控制/异议动作行）；导出归档包确认 `sections.hallMessages`。
- **回归**：既有 bid.e2e 全绿（确认 aggregate 改 host 房未破坏主持端/专家端——若 expert-portal 有消费 aggregate 需在 M1 末手工过一遍专家端 evaluate 页）。
