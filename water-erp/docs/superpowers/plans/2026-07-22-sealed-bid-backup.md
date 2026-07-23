# 未解密投标文件备份（sealed-bid-backup）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 供应商提交投标文件后，服务器立即备份一份"未解密态"密文副本（自包含证据包），用于后续争议核验；对现有封标/解密/下载流程零侵入，可一键关停。

**Architecture:** 新建独立 `BidBackupModule`（`BidBackupService`）：封标时在 `submitBid` 复用内存密文 best-effort 写入独立 MinIO 前缀 `sealed-backup/`，事务内固化 `BidFileBackup` 行（密文 + sha256 + wrapped DEK + 时间戳）；`@Cron` 后台补备缺失项；`BidController` 新增只读核验端点做三方哈希比对（只回哈希与布尔，绝不回内容）。

**Tech Stack:** NestJS 11 · Prisma（PostgreSQL）· MinIO（minio client）· `@nestjs/schedule`（@Cron）· Jest（单测 + supertest e2e）· AES-256-GCM 信封加密（既有 `envelope-crypto` / `bid-document.crypto`）。

## Global Constraints

- **只存密文，永不解密/提取内容**：备份与核验全程只操作密文与 SHA-256；`wrappedDek` 为 KMS 包裹密文，非明文；核验端点绝不返回密文/明文。
- **零侵入**：不修改现有封标、开标解密、文件下载的既有行为分支；本功能全部为追加式。
- **Feature flag**：`BID_BACKUP_ENABLED` 默认开启（opt-out，`!== 'false'`）；设 `false` 时不写备份、不补备、核验端点照常但无备份数据（返回 missing）。
- **KMS_SECRET** 仅经 `process.env.KMS_SECRET` 读取，永不写库。
- **核验端点权限**：仅 `admin` / `bid_host`（方法级 `@Roles` 覆盖 `BidController` 类级角色；`RolesGuard` 用 `getAllAndOverride`，方法优先）。
- **迁移安全**（项目 memory `main-db-migration-drift`）：禁止交互式 `prisma migrate dev`（会 reset 丢数据）；用 `--create-only` → `db execute` → `resolve --applied`，或手写 SQL + `db execute` + `resolve`。
- **提交纪律**（项目 memory `no-auto-push`）：每个任务结束 commit，但**不要 push**。

---

## File Structure

**Create:**
- `apps/api/src/bid-backup/bid-backup.service.ts` — `BidBackupService`：`buildBackupKey` / `computeSha256` / `stageBackup`（best-effort 写 MinIO）/ `persistBackup`（事务内幂等 upsert）/ `reconcileMissing`（@Cron 补备）/ `verify`（三方哈希核验）。含全部导出类型。
- `apps/api/src/bid-backup/bid-backup.module.ts` — 提供并导出 `BidBackupService`（被 SupplierPortalModule 与 BidModule 共同导入，Nest 去重为单例，@Cron 仅注册一次）。
- `apps/api/src/bid-backup/bid-backup.service.spec.ts` — 单元测试（mock `minioClient` + `PrismaService`）。
- `apps/api/test/sealed-bid-backup.e2e-spec.ts` — e2e：提交→备份→核验→篡改检测→RBAC。

**Modify:**
- `apps/api/prisma/schema.prisma` — 新增 `BidFileBackup` model（+ 迁移）。
- `apps/api/src/supplier-portal/supplier-portal.service.ts` — 注入 `BidBackupService`；封标循环 stage 备份；事务内 persist；补 `receiptNo` 捕获；备份键纳入失败清理。
- `apps/api/src/supplier-portal/supplier-portal.module.ts` — 导入 `BidBackupModule`。
- `apps/api/src/bid/bid.controller.ts` — 注入 `BidBackupService` + 核验端点。
- `apps/api/src/bid/bid.module.ts` — 导入 `BidBackupModule`。
- `apps/api/.env` — 追加 `BID_BACKUP_ENABLED=true`。

---

## Task 1: Prisma 模型 `BidFileBackup` + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（在 `FileAsset` model 之后追加）
- Create: 迁移 SQL（见步骤）

**Interfaces:**
- Produces: `prisma.bidFileBackup` 委托；复合唯一键名 `supplierId_projectId_fileRole`（供后续 upsert `where` 使用）。

- [ ] **Step 1: 在 schema.prisma 追加模型**

在 `FileAsset` model（约 :1067-1093）之后追加：

```prisma
/// 未解密投标文件备份：提交时即固化的加密态副本（自包含证据包），用于争议核验。
/// 不设外键级联——备份需独立长存，即使提交记录撤回/删除也保留。
model BidFileBackup {
  id               String   @id @default(cuid())
  projectId        String
  supplierId       String
  fileAssetId      String
  fileRole         String // technical | business | coverLetter
  backupKey        String   @unique // MinIO: sealed-backup/{pid}/{sid}/{role}/{basename}
  sealedPath       String // 本备份所镜像的 sealed 对象键（核验时直接读取）
  wrappedDek       String // KMS 包裹的 DEK（密文，需 KMS_SECRET 解包）
  ciphertextSha256 String // sha256(密文) — 完整性自证锚点
  plaintextSha256  String? // 复用 FileAsset.sha256（明文哈希）
  size             Int
  receiptNo        String? // 回执号 TB-yyyymmdd-NNN
  backupSource     String   @default("submission") // submission | reconcile
  cryptoVersion    String   @default("envelope-v1") // AES-256-GCM + wrapKey(salt water-erp-envelope-salt-v1)
  submittedAt      DateTime
  createdAt        DateTime @default(now())

  @@unique([supplierId, projectId, fileRole])
  @@index([projectId, supplierId])
}
```

- [ ] **Step 2: 生成迁移（非交互，不 reset）**

从 `apps/api` 目录执行（schema 默认在 `prisma/schema.prisma`，`DATABASE_URL` 来自 `apps/api/.env`）：

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm exec prisma migrate dev --create-only --name add_bid_file_backup
```

Expected: 打印类似 `Generated migration at prisma/migrations/<timestamp>_add_bid_file_backup/migration.sql`，**不应用、不 reset**。记下 `<timestamp>_add_bid_file_backup` 这个迁移名。

> ⚠️ 若上一步因 DB drift 报错或试图 reset：**中止**，改用 Step 2b 手写 SQL 路径。

- [ ] **Step 2b（仅当 Step 2 失败时）: 手写迁移 SQL**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
MIG=20260722000000_add_bid_file_backup
mkdir -p prisma/migrations/$MIG
cat > prisma/migrations/$MIG/migration.sql <<'SQL'
CREATE TABLE "BidFileBackup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "fileRole" TEXT NOT NULL,
    "backupKey" TEXT NOT NULL,
    "sealedPath" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "ciphertextSha256" TEXT NOT NULL,
    "plaintextSha256" TEXT,
    "size" INTEGER NOT NULL,
    "receiptNo" TEXT,
    "backupSource" TEXT NOT NULL DEFAULT 'submission',
    "cryptoVersion" TEXT NOT NULL DEFAULT 'envelope-v1',
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidFileBackup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BidFileBackup_backupKey_key" ON "BidFileBackup"("backupKey");
CREATE UNIQUE INDEX "BidFileBackup_supplierId_projectId_fileRole_key" ON "BidFileBackup"("supplierId", "projectId", "fileRole");
CREATE INDEX "BidFileBackup_projectId_supplierId_idx" ON "BidFileBackup"("projectId", "supplierId");
SQL
```

- [ ] **Step 3: 应用 SQL 并标记已应用**

用 Step 2（或 2b）的迁移名替换 `<MIGRATION_NAME>`：

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm exec prisma db execute --file prisma/migrations/<MIGRATION_NAME>/migration.sql
pnpm exec prisma migrate resolve --applied <MIGRATION_NAME>
```

Expected: `db execute` 无报错；`migrate resolve` 打印 `Migration <MIGRATION_NAME> marked as applied.`

- [ ] **Step 4: 重新生成 Prisma Client**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm exec prisma generate
```

Expected: `✔ Generated Prisma Client`。此后 `prisma.bidFileBackup` 可用。

- [ ] **Step 5: 验证表已建**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm exec prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name='BidFileBackup' ORDER BY ordinal_position;
SQL
```

Expected: 列出 `id, projectId, supplierId, fileAssetId, fileRole, backupKey, sealedPath, wrappedDek, ciphertextSha256, plaintextSha256, size, receiptNo, backupSource, cryptoVersion, submittedAt, createdAt`。

- [ ] **Step 6: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/apps/api/prisma/schema.prisma water-erp/apps/api/prisma/migrations/
git commit -m "feat(api): 新增 BidFileBackup 模型（未解密投标文件备份）"
```

---

## Task 2: `BidBackupService` 核心（helpers + stageBackup + persistBackup）— TDD

**Files:**
- Create: `apps/api/src/bid-backup/bid-backup.service.ts`
- Test: `apps/api/src/bid-backup/bid-backup.service.spec.ts`

**Interfaces:**
- Produces（供后续任务/模块使用）：
  - `type BackupFileRole = 'technical' | 'business' | 'coverLetter'`
  - `interface StagedBackup { fileAssetId: string; fileRole: BackupFileRole; backupKey: string; sealedPath: string; wrappedDek: string; ciphertextSha256: string; plaintextSha256: string | null; size: number }`
  - `interface BackupVerifyFileResult` / `interface BackupVerifyResult`（Task 4 用，此处先定义集中管理）
  - `class BidBackupService`：`isEnabled(): boolean`、`buildBackupKey(projectId, supplierId, fileRole, sealedPath): string`、`computeSha256(buf): string`、`stageBackup(input): Promise<StagedBackup | null>`、`persistBackup(tx, staged, meta): Promise<void>`
- Consumes: `minioClient.putObject` / `MINIO_BUCKET`（`../upload/minio.client`）、`PrismaService`。

- [ ] **Step 1: 先写失败测试（spec 文件）**

创建 `apps/api/src/bid-backup/bid-backup.service.spec.ts`：

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BidBackupService, StagedBackup } from './bid-backup.service';
import { minioClient } from '../upload/minio.client';
import * as crypto from 'crypto';

jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn(), getObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** 构造一个 streamToBuffer 可消费的异步可迭代对象 */
function fakeStream(buf: Buffer): any {
  return { async *[Symbol.asyncIterator]() { yield buf; } };
}

describe('BidBackupService', () => {
  let service: BidBackupService;
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.BID_BACKUP_ENABLED;
    prisma = {
      bidFileBackup: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn(), findMany: jest.fn() },
      fileAsset: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [BidBackupService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(BidBackupService);
  });

  describe('buildBackupKey / computeSha256', () => {
    it('buildBackupKey 生成独立前缀路径', () => {
      expect(service.buildBackupKey('p1', 's1', 'technical', 'sealed/p1/s1/bid.pdf.enc'))
        .toBe('sealed-backup/p1/s1/technical/bid.pdf.enc');
    });
    it('computeSha256 与 node crypto 一致', () => {
      const buf = Buffer.from('hello');
      expect(service.computeSha256(buf)).toBe(sha(buf));
    });
  });

  describe('stageBackup', () => {
    const input = {
      projectId: 'p1', supplierId: 's1', fileRole: 'technical' as const,
      fileAssetId: 'a1', sealedPath: 'sealed/p1/s1/bid.pdf.enc',
      ciphertext: Buffer.from('cipher-bytes'), wrappedDek: 'wrapped==', plaintextSha256: 'plainsha',
    };

    it('成功：putObject 后返回 StagedBackup，含正确 ciphertextSha256', async () => {
      (minioClient.putObject as jest.Mock).mockResolvedValue({});
      const staged = await service.stageBackup(input);
      expect(minioClient.putObject).toHaveBeenCalledWith(
        'test-bucket', 'sealed-backup/p1/s1/technical/bid.pdf.enc',
        input.ciphertext, input.ciphertext.length, { 'Content-Type': 'application/octet-stream' },
      );
      expect(staged).toMatchObject({
        fileRole: 'technical', backupKey: 'sealed-backup/p1/s1/technical/bid.pdf.enc',
        sealedPath: input.sealedPath, wrappedDek: 'wrapped==',
        ciphertextSha256: sha(input.ciphertext), size: input.ciphertext.length,
      });
    });

    it('putObject 失败：返回 null 且不抛（不阻断提交）', async () => {
      (minioClient.putObject as jest.Mock).mockRejectedValue(new Error('minio down'));
      await expect(service.stageBackup(input)).resolves.toBeNull();
    });

    it('功能关闭（BID_BACKUP_ENABLED=false）：返回 null 且不写 MinIO', async () => {
      process.env.BID_BACKUP_ENABLED = 'false';
      const module: TestingModule = await Test.createTestingModule({
        providers: [BidBackupService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      const disabled = module.get(BidBackupService);
      expect(disabled.isEnabled()).toBe(false);
      await expect(disabled.stageBackup(input)).resolves.toBeNull();
      expect(minioClient.putObject).not.toHaveBeenCalled();
    });
  });

  describe('persistBackup', () => {
    it('以 [supplierId,projectId,fileRole] 幂等 upsert，create/update 含 wrappedDek 与哈希', async () => {
      prisma.bidFileBackup.upsert.mockResolvedValue({});
      const staged: StagedBackup = {
        fileAssetId: 'a1', fileRole: 'technical', backupKey: 'bk', sealedPath: 'sp',
        wrappedDek: 'wd', ciphertextSha256: 'csha', plaintextSha256: 'psha', size: 5,
      };
      await service.persistBackup(prisma, staged, {
        projectId: 'p1', supplierId: 's1', receiptNo: 'TB-1', submittedAt: new Date('2026-01-01'), backupSource: 'submission',
      });
      expect(prisma.bidFileBackup.upsert).toHaveBeenCalledWith({
        where: { supplierId_projectId_fileRole: { supplierId: 's1', projectId: 'p1', fileRole: 'technical' } },
        update: expect.objectContaining({ backupKey: 'bk', wrappedDek: 'wd', ciphertextSha256: 'csha', backupSource: 'submission', cryptoVersion: 'envelope-v1' }),
        create: expect.objectContaining({ projectId: 'p1', supplierId: 's1', fileRole: 'technical', backupKey: 'bk', wrappedDek: 'wd' }),
      });
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test bid-backup
```

Expected: FAIL — `Cannot find module './bid-backup.service'`。

- [ ] **Step 3: 实现 service（含全部类型 + 核心方法）**

创建 `apps/api/src/bid-backup/bid-backup.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

export type BackupFileRole = 'technical' | 'business' | 'coverLetter';

/** 封标时暂存的备份元数据（putObject 成功后，在事务内固化为 BidFileBackup 行） */
export interface StagedBackup {
  fileAssetId: string;
  fileRole: BackupFileRole;
  backupKey: string;
  sealedPath: string;
  wrappedDek: string;
  ciphertextSha256: string;
  plaintextSha256: string | null;
  size: number;
}

export interface BackupVerifyFileResult {
  fileRole: BackupFileRole;
  status: 'consistent' | 'tampered' | 'missing';
  backupIntact: boolean | null;
  sealedMatchesBackup: boolean | null;
  recordedSha256: string | null;
  backupSha256: string | null;
  sealedSha256: string | null;
  backupSource: string | null;
  submittedAt: Date | null;
}

export interface BackupVerifyResult {
  projectId: string;
  supplierId: string;
  receiptNo: string | null;
  overall: 'consistent' | 'tampered' | 'missing';
  perFile: BackupVerifyFileResult[];
}

const CRYPTO_VERSION = 'envelope-v1';

@Injectable()
export class BidBackupService {
  private readonly logger = new Logger(BidBackupService.name);
  /** opt-out：默认开启；设 BID_BACKUP_ENABLED=false 关停回到现状 */
  private readonly enabled = process.env.BID_BACKUP_ENABLED !== 'false';

  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 备份对象键：独立前缀 sealed-backup/，与 sealed/ 隔离；现有删除路径不触碰此前缀 */
  buildBackupKey(projectId: string, supplierId: string, fileRole: BackupFileRole, sealedPath: string): string {
    const basename = sealedPath.split('/').pop() || `${fileRole}.enc`;
    return `sealed-backup/${projectId}/${supplierId}/${fileRole}/${basename}`;
  }

  computeSha256(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  /**
   * 封标时调用：把内存中的密文 best-effort 备份到独立前缀。
   * 失败不抛（不阻断投标），返回 null 表示本次未备份（交由 reconcileMissing 补备）。
   * 只写密文，永不解密。
   */
  async stageBackup(input: {
    projectId: string;
    supplierId: string;
    fileRole: BackupFileRole;
    fileAssetId: string;
    sealedPath: string;
    ciphertext: Buffer;
    wrappedDek: string;
    plaintextSha256: string | null;
  }): Promise<StagedBackup | null> {
    if (!this.enabled) return null;
    const backupKey = this.buildBackupKey(input.projectId, input.supplierId, input.fileRole, input.sealedPath);
    const ciphertextSha256 = this.computeSha256(input.ciphertext);
    try {
      await minioClient.putObject(MINIO_BUCKET, backupKey, input.ciphertext, input.ciphertext.length, {
        'Content-Type': 'application/octet-stream',
      });
    } catch (err) {
      this.logger.warn(
        `投标文件备份写入失败，待后台补备: projectId=${input.projectId} supplierId=${input.supplierId} role=${input.fileRole} backupKey=${backupKey} err=${(err as Error).message}`,
      );
      return null;
    }
    return {
      fileAssetId: input.fileAssetId,
      fileRole: input.fileRole,
      backupKey,
      sealedPath: input.sealedPath,
      wrappedDek: input.wrappedDek,
      ciphertextSha256,
      plaintextSha256: input.plaintextSha256,
      size: input.ciphertext.length,
    };
  }

  /** 在 submitBid 事务内调用：把已 staged 的备份固化为 BidFileBackup 行（@@unique 幂等 upsert） */
  async persistBackup(
    tx: Prisma.TransactionClient,
    staged: StagedBackup,
    meta: { projectId: string; supplierId: string; receiptNo: string | null; submittedAt: Date; backupSource: string },
  ): Promise<void> {
    const data = {
      fileAssetId: staged.fileAssetId,
      backupKey: staged.backupKey,
      sealedPath: staged.sealedPath,
      wrappedDek: staged.wrappedDek,
      ciphertextSha256: staged.ciphertextSha256,
      plaintextSha256: staged.plaintextSha256,
      size: staged.size,
      receiptNo: meta.receiptNo,
      submittedAt: meta.submittedAt,
      backupSource: meta.backupSource,
      cryptoVersion: CRYPTO_VERSION,
    };
    await tx.bidFileBackup.upsert({
      where: {
        supplierId_projectId_fileRole: { supplierId: meta.supplierId, projectId: meta.projectId, fileRole: staged.fileRole },
      },
      update: data,
      create: { projectId: meta.projectId, supplierId: meta.supplierId, fileRole: staged.fileRole, ...data },
    });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test bid-backup
```

Expected: PASS（6 个用例：buildBackupKey、computeSha256、stageBackup×3、persistBackup）。

- [ ] **Step 5: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/apps/api/src/bid-backup/bid-backup.service.ts water-erp/apps/api/src/bid-backup/bid-backup.service.spec.ts
git commit -m "feat(api): BidBackupService 核心——密文 best-effort 备份 + 幂等固化"
```

---

## Task 3: 后台补备 `reconcileMissing`（@Cron）— TDD

**Files:**
- Modify: `apps/api/src/bid-backup/bid-backup.service.ts`（新增 import + `lookupReceiptNo` + `reconcileMissing`）
- Modify: `apps/api/src/bid-backup/bid-backup.service.spec.ts`（新增 `fakeStream` 已有 + reconcile 用例）

**Interfaces:**
- Consumes: `streamToBuffer`（`../announcement/bid-document.crypto`）、`Cron`（`@nestjs/schedule`，已在 deps）、`prisma.supplierBidSubmission.findMany` / `prisma.bidFileBackup.findUnique` / `prisma.fileAsset.findUnique` / `prisma.bidSupplier.findFirst`、`minioClient.getObject`。
- Produces: `reconcileMissing(): Promise<number>`（返回补齐份数）。

- [ ] **Step 1: 先写失败测试（在 spec 的 describe('BidBackupService') 内追加）**

```typescript
  describe('reconcileMissing', () => {
    it('功能关闭：直接返回 0，不查询', async () => {
      process.env.BID_BACKUP_ENABLED = 'false';
      const module: TestingModule = await Test.createTestingModule({
        providers: [BidBackupService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      const disabled = module.get(BidBackupService);
      await expect(disabled.reconcileMissing()).resolves.toBe(0);
      expect(prisma.supplierBidSubmission.findMany).not.toHaveBeenCalled();
    });

    it('缺失的从 sealedPath 读密文补齐（backupSource=reconcile）', async () => {
      const ciphertext = Buffer.from('sealed-cipher');
      prisma.supplierBidSubmission.findMany.mockResolvedValue([{
        id: 'sub1', supplierId: 's1', projectId: 'p1', submittedAt: new Date('2026-01-01'),
        technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: 'wd', businessSealedKey: null, coverLetterSealedKey: null,
      }]);
      prisma.bidFileBackup.findUnique.mockResolvedValue(null); // 无备份
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'a1', sealedPath: 'sealed/p1/s1/bid.enc', sha256: 'psha' });
      (minioClient.getObject as jest.Mock).mockResolvedValue(fakeStream(ciphertext));
      (minioClient.putObject as jest.Mock).mockResolvedValue({});
      prisma.bidSupplier.findFirst.mockResolvedValue({ receiptNo: 'TB-9' });
      prisma.bidFileBackup.upsert.mockResolvedValue({});

      const n = await service.reconcileMissing();
      expect(n).toBe(1);
      expect(minioClient.getObject).toHaveBeenCalledWith('test-bucket', 'sealed/p1/s1/bid.enc');
      expect(prisma.bidFileBackup.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ backupSource: 'reconcile', ciphertextSha256: sha(ciphertext), receiptNo: 'TB-9' }),
      }));
    });

    it('已存在备份 → 跳过不补', async () => {
      prisma.supplierBidSubmission.findMany.mockResolvedValue([{
        id: 'sub1', supplierId: 's1', projectId: 'p1', submittedAt: new Date(),
        technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: 'wd', businessSealedKey: null, coverLetterSealedKey: null,
      }]);
      prisma.bidFileBackup.findUnique.mockResolvedValue({ id: 'b1' }); // 已有
      await expect(service.reconcileMissing()).resolves.toBe(0);
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('单条补备失败不中断整体', async () => {
      prisma.supplierBidSubmission.findMany.mockResolvedValue([{
        id: 'sub1', supplierId: 's1', projectId: 'p1', submittedAt: new Date(),
        technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: 'wd', businessSealedKey: null, coverLetterSealedKey: null,
      }]);
      prisma.bidFileBackup.findUnique.mockResolvedValue(null);
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'a1', sealedPath: 'sealed/x.enc', sha256: 'p' });
      (minioClient.getObject as jest.Mock).mockRejectedValue(new Error('read fail'));
      await expect(service.reconcileMissing()).resolves.toBe(0);
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test bid-backup
```

Expected: FAIL — `service.reconcileMissing is not a function`。

- [ ] **Step 3: 实现（在 service 顶部加 import，类内加两方法）**

在 `bid-backup.service.ts` 的 import 区追加：

```typescript
import { Cron } from '@nestjs/schedule';
import { streamToBuffer } from '../announcement/bid-document.crypto';
```

（`@nestjs/common` 的 import 保持不变；`Logger` 已在。）

在 `persistBackup` 方法之后、类结束 `}` 之前追加：

```typescript
  private async lookupReceiptNo(projectId: string, supplierId: string): Promise<string | null> {
    const bs = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId }, select: { receiptNo: true } });
    return bs?.receiptNo ?? null;
  }

  /** 每 15 分钟：为已提交但缺备份的记录，从 sealedPath 读密文补齐。仍只碰密文，不解密。 */
  @Cron('*/15 * * * *')
  async reconcileMissing(): Promise<number> {
    if (!this.enabled) return 0;
    const submissions = await this.prisma.supplierBidSubmission.findMany({
      where: { status: 'submitted' },
      select: {
        id: true, supplierId: true, projectId: true, submittedAt: true,
        technicalFileAssetId: true, businessFileAssetId: true, coverLetterAssetId: true,
        technicalSealedKey: true, businessSealedKey: true, coverLetterSealedKey: true,
      },
    });
    let fixed = 0;
    for (const sub of submissions) {
      const candidates: Array<{ role: BackupFileRole; assetId: string | null; sealedKey: string | null }> = [
        { role: 'technical', assetId: sub.technicalFileAssetId, sealedKey: sub.technicalSealedKey },
        { role: 'business', assetId: sub.businessFileAssetId, sealedKey: sub.businessSealedKey },
        { role: 'coverLetter', assetId: sub.coverLetterAssetId, sealedKey: sub.coverLetterSealedKey },
      ];
      for (const c of candidates) {
        if (!c.assetId || !c.sealedKey) continue; // 无该文件或 legacy 未封标 → 跳过
        const existing = await this.prisma.bidFileBackup.findUnique({
          where: { supplierId_projectId_fileRole: { supplierId: sub.supplierId, projectId: sub.projectId, fileRole: c.role } },
        });
        if (existing) continue;
        try {
          const asset = await this.prisma.fileAsset.findUnique({ where: { id: c.assetId } });
          if (!asset?.sealedPath) continue;
          const ciphertext = await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, asset.sealedPath));
          const staged: StagedBackup = {
            fileAssetId: c.assetId,
            fileRole: c.role,
            backupKey: this.buildBackupKey(sub.projectId, sub.supplierId, c.role, asset.sealedPath),
            sealedPath: asset.sealedPath,
            wrappedDek: c.sealedKey,
            ciphertextSha256: this.computeSha256(ciphertext),
            plaintextSha256: asset.sha256 ?? null,
            size: ciphertext.length,
          };
          await minioClient.putObject(MINIO_BUCKET, staged.backupKey, ciphertext, ciphertext.length, {
            'Content-Type': 'application/octet-stream',
          });
          const receiptNo = await this.lookupReceiptNo(sub.projectId, sub.supplierId);
          await this.persistBackup(this.prisma, staged, {
            projectId: sub.projectId, supplierId: sub.supplierId, receiptNo,
            submittedAt: sub.submittedAt ?? new Date(), backupSource: 'reconcile',
          });
          fixed++;
        } catch (err) {
          this.logger.warn(`投标文件补备失败: submission=${sub.id} role=${c.role} err=${(err as Error).message}`);
        }
      }
    }
    if (fixed > 0) this.logger.log(`投标文件补备完成：补齐 ${fixed} 份`);
    return fixed;
  }
```

> 说明：`this.prisma`（PrismaService extends PrismaClient）可赋值给 `Prisma.TransactionClient` 形参（后者是前者去掉 `$transaction` 等的子集），无需强转。

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test bid-backup
```

Expected: PASS（新增 4 个 reconcile 用例全绿，共 10 个）。

- [ ] **Step 5: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/apps/api/src/bid-backup/bid-backup.service.ts water-erp/apps/api/src/bid-backup/bid-backup.service.spec.ts
git commit -m "feat(api): BidBackupService 后台补备 @Cron——扫描缺失项从 sealedPath 补齐"
```

---

## Task 4: 核验 `verify`（三方哈希比对）— TDD

**Files:**
- Modify: `apps/api/src/bid-backup/bid-backup.service.ts`（新增 `verify`）
- Modify: `apps/api/src/bid-backup/bid-backup.service.spec.ts`（新增 verify 用例）

**Interfaces:**
- Consumes: `prisma.supplierBidSubmission.findUnique` / `prisma.bidFileBackup.findUnique` / `prisma.auditLog.create`、`lookupReceiptNo`、`minioClient.getObject`、`streamToBuffer`。
- Produces: `verify(projectId, supplierId, actorId?): Promise<BackupVerifyResult>`。
- 语义：`backupIntact = sha256(getObject(backupKey)) === 入库 ciphertextSha256`；`sealedMatchesBackup = sha256(getObject(backup.sealedPath)) === sha256(备份密文)`；**全程只读密文算哈希，不解密、不返回内容**。

- [ ] **Step 1: 先写失败测试（在 spec 内追加）**

```typescript
  describe('verify', () => {
    it('无提交记录 → overall=missing，perFile 为空', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      const r = await service.verify('p1', 's1');
      expect(r.overall).toBe('missing');
      expect(r.perFile).toEqual([]);
    });

    it('备份与 sealed 密文一致 → consistent，且写审计', async () => {
      const cipher = Buffer.from('same-cipher');
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null });
      prisma.bidSupplier.findFirst.mockResolvedValue({ receiptNo: 'TB-1' });
      prisma.bidFileBackup.findUnique.mockResolvedValue({ ciphertextSha256: sha(cipher), backupKey: 'bk', sealedPath: 'sp', backupSource: 'submission', submittedAt: new Date() });
      (minioClient.getObject as jest.Mock).mockResolvedValue(fakeStream(cipher));
      const r = await service.verify('p1', 's1', 'actor1');
      expect(r.overall).toBe('consistent');
      expect(r.perFile[0]).toMatchObject({ fileRole: 'technical', status: 'consistent', backupIntact: true, sealedMatchesBackup: true });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('sealed 密文与备份不一致 → tampered', async () => {
      const backupBuf = Buffer.from('backup-cipher');
      const sealedBuf = Buffer.from('TAMPERED');
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidFileBackup.findUnique.mockResolvedValue({ ciphertextSha256: sha(backupBuf), backupKey: 'bk', sealedPath: 'sp', backupSource: 'submission', submittedAt: new Date() });
      (minioClient.getObject as jest.Mock)
        .mockResolvedValueOnce(fakeStream(backupBuf))   // 第一次读 backupKey
        .mockResolvedValueOnce(fakeStream(sealedBuf));  // 第二次读 sealedPath
      const r = await service.verify('p1', 's1');
      expect(r.overall).toBe('tampered');
      expect(r.perFile[0].sealedMatchesBackup).toBe(false);
    });

    it('期望文件缺备份行 → 该文件 missing，overall=missing', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidFileBackup.findUnique.mockResolvedValue(null);
      const r = await service.verify('p1', 's1');
      expect(r.overall).toBe('missing');
      expect(r.perFile[0].status).toBe('missing');
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test bid-backup
```

Expected: FAIL — `service.verify is not a function`。

- [ ] **Step 3: 实现 verify（在 `reconcileMissing` 之后、类结束前追加）**

```typescript
  /**
   * 争议核验：三方哈希比对，只读密文算哈希，绝不解密、绝不返回内容。
   * a) backupIntact：备份对象自身 sha256 == 入库 ciphertextSha256（备份未被篡改）
   * b) sealedMatchesBackup：开标读取的 sealedPath 密文 sha256 == 备份密文 sha256（开标内容 == 提交内容）
   */
  async verify(projectId: string, supplierId: string, actorId?: string): Promise<BackupVerifyResult> {
    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    const receiptNo = await this.lookupReceiptNo(projectId, supplierId);
    const expected: Array<{ role: BackupFileRole; assetId: string }> = submission
      ? ([
          { role: 'technical', assetId: submission.technicalFileAssetId },
          { role: 'business', assetId: submission.businessFileAssetId },
          { role: 'coverLetter', assetId: submission.coverLetterAssetId },
        ].filter(x => !!x.assetId) as Array<{ role: BackupFileRole; assetId: string }>)
      : [];

    const perFile: BackupVerifyFileResult[] = [];
    for (const e of expected) {
      const backup = await this.prisma.bidFileBackup.findUnique({
        where: { supplierId_projectId_fileRole: { supplierId, projectId, fileRole: e.role } },
      });
      if (!backup) {
        perFile.push({ fileRole: e.role, status: 'missing', backupIntact: null, sealedMatchesBackup: null, recordedSha256: null, backupSha256: null, sealedSha256: null, backupSource: null, submittedAt: null });
        continue;
      }
      let backupSha256: string | null = null;
      let sealedSha256: string | null = null;
      try { backupSha256 = this.computeSha256(await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, backup.backupKey))); } catch { backupSha256 = null; }
      try { sealedSha256 = this.computeSha256(await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, backup.sealedPath))); } catch { sealedSha256 = null; }
      const backupIntact = backupSha256 !== null && backupSha256 === backup.ciphertextSha256;
      const sealedMatchesBackup = backupSha256 !== null && sealedSha256 !== null && sealedSha256 === backupSha256;
      const status: BackupVerifyFileResult['status'] = backupIntact && sealedMatchesBackup ? 'consistent' : 'tampered';
      perFile.push({ fileRole: e.role, status, backupIntact, sealedMatchesBackup, recordedSha256: backup.ciphertextSha256, backupSha256, sealedSha256, backupSource: backup.backupSource, submittedAt: backup.submittedAt });
    }

    let overall: BackupVerifyResult['overall'];
    if (perFile.length === 0) overall = 'missing';
    else if (perFile.some(f => f.status === 'tampered')) overall = 'tampered';
    else if (perFile.some(f => f.status === 'missing')) overall = 'missing';
    else overall = 'consistent';

    if (actorId) {
      await this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'BID_BACKUP_VERIFY',
          resourceType: 'sealed-bid-backup',
          resourceId: `${projectId}:${supplierId}`,
          details: { overall, perFile: perFile.map(f => ({ role: f.fileRole, status: f.status })) },
        },
      }).catch(() => {}); // 审计失败不影响核验结果
    }
    return { projectId, supplierId, receiptNo, overall, perFile };
  }
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test bid-backup
```

Expected: PASS（新增 4 个 verify 用例，共 14 个全绿）。

- [ ] **Step 5: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/apps/api/src/bid-backup/bid-backup.service.ts water-erp/apps/api/src/bid-backup/bid-backup.service.spec.ts
git commit -m "feat(api): BidBackupService 核验——三方哈希比对 + 审计留痕（只读密文）"
```

---

## Task 5: 模块装配 + 核验端点 + feature flag

**Files:**
- Create: `apps/api/src/bid-backup/bid-backup.module.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.module.ts`（imports 增 `BidBackupModule`）
- Modify: `apps/api/src/bid/bid.module.ts`（imports 增 `BidBackupModule`）
- Modify: `apps/api/src/bid/bid.controller.ts`（注入 + 端点）
- Modify: `apps/api/.env`（追加 flag）

**Interfaces:**
- Consumes: `BidBackupService`（Task 2-4）、`Roles` / `CurrentUser` 装饰器（既有）。
- Produces: `GET /api/bid/projects/:id/backup-verify/:supplierId`（仅 admin/bid_host）。

- [ ] **Step 1: 创建 BidBackupModule**

创建 `apps/api/src/bid-backup/bid-backup.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BidBackupService } from './bid-backup.service';

/**
 * 未解密投标文件备份模块。被 SupplierPortalModule（写入钩子）与 BidModule（核验端点）共同导入；
 * Nest 去重为单例，@Cron 补备任务仅注册一次。ScheduleModule.forRoot() 已由 SchedulerModule 全局注册。
 */
@Module({
  imports: [PrismaModule],
  providers: [BidBackupService],
  exports: [BidBackupService],
})
export class BidBackupModule {}
```

- [ ] **Step 2: SupplierPortalModule 导入**

编辑 `apps/api/src/supplier-portal/supplier-portal.module.ts`：

import 区追加：
```typescript
import { BidBackupModule } from '../bid-backup/bid-backup.module';
```
`imports` 数组改为：
```typescript
  imports: [AuthModule, PrismaModule, AnnouncementModule, BidBackupModule],
```

- [ ] **Step 3: BidModule 导入**

编辑 `apps/api/src/bid/bid.module.ts`：

import 区追加：
```typescript
import { BidBackupModule } from '../bid-backup/bid-backup.module';
```
`imports` 数组末尾追加 `BidBackupModule`：
```typescript
  imports: [
    AuthModule,
    PrismaModule,
    NotificationModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.TENDER_PROCESSING }),
    AiBidAnalysisModule,
    BidBackupModule,
  ],
```

- [ ] **Step 4: BidController 注入 + 核验端点**

编辑 `apps/api/src/bid/bid.controller.ts`。

import 区追加：
```typescript
import { BidBackupService } from '../bid-backup/bid-backup.service';
```

构造函数追加注入：
```typescript
  constructor(
    private readonly bidService: BidService,
    private readonly scorePointExtractor: ScorePointExtractorService,
    private readonly bidBackup: BidBackupService,
  ) {}
```

在 `decryptSupplier` 端点（约 :144-147）之后追加端点（方法级 `@Roles('admin','bid_host')` 覆盖类级角色）：

```typescript
  @Get('projects/:id/backup-verify/:supplierId')
  @ApiOperation({ summary: '核验未解密投标文件备份（争议举证：三方哈希比对，只读，仅 admin/bid_host）' })
  @Roles('admin', 'bid_host')
  verifyBackup(@Param('id') id: string, @Param('supplierId') supplierId: string, @CurrentUser('sub') userId?: string) {
    return this.bidBackup.verify(id, supplierId, userId);
  }
```

- [ ] **Step 5: 追加 feature flag 到 .env**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
grep -q '^BID_BACKUP_ENABLED=' .env || printf '\n# 未解密投标文件备份开关（opt-out，默认开启；设 false 关停回到现状）\nBID_BACKUP_ENABLED=true\n' >> .env
```

Expected: `.env` 末尾出现 `BID_BACKUP_ENABLED=true`（若已存在则不重复）。

- [ ] **Step 6: 构建校验（类型 + DI 图）**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm build
```

Expected: 构建成功，无 TS / 依赖注入错误。

- [ ] **Step 7: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/apps/api/src/bid-backup/bid-backup.module.ts \
        water-erp/apps/api/src/supplier-portal/supplier-portal.module.ts \
        water-erp/apps/api/src/bid/bid.module.ts \
        water-erp/apps/api/src/bid/bid.controller.ts \
        water-erp/apps/api/.env
git commit -m "feat(api): 装配 BidBackupModule + 核验端点（admin/bid_host）+ feature flag"
```

---

## Task 6: `submitBid` 写入钩子 + e2e

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（注入 + 封标循环 stage + 事务 persist + receiptNo 捕获 + 清理）
- Create: `apps/api/test/sealed-bid-backup.e2e-spec.ts`

**Interfaces:**
- Consumes: `BidBackupService.stageBackup` / `persistBackup`（Task 2）、`submitBid` 现有封标变量（`ciphertext` / `sealedPath` / `sealedKeys` / `asset` / `newlySealedPaths`）。
- Produces: 提交成功后即生成 `BidFileBackup`（`backupSource='submission'`）；失败不阻断提交。

- [ ] **Step 1: 先写 e2e（此时钩子未实现，提交后不会有备份行 → 红）**

创建 `apps/api/test/sealed-bid-backup.e2e-spec.ts`：

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { minioClient, MINIO_BUCKET, ensureBucket } from '../src/upload/minio.client';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login').set('X-Portal', portal).send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

async function readAll(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

describe('Sealed Bid Backup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let supplierCookie: string[];
  let projectId: string;
  let supplierId: string;
  let assetId: string;

  const plaintext = Buffer.from('E2E 投标文件内容 ' + Date.now(), 'utf-8');
  const plainSha = crypto.createHash('sha256').update(plaintext).digest('hex');
  const assetKey = `e2e/bid-${Date.now()}.txt`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await ensureBucket();

    prisma = app.get(PrismaService);
    adminCookie = await loginAs(app, '陈源远', '陈源远@2026', 'web');       // web 门户解析为 bid_host
    supplierCookie = await loginAs(app, 'supplier1', 'supplier1@2026', 'supplier');

    const user = await prisma.user.findUnique({ where: { username: 'supplier1' } });
    const supplier = await prisma.supplier.findUnique({ where: { userId: user!.id } });
    supplierId = supplier!.id;

    // 建项目并强制进入 SUBMIT 阶段、截止时间设为未来
    const pres = await request(app.getHttpServer())
      .post('/api/bid/projects').set('Cookie', adminCookie).set('X-Portal', 'web')
      .send({ name: `E2E备份-${Date.now()}`, procurementMethod: '公开招标', openTime: '2099-12-31T09:00:00Z', deadline: '2099-12-30T17:00:00Z' })
      .expect(201);
    projectId = pres.body.id;
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'SUBMIT', deadline: new Date('2099-12-30T17:00:00Z') } });

    // 造一个 supplier1 名下的 bid_document FileAsset，并把明文写入 MinIO（供 submit 读取加密）
    const asset = await prisma.fileAsset.create({
      data: { key: assetKey, originalName: 'bid.txt', mimeType: 'text/plain', size: plaintext.length, sha256: plainSha, category: 'bid_document', uploaderId: user!.id, encrypted: false },
    });
    assetId = asset.id;
    await minioClient.putObject(MINIO_BUCKET, assetKey, plaintext, plaintext.length, { 'Content-Type': 'text/plain' });
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.bidFileBackup.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.supplierBidSubmission.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupervisionLog.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupplier.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidProject.delete({ where: { id: projectId } }).catch(() => {});
    }
    if (assetId) await prisma.fileAsset.deleteMany({ where: { id: assetId } }).catch(() => {});
    await minioClient.removeObject(MINIO_BUCKET, assetKey).catch(() => {});
    await app.close();
  });

  it('非 admin/bid_host（supplier）调用核验端点 → 403', async () => {
    await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/backup-verify/${supplierId}`)
      .set('Cookie', supplierCookie).set('X-Portal', 'supplier')
      .expect(403);
  });

  it('供应商提交后生成未解密备份行（密文 + sha256 + wrappedDek）', async () => {
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${projectId}/submit`)
      .set('Cookie', supplierCookie).set('X-Portal', 'supplier')
      .send({ technicalFileAssetId: assetId, bidPrice: '1000000', deliveryPeriod: '90天' })
      .expect(201);

    const submission = await prisma.supplierBidSubmission.findUnique({ where: { supplierId_projectId: { supplierId, projectId } } });
    expect(submission!.status).toBe('submitted');
    expect(submission!.technicalSealedKey).toBeTruthy();

    const backup = await prisma.bidFileBackup.findUnique({ where: { supplierId_projectId_fileRole: { supplierId, projectId, fileRole: 'technical' } } });
    expect(backup).toBeTruthy();
    expect(backup!.backupSource).toBe('submission');
    expect(backup!.sealedPath).toBeTruthy();
    expect(backup!.wrappedDek).toBe(submission!.technicalSealedKey);

    // 备份对象确实存在于 MinIO，且 sha256 与入库记录一致
    const buf = await readAll(await minioClient.getObject(MINIO_BUCKET, backup!.backupKey));
    expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(backup!.ciphertextSha256);
  });

  it('核验端点：提交后 overall=consistent，sealed 与备份密文一致', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/backup-verify/${supplierId}`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .expect(200);
    expect(res.body.overall).toBe('consistent');
    const tech = res.body.perFile.find((f: any) => f.fileRole === 'technical');
    expect(tech.backupIntact).toBe(true);
    expect(tech.sealedMatchesBackup).toBe(true);
  });

  it('篡改 sealedPath 密文后核验 → tampered', async () => {
    const backup = await prisma.bidFileBackup.findUnique({ where: { supplierId_projectId_fileRole: { supplierId, projectId, fileRole: 'technical' } } });
    await minioClient.putObject(MINIO_BUCKET, backup!.sealedPath, Buffer.from('tampered'), 8, { 'Content-Type': 'application/octet-stream' });
    const res = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/backup-verify/${supplierId}`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .expect(200);
    expect(res.body.overall).toBe('tampered');
    expect(res.body.perFile.find((f: any) => f.fileRole === 'technical').sealedMatchesBackup).toBe(false);
  });
});
```

- [ ] **Step 2: 运行 e2e 确认失败（备份行尚未生成）**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test:e2e sealed-bid-backup.e2e-spec
```

Expected: FAIL —— 「供应商提交后生成未解密备份行」断言 `expect(backup).toBeTruthy()` 失败（backup 为 null）。RBAC 403 用例可能已绿。

- [ ] **Step 3: 实现钩子——imports + 注入**

编辑 `apps/api/src/supplier-portal/supplier-portal.service.ts`。

在 import 区（`import { minioClient, MINIO_BUCKET } ...` 之后，约 :13）追加：

```typescript
import { BidBackupService, BackupFileRole, StagedBackup } from '../bid-backup/bid-backup.service';
```

构造函数（约 :53-59）追加注入：

```typescript
  constructor(
    private prisma: PrismaService,
    private bidDocumentService: BidDocumentService,
    private signatureService: SignatureService,
    private bidBackup: BidBackupService,
  ) {}
```

- [ ] **Step 4: 封标循环——准备 role 映射 + staged 收集**

在 `submitBid` 内，定位现有片段（约 :483-486）：

```typescript
    const assetIds = [data.technicalFileAssetId, data.businessFileAssetId, data.coverLetterAssetId].filter(Boolean) as string[];
    const sealedKeys: Record<string, string> = {};
    const sealedPaths: Record<string, string> = {};
    const newlySealedPaths: string[] = []; // for cleanup on failure
```

替换为（追加 role 映射与 staged 收集）：

```typescript
    const assetIds = [data.technicalFileAssetId, data.businessFileAssetId, data.coverLetterAssetId].filter(Boolean) as string[];
    const sealedKeys: Record<string, string> = {};
    const sealedPaths: Record<string, string> = {};
    const newlySealedPaths: string[] = []; // for cleanup on failure
    const assetRoles: Record<string, BackupFileRole> = {};
    if (data.technicalFileAssetId) assetRoles[data.technicalFileAssetId] = 'technical';
    if (data.businessFileAssetId) assetRoles[data.businessFileAssetId] = 'business';
    if (data.coverLetterAssetId) assetRoles[data.coverLetterAssetId] = 'coverLetter';
    const stagedBackups: StagedBackup[] = []; // 提交时即备份（未解密态），best-effort
```

- [ ] **Step 5: 封标循环——putObject(sealedPath) 后追加备份 stage**

定位现有片段（封标循环内）：

```typescript
        sealedPaths[assetId] = sealedPath;
        newlySealedPaths.push(sealedPath);
```

替换为：

```typescript
        sealedPaths[assetId] = sealedPath;
        newlySealedPaths.push(sealedPath);

        // ── 未解密备份：复用内存密文 best-effort 备份到独立前缀；失败不阻断提交（交后台补备）──
        const staged = await this.bidBackup.stageBackup({
          projectId, supplierId, fileRole: assetRoles[assetId],
          fileAssetId: assetId, sealedPath, ciphertext,
          wrappedDek: sealedKeys[assetId], plaintextSha256: asset.sha256 ?? null,
        });
        if (staged) {
          stagedBackups.push(staged);
          newlySealedPaths.push(staged.backupKey); // 失败回滚时一并清理备份对象
        }
```

- [ ] **Step 6: 事务内——捕获 receiptNo + 固化备份**

定位现有片段（事务内 bidSupplier 处理 + return）：

```typescript
        const existingBidSupplier = await tx.bidSupplier.findFirst({
          where: { projectId, supplierName: supplier.name },
        });
        if (existingBidSupplier) {
          await tx.bidSupplier.update({
            where: { id: existingBidSupplier.id },
            data: { supplierId, submitStatus: '已提交', encryptStatus: '密文已校验' },
          });
        } else {
          const receiptNo = `TB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
          await tx.bidSupplier.create({
            data: {
              projectId,
              supplierId,
              supplierName: supplier.name,
              downloadStatus: '已下载',
              submitStatus: '已提交',
              encryptStatus: '密文已校验',
              receiptNo,
            },
          });
        }

        return submission;
```

替换为（`receiptNo` 提升为外层变量 + 事务内固化备份）：

```typescript
        const existingBidSupplier = await tx.bidSupplier.findFirst({
          where: { projectId, supplierName: supplier.name },
        });
        let receiptNo: string | null = existingBidSupplier?.receiptNo ?? null;
        if (existingBidSupplier) {
          await tx.bidSupplier.update({
            where: { id: existingBidSupplier.id },
            data: { supplierId, submitStatus: '已提交', encryptStatus: '密文已校验' },
          });
        } else {
          receiptNo = `TB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
          await tx.bidSupplier.create({
            data: {
              projectId,
              supplierId,
              supplierName: supplier.name,
              downloadStatus: '已下载',
              submitStatus: '已提交',
              encryptStatus: '密文已校验',
              receiptNo,
            },
          });
        }

        // ── 固化未解密备份：把封标时 staged 的密文备份写入 BidFileBackup（事务内，幂等 upsert）──
        for (const staged of stagedBackups) {
          await this.bidBackup.persistBackup(tx, staged, { projectId, supplierId, receiptNo, submittedAt: now, backupSource: 'submission' });
        }

        return submission;
```

- [ ] **Step 7: 运行 e2e 确认通过**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test:e2e sealed-bid-backup.e2e-spec
```

Expected: PASS（4 个用例：403、备份行生成、consistent、tampered）。

- [ ] **Step 8: 跑全量单测 + 构建，确保无回归**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
pnpm test
pnpm build
```

Expected: 单测全绿；构建成功。（supplier-portal 现有单测若 mock 了构造函数依赖，需补 `BidBackupService` 的 mock provider——若报 "can't resolve BidBackupService"，在相应 spec 的 providers 加 `{ provide: BidBackupService, useValue: { stageBackup: jest.fn().mockResolvedValue(null), persistBackup: jest.fn() } }`。）

- [ ] **Step 9: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/apps/api/src/supplier-portal/supplier-portal.service.ts \
        water-erp/apps/api/test/sealed-bid-backup.e2e-spec.ts \
        water-erp/apps/api/src/supplier-portal/*.spec.ts
git commit -m "feat(api): submitBid 提交时即备份未解密投标文件 + e2e（核验/篡改/RBAC）"
```

---

## Task 7: 文档告知条款（合规护栏，文档层面）

**Files:**
- Modify: 供应商投标须知 / 平台服务协议文档（如 `water-erp/docs/` 下相应文档；若无则在 `docs/` 记录待办）

**Interfaces:**
- Consumes: 无。Produces: 一段留存告知文字。

- [ ] **Step 1: 在投标须知/服务协议补充告知条款**

加入类似表述（具体措辞由业务/法务定稿）：

> 为保障招投标活动的真实性与可追溯性，平台将在供应商提交投标文件后，对**加密状态**的投标文件进行留存备份。该备份仅为加密密文，平台在开标前不会解密或提取其内容；留存数据用于开标核验及争议处理，留存期限不少于相关法规要求的招投标文件保存年限。

- [ ] **Step 2: 在 spec 文档勾选合规护栏落实状态（可选）**

在 `water-erp/docs/superpowers/specs/2026-07-22-sealed-bid-backup-design.md` §10 标注各护栏对应实现位置（备份只存密文→Task 2/4；访问隔离→sealed-backup 前缀；最小权限→Task 5 `@Roles`；告知→本任务）。

- [ ] **Step 3: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/docs/
git commit -m "docs: 未解密投标文件备份——供应商留存告知条款 + 合规护栏落实说明"
```

---

## Self-Review 结论

- **Spec 覆盖**：§1 目标→Task 6；§2 合规→Task 7 + 各任务护栏；§3 决策→全部落实（内部自证级=Task 2-4、尽力而为+补备=Task 2/3、核验 API=Task 4/5、自包含 wrappedDek=Task 2 模型、KMS 托管=spec §8.2 文档）；§4 数据流→Task 6；§5 模型→Task 1；§6 写入→Task 2/6；§7 补备→Task 3；§8 解密/托管→模型 cryptoVersion + spec 文档；§9 核验→Task 4/5；§10 护栏→Task 5/7；§11 flag→Task 2/5；§12 YAGNI→未做项均标注；§13 测试→Task 2-4/6；§14 文件→File Structure。
- **占位符扫描**：无 TBD/TODO；每步含完整代码或命令。
- **类型一致性**：`StagedBackup` / `BackupFileRole` / `BackupVerifyResult` / `persistBackup(tx, staged, meta)` / `stageBackup(input)` / `verify(projectId, supplierId, actorId?)` 在各任务间签名一致；复合键名 `supplierId_projectId_fileRole` 全程一致；`backupSource` 取值 `submission`/`reconcile` 一致。
- **一处刻意收窄**：spec §9 step 3「已解密时复用 verifyIntegrity 校验明文」为可选项，本计划**不实现**——核验端点严格只读密文算哈希、永不解密（与 spec §8.1/§10「核验只比哈希、无需解密」原则一致）；明文完整性已在开标解密（`decryptSupplier`）时由现有 `verifyIntegrity` 校验。
