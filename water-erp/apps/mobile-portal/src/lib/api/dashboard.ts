import { toApiError } from '@water-erp/client';
import { api } from '../api';
import { apiFetch } from './api-fetch';
const API_BASE = '/api';

export type DashboardBadges = { abnormalCount: number; pendingCount: number; stalledCount: number };
export type DashboardCompareSummary = {
  totalCount: number; completedCount: number; abnormalCount: number;
  awardedBudget: number; totalAward: number; totalSavings: number;
};
export type DashboardCompare = { prevRange: { startDate: string; endDate: string } | null; summary: DashboardCompareSummary | null };

export async function fetchDashboardBadges(companyId?: string): Promise<DashboardBadges> {
  const q = companyId && companyId !== 'all' ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<DashboardBadges>(`/dashboard/badges${q}`);
}

/* ── 公司龙虎榜（:3011，跨公司榜单——admin 全榜 / leader 本公司排位+集团均值）── */

export type CompanyRankingRange = "month" | "year";

/** awardedCount=轮次数、abnormalCount=0 为后端简化口径（榜单主序=awardAmount，计数列 UI 标「轮」） */
export type CompanyRankingRow = {
  companyId: string;
  companyName: string;
  totalCount: number;
  awardedCount: number;
  awardAmount: number;
  savings: number;
  abnormalCount: number;
};

export type CompanyRankingView = {
  range: string;
  /** admin 响应携带 */
  rows?: CompanyRankingRow[];
  /** leader/staff 响应携带（公司不在榜为 null） */
  self?: { rank: number; companyName: string; awardAmount: number } | null;
  groupAvg?: { awardAmount: number; totalCount: number };
};

export async function fetchCompanyRanking(range: CompanyRankingRange): Promise<CompanyRankingView> {
  return api.get<CompanyRankingView>(`/dashboard/company-ranking?range=${range}`);
}

export type DashboardData = {
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  compare?: DashboardCompare;
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
    /** 立项节点数（按项目立项日落桶） */
    initiated: number;
    /** 归档节点数（已成交轮次按完成时点落桶） */
    archived: number;
    /** 在执行净值（累计立项 − 累计归档） */
    active: number;
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
  /** 公司维度分布（2026-10-23：部门归属近乎全空，驾驶舱分布维度改用公司；与 departmentStats 同形） */
  companyStats: Array<{
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
    projectCode: string | null;
    awardedSupplierName: string | null;
    participantCount: number;
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
  companyId?: string, // 仅 admin 生效：公司选择器
  compare?: boolean, // 'true' 时响应附带环比上期块
): Promise<DashboardData> {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (companyId && companyId !== 'all') params.set('companyId', companyId);
  if (compare) params.set('compare', 'true');

  const url = `${API_BASE}/dashboard${params.toString() ? `?${params.toString()}` : ''}`;

  const response = await apiFetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw await toApiError(response, '加载仪表盘数据失败');
  }

  return response.json();
}