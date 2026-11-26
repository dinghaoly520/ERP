import { randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * 文档审查的源文件（审计第 3 处，2026-11-25）。
 *
 * 背景：审查任务的 objectKey 此前由客户端经 POST /tender-review/review/execute 直接指定，
 * 之后的下载、备份、覆盖写、回滚都作用于这个键——任何内部角色都能借它读写对象存储里的任意对象。
 * 现在键只由服务端生成，并在这里守住两道闸：
 *  - 审查模块每次读写存储前，先断言键落在自己的命名空间 review/ 内（isReviewObjectKey / assertReviewObjectKey）；
 *  - 存储层 StorageService 对所有模块的键设底线（见 storage/storage.service.ts 的 assertStorableObjectKey）。
 */

/** 审查源文件在 FileAsset.category 里的类目名 */
export const REVIEW_SOURCE_CATEGORY = 'tender_review_source';

/**
 * 清理进行中的审查源文件（2026-11-26）：记录已定案要删、对象还没删完（见 review-source-cleanup.ts）。
 * 到了这个状态的文件不能再被新任务引用——执行审查只认 REVIEW_SOURCE_CATEGORY，并在锁内复核。
 * 访问与删除规则跟正常状态一样：判断「是不是审查源文件」用 isReviewSourceCategory，别只比 REVIEW_SOURCE_CATEGORY。
 */
export const REVIEW_SOURCE_PURGING_CATEGORY = 'tender_review_source_purging';

/** 审查模块对象键的命名空间前缀（isReviewObjectKey / buildReviewSourceKey / 每日清理挑候选共用） */
export const REVIEW_OBJECT_KEY_PREFIX = 'review/';

/** 是否审查源文件（含清理进行中的） */
export function isReviewSourceCategory(category: unknown): boolean {
  return category === REVIEW_SOURCE_CATEGORY || category === REVIEW_SOURCE_PURGING_CATEGORY;
}

/** 控制字符：键里不允许出现（防日志注入与换行截断） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 是否审查模块自己的对象键：review/ 命名空间下的普通相对键。
 * 不限制其余字符集——存量任务的键带用户原始文件名（中文、空格、括号、#）。
 */
export function isReviewObjectKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.startsWith(REVIEW_OBJECT_KEY_PREFIX)) return false;
  if (key.includes('\\') || CONTROL_CHARS.test(key)) return false;
  const rest = key.slice(REVIEW_OBJECT_KEY_PREFIX.length);
  if (!rest) return false;
  return rest.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** 取出任务的对象键供存储操作使用；不在审查命名空间内 → 400 INVALID_REVIEW_OBJECT_KEY */
export function assertReviewObjectKey(key: unknown): string {
  if (!isReviewObjectKey(key)) {
    throw new BadRequestException({ error: '非法的审查文件键', code: 'INVALID_REVIEW_OBJECT_KEY' });
  }
  return key;
}

/** 审查文档的四种类型：登记用的 MIME 与对象键扩展名 */
const REVIEW_SOURCE_TYPES: ReadonlyArray<{ mime: string; ext: string }> = [
  { mime: 'application/pdf', ext: 'pdf' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  { mime: 'application/msword', ext: 'doc' },
  { mime: 'text/plain', ext: 'txt' },
];

/**
 * 审查文档的类型与对象键扩展名。
 * 浏览器偶发把 Word 上报成通用类型或空串：声明 MIME 不在四种之内时，按文件名后缀推断。
 * 两者都不是四种之一 → null（调用方拒绝）。
 */
export function resolveReviewSourceType(
  mimeType: string,
  fileName: string,
): { mime: string; ext: string } | null {
  const declared = REVIEW_SOURCE_TYPES.find((t) => t.mime === mimeType);
  if (declared) return declared;
  const dot = fileName.lastIndexOf('.');
  const ext = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
  return REVIEW_SOURCE_TYPES.find((t) => t.ext === ext) ?? null;
}

/** 新上传的对象键：review/<yyyy-MM-dd>/<32 位十六进制随机>.<扩展名>——不含任何用户提供的字符 */
export function buildReviewSourceKey(ext: string): string {
  return `${REVIEW_OBJECT_KEY_PREFIX}${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString('hex')}.${ext}`;
}
