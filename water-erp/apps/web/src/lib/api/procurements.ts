import type { ProcurementsListResponse, LedgerSummary, ResultStatusKey } from '../types/procurement';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

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

  const response = await fetch(`${API_BASE}/procurements?${query.toString()}`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Failed to fetch procurements');
  }
  return response.json();
}

export async function fetchProcurementById(id: string) {
  const response = await fetch(`${API_BASE}/procurements/${id}`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Failed to fetch procurement');
  }
  return response.json();
}

export async function fetchLedgerStats(startDate?: string, endDate?: string): Promise<LedgerSummary> {
  const query = new URLSearchParams();
  if (startDate) query.set('startDate', startDate);
  if (endDate) query.set('endDate', endDate);

  const response = await fetch(`${API_BASE}/procurements/stats?${query.toString()}`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Failed to fetch stats');
  }
  return response.json();
}

export async function fetchProcurementMethods(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/procurements/methods`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Failed to fetch methods');
  }
  return response.json();
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
  const response = await fetch(`${API_BASE}/procurements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create procurement');
  }
  return response.json();
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
  const response = await fetch(`${API_BASE}/procurements/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update procurement');
  }
  return response.json();
}

export async function moveProcurementToRecycleBin(id: string) {
  const response = await fetch(`${API_BASE}/procurements/${id}/recycle`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to move procurement to recycle bin');
  }
  return response.json();
}

export async function restoreProcurementFromRecycleBin(id: string) {
  const response = await fetch(`${API_BASE}/procurements/${id}/restore`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to restore procurement');
  }
  return response.json();
}

export async function deleteProcurementPermanently(id: string) {
  const response = await fetch(`${API_BASE}/procurements/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to delete procurement');
  }
  return response.json();
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
}) {
  const response = await fetch(`${API_BASE}/ai/procurement-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to analyze procurement ledger');
  }
  return response.json();
}