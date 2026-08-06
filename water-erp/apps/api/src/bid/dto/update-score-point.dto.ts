import { IsString, IsNumber, IsInt, Min, Max, IsBoolean, IsOptional, IsArray } from 'class-validator';

export class UpdateScorePointDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  @IsOptional()
  fullScore?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  seq?: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @IsBoolean()
  @IsOptional()
  objective?: boolean;

  /** Phase 1：关联招标条款 requirementId 列表（N:M 指引） */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  linkedRequirementIds?: string[];
}
