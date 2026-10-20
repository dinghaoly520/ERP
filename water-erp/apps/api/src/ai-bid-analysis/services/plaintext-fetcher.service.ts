// apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts
// 明文获取（方案 5.2）：复用 bid.service decryptSupplier 的解密流程，返回明文 buffer
// fetchBidderPlaintext：供应商投标文件（technical/business/coverLetter）
// fetchTenderPlaintext：招标文件（BidDocument，链路见方案 4.1）；谈判采购项目公告轨恒空
//   → 回退 Redis negotiation-config 轨（refFileKeys=PMI 阶段附件主轨 / FileAsset 兼容轨，2026-10-20）
import { Injectable, NotFoundException, Optional, Inject } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { minioClient, MINIO_BUCKET } from '../../upload/minio.client';
import { decryptBuffer, streamToBuffer, verifyIntegrity } from '../../bid/bid-submission.crypto';
import { unwrapKey, isWrappedKey } from '../../common/crypto/envelope-crypto';
import { resolveEnvelopeVersion } from '../../supplier-portal/envelope-version.util';

export type BidderFileType = 'technical' | 'business' | 'coverLetter';

@Injectable()
export class PlaintextFetcherService {
  constructor(
    private prisma: PrismaService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {
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

    // 双信封新轨（dual-v2/v3，阶段2 Task13 读端分派）：开标解密后 decryptedAssets[role] 存明文 FileAsset id，直接读明文——
    // 旧轨 sealedKey（iv:tag:data AES 包）与新轨 kself（SM2 密文 hex）格式不同，
    // 误走旧轨解密会抛「decryptKey 格式错误」（2026-09-10 实测 AI 投标分析 3 家全挂）。
    const dualTrack = resolveEnvelopeVersion(submission) !== 'legacy';
    const decryptedMap = (submission.decryptedAssets ?? {}) as Record<string, unknown>;
    const decryptedAssetId = decryptedMap[which];
    const assetId = dualTrack && typeof decryptedAssetId === 'string'
      ? decryptedAssetId
      : which === 'technical'
        ? submission.technicalFileAssetId
        : which === 'business'
          ? submission.businessFileAssetId
          : submission.coverLetterAssetId;
    const sealedKey = dualTrack
      ? null
      : which === 'technical'
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
   * 获取招标/采购文件明文（方案 4.1 链路 + 2026-10-20 谈判轨回退）
   * 公告轨：BidDocument 优先 bidProjectId 直连（PUBLISHED 公告名下最新一份）；miss 走
   *   Announcement(relatedProjectCode ∈ {BidProject.projectCode ∪ PMI.projectCode},
   *   BID_NOTICE, PUBLISHED) → BidDocument(announcementId @unique) → decryptKey + FileAsset
   *   （双编号并集：公告实际存 PMI 业务编号，仅按内部编号查恒空——2026-10-20 实录
   *    DMGY-XB-2026100901 内部码 XB-…，tenderText=0、条款提取整链空；同 supplier-portal
   *    resolveAnnouncementCodes 口径）
   * 谈判轨：谈判项目不发布采购公告（邀请书替代），BidDocument 恒空 → Redis
   *   negotiation-config（refFileKeys=PMI 附件主轨 / attachFileIds·refFileKeys 兜底=FileAsset）
   * 返回 { buffer, fileName }（fileName 供 processFile 按扩展名分派 docx/pdf/ocr 路径）。
   */
  async fetchTenderPlaintext(projectId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
    return (await this.fetchBidDocumentTenderFile(projectId))
      ?? (await this.fetchNegotiationTenderFile(projectId));
  }

  /** 公告轨（BidDocument）：任一环节 miss 返回 null（由调用方回退谈判轨）。 */
  private async fetchBidDocumentTenderFile(projectId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
    // 1. BidProject → 内部编号 + PMI 业务编号（公告 relatedProjectCode 的两个候选值）
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true, projectManagementItemId: true },
    });
    if (!project?.projectCode) return null;
    const codes = new Set<string>([project.projectCode]);
    if (project.projectManagementItemId) {
      const pm = await this.prisma.projectManagementItem.findUnique({
        where: { id: project.projectManagementItemId },
        select: { projectCode: true },
      });
      if (pm?.projectCode) codes.add(pm.projectCode);
    }

    // 2. BidDocument 直连优先（不受编码空间撞号影响，2026-09-10 注）：取 PUBLISHED 公告名下
    //    最新一份——同一 bidProject 会因公告重发挂多份，OFFLINE 历史公告的旧版不得被无序
    //    findFirst 捞走（2026-10-20，与 expert.service findTenderDoc 同口径）
    const bidDocument = (await this.prisma.bidDocument.findFirst({
      where: { bidProjectId: projectId, announcement: { status: 'PUBLISHED' } },
      orderBy: { createdAt: 'desc' },
    })) ?? (await this.prisma.bidDocument.findFirst({
      where: { bidProjectId: projectId },
      orderBy: { createdAt: 'desc' },
    }));
    if (bidDocument) return this.readBidDocumentFile(bidDocument);

    // 3. 公告链兜底：双编号并查 Announcement（BID_NOTICE 已发布）→ BidDocument(announcementId)
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        relatedProjectCode: { in: [...codes] },
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
      },
      select: { id: true },
    });
    if (!announcement) return null;
    const doc = await this.prisma.bidDocument.findUnique({
      where: { announcementId: announcement.id },
    });
    if (!doc) return null;
    return this.readBidDocumentFile(doc);
  }

  /** BidDocument → FileAsset 下载 + decryptKey 解密 + 完整性校验（公告轨共用读端） */
  private async readBidDocumentFile(
    bidDocument: { fileAssetId: string | null; decryptKey: string | null },
  ): Promise<{ buffer: Buffer; fileName: string } | null> {
    if (!bidDocument.fileAssetId) return null;
    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: bidDocument.fileAssetId },
    });
    if (!asset) return null;

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

    return { buffer, fileName: asset.originalName };
  }

  /** 谈判配置轨（2026-10-20，与专家端/供应商端同源口径）：Redis negotiation-config
   *  → refFileKeys 主轨=PMI 阶段附件（本地 uploads/ 磁盘，明文无信封，跳过完整性校验）
   *  → 兼容轨=FileAsset（attachFileIds byId / refFileKeys byKey，MinIO；sealedPath/sealedKey
   *    资产按 /upload streamFile 同口径解封）。取第一件（refFileKeys[0]=采购文件本体）。 */
  private async fetchNegotiationTenderFile(projectId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
    if (!this.redis) return null;
    let cfg: { refFileKeys?: string[]; attachFileIds?: string[] } | null = null;
    try {
      const raw = await this.redis.get(`negotiation-config:${projectId}`);
      if (raw) cfg = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!cfg) return null;

    const keys: string[] = cfg.refFileKeys || [];
    const ids: string[] = cfg.attachFileIds || [];
    if (keys.length === 0 && ids.length === 0) return null;

    // 主轨：PMI 阶段附件（:3005「引用采购文件」勾选即此体系）
    if (keys.length > 0) {
      const attachments = await this.prisma.attachment.findMany({
        where: { objectKey: { in: keys } },
        select: { fileName: true, objectKey: true },
      });
      if (attachments.length > 0) {
        const att = attachments[0];
        const buffer = await fs.promises.readFile(path.resolve(process.cwd(), 'uploads', att.objectKey));
        return { buffer, fileName: att.fileName };
      }
    }

    // 兼容轨：FileAsset（byId 优先，byKey 兜底），sealed 资产解封
    const assets = await this.prisma.fileAsset.findMany({
      where: ids.length > 0
        ? { OR: [{ id: { in: ids } }, ...(keys.length > 0 ? [{ key: { in: keys } }] : [])] }
        : { key: { in: keys } },
      select: { key: true, sealedPath: true, sealedKey: true, clientEncrypted: true, originalName: true },
    });
    if (assets.length === 0) return null;
    const asset = assets[0];
    let buffer = await streamToBuffer(
      await minioClient.getObject(MINIO_BUCKET, asset.sealedPath || asset.key),
    );
    if (asset.sealedKey && !asset.clientEncrypted) {
      const rawKey = isWrappedKey(asset.sealedKey)
        ? unwrapKey(asset.sealedKey, process.env.KMS_SECRET!)
        : asset.sealedKey;
      buffer = decryptBuffer(buffer, rawKey);
    }
    return { buffer, fileName: asset.originalName };
  }
}
