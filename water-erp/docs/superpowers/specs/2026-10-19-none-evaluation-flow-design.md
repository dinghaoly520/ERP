# 直接采购（evaluationMethod=none）评标链路贯通设计

日期：2026-10-19 ｜ 状态：已裁定（用户 2026-10-16 选定方向 A；2026-10-19 确认全貌 + builder check 五问三裁两代定）
背景实录：2026-10-16 单一来源项目 SWHI-ZJ-2026101609（直接采购公告 — 2026年小曾测试直接采购001）开标完成后无法启动评标。

## 1. 问题

直接采购族（直接采购/直接委托/续约）固有映射 `evaluationMethod='none'`（`apps/api/src/bid/evaluation-method.config.ts:26`，2026-09-26 裁定「不评分是采购方式固有属性」），评分模板 `getScoreTemplate('none')=[]`。但链路各处对 none 的处理不一致：

| # | 环节 | 位置 | 对 none 的行为 |
|---|------|------|---------------|
| 1 | :3005 PMI 03「采购文件」完成闸 | `project-management.service.ts` `assertScoreStandardConfigured` | **豁免**（`evaluationMethod==='none'` → return） |
| 2 | :3007 启动评标 G9 | `bid.service.ts` `startEvaluation` → `assertScoreStandardComplete` | **无豁免** → 0 评分项 → `MAX_SCORE_SUM_NOT_100` 恒拦（现有 select 缺 `evaluationMethod`，需补） |
| 3 | 专家进度 | `score-recalculate.helper.ts` `recomputeExpertProgress` | `totalItems===0 → progress=0` → 报告步永久锁死 |
| 4 | 报告完成度 | `expert.service.ts` `getReport` 的 `perSupplierComplete` | `scoreItems.length>0 && …` → 0 项恒 false |
| 5 | 评分核对（BidScoreReview）闸 | `expert.service.ts` `confirmReport` 要求逐家 `verified`；`verifyScoreReview` 对 0 记录 400 `SCORING_INCOMPLETE` | **第五处死锁**（builder check 发现）：none 专家无从产生核对记录 → 确认报告恒 400 |

下游（`getWinnerCount('none')=1`、成交 1 家）已适配；0 记录聚合路径（总分 0、去极值空数组）经核安全。

## 2. 用户裁定

- **方向 A**：直接采购真的不评分——评标 = 专家定性审查 + 逐家核对确认 + 报告确认 + 结果生成（成交 1 家，成交价=开标唱标价）。
- :3005 不加新闸；none 项目在 :3005 的评分标准区块**不得显示为「未编制」缺口**（信息态「直接采购·不评分」）。
- **2026-10-19 三项裁定（「都按倾向」）**：
  - **① 核对闸取 方案**：none 项目保留逐家核对动作（承载「定性审查确认」），放宽 `verifyScoreReview` 的 0 记录拒绝；`confirmReport` 的 allVerified 闸与签字包核对签章**照常**（留痕链完整）。
  - **② 多家可评=方式错配**：none 项目 `generateEvaluationResults` 时可评供应商 >1 家 → 400 `NONE_MULTI_BIDDERS`（提示流标/更正采购方式），**不做**字母序/价格比选成交。
  - **③ 缺价硬拦**：none 项目唯一可评供应商无有效唱标价（缺失/不可解析）→ 400 `NONE_PRICE_REQUIRED`（正确性闸，非流程闸；万元单位事故前科在册）。

## 3. 目标 / 非目标 / 反目标

**目标**
1. none 项目全链贯通：启动评标 → 专家签到/回避/AI 声明/保密 →（跳过打分）→ 逐家核对确认 → 确认评审报告 → 组长末签 → 生成评标结果（1 家成交、价=唱标价）→ 签字包 → 回流归档。
2. none 口径单一来源（共享谓词），杜绝再漂移（本类漂移已两例：minBidders N4a、committee F9）。
3. 存量卡死专家（如 SWHI-ZJ 三位，修复前已签到/回避确认）随启动评标自愈。
4. 测试锁定 none 路径。

**非目标**
- 非直接采购方式的任何口径变化（manual/comprehensive/lowest_price/qualified_lowest_price 项目仍要求评分标准 Σ=100 配满）。
- 专家向导结构变化（签到/回避/AI/保密步骤保留；桌面版 7 步中的 compare 步不动）。
- committee 人数闸调整（3 人小项目例外已放行；放宽另立裁定）。
- 多轮谈判（rounds=0 语义、谈判轮 UI）——不在本次范围。
- 普通项目「可评集合为空」（全部回避/废标/撤回）的既有语义——保持 progress=0 不变。

**反目标**
- 给 none 项目编造 100 分评分标准以「绕过」G9（方向 B，已否决）。
- 前端硬编码 `procurementMethod==='直接采购'`——一律以 `evaluationMethod==='none'` 为准（直接委托/续约同族）。
- 字母序静默选成交人（②已裁定为硬拦）。

## 4. 改点清单

### 4.1 共享谓词（防漂移核心）

新建 `apps/api/src/bid/none-evaluation.util.ts`（或挂 `ScoreStandardValidator`）：

```ts
/** none（直接采购族）项目免评分标准——:3005 03 闸与 :3007 G9 唯一口径来源。
 *  null 时按采购方式派生（与 getWinnerCount 的 evaluationMethod ?? default 同语义，
 *  防未来创建路径漏写默认值重演死锁；谈判/邀请 null 派生≠none，既有闸行为零变化）。 */
export function isNoneEvaluation(
  evaluationMethod: string | null | undefined,
  procurementMethod?: string | null,
): boolean {
  const m = evaluationMethod ?? (procurementMethod ? PROCUREMENT_EVALUATION_MAP[procurementMethod]?.evaluationMethod : undefined);
  return m === 'none';
}
```

- `assertScoreStandardConfigured`（:3005）改调它（行为不变）。
- G9 处：`if (!isNoneEvaluation(project.evaluationMethod, project.procurementMethod)) await this.scoreStandardValidator.assertScoreStandardComplete(id);`（select 已含两字段）。

### 4.2 专家进度与完成度（死锁 ③④ 修复）

`score-recalculate.helper.ts` **精确口径**（builder check Q3 采纳细化版）：
- `expertScorableItems.length === 0 && activeIds.length >= 1` → `progress = 100`（无可评项=定性审查口径下已评完）。
- `activeIds.length === 0`（可评集合空，普通项目回避/废标/撤回殆尽）→ **维持 0**，不随本次改动漂移。
- `totalScore` 沿用 0。

**进度持久化与存量自愈**（builder check Q2，文档作者代定）：`startEvaluation` 对 none 项目在事务内置 `progress=100` 回填（`updateMany` 正选 confirmed 且 `progress<100`）——SWHI-ZJ 三位存量专家随启动评标解锁报告步；回避确认路径的重算（现有）作为后续第二道自然修复。不采用 GET 读路径自愈（热路径写放大）。

`expert.service.ts` 报告聚合：
- `perSupplierComplete`：0 评分项 → `true`。
- 报告 payload 附 `noneEvaluation: true` 供前端信息态分支。

### 4.3 评分核对（BidScoreReview）none 轨道（死锁 ⑤ 修复，用户裁定 ①b）

`expert.service.ts` `verifyScoreReview`：
- none 项目（`isNoneEvaluation`）0 评分记录不再 400 `SCORING_INCOMPLETE`——核对语义转为「定性审查确认」，正常落 `verified` 记录（签名/留痕字段照常）。
- `confirmReport` 的逐家 `verified` 闸（`REVIEW_PENDING`）与 `getReport.canConfirm` 的 `allVerified` **不变**。
- 签字包 `bid-sign-packet.service.ts` 消费核对行的逻辑**不变**（核对签章照常出现在包内）。

### 4.4 专家门户（:3006）向导

- 打分步（桌面 7 步中的 scoring）：依据 `noneEvaluation`（payload 随 step 数据下发）渲染信息态「本项目为直接采购（不评分），请审阅标书后于下一步逐家确认审查结论」，该步视为完成、放行。
- 核对步（verify-score）：none 项目文案改「定性审查确认」（表格无分数列，仅确认动作）；动作仍调用 `verifyScoreReview`。
- 定性结论载体：`confirmReport(userId, projectId, comment?)` 既有 comment 参数，**不新增 schema 字段**。

### 4.5 生成评标结果（:3007 后端，含裁定 ②③ 硬闸）

`bid-evaluation-results.service.ts`：
- **`NONE_MULTI_BIDDERS`**：none 且 `activeSuppliers.length > 1` → 400（文案：直接采购按单一成交对象口径，多家可评属采购方式错配，请流标或更正方式后重新组织）。
- **`NONE_PRICE_REQUIRED`**：none 且唯一可评供应商开标记录无有效价格（`parseAmountToYuan` 不可解析）→ 400（提示补录/更正唱标）。
- 通过性废标判定：0 个通过性项 → 无失败票（现有逻辑天然如此，加断言测试）。
- 聚合/去极值：0 记录 → 总分 0；单供应商直出 rank=1。
- `completenessWarnings`（正选投票数核对）：none 项目抑制（0 记录是设计态而非缺失）。
- `bidPrice`：来自开标记录 `parseAmountToYuan`（万元口径戳，2026-09-14 铁律）。

### 4.6 签字包（`bid-sign-packet.service.ts`，实施时定位具体工件）

《评标报告》与「个人评分确认表×N」对 none 项目：评分章节/确认表显示「直接采购·不评分」页（不渲染空表格）；核对签章照常（4.3）；其余十项法定内容照常。

### 4.7 前端信息态（三处）

- **:3005** 项目详情/开标确认面板评分标准区块：none 项目显示「直接采购·不评分——无需编制评分标准」信息态（非红牌/缺口）。**注意（2026-10-19 审查 F1）**：`ensureBidProject` 已有项目路径 select（`project-management.service.ts:466` 起）不含 `evaluationMethod`、返回 `{...existing}`——须在该 select 补 `evaluationMethod: true`（后端一行），前端 `apps/web/src/lib/api/bid.ts` `BidProjectRef` 同步加字段；创建路径 `buildEvaluationDefaults` 已写默认值、返回全行，无恙。
- **:3007** 评标管理 tab 评分矩阵：0 项空态文案同上（`totalSlots=0` 的 scorePct 已有 0 兜底）。
- **:3006** 见 4.4。

## 5. 约束

- **零 schema 迁移**（evaluationMethod/scoreItems/BidScoreRecord/BidScoreReview 现有结构足够）。
- **协作**：并行会话正在编辑 `expert.service.ts`/`expert.service.spec.ts`（2026-10-19 工作区脏）——实施须待其提交后再动工，避免同文件手术。
- **测试三处镜像铁律**：本设计不动 `packages/shared` 的 evaluation-rules；前端判断用各门户本地 `evaluationMethod` 字段。
- 启动评标 F9 前端镜像（`evaluation-view.tsx`）**不加**评分标准 blocker——none 免、非 none 已被 :3005 03 闸前置拦截。

## 6. 裁定汇总

| 裁定 | 来源 | 理由 |
|------|------|------|
| 方向 A（none=真不评分） | 用户 2026-10-16 | — |
| ① 核对闸取 方案（保留逐家核对动作） | 用户 2026-10-19「都按倾向」 | 留痕链完整（签字包消费核对行）；成本=每人每家一次点击 |
| ② none+多家可评 → 400 `NONE_MULTI_BIDDERS` | 用户 2026-10-19「都按倾向」 | 字母序静默选人有审计红线风险 |
| ③ none 缺有效唱标价 → 400 `NONE_PRICE_REQUIRED` | 用户 2026-10-19「都按倾向」 | 成交价是唯一实质条款；万元事故前科 |
| 进度持久化 = startEvaluation 事务内回填 100 | 文档作者代定 | 存量卡死专家自愈；GET 读路径自愈有热路径写放大 |
| 0 项=100 仅限「0 评分项且 ≥1 家可评」 | 文档作者代定 | 避免普通项目可评集合空（回避/废标殆尽）语义被带偏 |
| 专家仍走完整向导（签到/回避/AI/保密/纪律） | 文档作者代定 | 法定独立性与留痕 |
| committee 人数闸维持 | 文档作者代定 | 3 人小项目例外已走通；放宽另立裁定 |
| 定性结论走 confirmReport comment | 文档作者代定 | 已有字段，零迁移 |
| 谓词对 null evaluationMethod 按采购方式派生 | 审查 2026-10-19（F2） | 与 getWinnerCount 派生语义对齐；现库直接采购族全数已落 'none'，纯防御未来创建路径漏写 |
| AI 辅助评标（per-item）不动 | 文档作者代定 | 与评分无关，照常跑 |
| 评标时限（evaluationDeadline）照常适用 | 文档作者代定 | 超时闸只拦结果链，与 none 无冲突 |

## 7. 验收（端到端，用 SWHI-ZJ-2026101609 复测）

1. :3007 启动评标 → 无 400，进入 EVALUATING；三位存量专家 progress 回填 100。
2. :3006 专家签到 → 打分步显示「不评分」信息态 → 核对步「定性审查确认」（逐家 verify）→ 第 5 步确认报告（可填定性意见）。**含评标室口令环节**：startEvaluation 事务自动生成 roomCode（口令启用），专家验证/核对/确认全链须先过口令闸（主持人从 :3007 分发）。
3. 组长末签 → :3007 生成评标结果 → SCCA试点供应商 成交 1 家、价格=唱标价（1 亿元）。
4. 签字包生成 → 评分确认表位置显示「不评分」页、核对签章齐全。
5. :3005 评分标准区块显示信息态而非「未编制」。
6. 非 none 项目（如询比 manual）G9/03 闸/进度行为回归不变。
7. 负路径：none+2 家可评 → `NONE_MULTI_BIDDERS`；none 缺唱标价 → `NONE_PRICE_REQUIRED`。

## 8. 测试计划

- 单测：`isNoneEvaluation` + G9 豁免分支；`recomputeExpertProgress`（0 项+≥1 家=100 / 0 家=0）；`perSupplierComplete` 0 项=true；`verifyScoreReview` none 0 记录放行；`startEvaluation` none 回填 100；`generateEvaluationResults` none 路径（0 记录、单供应商、bidPrice 换算、completenessWarnings 抑制、双硬闸）。
- 回归：`committee-composition.util.spec`、`score-standard-validator.service.spec`、`score-standard-gate.spec`、expert.service 既有 spec 全绿。
