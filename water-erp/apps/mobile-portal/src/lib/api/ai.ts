/**
 * 驾驶舱页 AI 综合分析（裁剪自 apps/web/src/lib/api/ai.ts——仅 Dashboard 分析，
 * payload 为 DashboardData 的纯投影，类型与 :3005 完全同源）。
 */
import { api } from '../api';

export type DashboardAnalysisPayload = {
  rangeLabel: string;
  startDate: string;
  endDate: string;
  summary: {
    totalCount: number;
    completedCount: number;
    abnormalCount: number;
    totalBudget: string;
    totalAward: string;
    totalSavings: string;
  };
  trendSeries: Array<{
    label: string;
    count: number;
    amount: number;
  }>;
  departmentStats: Array<{
    name: string;
    amount: string;
  }>;
  methodStats: Array<{
    name: string;
    share: string;
  }>;
  attachmentProgress: Array<{
    label: string;
    rate: string;
  }>;
  supplierStats: Array<{
    name: string;
    participatedCount: number;
    winCount: number;
    awardAmount: string;
  }>;
  resultStats: Array<{
    label: string;
    count: number;
    amount: string;
  }>;
  nonAwardReasons: Array<{
    label: string;
    count: number;
    detail: string;
  }>;
  riskProjects: Array<{
    project: string;
    department: string;
    reason: string;
    pendingDays: number;
    severity: string;
  }>;
  quickActions?: string[];
};

export type DashboardAnalysisResult = {
  overview: string;
  highlights: string[];
  concerns: string[];
  suggestions: string[];
};

export async function fetchDashboardAnalysis(
  payload: DashboardAnalysisPayload,
): Promise<DashboardAnalysisResult> {
  return api.post<DashboardAnalysisResult>('/ai/dashboard-analysis', payload);
}

export type MobileBrief = {
  available: true;
  /** 一行事实句（风险/拥堵事项）；无事为 null——条不渲染 */
  focus: { text: string; jump: '/ledger' | '/progress' } | null;
} | { available: false };

/** 驾驶舱页「今日关注条」（2026-11-18 用户裁定「AI 感太重」改版：三句小作文收为
 *  一行事实句，复述指标的 metric/reminder 句与 shareText 全撤）。rangeKey
 *  （month/quarter/year）显式携带区间语义；自定义/全部档不传（评审 F10） */
export async function fetchMobileBrief(
  companyId?: string,
  range?: { startDate?: string; endDate?: string; rangeKey?: string },
): Promise<MobileBrief> {
  const params = new URLSearchParams();
  if (companyId && companyId !== 'all') params.set('companyId', companyId);
  if (range?.startDate) params.set('startDate', range.startDate);
  if (range?.endDate) params.set('endDate', range.endDate);
  if (range?.rangeKey) params.set('rangeKey', range.rangeKey);
  const q = params.toString();
  return api.get<MobileBrief>(`/ai/mobile-brief${q ? `?${q}` : ''}`);
}
