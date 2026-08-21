import type { ReadyTenderDocumentType } from '@/lib/types/tender-write';
import type { ImportAutofillResult } from '@/lib/types/tender-write-import';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

function parseErrorMessage(text: string) {
  const trimmed = text.trim();
  return trimmed || '分析失败，请稍后重试。';
}

export async function importAutofill(
  documentType: ReadyTenderDocumentType,
  files: File[],
): Promise<ImportAutofillResult> {
  const formData = new FormData();
  formData.append('documentType', documentType);

  for (const file of files) {
    formData.append('files', file);
  }

  // 统一走 /api 相对路径，由 src/proxy.ts 转发到后端（proxy 已透传 Cookie + X-Portal）。
  // 之前的「LAN 直连 :4000」逻辑是错误的——(1) water-erp API 端口是 4001 不是 4000；
  // (2) 直连会绕过 proxy 丢掉 X-Portal 头导致 401/跨域 Failed to fetch。
  const response = await fetch(`${API_BASE}/tender-write/import-autofill`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Portal': 'web' },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return response.json();
}
