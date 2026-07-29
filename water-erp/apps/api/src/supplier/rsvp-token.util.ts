/* =====================================================================
   采购邀请回执（RSVP）链接 token —— 无登录、自包含、防篡改
   ---------------------------------------------------------------------
   设计：链接 ?t=<token> 供供应商从短信/邮件/站内信点开，无需登录即可回执。
   token 不泄露任何 id：载荷（sid/pid/iid/供应商名/摘要/过期）用 AES-256-GCM
   加密（机密性），再附 HMAC-SHA256 截断（完整性/认证）。密钥由 JWT_SECRET 经
   SHA-256 派生（enc / mac 两把子密钥），与登录 token 解耦。

   为何加密而非仅签名：URL 会被日志/Referer/转发留存，明文 base64 载荷会泄露
   供应商/项目 id 与名称；加密后 token 为不透明串，展示信息仅在校验后由服务端解密返回。
   ===================================================================== */
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from 'crypto';
import { getJwtSecret } from '../common/jwt-secret.helper';

export interface RsvpPayload {
  sid: string; // supplierId
  pid: string | null; // projectId（无项目时为 null）
  iid: string; // invitationId（批次）
  name: string; // 供应商名称（链接页展示 + 防误点）
  exp: number; // 过期时间 ms
}

export interface RsvpContext extends RsvpPayload {
  rid: string; // InvitationRsvp.id（用于 respond 时定位行）
}

const ALG = 'aes-256-gcm';
const MAC_LEN = 16; // HMAC 截断字节

function deriveKeys(secret: string): { enc: Buffer; mac: Buffer } {
  const enc = createHash('sha256').update(`water-erp-rsvp-enc:${secret}`).digest();
  const mac = createHash('sha256').update(`water-erp-rsvp-mac:${secret}`).digest();
  return { enc, mac };
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** 生成不透明签名 token。载荷加密 + HMAC 完整性。 */
export function signRsvpToken(ctx: RsvpContext): string {
  const { enc, mac } = deriveKeys(getJwtSecret());
  const iv = randomBytes(12);
  const plain = Buffer.from(JSON.stringify(ctx), 'utf8');
  const cipher = createCipheriv(ALG, enc, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes
  const body = Buffer.concat([iv, ct, tag]); // 加密体
  const sig = createHmac('sha256', mac).update(body).digest().subarray(0, MAC_LEN);
  return b64url(Buffer.concat([body, sig]));
}

/** 校验并解密 token。失败（篡改/格式错/过期）抛错。返回解密后的上下文。 */
export function verifyRsvpToken(token: string): RsvpContext {
  const { enc, mac } = deriveKeys(getJwtSecret());
  const all = fromB64url(token);
  if (all.length < 12 + 16 + MAC_LEN + 1) throw new Error('RSVP_TOKEN_INVALID');
  const body = all.subarray(0, all.length - MAC_LEN);
  const sig = all.subarray(all.length - MAC_LEN);
  const expect = createHmac('sha256', mac).update(body).digest().subarray(0, MAC_LEN);
  // 常量时间比较，防时序攻击
  if (!timingSafeEq(sig, expect)) throw new Error('RSVP_TOKEN_INVALID');
  const iv = body.subarray(0, 12);
  const tag = body.subarray(body.length - 16);
  const ct = body.subarray(12, body.length - 16);
  let plain: Buffer;
  try {
    const decipher = createDecipheriv(ALG, enc, iv);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error('RSVP_TOKEN_INVALID');
  }
  const ctx = JSON.parse(plain.toString('utf8')) as RsvpContext;
  if (!ctx || typeof ctx.exp !== 'number' || Date.now() > ctx.exp) throw new Error('RSVP_TOKEN_EXPIRED');
  if (!ctx.sid || !ctx.iid) throw new Error('RSVP_TOKEN_INVALID');
  return ctx;
}

function timingSafeEq(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
