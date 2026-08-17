import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { encryptBuffer, decryptBuffer, streamToBuffer } from './bid-document.crypto';
import { wrapKey, unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { convertOfficeToPdf, sanitizeFileName } from '../common/office-to-pdf.util';
import * as crypto from 'crypto';

export type AccessScope = 'OPEN' | 'INVITED';

@Injectable()
export class BidDocumentService {
  private readonly logger = new Logger(BidDocumentService.name);

  constructor(private prisma: PrismaService) {}

  /* ── 管理端：上传加密招标文件 ── */
  async upload(
    announcementId: string,
    file: Express.Multer.File,
    config: {
      title?: string;
      accessScope?: AccessScope;
      requirePayment?: boolean;
      price?: number;
      bidProjectId?: string;
      allowedSupplierIds?: string[];
    },
    uploaderId: string,
  ) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (announcement.type !== 'BID_NOTICE') {
      throw new BadRequestException({ error: '仅招标公示可上传招标文件', code: 'NOT_BID_NOTICE' });
    }
    const existing = await this.prisma.bidDocument.findUnique({ where: { announcementId } });
    if (existing) throw new BadRequestException({ error: '该公告已有招标文件，请先删除', code: 'DOC_EXISTS' });

    // ① 文件名 latin1→utf8 + ② docx/doc 转 PDF（标书获取页可预览）
    const originalName = sanitizeFileName(file.originalname);
    let buffer = file.buffer;
    let mimeType = file.mimetype;
    let displayName = originalName;
    const converted = convertOfficeToPdf(file.buffer, file.mimetype, originalName);
    if (converted) {
      buffer = converted.buffer;
      mimeType = converted.mimeType;
      displayName = converted.fileName;
    }

    // 加密（转换后的 buffer，若转了 pdf 则加密 pdf 内容）
    const { ciphertext, decryptKey } = encryptBuffer(buffer);

    // 存 MinIO（密文）+ FileAsset 元数据
    const date = new Date().toISOString().slice(0, 10);
    const key = `bid-doc/${date}/${crypto.randomBytes(8).toString('hex')}.enc`;
    await minioClient.putObject(MINIO_BUCKET, key, ciphertext, ciphertext.length, { 'Content-Type': 'application/octet-stream' });
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex'); // 原文 sha256，便于校验
    const asset = await this.prisma.fileAsset.create({
      data: { key, originalName: displayName, mimeType, size: buffer.length, sha256, category: 'bid_document', uploaderId },
    });

    const accessScope = config.accessScope || 'OPEN';
    const doc = await this.prisma.bidDocument.create({
      data: {
        announcementId,
        fileAssetId: asset.id,
        title: config.title || displayName,
        accessScope,
        requirePayment: config.requirePayment ?? false,
        price: config.requirePayment ? config.price : null,
        decryptKey: wrapKey(decryptKey, process.env.KMS_SECRET!),
        bidProjectId: accessScope === 'INVITED' ? config.bidProjectId : null,
      },
    });

    // INVITED 白名单 → 建 eligible access 记录
    if (accessScope === 'INVITED' && config.allowedSupplierIds?.length) {
      await this.syncWhitelist(doc.id, config.allowedSupplierIds);
    }
    return this.getForManagement(announcementId);
  }

  /* ── 管理端：从已有 MinIO 对象创建加密招标文件（公告发布「引用采购文件」链路）──
   *  P1b（2026-08-17）：发布向导勾选「引用采购文件」后原仅挂普通附件，BidDocument 断链，
   *  导致供应商端下载、AI 提取得分点（TENDER_NOT_READY）全挂。此处与 upload 共用
   *  「docx→PDF 转换 + 加密 + MinIO + FileAsset + BidDocument」链路。 */
  async attachFromObject(
    announcementId: string,
    input: {
      objectKey: string;
      fileName?: string;
      mimeType?: string;
      title?: string;
      bidProjectId?: string;
      uploaderId?: string | null;
    },
  ) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (announcement.type !== 'BID_NOTICE') {
      throw new BadRequestException({ error: '仅招标公示可创建招标文件', code: 'NOT_BID_NOTICE' });
    }
    const existing = await this.prisma.bidDocument.findUnique({ where: { announcementId } });
    if (existing) {
      this.logger.log(`公告 ${announcementId} 已有招标文件，跳过 attachFromObject`);
      return this.getForManagement(announcementId);
    }

    // ① 从 MinIO 读取源对象（PMI 阶段上传的采购文件）
    const source = await minioClient.getObject(MINIO_BUCKET, input.objectKey);
    const sourceBuffer = await streamToBuffer(source);
    if (sourceBuffer.length === 0) {
      throw new BadRequestException({ error: '采购文件对象为空', code: 'EMPTY_SOURCE' });
    }

    // ② 文件名/类型兜底 + docx/doc 转 PDF（与 upload 一致）
    const rawName = input.fileName || input.objectKey.split('/').pop() || '招标文件';
    const originalName = sanitizeFileName(rawName);
    let buffer = sourceBuffer;
    let mimeType = input.mimeType || 'application/octet-stream';
    let displayName = originalName;
    const converted = convertOfficeToPdf(sourceBuffer, mimeType, originalName);
    if (converted) {
      buffer = converted.buffer;
      mimeType = converted.mimeType;
      displayName = converted.fileName;
    }

    // ③ 加密 + 存 MinIO + FileAsset + BidDocument（与 upload 相同）
    const { ciphertext, decryptKey } = encryptBuffer(buffer);
    const date = new Date().toISOString().slice(0, 10);
    const key = `bid-doc/${date}/${crypto.randomBytes(8).toString('hex')}.enc`;
    await minioClient.putObject(MINIO_BUCKET, key, ciphertext, ciphertext.length, { 'Content-Type': 'application/octet-stream' });
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key,
        originalName: displayName,
        mimeType,
        size: buffer.length,
        sha256,
        category: 'bid_document',
        uploaderId: input.uploaderId ?? null,
      },
    });
    await this.prisma.bidDocument.create({
      data: {
        announcementId,
        fileAssetId: asset.id,
        title: input.title || displayName,
        accessScope: 'OPEN',
        requirePayment: false,
        price: null,
        decryptKey: wrapKey(decryptKey, process.env.KMS_SECRET!),
        bidProjectId: input.bidProjectId ?? null,
      },
    });
    this.logger.log(
      `公告 ${announcementId} 已从对象 ${input.objectKey} 创建加密招标文件（${displayName}）`,
    );
    return this.getForManagement(announcementId);
  }

  /* ── 管理端：更新访问配置 ── */
  async updateConfig(announcementId: string, config: {
    accessScope?: AccessScope;
    requirePayment?: boolean;
    price?: number;
    bidProjectId?: string;
    title?: string;
    allowedSupplierIds?: string[];
  }) {
    const doc = await this.prisma.bidDocument.findUnique({ where: { announcementId } });
    if (!doc) throw new NotFoundException({ error: '招标文件不存在', code: 'NOT_FOUND' });

    const data: any = {};
    if (config.title !== undefined) data.title = config.title;
    if (config.accessScope !== undefined) {
      data.accessScope = config.accessScope;
      if (config.accessScope === 'INVITED') data.bidProjectId = config.bidProjectId ?? doc.bidProjectId;
      if (config.accessScope !== 'INVITED') {
        // 离开 INVITED 时清空白名单 eligible
        await this.prisma.bidDocumentAccess.updateMany({ where: { documentId: doc.id, eligible: true, paid: false }, data: { eligible: false } });
      }
    }
    if (config.requirePayment !== undefined) {
      data.requirePayment = config.requirePayment;
      if (!config.requirePayment) data.price = null;
    }
    if (config.price !== undefined && (config.requirePayment ?? doc.requirePayment)) data.price = config.price;

    await this.prisma.bidDocument.update({ where: { id: doc.id }, data });

    if (config.accessScope === 'INVITED' && config.allowedSupplierIds !== undefined) {
      await this.syncWhitelist(doc.id, config.allowedSupplierIds);
    }
    return this.getForManagement(announcementId);
  }

  /** 同步白名单：以传入列表为准，重建 eligible 记录（保留已付款） */
  private async syncWhitelist(documentId: string, allowedSupplierIds: string[]) {
    const existing = await this.prisma.bidDocumentAccess.findMany({ where: { documentId } });
    const allowed = new Set(allowedSupplierIds);
    for (const a of existing) {
      if (!allowed.has(a.supplierId) && !a.paid) {
        await this.prisma.bidDocumentAccess.update({ where: { id: a.id }, data: { eligible: false } });
      }
    }
    for (const supplierId of allowedSupplierIds) {
      await this.prisma.bidDocumentAccess.upsert({
        where: { documentId_supplierId: { documentId, supplierId } },
        update: { eligible: true },
        create: { documentId, supplierId, eligible: true },
      });
    }
  }

  /* ── 管理端：删除招标文件 ── */
  async remove(announcementId: string) {
    const doc = await this.prisma.bidDocument.findUnique({ where: { announcementId } });
    if (!doc) throw new NotFoundException({ error: '招标文件不存在', code: 'NOT_FOUND' });
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: doc.fileAssetId } });
    await this.prisma.bidDocument.delete({ where: { id: doc.id } });
    if (asset) {
      try { await minioClient.removeObject(MINIO_BUCKET, asset.key); } catch (e) { this.logger.warn(`remove minio object failed: ${(e as Error).message}`); }
      await this.prisma.fileAsset.delete({ where: { id: asset.id } }).catch(() => {});
    }
    return { deleted: true };
  }

  /* ── 管理端：查看招标文件 + 访问/到账列表 ── */
  async getForManagement(announcementId: string) {
    const doc = await this.prisma.bidDocument.findUnique({
      where: { announcementId },
      include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } }, accesses: { include: { supplier: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } } },
    });
    if (!doc) return null;
    return {
      id: doc.id,
      announcementId: doc.announcementId,
      title: doc.title,
      accessScope: doc.accessScope,
      requirePayment: doc.requirePayment,
      price: doc.price !== null ? Number(doc.price) : null,
      bidProjectId: doc.bidProjectId,
      downloadCount: doc.downloadCount,
      fileName: doc.fileAsset.originalName,
      fileSize: doc.fileAsset.size,
      allowedSupplierIds: doc.accesses.filter(a => a.eligible).map(a => a.supplierId),
      accesses: doc.accesses.map(a => ({
        supplierId: a.supplierId,
        supplierName: a.supplier.name,
        eligible: a.eligible,
        paid: a.paid,
        paidAt: a.paidAt,
        paymentRef: a.paymentRef,
        downloadCount: a.downloadCount,
        lastDownloadAt: a.lastDownloadAt,
      })),
    };
  }

  /* ── 管理端：确认到账 ── */
  async confirmPayment(announcementId: string, supplierId: string, paymentRef?: string) {
    const doc = await this.prisma.bidDocument.findUnique({ where: { announcementId } });
    if (!doc) throw new NotFoundException({ error: '招标文件不存在', code: 'NOT_FOUND' });
    const access = await this.prisma.bidDocumentAccess.upsert({
      where: { documentId_supplierId: { documentId: doc.id, supplierId } },
      update: { paid: true, paidAt: new Date(), paymentRef, eligible: true },
      create: { documentId: doc.id, supplierId, eligible: true, paid: true, paidAt: new Date(), paymentRef },
    });
    return { success: true, access };
  }

  /* ── 供应商端：查看某招标公示的招标文件（含自身权限/付费状态）── */
  async getForSupplier(announcementId: string, supplierId: string) {
    const doc = await this.prisma.bidDocument.findUnique({
      where: { announcementId },
      include: { announcement: { select: { id: true, title: true, type: true, status: true, metadata: true } } },
    });
    if (!doc || doc.announcement.type !== 'BID_NOTICE') return null;

    const eligibility = await this.checkEligibility(doc, supplierId);
    const access = await this.prisma.bidDocumentAccess.findUnique({
      where: { documentId_supplierId: { documentId: doc.id, supplierId } },
    });

    // 解密下载模式：需要供应商输入密码才能解密（密码存于 announcement.metadata.downloadPassword）
    const annMeta = (doc.announcement as any)?.metadata as Record<string, any> | undefined;
    const needPassword = doc.accessScope === 'DESIGNATED' && !!annMeta?.downloadPassword;

    return {
      id: doc.id,
      announcementId: doc.announcementId,
      title: doc.title,
      accessScope: doc.accessScope,
      requirePayment: doc.requirePayment,
      price: doc.price !== null ? Number(doc.price) : null,
      fileSize: doc.fileAssetId ? (await this.prisma.fileAsset.findUnique({ where: { id: doc.fileAssetId }, select: { size: true } }))?.size : null,
      // 供应商可见的权限结论（不暴露内部白名单）
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      paid: access?.paid ?? false,
      canDownload: eligibility.eligible && (!doc.requirePayment || access?.paid === true) && !needPassword,
      needPassword,
      needPayment: doc.requirePayment && !access?.paid,
      downloadCount: access?.downloadCount ?? 0,
    };
  }

  /** 校验供应商是否有资格（不含付费） */
  private async checkEligibility(doc: any, supplierId: string): Promise<{ eligible: boolean; reason: string }> {
    if (doc.accessScope === 'OPEN') return { eligible: true, reason: '公开下载' };
    if (doc.accessScope === 'INVITED') {
      // 检查是否在白名单中（管理员手动指定）
      const whitelist = await this.prisma.bidDocumentAccess.findUnique({ where: { documentId_supplierId: { documentId: doc.id, supplierId } } });
      if (whitelist?.eligible) return { eligible: true, reason: '已列入受邀名单' };
      // 检查是否被邀参与关联项目
      if (doc.bidProjectId) {
        const invited = await this.prisma.bidSupplier.findFirst({ where: { projectId: doc.bidProjectId, supplierId } });
        if (invited) return { eligible: true, reason: '受邀参与本项目' };
      }
      return { eligible: false, reason: '未列入受邀名单且未受邀参与本项目' };
    }
    return { eligible: false, reason: '未知访问模式' };
  }

  /* ── 供应商端：发起付费（生成待付款记录）── */
  async initiatePayment(announcementId: string, supplierId: string, paymentRef?: string) {
    const doc = await this.prisma.bidDocument.findUnique({ where: { announcementId } });
    if (!doc) throw new NotFoundException({ error: '招标文件不存在', code: 'NOT_FOUND' });
    if (!doc.requirePayment) throw new BadRequestException({ error: '该文件无需付费', code: 'NOT_PAID_DOC' });
    const elig = await this.checkEligibility(doc, supplierId);
    if (!elig.eligible) throw new ForbiddenException({ error: elig.reason, code: 'NOT_ELIGIBLE' });
    const access = await this.prisma.bidDocumentAccess.upsert({
      where: { documentId_supplierId: { documentId: doc.id, supplierId } },
      update: { eligible: true, ...(paymentRef !== undefined && { paymentRef }), paid: false },
      create: { documentId: doc.id, supplierId, eligible: true, paid: false, paymentRef },
    });
    return { success: true, paid: access.paid, paymentRef: access.paymentRef, message: '付款记录已提交，等待确认到账' };
  }

  /* ── 供应商端：鉴权下载（解密 + 流式 + 记录）── */
  async downloadForSupplier(announcementId: string, supplierId: string, password?: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const doc = await this.prisma.bidDocument.findUnique({ where: { announcementId }, include: { fileAsset: true, announcement: { select: { metadata: true } } } });
    if (!doc) throw new NotFoundException({ error: '招标文件不存在', code: 'NOT_FOUND' });

    const elig = await this.checkEligibility(doc, supplierId);
    if (!elig.eligible) throw new ForbiddenException({ error: elig.reason, code: 'NOT_ELIGIBLE' });

    // 解密下载模式：DESIGNATED 需验证密码（存于 announcement.metadata.downloadPassword）
    if (doc.accessScope === 'DESIGNATED') {
      const annMeta = (doc.announcement as any)?.metadata as Record<string, any> | undefined;
      if (annMeta?.downloadPassword) {
        if (!password || password !== annMeta.downloadPassword) {
          throw new ForbiddenException({ error: '下载密码错误', code: 'WRONG_PASSWORD' });
        }
      }
    }
    if (doc.requirePayment) {
      const access = await this.prisma.bidDocumentAccess.findUnique({ where: { documentId_supplierId: { documentId: doc.id, supplierId } } });
      if (!access?.paid) throw new ForbiddenException({ error: '请先完成付费', code: 'PAYMENT_REQUIRED' });
    }

    // 读取密文 → 解密
    // TODO: 大文件下载应使用 createDecryptStream() 进行流式解密，
    // 将 objStream.pipe(createDecryptStream(rawKey)).pipe(response)，
    // 当前 streamToBuffer + decryptBuffer 全量读入内存，对大文件不够友好。
    const objStream = await minioClient.getObject(MINIO_BUCKET, doc.fileAsset.key);
    const ciphertext = await streamToBuffer(objStream);
    const rawKey = isWrappedKey(doc.decryptKey)
      ? unwrapKey(doc.decryptKey, process.env.KMS_SECRET!)
      : doc.decryptKey;
    const plaintext = decryptBuffer(ciphertext, rawKey);

    // 记录下载
    await this.prisma.$transaction([
      this.prisma.bidDocument.update({ where: { id: doc.id }, data: { downloadCount: { increment: 1 } } }),
      this.prisma.bidDocumentAccess.upsert({
        where: { documentId_supplierId: { documentId: doc.id, supplierId } },
        update: { downloadCount: { increment: 1 }, lastDownloadAt: new Date() },
        create: { documentId: doc.id, supplierId, eligible: true, downloadCount: 1, lastDownloadAt: new Date() },
      }),
    ]);

    return { buffer: plaintext, fileName: doc.fileAsset.originalName, mimeType: doc.fileAsset.mimeType };
  }
}
