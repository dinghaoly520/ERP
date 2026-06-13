import { Client } from 'minio';
import { Logger } from '@nestjs/common';

/**
 * MinIO 单例客户端。
 * 环境变量默认对齐 docker-compose.yml（localhost:9000, water_erp_minio/...dev, bucket=water-erp）。
 */
const logger = new Logger('MinioClient');

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'water_erp_minio',
  secretKey: process.env.MINIO_SECRET_KEY || 'water_erp_minio_dev',
});

export const MINIO_BUCKET = process.env.MINIO_BUCKET || 'water-erp';

/**
 * 确保 bucket 存在，不存在则创建。应在应用启动时调用一次。
 */
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await minioClient.makeBucket(MINIO_BUCKET, 'us-east-1');
    logger.log(`Bucket "${MINIO_BUCKET}" created`);
  } else {
    logger.log(`Bucket "${MINIO_BUCKET}" ready`);
  }
}
