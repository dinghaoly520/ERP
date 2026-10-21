/**
 * 手机号输入清洗：全角归半角 → 剥非数字 → 剥 86 国家码前缀 → 截 11 位。
 *
 * 为什么不能只靠 maxLength：maxLength 按原始字符计数，粘贴「138 1234 5678」
 * 会连分隔符一起被截到 11 字符，之后 onChange 再剥非数字就丢了末尾两位——
 * 用户输入了完整正确号码，状态里却只剩 9 位，校验必然失败（2026-10-19 注册
 * 「请先输入有效的注册手机号」误报根因之一）。配对使用的输入框不设 maxLength，
 * 由本函数统一收口。
 *
 * 全角数字（U+FF10-FF19，中文输入法全角模式）归一为半角而非丢弃：直接剥会
 * 让字段悄悄变空，用户以为已输入、点发码仍报无效（同日第二根因）。
 * 86 前缀仅当「13 位且以 86 开头、余下恰为完整手机号」时剥（通讯录复制常见
 * +86 形态），其余 13 位按位截断不猜。
 */
export function sanitizePhoneInput(raw: string): string {
  const normalized = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let digits = normalized.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('86') && /^1[3-9]\d{9}$/.test(digits.slice(2))) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}
