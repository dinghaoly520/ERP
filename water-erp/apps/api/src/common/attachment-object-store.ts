/**
 * PMI 附件双轨存储共享工具（2026-11-20）。
 *
 * 背景：PMI 阶段附件（Attachment 表）主轨为容器本地磁盘 uploads/，容器 recreate
 * 即灭失（2026-11-20 生产实录：getAttachmentFile 500 ×3、analyzeProject 静默丢文本）。
 * 本模块提供「本地主轨 + MinIO 副本」双轨读写原语：
 *   - 读：本地优先，miss 回退 MinIO（objectKey 即 MinIO 键——PMI 轨命中副本、
 *     非招标成交引用的 FileAsset 键轨命中本体，两轨皆正确）；
 *   - 写：best-effort 副本，失败绝不阻断本地主轨；
 *   - 删：best-effort 双清。
 *
 * 纯函数模块（直接消费 upload/minio.client 的共享 minioClient，无 DI）——
 * API 主进程与 ai-bid-analysis worker 进程通用。
 * 设计：docs/superpowers/specs/2026-11-20-pmi-attachment-dual-track-design.md
 */
import { Logger } from '@nestjs/common';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

const logger = new Logger('attachment-object-store');

/** 本地优先读附件；两轨皆失返回 null（调用方决定 404 或降级空文本）。 */
export async function readAttachmentBuffer(objectKey: string): Promise<Buffer | null> {
  const localPath = resolve(process.cwd(), 'uploads', objectKey);
  const st = await stat(localPath).catch(() => null);
  if (st?.isFile()) {
    try {
      return await readFile(localPath);
    } catch {
      /* 本地读取竞态失败 → 落 MinIO 副本轨 */
    }
  }
  try {
    const stream = await minioClient.getObject(MINIO_BUCKET, objectKey);
    return await new Promise<Buffer>((resolveP, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolveP(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'NoSuchKey') {
      // 非「对象不存在」（网络错/服务不可达）——回退语义优先可用性：按缺失处理但留痕
      logger.warn(
        `MinIO 附件读取失败（按缺失处理）: ${objectKey} — ${(err as Error)?.message ?? err}`,
      );
    }
    return null;
  }
}

/** best-effort 写 MinIO 副本：成功返 true；任何失败 warn 后返 false，绝不抛。 */
export async function writeAttachmentCopy(
  objectKey: string,
  buffer: Buffer,
  mimeType: string,
): Promise<boolean> {
  try {
    await minioClient.putObject(MINIO_BUCKET, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
    return true;
  } catch (err) {
    logger.warn(
      `MinIO 副本失败（不阻断）: ${objectKey} — ${(err as Error)?.message ?? err}`,
    );
    return false;
  }
}

/** best-effort 删 MinIO 副本（本地 unlink 由调用方既有逻辑负责）。 */
export async function removeAttachmentCopy(objectKey: string): Promise<void> {
  try {
    await minioClient.removeObject(MINIO_BUCKET, objectKey);
  } catch (err) {
    logger.debug(
      `MinIO 副本删除失败（best-effort 忽略）: ${objectKey} — ${(err as Error)?.message ?? err}`,
    );
  }
}
