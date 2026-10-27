import { api } from '../api';
import { apiFetch } from './api-fetch';

/* 专家管理视图模型（web 门户专属） */

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
  // A-129 档案维度：行政区域代码（GB/T 2260 六位）与库内等级（区别于履职评价等级）
  regionCode?: string | null;
  expertLevel?: string | null;
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
  /** 归属公司名快照（admin 全部公司视图按公司分组） */
  company?: string | null;
  department: { id: string; name: string } | null;
  expertProfile: ExpertProfile | null;
  bidExperts: { id: string; major: string; progress: number; signedIn: boolean; project: { id: string; name: string; stage: string } }[];
  _count: { expertEvaluations: number };
  latestEval?: { level: string } | null;
  avgGrade?: string | null;
}

/** 需求方代表目录项（全库，无 PII）：抽取页级联与指定代表搜索数据源（2026-10-20） */
export interface DemandRepDirectoryItem {
  userId: string;
  name: string;
  employer: string;
  specialty: string;
  department: string;
  companyId: string;
}

export interface ExtractionSelected {
  userId: string;
  name: string;
  specialty: string;
  title?: string | null;
  employer?: string | null;
  phone?: string | null;
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
  /** 所属部门（Department.name） */
  department?: string | null;
  /** 档案联系电话 */
  phone?: string | null;
  /** A-129 库内档案等级 A-E */
  expertLevel?: string | null;
  /** 历史参评项目数（累计） */
  pastProjects?: number;
  /** 评分偏离度（均分，越小越贴近共识） */
  scoreDeviation?: number | null;
  reason: string;
}

export interface ExtractionPreview {
  engine: 'deepseek' | 'rules';
  model: string;
  extractMode: 'specialty_match' | 'random' | 'merit_best';
  analysis: string;
  requiredSpecialties: { specialty: string; specialties?: string[]; companyIds?: string[]; count: number; reason: string }[];
  eligiblePool: number;
  candidatePool: CandidatePoolItem[];
  selected: ExtractionSelected[];
  alternatives: ExtractionSelected[];
  shortages: { specialty: string; needed: number; available: number }[];
  /** A-129：任一配额填了区域/等级过滤时返回（共享池按并集收窄；多值不一致时带 note 说明） */
  quotaFiltersApplied?: { regionCode: string[]; expertLevel: string[]; note?: string };
  suggestedLeaderId?: string | null;
  generatedAt: string;
}

export interface NotifyResult {
  userId: string;
  results: Record<string, string>;
}

/* ── 专家库 / 录入 ── */

export function listExperts(params?: { search?: string; specialty?: string; employer?: string; page?: number; pageSize?: number; companyId?: string }) {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.specialty) q.set('specialty', params.specialty);
  if (params?.employer) q.set('employer', params.employer);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  if (params?.companyId && params.companyId !== 'all') q.set('companyId', params.companyId);
  const qs = q.toString();
  return api.get<{ total: number; page: number; pageSize: number; items: ExpertListItem[] }>(`/expert-admin${qs ? '?' + qs : ''}`);
}

export function listSpecialties(companyId?: string, scope?: 'group') {
  const qs = [companyId && companyId !== 'all' ? 'companyId=' + companyId : '', scope === 'group' ? 'scope=group' : ''].filter(Boolean).join('&');
  return api.get<string[]>(`/expert-admin/specialties${qs ? '?' + qs : ''}`);
}

/** 全库各专业人数（抽取页配额卡「N人·库内」提示；不分公司——与 group 专业池同口径） */
export function specialtyPoolCounts() {
  return api.get<{ specialty: string; count: number }[]>('/expert-admin/specialty-pool-counts');
}

/** 配额「公司」下拉候选（2026-10-20）：仅列库内确有可抽取专家的公司（与抽取池同资格口径）。
 *  替代直拉 /companies 主数据全集——0 专家的残留公司会污染抽取下拉（走查测试集团实录）。 */
export function listPoolCompanies() {
  return api.get<Array<{ id: string; name: string; shortName?: string | null }>>('/expert-admin/pool-companies');
}

/** 需求方代表目录（全库，不隔离）：公司→部门→专业级联 + 指定代表搜索（2026-10-20，见后端端点注释） */
export function getDemandRepDirectory() {
  return api.get<{ items: DemandRepDirectoryItem[] }>('/expert-admin/demand-rep-directory');
}

/** 按公司分组全量计数（admin 全部公司视图的分组标题全量口径；与列表同 where） */
export function fetchExpertCompanyCounts(params?: { search?: string; specialty?: string; employer?: string }) {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.specialty) q.set('specialty', params.specialty);
  if (params?.employer) q.set('employer', params.employer);
  const qs = q.toString();
  return api.get<Array<{ name: string; count: number }>>(`/expert-admin/company-counts${qs ? '?' + qs : ''}`);
}

export function createExpert(data: {
  username: string; displayName: string; password: string; specialty: string;
  /** 归属公司（2026-10-15 工作单位=公司选择器）：后端以所选公司落 User 归属与 ExpertProfile.employer */
  companyId?: string;
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

/* 专家抽取 */

export function previewExtraction(data: {
  projectId: string;
  totalNeeded?: number;
  alternatives?: number;
  extractMode?: 'specialty_match' | 'random' | 'merit_best';
  /** @deprecated 兼容旧UI，优先用 extractMode */
  mode?: 'weighted' | 'fair';
  /** 多选配额（2026-10-13）：specialties/companyIds 数组；旧单值 specialty/companyId 仍受支持（后端归一化） */
  manualQuotas?: { specialty?: string; specialties?: string[]; count: number; employer?: string; department?: string; regionCode?: string; expertLevel?: string; companyId?: string; companyIds?: string[] }[];
  excludedUserIds?: string[];
  /** 公司限定：本次抽取的全部候选仅限该公司专家 */
  employer?: string;
}) {
  return api.post<ExtractionPreview>('/expert-admin/extract', data);
}

export function confirmExtraction(data: { projectId: string; experts: { userId: string; expertName: string; major: string; isLead?: boolean }[]; candidates?: { userId: string; expertName: string; major: string }[]; append?: boolean; extractMode?: 'specialty_match' | 'random' | 'merit_best'; companyIds?: string[] }) {
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
  requiredSpecialties: { specialty: string; specialties?: string[]; companyIds?: string[]; count: number; reason: string }[];
  totalExperts: number;
  analysis: string;
  engine: 'ai' | 'rules';
}
export function analyzeExtractionFiles(fileIds: string[]) {
  return api.post<ExtractionFileAnalysis>('/expert-admin/extract/analyze-files', { fileIds });
}

/** 已有项目 AI 推断专业配额（仅分析不抽取，用于预填配额） */
export interface ProjectSpecialtyAnalysis {
  requiredSpecialties: { specialty: string; specialties?: string[]; companyIds?: string[]; count: number; reason: string }[];
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

export function prepRsvpLinks(projectId: string, force = false) {
  // force：强制换发（未回复行换新 token 重置 15 分钟有效期；已回复行保持原链接）
  return api.post<{ links: Record<string, string> }>(`/expert-admin/projects/${projectId}/rsvp-links`, { force });
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

/* 专家评价 */

export function createExpertEvaluation(data: {
  expertUserId: string; projectId?: string;
  attendanceGrade: string; qualityGrade: string; disciplineGrade: string; comment?: string;
  evidence?: Record<string, string>;
  /** 方案B频次闸（2026-10-21）：7 天内再次评价须填复评事由（leader/admin 免填） */
  reviewReason?: string;
}) {
  return api.post<unknown>('/expert-admin/evaluations', data);
}

/** AI 辅助评价建议（LLM 综合历史评价/偏离度/违规/负荷给出建议分数） */
export function aiSuggestEvaluation(expertUserId: string) {
  return api.post<{
    attendanceGrade: string; qualityGrade: string; disciplineGrade: string;
    analysis: string; engine: 'ai' | 'rules';
  }>('/expert-admin/evaluations/ai-suggest', { expertUserId });
}

/* 履职评价·关联项目（真实参评）与评标结果窗口 */

/** 专家真实参评项目（BidExpert 分配实数据，非虚构项目） */
export interface ExpertEvaluationProject {
  projectId: string;
  project: { id: string; name: string; stage: string; procurementMethod: string; openTime: string };
  expertRole: string; // 正选 | 候补
  invitationStatus: string;
  signedIn: boolean;
  isLead: boolean;
  progress: number;
  reportConfirmed: boolean;
  reviewGroup: string | null;
  dutyRole: string | null;
  scoreCount: number;
  memoCount: number;
  resultsGenerated: boolean;
}

export function getEvaluationProjects(expertId: string) {
  return api.get<ExpertEvaluationProject[]>(`/expert-admin/${expertId}/evaluation-projects`);
}

// 导出专家抽取情况（Word 证明材料，2026-10-22）：抽取方式细节 + 正选/候补专家详情表
export async function downloadExtractionExport(projectId: string, projectName?: string) {
  const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api'}/expert-admin/projects/${projectId}/extraction-export`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as any));
    throw new Error(e?.error || '导出失败');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `专家抽取情况_${projectName || projectId}_${new Date().toISOString().slice(0, 10)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

// 工作人员代回应/代变更专家邀请（2026-10-21 代为变更设计适配）：理由必填（≥5 字，面板展示）；
// 确认→婉拒联动通知专家本人并触发递补；婉拒→确认恢复受评标中/席位占用闸门保护
export function proxyMarkExpertInvitation(
  projectId: string,
  userId: string,
  status: 'confirmed' | 'declined',
  reason: string,
) {
  return api.post<{ success: boolean; status: string; changed: boolean; promoted: { userId: string; expertName: string } | null }>(
    `/expert-admin/invitations/${projectId}/${userId}/proxy-mark`,
    { status, reason },
  );
}

/** 关联项目评标结果窗口数据：官方结果 ∪ 该专家已评分供应商，附委员会均分对照与行为统计 */
export interface EvaluationProjectDetail {
  project: { id: string; name: string; stage: string; procurementMethod: string; openTime: string; deadline: string; evaluationDeadline: string | null };
  assignment: {
    expertName: string; major: string; expertRole: string; invitationStatus: string;
    signedIn: boolean; identityVerified: boolean; avoidanceConfirmed: boolean; confidentialityAgreed: boolean;
    disciplineAgreed: boolean; roomVerifiedAt: string | null; progress: number; totalScore: number;
    reportConfirmed: boolean; reportConfirmedAt: string | null; signStatus: string;
    dissentingOpinion: string | null; isLead: boolean; reviewGroup: string | null; dutyRole: string | null; createdAt: string;
  };
  committee: { size: number; signedIn: number; scored: number };
  resultsGenerated: boolean;
  generatedAt: string | null;
  rows: {
    supplierId: string; supplierName: string; rank: number | null;
    expertScore: number | null; committeeMean: number | null; deviation: number | null;
    officialTotal: number | null; officialAverage: number | null;
    recommended: boolean | null; disqualified: boolean | null; bidPrice: number | null;
  }[];
  scoreStats: {
    itemCount: number; supplierCount: number; meanItemDeviation: number | null; deviationSamples: number;
    extremeSupplierCount: number; editCount: number; firstScoredAt: string | null; lastScoredAt: string | null;
  };
}

export function getEvaluationProjectDetail(expertId: string, projectId: string) {
  return api.get<EvaluationProjectDetail>(`/expert-admin/${expertId}/evaluation-projects/${projectId}`);
}

/** AI 专家行为分析（该项目打分偏离/极值/修改/合规 + 历史履职；LLM 输出、规则兜底） */
export interface ExpertBehaviorAnalysis {
  engine: 'ai' | 'rules';
  riskLevel: '正常' | '关注' | '预警';
  findings: string[];
  analysis: string;
  suggestion: string;
}

export function analyzeExpertBehavior(expertId: string, projectId: string) {
  return api.post<ExpertBehaviorAnalysis>(`/expert-admin/${expertId}/behavior-analysis/${projectId}`, {});
}

/* 采购项目（抽取页选择用） */

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
  suppliers: { supplierId: string | null; supplierName: string; confirmStatus?: string; submitStatus?: string }[];
  experts: { userId: string; expertName: string; major: string }[];
}
export function getBidProjectDetail(id: string) {
  return api.get<BidProjectDetail>(`/bid/projects/${id}`);
}

/* 专家画像 */
export interface ExpertPortrait {
  userId: string; displayName: string; participationCount: number; completedCount: number;
  completionRate: number; gradeCounts: Record<string, number> | null; meanDeviation: number | null;
  deviationSamples: number; evalCount: number;
  recentLevels: string[]; isStandingExpert: boolean;
}
export function getExpertPortrait(id: string) {
  return api.get<ExpertPortrait>(`/expert-admin/${id}/portrait`);
}

/* 评价历史 */
export function getExpertEvaluations(id: string) {
  return api.get<any[]>(`/expert-admin/${id}/evaluations`);
}

/* 统计仪表盘 */
export interface ExpertStatistics {
  totalExperts: number; available: number; occupied: number; disabled: number;
  specialtyDistribution: { name: string; count: number }[];
  titleDistribution: { name: string; count: number }[];
  evaluationStats: { levelCounts: { A: number; B: number; C: number; D: number; E: number }; excellentRatio: number; total: number };
  recentEvals: { level: string; score: number; expert: string; expertUserId?: string; time: string }[];
  recentAssigns7d: number; recentExtractions30d: number;
  monthlyEvalTrend: { labels: string[]; counts: number[] };
}
export function getExpertStatistics(companyId?: string) {
  const qs = companyId && companyId !== 'all' ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<ExpertStatistics>(`/expert-admin/statistics${qs}`);
}

/* 批量操作 */
export function batchOperation(data: { action: 'enable' | 'disable'; ids: string[]; reason?: string }) {
  return api.post<{ success: boolean; count: number }>('/expert-admin/batch', data);
}

/* 导出 */
export function exportExperts(ids?: string[]) {
  const q = ids?.length ? `?ids=${ids.join(',')}` : '';
  return api.get<any[]>(`/expert-admin/export${q}`);
}

/* 违规记录 */
export function getViolations(expertId?: string) {
  const q = expertId ? `?expertId=${expertId}` : '';
  return api.get<any[]>(`/expert-admin/violations${q}`);
}
export function addViolation(expertId: string, data: { type: string; detail: string; severity: 'warning' | 'danger' }) {
  return api.post<{ success: boolean }>(`/expert-admin/${expertId}/violation`, data);
}

/* 通知偏好 */
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

/* 退库管理 */
export function getRetireCandidates() {
  return api.get<any[]>('/expert-admin/retire-candidates');
}
export function confirmRetire(id: string, reason: string) {
  return api.post<{ success: boolean }>(`/expert-admin/${id}/retire`, { reason });
}

export function ignoreRetirementWarning(id: string) {
  return api.post<{ success: boolean }>(`/expert-admin/${id}/retire-ignore`, {});
}

/* 邀请确认——原 confirm/decline 两端点已收编为 proxy-mark（2026-10-21 留痕通道），见上方 proxyMarkExpertInvitation */

/** 专家邀请全量轨迹条目（2026-10-21 用户口径：理由全量记录，非仅最后一次） */
export interface ExpertInvitationTrailItem {
  action: string; actorType: 'EXPERT' | 'STAFF' | 'SYSTEM'; actorName: string | null;
  fromStatus: string | null; toStatus: string | null; fromRole: string | null; toRole: string | null;
  reason: string | null; createdAt: string;
}

export function getProjectInvitations(projectId: string) {
  return api.get<{
    experts: { id: string; userId: string; expertName: string; major: string; isLead: boolean; expertRole: string; invitationStatus: string; reviewGroup?: string | null; dutyRole?: string | null; title?: string | null; employer?: string | null; phone?: string | null; rsvpRespondedAt?: string | null; rsvpExpiresAt?: string | null; rsvpNo?: string;
      // 邀请作答留痕（2026-10-21）：作答方/理由/自答快照 + 全量轨迹（后端 getProjectInvitations 已返回）
      invitationActorType?: 'EXPERT' | 'STAFF' | 'SYSTEM' | null; invitationActorName?: string | null; invitationReason?: string | null;
      expertRespondedAt?: string | null; expertStatus?: 'confirmed' | 'declined' | null;
      invitationTrail?: ExpertInvitationTrailItem[]; }[];
    summary: { total: number; confirmed: number; declined: number; pending: number; availableCandidates: number; allDeclined: boolean };
  }>(`/expert-admin/invitations/${projectId}`);
}

/** A-132：评委职责分工（partial 语义——缺键=不动，null=显式清除，空串由调用方转为缺键） */
export function setCommitteeAssignment(projectId: string, data: { assignments: { userId: string; reviewGroup?: string | null; dutyRole?: string | null }[] }) {
  return api.put<{ success: boolean }>(`/expert-admin/projects/${projectId}/committee/assignment`, data);
}

/* AI 采纳率 */
export function getAiAdoptionRate(expertId?: string) {
  return api.get<any>(`/expert-admin/ai-adoption${expertId ? `?expertId=${expertId}` : ''}`);
}
export function getExpertRanking(period: 'month' | 'quarter' | 'all' = 'month') {
  return api.get<any[]>(`/expert-admin/ranking?period=${period}`);
}
export function getLoadDistribution() {
  return api.get<any>('/expert-admin/load-distribution');
}

/* 批量导入 */
export function importCsv(rows: Array<Record<string, string>>) {
  return api.post<any>('/expert-admin/import-csv', { rows });
}

/* AI 深化：OCR 录入 / 风险预警 / 抽取复盘 */
export function ocrIntake(data: { imageBase64: string; mimeType?: string; filename?: string }) {
  return api.post<{ rawText: string; fields: Record<string, string> }>('/expert-admin/ocr-intake', data);
}

export interface ExpertRiskBrief {
  expertId: string;
  displayName: string;
  signals: {
    meanDeviation: number | null;
    deviationRisk: 'high' | 'medium' | 'low';
    recentECount: number;
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

/* 操作历史（审计，只读） */

export interface ExpertOperationHistoryItem {
  id: string;
  action: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; displayName: string; username: string } | null;
}

export function getExpertOperationHistory(params?: { expertId?: string; action?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
  const q = new URLSearchParams();
  if (params?.expertId) q.set('expertId', params.expertId);
  if (params?.action) q.set('action', params.action);
  if (params?.startDate) q.set('startDate', params.startDate);
  if (params?.endDate) q.set('endDate', params.endDate);
  if (params?.page) q.set('page', String(params.page ?? 1));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize ?? 20));
  const qs = q.toString();
  return api.get<{ total: number; page: number; pageSize: number; items: ExpertOperationHistoryItem[] }>(`/expert-admin/operation-history${qs ? '?' + qs : ''}`);
}

/** PII 明文揭示（等保+密评）：列表/详情默认掩码，明文走此处；后端写 SensitiveAccessLog 审计 */
export function revealExpertField(userId: string, field: 'idNumber' | 'phone' | 'licenseNo' | 'email') {
  return api.post<{ field: string; value: string | null }>(`/expert-admin/${userId}/reveal`, { field });
}
