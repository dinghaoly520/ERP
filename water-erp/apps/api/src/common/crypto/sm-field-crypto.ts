import * as crypto from 'crypto';

/* =================================================================
   国密字段级加密 — SM4-CBC + HMAC-SM3（等保三级 + 密评整改）

   用途：评标专家身份证号/手机号/执业证号、供应商法人身份证号/
   联系人身份证号/手机/邮箱、银行账号、User.email/phone 等敏感
   个人信息与重要业务数据的落库加密（替代 AES 版 field-crypto，
   供密评 GM/T 0054 国密口径）。

   方案（GB/T 36624 可鉴别加密机制，Encrypt-then-MAC）：
   1. 加密：SM4-CBC（随机 16B IV，PKCS7）
   2. 完整性：HMAC-SM3(macKey, iv‖ciphertext)（32B tag）
   3. 密文格式：'sm1:' + keyId(8hex) + ':' + base64(iv16‖ct‖mac32)
      —— keyId 是主密钥的短指纹，内嵌于密文，轮转期凭它选钥
   4. 密钥派生：KDF = HMAC-SM3(master, label)，三把用途独立钥：
      enc（SM4 128bit）/ mac / index（盲索引）
   5. 盲索引：HMAC-SM3(indexKey, plain) hex——确定性、不可逆，
      供等值唯一性校验（User.phone / 法人/联系人身份证号）

   密钥管理：FIELD_ENC_SECRET（主密钥）+ FIELD_ENC_SECRET_OLD
   （轮转期旧钥，仅读）。与 KMS_SECRET（投标信封）、
   PASSWORD_VIEW_SECRET（密码保险柜）分类分离。
   开发环境未配置时回退固定 dev 钥；生产由
   assertFieldSecretForProduction()（main.ts 调用）拒绝启动。
   ================================================================= */

const ALGO = 'sm4-cbc';
const IV_LEN = 16;
const MAC_LEN = 32; // HMAC-SM3 输出
const SM4_KEY_LEN = 16;
const PREFIX_RE = /^sm1:([0-9a-f]{8}):(.+)$/;

export const FIELD_ENC_MIN_LEN = 32;
const DEV_FALLBACK_SECRET = 'dev-only-field-enc-secret-do-not-use-in-production';

const LABEL_KEYID = 'sm-field/keyid/v1';
const LABEL_ENC = 'sm-field/enc/v1';
const LABEL_MAC = 'sm-field/mac/v1';
const LABEL_INDEX = 'sm-field/index/v1';

function hmacSm3(key: string | Buffer, data: Buffer): Buffer {
  return crypto.createHmac('sm3', key).update(data).digest();
}

function derive(master: string, label: string, bytes: number): Buffer {
  return hmacSm3(master, Buffer.from(label, 'utf8')).subarray(0, bytes);
}

/** 主密钥的稳定短指纹（8 hex）——密文自描述用哪个钥密封 */
export function fieldKeyId(secret: string): string {
  return hmacSm3(secret, Buffer.from(LABEL_KEYID, 'utf8')).toString('hex').slice(0, 8);
}

/**
 * 密封短字符串字段（SM4-CBC + HMAC-SM3）。
 * 返回 'sm1:<keyId>:<base64(iv‖ct‖mac)>'。null→null、空串→空串。
 * 同一明文每次密封结果不同（随机 IV）。
 */
export function sealFieldSm(plain: string | null | undefined, secret: string): string | null {
  if (plain == null || plain === '') return plain ?? null;
  const iv = crypto.randomBytes(IV_LEN);
  const encKey = derive(secret, LABEL_ENC, SM4_KEY_LEN);
  const c = crypto.createCipheriv(ALGO, encKey, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const mac = hmacSm3(derive(secret, LABEL_MAC, MAC_LEN), Buffer.concat([iv, ct]));
  return `sm1:${fieldKeyId(secret)}:${Buffer.concat([iv, ct, mac]).toString('base64')}`;
}

/**
 * 拆封字段。secrets 支持单钥或钥数组（轮转期 [active, old]）。
 * 按密文内嵌 keyId 匹配钥；未知 keyId / MAC 校验失败 / 解密失败均抛错。
 * null/空原样返回。
 */
export function openFieldSm(
  stored: string | null | undefined,
  secrets: string | string[],
): string | null {
  if (stored == null || stored === '') return stored ?? null;
  const m = stored.match(PREFIX_RE);
  if (!m) throw new Error('未识别的字段密文格式（缺少 sm1:keyId: 前缀）');
  const [, keyId, b64] = m;
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  const secret = candidates.find((s) => fieldKeyId(s) === keyId);
  if (!secret) {
    throw new Error(
      `字段密文 keyId ${keyId} 无对应密钥（检查 FIELD_ENC_SECRET / FIELD_ENC_SECRET_OLD 配置）`,
    );
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < IV_LEN + SM4_KEY_LEN + MAC_LEN) {
    throw new Error('invalid sealed field blob');
  }
  const iv = buf.subarray(0, IV_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - MAC_LEN);
  const mac = buf.subarray(buf.length - MAC_LEN);
  const expect = hmacSm3(derive(secret, LABEL_MAC, MAC_LEN), Buffer.concat([iv, ct]));
  if (!crypto.timingSafeEqual(mac, expect)) {
    throw new Error('字段密文完整性校验失败（HMAC-SM3）');
  }
  const d = crypto.createDecipheriv(ALGO, derive(secret, LABEL_ENC, SM4_KEY_LEN), iv);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/**
 * 盲索引：HMAC-SM3(indexKey, plain) 的 64 位 hex。
 * 确定性（同钥同文同指纹）、不可逆，供等值唯一性校验列使用。
 * null→null、空串→空串。
 */
export function blindIndex(plain: string | null | undefined, secret: string): string | null {
  if (plain == null || plain === '') return plain ?? null;
  return hmacSm3(derive(secret, LABEL_INDEX, MAC_LEN), Buffer.from(plain, 'utf8')).toString('hex');
}

/** 是否为 sm1: 密文（用于迁移检测或调试） */
export function isSealedFieldSm(value: string | null | undefined): boolean {
  return typeof value === 'string' && PREFIX_RE.test(value);
}

/* ── env 便捷层：服务层调用入口，密钥来自环境变量 ── */

function activeSecret(): string {
  return process.env.FIELD_ENC_SECRET || DEV_FALLBACK_SECRET;
}

/** 密封（用 FIELD_ENC_SECRET；未配置回退 dev 钥） */
export function sealPii(plain: string | null | undefined): string | null {
  return sealFieldSm(plain, activeSecret());
}

/**
 * 展示掩码专用宽容拆封：密封则拆封、无前缀明文则原样直通（不抛错）。
 * 仅供「出口掩码」链路使用——单行坏数据不应 500 整个列表；
 * 功能性解密（揭示/审计/通知取号）必须用 openPii 严格拆封。
 */
export function openPiiForMask(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return stored ?? null;
  return isSealedFieldSm(stored) ? openPii(stored) : stored;
}

/** 拆封（FIELD_ENC_SECRET + 可选 FIELD_ENC_SECRET_OLD 轮转旧钥） */
export function openPii(stored: string | null | undefined): string | null {
  const secrets = [activeSecret()];
  if (process.env.FIELD_ENC_SECRET_OLD) secrets.push(process.env.FIELD_ENC_SECRET_OLD);
  return openFieldSm(stored, secrets);
}

/** 盲索引（与 sealPii 同一把 active 钥派生的 index 钥） */
export function blindIndexPii(plain: string | null | undefined): string | null {
  return blindIndex(plain, activeSecret());
}

/** 生产启动守卫：FIELD_ENC_SECRET 缺失或 <32 字符拒绝启动 */
export function assertFieldSecretForProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const s = process.env.FIELD_ENC_SECRET;
  if (!s || s.length < FIELD_ENC_MIN_LEN) {
    throw new Error(
      `FIELD_ENC_SECRET 未配置或长度 <${FIELD_ENC_MIN_LEN}，生产环境拒绝启动（敏感字段国密加密）`,
    );
  }
}
