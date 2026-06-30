import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateProjectStageDto {
  @IsIn(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
  status!: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

  @IsString()
  @IsOptional()
  note?: string;
}
