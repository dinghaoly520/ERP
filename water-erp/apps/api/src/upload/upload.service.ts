import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

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
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private prisma: PrismaService) {}

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
   * 生成文件访问 URL（MinIO 地址）
   */
  getFileUrl(key: string): string {
    const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
    const port = process.env.MINIO_PORT || '9000';
    const bucket = 'water-erp';
    return `http://${endpoint}:${port}/${bucket}/${key}`;
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
   * 上传文件并持久化元数据
   */
  async upload(file: Express.Multer.File, category: string = 'general', userId?: string) {
    this.validateFile(file, category);

    const key = this.generateKey(file.originalname);
    const url = this.getFileUrl(key);
    const sha256 = this.computeSha256(file.buffer);

    // TODO: 生产环境使用 MinIO SDK 上传文件内容
    this.logger.log(`File uploaded: ${key} (${file.size} bytes, ${file.mimetype})`);

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

    return {
      id: asset.id,
      key: asset.key,
      url,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      category: asset.category,
      sha256: asset.sha256,
      createdAt: asset.createdAt.toISOString(),
    };
  }

  /**
   * 删除文件（元数据 + TODO: MinIO 对象）
   */
  async delete(key: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { key } });
    if (!asset) {
      throw new BadRequestException({ error: '文件不存在', code: 'NOT_FOUND' });
    }

    // TODO: 生产环境使用 MinIO SDK 删除对象
    this.logger.log(`File deleted: ${key}`);

    await this.prisma.fileAsset.delete({ where: { key } });
    return { deleted: true, key };
  }
}
