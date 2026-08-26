import { IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePlanItemDto {
  @IsString()
  @MaxLength(200)
  content!: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
