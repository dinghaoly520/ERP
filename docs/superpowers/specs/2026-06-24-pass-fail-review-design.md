# 资格审查 / 响应性审查 改为「通过 / 不通过」制

**日期**：2026-06-24
**分支**：`fix/seed-data-audit`（或新开分支）
**状态**：设计已确认，待写实现计划

## 背景

当前评分体系把 5 个类别（`QUALIFICATION` / `RESPONSIVE` / `BUSINESS` / `TECHNICAL` / `PRICE`）一视同仁地当作数值打分项：

- 评分标准页（`bid/standard`）对 5 类都让管理员填数字 `maxScore`。
- 专家打分页把每一项都渲染成数值滑块。标准模板把 `QUALIFICATION`/`RESPONSIVE` 建为 `maxScore: 0`，于是这两类的滑块变成 `min=0 max=0`——**完全坏掉**，专家只能永远打 0，"通过 / 不通过"根本无法录入。

文案里虽写着"资格审查 / 响应性为通过性审查（满分 0）"，但只是描述，无任何功能支撑。

## 目标

让 `QUALIFICATION`（资格审查）与 `RESPONSIVE`（响应性审查）两个类别成为真正的**通过 / 不通过**裁定，而非数值打分；并让"不通过"产生真实的**废标**后果。

## 已确认的关键决策

1. **不通过 = 废标**：资格/响应性不通过的供应商从候选人中剔除（标记废标，不中标）。
2. **过半数否决**：某通过性项，若给出裁定的专家中"不通过"票数 > "通过"票数（严格过半），则该供应商该项不合格；任一通过性项不合格 → 供应商废标。
3. **类型按类别硬编码**：`QUALIFICATION`/`RESPONSIVE` 恒为通过性；`BUSINESS`/`TECHNICAL`/`PRICE` 恒为打分制。不加每项配置列（YAGNI）。
4. **方案 1（新增 `passed` 字段）**：通过性裁定存入新列 `BidScoreRecord.passed`，数值项该字段为 `null`；通过性项的 `score` 固定写 0，**所有现有数值求和逻辑零改动**。

## 数据模型（一次迁移，加两列）

```prisma
model BidScoreRecord {
  // ...既有字段
  score  Decimal  @db.Decimal(5, 1)   // 数值项分数；通过性项固定 0
  passed Boolean?                      // 新增：通过性项裁定。true=通过 / false=不通过；数值项 null
  // ...
}

model BidEvaluationResult {
  // ...既有字段
  disqualified Boolean @default(false) // 新增：废标标记
  // ...
}
```

- 无需回填（nullable / 有默认值）。
- 类型判定由类别派生，**不在 `BidScoreItem` 加列**。
- shared 新增辅助 `isPassFailCategory(category: string): boolean`（`packages/shared`），返回 `category === 'QUALIFICATION' || category === 'RESPONSIVE'`。

## 后端改动

### `expert/dto/batch-score.dto.ts` — `ScoreItemDto`

- `score` 改为可选：去掉必填，保留 `@IsNumber() @Min(0) @Max(100)`（仅打分制项必填，由 service 层按类别校验）。
- 新增 `@IsBoolean() @IsOptional() passed?: boolean`。

### `expert.service.ts` — `submitScores`

- 查评分项的 `select` 增加 `category`（现仅 `id, maxScore`，见 `:382`）。
- 校验路由：
  - **打分制项**：要求 `score` 存在且 `≤ maxScore`（沿用现有 `:402-410` 逻辑）。
  - **通过性项**：跳过 maxScore 校验；要求 `passed` 为 boolean（缺省/非 boolean 报错）；落库时 `score = 0`、`passed = 值`。
- upsert（`:426-444`）的 `update`/`create` 增加 `passed` 写入（数值项写 `passed: null`）。
- `totalScore` 求和（`:460`）**不改**——通过性项 `score=0` 天然不进总分。

### `bid.service.ts` — 生成评标结果（`:944-1024`）

在现有按供应商聚合、去极值、排名逻辑之上叠加废标判定：

1. 额外批量查询该供应商集合的通过性项 `BidScoreRecord`（含 `passed`）。
2. 对每个供应商、每个通过性项：统计给出裁定的专家票数，`failCount` = `passed === false` 的票数，`verdictCount` = 给出裁定的总票数。若 `failCount > verdictCount - failCount`（不通过票严格过半）→ 该项不合格。
3. 任一通过性项不合格 → `disqualified = true`。
4. 排名：
   - 合格供应商按 `averageScore` 降序在前；废标供应商排在所有合格者之后，`recommended` 恒 `false`。
   - `rank` 仍连续编号（废标者排末位）。
5. 为每个废标供应商写一条监督日志：`action: '资格审查'`、`target: 供应商名`、`result: '因{资格/响应}性审查不通过废标（不通过 {failCount}/{verdictCount} 票）'`、`riskFlag: '高风险'`。

### `expert.service.ts` — `generateReport`（`:588-612`）

- `categoryScores` 中通过性类别的条目需携带裁定信息供前端渲染：在 item 上加 `passed?: boolean`（取该专家对该项该供应商的 `record.passed`）。
- 数值类别条目保持原样。
- `totalScore`（`:590`）**不改**。

### shared types（`packages/shared/src/types.ts`）

- `BidProjectDetail.scoreRecords` / `ExpertProjectDetail.myScores` 元素增加 `passed?: boolean | null`。
- 评审报告 `categoryScores` 的 item 类型增加 `passed?: boolean`。
- `BidEvaluationResult` 相关展示类型增加 `disqualified?: boolean`。

## 前端改动

### ① 评分标准页 `apps/bid-portal/.../bid/standard/page.tsx`

- 类别为通过性时：表格"满分"列改为只读 `通过性` 徽标（不显示数字）；新增行 / 编辑行的"满分"输入框对该类别隐藏或禁用。
- 创建/更新（`handleCreate` / `handleSaveEdit`）：通过性类别 `maxScore` 固定传 0。
- 顶部说明文案微调，确保"通过 / 不通过"语义清晰。

### ② 专家打分页 `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（内联 `:1065-1212`）

> `components/evaluate/scoring-step.tsx` 经核实**无任何引用**（死代码），本设计不动它。

- 通过性项：把"滑块 + 数值框"替换为两个按钮 **通过 / 不通过**（选中态高亮）；理由框文案改为"不通过理由（不通过时必填）"，通过时可留空。
- 打分制项：保持现有滑块 + 数值框。
- 汇总区：通过性类别显示"通过性审查"（或该项裁定），不显示"得分 X / Y"。
- 提交 payload 构造：通过性项 `{ scoreItemId, supplierId, passed, reason }`；打分制项照旧 `{ scoreItemId, supplierId, score, reason }`。
- 草稿（localStorage）结构兼容：`{ score, reason, passed? }`。
- 提交前校验：通过性项必须选了通过/不通过；不通过时必填理由。

### ③ 评审报告页 `apps/expert-portal/.../evaluate/[id]/page.tsx`（`:1240-1263`）

- 通过性类别渲染"通过 / 不通过"，不渲染"得分 / 满分"。

### ④ 评标结果 / 归档视图（bid-portal）

- 渲染 `evaluationResults` 时，`disqualified === true` 的行：显示红色 `废标` 徽标、行置灰、不显示候选人标记。
- 中标候选人仅从合格者中产生（后端已保证 `recommended=false`）。

## 种子数据（`apps/api/prisma/seed-data/`）

- `BidScoreRecord.json`：
  - hero 项目 `cmqhero-bid-proj01` 的 `QUALIFICATION`/`RESPONSIVE` 记录补 `passed`（多数 `true`）。
  - 可设某家 demo 供应商（如解密异常那家或一家陪标供应商）的响应性 `passed: false`，以演示废标链路；相应 `BidEvaluationResult` 该家 `disqualified: true`、排末位。
  - 其余项目（submit/open 等）的通过性记录同步补 `passed: true`。
- `BidEvaluationResult.json`：给被废标者补 `disqualified: true`，保证重算后一致。

## 测试

- `bid.service.spec.ts`：新增"通过性过半不通过 → 废标且排末位、不推荐"用例；"通过性刚好不过半 → 不废标"用例。
- `expert.service.spec.ts`：新增"通过性项接收 `passed`、跳过 maxScore 校验、落库 score=0"用例；"数值项仍校验 score ≤ maxScore"用例。
- 现有 `applyScoreItemTemplate` 等用例保持通过。

## 注意事项

- Prisma 迁移需**先停 `pnpm dev`**（Windows 下 engine dll 锁，见 memory `prisma-generate-needs-dev-stopped`）。
- 改完 `packages/shared` / `packages/config` 需重新 build。
- 通过性项 `score` 固定 0，保证 6 处数值求和点（`expert.service.ts:460/590`、`bid.service.ts:974/1114`、performance 统计、assistant 图表）**均无需改动**。

## 涉及文件清单

| 层 | 文件 |
|---|---|
| Schema / 迁移 | `apps/api/prisma/schema.prisma` + 新 migration |
| 后端 | `apps/api/src/expert/expert.service.ts`、`apps/api/src/bid/bid.service.ts`、`apps/api/src/expert/dto/batch-score.dto.ts` |
| 共享 | `packages/shared/src`（`isPassFailCategory` + 类型） |
| 前端 | `apps/bid-portal/.../bid/standard/page.tsx`、评标结果/归档视图、`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` |
| 种子 | `apps/api/prisma/seed-data/BidScoreRecord.json`、`BidEvaluationResult.json` |
| 测试 | `apps/api/src/bid/bid.service.spec.ts`、`apps/api/src/expert/expert.service.spec.ts` |
