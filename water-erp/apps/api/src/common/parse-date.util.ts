/**
 * 灵活的日期时间解析：兼容 ISO（含/不含时区）、中文数字（"2026年3月23日 09:00"）、
 * "2026-03-23 09:00"、"2026/3/23 10:00"、"2026-03-26T15:00" 等。
 *
 * 背景：公告 metadata 里的 openTime 常以中文格式录入（"2026年03月23日09:00"），
 * 直接 `new Date()` 会得到 Invalid Date，导致开标时间写不回关联项目。
 * 中文/纯数字格式按本地时区解析；ISO 字符串保留其原始时区语义。
 *
 * 解析失败返回 null（调用方自行决定兜底）。
 */
export function parseFlexibleDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  // 中文 / 分隔符混合：2026年03月23日09:00 → 2026, 03, 23, 09, 00
  const m = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):?(\d{2}))?/);
  if (!m) return null;
  const dt = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
  );
  return Number.isNaN(dt.getTime()) ? null : dt;
}
