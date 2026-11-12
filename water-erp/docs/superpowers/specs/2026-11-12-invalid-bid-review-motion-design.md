# 通过性废标「先落废标 + 组长复议表决」设计（方案 B+D）

- 日期：2026-11-12
- 状态：待批准（自审一轮已过，见文末自审记录）
- 前置调研：本文件写作前已对实时废标链路、动议体系、WS 网关、前端评分页做全量代码核查（结论散见文内锚点，均为 `file:line` 实锚）

## 1. 背景与意图

现状：专家在资格性（QUALIFICATION）/符合性（RESPONSIVE）项投「不通过」，票数**严格过半的瞬间**系统自动废标（`expert.service.ts:1888-1932` phase ④ → `BidInvalidBid` + `bidValidity='invalid'` + WS 广播 + 全员进度重算）。误废标的救济只有两条非正式通道：专家自行改票（改票逃生口，前端-only 闸）或主持人手动撤销。

意图：在过半瞬间给**评审组长**一个正式的复议召集入口——弹窗展示票数分布与逐票理由，组长可（a）现场讨论后劝说改票（既有机制自动恢复），或（b）发起 `invalid_bid` 类型动议表决，由委员会正式裁定维持/推翻。同时补齐「不通过理由」的后端强制（误废标根因之一）。

**定案为叠加式（方案 B）而非挂起式（方案 A/C）**：保留过半即落的自动废标安全网，复议在其上叠加，`invalid↔revoked` 可逆机器全部复用，六个下游消费面（置灰/进度分母/报告核对豁免/报价封路/结果排除/权威重算）**零改动**。

## 2. 目标 / 非目标 / 反目标

**目标**
1. 过半瞬间组长端弹窗（WS 实时 + 刷新兜底），预载：供应商、评分项、票数分布、逐票不通过理由
2. 组长一键发起 `invalid_bid` 动议（复用既有 createMotion/castVote/closeMotion 全链）
3. 裁定结果联动废标状态：维持→留痕；推翻→复用 revoke 语义恢复参评资格
4. 动议表决期间冻结该项评分投票；裁定后该项投票终局锁定
5. D 线：`passed=false` 后端强制理由；过半广播载荷补供应商名/评分项名

**非目标**
- 不引入 `bidValidity` 第三态（不做「待裁定」挂起）
- 不改六个下游消费面任何口径
- 不改专家评分独立保密性（表决前逐人票面仅组长可见，沿用 `stripMotionVotesForExpert` 口径）
- 平板端只读，不动
- 不动 `generateEvaluationResults` 的投票计数与 H2 撤销不计票逻辑

**反目标**
- 复议流程不得阻塞自动废标安全网（invalid 先落不变；组长离线时流程不卡死，仅少一次弹窗）
- 不得在 `EVALUATION_OVERDUE` 上拦复议动议（法定过程豁免，既有裁定）
- 已闭环签字包不得被推翻路径静默作废（沿用 `SIGN_PACKET_CLOSED` 409 语义）

## 3. 现状资产锚点（全部已核实存在）

| 资产 | 锚点 |
|---|---|
| 过半实时触发（唯一钩子位） | `expert.service.ts:1898-1928`（`evaluateInvalidBid` → `BidInvalidBid` upsert → `notifyBidValidity` → `bidValidity` 聚合） |
| 动议发起（仅组长 `NOT_LEAD`） | `expert.service.ts:2879-2890` |
| 投票（一票制+理由+口令闸） | `expert.service.ts:2892-2916` |
| 结算（quorum 过半+平票组长决定票+tie_deadlock） | `expert.service.ts:2918-2967` |
| 防从众可见性（voting 期非组长仅本人票+已投人数） | `expert.service.ts:2975-3003` |
| 动议前端操作面（发起/投票/结束） | `expert-portal/src/app/(app)/page.tsx:94-124`（工作台首页待处理事项）；评审页只读（`evaluate/[id]/page.tsx:1120-1121`） |
| 签字包「动议决议」记名收录 | `bid-sign-packet-docx.service.ts:296-307`（含 type/结果/逐人投票+理由）——`invalid_bid` 动议自动入包 |
| 废标↔动议关联字段（现为死字段） | `schema.prisma:620` `BidInvalidBid.motionId`「委员会表决废标时」 |
| 供应商 socket 定向先例 | `bid.gateway.ts:248-251,504`（`supplierSockets` Map + `supplierSocketsIn` 过滤 `socketProjects`） |
| 专家入房（experts:${projectId}） | `bid.gateway.ts:259-272`（join 时已查得 `assigned` BidExpert 行——`assigned.id` 即 expertId，当前未登记 socket 映射） |
| revoke 恢复语义（WS revoked + 进度重算） | `expert.service.ts:1916-1928`、`score-recalculate.helper.ts:16-33` |
| 结果失效+签字包作废联动（异议裁决/手动废标同款） | `bid.service.ts:5157`（`invalidateEvaluationResultsAndPacket`，private）；`bid.module.ts:53` exports BidService；`expert.module.ts` 已 import BidModule，反向无 import（无环） |
| 权威重算排除已撤销废标（H2） | `bid-evaluation-results.service.ts:271-276`（revokedKeys 不计失败票）——推翻后无需改生成侧 |
| 前端 WS 钩子（key-based 绑定） | `expert-portal/src/hooks/use-expert-websocket.ts:50-70` |
| 评审页 isLead 变量已存在 | `evaluate/[id]/page.tsx:2429`（`isLead={isLead}` 传 ReportStep） |
| 专家端项目载荷源 | `expert.service.ts:340` `getProject`（`/expert/projects/:projectId`） |

## 4. 详细设计

### D1 后端强制「不通过理由」（`submitScores`）

位置：`expert.service.ts` 评分校验循环（:1664-1724）内，每项处理末尾统一追加：

```ts
// 通过性项判不通过必须附理由（此前仅前端闸，score-validation.ts:133）
if ((meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE')
    && item.passed === false && !(item.reason ?? '').trim()) {
  throw new BadRequestException({
    error: `通过性审查项 ${item.scoreItemId} 判不通过必须填写理由`,
    code: 'FAIL_REASON_REQUIRED',
  });
}
```

- 两条路径（有/无得分点）统一覆盖——checklist 路径在 :1694-1695 赋值 `item.passed` 后同样命中
- 兼容性核查结论：`apps/api/test/` 全部 e2e 无 `passed:false` 提交（仅 sign-packet e2e 用 `passed:true`）；`expert.service.spec.ts` 既有 `passed:false` 用例均带 reason（:1300 `'不符'`）——新增闸不破存量绿
- 平板端只读不提交，不受影响；草稿端点不校验（草稿非票）

### D2 过半广播载荷增强

`packages/shared/src/bid-events.ts` `BidValidityChangePayload`（:140-146）增加可选字段：

```ts
supplierName?: string;   // 前端 toast 免查表
scoreItemId?: string;
scoreItemName?: string;  // 如「资格性审查」
category?: 'QUALIFICATION' | 'RESPONSIVE';
```

- 发射点：`expert.service.ts:1915/1922` 两处 `notifyBidValidity` 调用补参（钩子位上下文里已有 supplierId/itemId，supplierName/itemName 需就近查一次或复用 `bidSuppliers`/itemMeta——itemMeta 只有 maxScore/category，评分项名需补 select）
- **逐票理由与署名不进广播**——只推组长（见 B2），维护评分独立保密性与 `stripMotionVotesForExpert` 同精神
- 专家页消费：`onBidValidityChange`（`evaluate/[id]/page.tsx:169-182`）滚动事件文案补评分项名
- ⚠️ `@water-erp/shared` 改动后必须 `pnpm --filter @water-erp/shared build`（dist 消费铁律）

### B1 网关：专家 socket 登记 + 定向推送

`bid.gateway.ts`：

1. 镜像 `supplierSockets` 增加 `expertSockets: Map<expertId, Set<sid>>`
2. join 专家分支（:259-272）：`(client.data).expertId = assigned.id` + 登记映射 + `socketProjects`；leave 分支（:290-316）镜像清理（以 `socketProjects` 登记为准，同 Wave4a-M6 口径）
3. 新事件 `BID_EVENT.LEAD_REVIEW_SUGGESTED = 'lead:review:suggested'`、`BID_EVENT.MOTION_CREATED = 'motion:created'`（shared `bid-events.ts` 枚举追加）
4. 新方法：

```ts
notifyLeadReviewSuggested(projectId, leadExpertId, payload) {
  // 组长定向（expertSocketsIn 过滤本项目）+ host 房（监督/主持人知情）
  for (const sid of this.expertSocketsIn(leadExpertId, projectId)) this.server.to(sid).emit(...);
  this.server.to(`host:${projectId}`).emit(BID_EVENT.LEAD_REVIEW_SUGGESTED, payload);
}
notifyMotionCreated(projectId, payload) {
  this.server.to(`experts:${projectId}`).emit(BID_EVENT.MOTION_CREATED, payload); // 轻载荷：motionId/title/type
}
```

载荷类型（shared）：`LeadReviewSuggestedPayload { projectId, invalidBidId, supplierId, supplierName, scoreItemId, scoreItemName, category, failCount, totalCount, votes: { expertName; passed: boolean; reason: string | null }[], timestamp }`；`MotionCreatedPayload { projectId, motionId, type, title, timestamp }`

### B2 触发位接线（`expert.service.ts` phase ④）

在 :1914 `BidInvalidBid` create/update 成功且 `disqualified` 分支内、`notifyBidValidity` 之后追加（try/catch 包裹，推送失败不阻塞主流程——安全网已落库）：

1. 判重：该 `BidInvalidBid.motionId == null` 才推（已有动议在途/已裁定不重复打扰）
2. 查组长：`bidExpert.findFirst({ projectId, isLead: true, invitationStatus: { not: 'declined' } })`（isLead 转移后实时查库，天然跟随专家替换）
3. 查票面明细：`bidScoreRecord.findMany({ where: { scoreItemId, supplierId, passed: { not: null } }, include: { expert: { select: { expertName: true } } } })` → votes 数组
4. `gateway.notifyLeadReviewSuggested(...)`

 revoked 分支（:1916-1923）不推（废标恢复无需复议）。

### B3 新端点：发起废标复议动议

`expert.controller.ts`（motions 端点区 :526 附近）：

```ts
@Post('projects/:projectId/invalid-bid-reviews')
createInvalidBidReviewMotion(@CurrentUser('sub') userId, @Param('projectId') projectId, @Body() dto: { invalidBidId: string; description?: string })
```

`expert.service.ts` 新方法，事务内：

1. `assertRoomUnlocked`（口令闸，与 createMotion 同口径）
2. 组长闸（`NOT_LEAD`，同 :2887）
3. 载入 `BidInvalidBid`（id + projectId 归属校验）：须 `status='invalid'`（已恢复的不可复议，409 `NOT_INVALID`）；须 `motionId == null` **或** 关联动议 `closed && result='tie_deadlock'`（平票死锁允许重发——见 B5），否则 409 `RULING_ALREADY_OPEN` / `RULING_FINAL`
4. 事务：`bidMotion.create({ type:'invalid_bid', title: '废标复议表决：${supplierName}·${scoreItemName}（不通过 ${failCount}/${totalCount}）', description: dto.description ?? 系统拼装票数摘要, createdBy: leadExpertId, status:'voting' })` + `bidInvalidBid.update({ motionId: motion.id })`（motionId 非空即占位，天然防并发双发）
5. 监督日志：「发起废标复议表决」riskFlag 高（`role: '评审组长'`）
6. 事务后 `gateway.notifyMotionCreated(...)`（专家房轻载荷提醒投票）

### B4 冻结闸 + 裁定终局锁（`submitScores`）

位置：事务开始前（:1743 之前）、`itemMeta` 就绪后。只对 dto 中**通过性项**生效（数值项不受影响）：

1. 查 `bidInvalidBid.findMany({ where: { projectId, supplierId: { in: 涉及供应商 }, scoreItemId: { in: 涉及通过性项 }, motionId: { not: null } } })`
2. motionId 非空 → 查 `bidMotion.findMany({ id: { in: motionIds } })`：
   - `status='voting'` → 400 `RULING_IN_PROGRESS`「该项废标复议表决进行中，评分投票已暂停」
   - `status='closed'`（任何 result）→ 400 `RULING_FINAL`「该项已经委员会裁定，评分投票已冻结」（双向锁：维持废标防改票翻转裁定；推翻废标防再投票翻回）
   - `closed + tie_deadlock` → 同样冻结（须组长重发动议解决，见 B3-3）
3. 拒绝粒度：整个提交按项拒绝（与既有 `PASS_FAIL_VERDICT_REQUIRED` 同风格——单请求内逐项校验，遇违规项即 400）。专家仍可提交该供应商其他项/其他供应商全项

注：改票逃生口（前端 :1023-1024）维持不变——但裁定后该项被后端锁，逃生口对已裁定项自然失效；弹窗文案在 B7 中向组长说明「裁定后不可再改票」。

### B5 `closeMotion` 增加 `invalid_bid` 分支

位置：`expert.service.ts:2946-2967`（result 计算完成后、update 前）：

```ts
if (motion.type === 'invalid_bid') {
  const invalidBid = await this.prisma.bidInvalidBid.findFirst({ where: { motionId: motion.id } });
  if (invalidBid) { /* 按 result 三路处置（见下），与 motion update 同事务 */ }
}
```

将现有 closeMotion 尾部 update 包进 `$transaction`，三路：

- **`approved`（维持废标）**：`BidInvalidBid` 不变（invalid 保持）；监督日志「废标复议表决：**维持废标**（赞成 x/反对 y/弃权 z）」riskFlag 高。无状态迁移、无 WS
- **`rejected`（推翻废标）**：镜像既有 revoke 语义（`expert.service.ts:1916-1928` + `bid.service.ts` 异议裁决路径）：
  1. `bidInvalidBid.update({ status:'revoked', revokedAt: now, revokedBy: 操作人 userId })`——H2 使权威重算自动不计该项失败票（`bid-evaluation-results.service.ts:271-276`）
  2. 聚合重算 `bidValidity`：该供应商其余 active invalid 计数为 0 → `valid`（同 :1927-1928）
  3. 若已有 `BidEvaluationResult` → 调 BidService 结果失效联动（`invalidateEvaluationResultsAndPacket` 需从 private 提为 public 或加薄包装 `invalidateResultsForRuling`；闭环签字包由其内部 409 `SIGN_PACKET_CLOSED` 保护，事务回滚推翻不生效——与异议裁决废标同语义，见 `bid.service.ts:5153-5157` 注）
  4. 监督日志「废标复议表决：**推翻废标，恢复参评资格**（赞成 x/反对 y/弃权 z）」riskFlag 高
  5. 事务后：`notifyBidValidity(revoked)` + `recomputeAllExpertsProgress`（分母恢复）
- **`tie_deadlock`**：不动废标状态（invalid 保持=安全网）；监督日志「废标复议表决平票未决（组长未投票或弃权），维持废标现状，须重新召集表决」riskFlag 高；组长可经 B3-3 重发动议（motionId 指向新动议）

投闲置端兼容：`closeMotion` 现按 `motion.project.experts`（正选）算 quorum——`invalid_bid` 动议天然适用（全员表决）。

### B6 持久化兜底（组长弹窗不丢）

`getProject`（`expert.service.ts:340`）：当 `myExpertRecord.isLead` 时附带：

```ts
pendingInvalidReviews: [{
  invalidBidId, supplierId, supplierName, scoreItemId, scoreItemName, category,
  failCount, totalCount, votes: [{ expertName, passed, reason }],
  hasOpenMotion: boolean,   // motionId != null && motion.status='voting' → 前端改横幅为「表决进行中」
}]
```

来源：`bidInvalidBid.findMany({ where: { projectId, status:'invalid', motionId: null } })` + tie_deadlock 重发候选（motionId 指向 closed+tie_deadlock 的也纳入，标 `canRemotion: true`）。非组长不下发（保密口径：票面明细仅组长）。

前端刷新/onReconnected 重拉 getProject 即恢复弹窗——WS 推送只是加速器，不是流程条件。

### B7 前端（expert-portal 评审页）

1. **WS 钩子**（`use-expert-websocket.ts`）：`Handlers` 增 `onLeadReviewSuggested` / `onMotionCreated` + `on()` 绑定两事件
2. **组长弹窗**（`evaluate/[id]/page.tsx`，cgzxui/neumorphic Modal）：
   - 触发：WS `lead:review:suggested` 或 getProject `pendingInvalidReviews` 非空（多项同时过半→队列逐个弹）
   - 内容：供应商/评分项/票数（不通过 x/已投 y）/逐票理由列表（记名——组长可见，同 stripMotionVotesForExpert 组长口径）
   - 动作：「发起复议表决」（POST B3，成功后 toast+横幅）／「暂不处理」（收起为常驻横幅，废标已落不受影响）；文案注明「表决裁定后该项评分投票将冻结」+「也可现场讨论后由专家改票（票数变化自动恢复）」
3. **表决提醒**（全员）：WS `motion:created` → 评审页顶部横幅「组长已发起废标复议表决：<title>，请到工作台首页-待处理事项投票」+ 链接（复用既有投票 UI，不在评审页内嵌表决——最小改动）
4. **D2 文案**：`onBidValidityChange` 滚动事件补 supplierName/scoreItemName（载荷新增字段）

## 5. 数据模型

**零迁移。** 全部复用既有字段：`BidInvalidBid.motionId`（String?，回填激活）、`BidMotion.type='invalid_bid'`（枚举注释已列）、`BidVote`（一票制+reason）。无新表、无新列、无新索引（`BidInvalidBid` 按 `projectId+status+motionId` 查询量级=单项目个位数行）。

## 6. 边界与竞态裁定

| # | 场景 | 裁定 |
|---|---|---|
| 1 | invalid 落库→组长发motion 窗口内专家改票翻转 | 可接受：revoke 自动恢复；B3-3 校验 `status='invalid'` 才可发起，已恢复的 409 |
| 2 | 组长离线/刷新 | B6 持久兜底；弹窗非阻塞，安全网（invalid 已落）不受影响 |
| 3 | 报告已确认后动议/裁定 | 保持开放（法定过程，CLAUDE.md 既有口径）；推翻后 `recomputeAllExpertsProgress` 全员重算，已确认专家不受阻；结果联动失效受 `SIGN_PACKET_CLOSED` 保护 |
| 4 | 组长替换（isLead 转移） | B2/B6 每次实时查库，无缓存 |
| 5 | 同一 (supplier,item) 并发双发 motion | B3 事务内 motionId 占位（非空即锁），后到者 409 |
| 6 | 多项同时过半 | 每项独立 BidInvalidBid+独立 motion；弹窗队列 |
| 7 | 1 票草率结案 | 既有 `QUORUM_NOT_MET`（过半正选投票才可 close）防之 |
| 8 | WS 故障 | 推送 try/catch 不阻塞主流程；B6 兜底 |
| 9 | 表决期间评标超时 | `EVALUATION_OVERDUE` 不拦动议（既有豁免）；submitScores 冻结闸与超时闸独立叠加 |
| 10 | 平板端 | 只读不动；平板专家经桌面端投票 |

## 7. 测试计划

**单测（expert.service.spec.ts 扩展）**
- D1：两条路径 `passed=false` 无理由 → 400 `FAIL_REASON_REQUIRED`；有理由放行
- B3：非组长 403；已 revoked 409 `NOT_INVALID`；已有 open motion 409 `RULING_ALREADY_OPEN`；tie_deadlock 后可重发
- B4：voting → `RULING_IN_PROGRESS`；closed → `RULING_FINAL`；同请求其他项不受牵连
- B5：approved→留痕不变；rejected→revoked+bidValidity 恢复+进度重算+结果失效调用；tie_deadlock→不动+可重发；平票组长决定票（既有）回归
- B2：motionId 已非空不推送；异常吞掉不抛

**e2e（bid 或 expert 套件扩展）**：种子项目走 3 专家投不通过（2/3 过半）→ 组长账号 POST 复议 → 另 2 专家投票 → close rejected → 断言 `bidValidity='valid'`、`BidInvalidBid.status='revoked'`、监督日志存在；approved 路对称断言。专家登录用种子身份证号（`ExpertLibrary.json`）。

**前端**：tsc + lint（门户无 jest）；shared 构建后全链 `pnpm dev:kill && pnpm dev` 起服务冒烟（弹窗/横幅/投票/结算）。

## 8. 实施顺序（依赖链）

1. shared：事件枚举+载荷 → **build**
2. D1（独立可先上）
3. B1 网关（socket 登记+两方法）
4. B2 触发位 + D2 载荷增强
5. B3+B4+B5（服务端闭环，含 BidService public 化小改）
6. B6 getProject 扩展
7. B7 前端三件（钩子/弹窗/横幅）
8. 单测→e2e→冒烟；每步独立提交（`feat(bid):` 前缀）

## 9. 开放项（实施前需用户裁定，均可默认）

1. **表决门槛**：维持废标沿用 approve>reject 简单多数（现状 closeMotion 语义），或加严「维持废标须 ≥2/3 赞成」（更慎重）→ 默认沿用现状
2. **推翻后结果失效联动**：默认联动（镜像异议裁决）；或降级为仅监督日志告警+人工重生成 → 默认联动
3. **普通专家投票入口**：默认跳工作台首页既有 UI；或评审页内嵌投票卡 → 默认跳转

---

## 自审记录（2026-11-12，方案完成后逐锚点复核）

以下为复核中实际执行并确认/修正的点：

1. ✅ **无模块环**：`expert.module.ts` imports BidModule；`grep ExpertModule apps/api/src/bid/*.ts` 零命中——ExpertService 注入 BidService 可行（B5-③前提成立）
2. ✅ **D1 不破存量测试**：`apps/api/test/` 全量 grep 无 `passed:false`（sign-packet e2e 仅 `passed:true`）；`expert.service.spec.ts` 的 `passed:false` 用例带 reason
3. ✅ **B1 前提**：join 专家分支（gateway :259-272）已查得 `assigned`（BidExpert 行）——`assigned.id` 可直接登记 expertSockets，无需加查
4. ✅ **B3 防并发依据**：`BidInvalidBid` 的 unique 由 raw SQL migration 管理（COALESCE 复合），motionId 占位判重不依赖 unique 约束，事务内 update 天然串行化（写写冲突由 PG 行锁保证）
5. ⚠️ **修正一处**：B5 原设想「rejected 后 H2 需要改生成侧」——复核确认**无需改**：`bid-evaluation-results.service.ts:271-276` revokedKeys 已排除 revoked 项的失败票，且 :504-515 权威重算只对 active 供应商重算、不误恢复。已在 B5-①中落注
6. ⚠️ **补一个联动缺口**：B5 rejected 若在「结果已生成后」发生，供应商恢复 valid 但 `BidEvaluationResult` 已排除该家——故 B5-③结果失效联动从「可选」提为**默认必做**（否则旧结果与废标事实并存，正是 `bid.service.ts:5153-5156` 注释批判过的矛盾）
7. ✅ **签字包自动收录**：`bid-sign-packet.service` 按项目拉全部 motions 入包（spec :483 断言含 type/投票理由），`invalid_bid` 动议无需另接
8. ✅ **防从众口径不破**：逐票理由只进组长定向载荷与 `pendingInvalidReviews`（isLead 才下发）；全员广播仅计数+名称（D2）；表决期可见性沿用 `stripMotionVotesForExpert`
9. ✅ **弹窗触发双源不重复**：WS 即时弹窗与 getProject 兜底都以 `invalidBidId` 为键，前端按 key 去重入队
10. ⚠️ **遗留注意（实施期核）**：`closeMotion` 现为单 update 尾部（:2963-2967），改事务时须保留 quorum/平票判定在事务外纯计算（votes 已随 findUnique include 读入，无 TOCTOU 新窗口——一票制+unique(motionId,expertId) 保证 votes 不可变）
11. ✅ **二次复核（private 方法与闭环包冲突语义）**：`invalidateEvaluationResultsAndPacket` 确为 private（`bid.service.ts:5089`），且无结果时 no-op（:5090-5091）、闭环包在其调用方事务内 409 回滚（:5092-5095）。**推论（B5 需吸收）**：`rejected`（推翻）撞已闭环签字包时整个 closeMotion 失败回滚——裁定无法落地。这是 spec §10「闭环不可更正」的正确保护，但 409 文案是「废标将清除已签字的评标结果」从废标方向写的；B5 调用侧须捕获并转译为「推翻废标与已闭环签字包冲突，请走数据修正流程重开签字包后再行裁定」
12. ✅ **B6 前提复核**：`getProject` 的 `myExpertRecord = { ...expertRecord }` 全字段展开（`expert.service.ts:390`）——`isLead` 已在内，前端 `evaluate/[id]/page.tsx:2429` 亦已消费同名变量，零新增查询
13. ⚠️ **B4 冻结闸存在良性 TOCTOU 窗口（接受，不改）**：冻结检查在事务外（submitScores :1743 之前），组长创建动议与专家提交评分并发时，尾部评分票可能落在动议 voting 开始之后。后果有界：裁定依据是 `BidVote`（动议票，一票制不可变），非 `BidScoreRecord`（评分票）——迟到评分票不进裁定计数，最坏只是实时 fail/total 计数在表决期间轻微漂移，close 后即冻结。不为它加事务级行锁（收益不抵复杂度），如实留档
