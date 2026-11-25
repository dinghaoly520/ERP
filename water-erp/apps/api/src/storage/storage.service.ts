import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

/** 控制字符：键里不允许出现 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 存储层键底线（审计第 3 处，2026-11-25）：所有模块读写删对象存储时键都必须是一个普通的相对键——
 * 非空字符串、不以 / 开头、不含反斜杠与控制字符、没有空段或 . / .. 段。
 * 这是全库共用的一道闸：各模块的键都应是服务端生成的（模块前缀 + 时间戳或随机串），
 * 不合法的键只可能来自被污染的数据或绕过入口写进来的值。违规一律 400 INVALID_OBJECT_KEY。
 */
export function assertStorableObjectKey(key: unknown): string {
  if (
    typeof key !== 'string'
    || key === ''
    || key.startsWith('/')
    || key.includes('\\')
    || CONTROL_CHARS.test(key)
    || key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new BadRequestException({ error: '非法的对象存储键', code: 'INVALID_OBJECT_KEY' });
  }
  return key;
}

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
    assertStorableObjectKey(objectKey);
    await this.ensureBucket(bucket);
    await minioClient.putObject(bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  async download(objectKey: string, bucket: string = MINIO_BUCKET): Promise<Buffer> {
    assertStorableObjectKey(objectKey);
    const stream = await minioClient.getObject(bucket, objectKey);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async delete(objectKey: string, bucket: string = MINIO_BUCKET): Promise<void> {
    assertStorableObjectKey(objectKey);
    await minioClient.removeObject(bucket, objectKey);
  }

  async getPresignedUrl(
    objectKey: string,
    expirySeconds = 3600,
    bucket: string = MINIO_BUCKET,
  ): Promise<string> {
    assertStorableObjectKey(objectKey);
    return minioClient.presignedGetObject(bucket, objectKey, expirySeconds);
  }

}
