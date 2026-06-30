import { parseJsonResponse } from './auth';

const API_BASE = '/api';

export type AuditLogItem = {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type AuditLogListResponse = {
  items: AuditLogItem[];
  total: number;
};

export async function fetchMyActivities(
  options?: {
    limit?: number;
    offset?: number;
  },
): Promise<AuditLogListResponse> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  if (options?.offset) {
    params.set('offset', String(options.offset));
  }

  const query = params.toString();
  const url = `${API_BASE}/audit-log/my-activities${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<AuditLogListResponse>(response);
}

// Action labels for display
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: '登录',
  LOGOUT: '登出',
  PASSWORD_CHANGE_REQUEST: '提交修改密码申请',
  PASSWORD_CHANGE_APPROVED: '修改密码已批准',
  PASSWORD_CHANGE_REJECTED: '修改密码已拒绝',
  PASSWORD_RESET_REQUEST: '提交密码重置申请',
  PASSWORD_RESET_APPROVED: '密码重置已批准',
  PASSWORD_RESET_REJECTED: '密码重置已拒绝',
  SETTINGS_UPDATE: '更新个人设置',
};
