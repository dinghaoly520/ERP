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

export function generateSummary(id: string) {
  return api.post<{ summary: string }>(`/announcements/${id}/generate-summary`, {});
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

/** 从已有本地对象挂载公告附件（引用项目采购文件，后端复制到 MinIO） */
export function attachFromObject(
  announcementId: string,
  data: { objectKey: string; fileName?: string; title?: string; mimeType?: string; size?: number },
) {
  return api.post<AnnouncementAttachment>(
    `/announcements/${announcementId}/attachments/from-object`,
    data,
  );
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
import type {
  AnnouncementCategory,
  AnnouncementDraft,
} from "@/lib/types/announcement";
import type { ReadyTenderDocumentType } from "@/lib/types/tender-write";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

function parseErrorMessage(text: string) {
  const trimmed = text.trim();
  return trimmed || "导出失败，请稍后重试。";
}

function parseFileName(disposition: string | null) {
  if (!disposition) return null;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] ?? null;
}

export async function exportAnnouncementDocument(payload: {
  tenderType: ReadyTenderDocumentType;
  category: AnnouncementCategory;
  draft: AnnouncementDraft;
}) {
  const response = await fetch(`${API_BASE}/tender-write/export-announcement`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return {
    blob: await response.blob(),
    fileName:
      parseFileName(response.headers.get("content-disposition")) ??
      "公告.docx",
  };
}

export type WinningBidImporter = {
  name: string;
  price: string;
};

export async function importWinningBidFromPdf(file: File): Promise<
  WinningBidImporter[]
> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE}/tender-write/import-winning-bid`,
    {
      method: "POST",
      credentials: "include",
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return response.json();
}

// ─── 中标通知书 ───

export type NotificationExtractedData = {
  projectName: string;
  winnerName: string;
  winnerPrice: string;
  department: string;
  controlPrice: string;
  extractedText: string;
};

export type NotificationLetterDraft = {
  projectName: string;
  winnerName: string;
  winnerPrice: string;
  winnerPriceChinese: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  signatureDate: string;
  department: string;
  controlPrice: string;
  category: string;
  project: string;
  procurementMethod: string;
  remark: string;
};

export async function extractNotificationData(
  file: File,
): Promise<NotificationExtractedData> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE}/tender-write/extract-notification-data`,
    {
      method: "POST",
      credentials: "include",
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return response.json();
}

export async function exportNotificationLetter(
  draft: NotificationLetterDraft,
) {
  const response = await fetch(
    `${API_BASE}/tender-write/export-notification`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    },
  );

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return {
    blob: await response.blob(),
    fileName:
      parseFileName(response.headers.get("content-disposition")) ??
      "中标通知书.docx",
  };
}

export async function exportNotificationLedger(
  draft: NotificationLetterDraft,
) {
  const response = await fetch(
    `${API_BASE}/tender-write/export-notification-ledger`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    },
  );

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return {
    blob: await response.blob(),
    fileName:
      parseFileName(response.headers.get("content-disposition")) ??
      "中标通知书台账.xlsx",
  };
}

// ─── 台账管理 ───

export async function fetchNotificationLedger(): Promise<string[][]> {
  const response = await fetch(`${API_BASE}/tender-write/notification-ledger`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return response.json();
}

export async function updateNotificationLedger(rows: unknown[][]) {
  const response = await fetch(`${API_BASE}/tender-write/notification-ledger`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return {
    blob: await response.blob(),
    fileName:
      parseFileName(response.headers.get("content-disposition")) ??
      "中标通知书台账.xlsx",
  };
}

/** 解析项目 TENDER_DOCUMENT 阶段 .docx 文件，用 AI 提取公告字段 */
export type ParsedAnnouncementFields = {
  fields: Record<string, string>;
  extractedText: string;
} | null;

export function parseAnnouncementFields(projectId: string) {
  return api.post<ParsedAnnouncementFields>(
    `/project-management/${projectId}/parse-announcement-fields`,
    {},
  );
}
