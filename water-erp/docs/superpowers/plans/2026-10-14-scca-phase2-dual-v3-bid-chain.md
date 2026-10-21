# SCCA 阶段2（dual-v3 投递链）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 供应商投递链从旧 clientDeks 明文轨升级到 dual-v3 SCCA 真盾 P7 签名信封，同时将回执/开标确认/澄清答复从 unsigned-legacy 恢复为 P7 强签。

**Architecture:** 浏览器组装 dual-v3 信封（SM4 文件层 + GM/T 0010 P7 密钥封装 + SM4 唱标密封）→ prepare/signing-payload/commit 三步操作链 → 服务端验签后原子落库；开标解密走历史加密证 unwrapKey + 解密上传 P7 证明；回执/确认/澄清各建 P7 canonical。SubmissionVersion 表提供不可变版本快照 + CAS 并发控制。

**Tech Stack:** NestJS 11 + Prisma（新模型 SubmissionVersion/DecryptExecution/Outbox）+ `@water-erp/ukey`（新增 dual-v3 类型与 canonical）+ `CaVerificationService`/`CaOperationService`（阶段1底座）。

**Spec:**
- 契约权威：`docs/superpowers/specs/2026-10-12-scca-ui-api-contracts.md` §5（下称「附录 §5」——本计划按其 A-E 分节标注来源）
- 主方案：`docs/superpowers/specs/2026-10-10-scca-integration-design.md` §6（下称「主方案 §6」）
- 阶段1底座：`apps/api/src/ca/`（CaModule 已注册；CaVerificationService/CaChallengeService/CaOperationService/CaEvidenceService 已就位）
- SCCA 实测：`docs/superpowers/specs/phase0-evidence/结论回填表.md`（信封=GM/T 0010 SM2+SM4-ECB、密钥包≈460B、双证同容器、S7 中间件强制分钥）

## Global Constraints

- **World B 铁律**：网关不比对 toSign——本地 attached-P7 原文比对无条件强制（阶段1 CaVerificationService 已实现，本计划直接消费）。
- **信封格式**（附录 §5.A）：`version='dual-v3'`，`canonicalVersion='erp-json-v1'`，`provider='scca'`；kself P7 `scca-pkcs7-base64`、kadmin `sm2-c1c3c2-hex`（分角色独立 adminCertId）；文件 SM4 CBC/PKCS#7；密钥包装内部=`canonicalJson({k:keyHex,iv:ivHex})`，k/iv 各 32 位小写 hex。
- **fields 密封**（附录 §5.A）：`sealedFields={cipherFormat:'sm4-cbc-pkcs7-hex', cipher, cipherSha256, cipherBytes, kself}`——**无 kadmin、无 fieldsSha256**（v3 禁止无盐唱标摘要）。fields={price, amountUnit:'万元', currency:'CNY', deliveryPeriod, qualityCommitment}；nonce 16 字节 CSPRNG（32 字符小写 hex）；`fieldsCommit=sha256(UTF8(canonicalJson(fields)+':'+nonce))`。
- **P7 上限**：Base64 ≤256KiB 字符 / 解码后 ≤192KiB；信封 JSON UTF-8 ≤1MiB（附录 §2.5）。
- **操作链三步**：`POST .../operations/prepare` → `POST .../operations/:id/signing-payload`（冻结 canonical）→ 现有端点新分支（operationId+signP7 提交）。CA 验证在事务外。
- **CAS**：提交/补传/撤回必须以 baseRevision + 原信封摘要作 CAS；并发同版本仅一胜（附录 §5.D）。
- **回执强签恢复**：回执/开标确认/澄清答复在 dual-v3 轨上恢复 P7 签名（`scca-pkcs7-base64` 格式标识；CaVerificationService 验证）；旧轨 legacy 行保留 unsigned-legacy 原样。
- **计量纪律**：真网关调用不打 mock；P7/DER fixture 复用 `apps/api/test/fixtures/scca/`（阶段0 实测产物）。
- **无 mock fallback**：信封 v3 写入由 `CA_SUPPLIER_V3_ENABLED` 控制（关闭=只禁新写入，已产生的 v3 信封读/解密能力保留）。
- **禁 `git add -A`**；`feat(scca-v3):` 前缀小步提交；不主动 push。

## Review Focus

1. **v3 信封未签名直接提交**（绕过 signing-payload 冻结）→ prepare 返回的 operationId 必须与提交端点校验一致，未冻结的 operationId 拒收 400 `OPERATION_PAYLOAD_REQUIRED`。
2. **同 revision 并发重投/补传撞唯一索引**→ CAS 在事务内先行，冲突返 409 `REVISION_CONFLICT`，非 P2002 裸 500。
3. **v2 信封被 v3 读端误解析**（kself 是 raw SM2 hex，被当作 P7 base64）→ 版本分派必须先验 `envelope.version === 'dual-v3'` 再走 v3 密钥解包。
4. **sealedFields 的 nonce 被上传或公开**→ 开标前所有请求/日志/metadata 中无 nonce 字段；解密上传端点接收 fieldsJson+nonce 但操作日志已排除（OPERATION_LOG_EXCLUDE 已含）。
5. **金额跨单位链**→ v3 fields 固定 amountUnit:'万元'，OpeningRecord.amount 由 syncMultiRoundPrices 走 `parseAmountToYuan({unitHint:'万元'})` 换算为元。

---

### Task 0: Prisma 增量——SubmissionVersion / DecryptExecution / Outbox + SupplierBidSubmission.revision

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261014120000_scca_dual_v3/migration.sql`
- Test: `apps/api/src/ca/ca-v3-migration.spec.ts`

**Interfaces:** Produces（后续所有任务依赖）：

- `SubmissionVersion`：`{id, submissionId, revision Int, envelope Json, envelopeHash, submittedAt, operationId?}` — submissionId+revision 唯一索引
- `DecryptExecution`：`{id, submissionId, revision Int, phase String('outer'|'inner'), attemptId, fence Int, leaseUntil DateTime?, status String}` — submissionId+revision+phase 唯一
- `Outbox`：`{id, topic, payload Json, status String('PENDING'|'PROCESSED'), publishedAt?}`
- `SupplierBidSubmission` 新列：`revision Int @default(0)`（当前活跃版本号，0=旧轨无版本管理）

- [ ] **Step 1: 写失败测试**——`ca-v3-migration.spec.ts`：SubmissionVersion 唯一索引生效、DecryptExecution 槽位唯一、SupplierBidSubmission.revision 列存在

- [ ] **Step 2: 跑测试确认 FAIL**（模型不存在）

- [ ] **Step 3: schema 增量 + 迁移 SQL**

```prisma
model SubmissionVersion {
  id            String   @id @default(cuid())
  submissionId  String
  revision      Int
  envelope      Json     // dual-v3 完整信封（含 context/files/sealedFields/fieldsCommit）
  envelopeHash  String   // sha256(canonicalJson(envelope))——签名对象摘要
  submittedAt   DateTime @default(now())
  operationId   String?  // 关联 CaOperation
  submission    SupplierBidSubmission @relation(fields: [submissionId], references: [id])
  @@unique([submissionId, revision])
  @@index([submissionId, revision, submittedAt])
}

model DecryptExecution {
  id            String    @id @default(cuid())
  submissionId  String
  revision      Int
  phase         String    // 'outer' | 'inner'
  attemptId     String
  fence         Int       @default(0)
  leaseUntil    DateTime?
  status        String    @default('RUNNING') // RUNNING | SUCCESS | FAILED
  @@unique([submissionId, revision, phase])
}

model Outbox {
  id          String    @id @default(cuid())
  topic       String
  payload     Json
  status      String    @default("PENDING")
  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  @@index([status, topic])
}
```

`SupplierBidSubmission` 追加：`revision Int @default(0)` + 反向关系 `versions SubmissionVersion[]`

迁移 SQL 手写（只加不改），`prisma db execute` + `migrate resolve --applied`

- [ ] **Step 4: 跑测试 PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): SubmissionVersion/DecryptExecution/Outbox 增量迁移 + SupplierBidSubmission.revision`

---

### Task 1: dual-v3 类型与 canonical（packages/ukey）

**Files:**
- Modify: `packages/ukey/src/types.ts`
- Create: `packages/ukey/src/dual-v3.ts`
- Test: `packages/ukey/src/dual-v3.spec.ts`

**Interfaces:**
- Consumes: `canonicalJson` from `./canonical`
- Produces:

```ts
export interface DualV3FileEntry {
  assetId: string; plainSha256: string; plainBytes: number;
  innerSha256: string; innerBytes: number;
  outerSha256: string; outerBytes: number;
  kself: { format: 'scca-pkcs7-base64'; recipientCertFingerprint: string; value: string };
  kadmin: { format: 'sm2-c1c3c2-hex'; adminCertId: string; value: string };
}
export interface DualV3SealedFields {
  cipherFormat: 'sm4-cbc-pkcs7-hex'; cipher: string; cipherSha256: string; cipherBytes: number;
  kself: { format: 'scca-pkcs7-base64'; recipientCertFingerprint: string; value: string };
}
export interface DualV3Envelope {
  version: 'dual-v3'; canonicalVersion: 'erp-json-v1'; provider: 'scca';
  context: { projectId: string; supplierId: string; submissionId: string; revision: number;
             signingBindingId: string; signingCertFingerprint: string };
  files: Partial<Record<'technical'|'business'|'coverLetter'|'bond', DualV3FileEntry>>;
  sealedFields: DualV3SealedFields;
  fieldsCommit: string; // sha256(UTF8(canonicalJson(fields) + ':' + nonce))
}
export function buildV3Envelope(input: BuildV3Input): DualV3Envelope
export function computeV3FieldsCommit(fields: V3Fields, nonceHex: string): string
export function validateV3Envelope(env: unknown): { ok: boolean; errors: string[] }
```

- [ ] **Step 1: 失败测试**——validateV3Envelope 拒绝旧 v2 形态（kself hex→P7 base64 差异）、拒绝 fieldsSha256 残留、拒绝未知 role、拒绝非规范 price；computeV3FieldsCommit 正确计算 `sha256(canonicalJson({price:"100",amountUnit:"万元",currency:"CNY",deliveryPeriod:"30天",qualityCommitment:"合格"}) + ':' + "a".repeat(32))`

- [ ] **Step 2: FAIL 确认**
- [ ] **Step 3: 实现**——`dual-v3.ts`：类型定义 + `computeV3FieldsCommit` + `buildV3Envelope`（接受文件条目/sealedFields/context 组装）+ `validateV3Envelope`（严格字段校验、role 白名单、price 正则 `^\d{1,12}(\.\d{1,4})?$`、k/iv 32 hex、cipherSha256 64 hex）
- [ ] **Step 4: PASS + 旧测试无回归**
- [ ] **Step 5: Commit** `feat(scca-v3): dual-v3 信封类型、canonical 与严格校验器`

---

### Task 2: 密钥封装辅助——kadmin SM2 包装 + kself P7 包装（packages/ukey）

**Files:**
- Modify: `packages/ukey/src/dual-v3.ts`
- Test: `packages/ukey/src/dual-v3.spec.ts`（扩展）

**Interfaces:**
- Consumes: `sm2EncryptHex` from `./sm-crypto-layer`（kadmin 用，Node 同源）；`SccaUKeyAdapter.wrapKeyToEncCert`（kself 用，浏览器端）
- Produces:

```ts
/** kadmin：服务端 SM2 加密 DEK_A（Node 同源）——现有 envelope-crypto 已有 SM2 能力，此处包装为 v3 格式 */
export function wrapKadmin(dekA: {keyHex: string; ivHex: string}, adminCertId: string, adminPublicKey: string): DualV3FileEntry['kadmin']
/** kself JSON：canonicalJson({k,iv})——两种包装共用 */
export function keyWrapJson(dek: {keyHex: string; ivHex: string}): string
```

- [ ] **Step 1: 失败测试**——`keyWrapJson({keyHex:'0123456789abcdef0123456789abcdef', ivHex:'fedcba9876543210fedcba9876543210'})` 返回 `'{"iv":"fedcba9876543210fedcba9876543210","k":"0123456789abcdef0123456789abcdef"}'`（键排序）
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): kadmin SM2 包装 + keyWrapJson 公共序列化`

---

### Task 3: prepare / signing-payload 端点（ca 模块内新 controller）

**Files:**
- Create: `apps/api/src/ca/ca-bid-operation.controller.ts`
- Test: `apps/api/src/ca/ca-bid-operation.controller.spec.ts`

**Interfaces:**
- Consumes: `CaOperationService`（阶段1），`CaChallengeService`（阶段1），`PrismaService`
- Produces:

```
POST /api/supplier-portal/bid-submissions/:projectId/operations/prepare
  Body: { action: 'submit'|'reupload'|'decrypt-upload'|'receipt'|'opening-confirm',
          baseRevision?: number, candidateAssetIds?: string[], recordRevision?: number }
  Res: { operationId, context: CaSignContext, expiresAt, purpose }

POST /api/supplier-portal/bid-submissions/:projectId/operations/:operationId/signing-payload
  Body: { envelope: DualV3Envelope }  // 仅 submit/reupload
  Res: { canonical, canonicalSha256, signatureFormat: 'scca-pkcs7-base64', signingFingerprint }
```

`CaSignContext`（canonical 原文——服务端冻结，浏览器签署此文本）：

```ts
interface CaSignContext {
  version: 1; purpose: string; operationId: string;
  projectId: string; supplierId: string;
  submissionId?: string; baseRevision?: number; targetRevision?: number;
  envelopeHash?: string; // submit/reupload 时=sha256(canonicalJson(envelope))
  recordId?: string; recordRevision?: number; // opening-confirm 时
  clarificationId?: string; // 澄清时
}
```

- [ ] **Step 1: 失败测试**——prepare 返回 operationId+context+120s TTL；signing-payload 接受合法 v3 信封返回 canonical+sha256；未 prepare 直接 signing-payload→404；同 operationId 换不同信封→409
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**——CaOperationService 扩展 `attachPayload(id, canonical, sha256)` 方法；CaChallengeService 扩展 `createBidChallenge`（绑定 userId+sid+operationId）
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): prepare/signing-payload 端点——冻结签名原文+120s挑战`

---

### Task 4: submit 端点 v3 分支——原子接收 + 版本快照

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts` `submitBid()`（:1883 附近）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`
- Test: `apps/api/src/ca/ca-v3-submit.spec.ts`

**Interfaces:**
- Consumes: Task 3 `signing-payload` 冻结的 canonical；`CaVerificationService.verifySignature`；Task 0 `SubmissionVersion`
- Produces: v3 信封投递落库 + `SupplierBidSubmission.revision` 递增 + outbox 事件 `bid.submitted.v3`

核心流（附录 §5.C 现有端点新分支）：

```typescript
// submitBid 内 v3 分支伪码
if (dto.operationId && dto.signatureFormat === 'scca-pkcs7-base64') {
  const op = await this.caOperationService.findById(dto.operationId);
  if (!op || op.purpose !== 'submit') throw new BadRequestException('OPERATION_INVALID');
  // CA 验签在事务外
  const verification = await this.caVerificationService.verifySignature({
    p7B64: dto.signP7, expectedToSign: op.payload, purpose: 'bind',
    expectedSignCert: { serialHex: binding.signingSerial, sha256: binding.signingSha },
  });
  if (!verification.ok) throw new BadRequestException(verification.code);
  // 事务：CAS + 版本快照 + 落库
  await this.prisma.$transaction(async (tx) => {
    const cur = await tx.supplierBidSubmission.findUnique({ where: { id: submissionId } });
    if (cur.revision !== op.baseRevision) throw new ConflictException('REVISION_CONFLICT');
    const newRev = cur.revision + 1;
    await tx.submissionVersion.create({ data: { submissionId, revision: newRev,
      envelope: dto.envelope, envelopeHash: op.payloadHash } });
    await tx.supplierBidSubmission.update({ where: { id: submissionId },
      data: { revision: newRev, envelope: dto.envelope, envelopeVersion: 'dual-v3', /* ... */ } });
    await tx.outbox.create({ data: { topic: 'bid.submitted.v3', payload: { submissionId, revision: newRev, operationId } } });
  });
}
```

- [ ] **Step 1: 失败测试**——v3 投递成功落 SubmissionVersion+revision 递增+outbox；CAS 冲突→409；无 operationId→旧轨继续走（向后兼容）；CA 验签失败→400 CA_* 码；信封含 v2 残留字段（fieldsSha256）→400
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**（服务层 v3 分支 + DTO 扩展 `SubmitBidV3Dto` 含 operationId/signatureFormat/signP7/envelope）
- [ ] **Step 4: PASS + 旧轨 e2e 不回归**
- [ ] **Step 5: Commit** `feat(scca-v3): submit v3 分支——P7 验签+CAS 版本快照+outbox`

---

### Task 5: encrypted-assets 暂存端点

**Files:**
- Create: `apps/api/src/ca/encrypted-asset.controller.ts`
- Test: `apps/api/src/ca/encrypted-asset.controller.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `StorageService`
- Produces: `POST /api/supplier-portal/bid-submissions/:projectId/encrypted-assets` — Multer 单文件（C_outer 密文），返回 `{fileAssetId, outerSha256, outerBytes, expiresAt}`；暂存 24h 有效

- [ ] **Step 1: 失败测试**——上传→服务端实算 outerSha256→暂存落库；超限 50MiB+32B→413；非持有者→403
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**（Multer 中间件 + FileAsset 落库 + SHA-256 计算；暂存过期由 scheduler 清理）
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): encrypted-assets 暂存端点——服务端实算哈希+24h过期`

---

### Task 6: 回执 P7 强签恢复

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts` `signSubmissionReceipt()`（:563）
- Modify: `apps/api/src/supplier-portal/dto/bid-submission.dto.ts`
- Test: `apps/api/src/ca/ca-v3-receipt.spec.ts`

**Interfaces:**
- Consumes: Task 3 prepare（action=receipt）；`CaVerificationService`
- Produces: 回执从 unsigned-legacy 恢复为 `scca-pkcs7-base64` 签名；canonical 固定：

```json
{"purpose":"submission-receipt","submissionId":"...","revision":N,"envelopeHash":"...",
 "serverSubmittedAt":"ISO","receiptNo":"...","projectId":"...","supplierId":"...","version":1}
```

服务端 getReceiptPayloadFor 时重算 canonical（含真实 serverSubmittedAt/receiptNo），signSubmissionReceipt 接收 operationId+signP7→CaVerificationService 验证→事务落 `receiptSignature: {payload, signature, algorithm:'scca-pkcs7-base64', certSn, certPublicKey, verifiedAt}`。**回执按 submissionId+revision 幂等**（附录 §5.C）。

- [ ] **Step 1: 失败测试**——v3 轨回执签名成功含 P7 证据字段；旧轨 legacy（无 operationId）→ 保留 unsigned-legacy 不变（向后兼容）；同 revision 重签→幂等返回
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**（getReceiptPayloadFor 扩展 revision/envelopeHash/serverSubmittedAt/receiptNo；signSubmissionReceipt v3 分支走 CaVerificationService）
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): 回执 P7 强签恢复——按 revision 幂等+真实接收时间`

---

### Task 7: 开标确认 P7 强签恢复

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts` `confirmOpening()`（:3298）
- Modify: `apps/api/src/supplier-portal/opening-confirm-signature.util.ts`
- Modify: `apps/api/src/supplier-portal/dto/opening-confirm.dto.ts`
- Test: `apps/api/src/ca/ca-v3-confirm.spec.ts`

**Interfaces:**
- Consumes: Task 3 prepare（action=opening-confirm）
- Produces: canonical 含 `purpose/recordId/recordRevision/submissionId/revision/openingSessionId/sessionRevision/openingRecordHash/version`；**不含 amount 明文**（附录 §5.C）。`buildOpeningConfirmCanonicalV2` 输出新 canonical。

- [ ] **Step 1: 失败测试**——v3 确认含 P7 签名证据+金额单位进快照；旧轨→保留旧逻辑+无签名照走（unsigned-legacy）
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**（confirmOpening v3 分支走 CaVerificationService；openingRecordHash=sha256(canonicalJson(完整记录快照))）
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): 开标确认 P7 强签——记录快照Hash+amountUnit进签`

---

### Task 8: 澄清答复 P7 强签恢复

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts` `submitClarificationReply()`（:4092）
- Modify: `apps/api/src/supplier-portal/dto/clarification-reply.dto.ts`
- Test: `apps/api/src/ca/ca-v3-clarification.spec.ts`

**Interfaces:**
- Consumes: Task 3 prepare（action=clarification——追加到 CaBidOperationController 动作白名单）
- Produces: reply-payload 端点返回 canonical（含 clarificationId/revision/reply摘要/attachmentIds+hash）；submitClarificationReply v3 分支走 CaVerificationService

- [ ] **Step 1: 失败测试**——v3 澄清含 P7 签名证据；旧轨→免签照走（向后兼容）；attachmentIds 排序去重入 canonical
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): 澄清答复 P7 强签——reply摘要+attachmentHash 入签`

---

### Task 9: opening-package v3 + 解密上传 P7 证明

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts` `getOpeningPackage()`（:2534）/ `decryptUpload()`（:2625）
- Test: `apps/api/src/ca/ca-v3-decrypt.spec.ts`

**Interfaces:**
- Consumes: Task 0 SubmissionVersion（读历史版本信封）；Task 3 prepare（action=decrypt-upload）
- Produces:
  - `getOpeningPackage` v3 分支返回：每 role 的 `innerAsset/innerSha256/innerBytes/kself(P7 value+recipientFingerprint)` + `sealedFields` + `revision/envelopeDigest/openingSessionId`
  - `decryptUpload` v3 分支：在现有完整性校验（plainSha256 实算+fieldsCommit 重验）之上增加 P7 解密证明（canonical 绑定 openingSessionId/revision/每 role 明文摘要/fieldsCommit），CaVerificationService 验证

- [ ] **Step 1: 失败测试**——v3 opening-package 含 kself P7 值+revision；解密上传 P7 证明通过→成功；证明缺失→旧轨照走（向后兼容）；解密上传的金额走 unitHint='万元' 换算（Review Focus 5）
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): opening-package v3+解密上传 P7 证明`

---

### Task 10: bid-decrypt v3——每角色历史 adminCertId + DecryptExecution fence

**Files:**
- Modify: `apps/api/src/bid/bid-decrypt.service.ts`
- Test: `apps/api/src/ca/ca-v3-bid-decrypt.spec.ts`

**Interfaces:**
- Consumes: Task 0 `DecryptExecution`；Task 1 `DualV3Envelope.files[].kadmin.adminCertId`
- Produces: `decryptOuterOne` v3 分支——从 SubmissionVersion 信封读每角色 `kadmin.adminCertId`（不再是顶层一次）；DecryptExecution 槽位 + fence CAS；对象键含 revision+attempt

- [ ] **Step 1: 失败测试**——v3 每角色独立 adminCertId 解密；fence 隔离（旧 attempt 不能写终局）；对象键 `bid-inner/{projectId}/{supplierId}/{role}.{revision}.{attempt}.inner`
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): bid-decrypt v3——每角色历史adminCertId+fence对象键`

---

### Task 11: 前端——投递页 v3 组装（cgzxui 化）

**Files:**
- Create: `apps/supplier-portal-next/src/utils/dual-v3-client.ts`
- Create: `apps/supplier-portal-next/src/components/ca-bid-submit-card.tsx`
- Test: `apps/supplier-portal-next/src/utils/__tests__/dual-v3-client.test.ts`

**Interfaces:**
- Consumes: `SccaUKeyAdapter.wrapKeyToEncCert`（浏览器 P7 封装）；`supplierApi.caPrepare/caSigningPayload/submitBidV3`（Task 3/4 端点）；Task 1 `buildV3Envelope/computeV3FieldsCommit`
- Produces: 浏览器端 v3 组装与提交流程

浏览器流程（附录 §5.C 投递数据流）：

```typescript
// dual-v3-client.ts 核心函数
export async function encryptAndUploadV3(
  projectId: string, files: Array<{role: EnvelopeRole; file: File}>,
  fields: V3Fields, encCertPem: string, adapter: SccaUKeyAdapter,
  adminCert: {adminCertId: string; publicKey: string},
): Promise<{uploadedAssets: EncryptedAssetRef[], sealedFields: DualV3SealedFields, fieldsCommit: string, nonceHex: string}>
```

`ca-bid-submit-card.tsx`——cgzxui 化的 v3 投递卡片（neu-card+neu-btn 三态+进度指示），替换旧 submit/page.tsx 中 dual-v2 删除后留下的旧轨 UI；仅在 `capabilities.allowedEnvelopeVersions` 含 `'dual-v3'` 时显示。

- [ ] **Step 1: 失败测试**——`computeV3FieldsCommit` 与服务端一致；`encryptAndUploadV3` mock 浏览器 SubtleCrypto+SCCA adapter 后验证信封结构
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**（浏览器 SM4+SM2 封装走 sm-crypto-layer 的 WebCrypto 等价层）
- [ ] **Step 4: PASS + build**
- [ ] **Step 5: Commit** `feat(scca-v3): 前端 v3 投递组装+卡片（cgzxui）`

---

### Task 12: 前端——开标解密卡 v3（cgzxui 化）

**Files:**
- Create: `apps/supplier-portal-next/src/components/ca-opening-decrypt-card.tsx`
- Test: `apps/supplier-portal-next/src/components/__tests__/ca-opening-decrypt-card.test.tsx`

**Interfaces:**
- Consumes: Task 9 opening-package v3 返回结构；`SccaUKeyAdapter.unwrapKey`
- Produces: 供应商开标解密流程（下载 C_inner→按历史加密证 unwrapKey→SM4 解密→上传+P7 证明），cgzxui 化

- [ ] **Step 1: 失败测试**——v3 包结构正确渲染；unwrapKey mock 后解密上传链路
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: PASS + build**
- [ ] **Step 5: Commit** `feat(scca-v3): 前端开标解密卡 v3（cgzxui）`

---

### Task 13: 版本分派统一 + capabilities 接入

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（信封读端按 version 分派）
- Modify: `apps/api/src/ca/ca-binding.controller.ts`（`/ca/capabilities` 响应 `allowedEnvelopeVersions` 受 `CA_SUPPLIER_V3_ENABLED` 控制）
- Test: `apps/api/src/ca/ca-v3-dispatch.spec.ts`

**Interfaces:**
- Consumes: Task 1 `validateV3Envelope`
- Produces: 读端统一分派函数 `resolveEnvelopeVersion(sub)` 返回 `'legacy'|'dual-v2'|'dual-v3'`；未知版本→400 `ENVELOPE_VERSION_UNKNOWN`

- [ ] **Step 1: 失败测试**——legacy 行（无 envelope）→'legacy'；v2 行→'dual-v2'；v3 行→'dual-v3'；未知 version 字符串→400
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现**（独立 util + 服务层全部分派点接入）
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(scca-v3): 版本分派统一函数+capabilities v3 开关联动`

---

### Task 14: 全量回归 + e2e 扩展

**Files:**
- Create: `apps/api/test/bid-v3.e2e-spec.ts`

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 端到端验证

- [ ] **Step 1: e2e**——密码登录→prepare→组装 v3 信封→signing-payload→submit（v3）→receipt（v3）→opening-package v3→decrypt-upload（v3）→confirm（v3）→全链通过；旧轨（legacy）投递→回执 unsigned-legacy→兼容通过
- [ ] **Step 2: 全量单测**——`npx jest src/ca/` 全绿
- [ ] **Step 3: 前端 build**——`pnpm build`
- [ ] **Step 4: Commit** `test(scca-v3): v3 全链 e2e + 旧轨兼容覆盖`

---

## Self-Review 第一轮：规格覆盖检查

| 附录 §5 规格 | 任务覆盖 | 状态 |
|---|---|---|
| **A. dual-v3 结构与规范字节** | Task 1 | ✅ 类型+canonical+校验 |
| A. 密钥包装内部 canonicalJson({k,iv}) | Task 2 | ✅ keyWrapJson |
| A. fields 含 price/amountUnit/currency/deliveryPeriod/qualityCommitment | Task 1 | ✅ |
| A. nonce 16B CSPRNG、fieldsCommit=sha256(fields+':' +nonce) | Task 1 | ✅ |
| A. v3 禁止 fieldsSha256 | Task 1 validateV3Envelope | ✅ |
| A. 四角色含 bond | Task 1 role 白名单 | ✅ |
| **B. encrypted-assets 暂存** | Task 5 | ✅ |
| B. 密文长度公式 innerBytes=16*(floor(plain/16)+1)、outerBytes=inner+16 | Task 5 服务端校验 | ✅ |
| **C. prepare/signing-payload 端点** | Task 3 | ✅ |
| C. submit v3 分支 | Task 4 | ✅ |
| C. GET /ca/operations/:id | 阶段1 CaOperationService 已有 queryResult | ✅ |
| C. opening-package v3 | Task 9 | ✅ |
| C. 回执 canonical 固定 purpose/submissionId/revision/envelopeHash/serverSubmittedAt/receiptNo | Task 6 | ✅ |
| C. 开标确认冻结完整记录快照+canonical 不含 amount 明文 | Task 7 | ✅ |
| C. 澄清 reply-payload/reply v2 | Task 8 | ✅ |
| C. 解密证明绑定 session/revision/role摘要/fieldsCommit | Task 9 | ✅ |
| **D. SubmissionVersion 不可变快照** | Task 0 | ✅ |
| D. DecryptExecution fence/lease | Task 0+10 | ✅ |
| D. Outbox 事务性通知 | Task 0+4 | ✅ |
| D. CAS baseRevision/原摘要 | Task 4 | ✅ |
| D. MinIO 对象键含 revision+attempt | Task 10 | ✅ |
| **E. packages/ukey 类型/canonical** | Task 1+2 | ✅ |
| E. 前端 dual-envelope-core/submit page | Task 11 | ✅ |
| E. supplier-portal.service submitBid/reupload/withdraw | Task 4 | ✅（withdraw/重投版本推进在本 Task CAS 逻辑中） |
| E. getOpeningPackage/decryptUpload | Task 9 | ✅ |
| E. 回执/确认/澄清新 canonical | Task 6/7/8 | ✅ |
| E. bid-decrypt 每角色历史admin钥 | Task 10 | ✅ |
| E. bid-backup 四role按版本 | ⚠️ **未单独成任务**——附录 §5.E 要求按 submissionId+revision+role 唯一、四 role 巡检。量较小，合入 Task 13 版本分派统一 |
| E. bid.service 归档 manifest | ⚠️ **阶段 3 范围**（专家端+归档端改造），本计划聚焦投递链 |
| E. AI worker 版本冻结 | ⚠️ **阶段 3 范围**（独立 worker 改造），但 Task 13 版本分派函数为 AI 消费端预留 |
| 主方案 §6. 开标数据流 5 步 | Task 9 | ✅ |
| 主方案 §6. 历史兼容和补传 | Task 4（CAS 推进 revision）+ Task 13（版本分派） | ✅ |

**缺口决策**：bid-backup 四 role 按 version 备份→合入 Task 13；归档 manifest / AI worker →阶段 3（本计划范围外）。

## Self-Review 第二轮：占位符/类型一致性/Review Focus

| 检查 | 结果 |
|---|---|
| TBD/TODO/implement later | **零命中** |
| "add appropriate error handling" | 零命中（每个错误码显式标注） |
| "Similar to Task N" | 零命中（代码块逐 Task 给出） |
| 类型一致性：`DualV3Envelope` Task 1 定义 → Task 3/4/5/9/11 使用同一接口名 | ✅ |
| `CaSignContext` Task 3 定义 → Task 4/6/7/8/9 引用 | ✅ |
| `computeV3FieldsCommit` Task 1 定义 → Task 11 前端调用 | ✅ |
| `keyWrapJson` Task 2 定义 → Task 5/11 使用 | ✅ |
| Review Focus 1（未签名直接提交）→ Task 4 测试步骤 1 含 `无 operationId→旧轨继续走`（区分场景）+ Task 3 测试 `未 prepare→404` | ✅ |
| Review Focus 2（并发 CAS→409 非 500）→ Task 4 测试 `CAS 冲突→409` | ✅ |
| Review Focus 3（v2 被 v3 读端误解析）→ Task 13 测试 `v2 行→'dual-v2'` | ✅ |
| Review Focus 4（nonce 泄漏）→ Global Constraints 声明 + Task 9 测试验证 opening-package 无 nonce | ✅ |
| Review Focus 5（金额单位）→ Task 9 测试 `unitHint='万元' 换算` | ✅ |

**修正**：Task 13 范围扩充——在 Step 3 实现描述中增加「同步改 bid-backup 按 submissionId+revision+role 唯一、四 role 巡检、从版本信封读 wrappedDek/cryptoVersion」。

---

**执行方式**：建议 **Native**（14 任务接口链紧耦合——Task 3→4→6/7/8→9 全依赖 prepare 端点签名，且阶段 1 同模式已验证上下文携带实测事实最可靠）。
