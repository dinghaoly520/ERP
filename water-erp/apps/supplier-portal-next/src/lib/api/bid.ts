import { api, qs } from "../api";

/** A-143：寻址本司的评标澄清（列表为剥离签名 payload 后的摘要行） */
export interface SupplierBidClarification {
  id: string;
  projectId: string;
  type: string;
  question: string;
  issuer: string;
  supplierName: string;
  status: string;
  reply: string | null;
  replyChannel: string | null;
  replySignature: { algorithm?: string; certSn?: string; verifiedAt?: string } | null;
  replyAttachmentIds: { fileAssetId: string; name: string; sha256: string }[] | null;
  replyByName: string | null;
  replyOfflineReason?: string | null;
  aiSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export const bidApi = {
  // 投标机会列表（供应商端，仅公开字段）
  listProjects(params?: { page?: number; pageSize?: number; search?: string; scope?: string }) {
    return api.get<any>(`/supplier-portal/bid-projects${qs(params)}`);
  },
  getProject(id: string) {
    return api.get<any>(`/supplier-portal/bid-projects/${id}`);
  },
  // AI 融合概览（采购内容 + 通知 + 两个时间）
  getProjectOverview(id: string) {
    return api.get<any>(`/supplier-portal/bid-projects/${id}/overview`);
  },
  // 招标文件（通过项目 → 公告 relatedProjectCode 关联）
  getProjectBidDocument(projectId: string) {
    return api.get<any>(`/supplier-portal/bid-projects/${projectId}/bid-document`);
  },
  // 谈判采购文件（受邀项目，获取窗口内可下载）
  getNegotiationFiles(projectId: string) {
    return api.get<any>(`/supplier-portal/bid-projects/${projectId}/negotiation-files`);
  },
  // 澄清说明文案（只读，由采购管理端编辑发布）
  getClarificationNotice() {
    return api.get<any>("/system-config/clarification-notice");
  },
  // P2c: 多轮报价
  getMyBidSupplier(projectId: string) {
    return api.get<any>(`/supplier-portal/projects/${projectId}/my-bid-supplier`);
  },
  listRounds(projectId: string) {
    return api.get<any[]>(`/supplier-portal/projects/${projectId}/rounds`);
  },
  getMyQuotes(projectId: string) {
    return api.get<any[]>(`/supplier-portal/projects/${projectId}/my-quotes`);
  },
  submitQuote(projectId: string, roundId: string, data: { bidSupplierId: string; quotePrice: number }) {
    return api.post<any>(`/supplier-portal/projects/${projectId}/rounds/${roundId}/quote`, data);
  },
  getRoundQuotes(projectId: string, roundId: string) {
    return api.get<any[]>(`/supplier-portal/projects/${projectId}/rounds/${roundId}/quotes`);
  },

  /* ── W1 招标文件澄清与修改（CTS A-80~A-86，B-011/012）── */

  listTenderClarifications(projectId: string) {
    return api.get<{
      questions: Array<{ id: string; supplierName: string; question: string; answer: string | null; status: string; createdAt: string }>;
      docs: Array<{ id: string; version: number; title: string; content: string; receipt: { receiptedAt: string } | null }>;
    }>(`/supplier-portal/projects/${projectId}/clarifications`);
  },

  askTenderClarification(projectId: string, question: string) {
    return api.post(`/supplier-portal/projects/${projectId}/clarifications`, { question });
  },

  downloadTenderClarificationDoc(projectId: string, docId: string) {
    return api.post<{ id: string; version: number; title: string; content: string; fileUrl: string | null }>(
      `/supplier-portal/projects/${projectId}/clarification-docs/${docId}/download`,
    );
  },

  /* ── A-143：评标澄清在线答复（编辑+附件+U盾 SM2 电子签名提交）── */

  /** 寻址本司的评标澄清列表（仅本人可见；EVALUATING 可答，ARCHIVED 只读） */
  listMyBidClarifications(projectId: string) {
    return api.get<SupplierBidClarification[]>(`/supplier-portal/projects/${projectId}/bid-clarifications`);
  },

  /** 取待签 canonical 串（无状态、不落库）——前端 U盾直接对此串签名 */
  getClarificationReplyPayload(
    projectId: string,
    cid: string,
    body: { reply: string; attachmentIds: string[]; certSn: string },
  ) {
    return api.post<{ payload: string }>(
      `/supplier-portal/projects/${projectId}/bid-clarifications/${cid}/reply-payload`,
      body,
    );
  },

  /** 提交签名答复（服务端重算 canonical + SM2 验签 + 落库） */
  submitClarificationReply(
    projectId: string,
    cid: string,
    body: { reply: string; attachmentIds: string[]; certSn: string; signature: string },
  ) {
    return api.post<SupplierBidClarification>(
      `/supplier-portal/projects/${projectId}/bid-clarifications/${cid}/reply`,
      body,
    );
  },
};
