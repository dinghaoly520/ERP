/* 通知/文案用本地时区日期格式化（2026-10-29 文案治理）：
 * 禁 toISOString() 直出用户可见文案——UTC 串带字母 T 且与北京时间差 8 小时
 * （:3005 web 侧同裁定，见 web/src/lib/local-date）。API 侧多处以闭包 pad()
 * 重复实现，新代码一律用本工具，勿再散落。 */
export function formatLocalDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatLocalDate(d: Date): string {
  return formatLocalDateTime(d).slice(0, 10);
}
