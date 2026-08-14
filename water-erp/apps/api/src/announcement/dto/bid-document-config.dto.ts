import { IsString, IsOptional, IsIn, MaxLength, IsArray } from 'class-validator';

/**
 * 招标文件上传/访问配置入参（2026-08 审计 E：原 @Body() body: any）。
 *
 * 注意：uploadBidDocument 是 multipart/form-data——所有值以字符串到达，
 * 布尔/数字由 controller 归一（与既有行为一致），DTO 只做白名单 + 字符串校验。
 */
export class BidDocumentUploadDto {
  @IsOptional() @IsString() @MaxLength(300)
  title?: string;

  @IsOptional() @IsIn(['OPEN', 'INVITED'])
  accessScope?: 'OPEN' | 'INVITED';

  /** multipart 传 'true'/'false' 字符串或布尔（controller 归一） */
  @IsOptional()
  requirePayment?: boolean | string;

  @IsOptional()
  price?: string | number;

  @IsOptional() @IsString() @MaxLength(100)
  bidProjectId?: string;

  /** 逗号分隔的供应商 ID 列表（controller split） */
  @IsOptional()
  allowedSupplierIds?: string | string[];
}

/** 更新招标文件访问配置（PUT，JSON） */
export class UpdateBidDocumentConfigDto {
  @IsOptional() @IsString() @MaxLength(300)
  title?: string;

  @IsOptional() @IsIn(['OPEN', 'INVITED'])
  accessScope?: 'OPEN' | 'INVITED';

  @IsOptional()
  requirePayment?: boolean | string;

  @IsOptional()
  price?: string | number;

  @IsOptional() @IsString() @MaxLength(100)
  bidProjectId?: string;

  @IsOptional() @IsArray()
  allowedSupplierIds?: string[];
}
