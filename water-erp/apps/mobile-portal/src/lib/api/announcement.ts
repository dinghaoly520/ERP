/** 公告公示（2026-11-19 公告公示板块）：公开端点——无需鉴权 */
import { apiFetch } from './api-fetch';
import { toApiError } from '@water-erp/client';
const API_BASE = '/api';

export type AnnouncementItemType = 'BID_NOTICE' | 'WIN_RESULT' | 'POLICY' | 'NEWS';

export type AnnouncementItem = {
  id: string;
  title: string;
  type: AnnouncementItemType;
  status: string;
  publishedAt: string | null;
  dataClass?: string;
  metadata?: { visibility?: string; titleOnly?: boolean };
  content?: string;
  excerpt?: string;
};

export type AnnouncementListResult = {
  items: AnnouncementItem[];
  total: number;
};

export async function fetchAnnouncements(params?: {
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<AnnouncementListResult> {
  const q = new URLSearchParams();
  if (params?.type) q.set('type', params.type);
  if (params?.search) q.set('search', params.search);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const url = `${API_BASE}/announcements/public${q.toString() ? `?${q.toString()}` : ''}`;
  const res = await apiFetch(url, { credentials: 'include' });
  if (!res.ok) throw await toApiError(res, '加载公告失败');
  return res.json();
}

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementItemType, string> = {
  BID_NOTICE: '采购公告',
  WIN_RESULT: '结果公示',
  POLICY: '政策法规',
  NEWS: '平台动态',
};
