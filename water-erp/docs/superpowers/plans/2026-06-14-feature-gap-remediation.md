# 功能落地审计修复实施计划（团队并行版）

> 对照文档：`water-erp/docs/superpowers/audit/2026-06-14-feature-audit-gaps.md`
> 工作区：`water-erp/`（pnpm workspace，API 在 `apps/api`）
> 计划日期：2026-06-14

## Context（为什么做这件事）

`feature-audit-gaps.md` 逐行审查 `apps/api/src/` 后列出 9 项"有 API/页面但业务逻辑空壳或不完整"的缺陷，其中 3 项标 🔴 严重（AI 风险评分全伪随机、标书解密无真实加解密、归档 hashDigest 伪造），6 项标 🟡 中等（专家回避/资质预警/绩效画像/多渠道通知/WebSocket 覆盖）。这些缺陷使系统的风控与合规能力形同虚设，需要逐一补齐真实业务逻辑。

本计划把这 9 项按文件归属切成 **6 条独立 track**，前置一条**基础设施 track**，使其可在 team 模式下并行执行。每条 track 产出自包含、可独立测试、可独立提交的改动。

## Scope（范围与显式排除）

**纳入（feature-audit-gaps.md 全部 9 项）**：
- §1.2 AI 供应商风险评分 → 数据驱动（Track B）
- §2.1 标书解密 → 真实加解密运算（Track C）
- §2.2 归档 hashDigest → 真实 SHA-256（Track C）
- §3.1 专家回避 → 自动利益冲突检测（Track D）
- §3.2 资质到期 → 主动通知（Track E + Track A 调度器）
- §3.3 供应商绩效 → 画像聚合 + 自动淘汰（Track E）
- §3.4 专家绩效 → 画像 + 自动退库（Track D）
- §3.5 多渠道通知 → 短信/邮件/IM 渠道抽象（Track A）
- §3.6 WebSocket → 扩展覆盖场景（Track F）

**显式排除**（属 `market-gap-analysis.md`，不在本计划，需另立计划）：
- 多信封投标、时效管控倒计时、电子签章/CA、二次报价/竞争性谈判、定标→合同链路、专家请假自动补抽。

**关键范围决策（已确认 2026-06-14）**：
- **Track C "真实解密" 界定为"信封式静态加密 + 完整性校验"**：投标文件以 `bid_document` 分类上传时用 AES-256-GCM 按项目密钥加密落 MinIO，开标解密时真实解密 + 校验 SHA-256/HMAC。这是对审计"无任何真实加解密运算"的直接修复，并赋予"开标前任何人都无法读取标书"的密封性。**法律级不可否认（per-supplier CA/数字签名）显式排除**，归入 market-gap #6 另做。

## Architecture（总体方法）

1. **Phase 0 — 基础设施（Track A，单 agent，必须先完成）**：调度器（`@nestjs/schedule`）、领域事件总线（`@nestjs/event-emitter`）、多渠道通知抽象（`NotificationChannel` + 派发器 + Email/SMS provider）、以及**所有 track 需要的 schema 加列**（Track A 独占 `schema.prisma`，消除并行期迁移冲突）。
2. **Phase 1 — 5 条业务 track 并行（B/C/D/E/F）**：每条 track 只改自己模块的 service，消费 Phase 0 提供的稳定契约（事件总线、通知派发器、已加列的 schema）。不新建 module、不改 `app.module.ts`、不碰 `schema.prisma`。
3. **Phase 2 — 集成**：全量测试、seed 快照刷新、lint、build、前端对接清单。

**Team 协作铁律（防并行冲突）**：
| 资源 | 唯一归属 |
|------|---------|
| `prisma/schema.prisma` | Track A（Phase 0） |
| `apps/api/src/app.module.ts` | Track A（Phase 0） |
| 新建 module 文件 | Track A（Phase 0） |
| `bid/bid.service.ts` + `bid/crypto.util.ts` | Track C |
| `bid/bid.gateway.ts` | Track F（仅订阅事件，不改 service） |
| `expert/expert.service.ts` + `expert-admin.service.ts` | Track D |
| `supplier/supplier.service.ts` + `supplier-portal/*` | Track E |
| `ai/ai.service.ts` | Track B |
| Phase 1 track 间通信 | 只走 `EventEmitter` / `NotificationDispatcher`，不跨模块直接 import |

业务 track 在关键点**只加 1 行 `eventEmitter.emit(...)` 或 `dispatcher.notify(...)`**，具体订阅/发送实现由 Track A/F 负责，从而避免跨模块文件冲突。

---

## Phase 0 — Track A：基础设施（先执行，单 agent）

**目标**：为所有业务 track 提供调度器、事件总线、多渠道通知派发器，并一次性加齐 schema 列。

**新增依赖**（`apps/api/package.json`）：`@nestjs/schedule`、`@nestjs/event-emitter`、`nodemailer`、`@types/nodemailer`(dev)。

### A1. Schema 加列（Track A 独占 `prisma/schema.prisma`）

按下方"schema 契约"一次性加列，跑 `pnpm db:migrate`（`migrate dev --create-only` + `db execute` + `migrate resolve --applied`，非交互），并把新/改模型补进 `seed.ts` 的 `ALL_TABLES` + 空 `seed-data/*.json` 快照（新增模型给 `[]`）。

**Schema 契约（各 track 只读消费，不得再改 schema）**：
```prisma
// Track C 用
model FileAsset {
  // ...existing...
  encrypted        Boolean   @default(false)
  encryptionKeyId  String?
  iv               String?     // GCM iv (base64)
  authTag          String?     // GCM authTag (base64)
}
model BidProject {
  // ...existing...
  encryptionKeyId  String?     // 项目数据密钥的引用/版本
}

// Track D 用
model ExpertProfile {
  // ...existing...
  retiredAt        DateTime?
  retireReason     String?
}

// Track A 用
model NotificationDeliveryLog {
  id            String   @id @default(cuid())
  notificationId String?
  userId        String
  channel       String   // in_app | email | sms
  status        String   // sent | failed | skipped
  error         String?
  createdAt     DateTime @default(now())
  @@index([userId])
}
```
Track E（供应商画像）与 Track B（AI 风险）均**按需计算，不加列**。

### A2. 调度器 + 领域事件总线

- `app.module.ts`：`imports` 增加 `ScheduleModule.forRoot()` 与 `EventEmitterModule.forRoot()`。
- 新建 `apps/api/src/scheduler/scheduler.module.ts` + `scheduler.service.ts`：
  - `@Cron('0 8 * * *')` 每日 08:00 调用 `supplierService.checkQualificationExpiry()`（已存在，`supplier.service.ts:401`），随后调用新增的 `supplierService.notifyExpiringQualifications()`（Track E 实现）。
  - `@Cron('0 1 * * 1')` 每周一 01:00 调用 `expertAdminService.reviewRetirementCandidates()`（Track D 实现；仅扫描+通知，不自动停用）。
  - 调度任务对依赖 service 用 `forwardRef` 或在模块内 `imports` 拉取，避免循环依赖。
- `EventEmitter2` 从 `@nestjs/event-emitter` 提供，全局可用。约定事件名常量集中在 `apps/api/src/common/events.ts`（如 `bid.score-submitted`、`bid.clarification-created`、`supplier.qualification-expiring`、`expert.auto-retired`）。

### A3. 多渠道通知抽象（修复 §3.5）

- 新建 `apps/api/src/notification/channels/`：
  - `notification-channel.interface.ts`：`interface NotificationChannel { readonly name: string; send(ctx: NotificationContext): Promise<DeliveryResult>; }`，`NotificationContext = { userId; title; content; type; link?; phone?; email? }`。
  - `in-app.channel.ts`：迁移现有 DB 写入逻辑（`prisma.notification.create`）。
  - `email.channel.ts`：`nodemailer`，SMTP 读 env（`SMTP_HOST/PORT/USER/PASS`），未配置时 `status='skipped'` 并 `Logger.warn`，不抛错。
  - `sms.channel.ts`：HTTP POST 到 `SMS_API_URL`（env），未配置则 `skipped`。
- 新建 `notification-dispatcher.ts`：`notify(ctx, channels?: ChannelName[])`，按渠道并行发送，每条写一条 `NotificationDeliveryLog`，in-app 始终发送（保证站内信不丢）。
- 改 `notification.service.ts`：`create` / `sendToRole` 内部改为调用 `dispatcher.notify({ ..., channel 默认 ['in_app'] })`；保留现有方法签名以兼容现有调用方。需要外部触达的场景（开标提醒、澄清、资质预警）由调用方显式传 `['in_app','email','sms']`。
- `NotificationModule` 增加 `providers: [...channels, NotificationDispatcher]`，`exports: [NotificationDispatcher]`。
- `.env` 文档：在 `apps/api/.env` 注释里补 SMTP/SMS 可选项（不写真实值）。

**Track A 验收**：
- `pnpm --filter api test` 通过；新增 `notification-dispatcher.spec.ts`（mock 各 channel，断言 in-app 始终发、未配置 channel 写 skipped）。
- `pnpm db:migrate` 成功，`pnpm db:seed` 幂等通过。
- 启动 API：`Swagger /api/docs` 出现无异常，调度器日志可见。

**提交**：`feat(infra): add scheduler, event bus, multi-channel notification dispatcher`

---

## Phase 1 — 业务 track（B/C/D/E/F 并行）

### Track B：AI 供应商风险评分数据驱动化（修复 §1.2）

**文件**：
- 改：`apps/api/src/ai/ai.service.ts:404-432`（`getSupplierRiskScores`）
- 测试：`apps/api/src/ai/ai.service.spec.ts`（新建）

**方法**：用真实数据源替换 `hashString(supplierName)` 派生：
| 因子 | 数据源（prisma） |
|------|----------------|
| 文件完整性 | `SupplierBidSubmission`（`technicalFileAssetId/businessFileAssetId/coverLetterAssetId` 三项齐全度，0/33/66/100%） |
| 解密状态 | `BidSupplier.decryptStatus`（已是真实值） |
| 资质合规 | `SupplierQualification` count + 是否存在 `已过期`/`即将过期` |
| 报价风险 | 该供应商 `SupplierBidSubmission.bidPrice` 与本项目全部有效报价均值/预算的偏离度 |
| 历史履约 | 该供应商历史 `SupplierEvaluation.score` 均值 + 中标次数（`BidEvaluationResult.recommended`） |

新增 `confidence`（0–1）：按可得真实信号占比计算（缺数据因子降权并标注 `dataAvailable:false`）。

**测试**：
- `getSupplierRiskScores` 在 mock 数据下各因子取真实值（非 `hashString`）；报价偏离度计算正确；`confidence` 随数据缺失下降。
- 对外 `GET /api/ai/projects/:projectId/risk-scores` 行为不变（返回结构兼容）。

**提交**：`feat(ai): data-driven supplier risk scoring`

### Track C：标书真实加解密 + 归档 hashDigest（修复 §2.1 / §2.2）

**文件**：
- 新建：`apps/api/src/bid/crypto.util.ts`
- 改：`apps/api/src/upload/upload.service.ts`（`upload()` 对 `bid_document` 加密落盘）
- 改：`apps/api/src/bid/bid.service.ts:311-384`（`decryptSupplier` 真实解密+校验）、`:584`（`hashDigest`）
- 测试：`apps/api/src/bid/crypto.util.spec.ts`（新建）、扩展 `bid.service.spec.ts`

**crypto.util.ts**（AES-256-GCM，密钥来自 env `BID_ENCRYPTION_KEY`，按 `projectId` HKDF 派生项目密钥）：
```ts
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
const MASTER = process.env.BID_ENCRYPTION_KEY ?? 'dev-master-key-32bytes-min-padding!!';
export function deriveProjectKey(projectId: string): Buffer {
  return createHmac('sha256', MASTER).update(projectId).digest(); // 32 bytes
}
export interface Sealed { iv: string; authTag: string; }
export function encryptBuffer(buf: Buffer, projectId: string): { cipher: Buffer; sealed: Sealed } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', deriveProjectKey(projectId), iv);
  const cipher = Buffer.concat([c.update(buf), c.final()]);
  return { cipher, sealed: { iv: iv.toString('base64'), authTag: c.getAuthTag().toString('base64') } };
}
export function decryptBuffer(cipher: Buffer, projectId: string, sealed: Sealed): Buffer {
  const d = createDecipheriv('aes-256-gcm', deriveProjectKey(projectId), Buffer.from(sealed.iv, 'base64'));
  d.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  return Buffer.concat([d.update(cipher), d.final()]); // 篡改/错误密钥会抛错
}
```

**upload.service.ts `upload()`**：`category === 'bid_document'` 且 `uploaderId` 能解析到项目时（通过 `SupplierBidSubmission`/上下文），`encryptBuffer(file.buffer, projectId)` 后 `putObject` 密文；`FileAsset` 写 `encrypted=true/iv/authTag`。`sha256` 仍按明文计算（供解密后校验）。**无项目上下文的 bid_document 暂不加密并记 `Logger.warn`**，避免破坏既有调用路径。

**bid.service.ts `decryptSupplier()`**：对 `encrypted=true` 的供应商投标 asset：`getObject` → `decryptBuffer` → 比对 `asset.sha256`；匹配设 `SUCCESS`，不匹配/GCM 校验失败设 `DANGER`（真实 `decryptError`）。`simulateDanger` 保留为显式演练开关。非加密 asset 走原流程。

**hashDigest**（`archiveAll` 第 584 行）：用真实 SHA-256 替换 `Date.now()+Math.random()`：
```ts
const canon = archiveItems.map(i => `${i.name}|${i.status}|${i.ownerRole}`).sort().join('\n');
const hashDigest = 'sha256:' + crypto.createHash('sha256').update(canon).digest('hex');
```
（同输入产生同 digest，可复核。）

**测试**：`crypto.util.spec.ts` 加解密往返、篡改密文抛错、不同 projectId 密钥隔离；`bid.service` 解密成功/失败两路径；hashDigest 幂等（同归档集 → 同值）。

**提交**：`feat(bid): real envelope encryption for bid documents + genuine archive hash`

### Track D：专家回避自动检测 + 画像 + 退库预警（修复 §3.1 / §3.4）

**文件**：
- 改：`apps/api/src/expert/expert.service.ts`（`confirmAvoidance` 前置自动检测）、`expert-admin.service.ts`（新增画像 + 退库预警）
- 新建：`apps/api/src/expert/expert-portrait.util.ts`（纯函数聚合）
- 测试：扩展 `expert.service.spec.ts` / `expert-admin.service.spec.ts`、新建 `expert-portrait.util.spec.ts`

**自动回避检测** `detectConflicts(userId, projectId)`：
- 工作单位（`ExpertProfile.employer`）标准化后与本项目各投标供应商的 `Supplier.name` + `Supplier.legalPerson` 双向包含匹配（复用 `expert-admin.service.ts:190-199` 既有逻辑，提取为共享 helper）。
- 历史合作：该专家过去参与的 `BidExpert` 项目中，是否与本项目任一投标供应商共同出现过。
- `confirmAvoidance()` 调用 `detectConflicts`：发现冲突 → 写监督日志（`riskFlag:'高风险'`）+ 经 `NotificationDispatcher` 通知开标主持人 + 抛 `BadRequestException({code:'AVOIDANCE_CONFLICT'})`；无冲突才允许置 `avoidanceConfirmed=true`。

**专家画像** `getExpertPortrait(userId)`：
- 参与次数、完成率、平均分、评分偏离度（该专家各项目 `BidScoreRecord` 与同项目其他专家均值的标准差均值）、评价等级趋势、是否"常委专家"（参与次数 ≥ 阈值）。

**退库预警（不自动执行）** `reviewRetirementCandidates()`（由 Track A 周一 cron 调用）：
- 扫描连续 ≥2 次 `ExpertEvaluation.level='D'` 或近 12 个月无分配的专家 → 产出候选清单 + 经 `NotificationDispatcher` 通知管理员 + `eventEmitter.emit('expert.retire-candidate', {userId, reason})`。**不**自动改 `availability`。
- 新增 admin 端点 `POST /api/expert-admin/:userId/retire`（`confirmRetire(userId, reason)`）：人工确认后才置 `availability='停用'` + `retiredAt` + `retireReason`，并发 `expert.auto-retired` 事件。

**测试**：冲突检测命中/未命中；画像数值正确；退库候选只命中条件专家。

**提交**：`feat(expert): auto conflict detection, portrait, retirement review`

### Track E：资质到期通知 + 供应商画像 + 淘汰预警（修复 §3.2 / §3.3）

**文件**：
- 改：`apps/api/src/supplier/supplier.service.ts`（新增 `notifyExpiringQualifications` / `getSupplierPortrait` / `reviewEliminationCandidates` / `confirmEliminate`）、`apps/api/src/supplier/supplier.controller.ts`（暴露画像端点）
- 新建：`apps/api/src/supplier/supplier-portrait.util.ts`
- 测试：扩展 `supplier.service.spec.ts`、新建 `supplier-portrait.util.spec.ts`

**资质到期通知** `notifyExpiringQualifications()`（由 Track A 每日 cron 调用，紧随既有 `checkQualificationExpiry`）：
- 查 30 天内 `status='即将过期'` 的 `SupplierQualification`（含 `supplier.userId`），按供应商去重，经 `NotificationDispatcher.notify({..., channels:['in_app','email']})` 推送。同资质 7 天内不重复（查 `NotificationDeliveryLog`）。

**供应商画像** `getSupplierPortrait(supplierId)`：
- 参与次数（`BidSupplier` count）、中标率（`BidEvaluationResult` 中 `supplierId===id` 且 `recommended` 占比）、平均绩效（`SupplierEvaluation.score` 均值）、价格偏离度（历史 `SupplierBidSubmission.bidPrice` 与对应项目中标价均值差）、响应速度（项目发布到 `submittedAt` 的中位时长，数据可得时计算）。

**淘汰预警（不自动执行）** `reviewEliminationCandidates()`：扫描连续 ≥2 次 `level='D'` 的供应商 → 产出候选清单 + 通知管理员 + `eventEmitter.emit('supplier.eliminate-candidate', {supplierId, reason})`，**不**自动改状态。
- 新增 admin 端点 `confirmEliminate(supplierId, reason)`：人工确认后才置 `Supplier.status='DISABLED'`。

**测试**：画像各维度数值；到期通知按供应商去重且 7 天去重；淘汰候选命中条件。

**提交**：`feat(supplier): qualification expiry alerts, portrait, elimination review`

### Track F：WebSocket 覆盖扩展（修复 §3.6）

**文件**：
- 改：`apps/api/src/bid/bid.gateway.ts`（新增订阅 + emit 方法）
- 测试：扩展 `bid.service.spec.ts` 或新建 `bid.gateway.spec.ts`

**方法**：基于 Track A 的 `EventEmitter2`，在 gateway 用 `@OnEvent(...)` 订阅 `common/events.ts` 中事件，转 `server.to('project:<id>').emit(...)`：
- `bid.score-submitted` → `score:update`
- `bid.clarification-created` / `clarification-replied` → `clarification:update`
- `bid.evaluation-progress` → `evaluation:progress`
- `archive.completed` → `archive:done`

各业务 track 在对应 service 关键点 `eventEmitter.emit('bid.score-submitted', {projectId,...})`（一行，不跨模块 import gateway）。Track F 只负责订阅与 socket 转发。

**测试**：mock `EventEmitter2` 触发事件，断言 `server.to().emit` 被调用且 room 正确。

**提交**：`feat(bid): expand WebSocket coverage via event subscriptions`

---

## Phase 2 — 集成

由集成 agent（或主线）执行：
1. `pnpm --filter api lint`、`pnpm --filter api test`（全量）、`pnpm --filter api test:e2e`。
2. 合并 schema 迁移与 seed：`pnpm db:migrate` → 改库 → `npx tsx prisma/scripts/dump-seed.ts` 刷新 `seed-data/*.json` → `pnpm db:seed` 验证幂等。
3. `pnpm build`（含 `@water-erp/shared`/`config` 先 build）。
4. 前端对接清单（后续任务，非本计划）：web/expert-portal/supplier-portal 接入画像端点、通知设置页。

## Verification（端到端验证）

- **单元/集成**：`pnpm --filter api test` 全绿；新增 spec 覆盖每条 track 的核心分支。
- **Track C 真实性手测**：起 infra（`pnpm infra:up`）+ `pnpm db:seed`；以 supplier1 上传 `bid_document` → 直查 MinIO 对象应为密文（非可读 PDF 头）；主持人触发解密 → 成功且 `FileAsset.sha256` 与原文一致；篡改 MinIO 对象后再解密 → `DANGER` + 真实错误。
- **Track A/E 资质预警**：手动改一条 `SupplierQualification.validTo` 为今+5 天 → 触发/等待 cron → 供应商收到站内信且 `NotificationDeliveryLog` 有记录。
- **Track D 回避**：构造专家 `employer` 与某投标供应商名称包含关系 → `confirmAvoidance` 返回冲突。
- **Track F**：开两个 socket 客户端 join 同 project → 提交评分 → 另一端收到 `score:update`。
- **Swagger**：`/api/docs` 新端点（画像、retire/eliminate 确认）出现且无需鉴权异常。

## 风险与回滚

- **Track C 改动上传路径**风险最高：通过"仅 `bid_document` + 有项目上下文才加密"渐进启用，未覆盖路径记 warn，保证既有流程不中断。回滚=还原 `upload.service.ts`/`bid.service.ts`，密文对象不可读但不影响新上传。
- **schema 加列**：全部 nullable/有默认值，向前兼容；`pnpm db:seed` 幂等可重建。
- **外部 provider 未配置**：email/sms channel 默认 `skipped`，绝不阻断主流程。

## Team 分工总览

| Track | 范围（feature-audit-gaps 条目） | 阶段 | 依赖 |
|-------|-------------------------------|------|------|
| A | 基础设施 + §3.5 + schema 契约 + 事件总线 + 调度器 | Phase 0（先） | 无 |
| B | §1.2 AI 风险 | Phase 1 | A（schema） |
| C | §2.1 + §2.2 加解密 + hashDigest | Phase 1 | A（schema） |
| D | §3.1 + §3.4 专家回避/画像/退库 | Phase 1 | A（事件/通知/调度） |
| E | §3.2 + §3.3 资质预警/画像/淘汰 | Phase 1 | A（通知/调度） |
| F | §3.6 WebSocket 扩展 | Phase 1 | A（事件总线）+ 各 track emit 点 |

Phase 1 的 B/C/D/E/F 五条 track 文件互不重叠，可由 5 个 subagent 并行执行；Phase 2 集成由主线收口。

## 已确认的关键决策（2026-06-14）

1. **Track C 范围** = 信封式静态加密 + 完整性校验；CA/数字签名排除（归 market-gap #6）。
2. **外部 provider** = 搭通道 + 默认 skipped + 留 env 占位；不接真实凭据，后续填 env 即生效。
3. **自动退库/淘汰** = **只生成预警建议，不自动执行状态变更**。cron 扫描候选 + 通知，实际停用须 admin 人工确认端点。
4. **前端** = 仅后端；web/expert-portal/supplier-portal 画像与通知 UI 列入后续前端对接清单。
