import { IsOptional, IsInt, IsString, IsEnum, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ResultStatus } from '@prisma/client';

export class QueryProcurementsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

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

  @IsOptional()
  @IsEnum(ResultStatus)
  resultStatus?: ResultStatus;

  @IsOptional()
  @IsString()
  searchKeyword?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'RECYCLED', 'ALL'])
  recycleStatus?: 'ACTIVE' | 'RECYCLED' | 'ALL' = 'ACTIVE';

  @IsOptional()
  @IsString()
  sortBy?: string = 'procurementDate';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
