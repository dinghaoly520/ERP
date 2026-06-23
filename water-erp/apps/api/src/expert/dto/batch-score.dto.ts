import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class ScoreItemDto {
  @IsString() @IsNotEmpty()
  scoreItemId: string;

  @IsString() @IsNotEmpty()
  supplierId: string;

  @IsNumber() @Min(0) @Max(100)
  score: number;

  @IsString() @IsOptional()
  reason?: string;
}

export class BatchScoreDto {
  @IsString() @IsNotEmpty()
  supplierName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreItemDto)
  scores: ScoreItemDto[];
}
