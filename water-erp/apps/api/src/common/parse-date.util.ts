/**
 * 灵活的日期时间解析：兼容 ISO（含/不含时区）、中文数字（"2026年3月23日 09:00"）、
 * "2026-03-23 09:00"、"2026/3/23 10:00"、"2026-03-26T15:00" 等。
 *
 * 背景：公告 metadata 里的 openTime 常以中文格式录入（"2026年03月23日09:00"），
 * 直接 `new Date()` 会得到 Invalid Date，导致开标时间写不回关联项目。
 *
 * 时区口径（2026-11-09 定案，生产 +8h 实录）：**无显式时区的墙上时间语义恒为北京时间**，
 * 与宿主时区解耦——组件构造 new Date(y,m,d,h,min) 和裸 new Date("2026-11-20 10:30")
 * 都按服务器本地时区解释（开发机 +08 恰好正确、生产 UTC 容器上 10:30 变 10:30Z，
 * 时间轴/专家抽取/开标倒计时全端 +8h）。现统一 Date.UTC 组件构造后减 8h 得北京时间
 * instant，与 timeline.service parseDateRange 同口径。带显式时区（Z / ±HH:MM）的
 * ISO 串保留其原始绝对语义。解析失败返回 null（调用方自行决定兜底）。
 */
export function parseFlexibleDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();

  // ① 带显式时区后缀（Z / ±HH:MM / ±HHMM）：绝对语义，new Date 直解析
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const direct = new Date(s);
    if (!Number.isNaN(direct.getTime())) return direct;
  }

  // ② 无时区墙上时间（中文 / 分隔符混合）：2026年03月23日09:00、2026-11-20 10:30 →
  //    逐组件提取后按北京时间构造（Date.UTC 减 8h）。时分分隔符：半角冒号或「时…分」
  //    （公告模板长格式"14时00分00秒"——此前解析不了，时间被丢成零点：
  //    BidProject.openTime 曾因此落 10-20 00:00 而非 14:00）。区间文本取首段。
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})[:时](\d{2})分?)?/);
  if (!m) return null;
  const dt = new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
    ) - 8 * 3_600_000,
  );
  return Number.isNaN(dt.getTime()) ? null : dt;
}
