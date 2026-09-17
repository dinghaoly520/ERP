import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueryProjectManagementDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  requesterDepartment?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED', 'RECYCLED'])
  status?: 'ACTIVE' | 'ARCHIVED' | 'RECYCLED';

  @IsOptional()
  @IsString()
  currentStage?: string;

  /** admin 专用公司过滤（公司级数据隔离）：不传/'all' = 全部公司；非 admin 一律忽略（保持个人隔离） */
  @IsOptional()
  @IsString()
  companyId?: string;
}
