# 开标现场异常触达：暂停/上报 → :3005 站内通知 + OPENING 流标窗口放行

日期：2026-10-23 · 状态：待评审 · 来源：2026-10-22~23 会话（开标会话终局 UI 修复的延伸排查）

## 1. 意图与背景

分工 v3（2026-08-13）把开标执行放 :3007、终局（流标/归档）放 :3005——终局权设计正确。但「现场发现重大异常 → 中心决策」的中间态只有线下电话一条通道：

- `pauseOpening`（bid.service.ts:2822）**零通知调用**——暂停只写监督日志+审计日志，:3005 若无人盯监督时间线/任务板则不知道现场冻结了；
- 监督视图「上报」（`upsertSupervisionAnnotation`，bid.service.ts:5633，status=escalated）是**纯本地标记**——无通知、:3005 全库零消费，按钮名有误导性；
- 暂停可无限期冻结（单向棘轮无超时倒逼，这是好性质），但电话不通时项目挂起无人知晓。

次要缺口：:3005 流标按钮的时间闸门按 `openTime` 算（前 24h ~ 后 48h，`BID_ABORT_WINDOW_*`）。长期暂停（跨周末）后 openTime 不动、超 48h 按钮灰死——而后端 `abortBidProject` 对 OPENING 本就放行（单向棘轮前进合法）。兜底只剩「发流标公告→幂等 abort」隐藏路径。

**本设计不推翻分工 v3**：不新增「申请终止」动作（暂停=信号），终局仍走 :3005 AbortDialog（abort+流标公告+开标归档串联）。只补「触达」与「按钮放行」。

## 2. 目标

1. **G1** 暂停开标时，:3005 侧可行动者立即收到站内通知（WS 实时弹窗 + 通知中心待办），深链直达该项目开标确认面板（面板已派生「已暂停」态）。
2. **G2** 监督视图「上报」（escalated）同触达；重复保存/改注不重发。
3. **G3** OPENING 阶段 :3005 流标按钮恒可用（时间窗口仅约束 DOWNLOAD/SUBMIT 的开标前 24h）。

## 3. 非目标 / 反目标

- ❌ 新增「申请终止开标」动作或审批流（暂停即信号；若将来要，另立 spec）
- ❌ 恢复开标（resumeOpening）发通知——回归常态，监督日志已留痕
- ❌ email/sms/phone 渠道——staff/leader/admin 无电话来源（contact 解析只认 ExpertProfile/Supplier 主联系人，notification.service.ts:102-113）、SMS_PROVIDER 未配；与 BID_ABORTED 先例一致仅 in_app
- ❌ :3005 新增暂停横幅/新面板——开标进度块已派生暂停态（opening-progress-block.tsx:132 注释），通知中心+WS 弹窗已触达
- ❌ 「上报」改造为工单流——保持最小（标记+通知），裁决仍在线下/:3005 面板

## 4. 设计

### 4.1 通知类型（packages/shared/src/notification-registry.ts，bid 域新增两条）

| 字段 | BID_OPENING_PAUSED | BID_ANOMALY_ESCALATED |
|------|--------------------|-----------------------|
| label | 开标暂停告警 | 现场异常上报 |
| icon / tone | PauseCircle / orange | ShieldAlert / red |
| actionable | **false**（评审裁定：事件性告警而非待办——escalated 无自然消音时点，actionable 会成永滞待办：markAsRead 对 actionable 拒置已读、stale-sweep 不扫 bid 域。通知仍走 WS 实时弹窗+通知中心列表+深链，触达不受损） | 同左 |
| audiences | `[{ kind: 'PROJECT_CREATOR' }]`——**2026-10-23 用户裁定：沿用 2026-10-09 口径（只发 PMI 创建人，宁可不发、不回退任何角色）**，突发告警不例外 | 同左 |
| channels | IN_APP | IN_APP |
| link | :3005 项目详情开标确认面板深链（**含 `?projectId=&panel=bid-confirm` 全参，勿漏**——深链参数丢过坑） | 同左 |

措辞走 registry 惯例：bid 域产生点用 `renderNotificationPayload()` 统一文案与跳转（同 BID_OPENING_HANDED_OVER 先例，bid.service.ts:1186）。

### 4.2 后端产生点（apps/api/src/bid/bid.service.ts）

**收件人解析**（2026-10-23 裁定=方案 A）：
- 复用 `resolveProjectCreatorId(prisma, project.projectManagementItemId)`（bid-project-notify.util.ts:17，含 isActive 闸与「宁可不发」语义）——零新增解析代码；
- `pauseOpening` 现有 select 只有 `stage/name`，须扩 `projectManagementItemId`；`upsertSupervisionAnnotation` 须补查项目（name + projectManagementItemId）。

**产生点一：`pauseOpening`**（controller 已传 `userId`，bid.controller.ts:531）
- 位置：落库成功后、return 前（现有监督日志写入之后）；
- 通知失败不阻塞暂停（try/catch + logger.warn——同 completeOpening 惯例，bid.service.ts:1194-1197）；
- content：项目名 + 暂停原因（可空）+「解密窗口计时已冻结，流标等后续处理请在开标确认面板操作」（时间不进正文——通知中心自带时间列；2026-10-23 终审 Minor-2 反向修措辞定案）。

**产生点二：`upsertSupervisionAnnotation`**
- 仅当状态**迁移至** escalated 时发（旧值非 escalated 且新值=escalated）；已是 escalated 的重复保存/仅改 notes 不发（防刷屏）。取旧值须按 `supplierId` 唯一键 `findUnique(bidSupervisionAnnotation)` 一次——现有 findFirst 查的是 bidSupplier 归属校验（bid.service.ts:5635），不能顺带取旧 status（评审勘误）；
- content：项目名 + 供应商名 + 上报批注（notes 截断 80 字，落库仍为全量——2026-10-23 终审 Minor-3 落地）；标题「项目X开标异常上报：供应商Y」（通知中心 label 仍为「现场异常上报」）。

### 4.3 :3005 流标按钮窗口放行（apps/web/src/components/projects/bid-confirm-panel.tsx）

现条件（:1336-1341，评审勘误行号）：`onAbort && (DOWNLOAD|SUBMIT|OPENING) && isWithinAbortWindow`。

改为：
- `stage === 'OPENING'` → 恒放行（不查窗口）；
- `DOWNLOAD/SUBMIT` → `diff <= BID_ABORT_WINDOW_BEFORE_OPENING_MS`（**无下界**——评审裁定：开标时间过点却停在 DOWNLOAD/SUBMIT 的滞留项目恰恰是流标高发场景，前窗的意义只是防发标早期误点，一旦进入决策窗应保持可用直至阶段推进）；
- `isWithinAbortWindow`（:141-145）去掉 `diff >= -AFTER` 下界；`BID_ABORT_WINDOW_AFTER_OPENING_MS`（constants.ts:182）退役——grep 全库确认仅此一处消费后删除，若他处有引则保留并加注释；
- 按钮 title 提示同步：OPENING 态不再显示「仅开标时间前 24h 内可操作流标」。

理由：闸门的立法本意是把 SUBMIT 期流标决策集中在临近开标窗口；项目已在 OPENING（含长期暂停）时后端本就放行，前端灰死只会逼用户走流标公告隐藏路径。

### 4.4 测试与验证

- **单测**（bid.service 现有 spec 体系）：
  - pauseOpening 成功后调 NotificationService.sendToUser 且收件人=解析集（mock 验证调用与参数）；
  - annotation：旧 escalated→再 escalated 不发；null/flagged→escalated 发。
- **浏览器端到端**（本仓前端无组件测试基建，按惯例浏览器验证）：
  1. :3007 暂停 → :3005 该公司 leader/staff 账号收到 WS 弹窗+通知中心待办，点开落 :3005 项目详情开标确认面板且显示「已暂停」；
  2. 监督视图上报 → 同上；重复保存不重发；
  3. 把 openTime 改到 72h 前（DB 手术，验后还原）→ OPENING 流标按钮可点，AbortDialog 走通（abort 后还原数据）。
- e2e（apps/api/test/，可选）：bid 套件加暂停通知冒烟一条。

## 5. 决定记录（含评审后修订）

| # | 决定 | 口径 |
|---|------|------|
| 1 | **收件人=仅 PMI 创建人**（2026-10-23 用户裁定 A） | 沿用 2026-10-09 口径：`resolveProjectCreatorId`，宁可不发不回退；突发告警不例外 |
| 2 | 仅 in_app 通道 | staff 无电话来源；SMS_PROVIDER 未配；同 BID_ABORTED 先例 |
| 3 | escalated 迁移才发 | 防重复 upsert 刷屏；旧值须按 supplierId findUnique 另取（评审勘误） |
| 4 | OPENING 恒放行而非窗口顺延 | 顺延须追踪暂停时长补偿链，复杂度不值；后端本就放行 |
| 5 | DOWNLOAD/SUBMIT 前窗**无下界** | 开标过点滞留项目保持可流标（评审裁定） |
| 6 | **actionable=false**（评审修订） | 事件性告警非待办：escalated 无自然消音时点，actionable=true 会永滞待办（markAsRead 拒置已读/stale-sweep 不扫 bid 域）；触达不受损（WS 弹窗+通知列表+深链照常） |
| 7 | 不通知监督人/主持人 | 都在现场；通知是给不在场的决策方 |
| 8 | annotation **POST 端点补 AssignedHostGuard**（2026-10-23 评审发现 2） | 现状=类级四角色无指派闸，escalated 通知会把该端点放大为跨公司触达向量；与 pause 端点（四角色+AssignedHostGuard）及 :3007 读侧 L6 隔离对齐，UI 无感知；GET/DELETE 维持现状留痕 |

## 6. 验收清单

1. 暂停 → 收件人立即收到通知（含 WS 弹窗），深链参数完整落开标确认面板，面板显示已暂停；
2. 上报 → 同触达；重复保存零重发；
3. openTime+72h 的 OPENING 项目流标按钮可点且 AbortDialog 全链走通；
4. 两类通知出现在通知中心列表（readonly，可正常已读，不进待办）；
5. tsc/现有单测全绿；并行会话协作按 CLAUDE.md 约定（禁 add -A、共享文件外科手术暂存）。
