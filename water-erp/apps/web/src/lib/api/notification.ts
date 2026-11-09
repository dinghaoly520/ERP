import { api } from '@/lib/api';

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  readAt?: string | null;
  resolvedAt: string | null;
  link?: string | null;
  createdAt: string;
}

export type NotificationTab = 'all' | 'todo' | 'done' | 'toread' | 'read';
export function listNotifications(tab: NotificationTab = 'all', page = 1, pageSize = 20, types?: string[], countTypes?: string[]) {
  const q = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) });
  if (types?.length) q.set('types', types.join(','));
  if (countTypes?.length) q.set('countTypes', countTypes.join(','));
  return api.get<{
    total: number; page: number; pageSize: number; items: NotificationItem[];
    unreadCount: number; todoCount: number;
    typeCounts: { type: string; count: number }[];
    segmentCounts: { all: number; todo: number; done: number; toread: number; read: number };
  }>(`/notifications?${q.toString()}`);
}
export function getUnreadCount() {
  return api.get<{ count: number }>('/notifications/unread-count');
}
export function markNotificationRead(id: string) {
  return api.post<NotificationItem>(`/notifications/${id}/read`, {});
}
/** 办结自己的待办（resolvedAt 落库）——markAsRead 对 actionable 未办结通知是 no-op，勿混用 */
export function resolveNotification(id: string) {
  return api.post<NotificationItem>(`/notifications/${id}/resolve`, {});
}
export function markAllNotificationsRead() {
  return api.post<{ count: number }>('/notifications/mark-all-read', {});
}

export interface AuditActivity {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  /** 资源可读名（2026-11-04）：后端把 BidProject:<id>/BID-xxx/details.projectId 批量解析成项目名 */
  resourceName?: string | null;
  /** 供应商名（2026-11-04）：details.supplierId 无名字的归属审批族由后端解析补挂 */
  supplierName?: string | null;
  /** 审计留痕元信息（2026-11-06 操作历史明细）：AuditLog 全行透传，前端此前未声明 */
  ipAddress?: string | null;
  userAgent?: string | null;
  /** 操作人（2026-11-06 全中心留痕端点）：仅 all-activities 视图带；my-activities 恒为本人 */
  operator?: { name: string; role?: string | null } | null;
  createdAt: string;
}

/** 操作历史筛选（2026-11-09 用户需求：全部操作历史统一配类型/时间筛选+搜索） */
export interface ActivityFilters {
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

function activityFilterQuery(f?: ActivityFilters): string {
  if (!f) return '';
  const p = new URLSearchParams();
  if (f.action) p.set('action', f.action);
  if (f.dateFrom) p.set('dateFrom', f.dateFrom);
  if (f.dateTo) p.set('dateTo', f.dateTo);
  if (f.search?.trim()) p.set('search', f.search.trim());
  const s = p.toString();
  return s ? `&${s}` : '';
}

/** 当前用户操作历史（AuditLog）——通知中心「操作历史」与已办结果记录数据源；
 *  offset 分页（2026-11-06 不上限裁定：加载更多/导出全量逐页翻） */
export function fetchMyActivities(limit = 50, exclude?: string[], offset = 0, filters?: ActivityFilters) {
  const ex = exclude?.length ? `&exclude=${exclude.join(',')}` : '';
  return api.get<{ items: AuditActivity[]; total: number }>(`/audit-log/my-activities?limit=${limit}&offset=${offset}${ex}${activityFilterQuery(filters)}`);
}

/** 全中心操作留痕（2026-11-06 用户裁定）——leader/admin 专属端点，每条带 operator；
 *  staff 调用会被后端 403，前端按角色分流调用 */
export function fetchAllActivities(limit = 100, exclude?: string[], offset = 0, filters?: ActivityFilters) {
  const ex = exclude?.length ? `&exclude=${exclude.join(',')}` : '';
  return api.get<{ items: AuditActivity[]; total: number }>(`/audit-log/all-activities?limit=${limit}&offset=${offset}${ex}${activityFilterQuery(filters)}`);
}
