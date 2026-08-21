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
  recycleStatus?: 'ACTIVE' | 'RECYCLED' | 'ALL';
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
  if (params.recycleStatus) query.set('recycleStatus', params.recycleStatus);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  if (params.companyId && params.companyId !== 'all') query.set('companyId', params.companyId);
  return api.get<ProcurementsListResponse>(`/procurements?${query.toString()}`);
}

export async function fetchProcurementById(id: string) {
  return api.get(`/procurements/${id}`);
}

export async function fetchLedgerStats(
  startDate?: string,
  endDate?: string,
  companyId?: string,
): Promise<LedgerSummary> {
  const query = new URLSearchParams();
  if (startDate) query.set('startDate', startDate);
  if (endDate) query.set('endDate', endDate);
  if (companyId && companyId !== 'all') query.set('companyId', companyId);
  return api.get<LedgerSummary>(`/procurements/stats?${query.toString()}`);
}

export async function fetchProcurementMethods(): Promise<string[]> {
  return api.get<string[]>('/procurements/methods');
}

export async function createProcurement(data: {
  projectName: string;
  procurementDate?: string;
  procurementMethod: string;
  departmentName?: string;
  budgetAmount?: number;
  controlAmount?: number;
  supplierNames?: string[];
  awardedSupplierName?: string;
  awardAmount?: number;
  resultStatus?: ResultStatusKey;
  resultText?: string;
}) {
  return api.post('/procurements', data);
}

export async function updateProcurement(id: string, data: Partial<{
  projectName: string;
  procurementDate: string;
  procurementMethod: string;
  departmentName: string;
  budgetAmount: number;
  controlAmount: number;
  supplierNames: string[];
  awardedSupplierName: string;
  awardAmount: number;
  resultStatus: ResultStatusKey;
  resultText: string;
}>) {
  return api.put(`/procurements/${id}`, data);
}

export async function moveProcurementToRecycleBin(id: string) {
  return api.post(`/procurements/${id}/recycle`, {});
}

export async function restoreProcurementFromRecycleBin(id: string) {
  return api.post(`/procurements/${id}/restore`, {});
}

export async function deleteProcurementPermanently(id: string) {
  return api.delete(`/procurements/${id}`);
}

export async function analyzeProcurementLedger(payload: {
  keyword: string;
  items: Array<{
    projectName: string;
    procurementDate: string | null;
    procurementMethod: string;
    departmentName: string;
    budgetAmount: number;
    awardAmount: number | null;
    resultStatus: string;
    supplierNames: string[];
  }>;
  summary: {
    totalCount: number;
    totalBudget: number;
    totalAward: number;
    savings: number;
    savingsRate: string;
    awardedCount: number;
    pendingCount: number;
    abnormalCount: number;
    methodCounts: Record<string, number>;
    deptCounts: Record<string, number>;
  };
}): Promise<{ overview: string; highlights: string[]; concerns: string[]; suggestions: string[] }> {
  return api.post('/ai/procurement-analysis', payload);
}
