# 定标文件制作功能完善设计（多轮采购闭环）

> 日期：2026-07-20
> 状态：设计待审
> 关联：定标「文件制作」（A-E 已实现）

## 背景

定标阶段「文件制作」功能（选择器 → 中标公告/中标通知书/流标公告 → 流标决策链 → 再次采购/归档）已实现 A-E 五批次，lint/类型干净。但审视发现：**E（再次采购）只做了"数据插入"，没做"UI 与流程闭环"**——再次采购后，时间线无法正确渲染、`currentStage` 不指向新一轮、`BidProject` 多轮共用。本设计补齐这三个关键 gap，使「再次采购」在 UI 与流程上完整可用。

## 已确认的决策

- **Gap 1（时间线）**：方案 A——按轮次分组，选中用 `(stageKey, round)` 组合。
- **Gap 2（currentStage）**：`reproc()` 末尾更新 `currentStage` + 新增 `currentRound` 指针。
- **Gap 3（BidProject）**：方案 A——`BidProject` 加 `projectManagementItemId` + `round`，`ensureBidProject(itemId, round)` 按轮找/建。
- **归档条件**：流标→否→归档时放宽（流标项目即使合同未完成也允许归档）。

## Schema 改动

| 模型 | 字段 | 说明 |
|---|---|---|
| `BidProject` | `+ projectManagementItemId String?` | 反向关联到 ProjectManagementItem（一对多） |
| `BidProject` | `+ round Int @default(1)` | 所属采购轮次 |
| `ProjectManagementItem` | `+ currentRound Int @default(1)` | 当前进行中的轮次 |

`ProjectManagementItem.bidProjectId`（单数，已存在）保留作为 round1 兜底，不再用于多轮查找。

## 详细设计

### 1. 时间线多轮分组（Gap 1）

**`ProjectStageTimeline`**：
- `TimelineEntry` 加 `round: number`。
- `onSelect` 签名改为 `onSelect(stageKey, round)`；`isSelected = entry.stageKey === activeStageKey && entry.round === activeRound`。
- 渲染：按 `round` 分组**采购阶段**（round=1、round=2…），每组前插入「第 N 轮」分隔标签（round=1 标签可省略）。合同阶段（`CONTRACT`）**不论 round 一律作为单独末组**（其 stageOrder 最大，自然排在所有采购轮之后）。
- `ProjectManagementStage.round`（已存在）为数据源。

**`project-detail-panel.tsx`**：
- `selectedStageKey` 状态扩展为 `(key, round)`，或新增 `selectedRound`。
- `isCurrentStage = stage.stageKey === currentStage && stage.round === currentRound`。

### 2. currentStage 指向新一轮（Gap 2）

**`reproc()`（后端）**：
- 插入新一轮阶段后，`update ProjectManagementItem.currentStage = 新一轮首阶段 stageKey + currentRound = newRound`。
- 新一轮首阶段：`REPROC_STAGE_SEGMENTS[method][0].key`（如邀请招标 = `TENDER_DOCUMENT`，直接采购 = `PUBLIC_ANNOUNCEMENT`）。

**前端**：`onUpdated()` 刷新后，`item.currentStage / currentRound` 已是新轮首个阶段，时间线自动聚焦。

### 3. 多轮 BidProject（Gap 3）

**`ensureBidProject(itemId, round?)`（后端）**：
- `round` 缺省时取 `item.currentRound`（当前轮）。
- 查找：`bidProject.findFirst({ where: { projectManagementItemId: itemId, round } })`。
- 找到 → 返回。
- 找不到 → 按 `item` 信息创建（`round` = 指定值，`projectManagementItemId` = itemId），返回。
- 不再依赖 `item.bidProjectId`（单数）。

**`GET /project-management/:id/bid-project?round=N`**（controller）：加 `round` query 参数，透传 `ensureBidProject`。

**`reproc()`**：**不**主动建 BidProject（懒创建）。新一轮用户首次点「开标确认」时，按当前 stage.round（=newRound）触发 `ensureBidProject(itemId, newRound)` 创建。

**前端 `BID_EVALUATION` onStageAction**：传当前 stage 的 `round` → `ensureBidProject(itemId, round)`。

**`bid-confirm-panel.tsx`**：加 `round` prop（由 `project-detail-panel` 从当前选中 stage 的 round 传入），`ensureBidProject(project.id, round)`。

### 4. 流标归档放宽

**现状**：前端 `canArchive = archiveStepState === 'READY'`（依赖合同阶段完成）；后端 `completeProjectManagementItem` 可能校验阶段完成。

**放宽**：流标→否→归档链路（`AwardFileMaker` 的 `onArchive`）绕过"合同完成"校验：
- `AwardFileMaker.onArchive` 由 `project-detail-panel` 提供，已直接调 `confirmArchive`（不经 `canArchive` 按钮）。
- 后端：若 `completeProjectManagementItem` 校验"所有阶段完成"，新增 `allowIncomplete?: boolean` 参数（流标归档传 true 跳过校验），或新增专用 `archiveOnFailure(itemId)` 端点。
- 实施时先确认 `completeProjectManagementItem` 的校验逻辑，再决定参数 vs 新端点。

## 次要 gap（本轮处理方式）

| 项 | 处理 |
|---|---|
| 中标通知书/公告 docx 上传到 AWARD_DECISION 阶段 | **不做**（YAGNI；公告 wizard 已上传到 PUBLIC_ANNOUNCEMENT；中标通知书导出已下载到本地） |
| 中标公告发布后自动推进到 CONTRACT | **不自动**（保持手动完成阶段，与现有流程一致） |

## 非目标

- 不改 AnnouncementPublishWizard 的 docx 上传目标阶段（保持 PUBLIC_ANNOUNCEMENT）。
- 不做多轮的"轮次对比/回溯"视图（仅按序展示）。
- 不改 NotificationLetterDialog 的导出逻辑。

## 涉及文件（预估）

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | BidProject + 2 字段；ProjectManagementItem + currentRound |
| `project-management.service.ts` | `ensureBidProject(itemId, round)`；`reproc()` 更新 currentStage/currentRound |
| `project-management.controller.ts` | `GET /:id/bid-project?round=` 加 query |
| `project-stage-timeline.tsx` | entry + round；onSelect/isSelected 双键；按轮分组渲染 |
| `project-detail-panel.tsx` | selectedStage 双键；isCurrentStage 加 round；BID_EVALUATION onStageAction 传 round；AwardFileMaker onArchive 流标归档 |
| `bid-confirm-panel.tsx` | 加 `round` prop；`ensureBidProject(project.id, round)` |
| `lib/api/bid.ts` | `ensureBidProject(projectItemId, round?)` 签名 |

## 验证

- `pnpm --filter web exec eslint` + `tsc --noEmit`：新改动文件零错误。
- `pnpm --filter api exec tsc --noEmit`：后端零错误。
- 视觉：流标→再次采购后，时间线显示两轮分组，currentStage 聚焦新一轮首阶段；新一轮开标确认用新 BidProject（供应商/专家为空）。
- 视觉：流标→否→归档，项目归档成功（不被合同完成校验挡）。
