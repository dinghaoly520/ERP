import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

/**
 * 「用文本替换附件」端点的入参（2026-11-25 审查补校验；此前是无校验的内联类型）。
 *
 * fileName 会原样落进 Attachment.fileName——界面展示用，归档时还用作归档目录里的文件名，
 * 所以不得含路径分隔符与控制字符。落盘的对象键由 sanitizeFileName 另行收口，不依赖这里。
 */
export class ReplaceAttachmentTextDto {
  @IsString()
  @IsNotEmpty()
  attachmentId!: string;

  /** 替换后的正文；空串是既有用法（清空正文），不设非空 */
  @IsString()
  text!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^/\\\u0000-\u001f]+$/, { message: 'fileName 不得包含路径分隔符或控制字符' })
  fileName!: string;
}
