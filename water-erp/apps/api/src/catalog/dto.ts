import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export const CATALOG_STATUSES = ['有效', '价格波动', '即将过期', '待复核', '下架', '停用'] as const;

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export class CatalogAdminListQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class CatalogItemAdminDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  specification!: string;

  @IsString()
  category!: string;

  @IsString()
  group!: string;

  @IsString()
  unit!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  referencePrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lastDealPrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  averagePrice!: number;

  @IsString()
  supplier!: string;

  @IsString()
  supplierType!: string;

  @IsString()
  priceSource!: string;

  @IsString()
  region!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  taxIncluded?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  freightIncluded?: boolean;

  @Type(() => Number)
  @IsNumber()
  changeRate!: number;

  @IsString()
  minOrder!: string;

  @IsOptional()
  @IsString()
  remark?: string | null;

  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  status?: CatalogStatus;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @IsDateString()
  validUntil?: string | null;
}

export class UpdateCatalogItemAdminDto extends CatalogItemAdminDto {}

export class CatalogStatusDto {
  @IsIn(['有效', '下架', '停用', '待复核'])
  status!: CatalogStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ── 品类树 ──

export class CreateCatalogCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  parentId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isLeaf?: boolean;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateCatalogCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isLeaf?: boolean;

  @IsOptional()
  @IsString()
  icon?: string | null;
}

export class MoveCategoryDto {
  @Type(() => Number)
  @IsNumber()
  newSortOrder!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  newParentId?: number | null;
}

export class CreateAttributeTemplateDto {
  @IsString()
  name!: string;

  @IsString()
  fieldKey!: string;

  @IsString()
  @IsIn(['TEXT', 'NUMBER', 'SELECT', 'DATE', 'BOOLEAN'])
  fieldType!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  options?: string[];

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

export class UpdateAttributeTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['TEXT', 'NUMBER', 'SELECT', 'DATE', 'BOOLEAN'])
  fieldType?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  options?: string[];

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

export class SetItemAttributesDto {
  @Type(() => Array)
  attributes!: { templateId: number; value: string }[];
}
