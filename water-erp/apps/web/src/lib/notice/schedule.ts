/**
 * 定时发布字段的前端解析（2026-10-29 审计 F，与 API 侧 scheduled-publish.util 同口径）：
 * 后端写入口已把无时区 datetime-local 值归一为 "+08:00" 后缀；存量裸值与归一值都按
 * 东八区解释，不依赖浏览器/服务器本地时区。
 */
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** 解析 scheduledPublishDate：缺失/非法返回 null */
export function scheduledPublishDue(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null;
  const normalized = NAIVE_DATETIME.test(raw) ? `${raw}+08:00` : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 草稿的定时时刻已过却仍是 DRAFT → 定时发布未生效（被发布闸拒绝或服务异常滞留）。
 *  90 秒宽限：scheduler 每分钟 :00 扫一次，定时刚到的最长 60 秒空窗内草稿仍合法待发，
 *  不宽限会闪报假「定时未生效」（2026-10-29 复验补）。 */
export const SCHEDULED_PUBLISH_GRACE_MS = 90_000;

export function isOverdueScheduledDraft(ann: { status: string; metadata?: Record<string, any> | null }): boolean {
  if (ann.status !== 'DRAFT') return false;
  const due = scheduledPublishDue(ann.metadata?.scheduledPublishDate);
  return !!due && due.getTime() < Date.now() - SCHEDULED_PUBLISH_GRACE_MS;
}

/** 定时发布失败留痕（2026-11-23）：scheduler 被发布闸拒绝时写入 metadata.scheduledPublishError
 *  （{ message, code, at }，同错误只写一次；自愈成功清除）。存量滞留件无此标记，返回 null。 */
export function scheduledPublishErrorOf(ann: { metadata?: Record<string, any> | null }): { message: string; code: string | null; at: string } | null {
  const e = ann.metadata?.scheduledPublishError;
  return e && typeof e.message === 'string' && e.message
    ? { message: e.message, code: typeof e.code === 'string' ? e.code : null, at: typeof e.at === 'string' ? e.at : '' }
    : null;
}

/** 待发定时草稿冲突标记（2026-11-24 用户裁定）：定时任务检出同项目同类型多条待发草稿时，
 *  一条都不发，并给每条写 metadata.scheduledPublishError（code=SCHEDULED_DUPLICATE_PENDING）、
 *  通知经办人保留一条、隐藏其余。未到点的草稿也会被提前标记——列表/详情据此亮「定时待处理」，
 *  不必等定时时刻过了才亮红。只认冲突码：其他失败原因不属于冲突。 */
export function scheduledDuplicatePendingErrorOf(ann: { metadata?: Record<string, unknown> | null }): { message: string; code: string | null; at: string } | null {
  const err = scheduledPublishErrorOf(ann);
  return err?.code === 'SCHEDULED_DUPLICATE_PENDING' ? err : null;
}

/** 待发定时草稿（查重弹窗 pending 行；与 API 的 AnnouncementPendingScheduledMatch 同构） */
export interface PendingScheduledDuplicateLine {
  id: string;
  title: string;
  scheduledPublishDate?: string | null;
  type?: string;
  status?: string;
  relatedProjectCode?: string | null;
}

/** 待发草稿查重弹窗的逐条排版——与已发布查重弹窗同构：标题一行、属性一行括注；
 *  定时时刻按东八区回显（不依赖浏览器时区）。 */
export function pendingScheduledDuplicateLines(pending: PendingScheduledDuplicateLine[]): string[] {
  return pending.map((p) => {
    const due = scheduledPublishDue(p.scheduledPublishDate);
    const attrs = [due ? `定时 ${new Date(due.getTime() + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')} 发布` : '', '待发']
      .filter(Boolean)
      .join(' ～ ');
    return `· ${p.title}\n（${attrs}）`;
  });
}
