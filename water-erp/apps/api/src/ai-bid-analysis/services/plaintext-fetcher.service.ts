// apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts
// 明文获取（方案 5.2）：复用 bid.service decryptSupplier 的解密流程，返回明文 buffer
// fetchBidderPlaintext：供应商投标文件（technical/business/coverLetter）
// fetchTenderPlaintext：招标文件（BidDocument，链路见方案 4.1）
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { minioClient, MINIO_BUCKET } from '../../upload/minio.client';
import { decryptBuffer, streamToBuffer, verifyIntegrity } from '../../bid/bid-submission.crypto';
import { unwrapKey, isWrappedKey } from '../../common/crypto/envelope-crypto';

export type BidderFileType = 'technical' | 'business' | 'coverLetter';

@Injectable()
export class PlaintextFetcherService {
  constructor(private prisma: PrismaService) {
    // wrapped key 场景需要 KMS_SECRET；缺失时启动即 warn（运行时 unwrapKey 会抛错，但有明确日志）
    if (!process.env.KMS_SECRET) {
      console.warn('[PlaintextFetcher] KMS_SECRET 未配置，加密招标文件/投标文件将无法解密');
    }
  }

  /**
   * 获取供应商投标文件明文（方案 5.2）
   * ★ sealedKey 可空：有则 AES 解密，无则明文直读（兼容存量）
   * 复用 bid.service decryptSupplier 的解密逻辑（668-694）
   */
  async fetchBidderPlaintext(
    bidSupplierId: string,
    which: BidderFileType,
  ): Promise<{ buffer: Buffer; fileId: string } | null> {
    const bs = await this.prisma.bidSupplier.findUnique({
      where: { id: bidSupplierId },
      select: { supplierId: true, projectId: true },
    });
    if (!bs) throw new NotFoundException(`BidSupplier ${bidSupplierId} 不存在`);
    if (!bs.supplierId) {
      throw new Error('供应商未关联系统账户，无法查询投标提交');
    }

    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: {
        supplierId_projectId: {
          supplierId: bs.supplierId,
          projectId: bs.projectId,
        },
      },
    });
    if (!submission) throw new Error('供应商未提交投标文件');

    const assetId =
      which === 'technical'
        ? submission.technicalFileAssetId
        : which === 'business'
          ? submission.businessFileAssetId
          : submission.coverLetterAssetId;
    const sealedKey =
      which === 'technical'
        ? submission.technicalSealedKey
        : which === 'business'
          ? submission.businessSealedKey
          : submission.coverLetterSealedKey;

    if (!assetId) throw new Error(`缺少 ${which} 文件引用`);

    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) throw new Error(`文件记录缺失: ${assetId}`);

    // 兼容存量：sealedPath（新）|| key（旧路径）
    const readKey = asset.sealedPath || asset.key;
    let buffer = await streamToBuffer(
      await minioClient.getObject(MINIO_BUCKET, readKey),
    );

    // Layer B：仅当 sealedKey 存在时执行真实 AES 解密；为空则明文直读
    if (sealedKey) {
      const rawKey = isWrappedKey(sealedKey)
        ? unwrapKey(sealedKey, process.env.KMS_SECRET!)
        : sealedKey;
      buffer = decryptBuffer(buffer, rawKey);
    }

    // Layer A：完整性校验（解密后明文 vs 存储 sha256）
    if (verifyIntegrity(buffer, asset.sha256) === false) {
      throw new Error(`${which} 文件完整性校验失败：SHA-256 不匹配`);
    }

    // Task 4: 同时返回 fileId（FileAsset.id，== assetId）供 matcher 跳转定位
    return { buffer, fileId: assetId };
  }

  /**
   * 获取招标文件明文（方案 4.1 链路）
   * BidProject.projectCode → Announcement(relatedProjectCode, BID_NOTICE, PUBLISHED)
   *   → BidDocument(announcementId @unique) → decryptKey + FileAsset
   */
  async fetchTenderPlaintext(projectId: string): Promise<Buffer | null> {
    // 1. BidProject → projectCode
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true },
    });
    if (!project?.projectCode) return null;

    // 2. Announcement（BID_NOTICE 已发布，按 relatedProjectCode 关联）
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        relatedProjectCode: project.projectCode,
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
      },
      select: { id: true },
    });
    if (!announcement) return null;

    // 3. BidDocument（1:1 Announcement）→ decryptKey + fileAssetId
    const bidDocument = await this.prisma.bidDocument.findUnique({
      where: { announcementId: announcement.id },
    });
    if (!bidDocument) return null;

    // 4. FileAsset
    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: bidDocument.fileAssetId },
    });
    if (!asset) return null;

    // 5. 下载 + 解密（decryptKey）+ 完整性校验
    const readKey = asset.sealedPath || asset.key;
    let buffer = await streamToBuffer(
      await minioClient.getObject(MINIO_BUCKET, readKey),
    );

    if (bidDocument.decryptKey) {
      const rawKey = isWrappedKey(bidDocument.decryptKey)
        ? unwrapKey(bidDocument.decryptKey, process.env.KMS_SECRET!)
        : bidDocument.decryptKey;
      buffer = decryptBuffer(buffer, rawKey);
    }

    if (verifyIntegrity(buffer, asset.sha256) === false) {
      throw new Error('招标文件完整性校验失败：SHA-256 不匹配');
    }

    return buffer;
  }
}
