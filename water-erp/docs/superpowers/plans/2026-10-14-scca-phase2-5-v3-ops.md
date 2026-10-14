# SCCA 阶段 2.5：dual-v3 运营闭环（补传/备份/事件/清理/清账）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把阶段2 交付的「能投一次真实的 v3 标」补成「能运营一条 v3 生产线」——解密异常可补传恢复、归档证据链完整、Outbox 事件流动、暂存垃圾清理、复审 Minor 清账。

**Architecture:** 全部工作在既有 dual-v3 骨架上增量：补传走 revision+1 版本推进（SubmissionVersion 链即审计链，不撤回）；备份沿用 BidFileBackup 表扩 revision 维度（自然键 [projectId,supplierId,fileRole,revision] 等价 submissionId+revision+role，零回填）；Outbox 消费者挂 Scheduler 单实例轮询 CAS 抢占；暂存清理走运维级直删（绕过删除端点硬保护）。

**Tech Stack:** NestJS 11 + Prisma（1 枚迁移）+ Next.js 16（1 张补传卡）+ @water-erp/ukey 原语复用。

**Spec:** `docs/superpowers/plans/2026-10-14-scca-phase2-dual-v3-bid-chain.md`（阶段2 计划，本计划是其收尾）+ 复审报告 Rulings（ledger `2026-10-14-scca-phase2-dual-v3-bid-chain.md` 修复轮段落）。

## Global Constraints

- 唱标金额单位铁律：v3 fields 固定 `amountUnit:'万元'`，任何新读端禁止裸读裸算（CLAUDE.md 金额链口径地图）。
- PIN/nonce 不入 URL/console/操作日志；`decrypt-upload` 已在 OPERATION_LOG_EXCLUDE 默认表。
- 新路由必须显式 `@Roles/@AnyRole/@Public` 之一（RolesGuard 默认拒绝）。
- 改 `packages/ukey`/`packages/client` src 后必须 rebuild dist（CI validate 链）。
- 改 `schema.prisma` 后提交前 `cd apps/api && npx prisma validate`；迁移走 `--create-only` + `db execute` + `resolve`（非交互约定）。
- 并行会话协作约定生效：禁 `git add -A`，共享文件（schema.prisma/supplier-portal.service.ts）仅在对方工作区干净时改。
- 测试模式沿用：mock Prisma 直测 service 类；接线缺陷用 e2e 兜底（阶段2 教训：mock 掩盖 DI/列名/域错配）。
- Outbox/清理 cron 只在主 API 进程注册（SchedulerModule 既有形态），worker 不注册。

## Review Focus（计划自带的刻意核查面——每条已钉到归属任务的测试步骤）

1. **补传改价**：开标期借补传重算 fieldsCommit/换 nonce 改价 → T2 Step1 测试钉死「新 fieldsCommit ≠ 原快照 → 400 FIELDS_COMMIT_CHANGED」。
2. **补传明文替换**：新文件冒充原标书（plainSha256 不符）→ T2 Step1 测试「plainSha256 不符 → 400 PLAIN_HASH_MISMATCH」。
3. **staging 清理误删**：删掉已投递（被 SubmissionVersion 引用）或在途暂存 → T7 Step1 测试「被引用/未过期不删，仅过期且未引用删」。
4. **Outbox 重复消费**：同事件重复通知/并发双消费 → T6 Step1 测试「CAS 抢占后第二笔跳过 + 通知恰一条」。
5. **存量名册兼容**：BidSupplier.supplierId 为 null 的存量行按 supplierId 匹配查不到 → 建重复名册行 → T8 Step1 测试「null-supplierId 行按 supplierName 兜底命中不建新行」。
6. **迁移期备份键共存**：v2 存量行（revision=0）与 v3 新行（revision≥1）不撞新唯一键 → T4 Step1 测试「同 supplier+project+role 两版本并存」。

---

### Task 0: 迁移——BidFileBackup 扩 revision + Outbox 扩 attempts

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（BidFileBackup / Outbox）
- Create: `apps/api/prisma/migrations/20261014150000_scca_v3_ops/migration.sql`
- Test: `apps/api/src/ca/ca-v3-ops-migration.spec.ts`

**Interfaces:**
- Produces: `BidFileBackup { +revision Int @default(0) }`、唯一键 `@@unique([projectId, supplierId, fileRole, revision])`（原 `[supplierId, projectId, fileRole]` 删除；supplierId+projectId 与 submission 一一对应，等价 submissionId+revision+role 自然键，v2 存量行 revision=0 零回填）；`Outbox { +attempts Int @default(0), +lastError String? }`。

- [ ] **Step 1: 失败测试**——migration spec：新列存在 + 唯一索引名/列序正确 + Outbox attempts 默认 0（`information_schema` 查询，沿 ca-v3-migration.spec 先例）。
- [ ] **Step 2: FAIL**（列不存在）
- [ ] **Step 3: 实现**——schema 改动 → `prisma migrate dev --create-only` → 生成 SQL 审阅（含 DROP CONSTRAINT 旧唯一 + ADD 新唯一，**禁止 diff 重生成 OperationLog DDL**）→ `db execute` → `resolve --applied` → `prisma generate`（严禁 `--no-engine`）。
- [ ] **Step 4: PASS + `npx prisma validate`**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): 迁移——BidFileBackup revision 维度+Outbox attempts`

---

### Task 1: reupload-context 端点（补传锚点下发）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（新增 `getReuploadContext`）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`
- Test: `apps/api/src/ca/ca-v3-reupload.spec.ts`（本任务起建，后续任务追加）

**Interfaces:**
- Consumes: Task 阶段2 SubmissionVersion（当前 revision 快照）
- Produces: `GET /supplier-portal/bid-submissions/:projectId/reupload-context` →
  `{ baseRevision: number, fieldsCommit: string, roles: Array<{role: V3Role, plainSha256: string, plainBytes: number}>, sealedFields: DualV3SealedFields }`
  （客户端 unwrap sealedFields 复原 fields+nonce → 重封；锚点全部来自**版本快照**而非 submission 行，防行内篡改。）

- [ ] **Step 1: 失败测试**——dual-v3 + OPENING + 已递交 → 返回快照锚点；非 v3 → 400 NOT_DUAL_TRACK；无快照 → 400 VERSION_SNAPSHOT_MISSING。
- [ ] **Step 2: FAIL → Step 3: 实现**（门控：成员+OPENING+submission dual-v3+status submitted；读 SubmissionVersion(submissionId, sub.revision)）→ **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): reupload-context 端点——补传锚点自版本快照下发`

---

### Task 2: reuploadBidV3 服务端（四闸 + CAS 版本推进 + 状态重置）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（新增 `reuploadBidV3`；`submitBid` 不动）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（`POST .../bid-submissions/:projectId/reupload-v3`，`@Roles('supplier')`）
- Test: `apps/api/src/ca/ca-v3-reupload.spec.ts`（追加）

**Interfaces:**
- Consumes: 阶段2 prepare(action=`reupload`——已在白名单)/signing-payload/`nextRevisionContext` 契约；Task 0 无依赖。
- Produces: body `{operationId, signatureFormat:'scca-pkcs7-base64', signP7, baseRevision}`；信封取冻结 canonical（mirror submitBidV3）。闸门顺序（前事务）：
  1. 阶段=OPENING（`PROJECT_NOT_OPENING`）；op subject/purpose/status 门（`OPERATION_INVALID`/`PURPOSE_MISMATCH`/`OPERATION_NOT_COMMITTABLE`）
  2. 信封 context 交叉（projectId/supplierId/revision=baseRevision+1）+ 新 assetId 归属（`FILE_NOT_OWNED`）
  3. **明文锚点闸**：对快照(baseRevision) envelope 的每个 role：新信封 entry 存在且 `plainSha256 === 快照.plainSha256`，否则 400 `PLAIN_HASH_MISMATCH`
  4. **改价闸**：`新.fieldsCommit === 快照.fieldsCommit`，否则 400 `FIELDS_COMMIT_CHANGED`
  5. **角色保全闸**：新信封 roles ⊇ 快照 roles（丢角色 400 `ROLE_LOST`）
  6. **外层实算闸**：新 entry.assetId 的 FileAsset.sha256 === entry.outerSha256（encrypted-assets 服务端实算值交叉）
  事务内：CAS(baseRevision===sub.revision 否则 409 `REVISION_CONFLICT`) → SubmissionVersion(revision+1) → submission `{revision, envelope, outerDecryptedAt: null, innerAssets: Prisma.DbNull}` → bidSupplier `{decryptStatus:'PENDING', decryptError: null, decryptedAt: null}` → 监督日志「v3 补传（版本推进 N→N+1）」→ op CAS commit。P2002 → 409。
  DecryptExecution：新 revision 自然开新槽（唯一键含 revision），旧 C_inner 对象（键含旧 revision）留存为证据，不清理。

- [ ] **Step 1: 失败测试**——六闸各一用例（含 Review Focus 1/2）+ 成功路径（revision 推进+状态重置+op commit）+ P2002→409。
- [ ] **Step 2: FAIL → Step 3: 实现 → Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): reuploadBidV3——四闸+CAS 版本推进+解密状态重置`

---

### Task 3: 前端补传卡 + 挂载

**Files:**
- Modify: `apps/supplier-portal-next/src/utils/dual-v3-client.ts`（`encryptAndUploadV3` 增可选参 `reuseNonce?: string`——有则 fieldsCommit/密封 nonce 用它；新增 `unwrapSealedFields(dekJson, sealedFields)`）
- Create: `apps/supplier-portal-next/src/components/ca-bid-reupload-card.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx`（DAMAGE 挂载）
- Test: `apps/supplier-portal-next/src/utils/__tests__/dual-v3-client.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 reupload-context；Task 2 reupload-v3；`scca.unwrapSccaKey`；`nextRevisionContext`；`supplierApi.getAdminCert()`（kadmin 收件人，卡内装配沿 CaBidSubmitSection 模式）；encCertPem 盾枚举运行时取（沿投递卡模式）。
- Produces: `encryptAndUploadV3` 第 9 参 `reuseNonce?: string`（现有 8 参：projectId…context——追加在尾，不破坏既有调用）（有则 nonce 与 fieldsCommit 均按它计算——补传复用原 nonce 使 fieldsCommit 必然一致）。卡流程=取 context → PIN → 盾 unwrap `sealedFields.kself` → DEK_F → `sm4Decrypt(cipher)` 复原 `{fields, nonce}` → 用户重选各 role **原始文件** → `encryptAndUploadV3(..., context, reuseNonce)`→ `prepare('reupload')` → `signing-payload` → POST reupload-v3（`nextRevisionContext` 的 revision=base+1）。挂载条件：解密状态 DANGER/EXCEPTION 且 `record.submitted.envelopeVersion==='dual-v3'`；失败态字段+按钮放行（沿阶段2 UI 验收口径）；进度残句失败即清。
  `unwrapSealedFields(dekJson: string, sealedFields: DualV3SealedFields): Promise<{fields: V3Fields, nonce: string}>`——Node/浏览器同源（sm4Decrypt+TextDecoder），单测闭环（解回 canonicalJson({fields,nonce})）。

- [ ] **Step 1: 失败测试**——`reuseNonce`：同 fields+复用 nonce → fieldsCommit 与首次一致；`unwrapSealedFields`：用 encryptAndUploadV3 产物解回原 fields+nonce（闭环）。
- [ ] **Step 2: FAIL → Step 3: 实现 → Step 4: PASS + `pnpm test` + `pnpm build`**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): 前端补传卡——盾复原 fields+nonce 重封+版本推进递交`

---

### Task 4: bid-backup v3（投递/补传统一固化）

**Files:**
- Modify: `apps/api/src/bid-backup/bid-backup.service.ts`（`StagedBackup`/`persistBackup` meta 增 `submissionId/revision`）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（`submitBidV3` + `reuploadBidV3` 集成）
- Test: `apps/api/src/bid-backup/bid-backup.service.spec.ts`（追加）+ `apps/api/src/ca/ca-v3-reupload.spec.ts`（补传重备断言）

**Interfaces:**
- Consumes: Task 0 迁移列；阶段2 encrypted-assets（C_outer 已在 MinIO，key=FileAsset.key）。
- Produces: submitBidV3 逐 role（envelope.files）：`fileAsset.findUnique(entry.assetId)` → `minioClient.getObject(asset.key)` → `stageBackup({projectId, supplierId, fileRole: role, fileAssetId, sealedPath: asset.key, ciphertext, wrappedDek: JSON.stringify({kself: entry.kself.value, kadmin: entry.kadmin.value, adminCertId: entry.kadmin.adminCertId}), plaintextSha256: entry.plainSha256})`；事务内 `persistBackup(tx, staged, {submissionId: sub.id, revision: newRev, receiptNo, submittedAt: now, backupSource: 'submission', cryptoVersion: 'dual-envelope-v3'})`；失败清理 mirror v2（newlyStaged 备份对象回滚删除，不动 v3-staging 本体）。reuploadBidV3 成功路径同款重备（backupSource 保持 'submission'）。v2 路径 persist 不传 submissionId/revision → 默认 revision=0，存量行为不变。

- [ ] **Step 1: 失败测试**——submit v3 后每 role 一条 BidFileBackup（cryptoVersion/wrappedDek 三键/revision=newRev）；同 supplier+project+role 两个 revision 并存（Review Focus 6）；补传后 revision+1 新备份行；v2 persist 不带新字段仍绿（回归）。
- [ ] **Step 2: FAIL → Step 3: 实现 → Step 4: PASS + 全量 `npx jest src/bid-backup src/ca src/supplier-portal`**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): bid-backup v3——双钥合账+版本维度固化`

---

### Task 5: 备份读端分派（核验/回流包）

**Files:**
- Modify: `apps/api/src/bid-backup/bid-backup.service.ts`（核验路径）+ 归档 collector 引用点（`grep -rn "BidFileBackup\|bidFileBackup" apps/api/src --exclude-dir=dist` 定位：预期 `bid/archive`/回流包 collector 与 `scripts/` 核验脚本）
- Test: 就近追加（核验 spec 或新 `ca-v3-backup-read.spec.ts`）

**Interfaces:**
- Consumes: Task 4 落库行（cryptoVersion='dual-envelope-v3'）。
- Produces: 分派规则——`cryptoVersion==='envelope-v1'`：现行 KMS 解包核验不变；`'dual-envelope-v2'`：现行双 DEK JSON 语义不变；**`'dual-envelope-v3'`：核验=对象存在 + `ciphertextSha256` 比对 + `plaintextSha256` 与 SubmissionVersion 快照锚点一致（不解 DEK——kself 是盾 P7、kadmin 是 SM2 公钥密文，平台无钥可解是设计而非缺陷）**；wrappedDek 原样入回流包（自证材料）。对象缺失走既有 `--rebuild-missing` 重建口径（以 v3-staging/bid-inner 前缀重取）。

- [ ] **Step 1: 失败测试**——v3 行核验：哈希一致 PASS；ciphertextSha256 不符 FAIL；快照 plainSha256 不符 FAIL。
- [ ] **Step 2: FAIL → Step 3: 实现（先 grep 定位全部消费点逐一接入，漏一处记 Ruling）→ Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): 备份读端 v3 分派——哈希核验+快照锚点交叉`

---

### Task 6: Outbox 消费者（事件流动）

**Files:**
- Create: `apps/api/src/scheduler/outbox-dispatch.service.ts`
- Modify: `apps/api/src/scheduler/scheduler.module.ts`（providers）
- Test: `apps/api/src/scheduler/outbox-dispatch.service.spec.ts`

**Interfaces:**
- Consumes: Task 0 attempts/lastError 列；`NotificationService.sendToUser(userId, ['in_app'], {type,title,content,link})`；`BidProject.assignedHostUserId`。
- Produces: 公共方法 `dispatchOnce(): Promise<{sent:number, failed:number, skipped:number}>`（Cron 与测试共调；`@Cron(CronExpression.EVERY_30_SECONDS)` 仅薄壳）。轮询：`updateMany({id, status:'PENDING'}, {status:'DISPATCHING'})` 逐条 CAS 抢占（take 20）→ topic registry 分发——`'bid.submitted.v3'`：`bidProject.findUnique({assignedHostUserId})` 有则 sendToUser（type `BID_SUBMITTED_V3`，link `/bid` 指 :3007 任务板——无已验证深链，宁裸勿错链）→ 成功 `SENT + publishedAt`；失败 `attempts+1`，`attempts>=5 → FAILED + lastError`，否则回 `PENDING`（下轮重试）。无主持人 → 直接 SENT（payload 记 skipped 原因）。topic 未注册 → FAILED（lastError='no handler'）。幂等：CAS 抢占保证同事件仅一个消费者；通知侧以 status CAS 为准（Review Focus 4）。

- [ ] **Step 1: 失败测试**——成功路径（抢占→通知→SENT）；第二笔并发抢占 count=0 跳过；失败 4 次留 PENDING、第 5 次 FAILED；无 handler → FAILED。
- [ ] **Step 2: FAIL → Step 3: 实现 → Step 4: PASS + Scheduler 模块单测全绿**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): Outbox 消费者——CAS 抢占+topic 分发+退避封顶`

---

### Task 7: v3-staging 过期清理 cron

**Files:**
- Modify: `apps/api/src/scheduler/scheduler.service.ts`（追加 `@Cron('30 3 * * *')` 方法，委托新服务）
- Modify: `apps/api/src/scheduler/scheduler.module.ts`（providers 注册 StagingCleanupService）
- Create: `apps/api/src/scheduler/staging-cleanup.service.ts`
- Test: `apps/api/src/scheduler/staging-cleanup.service.spec.ts`

**Interfaces:**
- Consumes: FileAsset（key 前缀 `v3-staging/`）+ SubmissionVersion 引用集。
- Produces: 扫 `v3-staging/` 前缀且 `createdAt < now-24h`（take 500/轮）→ 引用集=全部 SubmissionVersion.envelope 的 `files[].assetId`（`findMany({select:{envelope:true}})` 应用层提取，避免 Prisma JSON 数组 path 查询限制）→ 未被引用 → `minioClient.removeObject` + `prisma.fileAsset.delete`（**运维级直删，绕过删除端点 bid_document 硬保护——这是设计而非漏洞**）；被引用/未过期不动（Review Focus 3）；汇总监督日志一行（删 N 留 M）。MinIO 对象已失 DB 行的孤儿本轮不处理（记 Ruling 延后）。

- [ ] **Step 1: 失败测试**——过期+未引用→删（MinIO+DB 双删）；被引用→不删；未过期→不删；引用集含多版本多 role。
- [ ] **Step 2: FAIL → Step 3: 实现 → Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3-ops): v3-staging 过期清理——引用反查防误删+运维级直删`

---

### Task 8: 复审 Minor 清账（打包一笔）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（名册匹配/receiptNo 防碰撞；clarification/confirm op commit 后移）+ `decryptUpload` 证明 commit 后移
- Modify: `apps/api/src/ca/ca-binding.controller.ts`（GET /ca/operations/:id 域修复）+ `apps/api/src/ca/ca-operation.ts`（CA_OP_STATUS 补 PAYLOAD_READY + purpose 注释）
- Test: `apps/api/src/ca/ca-v3-submit.spec.ts`（名册用例改造）+ `ca-v3-receipt.spec.ts`（commit 时序回归）+ 新 `ca-ops-minor.spec.ts`

**Interfaces:**
- Produces:
  - 名册：v2/v3 两处 `findFirst({projectId, supplierName})` → `findFirst({projectId, OR:[{supplierId}, {supplierName, supplierId: null}]})`（存量 null-supplierId 行按名兜底——Review Focus 5）；receiptNo 生成后 `findFirst({receiptNo})` 查重，撞则重生成至多 3 次。
  - op commit 时序：clarification/confirmOpening/decrypt-proof 三处把 op 的 `updateMany CAS commit` 从「业务写之前」移到「业务写成功之后」（receipt 已在事务内不动）；失败路径 op 留 PAYLOAD_READY 可重试（重放防护由 CAS 单次性承担，语义不降）；decrypt-upload 的 DANGER 终局同理留 PAYLOAD_READY——「重置解密机会」重试路径可复用同一证明操作。
  - `GET /ca/operations/:id`：`op.subjectType==='supplier'` 时按 `supplier.findUnique({userId}).id` 比对（不再用 User id 恒 403）。
  - `CA_OP_STATUS.PAYLOAD_READY = 'PAYLOAD_READY'` 常量 + CaOperation purpose 注释补投递链枚举 + `canonicalVersion` 注释澄清「冻结哈希用 JSON.stringify（键序敏感），签的是冻结文本本身」。
  - M-3 留痕：`signing-payload` 冻结闸处补注释「读-判-写非原子——并发双签窗后写覆盖，兜底=P7 针对最终 canonical + commit CAS 单次，最坏自伤」。
  - M-5 记 Ruling 延后：同毫秒同哈希前缀对象键静默覆盖——概率可忽略且覆盖幂等，不修。

- [ ] **Step 1: 失败测试**——名册兜底（null-supplierId 存量行命中不建新行）；receiptNo 撞号重生成；三处 commit 后移（业务失败→op 仍 PAYLOAD_READY；业务成功→op COMMITTED）；operations/:id 对 bid 链 op 200。
- [ ] **Step 2: FAIL → Step 3: 实现 → Step 4: PASS + 全量回归**
- [ ] **Step 5: Commit** `fix(scca-v3-ops): 复审 Minor 清账——名册域兜底+op 时序+域修复+文档漂移`

---

### Task 9: 全量回归 + e2e 扩展

**Files:**
- Modify: `apps/api/test/bid-v3.e2e-spec.ts`（追加 ⑨⑩）
- Test: 全量

**Interfaces:**
- Produces:
  - e2e ⑨ 补传链（**独立项目自建场景，不改既有 ⑥ 用例**）：新项目投递成功 → decrypt-upload 用损坏明文触发 DANGER → `reupload-context` 取锚点 → 客户端逻辑（Node 侧同构）unwrap sealedFields 复原 fields+nonce → 重选原明文 → `encryptAndUploadV3(reuseNonce)` → prepare('reupload')/signing-payload → POST reupload-v3 → 断言 revision=2、decryptStatus 重置 PENDING、BidFileBackup revision=2 行在 → 重跑 decrypt-upload（复用 nonce 的 fieldsCommit 过闸）→ SUCCESS。
  - e2e ⑩ Outbox：提交后手动调用 dispatch 一轮（测试直调 service 或等 cron 不现实——`app.get(OutboxDispatchService).dispatchOnce()`）→ 断言 outbox SENT + 主持人通知落库恰一条。
  - 全量：`npx jest`（API 全量）+ `pnpm --filter @water-erp/ukey test` + 前端 `pnpm test` + 双端 build + `npx prisma validate`。

- [ ] **Step 1: e2e 扩展编写并跑通（真库真 MinIO）→ Step 2: 全量单测 → Step 3: 前端 build → Step 4: Commit** `test(scca-v3-ops): 补传链+Outbox 消费 e2e`
- [ ] **Step 5: Final whole-branch review（fresh reviewer，review-package MERGE_BASE=main）**

---

## 任务依赖与顺序

T0 →（T1 → T2 → T3 补传链）→（T4 → T5 备份链，T4 依赖 T2 的 reuploadBidV3 存在）→ T6 → T7 → T8（独立，可穿插）→ T9。

## 明确出界

专家端/:3007 v2-only 读分支与专家证书签名（阶段3）；真盾 Windows 端到端（独立验证轨）；支付/音视频/监管联调。
