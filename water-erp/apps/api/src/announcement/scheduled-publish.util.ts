/**
 * 定时发布时间的存储与解析约定（2026-10-29 审计 C 时区归一）：
 * - 前端 datetime-local 产出的是**无时区**字符串（"2026-10-29T09:45"）——裸 `new Date()`
 *   按服务器本地时区解释：宿主为东八区时侥幸正确，生产容器若跑 UTC 则全部定时晚 8 小时。
 * - 业务时区恒为东八区（集团平台）：写入口（create/update）把无时区值归一为带 "+08:00"
 *   后缀的 ISO；读端（scheduler / 前端回显）同口径解析。带偏移/Z 的既有值原样放行。
 * - 归一还顺带修好编辑页回显：datetime-local 控件吃 "2026-10-29T09:45+08:00".slice(0,16)
 *   得到的就是北京时间，不再依赖存储格式碰巧无秒无 Z。
 */
const CN_TZ_SUFFIX = '+08:00';
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** 无时区的 datetime-local 值补 +08:00；其余（带偏移/Z/非字符串/非法形状）原样返回 */
export function normalizeScheduledPublishDate(raw: unknown): unknown {
  if (typeof raw !== 'string' || !NAIVE_DATETIME.test(raw)) return raw;
  return raw + CN_TZ_SUFFIX;
}

/** 解析为 Date：非法/缺失返回 null（调用方按「无定时」处理，而非 NaN 比较） */
export function parseScheduledPublishDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(normalizeScheduledPublishDate(raw) as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** metadata 整体过闸：含 scheduledPublishDate 时返回归一副本，否则原对象（写入口用） */
export function normalizeScheduledPublishMetadata<T>(meta: T): T {
  if (meta && typeof meta === 'object' && (meta as Record<string, unknown>).scheduledPublishDate !== undefined) {
    return { ...(meta as object), scheduledPublishDate: normalizeScheduledPublishDate((meta as Record<string, unknown>).scheduledPublishDate) } as T;
  }
  return meta;
}
