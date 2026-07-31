import { api } from '../api';
import type { ScorePointSuggestion, ScorePointSuggestionGroup } from '@water-erp/shared';

export type { ScorePointSuggestion, ScorePointSuggestionGroup };

/* ── 开评标项目（:3005 项目管理 · BID_EVALUATION 开标确认面板用）──
   后端 /bid/projects/:id/... 已提供全部能力；此处仅做类型化封装。
   BidProject 与 ProjectManagementItem 通过 bidProjectId 关联（懒创建）。 */

export type BidStage = 'DOWNLOAD' | 'SUBMIT' | 'OPENING' | 'EVALUATING' | 'ARCHIVED' | 'ABORTED';
export type ScoreCategory = 'QUALIFICATION' | 'RESPONSIVE' | 'BUSINESS' | 'TECHNICAL' | 'PRICE';

export const BID_STAGE_LABELS: Record<BidStage, string> = {
  DOWNLOAD: '待开放投标',
  SUBMIT: '投标中',
  OPENING: '开标中',
  EVALUATING: '评标中',
  ARCHIVED: '已归档',
  ABORTED: '已流标',
};

export const SCORE_CATEGORY_LABELS: Record<ScoreCategory, string> = {
  QUALIFICATION: '资格审查',
  RESPONSIVE: '响应性',
  BUSINESS: '商务',
  TECHNICAL: '技术',
  PRICE: '价格',
};

export interface BidProjectRef {
  id: string;
  projectCode: string;
  name: string;
  stage: BidStage;
  procurementMethod: string;
  round?: number; // 多轮采购：所属轮次（再次采购递增）
  openTime: string;
  deadline: string;
  /** 关联招标公告的发布时间（投递起点），无公告时为 null */
  publishTime: string | null;
}

/** 确保 ProjectManagementItem 已关联 BidProject（按轮：无则建；round 缺省取 currentRound）*/
export function ensureBidProject(projectItemId: string, round?: number) {
  const qs = round != null ? `?round=${round}` : '';
  return api.get<BidProjectRef>(`/project-management/${projectItemId}/bid-project${qs}`);
}

/* ── 开标工作台（聚合：项目 + 供应商投递 + 专家确认 + stats）── */

export interface BidWorkspaceSupplier {
  id: string;
  supplierId: string | null;
  supplierName: string;
  classification?: string | null;
  downloadStatus: string;
  submitStatus: string;
  decryptStatus: string;
  /** CONFIRMED / PENDING / EXCEPTION / DISPUTED（C5 起随 workspace 返回） */
  confirmStatus: string;
  submission: {
    supplierId: string;
    status: string;
    submittedAt: string | null;
    bidPrice: string | null;
    deliveryPeriod: string | null;
  } | null;
  submitted: boolean;
  withdrawn: boolean;
}

export interface BidWorkspaceExpert {
  id: string;
  expertName: string;
  major: string;
  signedIn: boolean;
  avoidanceConfirmed: boolean;
  progress: string;
}

export interface BidWorkspace {
  project: {
    id: string;
    name: string;
    projectCode: string;
    procurementMethod: string;
    stage: BidStage;
    openTime: string;
    deadline: string;
  };
  suppliers: BidWorkspaceSupplier[];
  experts: BidWorkspaceExpert[];
  stats: {
    supplierTotal: number;
    submitted: number;
    withdrawn: number;
    expertCount: number;
    expertSignedIn: number;
    /** 开标就绪度信号（C5）：解密成功 / 供应商已确认 / 待处理异议 / 已唱标记录数 */
    decryptedCount: number;
    confirmedCount: number;
    pendingDisputeCount: number;
    openingRecordedCount: number;
  };
}

export function getBidWorkspace(bidProjectId: string) {
  return api.get<BidWorkspace>(`/bid/projects/${bidProjectId}/workspace`);
}

/* ── 评分标准 ── */

export interface BidScoreItem {
  id: string;
  projectId: string;
  category: ScoreCategory;
  name: string;
  maxScore: string; // Prisma Decimal 序列化为字符串
  scoringCriteria: string | null;
  evidenceHint: string | null;
  criteriaSource: string | null;
  points?: BidScorePoint[]; // listScoreItems 已 include points（seq 升序）
  createdAt: string;
}

export function listScoreItems(bidProjectId: string) {
  return api.get<BidScoreItem[]>(`/bid/projects/${bidProjectId}/score-items`);
}

export function createScoreItem(
  bidProjectId: string,
  data: { category: ScoreCategory; name: string; maxScore: number },
) {
  return api.post<BidScoreItem>(`/bid/projects/${bidProjectId}/score-items`, data);
}

export function updateScoreItem(
  bidProjectId: string,
  itemId: string,
  data: { category?: ScoreCategory; name?: string; maxScore?: number },
) {
  return api.patch<BidScoreItem>(`/bid/projects/${bidProjectId}/score-items/${itemId}`, data);
}

export function deleteScoreItem(bidProjectId: string, itemId: string) {
  return api.delete<{ deleted?: boolean }>(`/bid/projects/${bidProjectId}/score-items/${itemId}`);
}

/** 应用标准评分模板（幂等）*/
export function applyScoreTemplate(bidProjectId: string) {
  return api.post<BidScoreItem[]>(`/bid/projects/${bidProjectId}/score-items/template`, {});
}

/* ── 得分点（评分细则，挂在分项下的子项）── */

export interface BidScorePoint {
  id: string;
  scoreItemId: string;
  name: string;
  fullScore: string; // Prisma Decimal → 字符串
  seq: number;
  evidenceHint: string | null;
  objective: boolean;
  createdAt: string;
}

export function listScorePoints(bidProjectId: string, itemId: string) {
  return api.get<BidScorePoint[]>(`/bid/projects/${bidProjectId}/score-items/${itemId}/points`);
}

export function createScorePoint(
  bidProjectId: string,
  itemId: string,
  data: { name: string; fullScore: number; evidenceHint?: string; objective?: boolean },
) {
  return api.post<BidScorePoint>(`/bid/projects/${bidProjectId}/score-items/${itemId}/points`, data);
}

export function updateScorePoint(
  bidProjectId: string,
  itemId: string,
  pointId: string,
  data: { name?: string; fullScore?: number; evidenceHint?: string; objective?: boolean },
) {
  return api.patch<BidScorePoint>(`/bid/projects/${bidProjectId}/score-items/${itemId}/points/${pointId}`, data);
}

export function deleteScorePoint(bidProjectId: string, itemId: string, pointId: string) {
  return api.delete<{ deleted?: boolean }>(`/bid/projects/${bidProjectId}/score-items/${itemId}/points/${pointId}`);
}

/** 发布评分标准（锁定：置 scoreStandardPublishedAt）。后端校验打分类 Σ=100 且每项 ≥1 得分点，不满足 → 409。*/
export function publishScoreStandard(bidProjectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${bidProjectId}/score-items/publish`, {});
}

/** AI 从招标文件提取得分点建议（同步、不落库；120s 超时可经 options.signal 中断）。限流 3 次/分。*/
export function extractScorePoints(bidProjectId: string, itemId: string, options?: RequestInit) {
  return api.post<ScorePointSuggestion[]>(
    `/bid/projects/${bidProjectId}/score-items/${itemId}/points/extract`,
    {},
    options,
  );
}

/** 一键 AI 提取：全部评分项（除 PRICE）分组返回建议（同步、不落库；300s 超时可经 options.signal 中断）。限流 3 次/分。*/
export function extractAllScorePoints(bidProjectId: string, options?: RequestInit) {
  return api.post<ScorePointSuggestionGroup[]>(
    `/bid/projects/${bidProjectId}/score-items/points/extract-all`,
    {},
    options,
  );
}

/** 批量导入得分点（AI 建议审核通过后）。多余的 selected/duplicate 等字段被后端 whitelist 剥掉。*/
export function batchCreateScorePoints(
  bidProjectId: string,
  itemId: string,
  points: Array<{
    name: string;
    fullScore: number;
    seq?: number;
    evidenceHint?: string;
    objective?: boolean;
    evidenceSection?: string;
    confidence?: number;
  }>,
) {
  return api.post<{ count: number }>(
    `/bid/projects/${bidProjectId}/score-items/${itemId}/points/batch`,
    { points },
  );
}

/* ── 评分模板（整套评分标准 + 得分点的保存 / 复用）── */

export interface ScoreTemplateRef {
  id: string;
  name: string;
  createdById?: string | null; // null/缺省 = 公共模板；有值 = 创建者本人（后端按当前用户过滤，非空即「我的」）
  createdByName: string | null;
  createdAt: string;
}

export function listScoreTemplates() {
  return api.get<ScoreTemplateRef[]>('/bid/score-templates');
}

/** 把当前项目的全部评分项 + 得分点存为命名模板 */
export function saveScoreTemplate(bidProjectId: string, name: string) {
  return api.post<ScoreTemplateRef>('/bid/score-templates', { projectId: bidProjectId, name });
}

/** 应用已保存的模板到项目（同名分项跳过，幂等）*/
export function applySavedScoreTemplate(bidProjectId: string, templateId: string) {
  return api.post<BidScoreItem[]>(`/bid/projects/${bidProjectId}/apply-score-template/${templateId}`, {});
}

export function deleteScoreTemplate(templateId: string) {
  return api.delete<{ deleted: boolean }>(`/bid/score-templates/${templateId}`);
}

/* ── 催促（多通道通知）── */

export function nudgeSuppliers(bidProjectId: string, onlyUnsubmitted = true) {
  return api.post<{ notified: number }>(`/bid/projects/${bidProjectId}/nudge-suppliers`, {
    onlyUnsubmitted,
  });
}

export function nudgeExperts(bidProjectId: string, reason: 'signin' | 'score' = 'signin') {
  return api.post<{ notified: number }>(`/bid/projects/${bidProjectId}/nudge-experts`, { reason });
}

/** 通知开标时间变更（向全部投标供应商 + 评标专家）*/
export function notifyBidScheduleChange(bidProjectId: string, openTime: string) {
  return api.post<{ reached: number }>(`/bid/projects/${bidProjectId}/notify-schedule-change`, { openTime });
}

/* ── 开标决策 ── */

/** 开放投标投递（DOWNLOAD → SUBMIT）*/
export function openSubmission(bidProjectId: string) {
  return api.post<{ stage: BidStage }>(`/bid/projects/${bidProjectId}/open-submission`, {});
}

/** 启动开标（SUBMIT → OPENING），可附带主持人/监督员/解密窗口 */
export function startOpening(
  bidProjectId: string,
  dto?: { host?: string; supervisor?: string; decryptWindowStart?: string; decryptWindowEnd?: string },
) {
  return api.post<{ stage: BidStage }>(`/bid/projects/${bidProjectId}/open`, dto ?? {});
}

/** 流标：将项目状态置为 ABORTED（B2: 支持流标原因） */
export function abortBidProject(bidProjectId: string, reason?: string) {
  return api.post<{ stage: BidStage }>(`/bid/projects/${bidProjectId}/abort`, reason ? { reason } : {});
}

/** A1: 公示状态查询 */
export function getPublicityStatus(bidProjectId: string) {
  return api.get<{ hasPublicity: boolean; publicityEnd: string | null; canIssueAward: boolean }>(
    `/bid/projects/${bidProjectId}/publicity-status`,
  );
}

/** A3: 推送中标通知书 */
export function deliverAwardLetter(bidProjectId: string, data: { winnerName: string; winnerSupplierId?: string; content?: Record<string, unknown> }) {
  return api.post(`/bid/projects/${bidProjectId}/award-letter/deliver`, data);
}

/** A3: 中标通知书签收状态 */
export function getAwardLetterStatus(bidProjectId: string) {
  return api.get<Array<{ id: string; supplierName: string; deliveredAt: string | null; signedAt: string | null; signedBy: string | null }>>(
    `/bid/projects/${bidProjectId}/award-letter/status`,
  );
}

/** 延时开标：修改 openTime / deadline */
export function updateBidProjectSchedule(
  bidProjectId: string,
  data: { openTime?: string; deadline?: string },
) {
  return api.patch<BidProjectRef>(`/bid/projects/${bidProjectId}`, data);
}

/** 开标会话时间 */
export function getOpeningSessionTime(bidProjectId: string) {
  return api.get<{ openTime: string; decryptWindowStart?: string; decryptWindowEnd?: string } | null>(
    `/bid/projects/${bidProjectId}/opening-session/time`,
  );
}

/* ── Phase 2：:3005 开评标指挥中心（项目详情 / 评标管理 / 澄清答疑 / 归档）── */

export interface BidOpeningSessionInfo {
  id: string;
  host: string;
  supervisor: string | null; // 选填（法律未强制）
  decryptWindowStart: string;
  decryptWindowEnd: string;
  remainingSeconds: number;
  status: string;
  exchangeControl?: string;
  /** T10：:3007 完成开标后回传的移交资料（T1 为 BidOpeningSession 新增 handoverAt / handoverAssetId 两列） */
  handoverAt: string | null;
  handoverAssetId: string | null;
}

export interface BidProjectExpertInfo {
  id: string;
  userId: string;
  expertName: string;
  major: string | null;
  expertRole: string; // 正选 / 候补
  invitationStatus: string; // pending / confirmed / declined
  signedIn: boolean;
  avoidanceConfirmed: boolean;
  progress: string;
  reportConfirmed: boolean;
  totalScore: number | null;
  scoreRecords: Array<{
    id: string;
    scoreItemId: string;
    supplierId: string;
    score: number;
    /** 通过性审查（资格/响应性）：是否通过 */
    passed?: boolean | null;
    reason?: string | null;
  }>;
}

export interface BidProjectSupplierInfo {
  id: string;
  supplierId: string | null;
  supplierName: string;
  submitStatus: string;
  decryptStatus: string;
  confirmStatus: string;
  bidValidity?: string | null;
}

export interface BidArchiveItemInfo {
  id: string;
  name: string;
  ownerRole: string;
  status: string; // PENDING_CONFIRM / ARCHIVED
  hashDigest: string | null;
  archivedAt: string | null;
}

/** GET /bid/projects/:id 全量子表详情（开评标指挥中心各区块共用数据源） */
export interface BidProjectDetail {
  id: string;
  projectCode: string;
  name: string;
  stage: BidStage;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  riskNote?: string | null;
  qualityRequirement?: string | null;
  scoreStandardPublishedAt?: string | null;
  suppliers: BidProjectSupplierInfo[];
  openingSession: BidOpeningSessionInfo | null;
  openingRecords: Array<{
    id: string;
    bidSupplierId: string;
    bidPrice?: string | null;
    deliveryPeriod?: string | null;
    status: string;
    objectionReason?: string | null;
  }>;
  experts: BidProjectExpertInfo[];
  scoreItems: Array<{
    id: string;
    name: string;
    category: ScoreCategory;
    maxScore: number;
    weight?: number | null;
  }>;
  archiveItems: BidArchiveItemInfo[];
}

export function getBidProjectDetail(bidProjectId: string) {
  return api.get<BidProjectDetail>(`/bid/projects/${bidProjectId}`);
}

/* ── 评标管理 ── */

/** 启动评标（OPENING → EVALUATING；前置：有专家 + 有可评供应商 + 评分标准完整） */
export function startEvaluation(bidProjectId: string) {
  return api.post<{ stage: BidStage }>(`/bid/projects/${bidProjectId}/start-evaluation`, {});
}

export interface BidEvaluationResultInfo {
  id: string;
  supplierId: string;
  supplierName: string;
  totalScore: string; // Decimal 序列化为字符串
  averageScore: string;
  rank: number;
  recommended: boolean;
  disqualified: boolean;
  generatedAt: string;
}

export function listEvaluationResults(bidProjectId: string) {
  return api.get<BidEvaluationResultInfo[]>(`/bid/projects/${bidProjectId}/evaluation-results`);
}

/** 生成评标结果（须全部专家 reportConfirmed） */
export function generateEvaluationResults(bidProjectId: string) {
  return api.post<BidEvaluationResultInfo[]>(`/bid/projects/${bidProjectId}/evaluation-results/generate`, {});
}

/* ── 澄清答疑 ── */

export interface BidClarificationInfo {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  type: string; // clarification / question
  question: string;
  reply: string | null;
  issuer: string | null;
  status?: string | null;
  aiSummary?: string | null;
  fileAssetId?: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export function listClarifications(bidProjectId: string) {
  return api.get<BidClarificationInfo[]>(`/bid/projects/${bidProjectId}/clarifications`);
}

export function createClarification(
  bidProjectId: string,
  body: {
    question: string;
    issuer: string;
    supplierName: string;
    type?: string; // clarification（默认）/ question
    supplierId?: string;
  },
) {
  return api.post<BidClarificationInfo>(`/bid/projects/${bidProjectId}/clarifications`, body);
}

export function replyClarification(bidProjectId: string, clarificationId: string, body: { reply: string }) {
  return api.patch<BidClarificationInfo>(
    `/bid/projects/${bidProjectId}/clarifications/${clarificationId}/reply`,
    body,
  );
}

/** AI 起草候选问题（不落库） */
export function draftClarification(bidProjectId: string, supplierId: string) {
  return api.post<{ drafts: string[]; basis: string[] }>(
    `/bid/projects/${bidProjectId}/clarifications/draft`,
    { supplierId },
  );
}

/** AI 提炼回复要点（不落库） */
export function summarizeClarification(bidProjectId: string, clarificationId: string) {
  return api.post<{ summary: string; keyPoints: string[]; aiSummary: string }>(
    `/bid/projects/${bidProjectId}/clarifications/${clarificationId}/summarize`,
    {},
  );
}

/* ── 归档 ── */

/**
 * 一键归档。scope='opening'：开标归档（仅开标文件，流标/废标场景，终局）；
 * 'full'（默认）：完整归档（须已生成评标结果）。
 */
export function archiveAll(bidProjectId: string, scope: 'opening' | 'full' = 'full') {
  return api.post<BidProjectDetail>(`/bid/projects/${bidProjectId}/archive-all`, { scope });
}

/** 归档包导出直链（同源 rewrite，cookie 自动携带；CSV 走浏览器下载，JSON 可 fetch） */
export function archivePackageExportUrl(bidProjectId: string, format: 'json' | 'csv' = 'json') {
  return `/api/bid/projects/${bidProjectId}/archive-package/export?format=${format}`;
}

export function exportArchivePackageJson(bidProjectId: string) {
  return api.get<Record<string, unknown>>(archivePackageExportUrl(bidProjectId, 'json'));
}
