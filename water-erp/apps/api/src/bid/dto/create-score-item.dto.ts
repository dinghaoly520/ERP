import { IsEnum, IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';
import { ScoreCategory } from '@prisma/client';

export class CreateScoreItemDto {
  @IsEnum(ScoreCategory)
  category: ScoreCategory;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  maxScore: number;
}
