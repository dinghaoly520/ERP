import { createHash } from 'node:crypto';
import { IMAGE_MIME_TYPES, matchesFileContentPolicy, PDF_IMAGE_MIME_TYPES } from './file-content-policy';

/** 手机号不直接进入对象键；哈希命名空间把匿名上传与最终注册主体绑定。 */
export function registrationUploadNamespace(phone: string): string {
  const digest = createHash('sha256').update(phone.trim()).digest('hex').slice(0, 24);
  return `registration/${digest}`;
}

export function registrationAssetIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\/api\/upload\/files\/([^/?#]+)$/.exec(value.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function isValidRegistrationUploadFile(
  file: Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'buffer' | 'size'>,
  category: string,
): boolean {
  const maxBytes = category === 'general' ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  const mimeTypes = category === 'general' ? IMAGE_MIME_TYPES : PDF_IMAGE_MIME_TYPES;
  return file.size > 0
    && file.size <= maxBytes
    && matchesFileContentPolicy(file, mimeTypes);
}
