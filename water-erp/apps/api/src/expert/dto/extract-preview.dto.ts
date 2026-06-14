import { IsString, IsNotEmpty, IsOptional, IsInt, IsArray, Min, Max, ValidateNested } from 'class-validator';
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

  @IsOptional() @IsString()
  mode?: 'weighted' | 'fair';

  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => SpecialtyQuotaDto)
  manualQuotas?: SpecialtyQuotaDto[];
}
