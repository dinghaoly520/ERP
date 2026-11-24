/**
 * PMI 附件键的形态校验（2026-11-24 审计第 1 处，封 P1-2 后半）。
 *
 * 纯函数、零存储依赖。规则要被三处共用：DTO 的声明式校验、「引用采购文件」的服务层闸、
 * 存储工具。它不能放进 attachment-object-store——那个模块在不少测试里被整体桩成
 * 只剩读写函数的假模块，规则放在那里会在那些测试里变成 undefined（DTO 校验静默失效）。
 */
import { BadRequestException, Logger } from '@nestjs/common';

/** 「引用采购文件」唯一合法的源：PMI 阶段附件键（project-management/<时间戳>-<前缀>-<文件名>） */
export const PMI_ATTACHMENT_KEY_PREFIX = 'project-management/';

/** 附件键字符集：字母数字/中文开头，仅 [A-Za-z0-9一-龥/_\-.%]（% 兼容历史 URL 编码键）——拒绝对路径、空格、控制字符、反斜杠 */
export const ATTACHMENT_KEY_CHARSET_RE = /^[A-Za-z0-9一-龥][A-Za-z0-9一-龥/_\-.%]*$/;

const ATTACHMENT_KEY_MAX_LENGTH = 512;

const logger = new Logger('attachment-key.util');

/** 键的形态是否安全：字符串、长度 1..512、字符集合法、没有等于 ".." 的路径段 */
export function isSafeAttachmentKey(objectKey: unknown): objectKey is string {
  if (typeof objectKey !== 'string') return false;
  if (objectKey.length === 0 || objectKey.length > ATTACHMENT_KEY_MAX_LENGTH) return false;
  if (!ATTACHMENT_KEY_CHARSET_RE.test(objectKey)) return false;
  return !objectKey.split('/').includes('..');
}

/**
 * 「引用采购文件」源键闸：源键只认 PMI 阶段附件。
 * 发布链路的调用点会吞掉异常只留日志，所以拒绝前打一条带业务码的警告——那是拒绝发生时唯一的可见痕迹。
 */
export function assertPmiAttachmentSourceKey(objectKey: string): void {
  let code: 'FORBIDDEN_SOURCE_KEY' | 'INVALID_OBJECT_KEY';
  if (typeof objectKey !== 'string' || !objectKey.startsWith(PMI_ATTACHMENT_KEY_PREFIX)) {
    code = 'FORBIDDEN_SOURCE_KEY';
  } else if (!isSafeAttachmentKey(objectKey)) {
    code = 'INVALID_OBJECT_KEY';
  } else {
    return;
  }
  // 键是攻击者可控的：经 JSON.stringify 再截断，换行之类的控制字符破坏不了日志
  logger.warn(`[PMI_SOURCE_KEY] 拒绝引用：code=${code} key=${JSON.stringify(objectKey).slice(0, 120)}`);
  if (code === 'FORBIDDEN_SOURCE_KEY') {
    throw new BadRequestException({
      error: '禁止引用该对象（objectKey 须以 project-management/ 开头——仅允许引用 PMI 阶段附件）',
      code,
    });
  }
  throw new BadRequestException({ error: '非法附件键（路径越界或含非法字符）', code });
}
