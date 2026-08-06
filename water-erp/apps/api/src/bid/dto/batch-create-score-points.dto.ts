import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber, Min, Max, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ScorePointInputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  fullScore: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @IsBoolean()
  @IsOptional()
  objective?: boolean;

  @IsString()
  @IsOptional()
  evidenceSection?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  confidence?: number;

  /** Phase 1：关联招标条款 requirementId 列表（N:M 指引；管理员在评分标准编制时维护） */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  linkedRequirementIds?: string[];
}

export class BatchCreateScorePointsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScorePointInputDto)
  points: ScorePointInputDto[];
}
