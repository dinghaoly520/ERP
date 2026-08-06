import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

/* ── :3007 开标执行终端 API 封装 ──
   项目管理 / 评分标准 / 评标 / 澄清 / 归档触发等封装已随对应页面迁往 :3005。
   此处仅保留：任务板、开标会话组建、解密、唱标、异议、监督批注、评标结果。 */

/* ── 开标任务板 ── */

export interface DashboardProject {
  id: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  stage: string;
  riskNote?: string;
  budget?: number;
  scope?: string;
  qualification?: string;
  contact?: string;
  createdAt: string;
  updatedAt: string;
  supplierCount: number;
  supplierSubmitted: number;
  expertCount: number;
  expertSignedIn: number;
  /** 开标就绪度信号（C5）：解密成功 / 供应商已确认 / 待处理异议 / 已唱标记录数 */
  decryptedCount: number;
  confirmedCount: number;
  pendingDisputeCount: number;
  openingRecordedCount: number;
  readiness: 'ready' | 'partial' | 'not-ready' | 'archived';
}

export interface DashboardResponse {
  projects: DashboardProject[];
  stageDistribution: Record<string, number>;
  totalProjects: number;
  activeProjects: number;
}

export function getProjectsDashboard() {
  return api.get<DashboardResponse>('/bid/projects/dashboard');
}

/* ── 开标会话组建（:3005 已确定开标后，主持人在大厅同阶段幂等写入会话）── */

export function startOpening(projectId: string, body: {
  host: string; supervisor?: string; // 监督人选填（法律未强制）
  decryptWindowStart: string; decryptWindowEnd: string;
}) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/open`, body);
}

/* ── 解密 ── */

export function decryptBid(projectId: string, supplierId: string) {
  return api.post(`/bid/projects/${projectId}/decrypt/${supplierId}`, {});
}

/* ── 管理员一键重新封标（从系统内原始明文恢复，无需上传文件）── */

export interface ResealResult {
  recovered: string[];
  failed: Array<{ role: string; label: string; code: string; error: string }>;
  decrypted: boolean;
  message: string;
}

export function resealBidFiles(projectId: string, supplierId: string) {
  return api.post<ResealResult>(`/bid/projects/${projectId}/suppliers/${supplierId}/reseal`, {});
}

/* ── 唱标与异议 ── */

export function resolveOpeningDispute(projectId: string, recordId: string, body: {
  result: string; confirm: boolean;
}) {
  return api.post(`/bid/projects/${projectId}/opening-records/${recordId}/resolve-dispute`, body);
}

/** 主持人录入唱标信息（报价/工期/质量目标/保证金）→ 生成/更新开标记录供供应商确认。 */
export function enterOpeningRecord(projectId: string, body: {
  bidSupplierId: string; amount: string; period: string; qualityTarget: string; bondStatus: string;
}) {
  return api.post(`/bid/projects/${projectId}/opening-records`, body);
}

/** 唱标预填草稿（OPENING 阶段聚合报价/工期/质量目标/保证金凭证）。 */
export type OpeningDraftResult = {
  canView: boolean;
  amount: string | null;
  period: string | null;
  qualityTarget: string | null;
  bondStatus: string | null;
  bidBondAssetId: string | null;
};

export const getOpeningDraft = (projectId: string, supplierId: string) =>
  api.get<OpeningDraftResult>(`/bid/projects/${projectId}/suppliers/${supplierId}/opening-draft`);

/* ── 开标会话授时（倒计时以服务端时间为准）── */

export function getOpeningSessionTime(projectId: string) {
  return api.get<{ serverTime: number; remainingSeconds: number }>(`/bid/projects/${projectId}/opening-session/time`);
}

/* ── 监督批注（监督视图：关注/上报/批注持久化）── */

export interface SupervisionAnnotation {
  id: string; projectId: string; supplierId: string;
  status: string; notes?: string; createdBy?: string;
  createdAt: string; updatedAt: string;
}

export function getSupervisionAnnotations(projectId: string) {
  return api.get<SupervisionAnnotation[]>(`/bid/projects/${projectId}/supervision-annotations`);
}

export function upsertSupervisionAnnotation(projectId: string, body: {
  supplierId: string; status: string; notes?: string; createdBy?: string;
}) {
  return api.post<SupervisionAnnotation>(`/bid/projects/${projectId}/supervision-annotations`, body);
}

export function deleteSupervisionAnnotation(projectId: string, supplierId: string) {
  return api.delete(`/bid/projects/${projectId}/supervision-annotations/${supplierId}`);
}

/* ── 完成开标·资料移交（开标完成后主持人一键交回 :3005；幂等）── */

export interface HandoverResult {
  status: string;
  handoverAt: string | null;
  handoverAssetId: string | null;
  downloadUrl: string | null;
}

export function completeOpening(projectId: string) {
  return api.post<HandoverResult>(`/bid/projects/${projectId}/complete-opening`, {});
}

export function acceptSupplierDanger(projectId: string, supplierId: string, reason: string) {
  return api.post(`/bid/projects/${projectId}/suppliers/${supplierId}/accept-danger`, { reason });
}

export function pauseOpening(projectId: string, reason?: string) {
  return api.post(`/bid/projects/${projectId}/pause`, reason ? { reason } : {});
}

export function resumeOpening(projectId: string) {
  return api.post(`/bid/projects/${projectId}/resume`, {});
}

/* ── 工作区·评标管理（只读）：评标结果汇总 ── */

export interface EvaluationResultRow {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  rank: number;
  recommended: boolean;
  bidPrice?: string | null;
  disqualified?: boolean;
  averageScore?: string;
}

export function listEvaluationResults(projectId: string) {
  return api.get<EvaluationResultRow[]>(`/bid/projects/${projectId}/evaluation-results`);
}

/* ── 多轮报价（谈判/竞价采购）── */

export function listRounds(bidProjectId: string) {
  return api.get<Array<{ id: string; roundNo: number; roundType: string; status: string; deadline: string | null; quotes?: Array<{ id: string; bidSupplierId: string; quotePrice: string; status: string }> }>>(`/bid/projects/${bidProjectId}/rounds`);
}

export function createRound(bidProjectId: string, data: { roundType: string; deadline?: string }) {
  return api.post(`/bid/projects/${bidProjectId}/rounds`, data);
}

export function sealRound(bidProjectId: string, roundId: string) {
  return api.post(`/bid/projects/${bidProjectId}/rounds/${roundId}/seal`, {});
}

export function publishRound(bidProjectId: string, roundId: string) {
  return api.post(`/bid/projects/${bidProjectId}/rounds/${roundId}/publish`, {});
}

export function closeRound(bidProjectId: string, roundId: string, proceedToEvaluation: boolean) {
  return api.post(`/bid/projects/${bidProjectId}/rounds/${roundId}/close`, { proceedToEvaluation });
}
