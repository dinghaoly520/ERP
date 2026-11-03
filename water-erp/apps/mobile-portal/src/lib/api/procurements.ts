/**
 * 采购台账只读接口（裁剪自 apps/web/src/lib/api/procurements.ts——
 * 仅保留列表/统计/方式枚举，写操作不进移动门户）。
 */
import type { ProcurementsListResponse, LedgerSummary, ResultStatusKey } from '../types/procurement';
import { api } from '../api';

export async function fetchProcurements(params: {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  procurementMethod?: string;
  departmentId?: string;
  resultStatus?: ResultStatusKey;
  searchKeyword?: string;
  abnormalOnly?: boolean;
  recycleStatus?: 'ACTIVE' | 'RECYCLED' | 'ALL';
  category?: 'archived' | 'terminated';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  companyId?: string; // 仅 admin 生效：公司选择器
}): Promise<ProcurementsListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.procurementMethod) query.set('procurementMethod', params.procurementMethod);
  if (params.departmentId) query.set('departmentId', params.departmentId);
  if (params.resultStatus) query.set('resultStatus', params.resultStatus);
  if (params.searchKeyword) query.set('searchKeyword', params.searchKeyword);
  if (params.abnormalOnly) query.set('abnormalOnly', 'true');
  if (params.recycleStatus) query.set('recycleStatus', params.recycleStatus);
  if (params.category) query.set('category', params.category);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  if (params.companyId && params.companyId !== 'all') query.set('companyId', params.companyId);
  return api.get<ProcurementsListResponse>(`/procurements?${query.toString()}`);
}

/** 汇总条与列表同参（P1-2 口径漂移修复，2026-11-03）——筛选生效时两套数字必须可互相复现 */
export async function fetchLedgerStats(filter: {
  startDate?: string;
  endDate?: string;
  companyId?: string;
  searchKeyword?: string;
  resultStatus?: ResultStatusKey;
  abnormalOnly?: boolean;
}): Promise<LedgerSummary> {
  const query = new URLSearchParams();
  if (filter.startDate) query.set('startDate', filter.startDate);
  if (filter.endDate) query.set('endDate', filter.endDate);
  if (filter.companyId && filter.companyId !== 'all') query.set('companyId', filter.companyId);
  if (filter.searchKeyword) query.set('searchKeyword', filter.searchKeyword);
  if (filter.resultStatus) query.set('resultStatus', filter.resultStatus);
  if (filter.abnormalOnly) query.set('abnormalOnly', 'true');
  return api.get<LedgerSummary>(`/procurements/stats?${query.toString()}`);
}

export async function fetchProcurementMethods(): Promise<string[]> {
  return api.get<string[]>('/procurements/methods');
}
