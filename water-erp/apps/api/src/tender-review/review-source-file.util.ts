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

/** 控制字符：键里不允许出现（防日志注入与换行截断） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 是否审查模块自己的对象键：review/ 命名空间下的普通相对键。
 * 不限制其余字符集——存量任务的键带用户原始文件名（中文、空格、括号、#）。
 */
export function isReviewObjectKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.startsWith('review/')) return false;
  if (key.includes('\\') || CONTROL_CHARS.test(key)) return false;
  const rest = key.slice('review/'.length);
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
