# :3007 评标管理「AI 辅助评标进度」卡片（含补救操作）设计

日期：2026-08-06
状态：已确认（用户批准）
范围：`apps/api`（bid 模块）+ `apps/bid-portal`（评标管理 tab）

## 背景与动机

项目确认开标、解密完成并由 :3005「启动评标」后，`AiBidAnalysisTask` 与各 `AiBidderResult`
入队由独立 worker 进程（`pnpm --filter api dev:worker:ai-bid-analysis`）推进。
:3007 开标任务板/项目工作区是开标评标进行时实际盯盘的界面，但评标管理 tab
（`/bid/project/[id]?tab=evaluate`）没有任何 AI 分析进度可见性；分析卡住或失败时，
盯盘人无从知晓，更无法就地补救。

本任务在评标管理 tab 顶部新增一行「AI 辅助评标」进度卡片，展示进度与异常，
并提供就地补救操作（重试失败项 / 全量重新分析）。

### 关键现状事实（代码实证）

1. AI 入队仅两处：`bid.service.ts` 的 `startEvaluation`（:3005 启动评标时）与
   `rerunAiAnalysis`；解密端点不触发 AI。AI 分析以解密成功为前置
   （`assertOpeningDone` 守卫 + 仅对 `decryptStatus: 'SUCCESS'` 供应商建 bidderResult）。
2. 主 API 无 `ai-bid-analysis` controller；:3005 的 `/bid-analysis` 页面无导航入口且
   所有数据端点 404（历史断链，不在本任务范围）。
3. `POST /bid/projects/:id/rerun-ai-analysis` 已存在（全量重跑），但无 @Roles 守卫
   且前端无调用点。
4. worker 是独立进程、无 WebSocket gateway → 前端刷新只能轮询。
5. `BidService` 目前仅注入 `tenderQueue`（bid.module.ts 仅注册 TENDER_PROCESSING）。
6. :3007 总则为"纯开标执行终端、评标只读、流转归 :3005"。本任务的写操作（重跑 AI）
   **不改阶段、不流转**，作为有意的窄例外；「启动评标迁移至 :3007」为后续独立任务。

## 需求

- 在 `EvaluationView`（`components/workspace/evaluation-view.tsx`）现有四个 KPI 卡
  （评分进度/专家签到/报告确认/可生成结果）**之上**新增独立一行 AI 进度卡片。
- 展示：整体进度（完成家数/总数 + 百分比环）、任务状态、异常明细（失败/卡住家名）。
- 补救操作（仅异常时显示按钮）：
  - 「重试失败项」：重置并重入队 FAILED / 中间态卡住的 bidder（支持批量）；
  - 「重新分析」：全量重跑（复用现有 rerun 端点），带二次确认（会清空已完成结果）。
- 异常判定由后端完成，前端只渲染。

## 架构

```
:3007 EvaluationView（评标管理 tab，只读 + 本卡片例外）
  └─ AiAnalysisCard（新组件，独立一行置顶）
       ├─ GET  /bid/projects/:id/ai-analysis-progress   ← 新端点（3s 轮询）
       ├─ POST /bid/projects/:id/retry-ai-bidders        ← 新端点（批量重试）
       └─ POST /bid/projects/:id/rerun-ai-analysis       ← 现有端点（补角色守卫）
```

不碰：阶段流转、:3005 断链、worker 进程、现有四个 KPI 卡、WebSocket 架构。

## 后端设计（apps/api）

### 1. GET /bid/projects/:id/ai-analysis-progress（新）

`bid.controller.ts` + `bid.service.ts`。聚合 `AiBidAnalysisTask`（projectId 唯一）+
`AiBidderResult`（join BidSupplier 取名称），异常判定在后端：

```ts
{
  exists: boolean;               // 无 task → false（前端显示"待启动评标"）
  taskStatus: AiAnalysisTaskStatus | null;
  updatedAt: string | null;
  total: number; completed: number; failed: number;
  bidders: [{ id, bidSupplierId, name, status, updatedAt }];
  anomaly: {
    hasAnomaly: boolean;
    failedNames: string[];       // bidder FAILED
    stuckNames: string[];        // 中间态（非 PENDING/COMPLETED/FAILED）停摆 > STUCK_THRESHOLD
    taskFailed: boolean;         // task = FAILED（招标文件处理失败）
    allPending: boolean;         // task+全部 bidder PENDING 停摆 → 疑似 worker 未运行
  }
}
```

- `STUCK_THRESHOLD_MS = 30 * 60 * 1000`（常量；单家 OCR+LLM 约 5-15 分钟，30 分钟安全）。
  判定基于 `updatedAt`（Prisma `@updatedAt` 自动维护）。
- `allPending`：task 存在且 `task.status ∈ {PENDING, TENDER_PROCESSING}` 且
  `updatedAt` 停摆超阈值且无 bidder 进入过中间态/终态。
- 权限：无 @Roles（与评标管理 tab 只读定位一致，任何已登录用户可看）。
- **运维要求**：端点路径加入 `operation-log/operation-log.filter.ts` 高频轮询排除列表
  （GET-only），否则 3s 轮询刷爆 OperationLog。

### 2. POST /bid/projects/:id/retry-ai-bidders（新）

Body：`{ bidderResultIds?: string[] }`；不传 = 重试全部 FAILED + 卡住家。

前置校验（任一不满足 → 400/409）：
- project.stage === 'EVALUATING'
- task 存在且 status ∈ {ANALYZING, COMPLETED_WITH_ERRORS}
- 每个目标 bidder：status ∈ {FAILED} ∪ {中间态且 updatedAt 停摆超阈值}

动作（事务）：
1. 目标 bidder 重置 status → PENDING、processedAt → null；
2. task.status → ANALYZING、completedAt → null（使 worker 收尾逻辑重新生成报告并复位终态）；
3. 每个目标 bidder 入队 bidder job：`bidderQueue.add('process', { bidderResultId }, { jobId: `bidderResult-retry-<id>-<Date.now()>`, attempts: 3, backoff: exponential 5s, removeOnComplete/... })`；
4. 写 `bidSupervisionLog`（重试 AI 分析：家数/名单）+ `auditLog`。

需要：`bid.module.ts` 增注册 `QUEUE_NAMES.BIDDER_PROCESSING`；`BidService` 构造注入
`@InjectQueue(QUEUE_NAMES.BIDDER_PROCESSING) bidderQueue?`（可选注入，与 tenderQueue 同风格）。

worker 无需改动：bidder.processor 按 bidderResultId 处理，收尾 `checkAllTerminal`
全部终态后重新生成报告并置 task 为 COMPLETED/COMPLETED_WITH_ERRORS。

### 3. 权限补齐

- 新 retry 端点与现有 rerun 端点均加 `@Roles('admin', 'bid_host', 'leader', 'staff')`
  （:3007 登录者为 admin/bid_host；rerun 目前无任何角色限制，属安全缺口，顺手补齐）。

## 前端设计（apps/bid-portal）

### 1. 新组件 `components/workspace/ai-analysis-card.tsx`

Props：`projectId: string; stage: BidStage`。

数据获取与轮询：
- 挂载即拉一次 progress；task 处于非终态（或 exists=false 但 stage=EVALUATING）时每 3s 轮询；
- 停止条件：task COMPLETED 且无异常；stage ∉ {OPENING, EVALUATING}（ARCHIVED/ABORTED 静态展示最后一次结果）；
- 组件卸载清除 interval。不依赖 WebSocket（worker 无 gateway）。

状态 → 渲染：

| 状态 | 渲染 |
|------|------|
| exists=false（未启动） | 灰色静态行：「启动评标后自动开始 AI 辅助分析」（OPENING）/「评标已启动，等待分析任务创建」（EVALUATING 短窗） |
| 进行中 | 左：RingChart 迷你环（百分比=completed/total）+「AI辅助评标 N/M家」+ 任务状态文案（招标文件处理中/逐家分析中） |
| 已完成无异常 | 绿色：「AI 辅助评标完成（M/M）」 |
| 有 FAILED | 警示区块列出失败家名 + [重试失败项] + [重新分析] |
| 有卡住 | 警示区块列出卡住家名 + [重试失败项] + [重新分析] |
| allPending | 橙色提示「分析未启动——请确认 AI 分析 worker 进程已运行；worker 恢复后队列将自动消费」+ [重新分析]（强制重新入队整条流水线；PENDING 家不属于可重试对象，不提供「重试失败项」） |
| taskFailed | 红色：「招标文件处理失败」+ [重新分析] |

- 「重新分析」按钮带二次确认（confirm 对话框：将清空全部已完成分析结果并重跑）。
- 操作成功后立即 refetch 进度。
- 视觉：cgzxui 规范——`neu-card-static` 容器、oklch 色板、与 evaluation-view 现有
  kpi-card 同族（tabular-nums 数字、10px 大写小标题、警示色用现有
  `oklch(0.64_0.16_82)`/`var(--danger)`/`oklch(0.54_0.16_158)` 绿）。

### 2. EvaluationView 集成

- `evaluation-view.tsx`：在 `dashMetrics` 四卡 grid 之前渲染
  `<AiAnalysisCard projectId={projectId} stage={project.stage} />`；
- `lib/api/bid.ts` 增 `getAiAnalysisProgress(projectId)`、`retryAiBidders(projectId, ids?)`、
  `rerunAiAnalysis(projectId)` 三个函数（复用现有 api helper）。

## 测试

- 后端单元测试（bid.service 相关新方法）：
  - 进度聚合：无 task / 全 PENDING / 部分完成 / 部分 FAILED / 卡住 / allPending 各分支的 anomaly 判定；
  - retry：stage 非 EVALUATING 拒绝、task 状态拒绝、目标 bidder 状态拒绝、正常路径入队参数。
- 前端：tsc 编译通过（bid-portal 无既有测试基建则不新增框架）；组件按状态分支人工核对。
- 手动验收：真实项目 `cmqhero-bid-proj01`（EVALUATING 阶段）查看卡片各状态。

## 明确不做（YAGNI / 边界）

- 「启动评标 + AI 入队」迁移至 :3007 → 后续独立任务；
- 修复 :3005 `/bid-analysis` 断链 → 不做；
- worker 健康探测（queue 水位）→ 不做（allPending 文案提示已覆盖主要价值）；
- WebSocket 实时推送 AI 进度 → 不做（worker 架构限制）。

## 风险与对策

| 风险 | 对策 |
|------|------|
| 3s 轮询刷爆操作日志 | filter 排除列表（GET-only）|
| 重试与 worker 并发竞争 | jobId 带时间戳；worker 按状态幂等处理；重试前置校验排除正在正常推进的家 |
| rerun/retry 误触 | 仅异常态显示按钮 + rerun 二次确认 + 角色守卫 |
| STUCK 阈值误报（超长标书） | 30 分钟已留余量；阈值集中为常量便于调整 |
