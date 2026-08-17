import { IsString, IsNotEmpty, IsOptional, IsObject, MaxLength } from 'class-validator';

/**
 * AI 招标字段内容生成入参（2026-08 审计 E：原 @Body() payload: any）。
 * 与 ai.service.generateTenderFieldContent 的签名对齐。
 */
export class TenderFieldGenerateDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  fieldKey: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  fieldLabel: string;

  @IsString() @MaxLength(20000)
  currentValue: string;

  @IsOptional() @IsString() @MaxLength(2000)
  aiPrompt?: string;

  @IsOptional() @IsObject()
  context?: Record<string, unknown>;
}
