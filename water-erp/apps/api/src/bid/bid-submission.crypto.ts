import * as crypto from 'crypto';

export { encryptBuffer, decryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';

/** 比对 buffer 内容 SHA-256 与存储值。存储值缺失返回 null（legacy，跳过）。 */
export function verifyIntegrity(buffer: Buffer, storedSha256: string | null | undefined): boolean | null {
  if (!storedSha256) return null;
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  return actual === storedSha256;
}

export type DecryptOutcome = 'SUCCESS' | 'DANGER';

/** 根据 AES 解密结果与完整性校验结果，决定最终 decryptStatus。 */
export function classifyDecryptOutcome(input: {
  hasSealedKey: boolean;
  decryptOk: boolean | null; // null = 无需 AES 解密
  integrityOk: boolean | null; // null = 无 sha 可校验
}): DecryptOutcome {
  // 保密层失败优先判 DANGER
  if (input.hasSealedKey && input.decryptOk === false) return 'DANGER';
  // 完整性校验明确不通过 → DANGER
  if (input.integrityOk === false) return 'DANGER';
  return 'SUCCESS';
}
