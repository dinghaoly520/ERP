/** 附件上传统一规则（2026-10-19 spec）：与后端 apps/api/src/upload/attachment-rules.ts 同口径 */

export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.pdf,.zip,.rar';
export const ATTACHMENT_HINT = '支持 PNG/JPG/Word/PDF/Excel/ZIP/RAR，单个不超过 100MB';
export const ATTACHMENT_MAX_MB = 100;

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** A 类（自由附件）：大小 + 9 扩展白名单；返回错误文案或 null（通过） */
export function validateAttachmentFile(file: File): string | null {
  const sizeErr = validateFileSize(file);
  if (sizeErr) return sizeErr;
  if (!ALLOWED_EXTENSIONS.has(extOf(file.name))) {
    return `不支持的附件格式：${file.name}（${ATTACHMENT_HINT}）`;
  }
  return null;
}

/** B 类/解析型入口（通知书/审批表/立项解析等业务格式约束点）：仅大小校验 */
export function validateFileSize(file: File, maxMb = ATTACHMENT_MAX_MB): string | null {
  if (file.size > maxMb * 1024 * 1024) {
    return `「${file.name}」超过 ${maxMb}MB 上限（当前 ${(file.size / (1024 * 1024)).toFixed(1)}MB）`;
  }
  return null;
}
