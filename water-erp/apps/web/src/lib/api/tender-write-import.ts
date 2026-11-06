import type { ReadyTenderDocumentType } from '@/lib/types/tender-write';
import type { AnnouncementImportAutofillResult, ImportAutofillResult } from '@/lib/types/tender-write-import';
import { api } from '../api';

/** 上传选项（2026-11-06 上传进度条）：字节进度+取消 */
export type UploadOpts = { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal };

export async function importAutofill(
  documentType: ReadyTenderDocumentType,
  files: File[],
  opts?: UploadOpts,
): Promise<ImportAutofillResult> {
  const formData = new FormData();
  formData.append('documentType', documentType);

  for (const file of files) {
    formData.append('files', file);
  }

  // api.upload XHR 轨（2026-11-06）：X-Portal/X-Web-Token 由 client 统一注入，
  // 错误经 ApiError（后端 error 文案）抛出，与旧 toApiError 版语义一致。
  return api.upload<ImportAutofillResult>('/tender-write/import-autofill', formData, opts);
}

/** 公告导入识别（2026-11-03）：按（公告类别 × 采购方式）字段表识别，确认后由公告编辑器回填草稿 */
export async function announcementImportAutofill(
  category: 'procurement_document' | 'failed_bid' | 'winning_bid',
  tenderType: string,
  files: File[],
  opts?: UploadOpts,
): Promise<AnnouncementImportAutofillResult> {
  const formData = new FormData();
  formData.append('category', category);
  formData.append('tenderType', tenderType);
  for (const file of files) {
    formData.append('files', file);
  }
  return api.upload<AnnouncementImportAutofillResult>('/tender-write/announcement-import-autofill', formData, opts);
}
