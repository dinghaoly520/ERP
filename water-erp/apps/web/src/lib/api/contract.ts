import { api } from '../api';

/* ── C2/C3/C4（GB/T 43711 7.5.4/7.6/7.5.4.4）：采购合同订立·履行·验收 ── */

export type ContractStatus = 'drafting' | 'internal_review' | 'signed' | 'performing' | 'accepted' | 'terminated';
export type FulfillmentType = 'delivery' | 'payment' | 'acceptance';

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
  consistencyResult?: { checkedAt: string; manualConfirm: boolean; source: string; consistent: boolean; issues: Array<{ field: string; expected: string; actual: string }> } | null;
  reviewNote?: string | null;
  fulfillments: ContractFulfillment[];
  createdAt: string;
}

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  drafting: '草拟', internal_review: '内审中', signed: '已签署', performing: '履行中', accepted: '已验收', terminated: '已终止',
};
export const FULFILLMENT_LABEL: Record<FulfillmentType, string> = { delivery: '交付', payment: '付款', acceptance: '验收' };

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
  return api.post<{ supplierName: string; bondReturnedAt: string | null; bondReturnReason: string | null }>(`/bid/projects/${projectId}/bond-return-supplier`, data);
}
