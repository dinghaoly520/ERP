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
  // CTS A-218/222 入库状态机
  entryStatus?: string | null; // PENDING | ACTIVE | SUSPENDED | RETIRED
  statusNote?: string | null;
  verifiedAt?: string | null;
  retiredAt?: string | null;
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
  latestEval?: { level: string } | null;
  avgGrade?: string | null;
}

export interface ExtractionSelected {
  userId: string;
  name: string;
  specialty: string;
  title?: string | null;
  employer?: string | null;
  evaluationLevel?: string | null;
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
  suggestedLeaderId?: string | null;
  generatedAt: string;
}

export interface ExpertEvalStats {
  levelCounts: { A: number; B: number; C: number; D: number; E: number };
  excellentRatio: number;
  total: number;
}

export interface NotifyResult {
  userId: string;
  results: Record<string, string>;
}

/* ── 专家库 / 录入 ── */

export function listExperts(params?: { search?: string; specialty?: string; page?: number; pageSize?: number }) {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.specialty) q.set('specialty', params.specialty);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return api.get<{ total: number; page: number; pageSize: number; items: ExpertListItem[] }>(`/expert-admin${qs ? '?' + qs : ''}`);
}

export function listSpecialties() {
  return api.get<string[]>('/expert-admin/specialties');
}

export function createExpert(data: {
  username: string; displayName: string; password: string; specialty: string;
  title?: string; employer?: string; departmentName?: string; phone?: string; idNumber?: string; email?: string; notes?: string;
  ethnicity?: string; education?: string; licenseNo?: string;
}) {
  return api.post<unknown>('/expert-admin', data);
}

export function setExpertAvailability(id: string, available: boolean) {
  return api.patch<{ success: boolean }>(`/expert-admin/${id}/availability`, { available });
}

/** CTS A-218/222 专家库状态：待审核/在库/暂停/退库（退库/暂停须 reason） */
export function updateExpertEntryStatus(id: string, body: { status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED'; reason?: string }) {
  return api.patch(`/expert-admin/${id}/status`, body);
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
  manualQuotas?: { specialty: string; count: number; employer?: string }[];
  excludedUserIds?: string[];
}) {
  return api.post<ExtractionPreview>('/expert-admin/extract', data);
}

export function confirmExtraction(data: { projectId: string; experts: { userId: string; expertName: string; major: string; isLead?: boolean }[]; candidates?: { userId: string; expertName: string; major: string }[]; append?: boolean }) {
  return api.post<{ success: boolean; count: number; expertIds: string[] }>('/expert-admin/extract/confirm', data);
}

/** 设置/切换评审组长 */
export function setLeader(projectId: string, userId: string) {
  return api.patch<{ success: boolean; leaderId: string }>('/expert-admin/extract/leader', { projectId, userId });
}

/** AI 选定评审组长 */
export function aiSelectLeaderApi(projectId: string) {
  return api.post<{ leaderId: string; leaderName: string; reason: string }>('/expert-admin/extract/ai-leader', { projectId });
}

/** 自定义抽取：分析已上传文件，AI 从项目背景推断所需专业/人数 */
export interface ExtractionFileAnalysis {
  suggestedName: string;
  projectBackground: string;
  procurementType: string;
  requiredSpecialties: { specialty: string; count: number; reason: string }[];
  totalExperts: number;
  analysis: string;
  engine: 'ai' | 'rules';
}
export function analyzeExtractionFiles(fileIds: string[]) {
  return api.post<ExtractionFileAnalysis>('/expert-admin/extract/analyze-files', { fileIds });
}

/** 已有项目 AI 推断专业配额（仅分析不抽取，用于预填配额） */
export interface ProjectSpecialtyAnalysis {
  requiredSpecialties: { specialty: string; count: number; reason: string }[];
  totalExperts: number;
  analysis: string;
  engine: 'ai' | 'rules';
}
export function analyzeProjectSpecialties(projectId: string) {
  return api.post<ProjectSpecialtyAnalysis>('/expert-admin/extract/analyze-project', { projectId });
}

/** 自定义抽取：创建影子项目（仅承载抽取/通知/确认，不进项目管理列表） */
export function createCustomProject(data: { name: string; procurementMethod?: string; background?: string; openTime?: string; deadline?: string }) {
  return api.post<{ projectId: string; projectCode: string; name: string; openTime: string }>('/expert-admin/extract/custom-project', data);
}

/** 自定义抽取：上传项目文件（PDF/Word/图片），返回 FileAsset 元数据 */
export function uploadExtractionFile(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return api.postForm<{ id: string; key: string; url: string; originalName: string; size: number; mimeType: string }>(`/upload?category=bid_document`, fd);
}

export function generateNotification(data: {
  projectName: string; expertName: string; isLead: boolean;
  totalExperts: number; extractMode: string; openTime: string;
  isAlternate?: boolean; projectId?: string;
}) {
  return api.post<{ success: boolean; generated: boolean; content: string | null }>('/expert-admin/notification/generate', data);
}

export function prersvpLinks(projectId: string) {
  return api.post<{ links: Record<string, string> }>(`/expert-admin/projects/${projectId}/rsvp-links`, {});
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
  attendanceGrade: string; qualityGrade: string; disciplineGrade: string; comment?: string;
}) {
  return api.post<unknown>('/expert-admin/evaluations', data);
}

export function getExpertEvalStats() {
  return api.get<ExpertEvalStats>('/expert-admin/evaluations/stats');
}

export function getExpertDimensionStats() {
  return api.get<{ attendance: Record<string,number>; quality: Record<string,number>; discipline: Record<string,number>; total: number }>('/expert-admin/evaluations/dimensions');
}

/** AI 辅助评价建议（LLM 综合历史评价/偏离度/违规/负荷给出建议分数） */
export function aiSuggestEvaluation(expertUserId: string) {
  return api.post<{
    attendanceGrade: string; qualityGrade: string; disciplineGrade: string;
    analysis: string; engine: 'ai' | 'rules';
  }>('/expert-admin/evaluations/ai-suggest', { expertUserId });
}

/* ── 采购项目（抽取页选择用）── */

export interface BidProjectOption {
  id: string; name: string; projectCode: string; stage: string;
  procurementMethod: string; deadline: string; _count: { suppliers: number };
  projectManagementItemId?: string | null;
}
export function listBidProjects() {
  return api.get<BidProjectOption[]>('/bid/projects');
}

export interface BidProjectDetail {
  id: string; name: string; projectCode: string; stage: string;
  procurementMethod: string; openTime: string; deadline: string; riskNote?: string | null;
  budget?: string | number | null;
  projectManagementItemId?: string | null;
  suppliers: { supplierId: string | null; supplierName: string; confirmStatus?: string }[];
  experts: { userId: string; expertName: string; major: string }[];
}
export function getBidProjectDetail(id: string) {
  return api.get<BidProjectDetail>(`/bid/projects/${id}`);
}

/* ── 专家画像 ── */
export interface ExpertPortrait {
  userId: string; displayName: string; participationCount: number; completedCount: number;
  completionRate: number; gradeCounts: Record<string, number> | null; meanDeviation: number | null;
  deviationSamples: number; evalCount: number;
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
  evaluationStats: { levelCounts: { A: number; B: number; C: number; D: number; E: number }; excellentRatio: number; total: number };
  recentEvals: { level: string; score: number; expert: string; expertUserId?: string; time: string }[];
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

export interface NotifyHistoryItem { channel: string; status: string; error: string | null; time: string }
export function getNotifyHistory(userId: string) {
  return api.get<NotifyHistoryItem[]>(`/expert-admin/${userId}/notify-history`);
}

/* ── 退库管理 ── */
export function getRetireCandidates() {
  return api.get<any[]>('/expert-admin/retire-candidates');
}
export function confirmRetire(id: string, reason: string) {
  return api.post<{ success: boolean }>(`/expert-admin/${id}/retire`, { reason });
}

export function ignoreRetirementWarning(id: string) {
  return api.post<{ success: boolean }>(`/expert-admin/${id}/retire-ignore`, {});
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
    experts: { id: string; userId: string; expertName: string; major: string; isLead: boolean; expertRole: string; invitationStatus: string; title?: string | null; employer?: string | null; rsvpRespondedAt?: string | null; rsvpExpiresAt?: string | null; rsvpNo?: string }[];
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

/* ── AI 深化：OCR 录入 / 风险预警 / 抽取复盘 ── */
export function ocrIntake(data: { imageBase64: string; mimeType?: string; filename?: string }) {
  return api.post<{ rawText: string; fields: Record<string, string> }>('/expert-admin/ocr-intake', data);
}

export interface ExpertRiskBrief {
  expertId: string;
  displayName: string;
  signals: {
    meanDeviation: number | null;
    deviationRisk: 'high' | 'medium' | 'low';
    recentDCount: number;
    violationCount: number;
  };
  ruleBrief: string;
  aiBrief: string | null;
}
export function getRiskBrief(id: string) {
  return api.get<ExpertRiskBrief>(`/expert-admin/${id}/risk-brief`);
}

export function retrospectExtraction(projectId: string) {
  return api.get<{ summary: { projectName: string; total: number; regular: number; alternative: number; declined: number; avgProgress: number }; experts: { name: string; role: string; isLead: boolean; major: string; progress: number; status: string; latestEvalLevel: string | null }[]; aiSummary: string | null }>(`/expert-admin/extract/retrospect?projectId=${projectId}`);
}
