const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

export interface ProjectProgress {
  id: string;
  title: string;
  projectName: string;
  requesterName: string;
  requesterDepartment: string;
  procurementMethod: string;
  currentStage: string;
  status: string;
  budgetAmount: number;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  createdBy: {
    id: string;
    displayName: string;
    username: string;
  } | null;
  stages: Array<{
    stageKey: string;
    stageName: string;
    stageOrder: number;
    status: string;
    completedAt: string | null;
  }>;
}

export interface ProgressStats {
  totalActive: number;
  stageDistribution: Array<{
    stage: string;
    count: number;
  }>;
  projects: ProjectProgress[];
  // 月度统计
  monthlyAdded: number;
  monthlyCompleted: number;
  recentlyActive: number;
  // 效率指标
  avgDaysPerStage: number;
  totalCompleted: number;
  // 历史对比
  lastMonthCompleted: number;
  lastMonthAdded: number;
}

export interface ProgressAiInsight {
  id: string;
  type: 'risk' | 'bottleneck' | 'budget' | 'completion' | 'rhythm';
  message: string;
  urgency: 'low' | 'medium' | 'high';
  relatedProjectIds: string[];
  relatedStageKey: string | null;
  actionLabel: string | null;
}

export interface ProgressAiInsights {
  overview: string;
  insights: ProgressAiInsight[];
}

export async function fetchProgressStats(
  userId?: string,
  stage?: string,
  companyId?: string, // 仅 admin 生效：公司选择器
): Promise<ProgressStats> {
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  if (stage) params.set('stage', stage);
  if (companyId && companyId !== 'all') params.set('companyId', companyId);

  const url = `${API_BASE}/progress/stats${params.toString() ? `?${params.toString()}` : ''}`;

  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch progress stats: ${errorText}`);
  }

  return response.json();
}

export async function fetchProgressAiInsights(companyId?: string): Promise<ProgressAiInsights> {
  const qs = companyId && companyId !== 'all' ? `?companyId=${encodeURIComponent(companyId)}` : '';
  const url = `${API_BASE}/progress/ai-insights${qs}`;

  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch AI insights: ${errorText}`);
  }

  return response.json();
}
