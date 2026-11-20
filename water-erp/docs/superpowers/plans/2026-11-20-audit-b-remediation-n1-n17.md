# 2026-11-20b 审查复核轮 N1-N17 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-11-20b 全链路审查复核轮立案的 17 项发现（N1-N17：P2×3、P3×14），收口「终态项目写穿/全废标归档/归档冻结漏网/证据自含性」四类缺口。

**Architecture:** 全部为闸门补齐与快照补列的小步修复——不新建模块、零 schema 变更、零迁移；后端沿既有「service 前置校验 + 同文件 spec」惯例，前端仅一处组件收紧；签字包三缺列走「快照补字段→docx 补渲染」同任务闭环。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、Next.js 16 + React 19（apps/bid-portal）、jest（co-located spec）。

**Spec:** `docs/审查报告-招投标全链路漏洞审计复核-2026-11-20.md`（发现 N1-N17 的完整证据/触发序列/修复建议；行号为 2026-11-20 ~15:00 快照，执行时以 rg 重新定位为准）。

## Global Constraints

- **并行会话协调（开工前置）**：另一会话正在落地第四批 P3 修复——开工前 `git status` 必须干净（对方已提交）；`bid.service.ts`、`bid-sign-packet.service.ts`、`expert.service.ts` 为共享高危文件，冲突时外科手术只摘自己片段。
- **提交纪律**：禁 `git add -A`/`git add .`，只 add 本任务明确路径；每任务一提交，消息格式 `fix(review-b): N<x>…`，结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；**勿 push**（用户明确后手动）。
- **验证命令**：main 上 lint 不可用——后端 `cd water-erp && pnpm --filter api test -- <pattern>`（jest）+ `pnpm --filter api exec tsc --noEmit`；前端 `pnpm --filter bid-portal exec tsc --noEmit`。
- **零 schema 变更**：本计划全部任务不动 `prisma/schema.prisma`（无需 prisma validate/迁移）。
- **N14 只改 spec 文档不改行为**（D4 用户裁定同族，维持整驻现状、补留痕）。
- 既有口径：阶段机 DOWNLOAD→SUBMIT→OPENING→EVALUATING→ARCHIVED/ABORTED；开标记录金额=万元、BidQuote/结果=元；错误码复用既有（STAGE_NOT_OPENING/PROJECT_TERMINAL/SIGN_PACKET_CLOSED/OUTER_HASH_MISMATCH）。

## Review Focus

1. **终态项目的报价写**（N6）：修复须双向锁——submitQuote 阶段闸 + abort 关轮；只修一侧=流标后报价仍可经另一侧进来。测试两向都锁（Task 1）。
2. **0/1-2 家有效的结果生成**（N1）：全废=409 硬拦、不足法定家数=放行+高风险留痕——两条分支各有测试，防止把「可否决」做成硬拦或把「应流标」做成留痕（Task 4）。
3. **终态写端点冻结纪律**（N2/N3/N4/N7/N8）：五处 helper 化后，未来新增写端点仍会裸——helper 注释写明「新写端点必须前置」；本批测试覆盖五端点各自 409（Task 2/3）。
4. **签字包快照与 PDF 一一对应**（N15-N17）：快照加了字段 docx 没渲染=半修——每列在 docx spec 断言文本出现（Task 9）。
5. **暂存清理引用集完整性**（N13）：清理删掉在途证据=数据丢失——保护集除 CaOperation 外，测试再断言「SubmissionVersion 引用仍受保护」防回归（Task 7）。

---

### Task 1: N6 流标后报价闸——submitQuote 阶段闸 + abort 强制关轮

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（submitQuote ~:5671、abortBidProject ~:1561）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: 既有 `getMinBidders` 体系外的阶段常量；无前置依赖。
- Produces: `submitQuote` 新前置 `409 STAGE_NOT_OPENING`（stage∉{OPENING,EVALUATING}）；`abortBidProject` 事务内新增轮次收敛写（后续任务不依赖）。

- [ ] **Step 1: 写失败测试（submitQuote 阶段闸）**

在 `bid.service.spec.ts` 既有 `describe('submitQuote — 准入校验')` 内加用例：mock `prisma.bidProject.findUnique` 返回 `{ id:'p1', stage:'ABORTED' }`（round 正常 open、supplier 合格），断言 `rejects.toMatchObject({ response: { code: 'STAGE_NOT_OPENING' } })`。另加 stage='ARCHIVED' 同断言、stage='EVALUATING' 放行（走完不炸该码）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- bid.service.spec -t "submitQuote"` → 新用例 FAIL（当前无此闸，落库成功）。

- [ ] **Step 3: 实现 submitQuote 阶段闸**

submitQuote 在 round 归属校验后加载 `const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } })`，加：
```ts
if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
  throw new ConflictException({ error: '当前阶段不可提交报价（项目可能已流标或归档）', code: 'STAGE_NOT_OPENING' });
}
```
（码与 createRound 既有 `STAGE_NOT_OPENING` 同码同语义——前端已有该码的映射处理。）

- [ ] **Step 4: 写失败测试（abort 关轮）**

`describe('BidService — stage transitions')` 加用例：abortBidProject 场景 mock `tx.bidRound.updateMany` 捕获参数，断言被调用于 `{ where: { projectId, status: { not: 'closed' } }, data: { status: 'closed' } }`。

- [ ] **Step 5: 实现 abort 关轮**

abortBidProject 事务内（写 stage:'ABORTED' 之后）加 `await tx.bidRound.updateMany({ where: { projectId, status: { not: 'closed' } }, data: { status: 'closed' } })`，并在监督日志 result 追加 `；已强制关闭开放报价轮次`（有轮次时——用 updateMany 返回 count>0 判断）。

- [ ] **Step 6: 两用例全绿**

Run: `pnpm --filter api test -- bid.service.spec -t "submitQuote"` 与 `-t "stage transitions"` → PASS。

- [ ] **Step 7: 提交**

`git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts` → `fix(review-b): N6 流标后报价闸——submitQuote 补阶段闸 + abort 强制关轮`

### Task 2: N7 开标记录签字页终态闸

**Files:**
- Modify: `apps/api/src/bid/opening-sign.service.ts`（generateSignPage :83）
- Test: `apps/api/src/bid/opening-sign.service.spec.ts`

**Interfaces:**
- Produces: generateSignPage 前置 `409 PROJECT_TERMINAL`（与 uploadSignScan P3-22 同码）。

- [ ] **Step 1: 写失败测试**

用例：mock `prisma.bidProject.findUnique` 返回 `{ stage:'ARCHIVED' }`，调 generateSignPage，断言 `rejects.toMatchObject({ response:{ code:'PROJECT_TERMINAL' } })` 且 `storage.upload` 未被调用；ABORTED 同断言。（对既有 spec 的 prisma mock 补 `bidProject.findUnique`。）

- [ ] **Step 2: 确认失败** → `pnpm --filter api test -- opening-sign.service.spec -t "签字页"` FAIL。

- [ ] **Step 3: 实现**

generateSignPage 头部（buildSnapshot 之前）加：
```ts
const stageRow = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
if (stageRow?.stage === 'ARCHIVED' || stageRow?.stage === 'ABORTED') {
  throw new ConflictException({ error: `项目已${stageRow.stage === 'ARCHIVED' ? '归档' : '流标'}，签字页生成通道已关闭`, code: 'PROJECT_TERMINAL' });
}
```

- [ ] **Step 4: 过测** → 同 Step 2 命令 PASS。

- [ ] **Step 5: 提交** → `fix(review-b): N7 开标记录签字页终态闸（generateSignPage 镜像 P3-22 口径）`

### Task 3: N2/N3/N4/N8 归档冻结四端点收口（helper 化）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（新增私有 helper；setReportNotes ~:4813 / registerQualificationReview ~:4793 / registerManualArchiveItem ~:4172 / upsert+deleteSupervisionAnnotation ~:6028/:6084 五方法前置）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Produces: `private async assertProjectWritable(projectId: string): Promise<void>`——终态（ARCHIVED/ABORTED）抛 `409 PROJECT_TERMINAL`；helper 注释写明「**bid 域新增写端点必须前置本闸**（2026-11-20b N2/N3/N4/N8 收口）」。setReportNotes 另加签字闭环检查 `409 SIGN_PACKET_CLOSED`（复用既有码）。

- [ ] **Step 1: 写失败测试**

新 `describe('终态写冻结（N2/N3/N4/N8）')`：五方法各一用例——mock `bidProject.findUnique` 返回 `{ stage:'ARCHIVED' }`（setReportNotes 场景另 mock `bidSignPacket.findUnique` 返回 `{ closedAt: new Date() }`），断言各自 `code:'PROJECT_TERMINAL'`（setReportNotes 闭环分支断言 `'SIGN_PACKET_CLOSED'`，stage 为 EVALUATING 时触发）。

- [ ] **Step 2: 确认失败** → `pnpm --filter api test -- bid.service.spec -t "终态写冻结"` FAIL。

- [ ] **Step 3: 实现 helper + 五处接线**

helper 内一次 `findUnique select:{stage:true,name:true}`，终态抛错（错误文案含项目名）；五方法在存在性校验后立即 `await this.assertProjectWritable(projectId)`。setReportNotes 在 helper 后追加签字包闭环检查（`bidSignPacket.findUnique select:{closedAt:true}`，closedAt 非空抛 SIGN_PACKET_CLOSED，文案「评标签字已闭环，报告附注不可再编辑；如需更正请走数据修正流程」）。

- [ ] **Step 4: 过测 + 全量回归**

Run: `pnpm --filter api test -- bid.service.spec` → 全绿（防止既有用例因新前置炸——若既有用例未 mock `bidProject.findUnique`，按需补 mock 实现按 stage 返回非终态）。

- [ ] **Step 5: 提交** → `fix(review-b): N2/N3/N4/N8 归档冻结四端点 helper 化收口`

### Task 4: N1 全废标流标引导 + 不足法定家数留痕

**Files:**
- Modify: `apps/api/src/bid/bid-evaluation-results.service.ts`（qualifiedRanked 计算后 ~:492）
- Test: `apps/api/src/bid/bid-evaluation-results.service.spec.ts`

**Interfaces:**
- Consumes: `getMinBiddersForMethod`（`bid/decrypt-quorum.util.ts` 导出，bid.service.ts:31 同款 import）。
- Produces: `409 ALL_BIDS_REJECTED`（qualifiedRanked.length===0，全采购方式）；不足法定家数不拦、写 `BidSupervisionLog` riskFlag '高'。

- [ ] **Step 1: 写失败测试（两分支）**

既有 generate describe 体系内加两用例：①全部 disqualified（mock 聚合输入使 ranked 全废）→ `rejects.toMatchObject({ response:{ code:'ALL_BIDS_REJECTED' } })`；②3 家 2 家合格（招标类）→ 生成成功且 `bidSupervisionLog.create` 被调、payload `riskFlag:'高'` 且 result 含「不足法定」。

- [ ] **Step 2: 确认失败** → `pnpm --filter api test -- bid-evaluation-results.service.spec` FAIL。

- [ ] **Step 3: 实现**

`const qualifiedRanked = …` 后：
```ts
if (qualifiedRanked.length === 0) {
  throw new ConflictException({ error: '全部投标经评审被否决，不得生成评标结果——请走评标中流标（:3007 异议裁决/终止）后重新组织采购', code: 'ALL_BIDS_REJECTED' });
}
const minBidders = getMinBiddersForMethod(project.procurementMethod);
if (qualifiedRanked.length < minBidders) {
  // 12 号令 27 条「明显缺乏竞争可否决」为裁量项——留痕不硬拦，继续与否由评标委员会决定
  await this.prisma.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '系统', target: project.name,
    action: '有效标不足法定家数提示', result: `有效投标 ${qualifiedRanked.length} 家不足法定 ${minBidders} 家（明显缺乏竞争）——评标委员会可依《评标委员会和评标方法暂行规定》第 27 条否决全部投标走流标；继续生成视为确认竞争充分性`, riskFlag: '高' } }).catch(() => undefined);
}
```
（放置在 `$transaction` 之前；`getMinBiddersForMethod` import 顶部补。）

- [ ] **Step 4: 过测** → 同 Step 2 命令 PASS（含既有用例不回归）。

- [ ] **Step 5: 提交** → `fix(review-b): N1 全废标硬拦流标引导 + 不足法定家数高风险留痕`

### Task 5: N5 回避/退库后有效评审人数提示

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（confirmAvoidance ~:800-830）
- Modify: `apps/api/src/expert/expert-admin.service.ts`（unconfirm-report 服务方法 ~:1821 一带）
- Test: `apps/api/src/expert/expert.service.spec.ts`、`apps/api/src/expert/expert-admin.service.spec.ts`

**Interfaces:**
- Produces: 两处在既有动作成功后写 `bidSupervisionLog`（riskFlag '高'）——**不硬拦**（回避是专家法定权利、硬拦会造成「既不能回避也不能继续」死锁）。

- [ ] **Step 1: 写失败测试（expert.service）**

confirmAvoidance 既有 describe 加用例：mock 更新后「对该供应商仍有效评审的正选 confirmed 专家数」为 4（<5），断言 `bidSupervisionLog.create` 被调且 result 含供应商名与「有效评审专家降为 4 人」、riskFlag '高'。

- [ ] **Step 2: 确认失败** → `pnpm --filter api test -- expert.service.spec -t "回避"` FAIL。

- [ ] **Step 3: 实现（confirmAvoidance）**

update 落库后：`const activePanel = await this.prisma.bidExpert.count({ where: { projectId, expertRole: '正选', invitationStatus: 'confirmed', id: { not: expert.id } } })`——注意该专家对回避供应商仍计入他人的评审，此处口径=「除回避者外仍对该供应商有评审能力的正选数」；若 `activePanel < 5`（对齐委员会常量，取 `MIN_COMMITTEE_WATER` 同文件可硬编码 5 并注释来源 committee-composition.util）→ 写高风险监督日志（target=供应商名，result=`专家 ${expert.expertName} 回避后，该供应商有效评审专家降为 ${activePanel} 人（低于法定 5 人单数口径）`）。

- [ ] **Step 4: expert-admin 同构（unconfirm-report）**

服务方法写完撤销后，`confirmed 正选` 总数 <5 → 同款高风险日志（target=专家名，result=`专家 ${名} 退库后，评标委员会有效正选降为 ${n} 人`）。`expert-admin.service.spec.ts` 加对应断言用例并跑绿。

- [ ] **Step 5: 过测** → `pnpm --filter api test -- expert.service.spec` / `expert-admin.service.spec` PASS。

- [ ] **Step 6: 提交** → `fix(review-b): N5 回避/退库后有效评审人数高风险留痕（不硬拦）`

### Task 6: N9 启动评标前端镜像三收紧

**Files:**
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`（横幅 :850、startBlockers :640-643、文案 :855）
- 验证：tsc（本仓库前端无组件测试基建；G9 数据源改消费/预检端点为后续立项，本任务不做——见审查报告 N9 修复建议③④）

**Interfaces:**
- Consumes: 既有 `canHost`（:239）、`project.priceFormulaConfig`/`project.ceilingPrice`（详情已下发、evalRules :510-517 已消费同字段）。

- [ ] **Step 1: 横幅挂 canHost**

`:850` `{stage === 'OPENING' && (` → `{stage === 'OPENING' && canHost && (`（非指派 staff 不再看到可用按钮——后端 403 提前到不可见；canHost 计算已存在，零新逻辑）。

- [ ] **Step 2: startBlockers 增限价项（G11）**

在 biddersOk 之后加：
```ts
const formulaCfg = (project.priceFormulaConfig ?? null) as { formulaType?: string } | null;
const ceilingRequired = formulaCfg?.formulaType === 'benchmark_deviation' || formulaCfg?.formulaType === 'ratio';
const ceilingMissing = ceilingRequired && !(project.ceilingPrice && Number(project.ceilingPrice) > 0);
if (ceilingMissing) startBlockers.push('价格分公式为基准价偏离法/比例法，须先在 :3005 设置最高限价');
```
（disabled 逻辑 `startBlockers.length > 0` 已有，自动生效。）

- [ ] **Step 3: 文案对齐现实（G10）**

`:855` 横幅说明删去「且评分标准完整」六字（该检查后端有、前端无——文案不再虚诺；评分标准完整校验留待预检端点立项）。

- [ ] **Step 4: 类型验证**

Run: `pnpm --filter bid-portal exec tsc --noEmit` → 0 error。

- [ ] **Step 5: 提交** → `fix(review-b): N9 启动评标镜像收紧——canHost 挂横幅+限价 blocker+文案对齐`

### Task 7: N10/N11/N13-B 暂存链三修

**Files:**
- Modify: `apps/api/src/scheduler/staging-cleanup.service.ts`（BATCH 循环 :15/:33、引用集 :38-43）
- Modify: `apps/api/src/ca/encrypted-asset.controller.ts`（资格闸 :52-56 补 deadline）
- Test: `apps/api/src/scheduler/staging-cleanup.service.spec.ts`（若无则建，沿用 co-located 惯例）

**Interfaces:**
- Produces: 清理循环清空语义（`while (candidates.length === BATCH)`）；暂存闸 `409 DEADLINE_PASSED`；保护集并入 `caOperation`（purpose∈{submit,reupload} 且 status='PAYLOAD_READY' 的 result JSON 中 files.*.assetId）。

- [ ] **Step 1: 写失败测试（三用例）**

①600 件过期候选：mock findMany 依次返回 [500 件, 100 件]，断言 deleteMany 被调两轮、全部清空；②受 SubmissionVersion 引用的 key 不删（既有行为的回归锁）；③受 CaOperation（PAYLOAD_READY，result JSON 含 assetId）引用的 key 不删——现状 FAIL（③为 N13-B 红测试，①现状也 FAIL）。

- [ ] **Step 2: 确认失败** → `pnpm --filter api test -- staging-cleanup` FAIL。

- [ ] **Step 3: 实现循环清空 + 引用集扩展**

`do { const candidates = await …findMany({ take: BATCH }); if (candidates.length === 0) break; …逐件删除…; if (candidates.length < BATCH) break; } while (true)`；保护集合并入 `caOperation.findMany({ where: { purpose: { in: ['submit','reupload'] }, status: 'PAYLOAD_READY' }, select: { result: true } })` → `try { JSON.parse(op.result) } catch { continue }` 取 `files` 各角色 `assetId`（防御解析失败跳过，宁可不删不可漏保护）。

- [ ] **Step 4: 实现暂存 deadline 闸**

encrypted-asset.controller.ts :52 `select` 加 `deadline: true`；stage 闸后加：
```ts
if (project.deadline && project.deadline.getTime() < Date.now()) {
  throw new ConflictException({ error: '投标截止时间已过，不可暂存投标密文', code: 'DEADLINE_PASSED' });
}
```
（controller spec `encrypted-asset.controller.spec.ts` 补一用例：stage=SUBMIT 且 deadline 已过 → 409。）

- [ ] **Step 5: 过测** → `pnpm --filter api test -- staging-cleanup` / `encrypted-asset.controller.spec` PASS。

- [ ] **Step 6: 提交** → `fix(review-b): N10/N11/N13-B 暂存清理循环清空+截标闸+CaOperation 引用保护`

### Task 8: N12/N13-A/N14 dual-v3 投递链两闸 + spec 留痕

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（首投暂存循环 :3199-3205、补传循环 :3007-3014）
- Modify: `docs/superpowers/specs/2026-11-05-dual-envelope-chunked-encryption-design.md`（§9.3 补 N14 留痕一句）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`

**Interfaces:**
- Produces: 首投与补传两循环统一：暂存资产缺失 → `400 STAGED_ASSET_MISSING`；实算 sha ≠ `entry.outerSha256` → `400 OUTER_HASH_MISMATCH`（与补传既有闸 :2993 同码）。

- [ ] **Step 1: 写失败测试（四用例）**

首投路径：①暂存行缺失 → STAGED_ASSET_MISSING；②sha 不符 → OUTER_HASH_MISMATCH。补传路径同两用例（:3008 的 continue 同修）。mock `fileAsset.findUnique` 分别返回 null / `{ sha256:'aa', … }`（信封声明 'bb'）。

- [ ] **Step 2: 确认失败** → `pnpm --filter api test -- supplier-portal.service.spec -t "v3"` FAIL。

- [ ] **Step 3: 实现两循环统一闸**

两处 `if (!stagedAsset) continue;` 改为：
```ts
if (!stagedAsset) throw new BadRequestException({ error: `${role} 暂存资产不存在（可能已过期清理），请重新暂存后投递`, code: 'STAGED_ASSET_MISSING' });
if (stagedAsset.sha256 !== entry.outerSha256) throw new BadRequestException({ error: `${role} 外层密文哈希与暂存资产实算值不符（疑似调包或截断）`, code: 'OUTER_HASH_MISMATCH' });
```
（补传处既有 sha 闸保留不动——本闸落在其暂存行校验处；首投 entry 类型 V3Entry4 已含 outerSha256。）

- [ ] **Step 4: N14 spec 留痕**

spec §9.3 备份读回段补一句：「T4 备份读回为整驻 streamToBuffer（峰值 1×500MB/请求，与 D4 decrypt-upload 整驻同族裁定）；截标前多供应商并发投递时主进程 RSS 线性叠加，后续优化方向=流式管道（getObject→putObject+流式哈希）或投递并发信号量。2026-11-20b N14。」

- [ ] **Step 5: 过测** → Step 2 命令 PASS。

- [ ] **Step 6: 提交** → `fix(review-b): N12/N13-A v3 投递链暂存闸统一（缺失/调包硬拦）；N14 spec 留痕`

### Task 9: N15/N16/N17 签字包三缺列（快照+docx 同任务闭环）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（swapExpertRole 事务内 ~:6795-6820 补监督日志）
- Modify: `apps/api/src/bid/bid-sign-packet.service.ts`（motions 快照 :832、verifyLogs 过滤器 :709-713、disputes 快照 :830）
- Modify: `apps/api/src/bid/bid-sign-packet-docx.service.ts`（动议行 :318-321、异议行 :310-313、唱标表 :166-175）
- Test: `apps/api/src/bid/bid-sign-packet.service.spec.ts`、`apps/api/src/bid/bid-sign-packet-docx.service.spec.ts`

**Interfaces:**
- Produces: 快照 motions 项 `{ type, title, description, status, result, votes: [{ expertName, vote, reason }] }`；disputes 项增 `resolvedBy`/`resolvedAt`；verifyEvents 含 `action:'专家替换'` 行（经监督日志管道）；docx 三处渲染对应列。

- [ ] **Step 1: 写失败测试（service 三断言）**

`bid-sign-packet.service.spec.ts` buildSnapshot 相关 describe：①含 type/reason 的动议入快照（`motions[0].type==='invalid_bid'`、`votes[0].reason==='…'`）；②disputes 快照含 resolvedBy/resolvedAt；③监督日志含 `action:'专家替换'` 时 verifyEvents 出现该行（过滤器现状只收 3 action——红）。

- [ ] **Step 2: 确认失败** → `pnpm --filter api test -- bid-sign-packet.service.spec` FAIL。

- [ ] **Step 3: 实现 service 三处**

①motions map 补 `type: m.type` 与 votes 补 `reason: v.reason ?? null`；②disputes map 补 `resolvedBy: d.resolvedBy ?? null, resolvedAt: d.resolvedAt?.toISOString() ?? null`；③verifyLogs `action: { in: […] }` 列表加 `'专家替换'`。

- [ ] **Step 4: swapExpertRole 补监督日志（N16 数据源）**

事务内两条 `expertInvitationLog.create` 之后加一条 `bidSupervisionLog.create`：`action:'专家替换'`，`target:`${e1.expertName} → ${e2.expertName}``，`result:`正选换出/候补递补（${e1.expertRole}→${e2.expertRole}）``，`riskFlag:'中'`。（snapshot 管道与监督视图同时可见；expertInvitationLog 保留不动。）

- [ ] **Step 5: docx 三处渲染 + 文本断言**

①动议行（:318-321）前缀 `[${m.type}]`、表决串附 `（${v.reason ?? ''}）`（reason 空则不附括号）；②异议行（:310-313）裁决段补 resolvedBy/resolvedAt：`裁决：${d.response}${d.resolvedBy ? `（${d.resolvedBy} · ${d.resolvedAt}）` : ''}`；③唱标表头（:170）增 `'开标异议'` 列，行值=confirmStatus 映射（`SUPPLIER_DISPUTED`→`异议处置中`，其余→`—`）。`bid-sign-packet-docx.service.spec.ts` 加三处文本级断言（表格单元含期望串）。

- [ ] **Step 6: 过测 + 回归**

`pnpm --filter api test -- bid-sign-packet` 全绿（含既有 sign-loop 用例）。

- [ ] **Step 7: 提交** → `fix(review-b): N15/N16/N17 签字包补列——动议 type/reason、专家替换披露（监督日志轨）、异议裁决入唱标表`

### Task 10: 收尾——tsc 全量 + 报告状态回写

**Files:**
- Modify: `docs/审查报告-招投标全链路漏洞审计复核-2026-11-20.md`（各 N 行补 ✅状态）

- [ ] **Step 1: 后端全量编译+测试**

Run: `pnpm --filter api exec tsc --noEmit` → 0 error；`pnpm --filter api test` → 全绿（注意既有 mock 因新前置炸掉时补 stage/deadline mock，不改生产语义）。

- [ ] **Step 2: 前端类型**

Run: `pnpm --filter bid-portal exec tsc --noEmit` → 0 error。

- [ ] **Step 3: 报告状态回写**

审查报告 ① 修复清单各 N 行尾补「**✅已修复（2026-11-20b 修复批）**」；N14 行补「已 spec 留痕（不改行为）」。

- [ ] **Step 4: 提交** → `docs(review-b): 审查报告 N1-N17 修复状态回写`（提醒用户未推送，等明确指示）
