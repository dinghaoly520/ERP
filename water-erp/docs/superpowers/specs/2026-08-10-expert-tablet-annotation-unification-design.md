# 专家打分平板：批注与备忘统一改造

> **日期**：2026-08-10
> **范围**：expert-portal 平板端打分页 + PointChecklistScoring 共享组件 + MemoPanel 共享组件 + ExpertMemoService 后端 + :3005 EvaluationBlock 管理端只读查看
> **监督端（:3007）不在本次范围**

---

## 1. 背景与问题

当前平板打分页存在两套独立的"批注"机制：

| | 得分点行内批注 (`note`) | 专家备忘 (`ExpertMemo`) |
|---|---|---|
| **位置** | `PointChecklistScoring` 内每行右侧 MessageSquare 图标 → 展开 textarea | 右侧 `MemoPanel`（手写画布 + 键盘） |
| **存储** | `pointDecisions[].note`（随评分 payload 提交） | 独立表 `ExpertMemo`，含 `scorePointId` 关联、ink PNG、文本 |
| **记录栏** | 无历史 | 有历史列表（已按 `scorePointId` 过滤） |

专家实际使用时需要在两个入口之间切换，心智负担重。且管理员/领导在 :3005 评分矩阵中完全看不到专家的批注内容。

## 2. 目标

1. **统一批注入口**：移除得分点行内 textarea，手写/键盘均走 MemoPanel，笔迹直接存为 ExpertMemo（不 OCR）
2. **选中闸门**：未选中得分点时 MemoPanel 禁用输入
3. **批注角标**：得分点行 MessageSquare 图标加角标显示该点批注数量
4. **多条记录**：移除 upsert 逻辑，同得分点允许多条批注，历史栏可调出修改或删除
5. **管理端可见**：:3005 EvaluationBlock 评分矩阵展开行可查看专家批注（文本 + 笔迹原图）

## 3. 数据模型

### 3.1 无 schema 变更

`ExpertMemo` 模型现有字段完全满足需求：

```
model ExpertMemo {
  id           String   @id @default(cuid())
  expertId     String
  projectId    String
  supplierId   String?
  scoreItemId  String?
  scorePointId String?
  contentText  String?     // 键盘输入的文本
  inkFileId    String?     // 手写笔迹 PNG → FileAsset
  sourceDevice String?
  createdAt    DateTime
  updatedAt    DateTime
}
```

### 3.2 存储位置

| 输入方式 | 数据库 | 对象存储 |
|---------|--------|---------|
| 手写笔迹 | `ExpertMemo.inkFileId` → `FileAsset`（`category='expert_memo_ink'`） | MinIO `expert-memo/{projectId}/{expertId}/{timestamp}.png` |
| 键盘输入 | `ExpertMemo.contentText` | — |

### 3.3 多条记录语义

移除现有 upsert 逻辑（`doSave` 中"先删旧 ink 再建新的"和 switch effect 中的同类逻辑）。每次保存直接 `createMemo`，同得分点可累积多条批注记录。历史栏按 `createdAt DESC` 排列，点击一条可载入编辑区修改后另存为新记录，也可单独删除。

> **`pointDecisions[].note` 字段**：前端不再渲染行内 textarea，该字段在评分提交时仍可携带（兼容已提交数据），但新批注不再写入它——批注的 source of truth 是 `ExpertMemo` 表。

## 4. 后端 API 变更

### 4.1 专家端（expert-portal）— 改现有端点

| 端点 | 变更 |
|------|------|
| `POST /expert/projects/:projectId/memos` | **移除 upsert 语义**：`ExpertMemoService.createMemo` 不再在创建前查询/删除旧 ink。每次调用直接 `prisma.expertMemo.create` |
| `GET /expert/projects/:projectId/memos` | 不变（已支持 `scorePointId` 过滤） |
| `DELETE /expert/projects/:projectId/memos/:memoId` | 不变 |
| `GET /expert/projects/:projectId/memos/:memoId/ink` | 不变 |

**具体改动文件**：

- `apps/api/src/expert/expert-memo.service.ts` — `createMemo` 方法移除 upsert 相关代码
- OCR 逻辑保留（不删除）——只是前端不再依赖 OCR 结果；后端仍会在 OCR 可用时自动识别文本写入 `contentText`，作为辅助检索文本

### 4.2 管理端（:3005）— 新增只读端点

在 `ExpertAdminController`（`@Controller('expert-admin')`，`@Roles('admin','bid_host','leader','staff')`）中新增：

```
GET /expert-admin/projects/:projectId/memos
  ?expertId=<bidExpertId>
  &supplierId=<bidSupplierId>
  &scorePointId=<bidScorePointId>
```

- **Service**：`ExpertMemoService` 新增 `getMemosForAdmin(projectId, filters?)` 方法——不校验"当前用户是该专家"，改为校验"当前用户是 leader/staff/admin/bid_host"（由 controller `@Roles` 保证）
- **返回**：ExpertMemo 数组（含 `contentText`、`inkFileId`、`createdAt`、`sourceDevice`，不含 ink 二进制）

```
GET /expert-admin/projects/:projectId/memos/:memoId/ink
```

- 返回该 memo 笔迹 PNG 的 MinIO 预签名 URL
- Service：`ExpertMemoService.getInkUrlForAdmin(projectId, memoId)`——校验 memo 属于该 project

### 4.3 端点权限矩阵

| 端点 | 角色 |
|------|------|
| `GET/POST/DELETE /expert/projects/:projectId/memos/*` | `bid_expert`（仅本人） |
| `GET /expert-admin/projects/:projectId/memos` | `admin`, `bid_host`, `leader`, `staff` |
| `GET /expert-admin/projects/:projectId/memos/:memoId/ink` | `admin`, `bid_host`, `leader`, `staff` |

## 5. 前端变更

### 5.1 PointChecklistScoring（共享组件）

**文件**：`apps/expert-portal/src/components/evaluate/point-checklist-scoring.tsx`

改动：
- **移除**：inline textarea、`openIds` state、`noteRefs`、note 展开/折叠逻辑、`noteExpanded` 变量
- **MessageSquare 图标**改为只读状态角标：
  - 新增 prop：`pointMemoCounts?: Record<string, number>`（pointId → 批注数）
  - 无批注（count=0 或 undefined）：灰色 `MessageSquarePlus`，无角标
  - 有 N 条批注：主题色 `MessageSquare`，右上角绝对定位角标显示数字 N
  - 图标不再是 button——改为 `<span>` 或 `<div>`，点击不再展开 textarea（点击行仍触发 `onPointClick`）
- `hideNotes` prop 语义变为"隐藏角标"（调用方不传 `pointMemoCounts` 即等同隐藏）

### 5.2 MemoPanel（共享组件）

**文件**：`apps/expert-portal/src/components/memo/memo-panel.tsx`

改动：
- **无 scorePointId 时禁用输入**：
  - 手写模式：画布覆盖半透明遮罩 + 居中提示「← 请先选择左侧得分点」
  - 键盘模式：textarea `disabled` + 同样提示
  - 工具栏按钮全部 disabled
  - 保存按钮 disabled
- **移除 upsert 逻辑**（配合后端 4.1）：
  - `doSave`：移除"先删旧 ink"逻辑，直接 `createMemo`
  - switch effect（`[scorePointId, supplierId]` 依赖）：移除"捕获旧墨迹→删除旧→保存"逻辑，简化为"清屏→恢复新得分点墨迹"。首次进入无墨迹恢复时画布为空
  - `inkCache` 保留用于画布切换时的矢量恢复（全屏切换、得分点切换），但不再触发 API 删除
- **历史栏标题**：当有 `scorePointName` 时显示「{scorePointName} · 批注记录」
- **历史栏调出编辑**：
  - 手写记录：点击历史项 → `getMemoInkUrl` → `restoreBlob` 载入画布 → 专家可修改后点保存（创建新记录）
  - 键盘记录：点击历史项 → 文本回填 textarea → 修改后保存（创建新记录）
  - 不改变现有删除按钮行为
- **新增回调**：`onMemoCountChange?: (pointId: string, count: number) => void`——memos 列表加载/增删后回调，供父组件更新角标数据

### 5.3 平板打分页（tablet evaluate page）

**文件**：`apps/expert-portal/src/app/(tablet)/tablet/evaluate/[id]/page.tsx`

改动：
- 新增 state：`pointMemoCounts: Record<string, number>`
- 传入 `pointMemoCounts` 到所有 `<PointChecklistScoring>` 实例
- MemoPanel 接收 `onMemoCountChange` 回调，更新 `pointMemoCounts`
- 初始加载时批量拉取当前供应商所有得分点的 memo 计数（调一次 `listMemos(projectId, supplierId)` 不传 scorePointId，客户端 reduce 计数）

### 5.4 :3005 EvaluationBlock（管理端只读查看）

**文件**：`apps/web/src/components/projects/bid-confirm/evaluation-block.tsx`

改动：
- 评分矩阵展开行（专家×供应商单元格明细，`cell.items` 渲染处）：每个评分项旁加 MessageSquare 图标
  - 有批注：主题色 + 角标数字，点击弹出该专家在该得分点的批注列表
  - 无批注：灰色，不可点击
- **批注弹窗**（轻量 modal / popover）：
  - 调用 `GET /expert-admin/projects/:projectId/memos?expertId=...&supplierId=...&scorePointId=...`
  - 文本批注：直接展示 `contentText`
  - 笔迹批注：调用 `GET .../memos/:memoId/ink` 获取预签名 URL，`<img>` 展示
  - 每条显示 `createdAt` + `sourceDevice` 标签
- **API client**：`apps/web/src/lib/api/bid.ts` 新增 `listExpertMemosForAdmin` + `getExpertMemoInkUrlForAdmin` 函数

### 5.5 PointChecklistScoring 桌面端兼容

`PointChecklistScoring` 被 `verify-score-step.tsx`（桌面端评估页）和平板端同时使用。改造后：
- 桌面端不传 `pointMemoCounts` → 角标不显示（`undefined` → 视为 0 → 灰色图标），行为退化为纯状态指示
- 桌面端如果后续也要接入批注，只需传 `pointMemoCounts` 即可，无需再改组件

## 6. 数据流

### 6.1 专家创建批注

```
专家选中得分点 (activePointId)
  → MemoPanel 启用输入
  → 手写/键盘 → 点保存
  → POST /expert/projects/:projectId/memos { scorePointId, inkBlob | contentText }
  → ExpertMemo.create（无 upsert）
  → load() 刷新历史列表
  → onMemoCountChange(pointId, newCount) → 父组件更新角标
```

### 6.2 专家查看/编辑/删除历史批注

```
历史栏显示该得分点的 ExpertMemo 列表
  → 点击一条 → 载入编辑区（笔迹 restoreBlob / 文本回填）
  → 修改 → 保存 → 创建新 ExpertMemo 记录
  → 或点击删除 → DELETE /expert/projects/:projectId/memos/:memoId
```

### 6.3 管理员查看批注

```
:3005 EvaluationBlock 评分矩阵 → 展开专家×供应商单元格
  → 评分项旁 MessageSquare 角标（需加载 memo 计数）
  → 点击 → GET /expert-admin/projects/:projectId/memos?expertId&supplierId&scorePointId
  → 弹窗展示文本 + 笔迹图片（GET .../ink → 预签名 URL）
```

## 7. 边界情况

| 场景 | 处理 |
|------|------|
| 专家切换供应商 | 画布清屏（保留 inkCache 用于切回恢复），新供应商得分点 memo 列表重新加载 |
| 专家切换得分点 | 同上，旧得分点的未保存墨迹不自动保存（避免误存）——专家需手动点保存 |
| 无得分点的评分项（`itemPoints.length === 0`） | 该项无法选中得分点 → MemoPanel 禁用（无 scorePointId）。这是正确的——只有有得分点的评分项才支持批注 |
| 网络断开时保存 | toast 报错，墨迹留在画布上不丢失 |
| 管理员查看时专家正在修改 | 管理端看到的是已保存的记录，实时性由手动刷新保证（不需 WS） |
| scoreLocked（报告已确认） | MemoPanel 禁用输入（与现有评分禁用一致），历史栏只读 |

## 8. 实现顺序

1. **后端**：ExpertMemoService 移除 upsert + 新增 admin 只读方法 + ExpertAdminController 新增端点
2. **PointChecklistScoring**：移除 inline textarea + 加角标
3. **MemoPanel**：禁用闸门 + 移除 upsert + 历史调出 + onMemoCountChange 回调
4. **tablet evaluate page**：pointMemoCounts 状态 + 传参接线
5. **:3005 EvaluationBlock**：API client + 批注角标 + 弹窗
6. **桌面端 verify-score-step**：验证不传 pointMemoCounts 时无回归

## 9. 不做的事

- ❌ 不做 OCR 文本同步（笔迹本身就是批注）
- ❌ 不改 `pointDecisions[].note` 的提交结构（兼容已有数据）
- ❌ 不做监督端（:3007）批注查看
- ❌ 不做批注的 WS 实时推送（管理端手动刷新即可）
- ❌ 不做 Prisma migration（无 schema 变更）
