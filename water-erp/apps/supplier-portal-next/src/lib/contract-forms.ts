export const CONTRACT_PROOF_MAX_BYTES = 50 * 1024 * 1024;

export type LocalRecordsView = "platform" | "archive";

export function getLocalRecordsPanelVisibility(view: LocalRecordsView): {
  platform: boolean;
  archive: boolean;
} {
  return {
    platform: view === "platform",
    archive: view === "archive",
  };
}

const SUPPORTED_PROOF_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

const SUPPORTED_PROOF_EXTENSIONS = /\.(pdf|doc|docx|jpe?g|png)$/i;

const PROOF_EXTENSIONS_BY_MIME: Record<string, Set<string>> = {
  "application/pdf": new Set(["pdf"]),
  "application/msword": new Set(["doc"]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set(["docx"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/png": new Set(["png"]),
};

export function validateProofFile(file: Pick<File, "name" | "type" | "size">): string | null {
  if (file.size > CONTRACT_PROOF_MAX_BYTES) return "文件大小不能超过 50 MB";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const mimeSupported = SUPPORTED_PROOF_MIME_TYPES.has(file.type);
  const extensionSupported = SUPPORTED_PROOF_EXTENSIONS.test(file.name);
  if (!mimeSupported && !extensionSupported) {
    return "仅支持 PDF、Word、JPG 或 PNG 文件";
  }
  if (!mimeSupported || !extensionSupported || !PROOF_EXTENSIONS_BY_MIME[file.type]?.has(extension)) {
    return "文件扩展名与实际类型不一致";
  }
  return null;
}

export function canAttachFulfillmentProof(contractStatus: string, fulfillmentStatus: string): boolean {
  return ["signed", "performing"].includes(contractStatus) && fulfillmentStatus !== "done";
}

export function validateSatisfaction(score: number): string | null {
  return Number.isInteger(score) && score >= 1 && score <= 5
    ? null
    : "请选择 1 至 5 分的满意度";
}
