# 废标复议表决（B+D）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过性审查「不通过票严格过半」自动废标落库的同时，向评审组长定向推送复议召集弹窗，组长可发起 `invalid_bid` 动议由委员会裁定维持/推翻；并补齐「不通过理由」后端强制。

**Architecture:** 叠加式（方案 B）：不改自动废标安全网与六个下游消费面，复用既有 `BidMotion`/`BidVote` 动议全链与 `invalid↔revoked` 可逆机器；零数据库迁移（激活 `BidInvalidBid.motionId` 死字段）。动议表决期间冻结该项评分投票，裁定后双向终局锁。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、Socket.IO 网关、Next.js 16 + React 19（apps/expert-portal）、`@water-erp/shared`（事件枚举/载荷，dist 消费）。

**Spec:** `docs/superpowers/specs/2026-11-12-invalid-bid-review-motion-design.md`（含自审记录，方案从此文档论证；实施前先通读）

## Global Constraints

- shared 包改动后必须 `pnpm --filter @water-erp/shared build`（dist 消费铁律）
- 每任务独立提交，`feat(bid):` / `test(bid):` 前缀；**只 add 本任务文件，禁 `git add -A`**（并行会话约定）；提交信息尾部带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 不改：六个下游消费面（置灰/进度分母/报告核对豁免/报价封路/结果排除/权威重算）、`bidValidity` 语义、`generateEvaluationResults` 计数与 H2、平板端
- 逐票理由与署名只进组长定向载荷与 `pendingInvalidReviews`（isLead 才下发）；全员广播仅计数+名称
- 验证命令：单测 `pnpm --filter api test -- <pattern>`；API 编译 `cd apps/api && npx tsc --noEmit`；前端编译 `cd apps/expert-portal && npx tsc --noEmit`
- 新依赖注入一律 `@Optional()`（镜像 `expert.service.ts:87-89` gateway/notificationService 模式，保既有 spec 构造不破）

## Review Focus

1. **纯空格理由绕过**——`reason: '   '` 应拒：D1 用 `!(item.reason ?? '').trim()`，Task 2 测试覆盖纯空格串
2. **双发动议竞态**——组长双击/双标签页并发发起：Task 5 事务内 motionId 占位判重，测试断言第二次 409 `RULING_ALREADY_OPEN`
3. **推翻撞已闭环签字包**——closed packet + rejected：Task 7 事务前预检 409（转译文案），测试断言 motion 未被关闭
4. **数值项被连带冻结**——B4 冻结只按 (供应商, 通过性项) 精确对：Task 6 测试同 dto 数值项放行
5. **组长离线弹窗丢失**——WS 只是加速器：Task 8 保证 getProject 兜底下发且非组长不见票面，测试双断言

---

### Task 1: shared 事件枚举与载荷

**Files:**
- Modify: `packages/shared/src/bid-events.ts:12-50`（枚举）、`:140-146`（BidValidityChangePayload）、载荷区追加

**Interfaces:**
- Produces: `BID_EVENT.LEAD_REVIEW_SUGGESTED = 'lead:review:suggested'`、`BID_EVENT.MOTION_CREATED = 'motion:created'`；`LeadReviewVoteDetail { expertName: string; passed: boolean; reason: string | null }`；`LeadReviewSuggestedPayload { projectId; invalidBidId; supplierId; supplierName; scoreItemId; scoreItemName; category: 'QUALIFICATION' | 'RESPONSIVE'; failCount: number; totalCount: number; votes: LeadReviewVoteDetail[]; timestamp: number }`；`MotionCreatedPayload { projectId; motionId; type: string; title: string; timestamp: number }`；`BidValidityChangePayload` 增可选 `supplierName?: string; scoreItemId?: string; scoreItemName?: string; category?: 'QUALIFICATION' | 'RESPONSIVE'`

- [ ] **Step 1: 追加两个事件常量与三个载荷类型，扩展现有 BidValidityChangePayload 可选字段**（纯类型/常量，无逻辑）
- [ ] **Step 2: 构建并验证**

Run: `pnpm --filter @water-erp/shared build`
Expected: 构建成功零报错（dist 产出，后续任务的门户/api 消费方靠它过 tsc）

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/bid-events.ts
git commit -m "feat(bid): shared 事件与载荷——lead:review:suggested / motion:created / validity 载荷增强"
```

### Task 2: D1 不通过理由后端强制

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:1664-1724`（submitScores 评分校验循环）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: 错误码 `FAIL_REASON_REQUIRED`（400）；校验位置=逐项循环末尾，两条路径（有/无 pointDecisions）统一命中

- [ ] **Step 1: 写失败测试**——`describe('submitScores D1：不通过理由强制')` 两个用例：①无得分点路径 `passed:false, reason:'   '` → rejects 400 `FAIL_REASON_REQUIRED`；②checklist 路径 pointDecisions 全不勾（passed 推导 false）且无 reason → 同码拒绝；对照组 `passed:false, reason:'依据不足'` 放行（沿用 :1217 起「过半不通过」用例的 mock 构造方式）
- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter api test -- expert.service`
Expected: 新用例 FAIL（当前无此闸）

- [ ] **Step 3: 实现**——循环体内 `if (!meta) continue;` 之后的各分支处理完后追加：

```ts
if ((meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE')
    && item.passed === false && !(item.reason ?? '').trim()) {
  throw new BadRequestException({ error: `通过性审查项 ${item.scoreItemId} 判不通过必须填写理由`, code: 'FAIL_REASON_REQUIRED' });
}
```

- [ ] **Step 4: 跑测通过 + 全量 spec 回归**

Run: `pnpm --filter api test -- expert.service`
Expected: 新用例 PASS，存量全绿（既有 `passed:false` 用例均带理由，自查 :1300）

- [ ] **Step 5: Commit**（`git add` 仅上述两文件，`feat(bid): D1 通过性判不通过后端强制理由 FAIL_REASON_REQUIRED`）

### Task 3: B1 网关 expertSockets 登记 + 定向推送

**Files:**
- Modify: `apps/api/src/bid/bid.gateway.ts:166-168`（Map 声明区）、`:213-226`（handleDisconnect）、`:259-272`（join 专家分支）、`:290-316`（leave）、通知方法区（:475 notifyBidValidity 附近）

**Interfaces:**
- Consumes: Task 1 的 `BID_EVENT.LEAD_REVIEW_SUGGESTED` / `MOTION_CREATED` 与两载荷类型
- Produces: `expertSocketsIn(expertId: string, projectId: string): string[]`（镜像 :504 `supplierSocketsIn`）；`notifyLeadReviewSuggested(projectId: string, leadExpertId: string, payload: LeadReviewSuggestedPayload): void`（组长各 socket 定向 + `host:${projectId}` 房）；`notifyMotionCreated(projectId: string, payload: MotionCreatedPayload): void`（`experts:${projectId}` 房）

- [ ] **Step 1: 实现**——三处登记/清理（join 专家分支 `(client.data).expertId = assigned.id` + Map 登记 + `socketProjects.set`；disconnect 与 leave 按 `socket.data.expertId` + `socketProjects` 登记镜像 supplier 清理，同 Wave4a-M6 口径）+ 两通知方法（payload 补 `timestamp: Date.now()`）
- [ ] **Step 2: 编译验证**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 零错误

- [ ] **Step 3: Commit**（`feat(bid): B1 网关专家 socket 登记 + 组长复议定向推送 + motion:created 广播`）

### Task 4: B2+D2 触发位接线（过半→组长推送；广播载荷增强）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:1617-1624`（scoreItems select 加 `name`）、phase ④ `:1888-1932`、新增 private helper `suggestLeadReview`
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 `gateway.notifyLeadReviewSuggested`；Task 1 `BidValidityChangePayload` 扩展字段
- Produces: `private async suggestLeadReview(projectId: string, invalidBidRow: { id: string; motionId: string | null }, verdict: InvalidBidVerdict, ctx: { supplierId: string; supplierName: string; scoreItemId: string; scoreItemName: string; category: 'QUALIFICATION' | 'RESPONSIVE' }): Promise<void>`——motionId 非空即 return；查组长（`bidExpert.findFirst({ where: { projectId, isLead: true, expertRole: '正选', invitationStatus: { not: 'declined' } }, select: { id: true } })`）无组长即 return；查票面（`bidScoreRecord.findMany({ where: { scoreItemId, supplierId, passed: { not: null } }, include: { expert: { select: { expertName: true } } } })`）→ 调网关；整体调用方 try/catch 吞异常（推送失败不阻塞）
- 行为契约：disqualified 分支在 `BidInvalidBid` 写入后调用一次；revoked 分支不调；两处 `notifyBidValidity` 调用补 `supplierName/scoreItemId/scoreItemName/category`（supplierName 取自 :1640 已载 `bidSuppliers` 映射）

- [ ] **Step 1: 写失败测试**——`describe('submitScores B2：过半推送组长复议')`：①过半新建 `BidInvalidBid`（motionId null）→ gateway mock 的 `notifyLeadReviewSuggested` 被调且载荷含 votes 数组（含 expertName/passed/reason）；②existingRec 已带 motionId → 不调；③推送抛异常 → submitScores 照常成功（吞异常）。D2：断言 `notifyBidValidity` 载荷含 `supplierName` 与 `scoreItemName`。gateway mock 对象补 `notifyLeadReviewSuggested: jest.fn()`（既有 mock 同 :1217 用例挂法）
- [ ] **Step 2: 跑测确认失败**（`pnpm --filter api test -- expert.service`，新用例 FAIL）
- [ ] **Step 3: 实现**——scoreItems 查询 select 补 `name: true` 并入 itemMeta；disqualified 分支拿到刚写入行（update/create 返回值）后调 `suggestLeadReview`；两处 `notifyBidValidity` 补参
- [ ] **Step 4: 跑测通过 + 回归**（同命令，全部 PASS）
- [ ] **Step 5: Commit**（`feat(bid): B2+D2 过半废标即时推送组长复议 + 有效性广播载荷增强`）

### Task 5: B3 复议动议端点

**Files:**
- Modify: `apps/api/src/expert/expert.controller.ts:526-547`（motions 区追加路由）、`apps/api/src/expert/expert.service.ts`（closeMotion 前新增方法）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 `gateway.notifyMotionCreated`
- Produces: `POST /api/expert/projects/:projectId/invalid-bid-reviews`，body `{ invalidBidId: string; description?: string }` → `createInvalidBidReviewMotion(userId: string, projectId: string, dto): Promise<BidMotion>`；错误码：403 `NOT_LEAD`、404 `NOT_FOUND`（invalidBid 不属本项目）、409 `NOT_INVALID`（status≠'invalid'）、409 `RULING_ALREADY_OPEN`（motionId 指向 voting 动议）、409 `RULING_FINAL`（指向 closed 且 result≠'tie_deadlock'）；title 固定 `废标复议表决：${supplierName}·${scoreItemName}（不通过 ${failCount}/${totalCount}）`；默认 description `通过性审查不通过票 ${failCount}/${totalCount}（严格过半），提交委员会复议裁定。`

- [ ] **Step 1: 写失败测试**——`describe('createInvalidBidReviewMotion B3')`：①非组长 403；②status='revoked' 409 `NOT_INVALID`；③motionId 指向 voting 动议 409 `RULING_ALREADY_OPEN`；④指向 closed+approved 409 `RULING_FINAL`；⑤指向 closed+tie_deadlock → 放行重建（motionId 改指新动议）；⑥happy path：事务内 `bidMotion.create`（type='invalid_bid', status='voting', title 断言）+ `bidInvalidBid.update`（motionId 回写）+ 监督日志（action 含「发起废标复议表决」）+ 事务后 `notifyMotionCreated` 被调
- [ ] **Step 2: 跑测确认失败**
- [ ] **Step 3: 实现**——校验链（`assertRoomUnlocked` → 专家存在 → isLead → invalidBid 载入（`findFirst({ where: { id, projectId }, include: { supplier: { select: { supplierName: true } }, scoreItem: { select: { name: true, category: true } } } })`）→ 状态/动议判重）→ `$transaction`（create motion + update motionId + 监督日志 riskFlag 高、role '评审组长'）→ 事务后 `notifyMotionCreated`
- [ ] **Step 4: 跑测通过 + 回归**
- [ ] **Step 5: Commit**（`feat(bid): B3 废标复议动议端点——组长发起+motionId 占位防双发`）

### Task 6: B4 冻结闸 + 裁定终局锁

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（submitScores，:1637 供应商校验后、:1743 事务前）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: 错误码 400 `RULING_IN_PROGRESS`（关联动议 voting）与 400 `RULING_FINAL`（关联动议 closed）；查询精确对：`bidInvalidBid.findMany({ where: { projectId, motionId: { not: null }, OR: pairs.map(p => ({ AND: [{ supplierId: p.supplierId }, { scoreItemId: p.scoreItemId }] })) } })`，pairs 仅由 dto 中通过性项构成

- [ ] **Step 1: 写失败测试**——`describe('submitScores B4：复议冻结闸')`：①si1 关联 voting 动议、dto 含 (sup1,si1) 通过性票 → 400 `RULING_IN_PROGRESS`；②si1 关联 closed 动议 → 400 `RULING_FINAL`；③同一 dto 中 (sup1,si2) 数值项不受牵连（构造 si1 冻结、只投 si2 → 过闸到既有校验）；④tie_deadlock closed → 同 `RULING_FINAL`
- [ ] **Step 2: 跑测确认失败**
- [ ] **Step 3: 实现**——构造 pairs（dto.scores 过滤 itemMeta category∈通过性）→ 非空才查 invalidBid → 命中再查 `bidMotion.findMany({ where: { id: { in: motionIds } }, select: { status: true } })` → 任一 voting → `RULING_IN_PROGRESS`，否则 `RULING_FINAL`（error 文案带评分项名：itemMeta 需含 name——Task 4 已补 select）
- [ ] **Step 4: 跑测通过 + 回归**
- [ ] **Step 5: Commit**（`feat(bid): B4 复议表决冻结闸——该项评分投票暂停/裁定后终局锁`）

### Task 7: B5 closeMotion 裁定分支 + BidService 包装

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:5089`（private 方法上追加 public 薄包装）、`apps/api/src/bid/bid.module.ts`（无改动，已 exports BidService）、`apps/api/src/expert/expert.service.ts`（构造器注入 `@Optional() private readonly bidService?: BidService`；closeMotion `:2946-2967` 改造；新增 `private async applyInvalidBidRuling`）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: `recomputeAllExpertsProgress`（expert.service 已 import）、`notifyBidValidity`、Task 3
- Produces: `BidService.invalidateResultsForRuling(tx, projectId: string, targetName: string): Promise<void>`（转发 private `invalidateEvaluationResultsAndPacket`）；closeMotion 契约：`type='invalid_bid'` 且 result 定出后——**事务前预检**：result 将为 rejected 且 `bidSignPacket.closedAt` 非空 → 409 `{ error: '推翻废标与已闭环签字包冲突，请走数据修正流程重开签字包后再行裁定', code: 'SIGN_PACKET_CLOSED' }`（motion 不关闭）；`$transaction` 内：approved→仅监督日志「废标复议表决：维持废标（赞成 x/反对 y/弃权 z）」高；rejected→`bidInvalidBid.update {status:'revoked', revokedAt, revokedBy: 操作人 userId}` + 其余 active invalid 计数聚合重算 `bidSupplier.bidValidity` + `bidService.invalidateResultsForRuling(tx, projectId, supplierName)` + 监督日志「废标复议表决：推翻废标，恢复参评资格（…）」高；tie_deadlock→仅监督日志「平票未决…维持废标现状，须重新召集表决」高；事务后（rejected 分支）：`notifyBidValidity(revoked)` + `recomputeAllExpertsProgress`

- [ ] **Step 1: 写失败测试**——`describe('closeMotion B5：invalid_bid 裁定分支')`：①approved→invalidBid 不变、监督日志含「维持废标」；②rejected 无其他 invalid→invalidBid revoked + `bidSupplier.update` bidValidity='valid' + bidService mock 的 `invalidateResultsForRuling` 被调 + `notifyBidValidity` revoked + `bidExpert.update`（进度重算被调）；③rejected 但另有 active invalid→bidValidity 保持 'invalid'；④rejected + closed packet→409 `SIGN_PACKET_CLOSED` 且 `bidMotion.update` 未被调（预检挡在事务外）；⑤tie_deadlock→无任何状态写、日志含「平票未决」。quorum/平票组长决定票既有行为回归用例一并补（当前 spec 无 closeMotion 测试，属新增）
- [ ] **Step 2: 跑测确认失败**
- [ ] **Step 3: 实现**——BidService 加 public 包装；ExpertService 构造器追加 `@Optional() bidService`；closeMotion：result 计算后按上述契约走（invalidBid 载入 `findFirst({ where: { motionId } , include: { supplier: { select: { supplierName: true } } } })`）
- [ ] **Step 4: 跑测通过 + 回归 + 编译**（`pnpm --filter api test -- expert.service`；`cd apps/api && npx tsc --noEmit`）
- [ ] **Step 5: Commit**（`feat(bid): B5 复议裁定三路落地——维持留痕/推翻恢复+结果联动/平票重发`）

### Task 8: B6 getProject 组长兜底载荷

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:340-468`（getProject，myExpertRecord 构造后）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: getProject 返回体新增 `pendingInvalidReviews?: PendingInvalidReview[]`（仅 `expertRecord.isLead` 时存在）；`PendingInvalidReview { invalidBidId; supplierId; supplierName; scoreItemId; scoreItemName; category; failCount; totalCount; votes: LeadReviewVoteDetail[]; hasOpenMotion: boolean; canRemotion: boolean }`——收录：motionId null（hasOpenMotion=false, canRemotion=true）；motionId 指向 voting（hasOpenMotion=true, canRemotion=false）；指向 closed+tie_deadlock（hasOpenMotion=false, canRemotion=true）；**排除** closed+approved/rejected（已终局）

- [ ] **Step 1: 写失败测试**——①isLead 专家→字段存在且含 votes 记名明细；②非组长→返回体无该字段（或 undefined）；③closed+approved 的 invalid 不在列表；④voting 动议的行 hasOpenMotion=true
- [ ] **Step 2: 跑测确认失败**
- [ ] **Step 3: 实现**——新 private `buildPendingInvalidReviews(projectId)`：`bidInvalidBid.findMany({ where: { projectId, status: 'invalid' }, include: { supplier/scoreItem select } })` → motionIds 批查 `bidMotion` → 分类过滤 → 逐行查票面（复用 Task 4 的票面查询形状）
- [ ] **Step 4: 跑测通过 + 回归**
- [ ] **Step 5: Commit**（`feat(bid): B6 getProject 组长 pendingInvalidReviews 兜底下发`）

### Task 9: B7 前端（钩子 + 组长弹窗 + 全员横幅 + D2 文案）

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/lead-review-modal.tsx`
- Modify: `apps/expert-portal/src/hooks/use-expert-websocket.ts:9-33,50-70`、`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（:1115 isLead 已有；onBidValidityChange :169-182；WS handlers 注册区）

**Interfaces:**
- Consumes: Task 1 载荷类型；Task 8 `pendingInvalidReviews`；Task 5 端点 `POST /expert/projects/:id/invalid-bid-reviews`
- Produces: `LeadReviewModal` 组件 props `{ open: boolean; review: PendingInvalidReview | LeadReviewSuggestedPayload; busy: boolean; onSubmit: (invalidBidId: string) => void; onDismiss: () => void }`（渲染：供应商/评分项/票数/逐票理由列表——cgzxui neumorphic 风格，参照 `exp-pin-dialog.tsx`/`confirm-dialog.tsx` 的门户弹窗惯用法）

- [ ] **Step 1: WS 钩子**——`Handlers` 增 `onLeadReviewSuggested?: (d: LeadReviewSuggestedPayload) => void`、`onMotionCreated?: (d: MotionCreatedPayload) => void` + `bindBusinessEvents` 两行绑定
- [ ] **Step 2: 评审页接线**——①状态 `leadReviewQueue: LeadReviewSuggestedPayload[]`（按 invalidBidId 去重）+ `dismissedReviewIds: Set<string>` + `motionBanner: MotionCreatedPayload | null`；②getProject 水合：`pendingInvalidReviews` 逐行入队（hasOpenMotion=true 者仅入横幅态）；③WS `onLeadReviewSuggested` 入队自动弹首个未忽略项；`onMotionCreated` 置横幅（文案「组长已发起废标复议表决：<title>，请到工作台-待处理事项投票」+ 链接 `/`）；④弹窗动作：发起→POST `{invalidBidId}` → toast+重拉 getProject；暂不处理→入 dismissed（常驻小横幅计数）；⑤D2：`onBidValidityChange` 滚动事件文案改用载荷 `supplierName/scoreItemName`（带回退查表）
- [ ] **Step 3: 编译验证**

Run: `cd apps/expert-portal && npx tsc --noEmit`
Expected: 零错误（shared dist 已在 Task 1 构建）

- [ ] **Step 4: Commit**（`feat(bid): B7 专家端组长复议弹窗+表决横幅+废标广播文案增强`）

### Task 10: e2e + 全链验证

**Files:**
- Create: `apps/api/test/invalid-bid-review.e2e-spec.ts`

**Interfaces:**
- Consumes: 全部前置任务；e2e 惯用法照 `test/bid.e2e-spec.ts`（`loginAs(app, username, password, 'expert')` + X-Portal: expert，专家口令=身份证号取自 `prisma/seed-data/ExpertLibrary.json`）

- [ ] **Step 1: 写 e2e**——造 EVALUATING 项目+3 正选专家（1 isLead）+供应商+资格性评分项（沿用 bid.e2e 既有 fixture 构造段）：①三专家两票不通过→过半→`GET /expert/projects/:id` 组长载荷含 pendingInvalidReviews（votes 记名）；②组长 POST 复议→另一专家投票→组长 close rejected→断言 `bidValidity='valid'`、`BidInvalidBid.status='revoked'`、监督日志存在；③approved 路对称（维持+motionId 回写断言）
- [ ] **Step 2: 跑 e2e**

Run: `pnpm --filter api test:e2e -- invalid-bid-review`
Expected: 3 用例全绿（`--forceExit` 已在 script）

- [ ] **Step 3: 全量回归**

Run: `pnpm --filter api test`
Expected: 全绿（D1/B2/B3/B4/B5/B6 单测 + 存量）

- [ ] **Step 4: Commit**（`test(bid): 废标复议表决 e2e——过半推送/推翻恢复/维持留痕`）
