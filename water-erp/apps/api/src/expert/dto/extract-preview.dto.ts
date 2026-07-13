import { IsString, IsNotEmpty, IsOptional, IsInt, IsArray, Min, Max, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class SpecialtyQuotaDto {
  @IsString() @IsNotEmpty()
  specialty!: string;

  @IsInt() @Min(1)
  count!: number;

  @IsOptional() @IsString()
  reason?: string;
}

export class ExtractPreviewDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsInt() @Min(1) @Max(9)
  totalNeeded?: number;

  @IsOptional() @IsInt() @Min(0) @Max(5)
  alternatives?: number;

  /** @deprecated 保留兼容，优先使用 extractMode */
  @IsOptional() @IsString()
  mode?: 'weighted' | 'fair';

  /** 抽取模式：specialty_match=专业匹配 / random=随机抽取 / merit_best=综合择优 */
  @IsOptional() @IsString() @IsIn(['specialty_match', 'random', 'merit_best'])
  extractMode?: 'specialty_match' | 'random' | 'merit_best';

  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => SpecialtyQuotaDto)
  manualQuotas?: SpecialtyQuotaDto[];
}
