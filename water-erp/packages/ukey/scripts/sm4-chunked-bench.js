#!/usr/bin/env node
/* =====================================================================
   sm4-chunked-bench —— SM4-CBC 分块 vs one-shot 基准（双信封大文件分块加密 spec「实现纪要」数据源）

   用法（packages/ukey/ 下或任意 cwd，CJS 直跑；消费本包 dist，勿在 require 路径上再 build）：
     node scripts/sm4-chunked-bench.js               # 默认档 25MB / 100MB
     node scripts/sm4-chunked-bench.js --big         # 追加 500MB 档（仅分块——one-shot 500MB
                                                     #   需 ~10×S 堆（hex 串+number[] 扩散），
                                                     #   任何现实堆下都 OOM，不测）
     node scripts/sm4-chunked-bench.js --sizes=25,100
   ⚠ one-shot 100MB 档单进程实测需 >4GB 提交堆（25MB 档残留 + hex/number[] 放大，V8 不及回收），
     默认 4GB 堆会 OOM——跑含 one-shot 的基准请带堆参数：
     node --max-old-space-size=6144 scripts/sm4-chunked-bench.js
     node --max-old-space-size=8192 scripts/sm4-chunked-bench.js --big

   口径：
   - one-shot = 现状遗留路径（sm-crypto-layer sm4Encrypt/sm4Decrypt，hex 进 hex 出）；
     其解密把 hex 串直传 sm-crypto（内部 hex→number[] 往返）——这正是遗留路径吞吐减半的实测点。
   - chunked  = Sm4CbcChunked*（滚动 IV 续链，2MB=SM4_CHUNK_BYTES 分段，Buffer/Uint8Array 直传）。
   - 每档自检：chunked 解密回读 sha256 == 源；≤100MB 档另比对 chunked 密文 == one-shot 密文
     （逐字节等价的运行时佐证——正式回归闸在 sm4-cbc-chunked.spec.ts）。
   ===================================================================== */
'use strict';

const {
  Sm4CbcChunkedEncryptor,
  Sm4CbcChunkedDecryptor,
  SM4_CHUNK_BYTES,
  sm4Encrypt,
  sm4Decrypt,
} = require('../dist/index.js');
const crypto = require('crypto');

const MB = 1024 * 1024;
const ONESHOT_AUTO_SKIP_BYTES = 150 * MB; // ≥150MB 自动跳过 one-shot：100MB 档实测已需 >4GB 提交堆，
                                          // 150-200MB 手输档必 OOM（静默撞死不如打警告跳过）

function parseSizes() {
  const arg = process.argv.find((a) => a.startsWith('--sizes='));
  if (arg) return arg.slice('--sizes='.length).split(',').map((s) => Number(s)).filter((n) => n > 0);
  const sizes = [25, 100];
  if (process.argv.includes('--big')) sizes.push(500);
  return sizes;
}

const hr = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms（µs→ms 浮点）
const rssMB = () => Math.round(process.memoryUsage().rss / MB);

function chunkedEncrypt(data, dek) {
  const enc = new Sm4CbcChunkedEncryptor(dek);
  const parts = [];
  for (let off = 0; off < data.length; off += SM4_CHUNK_BYTES) {
    const seg = data.subarray(off, Math.min(off + SM4_CHUNK_BYTES, data.length));
    const out = enc.update(seg);
    if (out.length > 0) parts.push(Buffer.from(out));
  }
  parts.push(Buffer.from(enc.final()));
  return Buffer.concat(parts);
}

function chunkedDecrypt(data, dek) {
  const dec = new Sm4CbcChunkedDecryptor(dek);
  const parts = [];
  for (let off = 0; off < data.length; off += SM4_CHUNK_BYTES) {
    const seg = data.subarray(off, Math.min(off + SM4_CHUNK_BYTES, data.length));
    const out = dec.update(seg);
    if (out.length > 0) parts.push(Buffer.from(out));
  }
  parts.push(Buffer.from(dec.final()));
  return Buffer.concat(parts);
}

function oneShotEncrypt(data, dek) {
  return Buffer.from(sm4Encrypt(dek.keyHex, dek.ivHex, data.toString('hex')), 'hex');
}

function oneShotDecrypt(cipher, dek) {
  return Buffer.from(sm4Decrypt(dek.keyHex, dek.ivHex, cipher.toString('hex')), 'hex');
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function measure(label, fn) {
  const t0 = hr();
  const out = fn();
  const ms = hr() - t0;
  const mb = out.length / MB;
  console.log(`  ${label.padEnd(22)} ${String(Math.round(ms)).padStart(7)} ms   ${(mb / (ms / 1000)).toFixed(1).padStart(7)} MB/s`);
  return { out, ms };
}

function main() {
  console.log(`sm4-chunked-bench  chunk=${SM4_CHUNK_BYTES / MB}MB  node=${process.version}  (one-shot ≥${ONESHOT_AUTO_SKIP_BYTES / MB}MB 自动跳过)`);
  // JIT 预热（2MB 加解密一轮，不计时）
  {
    const dek = { keyHex: crypto.randomBytes(16).toString('hex'), ivHex: crypto.randomBytes(16).toString('hex') };
    const warm = crypto.randomBytes(2 * MB);
    chunkedDecrypt(chunkedEncrypt(warm, dek), dek);
    oneShotDecrypt(oneShotEncrypt(warm, dek), dek);
  }

  const rows = [];
  for (const sizeMB of parseSizes()) {
    const size = Math.round(sizeMB * MB);
    const dek = { keyHex: crypto.randomBytes(16).toString('hex'), ivHex: crypto.randomBytes(16).toString('hex') };
    console.log(`\n== ${sizeMB} MB（随机明文 ${size}B）==  rss@start ${rssMB()}MB`);
    const data = crypto.randomBytes(size);
    const srcSha = sha(data);

    const cEnc = measure('chunked  encrypt', () => chunkedEncrypt(data, dek));
    const cDec = measure('chunked  decrypt', () => chunkedDecrypt(cEnc.out, dek));
    if (sha(cDec.out) !== srcSha) throw new Error('chunked 回读 sha256 不符——密码学损坏，基准作废');
    rows.push({ sizeMB, track: 'chunked', encMs: cEnc.ms, decMs: cDec.ms });

    if (size < ONESHOT_AUTO_SKIP_BYTES) {
      const oEnc = measure('one-shot encrypt', () => oneShotEncrypt(data, dek));
      const oDec = measure('one-shot decrypt', () => oneShotDecrypt(oEnc.out, dek));
      if (sha(oDec.out) !== srcSha) throw new Error('one-shot 回读 sha256 不符——基准作废');
      if (sha(oEnc.out) !== sha(cEnc.out)) throw new Error('chunked 与 one-shot 密文不一致——逐字节等价破坏');
      console.log('  自检：回读 sha256 ✓  chunked==one-shot 密文 ✓');
      rows.push({ sizeMB, track: 'one-shot', encMs: oEnc.ms, decMs: oDec.ms });
    } else {
      console.log(`  自检：chunked 回读 sha256 ✓（⚠ one-shot 档自动跳过：${sizeMB}MB ≥ ${ONESHOT_AUTO_SKIP_BYTES / MB}MB 阈值，堆需求 ~10×S 必 OOM——如确要跑请自行改 ONESHOT_AUTO_SKIP_BYTES 并带 --max-old-space-size）`);
    }
    console.log(`  rss@end ${rssMB()}MB`);
  }

  console.log('\n── 汇总（MB/s = 明文字节 ÷ 墙钟）──');
  console.log('  size    track      enc      dec');
  for (const r of rows) {
    const enc = (r.sizeMB / (r.encMs / 1000)).toFixed(1);
    const dec = (r.sizeMB / (r.decMs / 1000)).toFixed(1);
    console.log(`  ${String(r.sizeMB).padStart(4)}MB  ${r.track.padEnd(9)} ${enc.padStart(7)}  ${dec.padStart(7)}`);
  }
}

main();
