const API_BASE = '/api';

export type DashboardData = {
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    totalCount: number;
    completedCount: number;
    abnormalCount: number;
    totalBudget: number;
    totalBudgetLabel: string;
    awardedBudget: number;
    awardedBudgetLabel: string;
    pendingBudget: number;
    pendingBudgetLabel: string;
    totalAward: number;
    totalAwardLabel: string;
    totalSavings: number;
    totalSavingsLabel: string;
  };
  trendSeries: Array<{
    date: string;
    label: string;
    count: number;
    amount: number;
    projects: Array<{
      name: string;
      date: string;
      department: string;
      method: string;
      budgetLabel: string;
      awardLabel: string;
      status: string;
    }>;
  }>;
  departmentStats: Array<{
    name: string;
    amount: number;
    amountLabel: string;
    completedRate: number;
    topMethod: string;
    projects: Array<{
      name: string;
      date: string;
      method: string;
      budgetLabel: string;
      awardLabel: string;
      status: string;
    }>;
  }>;
  methodStats: Array<{
    name: string;
    count: number;
    amount: number;
    amountLabel: string;
    share: number;
    projects: Array<{
      name: string;
      date: string;
      department: string;
      budgetLabel: string;
      awardLabel: string;
      status: string;
    }>;
  }>;
  attachmentProgress: Array<{
    label: string;
    rate: number;
  }>;
  supplierStats: Array<{
    name: string;
    participatedCount: number;
    winCount: number;
    awardAmount: number;
    awardAmountLabel: string;
    hitRate: number;
    topMethod: string;
    topDepartment: string;
    tags: string[];
    recentProcurements: Array<{
      project: string;
      date: string;
      method: string;
      department: string;
      budgetLabel: string;
      result: string;
    }>;
    winProjects: Array<{
      project: string;
      date: string;
      method: string;
      department: string;
      awardAmountLabel: string;
    }>;
  }>;
  resultStats: Array<{
    label: string;
    count: number;
    amount: number;
    amountLabel: string;
    accent: string;
  }>;
  nonAwardReasons: Array<{
    label: string;
    count: number;
    detail: string;
    projects: Array<{
      name: string;
      date: string;
      department: string;
      budgetLabel: string;
      reason: string;
    }>;
  }>;
  savingsRanking: Array<{
    project: string;
    department: string;
    controlAmount: number;
    awardAmount: number;
    savings: number;
    savingsRate: number;
    controlAmountLabel: string;
    awardAmountLabel: string;
    savingsLabel: string;
    method: string;
    date: string;
  }>;
  riskProjects: Array<{
    project: string;
    department: string;
    reason: string;
    pendingDays: number;
    severity: string;
  }>;
};

export async function fetchDashboardData(
  startDate?: string,
  endDate?: string,
): Promise<DashboardData> {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const url = `${API_BASE}/dashboard${params.toString() ? `?${params.toString()}` : ''}`;

  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch dashboard data: ${errorText}`);
  }

  return response.json();
}