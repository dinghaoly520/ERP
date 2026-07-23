import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { streamToBuffer } from '../announcement/bid-document.crypto';
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
}
