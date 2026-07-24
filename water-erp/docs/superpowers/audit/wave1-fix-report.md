# Wave 1 安全波修复报告（在线开标大厅·迭代一）

- **日期**：2026-07-24
- **分支**：`feat/bid-opening-hall-impl`
- **范围**：审查清单 `2026-07-24-iteration1-audit-fixlist.md` 的 C1 / S1 / S7 / S10（Wave 1 · 安全）
- **方法**：严格 TDD — 先写失败测试（RED 证据如下），再实现至全绿（GREEN）

---

## 修复 1 — C1：WS 连接认证兜底 + 显式角色白名单

**改动点**：`apps/api/src/bid/bid.gateway.ts`
- `:145` `handleJoinProject` 入口新增认证兜底：`if (!userId || !role) return { error: 'UNAUTHORIZED' }`（`handleConnection` 保持软鉴权风格不变，强制点收在 join 层）
- `:181-186` 兜底分支由「任何角色无条件进 project 房」改为显式白名单：仅 `canJoinHostRoom(role)`（admin/bid_host/leader/staff）进 `project:` + `host:` 房，其余角色（mall / procurement_staff 等）一律 `{ error: 'FORBIDDEN' }`
- supplier 分支既有双层门控、socket.data 缓存、supplierSockets 登记、broadcastHallPresence 调用原样保留（仅删除已被入口兜底覆盖的冗余 `if (!userId)` 检查）

**RED 证据**（实现前）：
- E2E：匿名 socket（空 Cookie 头 / 无 Cookie 头两种变体）`join:project` ack 均为 `{"ok":true}`，且能收到主持端公聊 `hall:message:new` 广播 — 漏洞实证复现
- 单测：`bid.gateway.spec.ts` 新用例 4 项失败（UNAUTHORIZED ×1、FORBIDDEN ×1、NOT_ASSIGNED_EXPERT ×1、已指派专家 findFirst 断言 ×1）

**GREEN 证据**：`bid.gateway.spec.ts` 14/14 通过；E2E `C1 负用例` 通过 — 两种匿名变体 ack 均为 `{ error: 'UNAUTHORIZED' }`，沉降窗口（600ms）内零泄漏

## 修复 2 — S1：专家指派门控

**改动点**：`apps/api/src/bid/bid.gateway.ts:169-176`（`handleJoinProject` 专家分支）
- join 前校验 `bidExpert.findFirst({ where: { projectId, userId } })`，未指派 → `{ error: 'NOT_ASSIGNED_EXPERT' }`，不进任何房

**RED 证据**：
- 单测：未指派专家 join ack 为 `{"ok":true}`（应为 NOT_ASSIGNED_EXPERT）
- E2E：未指派到 hero 项目（`cmqhero-bid-proj01`，仅 5 名指派专家 vs 186 人专家库）的真实专家账号登录连 WS，join hero ack 为 `{"ok":true}`

**GREEN 证据**：单测通过（含 findFirst where 参数断言）；E2E `S1 负用例` ack `{ error: 'NOT_ASSIGNED_EXPERT' }`（ack 本身即证明认证链路正常——角色已解析为 bid_expert，仅指派门拒绝）

## 修复 3 — S7：markRead 门控

**改动点**：
- `apps/api/src/opening-hall/opening-hall.service.ts:161-182` — 签名改为 `markRead(actor: HallActor, projectId, roomKey)`，三段校验：
  1. 项目存在性：`bidProject.findUnique`，不存在 → `BadRequestException({code:'NOT_FOUND'})`
  2. roomKey 归属：supplier 仅 `'public'` / `supplier:<自身>`，否则 `ForbiddenException({code:'ROOM_KEY_FORBIDDEN'})`；host（HOST_ROLES_SET）`'public'` 放行、`supplier:<x>` 须为项目参投成员（`bidSupplier.findFirst`），非成员 → `BadRequestException({code:'NOT_PROJECT_MEMBER'})`；其他角色 → `assertHost` → 403 HOST_ONLY
  3. 校验通过后 upsert 逻辑原样
- `apps/api/src/opening-hall/opening-hall.controller.ts:73-76` — `POST :projectId/read` 改用既有私有 `actor(req)` helper 构造 actor（supplier 角色自动解析 supplierId）

**RED 证据**：
- 单测：新签名对旧实现编译失败（TS2345，6 处）— 旧实现 `markRead(projectId, userId, roomKey)` 无 actor 概念
- E2E：供应商对 `supplier:<另一供应商id>` POST read → `201 Created`（应 403）

**GREEN 证据**：`opening-hall.service.spec.ts` 19/19 通过（新增 6 用例：supplier 合法路径 upsert、supplier 他人 roomKey 403、host 成员 roomKey upsert、host 非成员 400、bid_expert 403、不存在项目 400）；E2E `S7 负用例` 403/400/201 三断言通过

## 修复 4 — S10：E2E 负用例（`apps/api/test/opening-hall.e2e-spec.ts:337-390`）

1. **C1 无 cookie 连 WS**：`connectBid(base, '')`（空 Cookie 头）+ 裸 `io()`（无 Cookie 头）双变体 → ack `{ error: 'UNAUTHORIZED' }`；沉降窗口内主持端发公聊，两个匿名 socket 均零接收 `hall:message:new`
2. **S1 专家跨项目**：beforeAll 动态查 DB 找未指派到 hero 项目的 bid_expert（`User.role='bid_expert'` 且 id 不在 `BidExpert where projectId=hero` 的 userId 集），以 `expert@2026` 登录连 WS join hero → `{ error: 'NOT_ASSIGNED_EXPERT' }`；含兜底分支（查不到则创建临时 User，passwordHash 复用现有种子行，afterAll 清理）— 本次运行命中真实账号，未触发兜底
3. **S7 markRead 滥用**：供应商写他人 roomKey → 403 `ROOM_KEY_FORBIDDEN`；不存在项目 → 400 `NOT_FOUND`；合法自身 roomKey → 201（正路径回归）

---

## 验证结果（全部实现后运行）

| # | 命令 | 结果 |
|---|------|------|
| 1 | `pnpm --filter api test:e2e -- opening-hall` | ✅ 16/16（旧 13 + 新 3 组负用例） |
| 2 | `pnpm --filter api test -- opening-hall.service` | ✅ 19/19（旧 13 + 新 6） |
| 3 | `pnpm --filter api test -- bid.gateway.spec` | ✅ 14/14（旧 10 + 新 4；既有专家房/聚合/token 解析用例未被破坏） |
| 4 | `pnpm --filter api test`（全量） | ✅ 82 suites / 843 tests 全绿（supplier-portal.service.spec 存量失败当前亦为绿） |
| 5 | `pnpm --filter api build` | ✅ 干净 |

E2E RED 基线（实现前同套件运行）：旧 13 通过、新 3 失败，失败点与本修复一一对应。

## 遗留问题 / 观察

1. **procurement_staff 失去 project 房实时流**：白名单收敛后 `procurement_staff` join 返回 FORBIDDEN。`apps/web/src/components/projects/bid-confirm-panel.tsx`（经 `use-bid-websocket.ts`）以该角色 join 项目房，改后将收不到实时事件（ack FORBIDDEN，前端未消费 ack、表现为静默无实时刷新）。清单规格明确 host 白名单为 admin/bid_host/leader/staff，此为按规格执行的已知行为变更；如需保留 procurement_staff 实时只读，应另起条目决策（与 S8 host 角色粒度决策同源）。
2. **S9（WS CORS origin:true + credentials:true）未动**：不在 Wave 1 范围；C1 修复已关闭「匿名直连窃听」主路径，CSWSH 残余风险靠 cookie sameSite:lax 兜底，留待后续波。
3. Wave 2 条目（S4/S5 消毒、S6 分页、R 系列正确性）不在本次范围。
4. 前端各端 `join:project` 均不消费 ack 错误（`socket.emit('join:project', id)` 无回调）— 被拒后无 UI 反馈。建议迭代二为 join 加 ack 回调 + 错误提示（本波仅后端安全收口，未改前端）。
