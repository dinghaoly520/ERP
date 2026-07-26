# 交流控制变更 → 聊天流居中系统提示

日期：2026-07-26 · 分支：main · 状态：已提交（未 push）

## 需求

主持人切换交流控制（MUTED 全员禁言 / CLOSED 关闭聊天大厅 / OPEN 恢复自由发言）时，在聊天框中间以居中系统提示显示一条消息；要求持久化、双端（supplier-portal :3004 / bid-portal :3007）实时、重载后仍在、公聊私聊两栏都看得到。

## 方案

气泡改造已使两端把 `senderRole === 'SYSTEM'` 的消息渲染为居中提示条（supplier `.sys-tip`；host 居中胶囊），故只需后端在控制变更时落一条 SYSTEM 消息并广播。

SYSTEM 消息落 `roomType: 'PUBLIC'`：
- **持久化**：`OpeningHallMessage` 行，重载后 `GET /opening-hall/:id/messages?roomType=PUBLIC` 照常返回。
- **双端实时**：`notifyHallMessage` 对 PUBLIC 投 `project:<id>` 房 → 两端 `publicMsgs` 收到 → 居中渲染。
- **私聊可见**：SYSTEM 行属 PUBLIC 房，私聊列表不单独存；两端私聊 tab 由视图层归并 `publicMsgs` 中的 SYSTEM 行（按 createdAt 插入排序）。

## 改动文件

### 后端

**`apps/api/src/opening-hall/opening-hall.service.ts`**
- `setExchangeControl` 改签名：`(projectId, control, byName, actorUserId)`。
- 在 update session + 监督日志 + `notifyExchangeControl` 之后，按控制态生成文案（MUTED→「主持人已开启全员禁言」、CLOSED→「主持人已关闭聊天大厅」、OPEN→「主持人已恢复自由发言」），`openingHallMessage.create` 落 `roomType:'PUBLIC', supplierId:null, senderRole:'SYSTEM', senderName:'系统', senderId:actorUserId`，并以与 `sendMessage` 同构的 `HallMessagePayload` 经 `notifyHallMessage` 广播。

**`apps/api/src/opening-hall/opening-hall.controller.ts`**
- `PATCH :projectId/exchange-control` 调用处补传 `req.user.sub` 作 actorUserId；`byName`（username）仍供监督日志留痕。@Roles 守卫保证 req.user 存在。

### 前端

**`apps/supplier-portal/src/components/bid/ChatPanel.vue`**
- `current` computed：PRIVATE tab 时归并 `publicMsgs` 的 SYSTEM 消息，按 createdAt 升序排序（归并只在视图层，`privateMsgs` 与其 markRead 游标语义不变）。
- `controlHint` 的 CLOSED 分支文案：「主持人已关闭互动」→「主持人已关闭聊天大厅」（与系统消息统一）。

**`apps/bid-portal/src/components/bid/exchange-drawer.tsx`**
- `msgs`：PRIVATE tab 时同样归并 `publicMsgs` 的 SYSTEM 消息并按时序排序。
- `inputHint` 的 CLOSED 分支文案同上统一。

### 测试

**`apps/api/src/opening-hall/opening-hall.service.spec.ts`**
- 原「交流控制切换写库+监督日志+广播」用例适配新签名（补 `'u-host'`），新增断言：`openingHallMessage.create` 收到 `roomType:'PUBLIC', supplierId:null, senderRole:'SYSTEM', senderName:'系统', content:'主持人已开启全员禁言'`；`notifyHallMessage` 以同文案、`supplierId:null`、ISO `createdAt` 广播。
- 新增用例：CLOSED/OPEN 两态文案断言（三态文案齐全）。

## 验证

| 项 | 结果 |
|----|------|
| `pnpm --filter api test -- opening-hall.service` | ✅ 35 passed |
| `pnpm --filter api build` | ✅ 干净（见遗留①） |
| `pnpm --filter supplier-portal build` | ✅ 干净 |
| `apps/bid-portal && npx tsc --noEmit` | ✅ exit 0 |
| 浏览器手工验证 | 用户自行 |

## 遗留

1. **main 既有 Prisma client 漂移**（与本改动无关）：首次 `nest build` 报 28 个 TS 错，全部在 `src/supplier/supplier.service.ts`（`supplierInvitation` / `isTemporary` 不在生成的 client 上——client 由旧 schema 生成）。`pnpm db:generate` 重生成后 build 干净；零错误涉及 opening-hall。漂移只影响 node_modules 产物，不产生仓库变更。
2. 未读数语义：SYSTEM 提示计入公聊未读（与大厅公告同口径）；私聊 tab 的归并显示不产生私聊未读角标——符合「这是大厅级公告」的定位。
3. 私聊视图归并的是本端已加载的 `publicMsgs` 窗口（两端均 limit 100 拉取 + socket 增量）；极端情况下 SYSTEM 消息在公聊窗口第 101 条之外时私聊 tab 不显示该条——公聊 tab 仍可见，属既有窗口策略的自然边界，未另行处理。
