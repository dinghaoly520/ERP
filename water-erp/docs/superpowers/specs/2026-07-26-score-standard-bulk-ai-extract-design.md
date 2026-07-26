# 评分标准编制：模板按钮合并 + 一键 AI 提取得分点

- 日期：2026-07-26
- 范围：采购管理工作台 :3005 `/projects` → 项目详情「评分标准编制」面板（`ScoreStandardPanel` / `ScoreStandardEditor`）
- 状态：设计已确认，待实施

## 1. 背景与目标

`score-standard-editor.tsx` 工具栏现有两个模板入口：

- **应用标准模板** —— 直接调用 `POST /bid/projects/:id/score-items/template`（`applyScoreItemTemplate`，幂等），应用系统内置默认模板；
- **模板库** —— 打开 `TemplateLibraryDialog`，列出已保存模板（自己 + 公共），按名称合并应用 / 删除。

两者都是"把模板套到当前项目"，拆成两个按钮增加认知成本。同时，得分点的 AI 提取目前只有**单项入口**（每个评分项展开行里的「AI 提取建议」，`POST /bid/projects/:id/score-items/:itemId/points/extract`），初次编制时要逐项展开、逐项点、逐项审核，操作繁琐。

**目标：**

1. 两个模板按钮合并为一个入口「应用模板」，内置标准模板作为弹窗内的置顶项；
2. 工具栏新增「AI 提取」按钮，一次性提取当前项目**所有**评分项的得分点建议，分组审核后批量导入。

## 2. UI 变更

### 2.1 工具栏（`score-standard-editor.tsx`）

合并后按钮顺序（左 → 右，沿用 `flex justify-end` 现状）：

```
存为模板 ｜ 应用模板 ｜ AI 提取 ｜ 发布评分标准 ｜ 新增评分项
```

- **删除**「应用标准模板」按钮及其 `handleApplyTemplate`（逻辑迁至弹窗内）；
- **「模板库」改名「应用模板」**，图标（`FileSpreadsheet`）、样式不变；
- **新增「AI 提取」**：`Sparkles` 图标，与现有次级按钮同款白底蓝边样式；仅 `!locked` 时渲染（与发布 / 新增同级条件）。提取进行中按钮显示「提取中…」并 disabled。

### 2.2 模板弹窗（`template-library-dialog.tsx`）

- 标题保持「评分模板库」；
- 列表**顶部固定一行**「标准评分模板」：
  - 徽章「系统内置」（与「我的」/「公共」同位置同样式，中性灰）；
  - 副标题：`系统默认 · 资格审查/响应性/商务/技术/价格五类标准项`；
  - 「应用」按钮 → 调现有 `applyScoreTemplate(projectId)`（`POST .../score-items/template`），成功后 toast「已应用标准评分模板」、`onChanged(updated)`、关闭弹窗；
  - 无删除按钮（内置模板不可删）；
  - `locked` 时同样禁用「应用」。
- 其余已保存模板行（应用合并 / 删除）逻辑完全不变。

### 2.3 一键 AI 提取弹窗（新文件 `bulk-extract-review-dialog.tsx`）

提取成功且有建议时打开：

- 标题：`AI 提取得分点建议（来自招标文件）· N 项 / M 个评分项`；
- 顶部一行全局操作：全选 / 取消全选、已选计数；
- **按评分项分组**（组顺序 = 评分项表格顺序）：
  - 组头：类别 badge（复用 `CATEGORY_LABEL`/`CATEGORY_COLOR`）+ 评分项名称 + `大类满分 X` + 本组全选开关；
  - 组内建议行与现有单项审核弹窗**同款 UI**（见 §3.3 抽出的 `SuggestionRow`）：勾选框 / 可改名 / 可调分 / 客观主观切换 / 置信度 ●●● / 「可能重复」标记 / `adjusted` ⚠️ 提示 / 证据章节与要点；
- 底部：`已选 X/N 项 · K 项疑似重复` + 「取消」「导入选中的 X 项」；
- 默认勾选规则与单项流程一致：按 confidence 降序排列、`duplicate` 项默认不选。

## 3. 后端变更

### 3.1 新端点（`bid.controller.ts`）

```
POST /bid/projects/:id/score-items/points/extract-all
→ ScorePointSuggestionGroup[]
```

与单项 `extract` 同控制器、同鉴权（现有全局 guard，无需 `@Roles`），无 DTO。

### 3.2 `ScorePointExtractorService.extractAllScorePoints(projectId)`

```ts
async extractAllScorePoints(projectId: string): Promise<ScorePointSuggestionGroup[]>
```

行为：

1. 查出该项目全部 `bidScoreItem`（含 `points`，按 `order`/创建序，与列表端点一致）；若为空 → 返回 `[]`；
2. **预取招标文件文本一次**：直接调用同类内现有的私有方法 `this.getTenderText(projectId)`（无需改方法本身）；未就绪 → 抛 `BadRequestException({ error: '招标文件未就绪（未发布招标公告或无招标文件）', code: 'TENDER_NOT_READY' })`，与单项提取文案/错误码一致。预取写入 1 分钟 `tenderTextCache`，后续逐项 `extractScorePoints` 零成本命中缓存。
3. **顺序遍历** `category !== 'PRICE'` 的评分项，逐项调用**现有** `extractScorePoints(projectId, item.id)` 提取逻辑（PRICE 由报价公式计算，与单项行为一致跳过）；
   - 顺序执行的理由：LLM 调用已有全局信号量 `LLM_MAX_CONCURRENCY`，单项耗时约 5–15s，典型 5 项总时长可控；避免新引入并发 bug；
   - 单项 LLM 失败时现有逻辑已返回 `[]`（E6 降级），整批不中断。注意：单项内部的 `TENDER_NOT_READY` 不会触发（文本已预取），`NOT_FOUND` 不会触发（项来自同查询）；
4. 组装返回 `[{ itemId, itemName, category, maxScore, suggestions }]`，**所有非 PRICE 项都返回**（含空建议），前端据此展示「X 项未提取到」；PRICE 项不出现在结果中。

### 3.3 共享类型（`packages/shared/src/types.ts`）

紧邻现有 `ScorePointSuggestion` 新增：

```ts
export interface ScorePointSuggestionGroup {
  itemId: string;
  itemName: string;
  category: ScoreCategory;
  maxScore: number;
  suggestions: ScorePointSuggestion[];
}
```

改后需 `pnpm --filter @water-erp/shared build`。

## 4. 前端变更

### 4.1 API 客户端（`apps/web/src/lib/api/bid.ts`）

```ts
export function extractAllScorePoints(bidProjectId: string, options?: RequestInit) {
  return api.post<ScorePointSuggestionGroup[]>(
    `/bid/projects/${bidProjectId}/score-items/points/extract-all`, {}, options);
}
```

（签名与现有 `extractScorePoints` 对齐，透传 `signal`。）

### 4.2 编辑器接线（`score-standard-editor.tsx`）

- 新状态：`bulkSuggestions: ScorePointSuggestionGroup[] | null`、`extractingAll: boolean`；
- `handleBulkExtract`：
  1. 前置校验：`items` 为空 → `toast.error('请先「应用模板」或手动新增评分项')` 返回；无可提取项（全部 PRICE）→ `toast.error('当前评分项均为价格项，无需 AI 提取')` 返回；
  2. `AbortController` 超时 **300s**；按钮进入「提取中…」；
  3. 成功：过滤 `suggestions.length === 0` 的组；全空 → `toast.info('AI 未提取到任何得分点建议')`，不弹窗；有结果 → 组内按 confidence 降序 + `duplicate` 默认不选（与单项一致）→ `setBulkSuggestions`；
  4. 错误处理与单项 `handleExtract` 同构：AbortError → 「AI 提取超时（300s）…」；`e.message` 回退（`TENDER_NOT_READY` 的服务端文案直接透传显示）。
- 渲染 `<BulkExtractReviewDialog open={!!bulkSuggestions} groups={...} locked={locked} onImport={handleBulkImport} onClose={...} />`；
- `handleBulkImport(groups)`：对每个有勾选项的组调 `batchCreateScorePoints(bpId, itemId, picked)`，`Promise.allSettled` 并行；成功后 `reloadItems()`（沿用现有刷新路径，同时触发 `onChanged`）；toast 汇总「已导入 X 项得分点（Y 个评分项）」，失败组单独 toast 错误，成功组保留。

### 4.3 共享 `SuggestionRow` 组件（新文件 `suggestion-row.tsx`，从 `score-points-editor.tsx` 抽出）

把 `score-points-editor.tsx` 现有审核弹窗中 ~40 行内联建议行 JSX 抽为组件：

```tsx
type SuggestionRowProps = {
  suggestion: ScorePointSuggestion & { selected: boolean };
  onToggle: () => void;
  onChange: (patch: Partial<ScorePointSuggestion>) => void;
};
```

- `score-points-editor.tsx` 的单项弹窗改为消费 `SuggestionRow`（行为零变化，作为重构验证基准）；
- `bulk-extract-review-dialog.tsx` 同样消费它。

**不改动**单项「AI 提取建议」按钮、单项提取流程及其弹窗的其余部分。

## 5. 边界与错误处理

| 场景 | 行为 |
|---|---|
| 已发布 / EVALUATING / ARCHIVED（`locked`） | 「AI 提取」按钮不渲染；弹窗内「导入」按钮隐藏（与现有单项弹窗一致） |
| 未发布招标公告 / 无招标文件 | 后端 `TENDER_NOT_READY` → 前端 toast「招标文件未就绪（未发布招标公告或无招标文件）」 |
| 无评分项 | 前端前置 toast，不发请求 |
| 全部 PRICE 项 | 前端前置 toast，不发请求 |
| LLM 整体不可用 | 各组 E6 降级为 `[]` → 全空 → toast「AI 未提取到任何得分点建议」 |
| 导入阶段部分组失败 | `allSettled`：成功组写入生效并刷新，失败组 toast 单独报错 |

## 6. 测试

**后端**（扩展 `score-point-extractor.service.spec.ts`，沿用现有 mock 手法——mock `LlmService`/`LlmOutputValidator`/`PrismaService` 等依赖）：

1. 跳过 PRICE 项（结果不含 PRICE 组）；
2. 多评分项聚合：逐项结果按 itemId 正确分组，空建议组保留；
3. 招标文件未就绪 → 抛 `TENDER_NOT_READY`；
4. 单项 LLM 失败（该项返回 `[]`）不中断整批，其余项正常返回；
5. 无评分项 → 返回 `[]`。

**前端**：无单测（LLM 依赖流程），走 :3005 手工验证清单：

- 模板弹窗顶部「标准评分模板」应用成功、locked 时禁用、与已保存模板并存；
- 空项目点「AI 提取」→ 前置提示；
- 有招标文件项目点「AI 提取」→ 分组弹窗、置信度/重复标记、全选/组选、改名调分后导入 → 表格刷新、得分点落库；
- 单项「AI 提取建议」流程回归（抽组件后无行为变化）。

## 7. 改动文件清单

| 侧 | 文件 | 动作 |
|---|---|---|
| api | `apps/api/src/bid/bid.controller.ts` | 新增 extract-all 路由 |
| api | `apps/api/src/bid/score-point-extractor.service.ts` | 新增 `extractAllScorePoints`（`getTenderText` 提为可先行调用） |
| api | `apps/api/src/bid/score-point-extractor.service.spec.ts` | 新增 5 个用例 |
| shared | `packages/shared/src/types.ts` | 新增 `ScorePointSuggestionGroup`（改后 build） |
| web | `apps/web/src/lib/api/bid.ts` | 新增 `extractAllScorePoints` |
| web | `.../score-standard/score-standard-editor.tsx` | 工具栏改造 + 批量提取接线 |
| web | `.../score-standard/template-library-dialog.tsx` | 顶部固定「标准评分模板」行 |
| web | `.../score-standard/score-points-editor.tsx` | 建议行抽为 `SuggestionRow`（行为不变） |
| web | `.../score-standard/suggestion-row.tsx` | 新组件 |
| web | `.../score-standard/bulk-extract-review-dialog.tsx` | 新组件 |

## 8. 非目标与已知注意点

- **不做**流式进度（单项约 5–15s、典型 5 项约 1 分钟内完成，按钮「提取中…」足以反馈）；
- **不改**单项提取端点与审核流程；
- **不改**模板应用的后端语义（标准模板幂等、已保存模板按名合并）；
- 生产反代 read timeout（常见 60s）可能在评分项多 + 招标文件大时截断单次长请求——与现有单项提取同类特性，本次不处理；如出现，运维侧调高 `/api` 的 proxy timeout 即可；
- **实测（2026-07-26）**：:3005 Next.js dev 代理对上游请求 **30s 硬截断**（直连 :4001 正常），英雄项目级大文件全量提取约 68s 会经代理失败。开发环境演示大文件项目时直连 API 或换小文件项目；生产由 nginx 承载，调其 proxy timeout 即可；
- `OPERATION_LOG` 全局拦截器会自动记录新端点，无需额外配置（提取为低频操作，不需加入排除名单）。
