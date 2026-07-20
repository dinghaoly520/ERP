import { api } from '../api';

/* ── 专家管理视图模型（web 门户专属）── */

export interface ExpertProfile {
  id: string;
  userId: string;
  specialty: string;
  title?: string | null;
  employer?: string | null;
  phone?: string | null;
  idNumber?: string | null;
  availability: string;
  notes?: string | null;
}

export interface ExpertListItem {
  id: string;
  displayName: string;
  email: string | null;
  isActive: boolean;
  department: { id: string; name: string } | null;
  expertProfile: ExpertProfile | null;
  bidExperts: { id: string; major: string; progress: number; signedIn: boolean; project: { id: string; name: string; stage: string } }[];
  _count: { expertEvaluations: number };
  latestEval?: { level: string; overallScore: number } | null;
}

export interface ExtractionSelected {
  userId: string;
  name: string;
  specialty: string;
  title?: string | null;
  employer?: string | null;
  matchScore: number;
  reason: string;
  role: '正选' | '候补';
}

/** 候选池专家（供手动替换使用） */
export interface CandidatePoolItem {
  userId: string;
  name: string;
  specialty: string;
  title?: string;
  employer?: string;
  matchScore: number;
  evaluationLevel?: string;
  currentLoadStatus?: string;
  reason: string;
}

export interface ExtractionPreview {
  engine: 'deepseek' | 'rules';
  model: string;
  extractMode: 'specialty_match' | 'random' | 'merit_best';
  analysis: string;
  requiredSpecialties: { specialty: string; count: number; reason: string }[];
  eligiblePool: number;
  candidatePool: CandidatePoolItem[];
  selected: ExtractionSelected[];
  alternatives: ExtractionSelected[];
  shortages: { specialty: string; needed: number; available: number }[];
  generatedAt: string;
}

export interface ExpertEvalStats {
  levelCounts: { A: number; B: number; C: number; D: number };
  avgScore: number;
  total: number;
}

export interface NotifyResult {
  userId: string;
  results: Record<string, string>;
}

/* ── 专家库 / 录入 ── */

export function listExperts(params?: { search?: string; specialty?: string }) {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.specialty) q.set('specialty', params.specialty);
  const qs = q.toString();
  return api.get<ExpertListItem[]>(`/expert-admin${qs ? '?' + qs : ''}`);
}

export function listSpecialties() {
  return api.get<string[]>('/expert-admin/specialties');
}

export function getExpert(id: string) {
  return api.get<unknown>(`/expert-admin/${id}`);
}

export function createExpert(data: {
  username: string; displayName: string; password: string; specialty: string;
  title?: string; employer?: string; phone?: string; idNumber?: string; email?: string; notes?: string;
  ethnicity?: string; education?: string; licenseNo?: string;
}) {
  return api.post<unknown>('/expert-admin', data);
}

export function setExpertAvailability(id: string, available: boolean) {
  return api.patch<{ success: boolean }>(`/expert-admin/${id}/availability`, { available });
}

export function importExpertsFromSeed() {
  return api.post<{ imported: number; skipped: number; total: number }>('/expert-admin/import-from-seed', {});
}

export function updateExpertProfile(id: string, data: Record<string, unknown>) {
  return api.patch<{ success: boolean }>(`/expert-admin/${id}/profile`, data);
}

/* ── 专家抽取 ── */

export function previewExtraction(data: {
  projectId: string;
  totalNeeded?: number;
  alternatives?: number;
  extractMode?: 'specialty_match' | 'random' | 'merit_best';
  /** @deprecated 兼容旧UI，优先用 extractMode */
  mode?: 'weighted' | 'fair';
  manualQuotas?: { specialty: string; count: number }[];
  excludedUserIds?: string[];
}) {
  return api.post<ExtractionPreview>('/expert-admin/extract', data);
}

export function confirmExtraction(data: { projectId: string; experts: { userId: string; expertName: string; major: string; isLead?: boolean }[]; candidates?: { userId: string; expertName: string; major: string }[] }) {
  return api.post<{ success: boolean; count: number; expertIds: string[] }>('/expert-admin/extract/confirm', data);
}

export function generateNotification(data: {
  projectName: string; expertName: string; isLead: boolean;
  totalExperts: number; extractMode: string; openTime: string;
}) {
  return api.post<{ success: boolean; generated: boolean; content: string | null }>('/expert-admin/notification/generate', data);
}

export function sendExtractionNotify(data: {
  projectId: string;
  expertIds: string[];
  channels: string[];
  message: string;
}) {
  return api.post<{ projectId: string; projectName: string; results: NotifyResult[] }>('/expert-admin/extract/notify', data);
}

export function getExtractionHistory(params?: { projectId?: string; page?: number; pageSize?: number }) {
  const q = new URLSearchParams();
  if (params?.projectId) q.set('projectId', params.projectId);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return api.get<{ total: number; page: number; pageSize: number; items: any[] }>(`/expert-admin/extract/history${qs ? '?' + qs : ''}`);
}

/* ── 专家评价 ── */

export function createExpertEvaluation(data: {
  expertUserId: string; projectId?: string;
  attendanceScore: number; qualityScore: number; disciplineScore: number; comment?: string;
}) {
  return api.post<unknown>('/expert-admin/evaluations', data);
}

export function getExpertEvalStats() {
  return api.get<ExpertEvalStats>('/expert-admin/evaluations/stats');
}

export function getExpertDimensionStats() {
  return api.get<{ attendanceAvg: number; qualityAvg: number; disciplineAvg: number; total: number }>('/expert-admin/evaluations/dimensions');
}

/* ── 采购项目（抽取页选择用）── */

export interface BidProjectOption {
  id: string; name: string; projectCode: string; stage: string;
  procurementMethod: string; deadline: string; _count: { suppliers: number };
}
export function listBidProjects() {
  return api.get<BidProjectOption[]>('/bid/projects');
}

export function createBidProject(data: {
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  budget?: number;
  scope?: string;
  qualification?: string;
  contact?: string;
}) {
  return api.post<BidProjectOption>('/bid/projects', data);
}

export interface BidProjectDetail {
  id: string; name: string; projectCode: string; stage: string;
  procurementMethod: string; openTime: string; deadline: string; riskNote?: string | null;
  suppliers: { supplierId: string | null; supplierName: string }[];
  experts: { userId: string; expertName: string; major: string }[];
}
export function getBidProjectDetail(id: string) {
  return api.get<BidProjectDetail>(`/bid/projects/${id}`);
}

/* ── 专家画像 ── */
export interface ExpertPortrait {
  userId: string; displayName: string; participationCount: number; completedCount: number;
  completionRate: number; averageScore: number | null; meanDeviation: number | null;
  deviationSamples: number; evalAvg: number | null; evalCount: number;
  recentLevels: string[]; isStandingExpert: boolean;
}
export function getExpertPortrait(id: string) {
  return api.get<ExpertPortrait>(`/expert-admin/${id}/portrait`);
}

/* ── 评价历史 ── */
export function getExpertEvaluations(id: string) {
  return api.get<any[]>(`/expert-admin/${id}/evaluations`);
}

/* ── 统计仪表盘 ── */
export interface ExpertStatistics {
  totalExperts: number; available: number; occupied: number; disabled: number;
  specialtyDistribution: { name: string; count: number }[];
  titleDistribution: { name: string; count: number }[];
  evaluationStats: { levelCounts: { A: number; B: number; C: number; D: number }; avgScore: number; total: number };
  recentEvals: { level: string; score: number; expert: string; time: string }[];
  recentAssigns7d: number; recentExtractions30d: number;
  monthlyEvalTrend: { labels: string[]; counts: number[] };
}
export function getExpertStatistics() {
  return api.get<ExpertStatistics>('/expert-admin/statistics');
}

/* ── 批量操作 ── */
export function batchOperation(data: { action: 'enable' | 'disable'; ids: string[]; reason?: string }) {
  return api.post<{ success: boolean; count: number }>('/expert-admin/batch', data);
}

/* ── 导出 ── */
export function exportExperts(ids?: string[]) {
  const q = ids?.length ? `?ids=${ids.join(',')}` : '';
  return api.get<any[]>(`/expert-admin/export${q}`);
}

/* ── 违规记录 ── */
export function getViolations(expertId?: string) {
  const q = expertId ? `?expertId=${expertId}` : '';
  return api.get<any[]>(`/expert-admin/violations${q}`);
}
export function addViolation(expertId: string, data: { type: string; detail: string; severity: 'warning' | 'danger' }) {
  return api.post<{ success: boolean }>(`/expert-admin/${expertId}/violation`, data);
}

/* ── 通知偏好 ── */
export function getNotifyPrefs(userId: string) {
  return api.get<{ inApp: boolean; sms: boolean; phone: boolean }>(`/expert-admin/${userId}/notify-prefs`);
}
export function updateNotifyPrefs(userId: string, data: { inApp?: boolean; sms?: boolean; phone?: boolean }) {
  return api.patch<{ success: boolean }>(`/expert-admin/${userId}/notify-prefs`, data);
}

/* ── 退库管理 ── */
export function getRetireCandidates() {
  return api.get<any[]>('/expert-admin/retire-candidates');
}
export function confirmRetire(id: string, reason: string) {
  return api.post<{ success: boolean }>(`/expert-admin/${id}/retire`, { reason });
}

/* ── 邀请确认 ── */
export function confirmInvitation(projectId: string, userId: string) {
  return api.post<{ success: boolean; status: string }>(`/expert-admin/invitations/${projectId}/${userId}/confirm`, {});
}
export function declineInvitation(projectId: string, userId: string) {
  return api.post<{ success: boolean; status: string; promoted?: { userId: string; expertName: string; major: string } | null }>(`/expert-admin/invitations/${projectId}/${userId}/decline`, {});
}

export function getProjectInvitations(projectId: string) {
  return api.get<{
    experts: { id: string; userId: string; expertName: string; major: string; isLead: boolean; expertRole: string; invitationStatus: string }[];
    summary: { total: number; confirmed: number; declined: number; pending: number; availableCandidates: number; allDeclined: boolean };
  }>(`/expert-admin/invitations/${projectId}`);
}

/* ── AI 采纳率 ── */
export function getAiAdoptionRate(expertId?: string) {
  return api.get<any>(`/expert-admin/ai-adoption${expertId ? `?expertId=${expertId}` : ''}`);
}
export function getExpertRanking(period: 'month' | 'quarter' | 'all' = 'month') {
  return api.get<any[]>(`/expert-admin/ranking?period=${period}`);
}
export function getLoadDistribution() {
  return api.get<any>('/expert-admin/load-distribution');
}

/* ── 批量导入 ── */
export function importCsv(rows: Array<Record<string, string>>) {
  return api.post<any>('/expert-admin/import-csv', { rows });
}
