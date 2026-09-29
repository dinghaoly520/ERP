#!/usr/bin/env node
/**
 * 加密对象可解密性校验 —— 快照/SQL 恢复后的安全闸。
 *
 *   node scripts/verify-encrypted-assets.js
 *
 * 背景（2026-09-29 事故）：09-28 SQL 全量恢复用的是 09-22 09:44 备份，而招标文件
 * MinIO 对象在 10:01 已用新 DEK 重建 → DB 回灌旧 decryptKey ↔ MinIO 新对象失配
 * → 专家端 tender-document/download 500（AES-GCM 认证失败）。
 * 「对象在线」≠「密钥配对」——恢复后必须真正解一遍密。
 *
 * 校验范围：全部 BidDocument（join FileAsset）：
 *   对象存在 → unwrapKey(KMS_SECRET) → 全量 GCM 解密 → 明文 size/sha256 与 FileAsset 比对。
 * 刻意不扫其他 FileAsset 类目：开标文件包 JSON / C_inner / C_outer 存在合法悬空态
 * （EVALUATING 停止点无读端，见 memory demo-snapshot-system），全量存在性检查会误报。
 *
 * 任何 FAIL → exit 1（restore-demo.sh / db-restore.sh 链式调用即中断）。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* env 装载 + apps/api 依赖借用 —— 与 demo-snapshot.js 同款 */
const envPath = path.join(__dirname, '..', 'apps', 'api', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const { createRequire } = require('module');
const apiRequire = createRequire(path.join(__dirname, '..', 'apps', 'api', 'package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const Minio = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'minio'));
const prisma = new PrismaClient();
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'water_erp_minio',
  secretKey: process.env.MINIO_SECRET_KEY || 'water_erp_minio_dev',
});
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'water-erp';
const KMS_SECRET = process.env.KMS_SECRET;

/* ↓ 三段加解密均镜像 apps/api/src（common/crypto/envelope-crypto.ts 与
 *   announcement/bid-document.crypto.ts）——改源文件时此处同步。 */
function unwrapKey(wrappedBlob, kmsSecret) {
  const kek = crypto.createHash('sha256').update('water-erp-envelope-salt-v1').update(kmsSecret).digest();
  const wrapped = Buffer.from(wrappedBlob, 'base64');
  if (wrapped.length < 28) throw new Error('wrapped blob 过短');
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, wrapped.subarray(0, 12));
  decipher.setAuthTag(wrapped.subarray(12, 28));
  return Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]).toString('utf-8');
}
function isWrappedKey(value) {
  if (!value) return false;
  return /^[A-Za-z0-9+/=]+$/.test(value) && !/^[0-9a-f:]+$/.test(value);
}
function decryptBuffer(ciphertext, decryptKey) {
  const [keyHex, ivHex, authTagHex] = decryptKey.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]); // GCM 认证失败在此抛错
}

const FIX_HINT = [
  '修复指引（BidDocument 密钥↔对象失配，两次实录见 memory demo-snapshot-system 2026-09-22 / 09-29）：',
  '  1. 找到明文源（如 procurement/资料/ 下同名 docx）→ libreoffice --headless --convert-to pdf',
  '  2. encryptBuffer(pdf) 得新 DEK → minio putObject 同 key 覆写密文',
  '  3. wrapKey(新DEK, KMS_SECRET) 更新 BidDocument.decryptKey；FileAsset.size/sha256 按明文口径更新',
  '  4. 重跑本脚本确认全绿。若对象是快照恢复流程的产物，修复后记得同步快照 JSON 内 decryptKey。',
].join('\n');

async function main() {
  if (!KMS_SECRET) { console.error('❌ KMS_SECRET 未配置（apps/api/.env）'); process.exit(1); }
  const docs = await prisma.bidDocument.findMany({ include: { fileAsset: true } });
  if (!docs.length) { console.log('（库内无 BidDocument，跳过）'); return; }
  let failed = 0;
  for (const doc of docs) {
    const label = `${doc.id} ${doc.title?.slice(0, 24)}…`;
    try {
      const fa = doc.fileAsset;
      if (!fa) throw new Error('FileAsset 悬空（缺回灌？）');
      if (!doc.decryptKey) throw new Error('decryptKey 为空');
      const st = await minioClient.statObject(MINIO_BUCKET, fa.key).catch(() => null);
      if (!st) throw new Error(`MinIO 对象缺失: ${fa.key}`);
      const stream = await minioClient.getObject(MINIO_BUCKET, fa.key);
      const chunks = []; for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
      const dek = isWrappedKey(doc.decryptKey) ? unwrapKey(doc.decryptKey, KMS_SECRET) : doc.decryptKey;
      const pt = decryptBuffer(Buffer.concat(chunks), dek);
      if (pt.length !== fa.size) throw new Error(`size 失配: 明文 ${pt.length} ≠ FileAsset ${fa.size}`);
      const sha = crypto.createHash('sha256').update(pt).digest('hex');
      if (sha !== fa.sha256) throw new Error(`sha256 失配: 明文 ${sha.slice(0, 12)}… ≠ FileAsset ${(fa.sha256 || '').slice(0, 12)}…`);
      console.log(`✅ ${label} — ${fa.key}（${pt.length} B）解密+size/sha 校验一致`);
    } catch (e) {
      failed++;
      console.error(`❌ ${label} — ${e.message}`);
    }
  }
  if (failed) {
    console.error(`\n${failed}/${docs.length} 条 BidDocument 校验失败。${'❌'}`);
    console.error(FIX_HINT);
    process.exitCode = 1;
  } else {
    console.log(`全部 ${docs.length} 条 BidDocument 加密对象校验通过 ✅`);
  }
}

main().catch(e => { console.error('校验脚本异常:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
