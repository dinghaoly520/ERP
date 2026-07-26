# Wave 4b 修复报告 — 双端前端健壮性

- 分支：`feat/bid-opening-hall-impl`
- 日期：2026-07-25
- 范围：清单 `docs/superpowers/audit/2026-07-24-iteration1-audit-fixlist.md` 的 R3/R4/R9/R10/U2/U3/U4/U5/U6/U8/U9/U11 + 评审附带 M9
- 对接 Wave 4a 后端形状：`POST /opening-hall/:projectId/read` 支持 `{ roomKey, lastMessageId? }`；`resolveOpeningDispute` 400 `DISPUTE_NOT_PENDING`；唱标重录 409 `RECORD_LOCKED`

## 改动点

### R3 — 重连后 REST 补齐（双端）

- **supplier `ChatPanel.vue`**：消费 composable 返回的 `connection`（原未消费）；新增 `hydrate()`（双聊天历史 + 未读 + 当前 tab 即时 markRead），`onMounted` 与 `watch(connection)`（回 `connected` 且 `hydrated` 为真）共用；既有按 id 合并保留在途增量（`src/components/bid/ChatPanel.vue:67-83`）。
- **host `exchange-drawer.tsx`**：抽出 `hydrate()`（公聊历史/未读/花名册 + 已选中供应商的私聊，带 openPrivate 同款陈旧响应守卫）；effect `[open, projectId, connection, hydrate]`：首次 open 立即执行（`hydratedRef`），其后仅 connection 回 `connected` 时重跑；关闭抽屉时 `hydratedRef` 复位（`src/components/bid/exchange-drawer.tsx:69-121`）。

### R4 — stage:change 关闭聊天输入（双端）

- **ChatPanel.vue**：handlers 增 `onStageChange`（`d.to !== 'OPENING'` → `stageClosed = true`），`canSend` 叠加 `!stageClosed`，`controlHint` 优先显示「开标阶段已结束，互动已关闭」（`:18,23,25,45`）。
- **exchange-drawer.tsx**：同构 `stageClosed` state + `onStageChange` handler；`inputDisabled` 叠加；输入区上方 amber 提示条（`:32,42-44,190-191,288`）。

### R9 — handlers 真 ref（双端）

- **React `use-bid-websocket.ts`**：`on()` helper 改按 `key: keyof BidWsHandlers` 注册，listener 内**每次事件**取 `handlersRef.current[key]?.(d)`（原实现在连接建立时快照 `h.current.onX` 的值，后续渲染换上的 handler 永不生效）；`handlersRef.current = handlers` 每渲染更新保持不变（`src/hooks/use-bid-websocket.ts:126-145`）。
- **Vue `useBidWebSocket.ts`**：一次性捕获改 holder 间接层 `const holder = { current: handlers }`，listener 内 `holder.current[key]?.(d)`；返回值增 `setHandlers(h)` 供组件每渲染替换（现有调用方无需改动）（`src/composables/useBidWebSocket.ts:49-51,104-116,155-158`）。

### R10 — 断线指示（双端）

- **ChatPanel.vue**：tab 行右侧连接态徽标——connected 绿「实时已连」/ reconnecting 橙「重连中…」/ disconnected 红「已断开」+「重连」按钮（调 composable 的 `reconnectNow`）（`:134-139,162-167`）。
- **exchange-drawer.tsx**：header 标题旁同款徽标 + 重连按钮（`:192-197,221-230`）。

### U2 — 默认 PUBLIC tab 即时 markRead（双端）

- **ChatPanel.vue**：`hydrate()` 完成后按当前 tab 即时 markRead 并清未读（默认 PUBLIC → `publicUnread = 0`）；`switchTab` 的 markRead 同步上报列表末条 id（`:69-93`）。
- **exchange-drawer.tsx**：`hydrate()` 末尾对当前 tab markRead（游标 = REST 页末条 id）；未读响应处理在 PUBLIC tab 时直接清零；PUBLIC tab 点击与 `openPrivate` 的 markRead 均改报末条 id（`:100-113,154,255`）。
- 两端 API 客户端 `markRead` 增可选 `lastMessageId`（`supplier-portal/src/api/openingHall.ts:19-21`、`bid-portal/src/lib/opening-hall.ts:30-31`），命中时后端以其 createdAt 定游标，未命中回退 now()。

### U3 — .mine 判 senderId（supplier 端）

- **ChatPanel.vue**：新增 prop `userId: string`；气泡判定 `m.senderId === userId` 取代 `senderRole === 'SUPPLIER'`（公聊里其他供应商消息不再渲染成己方）；`Msg` 类型与两处映射（WS payload / REST items）补 `senderId`（`:8,12,40,54,145`）。
- **OpeningHall.vue**：传入 `:user-id="authStore.user?.id ?? ''"`。来源核实：消息 `senderId = actor.userId`（`opening-hall.service.ts:83`），即 `User.id`——取 `useAuthStore().user.id`（`/auth/me` select `id`，router 守卫进页前已 `init()`）；`supplierApi.getProfile()` 返回的 `id` 是 `Supplier.id`，不匹配（`OpeningHall.vue:9-10,13,170-171`）。

### U4 — MyBids 入口收敛

- `canConfirmOpening` 收紧为**仅 OPENING**（原放行 OPENING/EVALUATING/ARCHIVED → 进大厅只有灰字死胡同）；新增 `overdueUnconfirmed`（stage 序 > OPENING 且 confirmStatus 非空非 CONFIRMED）显示只读灰字「逾期未确认」（`MyBids.vue:64-76,249-257,506`）。
- 字段取值核实：行上 `confirmStatus` 富化自 `BidSupplier.confirmStatus`，枚举 `CONFIRMED/PENDING/EXCEPTION/DISPUTED`（schema.prisma:100-105；supplier-portal.service.ts:755-770），种子仅见 CONFIRMED/PENDING。

### U5 — 双层弹窗收口（supplier 端）

axios 拦截器（`api/index.ts:35-41`）已对 400/403/5xx 弹 `data.error`，删除组件层重复错误弹窗（catch 块保留状态复位/静默 cancel）：

- `ChatPanel.vue` send catch（原 `:79`，删 `ElMessage.error`，连带移除文件内唯一 ElMessage import）。
- `OpeningHall.vue` checkIn / confirmRecord / disputeRecord catch（`:78-82,92-97,109-113`；success toast 与 MessageBox cancel/close 静默保留）。
- `BidDetail.vue` 书面交流 postQuestion / postReply catch（`:58,62`）。
- 范围外保留（均非本项清单）：OpeningHall 首屏/profile 错误提示、BidDetail `doPay`/`doDownload` 的 `e?.message` toast（招标文件区块，可作后续收口）。

### U6 — BidDetail 附件边界

- `:on-exceed` → `ElMessage.warning('仅支持 1 个附件')`（`BidDetail.vue:219`）。
- `http-request` 抽为 `handleAttachUpload`：失败 → `ElMessage.error` + 清 `attachAssetId` + re-throw（el-upload 自身将文件标红）（`:63-75,217`）。
- 新增 `attachUploading` 标志，上传中提交按钮 disabled，防裸提交丢附件（`:56,213`）。

### U8 — drawer 随 projectId 重置

- `useEffect([projectId])`：清 activeSupplier（含同步 ref）、双聊天消息、sessions、publicUnread、tab 回 PUBLIC、checkins、roster、stageClosed、input（`exchange-drawer.tsx:123-136`；规格清单外补 `setRoster([])`/`setStageClosed(false)`/`setInput('')`，防跨项目残留与 R4 状态串档）。projectId 现态来源为 `useBidProjectContext()`（页面层 ?id= 重构后透传 prop）。

### U9 — alert → toast

- exchange-drawer 两处 `alert(e?.message)`（send / changeControl catch）改 `toast.error(e?.message || '操作失败')`，`import { toast } from 'sonner'`（页面级 Toaster 已挂载于 app/layout.tsx）（`:3,171,183`）。

### U11 — CLOSED 时 host 输入禁用

- `inputDisabled` 叠加 `control === 'CLOSED'`，提示「主持人已关闭互动」；MUTED 不影响 host 发言（不禁用）；发送按钮 disabled 同步联动（`exchange-drawer.tsx:190-191,288-299`）。

### M9 — resolve 错误处理（评审附带）

- `open/page.tsx handleResolveDispute`：try/catch + `disputeSubmitting` 态锁（双按钮 disabled + 文案「处理中…」）；`err.code === 'DISPUTE_NOT_PENDING'` → toast「该异议已被处理」，其余 `err.message || '处理异议失败'`；失败时面板不收起、按钮解锁（`:153,239-256,753,756`）。
- 唱标重录同链处理：`handleEnterRecord` catch 对 `e.code === 'RECORD_LOCKED'` → toast「该开标记录已锁定，无法重录」（`:323-328`）。

## 验证

| 项 | 命令 | 结果 |
|---|---|---|
| supplier-portal 构建 | `pnpm --filter supplier-portal build` | ✓ vite build 干净（710ms） |
| supplier-portal 类型 | `pnpm exec tsc --noEmit`（该 app 无 vue-tsc） | ✓ 仅存量 tsconfig `baseUrl` 弃用警告（TS5101，与本波无关） |
| bid-portal 类型 | `pnpm --filter bid-portal exec tsc --noEmit` | ✓ 基线 0 错 → 改后 0 错（exit 0） |
| 后端回归 | `pnpm --filter api test:e2e -- opening-hall` | ✓ 23/23 passed（本波不改后端） |

## 待手工验收（无法浏览器验证的效果项）

1. 连接徽标视觉：双端绿/橙/红三态切换观感；断开时「重连」按钮可用（自动重连退避中多呈「重连中…」，纯 disconnected 窗口短）。
2. 重连补齐观感：断网→恢复后双端历史/未读/花名册无重复、无丢失（按 id 合并）。
3. stage:change 离开 OPENING 后双端输入区提示与禁用；host 侧 control=CLOSED 提示。
4. U3 气泡：公聊中本司与他司供应商消息的左右/底色区分（需两家供应商账号同场）。
5. U4：EVALUATING/ARCHIVED 且未确认行显示「逾期未确认」灰字（当前种子未覆盖该组合，需手工造数据或改阶段验证）。
6. U6：超限第二附件警告、失败标红、上传中提交禁用。
7. M9：对已处理异议双击/并发提交时 toast「该异议已被处理」且面板保留。

## 遗留（范围外，供后续波次参考）

- `BidDetail.vue` 的 `doPay`/`doDownload` catch 仍有 `e?.message` toast，与拦截器重复（招标文件区块，U5 清单仅列书面提交）。
