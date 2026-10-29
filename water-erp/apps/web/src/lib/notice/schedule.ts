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

/** 草稿的定时时刻已过却仍是 DRAFT → 定时发布未生效（被发布闸拒绝或服务异常滞留） */
export function isOverdueScheduledDraft(ann: { status: string; metadata?: Record<string, any> | null }): boolean {
  if (ann.status !== 'DRAFT') return false;
  const due = scheduledPublishDue(ann.metadata?.scheduledPublishDate);
  return !!due && due.getTime() < Date.now();
}
