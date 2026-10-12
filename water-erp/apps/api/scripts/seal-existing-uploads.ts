/**
 * 存量通用上传密封脚本（2026-10-12 密文评估 P1-1 配套）
 *
 * 背景：UPLOAD_SERVER_SEAL_CATEGORIES 类目（qualification/profile/general/
 * contract_document/framework_document/performance_report）的存量 FileAsset
 * 在 MinIO 中是明文。本脚本把存量对象补封到与服务端新上传同构的形态。
 *
 * 每资产四步（crash-safe，两阶段落盘）：
 *   ① 下载明文（asset.key）→ 校验 sha256 与登记指纹一致（不符则跳过并列出——
 *      不给被篡改/损坏对象「密封洗白」）
 *   ② 加密（AES-256-GCM）→ 回读校验（decrypt == 原文）→ 密文写 sealedPath
 *      （sealed/<key>.enc，不覆盖明文对象）
 *   ③ DB 翻转：{ encrypted: true, sealedPath, sealedKey(wrapped DEK) }
 *   ④ 删除明文对象（asset.key）——此后下载走 streamFile 密封分支
 *      （sealedPath || key 读点 + sealedKey 解密）
 *
 *   任一步崩溃的恢复语义：①② 崩溃 → 行未翻转，明文仍可读（密文孤儿对象，重跑覆盖）；
 *   ③后崩溃 → 行已密封，下载走密文（明文对象孤儿，重跑按 encrypted=true 跳过，④由
 *   --sweep-orphans 补删）。幂等：候选集 WHERE encrypted=false。
 *
 * 用法：
 *   npx tsx apps/api/scripts/seal-existing-uploads.ts                 # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/seal-existing-uploads.ts --execute       # 真实密封
 *   npx tsx apps/api/scripts/seal-existing-uploads.ts --execute --sweep-orphans
 *                                                                      # 顺带清理已密封行的明文孤儿对象
 * 环境：自行加载 apps/api/.env（DATABASE_URL / KMS_SECRET / MINIO_*），
 * 从 water-erp/ 根或 apps/api/ 目录运行均可。生产 KMS 轮转约束见
 * docs/crypto-key-rotation-runbook.md（无 keyId——重封须与换钥同窗口完成或先后紧邻）。
 */
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { UPLOAD_SERVER_SEAL_CATEGORIES } from '../src/upload/upload-categories';
import { encryptBuffer, decryptBuffer } from '../src/announcement/bid-document.crypto';
import { wrapKey } from '../src/common/crypto/envelope-crypto';

// ── .env 加载（先于 minio Client / crypto 实例化）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
    return p;
  }
  return null;
}

const scriptDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const loadedEnv = loadEnvFile([
  join(process.cwd(), 'apps', 'api', '.env'),
  join(scriptDir, '..', '.env'),
]);
if (!loadedEnv) {
  console.error('未找到 apps/api/.env（DATABASE_URL / KMS_SECRET / MINIO_* 必需）');
  process.exit(1);
}

const EXECUTE = process.argv.includes('--execute');
const SWEEP_ORPHANS = process.argv.includes('--sweep-orphans');
const KMS = process.env.KMS_SECRET;
if (EXECUTE && !KMS) {
  console.error('--execute 需要 KMS_SECRET（密封 DEK 包裹主密钥）');
  process.exit(1);
}

const prisma = new PrismaClient();
const minio = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});
const BUCKET = process.env.MINIO_BUCKET || 'water-erp';

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

type Report = { id: string; key: string; note: string };
const sealed: Report[] = [];
const skipped: Report[] = [];
const failed: Report[] = [];
const swept: Report[] = [];

async function main() {
  console.log(`存量通用上传密封 ${EXECUTE ? '【EXECUTE·写库+写对象】' : '【dry-run·零副作用】'}`);
  console.log(`密封类目：${[...UPLOAD_SERVER_SEAL_CATEGORIES].join(' / ')}\n`);

  const candidates = await prisma.fileAsset.findMany({
    where: {
      encrypted: false,
      clientEncrypted: false,
      category: { in: [...UPLOAD_SERVER_SEAL_CATEGORIES] },
    },
    select: { id: true, key: true, sha256: true, originalName: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`候选 ${candidates.length} 个明文资产\n`);

  for (const fa of candidates) {
    try {
      // ① 明文下载 + 指纹校验
      const plain = await streamToBuffer(await minio.getObject(BUCKET, fa.key));
      const digest = createHash('sha256').update(plain).digest('hex');
      if (fa.sha256 && digest !== fa.sha256) {
        skipped.push({ id: fa.id, key: fa.key, note: 'sha256 与登记指纹不符（可能被篡改/损坏），拒绝密封' });
        continue;
      }
      // ② 加密 + 回读校验
      const { ciphertext, decryptKey } = encryptBuffer(plain);
      if (!decryptBuffer(ciphertext, decryptKey).equals(plain)) {
        skipped.push({ id: fa.id, key: fa.key, note: '加解密回读校验失败' });
        continue;
      }
      const sealedPath = `sealed/${fa.key}.enc`;
      const wrapped = wrapKey(decryptKey, KMS!);

      if (EXECUTE) {
        await minio.putObject(BUCKET, sealedPath, ciphertext, ciphertext.length, {
          'Content-Type': 'application/octet-stream',
        });
        // ③ 行翻转（在密文对象落盘之后）
        await prisma.fileAsset.update({
          where: { id: fa.id },
          data: { encrypted: true, sealedPath, sealedKey: wrapped },
        });
        // ④ 删明文对象（行已密封，失败不影响读路径）
        await minio.removeObject(BUCKET, fa.key).catch(() => undefined);
      }
      sealed.push({ id: fa.id, key: fa.key, note: EXECUTE ? `→ ${sealedPath}` : `(将密封至 ${sealedPath})` });
    } catch (e) {
      failed.push({ id: fa.id, key: fa.key, note: (e as Error).message });
    }
  }

  // 孤儿明文清理：已密封（encrypted=true 且 sealedKey 非空）但 asset.key 对象仍存在
  if (SWEEP_ORPHANS && EXECUTE) {
    const done = await prisma.fileAsset.findMany({
      where: { encrypted: true, sealedKey: { not: null }, sealedPath: { not: null } },
      select: { id: true, key: true },
    });
    for (const fa of done) {
      try {
        await minio.statObject(BUCKET, fa.key); // 对象仍存在 → 孤儿明文
        await minio.removeObject(BUCKET, fa.key);
        swept.push({ id: fa.id, key: fa.key, note: '孤儿明文已删' });
      } catch {
        /* 对象不存在 = 已清理，正常 */
      }
    }
  }

  // ── 汇总 ──
  console.log(`\n结果：密封 ${sealed.length} / 跳过 ${skipped.length} / 失败 ${failed.length}${SWEEP_ORPHANS && EXECUTE ? ` / 清理孤儿 ${swept.length}` : ''}`);
  for (const r of sealed) console.log(`  [sealed] ${r.key} ${r.note}`);
  for (const r of skipped) console.log(`  [skip]   ${r.key} ${r.note}`);
  for (const r of failed) console.log(`  [fail]   ${r.key} ${r.note}`);
  for (const r of swept) console.log(`  [sweep]  ${r.key} ${r.note}`);

  if (skipped.length > 0) console.log('\n跳过行须人工核查（指纹不符的对象可能被篡改——按事件处理，勿盲目重传覆盖）。');
  if (!EXECUTE && sealed.length > 0) console.log('\n以上为 dry-run 清单；确认后加 --execute 执行。');
  if (EXECUTE) console.log('\n执行后抽查建议：门户任一资质/资料文件下载可正常打开（走 streamFile 密封分支）。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
