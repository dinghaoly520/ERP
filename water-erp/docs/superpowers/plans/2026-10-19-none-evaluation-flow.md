# 直接采购（none）评标链路贯通 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `evaluationMethod='none'`（直接采购族）项目免评分标准，全链贯通：启动评标 → 专家定性审查/逐家核对 → 报告确认 → 生成结果（1 家成交、价=唱标价）→ 签字包。

**Architecture:** 五处对 none 的死锁/不一致统一拉齐：新建共享谓词 `isNoneEvaluation` 作唯一口径源（G9 豁免、:3005 闸复用）；专家侧修 progress/perSupplierComplete/核对闸三处；结果生成加两道正确性硬闸；签字包与三门户前端补「不评分」信息态。零 schema 迁移。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、Next.js 16 三门户、jest 单测（co-located `*.spec.ts`）。

**Spec:** `docs/superpowers/specs/2026-10-19-none-evaluation-flow-design.md`（含全部裁定依据；执行者必读）

## Global Constraints

- 零 schema 迁移；禁改 `packages/shared/src/evaluation-rules.ts`
- none 判定唯一入口：新建 `isNoneEvaluation`（Task 1）；任何地方不得写裸 `=== 'none'` 或按 `procurementMethod==='直接采购'` 分支
- 金额读端一律 `parseAmountToYuan`（万元口径铁律，spec §4.5）
- 新错误码字面量：`NONE_MULTI_BIDDERS`、`NONE_PRICE_REQUIRED`（与 `apps/api/src/common/error-codes.ts` 既有风格一致，无需登记该文件——它按需收录对外常量，本两码仅在 service 内使用）
- 每任务 TDD（先失败测试）；提交信息 `feat(none-eval):`/`fix(none-eval):` 中文，末行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；**禁止 `git add -A`**，逐文件 add
- 动工前置（全计划）：`git status` 确认 `apps/api/src/expert/expert.service.ts` 与 `expert.service.spec.ts` 无未提交改动（并行会话占用中，spec §5）；有则停下等提交
- 回归基线：`pnpm --filter api test` 全绿才算任务完成

## Review Focus

1. 普通项目可评集合空（全部回避/废标/撤回）progress 被误抬 100 → 必须保持 0 —— Task 2 测试锁定
2. 非 none 项目（manual/comprehensive）G9 被误放行 → 标准不完整仍须 400 —— Task 1 测试锁定
3. none + ≥2 家可评时按供应商名字母序静默成交 → 必须 400 `NONE_MULTI_BIDDERS` —— Task 5 测试锁定
4. none 唱标价缺失/不可解析 → 无价中标通知书静默生成 → 必须 400 `NONE_PRICE_REQUIRED` —— Task 5 测试锁定
5. 非 none 项目 `verifyScoreReview` 0 记录被误放行（`SCORING_INCOMPLETE` 语义）→ Task 4 测试锁定
6. 存量卡死专家（已签到/回避确认、stored progress=0）启动评标后不自愈 → Task 3 测试锁定 updateMany 谓词

---

### Task 1: 共享谓词 `isNoneEvaluation` + G9 豁免 + :3005 闸复用

**Files:**
- Create: `apps/api/src/bid/none-evaluation.util.ts`
- Create: `apps/api/src/bid/none-evaluation.util.spec.ts`
- Modify: `apps/api/src/bid/bid.service.ts`（`startEvaluation`：select 补 `evaluationMethod`；G9 调用处包裹）
- Modify: `apps/api/src/project-management/project-management.service.ts`（`assertScoreStandardConfigured` 内 `if (bp.evaluationMethod === 'none') return;` 改调 util，行为不变）
- Test: `apps/api/src/bid/none-evaluation.util.spec.ts`、`apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: `isNoneEvaluation(evaluationMethod: string | null | undefined, procurementMethod?: string | null): boolean`（Task 3/4/5/6 消费；null 时按 `PROCUREMENT_EVALUATION_MAP` 派生——审查 F2，导入自 `apps/api/src/bid/evaluation-method.config.ts`）
- Produces: G9 语义——`isNoneEvaluation(project.evaluationMethod, project.procurementMethod)` 为真时跳过 `assertScoreStandardComplete`，否则行为不变（select 已含两字段：`procurementMethod` 已在、`evaluationMethod` 需补）

- [ ] **Step 1: 失败测试（util 纯函数）**

```ts
// none-evaluation.util.spec.ts
describe('isNoneEvaluation', () => {
  it('none → true；manual/comprehensive/lowest_price/null/undefined → false', () => {
    expect(isNoneEvaluation('none')).toBe(true);
    expect(isNoneEvaluation('manual')).toBe(false);
    expect(isNoneEvaluation('comprehensive')).toBe(false);
    expect(isNoneEvaluation(null)).toBe(false);
    expect(isNoneEvaluation(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测确认失败** — `pnpm --filter api test -- none-evaluation` → FAIL（模块不存在）
- [ ] **Step 3: 实现 util** — 文件头注释：`/** none（直接采购族）项目免评分标准——:3005 03 闸与 :3007 G9 唯一口径来源（spec 2026-10-19 §4.1） */`；函数体：`const m = evaluationMethod ?? (procurementMethod ? PROCUREMENT_EVALUATION_MAP[procurementMethod]?.evaluationMethod : undefined); return m === 'none';`（util spec 补两断言：`isNoneEvaluation(null, '直接采购')===true`、`isNoneEvaluation(null, '谈判采购')===false`）
- [ ] **Step 4: 跑测通过** — 同命令 → PASS
- [ ] **Step 5: G9 豁免失败测试** — 先 `rg -n "startEvaluation" apps/api/src/bid/bid.service.spec.ts` 确认既有用例基建；有则在其 describe 内加两条用例：none 项目（`evaluationMethod:'none'`，scoreItems 空）`startEvaluation` 不因标准被拦（不抛 `MAX_SCORE_SUM_NOT_100`）；manual 项目 scoreItems 空仍抛该码。若该 spec 无 startEvaluation 基建，按同文件既有 PrismaService mock 模式新建最小 describe（只 mock G9 前置链路所需 findUnique/count 返回）。断言以错误码为准（`rejects.toMatchObject({ response: { code: ... } })` 或本 spec 既有断言风格）
- [ ] **Step 6: 实现 G9 豁免** — `startEvaluation` 顶部 `findUnique` 的 select 加 `evaluationMethod`；G9 行（`await this.scoreStandardValidator.assertScoreStandardComplete(id);`，约 :2166）改为 `if (!isNoneEvaluation(project.evaluationMethod)) await this.scoreStandardValidator.assertScoreStandardComplete(id);`，行上注释注 spec §4.1
- [ ] **Step 7: :3005 闸改调 util** — `assertScoreStandardConfigured` 的裸比较改 `if (isNoneEvaluation(bp.evaluationMethod)) return;`（导入 util）
- [ ] **Step 8: 跑 `pnpm --filter api test -- none-evaluation bid.service` 与 `score-standard-gate`** → 全 PASS（后者回归 :3005 闸行为不变）
- [ ] **Step 9: Commit**

```bash
git add apps/api/src/bid/none-evaluation.util.ts apps/api/src/bid/none-evaluation.util.spec.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/project-management/project-management.service.ts
git commit -m "feat(none-eval): isNoneEvaluation 共享谓词 + G9 豁免——直接采购免评分标准启动评标"
```

---

### Task 2: `recomputeExpertProgress` 精确口径（0 项且 ≥1 家可评 = 100）

**Files:**
- Modify: `apps/api/src/bid/score-recalculate.helper.ts`（`progress` 计算行）
- Test: `apps/api/src/bid/score-recalculate.helper.spec.ts`（已存在，加用例）

**Interfaces:**
- Consumes: 无（纯 helper）
- Produces: 语义变更——`expertScorableItems.length===0 && activeIds.length>=1 → progress=100`；`activeIds.length===0 → progress=0`（不变）

- [ ] **Step 1: 失败测试三条** — ① 0 个非 PRICE 评分项 + 1 家可评供应商 + 0 条记录 → `progress===100`；② 0 个评分项 + 0 家可评（全部回避）→ `progress===0`；③ 既有用例回归（有项有家未评 → <100 不变）。断言用返回值 `{ progress }`
- [ ] **Step 2: 跑测确认 ① 失败** — `pnpm --filter api test -- score-recalculate` → ① FAIL（现值 0）
- [ ] **Step 3: 实现** — 计算行改：`const progress = totalItems > 0 ? Math.min(100, Math.floor((scoredItems / totalItems) * 100)) : (activeIds.length > 0 ? 100 : 0);`，注释注明「0 评分项（none 直接采购）且有可评家=定性审查口径已评完；0 家=可评集合空维持 0（spec §4.2，防普通项目回避/废标殆尽语义漂移）」
- [ ] **Step 4: 跑测全过** — 同命令 → PASS
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/score-recalculate.helper.ts apps/api/src/bid/score-recalculate.helper.spec.ts
git commit -m "fix(none-eval): 专家进度 0 项且≥1 家可评=100——解 none 项目报告步死锁"
```

---

### Task 3: `startEvaluation` none 项目回填 progress=100（存量自愈）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`startEvaluation` 事务内，`lockAndReassertStage` 后）
- Test: `apps/api/src/bid/bid.service.spec.ts`（复用 Task 1 基建）

**Interfaces:**
- Consumes: `isNoneEvaluation`（Task 1）
- Produces: 事务内 `bidExpert.updateMany({ where: { projectId: id, expertRole: '正选', invitationStatus: 'confirmed', progress: { lt: 100 } }, data: { progress: 100 } })`（仅 none 分支执行）

- [ ] **Step 1: 失败测试** — none 项目 `startEvaluation` 成功路径断言 mock 的 `bidExpert.updateMany` 被以该谓词调用一次；manual 项目断言未被调用
- [ ] **Step 2: 跑测确认失败** → FAIL（未调用）
- [ ] **Step 3: 实现** — 事务内 `if (isNoneEvaluation(project.evaluationMethod)) { await tx.bidExpert.updateMany(...谓词同上...); }`，注释「存量自愈：修复前已签到/回避确认的 none 项目专家 stored progress=0（spec §4.2；回避确认重算为第二道自然修复）」
- [ ] **Step 4: 跑测全过**（含 Task 1 用例回归）
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(none-eval): 启动评标回填 none 专家 progress=100——存量卡死专家自愈"
```

---

### Task 4: expert.service 三处——perSupplierComplete / noneEvaluation payload / 核对闸 none 轨道

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`getReport`、`verifyScoreReview`、项目详情 payload `getProject`）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: `isNoneEvaluation`（Task 1）、Task 2 语义
- Produces: ① `getReport` 与项目详情 payload 增 `noneEvaluation: boolean`（Task 7 前端消费，字段名固定 `noneEvaluation`）；② `perSupplierComplete` 0 评分项 → `true`；③ `verifyScoreReview` none 项目跳过两处 `SCORING_INCOMPLETE` 检查（0 记录 + 项数比对），upsert/监督日志照常

**前置（本任务第一步，硬性）：**
- [ ] **Step 0: 协作检查** — `git status --short apps/api/src/expert/` 为空才继续；非空则停，报告等待并行会话提交

- [ ] **Step 1: 失败测试四条**（spec §8）— ① `getReport`：0 评分项项目 `supplierScores[0].perSupplierComplete===true` 且 payload `noneEvaluation===true`；② `verifyScoreReview`：none 项目（`evaluationMethod:'none'`、0 记录）resolve 且落 `bidScoreReview` verified 行；③ 非 none 项目 0 记录仍 reject `SCORING_INCOMPLETE`（Review Focus #5）；④ 项目详情 payload `noneEvaluation` 与 `evaluationMethod` 一致
- [ ] **Step 2: 跑测确认失败** — `pnpm --filter api test -- expert.service` → ①②④ FAIL（③ 现状即 PASS，作回归）
- [ ] **Step 3: 实现** —
  - `getReport`：`perSupplierComplete: project.scoreItems.length === 0 || records.length === project.scoreItems.length`（0 项=true）；返回对象加 `noneEvaluation: isNoneEvaluation(project.evaluationMethod)`
  - `verifyScoreReview`：在 `scores` 查询后包裹 `if (!isNoneEvaluation(project.evaluationMethod)) { ...两处 SCORING_INCOMPLETE 检查原样内移... }`；监督日志 `result` 在 none 时置 `'已核对（直接采购·定性审查确认）'`（action 不变）
  - `getProject`（专家项目详情）：payload 加 `noneEvaluation`（同一表达式）
- [ ] **Step 4: 跑 expert.service 全 spec** → PASS
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(none-eval): 专家侧 none 轨道——核对转定性确认、完成度 0 项=true、noneEvaluation 下发"
```

---

### Task 5: `generateEvaluationResults` none 双硬闸 + warnings 抑制

**Files:**
- Modify: `apps/api/src/bid/bid-evaluation-results.service.ts`
- Test: `apps/api/src/bid/bid-evaluation-results.service.spec.ts`（已存在）

**Interfaces:**
- Consumes: `isNoneEvaluation`（Task 1）
- Produces: ① `NONE_MULTI_BIDDERS`（none 且 `activeSuppliers.length>1`，400，置于 `activeSuppliers` 计算后）；② `NONE_PRICE_REQUIRED`（none 且唯一可评供应商 `!bidPrices.has(id)`，400，置于 bidPrices 构建块后）；③ `completenessWarnings` 收集块整体包 `if (!isNoneEvaluation(...))`

- [ ] **Step 1: 失败测试四条** — ① none+2 家可评 → reject `NONE_MULTI_BIDDERS`（Review Focus #3）；② none+1 家+开标记录 amount='10000'/amountUnit='万元' → resolve 且结果 `bidPrice===100000000`（元，1 亿元）；③ none+1 家+无开标记录 → reject `NONE_PRICE_REQUIRED`（Review Focus #4）；④ 非 none 项目缺投票 warnings 行为回归不变
- [ ] **Step 2: 跑测确认失败** — `pnpm --filter api test -- bid-evaluation-results` → ①②③ FAIL
- [ ] **Step 3: 实现** — 两闸用 `BadRequestException({ error, code })`，文案按 spec §4.5 逐字：①「直接采购按单一成交对象口径，现有 N 家可评供应商属采购方式错配，请流标或更正采购方式后重新组织」②「直接采购项目唯一可评供应商无有效唱标价，无法生成成交结果——请核对/补正开标记录唱标金额」；`completenessWarnings` 块包裹条件后，其余路径不动（`bidPrices` 已由 `parseAmountToYuan` 换算，勿裸读）
- [ ] **Step 4: 跑测全过** + `aggregate-supplier-scores` 回归
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid-evaluation-results.service.ts apps/api/src/bid/bid-evaluation-results.service.spec.ts
git commit -m "feat(none-eval): 生成结果 none 双硬闸（多家可评/缺价）+完整性告警抑制"
```

---

### Task 6: 签字包 none 页（评分确认表 →「直接采购·不评分」）

**Files:**
- Modify: `apps/api/src/bid/bid-sign-packet.service.ts`（`expertSheets` 构建处，~:697）
- Modify: `apps/api/src/bid/bid-sign-packet-docx.service.ts`（per-expert 评分表渲染处）
- Test: `apps/api/src/bid/bid-sign-packet.service.spec.ts`、`bid-sign-packet-docx.service.spec.ts`

**Interfaces:**
- Consumes: `isNoneEvaluation`（Task 1）；`project`（findUnique include experts/suppliers，全字段，`project.evaluationMethod` 可用）
- Produces: expertSheet JSON 增 `noneEvaluation: boolean` 字段；docx 对该字段渲染「直接采购·不评分」占位行（不渲染空评分表）；核对时间戳（`verifiedAt`）逻辑不变

- [ ] **Step 1: 失败测试两条** — ① none 项目 sheet `noneEvaluation===true`；② docx 渲染产物包含文本「直接采购·不评分」（spec §7 验收 4）
- [ ] **Step 2: 跑测确认失败**
- [ ] **Step 3: 实现** — sheet 加字段；docx 评分表段入口处 `if (sheet.noneEvaluation)` 渲染占位行（沿用该文件既有段落/表格构造方式，勿新引依赖）
- [ ] **Step 4: 跑测全过**
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid-sign-packet.service.ts apps/api/src/bid/bid-sign-packet.service.spec.ts apps/api/src/bid/bid-sign-packet-docx.service.ts apps/api/src/bid/bid-sign-packet-docx.service.spec.ts
git commit -m "feat(none-eval): 签字包 none 项目评分确认表改「直接采购·不评分」页"
```

---

### Task 7: 三门户前端信息态（无测试基建：tsc + lint + 人工）

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（scoring 步渲染分支）
- Modify: `apps/expert-portal/src/components/evaluate/verify-score-step.tsx`（none 文案/无分数列分支）
- Modify: `apps/api/src/project-management/project-management.service.ts`（`ensureBidProject` 已有项目路径 select 补 `evaluationMethod: true`——审查 F1，:466 起）
- Modify: `apps/web/src/lib/api/bid.ts:23`（`BidProjectRef` 加 `evaluationMethod?: string | null`）
- Modify: `apps/web/src/components/projects/score-standard-card.tsx`（none → 信息态）
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`（评分矩阵 0 项空态 none 分支）
- Test: 无前端测试；后端改动跑 `pnpm --filter api test -- score-standard-gate`（ensureBidProject 行为回归）

**Interfaces:**
- Consumes: payload `noneEvaluation`（Task 4，专家门户两处）；`BidProjectRef.evaluationMethod`（**本任务补齐后端下发**：existing 路径 select 现缺该字段、返回 `{...existing}`；创建路径 `buildEvaluationDefaults` 已写默认值且返回全行）；`project.evaluationMethod`（bid-portal 详情已下发，`evaluation-view.tsx:490` 已在用）

- [ ] **Step 1: 专家门户** — `page.tsx`：project payload 取 `noneEvaluation`，scoring 步为 true 时渲染信息卡「本项目为直接采购（不评分），请审阅标书后于「核对」步逐家确认审查结论」（替换打分表渲染，完成谓词与自动跳步逻辑不动——progress=100 时既有 `setStep('report')` 行为保留，手动导航到 scoring 仍见信息卡）；`verify-score-step.tsx`：`noneEvaluation` 时标题/文案改「定性审查确认」、隐藏分数列，确认动作仍调 `verifyScoreReview`
- [ ] **Step 2: web (:3005)** — 后端先行：`ensureBidProject` existing 路径 select 补 `evaluationMethod: true`（F1；spec §4.7），跑 `pnpm --filter api test -- score-standard-gate` 回归；`BidProjectRef` 加字段；`score-standard-card.tsx`：`evaluationMethod==='none'` → 卡片显示信息态「直接采购·不评分——无需编制评分标准」（隐藏编制入口与红牌，spec §2）
- [ ] **Step 3: bid-portal (:3007)** — `evaluation-view.tsx` 评分矩阵区：`project.evaluationMethod==='none'` 且 scoreItems 空时，空态文案改「直接采购·不评分」（不显示「未编制评分标准」类缺口文案）
- [ ] **Step 4: 三门户验证** — `cd apps/<portal> && npx tsc --noEmit && npx eslint src/...改动文件` → 全绿（cgzxui 红牌闸同跑）
- [ ] **Step 5: Commit**

```bash
git add apps/expert-portal/src/app/\(app\)/evaluate/\[id\]/page.tsx apps/expert-portal/src/components/evaluate/verify-score-step.tsx apps/api/src/project-management/project-management.service.ts apps/web/src/lib/api/bid.ts apps/web/src/components/projects/score-standard-card.tsx apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "feat(none-eval): 三门户直接采购·不评分信息态——替代缺口红牌/空表（含 ensureBidProject 补发 evaluationMethod）"
```

---

### Task 8: 端到端验收（SWHI-ZJ-2026101609）+ 全量回归

**Files:** 无代码改动（验收记录以回复形式报告，不入库）

**Interfaces:**
- Consumes: 全部前序任务

- [ ] **Step 1: 全量单测** — `pnpm --filter api test` → 全绿（含既有 `committee-composition`/`score-standard-validator`/`score-standard-gate` 回归）
- [ ] **Step 2: 正路径（spec §7 验收 1-5）** — dev 环境实测：admin 登录（curl 带 `X-Portal: bid` + token_bid）① `POST /bid/projects/cmvam85xs008nuunbslk01mli/start-evaluation` → 200 且三位专家 progress=100；**口令环节（F3）**：事务自动生成 roomCode，专家验证/核对/确认前先从 :3007 取口令并验证；② 专家端逐家 verify + 确认报告（专家口令 `111111111111111111`）；③ 组长末签 + 生成结果 → 1 家成交、`bidPrice=100000000`；④ 签字包 docx 含「直接采购·不评分」；⑤ :3005 卡片信息态
- [ ] **Step 3: 负路径（spec §7 验收 7）** — 临时第二供应商行或直接以单测断言为准（步骤 1 已覆盖）；页面目检 :3006/:3007 信息态
- [ ] **Step 4: 非 none 回归抽查（spec §7 验收 6）** — 任一 manual 项目 03 闸/G9 行为不变（score-standard-gate.spec + Task 1 用例已锁，此处目检一条即可）

---

## Self-Review 记录

- 覆盖 spec §4.1→Task 1、§4.2→Task 2+3、§4.3→Task 4、§4.4→Task 7(专家门户)、§4.5→Task 5、§4.6→Task 6、§4.7→Task 7、§7→Task 8、§8→各任务测试节 ✓
- 类型一致性：`isNoneEvaluation` 六处消费同名；payload 字段 `noneEvaluation` 在 Task 4 产出、Task 7 消费同名；错误码字面量 Task 5 与 Review Focus 一致 ✓
- 比例：计划以签名/断言/文件锚点为主，无函数体转写 ✓
