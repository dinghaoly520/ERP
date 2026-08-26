import { api } from '../api';

/* ── C6（GB/T 43711 4.1.4）：采购人异议/投诉管理 ── */

export interface SupplierObjectionItem {
  id: string;
  announcementId?: string | null;
  projectCode?: string | null;
  supplierName: string;
  phase: 'document' | 'prequalification' | 'result';
  title: string;
  content: string;
  status: 'open' | 'answered' | 'complaint' | 'closed';
  answer?: string | null;
  answeredByName?: string | null;
  answeredAt?: string | null;
  escalationNote?: string | null;
  createdAt: string;
}

export function listObjections(params?: { status?: string; phase?: string; q?: string }) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.phase) sp.set('phase', params.phase);
  if (params?.q) sp.set('q', params.q);
  const qs = sp.toString();
  return api.get<SupplierObjectionItem[]>(`/objections${qs ? `?${qs}` : ''}`);
}

export function answerObjection(id: string, answer: string) {
  return api.post<SupplierObjectionItem>(`/objections/${id}/answer`, { answer });
}

export function escalateObjection(id: string, note?: string) {
  return api.post<SupplierObjectionItem>(`/objections/${id}/escalate`, { note });
}

export function closeObjection(id: string, note?: string) {
  return api.post<SupplierObjectionItem>(`/objections/${id}/close`, { note });
}
