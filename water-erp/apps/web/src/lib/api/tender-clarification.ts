import { api } from '../api';

/* ── W1 招标文件澄清与修改（CTS A-80~A-86）：:3005 澄清工作台 ── */

export interface ClarificationQuestion {
  id: string; supplierName: string; question: string; answer: string | null;
  status: string; createdAt: string;
}
export interface ClarificationDocReceipt { supplierName: string; receiptedAt: string }
export interface ClarificationDoc {
  id: string; version: number; title: string; content: string; status: string;
  publishedAt: string | null; receipts: ClarificationDocReceipt[];
}
export interface ClarificationWorkbench {
  questions: ClarificationQuestion[];
  docs: ClarificationDoc[];
}

export function getClarifications(bidProjectId: string) {
  return api.get<ClarificationWorkbench>(`/tender-clarification/projects/${bidProjectId}`);
}

export function answerClarification(bidProjectId: string, qid: string, answer: string) {
  return api.post(`/tender-clarification/projects/${bidProjectId}/questions/${qid}/answer`, { answer });
}

export function createClarificationDoc(bidProjectId: string, body: { title: string; content?: string; fileAssetId?: string }) {
  return api.post<ClarificationDoc>(`/tender-clarification/projects/${bidProjectId}/docs`, body);
}

export function publishClarificationDoc(bidProjectId: string, docId: string) {
  return api.post<ClarificationDoc & { notifiedCount?: number }>(`/tender-clarification/projects/${bidProjectId}/docs/${docId}/publish`);
}

export function deleteClarificationDoc(bidProjectId: string, docId: string) {
  return api.delete<{ ok: true }>(`/tender-clarification/projects/${bidProjectId}/docs/${docId}`);
}
