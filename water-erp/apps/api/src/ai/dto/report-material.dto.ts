import { IsOptional, IsString, IsArray } from 'class-validator';

/**
 * 汇报材料 AI 分析入参（2026-11-17 用户裁定：各板块说明由 AI 生成）。
 * 前端传数据库页统计快照（比 dashboard-analysis 更宽：趋势含立项/归档、
 * 部门含完成率、规模分层/节资榜/供应商明细）。字段可选、嵌套结构透传，
 * 类型声明使全局 ValidationPipe whitelist 生效（未知顶层字段被剥离）。
 */
export class ReportMaterialDto {
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() rangeLabel?: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() summary?: unknown;
  @IsOptional() trendSeries?: unknown[];
  @IsOptional() departmentStats?: unknown[];
  @IsOptional() methodStats?: unknown[];
  @IsOptional() scaleSegments?: unknown[];
  @IsOptional() savingsRanking?: unknown[];
  @IsOptional() supplierStats?: unknown[];
}
