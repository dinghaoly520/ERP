import { api, type ReqOpts } from "../api";
import type { OpeningFieldDef } from "../opening-fields";

/** 公开唱标行（大厅脱敏视图：不含异议裁决过程字段） */
export interface OpeningRecordRow {
  id: string;
  bidSupplierId: string;
  supplierName: string;
  amount: string | null;
  /** dual-v2 报价单位（万元）——裸数字勿按「元」渲染 */
  amountUnit?: string | null;
  period: string | null;
  qualityTarget: string | null;
  bondStatus: string | null;
  /** A-113：动态唱标字段值（{ [key]: string }） */
  customFields?: Record<string, string> | null;
  decryptResult: string | null;
  confirmStatus: string;
  confirmedAt: string | null;
}

/** A-113：公开唱标表响应——records + 项目级字段配置（列表端点附带，null 配置由后端解析为默认四字段） */
export interface OpeningRecordsResponse {
  fieldConfig: { fields: OpeningFieldDef[] };
  records: OpeningRecordRow[];
}

export const supplierApi = {
  // Profile
  getProfile() {
    return api.get<any>("/supplier-portal/profile");
  },
  getStatus() {
    return api.get<any>("/supplier-portal/status", { silent: true });
  },
  getDashboardStats() {
    return api.get<any>("/supplier-portal/dashboard-stats");
  },

  // ── CA 证书（双信封 v2 · U盾管理）──
  getAdminCert() {
    return api.get<any>("/supplier-portal/admin-cert");
  },
  listMyCerts() {
    return api.get<any[]>("/supplier-portal/profile/cert");
  },
  /** 绑定 PoP 挑战：一次性 nonce（Redis 300s TTL），客户端 adapter.sign 后随绑定提交 */
  certBindChallenge() {
    return api.get<{ nonce: string; expiresIn: number }>("/supplier-portal/profile/cert/challenge");
  },
  bindCert(data: { certSn?: string; certDn?: string; publicKey?: string; alg?: string; notBefore?: string; expiresAt?: string; rawCert?: string; popNonce?: string; popSignature?: string }) {
    return api.post<any>("/supplier-portal/profile/cert", data);
  },
  revokeCert(certId: string) {
    return api.delete<any>(`/supplier-portal/profile/cert/${certId}`);
  },

  // ── SCCA CA 绑定链（阶段1：/api/auth/ca + /api/ca）──
  caReauth(data: { password: string; action: string; targetBindingId?: string; expectedActiveBindingId?: string }) {
    return api.post<{ credentialProofId: string; operationDigest: string; expiresAt: string }>('/auth/ca/reauth', data);
  },
  caBindChallenge(credentialProofId: string, signCertPem: string, encCertPem: string) {
    return api.post<{ challengeId: string; operationId: string; toSign: string; expiresAt: string; purpose: string; expectedActiveBindingId: string | null }>(
      '/ca/bind-challenge', { credentialProofId, signCertPem, encCertPem });
  },
  caBind(data: { credentialScheme: string; challengeId: string; signP7: string; credentialProofId: string; signCertPem: string; encCertPem: string; expectedActiveBindingId?: string | null }) {
    return api.post<any>('/ca/bind', data);
  },
  caCapabilities() {
    return api.get<any>('/ca/capabilities', { silent: true });
  },

  // ── SCCA dual-v3 投递链（阶段2 Task11：prepare → signing-payload → submit）──
  caPrepare(projectId: string, action: string, baseRevision?: number) {
    return api.post<{ operationId: string; canonical: string; expiresAt: string }>(
      `/supplier-portal/bid-submissions/${projectId}/operations/prepare`,
      { action, ...(baseRevision !== undefined ? { baseRevision } : {}) },
    );
  },
  caSigningPayload(projectId: string, operationId: string, envelope: unknown) {
    return api.post<{ canonical: string; canonicalSha256: string; signatureFormat: 'scca-pkcs7-base64' }>(
      `/supplier-portal/bid-submissions/${projectId}/operations/${operationId}/signing-payload`,
      { envelope },
    );
  },
  /** dual-v3 补传锚点（阶段2.5 T1）：roles 明文哈希+sealedFields 自版本快照 */
  getReuploadContext(projectId: string) {
    return api.get<any>(`/supplier-portal/bid-submissions/${projectId}/reupload-context`);
  },
  /** dual-v3 补传（阶段2.5 T2）：六闸+CAS 版本推进 */
  reuploadV3(projectId: string, body: { operationId: string; signatureFormat: string; signP7: string; baseRevision: number }) {
    return api.post<any>(`/supplier-portal/bid-submissions/${projectId}/reupload-v3`, body);
  },

  /** 开标解密包（Task9）：v3 返回 kself P7/innerSha256/revision/envelopeDigest */
  getOpeningPackage(projectId: string) {
    return api.get<any>(`/supplier-portal/bid-submissions/${projectId}/opening-package`);
  },
  /** 解密上传（Task9）：明文 multipart + fieldsJson/nonce + P7 证明 */
  caDecryptUpload(projectId: string, fd: FormData): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/supplier-portal/bid-submissions/${projectId}/decrypt-upload`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Portal', 'supplier');
      xhr.timeout = 180000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
        } else {
          try { reject(new Error(JSON.parse(xhr.responseText)?.error ?? `解密上传失败(${xhr.status})`)); }
          catch { reject(new Error(`解密上传失败(${xhr.status})`)); }
        }
      };
      xhr.onerror = () => reject(new Error('网络异常，解密上传失败'));
      xhr.send(fd);
    });
  },
  /** C_outer 密文暂存（Task5 端点）——multipart，服务端实算 outerSha256；onProgress 供投递页逐文件进度条 */
  caUploadEncryptedOuter(projectId: string, blob: Blob, filename: string, onProgress?: (pct: number) => void): Promise<{ fileAssetId: string; outerSha256: string; outerBytes: number; expiresAt: string }> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', blob, filename);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/supplier-portal/bid-submissions/${projectId}/encrypted-assets`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Portal', 'supplier');
      xhr.timeout = 180000;
      if (onProgress) {
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
        } else {
          try { reject(new Error(JSON.parse(xhr.responseText)?.error ?? `上传失败(${xhr.status})`)); }
          catch { reject(new Error(`上传失败(${xhr.status})`)); }
        }
      };
      xhr.onerror = () => reject(new Error('网络异常，密文上传失败'));
      xhr.send(fd);
    });
  },

  // Contacts
  listContacts() {
    return api.get<any[]>("/supplier-portal/contacts");
  },
  addContact(data: any) {
    return api.post<any>("/supplier-portal/contacts", data);
  },
  updateContact(contactId: string, data: any) {
    return api.put<any>(`/supplier-portal/contacts/${contactId}`, data);
  },
  deleteContact(contactId: string) {
    return api.delete<any>(`/supplier-portal/contacts/${contactId}`);
  },

  // Qualifications
  listQualifications() {
    return api.get<any[]>("/supplier-portal/qualifications");
  },
  addQualification(data: any) {
    return api.post<any>("/supplier-portal/qualifications", data);
  },
  deleteQualification(qualificationId: string) {
    return api.delete<any>(`/supplier-portal/qualifications/${qualificationId}`);
  },

  // Change requests
  listChangeRecords() {
    return api.get<any[]>("/supplier-portal/change-records");
  },
  createChangeRequest(data: any) {
    return api.post<any>("/supplier-portal/change-requests", data);
  },

  // Evaluations
  listEvaluations() {
    return api.get<any[]>("/supplier-portal/evaluations");
  },
  getEvaluationStats() {
    return api.get<any>("/supplier-portal/evaluation-stats");
  },

  // Bid submissions
  listBidSubmissions() {
    return api.get<any[]>("/supplier-portal/bid-submissions");
  },
  getBidSubmission(projectId: string) {
    return api.get<any>(`/supplier-portal/bid-submissions/${projectId}`);
  },
  saveBidDraft(projectId: string, data: any) {
    return api.post<any>(`/supplier-portal/bid-submissions/${projectId}/draft`, data);
  },
  submitBid(projectId: string, data: any) {
    return api.post<any>(`/supplier-portal/bid-submissions/${projectId}/submit`, data);
  },
  /** W11-①（A-101）：投标回执 SM2 签名——取待签负载/提交签名 */
  getReceiptPayload(submissionId: string, opts?: ReqOpts) {
    return api.get<{ payload: Record<string, unknown>; canonical: string }>(`/supplier-portal/bid-submissions/${submissionId}/receipt-payload`, opts);
  },
  /** 回执 P7 强签（dual-v3）：operationId+signP7（阶段2 收尾） */
  signReceiptV3(submissionId: string, body: { operationId: string; signatureFormat: string; signP7: string }) {
    return api.post<any>(`/supplier-portal/bid-submissions/${submissionId}/receipt-signature`, body);
  },

  signReceiptSignature(submissionId: string, signature: string) {
    return api.post(`/supplier-portal/bid-submissions/${submissionId}/receipt-signature`, { signature });
  },
  /** W11-①（A-101）：回执重验签——服务端对存档签名负载只读复验，供核验面板显示结论 */
  verifyReceiptSignature(submissionId: string, opts?: ReqOpts) {
    return api.get<{
      signed: boolean;
      verified?: boolean;
      reason?: string;
      algorithm?: string;
      archivedVerifiedAt?: string | null;
    }>(`/supplier-portal/bid-submissions/${submissionId}/receipt-verify`, opts);
  },

  withdrawSubmission(submissionId: string) {
    return api.post<any>(`/supplier-portal/bid-submissions/${submissionId}/withdraw`);
  },

  // 开标确认（供应商侧）
  getOpeningRecord(projectId: string) {
    return api.get<any>(`/supplier-portal/bid-submissions/${projectId}/opening-record`);
  },
  // 唱标记录列表（大厅公开视图：自 OPENING 起向全体投标人公开各家唱标信息）
  // A-113：响应附带项目级 fieldConfig——公开总表与本司对比区按同一 config 渲染动态字段
  getOpeningRecords(projectId: string) {
    return api.get<OpeningRecordsResponse>(`/supplier-portal/bid-submissions/${projectId}/opening-records`);
  },
  /** A-114：开标确认待签负载（待确认=首次确认签名；已确认未签名=补签，purpose 由服务端按记录态派生） */
  getOpeningConfirmPayload(projectId: string) {
    return api.get<{ payload: Record<string, unknown>; canonical: string }>(`/supplier-portal/bid-submissions/${projectId}/opening-confirm-payload`);
  },
  // A-114：确认/补签单端点双语义（服务端按记录态自动分辨），body 签名必填
  /** 开标确认（dual-v3 P7 强签）：operationId+signP7 */
  confirmOpeningV3(projectId: string, body: { operationId: string; signatureFormat: string; signP7: string }) {
    return api.post<any>(`/supplier-portal/bid-submissions/${projectId}/opening-confirm`, body);
  },

  confirmOpening(projectId: string, signature: string) {
    return api.post<any>(`/supplier-portal/bid-submissions/${projectId}/opening-confirm`, { signature });
  },
  disputeOpening(projectId: string, reason: string) {
    return api.post<any>(`/supplier-portal/bid-submissions/${projectId}/opening-dispute`, { reason });
  },

  // Password
  changePassword(oldPassword: string, newPassword: string) {
    return api.post<any>("/supplier-portal/change-password", { oldPassword, newPassword }, { silent: true });
  },

  /** 临时供应商申请转为正式（补全企业+联系人+资质资料，提交审批） */
  convertToRegular(data: {
    enterpriseType: string; legalPerson: string; legalPersonIdCard: string; legalIdFileUrl: string; registeredAddress: string; businessScope: string; creditCode: string;
    contacts: { name: string; phone: string; email?: string; isPrimary?: boolean }[];
    qualifications: { type: string; name: string; fileUrl?: string; validFrom?: string; validTo?: string }[];
  }) {
    return api.post<any>("/supplier-portal/convert-request", data);
  },
};


/** 已完成项目行（合作历史：ARCHIVED 归档 / ABORTED 流标） */
export interface CompletedProjectRow {
  projectId: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  stage: string;
  completedAt: string;
  outcome: "AWARDED" | "PARTICIPATED" | "INVITED" | "ABORTED";
  awardAmount: any;
  awardRoundNo: number | null;
  myBidPrice: string | null;
  submittedAt: string | null;
  submitStatus: string;
}

export const completedProjectsApi = {
  list() {
    return api.get<CompletedProjectRow[]>("/supplier-portal/completed-projects");
  },
};

// ── 公司归属管理（多公司归属 2026-10-16；唯一通道=自主申请）──
// 已由 controller HTTP-shaped：不含 supplierId/reviewedById
export interface CompanyLinkView {
  id: string;
  companyId: string;
  companyName: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "DISABLED";
  reviewStage: string | null;
  note: string | null;
  rejectReason: string | null;
  isPrimary: boolean;
  appliedAt: string | null;
}

export const supplierCompanyLinksApi = {
  /** 我的归属列表（silent：页面自行提示加载失败） */
  my() {
    return api.get<CompanyLinkView[]>("/supplier-portal/company-links", { silent: true });
  },
  /** 申请加入公司（companyId/companyName 二选一；公司只读解析不建档，不存在 400 COMPANY_NOT_FOUND；silent：错误文案由页面 toast） */
  apply(dto: { companyId?: string; companyName?: string; note?: string }) {
    return api.post<{ id: string }>("/supplier-portal/company-links/apply", dto, { silent: true });
  },
};
