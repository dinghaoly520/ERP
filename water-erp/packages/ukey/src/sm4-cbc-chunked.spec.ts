import { sm4Decrypt, sm4Encrypt } from './sm-crypto-layer';
import { SM4_CHUNK_BYTES, Sm4CbcChunkedDecryptor, Sm4CbcChunkedEncryptor } from './sm4-cbc-chunked';

/* ---------- 固定种子 PRNG ----------
   损坏/截断用例存在 ~1/256 的「非法填充被偶然当作合法」概率（解出的末字节恰好
   落在 0x00 或与填充长度吻合的值上），真随机会让用例偶发翻绿转红；固定种子既
   保留每尺寸独立的随机 key/IV/切分点，又保证用例完全可复现。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randBytes = (n: number, rand: () => number): Uint8Array => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(rand() * 256);
  return b;
};
const randHex = (bytes: number, rand: () => number): string => {
  let out = '';
  for (let i = 0; i < bytes; i++) out += Math.floor(rand() * 256).toString(16).padStart(2, '0');
  return out;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** 预分配 set 拼接（MB 级输出禁 push(...spread)——栈溢出） */
const concatAll = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

/** [0, total) 内随机切分点（未排序、可重复、可为空——空 update 也在覆盖面内） */
const randomCuts = (total: number, rand: () => number): number[] =>
  Array.from({ length: Math.floor(rand() * 9) }, () => Math.floor(rand() * total));

/** 按切分点分多次 update 后 final，收集全部分段输出并拼接 */
function feedAll(stream: { update(c: Uint8Array): Uint8Array; final(): Uint8Array }, data: Uint8Array, cuts: number[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let prev = 0;
  for (const c of [...cuts].sort((a, b) => a - b)) {
    parts.push(stream.update(data.subarray(prev, c)));
    prev = c;
  }
  parts.push(stream.update(data.subarray(prev)));
  parts.push(stream.final());
  return concatAll(parts);
}

/** 逐字节相等断言（带首个差异位置诊断） */
function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  const n = Math.min(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`首个差异字节 @${i}: actual=${actual[i]} expected=${expected[i]}`);
    }
  }
  expect(actual.length).toBe(expected.length);
}

// 0/1/15/16/17 = 空文件（仅一块填充）与 16B 块边界（含整除补整块）；31/32/33 = 跨块边界；
// 1000/4096/65543 = 多块带余；1MB/1MB+3 = MB 级逐字节一致性闸（本任务的存在意义）
const SIZES = [0, 1, 15, 16, 17, 31, 32, 33, 1000, 4096, 65543, 1024 * 1024, 1024 * 1024 + 3];

describe('Sm4CbcChunkedEncryptor/Decryptor（SM4-CBC 分块滚动 IV 续链）', () => {
  describe.each(SIZES)('尺寸 %i', (size) => {
    const rand = mulberry32(0x534d3421 ^ (size * 2654435761)); // 每尺寸独立种子
    const keyHex = randHex(16, rand);
    const ivHex = randHex(16, rand);
    const plain = randBytes(size, rand);

    test('加密一致：随机切分多次 update + final 与 one-shot 逐字节相等', () => {
      const expected = hexToBytes(sm4Encrypt(keyHex, ivHex, bytesToHex(plain)));
      // 每尺寸 3 轮随机切分，扩大块边界与空 update 的命中面
      for (let trial = 0; trial < 3; trial++) {
        const out = feedAll(new Sm4CbcChunkedEncryptor({ keyHex, ivHex }), plain, randomCuts(size, rand));
        expectBytesEqual(out, expected);
      }
    });

    test('字节计数契约：总输出 = plain + padLen（整除补整块 16）', () => {
      const out = feedAll(new Sm4CbcChunkedEncryptor({ keyHex, ivHex }), plain, []);
      expect(out.length).toBe(size + (16 - (size % 16)));
    });

    test('解密一致：one-shot 密文按随机切分喂入拼接与原文相等', () => {
      const cipher = hexToBytes(sm4Encrypt(keyHex, ivHex, bytesToHex(plain)));
      for (let trial = 0; trial < 3; trial++) {
        const out = feedAll(new Sm4CbcChunkedDecryptor({ keyHex, ivHex }), cipher, randomCuts(cipher.length, rand));
        expectBytesEqual(out, plain);
      }
    });

    test('加解密往返：分块加密输出喂分块解密还原原文', () => {
      const cipher = feedAll(new Sm4CbcChunkedEncryptor({ keyHex, ivHex }), plain, randomCuts(size, rand));
      const back = feedAll(new Sm4CbcChunkedDecryptor({ keyHex, ivHex }), cipher, randomCuts(cipher.length, rand));
      expectBytesEqual(back, plain);
    });
  });

  // 1B×N 逐字节喂法是最极端的切分（尾巴缓冲路径全覆盖）；只取小尺寸——
  // 1MB 级做百万次 update 只会拖慢套件，无新增覆盖面
  describe.each([1, 15, 16, 17, 31, 32, 33, 1000])('单字节喂法 尺寸 %i', (size) => {
    const rand = mulberry32(0x62797465 ^ (size * 40503));
    const keyHex = randHex(16, rand);
    const ivHex = randHex(16, rand);
    const plain = randBytes(size, rand);
    const oneShotCipher = hexToBytes(sm4Encrypt(keyHex, ivHex, bytesToHex(plain)));

    test('加密：1B×N 次 update 结果不变', () => {
      const enc = new Sm4CbcChunkedEncryptor({ keyHex, ivHex });
      const parts: Uint8Array[] = [];
      for (let i = 0; i < size; i++) parts.push(enc.update(plain.subarray(i, i + 1)));
      parts.push(enc.final());
      expectBytesEqual(concatAll(parts), oneShotCipher);
    });

    test('解密：1B×N 次 update 结果不变', () => {
      const dec = new Sm4CbcChunkedDecryptor({ keyHex, ivHex });
      const parts: Uint8Array[] = [];
      for (let i = 0; i < oneShotCipher.length; i++) parts.push(dec.update(oneShotCipher.subarray(i, i + 1)));
      parts.push(dec.final());
      expectBytesEqual(concatAll(parts), plain);
    });
  });

  describe('损坏与截断', () => {
    const rand = mulberry32(0xbaadc0de);
    const keyHex = randHex(16, rand);
    const ivHex = randHex(16, rand);
    const plain = randBytes(64, rand); // 密文 80B = 5 块，损坏/截断均落在末段语义内
    const cipher = hexToBytes(sm4Encrypt(keyHex, ivHex, bytesToHex(plain)));

    test('末块翻转一字节 → final 抛 padding is invalid', () => {
      const corrupted = cipher.slice();
      corrupted[corrupted.length - 1] ^= 0x5a;
      const dec = new Sm4CbcChunkedDecryptor({ keyHex, ivHex });
      dec.update(corrupted);
      expect(() => dec.final()).toThrow('padding is invalid');
    });

    test('密文截断一块 → final 抛错', () => {
      const dec = new Sm4CbcChunkedDecryptor({ keyHex, ivHex });
      dec.update(cipher.subarray(0, cipher.length - 16));
      expect(() => dec.final()).toThrow();
    });

    test('密文截断至非 16B 对齐 → final 抛错', () => {
      const dec = new Sm4CbcChunkedDecryptor({ keyHex, ivHex });
      dec.update(cipher.subarray(0, cipher.length - 6));
      expect(() => dec.final()).toThrow();
    });
  });

  describe('实例生命周期', () => {
    const rand = mulberry32(0x11fec0de);
    const dek = { keyHex: randHex(16, rand), ivHex: randHex(16, rand) };

    test('Encryptor：final 后 update 抛错', () => {
      const enc = new Sm4CbcChunkedEncryptor(dek);
      enc.update(new Uint8Array([1, 2, 3]));
      enc.final();
      expect(() => enc.update(new Uint8Array([4]))).toThrow();
    });

    test('Encryptor：final 后再 final 抛错', () => {
      const enc = new Sm4CbcChunkedEncryptor(dek);
      enc.final();
      expect(() => enc.final()).toThrow();
    });

    test('Decryptor：final 后 update 抛错', () => {
      // 须先走完一条合法密文流（空流/随机字节会在 final 处抛填充/长度错误，测不到生命周期）
      const cipher = hexToBytes(sm4Encrypt(dek.keyHex, dek.ivHex, bytesToHex(randBytes(64, rand))));
      const dec = new Sm4CbcChunkedDecryptor(dek);
      dec.update(cipher);
      dec.final();
      expect(() => dec.update(new Uint8Array([1]))).toThrow();
    });

    test('Decryptor：final 后再 final 抛错', () => {
      const cipher = hexToBytes(sm4Encrypt(dek.keyHex, dek.ivHex, bytesToHex(randBytes(64, rand))));
      const dec = new Sm4CbcChunkedDecryptor(dek);
      dec.update(cipher);
      dec.final();
      expect(() => dec.final()).toThrow();
    });
  });

  test('SM4_CHUNK_BYTES = 2MB（后续任务的分块基准）', () => {
    expect(SM4_CHUNK_BYTES).toBe(2 * 1024 * 1024);
  });

  test('one-shot 基准自检：sm4Decrypt(sm4Encrypt(x)) = x（基线可信）', () => {
    const rand = mulberry32(0xba5e11);
    const keyHex = randHex(16, rand);
    const ivHex = randHex(16, rand);
    const plain = randBytes(100, rand);
    expect(sm4Decrypt(keyHex, ivHex, sm4Encrypt(keyHex, ivHex, bytesToHex(plain)))).toBe(bytesToHex(plain));
  });
});
