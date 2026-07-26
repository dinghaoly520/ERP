# Wave 5 打磨波修复报告（在线开标大厅 迭代一）

日期：2026-07-25 · 分支：feat/bid-opening-hall-impl · 共 6 项 Minor

## 1. 供应商端确认/异议 API 状态门（完整性缺口）

**问题**：`confirmOpening`/`disputeOpening` 无条件 `updateMany`——UI 已门控但直调 API 可把「异议已处理-退回」（bidSupplier=EXCEPTION）翻回 CONFIRMED/供应商已确认让例外供应商逃脱，DISPUTED 也可被 confirm 覆盖。与 host 侧 R7/I1 不对称。

**改动**：
- `apps/api/src/supplier-portal/supplier-portal.service.ts:850-858`（confirmOpening）：`decryptStatus` 校验之后、事务之前查记录，非待确认态 → 400 `RECORD_NOT_CONFIRMABLE`（「不可确认」文案）
- `apps/api/src/supplier-portal/supplier-portal.service.ts:894-902`（disputeOpening）：bidSupplier 校验之后、事务之前同款门 → 400 `RECORD_NOT_DISPUTABLE`（「不可异议」文案）。异议处理退回后不可再异议（R7 闭环一致，再异议走线下/书面渠道）
- **待确认态接受双值**：`['待供应商确认', '待确认']`——「待确认」为旧值（种子/历史数据，E2E beforeAll 与 R7 用例均用旧值），供应商端 UI 两者都接受（OpeningHall.vue:158 注释），host 侧 I1 重录门同样两者放行

**RED→GREEN**（`supplier-portal.service.spec.ts:473-519` 新增 9 例）：
- RED：8 例失败（「Received promise resolved instead of rejected」——confirm 4 态 + 记录不存在 + dispute 3 态全部放行）
- GREEN：36/36 通过。覆盖：「异议已处理-退回」/「供应商已确认」/「供应商提出异议」/「异议已处理-确认」四态 confirm → 400；记录不存在 → 400；dispute 三锁定态 → 400；旧值「待确认」happy path 放行；既有 happy path 补 `bidOpeningRecord.findFirst` mock 后保持绿

**E2E 联动修正**（门控引入的预期行为变化，非缺陷）：
- `apps/api/test/opening-hall.e2e-spec.ts:441-450`：异议用例依赖旧的「已确认可翻回异议」行为——前例已 confirm sup1 记录后直调 opening-dispute 撞新门 400。修正为用例开头将 sup1 记录复位「待确认」（含 objectionReason/confirmedAt 置空）构造真实异议路径

## 2. I1 409 文案修正

**问题**：「如唱标数据确有错误，先处理异议再操作」误导主持人以为 resolve 后可重录（resolve 两结局均终态，重录永久锁定）。

**改动**：`apps/api/src/bid/bid.service.ts:1133` → `开标记录处于「${existing.confirmStatus}」状态，不得重录唱标；请通过异议处理结果（维持/退回）完成闭环`

**RED→GREEN**（`bid.service.spec.ts:1488-1496`）：既有 it.each 4 例加 `error: expect.stringContaining('请通过异议处理结果（维持/退回）完成闭环')` 断言 → RED 4 失败（旧文案不匹配）→ 改文案后 GREEN，bid.service.spec 151/151 通过。

## 3. lastMessageId @MaxLength(64)

**改动**：`apps/api/src/opening-hall/dto/mark-read.dto.ts:13` 加 `@MaxLength(64)`（消息 id 为 cuid ≤32 字符，防超大串浪费一次 findFirst）。

**RED→GREEN**（opening-hall.e2e-spec.ts Wave5-4 用例末段）：临时移除装饰器 → 65 字符 lastMessageId 得 201（RED：「expected 400, got 201」）；恢复装饰器 → 400（GREEN）。

## 4. E2E 真库 markRead 用例（固化 @updatedAt 承重点）

**改动**：`apps/api/test/opening-hall.e2e-spec.ts:288-338` 新增用例「Wave5-4 真库：markRead lastMessageId 游标定位 + 单调不回退（M3）+ @updatedAt 不覆盖显式值」：
1. 复位 sup1 公聊游标 → host 发 3 条公聊（间隔 15ms 避同毫秒，未读计数为 createdAt 严格 gt）
2. `POST read { roomKey: 'public', lastMessageId: id2 }` → `GET unread` → public === 1（仅 id3）
3. 再上报更旧的 id1 → unread 仍 1（游标单调，Wave4a-M3）
4. DB 直读 OpeningHallReadCursor：`lastReadAt.getTime() === id2.createdAt.getTime()`——固化 `lastReadAt` 的 `@updatedAt` 不被 upsert update 分支 now() 覆盖（覆盖则 m3 误判已读、未读变 0）
5. 65 字符 lastMessageId → 400（Wave5-3 同用例覆盖）

**证据**：opening-hall E2E 24/24 通过（含本用例）。

## 5. 公聊 hydrate 窗口外语序修正（双端 + 私聊统一）

**问题**：hydrate 合并 `fresh = prev.filter(不在服务端页内)` 一律追加尾部 → 消息超 100 条重开抽屉/面板时窗口外旧残留被当在途增量追加到升序列表尾部，尾部乱序且永不消除。

**改动**（fresh 只保留比服务端窗口最新一条还新的本地消息，空窗口时保留全部）：
- `apps/supplier-portal/src/components/bid/ChatPanel.vue:54-58`——loadHistory 公/私聊共用合并处（一处覆盖双路径）
- `apps/bid-portal/src/components/bid/exchange-drawer.tsx:87-91`（hydrate 公聊）、`:114-117`（hydrate 私聊段）、`:174-177`（openPrivate）——三处统一同款 maxIso 过滤

**验证**：supplier-portal build ✓ / bid-portal `tsc --noEmit` 退出 0。逻辑修正，前端无单测设施，**待手工验收**（造 >100 条消息重开抽屉/面板观察尾部序）。

## 6. 抽屉 stageClosed 初值同步

**问题**：stageClosed 纯事件驱动 → 阶段已离 OPENING 后才开的抽屉初始仍可输入（首次发送撞 403）。

**改动**：
- `apps/bid-portal/src/components/bid/exchange-drawer.tsx:19` 增 prop `initialStageClosed?: boolean`；`:32-34` `useState(initialStageClosed ?? false)`；`:154-159` 新增只升不降同步 effect（`prev => prev || (initialStageClosed ?? false)`，deps `[initialStageClosed]`，声明在切项目复位 effect 之后保证同 commit 内复位先跑、同步后跑）；U8 切项目复位由 `setStageClosed(false)` 改为 `setStageClosed(initialStageClosed ?? false)`（:144）
- `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx:572-573` 传入 `initialStageClosed={project.stage !== 'OPENING'}`（已核实：页面 line 444 `if (!project) return` 保证此处 project 非空，stage 为 BidProjectDetail 顶层字段；project 加载完成前页面渲染骨架屏、抽屉尚未挂载，无 null 窗口）

**验证**：bid-portal `tsc --noEmit` 退出 0。**待手工验收**（选 EVALUATING/ARCHIVED 阶段项目开抽屉 → 输入框初始禁用 + 提示「开标阶段已结束」；OPENING 项目 → 可输入）。

## 验证汇总

| 项 | 结果 |
|----|------|
| `pnpm --filter api test`（全量） | 82 套件 893/893 通过 |
| `pnpm --filter api test:e2e -- opening-hall` | 24/24 通过（含新 Wave5-4 用例） |
| `pnpm --filter supplier-portal build` | ✓ built |
| `cd apps/bid-portal && npx tsc --noEmit` | 退出 0 |
| `pnpm --filter api build` | ✓（附加） |

**待手工验收**：第 5 项（>100 条消息重开抽屉尾部序）、第 6 项（非 OPENING 阶段开抽屉输入框初值）。
