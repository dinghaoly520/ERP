import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export function listProjects() {
  return api.get<{ id: string }[]>('/bid/projects');
}

export function listProjectsFull() {
  return api.get<import('@/lib/types').BidProject[]>('/bid/projects');
}

export function getProject<T = BidProjectDetail>(id: string) {
  return api.get<T>(`/bid/projects/${id}`);
}

export function createProject(data: {
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  riskNote?: string;
}) {
  return api.post<BidProjectDetail>('/bid/projects', data);
}

export function updateProject(id: string, data: { stage?: string; riskNote?: string }) {
  return api.patch<BidProjectDetail>(`/bid/projects/${id}`, data);
}

export function getDashboardStats() {
  return api.get<{
    totalProjects: number; activeProjects: number;
    totalSuppliers: number; approvedSuppliers: number;
    totalExperts: number; totalAnnouncements: number;
    stageDistribution: Record<string, number>;
    recentLogs: import('@/lib/types').BidSupervisionLog[];
  }>('/bid/dashboard-stats');
}

export function openSubmission(projectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/open-submission`, {});
}

export function startOpening(projectId: string, body: {
  host: string; supervisor: string;
  decryptWindowStart: string; decryptWindowEnd: string;
}) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/open`, body);
}

export function startEvaluation(projectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/start-evaluation`, {});
}

export function decryptSupplier(projectId: string, supplierId: string, body?: {
  amount?: string; period?: string; qualityTarget?: string;
  bondStatus?: string; simulateDanger?: boolean;
}) {
  return api.post(`/bid/projects/${projectId}/decrypt/${supplierId}`, body || {});
}

export function resolveOpeningDispute(projectId: string, recordId: string, body: {
  result: string; confirm: boolean;
}) {
  return api.post(`/bid/projects/${projectId}/opening-records/${recordId}/resolve-dispute`, body);
}

export function submitScore(projectId: string, body: {
  expertId: string; scoreItemId: string; supplierId: string;
  score: number; reason?: string;
}) {
  return api.post(`/bid/projects/${projectId}/scores`, body);
}

export function listScores(projectId: string) {
  return api.get(`/bid/projects/${projectId}/scores`);
}

export function listEvaluationResults(projectId: string) {
  return api.get(`/bid/projects/${projectId}/evaluation-results`);
}

export function generateEvaluationResults(projectId: string) {
  return api.post(`/bid/projects/${projectId}/evaluation-results/generate`, {});
}

export function listClarifications(projectId: string) {
  return api.get(`/bid/projects/${projectId}/clarifications`);
}

export function createClarification(projectId: string, body: {
  question: string; issuer: string; supplierName: string;
}) {
  return api.post(`/bid/projects/${projectId}/clarifications`, body);
}

export function archiveAll(projectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/archive-all`, {});
}

export function getWorkspace(projectId: string) {
  return api.get(`/bid/projects/${projectId}/workspace`);
}
