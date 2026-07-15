import { IsString, IsNumber, IsBoolean, IsOptional, IsNotEmpty, IsArray, ValidateNested, Min, Max } from 'class-validator';
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

export class CreateScoreDto {
  @IsString()
  @IsNotEmpty()
  expertId: string;

  @IsString()
  @IsNotEmpty()
  scoreItemId: string;

  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  score: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  passed?: boolean;

  @IsArray() @ValidateNested({ each: true }) @Type(() => PointDecisionDto) @IsOptional()
  pointDecisions?: PointDecisionDto[];
}
