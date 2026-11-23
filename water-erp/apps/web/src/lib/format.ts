/**
 * web 门户统一格式化工具（2026-09-28 审计 R4：此前 206 处 toLocale* 散落 50+ 文件、
 * 金额格式 8 个变体——同一页面同一字段两套小数位、UTC 切片与本地时区混用致日期差一天）。
 * 新代码一律引用本模块；存量按"高可见不一致处"渐进收敛。
 */

/** 金额（元）→ 万元显示：≥1 万显示 `N.NN万`，不足 1 万显示 `N元`（统一两位小数） */
export function formatWan(
  amount: number | string | null | undefined,
  opts?: { digits?: number; empty?: string },
): string {
  const digits = opts?.digits ?? 2;
  const empty = opts?.empty ?? '—';
  if (amount === null || amount === undefined || amount === '') return empty;
  // 字符串先剥千分位逗号再解析（'12,000' 此前静默截断为 12——四审 P2）
  const num = typeof amount === 'string' ? parseFloat(amount.replace(/,/g, '')) : amount;
  if (!Number.isFinite(num)) return empty;
  return num >= 10000 ? `${(num / 10000).toFixed(digits)}万` : `${num.toFixed(0)}元`;
}

/**
 * 金额（元）精确显示（2026-11-23 用户裁定：公告顶部预算金额保持原始数字、不做四舍五入）：
 * 千分位分组 + 小数位原样 + 「元」。按字符串处理、不经 Number 往返，任何位数都不丢精度
 * （原 `/10000).toFixed(0) + 万元` 把 356,789 元显示成「36 万元」）。
 * 仅纯数字串/数值走分组；含单位或文字的自由文本（「约120万元」）原样返回；空值返回空串。
 */
export function formatYuanExact(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return s;
  const sign = m[1] === '-' ? '-' : '';
  // 去无意义前导零——千分位分组按规范整数位算（「007000」→「7,000」而非「00,7000」）
  const intPart = m[2].replace(/^0+(?=\d)/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${m[3] !== undefined ? `.${m[3]}` : ''} 元`;
}
