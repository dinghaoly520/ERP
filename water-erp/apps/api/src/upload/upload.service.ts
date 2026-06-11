import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

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
   * 上传文件到 MinIO
   * 当前为本地存储模式，生产环境替换为 MinIO SDK
   */
  async upload(file: Express.Multer.File) {
    const key = this.generateKey(file.originalname);
    const url = this.getFileUrl(key);

    // TODO: 生产环境使用 MinIO SDK 上传
    // 当前返回模拟 URL，文件内容在 buffer 中
    this.logger.log(`File uploaded: ${key} (${file.size} bytes)`);

    return {
      url,
      key,
      size: file.size,
      originalName: file.originalname,
      mimetype: file.mimetype,
    };
  }

  /**
   * 删除文件
   */
  async delete(key: string) {
    // TODO: 生产环境使用 MinIO SDK 删除
    this.logger.log(`File deleted: ${key}`);
    return { deleted: true, key };
  }
}
