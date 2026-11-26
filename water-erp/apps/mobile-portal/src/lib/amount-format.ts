/**
 * 金额缩位（2026-11-25 用户裁定「大数 ··· 优化」）：后端万元标签过亿时转「亿」，
 * 与节资趋势图 ≥1亿以亿计同惯例——四列瓷片宽度内放下，不再 truncate 成「···」。
 */

/** 削尾零（仅带小数点时削：「2.00」→「2」、「1.20」→「1.2」；整数原样——「1200」
 *  若无守卫会被削成「12」，2026-11-25 自测抓出） */
function trimTrailingZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 后端万元标签（「12345.6 万」/「12345.6万」）→ 过亿缩位「1.23亿」；万级一律归一位小数
 *  并削尾零（2026-11-25 用户裁定「千万级保留一位小数、与首页一致」——台账标签生产者
 *  procurements.service formatWan 是两位小数「2792.14万」，首页 dashboard.service 是一位
 *  「2792.1万」，两轨在此归一）；非「N 万」形态（如「—」、百分比、元值）原样返回 */
export function compactWanLabel(label: string): string {
  const m = /^\s*([\d,]+(?:\.\d+)?)\s*万\s*$/.exec(label ?? "");
  if (!m) return label;
  const wan = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(wan)) return label;
  if (wan >= 10000) return `${trimTrailingZeros((wan / 10000).toFixed(2))}亿`;
  return `${trimTrailingZeros(wan.toFixed(1))}万`;
}

/** 元数值 → 紧凑可读：≥1亿转亿（两位小数削零）、≥1万转万（一位削零）、其余元 */
export function compactYuan(v: number): string {
  if (v >= 1e8) return `${trimTrailingZeros((v / 1e8).toFixed(2))}亿`;
  if (v >= 1e4) return `${trimTrailingZeros((v / 1e4).toFixed(1))}万`;
  return `${Math.round(v)}元`;
}

/* :3011 金额两轨（2026-11-25 用户裁定）——预算/成交额等主金额=精确原数字
 * （formatYuanExact：千分位+小数位原样+「元」，不四舍五入、不用万/亿）；节资=首页
 * 紧凑口径（compactYuan：万一位小数/亿）。公告顶部金额芯片同精确轨（2026-11-23）。 */

/** 金额（元）精确显示：千分位分组 + 小数位原样 + 「元」。按字符串处理、不经 Number 往返，
 *  任何位数不丢精度；含单位/文字的自由文本（「约120万元」）原样返回；空值返回空串。
 *  与 :3005 lib/format formatYuanExact 同款算法 */
export function formatYuanExact(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return s;
  const sign = m[1] === "-" ? "-" : "";
  // 去无意义前导零——千分位分组按规范整数位算（「007000」→「7,000」而非「00,7000」）
  const intPart = m[2].replace(/^0+(?=\d)/, "");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${m[3] !== undefined ? `.${m[3]}` : ""} 元`;
}
