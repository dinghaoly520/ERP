import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const CATALOG_STATUSES = ['有效', '价格波动', '即将过期', '待复核', '下架', '停用'] as const;

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** 价格预警规则类型（schema.prisma PriceAlertRule.alertType） */
export const ALERT_TYPES = ['PRICE_SURGE', 'PRICE_DROP', 'EXPIRING', 'DEVIATION'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** 目录项关联类型（schema.prisma CatalogItemRelation.relationType） */
export const ITEM_RELATION_TYPES = ['SUBSTITUTE', 'COMPLEMENT', 'SIMILAR'] as const;
export type ItemRelationType = (typeof ITEM_RELATION_TYPES)[number];

/** 框架合同价格状态（schema.prisma ContractPrice.status） */
export const CONTRACT_PRICE_STATUSES = ['ACTIVE', 'EXPIRED', 'TERMINATED'] as const;
export type ContractPriceStatus = (typeof CONTRACT_PRICE_STATUSES)[number];

export class CatalogAdminListQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  categoryId?: number;

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

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  categoryId?: number | null;

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

// ── 价格预警规则 ──

export class CreateAlertRuleDto {
  @IsString()
  name!: string;

  @IsIn(ALERT_TYPES)
  alertType!: AlertType;

  @Type(() => Number)
  @IsNumber()
  threshold!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  categoryId?: number | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyRoles?: string[];
}

export class UpdateAlertRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(ALERT_TYPES)
  alertType?: AlertType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyRoles?: string[];
}

// ── 目录版本 ──

export class CreateVersionDto {
  @IsString()
  name!: string;

  @IsString()
  version!: string;

  // schema 要求 effectiveAt 必填，service 直接 new Date(dto.effectiveAt) 无兜底，故必填
  @IsDateString()
  effectiveAt!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ChangeVersionStatusDto {
  // schema.prisma CatalogVersion.status: DRAFT | ACTIVE | ARCHIVED
  @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED'])
  status!: string;
}

// ── 批量询价 ──

export class CreateInquiryDto {
  @IsString()
  title!: string;

  // schema: items Json [{ catalogItemId, spec, qty }]，必填
  @IsArray()
  items!: unknown[];

  @IsArray()
  @IsString({ each: true })
  supplierIds!: string[];

  @IsOptional()
  @IsDateString()
  deadlineAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 框架合同价格 ──

export class CreateContractPriceDto {
  @IsString()
  catalogItemId!: string;

  @IsString()
  supplierId!: string;

  @IsString()
  contractNo!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agreedPrice!: number;

  // schema 要求 validFrom/validUntil 必填，service 直接 new Date(...) 无兜底，故必填
  @IsDateString()
  validFrom!: string;

  @IsDateString()
  validUntil!: string;
}

export class UpdateContractPriceDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agreedPrice?: number;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsIn(CONTRACT_PRICE_STATUSES)
  status?: ContractPriceStatus;
}

// ── 目录项关联 ──

export class CreateItemRelationDto {
  @IsString()
  relatedItemId!: string;

  @IsString()
  @IsIn(ITEM_RELATION_TYPES)
  relationType!: ItemRelationType;
}

// ── 搜索日志 ──

export class SearchLogDto {
  @IsString()
  @MaxLength(200)
  keyword!: string;
}

// ── AI 自动分类 + 属性预填 ──

export class AiClassifyDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specification?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  categoryIdHint?: number;
}

// ── 目录项附件 ──

export class CreateAttachmentDto {
  @IsString()
  fileName!: string;

  @IsString()
  @MaxLength(2048)
  fileUrl!: string;

  // schema 注释枚举 IMAGE | PDF | CERTIFICATE | OTHER，但未在 DB 强约束；为避免误伤既有前端取值，此处仅校验字符串
  @IsString()
  fileType!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fileSize!: number;
}
