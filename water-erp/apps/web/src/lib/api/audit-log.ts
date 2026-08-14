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
  PROFILE_UPDATE: '修改个人资料',
  // ── 供应商 ──
  SUPPLIER_APPROVED: '审核通过供应商',
  SUPPLIER_REJECTED: '审核拒绝供应商',
  SUPPLIER_RETURNED: '退回供应商',
  SUPPLIER_APPROVE: '审核通过供应商',
  SUPPLIER_REJECT: '审核拒绝供应商',
  SUPPLIER_RETURN: '退回供应商',
  SUPPLIER_DISABLE: '停用供应商',
  SUPPLIER_ENABLE: '启用供应商',
  SUPPLIER_BLACKLIST: '拉黑供应商',
  SUPPLIER_UPDATE: '修改供应商信息',
  // ── 项目 ──
  PROJECT_CREATE: '创建项目',
  PROJECT_UPDATE: '修改项目',
  PROJECT_DELETE: '删除项目',
  PROJECT_RECYCLE: '回收项目',
  PROJECT_RESTORE: '恢复项目',
  PROJECT_STAGE_CHANGE: '变更项目阶段',
  PROJECT_ARCHIVE: '归档项目',
  // ── 公告 ──
  ANNOUNCEMENT_CREATE: '创建公告',
  ANNOUNCEMENT_PUBLISH: '发布公告',
  ANNOUNCEMENT_UPDATE: '修改公告',
  ANNOUNCEMENT_DELETE: '删除公告',
  // ── 招标 ──
  TENDER_CREATE: '创建招标文件',
  TENDER_UPDATE: '修改招标文件',
  TENDER_EXPORT: '导出招标文件',
  TENDER_REVIEW: '审查招标文件',
  // ── 专家 ──
  EXPERT_CREATE: '录入专家',
  EXPERT_EXTRACT: '抽取专家',
  EXPERT_EVALUATE: '评价专家',
  EXPERT_DISABLE: '停用专家',
  EXPERT_ENABLE: '启用专家',
  // ── 文件 ──
  FILE_UPLOAD: '上传文件',
  FILE_DELETE: '删除文件',
  // ── 目录 ──
  CATALOG_IMPORT: '导入目录',
  CATALOG_EXPORT: '导出目录',
  CATALOG_APPROVE: '审批目录',
  CATALOG_REJECT: '拒绝目录',
};
