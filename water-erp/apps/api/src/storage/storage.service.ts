import { Injectable, Logger } from '@nestjs/common';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

/**
 * StorageService — MinIO 封装
 *
 * 移植自 procurement storage/storage.service.ts，按 v4.1 方案 T10 适配：
 *  - 复用 ERP upload/minio.client.ts 的 minioClient + MINIO_BUCKET（不重复建 client）
 *  - 接口与 procurement 一致（task.service / fetchBidderPlaintext 等调用方用）
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  async ensureBucket(bucket: string = MINIO_BUCKET): Promise<void> {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket);
      this.logger.log(`Created bucket: ${bucket}`);
    }
  }

  async upload(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
    bucket: string = MINIO_BUCKET,
  ): Promise<void> {
    await this.ensureBucket(bucket);
    await minioClient.putObject(bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  async download(objectKey: string, bucket: string = MINIO_BUCKET): Promise<Buffer> {
    const stream = await minioClient.getObject(bucket, objectKey);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async delete(objectKey: string, bucket: string = MINIO_BUCKET): Promise<void> {
    await minioClient.removeObject(bucket, objectKey);
  }

  async getPresignedUrl(
    objectKey: string,
    expirySeconds = 3600,
    bucket: string = MINIO_BUCKET,
  ): Promise<string> {
    return minioClient.presignedGetObject(bucket, objectKey, expirySeconds);
  }

  /** List all object keys in the bucket (orphan detection 用) */
  async listObjects(
    bucket: string = MINIO_BUCKET,
  ): Promise<Array<{ key: string; lastModified: Date }>> {
    const stream = minioClient.listObjects(bucket, '', true);
    const objects: Array<{ key: string; lastModified: Date }> = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        if (obj.name) {
          objects.push({
            key: obj.name,
            lastModified: obj.lastModified ?? new Date(0),
          });
        }
      });
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });
  }
}
