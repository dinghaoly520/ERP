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

// 请求超时兜底（2026-11-20 终审 M3）：黑洞端点下副本写入/回退读不再无限挂到 OS TCP 超时。
// 默认 120s——500MB 大对象在慢链路也有余量；MINIO_REQUEST_TIMEOUT_MS 可覆盖（毫秒）。
export const MINIO_REQUEST_TIMEOUT_MS = Number(process.env.MINIO_REQUEST_TIMEOUT_MS) || 120_000;
if (typeof (minioClient as unknown as { setDefaultTimeout?: (ms: number) => void }).setDefaultTimeout === 'function') {
  (minioClient as unknown as { setDefaultTimeout: (ms: number) => void }).setDefaultTimeout(MINIO_REQUEST_TIMEOUT_MS);
}

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
