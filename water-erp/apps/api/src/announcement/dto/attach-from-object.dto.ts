/**
 * I-1（2026-11-23 增量审查）：from-object 正式 DTO——objectKey 白名单校验。
 * 原实现为 controller 内联类型（ValidationPipe 对内联类型零校验），裸 body 键直传
 * readAttachmentBuffer（路径越界读→复制挂公告附件→公开披露链）。
 */
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Matches, MaxLength } from 'class-validator';
import { ATTACHMENT_KEY_CHARSET_RE } from '../../common/attachment-key.util';

export class AttachFromObjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  /**
   * 白名单：字母数字/中文开头，仅 [A-Za-z0-9一-龥/_\-.%]（% 兼容历史 URL 编码键）——
   * 拒绝对路径/空格/控制字符。'..' 段 charset 挡不住，由 readAttachmentBuffer containment 二道闸硬拦。
   * 正则常量与「引用采购文件」的源键闸同源（2026-11-24 审计第 1 处）。
   */
  @Matches(ATTACHMENT_KEY_CHARSET_RE, { message: 'objectKey 含非法字符（仅允许字母数字/中文/_-.%）' })
  objectKey: string;

  @IsString() @IsOptional() @MaxLength(255)
  fileName?: string;

  @IsString() @IsOptional() @MaxLength(255)
  title?: string;

  @IsString() @IsOptional() @MaxLength(128)
  mimeType?: string;

  @IsInt() @Min(0) @IsOptional()
  size?: number;
}
