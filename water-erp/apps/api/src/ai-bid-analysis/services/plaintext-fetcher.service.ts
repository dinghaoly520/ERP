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
  constructor(private prisma: PrismaService) {}

  /**
   * 获取供应商投标文件明文（方案 5.2）
   * ★ sealedKey 可空：有则 AES 解密，无则明文直读（兼容存量）
   * 复用 bid.service decryptSupplier 的解密逻辑（668-694）
   */
  async fetchBidderPlaintext(
    bidSupplierId: string,
    which: BidderFileType,
  ): Promise<Buffer> {
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

    return buffer;
  }

  /**
   * 获取招标文件明文（方案 4.1 链路：BidProject → Announcement → BidDocument → FileAsset）
   * TODO: ERP 的 BidProject→Announcement 关联字段待确认（relatedProjectCode?），
   *       确认后补全查询链路；当前返回 null 让调用方降级（TenderExtractor 可用 task.tenderText）
   */
  async fetchTenderPlaintext(_projectId: string): Promise<Buffer | null> {
    // 链路待确认：BidProject.relatedProjectCode → Announcement(type=BID_NOTICE)
    //   → BidDocument(announcementId) → decryptKey + FileAsset
    // 暂返回 null（worker 可降级用 task.tenderText，或手动上传招标文本）
    return null;
  }
}
