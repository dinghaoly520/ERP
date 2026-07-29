import * as crypto from 'crypto';

/* =================================================================
   Envelope Encryption — KMS 主密钥包裹 DEK

   问题：AES-256-GCM DEK 以 hex 明文存储于 DB。DB 泄露 = 所有加密文件可解密。

   方案：
   1. 用 KMS_SECRET（SHA-256 派生为 KEK）包裹 DEK，存储 base64 blob
   2. 解密时先解包 DEK，再用 DEK 解密文件
   3. KMS_SECRET 仅在本文件中被读取，永不写入 DB

   格式：wrapKey 输出 base64 编码的 wrapped blob
         unwrapKey 输入 base64 blob，输出 "hexkey:hexiv:hextag"
   ================================================================= */

const KEK_ALGO = 'aes-256-gcm';
const KEK_SALT = 'water-erp-envelope-salt-v1';

function deriveKEK(kmsSecret: string): Buffer {
  return crypto.createHash('sha256')
    .update(KEK_SALT)
    .update(kmsSecret)
    .digest();
}

/**
 * 用 KMS_SECRET 派生的 KEK 包裹 DEK。
 * @param dek "hexkey:hexiv:hextag" 格式的原始 DEK
 * @param kmsSecret 主密钥（来自环境变量 KMS_SECRET）
 * @returns base64 编码的 wrapped blob
 */
export function wrapKey(dek: string, kmsSecret: string): string {
  if (!kmsSecret) throw new Error('KMS_SECRET is not configured');
  const kek = deriveKEK(kmsSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(KEK_ALGO, kek, iv);
  const plaintext = Buffer.from(dek, 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 格式: iv(12 bytes) + authTag(16 bytes) + ciphertext
  const wrapped = Buffer.concat([iv, authTag, encrypted]);
  return wrapped.toString('base64');
}

/**
 * 解包 base64 编码的 wrapped blob，恢复原始 DEK。
 * @param wrappedBlob wrapKey 的输出（base64 字符串）
 * @param kmsSecret 主密钥（来自环境变量 KMS_SECRET）
 * @returns "hexkey:hexiv:hextag" 格式的原始 DEK
 */
export function unwrapKey(wrappedBlob: string, kmsSecret: string): string {
  if (!kmsSecret) throw new Error('KMS_SECRET is not configured');
  if (!wrappedBlob) throw new Error('wrappedBlob is empty');

  const kek = deriveKEK(kmsSecret);
  const wrapped = Buffer.from(wrappedBlob, 'base64');

  if (wrapped.length < 28) {
    throw new Error('Invalid wrapped blob: too short (min 28 bytes: 12 iv + 16 authTag)');
  }

  const iv = wrapped.subarray(0, 12);
  const authTag = wrapped.subarray(12, 28);
  const ciphertext = wrapped.subarray(28);

  const decipher = crypto.createDecipheriv(KEK_ALGO, kek, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf-8');
  } catch (e) {
    throw new Error(`Failed to unwrap key: ${(e as Error).message}`);
  }
}

/**
 * 检测 blob 是否为已包裹的格式（非原始 hex 格式）。
 * 用于区分迁移前后数据，避免重复包裹。
 */
export function isWrappedKey(value: string | null | undefined): boolean {
  if (!value) return false;
  // 原始 DEK 格式: hex:hex:hex（仅含 0-9a-f 和冒号）
  // 包裹后格式: base64（含 A-Za-z0-9+/=）
  return /^[A-Za-z0-9+/=]+$/.test(value) && !/^[0-9a-f:]+$/.test(value);
}

/**
 * KMS 密钥健康检查：wrap→unwrap 往返验证。
 * 用于启动检测和 /health 端点——若返回 false，说明 KMS_SECRET 已变更或损坏，
 * 所有已包裹的密封密钥将无法解开。
 */
export function verifyKmsHealth(kmsSecret: string): { ok: boolean; error?: string } {
  if (!kmsSecret) return { ok: false, error: 'KMS_SECRET is not configured' };
  try {
    const testDek = `a`.repeat(32) + `:` + `b`.repeat(32) + `:` + `c`.repeat(32);
    const wrapped = wrapKey(testDek, kmsSecret);
    const unwrapped = unwrapKey(wrapped, kmsSecret);
    if (unwrapped !== testDek) return { ok: false, error: 'KMS wrap/unwrap mismatch — key may have been rotated' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `KMS health check failed: ${(e as Error).message}` };
  }
}
