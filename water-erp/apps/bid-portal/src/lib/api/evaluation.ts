import { api } from '@/lib/api';

/* ── :3007 评标管理 API 封装 ──
   分工 v3（2026-08-13）：评标管理/异议裁决/澄清答疑为 :3007 现场全操作。
   项目/专家/供应商等实体类型的真身在 @/lib/types（派生自 @water-erp/shared），
   本文件只保留评标管理链路的响应类型与函数（F19 清理：删除了零消费的旧详情副本类型）。 */

export type BidStage = 'DOWNLOAD' | 'SUBMIT' | 'OPENING' | 'EVALUATING' | 'ARCHIVED' | 'ABORTED';
export type ScoreCategory = 'QUALIFICATION' | 'RESPONSIVE' | 'BUSINESS' | 'TECHNICAL' | 'PRICE';

/* ── 开标决策 ── */

/** 流标：将项目状态置为 ABORTED（B2: 支持流标原因） */
export function abortBidProject(bidProjectId: string, reason?: string) {
  return api.post<{ stage: BidStage }>(`/bid/projects/${bidProjectId}/abort`, reason ? { reason } : {});
}

/* ── 专家异议工单（D2：采购端裁决，分工 v3 后为 :3007 现场办理）── */

/** 采购端裁决专家异议工单（采纳/驳回）。
 *  invalidateBidSupplierId：采纳时同事务把该投标供应商置为 invalid（废标联动，可选）。 */
export function resolveExpertDispute(
  bidProjectId: string,
  disputeId: string,
  dto: { response: string; status: 'resolved' | 'rejected'; invalidateBidSupplierId?: string },
) {
  return api.post(`/bid/projects/${bidProjectId}/disputes/${disputeId}/resolve`, dto);
}

/* ── 评标管理 ── */

/** 启动评标（OPENING → EVALUATING；前置：有专家 + 有可评供应商 + 评分标准完整）。evaluationHours：自定义评标时长（小时），缺省 72 */
export function startEvaluation(bidProjectId: string, evaluationHours?: number) {
  return api.post<{ stage: BidStage }>(`/bid/projects/${bidProjectId}/start-evaluation`, { evaluationHours });
}

/** 评标延期审批（leader/admin/bid_host）：在现有截止时间上累加小时数，写入监督日志（中风险）+ 审计日志 */
export function extendEvaluation(bidProjectId: string, dto: { extendHours: number; reason: string }) {
  return api.post<{ evaluationDeadline: string }>(`/bid/projects/${bidProjectId}/extend-evaluation`, dto);
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

/** F12（2026-08-28）：官方口径实时排名预览（与生成同源聚合：去极值/公式价格分/废标置后） */
export interface LiveOfficialScoreRow {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  averageScore: number;
  rank: number;
  disqualified: boolean;
  expertCount: number;
  trimmedCount: number;
}

export interface LiveOfficialScoresResponse {
  results: LiveOfficialScoreRow[];
  /** 公式配置需要最高限价但项目未设置——预览降级提示（非 400，生成时才会硬拦） */
  priceFormulaError: string | null;
}

export function getLiveOfficialScores(bidProjectId: string) {
  return api.get<LiveOfficialScoresResponse>(`/bid/projects/${bidProjectId}/live-official-scores`);
}

/** 生成时被排除的供应商（开标确认 EXCEPTION，未纳入排名） */
export interface ExcludedSupplierInfo {
  supplierId: string;
  supplierName: string;
  reason: string;
}

/** 生成评标结果响应（2026-08-28 起后端统一包一层，不再返回裸数组） */
export interface GenerateEvaluationResultsResponse {
  results: BidEvaluationResultInfo[];
  excludedSuppliers?: ExcludedSupplierInfo[];
}

/** 生成评标结果（须全部专家 reportConfirmed） */
export function generateEvaluationResults(bidProjectId: string) {
  return api.post<GenerateEvaluationResultsResponse>(`/bid/projects/${bidProjectId}/evaluation-results/generate`, {});
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
  /** A-143：答复通道（online=供应商门户电子签名 / offline=主持端离线登记） */
  replyChannel?: string | null;
  replySignature?: { algorithm?: string; certSn?: string; verifiedAt?: string } | null;
  replyAttachmentIds?: { fileAssetId: string; name: string; sha256: string }[] | null;
  replyOfflineReason?: string | null;
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

/**
 * 答复澄清（同一 PATCH 端点，F19 合并原 replyClarification/registerOfflineReply 双封装）。
 * A-143：在线答复（channel 缺省）与主持端离线登记（channel='offline' + offlineReason）共用此函数。
 */
export function replyClarification(
  bidProjectId: string,
  clarificationId: string,
  body: { reply: string; channel?: 'offline'; offlineReason?: string },
) {
  return api.patch<BidClarificationInfo>(
    `/bid/projects/${bidProjectId}/clarifications/${clarificationId}/reply`,
    body,
  );
}

/** A-143：核验供应商在线答复签名 */
export function verifyClarificationReply(projectId: string, cid: string) {
  return api.post<{ valid: boolean; certSn: string; bindingStatus: string; verifiedAt: string | null }>(
    `/bid/projects/${projectId}/clarifications/${cid}/verify-reply`, {},
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

/** 核验矩阵行（2026-09-18 身份核验设计 §4.5——后端 GET /bid/projects/:id/expert-verification 平铺） */
export interface ExpertVerificationRow {
  id: string;
  expertName: string;
  major: string;
  expertRole: string;
  isLead: boolean;
  isPurchaserRepresentative: boolean;
  signedIn: boolean;
  signInIp: string | null;
  signedInAt: string | null;
  method: string | null;
  occlusion: 'passed' | 'unchecked' | null;
  photoAssetId: string | null;
  manualReason: string | null;
  confirmedByName: string | null;
  /** 生效中的核验异常登记（闭环修复 2026-09-20：矩阵徽章/tooltip 用） */
  anomaly: { at: string; result: string } | null;
  identityVerified: boolean;
  identityVerifiedByName: string | null;
  identityDocType: string | null;
}

export interface ExpertVerificationMatrix {
  projectId: string;
  mode: 'self' | 'host' | 'off';
  experts: ExpertVerificationRow[];
}

export function getExpertVerification(projectId: string): Promise<ExpertVerificationMatrix> {
  return api.get(`/bid/projects/${projectId}/expert-verification`);
}

/** R9（2026-09-20 spec §4.6）：主持人手动确认专家签到（摄像头故障等现场降级） */
export function manualConfirmExpertVerification(
  projectId: string,
  expertId: string,
  body: { reason: string; docType?: string },
): Promise<{ ok: boolean; already?: boolean; expertId: string; expertName: string; signedInAt?: string }> {
  return api.post(`/bid/projects/${projectId}/expert-verification/${expertId}/manual-confirm`, body);
}

/** R5（2026-09-20 spec §4.4）：核验异常登记 */
export function rejectExpertVerification(
  projectId: string,
  expertId: string,
  body: { type: '人证不符' | '照片异常' | '到场异常'; note?: string },
): Promise<{ ok: boolean; already?: boolean; expertId: string; expertName: string; action?: string; riskFlag?: string }> {
  return api.post(`/bid/projects/${projectId}/expert-verification/${expertId}/reject`, body);
}

/** R5 闭环修复（2026-09-20）：撤销异常登记——误报可更正，追加更正日志不删原记录 */
export function retractExpertVerification(
  projectId: string,
  expertId: string,
  body: { reason: string },
): Promise<{ ok: boolean; already?: boolean; expertId: string; expertName: string }> {
  return api.post(`/bid/projects/${projectId}/expert-verification/${expertId}/unreject`, body);
}

/** P3 host 态（2026-09-20 spec §4.2）：主持人核验登记 */
export function verifyExpertIdentity(
  projectId: string,
  expertId: string,
  body: { docType: '身份证' | '护照' | '其他'; note?: string },
): Promise<{ ok: boolean; expertId: string; expertName: string; verifiedByName: string }> {
  return api.post(`/bid/projects/${projectId}/expert-verification/${expertId}/verify`, body);
}

/** P3 host 态（2026-09-20 spec §4.2）：撤销误登记（已签到 409 VERIFY_LOCKED） */
export function unverifyExpertIdentity(
  projectId: string,
  expertId: string,
  body: { reason: string },
): Promise<{ ok: boolean; already?: boolean; expertId: string; expertName: string }> {
  return api.post(`/bid/projects/${projectId}/expert-verification/${expertId}/unverify`, body);
}

/** 评标室口令查询（2026-09-20 spec §4）：明文仅主持人/管理员可见 */
export function getRoomCode(projectId: string): Promise<{ roomCode: string | null; roomCodeAt: string | null; stage: string }> {
  return api.get(`/bid/projects/${projectId}/room-code`);
}

/** 评标室口令生成/轮换（2026-09-20 spec §4）：仅 EVALUATING；轮换即全员失效重验 */
export function rotateRoomCode(projectId: string): Promise<{ roomCode: string; roomCodeAt: string }> {
  return api.post(`/bid/projects/${projectId}/room-code/rotate`, {});
}

/** 闸4 阀门（2026-09-20 spec）：解除专家评标期登录锁定（换设备场景，理由必填留痕） */
export function releaseLoginLock(
  projectId: string,
  expertId: string,
  body: { reason: string },
): Promise<{ ok: boolean; expertId: string; expertName: string }> {
  return api.post(`/bid/projects/${projectId}/expert-verification/${expertId}/release-login-lock`, body);
}
