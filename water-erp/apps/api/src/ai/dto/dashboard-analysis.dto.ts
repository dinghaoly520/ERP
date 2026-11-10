import { IsOptional, IsString, IsArray } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

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

  /** 公司视野（all/单 id/逗号多选，2026-11-10）：服务端按登录人 scope 解析后作缓存键
   *  ——admin=本参数（选择器），非 admin=本人公司（传参忽略）；生成成功落服务端缓存 */
  @IsOptional() @IsString()
  companyId?: string;

  @IsOptional()
  summary?: unknown;

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  departmentStats?: unknown[];

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  methodStats?: unknown[];

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  resultStats?: unknown[];

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  supplierStats?: unknown[];

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  nonAwardReasons?: unknown[];

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  trendSeries?: unknown[];

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  riskProjects?: unknown[];

  @EmptyAsUndefined()
  @IsOptional() @IsArray()
  quickActions?: string[];
}
