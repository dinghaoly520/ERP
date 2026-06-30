# 专家条款响应对比视图（可标注 · 中联动）

> 日期：2026-06-30
> 范围：`apps/api`（ai-bid-analysis + expert）、`apps/expert-portal`、`packages/shared`
> 前置：已完成的「专家评审页招标文件预览」（2026-06-29）— 本特性复用其招标文件解密链路与专家门控。

## 背景与动机

专家在评标时，核对"招标要求 ↔ 投标响应"是核心动作。当前：

- **招标文件预览**（已完成）：专家只能在新标签页看招标 PDF 原文。
- **辅助评标 assist step**：AI 已算出 `scoreItems`（带 evidence/页码）、`concordance`（系统数据 vs 标书）、`starredResponse`（★ 号条款满足清单），但**没有"以招标条款为骨架的逐条响应对照"**，专家仍需肉眼在两个 PDF 间来回切换。
- `starredResponse.unmet` 只是条款名字列表，**无页码、无原文摘录、无逐条对应**。

专家真正需要：**逐条**看"招标第 N 条要求（含★）↔ 投标在第几页怎么响应的 ↔ 是否满足"，并能对存疑条款留下标注、带入评审报告与打分页提示。

## 现状（调查结论）

- **OCR 管线已存在**：`local-ai/ocr.service.ts` → `ocrPdf(buffer)` 调 :8100 rapid OCR，返回 `{ text, pages }`（分页文本）。招标与投标均已走通。
- **招标条款已结构化**：`tender.processor` → `tenderExtractor.extract` → `TenderRequirements`，存 `aiBidAnalysisTask.requirements`。结构：
  - `qualificationRequirements[]{ id, category, content, isRequired, evidenceType, threshold }`
  - `technicalRequirements[]{ id, category, content, isStarred, weight, measurable, acceptanceCriteria }`
  - `commercialRequirements[]{ id, category, content, isRequired }`
- **投标侧已有证据**：`aiBidderResult.scoreItems[]{ evidence, reason }`（evidence 是"章节/页码/原文摘录"），`bidder-info` 的 attachments 带 `pageLocation`。
- **★ 条款响应核查已算**：`generic-item-scorer` 产出 `starredResponse{ allMet, unmet[] }`，docx 报告已渲染该段落。
- **关键缺口**：
  1. 招标条款 id 是 LLM 生成的序号（`q1/t1/c1`），**重跑会变** → 持久化标注会失联。
  2. 评分项（5 类打分用）≠ 招标条款（响应核查用，颗粒度不同），两者无逐条映射。
  3. `starredResponse.unmet` 仅名字，无页码/原文定位。
  4. 专家 `getAssistData`（`expert.service:420`）当前**不返回** `requirements` 与逐条响应。

## 设计

### 数据模型

**1. `AiBidderResult` 扩展字段**（需 migration）：

```
requirementResponses Json?   // matcher 产物，逐条响应定位
```

结构：
```ts
interface RequirementResponse {
  requirementId: string;      // 稳定 id（见下"requirementId 稳定化"）
  category: 'qualification' | 'technical' | 'commercial';
  tenderContent: string;      // 招标条款原文（冗余存，前端免再 join）
  isStarred: boolean;
  status: 'met' | 'partial' | 'unmet' | 'not_found';
  excerpt: string;            // 投标响应原文摘录
  location: { fileId: string; page: number } | null;  // 跳转定位
  confidence: number;
}
```

**2. 新表 `BidRequirementReview`**（专家标注，per expert × bidder × requirement）：

```
model BidRequirementReview {
  id             String   @id @default(cuid())
  projectId      String
  bidderResultId String   // → AiBidderResult.id
  expertId       String   // → BidExpert.id（标注仅本人可见）
  requirementId  String   // 稳定 id
  category       String
  verdict        String   // ack | dispute | doubt
  note           String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([projectId, bidderResultId, expertId, requirementId])
  @@map("bid_requirement_reviews")
}
```

### requirementId 稳定化（必做，堵风险 1）

`tenderExtractor` 落库 `requirements` 前，对每条 requirement 重算稳定 id，**覆盖** LLM 生成的 `q1/t1/c1`：

```ts
// 规范化：去 ★ 号、去空白、去标点、小写 → sha256 前 10 位
function stableReqId(category: string, content: string): string {
  const norm = `${category}|${content}`.replace(/[★\s\p{P}]/gu, '').toLowerCase();
  return sha256(norm).slice(0, 10);
}
```

- tenderExtractor 输出后、`aiBidAnalysisTask.requirements` 写入前统一重算 id。
- matcher 读 `requirements` 时 id 已稳定，`requirementResponses[].requirementId` 与 `BidRequirementReview.requirementId` 均引用之。
- 重跑 AI 分析：同内容 → 同 id → 标注不丢；内容改了视为新条款（合理）。

### matcher（条款-响应定位器）

在 `bidder.processor` 流程末尾加一步（复用 `LLMService` + 现有 BullMQ，不引入向量库）：

输入：
- `requirements`（已稳定 id 的招标条款）
- 投标 OCR 分页文本：合并 tech/biz 多份 `ocrResult.pages`，每页标注 `{ fileId, page, text }`（fileId = 对应 `FileAsset.id`）

处理：新 prompt `requirement-matching.prompt.ts`，对每条 requirement 让 LLM 在分页文本中定位响应，产出 `{ status, excerpt, location, confidence }`。

输出：`requirementResponses[]` → 写 `aiBidderResult.requirementResponses`。

成本：投标商数 × 条款数次 LLM 调用，单项目 3-5 商 × ~20 条，异步队列内可接受。

### 后端端点（expert）

| 端点 | 作用 |
|---|---|
| `getAssistData` 扩展 | 增返 `requirements`（招标条款）+ `requirementResponses` + 本人 `reviews`（标注） |
| `GET /expert/projects/:id/assist/:supplierId/reviews` | 取本人在该投标商的标注列表 |
| `POST /expert/projects/:id/assist/:supplierId/reviews` | upsert 标注（body: `{ requirementId, category, verdict, note }`），唯一约束自动 upsert |
| `getMyScores` 扩展 | 增返「本人异议条款所在的 category 集合」（条款与评分项非一一对应，映射粒度为 **category 级**：该 category 下任一条款被标异议 → 该类评分项需提示） |

所有标注端点复用现有专家门控（项目阶段 OPENING/EVALUATING + 本人 BidExpert 已签到/回避）。

### 联动（B 中联动）

- **评审报告**：`report-generator` / `docx-generator` 把**本人**的异议（verdict=dispute）条款加入报告——扩展现有「★ 号条款响应核查」段落，增"专家异议"小节。报告仍可确认（不阻断）。
- **打分页**：因条款与评分项非一一对应，联动粒度为 **category 级**——含异议的 category 评分区高亮，并要求专家勾选一个 category 级「已核对异议」确认后才能提交该供应商评分。**打分仍 100% 专家定，系统不改分、不阻断确认**。

### 前端（expert-portal）

**落点**：AssistPanel（assist step 主体，现有 5 个编号分区）新增「条款响应对比」分区，**插在 ①评分分析 之后**（成为新 ②，后续 ③–⑥ 顺延）。分区编号为 SVG 实心圆（`SectionNumber n={}`），改 prop 重编号，纯文案成本。

**组件结构**：

```
<section>
  <SectionHeader number={2} title="条款响应对比" subtitle="· 招标条款 ↔ 投标响应" />
  <RequirementComparePanel
    requirements={assistData.requirements}
    responses={assistData.requirementResponses}
    reviews={assistData.reviews}
    supplierName={supplierName}
    onReview={(payload) => upsertReview(payload)} />
</section>
```

内部按 `category`（qualification/technical/commercial）分组，每组复用现有 `CollapsibleSection`；组内每条 requirement 一行**横向卡片**，三列：

- **招标条款**：★ 标记 + content + acceptanceCriteria/threshold
- **AI 响应**：status 徽标（met/partial/unmet/not_found，复用 `CONCORDANCE_STATUS_CONFIG` 配色）+ excerpt 摘录 +「跳转投标原文」`<a href="/api/upload/files/{fileId}#page={page}" target="_blank" rel="noopener">`（投标文件明文，PDF `#page=N` 浏览器 viewer 原生支持）
- **标注**：verdict 单选（ack/dispute/doubt）+ 备注 textarea；异议(dispute)行整行 amber 高亮（仿 `SwCard` `border-l-amber-400`）；失焦/变更触发 `POST .../reviews` upsert

**打分页联动（scoring step）**：打分页已按 `category` 分组（`grouped[category]` + `CATEGORY_COLOR` 左边框），联动天然契合：

- `getMyScores` 增返「本人异议条款所在 category 集合」
- 命中 category 分组：加 amber 角标「⚠ 有异议条款待核对」+ 组内一个「已核对异议」checkbox
- `submitScores` 前校验：命中 category 未勾选则 `toast.warning` 拦截（复用现有 `missingReasons` 拦截模式）
- **不改分值、不阻断报告确认**，仅在提交瞬间要求看一眼

**降级态**（复用现有模式）：`requirements` 空 → 仿「AI 正在分析…」占位；`requirementResponses` 空但 `starredResponse` 有 → 降级显示 unmet 清单（只读）；完全无数据 → 现有空态卡片。

**视觉一致性**：卡片行、可折叠、status 徽标、category 分组高亮均复用现有积木，不引入新视觉范式，符合 `.impeccable.md` 设计系统。

**类型**：`packages/shared` 的 `AssistData` 增 `requirements` / `requirementResponses` / `reviews`；新增 `RequirementResponse`、`BidRequirementReview` 类型；改完须 `pnpm --filter @water-erp/shared build`。

**前端验证**：expert-portal 无单测设施，靠 `tsc --noEmit` 类型检查 + 浏览器手验（对比视图渲染、标注 upsert、打分页高亮拦截、`#page` 跳转）。

### 合规边界（硬约束）

- 系统**不改分、不阻断报告确认**。
- 异议只做：①评审报告披露 ②打分页高亮 + 该评分项强制二次确认。
- 标注**仅本人可见**（per-expert），对齐 `BidScoreRecord` 各评各的模式。

### 降级

- AI 分析未跑完（`requirements` 空）→「分析中」占位。
- 无招标文件 / 无 requirements → 空状态。
- matcher 失败 / `requirementResponses` 空 → 降级显示已有 `starredResponse.unmet` 清单（只读，无页码）。

## 测试策略

TDD（Red-Green-Refactor），单测位于各 service 的 `.spec.ts`：

- **requirementId 稳定化**：同 (category, content) → 同 id；★号/空白/标点差异 → 同 id；内容变 → id 变。
- **matcher**（mock LLMService）：给定 requirements + 分页文本 → `requirementResponses` 正确（status/excerpt/location{fileId,page}）；多文件合并后 fileId 正确归属。
- **标注 CRUD**：upsert 新建、upsert 更新、读取仅本人（隔离其他专家）、唯一约束生效。
- **getAssistData**：增返 requirements/requirementResponses/reviews；门控 403 用例。
- **联动映射**：异议条款 → 关联评分项映射正确（按 category 对齐）。
- **报告扩展**：docx-generator 含本人异议条款段落。
- 解密/OCR 逻辑已被现有管线覆盖，不重复测。

## 非目标（YAGNI）

- 不做 embedding/向量检索（投标商少，LLM 逐条足够）。
- 不做跨专家标注可见（评标独立）。
- 不做自动扣分/符合性自动不通过（合规红线）。
- 不做条款级原文编辑/批注（仅状态标注 + 备注）。
- 不做实时多人协同。

## 实现修正（plan 阶段发现）

写实现计划时核对代码发现两处需修正 spec 的实现假设：

1. **fileId 来源**：matcher 的 `location.fileId` 需投标文件 `FileAsset.id`，但 `plaintextFetcher.fetchBidderPlaintext` 现状只返回 buffer（内部已查到 assetId 未暴露）。实现须扩展其返回 `{ buffer, fileId }`。
2. **报告时序**：`docx-generator` 在 AI 分析完成时（`checkTaskCompletion`）生成，**早于**专家评审；专家异议（评标时产生）无法入该 docx。故异议改入**专家评审报告**（`getReport` 返回的 `EvaluationReport.myDisputedReviews`），随 `confirmReport` 确认——非 AI docx 报告。

（已在实现计划 Global Constraints 与 Task 4 / Task 11 体现。）

## 风险与应对

| 风险 | 应对 |
|---|---|
| requirementId 不稳定致标注失联 | **必做**稳定化（content-hash），见上 |
| 多投标文件页码跳到错文件 | `location.fileId` 必带，matcher 合并分页文本时保留 fileId |
| LLM 条款-响应误配 | 专家可标异议兜底；`confidence` 低时前端标黄 |
| matcher 成本 | BullMQ 异步 + removeOnComplete；单项目量级可控 |
| AI 分析未跑完 | 降级占位（见上） |
