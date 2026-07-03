# 评标流程 AI 能力 —— 优先级落地办法

> 配套文档：[`评标流程AI能力扩展机会.md`](./评标流程AI能力扩展机会.md)
> 本文把上文的「五、优先级建议」6 项展开为可直接施工的落地方案，每项含 schema / 服务 / prompt / API / 前端 / 降级 / 测试 / 工作量 / 验收。
> 整理日期：2026-07-03　·　**v2 审查修订版（2026-07-03）**
> 范围：`water-erp/apps/api/`（NestJS + Prisma）及对应前端门户

---

## 〇、优先级总览

| 优先级 | 编号 | 项 | 价值定位 | 工作量 |
|---|---|---|---|---|
| **P0** | A | AI 输出可信度与质量保障 | 不解决它，其余能力都建在沙堆上 | **2.5 人日** |
| **P0** | D | AI 使用披露与可审计 | 合规刚性、实现成本低 | **2.5 人日** |
| **P1** | E | 评分 delta 数据飞轮 | 零成本积累、长期复利 | 2 人日 |
| **P1** | F | 澄清答疑 LLM 辅助 | 流程最大空白、投入产出比高 | **2 人日** |
| **P2** | B | 评标 → 履约闭环 | 决定系统能否进化 | 5+ 人日 |
| **P2** | C | 水利行业知识深化 | 差异化护城河，依赖 Embedding 基建 | 基建 5 人日 + 场景各 2–3 人日 |

> 建议节奏：Sprint 1 做 A+D（打地基，约 **2.5 周**）；Sprint 2 做 E+F（见效快）；B/C 视业务节奏推进。
>
> **v2 工作量上调原因**：A1 校验改用模糊匹配、A3 需处理代码顺序、D 剥离报告撰写后仍偏紧、F 补 expert 端入口（详见各节）。

---

## 一、前置风险（开工前必须确认）

> ⚠️ 据 [[ai-bid-migration-status]] 记录，`ai-bid-analysis` 后端 Phase 1–5 虽完成，但**缺真实 MinIO 投标文件**，整条流水线很可能从未在真实 LLM 输出上跑通过。

**影响**：本方案 A1 的模糊匹配阈值、A2 的 confidence 触发阈值（0.6）与方差阈值（20%）**全是估计值，无实测支撑**。

**开工动作**：先用真实（或贴近真实）的招标/投标文件跑一次端到端，观察：
- `requirementMatcher` 产出的 excerpt 与原文的真实相似度分布 → 校准 A1 阈值；
- `genericItemScorer` 各 category 的 confidence 分布 → 校准 A2 阈值。

不做这一步，A1/A2 上线即可能在真实数据上误报成灾。

---

## 二、通用约定（所有方案必须遵守）

下列约定来自 `CLAUDE.md` 与现有代码，是任何扩展的硬约束。

1. **AI 永远只是建议，不落官方分** —— `BidScoreRecord` 只记专家本人打的分。AI 结果只能进 `reason / evidence` 或独立展示区。**打分相关能力扩展时，必须守住这条合规红线。**
2. **降级链不断** —— 每个 LLM 调用都要有规则 fallback。DeepSeek 全挂也能评标。新增能力最差返回「空建议 + 提示」，绝不允许 500 阻塞主流程。
3. **BullMQ 异步 + Redis 缓存** —— 重 LLM 调用走队列；`ai-bid-analysis/services/cache.service.ts` 的 prompt/task 缓存必须接上。
4. **`chatJson<T>` 真实签名**（`local-ai/llm.service.ts:69`）：
   ```ts
   chatJson<T>(
     systemPrompt: string,
     userPrompt: string,
     temperature = 0,
     signal?: AbortSignal,   // 第 4 参是取消信号，不是 maxTokens
     seed?: number,          // 第 5 参是数字，不是 string
   ): Promise<T>
   ```
   - **没有 `maxTokens` 参数**——需限制输出长度只能写进 prompt。
   - **`seed` 是 `number`**——要可复现/可变 seed 时，统一用 `deterministicSeed(str)`（接 string、返回 number）生成，**不要手写字符串拼接当 seed**。
   - 评估类用 `temperature=0`；需要多样性的（self-consistency、起草候选）调高。
5. **Prisma 迁移（非交互环境）**：`prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`，或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`。
6. **测试规范**：每个 service 都有 `*.spec.ts`（见现有 `generic-item-scorer.service.spec.ts` 等）。新/改 service 必须补单测，含降级路径用例。

---

## 三、P0-A：AI 输出可信度与质量保障

> **问题本质**：整条 `ai-bid-analysis` 流水线目前是「LLM 说什么就信什么」，没有任何输出校验。评标场景里 LLM 幻觉是硬伤——给错页码、捏造摘录、单次采样方差大——一旦专家点进去发现对不上，对 AI 的信任就崩了。这一项不性感但最该先做。

### A1. 页码溯源真实性校验

**现状定位**：`ai-bid-analysis/services/requirement-matcher.service.ts:25-44`
LLM 自报 `{ excerpt, page, confidence }`，代码只把 `file/page` 拼成 `location` 透传，**完全不验证 excerpt 是否真出现在第 page 页**。

**目标**：每条 `RequirementResponse` 带 `verified` 标记；摘录在原文找不到的，前端标黄降权，让专家知道「这条 AI 没复核通过」。

**方案（✅ 已实现）**：把校验抽成纯函数 `verifyExcerpt`（`ai-bid-analysis/utils/excerpt-verify.ts`），在 `requirement-matcher.service.ts` 的 `match()` 内对每条 LLM 响应调用——既易单测，又让 matcher 只做「调函数 + 拼装」。

1. **相似度算法：bigram 覆盖率，不是 Jaccard**（实现时的关键修正）。excerpt（几十字）远短于页面（几百字），Jaccard 分母是并集 → 逐字摘录也会被压到 ~0.1 判负；覆盖率 `|A∩B|/|A|`（excerpt 的字符 bigram 有多少能在页面找到）分母是 excerpt 自身 → 逐字摘录 ≈ 1、改写 0.7–0.9、无关 ≈ 0，符合「摘录是否真出自该页」语义。
   - 归一化：全角→半角 + 小写 + 去标点/空白（保留 `\p{L}\p{N}`，含 CJK）；
   - 命中目标页（覆盖率 ≥ 阈值）→ `verified: true`；
   - 目标页未命中但别页 ≥ 阈值 → `verified: true, correctedPage`（同步覆盖 `location.page`，修正 AI 报错的页码）；
   - 全标书都低于阈值 → `verified: false`，且 `confidence × 0.5` 降权；
   - 阈值默认 **0.55**，env `AI_EXCERPT_VERIFY_THRESHOLD` 可调（**未经真实数据实测，需按前置风险节校准**）。
2. **类型扩展**：`packages/shared/src/types.ts` 的 `RequirementResponse` 加 `verified?: boolean`、`pageCorrected?: boolean`。
3. **前端**（待接）：`expert-portal` 辅助评标页对 `verified === false` 标 `⚠️ AI 摘录未在标书中复核通过`，跳转按钮置灰或跳到 correctedPage。

**降级**：校验是纯本地字符串比对，不依赖 LLM，无降级风险。

**测试（✅ 已完成）**：`utils/excerpt-verify.spec.ts` 9 用例——逐字命中 / 轻度改写 / 别页命中 + correctedPage / 无关 / 空 excerpt / targetPage=null / 全角标点归一化 / 阈值边界（字母构造精确 coverage 0.5）/ pages 空。matcher 侧回归由全量 ai-bid-analysis 覆盖（13 suites / 78 tests 通过）。

**工作量**：**0.5 人日**（实做）　**状态**：后端已落地；前端 ⚠️ 标记待接。**性能注**：`verifyExcerpt` 每次调用重算页面 bigram，典型项目毫秒级；超大项目可在 `match()` 开头预算一次。

---

### A2. 评分 self-consistency（多次采样一致性）

**现状定位**：`ai-bid-analysis/services/generic-item-scorer.service.ts:55-87`
一次性 `chatJson`（`temperature=0`、固定 `deterministicSeed`），结果直接落 `scoreItems`。主观高分项方差大时，单次采样不可靠。

**目标**：对低置信项自动复跑，方差大的标「不稳定」，请专家重点复核。成本可控——只复跑少数项。

**方案**：

1. 在 `score()` 末尾，对首轮 `confidence < UNSTABLE_THRESHOLD`（默认 0.6，走 env `AI_SCORE_UNSTABLE_THRESHOLD`）的项触发复跑：
   ```ts
   private async rescoreUnstable(items: AiScoreItem[], ctx, taskId, bidSupplierId): Promise<AiScoreItem[]>
   ```
   - 复跑 `N=2` 次，`temperature=0.3`，seed 用 `deterministicSeed(`${base}:rescore:1`)` / `...:2`（**返回 number，勿字符串拼接**）；
   - 三次（含首轮）取 `score` **中位数**；`confidence` 重算为 `1 − std/mean`（clip 到 [0,1]）；
   - 若 `max−min > maxScore × 20%` → 该项 `unstable: true`。
2. `AiScoreItem` 类型（`ai-bid-analysis/types/index.ts:320`）加 `unstable?: boolean`。
3. 前端打分卡：`unstable` 项展示「⚙️ AI 把握度低，请重点复核」徽标，但不强制阻塞。
4. **成本控制**：阈值之外的项不复跑。

   > ⚠️ **缓存说明（v2 修正）**：首轮 `temperature=0` + 固定 seed 走 `cache.service` 命中、幂等；**复跑用新 seed 必然缓存 miss，这是预期成本，不是 bug**——不要误以为能靠缓存省掉复跑调用。是否复跑完全由 confidence 阈值把关。

5. **统计同质性备注**：严格说，首轮 `temperature=0` 与复跑 `temperature=0.3` 分布不同质，混合取中位数是工程近似。如追求严谨，可改为三轮都用 0.3（首轮仅用于触发判断）。列为可选优化。

**降级**：复跑 LLM 失败 → 保留首轮结果，`unstable` 不置位；不阻塞。

**测试**：`generic-item-scorer.service.spec.ts` 补：(a) 全高置信→不触发复跑；(b) 低置信触发、三次结果聚合正确；(c) 高方差→unstable 置位；(d) 复跑抛错→保留首轮、不阻塞。

**工作量**：1 人日　**验收**：mock 低置信返回，能看到复跑日志与 `unstable` 标记；高置信项确认未被复跑。

---

### A3. ★条款符合性 → 资格判定强联动

**现状定位**：
- `generic-item-scorer.service.ts:91` 产出 `starredResponse`（LLM 打分时附带），`bidder.processor.ts:293` 写入 `AiBidderResult`；
- **`qualificationStatus` 在 `bidder.processor.ts:211` 赋值**，但依据只是 `qualConflict`（资质冲突），**未纳入 `starredResponse.unmet`**。
- **`scoreResult`（含 `starredResponse`）在 `bidder.processor.ts:187-194` 由 `genericItemScorer.score()` 产出，211 行判定时已可用**——无需二次 update，直接在 211 行扩展判定即可。（v2 曾误判存在顺序陷阱，经核对源码已更正。）

**方案（✅ 已实现）**：把判定逻辑抽成纯函数 `resolveQualification`（`ai-bid-analysis/utils/qualification.ts`），在 `bidder.processor.ts:211` 直接调用——既有单测覆盖各组合，又让 processor 只做「调函数 + 拼装」。

1. **纯函数** `resolveQualification({ qualConflict, starredResponse, concordanceConflictCount, concordanceWarningCount })` → `{ qualificationStatus, riskLevel, autoNote }`：
   - `qualificationStatus` = `qualConflict || unmet.length>0 ? '不通过' : '通过'`（统一中文口径）；
   - `riskLevel`：`unmet` 或 concordance conflict → high；仅 warning → medium；否则 low；
   - `autoNote`：有 `unmet` 时产 `[自动] 存在未响应的 ★实质性条款：xxx`，供 overallComment 拼接。
2. **processor 接入**（`bidder.processor.ts:207-217`）：用解构替换原 `qualificationStatus`/`riskLevel` 三元；`autoNote` 在写入 `overallComment`（295 行）时换行拼入。
3. 前端辅助评标页：`qualificationStatus==='不通过'` 且 `overallComment` 含 `[自动]` 时，红色阻断卡片。
4. **红线**：仍只是「建议」——最终资格审查走专家在 `BidScoreRecord.passed` 的裁定（`submitScores` 强制通过性项必须有 `passed`，见 `expert.service.ts:708-716`）。

**降级**：`starredResponse` 缺失（null/undefined/unmet 缺失）时，纯函数安全降级为「视为无未响应」，维持 `qualConflict` 判定（已覆盖于单测）。

**测试（✅ 已完成）**：`utils/qualification.spec.ts` 8 个用例——无冲突 / qualConflict / unmet 单条与多条 / riskLevel 升级 / 其他字段 conflict / 仅 warning / starredResponse null / unmet undefined。processor 侧回归由既有 `queues/bidder.processor.spec.ts` 覆盖（全量 ai-bid-analysis：12 suites / 69 tests 通过）。

**工作量**：**0.5 人日**（实做）　**状态**：后端已落地；前端红卡展示待接。

---

## 四、P0-D：AI 使用披露与可审计

> **问题本质**：目前 LLM 调用「只存结果不存过程」——`AiBidderResult` 落结构化字段，但用了哪个模型、哪版 prompt、原始返回是什么，全无记录。归档包（`exportArchivePackage`）也不含「本项哪些字段参考了 AI」。政府招标越来越要求披露 AI 使用，质疑投诉时也需自证清白。

**现状定位**：
- `AiBidAnalysisTask` 无 `modelVersion / promptVersion`；
- `exportArchivePackage`（`bid.service.ts`）CSV/JSON 导出有「专家评分明细」「监督日志」节，无 AI 节。

**范围（v2 修正）**：P0-D **仅做快照 + 披露**。文档原文第 3 条「报告 NL 撰写」**剥离出 P0-D，建议单独立项**——它是独立的中价值项，夹带会让 P0-D 职责不清、工作量失真。

**目标**：每次评标留两个快照——① 用了什么模型/prompt；② 每家供应商哪些评分项产出了 AI 建议。归档包带「AI 辅助说明」节。（专家采纳率依赖 P1-E，P1-E 未实施前先只披露「哪些项产出了 AI 建议」。）

**方案**：

1. **schema**：`AiBidAnalysisTask` 增字段
   ```prisma
   model AiBidAnalysisTask {
     ...
     aiProvenance  Json?  // { model, modelVersion, ranAt, promptVersions: { tenderExtract, score, match, competitive, ... } }
   }
   ```
2. **prompt 版本号**：给 `ai-bid-analysis/prompts/*.prompt.ts`（共 8 个）每个文件加 `export const PROMPT_VERSION = 'v1'`；改 prompt 时 bump。
3. **写快照**：`task.service` 创建任务时初始化 `aiProvenance`；各 processor 执行时把自己的 `PROMPT_VERSION` 合并进去；`llm.service` 暴露当前 `model`（已从 env `DEEPSEEK_MODEL` 读）。
4. **归档导出加节**：
   - JSON：`exportArchivePackage` 返回对象加
     ```ts
     aiUsage: {
       model, modelVersion, ranAt,
       suppliers: [{ name, aiScoredItemsCount: number, aiSuggestedTotal: number }]
     }
     ```
     （取自 `AiBidderResult.scoreItems` 与 `totalScore`。）
   - CSV：新增 `=== AI 辅助说明 ===` sheet（供应商 / AI 建议评分项数 / AI 综合分 / 模型版本）。

**红线**：披露只陈述事实（哪些项用了 AI、模型版本），**不暗示 AI 参与决策**——决策主体是专家。

**降级**：`aiProvenance` 写失败仅 warn，不影响主流程。

**测试**：(a) 任务创建→aiProvenance 有 model 字段；(b) 改一版 prompt 后 promptVersions 对应 key bump；(c) 归档 JSON/CSV 均含 AI 节、字段齐全。

**工作量**：**2.5 人日**（8 个 prompt 加版本号 + schema 迁移 + 双格式导出改 + 测试）

**验收**：归档导出含 AI 节；改 prompt 后版本号可见 bump。

> 📎 文档原文第 3 条「评标报告 NL 撰写」不在本节。建议作为独立 P1 项：在 `report-generator` 生成 `AiBidReport.conclusion` 时调一次 LLM 写评审纪要，降级用模板拼装。

---

## 五、P1-E：评分 delta 数据飞轮

> **问题本质**：`submitScores`（`expert.service.ts:737` 事务）落 `BidScoreRecord.score`，而 `genericItemScorer` 早先产出了 AI 建议 score。**两者之差 = 专家对 AI 的修正信号**，是宝贵的免费训练/校准数据，目前完全丢弃。

**目标**：每位专家每次评分，自动 join 出 `aiScore` 并入仓；提供统计 API 用于 AI 校准与专家反向复核。

**方案**：

1. **schema**：新建
   ```prisma
   model BidScoreDelta {
     id                  String   @id @default(cuid())
     projectId           String
     expertId            String
     supplierId          String
     scoreItemId         String
     aiScore             Decimal  @db.Decimal(5, 1)
     expertScore         Decimal  @db.Decimal(5, 1)
     delta               Decimal  @db.Decimal(5, 1)  // expert − ai
     accepted            Boolean                      // |delta| ≤ maxScore×10% 视为采纳
     aiConfidence        Decimal? @db.Decimal(3, 2)
     expertReportConfirmed Boolean @default(false)
     createdAt           DateTime @default(now())
     @@unique([expertId, scoreItemId, supplierId])
     @@index([projectId])
     @@index([expertId])
     @@map("bid_score_deltas")
   }
   ```
2. **落点**：在 `submitScores` 的 `$transaction` 内（`expert.service.ts:749` 的 upsert 循环后），批量 upsert `BidScoreDelta`：
   - **事务前一次性**查该项目所有 `AiBidderResult`（按 `bidSupplierId`），把 `scoreItems` JSON 解析成 `Map<supplierId, Map<scoreItemId, {score, confidence}>>`，避免逐项查询；
   - **v2 关键修正：排除通过性项**。`QUALIFICATION` / `RESPONSIVE` 类专家端 `score` 固定为 0（`expert.service.ts:716`），数据在 `passed` boolean，与 AI 数值 score 不可比。**只对 category ∈ {TECHNICAL, BUSINESS, PRICE} 写 delta**，其余跳过——否则 `ai-calibration` 会被污染成「AI 在资格审查项系统性虚高」。
   - 计算 `delta` 与 `accepted`。
3. **`expertReportConfirmed` 置位**：`confirmReport`（`expert.service.ts:1042`，1073 行置 `reportConfirmed=true`）成功后，把该专家本项目的 delta 批量 `expertReportConfirmed = true`。
4. **统计 API**（`bid.controller` / `ai.controller`）：
   - `GET /api/bid/projects/:id/ai-adoption` → 项目级采纳率、按 category 拆分；
   - `GET /api/ai/ai-calibration` → 跨项目：哪类条款 AI 系统性高估/低估；
   - `GET /api/expert/:id/ai-deviation` → 哪些专家长期与 AI 分歧最大（反向复核专家，反哺 `shouldDeactivateExpert`）。
5. **前端**：`web` 工作台驾驶舱加「AI 建议采纳率」指标卡（`@water-erp/ui` 的 `MetricCard`）。

**降级**：`AiBidderResult` 缺失（走 rules_fallback 的项目）→ 不写 delta，不报错。

**测试**：(a) 数值项→delta 正确；(b) **通过性项→不写 delta**；(c) 无 AiBidderResult→静默跳过；(d) confirmReport 后 expertReportConfirmed 批量置位；(e) 多次改分→delta 取最新。

**工作量**：2 人日（含 3 个统计 API + 前端指标卡）　**验收**：专家评分后 `BidScoreDelta` 有数值项记录、通过性项无记录；驾驶舱显示采纳率。

---

## 六、P1-F：澄清答疑 LLM 辅助

> **问题本质**：文档判定的「最大流程空白」。澄清答疑目前纯手填——有两个入口：`bid.service.ts:1391`（招标方/host）和 **`expert.service.ts:905`（专家，这才是文档原文说的主场景）**。

**目标**：① 专家/招标方发起澄清时，LLM 基于该供应商的 AI 分析结果起草候选问题；② 供应商回复后，LLM 提炼要点回填给全体评委。

**方案**：

1. **新建** `apps/api/src/bid/clarification-ai.service.ts`：
   ```ts
   draftQuestion(projectId, supplierId): Promise<{ drafts: string[]; basis: string[] }>
   //   输入 = AiBidderResult.weaknesses + unmet/partial 的 requirementResponses + 相关 ★条款
   //   输出 = 3 条候选问题 + 引用依据

   summarizeReply(clarificationId): Promise<{ summary: string; keyPoints: string[] }>
   //   输入 = question + reply 全文
   //   输出 = 提炼要点
   ```
2. **prompt**：新建 `ai-bid-analysis/prompts/clarification-draft.prompt.ts`、`clarification-summary.prompt.ts`（加 `PROMPT_VERSION`，与 P0-D 一致）。**输出长度限制写进 prompt**（`chatJson` 无 maxTokens 参数）。
3. **API（v2 修正：两端都挂）**：
   - 专家端（主）：`POST /api/expert/projects/:id/clarifications/draft` → `expert.service.draftClarification`（新建）→ 调 `clarification-ai.draftQuestion`
   - 招标方端：`POST /api/bid/projects/:id/clarifications/draft` → 调同一 service
   - 回复摘要：`POST /api/bid/projects/:id/clarifications/:cid/summarize` → 写入 `BidClarification.aiSummary`
4. **schema 微调**：`BidClarification` 加 `aiSummary String?`（与 `reply` 并列，不覆盖原文）。
5. **前端（v2 修正：两端都改）**：
   - `expert-portal`（主）：澄清发起弹窗加「✨ AI 起草」按钮；
   - `bid-portal`：同样按钮；
   - 回复列表（两端）加可折叠「AI 摘要」块。

**降级**：LLM 失败 → `drafts: []`，前端隐藏 AI 按钮、不影响手填；`summarize` 失败 → 不写 `aiSummary`。

**红线**：起草的问题是**建议**，必须由人改完再发——draft 端点**不落库**，`createClarification`（两个入口）仍是唯一入库途径。

**测试**：(a) 有 weaknesses→生成针对性草稿；(b) 无 AiBidderResult→返回空 drafts 不抛错；(c) summarize→写入 aiSummary；(d) draft 端点确认不落库。

**工作量**：**2 人日**（补 expert 端入口）　**验收**：专家端与招标方端都能 AI 起草；回复后看到 AI 摘要。

---

## 七、P2-B：评标 → 履约闭环

> **问题本质**：评标链路止于 `ARCHIVED`，中标后合同履约不回流。无法回答「AI 评高分的后来真的履约好吗」——模型无法自我迭代。

**现状**：`prisma/schema.prisma` 无 Contract / Performance / Acceptance 模型；`ProcurementProject`（:892）有合同相关阶段但无履约评价数据。

**范围澄清（v2）**：履约是评标**之后**产生的数据，**只能影响供应商在未来项目中的 `riskLevel`，不能回灌已评标项目**。下文统一按此表述。

**方案**（战略，分两期）：

1. **schema**（一期，手工录入即可启动）：
   ```prisma
   model SupplierPerformance {
     id              String   @id @default(cuid())
     supplierId      String
     projectId       String?                       // 跨项目聚合时 null
     qualityScore    Decimal  @db.Decimal(4, 1)
     scheduleScore   Decimal  @db.Decimal(4, 1)
     changeCount     Int      @default(0)
     acceptanceStatus String  @default("pending")  // pending / accepted / disputed
     comment         String?
     evaluatedAt     DateTime @default(now())
     supplier        Supplier @relation(fields: [supplierId], references: [id])
     @@index([supplierId])
     @@map("supplier_performances")
   }
   ```
2. **数据来源**：一期支持 `web` 工作台手工录入；二期对接 `Procurement` 合同执行 / 外部验收单。
3. **对未来项目的回灌**：
   - 该供应商**下次参标**时，`fraudDetector` / `riskLevel` 计算 join 其近 N 次 `SupplierPerformance` 均值，作为「历史履约风险因子」叠加；
   - 供应商画像（`expert-portrait.util.ts`）展示履约趋势。
4. **AI 校准**：离线统计「AI 当初评 top1（高分）但履约评分低」的比例 → 指导 prompt 迭代；与 P1-E delta 交叉（AI 高分 + 履约差 + 专家也修正低分 = 三方一致的负面信号）。

**降级**：无履约数据时维持现有 riskLevel 计算。

**依赖**：P1-E（delta）让校准闭环完整；否则只能单向回灌。

**测试**：(a) 录入差评履约→下次该供应商参标时 riskLevel 因子上浮；(b) 无履约数据→riskLevel 不变。

**工作量**：5+ 人日（不含外部系统对接）　**验收**：录入一条差评履约后，下次参标 riskLevel 可见上浮。

---

## 八、P2-C：水利行业知识深化

> **问题本质**：文档第 5 条把 Embedding 当成通用基建项。但水利招标的专业壁垒（工程量清单、图纸、SL 规范、专项资质）恰是通用 DeepSeek 最弱处，值得单独立项，是差异化护城河。

**现状**：`llm.service.ts` 注释明说剥离了 Embedding；`assistant/knowledge/system-knowledge.ts` 硬编码；`plaintextFetcher` + rapid OCR 纯文本，丢表格结构；`expert-conflict.service.ts:32` 的资质/单位匹配是字面 `includes`。

**方案**（战略，依赖 Embedding 基建，分模块）：

1. **Embedding 基建**（前置）：引入 embedding（DeepSeek embedding API 或本地 `bge-m3`），PostgreSQL 装 `pgvector`（需确认 `docker-compose.yml` 的 PG 16 镜像装了扩展），建 `EmbeddingService`。抽象 `EmbedderProvider` 接口，与 `LlmService` 同层。
2. **水利专业库 RAG**：SL 系列规范、定额、资质等级标准 → 向量化；`assistant` 知识从硬编码切到 RAG 检索。
3. **BOQ / 表格结构化**：`plaintextFetcher` 路径补表格识别（PP-Structure 等），保留工程量清单 → 解锁「不平衡报价检测」「报价与工程量自动复核」。
4. **资质语义核验**：用 embedding 相似度替代 `expert-conflict.service.ts:32` 的 `includes`，覆盖「四川水发建设有限公司 vs 水发建设集团」改写型；也用于投标资质 vs 招标资质要求的等级/范围匹配。
5. **升级 fraudDetector**：`utils/text-similarity.ts`（字面）→ 语义相似度，更能抓改写型围标。

**降级**：每个 embedding 场景保留字面匹配 fallback（无 embedding 时退回现状）。

**工作量**：基建 5 人日；每个场景 2–3 人日　**验收**：assistant 能检索到 SL 规范条目；资质匹配能识别改写型同名。

---

## 九、实施路线图

```
Sprint 1（地基，约 2.5 周）
  ├─ 前置：真实文件端到端 + 阈值校准     1d
  ├─ P0-A1 页码校验（模糊匹配）         0.75d
  ├─ P0-A3 ★条款联动（处理顺序）        0.75d
  └─ P0-D  AI 披露（不含报告撰写）       2.5d
  → 交付物：AI 输出「可信」+ 归档「可审计」

Sprint 2（见效，约 2 周）
  ├─ P0-A2 self-consistency             1d
  ├─ P1-E  数据飞轮（排除通过性项）      2d
  └─ P1-F  澄清辅助（专家+招标方两端）   2d
  → 交付物：采纳率指标上线 + 澄清端 AI 按钮

Sprint 3+（战略，按业务节奏）
  ├─ 报告 NL 撰写（从 P0-D 剥离）        1d
  ├─ P2-B 履约闭环                      5d+
  └─ P2-C 水利知识深化                   基建 5d + 场景滚动
```

**贯穿检查项**（每个 PR 都要过）：
- [ ] 是否守住「AI 不落官方分」？
- [ ] LLM 调用是否有规则 fallback、失败是否不阻塞主流程？
- [ ] `seed` 是否用 `deterministicSeed()` 生成 number、未手写字符串拼接？
- [ ] 新 prompt 是否 bump `PROMPT_VERSION` 并被 `aiProvenance` 记录？
- [ ] 重 LLM 调用是否接 `cache.service.ts`？
- [ ] 新/改 service 是否补了 `*.spec.ts`（含降级用例）？
- [ ] 是否误把通过性项（QUALIFICATION/RESPONSIVE）当数值项处理？

---

## 附：v2 修订记录

相对 v1 的关键修正（基于源码核对）：

1. `chatJson` 签名更正：第 4 参是 `AbortSignal`（非 `maxTokens`）、`seed` 是 `number`（非 string）——通用约定与 A2 的 seed 用法连带修正。
2. A1 校验从「子串匹配」改为「模糊匹配 + 阈值」，避免对 LLM 改写型 excerpt 大量误判。
3. A3：`qualificationStatus` 原仅基于 `qualConflict`。v2 曾误判「211 行早于 starredResponse 产出、需二次 update」，**经核对源码更正**：`scoreResult` 在 187-194 行产出、211 行已可用。实际落地为抽 `resolveQualification` 纯函数 + 211 行直接调用（**已实现，8 单测 + 全量回归通过**）。
4. P0-D 剥离「报告 NL 撰写」（文档原文第 3 条单列），工作量 1.5d → 2.5d。
5. P1-E delta 排除通过性项（QUALIFICATION/RESPONSIVE），避免污染校准统计。
6. P1-F 补 expert 端入口（`expert.service.ts:905` 才是主场景），工作量 1.5d → 2d。
7. 新增「前置风险」节：流水线未经真实数据端到端验证，A1/A2 阈值需实测校准。
8. 每项补「测试」小节；总览/路线图工作量重估。

---

## 实现进展

- **A3（2026-07-03）✅ 后端已落地**：抽 `utils/qualification.ts:resolveQualification` 纯函数 + 接入 `bidder.processor`；8 单测 + 全量回归通过。前端红卡待接。
- **A1（2026-07-03）✅ 后端已落地**：抽 `utils/excerpt-verify.ts:verifyExcerpt` 纯函数（bigram 覆盖率，非 Jaccard）+ 接入 `requirement-matcher`；9 单测 + 全量回归通过。阈值 0.55 待真实数据校准。前端 ⚠️ 标记待接。
