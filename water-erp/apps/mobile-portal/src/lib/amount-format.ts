/**
 * 金额缩位（2026-11-25 用户裁定「大数 ··· 优化」）：后端万元标签过亿时转「亿」，
 * 与节资趋势图 ≥1亿以亿计同惯例——四列瓷片宽度内放下，不再 truncate 成「···」。
 */

/** 削尾零（仅带小数点时削：「2.00」→「2」、「1.20」→「1.2」；整数原样——「1200」
 *  若无守卫会被削成「12」，2026-11-25 自测抓出） */
function trimTrailingZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 后端万元标签（「12345.6 万」/「12345.6万」）→ 过亿缩位「1.23亿」；万级去空格并削尾零
 *  （「250.0 万」→「250万」）；非「N 万」形态（如「—」、百分比、元值）原样返回 */
export function compactWanLabel(label: string): string {
  const m = /^\s*([\d,]+(?:\.\d+)?)\s*万\s*$/.exec(label ?? "");
  if (!m) return label;
  const wan = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(wan)) return label;
  if (wan >= 10000) return `${trimTrailingZeros((wan / 10000).toFixed(2))}亿`;
  return `${trimTrailingZeros(m[1])}万`;
}

/** 元数值 → 紧凑可读：≥1亿转亿（两位小数削零）、≥1万转万（一位削零）、其余元 */
export function compactYuan(v: number): string {
  if (v >= 1e8) return `${trimTrailingZeros((v / 1e8).toFixed(2))}亿`;
  if (v >= 1e4) return `${trimTrailingZeros((v / 1e4).toFixed(1))}万`;
  return `${Math.round(v)}元`;
}
