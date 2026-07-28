import { IsString, IsNotEmpty, IsISO8601, IsOptional } from 'class-validator';

/**
 * 开标会话字段全部可选：不提供时仅推进阶段 SUBMIT→OPENING，
 * 不创建开标会话；提供时创建 BidOpeningSession。
 * 组建会话时主持人 + 解密窗口起止为必填组（service 层校验），
 * 监督人选填（法律未强制，见 bid.service.ts startOpening 注释）。
 */
export class StartOpeningDto {
  @IsOptional() @IsString() @IsNotEmpty()
  host?: string;

  /** 监督人：选填。空值请省略字段而非传空串（@IsNotEmpty 会拒绝空串）。 */
  @IsOptional() @IsString() @IsNotEmpty()
  supervisor?: string;

  @IsOptional() @IsISO8601()
  decryptWindowStart?: string;

  @IsOptional() @IsISO8601()
  decryptWindowEnd?: string;
}
