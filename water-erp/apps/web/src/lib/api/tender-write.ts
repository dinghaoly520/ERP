import type {
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  TenderDocumentType,
} from "@/lib/types/tender-write";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

function parseErrorMessage(text: string) {
  const trimmed = text.trim();
  return trimmed || "导出失败，请稍后重试。";
}

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
}) {
  const response = await fetch(`${API_BASE}/tender-write/export`, {
    method: "POST",
    credentials: "include",
    // 裸 fetch 必须带 X-Portal 头，否则后端 portal-cookie 无法识别会话 → 401
    headers: { "Content-Type": "application/json", "X-Portal": "web" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(await response.text()));
  }

  return {
    blob: await response.blob(),
    fileName:
      parseFileName(response.headers.get("content-disposition")) ??
      "招标文件.docx",
  };
}
