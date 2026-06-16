import { IsEnum, IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { ScoreCategory } from '@prisma/client';

export class UpdateScoreItemDto {
  @IsEnum(ScoreCategory)
  @IsOptional()
  category?: ScoreCategory;

  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  @IsOptional()
  maxScore?: number;
}
