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
