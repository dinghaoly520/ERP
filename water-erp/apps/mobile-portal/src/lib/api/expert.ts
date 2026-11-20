/** 专家库列表（2026-11-20：GET /expert-admin——:3005 专家库同源） */
import { api } from '../api';

export type ExpertListItem = {
  id: string;
  displayName: string;
  username: string;
  companyId: string | null;
  isActive: boolean;
  expertProfile: {
    id: string;
    specialty: string | null;
    title: string | null;
    employer: string | null;
    phone: string | null;
    entryStatus: string;
    availability: string | null;
    retiredAt: string | null;
  } | null;
  latestEval: { level: string; createdAt: string } | null;
  avgGrade: string | null;
};

export type ExpertListResult = {
  total: number;
  page: number;
  pageSize: number;
  items: ExpertListItem[];
};

export async function fetchExpertList(params?: {
  search?: string;
  specialty?: string;
  employer?: string;
  page?: number;
  pageSize?: number;
  companyId?: string;
  statusTab?: string;
}): Promise<ExpertListResult> {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.specialty) q.set('specialty', params.specialty);
  if (params?.employer) q.set('employer', params.employer);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  if (params?.companyId && params.companyId !== 'all') q.set('companyId', params.companyId);
  if (params?.statusTab) q.set('statusTab', params.statusTab);
  const qs = q.toString();
  return api.get<ExpertListResult>(`/expert-admin${qs ? `?${qs}` : ''}`);
}
