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
  /** 公司视野（all/单 id/逗号多选，2026-11-10）：传入则生成结果落服务端缓存（每公司一份最新） */
  cacheKey?: string,
): Promise<DashboardAnalysisResult> {
  return api.post<DashboardAnalysisResult>('/ai/dashboard-analysis', { ...payload, ...(cacheKey && { cacheKey }) });
}

/** 服务端缓存提取（2026-11-10 用户裁定）：按公司视野+日期区间取最新一份分析，
 *  该公司数据指纹未变即命中（instant）——命中不再请求 LLM 重新生成 */
export async function fetchDashboardAnalysisCache(
  companyId: string,
  startDate?: string,
  endDate?: string,
): Promise<{ hit: boolean; result?: DashboardAnalysisResult; generatedAt?: string }> {
  const q = new URLSearchParams({ companyId });
  if (startDate) q.set('startDate', startDate);
  if (endDate) q.set('endDate', endDate);
  return api.get(`/ai/dashboard-analysis/cache?${q.toString()}`);
}
