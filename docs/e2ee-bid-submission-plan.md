# 供应商投标 E2EE — 完整分步实施计划（含全链路审计）

> 生成日期：2026-07-29 | 基于 `water-erp/` 代码库全链路审计

## 审计发现摘要

全面审计发现了 **14 个 BREAK 级别**和 **10 个 ADAPTATION 级别**的受影响代码路径。以下计划覆盖所有路径，按依赖关系排序，每步独立验证。

---

## 总体架构

```
当前：浏览器 → 明文上传 MinIO → submitBid 读明文加密 → 存 sealedPath
目标：浏览器 → Web Crypto API 加密 → 密文上传 MinIO → submitBid 直接 wrap DEK → 存 sealedPath
```

**兼容性保证**：`FileAsset.clientEncrypted` 默认 `false`，所有现有数据走原流程。

---

## Step 1: Prisma Schema — 新增 clientEncrypted 标记

**文件**：`apps/api/prisma/schema.prisma`

```prisma
model FileAsset {
  // ... 现有字段 ...
  clientEncrypted Boolean @default(false) // E2EE: 客户端加密标记
}
```

**sha256 语义约定**（全链路统一）：

| 文件类型 | sha256 含义 | 用途 |
|---------|------------|------|
| 非 clientEncrypted（现有） | 原文哈希 | `verifyIntegrity`、`reuploadBidFile` 校验 |
| clientEncrypted（新增） | **原文哈希**（客户端加密前计算并上传时传递） | 同上，保持兼容 |
| 密文哈希 | 由服务端在上传时额外计算 | `BidFileBackup.ciphertextSha256`，用于备份自证 |

**迁移**：
```bash
cd water-erp
pnpm --filter api exec prisma migrate dev --name add-client-encrypted --create-only
pnpm --filter api exec prisma db execute --file prisma/migrations/<新迁移>/migration.sql
pnpm --filter api exec prisma migrate resolve --applied <迁移名>
```

**验证**：
```bash
pnpm --filter api exec prisma db execute --stdin <<< "SELECT column_name FROM information_schema.columns WHERE table_name='FileAsset' AND column_name='clientEncrypted';"
# 应返回 clientEncrypted
```

---

## Step 2: 浏览器端加密工具（新建）

**文件**：`apps/supplier-portal/src/utils/bid-crypto.ts`

四个导出函数（纯 Web Crypto API，无外部依赖）：

```typescript
// 1. 生成 DEK
generateDEK(): Promise<{ rawKey: CryptoKey; keyHex: string; iv: Uint8Array; ivHex: string }>

// 2. 加密文件
encryptFile(file: File, key: CryptoKey, iv: Uint8Array): Promise<{ encryptedBlob: Blob; authTagHex: string }>

// 3. 格式化 DEK 为 "keyHex:ivHex:authTagHex"（与服务端 encryptBuffer 输出格式一致）
formatDEK(keyHex: string, ivHex: string, authTagHex: string): string

// 4. 计算原文 SHA-256
computePlaintextHash(file: File): Promise<string>
```

**验证 — 浏览器 console**：
```javascript
const { generateDEK, encryptFile, formatDEK, computePlaintextHash } = await import('/src/utils/bid-crypto.ts')
const { rawKey, keyHex, iv, ivHex } = await generateDEK()
const hash = await computePlaintextHash(testFile)
const { encryptedBlob, authTagHex } = await encryptFile(testFile, rawKey, iv)
// 用 Node.js crypto 验证解密后与原文一致
```

---

## Step 3: UploadService + UploadController 适配

### 3a. UploadService.upload()

**文件**：`apps/api/src/upload/upload.service.ts`

```typescript
async upload(
  file: Express.Multer.File, category: string, userId?: string,
  clientEncrypted = false,
  clientPlaintextSha256?: string,   // NEW: 客户端计算的原文哈希
) {
  // clientEncrypted 时：跳过 Office→PDF 转换（密文无法转换）
  // sha256 = clientPlaintextSha256 || this.computeSha256(buffer)
  // mimeType = clientEncrypted ? 'application/octet-stream' : ...
  // prisma.fileAsset.create({ ..., clientEncrypted, sha256 })
}
```

### 3b. UploadController

**文件**：`apps/api/src/upload/upload.controller.ts`

```typescript
@Post()
async upload(
  @UploadedFile() file,
  @Query('category') category,
  @Query('clientEncrypted') clientEncrypted = 'false',
  @Query('plaintextSha256') plaintextSha256?: string, // NEW
  @Request() req,
) {
  return this.uploadService.upload(
    file, category, req.user?.sub,
    clientEncrypted === 'true',
    plaintextSha256,
  );
}
```

**验证 — curl**：
```bash
curl -X POST "http://localhost:4001/api/upload?category=bid_document&clientEncrypted=true&plaintextSha256=abc123..." \
  -H "Cookie: ..." -H "X-Portal: supplier" \
  -F "file=@/tmp/test.enc"
# → DB 验证：clientEncrypted=true, sha256=abc123...
```

---

## Step 4: 前端 upload.ts + BidSubmit.vue 适配

### 4a. upload.ts

**文件**：`apps/supplier-portal/src/api/upload.ts`

```typescript
export function uploadFile(
  file: File, category = 'qualification',
  onProgress?: (pct: number) => void,
  clientEncrypted = false,
  plaintextSha256?: string,   // NEW
): Promise<FileAssetResponse> {
  const params = `category=${encodeURIComponent(category)}&clientEncrypted=${clientEncrypted}`
    + (plaintextSha256 ? `&plaintextSha256=${encodeURIComponent(plaintextSha256)}` : '')
  return api.post(`/upload?${params}`, fd, { ... })
}
```

### 4b. BidSubmit.vue

**文件**：`apps/supplier-portal/src/views/bid/BidSubmit.vue`

引入 bid-crypto.ts，新增 `clientDeks` 状态。

每个 upload handler 流程：
```
1. computePlaintextHash(file) → plaintextSha256
2. generateDEK() → { rawKey, keyHex, iv, ivHex }
3. encryptFile(file, rawKey, iv) → { encryptedBlob, authTagHex }
4. uploadFile(encryptedFile, 'bid_document', progress, true, plaintextSha256)
5. 存储 clientDeks[assetId] = { keyHex, ivHex, authTagHex }
```

`confirmSubmit()` 构建：
```typescript
payload.clientDeks = {
  technical: formatDEK(clientDeks[techAssetId]),
  business: formatDEK(clientDeks[bizAssetId]),
  coverLetter: formatDEK(clientDeks[coverAssetId]),
}
```

**验证 — 浏览器**：
1. 上传 PDF → DevTools Network 显示请求体为随机字节
2. MinIO 检查：`file uploads/xxx` → `data`（非 PDF）
3. DB 检查：`FileAsset.clientEncrypted=true`, `sha256`=原文哈希（由客户端传入）

### 4c. useAutoSave DEK 持久化（关键——防止 DEK 丢失）

**文件**：`apps/supplier-portal/src/composables/useAutoSave.ts`

**风险**：如果供应商上传加密文件后关闭浏览器标签页，`clientDeks`（Vue reactive ref）中的 DEK 会丢失。密文文件在 MinIO 中，但没有 DEK 无法解密——必须重新上传。

**修改**：
```typescript
// useAutoSave 序列化时包含 clientDeks
function serialize() {
  const data = {
    form: form.value,
    clientDeks: clientDeks.value,  // NEW: 持久化 DEK
    savedAt: Date.now(),
  }
  localStorage.setItem(key, JSON.stringify(data))
}

// 恢复时同时恢复 clientDeks
function restore() {
  const raw = localStorage.getItem(key)
  if (raw) {
    const data = JSON.parse(raw)
    form.value = data.form
    clientDeks.value = data.clientDeks || {}  // NEW
  }
}
```

**BidSubmit.vue 同步变更**：将 `clientDeks` ref 传递给 `useAutoSave` composable。

**验证**：
1. 上传文件 → 关闭标签页 → 重新打开 → 恢复草稿
2. `clientDeks` 仍存在 → 提交投标 → DEK 正常发送

---

## Step 5: submitBid 服务端适配

### 5a. Controller DTO

**文件**：`apps/api/src/supplier-portal/supplier-portal.controller.ts`

```typescript
clientDeks?: {
  technical?: string;  // "keyHex:ivHex:authTagHex"
  business?: string;
  coverLetter?: string;
};
```

### 5b. Service submitBid() — 加密循环分支

**文件**：`apps/api/src/supplier-portal/supplier-portal.service.ts`，lines 766-804

```typescript
if (asset.clientEncrypted) {
  // 密文已在 MinIO（asset.key），无需读/加密/写 sealedPath
  const clientDek = data.clientDeks?.[role];
  if (!clientDek) throw BadRequest('MISSING_CLIENT_DEK');

  // 校验 DEK 格式：三段 hex，冒号分隔
  const parts = clientDek.split(':');
  if (parts.length !== 3 || parts.some(p => !/^[0-9a-f]+$/i.test(p))) {
    throw BadRequest('INVALID_CLIENT_DEK');
  }

  // wrap DEK with KMS_SECRET（与现有流程一致）
  sealedKeys[assetId] = wrapKey(clientDek, process.env.KMS_SECRET!);
  // sealedPath 直接指向上传路径（密文已在 MinIO）
  sealedPaths[assetId] = asset.key;
} else {
  // 现有服务端加密流程不变
}
```

**验证 — 完整投递**：
1. 供应商上传加密文件 + 提交投标
2. `SupplierBidSubmission.technicalSealedKey` = base64 密文块（wrapKey 输出）
3. `FileAsset.sealedPath = FileAsset.key`
4. MinIO 中**不**创建 `sealed/` 新文件

### 5c. saveBidDraft() 适配

**文件**：`apps/api/src/supplier-portal/supplier-portal.service.ts`，`saveBidDraft()`（line 897）

当前 `saveBidDraft` 存储 FileAsset ID 但不处理加密。对 E2EE 文件：
- `saveBidDraft` 的 DTO 需新增 `clientEncrypted` 标记
- 存储到 `SupplierBidSubmission` 草稿时保留 `clientEncrypted` 标记
- 草稿恢复时前端需知道文件已是密文，是否持有 DEK 取决于 `useAutoSave`

**修改**：与 `submitBid` 的 controller DTO 一致，`saveBidDraft` 也接受 `clientDeks` 字段（但仅存储不加密——DEK 在提交时处理）。

### 5d. withdrawSubmission() 适配

**文件**：`apps/api/src/supplier-portal/supplier-portal.service.ts`，`withdrawSubmission()`（line 971）

撤回投标时清理 MinIO `sealedPath`。对 clientEncrypted 文件，`sealedPath === asset.key`（密文原始路径）。撤回时删除此路径是**正确的行为**——撤回的投标文件应被清理。但需注意不要额外删除已被 `sealedPath` 别名引用的 `asset.key`（本来就是同一个）。

**验证**：
1. 投递 E2EE 文件 → 撤回 → MinIO 中 `asset.key` 被清理
2. `FileAsset` 记录和 `SupplierBidSubmission` 标记为已撤回

---

## Step 5e: announcement.service.ts 公告删除时的 sealedPath 清理适配

**文件**：`apps/api/src/announcement/announcement.service.ts`，公告删除逻辑（lines 303-337）

删除公告时会遍历关联的 `FileAsset.sealedPath` 清理 MinIO。对 clientEncrypted 文件，`sealedPath === asset.key`——清理时需避免重复删除同一个 MinIO 对象。添加去重判断：

```typescript
const pathsToClean = [...new Set(
  assets.map(a => a.sealedPath).filter(Boolean)
)];
```

---

## Step 6: BidFileBackup 适配（冗余备份 + 自证）

**文件**：`apps/api/src/bid-backup/bid-backup.service.ts`

### 6a. stageBackup() — 备份密文副本

```typescript
if (asset.clientEncrypted) {
  // 密文已在 asset.key → 直接拷贝到 backupKey
  const ciphertext = await streamToBuffer(
    await minioClient.getObject(MINIO_BUCKET, asset.key)
  );
  const backupPath = `sealed-backup/${projectId}/${supplierId}/${role}/${basename}`;
  await minioClient.putObject(MINIO_BUCKET, backupPath, ciphertext);
  
  return {
    backupKey: backupPath,
    sealedPath: asset.key,           // 指向密文原始位置
    wrappedDek: sealedKeys[assetId],  // KMS-wrapped client DEK
    ciphertextSha256: computeSha256(ciphertext),
    plaintextSha256: asset.sha256,    // 原文哈希（客户端传入）
    cryptoVersion: 'envelope-v1',
  };
} else {
  // 现有逻辑不变
}
```

### 6b. verify() — 备份自证验证

现有三向校验（backup ciphertext ↔ sealedPath ciphertext ↔ ciphertextSha256）。对 clientEncrypted 文件，两个路径（backupKey、sealedPath）都指向密文——自证性不变。

### 6c. reconcileMissing() — 定时对账补齐

```typescript
// 现有 line 224：if (!asset?.sealedPath) continue;
// 改为：if (!asset?.sealedPath && !asset?.clientEncrypted) continue;
if (asset.clientEncrypted) {
  readKey = asset.key;  // 密文即在此
} else {
  readKey = asset.sealedPath;
}
```

**验证 — 备份完整性**：
1. 投递后，检查 `BidFileBackup` 表：backupKey 存在，ciphertextSha256 非空
2. 调用 verify 端点 → `consistent`
3. 删除备份 MinIO 文件，等 reconcileMissing → 备份被补齐

---

## Step 7: decryptSupplier 适配

**文件**：`apps/api/src/bid/bid.service.ts`，`decryptSupplier()`（line 1248，文件解密循环 line 1329）

```typescript
if (asset.clientEncrypted) {
  // Step B: 解密（sealedKey 是 wrapKey(clientDek) → unwrap → decryptBuffer）
  const rawKey = isWrappedKey(ref.sealedKey)
    ? unwrapKey(ref.sealedKey, process.env.KMS_SECRET!)
    : ref.sealedKey;
  buffer = decryptBuffer(buffer, rawKey);
  decryptOk = true;

  // Step C: 原文完整性校验（asset.sha256 = 客户端传入的原文哈希）
  const integrity = verifyIntegrity(buffer, asset.sha256);
  if (integrity === false) { allFilesOk = false; errorMsg = 'SHA-256 mismatch'; break; }
  integrityOk = true;
} else {
  // 现有流程不变
}
```

**验证 — 开标解密**：
1. bid_host 启动开标 → 解密 clientEncrypted 供应商
2. `decryptStatus = SUCCESS`
3. 解密后的内容与原始文件一致

---

## Step 8: PlaintextFetcherService 适配（AI 分析 + 专家查看）

**文件**：`apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts`

`fetchBidderPlaintext()`（line 27）和 `fetchTenderPlaintext()`（line 93）：

```typescript
const readKey = asset.sealedPath || asset.key;

// 解密逻辑与 decryptSupplier 一致
const rawKey = isWrappedKey(submission[sealedKeyField])
  ? unwrapKey(submission[sealedKeyField], process.env.KMS_SECRET!)
  : submission[sealedKeyField];
const plaintext = decryptBuffer(ciphertext, rawKey);

// 对 clientEncrypted 文件：验证解密后的原文哈希
if (asset.clientEncrypted) {
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
  if (hash !== asset.sha256) throw new Error('plaintext integrity mismatch');
}
```

**验证**：AI 投标分析 worker 能正确读取并分析 E2EE 供应商的投标文件。

---

## Step 9: resealBidFiles 适配

**文件**：`apps/api/src/bid/bid.service.ts`，`resealBidFiles()`（line 1643）

```typescript
if (originalAsset.clientEncrypted) {
  // 密文在 asset.key，无需改动
  // 仅用新 KMS_SECRET 重新包裹 DEK
  const oldDek = unwrapKey(submission.technicalSealedKey, process.env.KMS_SECRET!);
  const newWrapped = wrapKey(oldDek, newKmsSecret);
  // 更新 submission.*SealedKey，sealedPath 不变
} else {
  // 现有流程：从 asset.key 读明文 → 重加密
}
```

**验证**：
1. 对 clientEncrypted 文件执行 resealBidFiles
2. sealedKey 更新（如果 KMS 变更），sealedPath 不变
3. 重新解密 → SUCCESS

> **注意**：`resealBidFiles` 端点有独立的 `@Roles('admin','bid_host')` 限制，比解密端点（`@Roles('admin','bid_host','leader','staff')`）更严格。

---

## Step 9b: 边缘场景处理

### 场景 1：Draft DEK 丢失

**风险**：供应商上传加密文件后关闭标签页 → `clientDeks` 内存丢失 → 密文不可解密。

**处理**：Step 4c 的 `useAutoSave` DEK 持久化已解决此问题。供应商恢复草稿时自动恢复 DEK。

### 场景 2：reuploadBidFile 后 clientEncrypted 标记

管理员 `reuploadBidFile` 后，文件变为 server-encrypted（`encryptBuffer + wrapKey`），但 `FileAsset.clientEncrypted` 可能仍为 `true`。

**处理**：`reuploadBidFile` 成功后重置 `clientEncrypted = false`，因为文件已转为 server-encrypted。解密路径中的 `isWrappedKey()` 检测保证功能上不会出错，但重置标记可避免语义混淆。

### 场景 3：BidBondAssetId 不加密

投标保证金凭证（bid bond）是程序性文件，schema 注释明确标记「不加密」。E2EE 流程**完全排除** `bidBondAssetId`——保证金文件继续以明文上传和存储。

### 场景 4：splitFiles 多文件模式的 DEK 映射

`normalizeBidFileAssets()` 将前端 split-files 模型映射为三 role（technical/business/coverLetter）。每个 role 只取第一个文件的 assetId。E2EE 中每个文件有独立 DEK——Step 5b 通过 `clientDeks[role]` 映射正确处理此场景。

### 场景 5：withdrawSubmission MinIO 清理

撤回 E2EE 投标时，`sealedPath === asset.key`（密文原始路径）。清理该路径会删除 MinIO 中的密文文件——这是**正确行为**（撤回的投标应被清理）。Step 5d 已覆盖此场景。

## Step 10: reuploadBidFile 适配

**文件**：`apps/api/src/bid/bid.service.ts`，`reuploadBidFile()`（line 1504）

**不需要修改逻辑**——因为 `asset.sha256` 语义统一为原文哈希：
- 管理员上传原始明文文件 → `SHA-256(明文) === asset.sha256` → 通过
- 通过后走服务端加密路径（`encryptBuffer + wrapKey`），文件变为 server-encrypted

**验证**：管理员上传原始文件 → SHA-256 校验通过 → 重新密封 → 正常解密。

---

## Step 11: UploadService.streamFile 适配（文件下载流）

**文件**：`apps/api/src/upload/upload.service.ts`，`streamFile()`（line 143）

对 clientEncrypted 文件必须在 serving 时解密：

```typescript
if (asset.clientEncrypted && asset.sealedPath) {
  // 从 sealedPath 读密文 → decrypted → 流式返回明文
  const submission = await prisma.supplierBidSubmission.findFirst({...});
  const sealedKey = submission?.[`${role}SealedKey`];
  const ciphertext = await minioClient.getObject(MINIO_BUCKET, asset.sealedPath);
  const rawKey = unwrapKey(sealedKey, process.env.KMS_SECRET!);
  ciphertext.pipe(createDecryptStream(rawKey)).pipe(res);
} else {
  // 现有逻辑：直接从 asset.key 读取并流式返回
}
```

**验证**：
1. 供应商在「我的投标」页面下载 → 正常打开 PDF
2. 开标解密后，bid_host/专家下载 → 正常打开 PDF
3. canAccessFile gating 一致：未解密时拒绝下载

---

## Step 12: 专家查看投标文件适配

**文件**：`apps/api/src/expert/expert.service.ts`

- `downloadTenderDocument()`（line 565）— 招标文件暂不纳入 E2EE，不受影响
- `downloadBidDocument()`（line 643）— 调用 `plaintextFetcher.fetchBidderPlaintext()`，已在 Step 8 处理

---

## Step 13: 开标管理端前端适配

### 13a. reseal 按钮

**文件**：`apps/bid-portal/src/components/opening-hall.tsx`（line 586）

对 clientEncrypted 文件，reseal 功能仍可用（Step 9 已适配），无需改动。

### 13b. WebSocket 事件

`DECRYPT_STATUS` 事件结构不变（`{ supplierId, supplierName, decryptStatus }`），所有前端 WebSocket listener 无需改动。

### 13c. 文件下载

开标管理端的文件下载走 `GET /api/upload/files/:id`，已在 Step 11 适配。

---

## Step 14: 专家门户前端适配

**文件**：`apps/expert-portal/src/`

专家评标向导中的文件预览和下载走 `GET /api/upload/files/:id`。Step 11 的 streamFile 适配使其透明化——无需改动。

---

## Step 15: 回归测试

### 15a. 现有服务端加密投标

- 老方式投递 → 走现有加密路径 ✓
- 开标解密 → SUCCESS ✓
- resealBidFiles → 正常工作 ✓
- AI 分析 → 正常读取明文 ✓
- 专家打分 → 正常查看文件 ✓

### 15b. E2E 测试

```bash
pnpm --filter api test:e2e -- supplier
pnpm --filter api test:e2e -- bid
pnpm --filter api test
```

---

## 完整文件变更清单

| Step | 操作 | 文件 | 影响级别 |
|------|------|------|---------|
| S1 | 修改 | `apps/api/prisma/schema.prisma` | 基础 |
| S2 | **新建** | `apps/supplier-portal/src/utils/bid-crypto.ts` | 基础 |
| S3 | 修改 | `apps/api/src/upload/upload.controller.ts` | BREAK |
| S3 | 修改 | `apps/api/src/upload/upload.service.ts`（`upload()`） | BREAK |
| S4 | 修改 | `apps/supplier-portal/src/api/upload.ts` | ADAPT |
| S4 | 修改 | `apps/supplier-portal/src/views/bid/BidSubmit.vue` | ADAPT |
| S4c | 修改 | `apps/supplier-portal/src/composables/useAutoSave.ts` | CRITICAL（DEK 持久化） |
| S5 | 修改 | `apps/api/src/supplier-portal/supplier-portal.controller.ts` | BREAK |
| S5 | 修改 | `apps/api/src/supplier-portal/supplier-portal.service.ts`（`submitBid()`） | BREAK |
| S5c | 修改 | `apps/api/src/supplier-portal/supplier-portal.service.ts`（`saveBidDraft()`） | BREAK |
| S5d | 修改 | `apps/api/src/supplier-portal/supplier-portal.service.ts`（`withdrawSubmission()`） | ADAPT |
| S5e | 修改 | `apps/api/src/announcement/announcement.service.ts`（sealedPath 清理去重） | ADAPT |
| S6 | 修改 | `apps/api/src/bid-backup/bid-backup.service.ts`（`stageBackup`、`verify`、`reconcileMissing`） | BREAK |
| S7 | 修改 | `apps/api/src/bid/bid.service.ts`（`decryptSupplier()`） | BREAK |
| S8 | 修改 | `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts` | BREAK |
| S9 | 修改 | `apps/api/src/bid/bid.service.ts`（`resealBidFiles()`） | BREAK |
| S9b | — | 边缘场景处理（文档化，代码中实现） | ADAPT |
| S10 | 修改 | `apps/api/src/bid/bid.service.ts`（`reuploadBidFile()`——重置 clientEncrypted） | ADAPT |
| S11 | 修改 | `apps/api/src/upload/upload.service.ts`（`streamFile()`） | BREAK |
| S12 | 不修改 | `apps/api/src/expert/expert.service.ts` | OK（招标文件暂不 E2EE） |
| S13 | 不修改 | `apps/bid-portal/src/` | OK |
| S14 | 不修改 | `apps/expert-portal/src/` | OK |
| S15 | 测试 | 回归 + E2E | — |
| — | **不修改** | `apps/api/src/announcement/bid-document.crypto.ts` | OK（格式兼容） |
| — | **不修改** | `apps/api/src/common/crypto/envelope-crypto.ts` | OK（复用） |
| — | **不修改** | `apps/api/src/common/crypto/field-crypto.ts` | OK（独立加密域） |
| — | 建议更新 | `apps/api/prisma/seed.ts` | 新增 clientEncrypted 测试用例 |
| — | 建议更新 | `apps/api/prisma/scripts/seed-yindajimin.ts` | 同上 |
| — | 建议更新 | `apps/api/prisma/scripts/create-bidable-project.ts` | 同上 |

## 不受影响的模块（审计确认）

| 模块 | 原因 |
|------|------|
| 字段级加密（field-crypto） | 报价加密独立于文件加密 |
| 招标文件（BidDocument） | 管理端上传，暂不纳入 E2EE |
| 澄清答疑（BidClarification） | 纯文本，无文件加密 |
| 开标大厅聊天（OpeningHall） | 纯文本 + 在线状态 |
| StorageService | 无感知的字节传输 |
| AI 分析逻辑（prompts/scoring） | 通过 PlaintextFetcher 间接消费（已适配） |
| AI worker（bidder/tender processor） | 通过 PlaintextFetcher 间接消费（已适配） |
| WebSocket 事件广播 | 传输元数据，`DECRYPT_STATUS` 结构不变 |
| ExpertMemo（手写批注） | 无加密需求 |
| 公告附件（AnnouncementAttachment） | 公开文件，无加密 |
| `canAccessFile()` 门控 | `decryptStatus` 检查逻辑不变，仅 `streamFile` 需适配（已覆盖） |
| `supplier-portal/src/api/announcement.ts` | `downloadBidDocument` 下载的是招标文件（BidDocument），非投标文件 |
| `bid-portal` bid bond 下载链接（opening-hall.tsx:781） | 保证金不加密，不受影响 |
| `ExpertEvaluationService` | 通过 PlaintextFetcher 获取投标文件，已覆盖 |
