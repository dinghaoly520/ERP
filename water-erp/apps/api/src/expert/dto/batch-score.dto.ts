import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class PointDecisionDto {
  @IsString() @IsNotEmpty()
  pointId: string;

  @IsBoolean()
  checked: boolean;

  @IsNumber() @Min(0) @Max(9999.9)
  awardedScore: number;

  @IsString() @IsOptional()
  note?: string;
}

class ScoreItemDto {
  @IsString() @IsNotEmpty()
  scoreItemId: string;

  @IsString() @IsNotEmpty()
  supplierId: string;

  @IsNumber() @Min(0) @Max(100) @IsOptional()
  score?: number;

  @IsBoolean() @IsOptional()
  passed?: boolean;

  @IsString() @IsOptional()
  reason?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => PointDecisionDto) @IsOptional()
  pointDecisions?: PointDecisionDto[];
}

export class BatchScoreDto {
  @IsString() @IsNotEmpty()
  supplierName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreItemDto)
  scores: ScoreItemDto[];
}
