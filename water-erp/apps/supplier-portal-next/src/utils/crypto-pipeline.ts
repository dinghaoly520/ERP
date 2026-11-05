/* =================================================================
   crypto-pipeline.ts — 双层流式加密 / 单层流式解密管线（纯函数，Node 可测）
   双信封大文件分块加密（spec 2026-11-05 · Task 4）的数据面：
   - 加密一遍流过两层：明文段 → EncryptorS（DEK_S）→ C_inner 段即弃 →
     EncryptorA（DEK_A）→ C_outer 段累计。**C_inner 全程零全量驻留**——
     内存峰值 = 外层密文累积 + O(1) 滚动缓冲，500MB 投标件浏览器侧可达的前提。
   - 解密单层一遍流（一把 DEK）：密文段 → Decryptor → 明文段累计 + 增量哈希。
     产品流里两层在不同机器剥离（服务端 decrypt-outer 剥外层、供应商开标
     解密卡剥内层），故解密按层调用、不做双层合体；双信封往返 = 两跳。
   - 三哈希（plain/inner/outer）与字节计数随流增量计算——信封锚点不整读。
   - 进度节流：约每 SM4_CHUNK_BYTES（2MB）一档 + 收尾必发一档（终值 == 总量），
     读段风暴不逐段回调；Task 5 worker 侧再叠 250ms 时间窗。
   - 与 one-shot（sm4Encrypt×2）逐字节一致——Task 2 一致性闸的直接推论，
     测试以 one-shot 双层手工期望值为等价锚（信封字节级零变化回归闸）。
   ================================================================= */
import {
  SM4_CHUNK_BYTES,
  Sha256Incremental,
  Sm4CbcChunkedDecryptor,
  Sm4CbcChunkedEncryptor,
} from '@water-erp/ukey';

/** 数据加密密钥（hex，16B key + 16B IV）——与信封 kself/kadmin 封装前同形态 */
export type DekHex = { keyHex: string; ivHex: string };

export interface EncryptFileResult {
  /** C_outer 全量（唯一累积的密文）——直接供 uploadOuter 上传 */
  outerBlob: Blob;
  plainSha256: string;
  innerSha256: string;
  outerSha256: string;
  plainBytes: number;
  innerBytes: number;
  outerBytes: number;
}

export interface DecryptStreamResult {
  plainBlob: Blob;
  plainSha256: string;
  plainBytes: number;
}

/** 进度节流闸：距上一档 ≥ step 字节才放行；收尾档由调用方在流结束后强制发 */
class ProgressGate {
  private baseline = 0;
  constructor(private readonly step: number) {}
  hit(doneBytes: number): boolean {
    if (doneBytes - this.baseline >= this.step) {
      this.baseline = doneBytes;
      return true;
    }
    return false;
  }
}

export async function encryptFileStream(
  source: ReadableStream<Uint8Array>,
  totalBytes: number,
  dekS: DekHex,
  dekA: DekHex,
  onProgress?: (doneBytes: number) => void | Promise<void>,
): Promise<EncryptFileResult> {
  const encInner = new Sm4CbcChunkedEncryptor(dekS);
  const encOuter = new Sm4CbcChunkedEncryptor(dekA);
  const plainHash = new Sha256Incremental();
  const innerHash = new Sha256Incremental();
  const outerHash = new Sha256Incremental();
  const outerParts: Uint8Array[] = [];
  let plainBytes = 0;
  let innerBytes = 0;
  let outerBytes = 0;
  const gate = new ProgressGate(SM4_CHUNK_BYTES);

  // C_inner 段即弃：内层密文段过完哈希立刻喂外层，绝不滞留（内存纪律）
  const pumpOuter = (innerChunk: Uint8Array): void => {
    if (innerChunk.length === 0) return;
    innerBytes += innerChunk.length;
    innerHash.update(innerChunk);
    const outerChunk = encOuter.update(innerChunk); // update 返回全新数组，可安全持有
    if (outerChunk.length > 0) {
      outerBytes += outerChunk.length;
      outerHash.update(outerChunk);
      outerParts.push(outerChunk);
    }
  };

  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value ?? new Uint8Array(0);
      plainBytes += chunk.length;
      plainHash.update(chunk);
      pumpOuter(encInner.update(chunk));
      if (onProgress && gate.hit(plainBytes)) await onProgress(plainBytes); // 按明文 doneBytes 计
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined); // 尽力通知上游丢弃（fetch 流断连）
    throw err;
  }
  if (plainBytes !== totalBytes) {
    // totalBytes 是信封声明口径（file.size）——不符 = 流被截断/文件在读取中被改动，
    // 静默放行会把错误计数写进信封，宁可在此炸出
    throw new Error(
      `encryptFileStream: 流实际长度 ${plainBytes} 与声明的 totalBytes ${totalBytes} 不符（文件在读取中被改动或截断）`,
    );
  }
  // EOF 双层依序收口：内层 final（PKCS#7 补块）产物即弃喂外层，再外层 final
  pumpOuter(encInner.final());
  const outerTail = encOuter.final();
  if (outerTail.length > 0) {
    outerBytes += outerTail.length;
    outerHash.update(outerTail);
    outerParts.push(outerTail);
  }
  if (onProgress) await onProgress(plainBytes); // 收尾档：终值 == totalBytes
  return {
    // ukey 分块类返回未参数化 Uint8Array，而 lib.dom 的 BlobPart 已收窄为
    // ArrayBufferView<ArrayBuffer>——运行时即普通 ArrayBuffer 视图，此处仅类型层收窄
    outerBlob: new Blob(outerParts as BlobPart[], { type: 'application/octet-stream' }),
    plainSha256: plainHash.finalHex(),
    innerSha256: innerHash.finalHex(),
    outerSha256: outerHash.finalHex(),
    plainBytes,
    innerBytes,
    outerBytes,
  };
}

export async function decryptStream(
  source: ReadableStream<Uint8Array>,
  dek: DekHex,
  onProgress?: (doneBytes: number) => void | Promise<void>,
): Promise<DecryptStreamResult> {
  const decryptor = new Sm4CbcChunkedDecryptor(dek);
  const plainHash = new Sha256Incremental();
  const plainParts: Uint8Array[] = [];
  let cipherBytes = 0;
  let plainBytes = 0;
  const gate = new ProgressGate(SM4_CHUNK_BYTES);

  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value ?? new Uint8Array(0);
      cipherBytes += chunk.length;
      const plainChunk = decryptor.update(chunk); // 扣留末块；输出全新数组可持有
      if (plainChunk.length > 0) {
        plainBytes += plainChunk.length;
        plainHash.update(plainChunk);
        plainParts.push(plainChunk);
      }
      if (onProgress && gate.hit(cipherBytes)) await onProgress(cipherBytes); // 按密文 doneBytes 计
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
  const plainTail = decryptor.final(); // 解扣留块并校验剥 PKCS#7；非法 → sm-crypto 'padding is invalid'
  if (plainTail.length > 0) {
    plainBytes += plainTail.length;
    plainHash.update(plainTail);
    plainParts.push(plainTail);
  }
  if (onProgress) await onProgress(cipherBytes); // 收尾档：终值 == 密文长
  return {
    plainBlob: new Blob(plainParts as BlobPart[], { type: 'application/octet-stream' }),
    plainSha256: plainHash.finalHex(),
    plainBytes,
  };
}
