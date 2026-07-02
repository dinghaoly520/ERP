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
}
