/* =================================================================
   国密封装层 — SM2/SM4 信封操作（双信封 v2，前后端同源）

   统一走 sm-crypto 的「字节数组通道」实现 hex 进 hex 出：
   - sm-crypto 的字符串通道两端各有一次 utf8 编解码，Node/浏览器的 utf8
     解码对无效序列有损（替换为 U+FFFD，如 ff 80 → ef bf bd ef bf bd），
     而 DEK/密文是任意随机字节，必须字节精确透传。
   - SM2 cipherMode=1（C1C3C2，GM/T 0003）；SM4-CBC + PKCS#7；
     签名与既有 SignatureService 同参（{ hash: true }，内部 SM3 杂凑）。

   sm-crypto 0.4 为无类型 CJS 包，且本包 tsconfig 作用域内无 @types/node，
   故对 require 做局部声明；编译产物为普通 CJS require 调用，Node / jest 直接可解析；
   Vite 应用须把本包登记进 optimizeDeps.include 才会经 esbuild 预打包转 ESM
   （否则 dev 模式浏览器侧 require is not defined；见 apps/supplier-portal/vite.config.ts）。
   ================================================================= */

declare const require: (id: string) => { sm2: any; sm4: any };

const sm2 = require('sm-crypto').sm2;
const sm4 = require('sm-crypto').sm4;

export const SM2_CIPHER_MODE = 1; // C1C3C2

const hexToBytes = (h: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
};
const bytesToHex = (bytes: ArrayLike<number>): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf); // Node ≥19 与现代浏览器均有全局 webcrypto
  return bytesToHex(buf);
}

/** SM2 加密：hex 明文 → hex 密文（C1C3C2）。任意字节（含无效 utf8 序列）精确透传。 */
export function sm2EncryptHex(publicKey: string, plaintextHex: string): string {
  return sm2.doEncrypt(hexToBytes(plaintextHex), publicKey, SM2_CIPHER_MODE);
}

/** SM2 解密：hex 密文 → hex 明文。C3 校验失败时 sm-crypto 返回空数组，输出 ''。 */
export function sm2DecryptHex(privateKey: string, cipherHex: string): string {
  return bytesToHex(sm2.doDecrypt(cipherHex, privateKey, SM2_CIPHER_MODE, { output: 'array' }));
}

export function sm4Encrypt(keyHex: string, ivHex: string, dataHex: string): string {
  return sm4.encrypt(hexToBytes(dataHex), keyHex, { iv: ivHex, mode: 'cbc', padding: 'pkcs#7' });
}
export function sm4Decrypt(keyHex: string, ivHex: string, cipherHex: string): string {
  return bytesToHex(
    sm4.decrypt(cipherHex, keyHex, { iv: ivHex, mode: 'cbc', padding: 'pkcs#7', output: 'array' }),
  );
}

/** DEK 序列化信封：{"k":"<keyHex>","iv":"<ivHex>"}（紧凑字段名，随后整体做 SM2 加密） */
export const wrapDekJson = (dek: { keyHex: string; ivHex: string }): string =>
  JSON.stringify({ k: dek.keyHex, iv: dek.ivHex });
export const unwrapDekJson = (json: string): { keyHex: string; ivHex: string } => {
  const parsed = JSON.parse(json) as { k: string; iv: string };
  return { keyHex: parsed.k, ivHex: parsed.iv };
};

/** 与既有 SignatureService（apps/api/src/common/crypto/signature.service.ts）同参：{ hash: true } */
export const signEnvelopeMsg = (msg: string, privateKey: string): string =>
  sm2.doSignature(msg, privateKey, { hash: true });
export const verifyEnvelopeMsg = (msg: string, sig: string, publicKey: string): boolean => {
  try {
    return sm2.doVerifySignature(msg, sig, publicKey, { hash: true });
  } catch {
    return false;
  }
};
