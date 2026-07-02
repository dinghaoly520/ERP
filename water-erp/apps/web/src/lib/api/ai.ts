const API_BASE = '/api';

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
  const response = await fetch(`${API_BASE}/ai/dashboard-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch dashboard analysis: ${errorText}`);
  }

  return response.json();
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
  const response = await fetch(`${API_BASE}/ai/reference-budget`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch reference budget: ${errorText}`);
  }

  return response.json();
}
