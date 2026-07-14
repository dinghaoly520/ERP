import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET, ensureBucket } from './minio.client';

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
  async upload(file: Express.Multer.File, category: string = 'general', userId?: string) {
    this.validateFile(file, category);

    const key = this.generateKey(file.originalname);
    const sha256 = this.computeSha256(file.buffer);

    // 写入 MinIO 对象存储
    await minioClient.putObject(MINIO_BUCKET, key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });
    this.logger.log(`File stored in MinIO: ${key} (${file.size} bytes, ${file.mimetype})`);

    // 持久化文件元数据到数据库
    const asset = await this.prisma.fileAsset.create({
      data: {
        key,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        sha256,
        category,
        uploaderId: userId,
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
   * - admin / bid_host / procurement_staff：允许，但若文件属于供应商投标提交则需 decryptStatus=SUCCESS
   * - bid_expert：仅当被分配到某项目，且该文件属于该项目某供应商提交的投标文件，
   *   且对应 BidSupplier 已解密成功时允许
   * - 其他：拒绝
   */
  private async canAccessFile(asset: { id: string; uploaderId: string | null }, user: { sub: string; role: string }): Promise<boolean> {
    if (asset.uploaderId && asset.uploaderId === user.sub) return true;
    if (['admin', 'bid_host', 'procurement_staff'].includes(user.role)) {
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

    // 先删对象，再删元数据；任一失败抛错以暴露问题
    await minioClient.removeObject(MINIO_BUCKET, key);
    this.logger.log(`File removed from MinIO: ${key} (by ${user?.sub ?? 'system'})`);

    await this.prisma.fileAsset.delete({ where: { key } });
    return { deleted: true, key };
  }
}
