/**
 * SM4-CBC 分块加解密——滚动 IV 续链（双信封大文件分块加密的密码学内核）。
 *
 * one-shot `sm4Encrypt/sm4Decrypt`（sm-crypto-layer.ts）要求整段明文/密文同时在
 * 内存，500MB 投标文件必须流式处理：update 喂任意大小分段、final 收尾，CBC 链以
 * 「上一密文块 hex」作为下一次调用的 iv 滚动续接——**累计输出与 one-shot 逐字节
 * 一致**（sm4-cbc-chunked.spec.ts 以 13 尺寸矩阵 × 随机切分作一致性闸）。
 *
 * sm-crypto 的两个隐性行为决定实现约束：
 * - `padding:'none'` 对非 16B 对齐输入会**静默丢弃**尾部不满一块的字节——
 *   中间段必须自行缓冲未对齐尾巴，只以对齐段调用；
 * - `padding:'pkcs#7'` 加密侧恒在输入后补齐（整除输入补整块 16B）、解密侧负责
 *   校验并剥除——只允许出现在末段（final），否则链条与 one-shot 不再一致。
 *
 * sm-crypto 为无类型 CJS 包（局部 require 声明同 sm-crypto-layer.ts）；历史 Vite
 * 消费方（旧 supplier-portal）已删除，现存消费方为 Next 门户与 Node/jest。
 */

declare const require: (id: string) => { sm4: any };

const sm4 = require('sm-crypto').sm4;

/** 分块调用的标准块大小（2MB，调用方切片参考值；类本身接受任意大小 update） */
export const SM4_CHUNK_BYTES = 2 * 1024 * 1024;

const BLOCK = 16;

/** 中间段无填充成链；末段（final）才带 PKCS#7 */
type Padding = 'none' | 'pkcs#7';

/** [end-16, end) → hex（滚动 IV——sm-crypto 的 iv 选项收 hex 串） */
const lastBlockHex = (bytes: ArrayLike<number>, end: number): string => {
  let out = '';
  for (let i = end - BLOCK; i < end; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
};

/** 预分配 set 拼接（禁 push(...spread)——MB 级分段会栈溢出） */
const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

export class Sm4CbcChunkedEncryptor {
  private readonly keyHex: string;
  /** 滚动 IV：上一密文块 hex（首段 = 原始 IV） */
  private lastCipherBlockHex: string;
  /** 未满 16B 对齐的明文尾巴（0..15B；拷贝持有——调用方缓冲可能复用） */
  private pendingTail: Uint8Array = new Uint8Array(0);
  private finalized = false;

  constructor(dek: { keyHex: string; ivHex: string }) {
    this.keyHex = dek.keyHex;
    this.lastCipherBlockHex = dek.ivHex;
  }

  /** 喂入任意大小明文段，返回本次完成的密文字节（未对齐尾巴扣留至后续段）。 */
  update(chunk: Uint8Array): Uint8Array {
    if (this.finalized) throw new Error('Sm4CbcChunkedEncryptor: final 后实例不可再用');
    const tail = this.pendingTail;
    const avail = tail.length + chunk.length;
    const processLen = avail - (avail % BLOCK); // 中间段只允许 16B 对齐输入
    if (processLen === 0) {
      if (chunk.length > 0) this.pendingTail = concat(tail, chunk);
      return new Uint8Array(0);
    }
    // 对齐段视图：tail 为空时直接落在调用方 chunk 上（2MB 主路径零拷贝）
    const aligned =
      tail.length === 0 ? chunk.subarray(0, processLen) : concat(tail, chunk).subarray(0, processLen);
    const cipher = this.run(aligned, 'none');
    this.lastCipherBlockHex = lastBlockHex(cipher, cipher.length);
    // 余量拷贝扣留（tail ≤ 15 < 16 ≤ processLen，尾巴必然已被整段消耗、余量全在 chunk 内）
    this.pendingTail = chunk.slice(processLen - tail.length);
    return cipher;
  }

  /** 末段：未对齐尾巴（0..15B，可为空=空文件）交给 sm-crypto 补 PKCS#7（整除补整块）。 */
  final(): Uint8Array {
    if (this.finalized) throw new Error('Sm4CbcChunkedEncryptor: final 后实例不可再用');
    this.finalized = true;
    return this.run(this.pendingTail, 'pkcs#7');
  }

  /** 单次 sm-crypto 调用：字节数组直传（禁 hex 往返——字符串通道吞吐减半且有损）。 */
  private run(segment: Uint8Array, padding: Padding): Uint8Array {
    const out: number[] = sm4.encrypt(Array.from(segment), this.keyHex, {
      mode: 'cbc',
      padding,
      iv: this.lastCipherBlockHex,
      output: 'array',
    });
    return new Uint8Array(out);
  }
}

export class Sm4CbcChunkedDecryptor {
  private readonly keyHex: string;
  /** 滚动 IV：上一段密文的末块 hex（首段 = 原始 IV）——解密链向量取自密文而非明文 */
  private lastCipherBlockHex: string;
  /** 扣留的密文（16..31B）：最后一块可能承载 PKCS#7，须待 final 才能解 */
  private withheld: Uint8Array = new Uint8Array(0);
  private finalized = false;

  constructor(dek: { keyHex: string; ivHex: string }) {
    this.keyHex = dek.keyHex;
    this.lastCipherBlockHex = dek.ivHex;
  }

  /** 喂入任意大小密文段，返回本次解出的明文；末块恒扣留（不知其后是否还有数据）。 */
  update(chunk: Uint8Array): Uint8Array {
    if (this.finalized) throw new Error('Sm4CbcChunkedDecryptor: final 后实例不可再用');
    const buf = this.withheld.length === 0 ? chunk : concat(this.withheld, chunk);
    // 除最后一个完整块外的对齐部分可安全按无填充解出（PKCS#7 只可能挂在末块）
    const processLen = buf.length >= 2 * BLOCK ? buf.length - BLOCK - (buf.length % BLOCK) : 0;
    if (processLen === 0) {
      this.withheld = buf.slice(); // 拷贝扣留——buf 可能是调用方缓冲的视图
      return new Uint8Array(0);
    }
    const segment = buf.subarray(0, processLen);
    const plain = this.run(segment, 'none');
    this.lastCipherBlockHex = lastBlockHex(segment, segment.length);
    this.withheld = buf.slice(processLen);
    return plain;
  }

  /** 末段：解扣留密文并校验剥除 PKCS#7；非法填充由 sm-crypto 抛 'padding is invalid'。 */
  final(): Uint8Array {
    if (this.finalized) throw new Error('Sm4CbcChunkedDecryptor: final 后实例不可再用');
    this.finalized = true;
    const tail = this.withheld;
    if (tail.length === 0 || tail.length % BLOCK !== 0) {
      throw new Error('Sm4CbcChunkedDecryptor: 密文长度非法（截断或非 16B 对齐）');
    }
    return this.run(tail, 'pkcs#7');
  }

  /** 单次 sm-crypto 调用：密文字节数组直传（禁 hex 往返）。 */
  private run(segment: Uint8Array, padding: Padding): Uint8Array {
    const out: number[] = sm4.decrypt(Array.from(segment), this.keyHex, {
      mode: 'cbc',
      padding,
      iv: this.lastCipherBlockHex,
      output: 'array',
    });
    return new Uint8Array(out);
  }
}
