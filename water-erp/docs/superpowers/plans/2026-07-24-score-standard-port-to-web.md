# 评分标准编制功能前置到采购管理工作台（:3005 /projects）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把开评标管理端（:3007）`/bid/project/[id]?tab=standard` 的评分标准编制功能（评分项 CRUD、得分点编辑 + AI 提取审核、模板库、发布锁定）移植到采购管理工作台（:3005）`/projects` 页面：从项目详情面板「采购文件」阶段时间线入口打开完整编辑器，同时用同一组件替换「开标评标 → 开标确认」面板内的简化版编辑器；:3007 原页面改为只读。

**Architecture:** 纯前端移植，**后端零改动**。:3005 的 `ensureBidProject(projectItemId, round)` 已按轮懒创建/关联 `BidProject`（`GET /api/project-management/:id/bid-project`），评分标准 16 个端点（`/api/bid/projects/:id/score-items*`、`/api/bid/score-templates*`）的类级 `@Roles('admin','bid_host','leader','staff')` 已覆盖 :3005 的实际用户（leader/staff/admin——bid_host 进不了 /projects，已 live 验证 403）。移植产物为自包含组件 `ScoreStandardEditor`（props 驱动，内部自解析 bidProject），两种挂载形态：`standalone`（全屏 overlay，采购文件阶段入口）与 `embedded`（嵌进开标确认面板区块4）。锁定语义（`scoreStandardPublishedAt` + stage）由后端单点保证，两端编辑同一份数据天然一致。

**Tech Stack:** Next.js 16 App Router (React 19, Turbopack)、Tailwind v4 + cgzxui 拟物设计系统（globals.css 的 `workbench-table`/`workbench-input`/`neu-btn-*`/`wb-panel`）、sonner toast、`@water-erp/shared`（`CATEGORY_LABEL`/`CATEGORY_COLOR`/`STAGE_LABEL`/`isPassFailCategory`/`ScorePointSuggestion`）、apps/web 共享 `api` 封装（`X-Portal: web` + `token_web` cookie）。

## Global Constraints

- **后端不改一行**：RBAC、锁定、校验、审计（`BidSupervisionLog` + 监督端 WS 推送）全部沿用。`logScoreStdOp` 审计 display role 硬编码「开标主持人」是已知 cosmetic 问题，不在本次范围。
- **`procurement_staff` 角色问题不在范围内**：种子账号「陈源远/procurement_staff」既不在 `AuthRole` 联合类型、也不在任何 `@Roles` 中，且 live 验证登录 :3005 时按 `PORTAL_ROLE_PRIORITY.web` 实际解析为 `bid_host`（`/project-management` 403）。:3005 的实际可用账号是 `Swhi-CGZX-*` 系列的 leader/staff。本次移植不为 procurement_staff 开口子（它连 /projects 都进不去）。
- **分支策略（与开标大厅功能并行开发）**：当前 `feat/bid-opening-hall-impl` 分支正在同步开发开标大厅/指挥中心（Phase 2 已提交 `b9d03512`，工作区另有 `bid/page.tsx` WIP）。本迁移**依赖** Phase 2 产物（`getBidProjectDetail`、指挥中心版 `bid-confirm-panel`），因此**从 `feat/bid-opening-hall-impl` 当前 HEAD 拉新分支** `feat/score-standard-port-to-web`，并在**独立 worktree** 中执行（`git worktree add ../water-erp-score-standard feat/score-standard-port-to-web`），避免与主工作区的并行会话互相踩踏（对方 `git add -A` 会卷入未提交改动）。合流方向：先合开标大厅分支入 main，本分支 rebase 后合入；或直接合回开标大厅分支。两分支的冲突面仅 `lib/api/bid.ts` 与 `bid-confirm-panel.tsx` 两文件的不同区域（见风险 #8）。遵守 memory「commit 前必查分支」「不要主动 push」。
- **commit 不 push**（memory「不要主动 push」）：每个任务 commit 后仅提醒「有 N 个未推送 commit」。
- **设计规范**（`water-erp/.impeccable.md`）：cgzxui 拟物体系——`neu-btn-*` 按钮、`wb-panel` 卡片、`workbench-table`/`workbench-input`；禁止渐变按钮、emoji 当图标、Material 阴影。移植组件保留 bid-portal 源文件的品牌十六进制色按钮（`#064ea2` 系，与体系兼容），表格/输入框走全局 `workbench-*` 类。
- **apps/web 无前端测试基建**：验证 = `pnpm --filter web lint`（eslint）+ `pnpm --filter web exec tsc --noEmit` + 手工端到端清单（Task 8）。后端评分标准链路已有完整单测/E2E（`bid.service.spec.ts:1082-1248`、`test/bid.e2e-spec.ts`），不受影响。
- **:3007 只读**：`bid/standard/page.tsx` 加 `readOnly` 开关，隐藏全部写操作入口，保留展示与展开查看得分点；两个模板弹窗随按钮隐藏而不可达。
- 中文 UI 文案保持与源文件一致（含标点风格）。

---

## 背景与关键事实（探索结论，2026-07-24 验证）

**源头（bid-portal :3007）**— `apps/bid-portal/src/app/(dashboard)/bid/standard/`：
- `page.tsx`（427 行，`BidStandardPage`）：锁定横幅 + 评分项表格（行内增改删、按行展开得分点）+ 发布/应用标准模板/新增三按钮 + 模板库入口。依赖 `useBidProjectContext`、`@/components/dialog`（glass-card 弹窗）、`@/components/skeleton`、`@water-erp/ui` 的 `SectionCard`。
- `score-points-editor.tsx`（277 行）：得分点 CRUD + 客观/主观切换 + AI 提取（120s AbortController）+ 置信度排序/重复标记的建议审核浮层 + 批量导入。**只依赖 lucide/sonner/`@/lib/api/bid`，天然可移植**。
- `save-template-dialog.tsx`（76）、`template-library-dialog.tsx`（163）。
- API 封装 `apps/bid-portal/src/lib/api/bid.ts`：16 个函数 + 本地类型 `ScoreItem`/`ScorePoint`/`ScoreTemplateSummary`；`ScorePointSuggestion` 在 `@water-erp/shared`（`packages/shared/src/types.ts:136`）。

**目标（web :3005）**— `/projects` → `apps/web/src/components/projects/project-management-page.tsx` → 卡片列表 + `project-detail-panel.tsx`（1665 行，9 阶段时间线）：
- 阶段：`PROCUREMENT_DEMAND → INITIATION → TENDER_DOCUMENT → SUPPLIER_INVITATION → PUBLIC_ANNOUNCEMENT → EXPERT_SELECTION → BID_EVALUATION → AWARD_DECISION → CONTRACT`（`lib/types/project-management.ts:68`）。
- 时间线每阶段一个动作按钮（`project-stage-timeline.tsx:59-69` `STAGE_ACTION_LABELS`）；`TENDER_DOCUMENT` 已有**第二个按钮的先例**（`onEditTenderFile`，:256-282）。
- `BID_EVALUATION` 动作 → `bid-confirm-panel.tsx`（**Phase 2 后 1072 行**全屏 overlay，`z-[500]`，已升级为「开评标指挥中心」：`detail` 状态 + `useBidWebSocket` 增量刷新 + 区块5-8 开标进度/评标/澄清/归档四区块，均按 stage 自决渲染），其**区块4（:647-886）已有一个简化版评分标准编辑器**（项/点 CRUD + 模板保存/应用），缺：AI 提取、发布锁定、客观/主观编辑、置信度审核。区块外无任何评分相关 state 引用（已 grep 验证；Phase 2 四区块是独立组件文件 `bid-confirm/*.tsx`，经 `bidProjectId + detail + onChanged` 驱动，不碰区块4 的 state）。
- `ensureBidProject(projectItemId, round)`（`lib/api/bid.ts:40` → `GET /project-management/:id/bid-project`）幂等懒创建，返回 `BidProjectRef`（含 stage，**不含** `scoreStandardPublishedAt`）。新建 BidProject stage=`SUBMIT`，且 `DOWNLOAD→SUBMIT` 自动推进——`assertScoreItemsEditable`（`bid.service.ts:1981`）在 DOWNLOAD/SUBMIT/OPENING 且未发布时可编辑 ✔。
- web `lib/api/bid.ts`（**Phase 2 后 455 行**）已封装 12 个评分/模板函数，**且 Phase 2 已补 `getBidProjectDetail`**（:349，`BidProjectDetail` 含 `scoreStandardPublishedAt?: string | null`，可直接复用）；**仍缺**：`publishScoreStandard`、`extractScorePoints`、`batchCreateScorePoints`；类型缺 `BidScoreItem.points?`、`ScoreTemplateRef.createdById?`。
- web `lib/api.ts` 的 `api.post` **不支持**透传 `RequestInit`（AI 提取的 AbortSignal 需要）——需扩一个可选参数。
- 共享件：`Modal`/`TableSkeleton` 在 `@/components/workbench`（barrel 导出）；globals.css 有 `.workbench-table`(:8881)、`.workbench-input`(:8919)、`.wb-panel`、`.neu-btn-*`；根 layout 已挂 sonner `<Toaster>`；`@water-erp/shared` 已被 web 多处引用。
- **⚠️ z-index 陷阱**：`Modal` portal 到 body 且 `z-50`（`workbench/modal.tsx:105`），而两个业务 overlay 是 `z-[500]`——从 overlay 内打开 Modal 会被盖住。web 现有 overlay（bid-confirm）从不用 Modal 所以没暴露。本计划 Task 3 将 Modal 提到 `z-[600]`。

**后端**（`apps/api/src/bid/bid.controller.ts` + `bid.service.ts`）— 零改动，仅列关键语义供排错：
- 16 路由全部继承类级 `@Roles('admin','bid_host','leader','staff')`（:24-28）；`RolesGuard` 是严格 `includes`（无角色映射）。
- 锁定锚点：`BidProject.scoreStandardPublishedAt` + stage（EVALUATING/ARCHIVED）→ 409 `SCORE_ITEMS_LOCKED`；写操作事务内 `FOR UPDATE` 复检（`reassertScoreItemsEditableInTx` :1994）。
- 发布校验：打分类 ΣmaxScore=100（±0.05）且每项 ≥1 得分点（`assertScoreStandardComplete`）；启动评标时再校验一次。
- `deleteScoreTemplate`：公共模板仅 admin/bid_host 可删；leader/staff 只能删自己的（`bid.service.ts:2356-2371`）——leader/staff 用户体验与 :3007 一致，无需改。
- 得分点排序无 reorder 端点：`seq` 仅创建/更新时可设；本次不引入拖拽（源文件 `GripVertical` 图标本就是装饰）。
- AI 提取 `@Throttle(3/min)`，PRICE 类返回空，同步不落库。

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `apps/web/src/components/projects/score-standard/score-standard-editor.tsx` | **移植主体**：自包含评分标准编辑器（解析 bidProject → 锁定判定 → 评分项表格 → 得分点 → 模板 → 发布）。`variant: 'standalone'｜'embedded'` 两种外壳。 |
| Create | `apps/web/src/components/projects/score-standard/score-points-editor.tsx` | 得分点 CRUD + AI 提取审核（近逐字移植，仅换类型名/import 路径）。 |
| Create | `apps/web/src/components/projects/score-standard/save-template-dialog.tsx` | 「存为评分模板」弹窗（Dialog→Modal 适配）。 |
| Create | `apps/web/src/components/projects/score-standard/template-library-dialog.tsx` | 「评分模板库」弹窗 + 删除二次确认（Dialog→Modal，`applyScoreTemplateById`→`applySavedScoreTemplate`）。 |
| Create | `apps/web/src/components/projects/score-standard/score-standard-panel.tsx` | 全屏 overlay 外壳（复刻 bid-confirm 的 chrome），包裹 standalone 编辑器。 |
| Modify | `apps/web/src/lib/api.ts` | `api.post` 增加可选 `init?: RequestInit`（透传 AbortSignal）。 |
| Modify | `apps/web/src/lib/api/bid.ts` | 类型补 `BidScoreItem.points?`/`ScoreTemplateRef.createdById?`；新增 `publishScoreStandard`、`extractScorePoints`、`batchCreateScorePoints`；re-export `ScorePointSuggestion`。（`getBidProjectDetail` Phase 2 已有，复用。） |
| Modify | `apps/web/src/components/projects/project-stage-timeline.tsx` | `TENDER_DOCUMENT` 卡片加第二个动作按钮「评分标准编制」（新 prop `onScoreStandard`，仿 `onEditTenderFile` 模式）。 |
| Modify | `apps/web/src/components/projects/project-detail-panel.tsx` | 新增 `scoreStandardOpen/Round` state；时间线接线；挂载 `<ScoreStandardPanel>`。 |
| Modify | `apps/web/src/components/projects/bid-confirm-panel.tsx` | 区块4（:608-848）替换为 `<ScoreStandardEditor variant="embedded">`；删除被取代的 state/handler/import（:85/:96-110/:248-418 及 load/reset 中对应行）。 |
| Modify | `apps/web/src/components/workbench/modal.tsx` | `z-50` → `z-[600]`（必须盖过业务 overlay 的 `z-[500]`）。 |
| Modify | `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` | 加 `readOnly` 开关：只读横幅文案、隐藏写按钮、子组件 `locked` 强制。 |
| Modify | `apps/api/prisma/seed.ts`（Task 8 可选） | 仿「陈源远」块补 `Swhi-CGZX-01/05` 口令规整为 `<用户名>@2026`，使 :3005 有可登录的 leader/staff 验证账号。 |
| Modify | `ACCOUNTS.md`（Task 8 可选） | 采购管理端表格补 Swhi-CGZX leader/staff 账号两行。 |

---

### Task 1: web API 层扩展（signal 透传 + 缺失封装）

**Files:**
- Modify: `apps/web/src/lib/api.ts:36-48`（`api` 对象的 `post`）
- Modify: `apps/web/src/lib/api/bid.ts`（类型区 + 评分标准区）

**Interfaces:**
- Produces（供 Task 2-6 使用）：
  - `api.post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>`
  - `getBidProjectDetail(bidProjectId: string): Promise<BidProjectDetail>` —— **Phase 2 既有**（`bid.ts:349`，`BidProjectDetail.scoreStandardPublishedAt?: string | null`），Task 4 直接复用，不新增
  - `publishScoreStandard(bidProjectId: string): Promise<BidProjectDetail>`
  - `extractScorePoints(bidProjectId: string, itemId: string, options?: RequestInit): Promise<ScorePointSuggestion[]>`
  - `batchCreateScorePoints(bidProjectId, itemId, points: Array<{name; fullScore; seq?; evidenceHint?; objective?; evidenceSection?; confidence?}>): Promise<{ count: number }>`
  - `BidScoreItem.points?: BidScorePoint[]`；`ScoreTemplateRef.createdById?: string | null`；`export type { ScorePointSuggestion }`

- [ ] **Step 1: 扩展 `api.post` 支持透传 RequestInit**

`apps/web/src/lib/api.ts` 中把：

```ts
export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
```

改为：

```ts
export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown, init?: RequestInit) =>
    fetchApi<T>(path, {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) },
      body: JSON.stringify(body),
    }),
```

（其余 `postForm/put/patch/delete` 不动。`fetchApi` 会在最终 headers 里并入 `X-Portal: web`，`signal` 经 `...init` 透传给 `fetch`。）

- [ ] **Step 2: bid.ts 顶部 import 共享类型**

`apps/web/src/lib/api/bid.ts` 第 1 行 `import { api } from '../api';` 后新增：

```ts
import type { ScorePointSuggestion } from '@water-erp/shared';

export type { ScorePointSuggestion };
```

- [ ] **Step 3: 补 `BidScoreItem.points?`（项目详情读取复用 Phase 2 既有 `getBidProjectDetail`）**

在 `BidScoreItem` interface 的 `createdAt: string;` 前插入一行：

```ts
  points?: BidScorePoint[]; // listScoreItems 已 include points（seq 升序）
```

（`BidScorePoint` 声明在同文件后段，TS interface 提升，无需移动。**不要**新增 `BidProjectDetail`/`getBidProject`——Phase 2 的 `getBidProjectDetail`（:349）已返回全量详情含 `scoreStandardPublishedAt`，Task 4 直接用它。）

- [ ] **Step 4: 补 `ScoreTemplateRef.createdById?`**

`ScoreTemplateRef` interface（:182-187）中 `createdByName` 前插入：

```ts
  createdById?: string | null; // null/缺省 = 公共模板；有值 = 创建者本人（后端按当前用户过滤，非空即「我的」）
```

- [ ] **Step 5: 在「得分点」区末尾追加 发布 / AI 提取 / 批量导入 封装**

在 `deleteScorePoint` 函数（:176-178）之后、「评分模板」注释（:180）之前插入：

```ts
/** 发布评分标准（锁定：置 scoreStandardPublishedAt）。后端校验打分类 Σ=100 且每项 ≥1 得分点，不满足 → 409。*/
export function publishScoreStandard(bidProjectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${bidProjectId}/score-items/publish`, {});
}

/** AI 从招标文件提取得分点建议（同步、不落库；120s 超时可经 options.signal 中断）。限流 3 次/分。*/
export function extractScorePoints(bidProjectId: string, itemId: string, options?: RequestInit) {
  return api.post<ScorePointSuggestion[]>(
    `/bid/projects/${bidProjectId}/score-items/${itemId}/points/extract`,
    {},
    options,
  );
}

/** 批量导入得分点（AI 建议审核通过后）。多余的 selected/duplicate 等字段被后端 whitelist 剥掉。*/
export function batchCreateScorePoints(
  bidProjectId: string,
  itemId: string,
  points: Array<{
    name: string;
    fullScore: number;
    seq?: number;
    evidenceHint?: string;
    objective?: boolean;
    evidenceSection?: string;
    confidence?: number;
  }>,
) {
  return api.post<{ count: number }>(
    `/bid/projects/${bidProjectId}/score-items/${itemId}/points/batch`,
    { points },
  );
}
```

- [ ] **Step 6: 类型检查 + lint**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 两者均 0 报错。（若 tsc 报 `ScorePointSuggestion` 找不到，确认 `packages/shared` 已 build：`pnpm --filter @water-erp/shared build`。）

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api/bid.ts
git commit -m "feat(web): api.post 支持透传 RequestInit；bid.ts 补发布/AI提取/批量导入封装与类型"
```

---

### Task 2: 移植得分点编辑器 score-points-editor.tsx

**Files:**
- Create: `apps/web/src/components/projects/score-standard/score-points-editor.tsx`
- Source（对照用，不改）: `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`

**Interfaces:**
- Consumes: Task 1 的 `extractScorePoints`/`batchCreateScorePoints` 及已有 `createScorePoint/updateScorePoint/deleteScorePoint`、类型 `BidScoreItem`/`BidScorePoint`/`ScorePointSuggestion`
- Produces: `export function ScorePointsEditor({ projectId, item, points, onChanged, locked }: Props)`，`Props = { projectId: string; item: BidScoreItem; points: BidScorePoint[]; onChanged: () => void; locked?: boolean }`

- [ ] **Step 1: 拷贝源文件**

```bash
mkdir -p apps/web/src/components/projects/score-standard
cp "apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx" \
   apps/web/src/components/projects/score-standard/score-points-editor.tsx
```

- [ ] **Step 2: 替换 import 块与类型名**

新文件的 import 块（前 15 行）整体替换为：

```tsx
'use client';

import { useState } from 'react';
import { Plus, Trash2, GripVertical, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createScorePoint,
  updateScorePoint,
  deleteScorePoint,
  extractScorePoints,
  batchCreateScorePoints,
  type BidScorePoint,
  type BidScoreItem,
  type ScorePointSuggestion,
} from '@/lib/api/bid';

interface Props {
  projectId: string;
  item: BidScoreItem;
  points: BidScorePoint[];
  onChanged: () => void; // 增删改后通知父组件刷新
  locked?: boolean; // 评分标准已发布/项目已进 EVALUATING/ARCHIVED 时禁用修改
}
```

然后把文件其余部分的所有 `ScorePoint`（作为类型标注处，如 `(p: ScorePoint)`、`useState<...>`）**整词替换**为 `BidScorePoint`，`ScoreItem` 整词替换为 `BidScoreItem`。组件体（`export function ScorePointsEditor` 至文件尾）**无任何其他改动**——它本就用 `projectId` prop，不依赖 bid-portal 的 context/组件。

注意三处机械替换的落点（替换后应正好是这些）：
- `item: BidScoreItem;` / `points: BidScorePoint[];`（Props）
- `async function toggleObjective(p: BidScorePoint)` / `remove(p: BidScorePoint)` / `editFullScore(p: BidScorePoint, v: number)`
- `useState<(ScorePointSuggestion & { selected: boolean })[] | null>(null)` —— `ScorePointSuggestion` 名字不变。

- [ ] **Step 3: 验证与源文件仅差 import/类型名**

Run:

```bash
cd /home/asus/桌面/ERP/water-erp
diff <(sed -e 's/BidScorePoint/ScorePoint/g' -e 's/BidScoreItem/ScoreItem/g' \
  -e "s#from '@/lib/api/bid'#from '@/lib/api/bid'#" \
  apps/web/src/components/projects/score-standard/score-points-editor.tsx) \
  "apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx"
```

Expected: 差异仅出现在 import 块（web 版从 `@/lib/api/bid` 导入 `BidScore*`/`ScorePointSuggestion`，bid-portal 版导入 `Score*` 且 `ScorePointSuggestion` 同处）与 Props 注释行，组件 JSX/逻辑零差异。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 报错（`BidScorePoint.fullScore` 是 string，源文件所有用法都经 `Number()` 包装，兼容）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/projects/score-standard/score-points-editor.tsx
git commit -m "feat(web): 移植得分点编辑器（CRUD + AI 提取审核 + 批量导入）"
```

---

### Task 3: 移植两个模板对话框（Modal 适配）+ 修复 Modal z-index

**Files:**
- Create: `apps/web/src/components/projects/score-standard/save-template-dialog.tsx`
- Create: `apps/web/src/components/projects/score-standard/template-library-dialog.tsx`
- Modify: `apps/web/src/components/workbench/modal.tsx:105`（`z-50` → `z-[600]`）
- Source（对照）: `apps/bid-portal/src/app/(dashboard)/bid/standard/save-template-dialog.tsx`、`template-library-dialog.tsx`

**Interfaces:**
- Consumes: `saveScoreTemplate`、`listScoreTemplates`、`applySavedScoreTemplate`（注意：bid-portal 叫 `applyScoreTemplateById`，web 既有封装叫 `applySavedScoreTemplate`）、`deleteScoreTemplate`、类型 `ScoreTemplateRef`（含 Task 1 补的 `createdById?`）/`BidScoreItem`；`Modal`（`@/components/workbench`，props: `open/onClose/title/description?/children/footer?/size?: 'sm'|'md'|'lg'|'xl'`）
- Produces:
  - `export function SaveTemplateDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string })`
  - `export function TemplateLibraryDialog({ open, onClose, projectId, locked, onChanged }: { open: boolean; onClose: () => void; projectId: string; locked: boolean; onChanged: (items: BidScoreItem[]) => void })`

- [ ] **Step 1: 修复 Modal z-index（前置条件）**

`apps/web/src/components/workbench/modal.tsx` 约 :105：

```tsx
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
```

改为：

```tsx
    {/* z-[600]：必须盖过业务全屏 overlay（bid-confirm / score-standard 面板的 z-[500]），
        Modal 经 createPortal 挂到 body，与 overlay 同级层叠 */}
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
```

- [ ] **Step 2: 写 save-template-dialog.tsx**

Create `apps/web/src/components/projects/score-standard/save-template-dialog.tsx`：

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { saveScoreTemplate } from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function SaveTemplateDialog({ open, onClose, projectId }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    setName('');
    onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请填写模板名称');
      return;
    }
    setBusy(true);
    try {
      await saveScoreTemplate(projectId, name.trim());
      toast.success('已保存为模板');
      setName('');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="存为评分模板"
      description="将当前项目的评分项与得分点保存为可复用模板。"
      size="sm"
      footer={
        <>
          <button onClick={handleClose} className="neu-btn-soft">
            取消
          </button>
          <button onClick={handleSave} disabled={busy} className="neu-btn-primary disabled:opacity-50">
            确认保存
          </button>
        </>
      }
    >
      <input
        type="text"
        autoFocus
        placeholder="模板名称（如：水务工程通用评分模板）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="workbench-input w-full"
      />
    </Modal>
  );
}
```

- [ ] **Step 3: 写 template-library-dialog.tsx**

Create `apps/web/src/components/projects/score-standard/template-library-dialog.tsx`：

```tsx
'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listScoreTemplates,
  applySavedScoreTemplate,
  deleteScoreTemplate,
  type ScoreTemplateRef,
  type BidScoreItem,
} from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  locked: boolean;
  onChanged: (items: BidScoreItem[]) => void;
}

export function TemplateLibraryDialog({ open, onClose, projectId, locked, onChanged }: Props) {
  const [templates, setTemplates] = useState<ScoreTemplateRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScoreTemplateRef | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setTemplates(await listScoreTemplates());
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleApply = async (t: ScoreTemplateRef) => {
    setApplyingId(t.id);
    try {
      const updated = await applySavedScoreTemplate(projectId, t.id);
      onChanged(updated);
      toast.success(`已应用模板「${t.name}」`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '应用失败');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteScoreTemplate(target.id);
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      toast.success('已删除');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="评分模板库" size="lg">
        <p className="mb-3 rounded-lg bg-[#f3f7fc] px-3 py-2 text-xs text-[#5a6d8a]">
          应用按名称合并到当前项目（已存在的项不重复添加），不会覆盖或删除已有项。
        </p>

        {loading ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">加载中…</div>
        ) : templates.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">
            尚无保存的模板。可在评分项页用「存为模板」创建。
          </div>
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => {
              const mine = !!t.createdById;
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg border border-[#edf2f7] bg-white px-3 py-2.5"
                >
                  <FileSpreadsheet size={16} strokeWidth={1.5} className="shrink-0 text-[#064ea2]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[#18243a]">{t.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                          mine ? 'bg-[#e6f0fb] text-[#064ea2]' : 'bg-[#f3f7fc] text-[#5a6d8a]'
                        }`}
                      >
                        {mine ? '我的' : '公共'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-[#8a96aa]">
                      {t.createdByName || '—'} · {new Date(t.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleApply(t)}
                      disabled={locked || applyingId === t.id}
                      title={locked ? '评分标准已锁定，无法应用' : '应用到此项目'}
                      className="rounded-lg bg-[#064ea2] px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#054280] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {applyingId === t.id ? '应用中…' : '应用'}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(t)}
                      title={mine ? '删除模板' : '删除公共模板（仅管理员可成功）'}
                      className="rounded-lg p-1.5 text-[#5a6d8a] transition hover:bg-[#fef2f2] hover:text-[#e74c3c]"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <button onClick={() => setDeleteTarget(null)} className="neu-btn-soft">
              取消
            </button>
            <button
              onClick={handleDelete}
              className="rounded-xl bg-[#e74c3c] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c0392b]"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[#5a6d8a]">
          确定要删除模板「{deleteTarget?.name}」吗？此操作不可撤销。
        </p>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: 类型检查 + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 0 报错。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/projects/score-standard/save-template-dialog.tsx \
        apps/web/src/components/projects/score-standard/template-library-dialog.tsx \
        apps/web/src/components/workbench/modal.tsx
git commit -m "feat(web): 移植评分模板对话框（存为模板/模板库）；Modal z-index 提升至 600 以盖过业务 overlay"
```

---

### Task 4: 移植主编辑器 score-standard-editor.tsx

**Files:**
- Create: `apps/web/src/components/projects/score-standard/score-standard-editor.tsx`
- Source（对照）: `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`

**Interfaces:**
- Consumes: Task 1 全部新增封装；Task 2 `ScorePointsEditor`；Task 3 两个 Dialog；`ensureBidProject`/`listScoreItems`/`createScoreItem`/`updateScoreItem`/`deleteScoreItem`/`applyScoreTemplate`（web 既有）+ `getBidProjectDetail`（Phase 2 既有）；`@water-erp/shared` 的 `CATEGORY_LABEL/CATEGORY_COLOR/STAGE_LABEL/isPassFailCategory`；`Modal`/`TableSkeleton`（`@/components/workbench`）
- Produces:

```ts
export function ScoreStandardEditor(props: {
  project: ProjectManagementItem;      // /projects 的项目管理项
  round?: number;                      // 多轮采购轮次（缺省由 ensureBidProject 取 currentRound）
  bidProject?: BidProjectRef | null;   // 已知则传入，跳过一次 ensure 往返（开标确认面板已有）
  onChanged?: () => void;              // 任一写操作成功后触发（父组件可刷新）
  variant?: 'standalone' | 'embedded'; // standalone=自带 wb-panel 卡片壳；embedded=仅内容（嵌在 SectionCard 内）
}): JSX.Element
```

- [ ] **Step 1: 写 score-standard-editor.tsx**

Create `apps/web/src/components/projects/score-standard/score-standard-editor.tsx`：

```tsx
'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { CATEGORY_COLOR, CATEGORY_LABEL, STAGE_LABEL, isPassFailCategory } from '@water-erp/shared';
import {
  applyScoreTemplate,
  createScoreItem,
  deleteScoreItem,
  ensureBidProject,
  getBidProjectDetail,
  listScoreItems,
  publishScoreStandard,
  updateScoreItem,
  type BidProjectRef,
  type BidScoreItem,
  type ScoreCategory,
} from '@/lib/api/bid';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { Modal, TableSkeleton } from '@/components/workbench';
import { ScorePointsEditor } from './score-points-editor';
import { SaveTemplateDialog } from './save-template-dialog';
import { TemplateLibraryDialog } from './template-library-dialog';

const CATEGORY_OPTIONS: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
const inputCls = 'workbench-input';

type Props = {
  project: ProjectManagementItem;
  round?: number;
  bidProject?: BidProjectRef | null;
  onChanged?: () => void;
  variant?: 'standalone' | 'embedded';
};

export function ScoreStandardEditor({ project, round, bidProject, onChanged, variant = 'standalone' }: Props) {
  const [bpId, setBpId] = useState<string | null>(bidProject?.id ?? null);
  const [stage, setStage] = useState('');
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [items, setItems] = useState<BidScoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<{ category: ScoreCategory; name: string; maxScore: number }>({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ category: ScoreCategory; name: string; maxScore: number }>({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [showLib, setShowLib] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setShowAdd(false);
    setEditingId(null);
    (async () => {
      try {
        const bp = bidProject ?? (await ensureBidProject(project.id, round));
        const [detail, its] = await Promise.all([getBidProjectDetail(bp.id), listScoreItems(bp.id)]);
        if (cancelled) return;
        setBpId(bp.id);
        setStage(detail.stage);
        setPublishedAt(detail.scoreStandardPublishedAt ?? null);
        setItems(its);
      } catch {
        if (!cancelled) toast.error('评分标准加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按项目/轮次重载；bidProject 仅作首屏捷径
  }, [project.id, round, bidProject?.id]);

  const locked = !!publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED';
  const totalMax = useMemo(() => items.reduce((s, i) => s + Number(i.maxScore), 0), [items]);
  const scoredTotal = useMemo(
    () => items.filter((i) => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0),
    [items],
  );

  // 得分点增删改后刷新 items（含 points 字段）并通知父组件
  const reloadItems = useCallback(async () => {
    if (!bpId) return;
    try {
      const refreshed = await listScoreItems(bpId);
      setItems(refreshed);
    } catch {
      /* 保留旧数据 */
    }
    onChanged?.();
  }, [bpId, onChanged]);

  const handlePublish = async () => {
    if (!bpId) return;
    const scoredSum = items.filter((i) => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0);
    const incomplete = items.filter((i) => Number(i.maxScore) > 0 && (!i.points || i.points.length === 0));
    if (scoredSum !== 100 || incomplete.length > 0) {
      toast.error(`发布前请确保:打分项满分合计=100(当前 ${scoredSum}),且每个打分项至少 1 个得分点`);
      return;
    }
    if (!window.confirm('发布后评分标准将锁定,不可再修改。确认发布?')) return;
    try {
      const res = await publishScoreStandard(bpId);
      setPublishedAt(res.scoreStandardPublishedAt);
      toast.success('评分标准已发布');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发布失败');
    }
  };

  const handleApplyTemplate = async () => {
    if (!bpId) return;
    try {
      const updated = await applyScoreTemplate(bpId);
      setItems(updated);
      toast.success('已应用标准评分模板');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const handleCreate = async () => {
    if (!bpId) return;
    if (!draft.name.trim()) {
      toast.error('请填写评分项名称');
      return;
    }
    try {
      const created = await createScoreItem(bpId, {
        category: draft.category,
        name: draft.name.trim(),
        maxScore: isPassFailCategory(draft.category) ? 0 : Number(draft.maxScore),
      });
      setItems((prev) => [...prev, created]);
      setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 });
      setShowAdd(false);
      toast.success('评分项已新增');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '新增失败');
    }
  };

  const startEdit = (it: BidScoreItem) => {
    setEditingId(it.id);
    setEditDraft({ category: it.category, name: it.name, maxScore: Number(it.maxScore) });
  };

  const handleSaveEdit = async (id: string) => {
    if (!bpId) return;
    if (!editDraft.name.trim()) {
      toast.error('请填写评分项名称');
      return;
    }
    try {
      const updated = await updateScoreItem(bpId, id, {
        category: editDraft.category,
        name: editDraft.name.trim(),
        maxScore: isPassFailCategory(editDraft.category) ? 0 : Number(editDraft.maxScore),
      });
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      setEditingId(null);
      toast.success('已保存');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const confirmDelete = async () => {
    if (!bpId || !deleteConfirm) return;
    const { id } = deleteConfirm;
    try {
      await deleteScoreItem(bpId, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success('已删除');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
    setDeleteConfirm(null);
  };

  const CategoryBadge = ({ category }: { category: string }) => {
    const color = CATEGORY_COLOR[category] || '#94a3b8';
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold"
        style={{ color, backgroundColor: `${color}18` }}
      >
        {CATEGORY_LABEL[category] || category}
      </span>
    );
  };

  const toolbar = (
    <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
      {items.length > 0 && (
        <button
          onClick={() => setShowSaveTpl(true)}
          className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
        >
          <Save size={14} strokeWidth={1.8} />
          存为模板
        </button>
      )}
      <button
        onClick={() => setShowLib(true)}
        className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
      >
        <FileSpreadsheet size={14} strokeWidth={1.8} />
        模板库
      </button>
      {!locked && (
        <>
          <button
            onClick={handlePublish}
            className="flex items-center gap-1.5 rounded-xl bg-[#11a874] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#0e8f61]"
          >
            <Check size={14} strokeWidth={1.8} />
            发布评分标准
          </button>
          <button
            onClick={handleApplyTemplate}
            className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
          >
            <FileSpreadsheet size={14} strokeWidth={1.8} />
            应用标准模板
          </button>
          <button
            onClick={() => {
              setShowAdd(true);
              setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 });
            }}
            className="flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#054280]"
          >
            <Plus size={14} strokeWidth={2} />
            新增评分项
          </button>
        </>
      )}
    </div>
  );

  const tableBlock = (
    <>
      {/* ── Summary ── */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-[#f3f7fc] px-4 py-3 text-sm">
        <span className="text-[#5a6d8a]">
          评分项：<span className="font-mono font-bold text-[#18243a]">{items.length}</span> 项
        </span>
        <span className="text-[#5a6d8a]">
          打分项满分合计：<span className="font-mono font-bold text-[#064ea2]">{scoredTotal}</span> 分
        </span>
        <span className="text-[#8a96aa]">
          （含 {items.length - items.filter((i) => Number(i.maxScore) > 0).length} 项通过性审查）
        </span>
      </div>

      <div className="overflow-x-auto">
        {loading ? (
          <table className="workbench-table">
            <tbody>
              <TableSkeleton cols={5} rows={5} />
            </tbody>
          </table>
        ) : items.length === 0 && !showAdd ? (
          <div className="py-14 text-center">
            <p className="text-sm text-[#8a96aa]">该项目尚未编制评分标准。</p>
            <p className="mt-1 text-xs text-[#aab4c5]">
              评分项是评标的前置条件——无评分项则专家无法打分。请「应用标准模板」或手动新增。
            </p>
          </div>
        ) : (
          <table className="workbench-table">
            <thead>
              <tr className="bg-[#f3f7fc]">
                <th className="w-8 px-2 py-3"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">类别</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">评分项名称</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">满分</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[#5a6d8a]">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isEdit = editingId === it.id;
                const open = !!expanded[it.id];
                const points = it.points ?? [];
                return (
                  <Fragment key={it.id}>
                    <tr
                      className={`border-t border-[#edf2f7] ${isEdit ? '' : 'cursor-pointer hover:bg-[#f8fbff]'}`}
                      onClick={() => {
                        if (!isEdit) setExpanded((prev) => ({ ...prev, [it.id]: !prev[it.id] }));
                      }}
                    >
                      <td className="px-2 py-3 text-[#8a96aa]">
                        {!isEdit &&
                          (open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />)}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <select
                            value={editDraft.category}
                            onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value as ScoreCategory }))}
                            className={`${inputCls} w-[140px]`}
                          >
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {CATEGORY_LABEL[c]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <CategoryBadge category={it.category} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            className={`${inputCls} w-full max-w-[360px]`}
                          />
                        ) : (
                          <span className="text-sm font-medium text-[#18243a]">{it.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          isPassFailCategory(editDraft.category) ? (
                            <span className="text-xs font-bold text-[#5a6d8a]">通过性</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              step="0.1"
                              value={editDraft.maxScore}
                              onChange={(e) => setEditDraft((d) => ({ ...d, maxScore: Number(e.target.value) }))}
                              className={`${inputCls} w-[100px] font-mono`}
                            />
                          )
                        ) : (
                          <span className="font-mono text-sm font-bold text-[#064ea2]">
                            {isPassFailCategory(it.category) ? '通过性' : Number(it.maxScore) > 0 ? `${Number(it.maxScore)}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isEdit ? (
                            <>
                              <button onClick={() => handleSaveEdit(it.id)} className="rounded-lg p-1.5 text-[#11a874] hover:bg-[#ecfdf5]" title="保存">
                                <Check size={15} strokeWidth={1.8} />
                              </button>
                              <button onClick={() => setEditingId(null)} className="rounded-lg p-1.5 text-[#8a96aa] hover:bg-[#f8fafc]" title="取消">
                                <X size={15} strokeWidth={1.8} />
                              </button>
                            </>
                          ) : (
                            !locked && (
                              <>
                                <button onClick={() => startEdit(it)} className="rounded-lg p-1.5 text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#064ea2]" title="编辑">
                                  <Pencil size={13} strokeWidth={1.5} />
                                </button>
                                <button onClick={() => setDeleteConfirm({ id: it.id, name: it.name })} className="rounded-lg p-1.5 text-[#5a6d8a] hover:bg-[#fef2f2] hover:text-[#e74c3c]" title="删除">
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && !isEdit && bpId && (
                      <tr className="border-t border-[#edf2f7] bg-[oklch(0.985_0.003_265)]">
                        <td colSpan={5} className="px-4 pb-4 pt-1">
                          <ScorePointsEditor projectId={bpId} item={it} points={points} onChanged={reloadItems} locked={locked} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {/* ── Add row ── */}
              {showAdd && (
                <tr className="border-t-2 border-[#064ea2] bg-[#f8fbff]">
                  <td className="px-2 py-3"></td>
                  <td className="px-4 py-3">
                    <select
                      value={draft.category}
                      onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as ScoreCategory }))}
                      className={`${inputCls} w-[140px]`}
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="如：技术方案完整性"
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      className={`${inputCls} w-full max-w-[360px]`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {isPassFailCategory(draft.category) ? (
                      <span className="text-xs font-bold text-[#5a6d8a]">通过性</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={draft.maxScore}
                        onChange={(e) => setDraft((d) => ({ ...d, maxScore: Number(e.target.value) }))}
                        className={`${inputCls} w-[100px] font-mono`}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={handleCreate} className="rounded-lg p-1.5 text-[#11a874] hover:bg-[#ecfdf5]" title="保存">
                        <Check size={15} strokeWidth={1.8} />
                      </button>
                      <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 text-[#8a96aa] hover:bg-white" title="取消">
                        <X size={15} strokeWidth={1.8} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {items.length > 0 && (
        <div className="mt-4 flex items-center justify-end border-t border-[#edf2f7] pt-3 text-sm">
          <span className="text-[#5a6d8a]">满分合计</span>
          <span className="ml-2 font-mono text-lg font-black text-[#064ea2]">{totalMax}</span>
        </div>
      )}
    </>
  );

  return (
    <div className={variant === 'embedded' ? 'space-y-4' : 'space-y-6'}>
      {locked && (
        <div className="flex items-center gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
          <Lock size={14} strokeWidth={1.8} />
          <span>
            {publishedAt
              ? `评分标准已发布(${new Date(publishedAt).toLocaleString('zh-CN')}),不可修改。`
              : `项目处于「${STAGE_LABEL[stage] || stage}」阶段,评分标准已锁定,不可修改。${stage === 'EVALUATING' ? ' 专家已开始打分。' : ''}`}
          </span>
        </div>
      )}

      {variant === 'standalone' ? (
        <section className="wb-panel p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-[var(--foreground)]">评分项</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              资格审查 / 响应性为通过性审查（满分 0）；商务 / 技术 / 价格为打分项。
            </p>
          </div>
          {toolbar}
          {tableBlock}
        </section>
      ) : (
        <>
          {toolbar}
          {tableBlock}
        </>
      )}

      {/* 删除确认弹窗 */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <button onClick={() => setDeleteConfirm(null)} className="neu-btn-soft">
              取消
            </button>
            <button
              onClick={confirmDelete}
              className="rounded-xl bg-[#e74c3c] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c0392b]"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[#5a6d8a]">
          确定要删除评分项「{deleteConfirm?.name}」吗？此操作不可撤销。
        </p>
      </Modal>

      {bpId && <SaveTemplateDialog open={showSaveTpl} onClose={() => setShowSaveTpl(false)} projectId={bpId} />}
      {bpId && (
        <TemplateLibraryDialog
          open={showLib}
          onClose={() => setShowLib(false)}
          projectId={bpId}
          locked={locked}
          onChanged={(updated) => {
            setItems(updated);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
```

> 注（与源文件的一处有意差异）：得分点展开行由源码的 `{open && !isEdit && (...)}` 改为 `{open && !isEdit && bpId && (...)}` 条件渲染，杜绝加载完成前以空 id 调用 `ScorePointsEditor`。

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 0 报错。若报 `CATEGORY_LABEL` 索引类型（`Record<string,string>` 以 `ScoreCategory` 索引合法）相关问题，检查 `@water-erp/shared` 是否已 build（`pnpm --filter @water-erp/shared build`）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/projects/score-standard/score-standard-editor.tsx
git commit -m "feat(web): 移植评分标准主编辑器（锁定横幅/评分项表格/得分点/模板/发布，standalone+embedded 双形态）"
```

---

### Task 5: 全屏面板 + 时间线入口 + 详情面板接线

**Files:**
- Create: `apps/web/src/components/projects/score-standard/score-standard-panel.tsx`
- Modify: `apps/web/src/components/projects/project-stage-timeline.tsx`（props 类型 :71-91、按钮渲染区 :256-282 之后）
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`（import 区 :35 附近、state :307 附近、时间线 props :889-914、挂载区 :1647 之后）

**Interfaces:**
- Consumes: Task 4 `ScoreStandardEditor`；`ProjectManagementItem` 类型
- Produces: `export function ScoreStandardPanel({ isOpen, onClose, project, round }: { isOpen: boolean; onClose: () => void; project: ProjectManagementItem | null; round?: number })`

- [ ] **Step 1: 写 score-standard-panel.tsx**

Create `apps/web/src/components/projects/score-standard/score-standard-panel.tsx`（外壳 chrome 复刻 `bid-confirm-panel.tsx:426-497` 的样式，阶段主色用 `--stage-tender` 系——globals.css :31-32 已定义）：

```tsx
'use client';

import { useEffect } from 'react';
import { ListChecks, X } from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { ScoreStandardEditor } from './score-standard-editor';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  round?: number;
};

export function ScoreStandardPanel({ isOpen, onClose, project, round }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !project) return null;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* ── 标题栏 ── */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'var(--stage-tender-soft)',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <ListChecks size={17} style={{ color: 'var(--stage-tender)' }} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                评分标准编制
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
                {project.title} · {project.procurementMethod}
                {(round ?? 1) > 1 ? ` · 第 ${round} 轮` : ''}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-soft !p-2" title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* ── 主体 ── */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
          style={{ background: 'oklch(0.975 0.012 258 / 0.32)' }}
        >
          <div className="mx-auto max-w-[1080px]">
            <ScoreStandardEditor project={project} round={round} variant="standalone" />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 时间线增加 `onScoreStandard` prop 与第二按钮**

`apps/web/src/components/projects/project-stage-timeline.tsx`：

2a. 解构参数列表（:71-91）中，`onEditTenderFile,` 一行后加一行：

```tsx
  onScoreStandard,
```

2b. props 类型块（同函数签名内，:82-90）中 `onEditTenderFile?: ...;` 后加：

```tsx
  /** 采购文件阶段的第二动作：打开评分标准编制面板（2026-07-24 从 :3007 前置）*/
  onScoreStandard?: () => void;
```

2c. 在 `onEditTenderFile` 按钮块（:256-282，以 `)}` 结束）**之后**插入第二按钮（同样用 `span role="button"` 规避按钮嵌套，与既有模式一致）：

```tsx
                          {onScoreStandard && stageKey === 'TENDER_DOCUMENT' && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onScoreStandard();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  onScoreStandard();
                                }
                              }}
                              className="pm-stage-action-btn shrink-0"
                              title="编制本项目评分标准（评分项 / 得分点 / AI 提取 / 发布锁定）"
                            >
                              评分标准编制
                            </span>
                          )}
```

- [ ] **Step 3: 详情面板接线**

`apps/web/src/components/projects/project-detail-panel.tsx`：

3a. import 区（:35 `import { BidConfirmPanel } from './bid-confirm-panel';` 附近）加：

```tsx
import { ScoreStandardPanel } from './score-standard/score-standard-panel';
```

3b. state（:307 `const [bidConfirmRound, setBidConfirmRound] = useState(1);` 之后）加：

```tsx
  const [scoreStandardOpen, setScoreStandardOpen] = useState(false);
  const [scoreStandardRound, setScoreStandardRound] = useState(1);
```

3c. 时间线 props（:913 `onEditTenderFile={...}` 一行之后）加：

```tsx
              onScoreStandard={() => {
                setScoreStandardRound(selectedRound);
                setScoreStandardOpen(true);
              }}
```

3d. 挂载（:1647-1652 `<BidConfirmPanel ... />` 块之后）加：

```tsx
      {/* 评分标准编制面板（2026-07-24 从开评标管理端 :3007 前置到采购文件阶段）*/}
      <ScoreStandardPanel
        isOpen={scoreStandardOpen}
        onClose={() => setScoreStandardOpen(false)}
        project={item}
        round={scoreStandardRound}
      />
```

- [ ] **Step 4: 类型检查 + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 0 报错。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/projects/score-standard/score-standard-panel.tsx \
        apps/web/src/components/projects/project-stage-timeline.tsx \
        apps/web/src/components/projects/project-detail-panel.tsx
git commit -m "feat(web): /projects 采购文件阶段新增「评分标准编制」入口（全屏面板 + 时间线按钮 + 详情面板接线）"
```

---

### Task 6: 开标确认面板区块4 替换为内嵌编辑器（删除被取代的死代码）

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx`

**Interfaces:**
- Consumes: Task 4 `ScoreStandardEditor`（`variant="embedded"`，传入面板已有的 `bidProject` 省一次 ensure）
- Produces: 开标确认面板区块4 与独立面板共用同一编辑器；面板其余区块（2 供应商、3 专家、5 开标决策）行为不变

> ⚠️ **本任务基于 Phase 2 后的 1072 行版本**（`b9d03512` 已把面板升级为指挥中心：新增 `detail` 状态、`useBidWebSocket`、区块5-8 四个 Phase 2 区块）。行号均按该版本；若执行时并行会话又改动了此文件，以**内容锚点**（注释/函数名）重新定位。区块外已 grep 验证无任何评分相关 state/handler 引用（Phase 2 四区块是独立组件 `bid-confirm/*.tsx`，经 `bidProjectId/detail/onChanged` 驱动），可安全删除下列成员。

- [ ] **Step 1: 替换区块4 JSX（当前 :647-886）**

把从 `{/* ▸ 区块4：评分标准编制 */}`（:647）到其配对的 `</SectionCard>`（:886，紧邻 `{/* ▸ 区块5-8（Phase 2 指挥中心）...` 注释之前）**整段**替换为：

```tsx
              {/* ▸ 区块4：评分标准编制（2026-07-24 换用从 :3007 移植的完整编辑器：AI 提取 / 发布锁定 / 模板库 / 客观主观）*/}
              <SectionCard
                icon={<FileText size={14} />}
                title="评分标准编制"
                accent="var(--stage-evaluation)"
                accentSoft="var(--stage-evaluation-soft)"
              >
                {project && (
                  <ScoreStandardEditor
                    project={project}
                    round={round}
                    bidProject={bidProject}
                    onChanged={() => void load()}
                    variant="embedded"
                  />
                )}
              </SectionCard>
```

- [ ] **Step 2: 删除被取代的 state**

删除以下 state 声明（按名称定位，保留相邻的非评分 state——**特别注意保留 Phase 2 的 `detail`（:94）、`notifyConfirmOpen`、`pendingOpenTime`、延时开标 state**）：
- `const [scoreItems, setScoreItems] = useState<BidScoreItem[]>([]);`（:92）
- `newItem`、`editingItem`（评分项 新增/编辑）
- `expandedItems`、`pointsByItem`、`pointsLoading`、`newPoint`、`editingPoint`（得分点展开/缓存/编辑）
- `templates`、`saveTplOpen`、`tplName`、`tplListOpen`（模板 inline 区）
- 常量 `const SCORE_CATEGORIES = Object.keys(SCORE_CATEGORY_LABELS) as ScoreCategory[];`

- [ ] **Step 3: 删除被取代的 handler（当前 :287-457）**

删除从 `/* ── 评分项 CRUD ── */`（:287）到 `handleDeleteTemplate` 函数结束（:457，即 `/* ── 渲染 ── */` 之前）的全部内容：`handleCreateItem`、`handleSaveItem`、`handleDeleteItem`、`handleApplyTemplate`、`loadPoints`、`toggleExpand`、`handleCreatePoint`、`handleSavePoint`、`handleDeletePoint`、`handleSaveTemplate`、`handleApplySavedTemplate`、`handleDeleteTemplate`。（**不动**其前的 Phase 2 `refreshDetail`/`scheduleRefresh`/`useBidWebSocket` 块 :151-173，及其后的 `withBusy`/催促/开标/延时 handler。）

- [ ] **Step 4: 精简 `load()` 与关闭重置 effect（保留 Phase 2 部分）**

`load()`（当前 :127-149）改为——去掉 `listScoreTemplates` 旁路与 `listScoreItems` 并发，**保留 Phase 2 的 `getBidProjectDetail`**：

```ts
  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const bp = await ensureBidProject(project.id, round);
      setBidProject(bp);
      const [ws, dt] = await Promise.all([
        getBidWorkspace(bp.id),
        getBidProjectDetail(bp.id).catch(() => null),
      ]);
      setWorkspace(ws);
      setDetail(dt);
      setDelayTime(toLocalInput(bp.openTime));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [project]);
```

关闭重置 effect（当前 :180-203）中删除针对已删 state 的重置行：`setScoreItems([])`、`setNewItem(null)`、`setEditingItem(null)`、`setExpandedItems(new Set())`、`setPointsByItem({})`、`setPointsLoading(new Set())`、`setNewPoint(null)`、`setEditingPoint(null)`、`setTemplates([])`、`setSaveTplOpen(false)`、`setTplName('')`、`setTplListOpen(false)`（**保留** `setBidProject/setWorkspace/setDetail/setError/setToast/setDelayOpen/setNotifyConfirmOpen/setPendingOpenTime`）。

> 协同说明：内嵌编辑器任一写操作成功 → `onChanged` → `void load()` → workspace + detail 全量刷新，与 Phase 2 的 socket 增量刷新（`scheduleRefresh`）互补；发布锁定后 Phase 2 区块（如 EvaluationBlock 的启动评标前置校验）读到的 `detail` 也是最新的。

- [ ] **Step 5: 修剪 import**

从 `@/lib/api/bid` 的 import 块删除（**仅**区块4 专用、Phase 2 不用的）：`applySavedScoreTemplate`、`applyScoreTemplate`、`createScoreItem`、`createScorePoint`、`deleteScoreItem`、`deleteScorePoint`、`deleteScoreTemplate`、`listScoreItems`、`listScorePoints`、`listScoreTemplates`、`saveScoreTemplate`、`updateScoreItem`、`updateScorePoint`、`SCORE_CATEGORY_LABELS`、`type BidScoreItem`、`type BidScorePoint`、`type ScoreCategory`、`type ScoreTemplateRef`。

**保留 Phase 2 所需**：`getBidProjectDetail`、`type BidProjectDetail`、`ensureBidProject`、`getBidWorkspace`、`BID_STAGE_LABELS`、`type BidProjectRef`、`type BidWorkspace`、nudge/notify/startOpening/updateBidProjectSchedule 等。

从 lucide import 删除：`BookmarkPlus`、`ChevronDown`、`ChevronRight`、`FileDown`、`Pencil`、`PlusCircle`、`Save`、`Trash2`（保留 `FileText`——新区块4 图标仍在用；`Fragment` 删除——旧区块4 是其唯一用户，Phase 2 区块在独立文件）。**其余 Phase 2 引入的图标（如 `Radio`/`MessagesSquare` 等，视文件现状）一律不动。**

新增 import（文件顶部 import 区，与 Phase 2 的 `./bid-confirm/*` 区块 import 同层）：

```tsx
import { ScoreStandardEditor } from './score-standard/score-standard-editor';
```

- [ ] **Step 6: 类型检查 + lint（捕获残留死引用）**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 0 报错。若 lint 报 `no-unused-vars`，按提示再删对应 import（上面清单基于 2026-07-24 的 grep，个别图标可能被其余区块复用——以 lint 结果为准，**被复用的留下**）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/projects/bid-confirm-panel.tsx
git commit -m "refactor(web): 开标确认面板评分标准区换用移植版完整编辑器，删除被取代的 ~260 行内联实现"
```

---

### Task 7: bid-portal 评分标准页改只读

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`（同时作用于独立路由 `/bid/standard` 与项目工作区 `?tab=standard`——同一组件，符合预期）

**Interfaces:**
- 无新增导出；`readOnly` 为组件内常量，将来如需恢复可写仅需改一处。

- [ ] **Step 1: 加 readOnly 常量**

`page.tsx` :53：

```tsx
  const locked = !!publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED';
```

改为：

```tsx
  const locked = !!publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED';
  // 2026-07-24: 编制功能已前置到采购管理工作台（:3005 · /projects · 采购文件阶段「评分标准编制」），此页改为只读展示。
  const readOnly = true;
```

- [ ] **Step 2: 只读横幅**

:153 的 `{locked && (` 改为 `{(locked || readOnly) && (`；横幅内文案三元（:157-160）改为：

```tsx
            {readOnly && !locked
              ? '评分标准编制已迁移至「采购管理工作台（:3005）→ 项目管理 → 采购文件阶段 → 评分标准编制」，此页面仅供查看。'
              : publishedAt
                ? `评分标准已发布(${new Date(publishedAt).toLocaleString('zh-CN')}),不可修改。`
                : `项目处于「${STAGE_LABEL[stage] || stage}」阶段,评分标准已锁定,不可修改。${stage === 'EVALUATING' ? ' 专家已开始打分。' : ''}`}
```

- [ ] **Step 3: 隐藏工具栏写按钮**

:185 的 `{!locked && (`（包裹「发布评分标准/应用标准模板/新增评分项」三按钮的那一处——以其中 `onClick={handlePublish}` 可辨认）改为：

```tsx
            {!locked && !readOnly && (
```

- [ ] **Step 4: 隐藏行内编辑/删除按钮**

:308 的 `!locked && (`（位于行操作单元格 `) : (` 之后、包裹 `startEdit`/`handleDelete` 两按钮）改为：

```tsx
                            !locked && !readOnly && (
```

- [ ] **Step 5: 子组件强制锁定**

:325-331 `<ScorePointsEditor ... />` 的 `locked={locked}` 改为：

```tsx
                            locked={locked || readOnly}
```

:418-424 `<TemplateLibraryDialog ... />` 的 `locked={locked}` 改为：

```tsx
        locked={locked || readOnly}
```

（`SaveTemplateDialog`/`TemplateLibraryDialog` 的挂载保留——入口按钮已隐藏，不可达；展开行查看得分点仍可用，只读态下 ScorePointsEditor 自行隐藏新增行与提取按钮。）

- [ ] **Step 6: 类型检查 + lint**

Run: `pnpm --filter bid-portal exec tsc --noEmit && pnpm --filter bid-portal lint`
Expected: 0 报错（`handleCreate`/`confirmDelete` 等函数仍被 JSX 引用——弹窗与添加行 JSX 保留，只是入口不可达，不会产生死代码告警）。

- [ ] **Step 7: Commit**

```bash
git add "apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx"
git commit -m "feat(bid-portal): 评分标准页改只读（编制功能已前置到 :3005 采购管理工作台）"
```

---

### Task 8: 端到端验证

**Files:**
- Modify（可选，验证前置）: `apps/api/prisma/seed.ts`（「陈源远」口令规整块 :295-304 之后）、`ACCOUNTS.md`（:30 附近采购管理端表格）

> 前置背景：live 验证确认「陈源远」登录 :3005 解析为 `bid_host`（`/project-management` 403），而种子 `Swhi-CGZX-*` leader/staff 账号口令是原系统 bcrypt（未知）。要验证本功能需要一个能进 /projects 的 leader/staff 会话。

- [ ] **Step 1（可选）: 规整两个内部账号口令，使 :3005 可登录**

`apps/api/prisma/seed.ts` 在「陈源远」规整块（`console.log('▶ 规整「陈源远」账号口令（陈源远@2026）');` 所在块）**之后**插入（开标大厅分支在文件头部 :71-73/:120-122 加的 `OpeningHallMessage` 表注册在远处，无锚点冲突）：

```ts
  // ═══ 内部管理账号口令规整（与 ACCOUNTS.md「<用户名>@2026」约定一致，使 :3005 有可登录的 leader/staff）═══
  console.log('▶ 规整内部管理账号口令（Swhi-CGZX-01 leader / Swhi-CGZX-05 staff）');
  for (const uname of ['Swhi-CGZX-01', 'Swhi-CGZX-05']) {
    await prisma.user.updateMany({
      where: { username: uname },
      data: { passwordHash: hashSync(`${uname}@2026`, 10) },
    });
  }
```

`ACCOUNTS.md` 采购管理端表格（`陈源远 | procurement_staff` 行）后补两行：

```markdown
| `Swhi-CGZX-01` | `Swhi-CGZX-01@2026` | `leader` · 采购中心领导（陈源远） | 陈源远 |
| `Swhi-CGZX-05` | `Swhi-CGZX-05@2026` | `staff` · 采购中心员工（彭强） | 彭强 |
```

> ⚠️ `pnpm db:seed` 是 TRUNCATE 重载（幂等但清库）——与团队确认后再跑；若当前开发库有不想丢的数据，跳过本步，改由有库权限的人手工重置一个 staff 口令。

Run（如执行本步）: `cd /home/asus/桌面/ERP/water-erp && pnpm db:seed`
Expected: 控制台打印两条规整日志，无报错。

- [ ] **Step 2: 启动服务**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm infra:up            # 若 PostgreSQL/Redis/MinIO 未运行
pnpm dev:api             # :4001（另开终端）
pnpm dev:web             # :3005（另开终端）
pnpm dev:bid             # :3007（另开终端）
```

- [ ] **Step 3: :3005 主流程验证（leader 或 staff 登录）**

浏览器打开 `http://localhost:3005`，用 `Swhi-CGZX-05`（staff）/`Swhi-CGZX-05@2026` 登录（或任一能进 /projects 的 leader/staff 账号）。进入「项目管理」，任选一个 ACTIVE 项目卡片打开详情面板。逐项核对：

1. **入口**：采购流程时间线「采购文件」卡片上有两个动作按钮：「采购文件编写」与**「评分标准编制」**（新增）。点后者 → 全屏 overlay 打开，标题「评分标准编制」+ 项目名 + 采购方式。
2. **懒创建**：首次打开时后端 `GET /project-management/:id/bid-project` 创建/返回该轮的 BidProject（stage=SUBMIT）。编辑器加载后显示空态文案「该项目尚未编制评分标准…」。
3. **应用标准模板**：点「应用标准模板」→ 出现 5 项（资格性审查 0 / 符合性审查 0 / 商务评分 20 / 技术评分 50 / 价格评分 30），满分合计 100。再次点击幂等（不重复添加）。
4. **评分项 CRUD**：新增一项「技术方案完整性」（技术，10 分）→ 出现于表格；行内编辑改名/分值→保存生效；删除→二次确认弹窗（Modal，应正确盖在 overlay 之上）后消失。
5. **得分点 + AI 提取**：展开「技术评分」行 → 得分点编辑器。手动添加 2 个得分点（合计 ≤ 50）。点「AI 提取建议」：该项目无招标文件 → 应显示「AI 未从招标文件提取到得分点建议。」（空路径正确即通过；若库里有带招标文件的项目可另验审核浮层：置信度 ●●● 排序、「可能重复」默认不勾、导入选中项落库）。PRICE 行提取应提示「价格分按报价公式…」。
6. **客观/主观**：得分点行「客观/主观」徽标可点击切换（刷新后保持）。
7. **发布锁定**：满足 Σ=100 且每个打分项 ≥1 得分点后，点「发布评分标准」→ confirm → 成功 toast，出现黄色锁定横幅（含发布时间），所有写按钮消失，得分点编辑器新增行/提取按钮消失。不满足时发布 → error toast 说明缺口。
8. **模板库**：发布前先「存为模板」（命名）→「模板库」中显示（「我的」徽标）；应用到别的项目按名合并；删除自己的模板成功。
9. **多轮**（如有再采购项目）：选第 2 轮时间线分组打开面板，副标题显示「第 2 轮」，数据与首轮隔离。
10. **网络面板**：DevTools Network 确认请求走 `/api/bid/...`（经 next rewrite 到 :4001），带 `X-Portal: web`。

- [ ] **Step 4: 开标确认面板内嵌验证**

同一项目详情面板 → 时间线「开标评标」→「开标确认」。核对：

1. 区块4「评分标准编制」渲染的是**同一个移植编辑器**（工具栏/汇总表与独立面板一致），已发布的标准显示锁定横幅且只读。
2. 未发布项目在此处编辑评分项/得分点 → 成功（embedded 形态与 standalone 行为一致）。
3. 面板其余区块正常：区块2 供应商投标状态、区块3 专家确认、区块5 开标决策（延时开标/启动开标按钮可用；启动开标时后端仍会复跑 `assertScoreStandardComplete`）。
4. 控制台无 React 报错/键警告。

- [ ] **Step 5: :3007 只读验证**

浏览器打开 `http://localhost:3007`，用 `陈源远`/`陈源远@2026`（bid_host）登录。进任一项目工作区 `?tab=standard`（或直接 `/bid/standard` 选择项目）：

1. 顶部黄色横幅文案为迁移说明（未发布项目）或发布信息（已发布项目）。
2. **无**「发布评分标准 / 应用标准模板 / 新增评分项」按钮；行内无编辑/删除图标。
3. 展开评分项行可查看得分点，但无「添加」行与「AI 提取建议」按钮。
4. 监督端（`?tab=supervise`，如该 tab 可用）仍能看到此前在 :3005 操作产生的编制审计日志（`BidSupervisionLog`，action=编制评分标准）。

- [ ] **Step 6: 静态检查与收尾**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter bid-portal exec tsc --noEmit && pnpm --filter bid-portal lint
pnpm --filter api test -- bid.service   # 后端评分标准单测回归（应全绿，未改后端）
```

Expected: 全部 0 报错/全绿。

- [ ] **Step 7: Commit（若执行了 Step 1）**

```bash
git add apps/api/prisma/seed.ts ACCOUNTS.md
git commit -m "chore(seed): 规整 Swhi-CGZX-01/05 口令为 <用户名>@2026（:3005 验证账号，同 ACCOUNTS.md 约定）"
```

提醒：此时分支上有若干未推送 commit——**等用户明确指示再 push**。

---

## 风险与备注

1. **`procurement_staff` 历史遗留**：CLAUDE.md/ACCOUNTS.md 称「陈源远/procurement_staff」是 :3005 账号，实测登录解析为 bid_host 且 `/project-management` 403——该账号体系问题先于本次迁移存在，不在范围内；验证用 leader/staff 账号。若产品要求 procurement_staff 可用，需另立任务（AuthRole 联合类型 + 相关控制器 @Roles + `deleteScoreTemplate` 的 isAdmin 判定）。
2. **锁定语义单点在后端**：两端（:3005 独立面板 / 开标确认内嵌 / :3007 只读）编辑同一份数据，并发写有事务内 `FOR UPDATE` 复检兜底（409 `SCORE_ITEMS_LOCKED`），前端 catch 后 toast 提示即可。
3. **AI 提取限流 3 次/分**（`@Throttle`）：验收时连续点多次可能 429，属预期。
4. **Modal z-index 提升（Task 3）是全局改动**：web 内所有 Modal 从 z-50 升到 z-[600]。现存 Modal 使用方都在页面层（无 overlay 叠加场景），提升只会更稳；若后续出现 >600 的浮层需再评估。
5. **`ensureBidProject` 的 DOWNLOAD→SUBMIT 自动推进**：从 :3005 打开评分标准面板即触发（语义：进入开标确认链路=公告已发布）。对「采购文件阶段前置编制」的场景无害——BidProject 尚无供应商投递；但团队应知悉此副作用（既有行为，非本次引入）。
6. **得分点拖拽排序**：后端无 reorder 端点（`seq` 仅创建/更新可设），源文件的 `GripVertical` 是装饰图标；本次不引入拖拽。
7. **多会话共库**：执行期间遵守 memory——commit 前 `git branch --show-current` 复查；不 push；不动 `feat/bid-opening-hall-impl` 主工作区的 WIP 文件（当前为 `bid/page.tsx`）。
8. **与开标大厅分支的冲突面（并行开发评估结论）**：经逐文件核对（2026-07-24，Phase 2 `b9d03512` 后），两特性**无根本冲突、方向互补**（均把能力收口到 :3005）。共享文件仅两处、且是不同区域：
   - `apps/web/src/lib/api/bid.ts`——对方在 Phase 2 段（评标/澄清/归档封装，文件中段）追加，本迁移在评分标准段（:100-205 区间）追加 `publishScoreStandard/extractScorePoints/batchCreateScorePoints` 与两处类型字段，文本上基本可自动合并；
   - `apps/web/src/components/projects/bid-confirm-panel.tsx`——对方加了 `detail`/socket/区块5-8（文件上半与尾部），本迁移替换区块4（:647-886）并清理顶部评分 state/handler/import，区域不重叠但同文件，rebase 时可能需要人工对齐行号；
   - 其余迁移文件（`api.ts`、`modal.tsx`、`project-stage-timeline.tsx`、`project-detail-panel.tsx`、`bid/standard/page.tsx`、新建 `score-standard/` 目录、`seed.ts` 的口令块）对方均未触碰或锚点相距甚远。
   若并行会话在本迁移执行期间再发 Phase 3 改动到上述两文件，以内容锚点重定位（本计划各步骤已用注释/函数名锚点）。
