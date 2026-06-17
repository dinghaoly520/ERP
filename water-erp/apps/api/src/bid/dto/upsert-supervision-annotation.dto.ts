import { IsString, IsOptional, IsIn } from 'class-validator';

export class UpsertSupervisionAnnotationDto {
  @IsString()
  supplierId: string;

  @IsIn(['flagged', 'escalated', 'cleared'])
  status: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}
