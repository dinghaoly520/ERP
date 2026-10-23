import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** 流标后再次采购·基本信息差异更新（spec 2026-10-23-abort-restart-unification §4.1）——仅传有变化字段，键名对齐 PMI 列名 */
export class ReprocBasicInfoDto {
  @IsOptional() @IsString() @MaxLength(100) requesterName?: string;
  @IsOptional() @IsString() @MaxLength(100) requesterDepartment?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(50) procurementCategory?: string;
  @IsOptional() @IsNumber() budgetAmount?: number;
  @IsOptional() @IsString() @MaxLength(2000) projectReason?: string;
  @IsOptional() @IsString() @MaxLength(2000) supplierRequirements?: string;
  /** 'YYYY-MM-DD'，服务端按本地时区解析 */
  @IsOptional() @IsString() initiationDate?: string;
  @IsOptional() @IsString() @MaxLength(20) procurementOrganizationForm?: string;
  @IsOptional() @IsBoolean() isAnnualBudget?: boolean;
}

export class ReprocDto {
  @IsIn(['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT'])
  startStageKey!: 'PROCUREMENT_DEMAND' | 'INITIATION' | 'TENDER_DOCUMENT';

  /** 不传 = 沿用当前采购方式；传入须 ∈ 五种 PMI 方式（服务端校验模板存在） */
  @IsOptional() @IsString() procurementMethod?: string;

  @IsOptional() @Type(() => ReprocBasicInfoDto) @ValidateNested()
  basicInfo?: ReprocBasicInfoDto;
}
