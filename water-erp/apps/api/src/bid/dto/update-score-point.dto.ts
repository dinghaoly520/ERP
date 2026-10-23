import { IsString, IsNumber, IsInt, Min, Max, IsBoolean, IsOptional, IsArray } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class UpdateScorePointDto {
  @IsString()
  @IsOptional()
  name?: string;

  @EmptyAsUndefined()
  @IsNumber()
  @Min(0)
  @Max(9999.9)
  @IsOptional()
  fullScore?: number;

  @EmptyAsUndefined()
  @IsInt()
  @Min(0)
  @IsOptional()
  seq?: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @EmptyAsUndefined()
  @IsBoolean()
  @IsOptional()
  objective?: boolean;

  /** Phase 1：关联招标条款 requirementId 列表（N:M 指引） */
  @EmptyAsUndefined()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  linkedRequirementIds?: string[];
}
