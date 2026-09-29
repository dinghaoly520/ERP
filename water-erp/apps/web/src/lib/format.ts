/**
 * web 门户统一格式化工具（2026-09-28 审计 R4：此前 206 处 toLocale* 散落 50+ 文件、
 * 金额格式 8 个变体——同一页面同一字段两套小数位、UTC 切片与本地时区混用致日期差一天）。
 * 新代码一律引用本模块；存量按"高可见不一致处"渐进收敛。
 */

/** 日期 → `YYYY-MM-DD`（zh-CN 口径；无效值回退 `—`） */
export function formatDateCN(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 日期时间 → `YYYY-MM-DD HH:mm`（zh-CN 口径） */
export function formatDateTimeCN(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${formatDateCN(d)} ${hm}`;
}

/** 金额（元）→ 万元显示：≥1 万显示 `N.NN万`，不足 1 万显示 `N元`（统一两位小数） */
export function formatWan(
  amount: number | string | null | undefined,
  opts?: { digits?: number; empty?: string },
): string {
  const digits = opts?.digits ?? 2;
  const empty = opts?.empty ?? '—';
  if (amount === null || amount === undefined || amount === '') return empty;
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return empty;
  return num >= 10000 ? `${(num / 10000).toFixed(digits)}万` : `${num.toFixed(0)}元`;
}
