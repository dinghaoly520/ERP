import { api } from '../api';
import type { Supplier, SupplierListResponse, SupplierClassification, SupplierEvaluation, SupplierChangeRecord, SupplierQualification } from '../types';

/** 公司视野 query 段（admin 选择器值：'all'/空=全部，缺省 ''；多选逗号列表 encodeURIComponent） */
function companyQuery(companyId?: string): string {
  if (!companyId || companyId === 'all') return '';
  return `?companyId=${encodeURIComponent(companyId)}`;
}

/* 供应商智能选取（web 门户专属视图模型） */
export interface SupplierStats {
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  blacklist: number;
  returned: number;
  temporaryApproved: number;
}

export interface SupplierRecommendation {
  supplierId: string;
  name: string;
  classification?: string;
  matchScore: number;
  reason: string;
  legalPerson?: string;
  enterpriseType?: string;
  tags?: string[];
  contacts?: { name: string; phone: string; isPrimary: boolean }[];
  evaluation?: { level: string; count: number };
  activeProjects: number;
  // 对比面板扩充
  supplierNo?: string;
  businessScope?: string;
  qualifications?: string[];
  registeredCapital?: string;
  region?: string;
  industry?: string;
  registeredAddress?: string;
}

/** 对比面板库内实时资料（POST /supplier/compare-profiles，2026-09-09）：
 *  对比数据以供应商库为准——不再依赖推荐负载快照（旧会话恢复的推荐无扩充字段）。 */
export interface SupplierCompareProfile {
  supplierId: string;
  name: string;
  supplierNo?: string;
  classification?: string;
  enterpriseType?: string;
  legalPerson?: string;
  registeredCapital?: string;
  region?: string;
  industry?: string;
  businessScope?: string;
  registeredAddress?: string;
  tags?: string[];
  qualifications?: { name: string; type?: string; status?: string; validTo?: string }[];
  contacts?: { name: string; phone: string; isPrimary: boolean }[];
  evaluation?: { level: string; count: number };
  activeProjects: number;
}

export function fetchSupplierCompareProfiles(ids: string[]): Promise<Record<string, SupplierCompareProfile>> {
  return api.post('/supplier/compare-profiles', { ids: [...new Set(ids)].slice(0, 12) });
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
export function getSupplierList(params?: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number; sort?: 'completeness' | 'createdAt'; enterpriseTypes?: string; dateFrom?: string; dateTo?: string; evalLevel?: string; qualificationStatus?: string; isTemporary?: boolean; reviewStage?: string; companyId?: string }) {
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
  if (params?.isTemporary) query.set('isTemporary', 'true');
  if (params?.reviewStage) query.set('reviewStage', params.reviewStage); // 三级审批当前级（2026-09-30）
  if (params?.companyId && params.companyId !== 'all') query.set('companyId', params.companyId);
  return api.get<SupplierListResponse>(`/supplier/list?${query.toString()}`);
}

/** 按公司分组全量计数（admin 全部公司视图的分组标题全量口径；与列表同筛选） */
export function fetchSupplierCompanyCounts(params?: { status?: string; search?: string; enterpriseTypes?: string; isTemporary?: boolean }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  if (params?.enterpriseTypes) query.set('enterpriseTypes', params.enterpriseTypes);
  if (params?.isTemporary) query.set('isTemporary', 'true');
  return api.get<Array<{ name: string; count: number }>>(`/supplier/company-counts?${query.toString()}`);
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
export function getSupplierStats(companyId?: string) {
  return api.get<SupplierStats>(`/supplier/stats${companyId && companyId !== 'all' ? '?companyId=' + companyId : ''}`);
}

// AI 智能推荐供应商（按采购需求 + 项目上下文；候选池公司隔离——companyId=项目归属公司，非 admin 由后端强制本人公司）
export function recommendSuppliers(data: { requirement: string; classificationId?: string; tags?: string[]; maxCount?: number; excludedSupplierIds?: string[]; projectContext?: Record<string, string>; companyId?: string }) {
  return api.post<SupplierSelectionResult>('/ai/supplier-selection', data);
}

// AI 按项目上下文从词表预选业务标签（供应商选取页预填；用户可删减补充）
export function suggestBusinessTags(data: {
  projectName?: string;
  projectCode?: string;
  procurementMethod?: string;
  stage?: string;
  requirement?: string;
  fileSummary?: string;
  vocabulary: string[];
}) {
  return api.post<{ tags: string[] }>('/ai/suggest-tags', data);
}

// AI 润色采购需求描述
export function polishRequirement(data: { text: string; projectName?: string; procurementMethod?: string; deadline?: string; additionalContext?: string }) {
  return api.post<{ polished: string }>('/ai/polish-requirement', data);
}

// AI 生成通知文案（含逐家无登录回执链接 RSVP）
export function generateNotificationContent(data: {
  projectName?: string; projectCode?: string; supplierNames: string[];
  supplierIds?: string[]; projectId?: string | null; deadline?: string;
  procurementMethod?: string; procurementCategory?: string;
  budgetAmount?: string; requesterDepartment?: string; requesterName?: string;
  projectReason?: string; supplierRequirements?: string; projectOverview?: string;
  fileAnalysisContext?: string; validityDays?: number;
}) {
  return api.post<{ title: string; body: string; rsvpTokens: Record<string, string>; invitationId: string | null }>('/ai/generate-notification', data);
}

// 选取历史
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

export function restoreShortlist(historyId: string) {
  return api.get<SupplierRecommendation[]>(`/ai/selection-history/${historyId}/shortlist`);
}

export function updateSelectionShortlist(historyId: string, shortlistedIds: string[]) {
  return api.patch<null>(`/ai/selection-history/${historyId}/shortlist`, { shortlistedIds });
}

export function deleteSelectionHistory(id: string) {
  return api.delete<null>(`/ai/selection-history/${id}`);
}

// 通知供应商
export interface NotifySuppliersResult {
  totalTargets: number; sent: number; notFound: number;
  results: { supplierId: string; supplierName: string; channels: Record<string, string> }[];
}
export function notifySuppliers(data: { supplierIds: string[]; channels: string[]; type: string; title: string; content: string; link?: string }) {
  return api.post<NotifySuppliersResult>('/supplier/notify', data);
}

// 谈判采购配置下发（附件步骤确认后，后台推送给供应商端）
export interface NegotiationConfigPayload {
  projectId: string;
  supplierIds: string[];
  acquireStartTime: string;
  acquireEndTime: string;
  bidOpeningTime: string;
  refFileKeys: string[];
  attachFileIds: string[];
  downloadMode: 'free' | 'encrypted' | 'paid';
  downloadPassword?: string;
  paidAmount?: string;
}
export function sendNegotiationConfig(data: NegotiationConfigPayload) {
  return api.post<{ delivered: number }>('/supplier/negotiation-config', data);
}

// 工作人员代回应/代变更（2026-10-21 回执锁定口径）：理由必填（≥5 字，界面展示）；
// 确认→拒绝联动通知供应商本人并计入其邀请回执经历
export function markRsvpManual(projectId: string, supplierId: string, status: 'ACCEPTED' | 'DECLINED', reason: string) {
  return api.post<{ id: string; status: string; changed: boolean }>('/supplier/rsvp/manual-mark', { projectId, supplierId, status, reason });
}

// 邀请通知发送打戳（2026-10-20 用户口径）：一键通知点击时刻落 InvitationRsvp.notifiedAt，
// 项目详情时间轴「供应商邀请」以此为准（仅补空不覆盖，多轮补选不撼动首轮时刻）
export function markInvitedNotified(projectId: string, supplierIds: string[]) {
  return api.post<{ stamped: number }>('/supplier/rsvp/mark-notified', { projectId, supplierIds });
}

// 邀请回执看板（采购端）——respondentType 区分 供应商自答 / 工作人员代回应 / 超时自动弃权
export interface RsvpTrailItem {
  action: string; actorType: 'SUPPLIER' | 'STAFF' | 'SYSTEM'; actorName: string | null;
  fromStatus: string | null; toStatus: string | null; reason: string | null; note: string | null; createdAt: string;
}
export interface RsvpListItem {
  rsvpNo: string; supplierId: string; supplierName: string; status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  tags?: string[]; note: string | null; respondedAt: string | null; notifiedAt?: string | null; expired: boolean;
  respondentType?: 'SUPPLIER' | 'STAFF' | 'SYSTEM' | null; respondedByName?: string | null; staffReason?: string | null;
  /** 供应商自答快照（2026-10-21 用户口径：代变更不覆盖原回执，两个时刻一并展示） */
  supplierRespondedAt?: string | null; supplierStatus?: 'ACCEPTED' | 'DECLINED' | null;
  trail?: RsvpTrailItem[];
}
export interface RsvpListResult { total: number; counts: { ACCEPTED: number; DECLINED: number; PENDING: number }; items: RsvpListItem[]; }
export function getRsvpList(params: { projectId?: string; invitationId?: string }) {
  const q = new URLSearchParams();
  if (params.projectId) q.set('projectId', params.projectId);
  if (params.invitationId) q.set('invitationId', params.invitationId);
  return api.get<RsvpListResult>(`/supplier/rsvp/list?${q.toString()}`);
}

// 供应商邀请回执经历（供应商详情「邀请回执」tab）：全量回执 + 轨迹 + 信用统计
export interface RsvpHistoryItem {
  rsvpNo: string; title: string; projectId: string | null; status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  note: string | null; staffReason: string | null;
  respondentType: 'SUPPLIER' | 'STAFF' | 'SYSTEM' | null; respondedByName: string | null;
  respondedAt: string | null; supplierRespondedAt?: string | null; supplierStatus?: 'ACCEPTED' | 'DECLINED' | null;
  notifiedAt: string | null; createdAt: string; trail: RsvpTrailItem[];
}
export interface RsvpBreachEvent {
  rsvpNo: string; title: string; at: string; reason: string | null; actorName: string | null;
}
export interface RsvpHistoryResult {
  supplierId: string;
  stats: {
    invited: number; accepted: number; declined: number; pending: number; acceptRate: string | null;
    systemDeclined: number; respondedByStaff: number; overrideAfterAccept: number;
    /** 当前连续拒绝段（2026-10-21 预警口径：≥3 触发，任一确认即重置） */
    consecutiveDeclined?: number;
  };
  /** 毁约事件（2026-10-21 用户口径：确认参加后被改为拒绝，逐条记录在供应商信息中） */
  breachEvents?: RsvpBreachEvent[];
  items: RsvpHistoryItem[];
}
export function getRsvpHistory(supplierId: string) {
  return api.get<RsvpHistoryResult>(`/supplier/rsvp/history?supplierId=${encodeURIComponent(supplierId)}`);
}

// 供应商详情
export function getSupplier(id: string) {
  return api.get<Supplier>(`/supplier/${id}`);
}

// 审核通过（三级审批 2026-09-29：staff/leader 级同意缘由必填，admin 终审可选）
export function approveSupplier(id: string, reason?: string, attachmentIds?: string[]) {
  return api.post<{ success: boolean; stage?: string }>(`/supplier/${id}/approve`, { reason, attachmentIds });
}

// 审核不通过
export function rejectSupplier(id: string, reason: string, attachmentIds?: string[]) {
  return api.post<Supplier>(`/supplier/${id}/reject`, { reason, attachmentIds });
}

// 退回补正
export function returnSupplier(id: string, reason: string, attachmentIds?: string[]) {
  return api.post<Supplier>(`/supplier/${id}/return`, { reason, attachmentIds });
}

// 更新状态
export function updateSupplierStatus(id: string, status: 'DISABLED' | 'BLACKLIST', reason: string) {
  return api.patch<Supplier>(`/supplier/${id}/status?status=${status}`, { reason });
}

// CTS A-213/215/216 投标人信息资源库

/** A-215 拉黑（带校验闸与供应商通知，区别于通用状态更新） */
export function blacklistSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/blacklist`, { reason });
}

/** A-215 解除黑名单（恢复入库） */
export function unblacklistSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/unblacklist`, { reason });
}

/** 恢复/解禁供应商（DISABLED/BLACKLIST → APPROVED；黑名单解禁须填理由，后端校验）。
 *  此前前端零接线——停用/黑名单后无任何恢复入口，形成断头路（2026-09-28 审计 S2）。 */
export function restoreSupplier(id: string, reason?: string) {
  return api.post<Supplier>(`/supplier/${id}/restore`, { reason });
}

/** 复活被拒绝的供应商（REJECTED → PENDING 重新进审，仅 admin——后端 @Roles('admin')） */
export function reactivateSupplier(id: string) {
  return api.post<Supplier>(`/supplier/${id}/reactivate`, {});
}

export type SupplierRewardPunishment = {
  id: string;
  projectName: string;
  recordType: 'reward' | 'punishment' | 'performance';
  recordNote: string | null;
  effectiveDate: string | null;
  clientName: string | null;
  createdAt: string;
};

/** A-213 录入奖惩记录 */
export function addSupplierRecord(
  id: string,
  body: { recordType: 'reward' | 'punishment'; projectName: string; recordNote: string; effectiveDate?: string; clientName?: string },
) {
  return api.post<SupplierRewardPunishment>(`/supplier/${id}/records`, body);
}

/** A-213 奖惩记录列表 */
export function listSupplierRecords(id: string, recordType?: 'reward' | 'punishment') {
  return api.get<SupplierRewardPunishment[]>(`/supplier/${id}/records${recordType ? `?recordType=${recordType}` : ''}`);
}

/** A-216 标注联系人人员类别/执业证书 */
export function updateContactPersonnel(contactId: string, body: { personnelType?: string; certTitle?: string }) {
  return api.patch(`/supplier/contacts/${contactId}/personnel`, body);
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

// 评价记录列表（关联项目附项目名）
export function getSupplierEvaluations(id: string) {
  return api.get<SupplierEvaluation[]>(`/supplier/${id}/evaluations`);
}

// 供应商真实参评项目（BidSupplier 实数据 + 评标结果对照；评价「关联项目」下拉数据源）
export interface SupplierEvaluationProject {
  projectId: string;
  project: { id: string; name: string; stage: string; procurementMethod: string; openTime: string; deadline: string };
  downloadStatus: string;
  submitStatus: string;
  decryptStatus: string;
  confirmStatus: string;
  result: { rank: number; recommended: boolean; disqualified: boolean; bidPrice: number | null; generatedAt: string } | null;
}

export function getSupplierEvaluationProjects(id: string) {
  return api.get<SupplierEvaluationProject[]>(`/supplier/${id}/evaluation-projects`);
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

// 评价统计（公司隔离：admin companyId 切公司，非 admin 后端强制本公司）
export function getEvaluationStats(companyId?: string) {
  return api.get<{ levelCounts: { A: number; B: number; C: number; D: number; E: number }; excellentRatio: number; total: number }>(`/supplier/evaluations/stats${companyQuery(companyId)}`);
}

// 分类列表（计数按公司视野）
export function getClassifications(companyId?: string) {
  return api.get<SupplierClassification[]>(`/supplier/classifications${companyQuery(companyId)}`);
}

// 业务标签词表（按频次降序；供选取/邀请页标签多选）
export interface TagVocabularyItem { tag: string; count: number; }
export function getTagVocabulary(limit = 60) {
  return api.get<{ items: TagVocabularyItem[]; totalDistinct: number }>(`/supplier/tag-vocabulary?limit=${limit}`);
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

// 供应商画像
// 生命周期时间线
export interface TimelineEvent { type: string; label: string; detail: string; at: string; }
export interface SupplierTimeline { supplierId: string; supplierName: string; events: TimelineEvent[]; }
export function getSupplierTimeline(id: string) {
  return api.get<SupplierTimeline>(`/supplier/${id}/timeline`);
}

// 审核历史（不可变留痕）
/** 快照内文件链接（资质 fileUrl 之外的附加材料 / 业绩证明材料） */
export interface SnapshotFileLink { name: string; url: string; }
export interface ApprovalSnapshot {
  name: string; creditCode: string | null; supplierNo: string; enterpriseType: string;
  legalPerson: string; legalPersonIdCard: string | null; registeredAddress: string; businessScope: string;
  tags: string[]; isTemporary: boolean;
  account: { username: string; displayName: string; email: string | null } | null;
  contacts: { name: string; gender?: string | null; phone: string; idCard: string | null; email: string | null; position: string | null; isPrimary: boolean }[];
  qualifications: { type: string; name: string; fileUrl?: string; attachments?: SnapshotFileLink[] | null; validFrom: string | null; validTo: string | null }[];
  /* 注册 2.0 新增字段（旧快照无以下字段，展示侧须优雅降级） */
  legalPersonPhone?: string | null;
  detailedAddress?: string | null;
  logoUrl?: string | null;
  organizationCode?: string | null;
  country?: string | null;
  region?: string | null;
  registeredCapital?: string | null;
  industry?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  bankAccounts?: { id: string; accountName: string; bankName: string; bankBranch?: string | null; accountNo: string; isDefault: boolean }[];
  performances?: { id: string; projectName: string; clientName?: string | null; contractAmount?: string | null; signDate?: string | null; description?: string | null; proofFiles?: SnapshotFileLink[] | null }[];
}
export interface ApprovalRecord {
  id: string; action: 'APPROVED' | 'REJECTED' | 'RETURNED';
  /** 三级审批发生级（2026-09-29）：STAFF/LEADER/ADMIN；null=旧数据 */
  stage?: string | null;
  /** 意见附件（2026-09-30）：FileAsset id 集合 */
  attachmentIds?: string[];
  reason: string | null; snapshot: ApprovalSnapshot; createdAt: string;
  /** 审批人角色（2026-10-08 A 方案）：LEADER 级=admin → 代复审、STAFF 级=leader → 代初审 徽标依据 */
  reviewer: { id: string; displayName: string; username: string; role?: string } | null;
}
export function getApprovalHistory(id: string) {
  return api.get<ApprovalRecord[]>(`/supplier/${id}/approval-history`);
}

/** 全量审批记录（admin only，2026-09-30）：跨供应商全流程（三级通过+驳回+退回补正） */
export interface AllApprovalRecord {
  id: string;
  action: 'APPROVED' | 'REJECTED' | 'RETURNED';
  stage?: string | null;
  reason?: string | null;
  attachmentIds?: string[];
  createdAt: string;
  reviewer: { id: string; displayName: string; username: string; role: string } | null;
  supplier: { id: string; name: string; creditCode: string | null; status: string; reviewStage: string | null; companyName: string | null };
}
export function listAllApprovalRecords() {
  return api.get<AllApprovalRecord[]>('/supplier/approval-records/all');
}

// 资质预警
export interface QualificationAlertItem {
  id: string; supplierId: string; supplierName: string;
  type: string; name: string; validTo: string | null; status: string; daysRemaining: number | null;
}
export interface QualificationAlerts {
  items: QualificationAlertItem[];
  expiredCount: number; expiringCount: number; affectedSupplierCount: number;
}
export function getQualificationAlerts(companyId?: string) {
  return api.get<QualificationAlerts>(`/supplier/qualification-alerts${companyQuery(companyId)}`);
}
export function notifyQualificationAlert(qualificationId: string) {
  return api.post<{ success: boolean }>(`/supplier/qualification-alerts/${qualificationId}/notify`, {});
}

// 淘汰候选（按公司视野）
export interface EliminationCandidate { supplierId: string; name: string; reason: string; }
export function getEliminationCandidates(companyId?: string) {
  return api.get<EliminationCandidate[]>(`/supplier/eliminate-candidates${companyQuery(companyId)}`);
}
export function confirmEliminate(id: string, reason: string) {
  return api.post<{ success: boolean }>(`/supplier/${id}/eliminate`, { reason });
}

// 多分类标签管理
export interface SupplierClassificationLink {
  supplierId: string; classificationId: string;
  classification: SupplierClassification;
  assignedAt: string;
}
export function setSupplierClassifications(supplierId: string, classificationIds: string[]) {
  return api.put<SupplierClassificationLink[]>(`/supplier/${supplierId}/classifications`, { classificationIds });
}

/** 管理员直接修改供应商业务标签（2-8 个，不走审批） */
export function updateSupplierTags(supplierId: string, tags: string[]) {
  return api.patch<{ tags: string[] }>(`/supplier/${supplierId}/tags`, { tags });
}

// 收藏
export function toggleFavorite(supplierId: string) {
  return api.post<{ favorited: boolean }>(`/supplier/${supplierId}/favorite`, {});
}
export interface SupplierFavoriteRecord { id: string; supplierId: string; createdAt: string; supplier: { id: string; name: string; enterpriseType: string; classification?: { name: string }; createdAt: string }; }
export function getFavorites(companyId?: string) {
  return api.get<SupplierFavoriteRecord[]>(`/supplier/favorites/list${companyQuery(companyId)}`);
}

// 近期动态（按公司视野，跨公司供应商不外泄）
export interface ActivityItem { id: string; action: string; resourceId: string; details: any; actorName: string; at: string; }
export function getRecentActivities(limit?: number, companyId?: string) {
  const q = new URLSearchParams({ limit: String(limit ?? 15) });
  if (companyId && companyId !== 'all') q.set('companyId', companyId);
  return api.get<ActivityItem[]>(`/supplier/recent-activities?${q.toString()}`);
}

// 操作历史（审计留痕）
export interface SupplierAuditLogItem {
  id: string; action: string; resourceId: string | null; resourceName: string | null;
  details: Record<string, unknown> | null; actorName: string; createdAt: string;
}
export interface SupplierAuditLogs {
  items: SupplierAuditLogItem[]; total: number; page: number; pageSize: number;
}
export function getSupplierAuditLogs(opts?: { page?: number; pageSize?: number; supplierId?: string; action?: string; dateFrom?: string; dateTo?: string; companyId?: string }) {
  const params = new URLSearchParams();
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts?.supplierId) params.set('supplierId', opts.supplierId);
  if (opts?.action) params.set('action', opts.action);
  if (opts?.dateFrom) params.set('dateFrom', opts.dateFrom);
  if (opts?.dateTo) params.set('dateTo', opts.dateTo);
  if (opts?.companyId && opts.companyId !== 'all') params.set('companyId', opts.companyId);
  const q = params.toString();
  return api.get<SupplierAuditLogs>(`/supplier/audit-logs${q ? `?${q}` : ''}`);
}

// AI 供应商综合画像分析
export interface PortraitInsight { label: string; value: string; interpretation: string; tone: string; icon: string; }
export interface SupplierPortraitAnalysis {
  supplierId: string; supplierName: string; analyzedAt: string;
  overview: string; strengths: string[]; risks: string[]; suggestions: string[];
  metrics: PortraitInsight[]; historySummary: string; suitableFor: string[];
}
export function getSupplierPortraitAnalysis(supplierId: string, bypassCache = false) {
  return api.post<SupplierPortraitAnalysis>('/ai/supplier-portrait-analysis', { supplierId, bypassCache });
}

// AI 评价维度分析
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

// 评价维度统计（等级分布）
export interface DimensionStats { completeness: Record<string, number>; responsiveness: Record<string, number>; cooperation: Record<string, number>; compliance: Record<string, number>; comprehensive: Record<string, number>; total: number; }
export function getEvaluationDimensionStats(companyId?: string) {
  return api.get<DimensionStats>(`/supplier/evaluations/dimension-stats${companyQuery(companyId)}`);
}

// 企业类型分布（看板后端聚合，按公司视野）
export function getEnterpriseTypeDistribution(companyId?: string) {
  return api.get<{ counts: Record<string, number> }>(`/supplier/enterprise-type-distribution${companyQuery(companyId)}`);
}

// 沟通记录
export interface CommunicationRecord { id: string; type: string; title: string; content: string; isRead: boolean; channels: string[]; createdAt: string; }
export function getSupplierCommunications(id: string) {
  return api.get<CommunicationRecord[]>(`/supplier/${id}/communications`);
}

// 文件档案
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

// 全局搜索
export interface SearchResult { type: string; id: string; title: string; subtitle: string; link: string; }
export function globalSearch(q: string) {
  return api.get<{ results: SearchResult[]; total: number }>(`/search?q=${encodeURIComponent(q)}`);
}



// 业务标签库（供应商注册选择制：自创标签审核入池）

export interface BusinessTagRow {
  id: string;
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  source: string;
  createdAt: string;
  reviewedAt: string | null;
  /** id（2026-10-08）：审核面板按来源供应商合并分组的分组键 */
  createdBySupplier?: { id: string; name: string; supplierNo: string } | null;
  reviewedBy?: { displayName: string } | null;
}

export function listBusinessTags(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  return api.get<BusinessTagRow[]>(`/supplier/admin/tags${status ? `?status=${status}` : ''}`);
}

export function approveBusinessTag(id: string) {
  return api.post(`/supplier/admin/tags/${id}/approve`, {});
}

export function rejectBusinessTag(id: string) {
  return api.post(`/supplier/admin/tags/${id}/reject`, {});
}

/* 供应商密码重置审批（2026-09-03：供应商账号的重置申请归供应商管理中心，staff/leader 审批） */
export interface SupplierPasswordResetRequest {
  id: string;
  requestedUsername: string;
  applicantName: string;
  applicantContact: string;
  status: 'PENDING';
  requestedAt: string;
  decisionNote: string | null;
  matchedUser: {
    id: string;
    username: string;
    displayName: string | null;
    phone: string | null;
    role: string;
    company: string | null;
  } | null;
}

export function fetchSupplierPasswordResets() {
  return api.get<SupplierPasswordResetRequest[]>('/supplier/password-reset-requests');
}

export function approveSupplierPasswordReset(id: string) {
  return api.post<{ id: string; status: string }>(`/supplier/password-reset-requests/${id}/approve`, {});
}

export function rejectSupplierPasswordReset(id: string, decisionNote?: string) {
  return api.post(`/supplier/password-reset-requests/${id}/reject`, { decisionNote: decisionNote ?? null });
}

/* 供应商资料变更审批（:3004 供应商门户提交的资料变更，审批中心处理） */
export interface SupplierChangePendingRow {
  id: string;
  supplierId: string;
  fieldName: string;
  fieldLabel: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';
  createdAt: string;
  supplier: { id: string; name: string; supplierNo: string };
}

export function fetchPendingSupplierChanges() {
  return api.get<SupplierChangePendingRow[]>('/supplier/changes/pending');
}

// 审批中心角标（2026-09-29）：待我审的注册数 + 信息更新数 + 密码重置数 + 加入审批数（2026-10-16）

/** 审批留痕附件解析（2026-09-30）：id → 文件名/大小 */
export interface ApprovalAttachment { id: string; name: string; size: number; mimeType: string }
export function resolveApprovalAttachments(ids: string[]) {
  return api.post<ApprovalAttachment[]>('/supplier/approval-attachments/resolve', { ids });
}

/** 上传审核意见附件（FileAsset） */
export function uploadReviewAttachment(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return api.postForm<{ id: string; url: string; originalName: string; size: number }>(`/upload?category=general`, fd);
}

export function fetchMyPendingReviewCount(companyId?: string) {
  // joins=加入审批（多公司归属 2026-10-16）待我审数，级/公司口径与 registration 同构
  return api.get<{ registration: number; changes: number; resets: number; joins: number }>(`/supplier/approvals/my-pending-count${companyId ? `?companyId=${companyId}` : ''}`);
}

/* ── 供应商多公司归属·公司侧（2026-10-16）──
 *  仅审批与库内停用：公司侧零检索面（用户裁决 2026-10-16），无邀请/全库搜索端点，
 *  全部动作针对供应商自主发起的加入申请。 */
export interface CompanyLinkRow {
  id: string;
  supplierId: string;
  companyId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
  /** 三级审批当前待审级 STAFF/LEADER/ADMIN；null=已终态（通过/驳回） */
  reviewStage: string | null;
  /** 供应商申请说明 */
  note: string | null;
  rejectReason: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  supplier: { id: string; name: string; supplierNo: string; creditCode: string | null; status: string; isTemporary: boolean };
}

export const companyLinksApi = {
  /** 加入审批/归属列表（按登录人公司视野隔离；admin 可 companyId 切单公司，'all'=全部） */
  list: (params?: { status?: string; reviewStage?: string; companyId?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.reviewStage) q.set('reviewStage', params.reviewStage);
    if (params?.companyId && params.companyId !== 'all') q.set('companyId', params.companyId);
    const qs = q.toString();
    return api.get<CompanyLinkRow[]>(`/supplier/company-links${qs ? `?${qs}` : ''}`);
  },
  /** 逐级通过（非 ADMIN 级 reason 必填——后端校验）；返回 {success, stage}（stage=DONE|下一级），并发已审 → 409 */
  approve: (id: string, reason?: string) =>
    api.post<{ success: boolean; stage: string }>(`/supplier/company-links/${id}/approve`, { reason }),
  /** 驳回（终态，reason 必填） */
  reject: (id: string, reason: string) =>
    api.post<{ success: boolean }>(`/supplier/company-links/${id}/reject`, { reason }),
  /** 本公司库内停用/恢复（leader only；软移出——不影响供应商在其他公司的归属） */
  disable: (id: string) => api.post<{ success: boolean }>(`/supplier/company-links/${id}/disable`, {}),
  enable: (id: string) => api.post<{ success: boolean }>(`/supplier/company-links/${id}/enable`, {}),
};


export function approveSupplierChange(id: string) {
  return api.post(`/supplier/changes/${id}/approve`, {});
}

export function rejectSupplierChange(id: string, rejectReason?: string) {
  return api.post(`/supplier/changes/${id}/reject`, { rejectReason: rejectReason ?? '' });
}

/** PII 明文揭示（等保+密评）：列表/详情默认掩码，明文走此处；后端写 SensitiveAccessLog 审计 */
export function revealSupplierField(
  id: string,
  body: { entity: 'supplier' | 'contact' | 'bankAccount'; targetId?: string; field: string },
) {
  return api.post<{ entity: string; targetId: string; field: string; value: string | null }>(`/supplier/${id}/reveal`, body);
}
