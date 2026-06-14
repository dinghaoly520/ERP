import { IsString, IsNotEmpty, IsISO8601, IsOptional } from 'class-validator';

/**
 * 开标会话字段全部可选：不提供时仅推进阶段 SUBMIT→OPENING，
 * 不创建开标会话；提供时创建 BidOpeningSession。
 */
export class StartOpeningDto {
  @IsOptional() @IsString() @IsNotEmpty()
  host?: string;

  @IsOptional() @IsString() @IsNotEmpty()
  supervisor?: string;

  @IsOptional() @IsISO8601()
  decryptWindowStart?: string;

  @IsOptional() @IsISO8601()
  decryptWindowEnd?: string;
}
