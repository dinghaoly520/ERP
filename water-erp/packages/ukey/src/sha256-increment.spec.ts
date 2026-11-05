import { Sha256Incremental } from './sha256-increment';

/** 随机字节（Node ≥18 / 浏览器均有全局 crypto；getRandomValues 单次上限 65536B，分片填） */
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let off = 0; off < n; off += 65536) {
    crypto.getRandomValues(b.subarray(off, Math.min(off + 65536, n)));
  }
  return b;
}

/** [0, total) 内随机切分点（未排序、可重复、可为空——空 update 也在覆盖内） */
function randomCuts(total: number): number[] {
  const count = Math.floor(Math.random() * 9);
  return Array.from({ length: count }, () => Math.floor(Math.random() * total));
}

/** 按（无序）切分点分多次 update 喂入 */
function digestWithSplits(data: Uint8Array, cuts: number[]): string {
  const h = new Sha256Incremental();
  let prev = 0;
  for (const c of [...cuts].sort((a, b) => a - b)) {
    h.update(data.subarray(prev, c));
    prev = c;
  }
  h.update(data.subarray(prev));
  return h.finalHex();
}

/** crypto.subtle 全量摘要作唯一基准（WebCrypto 无流式接口，全量喂入可行） */
async function referenceHex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 55/56 = 0x80+8B 长度的单块边界；63/64/65 = 64B 分组边界；1MB+7 = 跨多分组带余数
const SIZES = [0, 1, 55, 56, 63, 64, 65, 1000, 1024 * 1024 + 7];

describe('Sha256Incremental（增量 SHA-256）', () => {
  describe.each(SIZES)('尺寸 %i', (size) => {
    test('随机切分多次 update 与 crypto.subtle 全量摘要一致', async () => {
      const data = randomBytes(size);
      const expected = await referenceHex(data);
      // 每个尺寸跑 3 轮随机切分，扩大分组边界命中面
      for (let trial = 0; trial < 3; trial++) {
        expect(digestWithSplits(data, randomCuts(size))).toBe(expected);
      }
    });
  });

  test('同输入两实例不同切分点结果相同', () => {
    const data = randomBytes(1000);
    expect(digestWithSplits(data, [1, 63, 64, 500, 999]))
      .toBe(digestWithSplits(data, [100, 200, 300, 640, 700, 900]));
  });

  test('finalHex 后再 update 抛错', () => {
    const h = new Sha256Incremental();
    h.update(new Uint8Array([1, 2, 3]));
    h.finalHex();
    expect(() => h.update(new Uint8Array([4]))).toThrow();
  });

  test('finalHex 后实例不可再用——再 finalHex 也抛错', () => {
    const h = new Sha256Incremental();
    h.finalHex();
    expect(() => h.finalHex()).toThrow();
  });

  test('已知向量：SHA-256("abc")', () => {
    const h = new Sha256Incremental();
    h.update(new TextEncoder().encode('abc'));
    expect(h.finalHex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('已知向量：空输入', () => {
    expect(new Sha256Incremental().finalHex())
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
