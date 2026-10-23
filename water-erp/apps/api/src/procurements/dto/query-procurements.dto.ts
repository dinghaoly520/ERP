import { IsOptional, IsInt, IsString, IsEnum, Min, IsIn } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { Type } from 'class-transformer';
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
