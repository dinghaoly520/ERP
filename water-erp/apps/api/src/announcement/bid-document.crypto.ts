import * as crypto from 'crypto';
import { Transform, TransformCallback } from 'stream';

/* =================================================================
   招标文件加密工具 — AES-256-GCM
   每个文档独立密钥；密文存 MinIO，密钥(hex)存 BidDocument.decryptKey。
   格式：key:iv:authTag（均为 hex）
   ================================================================= */

const ALGO = 'aes-256-gcm';

export interface EncryptedPayload {
  ciphertext: Buffer;
  decryptKey: string; // key:iv:authTag
}

/** 加密一个 buffer，返回密文与可持久化的 decryptKey */
export function encryptBuffer(plaintext: Buffer): EncryptedPayload {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted,
    decryptKey: `${key.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}`,
  };
}

/** 用持久化的 decryptKey 解密密文 buffer */
export function decryptBuffer(ciphertext: Buffer, decryptKey: string): Buffer {
  const parts = decryptKey.split(':');
  if (parts.length !== 3) throw new Error('decryptKey 格式错误');
  const [keyHex, ivHex, authTagHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** 把 MinIO 对象读取为完整 buffer（用于解密后再流式输出）。
 * @deprecated 大文件下载应使用 {@link createDecryptStream} 进行流式解密，避免全量读入内存。
 */
export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

/**
 * 创建流式解密 Transform — 将 MinIO 密文 Readable 管道连接到此 Transform，
 * 输出的 plaintext Readable 可直接 pipe 到 HTTP Response，避免全量读入内存。
 *
 * AES-256-GCM 认证标签在 decipher.final() 时验证，任意篡改会在流末尾抛出错误。
 *
 * 用法：
 *   minioClient.getObject(...)
 *     .pipe(createDecryptStream(decryptKey))
 *     .pipe(response);
 */
export function createDecryptStream(decryptKey: string): Transform {
  const parts = decryptKey.split(':');
  if (parts.length !== 3) throw new Error('decryptKey 格式错误');
  const [keyHex, ivHex, authTagHex] = parts;
  const decipher = crypto.createDecipheriv(
    ALGO,
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        const decrypted = decipher.update(chunk);
        if (decrypted.length > 0) this.push(decrypted);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        const final = decipher.final();
        if (final.length > 0) this.push(final);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}
