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
