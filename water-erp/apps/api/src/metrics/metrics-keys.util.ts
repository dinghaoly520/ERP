/** 全量请求指标 Redis 键族（拦截器写侧 / health 读侧共用，键格式单一源） */
const pad = (n: number) => String(n).padStart(2, '0');

/** 本地时间 yyyyMMddHHmm（分钟桶字段名；写读两侧同函数，避免时区错位） */
export function minuteKey(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 本地时间 yyyyMMdd（接口聚合按日滚动 key 用） */
export function dayKey(d: Date = new Date()): string {
  return minuteKey(d).slice(0, 8);
}

export const METRICS_KEYS = {
  minutesHash: 'sys:metrics:24h',                                    // field t:<min>/e:<min> → count
  routesDay: (day: string) => `sys:metrics:routes:${day}`,           // field "METHOD /path" → count
  routesErrDay: (day: string) => `sys:metrics:routes:err:${day}`,
  routesLastDay: (day: string) => `sys:metrics:routes:last:${day}`,  // field route → ISO（最近一次错误）
} as const;
