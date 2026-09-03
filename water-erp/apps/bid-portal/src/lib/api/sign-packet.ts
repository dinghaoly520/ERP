import { api } from '@/lib/api';

export type SignStatusValue = 'PENDING' | 'SIGNED' | 'REFUSED_DISSENT' | 'DEEMED_AGREED';

export interface SignPacketExpertRow {
  expertId: string;
  name: string;
  major: string;
  role: string;
  /** A-132：评审分组（技术组|商务组|综合组）与组内职责（主审|复核|成员）；未设置为 null */
  reviewGroup: string | null;
  dutyRole: string | null;
  isLead: boolean;
  isPurchaserRepresentative: boolean;
  signStatus: SignStatusValue;
  signStatusAt: string | null;
  signScanUrl: string | null;
  dissentingOpinion: string | null;
  dissentingReason: string | null;
}

export interface SignPacketResponse {
  stage: string;
  resultsGenerated: boolean;
  canGenerate: boolean;
  packet: {
    id: string;
    sha256: string;
    generatedAt: string;
    downloadUrl: string;
    signPageScanUrl: string | null;
    closedAt: string | null;
    closed: boolean;
    handoverFileAssetId: string | null;
    handoverSha256: string | null;
    handoverDownloadUrl: string | null;
  } | null;
  experts: SignPacketExpertRow[];
  allClosed: boolean;
}

export function getSignPacket(projectId: string) {
  return api.get<SignPacketResponse>(`/bid/projects/${projectId}/sign-packet`);
}

export function generateSignPacket(projectId: string) {
  return api.post<SignPacketResponse>(`/bid/projects/${projectId}/sign-packet/generate`, {});
}

export function generateHandover(projectId: string) {
  return api.post<SignPacketResponse>(`/bid/projects/${projectId}/sign-packet/handover`, {});
}

export function uploadExpertScan(projectId: string, expertId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return api.upload<SignPacketResponse>(`/bid/projects/${projectId}/sign-packet/experts/${expertId}/scan`, form);
}

export function uploadSignaturePageScan(projectId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return api.upload<SignPacketResponse>(`/bid/projects/${projectId}/sign-packet/signature-page/scan`, form);
}

export function registerSign(projectId: string, expertId: string, dto: { status: Exclude<SignStatusValue, 'PENDING'>; dissentingOpinion?: string; dissentingReason?: string }) {
  return api.post<SignPacketResponse>(`/bid/projects/${projectId}/sign-packet/experts/${expertId}/register`, dto);
}

export function unregisterSign(projectId: string, expertId: string) {
  return api.post<SignPacketResponse>(`/bid/projects/${projectId}/sign-packet/experts/${expertId}/unregister`, {});
}

// multipart 一律走 api.upload（POST + FormData、不设 Content-Type）；
// 勿用 api.post 传 FormData——它会 JSON.stringify(body) 且强制 application/json。
