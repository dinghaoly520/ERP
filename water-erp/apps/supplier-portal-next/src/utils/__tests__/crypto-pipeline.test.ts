/**
 * crypto-pipeline 单测（Task 4）——流式管线 vs one-shot 双层等价锚
 *
 * 纯 Node（node:test）跑：ReadableStream/Blob/crypto 均为 Node 24 全局。
 * 等价锚：同 key/IV 下管线产出与手工 one-shot `sm4Encrypt(dekA, sm4Encrypt(dekS))`
 * 逐字节一致（信封字节级零变化是本项目回归闸）；解密按层单把 DEK 调用，
 * 往返 = 剥外层（dekA）→ 剥内层（dekS）两跳（与产品流一致：服务端剥外层、
 * 供应商解密卡剥内层）。
 * 尺寸上限 300KB+7（控制时长）——SM4 块边界穿越已由 ukey 侧 Task 2 尺寸矩阵锁定。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomHex, sha256Hex, sm4Encrypt, SM4_CHUNK_BYTES } from '@water-erp/ukey';
import type { DekHex } from '../crypto-pipeline';
import { decryptStream, encryptFileStream, parseContentLengthBytes } from '../crypto-pipeline';

/** 测试尺寸：0（空）/1（单字节）/16（恰好整块）/1000（非对齐）/300KB+7（跨多个读段） */
const SIZES = [0, 1, 16, 1000, 300 * 1024 + 7];

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const fromHex = (h: string): Uint8Array =>
  new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const randomDek = (): DekHex => ({ keyHex: randomHex(16), ivHex: randomHex(16) });
/** getRandomValues 单次上限 65536B——超限分段填充 */
const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  for (let pos = 0; pos < n; pos += 65536) crypto.getRandomValues(out.subarray(pos, pos + 65536));
  return out;
};

/** 随机切分（1B..16KB 段）喂流——任意非对齐 update 是 Task 2 锁定的风险面，这里沿用 */
const chunkedStream = (bytes: Uint8Array, maxChunk = 16 * 1024): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (let pos = 0; pos < bytes.length; ) {
        const len = 1 + Math.floor(Math.random() * maxChunk);
        controller.enqueue(bytes.slice(pos, pos + len));
        pos += len;
      }
      controller.close();
    },
  });

/** 定长切分喂流（进度用例：小段密集读，验证节流不被读段风暴击穿） */
const fixedChunkStream = (bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (let pos = 0; pos < bytes.length; pos += chunkSize) {
        controller.enqueue(bytes.slice(pos, pos + chunkSize));
      }
      controller.close();
    },
  });

const blobBytes = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer());

/* ───────────────────── 组1：管线等价锚（vs one-shot 双层手工期望） ───────────────────── */

for (const size of SIZES) {
  test(`等价锚 ${size}B：管线 C_outer/三哈希/三字节计数 == one-shot 双层手工值`, async () => {
    const plain = randomBytes(size);
    const dekS = randomDek();
    const dekA = randomDek();

    // 手工期望：C_inner = sm4Encrypt(dekS, plain)、C_outer = sm4Encrypt(dekA, C_inner)
    const innerHex = sm4Encrypt(dekS.keyHex, dekS.ivHex, toHex(plain));
    const cInner = fromHex(innerHex);
    const outerHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, innerHex);
    const cOuter = fromHex(outerHex);

    const r = await encryptFileStream(chunkedStream(plain), plain.length, dekS, dekA);

    assert.equal(toHex(await blobBytes(r.outerBlob)), outerHex, 'outerBlob 字节 == one-shot C_outer');
    assert.equal(r.plainSha256, await sha256Hex(plain), 'plainSha256');
    assert.equal(r.innerSha256, await sha256Hex(cInner), 'innerSha256（对 C_inner 字节）');
    assert.equal(r.outerSha256, await sha256Hex(cOuter), 'outerSha256（对 C_outer 字节）');
    assert.equal(r.plainBytes, plain.length, 'plainBytes');
    assert.equal(r.innerBytes, cInner.length, 'innerBytes == one-shot C_inner 长度');
    assert.equal(r.outerBytes, cOuter.length, 'outerBytes == one-shot C_outer 长度');
    // PKCS#7 字节计数公式（整除补整块）
    const padLen = 16 - (plain.length % 16) || 16;
    assert.equal(r.innerBytes, plain.length + padLen, `innerBytes 公式（pad=${padLen}）`);
    assert.equal(r.outerBytes, r.innerBytes + 16, 'outerBytes 公式（外层恒 +1 填充块）');
    assert.equal(r.outerBlob.type, 'application/octet-stream');
  });
}

/* ───────────────────── 组2：往返（C_outer 流 → 两跳单层解密 → 原 plain） ───────────────────── */

for (const size of SIZES) {
  test(`往返 ${size}B：decryptStream(dekA) 剥外层 → decryptStream(dekS) 还原明文`, async () => {
    const plain = randomBytes(size);
    const dekS = randomDek();
    const dekA = randomDek();
    const enc = await encryptFileStream(chunkedStream(plain), plain.length, dekS, dekA);
    const cOuter = await blobBytes(enc.outerBlob);

    const inner = await decryptStream(chunkedStream(cOuter), dekA);
    assert.equal(inner.plainBytes, enc.innerBytes, '第一跳产出 = C_inner');
    assert.equal(inner.plainSha256, enc.innerSha256, 'C_inner 哈希与加密侧一致');

    const back = await decryptStream(chunkedStream(await blobBytes(inner.plainBlob)), dekS);
    assert.equal(toHex(await blobBytes(back.plainBlob)), toHex(plain), 'plainBlob 字节 == 原 plain');
    assert.equal(back.plainSha256, enc.plainSha256, 'plainSha256 相等');
    assert.equal(back.plainBytes, plain.length);
  });
}

/* ───────────────────── 组3：进度（单调 / 终值 / 节流档数上界） ───────────────────── */

test('进度：doneBytes 单调不减、终值==总量、节流后调用次数 ≤ 块数+2（300 段密集读只出 1 档）', async () => {
  const plain = randomBytes(300 * 1024 + 7); // 307207B
  const dekS = randomDek();
  const dekA = randomDek();

  const encProgress: number[] = [];
  const enc = await encryptFileStream(
    fixedChunkStream(plain, 1024), // 301 个读段——无节流则回调风暴
    plain.length,
    dekS,
    dekA,
    (done) => {
      encProgress.push(done);
    },
  );
  const plainBlocks = Math.ceil(plain.length / SM4_CHUNK_BYTES);
  assert.ok(encProgress.length <= plainBlocks + 2, `加密侧节流：${encProgress.length} 次 ≤ ${plainBlocks}+2`);
  assert.ok(encProgress.length < 300, '301 个读段不逐段回调');
  assert.ok(
    encProgress.every((v, i) => i === 0 || v >= encProgress[i - 1]!),
    '单调不减',
  );
  assert.equal(encProgress[encProgress.length - 1], plain.length, '最终 == totalBytes');

  // 解密侧对称（按密文 doneBytes 计）：两跳各自验证
  const cOuter = await blobBytes(enc.outerBlob);
  const decProgress: number[] = [];
  const inner = await decryptStream(fixedChunkStream(cOuter, 1024), dekA, (done) => {
    decProgress.push(done);
  });
  const cipherBlocks = Math.ceil(cOuter.length / SM4_CHUNK_BYTES);
  assert.ok(decProgress.length <= cipherBlocks + 2, `解密侧节流：${decProgress.length} 次 ≤ ${cipherBlocks}+2`);
  assert.ok(
    decProgress.every((v, i) => i === 0 || v >= decProgress[i - 1]!),
    '解密侧单调不减',
  );
  assert.equal(decProgress[decProgress.length - 1], cOuter.length, '最终 == 密文长');
  assert.equal(inner.plainBytes, enc.innerBytes);

  const decProgress2: number[] = [];
  const back = await decryptStream(
    fixedChunkStream(await blobBytes(inner.plainBlob), 1024),
    dekS,
    (done) => {
      decProgress2.push(done);
    },
  );
  assert.equal(decProgress2[decProgress2.length - 1], enc.innerBytes, '第二跳终值 == C_inner 长');
  assert.equal(back.plainSha256, enc.plainSha256);
});

/* ───────────────────── 组4：totalBytes 声明不符闸（T4①——防截断/改动静默进信封） ───────────────────── */

test('totalBytes 声明不符 → throw（流 10B 声明 9B 不许静默放行）', async () => {
  const plain = randomBytes(10);
  await assert.rejects(
    encryptFileStream(chunkedStream(plain), 9, randomDek(), randomDek()),
    /totalBytes 9 不符/,
  );
});

/* ───────────────────── 组5：空文件（每层单填充块，与 one-shot 空输入一致） ───────────────────── */

test('空文件：双层各补单填充块——innerBytes=16/outerBytes=32，outerBlob == one-shot 空输入双层密文', async () => {
  const dekS = randomDek();
  const dekA = randomDek();
  const expectedOuterHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, sm4Encrypt(dekS.keyHex, dekS.ivHex, ''));

  const r = await encryptFileStream(chunkedStream(new Uint8Array(0)), 0, dekS, dekA);
  assert.equal(r.plainBytes, 0);
  assert.equal(r.innerBytes, 16, '内层=单填充块');
  assert.equal(r.outerBytes, 32, '外层=C_inner(16)+自身填充块(16)');
  assert.equal(r.outerBlob.size, 32);
  assert.equal(toHex(await blobBytes(r.outerBlob)), expectedOuterHex, '与 one-shot 空输入一致');
  assert.equal(r.plainSha256, await sha256Hex(new Uint8Array(0)), '空串 sha256');

  // 空文件往返闭环：32B → 16B → 0B
  const mid = await decryptStream(chunkedStream(fromHex(expectedOuterHex)), dekA);
  assert.equal(mid.plainBytes, 16);
  const back = await decryptStream(chunkedStream(await blobBytes(mid.plainBlob)), dekS);
  assert.equal(back.plainBytes, 0);
  assert.equal(back.plainBlob.size, 0);
  assert.equal(back.plainSha256, await sha256Hex(new Uint8Array(0)));
});

/* ───────────────────── 组6：取消（shouldStop 块边界哨兵——F5 修复波） ───────────────────── */

test('取消：encryptFileStream shouldStop 第 N 次检查起置位 → reject CRYPTO_CANCELLED（部分产出随拒绝作废）', async () => {
  const plain = randomBytes(300 * 1024 + 7);
  let checks = 0;
  await assert.rejects(
    encryptFileStream(
      fixedChunkStream(plain, 64 * 1024), // 5 个读段——多块输入
      plain.length,
      randomDek(),
      randomDek(),
      undefined,
      () => ++checks > 2, // 第 3 次检查（块边界）起取消
    ),
    /CRYPTO_CANCELLED/,
  );
  assert.ok(checks >= 3, `取消检查确实执行并拦截（${checks} 次）`);
});

test('取消：decryptStream shouldStop 第 N 次检查起置位 → reject CRYPTO_CANCELLED（不触 final/padding 校验）', async () => {
  const plain = randomBytes(300 * 1024 + 7);
  const enc = await encryptFileStream(chunkedStream(plain), plain.length, randomDek(), randomDek());
  const cOuter = await blobBytes(enc.outerBlob);
  let checks = 0;
  await assert.rejects(
    decryptStream(
      fixedChunkStream(cOuter, 64 * 1024),
      randomDek(), // 到不了 final——错钥 padding 校验不构成干扰
      undefined,
      () => ++checks > 2,
    ),
    /CRYPTO_CANCELLED/,
  );
  assert.ok(checks >= 3, `取消检查确实执行并拦截（${checks} 次）`);
});

/* ───────────────────── 组7：parseContentLengthBytes（Content-Length 唯一实现，engine/worker 双消费） ───────────────────── */

test('parseContentLengthBytes：合法→字节数；缺失/空串/非法/非正→0', () => {
  assert.equal(parseContentLengthBytes('12345'), 12345);
  assert.equal(parseContentLengthBytes('0'), 0, '0=未知总量口径（非「总长 0」）');
  assert.equal(parseContentLengthBytes('-5'), 0);
  assert.equal(parseContentLengthBytes('abc'), 0);
  assert.equal(parseContentLengthBytes('NaN'), 0);
  assert.equal(parseContentLengthBytes(''), 0);
  assert.equal(parseContentLengthBytes(null), 0);
});
