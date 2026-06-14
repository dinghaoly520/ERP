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
  @IsBoolean()
  taxIncluded?: boolean;

  @IsOptional()
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
