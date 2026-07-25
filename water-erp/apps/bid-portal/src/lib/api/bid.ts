import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

/* ── :3007 开标执行终端 API 封装（Phase 3 瘦身版）──
   项目管理 / 评分标准 / 评标 / 澄清 / 归档触发等封装已随对应页面迁往 :3005。
   此处仅保留：项目读取、任务板、开标会话组建、解密、唱标、异议、监督批注。 */

/* ── 项目详情 ── */

export function getProject<T = BidProjectDetail>(id: string) {
  return api.get<T>(`/bid/projects/${id}`);
}

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
  host: string; supervisor: string;
  decryptWindowStart: string; decryptWindowEnd: string;
}) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/open`, body);
}

/* ── 解密 ── */

export function decryptBid(projectId: string, supplierId: string) {
  return api.post(`/bid/projects/${projectId}/decrypt/${supplierId}`, {});
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
