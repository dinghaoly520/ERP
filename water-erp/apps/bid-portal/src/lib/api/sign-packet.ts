import { api } from '@/lib/api';

export type SignStatusValue = 'PENDING' | 'SIGNED' | 'REFUSED_DISSENT' | 'DEEMED_AGREED';

export interface SignPacketExpertRow {
  expertId: string;
  name: string;
  major: string;
  role: string;
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

// uploadExpertScan / uploadSignaturePageScan / registerSign / unregisterSign 由 Task 8 追加
// （本任务仅状态读取 + 生成/下载/回流；multipart 注意点见 Task 8）。
