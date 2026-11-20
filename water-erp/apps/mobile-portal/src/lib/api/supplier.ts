/** 供应商库列表（2026-11-19 供应商板块：GET /supplier/list——:3005 供应商库同源） */
import { api } from '../api';

export type SupplierItem = {
  id: string;
  name: string;
  status: 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'DISABLED' | 'BLACKLIST';
  shortName?: string | null;
  legalRepresentative?: string | null;
  registeredCapital?: string | null;
  registeredAt?: string | null;
  completeness?: number;
  qualificationSummary?: string | null;
  tags?: string[];
  companies?: Array<{ id: string; name: string; shortName: string | null; status: string }>;
  createdAt: string;
  updatedAt: string;
};

export type SupplierListResult = {
  total: number;
  page: number;
  pageSize: number;
  items: SupplierItem[];
};

export async function fetchSupplierLibrary(params?: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<SupplierListResult> {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return api.get<SupplierListResult>(`/supplier/list${qs ? `?${qs}` : ''}`);
}

export const SUPPLIER_STATUS_LABELS: Record<SupplierItem['status'], string> = {
  PENDING: '待审核',
  RETURNED: '已退回',
  APPROVED: '已入库',
  REJECTED: '已拒绝',
  DISABLED: '已停用',
  BLACKLIST: '黑名单',
};
