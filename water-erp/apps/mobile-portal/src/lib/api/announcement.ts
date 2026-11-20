/** 公告公示（2026-11-20 业务对齐 :3002 公开门户 tab）：真实类型枚举+公司口径 */
import { api } from '../api';

/** 公告类型标签/色（:3002 TYPE_META 同源） */
export const ANNOUNCEMENT_TYPES: Record<string, { label: string; color: string }> = {
  BID_NOTICE:          { label: '采购公告',   color: 'var(--accent)'  },
  ADDENDUM:            { label: '补遗公告',   color: 'var(--warning)' },
  CLARIFY_NOTICE:      { label: '澄清与修改', color: 'var(--warning)' },
  PREQUAL_NOTICE:      { label: '资格预审',   color: 'var(--accent)'  },
  PRE_WIN_NOTICE:      { label: '预成交公示', color: 'var(--success)' },
  WIN_BID_NOTICE:      { label: '中标公告',   color: 'var(--success)' },
  WIN_NOTICE:          { label: '成交公告',   color: 'var(--success)' },
  FAILED_BID_NOTICE:   { label: '流标公告',   color: 'var(--warning)' },
  CONTRACT_NOTICE:     { label: '合同公告',   color: 'var(--accent)'  },
  PERFORMANCE_NOTICE:  { label: '履行结果',   color: 'var(--gold)'    },
  POLICY:              { label: '政策法规',   color: 'var(--danger)'  },
  PLATFORM:            { label: '平台通知',   color: 'var(--gold)'    },
};

/** Chip（:3002 ANNOUNCEMENT_TABS 同构——7 类 + 全部） */
export const ANNOUNCEMENT_TABS: Array<{ key: string; label: string; types?: string[] }> = [
  { key: 'all',              label: '全部' },
  { key: 'BID_NOTICE',       label: '采购公告', types: ['BID_NOTICE'] },
  { key: 'FAILED_BID_NOTICE',label: '流标公告', types: ['FAILED_BID_NOTICE'] },
  { key: 'win',              label: '中标公告', types: ['WIN_BID_NOTICE', 'PRE_WIN_NOTICE'] },
  { key: 'ADDENDUM',         label: '补遗公告', types: ['ADDENDUM'] },
  { key: 'PREQUAL_NOTICE',   label: '资格预审', types: ['PREQUAL_NOTICE'] },
  { key: 'POLICY',           label: '政策法规', types: ['POLICY'] },
  { key: 'PLATFORM',         label: '平台通知', types: ['PLATFORM'] },
];

export type AnnouncementItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  publishedAt: string | null;
  dataClass?: string;
  metadata?: { visibility?: string; titleOnly?: boolean };
  relatedProjectCode?: string | null;
  content?: string;
};

export type AnnouncementListResult = {
  items: AnnouncementItem[];
  total: number;
};

/** 管理端列表（公司隔离，:3005 notice 同源） */
export async function fetchAnnouncements(params?: {
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  companyId?: string;
}): Promise<AnnouncementListResult> {
  const q = new URLSearchParams();
  if (params?.type) q.set('type', params.type);
  if (params?.search) q.set('search', params.search);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  if (params?.companyId && params.companyId !== 'all') q.set('companyId', params.companyId);
  const qs = q.toString();
  return api.get<AnnouncementListResult>(`/announcements${qs ? `?${qs}` : ''}`);
}

export function typeOf(t: string): { label: string; color: string } {
  return ANNOUNCEMENT_TYPES[t] ?? { label: t, color: 'var(--muted-foreground)' };
}

export function matchesTab(type: string, tab: string): boolean {
  if (tab === 'all') return true;
  const entry = ANNOUNCEMENT_TABS.find((t) => t.key === tab);
  return entry?.types?.includes(type) ?? type === tab;
}
