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

/** 待发定时草稿互斥的失败留痕码（metadata.scheduledPublishError.code）：
 *  scheduler 检出同项目同类型多条待发草稿时写入，前端据此在未到点的草稿上也亮「定时待处理」。 */
export const SCHEDULED_DUPLICATE_PENDING_CODE = 'SCHEDULED_DUPLICATE_PENDING';

/** 变更/补遗按轮次区分互斥：同项目不同轮次的变更、补遗公告合法并存 */
const ROUND_SCOPED_TYPES = new Set(['CHANGE_NOTICE', 'ADDENDUM']);

/** 是否「待发定时草稿」：DRAFT + 可解析的 scheduledPublishDate（到期与否都算——到期但被闸拦下的仍在待发队列） */
export function isPendingScheduledDraft(a: { status?: string | null; metadata?: unknown }): boolean {
  if (a.status !== 'DRAFT') return false;
  return parseScheduledPublishDate((a.metadata as Record<string, unknown> | null | undefined)?.scheduledPublishDate) !== null;
}

/** 待发定时草稿互斥键：项目编号 + 公告类型（变更/补遗再带轮次）。
 *  无项目编号返回 null——手工公告（政策/平台通知等）不参与互斥。
 *  2026-11-24 生产实录：04 向导两次「确认发布」各建一条定时草稿，同键两条到点各发一条、供应商收两遍通知。 */
export function scheduledDuplicateKey(a: { type?: string | null; relatedProjectCode?: string | null; metadata?: unknown }): string | null {
  const code = (a.relatedProjectCode ?? '').trim();
  if (!code || !a.type) return null;
  if (!ROUND_SCOPED_TYPES.has(a.type)) return `${code}|${a.type}`;
  const round = Number((a.metadata as Record<string, unknown> | null | undefined)?.changeRound);
  return `${code}|${a.type}|${Number.isFinite(round) && round > 0 ? `r${round}` : ''}`;
}

/** 定时时刻回显为东八区「月-日 时:分」（拒绝/查重提示用；业务时区恒东八区，不依赖服务器时区）。
 *  缺失/非法返回 null。 */
export function formatScheduledPublishDate(raw: unknown): string | null {
  const d = parseScheduledPublishDate(raw);
  if (!d) return null;
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');
}
