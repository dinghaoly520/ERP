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

// P1-E：全局 AI 评分校准
export type AiCalibration = {
  overall: { total: number; accepted: number; adoptionRate: number };
  byCategory: Array<{ category: string; avgDelta: number; count: number }>;
  topDeviations: Array<{ scoreItemId: string; name: string; category: string; avgDelta: number; count: number }>;
};

export async function fetchAiCalibration(): Promise<AiCalibration | null> {
  return api.get<AiCalibration | null>('/ai/ai-calibration');
}

export type ReferenceBudgetPayload = {
  projectTitle: string;
  procurementMethod?: string;
  procurementCategory?: string;
  requesterDepartment?: string;
  projectReason?: string;
  historicalProjects?: Array<{
    projectName: string;
    procurementMethod: string;
    departmentName: string;
    budgetAmount: number;
    awardAmount: number | null;
    procurementDate: string | null;
  }>;
};

export type ReferenceBudgetResult = {
  referenceBudget: number;
  reasoning: string;
};

export async function fetchReferenceBudget(
  payload: ReferenceBudgetPayload,
): Promise<ReferenceBudgetResult> {
  return api.post<ReferenceBudgetResult>('/ai/reference-budget', payload);
}
