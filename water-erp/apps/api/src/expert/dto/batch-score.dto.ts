import { IsString, IsNumber, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ScoreItemDto {
  @IsString()
  scoreItemId: string;

  @IsNumber()
  @Type(() => Number)
  score: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class BatchScoreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreItemDto)
  items: ScoreItemDto[];

  @IsString()
  supplierName: string;
}
