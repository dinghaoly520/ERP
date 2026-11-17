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
  /** 公司视野（2026-11-10）：服务端按登录人 scope 解析为缓存键——admin=本参数（选择器），
   *  非 admin=本人公司；生成成功落服务端缓存（每公司一份最新） */
  companyId?: string,
): Promise<DashboardAnalysisResult> {
  return api.post<DashboardAnalysisResult>('/ai/dashboard-analysis', { ...payload, ...(companyId && { companyId }) });
}

/** 服务端缓存提取（2026-11-10 用户裁定）：按登录人 scope（admin=选择器参数、非
 *  admin=本公司，传参忽略）取最新一份分析，该公司数据指纹未变即命中——命中不再
 *  请求 LLM 重新生成 */
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

/** 汇报材料 AI 分析结果（2026-11-17）：总评 + 六板块逐段说明 */
export type ReportMaterialResult = {
  overview: string;
  sections: Record<'savings' | 'trend' | 'department' | 'method' | 'scale' | 'supplier', string>;
  highlights: string[];
  concerns: string[];
  suggestions: string[];
};

export type ReportMaterialPayload = {
  startDate?: string;
  endDate?: string;
  rangeLabel?: string;
  summary?: unknown;
  trendSeries?: unknown[];
  departmentStats?: unknown[];
  methodStats?: unknown[];
  scaleSegments?: unknown[];
  savingsRanking?: unknown[];
  supplierStats?: unknown[];
};

/** 汇报材料各板块说明（AI 生成，按需调用无缓存；未开标=在途非异常口径已入提示词） */
export async function fetchReportMaterialAnalysis(payload: ReportMaterialPayload, companyId?: string): Promise<ReportMaterialResult> {
  return api.post<ReportMaterialResult>('/ai/report-material', { ...payload, ...(companyId && companyId !== 'all' && { companyId }) });
}

/** 汇报材料 AI 分析缓存提取（数据/区间未变即命中，不再请求 LLM） */
export async function fetchReportMaterialCache(
  companyId: string,
  startDate?: string,
  endDate?: string,
): Promise<{ hit: boolean; result?: ReportMaterialResult }> {
  const q = new URLSearchParams({ companyId });
  if (startDate) q.set('startDate', startDate);
  if (endDate) q.set('endDate', endDate);
  return api.get(`/ai/report-material/cache?${q.toString()}`);
}
