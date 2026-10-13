# 四川CA 阶段1（绑定/登录/自检试点）Implementation Plan

> **v3（2026-10-13）**：v2 后二轮审查 15 条（P0×4/P1×7/P2×4）全修——代理匿名机制/格式归一链/Lua 脚本/KeyUsage 位表等。历史修订见文末 Self-Review 第 5-6 条。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隔离测试供应商账号上跑通真实 SCCA 证书的绑定、CA 登录与自检（主方案阶段 1），全部在测试网关+测试盾环境，不含 dual-v3 投递（阶段 2 另立计划）。

**Architecture:** NestJS 新增 `apps/api/src/ca/` 模块（网关客户端=阶段0已证字节等价的 probe 移植；验证服务=网关密码学验证 + **本地 attached-P7 原文比对（World B 下唯一原文绑定）** + 三方指纹）；Prisma 增量迁移（新表+旧表可空新列+部分唯一索引，legacy 先行收窄）；`packages/ukey` 新增 scca-transport（阶段0 transport v3.2 语义工程化）+ SccaUKeyAdapter（双证书模型）；供应商门户登录页/U盾管理页/自检对话框按能力投影改造。

**Tech Stack:** NestJS 11 + Prisma + Redis(ioredis) / Next.js 16 + React 19 / sm-crypto、原 ASN.1 手写解析（无新依赖）/ vitest 不引入——沿用 jest。

**Spec:** 
- 设计：`docs/superpowers/specs/2026-10-10-scca-integration-design.md`（主方案）+ `2026-10-12-scca-ui-api-contracts.md`（附录=契约权威，本计划引用其 §N.M）
- 阶段0 证据：`docs/superpowers/specs/phase0-evidence/`（结论回填表、能力矩阵、S/G/E 结论、原样 P7/证书 fixtures）
- 厂商资料：`~/桌面/ERP/四川CA/`（sccmPlugin.js、JAR、真证/P7 样本在 `p0/`、`p02/`）

## Global Constraints

- **World B 铁律**：网关不比对 toSign（phase0 G3 判决）——**本地 attached-P7 原文比对无条件强制**，无任何环境开关；detached/无内嵌原文的 P7 一律 `CA_CONTENT_MISMATCH` 拒绝。
- **算法白名单**（phase0 C-9/C-11 实测）：签名=digest `1.2.156.10197.1.401` × sig `1.2.156.10197.1.301`；证书 SPKI=`id-ecPublicKey`+SM2 曲线 `1.2.156.10197.1.301`、证书签名 `SM2-with-SM3`；白名单外拒绝（`CA_ALG_UNSUPPORTED`）。
- **网关契约**（T3 字节等价实证）：表单与 HMAC 同源（键升序、跳空值、仅值 `&` 连接、UTF-8、HMAC-SHA1 小写 hex）；`content-type: application/x-www-form-urlencoded; charset=UTF-8`；错误码 `0`成功/`1003`(401)/`1105`(403)/`9998`(200)；**禁止自动重试**。
- **计量纪律**：单测/e2e 一律不打真网关——用 fixtures 与本地 mock gateway；真网关只允许 Windows 实盾验收，逐发登记。
- **凭据/PIN 卫生**：appSecret 只入 `.env`（不入库不入档）；PIN 永不出浏览器；新轮询端点加入 `OPERATION_LOG_EXCLUDE`。
- **RolesGuard 默认拒绝**：每个新路由显式 `@Public()`/`@Roles()`/`@AnyRole()`。
- **迁移纪律**：改 `schema.prisma` 后先 `npx prisma validate`；迁移走 `--create-only` + `prisma db execute` + `migrate resolve`（遵循 main-db-migration-drift 口径）；**禁 `git add -A`**，`feat(scca):` 前缀小步提交，不主动 push；开工前后 `git status` 检查并行会话。
- **共享包**：改 `packages/ukey`/`packages/client` 后必须 `pnpm --filter` 重建 dist。
- **无 mock fallback**：CA 不可用=明确 503 `CA_VERIFY_UNAVAILABLE`，不降级、不本地放行。
- **证书状态覆盖**（能力矩阵阻断项）：链校验（中间证入 `TRUSTED_CA_DIR`）+有效期+KeyUsage 实现；**吊销检查=未覆盖**，以 `statusCoverage` 字段如实记录，试点文档声明。
- **证书格式归一链**（v3）：唯一归一点 = `CaVerificationService` 私有工具 `normalizeToDer(input: string): Buffer`（PEM 甲正则匹配则 `pemToDer()` 剥甲；否则按裸 base64 直解 `Buffer.from(input, 'base64')`）。各任务调用链：
  | 来源 | 原始格式 | 归一点 | 去向 |
  |------|---------|--------|------|
  | Task 9 适配器导出 | PEM | Task 5 `normalizeToDer` | Task 2 `parseCertificate(der)` |
  | Task 7 挑战 DTO `signCertPem` | PEM | Task 6 服务端 `normalizeToDer` | 计算 sha256Fingerprint |
  | Task 8 绑定 DTO `signCertPem/encCertPem` | PEM | Task 8 服务端 `normalizeToDer` | Task 1 CaCertificate.derBase64 = `normalizeToDer(pem).toString('base64')` |
  | Task 5 网关回传 `certBase64` | base64 DER | `Buffer.from(b64)` | Task 2 `parseCertificate(der)` |
  | Task 5 P7 输入 `p7B64` | base64 DER | `Buffer.from(b64)` | Task 3 `parseSignedP7(der)` |

  **禁止各任务自造转换**——全部经 `normalizeToDer` 或 `Buffer.from(b64)`，两出口不混用。

## Review Focus

实现时最可能踩、且各任务测试必须钉住的五个失效模式：

1. **detached/无内嵌原文的 P7 冒充登录**（World B 下网关会放行）→ Task 3 解析器把 detached 判为「无 embeddedContent」、Task 5 比对必拒——测试：用 `V1d.p7.b64`（真 detached 样本）+ 正确 toSign 断言 `CA_CONTENT_MISMATCH`。
2. **旧 P7 重放到新挑战**（进程级登录态共享+网关不看原文的组合攻击面，phase0 S10）→ Task 6 挑战一次性消费 + Task 5 原文比对——测试：同一 P7 配第二个 challengeId 必拒。
3. **同主体并发双 ACTIVE 绑定 / 换绑竞态**→ Task 1 部分唯一索引 + Task 9 CAS 冲突 409——测试：并发两次 bind 只成一个。
4. **三方指纹不一致**（P7 签名者 ≠ 绑定证书 ≠ 网关回传）→ Task 5 逐方断言——测试：用 B 盾证书的 serialHex 期望值配 A 盾 P7 必拒。
5. **网关超时/不可达被当业务失败或触发重试** → Task 4 超时映射 `GatewayUnavailableError` 且零重试——测试：mock 网关挂起 16s 断言抛错且仅发起一次请求。

---

### Task 0: 阶段0 探路收尾 + 开工环境检查

**Files:** 无代码改动；产物归档 `docs/superpowers/specs/phase0-evidence/probe/`。

**Interfaces:** Produces: `TRUSTED_CA_DIR` 候选中间证 `scegb_sm2.crt`（Task 5 消费）；OCSP 探活结论（写入驻点，供吊销阻断项的备选路径）。

- [ ] **Step 1: git status 确认并行会话无未提交改动**（CLAUDE.md 并行协作约定）；有则等待对方提交。
- [ ] **Step 2: 下载中间证**

```bash
mkdir -p apps/api/.data/trusted-ca docs/superpowers/specs/phase0-evidence/probe
curl -s --noproxy '*' -o apps/api/.data/trusted-ca/scegb_sm2.crt http://topca.scca.com.cn/cacert/scegb_sm2.crt
openssl x509 -in apps/api/.data/trusted-ca/scegb_sm2.crt -noout -subject -serial   # 校验主题含 SCEGB CA、serial 74ED943F…
cp apps/api/.data/trusted-ca/scegb_sm2.crt docs/superpowers/specs/phase0-evidence/probe/
```

> 该目录即 env **`TRUSTED_CA_DIR`** 的取值（复用现有 x509/trust-store 变量名——勿造 SCCA_ 前缀新名）。

- [ ] **Step 3: OCSP 探活（备选状态源一手数据）**

```bash
openssl ocsp -issuer apps/api/.data/trusted-ca/scegb_sm2.crt -cert /tmp/p0/real-sign.der \
  -url http://topca.scca.com.cn:8085/ocsp -resp_text -noverify 2>&1 | head -20
# https 若握手失败试 http；记录：可达性/响应状态(good/revoked/unknown)/HTTP 状态——结论写 evidence/probe/ocsp-probe.md
```

- [ ] **Step 4: commit（仅 evidence 归档；.data/ 不入库）**

```bash
git add docs/superpowers/specs/phase0-evidence/probe/
git commit -m "chore(scca): 阶段0探路归档——中间证下载与OCSP探活"
```

---

### Task 1: Prisma 增量迁移（新表 + 旧表可空新列 + 部分唯一索引 + legacy 盘点）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261013120000_scca_ca_certificates/migration.sql`
- Create: `apps/api/scripts/scca-legacy-inventory.ts`（盘点脚本）
- Test: `apps/api/src/ca/ca-migration.spec.ts`（迁移后约束断言）

**Interfaces:** Produces（后续所有任务依赖）：模型 `CaCertificate`、`CaSigningCertificateClaim`、`CaOperation`、`CaVerificationRecord`、`CaExpiryReminder`；`SupplierCert`/`ExpertCert` 新列 `credentialScheme/signingCaCertificateId/encryptionCaCertificateId(仅 Supplier)/bindingRevision/createdBy/revocationReason`；`Supplier.caCredentialRevision`、`User.caCredentialRevision`；DB 约束：每主体至多一条 ACTIVE、签名证书全局单主体占用。

- [ ] **Step 1: schema 增量**（只加不改——旧列不动）

```prisma
model CaCertificate {
  id               String   @id @default(cuid())
  provider         String   @default("scca")
  derBase64        String   // DER 正文 base64（入库存储前剥 PEM 甲）
  sha256Fingerprint String  @unique // 小写 64hex
  serialHex        String   // 无符号去前导零小写
  issuerNameDerHash String
  issuerDisplay    String
  subjectDisplay   String
  spkiAlgorithmOid String
  curveOid         String?
  keyUsage         String[] // DigitalSignature/NonRepudiation/KeyEncipherment/…
  extendedKeyUsage String[]
  notBefore        DateTime
  notAfter         DateTime
  createdAt        DateTime @default(now())
  @@unique([issuerNameDerHash, serialHex])
  @@index([notAfter])
}

model CaSigningCertificateClaim {
  id                 String   @id @default(cuid())
  certificateId      String   @unique
  certificate        CaCertificate @relation(fields: [certificateId], references: [id])
  supplierId         String?
  expertUserId       String?
  supplierBindingId  String?
  expertBindingId    String?
  status             String   @default("ACTIVE") // ACTIVE | RELEASED
  claimedAt          DateTime @default(now())
  releaseAt          DateTime?
  revision           Int      @default(0)
  @@index([supplierId]) @@index([expertUserId])
}

model CaOperation {
  id           String   @id @default(cuid())
  subjectType  String   // 'supplier' | 'expert'
  subjectId    String
  purpose      String   // ca-login | bind | replace | revoke | self-test
  payloadHash  String
  businessRef  String?
  status       String   @default("PREPARED") // PREPARED→VERIFYING→COMMITTED | FAILED/EXPIRED/CANCELLED
  result       Json?
  challengeId  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([subjectType, subjectId, status])
}

model CaVerificationRecord {
  id              String   @id @default(cuid())
  requestId       String   @unique
  provider        String   @default("scca")
  protocolVersion String
  purpose         String
  actorUserId     String?
  subjectId       String?
  bindingId       String?
  certFingerprint String
  operationDigest String?
  toSignSha256    String
  p7Sha256        String
  result          String   // ok | CA_* 错误码
  statusCoverage  String[] // 永不含 'revocation'——阻断项如实记录
  checkedAt       DateTime
  evidenceAssetId String?
  createdAt       DateTime @default(now())
}

model CaExpiryReminder {
  id            String    @id @default(cuid())
  bindingId     String
  certificateId String
  usage         String    // signing | encryption
  stage         Int       @default(0)
  notifiedAt    DateTime?
  @@unique([bindingId, certificateId, usage, stage])
}
```

`SupplierCert` 追加：`credentialScheme String @default("legacy-raw-sm2")`、`signingCaCertificateId String?`、`encryptionCaCertificateId String?`、`bindingRevision Int @default(0)`、`createdBy String?`、`revocationReason String?`，关系 `signingCaCertificate CaCertificate? @relation("SupplierSignCert")`、`encryptionCaCertificate CaCertificate? @relation("SupplierEncCert")`；`ExpertCert` 同签名侧。`Supplier` 加 `caCredentialRevision Int @default(0)`，`User` 加 `caCredentialRevision Int @default(0)`。`CaCertificate` 上加反向关系 `supplierSignBindings SupplierCert[] @relation("SupplierSignCert")` 等。

- [ ] **Step 2: 校验 + 生成迁移**

```bash
cd apps/api && npx prisma validate && npx prisma format
npx prisma migrate dev --create-only --name scca_ca_certificates
# 编辑生成的 migration.sql：确认新列均可空/有默认值；追加部分唯一索引与 CHECK（Prisma 不生成，手写）：
```

migration.sql 末尾追加：

```sql
CREATE UNIQUE INDEX "supplier_cert_one_active" ON "SupplierCert"("supplierId") WHERE "bindingStatus" = 'ACTIVE';
CREATE UNIQUE INDEX "expert_cert_one_active" ON "ExpertCert"("userId") WHERE "bindingStatus" = 'ACTIVE';
ALTER TABLE "CaSigningCertificateClaim" ADD CONSTRAINT "claim_exactly_one_owner" CHECK (
  ("supplierId" IS NOT NULL AND "expertUserId" IS NULL) OR ("supplierId" IS NULL AND "expertUserId" IS NOT NULL)
);
```

- [ ] **Step 3: 应用 + resolve + 生成 client**

```bash
npx prisma migrate resolve --applied 20261013120000_scca_ca_certificates 2>/dev/null || \
  npx prisma db execute --file prisma/migrations/20261013120000_scca_ca_certificates/migration.sql
npx prisma migrate resolve --applied 20261013120000_scca_ca_certificates || true
npx prisma generate
```

- [ ] **Step 4: 盘点脚本 `scripts/scca-legacy-inventory.ts`**（附录 §6.3 第1步）：输出清单——重复 ACTIVE、跨主体同 certSn、certSource=x509 行数、待签回执/在途提交计数、约束违规预检；对 dev 库运行，产物存 `phase0-evidence/probe/legacy-inventory.json`；含「三套编号撞号预检」——现网 certSn 与厂商 certSN（DN 的 `SN=`/`OU=NO.1:` 18 位值）与 X.509 serial 的映射冲突预检（E1 实测三套体系并存）。tsx 运行注意 Nest tsx 脚本坑（不用 DI，直接 new PrismaClient）。
- [ ] **Step 5: 约束测试 `ca-migration.spec.ts`**：双 ACTIVE 插入第二行被 P2002 拒；Claim 双 owner NULL 被 CHECK 拒；legacy 行 credentialScheme 默认值正确。
- [ ] **Step 6: 跑测试 + commit**

```bash
pnpm --filter api test -- ca-migration
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261013120000_scca_ca_certificates/ apps/api/scripts/scca-legacy-inventory.ts apps/api/src/ca/ca-migration.spec.ts
git commit -m "feat(scca): CaCertificate/Claim 增量迁移与主体唯一约束（阶段1 Task1）"
```

---

### Task 2: x509 解析扩展（KeyUsage/EKU/曲线）

**Files:**
- Modify: `apps/api/src/common/crypto/x509/x509-cert.ts`
- Test: `apps/api/src/common/crypto/x509/x509-cert.spec.ts`
- Create: `apps/api/test/fixtures/scca/S2-sign-cert.b64`、`S2-enc-cert.b64`（从 `~/桌面/ERP/四川CA/p0/` 拷入）

**Interfaces:** Produces: `ParsedX509` 扩展字段 `keyUsage: string[]`、`extendedKeyUsage: string[]`（仅 2.5.29.37）、`unknownExtensionOids: string[]`（私有扩展）、`curveOid: string | null`（SM2 曲线 `1.2.156.10197.1.301`）；`certSha256(der): string` 工具。Consumes: 现有 `parseCertificate`（保持兼容，只增字段）。

- [ ] **Step 1: 失败测试**（真证书 fixture）——断言签名证 `keyUsage` 含 `DigitalSignature`/`NonRepudiation`、`curveOid==='1.2.156.10197.1.301'`；加密证含 `KeyEncipherment`/`DataEncipherment`/`KeyAgreement`、扩展含 `2.16.156.1.6.10.2`（ITRUSKMC——**私有扩展**，落在 `unknownExtensionOids`，不得混入 EKU 数组）。
- [ ] **Step 2: 跑测试确认 FAIL**（`pnpm --filter api test -- x509-cert`，字段 undefined）。
- [ ] **Step 3: 实现**——在现有 BasicConstraints 扩展循环里加：KeyUsage(2.5.29.15) BIT STRING 位解——RFC 5280 位表：
  ```
  bit 0 = DigitalSignature    bit 1 = NonRepudiation (contentCommitment)
  bit 2 = KeyEncipherment     bit 3 = DataEncipherment
  bit 4 = KeyAgreement        bit 5 = KeyCertSign
  bit 6 = CRLSign             bits 7-8 = EncipherOnly/DecipherOnly (仅 KeyAgreement 时有意义)
  ```
  BIT STRING 首字节=unused bits（须 0），后续字节逐位映射；EKU/杂项 OID(2.5.29.37 与裸 OID 扩展) 收集；SPKI 算法参数 OID（曲线）解析（x509-cert.ts:106-112 现有 `parseChildren(spkiAlg)[0]` 取 OID——补 `[1]` 取 params 曲线 OID）。
- [ ] **Step 4: 跑测试 PASS + 旧 x509 测试不回归**（`pnpm --filter api test -- x509`）。
- [ ] **Step 5: commit** `feat(scca): x509 解析补 KeyUsage/EKU/曲线（真证 fixture 锁定）`。

---

### Task 3: P7 解析器入库（attached 原文提取 + 签名者指纹）

**Files:**
- Create: `apps/api/src/common/crypto/p7/p7-parser.ts`
- Create: `apps/api/src/common/crypto/p7/p7-parser.spec.ts`
- Create: `apps/api/test/fixtures/scca/` 拷入 `V1.p7.b64/V1.txt/V1d.p7.b64/V7.p7.b64/V7.txt/v1-unknown-oid.p7.b64/illegal-encap.p7.b64`（phase0 originals）

**Interfaces:** Produces:

```ts
export const SIGNED_DATA_OID = '1.2.840.113549.1.7.2';
export class P7ParseError extends Error { constructor(msg: string, public readonly reason: 'NON_WHITELISTED' | 'MALFORMED' | 'NO_CONTENT') }
export interface P7Signer { sidKind: 'issuerAndSerial' | 'ski'; serialHex?: string; skiHex?: string; digestAlgOid: string; signatureAlgOid: string; hasSignedAttrs: boolean }
export interface P7ParseResult { contentTypeOid: string; eContentTypeOid: string | null; embeddedContent: Buffer | null; signers: P7Signer[]; embeddedCerts: { sha256: string; serialHex: string }[] }
export function parseSignedP7(input: string | Buffer): P7ParseResult  // string=base64 DER → Buffer.from；Buffer=DER 直用——内部归一
```

白名单仅 `SIGNED_DATA_OID`（信封 GM OID 属阶段 2）；detached/非法标签→`NO_CONTENT`/`MALFORMED`；复用 `x509-cert.ts` 的 TLV 原语（抽出 `parseChildren/readOid` 到 `common/crypto/asn1.ts` 共享，x509 改引不复制）。

- [ ] **Step 1: 失败测试**——① V1+正确 expect：`embeddedContent` == V1.txt 的 UTF-8 字节、1 个 signer `issuerAndSerial` serial=`4eb0…`、digest `…401`、sig `…301`、无 signedAttrs、embeddedCerts 含 sha256 `8dcdbaca…`；② V1d（真 detached）→ `embeddedContent===null` 且 reason 路径可区分；③ unknown-oid → `NON_WHITELISTED`；④ illegal-encap → `MALFORMED`；⑤ V7 291 字节原文逐字节等。
- [ ] **Step 2: 确认 FAIL**（模块不存在）。
- [ ] **Step 3: 实现**——phase0 `p7walk.mjs`（/tmp/p0）语义移植为 TS：ContentInfo→[0]→SignedData→encapContentInfo 严格形状（仅 [OID] 或 [OID,[0]→单 OCTET]）；sid 区分 0x30/0xa0/0x80；`[0]` 证书集逐张 sha256+serial（tbs 首个 INTEGER）；2MiB 上限。
- [ ] **Step 4: PASS + commit** `feat(scca): P7 解析器（attached 原文/签名者/证书指纹，真样锁定）`。

---

### Task 4: SccaGatewayClient（协议客户端）

**Files:**
- Create: `apps/api/src/ca/scca-gateway.client.ts` + `scca-gateway.client.spec.ts`
- Create: `apps/api/src/ca/ca-config.ts`（env 读取：`SCCA_GATEWAY_BASE_URL/SCCA_APP_ID/SCCA_APP_SECRET/SCCA_GATEWAY_TIMEOUT_MS(默认15000)` 及功能开关 `CA_LOGIN_ENABLED/CA_BINDING_ENABLED/CA_PILOT_SUBJECT_IDS(试点白名单,逗号分隔)/CA_LEGACY_WRITE_ENABLED(默认仅 dev)`；缺必填时模块仍可启动、调用抛 `CA_NOT_CONFIGURED`——供单测/CI）

**Interfaces:** Produces:

```ts
export type GwErrorKind = 'AUTH' | 'PERMISSION' | 'CERT_CHAIN' | 'BUSINESS' | 'UNAVAILABLE' | 'MALFORMED_RESPONSE';
export interface GwVerifyResult { resultCode: number; resultMsg: string; certSerialHex: string | null; certBase64: string | null }
export class SccaGatewayClient {
  async verifyPkcs7(p: { opType: string; requestId: string; signedDataB64: string; toSign: string }): Promise<GwVerifyResult>
}
```

实现要点（全部为 T3/G0/G3 已证行为）：`URLSearchParams`（排序键、**跳空值**——表单与 HMAC 同源）；HMAC-SHA1(secret, values.join('&')) 小写 hex 头 `signature`；头 `app_id`；`content-type` 带 `; charset=UTF-8`；fetch+AbortController 总超时；**按字节流式限读 256KiB**（`res.body.getReader()` 循环累计 `byteLength`）；映射：HTTP 2xx+`result_code===0`→成功（取 `body.serialNumber/certBase64`）；`1003`→AUTH、`1105`→PERMISSION、`9998`→CERT_CHAIN、其他非零→BUSINESS；网络/超时→UNAVAILABLE（**不重试，单次调用**）。

- [ ] **Step 1: 失败测试（零外呼）**——① 固定向量：mock fetch（注入 `globalThis.fetch`）断言 body/headers 与 T3 已证字节逐字段相等（golden 取自 T3 捕获对 `phase0-evidence/sink-all.log`+`t3-manifest.json`——**全虚构凭据、字节等价已证**；fixtures 拷入清单与 t3-inputs 四文件，断言生成 body/headers 与捕获逐字段相等。G0 的 debug 文件是真凭据输入，**不可**作 golden）；② mock `result_code=0` 正常解析；③ `1003/1105/9998` 错误映射；④ mock 挂起 16s→UNAVAILABLE 且 fetch 仅调用 1 次；⑤ 300KiB 响应→截断标志且不崩溃；⑥ 空串 signedData→请求体不含该字段（跳空）。
- [ ] **Step 2-4: FAIL→实现→PASS**（移植 /tmp/p0/probe.mjs 已验证逻辑）。
- [ ] **Step 5: commit** `feat(scca): 网关客户端（T3 字节等价实现+错误映射+零重试）`。

---

### Task 5: CaVerificationService（组合验证：网关 + 本地比对 + 三方指纹 + 算法闸）

**Files:**
- Create: `apps/api/src/ca/ca-verification.service.ts` + spec
- Consumes: Task 2/3/4 全部接口；`x509/trust-store.ts` 的 **`TrustStore.verifyChain(leaf: ParsedX509, atTime: Date)` 实接口**（env **`TRUSTED_CA_DIR`**——复用现有变量，指向 Task 0 的 `apps/api/.data/trusted-ca/`；`scegb_sm2.crt` 为**中级 CA**（issuer=SCEGB CA），pilot 即以它为信任锚——上级根证未取得，挂厂商索取清单）

**Interfaces:** Produces:

```ts
export interface VerifySignatureInput { p7B64: string; expectedToSign: string; purpose: 'ca-login'|'bind'|'self-test'; expectedSignCert?: { serialHex: string; sha256: string } }
export interface VerificationOutcome {
  ok: boolean; code?: 'CA_CONTENT_MISMATCH'|'CA_SIGNER_COUNT'|'CA_FINGERPRINT_MISMATCH'|'CA_ALG_UNSUPPORTED'|'CA_GATEWAY_REJECTED'|'CA_CERT_CHAIN'|'CA_VERIFY_UNAVAILABLE'|'CA_CERT_EXPIRED';
  signerSerialHex?: string; evidenceId?: string; statusCoverage: ('chain'|'validity'|'usage')[]; // 永不含 'revocation'——阻断项如实记录
}
@Injectable() export class CaVerificationService { async verifySignature(i: VerifySignatureInput): Promise<VerificationOutcome> }
```

流程（顺序固定）：①`parseSignedP7`——`embeddedContent` 与 `utf8(expectedToSign)` **逐字节全等**，null/detached→`CA_CONTENT_MISMATCH`；signer 恰 1 个；算法白名单（Global Constraints 三组 OID）；②指纹三方——`expectedSignCert`（登录：从挑战快照；绑定：待绑定证书）serialHex === P7 signer.serialHex，且 `embeddedCerts[].sha256` 含期望 sha256；③网关 `verifyPkcs7({opType: 目的映射, requestId: createId()  // @paralleldrive/cuid2（项目现有依赖）, signedData, toSign})`——成功且 `certSerialHex === signer.serialHex`（第三方）；`CERT_CHAIN/UNAVAILABLE` 等按 GwErrorKind 透传 code；④网关回传 `certBase64` 剥 PEM→`parseCertificate`→有效期/KeyUsage（登录/绑定用途校验）/链（`TrustStore`，锚=中级证）→`CA_CERT_EXPIRED` 等；`revocation.ts` 现状（NullRevocationChecker）保持不动——吊销=阻断项；⑤产出 `statusCoverage`（无 revocation）。**不含吊销检查，任何环境都不放宽**。

- [ ] **Step 1: 失败测试（全部离线 fixtures + mock client）**——Review Focus 1/2/4/5 的测试落在此：V1+正确 toSign+mock 网关成功→ok；V1d→`CA_CONTENT_MISMATCH`；V1+V7 的 toSign→`CA_CONTENT_MISMATCH`（防重放：旧 P7 新挑战）；B 盾期望+A 盾 P7→`CA_FINGERPRINT_MISMATCH`；mock 网关返回 serial 不一致→`CA_FINGERPRINT_MISMATCH`；mock 挂起→`CA_VERIFY_UNAVAILABLE`；真证过期样本（构造 notAfter 过去的 fixture 经 mock certBase64）→`CA_CERT_EXPIRED`。
- [ ] **Step 2-4: FAIL→实现→PASS**。
- [ ] **Step 5: commit** `feat(scca): 组合验证服务（World B 本地比对强制+三方指纹+算法闸）`。

---

### Task 6: CaChallengeService + CaEvidenceService + CaOperation

**Files:**
- Create: `apps/api/src/ca/ca-challenge.service.ts`、`ca-evidence.service.ts`、`ca-operation.service.ts`、`ca-operation.ts`（模型常量/状态机）+ 对应 spec
- Modify: `apps/api/src/app.module.ts`（注册 CaModule——共享高危文件，改前确认对方会话干净）

**Interfaces:** Produces:

```ts
export type ChallengePurpose = 'ca-login'|'bind'|'replace'|'revoke'|'self-test';
@Injectable() export class CaChallengeService {
  async createLogin(p: { portal: 'supplier'|'expert'; browserCookieHash: string; signCertPem: string }): Promise<{ challengeId: string; toSign: string; expiresAt: Date }>
  // toSign = `LOGONDATA:${canonicalJson({version:1,purpose:'ca-login',portal,challengeId,nonce:hex(32),expiresAt,signFingerprint})}`
  async createBound(p: { userId: string; sid: string; purpose: 'bind'|'replace'|'revoke'|'self-test'; signCertSha256: string; encCertSha256?: string }): Promise<...>
  async claimAndConsume(challengeId: string, purpose: ChallengePurpose, bindingKey: string): Promise<{ toSign: string; payload: any } | null>  // Lua 原子 READY→CLAIMED→CONSUMED；失败不回 READY
}
@Injectable() export class CaEvidenceService { async record(v: VerificationOutcome & { p7Sha256: string; toSignSha256: string; purpose: string; actor?: string }): Promise<string /*evidenceId*/> }
// CaOperation：PREPARED→VERIFYING→COMMITTED | FAILED/EXPIRED/CANCELLED；GET /ca/operations/:id 的持久支撑
// 登录场景：subjectId 初始 null（用户在验证通过前未知）→ COMMITTED 时写入实际 userId
```

Redis key `ca:challenge:v1:{id}`，TTL 120s。`claimAndConsume` 用 EVAL 原子消费：

```lua
-- KEYS[1]=ca:challenge:v1:{id}  ARGV[1]=purpose  ARGV[2]=bindingKey
local s = redis.call('HMGET', KEYS[1], 'state', 'purpose', 'bindingKey', 'toSign', 'payload')
if not s[1] then return nil end                          -- 不存在/过期
if s[1] ~= 'READY' then return 'ALREADY_CLAIMED' end     -- 一次性（CLAIMED/CONSUMED 均拒）
if s[2] ~= ARGV[1] or s[3] ~= ARGV[2] then return 'MISMATCH' end
redis.call('HSET', KEYS[1], 'state', 'CONSUMED')          -- 原子置终态（失败也不回 READY）
return s[4]                                              -- 返回 toSign
```evidence 落 `CaVerificationRecord`（Task 1 表，requestId 唯一；p7/toSign 存 sha256+MinIO 原件按需，阶段1 先 DB 记录+原件仅登录/绑定）。

- [ ] **Step 1: 失败测试**——创建→toSign 以 `LOGONDATA:` 开头且含 challengeId/nonce；并发两个 claim 同 id 只有一个成功（用 ioredis-mock 或真 Redis——沿用 api 现测方式）；错误 purpose 拒；过期 TTL 后 claim null；COMMITTED 重放返回既有结果不二次消费。
- [ ] **Step 2-4: FAIL→实现→PASS**。
- [ ] **Step 5: commit** `feat(scca): 挑战原子消费/证据/操作状态机`。

---

### Task 7: 认证端点（/auth/ca/*）与会话收尾复用

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`（追加路由；**CA login 路由加 `@Timeout(30000)` 或自定义 interceptor**——网关 15s + 本地 P7 解析 + DB 写入可能超 NestJS 默认路由处理时长）、`auth.service.ts`（抽出 `completeSupplierLogin/completeExpertLogin` 共享收尾——从现有登录路径提取，行为不变）、`portal-cookie.ts`（匿名 cookie 辅助）
- Create: `apps/api/src/ca/dto/ca-auth.dto.ts`（class-validator 严格 DTO）
- Test: `apps/api/src/ca/ca-auth.spec.ts` + `apps/api/test/auth-ca.e2e-spec.ts`

**Interfaces:** Produces（附录 §4.2 B 契约）：

```
GET  /api/auth/ca/config          @Public   → { enabled(由 CA_LOGIN_ENABLED 驱动), portalSupport: {supplier:true}, clientNote }
POST /api/auth/ca/challenge      @Public   DTO{provider:'scca',signCertPem} → {challengeId,toSign,encoding:'UTF-8',signatureFormat:'scca-pkcs7-base64',expiresAt}
POST /api/auth/ca/login          @Public   DTO{challengeId,signP7}（≤256KiB 严格 Base64）→ 登录响应同形 {access_token,role,username} + 写 token_supplier/token_expert + 清匿名 cookie
POST /api/auth/ca/result         @Public   DTO{challengeId}（凭匿名 ca_browser_* cookie + sessionMeta.caLoginChallengeId 匹配恢复）
POST /api/auth/ca/reauth         @Roles('supplier','bid_expert') DTO{password,action,targetBindingId?…} → {credentialProofId,operationDigest,expiresAt}
```

登录流程：challenge（匿名 cookie hash 绑定）→ 客户端签 toSign → login：`claimAndConsume`→`verifySignature`（expectedSignCert=挑战快照指纹）→ 通过→锁 User 复核（isActive/isFrozen/Supplier=APPROVED+临时期限，附录 4.1.2）→ 复用共享收尾（SID 轮换+cookie+审计；供应商 remember 语义由前端收尾）。**401 不泄绑定存在性**；资格错在验签通过后才给 `ACCOUNT_PENDING/FROZENEN/TEMPORARY_EXPIRED`。匿名 cookie `ca_browser_{portal}`：256bit、httpOnly、host-only、sameSite=lax、path=`/api/auth/ca/`、TTL 10min；JSON 写请求校验 Origin 精确白名单（`CA_ALLOWED_ORIGINS` env）。新路由入 `OPERATION_LOG_EXCLUDE` 的高频项除外（challenge/login 是低频，正常记录但 body 投影脱敏——复用 sanitize 白名单）。

- [ ] **Step 1: e2e 先行失败（overrideProvider 策略）**——挑战 toSign 含随机 nonce，真盾之外无法对动态文本造真签名，故 e2e 流程测试 **`overrideProvider(CaVerificationService)`**（fake 验证固定返回 ok——auth.e2e-spec.ts:39 的 `Test.createTestingModule` 已核可 override）；**真实验证路径（本地比对/三方指纹/算法闸）不在 e2e**，由 Task 5 单测以固定文本+真 P7 fixtures 覆盖。用例：登录成功 cookie 形状与 remember 收尾；错误账号态（验签通过后 `ACCOUNT_*`）；同一挑战重放 409；跨 portal 匿名 cookie 隔离；`/auth/ca/result` 恢复。复用 `test/setup-throttle.ts` 放宽新端点限流。
- [ ] **Step 2-4: 实现（controller+service+DTO+cookie 工具）→ e2e+单测 PASS**；旧 auth e2e 全量不回归（`pnpm --filter api test:e2e -- auth`）。
- [ ] **Step 5: commit** `feat(scca): CA 登录链（挑战/登录/恢复/重认证 + 匿名 cookie 来源校验）`。

---

### Task 8: 绑定链（资格门禁 + 双证绑定 + 换绑/解绑）

**Files:**
- Create: `apps/api/src/ca/ca-eligibility.service.ts` + spec
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（新增 `POST /profile/cert/ca-challenge`、扩展 `POST /profile/cert` discriminated DTO、`POST /profile/cert/:id/revoke`）、`supplier-portal.service.ts`
- Test: `apps/api/src/ca/ca-binding.spec.ts` + e2e 扩展

**Interfaces:** Produces：

```
POST /api/supplier-portal/profile/cert/ca-challenge  @Roles('supplier') DTO{credentialProofId}
  → {challengeId, operationId, toSign, expiresAt}   // toSign 覆盖 双证指纹+旧 activeBindingId+caCredentialRevision+purpose
POST /api/supplier-portal/profile/cert              @Roles('supplier') CA 分支 DTO{credentialScheme:'scca-pkcs7',challengeId,signP7,credentialProofId,signCertPem,encCertPem}（服务端用现有 `pemToDer`（x509-cert.ts:55）归一为 DER——adapter 导出实测为 PEM）
POST /api/supplier-portal/profile/cert/:id/revoke   @Roles('supplier') DTO{credentialProofId}
GET  /api/ca/capabilities                           @AnyRole() → {provider,credentialScheme,caCredentialRevision,activeBinding,allowedActions,allowedEnvelopeVersions:['dual-v2'],disabledReasons}
GET  /api/ca/operations/:operationId              @AnyRole() → {status,businessRef,result,evidenceId}（主体归属校验；请求超时后查询/恢复——附录 §2.1）
```

`CaEligibilityService.assertBindEligible(supplierId)`——前置功能闸：`CA_BINDING_ENABLED`+`CA_PILOT_SUBJECT_IDS` 白名单（非白名单→`CA_PILOT_ONLY`）；业务资格：Supplier.status=APPROVED+临时期限+User 活跃；**在途门禁**（解绑共用）：扫描该主体历史提交中待签回执/未归档开标确认/进行中补传（按主体不按 certSn）→ 阻塞返回 409 `CERT_DEPENDENCIES_PENDING` + `details.affectedItems`（HttpExceptionFilter details 白名单需扩——现状 :182-183 仅透传 itemIds/items，加法扩展）。legacy `bindCert` 旧轨（controller :181 现存）保留但挂 `CA_LEGACY_WRITE_ENABLED`（默认仅 dev）——附录 B.25「legacy 写入仅授权主体/环境」。绑定事务：锁 User→Supplier→旧绑定；比对 `expectedActiveBindingId`（来源=`GET /ca/capabilities` 的 `activeBinding.id`；首绑传 `null`，换绑传当前值——CAS 防竞态）；写 CaCertificate（双证 upsert by fingerprint）+ Claim + SupplierCert 新行（credentialScheme='scca-pkcs7'，signing/encryptionCaCertificateId）+ 旧 ACTIVE→REVOKED + `caCredentialRevision++`；Claim 写入撞唯一约束（另一主体已占用同证）→ catch P2002 → 409 `CA_CERT_ALREADY_CLAIMED`；服务端身份核对：网关 certBase64 解析的 DN `SN=`/`OU=NO.1:` 18 位号 === Supplier.creditCode（不符→`CA_IDENTITY_MISMATCH`，测试盾 creditCode 为占位值时以隔离账号的 creditCode 预先对齐）。

- [ ] **Step 1: 失败测试/e2e**——资格三拒（BLACKLIST/未审/临时过期）；在途依赖阻塞与解除；并发双 bind 只成一个（Review Focus 3）；换绑冲突 409 `CA_BINDING_CHANGED`；身份不一致 400；revoke 消费 proof.action='revoke' 且走同一门禁。
- [ ] **Step 2-4: 实现→PASS**（含 details 白名单与操作日志脱敏投影）。
- [ ] **Step 5: commit** `feat(scca): 双证绑定/换绑/解绑（资格+在途门禁+全局占用+身份核对）`。

---

### Task 9: packages/ukey — scca-transport + SccaUKeyAdapter（双证书模型）

**Files:**
- Create: `packages/ukey/src/scca-transport.ts`、`scca-ukey.ts`、`scca-fixture.ts`（FakeWS 供测试）
- Modify: `packages/ukey/src/index.ts`（导出）
- Test: `packages/ukey/src/scca-transport.spec.ts`（Node 跑——FakeWS 注入 `globalThis.WebSocket`，phase0 t1-run.mjs 语义移植）

**Interfaces:** Produces:

```ts
export class SccaTransport {  // transport v3.2 全语义：FIFO 串行队列/每请求固定 sock+gen/超时只关自己的连接/queueEpoch 失效/连接等待 8s/迟帧只记录/action 回显不匹配不消费
  call(action: string, params: unknown[]): Promise<{ retValue: any; retCode?: number }>
  on(event: 'ws', cb: (e: { kind: string }) => void): void
}
export interface SccaDualCert { container: string; sign: { serialHex: string; pem: string; notBefore?: string; notAfter?: string }; enc: { serialHex: string; pem: string } } // container=枚举串解析（`名称||容器名&&&…`——S1 实测单盾 1 条目=双证同容器）；login(container,pin) 依赖此字段
export class SccaUKeyAdapter {  // 不实现旧 UKeyAdapter 单证接口——新双证接口，登录由页面显式调
  static probe(timeoutMs = 300): Promise<{ version: string } | null>   // 超时：竞速 300ms 定时器+close()。TLS 双环境：浏览器端原生 WebSocket（无 rejectUnauthorized 选项，靠 OS 信任库——S12 实证可连）；Node 测试端经 FakeWS 注入（不走真 TLS，无此问题）。生产不经 Node 直连——若未来需要，用 ws 库+rejectUnauthorized:false（中间件自签证书依据 S12/CLI 实测，注释须写明）
  listCertificates(): Promise<SccaDualCert[]>                              // SOF_GetUserList 解析 + 双导出 + 本地 parseCertificate 指纹
  login(container: string, pin: string): Promise<void>                     // SOF_Login，失败同连接 GetLastError
  signP7Attached(container: string, text: string): Promise<string>         // SOFE_SignPKCS7Message(0,c,b64(TextEncoder))
  wrapKeyToEncCert(json: string): Promise<string>                          // SOF_EncryptData(encCert, b64(json))
  unwrapKey(container: string, p7B64: string): Promise<string>            // SOF_DecryptData
}
```

红线内置：`SOF_EncryptData` 输入 >64KiB 抛错（phase0 S9-3 全局阻塞 DoS 面）；错误码三映射（S3/S9/S10/S11 实测）：184550659→`UKEY_PIN_REQUIRED`（未登录——拔盾/服务重启后重登）；184550657→`UKEY_PIN_INVALID`（PIN 错误——错一次减一、登录成功回满 15）；184549377→`UKEY_DECRYPT_FAILED`（错盾/错钥通用码）。浏览器直连依赖中间件自签证书入 OS 信任库（S12 headed 复跑为可选闭环；未闭环则 Task 12 验收含此检查项）。**PIN 不进任何日志**（transport 不记录 params 中的口令位——沿用 mask 表）。

- [ ] **Step 1: 测试基建 + 失败测试**——先给 packages/ukey 补 jest 最小配置（node 环境，沿用 apps/api ts-jest 配方）与 `test` script（现状 package.json 仅 build/dev，spec 无处可跑；`pnpm --filter @water-erp/ukey test` 可跑）；随后 FakeWS 注入后：T1 十断言语义（超时只关自己的连接/QUEUE_INVALIDATED/连接等待超时/打开前关闭/迟帧不误配——直接移植 phase0 `t1-run.mjs`+`t1e.mjs` 为 jest 用例）；PIN 位在 `JSON.stringify(log)` 中恒为 `***`。
- [ ] **Step 2-4: 实现（transport v3.2 移植 TS + 双证封装）→ PASS**；`pnpm --filter @water-erp/ukey build`。
- [ ] **Step 4.5: build**——`pnpm --filter @water-erp/ukey build`（dist 消费不入库，漏建则 api 侧 tsc 隐式 any）
- [ ] **Step 5: commit** `feat(scca): ukey 受控通道与双证适配器（v3.2 语义+DoS 红线）`。

---

### Task 10: 供应商门户前端（CA 登录 + U盾管理改版 + 自检）

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/api.ts`（识别 `/auth/ca/*` 认证请求集合、401 就地展示）、`src/proxy.ts`（三处改动）：
  ① Set-Cookie 逐条透传——`upstream.headers.getSetCookie()` 逐条 append（undici/Next 提供；现状 :66-74 `Headers.forEach+set` 会合并多枚 Set-Cookie）；
  ② **API 匿名路径放行**——auth gate 前加（精确位置：proxy.ts `// ★ Auth gate` 注释行之前）：
  ```ts
  // CA 匿名端点（challenge/login/result）：不经 token_supplier 检查——CA 登录在会话建立之前
  const isCaAuthPath = pathname.startsWith('/api/auth/ca/');
  if (isCaAuthPath) return NextResponse.next();  // 直接放行到 proxy forward
  ```
  现有 `GUEST_PAGES`（proxy.ts:14）是页面级（`/login` 等），**不能**直接加 API 路径——它控制的是页面重定向逻辑而非 API 转发。CA 匿名请求需要在 auth gate 之前短路，让 proxy 直接转发到后端 API。
  ③ `/auth/ca/config` 同理走 ②（只读公开端点）、`src/app/login/page.tsx`（双入口）
- Modify/Rewrite: `src/app/(main)/profile/ukey/page.tsx`（双证卡+绑定向导）、`src/components/profile/ca-selftest-dialog.tsx`（P7 云验签自检）
- Create: `src/utils/scca-ukey.ts`（浏览器侧薄封装：动态 import `@water-erp/ukey`、probe 优先切换 local-sm2/scca）
- Test: `src/components/__tests__/ca-login-flow.test.tsx`、`ca-binding-wizard.test.tsx`（jest+testing-library，沿用现有组件测试目录）

**Interfaces:** Consumes: Task 7/8 全部 HTTP 契约 + Task 9 `SccaUKeyAdapter`。Produces: 页面状态机按附录 §3.2 共用视图模型（`device: unsupported|idle|connecting|ready|disconnected|error`、`operation: idle|preparing|awaitingPin|localRunning|serverVerifying|committing|succeeded|cancelled|failed|unknown`）。

关键实现点（附录 §3.1 修正全落）：①登录页 CA 入口流程 probe→枚举→选证→`/auth/ca/challenge`→PIN（页面密码框，绝不入 URL/console）→`signP7Attached(toSign)`→`/auth/ca/login`→复用 `rememberSupplierSession`；②绑定向导五步（资格预检→选双证→近期密码 reauth→ca-challenge→PIN/PoP→结果），每步独立可取消（actionId 失效迟到回调——`AbortController`+代次）；③U盾管理页四分区（本机状态/当前绑定/签名证/加密证），legacy 行显式 `kind:'legacy'` 投影（旧字段空不显示「永久」）；④自检对话框走 `purpose='self-test'` 挑战+P7 验签+加密证 wrap/unwrap 往返，四分项结果；⑤「绑定状态未知」不降级未绑定不读旧 `supplier_ukey_bound` 缓存（该 key 保留但 scca 路径不读）。

- [ ] **Step 1: 组件测试先行**——登录流（mock api+FakeAdapter 注入）：挑战过期重取、PIN 取消不残留、成功写 session；向导：资格阻塞清单渲染、第 4 步取消清 pending、绑定成功后 capabilities 刷新；登录响应丢失→`/auth/ca/result` 恢复接线用例（附录 §2.1 恢复路径）。
- [ ] **Step 2-4: 实现→PASS**；`pnpm --filter supplier-portal-next build`（Turbopack 构建过）+ 手动 `pnpm dev:supplier` 冒烟登录页。
- [ ] **Step 5: commit** `feat(scca): 供应商门户 CA 登录/绑定向导/双证管理/自检`。

---

### Task 11: 双证到期提醒迁移 + capabilities 全端收口

**Files:**
- Modify: `apps/api/src/scheduler/scheduler.service.ts`（`scanSupplierCertExpiry` 改双源：legacy 行读旧 expiresAt、CA 行读 signing/encryption CaCertificate.notAfter 双条目；分页 take→`skip/take` 循环覆盖 >500；唯一键 (bindingId,certificateId,usage,stage) 幂等）
- Modify: 供应商门户能力 gating 收尾（投递页/回执/澄清入口按 `allowedActions` 启禁——阶段 1 只读不启 v3）
- Test: scheduler spec 扩展（双证不同到期日两条提醒、>500 分页、legacy 不回归）

- [ ] **Step 1-4: 失败测试→实现→PASS**。
- [ ] **Step 5: commit** `feat(scca): 双证到期提醒分页扫描与能力投影收口`。

---

### Task 12: 隔离账号试点准备 + 阶段1 验收（Windows 实盾）

**Files:**
- Create: `apps/api/scripts/scca-pilot-account.ts`（建/修隔离测试供应商：creditCode=测试盾 DN 的 18 位号 `500999202610091118`（**占位值**——第 1 位数字、第 2 位本应为字母/数字混合；正式部署须换真实 USCC，脚本加格式断言）、status=APPROVED、标记 pilot）
- Create: `docs/superpowers/specs/phase0-evidence/pilot/验收记录-阶段1.md`

- [ ] **Step 1: 建隔离账号**（脚本跑 dev 库；`.env` 配 `SCCA_GATEWAY_BASE_URL=http://testmicrosrv.scca.com.cn:9527/signgw-service` + demo 凭据——计量：试点全程 ≤20 发，登记同款台账）。
- [ ] **Step 2: 全链验收（Windows，按附录 §4.3 认证验收矩阵裁剪）**：绑定（成功/资格拒/在途拒/并发冲突）→ CA 登录（成功/SID 轮换/挑战重放拒/detached 拒/错误 toSign 拒）→ 自检四分项 → 密码登录共存 → 拔盾/重启助手后重登（若 S12 headed 未闭环，首项前补该项检查）。每项截图/JSON 归档。
- [ ] **Step 3: 回归**：`pnpm --filter api test`（全量单测）+ `test:e2e -- auth supplier` + 门户 build；记录结果。
- [ ] **Step 4: 收官 commit + 更新能力矩阵**（`能力与阻断项矩阵.md` 追加「阶段1 已实施」列；吊销阻断项保持）。

```bash
git add docs/superpowers/specs/phase0-evidence/pilot/ apps/api/scripts/scca-pilot-account.ts
git commit -m "feat(scca): 阶段1 试点账号与验收记录（绑定/登录/自检 全链）"
```
（显式清单——**禁 `git add -A`**，v1 此处自相矛盾已删。）

---

## Self-Review 结论

1. **Spec 覆盖**：附录 §4.2（认证/绑定/Redis/状态写入）→ Task 6/7/8；§3（UI）→ Task 10；§2 契约 → Task 4/5；§6.1 横切（x509/scheduler/filter/proxy）→ Task 2/10/11/8；§6.3 发布顺序（盘点→增量→读端→前端→试点）→ Task 1→12 顺序。dual-v3（附录 §5）、专家门户（阶段 3）、澄清/回执 P7（阶段 2）明确不在本计划——已由 scope 切除。
2. **占位符扫描**：无 TBD/「适当处理」；前端任务给出契约+关键流程+测试用例（附录 §3 为其完整规格，executor 双读）。
3. **类型一致性**：`parseSignedP7/P7ParseResult`（Task 3→5）、`SccaGatewayClient.verifyPkcs7`（4→5）、`CaChallengeService.claimAndConsume`（6→7/8）、`SccaUKeyAdapter`（9→10）签名已对齐。
4. **Review Focus→测试映射**：①Task 3/5；②Task 5/6；③Task 1/8；④Task 5；⑤Task 4——均有对应 Step 1 用例。
6. **v3 修订记录（2026-10-13 二轮审查，15 条全落）**：P0——①代理匿名放行：Task 10 加精确改动（proxy.ts auth gate 前短路 `/api/auth/ca/` 前缀——GUEST_PAGES 是页面级不能复用）；②`nanoid`→`createId()`（cuid2，项目现有）；③证书格式归一链入 Global Constraints（`normalizeToDer` 单一归一点+五任务转换表）；④`parseSignedP7` 接口改 `string | Buffer`。P1——⑤Task 6 Lua 脚本内联；⑥`fingerprints`→`signCertSha256/encCertSha256?`；⑦`expectedActiveBindingId` 来源（capabilities→activeBinding.id，首绑 null）；⑧Claim 竞态→`CA_CERT_ALREADY_CLAIMED` 409；⑨TLS 双环境注（浏览器 OS 信任库/Node FakeWS 注入/未来 ws 库 rejectUnauthorized）；⑩KeyUsage RFC 5280 位表内联；⑪CaOperation 登录 subjectId 生命周期（null→COMMITTED 写入）。P2——⑫Task 9 commit 加 `pnpm --filter @water-erp/ukey build`；⑬Task 7 controller 加 `@Timeout(30000)`；⑭pilot creditCode 加占位值注+格式断言提示。
5. **v2 修订记录（2026-10-13 代码/demo/实测审查，19 条全落）**：P0——Task1 补 CaOperation/CaVerificationRecord/CaExpiryReminder 三表（v1 引用未建）；`SCCA_TRUSTED_CA_DIR`→复用现有 `TRUSTED_CA_DIR`+`TrustStore.verifyChain` 实接口；Task7 e2e 改 `overrideProvider(CaVerificationService)` 策略（动态 toSign 与真 P7 永不相等，真验证归 Task5 单测）；Task12 删 `git add -A`；Task4 golden 改 T3 捕获对（sink-all.log 虚构凭据）。P1——ukey 补 jest 基建；SccaDualCert 加 `container`；错误码三映射（184550657/184550659/184549377）；probe 竞速 300ms；补 `GET /ca/operations/:id`；功能开关四 env；ITRUSKMC 归 `unknownExtensionOids`；中级证=信任锚（根证挂厂商清单）。P2——proxy 用 `getSetCookie()`；legacy 轨 `CA_LEGACY_WRITE_ENABLED` 闸；e2e 复用 setup-throttle；`/auth/ca/result` 前端接线用例；盘点加三套编号撞号预检；S12 headed 未闭环则 Task12 首查。
