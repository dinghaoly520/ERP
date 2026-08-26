import { api } from '../api';

/* ── E1（GB/T 43711 第 9 章）：采购质效评价 ── */

export interface PerformanceMetrics {
  period: { from: string; to: string };
  projectCount: number;
  contractCount: number;
  avgCycleDays: number | null;
  savingsRate: number | null;
  competitionAvg: number | null;
  objectionRate: number | null;
  acceptanceRate: number | null;
  satisfactionAvg: number | null;
}

export interface ProjectEvaluationItem {
  id: string;
  projectCode: string;
  projectName: string;
  evaluatorName: string;
  qualityScore: number;
  efficiencyScore: number;
  complianceScore: number;
  weightedScore: number;
  period?: string | null;
  comment?: string | null;
  createdAt: string;
}

export function getPerformanceMetrics(params?: { from?: string; to?: string }) {
  const q = new URLSearchParams();
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  const qs = q.toString();
  return api.get<PerformanceMetrics>(`/performance/metrics${qs ? `?${qs}` : ''}`);
}

export function listEvaluations(projectCode?: string) {
  return api.get<ProjectEvaluationItem[]>(`/performance/evaluations${projectCode ? `?projectCode=${encodeURIComponent(projectCode)}` : ''}`);
}

export function createEvaluation(data: {
  projectCode: string; projectName: string; projectManagementItemId?: string;
  qualityScore: number; efficiencyScore: number; complianceScore: number; period?: string; comment?: string;
}) {
  return api.post<ProjectEvaluationItem>('/performance/evaluations', data);
}

export function generatePerformanceReport(periodLabel?: string) {
  return api.post<{ fileAssetId: string; size: number }>('/performance/report', { periodLabel });
}

export function submitSatisfaction(data: { projectCode: string; score: number; comment?: string }) {
  return api.post<unknown>('/supplier-portal/satisfaction', data);
}
