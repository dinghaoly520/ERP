import { IsString, IsNotEmpty, IsOptional, IsArray, MaxLength } from 'class-validator';

/**
 * AI 参考预算生成入参（2026-08 审计 E：原 @Body() payload: any）。
 * 与 ai.service.generateReferenceBudget 的签名对齐。
 */
export class ReferenceBudgetDto {
  @IsString() @IsNotEmpty() @MaxLength(300)
  projectTitle: string;

  @IsOptional() @IsString() @MaxLength(50)
  procurementMethod?: string;

  @IsOptional() @IsString() @MaxLength(50)
  procurementCategory?: string;

  @IsOptional() @IsString() @MaxLength(200)
  requesterDepartment?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  projectReason?: string;

  @IsOptional() @IsArray()
  historicalProjects?: Array<Record<string, unknown>>;
}
