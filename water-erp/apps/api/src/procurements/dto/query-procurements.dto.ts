import { IsOptional, IsInt, IsString, IsEnum, Min, IsIn, IsBoolean } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { Type, Transform } from 'class-transformer';
import { ResultStatus } from '@prisma/client';

export class QueryProcurementsDto {
  @EmptyAsUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @EmptyAsUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  procurementMethod?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @EmptyAsUndefined()
  @IsOptional()
  @IsEnum(ResultStatus)
  resultStatus?: ResultStatus;

  @IsOptional()
  @IsString()
  searchKeyword?: string;

  /** 仅看异常四态（:3011 异常卡→台账两步链路，2026-11-03）——query string 'true'/'1' 归一 */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  abnormalOnly?: boolean;

  @EmptyAsUndefined()
  @IsOptional()
  @IsIn(['ACTIVE', 'RECYCLED', 'ALL'])
  recycleStatus?: 'ACTIVE' | 'RECYCLED' | 'ALL' = 'ACTIVE';

  /** 台账类型快捷筛选（2026-09-20）：已归档=项目管理已完成的成交轮次；已终止=项目终止的取消轮次 */
  @EmptyAsUndefined()
  @IsOptional()
  @IsIn(['archived', 'terminated'])
  category?: 'archived' | 'terminated';

  @IsOptional()
  @IsString()
  sortBy?: string = 'procurementDate';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
