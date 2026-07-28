import * as crypto from 'crypto';

/* =================================================================
   Field-level Encryption — KMS_SECRET 派生 KEK 直接加密短字符串字段

   问题：SupplierBidSubmission.bidPrice 等字段以明文入库，DB 泄露或
   未到开标解密时被运维/采购人员读到 = 封存报价泄密。

   方案：
   1. 用 KMS_SECRET（SHA-256 + 静态 salt 派生 KEK）直接 AES-256-GCM 加密
   2. 输出 'v1:' + base64(iv12 + authTag16 + ciphertext)，存储为原字段值
   3. 解密时去前缀拆封；不带前缀视为旧明文原样返回（向后兼容）
   4. KMS_SECRET 仅在本文件中被读取，永不写入 DB

   与 envelope-crypto 的区别：
   - envelope-crypto 包裹的是 DEK（"hexkey:hexiv:hextag"），DEK 再去解密大文件
   - field-crypto 直接加密短业务字段（报价、工期等），无两层结构
   - 两者共用 KMS_SECRET，但 SALT 不同（派生独立 KEK，互不影响）
   ================================================================= */

const ALGO = 'aes-256-gcm';
const SALT = 'water-erp-field-seal-v1';
const PREFIX = 'v1:';

function kek(kms: string): Buffer {
  return crypto.createHash('sha256').update(SALT).update(kms).digest();
}

/**
 * 密封短字符串字段（如 bidPrice）。
 * 返回 'v1:'+base64(iv12+authTag16+ciphertext)。null/空串原样返回。
 * 同一明文每次密封结果不同（随机 IV）。
 */
export function sealField(plain: string | null | undefined, kms: string): string | null {
  if (plain == null || plain === '') return plain ?? null;
  if (!kms) throw new Error('KMS_SECRET is not configured');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, kek(kms), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * 拆封字段。
 * 带 'v1:' 前缀则解密；否则视为旧明文原样返回（向后兼容已存在行）。
 * null/空原样返回。前缀值缺 KMS 抛错；legacy 不需要 KMS。
 */
export function openField(stored: string | null | undefined, kms: string): string | null {
  if (stored == null || stored === '') return stored ?? null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext 兼容
  if (!kms) throw new Error('KMS_SECRET is not configured');
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (buf.length < 28) throw new Error('invalid sealed field blob');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv(ALGO, kek(kms), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/**
 * 判断字段值是否已密封（带 v1: 前缀）。用于迁移检测或调试。
 */
export function isSealedField(value: string | null | undefined): boolean {
  return !!value && value.startsWith(PREFIX);
}
