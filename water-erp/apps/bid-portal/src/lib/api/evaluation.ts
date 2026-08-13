import { api } from '@/lib/api';

/* ── :3007 评标管理 API 封装（自 :3005 lib/api/bid.ts 移植，函数体保持一致） ──
   分工 v3（2026-08-13）：评标管理/异议裁决/澄清答疑为 :3007 现场全操作，
   此处仅复制评标管理所依赖的类型与函数。 */

export type BidStage = 'DOWNLOAD' | 'SUBMIT' | 'OPENING' | 'EVALUATING' | 'ARCHIVED' | 'ABORTED';
export type ScoreCategory = 'QUALIFICATION' | 'RESPONSIVE' | 'BUSINESS' | 'TECHNICAL' | 'PRICE';

export const SCORE_CATEGORY_LABELS: Record<ScoreCategory, string> = {
  QUALIFICATION: '资格审查',
  RESPONSIVE: '响应性',
  BUSINESS: '商务',
  TECHNICAL: '技术',
  PRICE: '价格',
};

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
  evaluationDeadline?: string | null; // E2: 评标截止时间
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
  /** A3 中标通知书：评标结果（后端 getProject 暂未返回——UI 按 ?? [] 容错，功能待后端补齐） */
  evaluationResults?: BidEvaluationResultInfo[];
  // ── 开标主持人指派（R1 硬分流）──
  assignedHostUserId?: string | null;
  assignedHostUser?: { id: string; username: string; displayName: string } | null;
  supervisionLogs?: Array<{ time: string; role: string; target: string; action: string; result: string; riskFlag: string }>; // G2
  expertDisputes?: Array<{ // D2: 专家异议工单（采购端裁决用）
    id: string; expertName: string; type: string; // scoring | procedure | other
    title: string; content: string; status: string; // open | resolved | rejected
    response?: string | null; createdAt: string;
    resolvedAt?: string | null; resolvedBy?: string | null;
  }>;
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
  bidPrice?: string | null; // A4: 供应商报价（从评标结果流入）
  generatedAt: string;
}

export function listEvaluationResults(bidProjectId: string) {
  return api.get<BidEvaluationResultInfo[]>(`/bid/projects/${bidProjectId}/evaluation-results`);
}

/** 生成评标结果（须全部专家 reportConfirmed） */
export function generateEvaluationResults(bidProjectId: string) {
  return api.post<BidEvaluationResultInfo[]>(`/bid/projects/${bidProjectId}/evaluation-results/generate`, {});
}

/* ── 专家批注/备忘（管理端只读）── */

export interface ExpertMemoForAdmin {
  id: string;
  expertId: string;
  projectId: string;
  supplierId?: string | null;
  scoreItemId?: string | null;
  scorePointId?: string | null;
  contentText?: string | null;
  inkFileId?: string | null;
  sourceDevice?: string | null;
  createdAt: string;
}

export function listExpertMemosForAdmin(
  projectId: string,
  params?: { expertId?: string; supplierId?: string; scoreItemId?: string },
): Promise<ExpertMemoForAdmin[]> {
  const qs = new URLSearchParams();
  if (params?.expertId) qs.set('expertId', params.expertId);
  if (params?.supplierId) qs.set('supplierId', params.supplierId);
  if (params?.scoreItemId) qs.set('scoreItemId', params.scoreItemId);
  return api.get(`/expert-admin/projects/${projectId}/memos${qs.size ? `?${qs}` : ''}`);
}

export function getExpertMemoInkUrlForAdmin(
  projectId: string,
  memoId: string,
): Promise<{ url: string }> {
  return api.get(`/expert-admin/projects/${projectId}/memos/${memoId}/ink`);
}
