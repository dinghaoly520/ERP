import { IsOptional, IsArray, IsObject } from 'class-validator';

/**
 * AI 采购台账分析入参（2026-08 审计 E：原 @Body() payload: any）。
 * 前端（web lib/api/procurements.ts）传入台账行 + 汇总统计，供 LLM 分析。
 */
export class ProcurementAnalysisDto {
  @IsOptional() @IsArray()
  items?: Array<Record<string, unknown>>;

  @IsOptional() @IsObject()
  summary?: Record<string, unknown>;
}
