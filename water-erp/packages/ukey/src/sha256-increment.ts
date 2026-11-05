/**
 * 增量 SHA-256——大文件流式哈希基元。
 *
 * WebCrypto 的 digest 只能一次性喂全量（crypto.subtle 无流式接口），
 * 数百 MB 投标文件在浏览器 worker / 服务端流里需分块喂入、内存不持全文。
 * 与 canonical.ts 的 sha256Hex 结果一致（同算法、仅增量喂入）。
 */

/** SHA-256 轮常数（前 64 个素数立方根小数部分） */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 循环右移（JS 位运算符是 32 位有符号——先 >>> 再 << 补高位） */
const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

export class Sha256Incremental {
  /** 中间状态 H0..H7（大端输出序） */
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  /** 未满 64B 的尾部缓冲（调用方缓冲可能复用，这里必须拷贝） */
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  /** 累计字节数（Number 整数精确到 2^53，远超单文件上限） */
  private totalBytes = 0;
  private finalized = false;
  /** 消息调度 W（复用避免每块分配） */
  private readonly w = new Uint32Array(64);

  update(data: Uint8Array): void {
    if (this.finalized) throw new Error('Sha256Incremental: finalHex 后实例不可再用');
    const n = data.length;
    if (n === 0) return;
    this.totalBytes += n;
    let pos = 0;
    // 先补满尾部缓冲
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, n);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      pos = take;
      if (this.blockLen === 64) {
        this.compress(this.block, 0);
        this.blockLen = 0;
      }
    }
    // 整块直接在调用方缓冲上压缩（零拷贝零分配——大文件每 64B 一次，不建 subarray 视图）
    while (pos + 64 <= n) {
      this.compress(data, pos);
      pos += 64;
    }
    // 余量拷入尾部缓冲
    if (pos < n) {
      this.block.set(data.subarray(pos), this.blockLen);
      this.blockLen += n - pos;
    }
  }

  finalHex(): string {
    if (this.finalized) throw new Error('Sha256Incremental: finalHex 后实例不可再用');
    this.finalized = true;
    // 位长 64 位大端：bits = totalBytes * 8，以 2^29 字节为界拆高低 32 位（×8 后低半不溢出）
    const bitsHi = Math.floor(this.totalBytes / 0x20000000);
    const bitsLo = (this.totalBytes % 0x20000000) * 8;
    this.block[this.blockLen++] = 0x80;
    // 0x80 落在 [56,64) 内则 8B 长度放不下——先冲一块再补一块（56B 边界的由来）
    if (this.blockLen > 56) {
      this.block.fill(0, this.blockLen, 64);
      this.compress(this.block, 0);
      this.blockLen = 0;
    }
    this.block.fill(0, this.blockLen, 56);
    this.block.set(new Uint8Array([
      (bitsHi >>> 24) & 0xff, (bitsHi >>> 16) & 0xff, (bitsHi >>> 8) & 0xff, bitsHi & 0xff,
      (bitsLo >>> 24) & 0xff, (bitsLo >>> 16) & 0xff, (bitsLo >>> 8) & 0xff, bitsLo & 0xff,
    ]), 56);
    this.compress(this.block, 0);
    let out = '';
    for (let i = 0; i < 8; i++) out += this.state[i].toString(16).padStart(8, '0');
    return out;
  }

  /** 压缩 src[offset, offset+64) 的单个分组（offset 起点避免逐块建视图） */
  private compress(src: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const o = offset + i * 4;
      w[i] = ((src[o] << 24) | (src[o + 1] << 16) | (src[o + 2] << 8) | src[o + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      // 加法在 float64 精确范围内（< 2^53），>>> 0 收回 32 位
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}
