import { IsString, IsNotEmpty, IsIn, IsOptional, MaxLength } from 'class-validator';

/**
 * 供应商目录供货申请入参（2026-08 审计 E：原 @Body() body: any）。
 * 与 supplier-portal.service.createCatalogApplication / updateMyCatalogApplication
 * 的入参签名对齐；type 合法值与 service 内校验一致。
 */
export class CreateCatalogApplicationDto {
  @IsString() @IsNotEmpty() @IsIn(['NEW_ITEM', 'JOIN_EXISTING', 'UPDATE_QUOTE'])
  type: 'NEW_ITEM' | 'JOIN_EXISTING' | 'UPDATE_QUOTE';

  @IsOptional() @IsString() @MaxLength(100)
  catalogItemId?: string;

  @IsOptional() @IsString() @MaxLength(300)
  proposedName?: string;

  @IsOptional() @IsString() @MaxLength(500)
  proposedSpec?: string;

  @IsOptional() @IsString() @MaxLength(100)
  proposedCategory?: string;

  @IsOptional() @IsString() @MaxLength(100)
  proposedGroup?: string;

  @IsOptional() @IsString() @MaxLength(50)
  proposedUnit?: string;

  /** 报价：表单可能传字符串或数字（service 内 Number() 归一——不加 @IsNumber 以免字符串报价被 400） */
  @IsOptional()
  quotedPrice?: string | number;

  @IsOptional() @IsString() @MaxLength(100)
  deliveryPeriod?: string;

  @IsOptional() @IsString() @MaxLength(100)
  region?: string;

  @IsOptional() @IsString() @MaxLength(50)
  minOrder?: string;

  @IsOptional()
  taxIncluded?: boolean;

  @IsOptional()
  freightIncluded?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  qualificationNote?: string;

  @IsOptional() @IsString() @MaxLength(100)
  attachmentFileAssetId?: string;
}

/** 更新（PATCH 语义：全部可选） */
export class UpdateCatalogApplicationDto {
  @IsOptional() @IsString() @MaxLength(300)
  proposedName?: string;

  @IsOptional() @IsString() @MaxLength(500)
  proposedSpec?: string;

  @IsOptional() @IsString() @MaxLength(100)
  proposedCategory?: string;

  @IsOptional() @IsString() @MaxLength(100)
  proposedGroup?: string;

  @IsOptional() @IsString() @MaxLength(50)
  proposedUnit?: string;

  @IsOptional()
  quotedPrice?: string | number;

  @IsOptional() @IsString() @MaxLength(100)
  deliveryPeriod?: string;

  @IsOptional() @IsString() @MaxLength(100)
  region?: string;

  @IsOptional() @IsString() @MaxLength(50)
  minOrder?: string;

  @IsOptional()
  taxIncluded?: boolean;

  @IsOptional()
  freightIncluded?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  qualificationNote?: string;

  @IsOptional() @IsString() @MaxLength(100)
  attachmentFileAssetId?: string;
}
