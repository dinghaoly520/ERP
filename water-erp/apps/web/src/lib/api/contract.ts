import { api } from '../api';

/* ── C2/C3/C4（GB/T 43711 7.5.4/7.6/7.5.4.4）：采购合同订立·履行·验收 ── */

export type ContractStatus =
  | 'drafting'
  | 'internal_review'
  | 'approved_for_signing'
  | 'signed'
  | 'performing'
  | 'accepted'
  | 'terminated';
export type FulfillmentType = 'delivery' | 'payment' | 'acceptance';

export interface ContractProofAsset {
  id: string;
  originalName: string;
  size: number;
  sha256: string;
  mimeType: string;
  createdAt: string;
}

export interface ContractFulfillment {
  id: string;
  contractId: string;
  type: FulfillmentType;
  title: string;
  dueDate?: string | null;
  doneDate?: string | null;
  amount?: number | null;
  status: 'pending' | 'done' | 'exception';
  proofAssetId?: string | null;
  proofAsset?: ContractProofAsset | null;
  note?: string | null;
}

export interface Contract {
  id: string;
  contractCode: string;
  projectId?: string | null;
  projectCode: string;
  projectManagementItemId?: string | null;
  supplierName: string;
  supplierId: string;
  contractType: 'standard' | 'order';
  status: ContractStatus;
  amount?: number | null;
  signDeadline?: string | null;
  signedAt?: string | null;
  keyTerms?: Record<string, any> | null;
  draftAssetId?: string | null;
  signedAssetId?: string | null;
  signedAsset?: ContractProofAsset | null;
  consistencyResult?: { checkedAt: string; manualConfirm: boolean; source: string; consistent: boolean; issues: Array<{ field: string; expected: string; actual: string }> } | null;
  reviewNote?: string | null;
  fulfillments: ContractFulfillment[];
  createdAt: string;
}

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  drafting: '草拟',
  internal_review: '内审中',
  approved_for_signing: '内审通过·待签署',
  signed: '已签署',
  performing: '履行中',
  accepted: '已验收',
  terminated: '已终止',
};
export const FULFILLMENT_LABEL: Record<FulfillmentType, string> = { delivery: '交付', payment: '付款', acceptance: '验收' };

export function contractProofAssetUrl(assetId: string | null | undefined) {
  return assetId ? `/api/upload/files/${encodeURIComponent(assetId)}` : null;
}

export function canCompleteContractFulfillment(
  fulfillment: Pick<ContractFulfillment, 'proofAssetId' | 'proofAsset'>,
  hasSelectedProof: boolean,
) {
  return Boolean(fulfillment.proofAssetId || fulfillment.proofAsset?.id || hasSelectedProof);
}

export function canAcceptContract(
  fulfillments: Array<Pick<ContractFulfillment, 'type' | 'status' | 'proofAssetId' | 'proofAsset'>>,
  hasSelectedProof: boolean,
) {
  if (hasSelectedProof) return true;
  return fulfillments.some(fulfillment => (
    fulfillment.type === 'acceptance'
    && fulfillment.status === 'done'
    && Boolean(fulfillment.proofAssetId || fulfillment.proofAsset?.id)
  ));
}

export function canRegisterContractSigning(status: ContractStatus, hasSelectedSignedAsset: boolean) {
  return (status === 'approved_for_signing' || status === 'signed') && hasSelectedSignedAsset;
}

function formatProofSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function formatContractProofMetadata(asset: ContractProofAsset) {
  const createdAt = new Date(asset.createdAt);
  return {
    name: asset.originalName,
    size: formatProofSize(asset.size),
    sha256: asset.sha256,
    mimeType: asset.mimeType,
    createdAt: Number.isNaN(createdAt.getTime())
      ? asset.createdAt
      : createdAt.toLocaleString('zh-CN', { hour12: false }),
  };
}

export function uploadContractProof(file: File) {
  const body = new FormData();
  body.append('file', file);
  return api.postForm<ContractProofAsset & { key: string; url: string; category: string }>(
    '/upload?category=contract_document',
    body,
  );
}

export function listContractsByProject(params: { projectManagementItemId?: string; projectCode?: string }) {
  const q = new URLSearchParams();
  if (params.projectManagementItemId) q.set('projectManagementItemId', params.projectManagementItemId);
  if (params.projectCode) q.set('projectCode', params.projectCode);
  return api.get<Contract[]>(`/contracts/by-project?${q.toString()}`);
}

export function createContract(data: {
  projectCode: string; projectManagementItemId?: string; supplierId?: string; supplierName: string;
  contractType?: string; amount?: number; signDeadline?: string; keyTerms?: Record<string, any>;
}) {
  return api.post<Contract>('/contracts', data);
}

export function runContractConsistency(id: string) {
  return api.post<Contract['consistencyResult']>(`/contracts/${id}/consistency`, {});
}

export function submitContractReview(id: string) {
  return api.post<Contract>(`/contracts/${id}/submit-review`, {});
}

export function reviewContract(id: string, data: { approved: boolean; note?: string }) {
  return api.post<Contract>(`/contracts/${id}/review`, data);
}

export function signContract(id: string, data: { signedAssetId?: string; signedAt?: string }) {
  return api.post<Contract>(`/contracts/${id}/sign`, data);
}

export function publishContractNotice(id: string) {
  return api.post<{ announcementId: string; created: boolean }>(`/contracts/${id}/contract-notice`, {});
}

export function generateContractDraftDocx(id: string) {
  return api.post<{ fileAssetId: string; objectKey: string; size: number }>(`/contracts/${id}/draft-docx`, {});
}

export function addContractFulfillment(id: string, data: { type: string; title: string; dueDate?: string; amount?: number; note?: string }) {
  return api.post<ContractFulfillment>(`/contracts/${id}/fulfillments`, data);
}

export function updateContractFulfillment(id: string, fid: string, data: { status?: string; doneDate?: string; proofAssetId?: string; note?: string }) {
  return api.post<ContractFulfillment>(`/contracts/${id}/fulfillments/${fid}`, data);
}

export function acceptContract(id: string, data: { note?: string; proofAssetId?: string; publishNotice?: boolean }) {
  return api.post<{ contract: Contract; announcementId: string | null }>(`/contracts/${id}/accept`, data);
}

export function terminateContract(id: string, reason: string) {
  return api.post<Contract>(`/contracts/${id}/terminate`, { reason });
}

/** C4：登记响应担保退还/不予退还（合同关联的 BidProject，项目级·兼容保留——UI 已切逐家端点） */
export function markBondReturned(projectId: string, data: { returned: boolean; reason?: string }) {
  return api.post<{ id: string; bondReturnedAt: string | null }>(`/bid/projects/${projectId}/bond-return`, data);
}

/** A-105（实施条例第57条）：保证金逐家退还行——花名册 × 唱标 bondStatus × 退还态 × 中标标识 */
export interface BondReturnRow {
  supplierName: string;
  bondStatus: string | null;
  bondReturnedAt: string | null;
  bondReturnReason: string | null;
  isWinner: boolean;
}

/** A-105：保证金逐家退还清单（bondRequired=false 时登记端点拒 NO_BOND） */
export function listBondReturns(projectId: string) {
  return api.get<{ bondRequired: boolean; rows: BondReturnRow[] }>(`/bid/projects/${projectId}/bond-returns`);
}

/** A-105：逐家登记保证金退还/不予退还（同步开标记录 bondStatus、记监督日志；不予退还必填理由） */
export function markSupplierBondReturned(projectId: string, data: { supplierName: string; returned: boolean; reason?: string }) {
  return api.post<{ success: boolean }>(`/bid/projects/${projectId}/bond-return-supplier`, data);
}
