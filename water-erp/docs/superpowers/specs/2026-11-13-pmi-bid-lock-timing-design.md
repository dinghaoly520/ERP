# 项目管理开标锁触发时机修正（到达页≠落锁，启动开标才落锁）— 设计

**日期**：2026-11-13
**状态**：已批准（用户裁定方案 A；延时开标不落锁——只有真正启动开标才锁）

## 1. 问题

:3005 项目管理详情面板的开标锁定判定与后端口径漂移：

- **前端** `project-detail-panel.tsx:479-498`：`isBidLocked`/`isLockedByBid` 以 PMI 阶段行
  `BID_EVALUATION` 的 status ∈ {IN_PROGRESS, COMPLETED} 为据——**步骤指针一推进到
  开标确认页（IN_PROGRESS）即落锁**，驱动 8 个消费点：前置步骤导航（:862/:1374）、
  步骤重开（:1404）、时间轴锁定（:1415）、附件上传（:907/:508 stageLocked）、
  基本信息编辑（:1023）、变更/补遗弹窗 `bidOpened`（:2448）。
- **后端四道闸全部锚定 BidProject 实际阶段**（OPENING/EVALUATING/ARCHIVED）：
  - `reopenStage` 开标锁（project-management.service.ts:3901-3921）
  - 变更/补遗标段分区闸 `bidOpened`（project-management/change.service.ts:50-55）
  - 补遗发布硬闸 `ADDENDUM_BID_STARTED`（announcement.service.ts）
  - `mine=true` 补遗选择器过滤（project-management.service.ts:337-352）

结果：到达开标确认页（尚未做开标决策）时，前端提前拦死前置步骤重开/附件/基本信息/
变更标前区——后端本会放行；且流标轮（bp ABORTED，后端明确穿闸可重开）被前端误锁。

## 2. 用户裁定（2026-11-13）

1. **落锁时机 = 真正启动开标**：开标确认面板点「按时开标」（`startOpening` →
   BidProject→OPENING）后才落锁。
2. **延时开标不落锁**：`延时开标` 仅 PATCH openTime 改时间（标尚未开），改完到新时刻
   再点「按时开标」时才落锁。延时后、真正开标前发现标前资料有误仍可走变更/补遗更正。
   （若要「点延时也立即锁」需新增持久状态落点并同步扩后端四道闸——已否决。）

## 3. 方案（A：前端换源，零后端改动）

### 3.1 锁判定换源

新增纯函数 helper `apps/web/src/lib/bid-lock.ts`（与 `change-fields.ts` 同级；
参数用结构类型 `Array<{ round: number; stage: string }>`，不 import api 模块，
node:test 直测）：

- `roundBidOpened(bpRefs, round)`：该轮 bp 存在且 stage ∈ {OPENING, EVALUATING, ARCHIVED}
  ——对齐后端 `reopenStage`（同轮 bp、ABORTED 不锁=流标轮穿闸）。
- `latestBidOpened(bpRefs)`：**最新非 ABORTED** bp 同判——对齐后端 `change.service`
  （变更弹窗/基本信息闸的布尔口径）。

`project-detail-panel.tsx` 改造：

- `isLockedByBid(stageKey, round?)`：锁布尔换 `roundBidOpened(bpRefs, targetRound)`；
  「前置」判定保留既有 stageOrder 比较（目标阶段序 < 该轮 BID_EVALUATION 行序）。
- `isBidLocked`：换 `latestBidOpened(bpRefs)`；删除 `bidEvalStage` 阶段行判式。
- 8 个消费点自动跟随；toast 文案不变（「开标已确认…」在真正开标后出现，语义仍准确——
  UI 改动字面最小）。

### 3.2 刷新链路

`BidConfirmPanel` 的 `onClose`（project-detail-panel.tsx:2635）追加
`setBpDataTick(t => t + 1)` + `handleUpdated()`：按时开标/延时开标/流标/归档等一切
面板内变更统一在关闭时回流。依据：面板是模态覆盖层，打开期间父层不可交互，「关闭即
刷新」已足够即时；延时开标后 PMI 开标时间同步值（后端 2026-11-10 一处修改全局统一）
也借此回流到 hero 时间轴。不加 BidConfirmPanel 新 props（精确回调无用户可见收益）。

## 4. 行为矩阵（修复后）

| 状态 | 前置步骤重开/附件/基本信息/变更标前区 | 变更标后区（定标/合同） |
|---|---|---|
| 到达开标确认页，bp 仍 DOWNLOAD/SUBMIT | **可编辑**（修复点） | 锁（POST_BID_LOCKED，前后端一致） |
| 点按时开标（→OPENING）后关闭面板 | 锁 | 解锁 |
| 延时开标后（未再点按时） | 不锁，仅时间回流 | 锁 |
| 该轮 bp ABORTED（流标未再采） | 不锁（后端 reopenStage 穿闸，前端此前误锁→修正） | 锁 |
| 无 bp（未发公告/未组织投标） | 不因开标锁 | 锁（后端 POST_BID_LOCKED 同口径，无回归） |

## 5. 边界与错误处理

- **bpRefs 拉取失败**：锁不提前（前端是提示性拦截；后端 409/400 硬闸兜底）——与同
  effect 既有「徽标/卡片数据尽力而为」口径一致。
- **多轮**：`isLockedByBid` 按目标条目自身轮取该轮 bp；旧轮本就由 `isPastRound` 只读，
  双闸叠加不冲突。
- **opening-field-config-card 等既有消费点**：已按 bp.stage 判定（正确口径），不动。
- **后端零改动**；spec/plan 外的既有闸门（change.service/reopenStage/ADDENDUM/
  mine 过滤）不动。

## 6. 测试

- `lib/bid-lock.test.ts`（node:test，纯函数穷举）：各 stage × 有/无 bp × 多轮（含
  最新非 ABORTED 跳过 ABORTED 轮）× round 未命中。
- 组件层无既有测试框架覆盖本面板（无 project-detail-panel.test），行为验收走手动主径：
  进开标确认页不锁 → 点按时开标 → 关闭面板 → 前置步骤/变更标前区锁、标后区解锁。
- 回归：`pnpm --filter web test` + `lint` + tsc（`pnpm --filter web build` 或既有
  check 链）。
