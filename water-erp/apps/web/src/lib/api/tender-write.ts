import { apiFetch } from './api-fetch';
import { toApiError } from '@water-erp/client';
import type {
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  TenderDocumentType,
} from "@/lib/types/tender-write";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

function parseFileName(disposition: string | null) {
  if (!disposition) {
    return null;
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] ?? null;
}

export async function exportTenderDocument(payload: {
  documentType: ReadyTenderDocumentType;
  answers: ReadyTenderDraft;
  /** 项目编号（统一命名用，项目绑定场景传入） */
  projectCode?: string;
  /** 导出格式（2026-11-12）：pdf 走服务器 LibreOffice 转换，不可用回退 docx——回读 format 知实际产物 */
  format?: 'docx' | 'pdf';
}) {
  const response = await apiFetch(`${API_BASE}/tender-write/export`, {
    method: "POST",
    credentials: "include",
    // 裸 fetch 必须带 X-Portal 头，否则后端 portal-cookie 无法识别会话 → 401
    headers: { "Content-Type": "application/json", "X-Portal": "web" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await toApiError(response, '导出采购文件失败，请稍后重试。');
  }

  return {
    blob: await response.blob(),
    fileName:
      parseFileName(response.headers.get("content-disposition")) ??
      "招标文件.docx",
    /** 实际导出格式（X-Export-Format）：选 pdf 但服务器无转换环境时为 'docx'（回退） */
    format: (response.headers.get('X-Export-Format') === 'pdf' ? 'pdf' : 'docx') as 'pdf' | 'docx',
  };
}
