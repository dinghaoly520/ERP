# 蜀水云采 ERP — 投标文件加密与安全架构

> 生成日期：2026-07-29 | 基于 `water-erp/apps/api/src` 源码分析

## 目录

1. [总体架构：三层密钥体系](#一总体架构三层密钥体系)
2. [供应商投递时的加密措施](#二供应商投递时的加密措施)
3. [开标管理员解密流程](#三开标管理员解密流程)
4. [服务器备份与有效性保证](#四服务器备份与有效性保证)
5. [安全模型总结](#五安全模型总结)
6. [关键源文件索引](#六关键源文件索引)

---

## 一、总体架构：三层密钥体系

系统采用 **信封加密（Envelope Encryption）** 为核心的三层密钥模型，所有密钥派生自同一个环境变量 `KMS_SECRET`（永不落库，仅存于服务器 `.env`）：

```
KMS_SECRET（环境变量，永不入库）
    │
    ├── SHA-256("water-erp-field-seal-v1" + KMS_SECRET)
    │       → KEK 字段级加密（field-crypto.ts）—— 加密投标报价等短字段
    │
    └── SHA-256("water-erp-envelope-salt-v1" + KMS_SECRET)
            → KEK 信封加密（envelope-crypto.ts）—— 包装文件解密密钥
```

### 为什么分两层？

文件加密使用随机生成的 AES-256-GCM 数据密钥（DEK），这个 DEK 原本以明文 hex 存在数据库里——数据库一旦泄露，所有文件都暴露。引入信封加密后，DEK 入库前先被 KMS 派生密钥包裹（wrap）成 base64 密文块。攻击者即便拿到数据库也解不开文件。

### 核心加密原语

| 模块 | 文件 | 算法 | 用途 |
|------|------|------|------|
| 信封加密 | `common/crypto/envelope-crypto.ts` | AES-256-GCM | wrapKey / unwrapKey — 用 KMS 派生 KEK 包裹文件 DEK |
| 文件加解密 | `announcement/bid-document.crypto.ts` | AES-256-GCM | encryptBuffer / decryptBuffer — 随机 DEK 对文件对称加密 |
| 字段级加密 | `common/crypto/field-crypto.ts` | AES-256-GCM | sealField / openField — 加密投标报价等短字段 |
| 解密结果分类 | `bid/bid-submission.crypto.ts` | SHA-256 | verifyIntegrity + classifyDecryptOutcome → SUCCESS/DANGER |

---

## 二、供应商投递时的加密措施

供应商提交投标文件时，`supplier-portal.service.ts` 的 `submitBid` 方法执行以下安全步骤：

### 2.1 文件层面 — AES-256-GCM 对称加密

```
供应商上传的明文文件（MinIO 原始路径）
    │
    ├── encryptBuffer(plaintext)
    │       → 随机生成 32 字节 AES-256-GCM 密钥 + 12 字节 IV
    │       → 输出 { ciphertext, decryptKey: "key:iv:authTag" }
    │
    ├── 密文写入 MinIO 新路径：sealed/{projectId}/{supplierId}/{filename}.enc
    │       （原始明文路径保留不动，永不删除）
    │
    └── wrapKey(decryptKey, KMS_SECRET) → base64 密文块
            → 存入 SupplierBidSubmission.technicalSealedKey
            → 存入 SupplierBidSubmission.businessSealedKey
            → 存入 SupplierBidSubmission.coverLetterSealedKey
```

**每个文件使用独立的随机 DEK**，不是用同一个密钥加密所有文件。

### 2.2 报价字段 — 字段级加密

```typescript
// supplier-portal.service.ts — pickBidSubmissionFields() (line 50)
bidPrice: data.bidPrice ? sealField(data.bidPrice, process.env.KMS_SECRET!) : null,
// 输出格式: "v1:" + base64(iv[12] + authTag[16] + ciphertext)
```

报价在**写入数据库前**就已经被加密，`SupplierBidSubmission.bidPrice` 字段存储的是 `v1:...` 格式的密文。只有开标解密成功后，前端才能看到解密后的报价（`announcement.service.ts:411` 有门控）。

### 2.3 完整性校验 — SHA-256 指纹

文件上传时即计算 `FileAsset.sha256`（`upload.service.ts`），解密时会比对：

```typescript
// bid-submission.crypto.ts
verifyIntegrity(plaintext, storedSha256)
// → null（无历史哈希，legacy 跳过）
// → true（匹配）
// → false（篡改 → classifyDecryptOutcome 返回 DANGER）
```

### 2.4 抗抵赖 — SM2 国密签名（架构就绪）

`SupplierBidSubmission` 模型包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fileHash` | String | 投标文件哈希 |
| `signature` | String | SM2 数字签名 |
| `signedAt` | DateTime | 签名时间 |

后端验证逻辑已在 `supplier-portal.service.ts` 中预留，前端待实现。

### 2.5 加密流程的事务保护

```typescript
// supplier-portal.service.ts — submitBid()
// 事务内原子完成：
// ① FileAsset 标记 encrypted=true, sealedPath
// ② SupplierBidSubmission 写入 sealedKey + 加密报价
// ③ BidSupplier 更新 submitStatus, encryptStatus
// ④ BidFileBackup 持久化备份记录
// 事务失败 → MinIO sealedPath 清理回滚
```

---

## 三、开标管理员解密流程

`bid.service.ts` 的 `decryptSupplier` 方法（line 1248）实现解密：

### 3.1 解密前置闸门（四重校验）

`decryptSupplier` 内依次执行以下门控，全部失败返回 `BadRequestException`（HTTP 400）：

| 闸门 | 校验 | 失败返回 |
|------|------|---------|
| 阶段门控 | `project.stage === 'OPENING'` | 400 BadRequest（code: `PROJECT_NOT_OPENING`） |
| 时间窗口 | `decryptWindowStart ≤ now ≤ decryptWindowEnd` | 400 BadRequest |
| 幂等保护 | `decryptStatus !== 'SUCCESS'` | 400 BadRequest（code: `ALREADY_DECRYPTED`） |
| 暂停检查 | `!session.pausedAt` | 400 BadRequest（code: `OPENING_PAUSED`） |

> **注意**：`decryptSupplier` **不**校验供应商 `submitStatus`。撤回/退出过滤仅在 `decryptAllSuppliers`（line 1226）的批量遍历查询中生效（`submitStatus: { not: '已撤回' }`），不在 per-supplier 解密方法内。

### 3.2 解密执行（逐文件）

```
SupplierBidSubmission.*SealedKey（base64 密文块，来自数据库）
    │
    ├── isWrappedKey(blob) 检测格式
    │       → 是 base64 → unwrapKey(blob, KMS_SECRET) → 原始 DEK 字符串
    │       → 是 legacy 明文 hex → 直接使用（向后兼容旧数据）
    │
    ├── MinIO 读取密文（sealedPath）
    │       → decryptBuffer(ciphertext, rawDEK) → 明文 Buffer
    │
    └── verifyIntegrity(plaintext, FileAsset.sha256)
            → SHA-256 比对
            → classifyDecryptOutcome → "SUCCESS" 或 "DANGER"
```

### 3.3 DANGER（异常）态处理

如果 sealedKey 存在但解密失败、或完整性校验不通过：

- `decryptStatus` → `DANGER`
- `confirmStatus` → `EXCEPTION`
- 系统记录 `BidSupervisionLog` 日志（**不**创建 `BidOpeningRecord`；开标记录仅在 SUCCESS 且提供了唱标信息时创建）
- 发送通知给相关人员

### 3.4 一键解密

```typescript
// bid.service.ts — decryptAllSuppliers (line 1218)
// 查询条件：decryptStatus IN ('PENDING', 'DANGER') AND submitStatus != '已撤回'
// 逐个调用 decryptSupplier
```

### 3.5 KMS_SECRET 安全保证

| 防护措施 | 说明 |
|---------|------|
| 永不落库 | KMS_SECRET 仅存在于服务器 `.env` 文件和进程内存中 |
| 启动校验 | 加密操作时若为空直接抛错 `KMS_SECRET is not configured` |
| 访问控制 | 解密端点受 `AuthGuard` + `RolesGuard` 双重保护。`BidController` 类级别 `@Roles('admin','bid_host','leader','staff')`；仅 `resealBidFiles` 额外限制为 `@Roles('admin','bid_host')` |
| 时间窗口 | 解密仅在 `decryptWindowStart ~ decryptWindowEnd` 内可用 |
| 密钥轮转 | `resealBidFiles` 方法允许用新 KMS_SECRET 重新包裹所有 DEK |
| 格式兼容 | `isWrappedKey()` 可区分新旧格式，平滑迁移 |

---

## 四、服务器备份与有效性保证

### 4.1 多层数据冗余

| 存储层 | 内容 | MinIO 路径 | 删除策略 |
|--------|------|-----------|---------|
| **原始明文上传** | 供应商上传的原始文件 | `uploads/` | **永不删除** |
| **密封密文** | 加密后的投标文件 | `sealed/{pid}/{sid}/...` | 事务回滚时清理 |
| **证据备份包** | 自包含加密证据 | `sealed-backup/{pid}/{sid}/...` | 长期保留 |
| **重加密副本** | 密钥轮转产物 | `reseal/{pid}/{sid}/...` | 覆盖更新 |
| **移交档案包** | 开标完成后的 JSON 档案 | `bid-opening-handover/{pid}.json` | 长期保留 |
| **数据库记录** | FileAsset + Submission + Backup | PostgreSQL | 按业务规则 |

**原始明文永远不会被删除**——加密时写新的 `sealedPath`，原 `key` 路径的明文保留。这确保了即使加密链路出现灾难性故障，仍可从原始文件恢复。

### 4.2 BidFileBackup — 自包含加密证据包

`BidFileBackup` 是专门为争议解决设计的独立证据单元，每条记录就是一个**自包含的加密证据包**：

| 字段 | 内容 | 作用 |
|------|------|------|
| `backupKey` | MinIO 存储路径 | 证据包的物理位置 |
| `sealedPath` | 密文对象 key | 指向加密文件 |
| `wrappedDek` | KMS 包裹的 DEK | 持有 KMS_SECRET 即可解密 |
| `ciphertextSha256` | 密文的 SHA-256 | **密文完整性自证**——密文未被替换 |
| `plaintextSha256` | 原文的 SHA-256 | 解密后比对——明文未被篡改 |
| `cryptoVersion` | `"envelope-v1"` | 加密方案版本，向前兼容 |

**自证有效性闭环：**

```
BidFileBackup 证据包
    → unwrapKey(wrappedDek, KMS_SECRET) → 原始 DEK
    → MinIO 读取密文（backupKey）
    → SHA-256(密文) 比对 ciphertextSha256 ✓（密文未被替换）
    → decryptBuffer(密文, DEK) → 明文
    → SHA-256(明文) 比对 plaintextSha256 ✓（内容未被篡改）
    → 结果可信，不依赖数据库任何其他记录
```

### 4.3 移交档案包（Handover Package）

开标完成后，`completeOpening` 方法（`bid.service.ts:516`）生成完整档案：

```json
{
  "packageType": "BID_OPENING_HANDOVER",
  "packageVersion": 1,
  "generatedAt": "2026-07-29T...",
  "project": {
    "id": "项目ID",
    "code": "项目编号",
    "name": "项目名称",
    "procurementMethod": "采购方式",
    "openTime": "...",
    "deadline": "..."
  },
  "session": {
    "host": "主持人",
    "supervisor": "监督人",
    "decryptWindowStart": "...",
    "decryptWindowEnd": "..."
  },
  "suppliers": [
    {
      "id": "供应商ID",
      "name": "供应商名称",
      "decryptStatus": "SUCCESS",
      "confirmStatus": "CONFIRMED"
    }
  ],
  "openingRecords": ["唱标记录..."],
  "supervisionLogs": ["监督日志..."],
  "summary": {
    "supplierTotal": 3,
    "decrypted": 3,
    "decryptFailed": 0,
    "confirmed": 3,
    "disputed": 0,
    "withdrawn": 0
  },
  "fingerprint": "<SHA-256 of entire JSON>"
}
```

**指纹覆盖整个 JSON 内容**，任何字段被篡改都会导致指纹不匹配。

**移交流程：**

```
1. assertOpeningDone: 所有活跃供应商必须处于终态
   (DANGER OR (SUCCESS AND (CONFIRMED OR EXCEPTION)))
2. buildHandoverPackage → JSON + SHA-256 fingerprint
3. 存入 MinIO: bid-opening-handover/{projectId}.json
4. 事务: 创建 FileAsset(category=bid_opening_handover)
         + 更新 BidOpeningSession.status → "开标完成"
         + 写入 session.handoverAssetId, handoverAt
5. WS 广播 opening:completed 事件（Socket.IO → 采购管理工作台 :3005）
6. 通知所有 leader/staff
```

### 4.4 恢复机制 — resealBidFiles

当 KMS_SECRET 轮转或密封数据损坏时，`resealBidFiles`（`bid.service.ts:1643`）提供完整恢复链路：

```
原始明文（asset.key，从未删除）
    → SHA-256 校验（确认原文未被篡改）
    → encryptBuffer（用新随机 DEK 重新加密）
    → wrapKey（用新 KMS_SECRET 包裹新 DEK）
    → 写入 reseal/{pid}/{sid}/{role}-{timestamp}.enc
    → 更新 FileAsset.sealedPath
    → 更新 SupplierBidSubmission.*SealedKey
    → 重置 BidSupplier.decryptStatus
    → 自动触发重新解密验证
```

### 4.5 基础设施层面

| 组件 | 备份机制 | 说明 |
|------|---------|------|
| **PostgreSQL** | `scripts/db-backup.sh` | docker exec pg_dump → gzip，`BACKUP_KEEP_DAYS=14`，输出 `backups/`（gitignored） |
| **MinIO** | 纠删码（Erasure Coding） | 对象存储自带多磁盘冗余，容忍半数磁盘故障 |
| **Redis** | 非持久化 | 仅 BullMQ 任务队列 + 开标大厅实时状态缓存 |
| **环境变量** | `.env` 文件 | 需单独备份，KMS_SECRET 丢失则所有密封数据不可恢复 |

---

## 五、安全模型总结

### 威胁模型 & 防护矩阵

```
┌──────────────────┬──────────────────────────────────────────────┐
│     威胁          │                   防护                       │
├──────────────────┼──────────────────────────────────────────────┤
│ 数据库泄露        │ DEK 被 KMS_SECRET 包裹，无 KMS 无法解包        │
│ MinIO 泄露        │ 文件以 AES-256-GCM 密文存储，无 DEK 不可解密    │
│ 传输截获          │ 文件明文经 HTTPS 传输；加密为服务端 at-rest，非 E2EE │
│ 内部篡改          │ SHA-256 完整性校验 + 移交档案指纹 + 备份包自证   │
│ 抵赖投递          │ SM2 数字签名（架构就绪，前端待实现）             │
│ 未授权解密        │ 角色门控 + 解密时间窗口 + 开标暂停机制           │
│ 密钥泄露          │ KMS_SECRET 轮转 → resealBidFiles 全量重加密    │
│ 灾难恢复          │ 原始明文永不删除 + 自包含备份包 + reseal 链路    │
│ 单点故障          │ PostgreSQL + MinIO + Redis 独立冗余             │
└──────────────────┴──────────────────────────────────────────────┘
```

### 核心设计哲学

> **不信任任何单一存储层。** 数据库、MinIO、应用程序各持有一部分密钥材料——攻击者必须同时攻破**服务器环境变量（KMS_SECRET）**和**数据库**和**MinIO**三者才能还原投标文件明文。

### 安全边界

```
┌─────────────────────────────────────────────────────────┐
│                    服务器进程内存                         │
│  ┌──────────────┐                                       │
│  │  KMS_SECRET  │ ← 唯一可信根，永不落库                   │
│  └──────┬───────┘                                       │
│         │ SHA-256 派生                                   │
│  ┌──────┴───────┐                                       │
│  │   KEK（派生） │ ← 信封加密/字段加密共用不同盐值           │
│  └──────────────┘                                       │
├─────────────────────────────────────────────────────────┤
│                    PostgreSQL 数据库                      │
│  ┌────────────────────────────────────────┐             │
│  │ SupplierBidSubmission.*SealedKey        │ ← KMS 包裹   │
│  │ SupplierBidSubmission.bidPrice (v1:...) │ ← KMS 加密   │
│  │ BidFileBackup.wrappedDek                │ ← KMS 包裹   │
│  │ FileAsset.sha256                        │ ← 完整性锚    │
│  └────────────────────────────────────────┘             │
├─────────────────────────────────────────────────────────┤
│                      MinIO 对象存储                       │
│  ┌────────────────────────────────────────┐             │
│  │ sealed/*.enc        ← AES-256-GCM 密文  │             │
│  │ sealed-backup/*     ← 自包含加密证据包   │             │
│  │ bid-opening-handover/*.json ← 归档指纹   │             │
│  │ uploads/*           ← 原始明文（不删除）  │             │
│  └────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 完整数据流

```
1. 招标文件上传（管理员）
   文件 → encryptBuffer() → 密文存入 MinIO
        → wrapKey(dek, KMS_SECRET) → BidDocument.decryptKey（base64 入库）

2. 供应商投标投递
   文件 → encryptBuffer() → 密文存入 MinIO（sealed/ 前缀）
        → wrapKey(dek, KMS_SECRET) → SupplierBidSubmission.*SealedKey（base64 入库）
        → sealField(bidPrice, KMS_SECRET) → SupplierBidSubmission.bidPrice（v1: base64 入库）
        → BidFileBackup 创建（自包含加密证据包）

3. 开标解密
   *SealedKey → unwrapKey(blob, KMS_SECRET) → 原始 DEK
   MinIO 密文 → decryptBuffer(ciphertext, rawDEK) → 明文
   verifyIntegrity(plaintext, FileAsset.sha256)
   classifyDecryptOutcome → SUCCESS / DANGER

4. 招标文件下载（供应商）
   BidDocument.decryptKey → unwrapKey(blob, KMS_SECRET) → 原始 DEK
   MinIO 密文 → decryptBuffer → 明文返回给供应商

5. 开标完成移交
   汇总开标数据 → JSON → MinIO（bid-opening-handover/ 前缀）
   SHA-256 指纹覆盖全部内容
   WS 通知 :3005 采购管理工作台
```

---

## 六、关键源文件索引

| 文件 | 职责 |
|------|------|
| `apps/api/src/common/crypto/envelope-crypto.ts` | 信封加密：wrapKey / unwrapKey / isWrappedKey / verifyKmsHealth |
| `apps/api/src/common/crypto/field-crypto.ts` | 字段级加密：sealField / openField / isSealedField |
| `apps/api/src/announcement/bid-document.crypto.ts` | 文件对称加密：encryptBuffer / decryptBuffer / createDecryptStream |
| `apps/api/src/bid/bid-submission.crypto.ts` | 解密结果分类：verifyIntegrity / classifyDecryptOutcome |
| `apps/api/src/supplier-portal/supplier-portal.service.ts` | 供应商投递加密流程（submitBid: line 711） |
| `apps/api/src/bid/bid.service.ts` | 开标解密 + 移交：decryptSupplier (line 1248) / completeOpening (line 516) / resealBidFiles (line 1643) |
| `apps/api/src/announcement/bid-document.service.ts` | 招标文件上传加密 + 下载解密 |
| `apps/api/src/announcement/announcement.service.ts` | 报价解密展示门控（line 411） |
| `apps/api/src/upload/upload.service.ts` | 文件上传：SHA-256 计算 + 类型校验 + 访问控制 |
| `apps/api/src/storage/storage.service.ts` | MinIO 封装：upload / download / delete / getPresignedUrl |
| `apps/api/prisma/schema.prisma` | 数据模型：FileAsset (line 1172) / SupplierBidSubmission (line 1130) / BidFileBackup (line 1202) / BidOpeningSession (line 398) |
| `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts` | AI 分析明文获取（使用 unwrapKey 解密） |
| `apps/api/.env.example` | KMS_SECRET 环境变量说明 |
