/* =================================================================
   PII 出口脱敏规则（等保三级 + 密评整改）

   管理端列表/详情/导出一律返回掩码；明文仅两条路：
   - 本人自视（专家/供应商门户自己的资料）
   - admin 揭示端点（写 SensitiveAccessLog 审计）
   掩码保长度，避免前端布局抖动，也不泄露实际位数。
   ================================================================= */

/** 头尾保留、中段打星；长度不足 head+tail 时全星 */
function keepEnds(value: string, head: number, tail: number): string {
  if (value.length <= head + tail) return '*'.repeat(value.length);
  return value.slice(0, head) + '*'.repeat(value.length - head - tail) + value.slice(-tail);
}

function normalize(value: string | null | undefined): string | null | undefined {
  return value === undefined ? null : value;
}

/** 身份证号：前4后4（5110**********123X） */
export function maskIdNumber(value: string | null | undefined): string | null {
  const v = normalize(value);
  if (v == null) return null;
  return keepEnds(v, 4, 4);
}

/** 手机号：前3后4（138****5678） */
export function maskPhone(value: string | null | undefined): string | null {
  const v = normalize(value);
  if (v == null) return null;
  return keepEnds(v, 3, 4);
}

/** 邮箱：本地部分首字符 + *** + @域名保留 */
export function maskEmail(value: string | null | undefined): string | null {
  const v = normalize(value);
  if (v == null) return null;
  const at = v.lastIndexOf('@');
  if (at > 0) return `${v.slice(0, 1)}***${v.slice(at)}`;
  return keepEnds(v, 1, 1);
}

/** 银行账号：前4后4 */
export function maskBankAccount(value: string | null | undefined): string | null {
  const v = normalize(value);
  if (v == null) return null;
  return keepEnds(v, 4, 4);
}

/** 执业资格证号：前4后4，≤8 位全星 */
export function maskLicenseNo(value: string | null | undefined): string | null {
  const v = normalize(value);
  if (v == null) return null;
  return keepEnds(v, 4, 4);
}

type MaskableField =
  | 'idNumber'
  | 'idCard'
  | 'legalPersonIdCard'
  | 'phone'
  | 'legalPersonPhone'
  | 'accountNo'
  | 'licenseNo'
  | 'email';

const MASKERS: Record<MaskableField, (v: string | null) => string | null> = {
  idNumber: maskIdNumber,
  idCard: maskIdNumber,
  legalPersonIdCard: maskIdNumber,
  phone: maskPhone,
  legalPersonPhone: maskPhone,
  accountNo: maskBankAccount,
  licenseNo: maskLicenseNo,
  email: maskEmail,
};

/**
 * 按字段名路由的统一脱敏入口。
 * 未知字段名原样返回（不误伤非敏感字段）。
 */
export function maskContact(field: string, value: string | null | undefined): string | null {
  const masker = MASKERS[field as MaskableField];
  if (!masker) return normalize(value) ?? null;
  return masker(normalize(value) ?? null);
}
