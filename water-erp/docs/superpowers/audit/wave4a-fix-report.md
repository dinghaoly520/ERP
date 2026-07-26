# Wave 4a（后端实时健壮性）修复报告 — R5/R6/R7/R8

- **日期**：2026-07-25
- **分支**：feat/bid-opening-hall-impl
- **范围**：`docs/superpowers/audit/2026-07-24-iteration1-audit-fixlist.md` R5/R6/R7/R8 节；仅后端（前端升级在 Wave 4b）
- **方法**：TDD 先红后绿——先写失败用例（单元层 9 红；E2E 层经 source-only stash 实证 3 红），再实现至全绿

## R5 — 未读游标改"客户端上报已读末条"

**问题**：markRead 以服务端 now() 定游标 → "拉历史→markRead"窗口内到达的消息被误判已读（供应商可能错过主持人指令）。

**改动点**：
- `apps/api/src/opening-hall/dto/mark-read.dto.ts:13` — `MarkReadDto` 增 `@IsOptional() @IsString() lastMessageId?: string`
- `apps/api/src/opening-hall/opening-hall.controller.ts:75` — 透传 `dto.lastMessageId`
- `apps/api/src/opening-hall/opening-hall.service.ts:188,205-222` — `markRead(actor, projectId, roomKey, lastMessageId?)`：给出 lastMessageId 时按 roomKey 解析 roomType/supplierId（`public`→PUBLIC；`supplier:<id>`→PRIVATE+supplierId），`openingHallMessage.findFirst({ where: { id, projectId, roomType, supplierId? } })` **命中才**用其 createdAt 定游标（防跨项目/跨会话 id 乱报）；未给或未命中 → 回退 now()（旧前端兼容）
- 前置实证：`@updatedAt` 字段显式赋值不被 Prisma 覆盖（真实 DB 探针确认 EXPLICIT_VALUE_WINS），方案在 DB 层成立

**RED→GREEN**：
- RED：新单测 4 处 `svc.markRead(..., 4参)` → TS2554（Expected 3 arguments, but got 4），套件编译失败
- GREEN：`opening-hall.service.spec.ts`「markRead 已读末条游标（R5）」5 例：M1/M2/M3 上报 M2 → upsert lastReadAt=t2、unreadCounts.public=1（仅 M3，旧 now() 会判 0）；私聊 roomKey 的 findFirst 带 supplierId 限定；未知 id → 回退 now()（unread 0）；跨项目 id（findFirst null）→ 回退 now()；不传 lastMessageId 向后兼容不查消息表

## R6 — 签到原子抢占

**问题**：事务外"读后写"——并发双签到重复监督日志；update 成功而日志失败 → 重试命中 already → 监督日志永久丢失（存证缺口）。

**改动点**：
- `apps/api/src/opening-hall/opening-hall.service.ts:234-256` — `$transaction` 内 `tx.bidSupplier.updateMany({ where: { id: member.id, checkInAt: null }, data: {...} })` 原子抢占，count=1 时同事务写监督日志；count=0 → 回读首签时间返回 `already: true`（不写日志/不广播）。前置 SUPPLIER_ONLY/HALL_CLOSED/成员校验保留；notifyHallCheckin + broadcastHallPresence 仍在事务外（现状）

**RED→GREEN**：
- RED（单元）：新例断言 `updateMany({ where: { id: 'bs1', checkInAt: null } })` + `$transaction` 被调 → 旧实现未调用 → 失败
- GREEN（单元）：「checkIn 原子抢占（R6）」2 例：首签抢占+同事务留痕+广播；并发第二签到（count=0）→ already:true、回读首签时间、不重复写日志、不广播
- RED（E2E，source-only stash 实证）：并发双 POST → 旧实现两个 `already:false` + 2 行日志 → `[false,false] ≠ [false,true]` 失败
- GREEN（E2E）：`test/opening-hall.e2e-spec.ts`「R6：并发双签到原子抢占」——Promise.all 双签到，恰好一次 already:false，监督日志差值 =1

## R7 — resolveOpeningDispute 状态机

**问题**：不校验记录态 → 可"处理"从未异议的记录（翻转确认态）、对已处理记录反复覆盖。

**改动点**：
- `apps/api/src/bid/bid.service.ts:1156-1160` — 阶段门控之后、事务之前：`if (record.confirmStatus !== '供应商提出异议') throw new BadRequestException({ error: '该记录不处于异议待处理状态', code: 'DISPUTE_NOT_PENDING' })`

**RED→GREEN**：
- RED（单元）：新例 it.each 5 态（待确认/待供应商确认/供应商已确认/异议已处理-确认/异议已处理-退回）→ 旧实现不抛 → 失败
- GREEN（单元）：`bid.service.spec.ts` 5 态全部 400 DISPUTE_NOT_PENDING 且事务前拦截（`$transaction`/update 未调用）；「供应商提出异议」态放行；既有"异议→处理"2 例补 `confirmStatus: '供应商提出异议'` 后保持绿
- RED（E2E，source-only stash 实证）：对「待确认」记录 resolve → 旧实现 201 → `expected 400, got 201` 失败
- GREEN（E2E）：「R7 状态机」——sup2「待确认」记录 resolve → 400 DISPUTE_NOT_PENDING 且记录态未翻转；sup1 已处理记录二次 resolve → 400；既有"供应商提异议→主持处理→dispute:resolved"用例保持绿

## R8 — leave 清连接表 + 私聊定向按项目过滤

**问题**：leave:project 只退房不清 supplierSockets/socketProjects → 离场后仍计在线、仍收私聊定向推送；定向推送遍历该供应商全部 socket（跨项目 tab 互收）。

**改动点**：
- `apps/api/src/bid/bid.gateway.ts:200-226` — `handleLeaveProject`：清 supplierSockets（仅本次 join 登记的供应商身份；空集删键）、删 socketProjects、退 project/host/experts 三房、刷新 presence。房间以 leave 载荷为准、回退 `client.data.projectId`（修正指令稿纯用 client.data 会使 host/expert 退房失效的偏差）
- `apps/api/src/bid/bid.gateway.ts:323-328` — 私有 helper `supplierSocketsIn(supplierId, projectId)`：按 socketProjects 过滤项目
- `apps/api/src/bid/bid.gateway.ts:337,378,385,392` — 四处定向发射（notifyHallMessage PRIVATE 分支 / notifyOpeningConfirmed / notifyOpeningDisputed / notifyOpeningDisputeResolved）改用该 helper

**RED→GREEN**：
- RED（单元）：跨项目双 tab 用例断言 sock-p2 不收 p1 定向事件 → 旧实现 `Expected value: not "sock-p2"` 失败；leave 用例断言 presence 刷新 + 连接表清空 → `Expected: "p1"` 失败
- GREEN（单元）：`bid.gateway.spec.ts`「leave:project 清连接表 + 定向推送项目过滤（R8）」4 例：join→leave 后 supplierSockets 清空/socketProjects 删除/退三房/presence 被调；leave 后四路定向事件对该 socket 零接收；同供应商跨项目双 tab 仅本项目 socket 收到（host 房不受影响）；非供应商 socket leave 仅退房清表
- RED（E2E，source-only stash 实证）：leave 后 presence 仍 online=true → `Expected: false` 失败
- GREEN（E2E）：「R8：leave:project 清连接表」——join 基线 online=true → leave → 主持公聊 600ms 沉降窗口零接收 → presence online=false

## 测试结果

| 套件 | 结果 |
|---|---|
| `pnpm --filter api test -- opening-hall.service.spec bid.gateway.spec`（+bid.service.spec） | 196/196 ✅（基线 42 → 新增 R5×5/R6×2/R7×7/R8×4） |
| `pnpm --filter api test`（全量） | 82 suites / 873 tests ✅ 无新失败 |
| `pnpm --filter api test:e2e -- opening-hall` | 23/23 ✅（含 R6 并发、R7 状态机、R8 leave 零接收三新例；RED 实证 3/3 失败） |
| `pnpm --filter api test:e2e -- bid.e2e`（R7 回归） | 21/21 ✅ |
| `pnpm --filter api build` | 干净 ✅ |

## 遗留

1. **R5 同毫秒边界**：游标 = 已读末条 createdAt，`createdAt > cursor` 严格大于 → 与末条**同毫秒**到达的消息仍判已读（概率极低；彻底修复需 `(createdAt, id)` 复合游标落库，列入 Wave 5 打磨）
2. **前端配合（Wave 4b）**：markRead 调用需上报已读末条 id 才享新语义；未升级前行为与现状完全一致（向后兼容已单测背书）
3. **R8 偏差说明**：指令稿 leave 房间纯用 `client.data.projectId`，但仅供应商 join 分支写该字段——host/expert/staff socket 会退 `project:undefined` 而真房间漏退。实现改为 `leave 载荷 ?? client.data.projectId`，供应商语义不变、其余角色恢复正确退房（单测覆盖非供应商 leave）
4. **fixlist 登记**：R5 的"markRead 同毫秒恒已读"子项随复合游标方案（遗留 1）一并消解；其余 Wave 4a 四项关闭
