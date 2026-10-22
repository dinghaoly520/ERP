/**
 * 数据库页 AI 综合分析（裁剪自 apps/web/src/lib/api/ai.ts——仅 Dashboard 分析，
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

export type MobileGreeting = { text: string; source: 'llm' | 'fallback' };

/** 顶部欢迎语（服务端 LLM 每次现场生成新句，不缓存） */
export async function fetchMobileGreeting(): Promise<MobileGreeting> {
  return api.get<MobileGreeting>('/ai/mobile-greeting');
}

export type MobileBrief = {
  available: true;
  focus: { text: string; jump: string };
  metric: { text: string; jump: string };
  reminder: { text: string; jump: string };
  shareText: string;
} | { available: false };

/** 数据库页「今日要报」三句（LLM 生成，失败时 available:false） */
export async function fetchMobileBrief(companyId?: string): Promise<MobileBrief> {
  const q = companyId && companyId !== 'all' ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<MobileBrief>(`/ai/mobile-brief${q}`);
}
