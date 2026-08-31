import { IsString, IsNotEmpty, IsOptional, IsInt, IsArray, Min, Max, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class SpecialtyQuotaDto {
  @IsString()
  specialty!: string;

  @IsInt() @Min(1)
  count!: number;

  @IsOptional() @IsString()
  reason?: string;

  /** 公司限定：该配额仅从工作单位匹配该公司的专家中抽取（需求方代表「公司→部门→专业」） */
  @IsOptional() @IsString()
  employer?: string;

  /** 部门限定（真部门 Department.name）：配额在公司内进一步按专家所属部门过滤 */
  @IsOptional() @IsString()
  department?: string;
}

export class ExtractPreviewDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsInt() @Min(1) @Max(9)
  totalNeeded?: number;

  @IsOptional() @IsInt() @Min(0) @Max(9)
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

  /** 预排除专家 userId 列表（这些专家不参与抽取） */
  @IsOptional() @IsArray()
  @IsString({ each: true })
  excludedUserIds?: string[];

  /** 公司限定（抽取配置「公司」下拉）：本次抽取的全部候选（含各专业配额与需求方代表）仅限该公司专家 */
  @IsOptional() @IsString()
  employer?: string;
}
