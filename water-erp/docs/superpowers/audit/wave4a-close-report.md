# Wave 4a 评审残留收口报告

- **日期**：2026-07-25
- **分支**：`feat/bid-opening-hall-impl`
- **范围**：Wave 4a 评审残留 1 Important + 5 Minor（`wave4a-fix-report.md` 后续收口）
- **方法**：TDD 先红后绿——先落 10 个失败断言（RED），再实现修复（GREEN）

## 改动点

### I1（Important）— enterOpeningRecord 状态门（防异议态记录被唱标重录覆写）

- **位置**：`apps/api/src/bid/bid.service.ts:1126-1136`（`enterOpeningRecord` 事务内 existing 分支前）
- **改动**：existing 记录命中锁定态集合 `['供应商已确认', '供应商提出异议', '异议已处理-确认', '异议已处理-退回']` → 抛 `ConflictException { code: 'RECORD_LOCKED' }`。堵住「异议后重录唱标 → record 覆写回待确认（objectionReason 残留）→ resolve 撞 R7 400 → bidSupplier 永久 DISPUTED → generateEvaluationResults 静默排除」的楔子链路（R7 引入的交互回归）。
- **RED→GREEN**：新增 `it.each` 4 个锁定态 → 409 RECORD_LOCKED + update/create 零调用；`it.each` 2 个可重录态（`待供应商确认`/`待确认`）→ 正常补录放行。RED 阶段 4 个锁定态用例全挂（update 无条件执行）；GREEN 后全过。
- **测试**：`apps/api/src/bid/bid.service.spec.ts`「BidService — enterOpeningRecord」新增 6 个用例。

### M2 — broadcastHallPresence 在场列表按项目过滤

- **位置**：`apps/api/src/bid/bid.gateway.ts:356-366`
- **改动**：过滤口径由全局 `supplierSockets.get(id)?.size > 0` 改为 `getOnlineSupplierIds(projectId)`（按 socketProjects 过滤项目），与私聊定向投递口径统一。
- **RED→GREEN**：新用例——sup-1 仅登记 p2、sup-2 登记 p1 → `broadcastHallPresence('p1')` 名单仅含 sup-2、`onlineCount=1`。RED 阶段失败（旧全局口径把 sup-1 误列在线）；GREEN 后通过。
- **测试**：`apps/api/src/bid/bid.gateway.spec.ts` R8 describe 新增 1 个用例。

### M3 — 游标单调（markRead 不倒退）

- **位置**：`apps/api/src/opening-hall/opening-hall.service.ts:220-224`
- **改动**：upsert 前先读既有游标，`existing.lastReadAt > lastReadAt` 时保留旧游标——客户端乱序上报更旧"已读末条"不再使游标倒退（防假未读/角标虚高）。now() 回退分支天然大于既有游标，行为不变。
- **RED→GREEN**：新用例——游标先在 M3（t3），再上报 M1（t1）→ 第二次 upsert 的 `update.lastReadAt` 保持 t3、`unreadCounts=0`。RED 阶段失败（游标倒退到 t1）；GREEN 后通过。
- **测试**：`apps/api/src/opening-hall/opening-hall.service.spec.ts` R5 describe 新增 1 个用例。

### M4 — resolveOpeningDispute 事务内条件更新（消灭门外 stale-read 双处理竞态）

- **位置**：`apps/api/src/bid/bid.service.ts:1178-1187`
- **改动**：事务内 record 更新由无条件 `update({ where: { id } })` 改为条件式 `updateMany({ where: { id, confirmStatus: '供应商提出异议' } })`，`count === 0` → `BadRequestException { code: 'DISPUTE_NOT_PENDING' }`（「该异议已被处理」）。事务外状态门保留（快速失败 + 文案区分）；与 R6 签到原子抢占同构。
- **RED→GREEN**：既有 3 个 resolve 用例的 mock/断言由 `update` 迁移到 `updateMany`（where 含异议态条件）；新增并发用例 `updateMany → count=0` → 400 + `bidSupplier.update`/`bidSupervisionLog.create` 零调用。RED 阶段 2 个用例失败；GREEN 后通过。
- **测试**：`apps/api/src/bid/bid.service.spec.ts` resolveOpeningDispute describe——3 个既有用例更新 + 1 个新增。

### M5 — resolve 监督日志记前后态

- **位置**：`apps/api/src/bid/bid.service.ts:1175, 1197, 1202`
- **改动**：监督日志（DB 落库 + WS `notifySupervisionLog` 双路）result 由裸 `dto.result` 改为 `供应商提出异议 → ${confirmStatus}：${dto.result}`，监督端可回放异议态迁移闭环。
- **RED→GREEN**：新用例断言 `bidSupervisionLog.create` 的 `data.result === '供应商提出异议 → 异议已处理-确认：复核无误'`。RED 阶段失败；GREEN 后通过。
- **测试**：`apps/api/src/bid/bid.service.spec.ts` resolveOpeningDispute describe 新增 1 个用例。

### M6 — leave 清理以 socketProjects 登记为准（防跨项目载荷误清）

- **位置**：`apps/api/src/bid/bid.gateway.ts:200-228`（`handleLeaveProject`）
- **改动**：连接表（supplierSockets/socketProjects）清理一律以 `socketProjects.get(client.id)` 登记项目为准（须 `registered` 存在才清供应商表）；退房 = 载荷房 + 登记房去重后都退（`project:`/`host:`/`experts:` 三房型 × 去重 pid 集）；presence 按涉及项目集逐个刷新。恶意/异常端 emit `leave('p1')` 不再漏清登记于 p2 的 socket，p2 在场名单不再残留幽灵在线。非供应商 socket（无登记）行为不变（仅载荷退房 + 刷 presence）。
- **RED→GREEN**：新用例——socket 登记 p2，emit `leave('p1')` → p2 在线表清空、socketProjects 删除、`left` 含 `project:p1`+`project:p2`、presence 广播 p2。RED 阶段失败（旧实现只退 p1、只刷 p1 presence）；GREEN 后通过。
- **测试**：`apps/api/src/bid/bid.gateway.spec.ts` R8 describe 新增 1 个用例。

## 测试结果

| 验证项 | 命令 | 结果 |
|--------|------|------|
| RED 基线 | `pnpm --filter api test -- bid.gateway.spec opening-hall.service.spec` + `bid.service.spec` | 10 个预期失败（I1×4、M4×2、M5×1、M2、M3、M6），其余全绿 |
| gateway + opening-hall 单测 | `pnpm --filter api test -- bid.gateway.spec opening-hall.service.spec` | ✅ 56/56 |
| bid.service 单测 | `pnpm --filter api test -- bid.service.spec` | ✅ 151/151 |
| 全量单测 | `pnpm --filter api test` | ✅ 82 suites / 884 tests，无新失败 |
| e2e opening-hall | `pnpm --filter api test:e2e -- opening-hall` | ✅ 23/23 保持 |
| e2e bid（I1 波及面） | `pnpm --filter api test:e2e -- bid.e2e` | ✅ 21/21（含 sealed-bid-backup 匹配套件） |
| 构建 | `pnpm --filter api build` | ✅ 干净 |

## 遗留

- 无。六项全部落地，无行为兼容性破坏：
  - I1 仅收紧「锁定态重录」这一本就不该发生的路径；待确认态补录（幂等 upsert 主路径）不受影响。
  - M4 事务外快速失败门未动，e2e R7 用例（`DISPUTE_NOT_PENDING` 含二次处理）原样通过。
  - M6 非供应商 socket / 载荷与登记一致的正常退房路径行为不变（既有 3 个 R8 用例全绿）。
