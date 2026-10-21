/**
 * 剔除 U+FFFD（�）替换符：UTF-8 多字节字符在传输/OCR 环节损坏后以替换符落进
 * 文本，出现在公告/草稿/提取字段里即乱码（2026-10-15 公告资格条款
 * 「重大税���违法失信主体」实录）。仅清字符不动其余内容。
 */
export function stripMojibake(text: string): string {
  if (!text || !text.includes('�')) return text;
  return text.replace(/�+/g, '');
}

/** 递归剔除对象/数组内全部字符串值的替换符（LLM JSON 输出清洗用） */
export function stripMojibakeDeep<T>(value: T): T {
  if (typeof value === 'string') return stripMojibake(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripMojibakeDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripMojibakeDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
