# 双层数字信封 + 供应商 CA 开标解密 · 设计 Spec

> 日期：2026-08-20（v2 安全评审 → v3 代码对账 → v4 落地性对账 → v5 计划推演补 sealedFields → v6 补传密封件锚点锁定）
> 状态：已实施（feat/dual-envelope）
> 依据：电子招投标合规审查报告（2026-08-19）P0-1/P1-1/P1-2/P1-13/P2-17；《电子招标投标办法》第26/27/30/31/32条
> 用户决策（2026-08-20 确认）：①供应商 CA 采用**外部 CA/U 盾介质**形态；②加密次序 = **供应商内层 → 管理方外层**（开标解密镜像次序）；③存量项目**双轨并存**；④解密交互采用「供应商端解密上传」方案；⑤管理方私钥形态 = **B：服务器托管+仅主持人**。
> v2 评审修订（2026-08-20）：**删除 khost 授权代解密**（其存在使「平台开标前零解密能力」失效——不在场投标人依法视为撤销，在场故障者持 U盾自行重解，代解密无必要）；**报价等唱标字段改用 nonce 承诺绑定**（防开标时篡改）；**撤销归因增加前置条件**（防管理方失误误判供应商）；C_inner 下载权限、管理方密钥轮转布局、bootstrap、多轮报价口径、签名规范化等 11 项修订。
> v3 代码对账修订（2026-08-20，逐点核对现有代码后）：**下载链路三处冲突修复**（通用 download 的 AES-GCM 流式解密分支对新轨密文必挂——upload.service.ts:172-204：C_outer 本人下载 400/乱码、专家 SUCCESS 后下载需改指明文资产、C_inner 须以 clientEncrypted=false 存储）；**唱标记录预填**（旧轨开标记录由 decryptSupplier 事务内自动 upsert——bid.service.ts:2097-2119，新轨由 decrypt-upload 承担，否则唱标表空）；**归因矩阵触发点**（现有代码无「窗口关闭扫描」，assertOpeningDone 只查不转——惰性执行+UNKNOWN 阻塞完成开标）；WS 事件复用 notifyDecryptStatus、decrypt-upload 原子抢占、bond 解密链路、bid-crypto 并行模块、encryptStatus 文案、本人报价回显、mock 签名法律效力声明。
> v4 落地性对账修订（2026-08-20 第三轮审核）：**新资产归属链**（FileAsset 无任何 project/supplier 关联，canAccessFile/expert 规则靠 submission 四列 assetId 反查——C_inner/bid_decrypted 不在四列中则 §5.2/§5.4a 权限规则做不出来；envelope 已签名不可事后追加 → SupplierBidSubmission 增 `innerAssets`/`decryptedAssets` 两 Json 列，签名之外并行存储）；**envelope 补 adminCertId**（密钥轮转后定位旧私钥的唯一锚点，v3 内部不一致）；**pickBidSubmissionFields 白名单扩展**（Mass Assignment 白名单不含新字段会被剥离，draft 路径同源）；split 模式首文件语义、outer 就绪通知、服务端 SM4 无流式 API、密封核验（招标投标法第36条电子化对应物）。
> v6 实施修订（2026-08-20，Task 10 审查裁决）：**补传不得变更唱标字段密封件**——新 envelope 的顶层 `fieldsCommit` 与 `sealedFields.fieldsSha256` 必须与投递时 `submission.envelope` 原值**逐字相等**（任一缺失或不符 → 400 `FIELDS_COMMIT_CHANGED` + 监督日志「疑似借补传改价」）；§5.6 原文「fieldsCommit 随新 envelope 重新签名」作废（开标期借补传改价通道）。

---

## 1. 目标

1. **根治 P0-1**：平台存储的投标文件为双层密文，平台开标前**零解密能力、零明文留存**（无任何例外通道）——投递明文永不落地服务器，服务端代加密分支删除。
2. **激活供应商 CA（办法第30条）**：投标文件与唱标内容由供应商 U盾加密；开标时供应商在线解密（U盾），平台按程序启动开标（管理方先解外层）。
3. **顺带修复**：Layer C SM2 验签激活（P1-13 抗抵赖）、解密失败撤销/撤回归因（P1-2，含前置条件）、解密后投标文件形成独立归档物（P2-17）、未加密拒收（办法第26条）。
4. **存量零迁移**：旧轨（KMS 信封 + 主持人代解密）项目继续走旧流程至归档，新投递走新轨。

## 2. 加密次序与数据流（核心）

### 2.1 国密算法约定

| 层 | 算法 | 说明 |
|---|---|---|
| 对称 | **SM4-CBC + PKCS7**（sm-crypto 原生模式，定死不再二选） | 文件/字段加密；DEK 16 字节随机，IV 16 字节随机 |
| 非对称 | SM2（sm2p256v1） | 供应商证书、管理方加密证书均为 SM2 |
| 哈希 | SM3 / SHA-256 | 明文锚点/承诺用 SHA-256（与 FileAsset.sha256 一致）；SM2 签名参数统一封装（见 §4.2） |

### 2.2 投递时（加密：先供应商内层，后管理方外层）

```
明文 M（技术标/商务标/投标函/保证金凭证文件）
唱标字段 F = { price, deliveryPeriod, qualityCommitment }   // 缺失字段取空串
  ① 供应商层（浏览器，密钥操作经 U盾适配层）：
     nonce    = 随机128bit（客户端持有，开标时揭示）
     fieldsCommit = SHA256( canonicalJson(F) + ':' + nonce )   // 密封承诺（防开标时改字段）
     DEK_S = 随机16B；C_inner = SM4(DEK_S, M)
     K_self = SM2_Enc(供应商证书公钥, DEK_S)      // 开标时供应商 U盾解回 DEK_S
  ② 管理方层（浏览器，用管理方加密证书公钥——公开，无需介质）：
     DEK_A = 随机16B；C_outer = SM4(DEK_A, C_inner)
     K_admin = SM2_Enc(管理方加密证书公钥, DEK_A)
  ③ envelope = { version:'dual-v2', certSn, adminCertId,
                  files:{角色:{sha256,kself,kadmin}},
                  sealedFields:{ cipher:SM4(DEK_F, canonicalJson(F+nonce)), kself:SM2_Enc(供应商公钥, DEK_F) },
                  fieldsCommit }
     // sealedFields（v5）：F+nonce 的供应商层密封件——nonce 为随机值不可凭记忆重输、
     // fieldsCommit 仅哈希不可逆，无此密封件则供应商换设备/清浏览器后解密上传死锁。
     // 仅 kself 包裹（无管理方外层）：恢复只需供应商 U盾；完整性由 fieldsCommit+签名保障。
     Sig = UKey_SM2_Sign( SHA256(canonicalJson(envelope)) )    // 对整个 envelope 签名（§4.2）
上传/提交 → 平台只存：C_outer + K_self + K_admin + Sig + envelope + 各文件 SHA256(M)
```

- **平台开标前无法解密（无例外）**：外层私钥虽在服务器（形态 B），解外层后仅得 C_inner；内容保密屏障在供应商内层——无供应商 U盾不可读。**不存在任何预托管/代解密通道**：投标人不在场未解密，依办法第31条视为撤销；在场遇浏览器故障，换设备用 U盾（或其导出文件）重新解密即可。
- **未加密拒收（办法第26条）**：technical/business/coverLetter/bond（bondRequired 项目）任一未按双层信封加密 → 400 拒收；删除服务端代加密分支。

### 2.3 开标时（解密：先管理方外层，后供应商内层）

```
① 管理方解外层（主持人发起，服务器执行——形态B：管理方私钥服务器托管）：
     主持人触发（bid_host，解密窗口内）→ 服务器读取 keystore 的管理方私钥
     → SM2 解 K_admin 得 DEK_A → SM4 解 C_outer → C_inner
     → 存 FileAsset(category=bid_inner_ciphertext) → 记录 outerDecryptedAt + 监督日志
     ⇑ 此步 = 开标程序正式启动；管理方掌握开标启动控制权（己方权益）
     ⇑ 平台解外层后只拿到 C_inner（供应商密文）——无供应商 U盾仍解不开内容
② 供应商解内层（供应商开标大厅，U盾在供应商浏览器，解密窗口内）：
     GET opening-package（记 packageFetchedAt）→ 下载 C_inner + K_self + sealedFields.kself
     → U盾 SM2 解 DEK_S → SM4 解 → 明文；U盾 解 sealedFields.kself → DEK_F → SM4 解 → F+nonce（v5：不依赖本地存储/记忆）
     本地校验 SHA256(M) == 存证值 → 连同 F + nonce 一并上传
     服务端双闸：SHA256(M)==存证 && SHA256(canonicalJson(F)+':'+nonce)==fieldsCommit
     → 存 FileAsset(category=bid_decrypted) → decryptStatus=SUCCESS
③ 唱标：录入流程照旧；报价一致性校验对新轨读取经承诺验证的 decryptedPrice（§5.4）
```

**为何供应商在内层**：反序（管理方内、供应商外）时，供应商解外层后管理方可单独完成解密——供应商「在场解封」失去实质意义且保密保障被削弱。

**唱标字段密封原理（nonce 承诺）**：提交时只公开 `fieldsCommit`（含 128bit 随机 nonce）——供应商开标时改字段找不到新值对应的 nonce（原像不可求）；平台想提前枚举低熵报价缺少 nonce（承诺不可暴力破解）。承诺被 envelope 签名覆盖，提交后不可更换。

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
- 换证/挂失：REVOKED + 新证；**换证时 UI 警示「已有 N 个未开标提交依赖旧证书解密」**（envelope 存 certSn+publicKey 快照，旧标书仍需旧证书解密，供应商须保留旧 U盾证书）。

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

- **密钥对由平台生成**：`POST /api/bid/admin-cert/generate`（@Roles admin）服务端用 sm-crypto 生成 SM2 密钥对，公钥登记置 active（旧证置 inactive）；`GET /api/bid/admin-cert`（admin）查看当前证书。
- **私钥 keystore 布局（支持轮转）**：env `ADMIN_KEYSTORE_DIR`（默认 `apps/api/.data/admin-keystore/`，gitignored，目录权限 700）下**每证书一个私钥文件**（文件名 = certId，权限 600）——旧提交的 K_admin 绑定旧公钥（envelope 存 certSn/certId 快照），轮转后旧项目仍可用对应旧私钥解外层；inactive 证书的私钥保留至其覆盖提交全部归档。
- **Bootstrap**：`db:seed` 自动生成初始证书；应用启动自检——无 active 证书时自动生成并写告警日志（防「供应商取不到公钥无法投递」的空态死锁）。
- 生产对应：keystore 读写模块适配加密机/HSM 客户端——mock 与生产的边界即「私钥读写」一个模块。
- 公钥公开端点 `GET /api/supplier-portal/admin-cert`（supplier 角色）供投递端取用——公钥无敏感性。
- 服务器持外层私钥的**安全论证**：管理方解外层后仅得 C_inner（供应商密文），内容保密屏障在供应商内层——平台开标前无法读取任何投标内容；管理方权益=开标程序控制+全程留痕（解密触发受 bid_host 角色+解密窗口状态+OperationLog/监督日志三重约束）。

### 3.3 证书中间件适配层（新共享包 `@water-erp/ukey`，**仅供应商侧消费**；含服务端复用的纯函数模块）

浏览器端适配层 + 信封规范化纯函数（前后端同源）：

```ts
export interface UKeyAdapter {
  name: string;
  listCertificates(): Promise<CertInfo[]>;              // {certSn, certDn, publicKey, alg}
  sign(certSn: string, msg: string): Promise<string>;                // SM2 签名（私钥在介质内）
  decrypt(certSn: string, cipherBlob: string): Promise<string>;      // SM2 解密（私钥在介质内）
}
/** 规范化哈希（前后端同一实现，防两套 canonicalization 漂移） */
export function canonicalEnvelopeHash(envelope: DualEnvelope): string; // SHA256(canonicalJson)
export function computeFieldsCommit(fields: SealedFields, nonce: string): string;
```

- **MockUKeyAdapter**（开发/演示/单测）：密钥对生成于浏览器，私钥经用户口令派生密钥（PBKDF2 + AES-GCM）加密存 localStorage；**导出/导入 U盾文件**（仅证书私钥——F+nonce 在 sealedFields 内，见 §12.3）模拟实体介质可携带——换机器、在场换设备重解都依赖此文件。
- **VendorUKeyAdapter 骨架**：接口同上，实现走 CA 厂商本地中间件（localhost 端口 HTTP 协议）；拿到厂商 SDK 文档后填 adapter 即可，业务代码零改动。
- **SM2 签名参数统一封装**：der/userId/hash 等参数在共享包内一处显式定义，前后端同参调用（不依赖 sm-crypto 默认值），并附 golden vector 测试（§10）。
- 加密操作（SM2_Enc 用公钥）不需介质，由前端直接 sm-crypto 执行——只有 **sign 与 decrypt 走适配层**。
- 依赖：supplier-portal 新增 `sm-crypto`；API 侧已有 sm-crypto（管理方 SM2 解密复用）；API 直接 import `@water-erp/ukey` 的纯函数模块（Phase 1 构建时确认 dist+types 可被 Nest 消费，与 @water-erp/shared 同模式）。

## 4. 投递信封改造

### 4.1 客户端（BidSubmit.vue）

- 上传即双层：M → C_inner → C_outer → `POST /api/upload?category=bid_document&clientEncrypted=true&plaintextSha256=...`（复用现有端点，`key` 即 C_outer）；保证金凭证同款（uploadEncryptedFile 替代现明文 uploadFile）；
- **加密模块并行不改造**：现有 `@/utils/bid-crypto`（WebCrypto AES-GCM，DEK=key:iv:tag 三段 hex）保留供旧轨密文读取；新增 `dual-envelope` 模块（sm-crypto SM4/SM2 + nonce），`computePlaintextHash` 从 bid-crypto 复用；localStorage clientDeks 条目结构随新轨扩展（DEK_S+nonce 并存）；
- 浏览器端 localStorage（clientDeks 机制扩展）仅为**草稿编辑加速缓存**——开标恢复不依赖它（F+nonce 经 sealedFields 用 U盾可解，v5）；
- 提交 payload：`envelope`（见 §2.2 结构）+ `signature`（对 canonicalEnvelopeHash 签名）+ `sealedFields` 对应的 nonce 仅存本地不上传；**无任何代解密授权字段**；
- 草稿：与提交同构（envelope 随草稿保存；重新提交生成新 envelope+新签名+新 nonce）。

### 4.2 envelope 规范化签名（Layer C 验签激活）

- envelope 结构固定：`{ version:'dual-v2', certSn, adminCertId, files: { technical|business|coverLetter|bond: {sha256(明文), kself, kadmin} }, fieldsCommit }`（缺失角色不出现在 files；canonicalJson = 键字典序、无空白——共享包单一实现；**adminCertId = 投递时所用管理方加密证书 id**——密钥轮转后 decrypt-outer 按 it 定位 keystore 旧私钥，纳入签名防替换）；角色集与 `normalizeBidFileAssets` 归一契约严格对齐（supplier-portal.service.ts:75-94）：完整标书→technical、拆分模式**每类仅首个文件**入信封（`v[0]`，沿现状）、other→coverLetter 兜底；
- 客户端：`signature = UKey.sign(canonicalEnvelopeHash(envelope))`；
- 服务端：删除「TODO Phase 6 恒跳过」——用提交时证书公钥（envelope.certSn → SupplierCert 或快照）验签；验签失败 400 `SM2_SIGNATURE_INVALID`；存量 `SupplierBidSubmission.fileHash/signature` 列复用（fileHash 存 canonicalHash）；
- 签名覆盖整个 envelope（含 kself/kadmin/fieldsCommit）——提交后任何字段不可更换；明文哈希与 ciphertext 的绑定由解密上传时的 SHA256 闸门闭环（§5.3）；
- 存量旧轨提交不要求签名（兼容）。

### 4.3 服务端（submitBid 重构）

- **未加密拒收**：technical/business/coverLetter（及 bondRequired 项目的 bond）任一 asset `clientEncrypted !== true` 或 envelope 缺对应 `{kself,kadmin}` → 400 `BID_FILE_NOT_ENCRYPTED`（提示重新加密上传）；
- **删除服务端代加密分支**（现 supplier-portal.service.ts:911-925 整段）与明文 DEK 接收路径（clientDeks 明文不再接收，改 envelope 密文字段）；
- 落库：envelope JSON + canonicalHash + signature → `SupplierBidSubmission`；`envelopeVersion='dual-v2'`；旧轨字段（sealedKey 等）不再写入；`BidSupplier.encryptStatus` 写「**双层信封已验签**」（该列进开标文件包与 CSV 导出，bid.service.ts:5026/:5155）；
- **白名单扩展（实现必经关卡）**：`pickBidSubmissionFields`（supplier-portal.service.ts:51-69）是 Mass Assignment 白名单，**envelope/envelopeVersion 不在其中会被剥离**——draft（`:1063`）与 submit 两路径同源生效；新轨字段显式加入白名单，同时改其 bidPrice 分支：新轨不再 `sealField(bidPrice)` 入库（`  :54` 现状），draft 同理（fieldsCommit 随 envelope 存）；
- **KMS_SECRET 对投标文件退役**（新轨不再 wrapKey；envelope-crypto 保留供旧轨与 DB 字段密封使用）；
- BidFileBackup：新轨备份 = C_outer 快照 + envelope（`cryptoVersion='dual-envelope-v2'`）；备份链为「争议三方核验」保留——核验时需双方到场解封（符合双重加密语义）。

### 4.4 唱标字段密封（fieldsCommit）

- 提交时：客户端算 `fieldsCommit = SHA256(canonicalJson(F) + ':' + nonce)`（F = {price, deliveryPeriod, qualityCommitment}，缺失取空串），仅承诺值入 envelope（签名覆盖）；nonce/明文字段不上传（bidPrice 列新轨不写，仅旧轨使用）；
- 开标时：供应商解密上传时提交 `F + nonce`（§5.3），服务端重算比对 envelope.fieldsCommit——**供应商开标时无法改字段**（无原像）、**平台无法提前枚举报价**（无 nonce）；
- **多轮报价（BidQuote / roundMode=negotiation|sealed_auction）口径**：本 spec 范围 = 投递时的密封字段；多轮项目的逐轮报价字段现状（明文 BidQuote）暂不纳入信封，后续轮次功能迭代按「每轮独立 fieldsCommit + 逐轮解密上传」扩展——在 BidQuote 模型处标注 TODO 引用本节。

## 5. 开标会话模型重构

### 5.1 解密窗口语义（保留）

- 主持人组建会话、解密窗口起止、暂停/恢复、补偿延长——全部保留（管理方控制开标节奏不变）；
- 新增约束：**窗口未开启前不得解外层**（decrypt-outer 校验窗口状态，同现 decryptSupplier 门控）。

### 5.2 主持端：解外层（新增，服务端执行）

- `POST /api/bid/projects/:id/opening/decrypt-outer`（@Roles admin,bid_host；逐家或批量）：**服务端**按 envelope 快照的 `adminCertId` 取 keystore 对应私钥 → SM2 解 K_admin → SM4 解 C_outer → C_inner 存 FileAsset(category=bid_inner_ciphertext, clientEncrypted=false) → **同事务写 `SupplierBidSubmission.innerAssets Json`（{role: assetId}——FileAsset 无项目归属列，§5.4a 权限反查的唯一依赖）** → 记 `outerDecryptedAt` + 监督日志「管理方解外层」+ auditLog（actorId）；门控与现 decryptSupplier 同款（OPENING 阶段 + 会话存在 + 解密窗口开启未暂停）；批量逐家串行（sm-crypto 无流式 API，50MB 全量缓冲，防内存堆积）；
- 现「单条/批量解密」端点**仅旧轨项目可用**（envelopeVersion=null 分派）；新轨项目调用返回 400 `USE_SUPPLIER_DECRYPT`；
- **C_inner 存储与下载规则**：C_inner 落库时 `clientEncrypted=false`（它不是「客户端加密」语义——若标 true 会误入 download 的 AES-GCM 流式解密分支，upload.service.ts:172-204，对 SM4 密文必然输出乱码/报 MISSING_SEALED_KEY）；`canAccessFile` 新增规则：category=bid_inner_ciphertext 按项目成员放行（请求者 BidSupplier.supplierId 匹配该项目）——现规则「uploader 本人/admin/bid_host/SUCCESS 后 staff·专家」不含等待解密中的供应商本人。

### 5.3 供应商端：解内层（新增）

- `GET /api/supplier-portal/bid-submissions/:projectId/opening-package`（成员门控+窗口内+outer 已解）：返回 C_inner 下载凭证（按 innerAssets 解析）+ K_self + 窗口状态 + **C_outer 密文 sha256（密封核验——招标投标法第36条「当众检查投标文件密封情况」的电子化对应物：供应商解密前本地重算密文哈希比对，确认密封未被调包；语义同 BidFileBackup.ciphertextSha256）**；**记录 `packageFetchedAt`**（归因依据，§5.5）；outer 解密就绪的告知：前端进入开标大厅后轮询本端点（5-10s）或 WS 增加常量事件（二选一，实现期定）；
- `POST /api/supplier-portal/bid-submissions/:projectId/decrypt-upload`（成员门控+窗口内）：上传**全部角色解密明文**（technical/business/coverLetter/bond）+ `F + nonce` → 服务端双闸校验：
  1. 每文件 `SHA256(M) == FileAsset.sha256`（明文存证锚点，防文件替换——复用补传同款闸门语义；**bond 同样入闸**）；
  2. `SHA256(canonicalJson(F)+':'+nonce) == envelope.fieldsCommit`（防唱标字段篡改）；
  双闸过 → 存 FileAsset(category=bid_decrypted) → **同事务写 `decryptedAssets Json`（{role: assetId}——§5.4a 权限反查依赖）** → `decryptStatus=SUCCESS`、`decryptedPrice=F.price` 落库 → **自动预填开标记录**（见下）→ 监督日志 + WS 复用 `notifyDecryptStatus` 既有通道（事件常量表 packages/shared/src/bid-events.ts 已有解密状态事件，**不新增臆造事件名**；如需细分「供应商自解」标记，在 bid-events.ts 加常量并同步三份 use-bid-websocket 前端钩子）；任一闸失败 → DANGER + 归因 UNKNOWN（§5.5）；
- **并发/幂等（复用旧轨三段式）**：decrypt-upload 采用与 decryptSupplier 同款「①原子抢占（PENDING→RUNNING 条件更新，bid.service.ts:1981-2011）+ 60s 崩溃接管 → ②事务外文件校验 → ③短事务终局写入」——供应商端弱网重传/双击是常态，无抢占会双跑双写；
- **唱标记录预填（衔接旧轨语义）**：双闸通过后，事务内自动 upsert `BidOpeningRecord`（amount=F.price、period=F.deliveryPeriod、qualityTarget=F.qualityCommitment、confirmStatus=「待供应商确认」、bondStatus 留空由主持人判定）——旧轨该记录由 decryptSupplier 在解密事务内创建（bid.service.ts:2097-2119「解密即唱标」），新轨由 decrypt-upload 承担同一职责，主持端唱标表/供应商确认流/开标文件包无感衔接；
- 供应商门户 OpeningHall.vue 新增「解密我的投标」卡片（U盾选择器 + 解密进度 + 字段揭示 + 失败原因展示）。

### 5.4 唱标衔接

- 主持端唱标录入流程与一致性校验不动（唱标记录已由 §5.3 预填，主持端为核对/修正角色）；
- 新轨报价校验源：`assertPriceMatchesSealed` 在新轨读 `decryptedPrice`（已经 fieldsCommit 验证）；旧轨读 openField(sealed bidPrice)（supplier-portal.service.ts:1212 同源）；唱标录入前供应商未完成解密 → 报价校验跳过并提示（与现行「未解密不可唱标」节奏一致）；
- 唱标记录表、开标文件包 JSON 结构不变。

### 5.4a 下载链路切换（新轨）

现有通用 download 对 `clientEncrypted` 资产做 AES-GCM 流式解密（upload.service.ts:172-204），对新轨密文全部失效，按 envelopeVersion 分派：

| 场景 | 旧轨 | 新轨 |
|---|---|---|
| 供应商本人下载投标文件 | E2EE 分支 AES-GCM 解密回明文 | **拒绝**（400 `SEALED_NO_DOWNLOAD`——C_outer 对本人无用途且必挂分支；本人要的 C_inner 走 opening-package，明文解密上传后本地已有） |
| admin/bid_host/leader/staff 下载（SUCCESS 门控后） | 解密分支输出明文 | **改指 `bid_decrypted` 明文资产**——expert.service getDecryptedDocuments 与 web/bid-portal 文件链接的 URL 解析按 envelopeVersion 分派，新轨下发 decrypted assetId |
| 专家下载投标文件 | 同上（SUCCESS 门控） | 同上（改指 bid_decrypted，SUCCESS 门控复用） |
| C_inner 下载 | — | §5.2 成员规则；clientEncrypted=false 走原样字节输出分支 |

**归属链实现前提（§6 两列）**：FileAsset 无任何 project/supplier 关联，`canAccessFile` 的 staff/expert 规则靠 submission 四列 assetId（technical/business/coverLetter/bidBond）反查——C_inner/bid_decrypted 不在四列中，**必须经 `innerAssets`/`decryptedAssets` 两 Json 列解析归属**（canAccessFile 与 expert.service 下载 URL 解析各加一个反查分支），envelope 因已签名不可承载事后写入的 assetId。

### 5.5 解密失败归因（P1-2，含前置条件）

- `BidSupplier.dangerAttribution: String?`（`BIDDER` | `PLATFORM` | `UNKNOWN`）；
- **触发点（代码对账澄清）**：现有代码**不存在**「窗口关闭扫描」——`assertOpeningDone`（bid.service.ts:1424-1440）只检查不转换，现状靠主持人人工定性 DANGER（decryptAllSuppliers N15 注释）。新轨归因改为**惰性执行**：`assertOpeningDone` 入口处对「解密窗口已关 + 新轨 + decryptStatus=PENDING」的供应商逐家跑下表矩阵（幂等：已有归因不重算），随后照常做终局态检查——**UNKNOWN 非终局态，继续阻塞 completeOpening/startEvaluation 直至主持人裁决**（与守卫 409 附名单的既有语义咬合）；主持端开标大厅提供「待裁决」清单入口；
- **判定矩阵（新轨，逐供应商）**：

| outerDecryptedAt | packageFetchedAt | 解密上传 | 自动归因 | 法定后果 |
|---|---|---|---|---|
| null | — | — | **UNKNOWN**（管理方未启动该家解外层——可能是管理方/平台原因，也可能是刻意剔除；主持人裁决） | 裁决后定 |
| 有 | null | — | **UNKNOWN**（无法区分供应商未到场或取包故障；主持人裁决） | 裁决后定 |
| 有 | 有 | 未完成 | **BIDDER**（供应商已持有 C_inner+K_self，窗口内未完成） | **视为撤销** |
| — | — | 双闸失败 | DANGER + **UNKNOWN**（密文损坏/错钥/篡改不可自动区分；主持人裁决） | 裁决后定 |

- 主持人裁决：`POST .../opening/mark-platform-fault`（须填原因，写监督日志）→ `PLATFORM`（**视为撤回**）；其余 UNKNOWN 经裁决落 BIDDER/PLATFORM；旧轨沿用现行 DANGER/EXCEPTION 语义不自动归因；
- 通知文案按归因分流并**告知权利**：BIDDER →「因投标人原因未完成解密，视为撤销投标文件，保证金依招标文件规定处理」；PLATFORM →「因平台原因未完成解密，视为撤回投标文件，你有权要求责任方赔偿直接损失」（办法第31条）；
- 归因写入开标文件包与监督日志。

### 5.6 reseal / 补传

- **删除 reseal 明文分支**（bid.service.ts:2452-2500 段）；E2EE 重包裹分支仅对旧轨保留；
- 新轨 reseal → 400 引导走补传；补传 reupload 改造：供应商端重新双层加密上传（sha256 逐字节闸门不变，服务器只存 C_outer）。**唱标字段密封件不得变更（v6）**：新 envelope 的顶层 `fieldsCommit` 与 `sealedFields.fieldsSha256` 必须与投递时 `submission.envelope` 原值逐字相等——布局对齐 ukey 类型定义（`fieldsCommit` 在 envelope 顶层、`sealedFields` 为 `{cipher, kself, fieldsSha256}`），任一缺失或不符 → 400 `FIELDS_COMMIT_CHANGED` + 监督日志（防开标期借补传改价）；其余 files 条目保留、仅覆盖补传角色，整体重新签名。

### 5.7 解密后投标文件归档（P2-17）

- category=bid_decrypted 的 FileAsset（明文+sha256）为独立归档物；评标回流包 JSON 的 suppliers 段补 `decryptedFileSha256` 引用；完整归档清单补「解密后投标文件」项（哈希链既有 fileHashes 机制可纳入）；
- **新类目删除保护联动**：`bid_inner_ciphertext` / `bid_decrypted` / `bid_document`（新轨）一并纳入 P0-5 修复的删除引用保护清单（本 spec 上线时若 P0-5 未修，至少在 upload delete() 对这三类 category 加硬拒绝）。

## 6. 数据模型变更（migration 清单）

| 表 | 变更 |
|---|---|
| `SupplierCert` | 新表（§3.1） |
| `AdminEncryptionCert` | 新表（§3.2） |
| `SupplierBidSubmission` | +`envelope Json?`、+`envelopeVersion String?`、+`decryptedPrice String?`、+`outerDecryptedAt DateTime?`、+`packageFetchedAt DateTime?`、+`innerAssets Json?`（{role: assetId}，decrypt-outer 写）、+`decryptedAssets Json?`（{role: assetId}，decrypt-upload 写）——后两列是 §5.4a 权限反查的唯一归属链 |
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
| `DELETE /api/supplier-portal/profile/cert/:id` | supplier | 解绑/换证（REVOKED，附未开标依赖警示） |
| `GET /api/supplier-portal/bid-submissions/:projectId/opening-package` | supplier（成员） | 取 C_inner + K_self + 窗口状态（记 packageFetchedAt） |
| `POST /api/supplier-portal/bid-submissions/:projectId/decrypt-upload` | supplier（成员） | 解密明文 + F + nonce 上传（sha256/fieldsCommit 双闸） |
| `POST /api/bid/projects/:id/opening/decrypt-outer` | admin,bid_host | 管理方解外层（服务端，窗口门控） |
| `POST /api/bid/projects/:id/opening/mark-platform-fault` | admin,bid_host | 平台故障归因裁决（须填原因） |
| `POST /api/bid/admin-cert/generate` | admin | 服务端生成管理方 SM2 密钥对（keystore 落盘，公钥登记置 active） |
| `GET /api/bid/admin-cert` | admin | 查看当前管理方加密证书（公钥/certDn/active） |

### 变更/退役
- `submitBid`：未加密拒收 + 删除服务端代加密分支 + envelope 验签；
- `decrypt` / `decrypt-all`（bid.controller）：仅旧轨（envelopeVersion 分派；新轨 400 `USE_SUPPLIER_DECRYPT`）；
- `resealBidFiles`：删除明文分支；新轨 400；
- `reuploadBidFile`：新轨要求双层信封；
- `download`（upload.service）：+`bid_inner_ciphertext` 项目成员放行规则；+新轨 `bid_document`（C_outer）对 supplier 角色拒绝（§5.4a）；
- **下载 URL 解析分派**（expert.service getDecryptedDocuments、web/bid-portal 文件链接）：按 envelopeVersion——新轨 SUCCESS 后下发 `bid_decrypted` assetId，旧轨不变（§5.4a）；
- `assertOpeningDone`（bid.service）：入口增加新轨归因惰性执行（§5.5）。

## 8. 存量兼容与迁移

- **双轨分派**：`envelopeVersion === 'dual-v2'` → 新轨；null/旧值 → 旧轨（KMS 信封 + 主持人代解密），旧轨逻辑不改动；分派按 submission 级——过渡期同一项目混轨天然支持（各供应商按各自提交版本走各自解密路径）；
- **存量明文清理**：新脚本 `scripts/clean-legacy-plaintext.ts`（tsx）：dry-run 列出「`encrypted=true && clientEncrypted=false` 且被 submitted 提交引用」的 FileAsset → 执行删除 MinIO 明文对象（asset.key），sealedPath 密文保留；未提交草稿明文不动（提交时被拒，供应商重新加密上传）；
- **演示快照**：不重拍；`scripts/demo-decrypt-project.js` 仅当涉及新轨演示时适配（旧轨演示路径不动）；
- **KMS_SECRET**：继续保留（旧轨 + DB 字段密封）；新轨不再使用。

## 9. 前端改造清单

| 门户 | 改动 |
|---|---|
| supplier-portal | +sm-crypto 依赖；+`@water-erp/ukey` 适配层接入；profile 证书绑定页（枚举/绑定/换证含旧证书依赖警示/U盾导出导入）；BidSubmit.vue 双层加密+envelope 签名（nonce 本地保存提示）；OpeningHall.vue「解密我的投标」卡片；保证金凭证加密上传；**本人报价回显改口径**（新轨服务端无明文 bidPrice——getMySubmissions 旧轨 openField 回显对新轨返回空，列表价格改显示「已密封·开标时揭示」或本地缓存值） |
| bid-portal | 无 U盾适配层（管理方解密在服务端）；管理方证书生成按钮（admin 可见）；开标大厅「解外层」步骤与进度（触发服务端解密）；reseal 按钮退役（旧轨保留）；UNKNOWN 归因裁决 UI（含平台故障标记） |
| web (:3005) | 无改动（开标确认面板不涉解密执行） |
| expert-portal | 无改动（解密后文件下载走现有权限链） |

## 10. 测试策略

- **共享包单测**（@water-erp/ukey）：canonicalEnvelopeHash 确定性（键序/嵌套/缺失角色）、computeFieldsCommit、**golden vector**（固定输入→固定哈希+签名验证对，前后端一致性锚点）、MockUKeyAdapter sign/decrypt/证书枚举 roundtrip、口令加密存储、导出导入往返（含 DEK_S+nonce）；
- **API 单测**：submitBid 未加密拒收（BID_FILE_NOT_ENCRYPTED）、envelope 缺失字段校验（含 adminCertId）、**白名单不剥离**（submit 与 draft 两路径 envelope/envelopeVersion 落库）、验签失败 400、fieldsCommit 双闸（正/篡改 F/篡改 nonce/重放 nonce）、decrypt-outer 窗口门控、admin-cert/generate keystore 落盘/幂等/**轮转后旧 adminCertId 仍可解**、decrypt-upload sha256 不匹配拒绝、**decrypt-upload 并发抢占**（双跑只成一笔/60s 接管）、**开标记录预填**（解密成功后 BidOpeningRecord 自动 upsert 且字段=F）、**归因判定矩阵**（§5.5 四行全覆盖 + 惰性触发在 assertOpeningDone 内幂等）、**归属链与下载分派**（新轨 supplier 取 C_outer 400 / staff·专家 SUCCESS 后经 decryptedAssets 拿 bid_decrypted / C_inner 经 innerAssets 成员放行非成员 403）、**split 模式首文件入信封**（normalizeBidFileAssets 契约对齐）、**密封核验**（opening-package 的 ciphertextSha256 与存储一致）、cert 绑定 DN 校验、旧轨 decrypt 回归不破；
- **供应商前端**：`npx vue-tsc --noEmit`（不可用则 build）；**bid-portal**：`npx tsc --noEmit`；
- **端到端冒烟**（手工脚本）：mock U盾 → 绑定证书 → 投递（双层+承诺）→ 开标 → 管理方解外层 → 供应商解内层（含 F+nonce 揭示）→ 唱标比对 → 归档含解密后投标文件；另验「解外层未跑时窗口关闭→UNKNOWN 裁决」路径。

## 11. 分阶段落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| Phase 1 基座 | @water-erp/ukey 包（接口+Mock+骨架+规范化纯函数+golden vector）、SupplierCert/AdminEncryptionCert 迁移、证书绑定/登记端点、keystore+bootstrap、管理方公钥公开端点 | 单测 + tsc |
| Phase 2 投递 | BidSubmit 双层加密+envelope 签名+fieldsCommit、submitBid 重构（拒收+验签+envelope）、BidFileBackup v2、补传改造 | API 单测 + vue-tsc |
| Phase 3 开标 | decrypt-outer/opening-package/decrypt-upload（含并发抢占+唱标记录预填）/mark-platform-fault、归因矩阵（assertOpeningDone 惰性触发）、唱标衔接、**下载链路分派切换（§5.4a 四场景）**、reseal 退役、解密后归档物、C_inner 下载规则 | API 单测 + tsc + 冒烟 |
| Phase 4 清理 | clean-legacy-plaintext.ts（dry-run→执行）、旧轨回归、演示验证 | 全量单测 + 手动验证 |

## 12. 风险与开放问题

1. **纯 JS SM4 性能（浏览器+服务端双侧）**：sm-crypto 无硬件加速，浏览器侧 50MB 双层加密预计秒级~十秒级（上传 UX 需进度反馈，预留 WebWorker 优化位）；**服务端 sm-crypto 无流式 API**——decrypt-outer 全量缓冲解密，批量逐家串行防内存堆积（10 家×50MB 峰值受控）。
2. **canonicalization 前后端漂移**：以共享包单一实现 + golden vector 测试锁死；spec 层面禁止两端各自拼 JSON。
3. **U盾丢失**（v5 后收窄）：mock U盾导出文件仅含证书私钥（F+nonce 在 sealedFields 内、开标时用证书解封）——U盾丢失=无法解内层/揭示字段，与实体 U盾丢失同语义（挂失换证也无法恢复已提交标书），UI 醒目提醒导出备份；本地 localStorage 清空**不再**造成任何死锁。
4. **管理方私钥的服务器保护**（形态 B）：keystore 目录 env 配置、权限 700/600、gitignore；文件系统失陷=外层私钥失陷——但外层解封后仍被供应商内层保护，内容不泄露；风险转化为「开标程序控制权」层面，由角色+窗口+双日志（OperationLog/监督日志）约束。生产迁移加密机/HSM 时仅替换「私钥读写」模块。
5. **Mock 与真 U盾的协议差异 + 法律效力边界**：VendorUKeyAdapter 具体协议依赖厂商 SDK，属隔离面，不阻塞 Phase 1-4；DER/PEM 编码转换在 VendorUKeyAdapter 内消化，Mock 全 hex。**诚实声明：MockUKeyAdapter 为自签名密钥对（非 CA 机构颁发证书），其签名/解密仅具备开发与演示功能，不构成《电子签名法》第13条意义上可对外主张的「可靠电子签名」——生产合规必须切换 VendorUKeyAdapter + 真实 CA 证书；演示材料中涉及「U盾签名」表述须标注 mock 出处。**
6. **多轮报价扩展**（§4.4）：本轮不实现，BidQuote 处留 TODO 引用——多轮项目投递密封字段走本 spec，逐轮报价维持现状至轮次功能迭代。
7. **旧轨解密异常演示脚本**：demo-decrypt-project.js 与新轨关系待 Phase 3 验证后确认是否适配。
