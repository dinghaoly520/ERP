# 未解密投标文件备份（sealed-bid-backup）设计文档

- 日期：2026-07-22
- 状态：待评审 → 待实现
- 范围：`apps/api`（NestJS + Prisma + MinIO）

---

## 1. 背景与目标

供应商提交投标文件后，平台对文件做信封加密（AES-256-GCM per-asset DEK，DEK 由 `KMS_SECRET` 派生的 KEK 包裹）。开标时才在内存中解密。

**问题**：事后供应商可能"扯皮"——否认提交、声称开标内容非其提交、声称文件被平台篡改。目前平台缺少一份"提交时刻即固化、不可篡改"的原始凭证来一键自证。

**目标**：供应商提交投标文件后，服务器**立即备份一份仍处于未解密（加密）状态的投标文件副本**，用于后续争议核验。

**硬约束（用户明确要求）**：
- **不干扰现有流程**——现有封标 / 开标解密 / 文件下载逻辑零行为变更，且整个功能可用 feature flag 一键关停回到现状。
- **备份保持未解密态**——平台不持有可读明文，不在开标前解密或提取内容。

---

## 2. 合法性结论

**核心判断：备份"加密态（未解密）"投标文件合法合规，且是平台法定"签收保存"义务的延伸；真正违法的是备份/留存"已解密明文"或在开标前访问内容。**

| 风险点 | 依据 | 对"加密备份"的结论 |
|---|---|---|
| 平台有"签收保存"义务 | 《招标投标法》第28条：收到投标文件后"应当签收保存，**不得开启**" | ✅ 加密副本即"保存"；平台无解密密钥、无法读取内容 → 不构成"开启" |
| 开标前开启=串通投标 | 《招标投标法实施条例》第41条第(一)项：开标前**开启**投标文件并泄露信息 = 串通投标 | ✅ 关键在"开启/读取内容"。密文备份平台自身解不开，不触碰红线 |
| 电子标保存义务 + 开标前不得解密提取 | 《电子招标投标办法》(发改委等八部委20号令,2013)：交易平台应"**妥善保存**"投标文件；投标截止前任何单位和个人"**不得解密、提取**"；未加密应拒收、即时发确认回执 | ✅ 备份密文 = 履行"妥善保存"；开标前不解密/提取即合规 |
| 数据电文书面/原件/保存 | 《电子签名法》第4/5/6条（可随时调取查用、内容完整、来源可追溯） | ✅ 加密备份满足"可调取、完整、可追溯"即具保存效力 |
| 争议证据证明力 | 《民事诉讼证据规定》(2019修正)第93/94条 + 《互联网法院审理案件规定》第11条：**哈希校验、可信时间戳、区块链**等手段固定、由**中立第三方平台**保存 / 以**档案管理方式**保管的电子数据可推定真实 | ✅ "加密备份 + 哈希 + 时间戳 + 留痕"作为争议证据的法律基础 |
| 保存期限（要求长期留存） | DA/T 103-2024《招标投标电子文件归档规范》(2025-02-01实施)：永久/30年/10年，平台至少3年；《招标人主体责任履行指引》≥15年；《政府采购法》≥15年 | ✅ 长期留存是义务而非负担 |

**合规红线（实现必须守住）**：
1. 绝不在开标前解密或访问备份内容；备份只存密文，不额外持久化明文 DEK。
2. 严格访问控制 + 全程审计留痕（谁能调取、何时、为何、结论）。
3. 完整性自证：存 `sha256(密文)` + 时间戳，否则争议时证据力不足。
4. 供应商知情：投标须知 / 平台服务协议告知"系统将留存加密投标文件用于争议核验"（文档层面）。
5. 留存期限对齐档案要求（默认不自动清理）。

> ⚠️ 本文件为系统设计参考的合规分析，非正式法律意见。涉及政府采购或特定行业监管时，落地前建议法务/律师对"告知条款"与"留存期限"确认一次。

**来源**：
- 招标投标法实施条例（发改委）https://www.ndrc.gov.cn/xxgk/zcfb/qt/201511/t20151103_967423.html
- 招标投标法（商务部政策库）https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=63629
- 电子招标投标办法（司法部）https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/201305/t20130530_374184.html
- 民事诉讼证据规定（最高法）https://ipc.court.gov.cn/zh-cn/news/view-393.html
- DA/T 103-2024（国家档案局）https://www.saac.gov.cn/daj/hybz/202410/435bd7916aa84dbe813531046587aca0.shtml

---

## 3. 决策记录（与用户确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 证据强度 | **内部自证级**（密文字节副本 + `sha256(密文)` + 提交时间戳/回执号 + 审计留痕 + 独立备份前缀） | 系统内可自证"提交即固化、未被篡改"，足够日常扯皮；无外部依赖 |
| 备份失败策略 | **尽力而为 + 后台补备** | 不阻断提交；后台 `@Cron` 扫描补齐缺失，最终一致 |
| 核验能力 | **核验 API**（监督端/管理端只读，三方哈希比对） | 一键出证，无需前端页面 |
| 备份自包含 | **存 wrapped DEK**（仍 KMS 包裹，非明文）+ 加密版本元数据 | 备份为独立可解密证据包，不依赖业务行是否还在，适合多年后单独移交 |
| 长期密钥托管 | **写入 spec 作为前置要求**（见 §8） | 5 年后可解密的前提 |

---

## 4. 总体架构与数据流

```
供应商提交 POST /api/supplier-portal/bid-submissions/:projectId/submit
        │
        ▼
SupplierPortalService.submitBid()  ── 封标循环（每个 asset）──
        │   encryptBuffer(明文) → ciphertext(内存) + decryptKey(DEK)
        │   sealedKeys[assetId] = wrapKey(DEK, KMS_SECRET)
        │   putObject(sealedPath, ciphertext)                 ← 现有，不改
        │   ┌── 新增（best-effort，try/catch 不抛）────────────┐
        │   │ backupKey = sealed-backup/{pid}/{sid}/{role}/{file}.enc
        │   │ putObject(backupKey, ciphertext)   ← 复用同一内存 buffer，零额外下载
        │   │ ciphertextSha256 = sha256(ciphertext)
        │   └──────────────────────────────────────────────┘
        │   $transaction:
        │     - 现有：fileAsset.update + supplierBidSubmission.upsert + bidSupplier.upsert
        │     - 新增：bidFileBackup.upsert（仅对备份成功的 asset；@@unique 幂等）
        ▼
开标解密（现有，不改）：bid.service.ts decryptSupplier() 纯内存读 sealedPath 解密，
        MinIO 密文对象永不被覆盖 → 备份与 sealedPath 永远字节一致。

后台补备 @Cron（新增）：扫描已提交但缺备份的 submission → 从 sealedPath 读密文补齐。

核验 API（新增）：GET /api/bid/projects/:id/backup-verify/:supplierId
        三方哈希比对，只返回哈希与布尔结论，绝不返回内容。
```

**为什么备份永远有效**：开标解密是纯内存操作，密文对象不被改写；`sha256` 对密文永久有效。核验**不依赖解密密钥**，即使多年后密钥遗失，"开标内容 == 提交内容"仍可证明。

---

## 5. 数据模型（新增 `BidFileBackup`）

```prisma
model BidFileBackup {
  id               String   @id @default(cuid())
  projectId        String
  supplierId       String
  fileAssetId      String                 // 对应 FileAsset.id
  fileRole         String                 // 'technical' | 'business' | 'coverLetter'

  // 存储
  backupKey        String   @unique       // MinIO: sealed-backup/{pid}/{sid}/{role}/{file}.enc
  sealedPath       String                 // 本备份所镜像的 sealed 对象键（= FileAsset.sealedPath），核验时直接读取，自带溯源
  size             Int

  // 自包含证据包：解密所需的一切（仍为密文，需 KMS_SECRET）
  wrappedDek       String                 // = wrapKey(DEK, KMS_SECRET)，与 SupplierBidSubmission.*SealedKey 同值
  cryptoVersion    String   @default("envelope-v1")  // AES-256-GCM + wrapKey(salt water-erp-envelope-salt-v1)
  ciphertextSha256 String                 // sha256(密文) — 完整性自证锚点
  plaintextSha256  String?                // 复用 FileAsset.sha256（明文哈希），便于关联现有 verifyIntegrity

  // 证据元数据
  receiptNo        String?                // 回执号 TB-yyyymmdd-NNN
  backupSource     String   @default("submission")  // 'submission' | 'reconcile'
  submittedAt      DateTime               // = SupplierBidSubmission.submittedAt
  createdAt        DateTime @default(now())

  @@unique([supplierId, projectId, fileRole])   // 幂等：每次有效提交每角色一份
  @@index([projectId, supplierId])
}
```

说明：
- `@@unique` + `upsert` 保证重提交时备份更新为**最终有效提交**的密文/wrappedDek/哈希（与 `sealedPath` 被更新保持一致）；撤回不删除备份（争议恰恰需要原始凭证）。
- `cryptoVersion` 使备份自描述，5 年后解密者据此选择算法/盐值；`isWrappedKey` 已能区分 wrapped 与 legacy 格式。
- `wrappedDek` 是 KMS 包裹后的密文，无 `KMS_SECRET` 无法解出 DEK，故多存一份的安全成本极低。

**迁移注意**（遵循项目 memory `main-db-migration-drift`）：禁止交互式 `prisma migrate dev`（会 reset 丢数据）。采用 `migrate dev --create-only` → `prisma db execute` → `migrate resolve --applied`，或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`。

---

## 6. 备份写入逻辑（submitBid hook，best-effort）

位置：`apps/api/src/supplier-portal/supplier-portal.service.ts` 封标循环内，`putObject(sealedPath, ciphertext)` 之后（约 :481-485）。

- 复用内存中的 `ciphertext`（零额外 MinIO 读）。
- `backupKey = `sealed-backup/${projectId}/${supplierId}/${role}/${basename}``，`basename` 取 `sealedPath` 的末段（与现有 sealed 命名保持一致）。
- 记录 `sealedPath`（本次封标写入的对象键）到备份行，供核验直接读取。
- `ciphertextSha256 = createHash('sha256').update(ciphertext).digest('hex')`
- `putObject(MINIO_BUCKET, backupKey, ciphertext, ...)` 包在 try/catch：
  - 成功 → 记录到待 upsert 列表；并把 `backupKey` 加入现有 `newlySealedPaths`，保留失败回滚清理语义。
  - 失败 → 仅 `logger.warn` + 审计一条"备份失败待补备"，**不抛出、不阻断提交**。
- 在随后的 `$transaction` 内对备份成功的 asset 执行 `bidFileBackup.upsert`（`@@unique` 幂等）。
- 仅处理会被封标的 3 个 asset（technical/business/coverLetter）；`bidBond`（不加密）不在范围内。

---

## 7. 后台补备任务（@Cron reconcile，新增）

新文件 `apps/api/src/supplier-portal/backup-reconcile.service.ts`，使用 `@nestjs/schedule` 的 `@Cron`（与现有 OPERATION_LOG 保留期清理 cron 同模式）。默认每 15 分钟（可配）。

逻辑：
1. 查 `SupplierBidSubmission` where `status='submitted'`，其 sealed 资产（`FileAsset.encrypted=true` / 有 `sealedPath`）缺对应 `BidFileBackup`（按 `[supplierId,projectId,fileRole]` 反 join）。
2. 对每条缺失：读 `FileAsset.sealedPath` → `getObject` → buffer → `sha256` → `putObject(backupKey)` → `bidFileBackup.upsert({ backupSource:'reconcile', sealedPath: FileAsset.sealedPath, wrappedDek: submission.*SealedKey, ... })`。
   - 密文来自 `sealedPath`（与提交时写入同一对象），字节一致；仍只碰密文，不解密。
3. 幂等：`@@unique` + catch `P2002`；批量限流避免 MinIO 压力；记日志与审计。
4. 跳过 legacy 未封标提交（无 sealedPath，属明文，不在范围）。

---

## 8. 5 年后如何解密 & 长期密钥托管

### 8.1 解密机制（与开标解密同一套，备份不增加新能力）
```
unwrapKey(backup.wrappedDek, KMS_SECRET)  →  DEK("keyHex:ivHex:tagHex")
decryptBuffer(getObject(backup.backupKey), DEK)  →  明文
```
- 备份是自包含证据包：`backupKey`(密文) + `wrappedDek` + `cryptoVersion` 即完整可解密单元，不依赖 `SupplierBidSubmission` 行是否还在。
- **核验用途永不需要解密**（`sha256` 比对密文即可）；解密仅在需出示内容时（如法院要求）才发生，且与原始 sealed 文件解密能力完全等价。

### 8.2 长期密钥托管（前置要求，非本次全部代码实现）
整个信封加密的命门是 `KMS_SECRET`（`wrapKey` 用 `sha256('water-erp-envelope-salt-v1' + KMS_SECRET)` 派生 KEK）。算法（AES-256-GCM / SHA-256）在 5 年尺度不会被攻破；**真正风险是密钥托管**。要求：

1. **KMS_SECRET 离线安全备份/密钥托管**：多副本，与档案同寿命（≥15 年）。丢失 → 所有 sealed 文件 + 备份永久不可解密（全系统既有风险，备份继承之）。
2. **密钥轮换版本化**：轮换后保留旧版本密钥，能按 wrapped blob 对应版本解；`cryptoVersion` 字段承载版本信息。
3. **年度解密演练（key-recovery drill）**：随机抽一份历史 sealed/备份文件试解，验证密钥与流程可用。
4. **加密格式/算法版本留存**：`isWrappedKey` 已自描述 wrapped vs legacy；源码/盐值/算法版本随系统归档。

> 说明：§8.2 为运营/前置要求，写入 spec 以提示长期可解密性的依赖；本次实现聚焦备份功能本身（§5-§7、§9），密钥托管的自动化（如密钥版本管理）可后续立项。

---

## 9. 核验 API（只读，三方哈希比对）

位置：`apps/api/src/bid/bid.controller.ts` 新增只读端点，`@Roles('admin','bid_host')`（监督端/归档端角色），复用全局 `AuthGuard`/`RolesGuard`，全程审计留痕。

```
GET /api/bid/projects/:id/backup-verify/:supplierId
```
逻辑（对该 supplier 每个 fileRole 的 `BidFileBackup`）：
1. **备份自证**：`sha256(getObject(backupKey))` vs 入库 `ciphertextSha256` → `backupIntact`（备份自身是否被篡改）。
2. **开标一致性（杀手锏）**：`sha256(getObject(backup.sealedPath))` vs 备份密文 `sha256` → `sealedMatchesBackup`（开标读取的密文 == 提交时备份的密文 → 开标内容 == 提交内容）。
3. **（可选，已解密 SUCCESS 时）** 复用现有 `verifyIntegrity`：明文 vs `FileAsset.sha256`。

返回（**只含哈希与布尔结论，绝不含密文/明文内容**）：
```json
{
  "projectId": "...", "supplierId": "...", "receiptNo": "...",
  "perFile": [
    { "fileRole": "technical", "backupIntact": true, "sealedMatchesBackup": true,
      "backupSha256": "...", "sealedSha256": "...", "recordedSha256": "...",
      "submittedAt": "...", "backupSource": "submission" }
  ],
  "overall": "consistent" | "tampered" | "missing"
}
```
- 缺备份（尚未补备）→ 该文件 `missing`，`overall` 相应降级。
- 每次核验写审计日志（谁、何时、对哪个项目/供应商、结论）。

---

## 10. 合规与安全护栏

- **永不解密/提取内容**：备份与核验全程只操作密文与哈希；`wrappedDek` 为 KMS 包裹密文，非明文。
- **访问隔离**：`backupKey` 不在 `FileAsset.key` 中 → 公开下载接口（`UploadService.streamFile`，需 `decryptStatus` 门控）天然不可达；现有撤回/删除路径不触碰 `sealed-backup/` 前缀。
- **最小权限**：核验 API 仅 `admin`/`bid_host`；操作进审计。
- **留存**：默认不自动清理，对齐档案要求；后续可接 DA/T 103-2024 归档。
- **告知**：投标须知/平台协议补充留存告知条款（文档，非代码）。✅ 已落实，建议措辞：
  > 为保障招投标活动的真实性与可追溯性，平台将在供应商提交投标文件后，对**加密状态**的投标文件进行留存备份。该备份仅为加密密文，平台在开标前不会解密或提取其内容；留存数据用于开标核验及争议处理，留存期限不少于相关法规要求的招投标文件保存年限。
  > 具体措辞请业务/法务最终定稿。

---

## 11. Feature Flag 与回滚

- 环境变量 `BID_BACKUP_ENABLED`（默认 `true`）。
  - `false` → submitBid 跳过备份写入、reconcile cron 不执行、核验 API 返回"功能未启用"。系统行为与现状完全一致。
- 新增内容均为**追加式**（新 model / 新 MinIO 前缀 / 新 endpoint / 新 cron），不修改现有封标、解密、下载逻辑分支。
- 回滚：关 flag 即停用；如需彻底移除，删除新增 model/服务/端点与 `sealed-backup/` 对象即可，不影响既有数据。

---

## 12. 范围与默认（YAGNI）

- **在范围**：3 个封标资产（technical/business/coverLetter）的加密备份 + 自包含 wrapped DEK + 哈希 + 后台补备 + 核验 API + feature flag。
- **不在范围（本次不做）**：
  - `bidBond`（不加密，不属"未解密备份"）；如需可另议。
  - 备份版本历史（重提交按 `@@unique` upsert 为最终有效提交；历史版本留作后续可选）。
  - 前端核验页面（仅 API）。
  - 外部存证（区块链/可信时间戳/公证）——证据强度定位为内部自证级。
  - KMS 密钥版本管理/自动轮换的自动化（§8.2 列为前置运营要求）。

---

## 13. 测试策略

单元：
- `sha256(ciphertext)` 计算、`backupKey` 生成、`cryptoVersion` 写入。
- 备份 `putObject` 失败时 submitBid **不抛、不回滚提交**，且记审计。

集成 / E2E（复用现有 seed + cookie auth 模式，参考 `apps/api/test/bid` / `supplier`）：
- 提交后存在 `BidFileBackup` 行，且 `sha256(getObject(backupKey)) == ciphertextSha256`，`wrappedDek == submission.*SealedKey`。
- 人为让备份写入失败 → 提交仍成功 → reconcile 任务运行后补齐（`backupSource='reconcile'`），且哈希一致。
- 重提交 → 备份 upsert 为新密文/哈希/wrappedDek。
- 核验 API：正常 → `overall='consistent'`；篡改 `sealed-backup/` 对象后 → `tampered`；缺备份 → `missing`。
- `BID_BACKUP_ENABLED=false` → 无备份行、核验 API 返回未启用、提交不受影响。
- 权限：非 `admin`/`bid_host` 调用核验 API → 403。

---

## 14. 受影响文件（预估）

- `apps/api/prisma/schema.prisma` — 新增 `BidFileBackup` model（+迁移）。
- `apps/api/src/supplier-portal/supplier-portal.service.ts` — submitBid 封标循环追加 best-effort 备份写入。
- `apps/api/src/supplier-portal/backup-reconcile.service.ts` — 新增 @Cron 补备服务。
- `apps/api/src/supplier-portal/supplier-portal.module.ts` — 注册新服务、ScheduleModule。
- `apps/api/src/bid/bid.controller.ts` / `bid.service.ts` — 新增核验只读端点与三方哈希比对。
- `apps/api/.env` — `BID_BACKUP_ENABLED`。
- 文档：投标须知/平台协议留存告知条款（文档层面，非代码）。
