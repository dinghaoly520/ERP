import { api } from '../api';

/* ── 开评标项目（:3005 项目管理 · BID_EVALUATION 开标确认面板用）──
   后端 /bid/projects/:id/... 已提供全部能力；此处仅做类型化封装。
   BidProject 与 ProjectManagementItem 通过 bidProjectId 关联（懒创建）。 */

export type BidStage = 'DOWNLOAD' | 'SUBMIT' | 'OPENING' | 'EVALUATING' | 'ARCHIVED';
export type ScoreCategory = 'QUALIFICATION' | 'RESPONSIVE' | 'BUSINESS' | 'TECHNICAL' | 'PRICE';

export const BID_STAGE_LABELS: Record<BidStage, string> = {
  DOWNLOAD: '待开放投标',
  SUBMIT: '投标中',
  OPENING: '开标中',
  EVALUATING: '评标中',
  ARCHIVED: '已归档',
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

/* ── 评分模板（整套评分标准 + 得分点的保存 / 复用）── */

export interface ScoreTemplateRef {
  id: string;
  name: string;
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
