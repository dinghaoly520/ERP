/** 凭证类字段 —— 值整体替换为 ***（绝不入库明文） */
const CREDENTIAL_KEYS = [
  'password', 'pwd', 'token', 'secret', 'apikey', 'api_key', 'authorization',
  'kmssecret', 'kms', 'privatekey', 'captcha', 'verificationcode', 'smscode',
];

/** 个人信息类字段 —— 部分掩码（保留可识别性） */
const PHONE_KEYS = ['phone', 'mobile', 'telephone'];
const IDCARD_KEYS = ['idcard', 'idnumber'];
const BANK_KEYS = ['bankcard', 'cardno', 'bankaccount'];

const includesAny = (key: string, words: string[]): boolean => {
  const k = key.toLowerCase();
  return words.some((w) => k.includes(w));
};

function maskPhone(value: unknown): string {
  const d = String(value).replace(/\D/g, '');
  if (d.length < 7) return '***';
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
}

function maskIdCard(value: unknown): string {
  const s = String(value);
  if (s.length < 10) return '***';
  return `${s.slice(0, 6)}${'*'.repeat(Math.max(s.length - 10, 4))}${s.slice(-4)}`;
}

function maskBank(value: unknown): string {
  const d = String(value).replace(/\D/g, '');
  if (d.length < 8) return '***';
  return `${d.slice(0, 4)}****${d.slice(-4)}`;
}

/** 按字段名对单个值脱敏（不递归；嵌套由 sanitizeObject 处理） */
export function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (includesAny(key, CREDENTIAL_KEYS)) return '***';
  if (includesAny(key, PHONE_KEYS)) return maskPhone(value);
  if (includesAny(key, IDCARD_KEYS)) return maskIdCard(value);
  if (includesAny(key, BANK_KEYS)) return maskBank(value);
  if (typeof value === 'object') return sanitizeObject(value);
  return value;
}

/** 递归脱敏对象/数组 */
export function sanitizeObject(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => (typeof v === 'object' && v !== null ? sanitizeObject(v) : v));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = sanitizeValue(k, v);
    return out;
  }
  return input;
}

export function truncateString(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[截断]` : s;
}

/** Decode a query key/value, tolerating malformed %-encoding */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Mask credential-keyed query params before logging: `?token=xyz` → `?token=***`.
 * Only PARAM KEYS matching CREDENTIAL_KEYS are masked (by key, consistent with body
 * sanitization). Non-credential params (keyword, page, filters...) are preserved for
 * audit value. Then truncate to maxLen.
 */
export function sanitizeQueryString(query: string, maxLen = 2048): string {
  const masked = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      const val = pair.slice(eq + 1);
      const decodedKey = safeDecode(key).toLowerCase();
      return CREDENTIAL_KEYS.some((w) => decodedKey.includes(w)) ? `${key}=***` : `${key}=${val}`;
    })
    .join('&');
  return truncateString(masked, maxLen);
}

/**
 * 脱敏请求体并截断：先递归脱敏 → JSON.stringify → 超 maxBytes 则存 { _truncated, preview }。
 * 不可序列化（循环引用等）返回 null。
 */
export function sanitizeBody(body: unknown, maxBytes = 4096): unknown {
  if (body === null || body === undefined) return null;
  let sanitized: unknown;
  let serialized: string;
  try {
    sanitized = sanitizeObject(body);
    serialized = JSON.stringify(sanitized);
  } catch {
    return null;
  }
  if (serialized.length <= maxBytes) return sanitized;
  return { _truncated: true, preview: serialized.slice(0, maxBytes) };
}
