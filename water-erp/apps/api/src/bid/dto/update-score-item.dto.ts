import { IsEnum, IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { ScoreCategory } from '@prisma/client';

export class UpdateScoreItemDto {
  @EmptyAsUndefined()
  @IsEnum(ScoreCategory)
  @IsOptional()
  category?: ScoreCategory;

  @IsString()
  @IsOptional()
  name?: string;

  @EmptyAsUndefined()
  @IsNumber()
  @Min(0)
  @Max(9999.9)
  @IsOptional()
  maxScore?: number;
}
