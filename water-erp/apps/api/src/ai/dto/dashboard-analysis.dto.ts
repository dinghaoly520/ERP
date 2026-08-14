import { IsOptional, IsString, IsArray } from 'class-validator';

/**
 * AI 采购仪表盘深度分析入参（2026-08 审计 E：原 @Body() payload: any）。
 * 前端（web lib/api/ai.ts DashboardAnalysisPayload）传入仪表盘统计快照，
 * 供 LLM 生成综述。字段全部可选、嵌套统计结构不做逐项校验（内部分析透传），
 * 但类型声明使全局 ValidationPipe whitelist 生效（未知顶层字段被剥离）。
 */
export class DashboardAnalysisDto {
  @IsOptional() @IsString()
  startDate?: string;

  @IsOptional() @IsString()
  endDate?: string;

  @IsOptional() @IsString()
  rangeLabel?: string;

  @IsOptional()
  summary?: unknown;

  @IsOptional() @IsArray()
  departmentStats?: unknown[];

  @IsOptional() @IsArray()
  methodStats?: unknown[];

  @IsOptional() @IsArray()
  resultStats?: unknown[];

  @IsOptional() @IsArray()
  supplierStats?: unknown[];

  @IsOptional() @IsArray()
  nonAwardReasons?: unknown[];

  @IsOptional() @IsArray()
  trendSeries?: unknown[];

  @IsOptional() @IsArray()
  riskProjects?: unknown[];

  @IsOptional() @IsArray()
  quickActions?: string[];
}
