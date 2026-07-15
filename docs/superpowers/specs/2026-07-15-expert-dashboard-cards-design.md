# 专家门户首页统计卡片精简设计

日期：2026-07-15
分支：`feat/standard-scorepoints`
涉及门户：专家门户 `apps/expert-portal`（:3006）

## 背景与问题

专家门户首页（`src/app/(app)/page.tsx`）顶部有四张统计卡片：`分配项目` / `进行中` / `已完成` / `平均得分`，下方项目列表标题为「我的评审项目」。用户反馈「不够清晰、名词不直接、卡片可精简」。

经核查根因不是文案润色，而是 **信息架构混乱 + 一处数据语义错位**：

| 卡片 | 背后字段 | 真实含义 | 问题 |
|---|---|---|---|
| 分配项目 | `stats.totalProjects` | 分配给我的项目总数 | 名称勉强，与下方列表标题「我的评审项目」语义重叠 |
| 进行中 | `stats.signedInProjects` | 我**已签到**的项目数 | ❌ 标签与数据对不上：签到 ≠ 进行中。后端 `pendingProjects`（待签到）已计算却未在卡片使用 |
| 已完成 | `stats.completedProjects` | progress≥100 的项目数 | OK |
| 平均得分 | `stats.averageScore` | 我对各供应商打分的均值 | ⚠️「得分」歧义，且对「现在该干嘛」无行动指引 |

「我的评审项目」列表实际只列 `OPENING/EVALUATING`（进行中）阶段前 5 条，标题却暗示全部，名实不符。

四张卡混合了四个维度（分配 / 签到 / 进度 / 评分），专家无法建立统一心智模型。

## 目标

- 卡片精简、命名直白、维度统一到「专家工作流进度」单一视角。
- 修复「进行中」标签与数据语义错位。
- 「平均得分」从驾驶舱移除（无行动价值），保留在更合适的位置。

## 设计

### 1. 首页统计区：四卡 → 三卡

统一到「专家工作流进度」维度（待办 → 进行中 → 完成），每张卡指向一个明确行动：

| 新卡片 | 数据来源 | 图标 | tone | 行动含义 |
|---|---|---|---|---|
| 待核验 | `stats.pendingProjects`（后端已有） | ShieldCheck | orange | 还没做身份核验 → 去签到 |
| 评审中 | `activeProjects.length`（与下方列表同口径：stage ∈ {OPENING, EVALUATING}） | Clipboard | purple | 正在开评标、需关注 → 去打分 |
| 已完成 | `stats.completedProjects`（progress≥100） | CheckCircle | green | 已完成评分（参考） |

- 布局：`md:grid-cols-4` → `md:grid-cols-3`；loading 骨架同步 4 → 3。
- 「评审中」数字 = 下方列表的项目数，卡片与列表口径自洽。
- 说明：`pendingProjects`（!signedIn）与 `activeProjects`（按阶段）在后端是不同口径，理论上可能轻微重叠（如 stage 已到 EVALUATING 但专家未签到）。本设计**不追求数学上严格互斥**——语义上三者各指向一个明确行动（去签到 / 去打分 / 参考），对专家足够清晰。这是有意的取舍，避免为消歧引入额外后端字段。

### 2. 项目列表标题

「我的评审项目」→ **「进行中的评审」**。名实相符：下方列出的正是进行中的项目。

### 3. 平均得分移至「个人信息」页

首页移除 `平均得分` 卡。该指标属于专家画像而非驾驶舱，挪到 profile 页（`src/app/(app)/profile/page.tsx`）。

- 后端 `getProfile`（`expert.service.ts:33-49`）已在 `assignments[].scoreRecords` 中带回评分数据。在 `getProfile` 返回值中增加 `averageScore`，**复用 `getStatistics` 的口径**（按 supplierId 累加 score → 对各供应商总和求平均），以保证两处一致、单一数据源。
- 推荐抽取共享 helper（如 `computeAverageScore(records)`），供 `getStatistics` 与 `getProfile` 共同调用，避免算法漂移。
- profile 页统计区现有三卡（参与项目 / 已完成 / 评分记录）末尾新增第 4 张「平均给分」卡，布局由 `md:grid-cols-3` 改为 `md:grid-cols-4`。

## 改动清单

| 文件 | 改动 |
|---|---|
| `apps/expert-portal/src/app/(app)/page.tsx` | 卡片区 4→3（待核验/评审中/已完成）；`grid-cols-4`→`grid-cols-3`；骨架 4→3；移除 `平均得分` 卡与未再使用的 `TrendingUp` import；列表标题改为「进行中的评审」 |
| `apps/expert-portal/src/app/(app)/profile/page.tsx` | `ExpertProfile` 接口加 `averageScore: number`；统计区加「平均给分」卡；`grid-cols-3`→`grid-cols-4` |
| `apps/api/src/expert/expert.service.ts` | 抽 `computeAverageScore` helper；`getStatistics` 与 `getProfile` 共用；`getProfile` 返回值增 `averageScore` |
| `packages/shared/src/types.ts` | 无需改动（`ExpertStatistics` 已含全部字段） |

## 不做（YAGNI）

- 不新增后端 statistics 字段（`pendingProjects` 已存在）。
- 不追求三卡数学严格互斥（见上文字意取舍）。
- 不改 `getStatistics` 的返回契约（仅内部抽 helper，行为不变）。
- 不动 profile 页其它卡片与评审记录区。
- 不引入可视化对比/图表。

## 测试

- `apps/api/src/expert/expert.service.spec.ts`：
  - 新增 `getProfile` 返回 `averageScore` 的断言（与 `getStatistics` 同口径）。
  - `getStatistics` 既有用例保持通过（回归，验证抽 helper 未改变行为）。
- 前端 `page.tsx` / `profile/page.tsx` 无单测，靠手动验证：首页三卡渲染、列表标题、profile 四卡含平均给分。
- `pnpm --filter api test` 全绿；`pnpm --filter @water-erp/shared build`（types 未改，可跳过）。
