# 专家打分平板：批注与备忘统一改造

> **日期**：2026-08-10（代码审核修订版）
> **范围**：expert-portal 平板端 + 桌面端打分页 + PointChecklistScoring 共享组件 + MemoPanel 共享组件 + ExpertMemoService 后端 + :3005 EvaluationBlock 管理端只读查看
> **监督端（:3007）不在本次范围**

---

## 1. 背景与问题

当前打分页存在两套独立的"批注"机制：

| | 得分点行内批注 (`note`) | 专家备忘 (`ExpertMemo`) |
|---|---|---|
| **位置** | `PointChecklistScoring` 内每行右侧 MessageSquare 图标 → 展开 textarea | `MemoPanel`（手写画布 + 键盘） |
| **存储** | `pointDecisions[].note`（随评分 payload 提交） | 独立表 `ExpertMemo`，含 `scorePointId` 关联、ink PNG、文本 |
| **记录栏** | 无历史 | 有历史列表（已按 `scorePointId` 过滤） |
| **桌面端 MemoPanel** | — | 抽屉式（`memoOpen` state），**不绑定 scorePointId**，仅项目/供应商级 |
| **平板端 MemoPanel** | — | 右侧常驻面板，绑定 `activePointId` |

专家实际使用时需要在两个入口之间切换，心智负担重。且管理员/领导在 :3005 评分矩阵中完全看不到专家的批注内容。

## 2. 目标

1. **统一批注入口**：移除得分点行内 textarea，手写/键盘均走 MemoPanel，笔迹直接存为 ExpertMemo（不 OCR）
2. **选中闸门（平板）**：平板端未选中得分点时 MemoPanel 禁用输入；桌面端不强制（抽屉式，可写项目级备忘）
3. **批注角标**：得分点行 MessageSquare 图标加角标显示该点批注数量
4. **多条记录**：移除 upsert 逻辑，同得分点允许多条批注，历史栏可调出修改或删除
5. **桌面端同步改造**：桌面端 PointChecklistScoring 也接入得分点选中 + MemoPanel 绑定
6. **管理端可见**：:3005 EvaluationBlock 评分矩阵展开行可查看专家批注（文本 + 笔迹原图）

## 3. 数据模型

### 3.1 无 schema 变更

`ExpertMemo` 模型现有字段完全满足需求：

```
model ExpertMemo {
  id           String   @id @default(cuid())
  expertId     String
  projectId    String
  supplierId   String?
  scoreItemId  String?     // ⚠️ 当前全部为 null（MemoPanel 声明了 prop 但从未传给 API）——本次修复
  scorePointId String?
  contentText  String?     // 键盘输入的文本 / OCR 辅助文本
  inkFileId    String?     // 手写笔迹 PNG → FileAsset
  sourceDevice String?
  createdAt    DateTime
  updatedAt    DateTime
}
```

### 3.2 `scoreItemId` 修复（代码审核发现）

**现状**：`MemoPanel` 的 Props 声明了 `scoreItemId?: string`（:20），但从未解构、从未传给 `createMemo` API。所有 ExpertMemo 的 `scoreItemId = null`。

**影响**：管理端 `BidProjectDetail.scoreItems` 只到 scoreItem 粒度（不含 points 子结构），无法按 scorePoint 聚合。必须通过 `scoreItemId` 过滤。

**修复**：
- 平板页 / 桌面页传 `scoreItemId` 给 MemoPanel（从包含当前 scorePoint 的 scoreItem 获取）
- MemoPanel 解构 `scoreItemId` 并传给 `createMemo` / `listMemos`

### 3.3 存储位置

| 输入方式 | 数据库 | 对象存储 |
|---------|--------|---------|
| 手写笔迹 | `ExpertMemo.inkFileId` → `FileAsset`（`category='expert_memo_ink'`） | MinIO `expert-memo/{projectId}/{expertId}/{timestamp}.png` |
| 键盘输入 | `ExpertMemo.contentText` | — |

### 3.4 多条记录语义

移除现有 upsert 逻辑。每次保存直接 `createMemo`，同得分点可累积多条批注记录。历史栏按 `createdAt DESC` 排列，点击一条可载入编辑区修改后另存为新记录，也可单独删除。

> **`pointDecisions[].note` 字段**：前端不再渲染行内 textarea，该字段在评分提交时仍可携带（兼容已提交数据），但新批注不再写入它——批注的 source of truth 是 `ExpertMemo` 表。

## 4. 后端 API 变更

### 4.1 专家端（expert-portal）— 改现有端点

| 端点 | 变更 |
|------|------|
| `POST /expert/projects/:projectId/memos` | **移除 upsert 语义**：`ExpertMemoService.createMemo` 不再在创建前查询/删除旧 ink。每次调用直接 `prisma.expertMemo.create` |
| `GET /expert/projects/:projectId/memos` | **新增 `scoreItemId` 过滤参数**（与 `scorePointId` 并存） |
| `DELETE /expert/projects/:projectId/memos/:memoId` | 不变 |
| `GET /expert/projects/:projectId/memos/:memoId/ink` | 不变 |

**具体改动文件**：

- `apps/api/src/expert/expert-memo.service.ts`：
  - `createMemo`：移除 upsert 相关代码
  - `getMemos`：`where` 子句新增 `...(scoreItemId ? { scoreItemId } : {})`
- `apps/api/src/expert/expert.controller.ts`：`listMemos` 新增 `@Query('scoreItemId')` 参数
- `apps/api/src/expert/dto/create-memo.dto.ts`：确认 `scoreItemId` 字段存在（应已有）
- OCR 逻辑保留——后端仍会在 OCR 可用时自动识别文本写入 `contentText`，作为辅助检索文本

### 4.2 管理端（:3005）— 新增只读端点

在 `ExpertAdminController`（`@Controller('expert-admin')`，`@Roles('admin','bid_host','leader','staff')`）中新增。

**注意**：该 controller 当前只注入 `ExpertAdminService`（:32），需额外注入 `ExpertMemoService`（同模块 provider，module 已 exports）。

**路由位置**：新增的 `@Get('projects/:projectId/memos')` 必须声明在 `@Get(':id')`（:225）**之前**——虽然多段路径 `projects/:projectId/memos`（3 段）不会匹配单段 `:id`，但遵循 NestJS 声明顺序最佳实践。

```
GET /expert-admin/projects/:projectId/memos
  ?expertId=<bidExpertId>     // BidExpert.id（BidProjectExpertInfo.id）
  &supplierId=<bidSupplierId>
  &scoreItemId=<bidScoreItemId>
```

- **Service**：`ExpertMemoService.getMemosForAdmin(projectId, filters?)`——不校验"当前用户是该专家"（controller `@Roles` 保证身份），按 projectId + 可选 expertId/supplierId/scoreItemId 过滤
- **返回**：ExpertMemo 数组（含 `contentText`、`inkFileId`、`scorePointId`、`createdAt`、`sourceDevice`，不含 ink 二进制）

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

**实际消费者**（代码审核确认）：

| 消费者 | 当前 `hideNotes` | 当前 `selectedPointId`/`onPointClick` | 改造后 |
|--------|------------------|---------------------------------------|--------|
| `(app)/evaluate/[id]/page.tsx`（桌面）×2 | ❌ 未传（textarea 活跃） | ❌ 未传 | 传 `selectedPointId`/`onPointClick`/`pointMemoCounts` |
| `(tablet)/tablet/evaluate/[id]/page.tsx`（平板）×2 | ❌ | ✅ 已传 | 加传 `pointMemoCounts` |
| `assist/requirement-compare-panel.tsx` ×1 | ✅ `hideNotes` | ❌ | 不受影响（`hideNotes` 隐藏一切） |

改动：
- **移除**：inline textarea、`openIds` state、`noteRefs`、note 展开/折叠逻辑、`noteExpanded` 变量
- **MessageSquare 图标**改为只读状态角标：
  - 新增 prop：`pointMemoCounts?: Record<string, number>`（pointId → 批注数）
  - 无批注（count=0 或 undefined）：灰色 `MessageSquarePlus`，无角标
  - 有 N 条批注：主题色 `MessageSquare`，右上角绝对定位角标显示数字 N
  - 图标不再是 button——改为 `<span>`，点击行仍触发 `onPointClick`
- `hideNotes` prop 行为不变：为 `true` 时完全不渲染图标区域（`requirement-compare-panel.tsx` 已传）

### 5.2 MemoPanel（共享组件）

**文件**：`apps/expert-portal/src/components/memo/memo-panel.tsx`

#### 5.2.1 新增 `requirePointSelection` prop（代码审核修正）

```typescript
interface MemoPanelProps {
  // ... 现有 props ...
  /** true=无 scorePointId 时禁用输入（平板）；false/省略=始终允许（桌面） */
  requirePointSelection?: boolean;
}
```

- **平板**：传 `requirePointSelection={true}` → 无 scorePointId 时画布/键盘/工具栏/保存全部 disabled + 半透明遮罩提示「← 请先选择左侧得分点」
- **桌面**：不传（默认 `false`）→ 即使无 scorePointId 也可输入（项目/供应商级备忘）

#### 5.2.2 移除 upsert 逻辑

- **`doSave`**（:239-286）：移除 :253-258 的"先删旧 ink"逻辑，直接 `createMemo`
- **switch effect**（:96-180）：移除**全部**捕获+auto-save 分支（:114-150），简化为：
  1. 清屏
  2. 恢复新得分点墨迹（inkCache 优先 → API 兜底）
  
  > 旧得分点的未保存墨迹不自动保存——专家需手动点保存（§7 边界情况）

- **`inkCache`**：保留用于画布切换时的矢量恢复（全屏切换、得分点切换），但不再在 switch effect 中写入（仅 `doSave` 成功后更新缓存）

#### 5.2.3 修复 `scoreItemId` 死代码

- 解构 `scoreItemId`（当前声明但未解构）
- `createMemo` 调用传入 `scoreItemId`
- `listMemos` 调用传入 `scoreItemId`（后端 :4.1 已新增过滤参数）

#### 5.2.4 历史栏调出编辑

- 手写记录：点击历史项 → `getMemoInkUrl` → `restoreBlob` 载入画布 → 修改后保存（创建新记录）
- 键盘记录：点击历史项 → 文本回填 textarea → 修改后保存（创建新记录）
- 历史栏标题：当有 `scorePointName` 时显示「{scorePointName} · 批注记录」
- 不改变现有删除按钮行为

#### 5.2.5 新增回调

```typescript
onMemoCountChange?: (pointId: string, count: number) => void;
```

`memos` 列表加载/增删后触发，供父组件更新角标数据。

### 5.3 平板打分页（tablet evaluate page）

**文件**：`apps/expert-portal/src/app/(tablet)/tablet/evaluate/[id]/page.tsx`

改动：
- 新增 state：`pointMemoCounts: Record<string, number>`
- 两个 `<PointChecklistScoring>` 实例加传 `pointMemoCounts`
- `<MemoPanel>` 加传 `requirePointSelection={true}` + `scoreItemId`（从包含 activePointId 的 scoreItem 获取） + `onMemoCountChange` 回调
- `handlePointClick` 增强为同时设置 `scoreItemId`（通过查找 `project.scoreItems` 找到包含该 point 的 item）
- 初始加载时批量拉取当前供应商所有 memo 计数（调一次 `listMemos(projectId, supplierId)` 不传 scorePointId，客户端 reduce 计数）

### 5.4 桌面打分页（desktop evaluate page）

**文件**：`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`

#### 5.4.1 新增得分点选中状态

```typescript
const [activePointId, setActivePointId] = useState<string | null>(null);
const [activePointName, setActivePointName] = useState<string>('');
const [activeScoreItemId, setActiveScoreItemId] = useState<string | null>(null); // 用于 MemoPanel
const [pointMemoCounts, setPointMemoCounts] = useState<Record<string, number>>({});
```

`handlePointClick(pointId, pointName)` → 设置以上状态 + 通过 `project.scoreItems` 查找 `scoreItemId`。

#### 5.4.2 PointChecklistScoring 接入

两个实例（:1629 pass-fail、:1686 scoring）加传：
```tsx
selectedPointId={activePointId}
onPointClick={handlePointClick}
pointMemoCounts={pointMemoCounts}
```

#### 5.4.3 MemoPanel 抽屉接入得分点绑定

```tsx
<MemoPanel
  projectId={projectId}
  supplierId={activeSupplier}
  scorePointId={activePointId ?? undefined}
  scorePointName={activePointName || undefined}
  scoreItemId={activeScoreItemId ?? undefined}
  sourceDevice="desktop"
  onMemoCountChange={(pid, count) => setPointMemoCounts(prev => ({ ...prev, [pid]: count }))}
/>
```

> **桌面 UX**：不强制要求先选得分点才能打开备忘抽屉（`requirePointSelection` 不传）。专家可以先开抽屉写项目级备忘，也可以先选得分点再开抽屉写批注。

#### 5.4.4 初始加载批量计数

与平板端一致：调 `listMemos(projectId, supplierId)` 不传 scorePointId，客户端 reduce 按 `scorePointId` 计数。

### 5.5 :3005 EvaluationBlock（管理端只读查看）

**文件**：`apps/web/src/components/projects/bid-confirm/evaluation-block.tsx`

**数据源限制**（代码审核确认）：`BidProjectDetail.scoreItems`（:511-517）只有 `{ id, name, category, maxScore, weight }`——不含 `points` 子结构。`BidProjectExpertInfo.scoreRecords`（:457-465）也只有 item 级 `{ scoreItemId, supplierId, score, passed, reason }`。因此管理端批注展示在 **scoreItem 级别**（非 scorePoint 级别）。

改动：
- 评分矩阵展开行（专家×供应商单元格明细，`cell.items` 渲染处 :514-523）：每个评分项旁加 MessageSquare 图标
  - 有批注：主题色 + 角标数字，点击弹出批注列表
  - 无批注：灰色，不可点击
- **批注计数加载**：展开单元格时调 `GET /expert-admin/projects/:projectId/memos?expertId=X&supplierId=Y`（不传 scoreItemId，一次拉全量），客户端按 `scoreItemId` reduce 计数
- **批注弹窗**（轻量 modal / popover）：
  - 点击某 scoreItem 的图标 → 从已加载的全量 memo 列表中按 `scoreItemId` 过滤展示
  - 文本批注：直接展示 `contentText`
  - 笔迹批注：调用 `GET .../memos/:memoId/ink` 获取预签名 URL，`<img>` 展示
  - 每条显示 `createdAt` + `sourceDevice` 标签
- **API client**：`apps/web/src/lib/api/bid.ts` 新增：
  - `listExpertMemosForAdmin(projectId, { expertId?, supplierId?, scoreItemId? })` → `GET /expert-admin/projects/:projectId/memos`
  - `getExpertMemoInkUrlForAdmin(projectId, memoId)` → `GET /expert-admin/projects/:projectId/memos/:memoId/ink`

> **历史数据**：本次改造前创建的 ExpertMemo `scoreItemId = null`，管理端按 scoreItemId 过滤时不会出现。这是可接受的——新数据会正确携带 scoreItemId。

### 5.6 API client（expert-portal）

**文件**：`apps/expert-portal/src/lib/api.ts`

- `listMemos`：新增可选参数 `scoreItemId`
- `createMemo`：确认 `scoreItemId` 已在 `data` 类型中（应已有），前端调用时传入

## 6. 数据流

### 6.1 专家创建批注（平板）

```
专家选中得分点 (activePointId)
  → handlePointClick 同时设置 activeScoreItemId（从 scoreItems 查找）
  → MemoPanel 启用输入（requirePointSelection=true + scorePointId 已设）
  → 手写/键盘 → 点保存
  → POST /expert/projects/:projectId/memos { scorePointId, scoreItemId, supplierId, inkBlob | contentText }
  → ExpertMemo.create（无 upsert）
  → load() 刷新历史列表
  → onMemoCountChange(pointId, newCount) → 父组件更新角标
```

### 6.2 专家创建批注（桌面）

```
专家选中得分点 (activePointId) → 设置 activeScoreItemId
  → 点「备忘」按钮打开抽屉
  → MemoPanel 显示（scorePointId/scoreItemId 已绑定）
  → 手写/键盘 → 保存（同上）
  → 或：不选得分点直接开抽屉 → 项目/供应商级备忘（scorePointId/scoreItemId = undefined）
```

### 6.3 专家查看/编辑/删除历史批注

```
历史栏显示该得分点的 ExpertMemo 列表
  → 点击一条 → 载入编辑区（笔迹 restoreBlob / 文本回填）
  → 修改 → 保存 → 创建新 ExpertMemo 记录
  → 或点击删除 → DELETE /expert/projects/:projectId/memos/:memoId
```

### 6.4 管理员查看批注

```
:3005 EvaluationBlock 评分矩阵 → 展开专家×供应商单元格
  → 加载该 expert+supplier 的全部 ExpertMemo（GET /expert-admin/...）
  → 客户端按 scoreItemId reduce → 每个 scoreItem 显示角标
  → 点击 scoreItem 的图标 → 过滤该 scoreItemId 的 memos → 弹窗展示
  → 文本直接展示；笔迹 GET .../ink → 预签名 URL → <img>
```

## 7. 边界情况

| 场景 | 处理 |
|------|------|
| 专家切换供应商 | 画布清屏（保留 inkCache 用于切回恢复），新供应商得分点 memo 列表 + 计数重新加载 |
| 专家切换得分点（平板） | 画布清屏 → 恢复新得分点墨迹。旧得分点的未保存墨迹**不自动保存**——专家需手动点保存 |
| 专家切换得分点（桌面） | 同上；如抽屉已开，MemoPanel 同步切换绑定 |
| 无得分点的评分项（`itemPoints.length === 0`） | 该项无 PointChecklistScoring → 不涉及得分点选中。MemoPanel 无 scorePointId → 平板禁用，桌面可用（项目级） |
| 桌面端抽屉未选得分点 | `requirePointSelection` 默认 false → 仍可输入（项目/供应商级备忘） |
| 网络断开时保存 | toast 报错，墨迹留在画布上不丢失 |
| 管理员查看时专家正在修改 | 管理端看到的是已保存的记录，实时性由手动刷新保证（不需 WS） |
| scoreLocked（报告已确认） | MemoPanel 禁用输入（与现有评分禁用一致），历史栏只读 |
| 历史 ExpertMemo 无 scoreItemId | 管理端按 scoreItemId 过滤时不显示。新数据会正确携带。专家端按 scorePointId 过滤不受影响（scorePointId 一直有值） |

## 8. 实现顺序

1. **后端**：ExpertMemoService 移除 upsert + `getMemos` 加 scoreItemId 过滤 + 新增 admin 只读方法 + ExpertAdminController 注入 ExpertMemoService + 新增端点
2. **expert-portal API client**：`listMemos` 加 scoreItemId 参数
3. **PointChecklistScoring**：移除 inline textarea + 加角标 prop
4. **MemoPanel**：`requirePointSelection` + 移除 upsert + switch effect 简化 + 修复 scoreItemId + 历史调出 + onMemoCountChange 回调
5. **平板 evaluate page**：pointMemoCounts + scoreItemId + requirePointSelection + 传参接线
6. **桌面 evaluate page**：activePointId/activeScoreItemId/pointMemoCounts 状态 + PointChecklistScoring 传参 + MemoPanel 抽屉传参
7. **:3005 EvaluationBlock**：API client + 批注角标 + 弹窗
8. **验证**：`requirement-compare-panel.tsx`（hideNotes 不受影响）；桌面端未选得分点时 MemoPanel 仍可用

## 9. 不做的事

- ❌ 不做 OCR 文本同步（笔迹本身就是批注）
- ❌ 不改 `pointDecisions[].note` 的提交结构（兼容已有数据）
- ❌ 不做监督端（:3007）批注查看
- ❌ 不做批注的 WS 实时推送（管理端手动刷新即可）
- ❌ 不做 Prisma migration（无 schema 变更）
- ❌ 不改 `verify-score-step.tsx`（不使用 PointChecklistScoring，有自己的只读渲染）
