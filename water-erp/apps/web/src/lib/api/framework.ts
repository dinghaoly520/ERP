import { api } from '../api';

/* ── B4（GB/T 43711 附录 D）：框架协议采购两阶段 ── */

export interface FaEntry {
  id: string;
  faId: string;
  supplierId?: string | null;
  supplierName: string;
  shareRatio?: number | null;
  status: 'active' | 'supplemented' | 'exited';
  entryAt: string;
  exitedAt?: string | null;
  note?: string | null;
}

export interface FrameworkAgreement {
  id: string;
  faCode: string;
  title: string;
  entryMode: 'closed' | 'open';
  variant: 'supplier_only' | 'supplier_price' | 'supplier_price_qty';
  catalogCategoryId?: number | null;
  projectManagementItemId?: string | null;
  validFrom: string;
  validUntil: string;
  priceRule?: Record<string, any> | null;
  quotaRule?: Record<string, any> | null;
  secondStageRule?: string | null;
  status: 'drafting' | 'entry' | 'active' | 'expired' | 'terminated';
  eliminationCheck?: { passed: boolean; detail: string; overrideReason?: string | null } | null;
  changeLog?: Array<{ at: string; action: string; note: string }> | null;
  entries: FaEntry[];
  createdAt: string;
}

export const FA_STATUS_LABEL: Record<string, string> = {
  drafting: '草拟', entry: '入围登记中', active: '生效中', expired: '已到期', terminated: '已终止',
};
export const FA_VARIANT_LABEL: Record<string, string> = {
  supplier_only: '定商', supplier_price: '定商定价', supplier_price_qty: '定商定价定量',
};
export const FA_ENTRY_MODE_LABEL: Record<string, string> = {
  closed: '封闭式竞争入围', open: '开放式资格审查',
};

export function listFrameworkAgreements(params?: { status?: string; q?: string }) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.q) sp.set('q', params.q);
  const qs = sp.toString();
  return api.get<FrameworkAgreement[]>(`/framework-agreements${qs ? `?${qs}` : ''}`);
}

export function createFrameworkAgreement(data: {
  title: string; entryMode?: string; variant?: string; catalogCategoryId?: number;
  projectManagementItemId?: string; validFrom: string; validUntil: string;
  priceRule?: Record<string, any>; quotaRule?: Record<string, any>; secondStageRule?: string;
}) {
  return api.post<FrameworkAgreement>('/framework-agreements', data);
}

export function addFaEntries(id: string, entries: Array<{ supplierName: string; supplierId?: string; shareRatio?: number; note?: string }>) {
  return api.post<FrameworkAgreement>(`/framework-agreements/${id}/entries`, { entries });
}

export function activateFrameworkAgreement(id: string, data: { rounds?: number; participants?: number; overrideReason?: string }) {
  return api.post<{ agreement: FrameworkAgreement; docx: { fileAssetId: string; size: number } }>(`/framework-agreements/${id}/activate`, data);
}

export function secondStageOrder(id: string, data: { entryId: string; title?: string; amount?: number; selectionRule?: string }) {
  return api.post<{ id: string; contractCode: string; supplierName: string }>(`/framework-agreements/${id}/second-stage-order`, data);
}

export function exitFaEntry(id: string, entryId: string, reason?: string) {
  return api.post<FaEntry>(`/framework-agreements/${id}/entries/${entryId}/exit`, { reason });
}

export function adjustFaPriceRule(id: string, priceRule: Record<string, any>, note: string) {
  return api.post<FrameworkAgreement>(`/framework-agreements/${id}/price-adjust`, { priceRule, note });
}

export function terminateFrameworkAgreement(id: string, reason: string) {
  return api.post<FrameworkAgreement>(`/framework-agreements/${id}/terminate`, { reason });
}
