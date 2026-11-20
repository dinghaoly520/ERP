/**
 * 一次性回填（2026-11-20）：PMI 附件双轨制——Attachment 存量行补写 MinIO 副本。
 *
 * 病理：persistUploadedFile 历史上只写容器本地磁盘（uploads/project-management/），
 * objectKey 只是相对路径约定，容器 recreate 即灭失（2026-11-20 生产实录：下载 500 ×3、
 * AI 分析静默丢文本）。运行时已改双轨（写入即落 MinIO 副本）——本脚本把**存量**本地
 * 文件补传 MinIO，让旧附件同样获得副本轨。
 *
 * 判定（逐行，不分工轨——行为自分类）：
 *   本地存在 & MinIO 无  → 待回填（--execute 时 putObject 本地 buffer，contentType=mimeType）
 *   本地存在 & MinIO 有  → skip（已双轨/已回填，幂等重跑全落此类）
 *   本地缺失 & MinIO 有  → healthy（双轨新件或 FileAsset 键轨本体在 MinIO）
 *   本地缺失 & MinIO 无  → 不可恢复清单（容器重建已丢，只能找回原始文件走 UI 重传）
 *
 * 不触碰：FileAsset 表、数据库行（只读 Attachment）、MinIO 已有对象（绝不覆盖）。
 *
 * 用法：
 *   npx tsx scripts/backfill-attachment-minio.ts            # dry-run（默认，只报告）
 *   npx tsx scripts/backfill-attachment-minio.ts --execute  # 执行补传
 * 幂等：重复执行安全——已传对象走 statObject 命中即 skip。
 */
import { PrismaClient } from '@prisma/client';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { minioClient, MINIO_BUCKET } from '../src/upload/minio.client';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');

async function minioHas(objectKey: string): Promise<boolean> {
  try {
    await minioClient.statObject(MINIO_BUCKET, objectKey);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const rows = await prisma.attachment.findMany({
    select: {
      id: true,
      fileName: true,
      objectKey: true,
      mimeType: true,
      projectManagementItemId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`[backfill-attachment-minio] 扫描 Attachment ${rows.length} 行（mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}）`);

  let backfilled = 0;
  let skipped = 0;
  let healthy = 0;
  const unrecoverable: Array<{ id: string; fileName: string; objectKey: string }> = [];
  const failed: Array<{ objectKey: string; err: unknown }> = [];

  for (const row of rows) {
    try {
      const localPath = resolve(process.cwd(), 'uploads', row.objectKey);
      const st = await stat(localPath).catch(() => null);
      const inMinio = await minioHas(row.objectKey);

      if (st?.isFile() && !inMinio) {
        if (execute) {
          const buffer = await readFile(localPath);
          await minioClient.putObject(MINIO_BUCKET, row.objectKey, buffer, buffer.length, {
            'Content-Type': row.mimeType || 'application/octet-stream',
          });
        }
        backfilled += 1;
        console.log(`${execute ? '✓ 已回填' : '· 待回填'}: ${row.objectKey}（${row.fileName}）`);
      } else if (st?.isFile() && inMinio) {
        skipped += 1;
      } else if (!st?.isFile() && inMinio) {
        healthy += 1;
      } else {
        unrecoverable.push({ id: row.id, fileName: row.fileName, objectKey: row.objectKey });
        console.log(`✗ 不可恢复: ${row.objectKey}（${row.fileName}，项目 ${row.projectManagementItemId ?? '-'}）`);
      }
    } catch (err) {
      failed.push({ objectKey: row.objectKey, err });
      console.log(`! 单行失败（不中断）: ${row.objectKey} — ${(err as Error)?.message ?? err}`);
    }
  }

  console.log('──── 汇总 ────');
  console.log(`待回填/已回填: ${backfilled}（本地有 MinIO 无）`);
  console.log(`skip: ${skipped}（两轨皆有，幂等命中）`);
  console.log(`healthy: ${healthy}（仅 MinIO——双轨新件或 FileAsset 键轨）`);
  console.log(`不可恢复: ${unrecoverable.length}（两轨皆无——需找回原始文件走 UI 重传）`);
  console.log(`单行失败: ${failed.length}`);
  if (unrecoverable.length > 0) {
    console.log('──── 不可恢复清单（交业务方找回重传）────');
    for (const u of unrecoverable) console.log(`  ${u.id} | ${u.fileName} | ${u.objectKey}`);
  }
}

main()
  .catch((err) => {
    console.error('[backfill-attachment-minio] 致命错误:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
