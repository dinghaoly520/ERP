import { api } from '../api';

/* ── 信息发布中心视图模型 ── */

export type AnnouncementType = 'BID_NOTICE' | 'WIN_NOTICE' | 'POLICY' | 'PLATFORM';
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface AnnouncementAttachment {
  id: string;
  announcementId: string;
  fileAssetId: string;
  title: string;
  createdAt: string;
  fileAsset: { id: string; originalName: string; size: number; mimeType: string };
}

export interface AnnouncementListItem {
  id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  status: AnnouncementStatus;
  summary?: string;
  aiSummary?: string;
  publishDate?: string;
  isTop: boolean;
  viewCount: number;
  relatedProjectCode?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  attachments?: AnnouncementAttachment[];
  bidDocument?: { id: string; title: string; accessScope: string; requirePayment: boolean; price: number | null; downloadCount: number } | null;
}

export interface BidDocumentAccess {
  supplierId: string;
  supplierName: string;
  eligible: boolean;
  paid: boolean;
  paidAt?: string;
  paymentRef?: string;
  downloadCount: number;
  lastDownloadAt?: string;
}

export interface BidDocumentManage {
  id: string;
  announcementId: string;
  title: string;
  accessScope: 'OPEN' | 'INVITED';
  requirePayment: boolean;
  price: number | null;
  bidProjectId: string | null;
  downloadCount: number;
  fileName: string;
  fileSize: number;
  allowedSupplierIds: string[];
  accesses: BidDocumentAccess[];
}

export interface AnnouncementListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: AnnouncementListItem[];
}

/* ── 公告 CRUD ── */

export function listAnnouncements(params?: { type?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
  const q = new URLSearchParams();
  if (params?.type) q.set('type', params.type);
  if (params?.status) q.set('status', params.status);
  if (params?.search) q.set('search', params.search);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  return api.get<AnnouncementListResponse>(`/announcements?${q.toString()}`);
}

export function getAnnouncement(id: string) {
  return api.get<AnnouncementListItem>(`/announcements/${id}`);
}

export function getAnnouncementStats() {
  return api.get<{ total: number; published: number; bidNotice: number; winNotice: number; policy: number }>('/announcements/stats');
}

export function createAnnouncement(data: {
  title: string; content: string; type: AnnouncementType;
  summary?: string; publishDate?: string; isTop?: boolean; relatedProjectCode?: string; metadata?: Record<string, any>; status?: AnnouncementStatus;
}) {
  return api.post<AnnouncementListItem>('/announcements', data);
}

export function updateAnnouncement(id: string, data: Partial<{
  title: string; content: string; type: AnnouncementType; summary: string; status: AnnouncementStatus;
  publishDate: string; isTop: boolean; relatedProjectCode: string; metadata: Record<string, any>;
}>) {
  return api.put<AnnouncementListItem>(`/announcements/${id}`, data);
}

export function deleteAnnouncement(id: string) {
  return api.delete<{ deleted?: boolean }>(`/announcements/${id}`);
}

/** 招标公示投标情况：参与供应商 + 是否已投标（只读） */
export interface Participant {
  supplierName: string;
  classification?: string;
  downloadStatus: string;
  submitStatus: string;
  submitted: boolean;
  withdrawn: boolean;
  submittedAt?: string | null;
  bidPrice?: string | null;
}
export interface ParticipantsResult {
  project: { name: string; projectCode: string; stage: string; deadline: string } | null;
  suppliers: Participant[];
  stats: { total: number; submitted: number };
}
export function getParticipants(id: string) {
  return api.get<ParticipantsResult>(`/announcements/${id}/participants`);
}

/* ── 普通附件 ── */

export function listAttachments(announcementId: string) {
  return api.get<AnnouncementAttachment[]>(`/announcements/${announcementId}/attachments`);
}
export function addAttachment(announcementId: string, fileAssetId: string, title?: string) {
  return api.post<AnnouncementAttachment>(`/announcements/${announcementId}/attachments`, { fileAssetId, title });
}
export function removeAttachment(attachmentId: string) {
  return api.delete<{ deleted: boolean }>(`/announcements/attachments/${attachmentId}`);
}

/** 上传文件（沿用既有 /upload），返回 fileAsset 信息 */
export function uploadFile(file: File, category = 'announcement') {
  const fd = new FormData();
  fd.append('file', file);
  return api.postForm<{ id: string; key: string; url: string; originalName: string; size: number; mimeType: string }>(`/upload?category=${category}`, fd);
}

/* ── 招标文件（加密 + 受控分发）── */

export function getBidDocument(announcementId: string) {
  return api.get<BidDocumentManage | null>(`/announcements/${announcementId}/bid-document`);
}

export function updateBidDocumentConfig(announcementId: string, data: {
  accessScope?: 'OPEN' | 'INVITED';
  requirePayment?: boolean;
  price?: number;
  bidProjectId?: string;
  title?: string;
  allowedSupplierIds?: string[];
}) {
  return api.put<BidDocumentManage>(`/announcements/${announcementId}/bid-document`, data);
}

export function confirmBidDocPayment(announcementId: string, supplierId: string, paymentRef?: string) {
  return api.post<{ success: boolean }>(`/announcements/${announcementId}/bid-document/confirm-payment`, { supplierId, paymentRef });
}

export function removeBidDocument(announcementId: string) {
  return api.delete<{ deleted: boolean }>(`/announcements/${announcementId}/bid-document`);
}

/** 上传加密招标文件（multipart） */
export function uploadBidDocument(announcementId: string, file: File, config: {
  title?: string; accessScope: 'OPEN' | 'INVITED';
  requirePayment: boolean; price?: number; bidProjectId?: string; allowedSupplierIds?: string[];
}) {
  const fd = new FormData();
  fd.append('file', file);
  if (config.title) fd.append('title', config.title);
  fd.append('accessScope', config.accessScope);
  fd.append('requirePayment', String(config.requirePayment));
  if (config.price !== undefined) fd.append('price', String(config.price));
  if (config.bidProjectId) fd.append('bidProjectId', config.bidProjectId);
  if (config.allowedSupplierIds?.length) fd.append('allowedSupplierIds', config.allowedSupplierIds.join(','));
  return api.postForm<BidDocumentManage>(`/announcements/${announcementId}/bid-document`, fd);
}
