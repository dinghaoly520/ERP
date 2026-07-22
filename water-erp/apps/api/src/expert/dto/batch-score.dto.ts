import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional, IsBoolean, Min, Max, ArrayNotEmpty, ArrayMaxSize } from 'class-validator';
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

  // P1-10：得分点裁定限流，防巨量请求拖垮单事务
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PointDecisionDto) @IsOptional()
  pointDecisions?: PointDecisionDto[];
}

export class BatchScoreDto {
  @IsString() @IsNotEmpty()
  supplierName: string;

  // P1-10：评分项数组非空且限流，防巨量请求在单事务内顺序 upsert 致 DoS
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ScoreItemDto)
  scores: ScoreItemDto[];
}
