# Wave 3（UI 明显故障波）修复报告

- 清单：`docs/superpowers/audit/2026-07-24-iteration1-audit-fixlist.md` C2 / C3 / R1 / R2 / U1 / U7
- 分支：`feat/bid-opening-hall-impl`
- 范围：仅 4 个前端文件，未改后端。与并行工作线（Phase 3 对 `open/page.tsx` 的监督视图折叠重构）无冲突——改动点均在 `onOpeningConfirmed/Disputed` handler 内，未触碰其重构区域。

## 改动明细

### C2 — 抽屉 portal 化（不再被 backdrop-filter 祖先裁剪）
- `apps/bid-portal/src/components/bid/exchange-drawer.tsx:4`（`import { createPortal } from 'react-dom'`）、`:144`、`:217`
- `<aside className="fixed right-0 top-0 z-40 ...">` 改经 `createPortal(aside, document.body)` 渲染到 body 层，`fixed` 恢复相对视口定位，不再受 `SectionCard`（glass-card `backdrop-filter: blur(16px)` + `overflow-hidden p-0`）建立的包含块/裁剪影响。
- 触发按钮位置不动；抽屉仅在 `open`（客户端 state）为 true 时渲染，SSR 路径不触碰 `document`。
- 层级复核：抽屉 z-40 < 唱标录入模态 z-50（`open/page.tsx` recordEntry 模态），portal 化后两者均在 body 层，关系保持正确。

### C3 — 状态更新器纯化（未读角标不再双计）
- `exchange-drawer.tsx:37-39, 44-45`
- 删除 `setTab(cur => { if (cur !== 'PUBLIC') setPublicUnread(n => n + 1); return cur; })` 的不纯更新器；仿 `activeSupplierRef` 新增 `tabRef`（渲染期镜像），`onHallMessage` 的 PUBLIC 分支改读 `tabRef.current` 后在更新器外调用 `setPublicUnread(n => n + 1)`。StrictMode/并发双调更新器不再导致每条公聊 +2。
- 顺带按清单修 R2 公聊去重：socket PUBLIC 分支 `setPublicMsgs` 先按 id 查重再追加。

### R2 — drawer hydrate 按 id 合并（不再覆盖在途 socket 增量）
- `exchange-drawer.tsx:62-67`（公聊 hydrate）、`:80-93`（`openPrivate` 私聊）
- 公聊 hydrate：`setPublicMsgs(prev => [...r.items.map(toMsg), ...prev.filter(不在 r.items 中的本地增量)])`，与供应商端 `ChatPanel.vue:48-51` 已修模式一致。
- 私聊 hydrate：`privateMsgs` 在主持端是跨供应商共享的单一列表，直接套同款合并会把上一家供应商的消息泄漏进当前会话——故 `openPrivate` 内先**同步** `setPrivateMsgs([])`（同 tick 内无 socket 事件可插入，无竞态），hydrate 返回后再按 id 合并保留在途增量；请求失败时保留窗口内已到的 socket 消息（不再盲清空）。
- `openPrivate` 首行同步写 `activeSupplierRef.current = s.supplierId`（:81），消除点击到重渲染之间的旧值窗口。

### R1 — 确认/异议事件后刷新记录表
- `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx:376-387`
- `onOpeningConfirmed` / `onOpeningDisputed` 在 toast 之后补 `api.get<BidProjectDetail>(/bid/projects/:id).then(setProject).catch(() => {})`，与同页 `onStageChange` 的 refetch 模式一致（未用 `loadProject`——它会置 loading=true 触发整页骨架屏闪烁）。解密表"确认"列与开标记录确认状态 chip 随事件同步刷新；`.catch(() => {})` 避免网络抖动产生 unhandled rejection。

### U1 — 中文输入法 Enter 守卫（双端）
- 供应商端 `apps/supplier-portal/src/components/bid/ChatPanel.vue:85-88, 119`：`@keyup.enter="send"` → `@keyup.enter="onEnter"`；`onEnter` 内 `if (e.isComposing || e.keyCode === 229) return` 后发送。
- 主持端 `exchange-drawer.tsx:208`：`onKeyDown` 改为 `if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()`。

### U7 — 供应商大厅失败态 + 重试（OpeningHall.vue）
- `apps/supplier-portal/src/views/bid/OpeningHall.vue:23-26, 28-43, 45-67, 113-123, 124, 130-133, 168-172, 181`
  1. `refresh()` 包 try/catch：失败置 `loadError`/`loadErrorMsg`（保留上次成功数据）；首屏（`project` 为空）失败渲染 `el-empty` 错误态 + "重试"按钮。
  2. onMounted 加载逻辑抽成 `bootstrap()`（并行 `loadProfile` + `refresh` + `loadPresence`），挂载与重试共用。
  3. profile 失败单独 `profileError` 标志 → 聊天区 `el-empty`"会话加载失败"+ 单独重试（`retryProfile` 只重拉 profile），不影响左侧状态卡。
  4. socket handler（`onStageChange` / `onOpeningDisputeResolved`）的 refresh 调用补 `.catch(() => {})` 兜底（refresh 内部已不抛出，双保险防 unhandled rejection）。
  5. 错误提示用 ElMessage（与页面既有风格一致），错误态 UI 用 Element Plus `el-empty`；`.hall-error { grid-column: 1 / -1 }` 使错误态横贯两栏网格。

## 验证结果

| 项 | 命令 | 结果 |
|---|---|---|
| bid-portal 类型检查 | `pnpm --filter bid-portal exec tsc --noEmit` | 干净（改前基线即 0 错误，改后仍 0） |
| supplier-portal 构建 | `pnpm --filter supplier-portal build` | ✓ built，无告警 |
| e2e 回归 | `pnpm --filter api test:e2e -- opening-hall` | 20/20 passed（未改后端，确认无回归） |

## 待手工验收

- **C2 视觉效果**：页面下滚后打开"会场交流"抽屉，确认其相对视口右侧固定、不被卡片裁剪、不随卡片滚走；与唱标录入模态（z-50）同开时抽屉在下层。
- **U1 IME**：双端用中文输入法打字，候选词确认的 Enter 不发送消息；非组合态 Enter 正常发送。
- **U7 失败态**：断网/停 API 后刷新供应商大厅 → 错误态 + 重试按钮；恢复后点重试正常加载；profile 接口单独失败 → 仅聊天区错误态、左侧状态卡正常。
- **C3/R2**：停留私聊 tab 收到多条公聊，切回公聊核对未读计数（不再 ×2）；开抽屉瞬间有公聊到达，消息不丢失（无重复）。
- **R1**：供应商点"确认开标记录"/"提出异议"后，主持端解密表确认列与开标记录表即时变化（不再只有 toast）。
