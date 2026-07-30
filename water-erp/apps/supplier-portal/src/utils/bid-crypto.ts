/**
 * 供应商投标客户端加密工具（E2EE）
 *
 * 使用 Web Crypto API (crypto.subtle) 在浏览器端对投标文件进行 AES-256-GCM 加密，
 * 输出格式与后端 `bid-document.crypto.ts` 的 `encryptBuffer` / `decryptBuffer` 完全兼容。
 *
 * 加密流程：
 *   1. generateDEK()         → 生成随机 AES-256 密钥 + 12 字节 IV
 *   2. computePlaintextHash() → 计算原始文件的 SHA-256（作为完整性锚）
 *   3. encryptFile()          → AES-256-GCM 加密，分离 ciphertext 和 authTag
 *   4. formatDEK()            → 拼接 "keyHex:ivHex:authTagHex" 发送给后端
 *
 * 兼容性保证：
 *   - 密文不含 authTag（authTag 通过 DEK 字符串传递），与 decryptBuffer 一致
 *   - DEK 格式 "keyHex:ivHex:authTagHex"（64:24:32 hex chars），与 encryptBuffer 输出一致
 */

const AES_GCM = 'AES-GCM'
const KEY_LENGTH = 256 // bits
const IV_LENGTH = 12 // bytes (96 bits, NIST recommended for GCM)
const AUTH_TAG_LENGTH = 16 // bytes (128 bits)

export interface ClientDek {
  keyHex: string // 32 bytes → 64 hex chars
  ivHex: string // 12 bytes → 24 hex chars
  authTagHex: string // 16 bytes → 32 hex chars
}

export interface EncryptResult {
  encryptedBlob: Blob // 纯 ciphertext（不含 authTag），可直接上传
  dek: ClientDek
}

// ─── helpers ───

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── exports ───

/** 生成随机 AES-256 密钥 + 12 字节 IV。返回 rawKey 仅供本次加密使用，不可提取。 */
export async function generateDEK(): Promise<{
  rawKey: CryptoKey
  keyHex: string
  iv: Uint8Array
  ivHex: string
}> {
  // 32 字节原始密钥材料
  const keyMaterial = crypto.getRandomValues(new Uint8Array(32))
  const keyHex = bufToHex(keyMaterial)

  // 导入为不可提取的 CryptoKey
  const rawKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: AES_GCM, length: KEY_LENGTH },
    false, // extractable=false — 密钥不可从 CryptoKey 导出
    ['encrypt'],
  )

  // 12 字节随机 IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ivHex = bufToHex(iv)

  return { rawKey, keyHex, iv, ivHex }
}

/**
 * 用 AES-256-GCM 加密文件。
 *
 * Web Crypto API 的 encrypt() 返回 `ciphertext || authTag`（authTag 在末尾 16 字节）。
 * 我们将 authTag 分离出来，密文 Blob 中仅含 ciphertext —— 与后端 decryptBuffer 的期望一致。
 */
export async function encryptFile(
  file: File,
  rawKey: CryptoKey,
  iv: Uint8Array,
): Promise<EncryptResult> {
  const plaintext = await file.arrayBuffer()

  const encrypted = await crypto.subtle.encrypt(
    { name: AES_GCM, iv },
    rawKey,
    plaintext,
  )

  // Web Crypto API 返回 ciphertext || authTag
  const encryptedBytes = new Uint8Array(encrypted)
  const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - AUTH_TAG_LENGTH)
  const authTag = encryptedBytes.slice(encryptedBytes.length - AUTH_TAG_LENGTH)

  const authTagHex = bufToHex(authTag)

  return {
    encryptedBlob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    dek: {
      keyHex: '', // 由调用方填入（generateDEK 返回的 keyHex）
      ivHex: bufToHex(iv),
      authTagHex,
    },
  }
}

/** 拼接 DEK 为后端 bid-document.crypto.ts decryptBuffer 可解析的格式。 */
export function formatDEK(keyHex: string, ivHex: string, authTagHex: string): string {
  return `${keyHex}:${ivHex}:${authTagHex}`
}

/** 计算原始文件的 SHA-256 哈希（hex 字符串），作为完整性锚点传给后端。 */
export async function computePlaintextHash(file: File): Promise<string> {
  const plaintext = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', plaintext)
  return bufToHex(hash)
}

/** 将加密后的 Blob 包装为 File 对象，用于 FormData 上传。 */
export function packageEncryptedFile(encryptedBlob: Blob, originalName: string): File {
  return new File([encryptedBlob], originalName + '.enc', {
    type: 'application/octet-stream',
  })
}
