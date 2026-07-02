import type { ReadyTenderDocumentType } from '@/lib/types/tender-write';
import type { ImportAutofillResult } from '@/lib/types/tender-write-import';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

function parseErrorMessage(text: string) {
  const trimmed = text.trim();
  return trimmed || '分析失败，请稍后重试。';
}

/**
 * Build the full API URL for import-autofill.
 *
 * Next.js rewrites /api/* to the backend, but multipart/form-data
 * forwarding can be unreliable through the proxy. When accessing
 * via LAN IP, construct a direct URL to the backend instead.
 */
function getImportAutofillUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured?.startsWith('http://') || configured?.startsWith('https://')) {
    return `${configured}/tender-write/import-autofill`;
  }

  // Check if accessed via LAN (not localhost)
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:4000/api/tender-write/import-autofill`;
  }

  return `${API_BASE}/tender-write/import-autofill`;
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

  const response = await fetch(getImportAutofillUrl(), {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return response.json();
}
