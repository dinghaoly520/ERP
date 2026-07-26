import { api } from '../api';
import type { Supplier, SupplierListResponse, SupplierClassification, SupplierEvaluation, SupplierChangeRecord, SupplierQualification } from '../types';

/* ── 供应商智能选取（web 门户专属视图模型）── */
export interface SupplierStats {
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  blacklist: number;
  returned: number;
}

export interface SupplierRecommendation {
  supplierId: string;
  name: string;
  classification?: string;
  matchScore: number;
  reason: string;
  legalPerson?: string;
  enterpriseType?: string;
  contacts?: { name: string; phone: string; isPrimary: boolean }[];
  evaluation?: { level: string; count: number };
  activeProjects: number;
}

export interface SupplierSelectionResult {
  requirement: string;
  engine: 'deepseek' | 'rules';
  model: string;
  candidatePool: number;
  summary: string;
  recommendations: SupplierRecommendation[];
  generatedAt: string;
}

// 供应商列表
export function getSupplierList(params?: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number; sort?: 'completeness' | 'createdAt'; enterpriseTypes?: string; dateFrom?: string; dateTo?: string; evalLevel?: string; qualificationStatus?: string }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.classificationId) query.set('classificationId', params.classificationId);
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.sort) query.set('sort', params.sort);
  if (params?.enterpriseTypes) query.set('enterpriseTypes', params.enterpriseTypes);
  if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params?.dateTo) query.set('dateTo', params.dateTo);
  if (params?.evalLevel) query.set('evalLevel', params.evalLevel);
  if (params?.qualificationStatus) query.set('qualificationStatus', params.qualificationStatus);
  return api.get<SupplierListResponse>(`/supplier/list?${query.toString()}`);
}

/* ── 临时供应商邀请码（采购端生成，有效期 30/180/360 天）── */
export interface SupplierInvitation {
  id: string;
  code: string;
  validityDays: number;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
  note?: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  createdBy?: { id: string; displayName: string };
  usedBy?: { id: string; name: string } | null;
}
export interface InvitationListResponse { items: SupplierInvitation[]; total: number; page: number; pageSize: number; }

export function listInvitations(params?: { page?: number; pageSize?: number; status?: string }) {
  const q = new URLSearchParams();
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  if (params?.status) q.set('status', params.status);
  return api.get<InvitationListResponse>(`/supplier/invitations?${q.toString()}`);
}
export function createInvitation(data: { validityDays: number; note?: string; boundCreditCode?: string }) {
  return api.post<SupplierInvitation>('/supplier/invitations', data);
}
export function revokeInvitation(id: string) {
  return api.post<SupplierInvitation>(`/supplier/invitations/${id}/revoke`, {});
}

// 供应商统计（总数 / 待审核 / 已入库 / 停用 / 黑名单）
export function getSupplierStats() {
  return api.get<SupplierStats>('/supplier/stats');
}

// AI 智能推荐供应商（按采购需求）
export function recommendSuppliers(data: { requirement: string; classificationId?: string; maxCount?: number }) {
  return api.post<SupplierSelectionResult>('/ai/supplier-selection', data);
}

// AI 润色采购需求描述
export function polishRequirement(data: { text: string; projectName?: string; procurementMethod?: string; deadline?: string; additionalContext?: string }) {
  return api.post<{ polished: string }>('/ai/polish-requirement', data);
}

// ── AI 生成通知文案 ──
export function generateNotificationContent(data: {
  projectName?: string; projectCode?: string; supplierNames: string[];
  procurementMethod?: string; procurementCategory?: string;
  budgetAmount?: string; requesterDepartment?: string;
  projectReason?: string; fileAnalysisContext?: string;
}) {
  return api.post<{ title: string; body: string }>('/ai/generate-notification', data);
}

// ── 选取历史 ──
export interface SupplierSelectionHistoryRecord {
  id: string;
  requirement: string;
  classificationId?: string;
  classificationName?: string;
  resultSummary: string;
  recommendationCount: number;
  candidatePool: number;
  shortlistedIds: string[];
  createdAt: string;
}

export function getSelectionHistory() {
  return api.get<SupplierSelectionHistoryRecord[]>('/ai/selection-history');
}

export function getSelectionHistoryDetail(id: string) {
  return api.get<SupplierSelectionHistoryRecord>(`/ai/selection-history/${id}`);
}

export function restoreShortlist(historyId: string) {
  return api.get<SupplierRecommendation[]>(`/ai/selection-history/${historyId}/shortlist`);
}

export function updateSelectionShortlist(historyId: string, shortlistedIds: string[]) {
  return api.patch<null>(`/ai/selection-history/${historyId}/shortlist`, { shortlistedIds });
}

export function deleteSelectionHistory(id: string) {
  return api.delete<null>(`/ai/selection-history/${id}`);
}

// ── 通知供应商 ──
export interface NotifySuppliersResult {
  totalTargets: number; sent: number; notFound: number;
  results: { supplierId: string; supplierName: string; channels: Record<string, string> }[];
}
export function notifySuppliers(data: { supplierIds: string[]; channels: string[]; type: string; title: string; content: string }) {
  return api.post<NotifySuppliersResult>('/supplier/notify', data);
}

// ── 邀请供应商到招标项目 ──
export function inviteSuppliers(projectId: string, supplierIds: string[]) {
  return api.post<{ added: number; skipped: number }>(`/bid/projects/${projectId}/suppliers`, { supplierIds });
}

// ── 分享候选名单 ──
export function shareShortlist(data: { requirement: string; shortlist: { name: string; matchScore: number; reason: string }[]; note?: string }) {
  return api.post<{ success: boolean }>('/ai/share-shortlist', data);
}

// 供应商详情
export function getSupplier(id: string) {
  return api.get<Supplier>(`/supplier/${id}`);
}

// 审核通过
export function approveSupplier(id: string) {
  return api.post<{ success: boolean }>(`/supplier/${id}/approve`, {});
}

// 审核不通过
export function rejectSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/reject`, { reason });
}

// 退回补正
export function returnSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/return`, { reason });
}

// 更新状态
export function updateSupplierStatus(id: string, status: 'DISABLED' | 'BLACKLIST', reason: string) {
  return api.patch<Supplier>(`/supplier/${id}/status?status=${status}`, { reason });
}

// 变更记录列表
export function getSupplierChanges(id: string) {
  return api.get<SupplierChangeRecord[]>(`/supplier/${id}/changes`);
}

// 审核变更
export function approveChange(changeId: string) {
  return api.post<{ success: boolean }>(`/supplier/changes/${changeId}/approve`, {});
}

// 拒绝变更
export function rejectChange(changeId: string, rejectReason: string) {
  return api.post<SupplierChangeRecord>(`/supplier/changes/${changeId}/reject`, { rejectReason });
}

// 资质材料列表
export function getQualifications(id: string) {
  return api.get<SupplierQualification[]>(`/supplier/${id}/qualifications`);
}

// 评价记录列表
export function getSupplierEvaluations(id: string) {
  return api.get<SupplierEvaluation[]>(`/supplier/${id}/evaluations`);
}

// 发起评价
export function createEvaluation(id: string, data: {
  projectId?: string;
  completenessGrade: string;
  responsivenessGrade: string;
  cooperationGrade: string;
  complianceGrade: string;
  comprehensiveGrade: string;
  comment?: string;
  evidence?: Record<string, string>;
}) {
  return api.post<SupplierEvaluation>(`/supplier/${id}/evaluations`, data);
}

// 评价统计
export function getEvaluationStats() {
  return api.get<{ levelCounts: { A: number; B: number; C: number; D: number; E: number }; excellentRatio: number; total: number }>('/supplier/evaluations/stats');
}

// 分类列表
export function getClassifications() {
  return api.get<SupplierClassification[]>('/supplier/classifications');
}

// 创建分类
export function createClassification(data: { name: string; code: string; description?: string }) {
  return api.post<SupplierClassification>('/supplier/classifications', data);
}

// 更新分类
export function updateClassification(id: string, data: { name?: string; code?: string; description?: string }) {
  return api.patch<SupplierClassification>(`/supplier/classifications/${id}`, data);
}

// 删除分类
export function deleteClassification(id: string) {
  return api.delete<SupplierClassification>(`/supplier/classifications/${id}`);
}

// ── 供应商画像 ──
export interface SupplierPortrait {
  supplierId: string; name: string;
  participationCount: number; winCount: number; winRate: number;
  gradeCounts: Record<string, number>; evalCount: number;
  performanceTrend: 'improving' | 'stable' | 'declining';
  levelCounts: { A: number; B: number; C: number; D: number; E: number };
  priceDeviation: number | null;
}
export function getSupplierPortrait(id: string) {
  return api.get<SupplierPortrait>(`/supplier/${id}/portrait`);
}

// ── 生命周期时间线 ──
export interface TimelineEvent { type: string; label: string; detail: string; at: string; }
export interface SupplierTimeline { supplierId: string; supplierName: string; events: TimelineEvent[]; }
export function getSupplierTimeline(id: string) {
  return api.get<SupplierTimeline>(`/supplier/${id}/timeline`);
}

// ── 资质预警 ──
export interface QualificationAlertItem {
  id: string; supplierId: string; supplierName: string;
  type: string; name: string; validTo: string | null; status: string; daysRemaining: number | null;
  acked: boolean; // 当前用户是否已标记「已处理」（后端持久化）
}
export interface QualificationAlerts {
  items: QualificationAlertItem[];
  expiredCount: number; expiringCount: number; affectedSupplierCount: number;
}
export function getQualificationAlerts() {
  return api.get<QualificationAlerts>('/supplier/qualification-alerts');
}
export function acknowledgeQualificationAlert(qualificationId: string) {
  return api.post<{ success: boolean }>(`/supplier/qualification-alerts/${qualificationId}/ack`);
}

// ── 淘汰候选 ──
export interface EliminationCandidate { supplierId: string; name: string; reason: string; }
export function getEliminationCandidates() {
  return api.get<EliminationCandidate[]>('/supplier/eliminate-candidates');
}
export function confirmEliminate(id: string, reason: string) {
  return api.post<{ success: boolean }>(`/supplier/${id}/eliminate`, { reason });
}

// ── 多分类标签管理 ──
export interface SupplierClassificationLink {
  supplierId: string; classificationId: string;
  classification: SupplierClassification;
  assignedAt: string;
}
export function getSupplierClassifications(supplierId: string) {
  return api.get<SupplierClassificationLink[]>(`/supplier/${supplierId}/classifications`);
}
export function setSupplierClassifications(supplierId: string, classificationIds: string[]) {
  return api.put<SupplierClassificationLink[]>(`/supplier/${supplierId}/classifications`, { classificationIds });
}

// ── 收藏 ──
export function toggleFavorite(supplierId: string) {
  return api.post<{ favorited: boolean }>(`/supplier/${supplierId}/favorite`, {});
}
export interface SupplierFavoriteRecord { id: string; supplierId: string; createdAt: string; supplier: { id: string; name: string; enterpriseType: string; classification?: { name: string }; createdAt: string }; }
export function getFavorites() {
  return api.get<SupplierFavoriteRecord[]>('/supplier/favorites/list');
}

// ── 近期动态 ──
export interface ActivityItem { id: string; action: string; resourceId: string; details: any; actorName: string; at: string; }
export function getRecentActivities(limit?: number) {
  return api.get<ActivityItem[]>(`/supplier/recent-activities?limit=${limit ?? 15}`);
}

// ── AI 供应商综合画像分析 ──
export interface PortraitInsight { label: string; value: string; interpretation: string; tone: string; icon: string; }
export interface SupplierPortraitAnalysis {
  supplierId: string; supplierName: string; analyzedAt: string;
  overview: string; strengths: string[]; risks: string[]; suggestions: string[];
  metrics: PortraitInsight[]; historySummary: string; suitableFor: string[];
}
export function getSupplierPortraitAnalysis(supplierId: string) {
  return api.post<SupplierPortraitAnalysis>('/ai/supplier-portrait-analysis', { supplierId });
}

// ── AI 评价维度分析 ──
export interface DimensionAnalysis {
  dimension: string; suggestedGrade: string;
  rationale: string; evidencePoints: string[];
}
export interface EvaluationAnalysisResult {
  supplierId: string; supplierName: string; analyzedAt: string;
  dimensions: DimensionAnalysis[]; overallGrade: string; summary: string;
}
export function getSupplierEvaluationAnalysis(supplierId: string) {
  return api.post<EvaluationAnalysisResult>('/ai/supplier-evaluation-analysis', { supplierId });
}

// ── 评价维度统计（等级分布）──
export interface DimensionStats { completeness: Record<string, number>; responsiveness: Record<string, number>; cooperation: Record<string, number>; compliance: Record<string, number>; comprehensive: Record<string, number>; total: number; }
export function getEvaluationDimensionStats() {
  return api.get<DimensionStats>('/supplier/evaluations/dimension-stats');
}

// ── 企业类型分布（看板后端聚合，P0-14）──
export function getEnterpriseTypeDistribution() {
  return api.get<{ counts: Record<string, number> }>('/supplier/enterprise-type-distribution');
}

// ── 沟通记录 ──
export interface CommunicationRecord { id: string; type: string; title: string; content: string; isRead: boolean; channels: string[]; createdAt: string; }
export function getSupplierCommunications(id: string) {
  return api.get<CommunicationRecord[]>(`/supplier/${id}/communications`);
}

// ── 文件档案 ──
export interface SupplierDocumentRecord { id: string; type: string; name: string; fileUrl: string; fileSize?: number; note?: string; uploader: { displayName: string }; createdAt: string; }
export function getSupplierDocuments(id: string) {
  return api.get<SupplierDocumentRecord[]>(`/supplier/${id}/documents`);
}
/** 上传文件到 MinIO，返回真实可访问 url —— 供详情文件档案使用，杜绝 fileUrl:'#' 假记录。
 *  分类须在后端 ALLOWED_CATEGORIES 白名单内（upload.service.ts），故用 'general' 而非自造值。 */
export function uploadSupplierFile(file: File): Promise<{ url: string; originalName: string; size: number }> {
  const fd = new FormData();
  fd.append('file', file);
  return api.postForm<{ id: string; url: string; originalName: string; size: number }>('/upload?category=general', fd);
}
export function uploadSupplierDocument(id: string, data: { type: string; name: string; fileUrl: string; fileSize?: number; note?: string }) {
  return api.post<SupplierDocumentRecord>(`/supplier/${id}/documents`, data);
}
export function deleteSupplierDocument(id: string, docId: string) {
  return api.delete<null>(`/supplier/${id}/documents/${docId}`);
}

// ── 全局搜索 ──
export interface SearchResult { type: string; id: string; title: string; subtitle: string; link: string; }
export function globalSearch(q: string) {
  return api.get<{ results: SearchResult[]; total: number }>(`/search?q=${encodeURIComponent(q)}`);
}

