import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 2026-09-14 admin 密码查看：供应商账号的可恢复密码副本（User.passwordVault）。
 * AES-256-GCM（key = sha256(PASSWORD_VIEW_SECRET)）；密钥未配置时不写入也不可读（退化为纯 bcrypt，功能静默降级）。
 * 注意：这是用户拍板的产品决策（admin 可查看供应商最新密码），非默认安全形态——工作人员密码仍仅存哈希。
 */
export function encryptPasswordVault(plain: string): string | undefined {
  const secret = process.env.PASSWORD_VIEW_SECRET;
  if (!secret || !plain) return undefined;
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptPasswordVault(vault: string | null | undefined): string | null {
  if (!vault) return null;
  const secret = process.env.PASSWORD_VIEW_SECRET;
  if (!secret) return null;
  const [ivB64, tagB64, dataB64] = vault.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const key = createHash('sha256').update(secret).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // 密钥轮换/数据损坏 → 视为不可读，不抛错
  }
}
