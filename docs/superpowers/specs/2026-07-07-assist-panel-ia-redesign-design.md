# 辅助评标页（AssistPanel）信息架构重排设计

- **日期**：2026-07-07
- **范围**：专家门户 `apps/expert-portal` 的辅助评标步（`step === 'assist'`，路由 `/evaluate/[id]`），即 `<AssistPanel>` 组件
- **边界**：仅 assist 步。不改动 compare（条款响应核对）/ scoring（专家打分）/ verify / documents / report 步
- **类型**：前端信息架构重排 + 后端口径修复 + 孤儿代码清理 + 顺带亮出已有数据丰富度

> **编号约定**：下文 section 3 的「① ~ ④」一律指**新设计**的四层（合规门 / 证据 / 打分 / 横向对比）。section 1 描述**现状**时只用文字名（评分分析区 / 关键信息区 / 数据一致性区 / 串通检测区 / 综合排名区），不带编号，避免与新设计撞车。

---

## 1. 背景与问题

当前辅助评标页（`apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx`，1378 行）有 5 个分区：评分分析 / 关键信息 / 数据一致性 / 串通检测 / 综合排名。诊断出三类结构性问题：

### 1.1 信息架构混乱（两个正交维度被压扁）
- **作用域**：单供应商（评分分析、关键信息、数据一致性）vs 跨供应商（串通检测、综合排名）混在一条编号列表里，无边界。
- **认知阶段**：结论（评分分析）排在证据（关键信息）之前；通过性门（资格/响应性，不通过=出局）和打分类（商务/技术/价格，比高低）被当成同一层级兄弟，抹掉了评审里最重要的"门 vs 分"区分。

### 1.2 数据口径错位
- 串通检测的 `fraudSummary` 取自 `AiBidReport`（每项目一份，service.ts:576-588），**对项目内每家供应商显示完全一样**，却塞在"单供应商深度剖面"的串通检测位。
- 两个 `riskLevel` 同名异源：项目级 `fraudSummary.riskLevel` vs per-bidder `AiBidderResult.riskLevel`（排名表列），分处串通检测区与综合排名区，专家难以分辨。
- 资格审查结论全页出现 3 次（StatusBar / 不通过阻断条 / 评分分析卡）。
- `reportDocxUrl`（项目级 AI 报告 DOCX）由 per-supplier 端点返回，但前端唯一消费者是孤儿 `tabs/report-tab.tsx`——live 代码无入口，属藏起来的死数据。

### 1.3 前端藏住了 AI 已产出的丰富度
prompt 侧要求丰富（`competitive-analysis.prompt.ts`：优势/不足各 3-6 条含 title/detail/evidence/impact、overallComment 200-400 字、keyObservations 具体要点；`item-scoring.prompt` 要求 per-item reason/evidence），但前端多处截断/隐藏：
- 评分类别 `CollapsibleSection` 默认折叠（assist-panel.tsx:484 未传 `defaultOpen`）。
- `ScoreBreakdownBars` `reasonLines=1` 单行截断、`evidence` 仅 `expanded` 时显示（score-breakdown-bars.tsx:55,73）。
- `confidence` 只聚合成"N 项<0.6"计数（assist-panel.tsx:517），无单项标注。
- `requirementResponses`（每条款状态/摘录/页码/verified）只在 compare 步展示，assist 步完全缺席。
- `starredResponse`（★实质性条款预算结论 `{allMet, unmet[]}`，AiBidderResult 字段）后端有、前端从未消费。
- `ExpertComparisonTable` 只显数字+偏差，无 reason。

> 说明：让 AI 本身产得更丰富/更聪明（prompt 工程、输出校验、加字段）是**独立工作流 Y**，不在本 spec 内。本轮只在前端"亮出已有数据"，不动 AI/prompt/worker。

---

## 2. 目标与非目标

### 目标
1. 按"单供应商决策级联 → 跨供应商收尾"重排页面，作用域边界显式化。
2. 把"通过性门"提升为独立门层，资格审查收敛到唯一权威呈现处；门层判据指定权威来源。
3. 打分层按"客观/主观"切分，两套密度对应两套对 AI 的信任。
4. 修复项目级数据口径：`fraudSummary`、`reportDocxUrl` 从 per-supplier 端点迁到跨供应商端点 + 跨供应商视图。
5. 清理孤儿代码（`tabs/`、`cross-bidder-overview.tsx`、`assist-kpi-card.tsx`、死 import、死 barrel）。
6. 在重做的卡片里取消截断/隐藏，把已存在的 evidence/confidence/requirementResponses/starredResponse 等亮出来；给项目级 AI 报告 DOCX 一个真入口。
7. 拆分 1378 行的 `assist-panel.tsx`，一层一文件。

### 非目标
- 不改 AI prompt / worker / 模型 / 输出校验（属工作流 Y）。
- 不动 compare / scoring / verify / documents / report 步。
- 不改视觉设计系统（glass-card、oklch 冷灰、tabular-nums、Lucide 1.5 描边、5 类评审色）。
- 不改供应商切换竞态保护（`assistSeqRef`）、WebSocket、降级/空/加载四态判断逻辑。

---

## 3. 设计

### 3.1 顶层骨架

整页 = 档案头条 + 单供应商区（三层）+ 跨供应商区（一层），作用域之间一条显式分隔线。

```
┌─ 档案头条（重构后的 StatusBar）──────────────────────────────────┐
│  供应商名·解密状态   投标报价   AI 总分   AI 模型+生成时间(provenance) │
├─ 单供应商区 ─────────────────────────────────────────────────────┤
│ ① 合规门      资格 + 响应性（客观·核查·pass/fail）+ 条款级证据摘要    │
│ ② 证据        关键信息(OCR 事实) → 数据一致性(质量子块)              │
│ ③ 打分        ③a 客观·价格（公式分·紧凑）                          │
│               ③b 主观·商务/技术（展开·置信度/evidence/条款佐证）     │
│               ③c AI 综合（关键观察 + 优势/不足 + 评语）             │
├─ 跨供应商区 ─────────────────────────────────────────────────────┤
│ ④ 横向对比    综合排名(表+雷达/柱+报价对比) + 本项目围标风险摘要      │
│               + 导出 AI 分析报告(DOCX)                              │
└──────────────────────────────────────────────────────────────────┘
页脚免责：以上结果由 AI 辅助生成，仅供参考，以专家独立评分为准。
```

### 3.2 档案头条（StatusBar 重构）

**移除**：资格审查（→门层）、风险等级（→跨供应商/门）、数据一致性（→证据层）、"我的评分"（属 scoring 步，此刻不存在）、"评审进度"（属后续步）。

**保留/新增**：

| 槽位 | 内容 | 说明 |
|---|---|---|
| 左 | 供应商名 + 解密状态点 | 落地确认"在看谁" |
| 中左 | 投标报价 | 最关键客观事实，原埋在关键信息里 |
| 中右 | AI 总分 | **降级显示**：不再 44px 英雄化（这是 AI 结论不是事实），克制字号 |
| 右 | AI 模型 + 生成时间 | provenance，右上角，支撑"仅供参考" |

> 子决策记录：曾考虑 "AI 总分 ↔ 我的评分" 并列对照，被否——专家打分在 assist 之后两步（assist→compare→scoring），此刻"我的评分"不存在。

### 3.3 ① 合规门（客观·核查）

- 内容：资格审查 + 响应性审查，pass/fail。
- **权威结论来源（消除双源歧义）**：
  - 资格审查 → 以 `AssistData.qualificationStatus`（string：通过/不通过/待审查）为权威判据。
  - 响应性审查 → 以 `AssistData.starredResponse.allMet`（★实质性条款预算结论）为权威判据。
  - `scoreItems` 里 QUALIFICATION/RESPONSIVE 的 `pass` 仅作展开明细，**不作门层判据**。
- **常驻展开**（不折叠）：横向"门带"。全过为紧凑绿带「资格 ✓ · 响应 ✓」；任一不通过整条变红。
- **阻断条归位**：资格不通过时的红色 `ShieldAlert` 条 + `[自动]` 说明（现 assist-panel.tsx:1289-1301）从"浮在头条下"挪到门带内部失败态，不再作独立横幅。
- **亮出条款级证据（B'）**：
  - 资格门：`requirementResponses`(category=qualification)「满足 X / 部分 Y / 不满足 Z / 未提及 W」计数 + 列出**不满足**条款（摘录 + 页码定位）。
  - 响应性门：用 `starredResponse`（`{ allMet, unmet[] }`）——`allMet=false` 时列出 `unmet[]` 的★条款，即为响应性不通过的可追溯证据。**不**再从 `requirementResponses` 里筛 `isStarred` 重新推导（已有预算字段，避免双源）。
- 效果：资格审查从原 3 处收敛到**门带 1 处**。

### 3.4 ② 证据

- 关键信息（`KeyInfoSection` 的 2×2 + 业绩网格）原样保留。
- **数据一致性从原数据一致性区挪入、降级为 ② 的质量子块**，紧跟关键信息（它本质是"②里那些 OCR 字段可不可信"）。原 `grid-cols-2` 把它和串通检测硬塞双列（assist-panel.tsx:1335）的排版随之消失。
- 投标报价同时出现在头条（数字速览）和关键信息（完整字段），保留两处——头条是瞥、字段有上下文。
- **亮出（B'）**：数据一致性当前 `slice(0,4)`（非一致项截到 4 条）改为显示全部非一致项，超长折叠。

### 3.5 ③ 打分（主观/客观切分）

按"AI 在客观项做核查、主观项做参谋"分三子块，每块带可信度小标签：

| 子块 | 类别 | 来源 | 密度 | 标签 |
|---|---|---|---|---|
| ③a 客观·价格 | PRICE | 公式计算 | 紧凑（见下） | `客观·公式` |
| ③b 主观·商务/技术 | BUSINESS/TECHNICAL | LLM 打分 | 展开（见下） | `主观·AI 建议` |
| ③c AI 综合 | 跨维度 | AI 综合 | 关键观察 + 优势 + 不足 + 评语 | `AI 综合` |

阅读顺序：③a 客观快览 → ③b 主观深读 → ③c 综合收尾。

**③a 客观·价格**：算得分 + 分析文字；**不显示** confidence/unstable（公式项无采样概念）。分析文字字段需实现前核实：`priceAnalysis` 仅存在于后端 ai-bid-analysis 内部类型（`apps/api/src/ai-bid-analysis/types/index.ts:336`），**不在前端 `AiScoreItem` 类型**。实现前抓一条真实 PRICE scoreItem 核实持久化层是否带 `priceAnalysis`——若带→给 `AiScoreItem` 补可选 `priceAnalysis` 字段后展示；若不带→退化为 `reason/evidence` 短文字。

**③b 主观·商务/技术（亮出 B'）**：
- 评分类别 `CollapsibleSection` **默认展开**（主观类）。
- per-item 卡：reason **多行不截断** + evidence **常驻显示**（不再 only-expanded）。
- 每项标注 **confidence**（低置信标红），保留聚合警告。
- 每项标注 **unstable**（若 true）。
- 技术/商务类 `requirementResponses` 作条款级佐证，附在对应类别下（响应摘要 + 最差几条的摘录定位）。
- `ExpertComparisonTable`（回看时，即 `expertScores` 存在时）加 **reason 列**（AI 理由 vs 专家理由对照）。

**③c AI 综合**：`overallComment` / `keyObservations` / `strengths` / `weaknesses` 全文展示，SWOT 不限条数全展示（现状即如此，写入 spec 防回退）。

### 3.6 ④ 横向对比（跨供应商）

- 现有 `RankingSection`（排名表 + 雷达/柱切换 + 报价对比）原样保留。
- **串通检测从原串通检测区（单供应商双列）挪入**作子块。
- 两个 riskLevel 各归其位、各标口径（**不合并**，它们是不同信号）：

| 信号 | 来源 | 粒度 | 去向 |
|---|---|---|---|
| per-bidder `riskLevel` | `AiBidderResult.riskLevel` | 每家不同 | 排名表"风险"列（已有，保留） |
| 项目级围标风险 | `AiBidReport.fraudIndicators` | 全项目一份、每家一样 | 底部摘要 callout，标注"本项目围标风险：高/中/低 · N 项指标 · 详情仅管理端可见" |

- 单供应商区**不再显示** riskLevel（避免又开重复出口；风险最有意义是在横向对比里）。`AssistData.riskLevel` 字段保留在类型中、后端仍返回，仅前端 assist 步不再渲染；per-bidder riskLevel 由 compare 端点在排名表展示。
- **导出 AI 分析报告（B' 亮出）**：④ 提供一个"导出 AI 分析报告（DOCX）"按钮，消费 `reportDocxUrl`。该 URL 是项目级（`AiBidReport.docxFileId` 产物，每家相同），是一份完整的 AI 分析报告，当前前端无入口（唯一消费者是待删孤儿 `tabs/report-tab.tsx`）。亮出来既给数据一个真家，也补强"AI 内容不够丰富"的体感。按钮放 ④（项目级数据归项目级视图）。

### 3.7 后端与类型修复（`apps/api/src/expert/expert.service.ts`）

**`getAssistData`（单供应商，:539-615）—— 删 AiBidReport 死查询，加 `starredResponse`**
- **整段删除 `AiBidReport` 查询及其产出**（service.ts:576-588 内）：它原来产出 `fraudIndicators`（→`fraudSummary`）和 `docxFileId`（→`reportDocxUrl`）两项。两者都是项目级数据，按 4(b) 决策一并迁到 `getAssistCompare`（见下）。per-supplier 端点不再保留这两个用途，故查询整段删。
- return 去掉 `fraudSummary`（:603）和 `reportDocxUrl`（:604）。
- `task` 查询（:567-570）**保留**——仍需 `task.requirements`（返回给 compare 步）和作为 `myReviews`（`BidRequirementReview`）查询的守卫。
- `myReviews` 查询（:585-587）**保留**——compare 步的条款标注要用。
- **新增返回 `starredResponse`**：`AiBidderResult.starredResponse`（`{ allMet, unmet[] }`）是 `findFirst` 默认取到的标量 Json 字段（:558 的查询已含），当前没 return。加进 return 即可，**零额外查询**。

**`getAssistCompare`（跨供应商，:618-645）—— 接收项目级 `projectFraudSummary` + `reportDocxUrl`**
- 复用已有的 `task`（:624），新增一次 `AiBidReport.findUnique({ where: { taskId: task.id }, select: { fraudIndicators: true, docxFileId: true } })`（即从 `getAssistData` 迁来的查询）。
- return 新增两个顶层字段：
  - `projectFraudSummary: { riskLevel: string; indicatorCount: number } | null`（从 `fraudIndicators` 派生，逻辑同原 :580-583）。
  - `reportDocxUrl: string | null`（`docxFileId ? '/api/upload/files/'+docxFileId : null`）。
- **前置依赖**：删孤儿（3.9）后 `RankingSection` 才是 compare 端点唯一 live 消费者（当前 `tabs/report-tab`、`tabs/scoring-tab`、`cross-bidder-overview` 也调用它，皆待删）。

**前端类型（`packages/shared/src/types.ts`）**
- `AssistData`（:228）补可选字段：`keyObservations?: string[]`、`starredResponse?: { allMet: boolean; unmet?: string[] }`。`fraudSummary` 不补（已从该端点移除）。
- 若 ③a 核实出 PRICE scoreItem 持久化了 `priceAnalysis`，则给 `AiScoreItem`（:14）补可选 `priceAnalysis?: PriceAnalysisDetail`（类型从 `apps/api/src/ai-bid-analysis/types/index.ts:336` 提到 shared，或就地轻量定义）。
- `RankingSection` 的 fetch 类型（assist-panel.tsx:921）从 `{ bidders: ComparedBidder[] }` 扩为 `{ bidders: ComparedBidder[]; projectFraudSummary: { riskLevel: string; indicatorCount: number } | null; reportDocxUrl: string | null }`。

**前端 `as any` 清理**
- `(assistData as any).fraudSummary`（assist-panel.tsx:1356，整段 `FraudSection` 调用随单供应商区串通检测一并删除）。
- `(assistData as any).keyObservations`（assist-panel.tsx:1317）→ 改用补好的 `AssistData.keyObservations` 类型化访问。

### 3.8 组件文件拆分（`assist-panel.tsx` 1378 行 → 一层一文件）

```
components/evaluate/assist/
  assist-panel.tsx          主壳：4 态判断(loading/空/降级/正常) + 四层编排，瘦到 ~150 行
  status-bar.tsx            档案头条（重构）
  gate-layer.tsx            ① 合规门（含阻断条归位 + 条款证据摘要 + starredResponse）
  evidence-layer.tsx        ② 证据（编排 关键信息 + 数据一致性子块）
  scoring-layer.tsx         ③ 打分层壳（编排 ③a/③b/③c）
  cross-bidder-layer.tsx    ④ 横向对比（原 RankingSection + 项目级围标摘要 + 导出报告按钮）
  shared/
    collapsible-section.tsx 折叠容器（多块复用）
    section-header.tsx      SectionNumber/SectionHeader
    pass-fail-card.tsx / sw-card.tsx / field-card.tsx / rank-badge.tsx
  charts/                   保留 4 个在用图：radar-chart / score-bar-chart / price-comparison-chart / score-breakdown-bars
```

scoring-layer 内部是否再拆 `scoring-subjective.tsx` 等，按实现时体积定（③b 偏大可单拆，③a/③c 小则留层内）。

### 3.9 孤儿代码清理

全部已 grep 确认零 live 消费者，删除：

| 删除目标 | 依据 |
|---|---|
| `components/evaluate/assist/tabs/` 整个目录（6 文件 + index.ts） | 无任何 live import（仅互相引用） |
| `components/evaluate/assist/cross-bidder-overview.tsx` | 只引用自身 |
| `components/evaluate/assist/charts/assist-kpi-card.tsx` | 唯一消费者在 `tabs/`（随之删） |
| `assist-panel.tsx:43` 的 `import { AssistKpiCard }` | 死 import |
| `components/evaluate/assist/charts/index.ts` | 死 barrel，无消费者 |

---

## 4. 数据流（改动前后）

**改动前**
```
切供应商 → GET /expert/projects/:id/assist/:sid
           → AssistData（含 fraudSummary、reportDocxUrl；无 starredResponse；keyObservations 走 as any）
④ 渲染   → GET /expert/projects/:id/assist/compare → { bidders[] }
```

**改动后**
```
切供应商 → GET /expert/projects/:id/assist/:sid
           → AssistData（去 fraudSummary/reportDocxUrl；新增 starredResponse；keyObservations 类型化）
④ 渲染   → GET /expert/projects/:id/assist/compare
           → { bidders[], projectFraudSummary, reportDocxUrl }
```

- `requirementResponses` 仍随 AssistData 返回（未变），assist 步现在也消费它（门层 + ③b 条款佐证），不再只给 compare 步用。
- `starredResponse` 新增返回，供门层响应性判据（零额外查询）。
- `projectFraudSummary`、`reportDocxUrl` 迁到 compare 端点，④ 渲染时一并拿到，不多发请求。

---

## 5. 验收口径

### 5.1 自动化
- `apps/api/src/expert/expert.service.spec.ts` 的 `describe('getAssistData')`（:161，两例）：断言 return **不再含** `fraudSummary`、**不再含** `reportDocxUrl`、**新增** `starredResponse`；其它字段（`source/scoreItems/.../reviews/requirements/requirementResponses`）不变。
- 为 `getAssistCompare` **新增**一例：断言返回 `projectFraudSummary`（从 mock 的 `AiBidReport.fraudIndicators` 正确派生 `riskLevel`/`indicatorCount`）与 `reportDocxUrl`（从 `docxFileId` 正确拼装）。
- `pnpm --filter api lint`、`pnpm lint`（expert-portal）通过。
- `pnpm --filter api test` 通过。
- TypeScript：`AssistData` 补 `keyObservations`/`starredResponse`；去掉 `(assistData as any).fraudSummary` 与 `(assistData as any).keyObservations`；compare 响应补 `projectFraudSummary`/`reportDocxUrl` 类型。无新增 `as any` 逃逸。

### 5.2 手动 IA 验收清单（主验收面）
1. 资格审查全页**只出现一次**（门层）；头条/独立阻断条/打分层不再见。
2. 门层判据：资格用 `qualificationStatus`、响应性用 `starredResponse.allMet`；`unmet[]` 列出于门带。
3. 串通检测在 ④，标注"本项目围标风险"；**切供应商时该摘要与"导出报告"按钮均不变**（验证确实项目级）。
4. ④ 有"导出 AI 分析报告（DOCX）"按钮，点击下载 `reportDocxUrl`。
5. 数据一致性在 ② 证据内部，不再与串通检测双列；非一致项不截到 4 条。
6. 打分层有 `客观·公式` / `主观·AI 建议` / `AI 综合` 三个标签；价格项**不显示** confidence/unstable 警告，商务/技术项**显示**。
7. 主观评分类别**默认展开**；per-item reason 多行不截断、evidence 常驻；每项标 confidence。
8. ③b 主观侧附技术/商务条款佐证；偏差表（回看时）含 reason 列。
9. 头条只含档案+报价+AI 总分+provenance，**无**"我的评分/评审进度/资格审查/风险/一致性"。
10. 四态（loading/空/降级/正常）正常；切供应商竞态保护（`assistSeqRef`）仍生效。
11. compare 步不受影响（它消费的 `assistData.requirements/responses/reviews` 未动）。
12. `grep -r tabs/ cross-bidder-overview AssistKpiCard` 在 `apps/expert-portal/src/` 下零命中。

### 5.3 实现前的前置核对（诚实前提）
抓一条真实 `AiBidderResult` 行，核对：
- `evidence / impact / confidence / requirementResponses / starredResponse` 的**实际填充率**。若普遍有值 → 按 spec 全量亮出；若某字段普遍为空 → 对应卡片优雅降级（有则显、无则隐），并将"字段稀疏"作为独立工作流 Y 的输入，不在本轮硬塞。
- PRICE scoreItem 是否持久化了 `priceAnalysis`（决定 ③a 是用 `priceAnalysis` 还是退化为 `reason/evidence`，以及是否要给 `AiScoreItem` 补类型）。

---

## 6. 风险与权衡

- **页变长**：默认展开主观类别 + evidence 常驻会增加纵向长度。靠门带紧凑、客观价格紧凑、`CollapsibleSection` 仍可手动收起来平衡。
- **requirementResponses 双消费**：assist 步（摘要）和 compare 步（全文）都用它。assist 只显摘要（计数 + 最差几条），不复制 compare 的三栏全文，避免重复。
- **偏差表首评不可见**：依赖 `expertScores`，首评时自动隐藏（沿用现 `hasComparison` 逻辑，assist-panel.tsx:453），仅回看出现。这是设计意图，非 bug。
- **`getAssistData` 测试可能隐性依赖 return 形状**：虽 grep 未发现 `fraudSummary`/`reportDocxUrl` 显式断言，实现时仍需跑 `describe('getAssistData')` 全例确认无回归。
- **类型上提**：若 PRICE `priceAnalysis` 需补类型，要从 ai-bid-analysis 内部类型提到 shared，注意不引入后端专属依赖。

---

## 7. 未尽事项（另立 spec）

- **工作流 Y**：让 AI 本身产得更丰富/更聪明（prompt 工程、输出校验 `LlmOutputValidator`、可能加字段）。以 5.3 的填充率核对结果为输入。
- compare 步的三栏 IA 是否随本次主观/客观语言统一，未在本次范围。
