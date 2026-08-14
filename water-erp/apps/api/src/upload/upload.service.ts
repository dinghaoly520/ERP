import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ConflictException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET, ensureBucket } from './minio.client';
import { convertOfficeToPdf, sanitizeFileName } from '../common/office-to-pdf.util';
import { unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { createDecryptStream } from '../announcement/bid-document.crypto';

/** Allowed MIME types for upload */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'text/plain',
];

/** Allowed categories */
const ALLOWED_CATEGORIES = [
  'qualification',  // 资质材料
  'bid_document',   // 投标文件
  'announcement',   // 公告附件
  'profile',        // 供应商资料
  'expert_signin_photo', // 专家签到拍照留痕（evaluate 身份核验步骤，非人脸识别）
  'general',        // 通用
];

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // 启动时确保 bucket 存在；MinIO 不可用时不阻断应用启动，仅记录告警
    try {
      await ensureBucket();
    } catch (err) {
      this.logger.error(`MinIO bucket 初始化失败：${(err as Error).message}`);
    }
  }

  /**
   * 生成文件存储 key: uploads/{yyyy-mm-dd}/{random}.{ext}
   */
  generateKey(originalName: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const ext = originalName.includes('.') ? originalName.split('.').pop() : 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    return `uploads/${date}/${hash}.${ext}`;
  }

  /**
   * 计算文件 SHA256
   */
  private computeSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * 校验文件合法性
   */
  validateFile(file: Express.Multer.File, category: string) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        error: `不支持的文件类型：${file.mimetype}`,
        code: 'INVALID_MIME_TYPE',
      });
    }

    if (!ALLOWED_CATEGORIES.includes(category)) {
      throw new BadRequestException({
        error: `不支持的文件分类：${category}`,
        code: 'INVALID_CATEGORY',
      });
    }
  }

  /**
   * 上传文件并持久化元数据（文件字节写入 MinIO）
   */
  async upload(
    file: Express.Multer.File, category: string = 'general', userId?: string,
    clientEncrypted = false,
    clientPlaintextSha256?: string,
  ) {
    // clientEncrypted 时跳过 MIME 校验——密文的 MIME type 是 application/octet-stream
    if (!clientEncrypted) {
      this.validateFile(file, category);
    }

    // ① 文件名从 multer 的 latin1 还原为 utf8（中文不乱码）
    const originalName = sanitizeFileName(file.originalname);

    // ② Office Word 文档自动转 PDF（预览统一，转换失败降级存原始文件）
    //    clientEncrypted 时跳过——文件已是密文，无法识别为 Office 文档
    let buffer = file.buffer;
    let mimeType = file.mimetype;
    let displayName = originalName;
    if (!clientEncrypted) {
      const converted = convertOfficeToPdf(file.buffer, file.mimetype, originalName);
      if (converted) {
        buffer = converted.buffer;
        mimeType = converted.mimeType;
        displayName = converted.fileName;
      }
    } else {
      // E2EE: 统一标记为 octet-stream
      mimeType = 'application/octet-stream';
    }

    const key = this.generateKey(displayName);
    // sha256: 客户端提供原文哈希则用它；否则计算密文哈希
    const sha256 = clientPlaintextSha256 || this.computeSha256(buffer);

    // 写入 MinIO 对象存储
    await minioClient.putObject(MINIO_BUCKET, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
    this.logger.log(`File stored in MinIO: ${key} (${buffer.length} bytes, ${mimeType})${clientEncrypted ? ' [E2EE]' : ''}`);

    // 持久化文件元数据到数据库
    const asset = await this.prisma.fileAsset.create({
      data: {
        key,
        originalName: displayName,
        mimeType,
        size: buffer.length,
        sha256,
        category,
        uploaderId: userId,
        clientEncrypted, // E2EE 标记持久化
      },
    });

    // url 为鉴权代理下载路径（稳定、不失效、受 AuthGuard 保护）
    return {
      id: asset.id,
      key: asset.key,
      url: `/api/upload/files/${asset.id}`,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      category: asset.category,
      sha256: asset.sha256,
      createdAt: asset.createdAt.toISOString(),
    };
  }

  /**
   * 以流的方式返回文件内容（鉴权下载）。受全局 AuthGuard 保护。
   * 在流出文件前校验访问权限：上传者本人、采购/开评标管理角色可直接访问；
   * 评审专家仅可访问其被分配项目中、且对应投标供应商已解密成功的投标文件。
   */
  async streamFile(id: string, user: { sub: string; role: string }, res: any) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException({ error: '文件不存在', code: 'NOT_FOUND' });
    }

    const canAccess = await this.canAccessFile(asset, user);
    if (!canAccess) {
      throw new ForbiddenException({ error: '无权访问该文件', code: 'FILE_FORBIDDEN' });
    }

    // E2EE: 文件在 MinIO 中是 ciphertext，需在流式输出时解密
    if (asset.clientEncrypted) {
      const submission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
          ],
        },
      });
      const sealedKey = submission?.technicalFileAssetId === asset.id ? submission?.technicalSealedKey
        : submission?.businessFileAssetId === asset.id ? submission?.businessSealedKey
        : submission?.coverLetterSealedKey;
      if (!sealedKey) {
        throw new BadRequestException({ error: 'E2EE 文件缺少解密密钥', code: 'MISSING_SEALED_KEY' });
      }
      const rawKey = isWrappedKey(sealedKey) ? unwrapKey(sealedKey, process.env.KMS_SECRET!) : sealedKey;

      // 流式解密：从 MinIO 读取 ciphertext → AES-256-GCM decrypt → 响应
      const cipherStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
      const decryptStream = createDecryptStream(rawKey);

      // E2EE 文件在 MinIO 中存的是 ciphertext，不含 authTag → size 是 ciphertext 长度
      // 解密后会略短（去掉 authTag 长度），无法提前知道 Content-Length
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(asset.originalName.replace(/\.enc$/, ''))}"`,
      );
      cipherStream.pipe(decryptStream).pipe(res);
      return;
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(asset.size));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(asset.originalName)}"`,
    );

    const dataStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
    dataStream.pipe(res);
    return dataStream;
  }

  /**
   * 文件访问权限判定：
   * - 上传者本人：允许
   * - admin / bid_host / leader / staff：允许，但若文件属于供应商投标提交则需 decryptStatus=SUCCESS
   * - bid_expert：仅当被分配到某项目，且该文件属于该项目某供应商提交的投标文件，
   *   且对应 BidSupplier 已解密成功时允许
   * - 其他：拒绝
   */
  private async canAccessFile(asset: { id: string; uploaderId: string | null }, user: { sub: string; role: string }): Promise<boolean> {
    if (asset.uploaderId && asset.uploaderId === user.sub) return true;
    if (['admin', 'bid_host', 'leader', 'staff'].includes(user.role)) {
      const submission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
          ],
        },
      });
      if (submission) {
        const decrypted = await this.prisma.bidSupplier.findFirst({
          where: { projectId: submission.projectId, supplierId: submission.supplierId, decryptStatus: 'SUCCESS' },
        });
        return !!decrypted;
      }
      return true;
    }

    if (user.role === 'bid_expert') {
      // 从 asset 反查其所属项目（通过引用该 asset 的 SupplierBidSubmission），
      // 再校验专家是否被分配到【该】项目——避免对多项目专家取到错误项目导致误判。
      const submission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
          ],
        },
      });
      if (!submission) return false;
      const expert = await this.prisma.bidExpert.findFirst({
        where: { userId: user.sub, projectId: submission.projectId },
      });
      if (!expert) return false;
      const bidSupplier = await this.prisma.bidSupplier.findFirst({
        where: { projectId: submission.projectId, supplierId: submission.supplierId, decryptStatus: 'SUCCESS' },
      });
      if (!bidSupplier) return false;

      // 审计：记录专家文件访问
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId: submission.projectId,
          time: new Date(),
          role: '专家',
          target: bidSupplier.supplierName,
          action: '文件访问',
          result: `专家预览/下载投标文件 (asset: ${asset.id})`,
          riskFlag: '无',
        },
      });

      return true;
    }

    return false;
  }

  /**
   * 删除文件（MinIO 对象 + 元数据）
   */
  async delete(key: string, user?: { sub: string; role: string }) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { key } });
    if (!asset) {
      throw new BadRequestException({ error: '文件不存在', code: 'NOT_FOUND' });
    }

    // 越权防护：仅上传者本人或 admin/bid_host 可删除
    // （原实现完全无鉴权，任意登录用户拿到 key 即可删他人投标/招标/AI 报告文件）
    const isAdmin = !!user && ['admin', 'bid_host'].includes(user.role);
    if (!isAdmin && asset.uploaderId !== user?.sub) {
      throw new ForbiddenException({ error: '无权删除该文件', code: 'FILE_FORBIDDEN' });
    }

    // H7: 已被投标文件引用的资产不可删除——防供应商截标后删件伪装技术故障 / 触发解密误判（H1 组合）
    const submission = await this.prisma.supplierBidSubmission.findFirst({
      where: {
        OR: [
          { technicalFileAssetId: asset.id },
          { businessFileAssetId: asset.id },
          { coverLetterAssetId: asset.id },
          { bidBondAssetId: asset.id },
        ],
      },
      select: { id: true },
    });
    if (submission) {
      throw new ConflictException({ error: '该文件已被投标文件引用，不可删除', code: 'FILE_REFERENCED' });
    }

    // 先删对象，再删元数据；任一失败抛错以暴露问题
    await minioClient.removeObject(MINIO_BUCKET, key);
    this.logger.log(`File removed from MinIO: ${key} (by ${user?.sub ?? 'system'})`);

    await this.prisma.fileAsset.delete({ where: { key } });
    return { deleted: true, key };
  }
}
