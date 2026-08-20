# 双层数字信封 + 供应商 CA 开标解密 · 设计 Spec

> 日期：2026-08-20
> 状态：待审阅
> 依据：电子招投标合规审查报告（2026-08-19）P0-1/P1-1/P1-2/P1-13/P2-17；《电子招标投标办法》第26/27/30/31/32条
> 用户决策（2026-08-20 确认）：①供应商 CA 采用**外部 CA/U 盾介质**形态；②加密次序 = **供应商内层 → 管理方外层**（开标解密镜像次序）；③存量项目**双轨并存**；④解密交互采用「供应商端解密上传」方案；⑤管理方私钥形态 = **B：服务器托管+仅主持人**（平台生成密钥对、私钥文件受保护路径、bid_host+窗口门控触发解外层）。

---

## 1. 目标

1. **根治 P0-1**：平台存储的投标文件为双层密文，平台开标前**零解密能力、零明文留存**——投递明文永不落地服务器，服务端代加密分支删除。
2. **激活供应商 CA（办法第30条）**：投标文件与唱标内容由供应商 U盾加密；开标时供应商在线解密（U盾），平台按程序启动开标（管理方先解外层）。
3. **顺带修复**：Layer C SM2 验签激活（P1-13 抗抵赖）、解密失败撤销/撤回归因（P1-2）、解密后投标文件形成独立归档物（P2-17）、未加密拒收（办法第26条）。
4. **存量零迁移**：旧轨（KMS 信封 + 主持人代解密）项目继续走旧流程至归档，新投递走新轨。

## 2. 加密次序与数据流（核心）

### 2.1 国密算法约定

| 层 | 算法 | 说明 |
|---|---|---|
| 对称 | **SM4-CBC + PKCS7**（sm-crypto 原生模式，定死不再二选） | 文件/字段加密；DEK 16 字节随机，IV 16 字节随机 |
| 非对称 | SM2（sm2p256v1） | 供应商证书、管理方加密证书均为 SM2 |
| 哈希 | SM3 / SHA-256 | 明文锚点用 SHA-256（与现 FileAsset.sha256 一致）；签名摘要 SM3（sm-crypto 内部处理） |

### 2.2 投递时（加密：先供应商内层，后管理方外层）

```
明文 M（技术标/商务标/投标函/保证金凭证文件 + 报价字段 bidPrice）
  ① 供应商层（浏览器，密钥操作经 U盾适配层）：
     DEK_S = 随机16B；C_inner = SM4(DEK_S, M)
     K_self = SM2_Enc(供应商证书公钥, DEK_S)      // 开标时供应商 U盾解回 DEK_S
     Sig    = SM2_Sign(供应商U盾, SM3(聚合哈希))    // Layer C 抗抵赖（第4.2节）
  ② 管理方层（浏览器，用管理方加密证书公钥——公开，无需介质）：
     DEK_A = 随机16B；C_outer = SM4(DEK_A, C_inner)
     K_admin = SM2_Enc(管理方加密证书公钥, DEK_A)
上传/提交 → 平台只存：C_outer + K_self + K_admin + Sig + SHA256(M)
```

- **平台开标前无法解密**：要拿到明文必须同时经 管理方 U盾（解外层）与 供应商 U盾（解内层）——双方缺一不可。
- **未加密拒收（办法第26条）**：投标文件（technical/business/coverLetter）未按双层信封加密的一律 400 拒收；删除服务端代加密分支。

### 2.3 开标时（解密：先管理方外层，后供应商内层）

```
① 管理方解外层（主持人发起，服务器执行——形态B：管理方私钥服务器托管）：
     主持人触发（bid_host，解密窗口内）→ 服务器读取受保护路径的管理方私钥
     → SM2 解 K_admin 得 DEK_A → SM4 解 C_outer → C_inner
     → 存 FileAsset(category=bid_inner_ciphertext) → 记录 outerDecryptedAt + 监督日志
     ⇑ 此步 = 开标程序正式启动；管理方掌握开标启动控制权（己方权益）
     ⇑ 平台解外层后只拿到 C_inner（供应商密文）——无供应商 U盾仍解不开内容，
       故「平台开标前不能解密投标文件」对形态 B 同样成立
② 供应商解内层（供应商开标大厅，U盾在供应商浏览器，解密窗口内）：
     下载 C_inner + K_self → U盾 SM2 解 DEK_S → SM4 解 → 明文
     本地校验 SHA256(M) == 平台存证值 → 上传明文
     平台存 FileAsset(category=bid_decrypted) → decryptStatus=SUCCESS
③ 唱标：唱标录入照旧；报价一致性校验对新轨读取 decryptedPrice（第5.4节）
```

**为何供应商在内层**：反序（管理方内、供应商外）时，供应商解外层后管理方可单独完成解密——供应商「在场解封」失去实质意义且保密保障被削弱。

## 3. 证书体系

### 3.1 供应商证书（SupplierCert，新表）

```prisma
model SupplierCert {
  id            String   @id @default(cuid())
  supplierId    String
  certSn        String   @unique        // 证书序列号
  certDn        String                   // 证书主体（CN=企业名称,...）
  publicKey     String                   // SM2 公钥 hex（04 开头）
  alg           String   @default("SM2")
  bindingStatus String   @default("ACTIVE") // ACTIVE | REVOKED
  boundAt       DateTime @default(now())
  revokedAt     DateTime?
  supplier      Supplier @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  @@index([supplierId])
}
```

- **绑定流程**：供应商 profile「绑定 CA 证书」→ 适配层枚举证书 → POST 证书信息 → 服务端校验 **DN 含企业名称**（归一化比对，同 expert-conflict 的名称归一逻辑）→ 绑定成功同时回填 `Supplier.sm2PublicKey`（存量列，激活）。
- **实名核验联动**：DN↔企业名一致性校验作为实名核验的一部分（P1-13 部分修复）。
- 换证/挂失：REVOKED + 新证；已提交标书绑定提交时证书快照（envelope JSON 存 certSn+publicKey）。

### 3.2 管理方加密证书（AdminEncryptionCert，新表；**形态 B：私钥服务器托管**）

```prisma
model AdminEncryptionCert {
  id        String   @id @default(cuid())
  publicKey String                   // SM2 公钥 hex
  certDn    String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}
```

- **密钥对由平台生成**：`POST /api/bid/admin-cert/generate`（@Roles admin）服务端用 sm-crypto 生成 SM2 密钥对，**私钥写入受保护路径**（env `ADMIN_UKEY_PRIVATE_KEY_PATH`，默认 `apps/api/.data/admin-encryption-key.json`，gitignored，权限 600），公钥登记置 active（旧证置 inactive 保留至存量项目开标完成——envelope 存 certSn 快照）；
- 生产对应：私钥托管加密机/HSM（密钥不落应用文件系统），生成/读取适配为 HSM 客户端——spec 中 mock 与生产的边界即「私钥读写」一个模块；
- 公钥公开端点 `GET /api/supplier-portal/admin-cert`（supplier 角色）供投递端取用——公钥无敏感性；
- 服务器持外层私钥的**安全论证**：管理方解外层后仅得 C_inner（供应商密文），内容保密屏障在供应商内层——平台开标前无法读取任何投标内容；管理方权益=开标程序控制+全程留痕（解密触发受 bid_host 角色+解密窗口状态+OperationLog/监督日志三重约束）。

### 3.3 证书中间件适配层（新共享包 `@water-erp/ukey`，**仅供应商侧**）

浏览器端适配层，当前仅供应商门户（Vue）消费；管理方解密在服务端执行（§3.2），不需要浏览器介质：

```ts
export interface UKeyAdapter {
  name: string;
  listCertificates(): Promise<CertInfo[]>;              // {certSn, certDn, publicKey, alg}
  sign(certSn: string, digestHex: string): Promise<string>;          // SM2 签名（私钥在介质内）
  decrypt(certSn: string, cipherBlob: string): Promise<string>;      // SM2 解密（私钥在介质内）
}
```

- **MockUKeyAdapter**（开发/演示/单测）：密钥对生成于浏览器，私钥经用户口令派生密钥（PBKDF2 + AES-GCM）加密存 localStorage；支持导出/导入 U盾文件（模拟实体介质可携带——换机器需导出导入）。DN 按绑定供应商名生成。
- **VendorUKeyAdapter 骨架**：接口同上，实现走 CA 厂商本地中间件（localhost 端口 HTTP 协议）；拿到厂商 SDK 文档后填 adapter 即可，业务代码零改动。
- 加密操作（SM2_Enc 用公钥）不需介质，由前端直接 sm-crypto 执行——只有 **sign 与 decrypt 走适配层**。
- 依赖：supplier-portal 新增 `sm-crypto`；API 侧已有 sm-crypto（管理方 SM2 解密复用）。

## 4. 投递信封改造

### 4.1 客户端（BidSubmit.vue）

- 上传即双层：M → C_inner → C_outer → `POST /api/upload?category=bid_document&clientEncrypted=true&plaintextSha256=...`（复用现有端点，`key` 即 C_outer）；
- 浏览器端保留 DEK_S（现有 clientDeks localStorage 机制不变）；
- 提交 payload 新增 `envelope`：每文件 `{ kself, kadmin, certSn }`、报价字段 `{ priceCipher, priceKself, priceKadmin }`、`signature`+`fileHash`（聚合哈希，见4.2）、可选 `hostDecryptAuthorized`（投标人勾选「授权平台在开标环节代解密」时，额外提交 `khost = SM2_Enc(管理方公钥, DEK_S)`）；
- 保证金凭证纳入信封（uploadEncryptedFile 替代现明文 uploadFile，`bidBond` 进入 envelope.files）。

### 4.2 聚合哈希与 Layer C 验签激活

- `fileHash = SHA256( concat( sort( [sha256(technical), sha256(business), sha256(coverLetter), sha256(bond), sha256(priceCipher)] ) ) )`（各文件 sha256 为明文哈希；缺失项跳过；按角色固定序）；
- 客户端签名：`signature = U盾 SM2_Sign( fileHash )`；
- 服务端验签：删除「TODO Phase 6 恒跳过」逻辑，用提交时证书公钥（envelope.certSn → SupplierCert.publicKey 或 sm2PublicKey）验证 `verify(fileHash, signature, pubKey)`；验签失败 400 `SM2_SIGNATURE_INVALID`；
- 存量旧轨提交不要求签名（兼容）。

### 4.3 服务端（submitBid 重构）

- **未加密拒收**：technical/business/coverLetter 任一 asset `clientEncrypted !== true` 或 envelope 缺对应 `{kself,kadmin}` → 400 `BID_FILE_NOT_ENCRYPTED`（提示重新加密上传）；
- **删除服务端代加密分支**（现 supplier-portal.service.ts:911-925 整段）与明文 DEK 接收路径（clientDeks 明文不再接收，改 envelope.kself/kadmin 密文）;
- 落库：envelope JSON（含 certSn 快照）→ `SupplierBidSubmission.envelope`；`envelopeVersion='dual-v2'`；旧轨字段（sealedKey 等）不再写入；
- **KMS_SECRET 对投标文件退役**（新轨不再 wrapKey；envelope-crypto 保留供旧轨与报价字段旧封装使用）；
- BidFileBackup：新轨备份 = C_outer 快照 + kself/kadmin（`cryptoVersion='dual-envelope-v2'`）；备份链为「争议三方核验」保留——核验时需双方到场解封（符合双重加密语义）。

### 4.4 报价字段（bidPrice）

- 新轨：priceCipher 存 `envelope.price`，**不写 bidPrice 列**（bidPrice 列仅旧轨使用，sealField/openField 封装不动）；唱标时由供应商解密上传 decryptedPrice 供校验（第5.4节）；
- 草稿：与提交同构（envelope 随草稿保存）。

## 5. 开标会话模型重构

### 5.1 解密窗口语义（保留）

- 主持人组建会话、解密窗口起止、暂停/恢复、补偿延长——全部保留（管理方控制开标节奏不变）；
- 新增约束：**窗口未开启前不得解外层**（decrypt-outer 校验窗口状态，同现 decryptSupplier 门控）。

### 5.2 主持端：解外层（新增，服务端执行）

- `POST /api/bid/projects/:id/opening/decrypt-outer`（@Roles admin,bid_host；逐家或批量）：**服务端**读取受保护路径管理方私钥 → SM2 解 K_admin → SM4 解 C_outer → C_inner 存 FileAsset(category=bid_inner_ciphertext) → 记 `outerDecryptedAt` + 监督日志「管理方解外层」+ auditLog（actorId）；门控与现 decryptSupplier 同款（OPENING 阶段 + 会话存在 + 解密窗口开启未暂停）；
- 现「单条/批量解密」端点**仅旧轨项目可用**（envelopeVersion=null 分派）；新轨项目调用返回 400 `USE_SUPPLIER_DECRYPT`；
- **授权代解密补救**（办法第30条「按招标文件规定方式」的合规出口）：投标人投递时勾选 `hostDecryptAuthorized` 的项目，主持端 `POST .../opening/decrypt-proxy` 由服务端用管理方私钥解 `khost` → DEK_S → SM4 解 C_inner → 代存明文（同 decrypt-upload 的 sha256 闸门）；授权记录（envelope.hostAuth + 监督日志）随开标文件包存档。

### 5.3 供应商端：解内层（新增）

- `GET /api/supplier-portal/bid-submissions/:projectId/opening-package`（成员门控+窗口内）：返回 C_inner 下载凭证 + K_self + 窗口状态；
- `POST /api/supplier-portal/bid-submissions/:projectId/decrypt-upload`（成员门控+窗口内）：上传解密明文 → 服务端校验 `SHA256(M) == FileAsset.sha256`（存证锚点，防替换——复用补传同款闸门语义）→ 存 FileAsset(category=bid_decrypted) → `decryptStatus=SUCCESS` + `decryptedPrice` 提取（报价字段解密结果）→ 监督日志 + WS 广播 `opening:decrypted`；
- 供应商门户 OpeningHall.vue 新增「解密我的投标」卡片（U盾选择器 + 解密进度 + 失败原因展示）。

### 5.4 唱标衔接

- 唱标录入流程与一致性校验不动；
- 新轨报价校验源：`assertPriceMatchesSealed` 在新轨读 `decryptedPrice`（供应商解密上传后可得），旧轨读 openField(sealed bidPrice)；唱标录入前供应商未完成解密 → 报价校验跳过并提示（与现行「未解密不可唱标」节奏一致）；
- 唱标记录表、开标文件包 JSON 结构不变。

### 5.5 解密失败归因（P1-2）

- `BidSupplier.dangerAttribution: String?`（`BIDDER` | `PLATFORM` | `UNKNOWN`）；
- 窗口关闭扫描（现有完成度守卫扩展）：未 SUCCESS 且 `hostDecryptAuthorized=false` → 归因 `BIDDER`（**视为撤销**）；主持人可对平台故障批量标记 `POST .../opening/mark-platform-fault`（须填原因，写监督日志）→ `PLATFORM`（**视为撤回**）；
- 通知文案按归因分流并**告知权利**：BIDDER →「因投标人原因未完成解密，视为撤销投标文件，保证金依招标文件规定处理」；PLATFORM →「因平台原因未完成解密，视为撤回投标文件，你有权要求责任方赔偿直接损失」（办法第31条）；
- 归因写入开标文件包与监督日志。

### 5.6 reseal / 补传

- **删除 reseal 明文分支**（bid.service.ts:2452-2500 段）；E2EE 重包裹分支仅对旧轨保留；
- 新轨 reseal → 400 引导走补传；补传 reupload 改造：供应商端重新双层加密上传（sha256 逐字节闸门不变，服务器只存 C_outer）。

### 5.7 解密后投标文件归档（P2-17）

- category=bid_decrypted 的 FileAsset（明文+sha256）为独立归档物；评标回流包 JSON 的 suppliers 段补 `decryptedFileSha256` 引用；完整归档清单补「解密后投标文件」项（哈希链既有 fileHashes 机制可纳入）。

## 6. 数据模型变更（migration 清单）

| 表 | 变更 |
|---|---|
| `SupplierCert` | 新表（§3.1） |
| `AdminEncryptionCert` | 新表（§3.2） |
| `SupplierBidSubmission` | +`envelope Json?`、+`envelopeVersion String?`、+`decryptedPrice String?`、+`outerDecryptedAt DateTime?`、+`hostDecryptAuthorized Boolean @default(false)` |
| `BidSupplier` | +`dangerAttribution String?` |
| `BidOpeningSession` | 无结构变更（复用解密窗口字段） |
| `FileAsset` | 无结构变更（category 新取值 `bid_inner_ciphertext` / `bid_decrypted`） |
| `Supplier` | 无结构变更（sm2PublicKey 激活写入） |

迁移纪律（memory `main-db-migration-drift`）：`prisma migrate dev --create-only` → 人工审查 SQL（勿让 diff 重生成 OperationLog 分区 PK/超集索引/pgvector DDL）→ `db execute` → `migrate resolve --applied`。

## 7. 端点清单

### 新增
| 端点 | 角色 | 说明 |
|---|---|---|
| `GET /api/supplier-portal/admin-cert` | supplier | 管理方加密证书公钥（投递端取用） |
| `POST /api/supplier-portal/profile/cert` | supplier | 绑定 CA 证书（DN↔企业名校验） |
| `DELETE /api/supplier-portal/profile/cert/:id` | supplier | 解绑/换证（REVOKED） |
| `GET /api/supplier-portal/bid-submissions/:projectId/opening-package` | supplier（成员） | 取 C_inner + K_self + 窗口状态 |
| `POST /api/supplier-portal/bid-submissions/:projectId/decrypt-upload` | supplier（成员） | 解密明文上传（sha256 闸门） |
| `POST /api/bid/projects/:id/opening/decrypt-outer` | admin,bid_host | 管理方解外层 |
| `POST /api/bid/projects/:id/opening/decrypt-proxy` | admin,bid_host | 授权代解密（须 hostDecryptAuthorized） |
| `POST /api/bid/projects/:id/opening/mark-platform-fault` | admin,bid_host | 平台故障归因标记 |
| `POST /api/bid/admin-cert/generate` | admin | 服务端生成管理方 SM2 密钥对（私钥写受保护路径，公钥登记置 active） |
| `GET /api/bid/admin-cert` | admin | 查看当前管理方加密证书（公钥/certDn/active） |

### 变更/退役
- `submitBid`：未加密拒收 + 删除服务端代加密分支 + 验签激活；
- `decrypt` / `decrypt-all`（bid.controller）：仅旧轨；
- `resealBidFiles`：删除明文分支；新轨 400；
- `reuploadBidFile`：新轨要求双层信封；
- `download`（upload.service）：新轨 bid_document 下载开标前返回密文（现状不变），解密后明文经 bid_decrypted 类目走现有权限链（SUCCESS 门控复用）。

## 8. 存量兼容与迁移

- **双轨分派**：`envelopeVersion === 'dual-v2'` → 新轨；null/旧值 → 旧轨（KMS 信封 + 主持人代解密），旧轨逻辑不改动；
- **存量明文清理**：新脚本 `scripts/clean-legacy-plaintext.ts`（tsx）：dry-run 列出「`encrypted=true && clientEncrypted=false` 且被 submitted 提交引用」的 FileAsset → 执行删除 MinIO 明文对象（asset.key），sealedPath 密文保留；未提交草稿明文不动（提交时被拒，供应商重新加密上传）；
- **演示快照**：不重拍；`scripts/demo-decrypt-project.js` 仅当涉及新轨演示时适配（旧轨演示路径不动）；
- **KMS_SECRET**：继续保留（旧轨 + DB 字段密封）；新轨不再使用。

## 9. 前端改造清单

| 门户 | 改动 |
|---|---|
| supplier-portal | +sm-crypto 依赖；+`@water-erp/ukey` 适配层接入；profile 证书绑定页（枚举/绑定/换证/U盾导出导入）；BidSubmit.vue 双层加密+签名+授权勾选；OpeningHall.vue「解密我的投标」卡片；保证金凭证加密上传 |
| bid-portal | 无 U盾适配层（管理方解密在服务端）；管理方证书生成按钮（admin 可见，调用 admin-cert/generate）；开标大厅「解外层」步骤与进度（触发服务端解密）；代解密按钮（授权项目）；reseal 按钮退役（旧轨保留）；平台故障归因标记 UI |
| web (:3005) | 无改动（开标确认面板不涉解密执行） |
| expert-portal | 无改动（解密后文件下载走现有权限链） |

## 10. 测试策略

- **适配层单测**（新包 @water-erp/ukey）：MockUKeyAdapter sign/decrypt/证书枚举 roundtrip、口令加密存储、导出导入往返；
- **API 单测**：submitBid 未加密拒收（BID_FILE_NOT_ENCRYPTED）、envelope 缺失字段校验、验签失败 400、decrypt-outer 窗口门控（服务端解密路径）、admin-cert/generate 私钥落盘与幂等、decrypt-upload sha256 不匹配拒绝、dangerAttribution 归因、decrypt-proxy 授权前置、cert 绑定 DN 校验、旧轨 decrypt 回归不破；
- **供应商前端**：`npx vue-tsc --noEmit`（不可用则 build）；**bid-portal**：`npx tsc --noEmit`；
- **端到端冒烟**（手工脚本）：mock U盾 → 绑定证书 → 投递（双层）→ 开标 → 管理方解外层 → 供应商解内层 → 唱标比对 → 归档含解密后投标文件。

## 11. 分阶段落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| Phase 1 基座 | @water-erp/ukey 包（接口+Mock+骨架）、SupplierCert/AdminEncryptionCert 迁移、证书绑定/登记端点、管理方公钥公开端点 | 单测 + tsc |
| Phase 2 投递 | BidSubmit 双层加密+签名、submitBid 重构（拒收+验签+envelope）、BidFileBackup v2、补传改造 | API 单测 + vue-tsc |
| Phase 3 开标 | decrypt-outer/opening-package/decrypt-upload/decrypt-proxy/mark-platform-fault、归因、唱标衔接、reseal 退役、解密后归档物 | API 单测 + tsc + 冒烟 |
| Phase 4 清理 | clean-legacy-plaintext.ts（dry-run→执行）、旧轨回归、演示验证 | 全量单测 + 手动验证 |

## 12. 风险与开放问题

1. **Mock 与真 U盾的协议差异**：VendorUKeyAdapter 的具体交互协议依赖厂商 SDK，属隔离面，不阻塞 Phase 1-4。
2. **管理方私钥的服务器保护**（形态 B）：私钥文件路径 env 配置、权限 600、gitignore；任何人取得 API 服务器文件系统访问权即可得外层私钥——但外层解封后仍被供应商内层保护，内容不泄露；风险转化为「开标程序控制权」层面，由角色+窗口+双日志（OperationLog/监督日志）约束。生产迁移加密机/HSM 时仅替换「私钥读写」模块。
3. **报价字段的唱标节奏**：新轨唱标报价校验依赖供应商先行解密上传（decryptedPrice）；供应商解密滞后时唱标录入可先行、报价校验后补——需在 Phase 3 明确 UI 提示口径。
4. **旧轨解密异常演示脚本**：demo-decrypt-project.js 与新轨关系待 Phase 3 验证后确认是否适配。
5. **DER/PEM 编码**：供应商端 sm-crypto 与真 CA 证书的编码格式转换在 VendorUKeyAdapter 内消化，Mock 全 hex。
